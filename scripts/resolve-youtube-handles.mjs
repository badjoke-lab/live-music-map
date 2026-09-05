const API_KEY = process.env.YOUTUBE_API_KEY?.trim();
const handles = String(process.env.YOUTUBE_HANDLES || '')
  .split(',')
  .map((value) => value.trim().replace(/^@/, ''))
  .filter(Boolean);
const videoIds = String(process.env.YOUTUBE_VIDEO_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (!API_KEY) throw new Error('YOUTUBE_API_KEY is required');
if (!handles.length && !videoIds.length) throw new Error('YOUTUBE_HANDLES or YOUTUBE_VIDEO_IDS is required');

async function api(resource, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
  for (const [key, value] of Object.entries({ ...params, key: API_KEY })) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `${response.status} ${response.statusText}`);
  return body;
}

async function printChannel(channelId, origin) {
  const result = await api('channels', { part: 'id,snippet,contentDetails', id: channelId, maxResults: 1 });
  const channel = result.items?.[0];
  if (!channel?.id) {
    console.log(`UNRESOLVED CHANNEL ${channelId} from ${origin}`);
    return;
  }
  console.log(JSON.stringify({
    origin,
    title: channel.snippet?.title || null,
    youtube_channel_id: channel.id,
    youtube_uploads_playlist_id: channel.contentDetails?.relatedPlaylists?.uploads || null
  }));
}

for (const handle of handles) {
  const result = await api('channels', { part: 'id,snippet,contentDetails', forHandle: handle, maxResults: 1 });
  const channel = result.items?.[0];
  if (!channel?.id) {
    console.log(`UNRESOLVED @${handle}`);
    continue;
  }
  console.log(JSON.stringify({
    origin: `@${handle}`,
    title: channel.snippet?.title || null,
    youtube_channel_id: channel.id,
    youtube_uploads_playlist_id: channel.contentDetails?.relatedPlaylists?.uploads || null
  }));
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
