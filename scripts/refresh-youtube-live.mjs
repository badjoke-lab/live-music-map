import fs from 'node:fs/promises';

const API_KEY = process.env.YOUTUBE_API_KEY?.trim();
const DISCOVERY_MODE = process.env.YOUTUBE_DISCOVERY_MODE === 'rss+playlist' ? 'rss+playlist' : 'rss';
const MUSIC_CLASSIFIER_VERSION = 1;

if (!API_KEY) {
  console.log('YOUTUBE_API_KEY is not configured; leaving data unchanged.');
  process.exit(0);
}

const sourcesPath = new URL('../data/sources.json', import.meta.url);
const streamsPath = new URL('../data/streams.json', import.meta.url);
const acquisitionPath = new URL('../data/acquisition.json', import.meta.url);
const statePath = new URL('../data/youtube-state.json', import.meta.url);

const sources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
const previousStreams = JSON.parse(await fs.readFile(streamsPath, 'utf8'));
const sourceBySourceId = new Map(sources.map((source) => [source.id, source]));
let acquisition = {};
let state = { version: 1, feeds: {} };
try { acquisition = JSON.parse(await fs.readFile(acquisitionPath, 'utf8')); } catch {}
try { state = JSON.parse(await fs.readFile(statePath, 'utf8')); } catch {}
if (!state || typeof state !== 'object') state = { version: 1, feeds: {} };
if (!state.feeds || typeof state.feeds !== 'object') state.feeds = {};

const GLOBAL_DENY_PATTERNS = [
  'interview',
  'podcast',
  'news',
  'discussion',
  'press conference',
  'panel discussion',
  'q&a'
];

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
  if (parts[0] === 'user' && parts[1]) return { kind: 'legacy_username', value: parts[1] };
  if (parts[0]?.startsWith('@')) return { kind: 'handle', value: parts[0].slice(1) };
  if (parts[0]) return { kind: 'username', value: parts[0] };
  return null;
}

async function resolveChannelId(source) {
  if (!source.youtube_url) return source.youtube_channel_id
    ? { channelId: source.youtube_channel_id, changed: false }
    : null;
  const ref = parseYoutubeRef(source.youtube_url);
  if (!ref) return source.youtube_channel_id
    ? { channelId: source.youtube_channel_id, changed: false }
    : null;

  if (ref.kind !== 'legacy_username' && source.youtube_channel_id) {
    return { channelId: source.youtube_channel_id, changed: false };
  }

  if (ref.kind === 'channel') {
    source.youtube_channel_id = ref.value;
    return { channelId: ref.value, changed: true };
  }

  const params = { part: 'id', maxResults: 1 };
  if (ref.kind === 'handle') params.forHandle = ref.value;
  if (ref.kind === 'username' || ref.kind === 'legacy_username') params.forUsername = ref.value;
  const result = await api('channels', params);
  const channelId = result.items?.[0]?.id || null;
  if (!channelId) return null;

  const changed = source.youtube_channel_id !== channelId
    || (ref.kind === 'legacy_username' && source.youtube_url !== `https://www.youtube.com/channel/${channelId}`);
  source.youtube_channel_id = channelId;
  if (ref.kind === 'legacy_username') {
    source.youtube_url = `https://www.youtube.com/channel/${channelId}`;
    delete source.youtube_uploads_playlist_id;
  }
  return { channelId, changed };
}

async function ensureUploadsPlaylist(source, channelId) {
  if (source.youtube_uploads_playlist_id) return { playlistId: source.youtube_uploads_playlist_id, changed: false };
  const result = await api('channels', { part: 'contentDetails', id: channelId, maxResults: 1 });
  const playlistId = result.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || null;
  if (!playlistId) return null;
  source.youtube_uploads_playlist_id = playlistId;
  return { playlistId, changed: true };
}

function parseAtomEntries(xml) {
  const entries = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const block = match[1];
    const videoId = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]?.trim();
    const updated = block.match(/<updated>([^<]+)<\/updated>/)?.[1]?.trim() || null;
    if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) entries.push({ videoId, updated });
  }
  return entries;
}

async function fetchAtomFeed(channelId) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  const response = await fetch(url, { headers: { accept: 'application/atom+xml,application/xml,text/xml' } });
  if (!response.ok) throw new Error(`rss: ${response.status} ${response.statusText}`);
  return parseAtomEntries(await response.text());
}

function thumbnail(snippet) {
  const t = snippet?.thumbnails || {};
  return t.maxres?.url || t.standard?.url || t.high?.url || t.medium?.url || t.default?.url || null;
}

