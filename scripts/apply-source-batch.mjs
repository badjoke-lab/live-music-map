import fs from 'node:fs/promises';

const API_KEY = process.env.YOUTUBE_API_KEY?.trim();
const args = process.argv.slice(2);
const PREFLIGHT = args.includes('--preflight');
const batchArg = args.find((arg) => !arg.startsWith('--'));
if (!API_KEY) throw new Error('YOUTUBE_API_KEY is required for source onboarding');
if (!batchArg) throw new Error('Usage: node scripts/apply-source-batch.mjs <batch.json> [--preflight]');

const sourcesUrl = new URL('../data/sources.json', import.meta.url);
const streamsUrl = new URL('../data/streams.json', import.meta.url);
const batchUrl = new URL(`../${batchArg.replace(/^\.\//, '')}`, import.meta.url);
const sources = JSON.parse(await fs.readFile(sourcesUrl, 'utf8'));
const streams = JSON.parse(await fs.readFile(streamsUrl, 'utf8'));
const batch = JSON.parse(await fs.readFile(batchUrl, 'utf8'));
if (!Array.isArray(sources) || !Array.isArray(streams) || !Array.isArray(batch)) throw new Error('Source, stream, and batch files must contain arrays');

async function api(path, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries({ ...params, key: API_KEY })) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
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
  if (parts[0]) return { kind: 'custom', value: parts[0] };
  return null;
}

