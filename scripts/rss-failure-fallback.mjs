import fs from 'node:fs/promises';

const API_KEY = process.env.YOUTUBE_API_KEY?.trim();
const FALLBACK_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const FAILED_ATTEMPT_COOLDOWN_MS = 60 * 60 * 1000;
const WIDESPREAD_THRESHOLD = 0.5;
const WIDESPREAD_COHORTS = 24;
const PROBE_CONCURRENCY = 25;
const MUSIC_CLASSIFIER_VERSION = 2;

if (!API_KEY) {
  console.log('RSS failure fallback skipped: YOUTUBE_API_KEY is not configured.');
  process.exit(0);
}

const sourcesPath = new URL('../data/sources.json', import.meta.url);
const streamsPath = new URL('../data/streams.json', import.meta.url);
const statePath = new URL('../data/youtube-state.json', import.meta.url);
const acquisitionPath = new URL('../data/acquisition.json', import.meta.url);

const sources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
const streams = JSON.parse(await fs.readFile(streamsPath, 'utf8'));
let state = { version: 1, feeds: {} };
let acquisition = {};
try { state = JSON.parse(await fs.readFile(statePath, 'utf8')); } catch {}
try { acquisition = JSON.parse(await fs.readFile(acquisitionPath, 'utf8')); } catch {}
if (!state || typeof state !== 'object') state = { version: 1, feeds: {} };
if (!state.feeds || typeof state.feeds !== 'object') state.feeds = {};

const GLOBAL_DENY_PATTERNS = ['interview', 'podcast', 'news', 'discussion', 'press conference', 'panel discussion', 'q&a'];
const GLOBAL_ALLOW_PATTERNS = [
  ['live session', 'studio_session'],
  ['live performance', 'live_performance'],
  ['dj set', 'dj_set'],
  ['live set', 'dj_set'],
  ['concert', 'concert'],
  ['festival', 'festival_stream'],
  ['orchestra', 'concert'],
  ['symphony', 'concert'],
  ['opera', 'opera'],
  ['recital', 'concert']
];

function chunks(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function api(path, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries({ ...params, key: API_KEY })) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${body?.error?.message || `${response.status} ${response.statusText}`}`);
  return body;
}

async function rssHealthy(channelId) {
  try {
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, {
      headers: { accept: 'application/atom+xml,application/xml,text/xml' }
    });
    return response.ok;
  } catch {
    return false;
  }
}

function feedState(sourceId) {
  if (!state.feeds[sourceId] || typeof state.feeds[sourceId] !== 'object') state.feeds[sourceId] = { entries: {} };
  if (!state.feeds[sourceId].entries || typeof state.feeds[sourceId].entries !== 'object') state.feeds[sourceId].entries = {};
  if (!state.feeds[sourceId].rss_failure_fallback || typeof state.feeds[sourceId].rss_failure_fallback !== 'object') {
    state.feeds[sourceId].rss_failure_fallback = {};
  }
  return state.feeds[sourceId];
}

function timestampMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function hashSourceId(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function matchesPattern(text, rawPattern) {
  const pattern = normalizeText(rawPattern);
  if (!pattern) return false;
  if (/^[\p{L}\p{N}_-]+$/u.test(pattern)) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}([^\\p{L}\\p{N}_-]|$)`, 'u').test(text);
  }
  return text.includes(pattern);
}

function nonMusicType(pattern) {
  const p = normalizeText(pattern);
  if (p.includes('interview')) return 'interview';
  if (p.includes('podcast')) return 'podcast';
  if (p.includes('news')) return 'news';
  return 'talk';
}

function contentTypeFromPattern(pattern, source) {
  const p = normalizeText(pattern);
  const mapped = GLOBAL_ALLOW_PATTERNS.find(([candidate]) => candidate === p)?.[1];
  if (mapped) return mapped;
  if (p.includes('dj')) return 'dj_set';
  if (p.includes('festival')) return 'festival_stream';
  if (p.includes('session')) return 'studio_session';
  if (p.includes('opera')) return 'opera';
  if (p.includes('concert') || p.includes('orchestra') || p.includes('symphony') || p.includes('recital')) return 'concert';
  if (source.formats?.length === 1) return source.formats[0];
  return 'music_live_unspecified';
}

