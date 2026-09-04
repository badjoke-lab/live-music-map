import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// The per-run playlist budget is deliberately fixed and measured in production before it is raised.
const API_KEY = process.env.YOUTUBE_API_KEY?.trim();
const RUN_BUDGET = Math.max(1, Number.parseInt(process.env.YOUTUBE_PLAYLIST_SWEEP_BUDGET || '40', 10) || 40);
const CADENCE_MINUTES = 15;
const RECENT_VIDEOS = 50;
const DISCOVERY_LABEL = 'uploads_playlist_budgeted_sweep';

if (!API_KEY) {
  console.log('Budgeted playlist sweep skipped: YOUTUBE_API_KEY is not configured.');
  process.exit(0);
}

const sourcesPath = new URL('../data/sources.json', import.meta.url);
const streamsPath = new URL('../data/streams.json', import.meta.url);
const statePath = new URL('../data/youtube-state.json', import.meta.url);
const acquisitionPath = new URL('../data/acquisition.json', import.meta.url);
const processorPath = new URL('./process-websub-video.mjs', import.meta.url);

const sources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
const streams = JSON.parse(await fs.readFile(streamsPath, 'utf8'));
let state = { version: 1, feeds: {} };
let acquisition = {};
try { state = JSON.parse(await fs.readFile(statePath, 'utf8')); } catch {}
try { acquisition = JSON.parse(await fs.readFile(acquisitionPath, 'utf8')); } catch {}
if (!state || typeof state !== 'object') state = { version: 1, feeds: {} };
if (!state.feeds || typeof state.feeds !== 'object') state.feeds = {};
if (!state.playlist_sweep || typeof state.playlist_sweep !== 'object') state.playlist_sweep = { sources: {} };
if (!state.playlist_sweep.sources || typeof state.playlist_sweep.sources !== 'object') state.playlist_sweep.sources = {};

function sourceState(sourceId) {
  if (!state.playlist_sweep.sources[sourceId] || typeof state.playlist_sweep.sources[sourceId] !== 'object') {
    state.playlist_sweep.sources[sourceId] = {};
  }
  if (!state.feeds[sourceId] || typeof state.feeds[sourceId] !== 'object') state.feeds[sourceId] = { entries: {} };
  if (!state.feeds[sourceId].entries || typeof state.feeds[sourceId].entries !== 'object') state.feeds[sourceId].entries = {};
  return state.playlist_sweep.sources[sourceId];
}

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function chunks(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
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

function isActive(video) {
  const content = video.snippet?.liveBroadcastContent;
  const live = video.liveStreamingDetails || {};
  if (content === 'live' && !live.actualEndTime) return true;
  if (content === 'upcoming' && Number.isFinite(Date.parse(live.scheduledStartTime))) return true;
  return false;
}

function remember(sourceId, videoId, marker) {
  const entries = state.feeds[sourceId].entries;
  entries[videoId] = marker;
  const keys = Object.keys(entries);
  if (keys.length > 100) {
    for (const staleId of keys.slice(0, keys.length - 100)) delete entries[staleId];
  }
}

async function relabelDiscovery(videoId) {
  const latestStreams = JSON.parse(await fs.readFile(streamsPath, 'utf8'));
  let changed = false;
  for (const record of latestStreams) {
    if (record.youtube_video_id !== videoId) continue;
    if (record.discovery !== DISCOVERY_LABEL) {
      record.discovery = DISCOVERY_LABEL;
      changed = true;
    }
  }
  if (changed) await fs.writeFile(streamsPath, `${JSON.stringify(latestStreams, null, 2)}\n`);
}

const enabled = sources.filter((source) =>
  source.acquisition?.enabled !== false
  && /^UC[A-Za-z0-9_-]{22}$/.test(source.youtube_channel_id || '')
  && /^UU[A-Za-z0-9_-]{22}$/.test(source.youtube_uploads_playlist_id || '')
);

for (const source of enabled) sourceState(source.id);

const selected = [...enabled]
  .sort((a, b) => {
    const aState = sourceState(a.id);
    const bState = sourceState(b.id);
    return timestamp(aState.last_checked_at) - timestamp(bState.last_checked_at)
      || timestamp(aState.last_success_at) - timestamp(bState.last_success_at)
      || a.id.localeCompare(b.id);
  })
  .slice(0, RUN_BUDGET);

const existingVideoIds = new Set(streams.map((record) => record.youtube_video_id).filter(Boolean));
const candidates = new Map();
let playlistQueries = 0;
let playlistFailures = 0;
const nowIso = new Date().toISOString();

for (const source of selected) {
  const sweep = sourceState(source.id);
  sweep.last_checked_at = nowIso;
  try {
    const playlist = await api('playlistItems', {
      part: 'contentDetails',
      playlistId: source.youtube_uploads_playlist_id,
      maxResults: RECENT_VIDEOS
    });
    playlistQueries += 1;
    sweep.last_success_at = nowIso;
    sweep.last_error = null;
    const feedEntries = state.feeds[source.id].entries;
    for (const item of playlist.items || []) {
      const videoId = item.contentDetails?.videoId;
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) continue;
      if (existingVideoIds.has(videoId) || videoId in feedEntries) continue;
      candidates.set(videoId, source);
    }
  } catch (error) {
    playlistFailures += 1;
    sweep.last_error_at = nowIso;
    sweep.last_error = error.message;
    console.error(`[${source.id}] budgeted playlist sweep failed: ${error.message}`);
  }
}

