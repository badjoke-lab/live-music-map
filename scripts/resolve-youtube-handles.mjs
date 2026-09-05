const API_KEY = process.env.YOUTUBE_API_KEY?.trim();
const handles = String(process.env.YOUTUBE_HANDLES || '')
  .split(',')
  .map((value) => value.trim().replace(/^@/, ''))
  .filter(Boolean);
const videoIds = String(process.env.YOUTUBE_VIDEO_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const channelIds = String(process.env.YOUTUBE_CHANNEL_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const scanLimit = Math.max(1, Math.min(50, Number(process.env.YOUTUBE_SCAN_LIMIT || 50)));

if (!API_KEY) throw new Error('YOUTUBE_API_KEY is required');
if (!handles.length && !videoIds.length && !channelIds.length) {
  throw new Error('YOUTUBE_HANDLES, YOUTUBE_VIDEO_IDS or YOUTUBE_CHANNEL_IDS is required');
}

async function api(resource, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
  for (const [key, value] of Object.entries({ ...params, key: API_KEY })) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `${response.status} ${response.statusText}`);
  return body;
}

async function getChannel(channelId) {
  const result = await api('channels', { part: 'id,snippet,contentDetails', id: channelId, maxResults: 1 });
  return result.items?.[0] || null;
}

function channelRow(channel, origin) {
  return {
    origin,
    title: channel?.snippet?.title || null,
    youtube_channel_id: channel?.id || null,
    youtube_uploads_playlist_id: channel?.contentDetails?.relatedPlaylists?.uploads || null
  };
}

async function printChannel(channelId, origin) {
  const channel = await getChannel(channelId);
  if (!channel?.id) {
    console.log(`UNRESOLVED CHANNEL ${channelId} from ${origin}`);
    return null;
  }
  console.log(JSON.stringify(channelRow(channel, origin)));
  return channel;
}

async function scanChannel(channelId) {
  const channel = await getChannel(channelId);
  if (!channel?.id) {
    console.log(`UNRESOLVED CHANNEL ${channelId}`);
    return;
  }
  console.log(JSON.stringify(channelRow(channel, `scan:${channelId}`)));
  const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return;
  const items = await api('playlistItems', {
    part: 'contentDetails',
    playlistId: uploads,
    maxResults: scanLimit
  });
  const ids = (items.items || []).map((item) => item.contentDetails?.videoId).filter(Boolean);
  if (!ids.length) {
    console.log(`SCAN ${channelId}: no uploads found`);
    return;
  }
  const videos = await api('videos', {
    part: 'snippet,liveStreamingDetails',
    id: ids.join(','),
    maxResults: ids.length
  });
  const liveRows = (videos.items || [])
    .filter((video) => video.liveStreamingDetails)
    .map((video) => ({
      video_id: video.id,
      video_title: video.snippet?.title || null,
      published_at: video.snippet?.publishedAt || null,
      scheduled_start: video.liveStreamingDetails?.scheduledStartTime || null,
      actual_start: video.liveStreamingDetails?.actualStartTime || null,
      actual_end: video.liveStreamingDetails?.actualEndTime || null
    }));
  console.log(`SCAN ${channel.snippet?.title || channelId}: ${liveRows.length} livestream record(s) in ${ids.length} recent uploads`);
  for (const row of liveRows) console.log(JSON.stringify(row));
}

for (const handle of handles) {
  const result = await api('channels', { part: 'id,snippet,contentDetails', forHandle: handle, maxResults: 1 });
  const channel = result.items?.[0];
  if (!channel?.id) {
    console.log(`UNRESOLVED @${handle}`);
    continue;
  }
  console.log(JSON.stringify(channelRow(channel, `@${handle}`)));
}

for (const videoId of videoIds) {
  const result = await api('videos', { part: 'snippet,liveStreamingDetails', id: videoId, maxResults: 1 });
  const video = result.items?.[0];
  const channelId = video?.snippet?.channelId;
  if (!channelId) {
    console.log(`UNRESOLVED VIDEO ${videoId}`);
    continue;
  }
  const live = video.liveStreamingDetails || null;
  console.log(JSON.stringify({
    video_id: videoId,
    video_title: video.snippet?.title || null,
    video_channel_title: video.snippet?.channelTitle || null,
    video_channel_id: channelId,
    scheduled_start: live?.scheduledStartTime || null,
    actual_start: live?.actualStartTime || null,
    actual_end: live?.actualEndTime || null,
    has_live_streaming_details: Boolean(live)
  }));
  await printChannel(channelId, `video:${videoId}`);
}

for (const channelId of channelIds) await scanChannel(channelId);