function classify(source, video) {
  const policy = source.music_live_policy || { mode: 'mixed' };
  const title = normalizeText(video.snippet?.title || '');
  const full = normalizeText(`${video.snippet?.title || ''}\n${video.snippet?.description || ''}`);
  const sourceDeny = Array.isArray(policy.deny_title_patterns) ? policy.deny_title_patterns : [];
  const denyPatterns = [...sourceDeny, ...GLOBAL_DENY_PATTERNS];
  const sourceAllow = Array.isArray(policy.allow_title_patterns) ? policy.allow_title_patterns : [];

  const titleDeny = denyPatterns.find((pattern) => matchesPattern(title, pattern));
  if (titleDeny) return {
    music_live_status: 'rejected', content_type: nonMusicType(titleDeny), music_live_decision: 'deny_title_pattern',
    music_live_evidence: [{ type: 'youtube_title_pattern', value: titleDeny }], music_live_requires_schedule_match: false
  };

  const sourceTitleAllow = sourceAllow.find((pattern) => matchesPattern(title, pattern));
  if (sourceTitleAllow) return {
    music_live_status: 'verified', content_type: contentTypeFromPattern(sourceTitleAllow, source), music_live_decision: 'source_allow_title_precedence',
    music_live_evidence: [{ type: 'youtube_title_pattern', value: sourceTitleAllow }], music_live_requires_schedule_match: false
  };

  const globalTitleAllow = GLOBAL_ALLOW_PATTERNS.find(([pattern]) => matchesPattern(title, pattern));
  if (globalTitleAllow) return {
    music_live_status: 'verified', content_type: globalTitleAllow[1], music_live_decision: 'global_allow_title_precedence',
    music_live_evidence: [{ type: 'youtube_title_pattern', value: globalTitleAllow[0] }], music_live_requires_schedule_match: false
  };

  const deny = denyPatterns.find((pattern) => matchesPattern(full, pattern));
  if (deny) return {
    music_live_status: 'rejected', content_type: nonMusicType(deny), music_live_decision: 'deny_pattern',
    music_live_evidence: [{ type: 'youtube_metadata_pattern', value: deny }], music_live_requires_schedule_match: false
  };

  const sourceAllowMatch = sourceAllow.find((pattern) => matchesPattern(full, pattern));
  if (sourceAllowMatch) return {
    music_live_status: 'verified', content_type: contentTypeFromPattern(sourceAllowMatch, source), music_live_decision: 'source_allow_pattern',
    music_live_evidence: [{ type: 'youtube_metadata_pattern', value: sourceAllowMatch }], music_live_requires_schedule_match: false
  };

  const globalAllow = GLOBAL_ALLOW_PATTERNS.find(([pattern]) => matchesPattern(full, pattern));
  if (globalAllow) return {
    music_live_status: 'verified', content_type: globalAllow[1], music_live_decision: 'global_allow_pattern',
    music_live_evidence: [{ type: 'youtube_metadata_pattern', value: globalAllow[0] }], music_live_requires_schedule_match: false
  };

  if (policy.mode === 'music_only') return {
    music_live_status: 'verified', content_type: source.formats?.length === 1 ? source.formats[0] : 'music_live_unspecified',
    music_live_decision: 'verified_music_only_source', music_live_evidence: [{ type: 'source_policy', value: 'music_only' }],
    music_live_requires_schedule_match: false
  };

  const evidence = [];
  if (String(video.snippet?.categoryId || '') === '10') evidence.push({ type: 'youtube_category', value: 'Music' });
  return { music_live_status: 'unknown', content_type: 'unknown', music_live_decision: 'ambiguous_mixed_source', music_live_evidence: evidence,
    music_live_requires_schedule_match: policy.require_schedule_match_when_ambiguous === true };
}

function liveState(video) {
  const content = video.snippet?.liveBroadcastContent;
  const live = video.liveStreamingDetails || {};
  if (content === 'live' && !live.actualEndTime) return 'live';
  if (content === 'upcoming' && Number.isFinite(Date.parse(live.scheduledStartTime))) return 'upcoming';
  return null;
}

function thumbnail(snippet) {
  const t = snippet?.thumbnails || {};
  return t.maxres?.url || t.standard?.url || t.high?.url || t.medium?.url || t.default?.url || null;
}

function recordFor(source, video, status) {
  const live = video.liveStreamingDetails || {};
  return {
    id: `youtube:${video.id}`,
    origin: 'youtube_api',
    discovery: 'uploads_playlist_rss_failure_fallback',
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
    youtube_category_id: video.snippet?.categoryId || null,
    classifier_version: MUSIC_CLASSIFIER_VERSION,
    ...classify(source, video),
    genres: [],
    genre_status: 'unknown',
    performers: [],
    venue: null,
    location: null,
    location_rule: 'unknown_until_verified'
  };
}