function normalizedChannelName(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

async function resolveChannel(source) {
  if (typeof source.youtube_channel_id === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(source.youtube_channel_id)) {
    return { id: source.youtube_channel_id, canonicalizeUrl: false };
  }

  const ref = youtubeRef(source.youtube_url);
  if (!ref) throw new Error(`[${source.id}] cannot parse YouTube URL`);
  if (ref.kind === 'channel') return { id: ref.value, canonicalizeUrl: false };

  const lookups = ref.kind === 'handle'
    ? [{ forHandle: ref.value }]
    : ref.kind === 'username'
      ? [{ forUsername: ref.value }]
      : [{ forUsername: ref.value }, { forHandle: ref.value }];

  for (const lookup of lookups) {
    const result = await api('channels', { part: 'id', maxResults: 1, ...lookup });
    const id = result.items?.[0]?.id;
    if (id) return { id, canonicalizeUrl: false };
  }

  const targetName = normalizedChannelName(source.name);
  const search = await api('search', { part: 'snippet', type: 'channel', q: source.name, maxResults: 5 });
  const exactMatches = (search.items || []).filter((item) => {
    const id = item.id?.channelId;
    const title = normalizedChannelName(item.snippet?.title);
    return typeof id === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(id) && title === targetName;
  });
  if (exactMatches.length === 1) return { id: exactMatches[0].id.channelId, canonicalizeUrl: true };
  if (exactMatches.length > 1) throw new Error(`[${source.id}] multiple exact-name YouTube channels found; pin youtube_channel_id explicitly`);
  throw new Error(`[${source.id}] YouTube channel could not be resolved`);
}

async function findLiveProof(channelId) {
  for (const eventType of ['live', 'upcoming', 'completed']) {
    const result = await api('search', { part: 'id', channelId, eventType, type: 'video', maxResults: 1 });
    const videoId = result.items?.[0]?.id?.videoId;
    if (typeof videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(videoId)) return { eventType, videoId };
  }
  return null;
}

async function preflightBatch({ skipExistingIds = false } = {}) {
  const existingIds = new Set(sources.map((source) => source.id));
  const existingNames = new Map(sources.map((source) => [normalizedChannelName(source.name), source.id]));
  const existingChannels = new Map(sources.map((source) => [source.youtube_channel_id, source.id]).filter(([channelId]) => channelId));
  const batchIds = new Set();
  const batchChannels = new Map();
  const errors = [];
  const resolvedRows = [];

  for (const candidate of batch) {
    if (!candidate?.id) {
      errors.push('Batch source is missing id');
      continue;
    }
    if (existingIds.has(candidate.id)) {
      if (skipExistingIds) {
        console.log(`Preflight ${candidate.id}: already canonical, skipped.`);
        continue;
      }
      errors.push(`[${candidate.id}] duplicate source id already in canonical`);
      continue;
    }
    if (batchIds.has(candidate.id)) {
      errors.push(`[${candidate.id}] duplicate source id inside batch`);
      continue;
    }
    batchIds.add(candidate.id);

    const normalizedName = normalizedChannelName(candidate.name);
    if (existingNames.has(normalizedName)) errors.push(`[${candidate.id}] duplicate source name already used by ${existingNames.get(normalizedName)}`);

    try {
      const resolved = await resolveChannel(candidate);
      const existingSource = existingChannels.get(resolved.id);
      if (existingSource) errors.push(`[${candidate.id}] duplicate YouTube channel ${resolved.id}; already used by ${existingSource}`);
      if (batchChannels.has(resolved.id)) errors.push(`[${candidate.id}] duplicate YouTube channel ${resolved.id} inside batch; already used by ${batchChannels.get(resolved.id)}`);
      batchChannels.set(resolved.id, candidate.id);

      const liveProof = await findLiveProof(resolved.id);
      if (!liveProof) errors.push(`[${candidate.id}] no YouTube live/upcoming/completed broadcast proof found on resolved channel ${resolved.id}`);
      resolvedRows.push({ id: candidate.id, channelId: resolved.id, liveProof });
    } catch (error) {
      errors.push(error.message);
    }
  }

  for (const row of resolvedRows) {
    console.log(`Preflight ${row.id}: channel=${row.channelId}, liveProof=${row.liveProof ? `${row.liveProof.eventType}:${row.liveProof.videoId}` : 'none'}`);
  }
  if (errors.length) {
    console.error(`Source batch preflight failed with ${errors.length} error(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`Source batch preflight OK: ${resolvedRows.length} pending candidates, ${batchChannels.size} unique YouTube channels, no canonical duplicates, live-broadcast proof present for every pending candidate.`);
}

if (PREFLIGHT) {
  await preflightBatch();
  process.exit(0);
}

await preflightBatch({ skipExistingIds: true });

function thumbnail(snippet) {
  const t = snippet?.thumbnails || {};
  return t.maxres?.url || t.standard?.url || t.high?.url || t.medium?.url || t.default?.url || null;
}

const existingIds = new Set(sources.map((source) => source.id));
const existingChannels = new Set(sources.map((source) => source.youtube_channel_id).filter(Boolean));
const added = [];
const skippedDuplicateChannels = [];
for (const candidate of batch) {
  if (!candidate?.id) throw new Error('Batch source is missing id');
  if (existingIds.has(candidate.id)) continue;
  const source = structuredClone(candidate);
  const resolved = await resolveChannel(source);
  source.youtube_channel_id = resolved.id;
  source.youtube_uploads_playlist_id = `UU${source.youtube_channel_id.slice(2)}`;
  if (resolved.canonicalizeUrl) {
    const canonicalUrl = `https://www.youtube.com/channel/${source.youtube_channel_id}`;
    source.youtube_url = canonicalUrl;
    for (const item of source.evidence || []) {
      if (item?.kind === 'official_youtube_channel') item.url = canonicalUrl;
    }
  }
  if (existingChannels.has(source.youtube_channel_id)) {
    skippedDuplicateChannels.push(`${source.id}:${source.youtube_channel_id}`);
    continue;
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
    const result = await api('search', { part: 'id', channelId: source.youtube_channel_id, eventType: 'live', type: 'video', maxResults: 10 });
    searchQueries += 1;
    for (const item of result.items || []) {
      const videoId = item.id?.videoId;
      if (typeof videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(videoId)) liveCandidates.set(videoId, source);
    }
  } catch (error) {
    searchFailures += 1;
    console.error(`[${source.id}] onboarding live search failed: ${error.message}`);
  }
}

const seeded = [];
const ids = [...liveCandidates.keys()];
for (let offset = 0; offset < ids.length; offset += 50) {
  const details = await api('videos', { part: 'snippet,liveStreamingDetails,status', id: ids.slice(offset, offset + 50).join(',') });
  for (const video of details.items || []) {
    const source = liveCandidates.get(video.id);
    if (!source) continue;
    const live = video.liveStreamingDetails || {};
    if (video.snippet?.liveBroadcastContent !== 'live' || live.actualEndTime) continue;
    if (source.music_live_policy?.mode !== 'music_only') continue;
    seeded.push({ id: `youtube:${video.id}`, origin: 'youtube_api', discovery: 'youtube_search_onboarding_seed', query_event_type: 'live', source_id: source.id, youtube_video_id: video.id, youtube_url: `https://www.youtube.com/watch?v=${video.id}`, title: video.snippet?.title || '(untitled)', status: 'live', published_at: video.snippet?.publishedAt || null, scheduled_start: live.scheduledStartTime || null, actual_start: live.actualStartTime || null, actual_end: null, concurrent_viewers: live.concurrentViewers ? Number(live.concurrentViewers) : null, thumbnail: thumbnail(video.snippet), embed_allowed: video.status?.embeddable ?? null, youtube_category_id: video.snippet?.categoryId || null, classifier_version: 1, music_live_status: 'verified', content_type: source.formats?.length === 1 ? source.formats[0] : 'music_live_unspecified', music_live_decision: 'verified_music_only_source', music_live_evidence: [{ type: 'source_policy', value: 'music_only' }], music_live_requires_schedule_match: false, genres: [], genre_status: 'unknown', performers: [], venue: null, location: null, location_rule: 'unknown_until_verified' });
  }
}

const seededIds = new Set(seeded.map((record) => record.id));
const mergedStreams = [...streams.filter((record) => !seededIds.has(record.id)), ...seeded];
await fs.writeFile(sourcesUrl, `${JSON.stringify(sources, null, 2)}\n`);
await fs.writeFile(streamsUrl, `${JSON.stringify(mergedStreams, null, 2)}\n`);
console.log(`Source batch applied: ${added.length} added, ${sources.length} total. Duplicate channels skipped: ${skippedDuplicateChannels.length}${skippedDuplicateChannels.length ? ` (${skippedDuplicateChannels.join(', ')})` : ''}. Onboarding live search: ${searchQueries} calls, ${searchFailures} failures, ${seeded.length} current live records seeded.`);
