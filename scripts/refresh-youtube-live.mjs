import fs from 'node:fs/promises';

const API_KEY = process.env.YOUTUBE_API_KEY?.trim();
const EVENT_TYPES = (process.env.YOUTUBE_EVENT_TYPES || 'live')
  .split(',')
  .map((v) => v.trim())
  .filter((v) => ['live', 'upcoming'].includes(v));

if (!API_KEY) {
  console.log('YOUTUBE_API_KEY is not configured; leaving data unchanged.');
  process.exit(0);
}
if (!EVENT_TYPES.length) throw new Error('No valid YOUTUBE_EVENT_TYPES supplied.');

const sourcesPath = new URL('../data/sources.json', import.meta.url);
const streamsPath = new URL('../data/streams.json', import.meta.url);
const acquisitionPath = new URL('../data/acquisition.json', import.meta.url);

const sources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
const previousStreams = JSON.parse(await fs.readFile(streamsPath, 'utf8'));
let acquisition = {};
try { acquisition = JSON.parse(await fs.readFile(acquisitionPath, 'utf8')); } catch {}

async function api(path, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries({...params, key: API_KEY})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {headers: {'accept': 'application/json'}});
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
  if (parts[0] === 'channel' && parts[1]) return {kind: 'channel', value: parts[1]};
  if (parts[0]?.startsWith('@')) return {kind: 'handle', value: parts[0].slice(1)};
  if (parts[0]) return {kind: 'username', value: parts[0]};
  return null;
}

async function resolveChannelId(source) {
  if (source.youtube_channel_id) return source.youtube_channel_id;
  if (!source.youtube_url) return null;
  const ref = parseYoutubeRef(source.youtube_url);
  if (!ref) return null;
  if (ref.kind === 'channel') return ref.value;
  const params = {part: 'id', maxResults: 1};
  if (ref.kind === 'handle') params.forHandle = ref.value;
  if (ref.kind === 'username') params.forUsername = ref.value;
  const result = await api('channels', params);
  return result.items?.[0]?.id || null;
}

function thumbnail(snippet) {
  const t = snippet?.thumbnails || {};
  return t.maxres?.url || t.standard?.url || t.high?.url || t.medium?.url || t.default?.url || null;
}

function toRecord(source, queryEventType, video) {
  const live = video.liveStreamingDetails || {};
  return {
    id: `youtube:${video.id}`,
    origin: 'youtube_api',
    query_event_type: queryEventType,
    source_id: source.id,
    youtube_video_id: video.id,
    youtube_url: `https://www.youtube.com/watch?v=${video.id}`,
    title: video.snippet?.title || '(untitled)',
    status: queryEventType,
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

const fresh = [];
const preserveKeys = new Set();
let sourceChanged = false;
let successfulQueries = 0;

for (const source of sources) {
  if (!source.youtube_url) continue;
  let channelId;
  try {
    channelId = await resolveChannelId(source);
    if (!channelId) throw new Error('channel ID not found');
    if (!source.youtube_channel_id) {
      source.youtube_channel_id = channelId;
      sourceChanged = true;
    }
  } catch (error) {
    console.error(`[${source.id}] channel resolution failed: ${error.message}`);
    for (const eventType of EVENT_TYPES) preserveKeys.add(`${source.id}:${eventType}`);
    continue;
  }

  for (const eventType of EVENT_TYPES) {
    const key = `${source.id}:${eventType}`;
    try {
      const search = await api('search', {
        part: 'snippet',
        channelId,
        eventType,
        type: 'video',
        order: 'date',
        maxResults: 10
      });
      const ids = (search.items || []).map((item) => item.id?.videoId).filter(Boolean);
      if (!ids.length) {
        successfulQueries += 1;
        continue;
      }
      const details = await api('videos', {
        part: 'snippet,liveStreamingDetails,status',
        id: ids.join(',')
      });
      for (const video of details.items || []) fresh.push(toRecord(source, eventType, video));
      successfulQueries += 1;
    } catch (error) {
      preserveKeys.add(key);
      console.error(`[${key}] refresh failed; preserving previous records: ${error.message}`);
    }
  }
}

const preserved = previousStreams.filter((record) => {
  if (record.origin !== 'youtube_api') return true;
  return preserveKeys.has(`${record.source_id}:${record.query_event_type}`);
});

const merged = [...preserved, ...fresh]
  .filter((record, index, array) => array.findIndex((other) => other.id === record.id) === index)
  .sort((a, b) => {
    const rank = {live: 0, upcoming: 1};
    const ra = rank[a.status] ?? 9;
    const rb = rank[b.status] ?? 9;
    if (ra !== rb) return ra - rb;
    return String(a.scheduled_start || a.actual_start || a.title).localeCompare(String(b.scheduled_start || b.actual_start || b.title));
  });

if (sourceChanged) await fs.writeFile(sourcesPath, `${JSON.stringify(sources, null, 2)}\n`);
await fs.writeFile(streamsPath, `${JSON.stringify(merged, null, 2)}\n`);

if (successfulQueries > 0 && acquisition?.youtube?.configured !== true) {
  acquisition.youtube = {
    ...(acquisition.youtube || {}),
    configured: true,
    mode: 'youtube_data_api_v3',
    live_cadence_hours: 3,
    upcoming_cadence_hours: 12
  };
  await fs.writeFile(acquisitionPath, `${JSON.stringify(acquisition, null, 2)}\n`);
}

console.log(`YouTube refresh complete: ${successfulQueries} successful queries, ${fresh.length} current records, ${preserveKeys.size} preserved query groups.`);
