import fs from 'node:fs/promises';

const API_KEY = process.env.YOUTUBE_API_KEY?.trim();

if (!API_KEY) {
  console.log('YOUTUBE_API_KEY is not configured; leaving data unchanged.');
  process.exit(0);
}

const sourcesPath = new URL('../data/sources.json', import.meta.url);
const streamsPath = new URL('../data/streams.json', import.meta.url);
const acquisitionPath = new URL('../data/acquisition.json', import.meta.url);

const sources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
const previousStreams = JSON.parse(await fs.readFile(streamsPath, 'utf8'));
const sourceBySourceId = new Map(sources.map((source) => [source.id, source]));
let acquisition = {};
try { acquisition = JSON.parse(await fs.readFile(acquisitionPath, 'utf8')); } catch {}

async function api(path, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries({ ...params, key: API_KEY })) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`${path}: ${message}`);
  }
  return body;
}

function parseYoutubeRef(urlString) {
  const url = new URL(urlString);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'channel' && parts[1]) return { kind: 'channel', value: parts[1] };
  if (parts[0]?.startsWith('@')) return { kind: 'handle', value: parts[0].slice(1) };
  if (parts[0]) return { kind: 'username', value: parts[0] };
  return null;
}

async function resolveChannel(source) {
  if (source.youtube_channel_id && source.youtube_uploads_playlist_id) {
    return {
      channelId: source.youtube_channel_id,
      uploadsPlaylistId: source.youtube_uploads_playlist_id,
      changed: false
    };
  }

  let channelId = source.youtube_channel_id || null;
  if (!channelId) {
    if (!source.youtube_url) return null;
    const ref = parseYoutubeRef(source.youtube_url);
    if (!ref) return null;
    if (ref.kind === 'channel') channelId = ref.value;
    else {
      const params = { part: 'id,contentDetails', maxResults: 1 };
      if (ref.kind === 'handle') params.forHandle = ref.value;
      if (ref.kind === 'username') params.forUsername = ref.value;
      const result = await api('channels', params);
      const channel = result.items?.[0];
      if (!channel?.id) return null;
      channelId = channel.id;
      const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads || null;
      if (uploadsPlaylistId) {
        source.youtube_channel_id = channelId;
        source.youtube_uploads_playlist_id = uploadsPlaylistId;
        return { channelId, uploadsPlaylistId, changed: true };
      }
    }
  }

  const result = await api('channels', { part: 'contentDetails', id: channelId, maxResults: 1 });
  const uploadsPlaylistId = result.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || null;
  if (!uploadsPlaylistId) return null;
  const changed = source.youtube_channel_id !== channelId || source.youtube_uploads_playlist_id !== uploadsPlaylistId;
  source.youtube_channel_id = channelId;
  source.youtube_uploads_playlist_id = uploadsPlaylistId;
  return { channelId, uploadsPlaylistId, changed };
}

function thumbnail(snippet) {
  const t = snippet?.thumbnails || {};
  return t.maxres?.url || t.standard?.url || t.high?.url || t.medium?.url || t.default?.url || null;
}

function liveState(video) {
  if (video.snippet?.liveBroadcastContent === 'live') return 'live';
  if (video.snippet?.liveBroadcastContent === 'upcoming') return 'upcoming';
  return null;
}

function toRecord(source, video, status) {
  const live = video.liveStreamingDetails || {};
  return {
    id: `youtube:${video.id}`,
    origin: 'youtube_api',
    discovery: 'uploads_playlist',
    query_event_type: status,
    source_id: source.id,
    youtube_video_id: video.id,
    youtube_url: `https://www.youtube.com/watch?v=${video.id}`,
    title: video.snippet?.title || '(untitled)',
    status,
    published_at: video.snippet?.publishedAt || null,
    scheduled_start: live.scheduledStartTime || null,
    actual_start: live.actualStartTime || null,
    actual_end: live.actualEndTime || null,
    concurrent_viewers: live.concurrentViewers ? Number(live.concurrentViewers) : null,
    thumbnail: thumbnail(video.snippet),
    embed_allowed: video.status?.embeddable ?? null,
    genres: [],
    genre_status: 'unknown',
    performers: [],
    venue: null,
    location: null,
    location_rule: 'unknown_until_verified'
  };
}

