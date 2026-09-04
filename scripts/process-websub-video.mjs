import fs from 'node:fs/promises';

const API_KEY = process.env.YOUTUBE_API_KEY?.trim();
const VIDEO_ID = process.env.YOUTUBE_WEBSUB_VIDEO_ID?.trim();
const CHANNEL_ID = process.env.YOUTUBE_WEBSUB_CHANNEL_ID?.trim();
const MUSIC_CLASSIFIER_VERSION = 1;

if (!API_KEY) throw new Error('YOUTUBE_API_KEY is required');
if (!/^[A-Za-z0-9_-]{11}$/.test(VIDEO_ID || '')) throw new Error('YOUTUBE_WEBSUB_VIDEO_ID must be an 11-character video id');
if (!/^UC[A-Za-z0-9_-]{22}$/.test(CHANNEL_ID || '')) throw new Error('YOUTUBE_WEBSUB_CHANNEL_ID must be a canonical channel id');

const sourcesPath = new URL('../data/sources.json', import.meta.url);
const streamsPath = new URL('../data/streams.json', import.meta.url);
const sources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
const streams = JSON.parse(await fs.readFile(streamsPath, 'utf8'));
const source = sources.find((candidate) => candidate.youtube_channel_id === CHANNEL_ID && candidate.acquisition?.enabled !== false);
if (!source) throw new Error(`WebSub channel is not an enabled registered Source: ${CHANNEL_ID}`);

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

function contentTypeFromPattern(pattern) {
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

function verified(pattern, decision) {
  return {
    music_live_status: 'verified',
    content_type: contentTypeFromPattern(pattern),
    music_live_decision: decision,
    music_live_evidence: [{ type: 'youtube_metadata_pattern', value: pattern }],
    music_live_requires_schedule_match: false
  };
}

function rejected(pattern, decision) {
  return {
    music_live_status: 'rejected',
    content_type: nonMusicType(pattern),
    music_live_decision: decision,
    music_live_evidence: [{ type: 'youtube_metadata_pattern', value: pattern }],
    music_live_requires_schedule_match: false
  };
}

function classify(video) {
  const policy = source.music_live_policy || { mode: 'mixed' };
  const title = normalizeText(video.snippet?.title || '');
  const fullText = normalizeText(`${video.snippet?.title || ''}\n${video.snippet?.description || ''}`);
  const denyPatterns = [...(Array.isArray(policy.deny_title_patterns) ? policy.deny_title_patterns : []), ...GLOBAL_DENY_PATTERNS];
  const sourceAllow = Array.isArray(policy.allow_title_patterns) ? policy.allow_title_patterns : [];

  const titleDeny = denyPatterns.find((pattern) => matchesPattern(title, pattern));
  if (titleDeny) return rejected(titleDeny, 'title_deny_pattern');

  const sourceTitleAllow = sourceAllow.find((pattern) => matchesPattern(title, pattern));
  if (sourceTitleAllow) return verified(sourceTitleAllow, 'source_title_allow_pattern');
  const globalTitleAllow = GLOBAL_ALLOW_PATTERNS.find(([pattern]) => matchesPattern(title, pattern));
  if (globalTitleAllow) return verified(globalTitleAllow[0], 'global_title_allow_pattern');

  const fullDeny = denyPatterns.find((pattern) => matchesPattern(fullText, pattern));
  if (fullDeny) return rejected(fullDeny, 'metadata_deny_pattern');

  const sourceAllowMatch = sourceAllow.find((pattern) => matchesPattern(fullText, pattern));
  if (sourceAllowMatch) return verified(sourceAllowMatch, 'source_allow_pattern');
  const globalAllow = GLOBAL_ALLOW_PATTERNS.find(([pattern]) => matchesPattern(fullText, pattern));
  if (globalAllow) return verified(globalAllow[0], 'global_allow_pattern');

  if (policy.mode === 'music_only') {
    return {
      music_live_status: 'verified',
      content_type: source.formats?.length === 1 ? source.formats[0] : 'music_live_unspecified',
      music_live_decision: 'verified_music_only_source',
      music_live_evidence: [{ type: 'source_policy', value: 'music_only' }],
      music_live_requires_schedule_match: false
    };
  }

  const evidence = [];
  if (String(video.snippet?.categoryId || '') === '10') evidence.push({ type: 'youtube_category', value: 'Music' });
  return {
    music_live_status: 'unknown',
    content_type: 'unknown',
    music_live_decision: 'ambiguous_mixed_source',
    music_live_evidence: evidence,
    music_live_requires_schedule_match: policy.require_schedule_match_when_ambiguous === true
  };
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

const details = await api('videos', {
  part: 'snippet,liveStreamingDetails,status',
  id: VIDEO_ID
});
const video = details.items?.[0] || null;
if (video && video.snippet?.channelId !== CHANNEL_ID) throw new Error(`Video channel mismatch: expected ${CHANNEL_ID}, got ${video.snippet?.channelId || 'unknown'}`);

const recordId = `youtube:${VIDEO_ID}`;
const withoutTarget = streams.filter((record) => record.id !== recordId);
let nextStreams = withoutTarget;
let result = 'ignored_non_live';

if (video) {
  const status = liveState(video);
  if (status) {
    const live = video.liveStreamingDetails || {};
    const classification = classify(video);
    const record = {
      id: recordId,
      origin: 'youtube_api',
      discovery: 'youtube_websub',
      query_event_type: status,
      source_id: source.id,
      youtube_video_id: VIDEO_ID,
      youtube_url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
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
      ...classification,
      genres: [],
      genre_status: 'unknown',
      performers: [],
      venue: null,
      location: null,
      location_rule: 'unknown_until_verified'
    };
    nextStreams = [...withoutTarget, record];
    result = `${status}:${classification.music_live_status}`;
  }
} else {
  result = 'video_not_found';
}

nextStreams.sort((a, b) => {
  const rank = { live: 0, upcoming: 1 };
  const ra = rank[a.status] ?? 9;
  const rb = rank[b.status] ?? 9;
  if (ra !== rb) return ra - rb;
  return String(a.scheduled_start || a.actual_start || a.title).localeCompare(String(b.scheduled_start || b.actual_start || b.title));
});

await fs.writeFile(streamsPath, `${JSON.stringify(nextStreams, null, 2)}\n`);
console.log(`WebSub video processed: source=${source.id}, channel=${CHANNEL_ID}, video=${VIDEO_ID}, videos.list=1, result=${result}.`);