function liveState(video) {
  const content = video.snippet?.liveBroadcastContent;
  const live = video.liveStreamingDetails || {};
  if (content === 'live' && !live.actualEndTime) return 'live';
  if (content === 'upcoming' && Number.isFinite(Date.parse(live.scheduledStartTime))) return 'upcoming';
  return null;
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

function classifyMusicLive(source, video) {
  const policy = source.music_live_policy || { mode: 'mixed' };
  const text = normalizeText(`${video.snippet?.title || ''}\n${video.snippet?.description || ''}`);
  const sourceDeny = Array.isArray(policy.deny_title_patterns) ? policy.deny_title_patterns : [];
  const denyPatterns = [...sourceDeny, ...GLOBAL_DENY_PATTERNS];
  const denyMatch = denyPatterns.find((pattern) => matchesPattern(text, pattern));
  if (denyMatch) {
    return {
      music_live_status: 'rejected',
      content_type: nonMusicType(denyMatch),
      music_live_decision: 'deny_pattern',
      music_live_evidence: [{ type: 'youtube_metadata_pattern', value: denyMatch }],
      music_live_requires_schedule_match: false
    };
  }

  const sourceAllow = Array.isArray(policy.allow_title_patterns) ? policy.allow_title_patterns : [];
  const sourceAllowMatch = sourceAllow.find((pattern) => matchesPattern(text, pattern));
  if (sourceAllowMatch) {
    return {
      music_live_status: 'verified',
      content_type: contentTypeFromPattern(sourceAllowMatch, source),
      music_live_decision: 'source_allow_pattern',
      music_live_evidence: [{ type: 'youtube_metadata_pattern', value: sourceAllowMatch }],
      music_live_requires_schedule_match: false
    };
  }

  const globalAllowMatch = GLOBAL_ALLOW_PATTERNS.find(([pattern]) => matchesPattern(text, pattern));
  if (globalAllowMatch) {
    return {
      music_live_status: 'verified',
      content_type: globalAllowMatch[1],
      music_live_decision: 'global_allow_pattern',
      music_live_evidence: [{ type: 'youtube_metadata_pattern', value: globalAllowMatch[0] }],
      music_live_requires_schedule_match: false
    };
  }

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

function toRecord(source, video, status, discovery) {
  const live = video.liveStreamingDetails || {};
  const classification = classifyMusicLive(source, video);
  return {
    id: `youtube:${video.id}`,
    origin: 'youtube_api',
    discovery,
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
    ...classification,
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

function sourceFeedState(sourceId) {
  const existing = state.feeds[sourceId];
  if (!existing || typeof existing !== 'object') state.feeds[sourceId] = { entries: {} };
  if (!state.feeds[sourceId].entries || typeof state.feeds[sourceId].entries !== 'object') state.feeds[sourceId].entries = {};
  return state.feeds[sourceId];
}

const candidateByVideoId = new Map();
const fresh = [];
const detailFailedSources = new Set();
let sourceChanged = false;
let rssFetches = 0;
let rssFailures = 0;
let playlistQueries = 0;
let videoQueries = 0;
let channelQueriesApprox = 0;

for (const source of sources) {
  if (source.acquisition?.enabled === false || !source.youtube_url) continue;
  let resolved;
  try {
    const beforeChannelId = source.youtube_channel_id || null;
    resolved = await resolveChannelId(source);
    if (!resolved?.channelId) throw new Error('channel ID not found');
    sourceChanged ||= resolved.changed;
    if (!beforeChannelId && resolved.channelId) channelQueriesApprox += 1;
  } catch (error) {
    console.error(`[${source.id}] channel resolution failed: ${error.message}`);
    continue;
  }

  const feedState = sourceFeedState(source.id);
  try {
    const entries = await fetchAtomFeed(resolved.channelId);
    rssFetches += 1;
    for (const entry of entries) {
      const previousUpdated = feedState.entries[entry.videoId] ?? null;
      if (previousUpdated !== entry.updated) {
        candidateByVideoId.set(entry.videoId, {
          source,
          discovery: 'youtube_atom_feed',
          updated: entry.updated
        });
      }
    }
  } catch (error) {
    rssFailures += 1;
    console.error(`[${source.id}] RSS discovery failed: ${error.message}`);
  }

  if (DISCOVERY_MODE === 'rss+playlist') {
    try {
      const beforePlaylist = source.youtube_uploads_playlist_id || null;
      const uploads = await ensureUploadsPlaylist(source, resolved.channelId);
      if (!uploads?.playlistId) throw new Error('uploads playlist not found');
      sourceChanged ||= uploads.changed;
      if (!beforePlaylist && uploads.playlistId) channelQueriesApprox += 1;
      const playlist = await api('playlistItems', {
        part: 'contentDetails',
        playlistId: uploads.playlistId,
        maxResults: 25
      });
      playlistQueries += 1;
      for (const item of playlist.items || []) {
        const videoId = item.contentDetails?.videoId;
        if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue;
        if (!(videoId in feedState.entries)) {
          candidateByVideoId.set(videoId, {
            source,
            discovery: 'uploads_playlist_daily_backstop',
            updated: `playlist:${new Date().toISOString().slice(0, 10)}`
          });
        }
      }
    } catch (error) {
      console.error(`[${source.id}] playlist backstop failed: ${error.message}`);
    }
  }
}

for (const record of previousStreams) {
  if (record.origin !== 'youtube_api') continue;
  if (typeof record.youtube_video_id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(record.youtube_video_id)) continue;
  const source = sourceBySourceId.get(record.source_id);
  if (!source) continue;
  if (!candidateByVideoId.has(record.youtube_video_id)) {
    candidateByVideoId.set(record.youtube_video_id, {
      source,
      discovery: record.discovery || 'known_active_video',
      updated: null
    });
  }
}

const candidates = [...candidateByVideoId.keys()];
for (const batch of chunks(candidates, 50)) {
  try {
    const details = await api('videos', {
      part: 'snippet,liveStreamingDetails,status',
      id: batch.join(',')
    });
    videoQueries += 1;
    const returned = new Map((details.items || []).map((video) => [video.id, video]));
    for (const id of batch) {
      const candidate = candidateByVideoId.get(id);
      if (!candidate) continue;
      const { source, discovery, updated } = candidate;
      const video = returned.get(id);
      const feedState = sourceFeedState(source.id);
      if (updated !== null) {
        feedState.entries[id] = updated;
        const keys = Object.keys(feedState.entries);
        if (keys.length > 40) {
          for (const staleId of keys.slice(0, keys.length - 40)) delete feedState.entries[staleId];
        }
      }
      if (!video) continue;
      const status = liveState(video);
      if (status) fresh.push(toRecord(source, video, status, discovery));
    }
  } catch (error) {
    for (const id of batch) {
      const source = candidateByVideoId.get(id)?.source;
      if (source) detailFailedSources.add(source.id);
    }
    console.error(`[videos] detail refresh failed; preserving affected sources: ${error.message}`);
  }
}

const freshIds = new Set(fresh.map((record) => record.id));
const preserved = previousStreams.filter((record) => {
  if (freshIds.has(record.id)) return false;
  if (record.origin !== 'youtube_api') return true;
  return detailFailedSources.has(record.source_id);
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
await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

if (rssFetches > 0 || playlistQueries > 0) {
  acquisition.youtube = {
    ...(acquisition.youtube || {}),
    configured: true,
    mode: 'youtube_data_api_v3_plus_official_atom_feed',
    strategy: 'atom_feed_delta_plus_known_active_video_poll',
    search_list_used: false,
    atom_feed_quota_units: 0,
    poll_cadence_minutes: 15,
    playlist_backstop: 'daily',
    playlist_backstop_recent_videos: 25,
    music_live_classifier_version: MUSIC_CLASSIFIER_VERSION,
    public_stream_rule: 'music_live_status=verified'
  };
  delete acquisition.youtube.live_cadence_hours;
  delete acquisition.youtube.upcoming_cadence_hours;
  delete acquisition.youtube.recent_videos_per_source;
  await fs.writeFile(acquisitionPath, `${JSON.stringify(acquisition, null, 2)}\n`);
}

const verifiedCount = fresh.filter((record) => record.music_live_status === 'verified').length;
const rejectedCount = fresh.filter((record) => record.music_live_status === 'rejected').length;
const unknownCount = fresh.filter((record) => record.music_live_status === 'unknown').length;
console.log(`YouTube refresh complete: ${rssFetches} RSS feeds (${rssFailures} failures), ${channelQueriesApprox} channel-resolution calls, ${playlistQueries} playlist backstop calls, ${videoQueries} batched video calls, ${fresh.length} active records (${verifiedCount} verified music, ${rejectedCount} rejected, ${unknownCount} unknown), ${detailFailedSources.size} preserved sources.`);