let videoQueries = 0;
let processorRuns = 0;
let processorFailures = 0;
for (const ids of chunks([...candidates.keys()], 50)) {
  let details;
  try {
    details = await api('videos', { part: 'snippet,liveStreamingDetails,status', id: ids.join(',') });
    videoQueries += 1;
  } catch (error) {
    console.error(`[videos] budgeted playlist detail lookup failed: ${error.message}`);
    continue;
  }

  const returned = new Map((details.items || []).map((video) => [video.id, video]));
  for (const id of ids) {
    const source = candidates.get(id);
    if (!source) continue;
    const video = returned.get(id);
    if (!video || !isActive(video)) {
      remember(source.id, id, `playlist-sweep:${nowIso}`);
      continue;
    }

    const result = spawnSync(process.execPath, [processorPath.pathname], {
      stdio: 'inherit',
      env: {
        ...process.env,
        YOUTUBE_WEBSUB_VIDEO_ID: id,
        YOUTUBE_WEBSUB_CHANNEL_ID: source.youtube_channel_id
      }
    });
    processorRuns += 1;
    if (result.status === 0) {
      await relabelDiscovery(id);
      remember(source.id, id, `playlist-sweep:${nowIso}`);
    } else {
      processorFailures += 1;
      console.error(`[${source.id}] targeted processor failed for ${id}; leaving it eligible for retry.`);
    }
  }
}

const fullSweepMinutes = enabled.length ? Math.ceil(enabled.length / RUN_BUDGET) * CADENCE_MINUTES : 0;
acquisition.youtube = {
  ...(acquisition.youtube || {}),
  rolling_playlist_sweep: {
    enabled: true,
    cadence_minutes: CADENCE_MINUTES,
    max_playlist_calls_per_run: RUN_BUDGET,
    recent_videos_per_source: RECENT_VIDEOS,
    selection: 'oldest_checked_first',
    source_count: enabled.length,
    projected_max_full_sweep_minutes: fullSweepMinutes
  },
  rss_failure_fallback: {
    enabled: false,
    superseded_by: 'rolling_playlist_sweep'
  }
};

await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
await fs.writeFile(acquisitionPath, `${JSON.stringify(acquisition, null, 2)}\n`);

console.log(`Budgeted playlist sweep: selected=${selected.length}/${enabled.length}, playlist calls=${playlistQueries}, playlist failures=${playlistFailures}, candidate video batches=${videoQueries}, targeted processors=${processorRuns}, processor failures=${processorFailures}, projected full sweep <=${fullSweepMinutes}m.`);