function chunks(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

const fresh = [];
const failedSources = new Set();
const sourceByVideoId = new Map();
let sourceChanged = false;
let playlistQueries = 0;
let videoQueries = 0;

for (const source of sources) {
  if (!source.youtube_url) continue;
  try {
    const resolved = await resolveChannel(source);
    if (!resolved?.uploadsPlaylistId) throw new Error('uploads playlist not found');
    sourceChanged ||= resolved.changed;

    const playlist = await api('playlistItems', {
      part: 'contentDetails',
      playlistId: resolved.uploadsPlaylistId,
      maxResults: 25
    });
    playlistQueries += 1;
    const ids = (playlist.items || [])
      .map((item) => item.contentDetails?.videoId)
      .filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id));
    for (const id of ids) sourceByVideoId.set(id, source);
  } catch (error) {
    failedSources.add(source.id);
    console.error(`[${source.id}] discovery failed; preserving previous records: ${error.message}`);
  }
}

// Keep tracking already-known live/upcoming IDs even if a busy channel pushes the
// scheduled video outside the most recent uploads window.
for (const record of previousStreams) {
  if (record.origin !== 'youtube_api') continue;
  if (typeof record.youtube_video_id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(record.youtube_video_id)) continue;
  const source = sourceBySourceId.get(record.source_id);
  if (!source || failedSources.has(source.id)) continue;
  sourceByVideoId.set(record.youtube_video_id, source);
}

const allIds = [...sourceByVideoId.keys()];
for (const batch of chunks(allIds, 50)) {
  try {
    const details = await api('videos', {
      part: 'snippet,liveStreamingDetails,status',
      id: batch.join(',')
    });
    videoQueries += 1;
    for (const video of details.items || []) {
      const source = sourceByVideoId.get(video.id);
      const status = liveState(video);
      if (source && status) fresh.push(toRecord(source, video, status));
    }
  } catch (error) {
    for (const id of batch) {
      const source = sourceByVideoId.get(id);
      if (source) failedSources.add(source.id);
    }
    console.error(`[videos] detail refresh failed; preserving affected sources: ${error.message}`);
  }
}

const freshIds = new Set(fresh.map((record) => record.id));
const preserved = previousStreams.filter((record) => {
  if (freshIds.has(record.id)) return false;
  if (record.origin !== 'youtube_api') return true;
  return failedSources.has(record.source_id);
});

const merged = [...preserved, ...fresh]
  .filter((record, index, array) => array.findIndex((other) => other.id === record.id) === index)
  .sort((a, b) => {
    const rank = { live: 0, upcoming: 1 };
    const ra = rank[a.status] ?? 9;
    const rb = rank[b.status] ?? 9;
    if (ra !== rb) return ra - rb;
    return String(a.scheduled_start || a.actual_start || a.title).localeCompare(String(b.scheduled_start || b.actual_start || b.title));
  });

if (sourceChanged) await fs.writeFile(sourcesPath, `${JSON.stringify(sources, null, 2)}\n`);
await fs.writeFile(streamsPath, `${JSON.stringify(merged, null, 2)}\n`);

if (playlistQueries > 0) {
  acquisition.youtube = {
    ...(acquisition.youtube || {}),
    configured: true,
    mode: 'youtube_data_api_v3',
    strategy: 'uploads_playlist_recent_video_poll',
    search_list_used: false,
    poll_cadence_minutes: 30,
    recent_videos_per_source: 25
  };
  delete acquisition.youtube.live_cadence_hours;
  delete acquisition.youtube.upcoming_cadence_hours;
  await fs.writeFile(acquisitionPath, `${JSON.stringify(acquisition, null, 2)}\n`);
}

console.log(`YouTube refresh complete: ${playlistQueries} playlist queries, ${videoQueries} batched video queries, ${fresh.length} active records, ${failedSources.size} preserved sources.`);
