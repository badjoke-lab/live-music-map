import fs from 'node:fs/promises';

const API_KEY = process.env.YOUTUBE_API_KEY?.trim();
const batchArg = process.argv[2];
if (!API_KEY) throw new Error('YOUTUBE_API_KEY is required for source onboarding');
if (!batchArg) throw new Error('Usage: node scripts/apply-source-batch.mjs <batch.json>');

const sourcesUrl = new URL('../data/sources.json', import.meta.url);
const streamsUrl = new URL('../data/streams.json', import.meta.url);
const batchUrl = new URL(`../${batchArg.replace(/^\.\//, '')}`, import.meta.url);

const sources = JSON.parse(await fs.readFile(sourcesUrl, 'utf8'));
const streams = JSON.parse(await fs.readFile(streamsUrl, 'utf8'));
const batch = JSON.parse(await fs.readFile(batchUrl, 'utf8'));
if (!Array.isArray(sources) || !Array.isArray(streams) || !Array.isArray(batch)) {
  throw new Error('Source, stream, and batch files must contain arrays');
}

async function api(path, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries({ ...params, key: API_KEY })) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `${response.status} ${response.statusText}`);
  return body;
}

function youtubeRef(urlString) {
  const url = new URL(urlString);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'channel' && parts[1]) return { kind: 'channel', value: parts[1] };
  if (parts[0]?.startsWith('@')) return { kind: 'handle', value: parts[0].slice(1) };
  if (parts[0] === 'user' && parts[1]) return { kind: 'username', value: parts[1] };
  if (parts[0]) return { kind: 'username', value: parts[0] };
  return null;
}

async function resolveChannelId(source) {
  if (typeof source.youtube_channel_id === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(source.youtube_channel_id)) {
    return source.youtube_channel_id;
  }
  const ref = youtubeRef(source.youtube_url);
  if (!ref) throw new Error(`[${source.id}] cannot parse YouTube URL`);
  if (ref.kind === 'channel') return ref.value;
  const params = { part: 'id', maxResults: 1 };
  if (ref.kind === 'handle') params.forHandle = ref.value;
  else params.forUsername = ref.value;
  const result = await api('channels', params);
  const id = result.items?.[0]?.id;
  if (!id) throw new Error(`[${source.id}] YouTube channel could not be resolved`);
  return id;
}

function thumbnail(snippet) {
  const t = snippet?.thumbnails || {};
  return t.maxres?.url || t.standard?.url || t.high?.url || t.medium?.url || t.default?.url || null;
}

const existingIds = new Set(sources.map((source) => source.id));
const existingChannels = new Set(sources.map((source) => source.youtube_channel_id).filter(Boolean));
const added = [];

for (const candidate of batch) {
  if (!candidate?.id) throw new Error('Batch source is missing id');
  if (existingIds.has(candidate.id)) continue;
  const source = structuredClone(candidate);
  source.youtube_channel_id = await resolveChannelId(source);
  source.youtube_uploads_playlist_id = `UU${source.youtube_channel_id.slice(2)}`;
  if (existingChannels.has(source.youtube_channel_id)) {
    throw new Error(`[${source.id}] duplicate YouTube channel ${source.youtube_channel_id}`);
  }
  existingIds.add(source.id);
  existingChannels.add(source.youtube_channel_id);
  sources.push(source);
  added.push(source);
}

const liveCandidates = new Map();
let searchQueries = 0;
let searchFailures = 0;
for (const source of added) {
  try {
    const result = await api('search', {
      part: 'id',
      channelId: source.youtube_channel_id,
      eventType: 'live',
      type: 'video',
      maxResults: 10
    });
    searchQueries += 1;
    for (const item of result.items || []) {
      const videoId = item.id?.videoId;
      if (typeof videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        liveCandidates.set(videoId, source);
      }
    }
  } catch (error) {
    searchFailures += 1;
    console.error(`[${source.id}] onboarding live search failed: ${error.message}`);
  }
}

const seeded = [];
const ids = [...liveCandidates.keys()];
for (let offset = 0; offset < ids.length; offset += 50) {
  const batchIds = ids.slice(offset, offset + 50);
  const details = await api('videos', {
    part: 'snippet,liveStreamingDetails,status',
    id: batchIds.join(',')
  });
  for (const video of details.items || []) {
    const source = liveCandidates.get(video.id);
    if (!source) continue;
    const live = video.liveStreamingDetails || {};
    if (video.snippet?.liveBroadcastContent !== 'live' || live.actualEndTime) continue;
    if (source.music_live_policy?.mode !== 'music_only') continue;
    seeded.push({
      id: `youtube:${video.id}`,
      origin: 'youtube_api',
      discovery: 'youtube_search_onboarding_seed',
      query_event_type: 'live',
      source_id: source.id,
      youtube_video_id: video.id,
      youtube_url: `https://www.youtube.com/watch?v=${video.id}`,
      title: video.snippet?.title || '(untitled)',
      status: 'live',
      published_at: video.snippet?.publishedAt || null,
      scheduled_start: live.scheduledStartTime || null,
      actual_start: live.actualStartTime || null,
      actual_end: null,
      concurrent_viewers: live.concurrentViewers ? Number(live.concurrentViewers) : null,
      thumbnail: thumbnail(video.snippet),
      embed_allowed: video.status?.embeddable ?? null,
      youtube_category_id: video.snippet?.categoryId || null,
      classifier_version: 1,
      music_live_status: 'verified',
      content_type: source.formats?.length === 1 ? source.formats[0] : 'music_live_unspecified',
      music_live_decision: 'verified_music_only_source',
      music_live_evidence: [{ type: 'source_policy', value: 'music_only' }],
      music_live_requires_schedule_match: false,
      genres: [],
      genre_status: 'unknown',
      performers: [],
      venue: null,
      location: null,
      location_rule: 'unknown_until_verified'
    });
  }
}

const seededIds = new Set(seeded.map((record) => record.id));
const mergedStreams = [...streams.filter((record) => !seededIds.has(record.id)), ...seeded];
await fs.writeFile(sourcesUrl, `${JSON.stringify(sources, null, 2)}\n`);
await fs.writeFile(streamsUrl, `${JSON.stringify(mergedStreams, null, 2)}\n`);
console.log(`Source batch applied: ${added.length} added, ${sources.length} total. Onboarding live search: ${searchQueries} calls, ${searchFailures} failures, ${seeded.length} current live records seeded.`);