const enabled = sources.filter((source) => source.acquisition?.enabled !== false && source.youtube_channel_id && source.youtube_uploads_playlist_id);
const probes = [];
for (const batch of chunks(enabled, PROBE_CONCURRENCY)) {
  const results = await Promise.all(batch.map(async (source) => ({ source, healthy: await rssHealthy(source.youtube_channel_id) })));
  probes.push(...results);
}

const failed = probes.filter((item) => !item.healthy).map((item) => item.source);
const widespread = enabled.length > 0 && failed.length / enabled.length >= WIDESPREAD_THRESHOLD;
const now = Date.now();
const nowIso = new Date(now).toISOString();
const currentCohort = Math.floor(now / (15 * 60 * 1000)) % WIDESPREAD_COHORTS;
const eligible = [];

for (const source of failed) {
  const fallback = feedState(source.id).rss_failure_fallback;
  const sinceSuccess = now - timestampMs(fallback.last_success_at);
  const sinceAttempt = now - timestampMs(fallback.last_attempt_at);
  if (sinceSuccess < FALLBACK_COOLDOWN_MS || sinceAttempt < FAILED_ATTEMPT_COOLDOWN_MS) continue;
  if (widespread && hashSourceId(source.id) % WIDESPREAD_COHORTS !== currentCohort) continue;
  eligible.push(source);
}

const existingVideoIds = new Set(streams.map((record) => record.youtube_video_id).filter(Boolean));
const candidates = new Map();
let playlistQueries = 0;
let playlistFailures = 0;

for (const source of eligible) {
  const fsState = feedState(source.id);
  fsState.rss_failure_fallback.last_attempt_at = nowIso;
  try {
    const playlist = await api('playlistItems', { part: 'contentDetails', playlistId: source.youtube_uploads_playlist_id, maxResults: 25 });
    playlistQueries += 1;
    fsState.rss_failure_fallback.last_success_at = nowIso;
    for (const item of playlist.items || []) {
      const videoId = item.contentDetails?.videoId;
      if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue;
      if (videoId in fsState.entries || existingVideoIds.has(videoId)) continue;
      candidates.set(videoId, source);
    }
  } catch (error) {
    playlistFailures += 1;
    console.error(`[${source.id}] RSS failure playlist fallback failed: ${error.message}`);
  }
}

const discovered = [];
let videoQueries = 0;
for (const ids of chunks([...candidates.keys()], 50)) {
  try {
    const details = await api('videos', { part: 'snippet,liveStreamingDetails,status', id: ids.join(',') });
    videoQueries += 1;
    const returned = new Map((details.items || []).map((video) => [video.id, video]));
    for (const id of ids) {
      const source = candidates.get(id);
      if (!source) continue;
      const fsState = feedState(source.id);
      fsState.entries[id] = `rss-fallback:${nowIso}`;
      const keys = Object.keys(fsState.entries);
      if (keys.length > 40) for (const staleId of keys.slice(0, keys.length - 40)) delete fsState.entries[staleId];
      const video = returned.get(id);
      if (!video) continue;
      const status = liveState(video);
      if (status) discovered.push(recordFor(source, video, status));
    }
  } catch (error) {
    console.error(`[videos] RSS failure fallback detail lookup failed: ${error.message}`);
  }
}

if (discovered.length) {
  const byId = new Map(streams.map((record) => [record.id, record]));
  for (const record of discovered) byId.set(record.id, record);
  const merged = [...byId.values()].sort((a, b) => {
    const rank = { live: 0, upcoming: 1 };
    const delta = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    if (delta) return delta;
    return String(a.scheduled_start || a.actual_start || a.title).localeCompare(String(b.scheduled_start || b.actual_start || b.title));
  });
  await fs.writeFile(streamsPath, `${JSON.stringify(merged, null, 2)}\n`);
}

acquisition.youtube = {
  ...(acquisition.youtube || {}),
  rss_failure_fallback: {
    enabled: true,
    success_cooldown_hours: 6,
    failed_attempt_cooldown_hours: 1,
    widespread_failure_threshold: WIDESPREAD_THRESHOLD,
    widespread_cohorts: WIDESPREAD_COHORTS,
    recent_videos: 25
  }
};
await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
await fs.writeFile(acquisitionPath, `${JSON.stringify(acquisition, null, 2)}\n`);

console.log(`RSS fallback: ${enabled.length} sources probed, ${failed.length} failed (${widespread ? 'widespread' : 'isolated'}), cohort ${currentCohort}/${WIDESPREAD_COHORTS}, ${eligible.length} eligible, ${playlistQueries} playlist calls (${playlistFailures} failures), ${videoQueries} video batches, ${discovered.length} active streams discovered.`);
