import fs from 'node:fs/promises';

const mode = process.argv[2];
const root = new URL('../', import.meta.url);
const streamsPath = new URL('data/streams.json', root);
const sourcesPath = new URL('data/sources.json', root);
const historyPath = new URL('data/stream-history.json', root);
const statsPath = new URL('data/source-stats.json', root);
const snapshotPath = new URL('.youtube-streams-before-refresh.json', root);

async function readJson(url, fallback) {
  try { return JSON.parse(await fs.readFile(url, 'utf8')); } catch { return fallback; }
}

function isoOrNull(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function startTime(record) {
  return isoOrNull(record.actual_start || record.scheduled_start || record.published_at);
}

function withinDays(value, days, nowMs) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) && time >= nowMs - days * 86400000 && time <= nowMs;
}

function maxIso(values) {
  const times = values.map(v => Date.parse(v || '')).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function minFutureIso(values, nowMs) {
  const times = values.map(v => Date.parse(v || '')).filter(t => Number.isFinite(t) && t >= nowMs);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

function bump(target, key, patch) {
  if (!key) return;
  if (!target[key]) target[key] = { sources: 0, live_now: 0, upcoming: 0, observed_live_30d: 0 };
  for (const [field, value] of Object.entries(patch)) target[key][field] += value;
}

function withoutGeneratedAt(stats) {
  if (!stats || typeof stats !== 'object') return stats;
  const { generated_at, ...rest } = stats;
  return rest;
}

if (mode === 'snapshot') {
  const streams = await readJson(streamsPath, []);
  await fs.writeFile(snapshotPath, `${JSON.stringify(streams, null, 2)}\n`);
  console.log(`History snapshot saved: ${streams.length} active records.`);
  process.exit(0);
}

if (mode !== 'finalize') {
  console.error('Usage: node scripts/update-history-stats.mjs snapshot|finalize');
  process.exit(2);
}

const now = new Date();
const nowIso = now.toISOString();
const nowMs = now.getTime();
const sources = await readJson(sourcesPath, []);
const previous = await readJson(snapshotPath, []);
const current = await readJson(streamsPath, []);
const existingHistory = await readJson(historyPath, []);
const existingStats = await readJson(statsPath, null);

const currentIds = new Set(current.map(record => record.id));
const historyById = new Map(existingHistory.map(record => [record.id, record]));
let archivedNow = 0;

for (const record of previous) {
  if (currentIds.has(record.id)) continue;
  if (record.music_live_status !== 'verified') continue;
  if (record.status !== 'live') continue;
  if (historyById.has(record.id)) continue;

  historyById.set(record.id, {
    ...record,
    previous_status: 'live',
    status: 'ended',
    actual_end: record.actual_end || null,
    ended_observed_at: nowIso,
    history_archived_at: nowIso,
    history_reason: 'previously_observed_live_no_longer_active'
  });
  archivedNow += 1;
}

const history = [...historyById.values()].sort((a, b) => {
  const at = Date.parse(a.actual_start || a.scheduled_start || a.published_at || a.history_archived_at || 0) || 0;
  const bt = Date.parse(b.actual_start || b.scheduled_start || b.published_at || b.history_archived_at || 0) || 0;
  return bt - at;
});

const currentVerified = current.filter(record => record.music_live_status === 'verified');
const observedLiveById = new Map();
for (const record of history) {
  if (record.music_live_status === 'verified') observedLiveById.set(record.id, record);
}
for (const record of currentVerified) {
  if (record.status === 'live') observedLiveById.set(record.id, record);
}
const observedLive = [...observedLiveById.values()];

const bySource = {};
for (const source of sources) {
  const sourceCurrent = currentVerified.filter(record => record.source_id === source.id);
  const sourceObserved = observedLive.filter(record => record.source_id === source.id);
  const starts = sourceObserved.map(startTime).filter(Boolean);
  const starts30 = starts.filter(value => withinDays(value, 30, nowMs));
  const starts7 = starts.filter(value => withinDays(value, 7, nowMs));
  const activeDays30 = new Set(starts30.map(value => value.slice(0, 10))).size;
  const liveNow = sourceCurrent.filter(record => record.status === 'live').length;
  const upcoming = sourceCurrent.filter(record => record.status === 'upcoming');
  const contentTypes = [...new Set(sourceObserved.map(record => record.content_type).filter(Boolean))].sort();

  bySource[source.id] = {
    source_id: source.id,
    source_name: source.name,
    country_code: source.country_code || null,
    country: source.country || null,
    region: source.region || null,
    city: source.city || null,
    source_type: source.type || null,
    source_genres: Array.isArray(source.genres) ? source.genres : [],
    live_now: liveNow,
    upcoming_count: upcoming.length,
    observed_live_streams_total: sourceObserved.length,
    observed_live_streams_7d: starts7.length,
    observed_live_streams_30d: starts30.length,
    active_days_30d: activeDays30,
    last_live_at: maxIso(starts),
    next_live_at: minFutureIso(upcoming.map(record => record.scheduled_start), nowMs),
    observed_content_types: contentTypes
  };
}

const aggregates = {
  by_country: {},
  by_source_type: {},
  by_source_genre: {},
  by_verified_stream_content_type_30d: {}
};

for (const source of sources) {
  const stats = bySource[source.id];
  const patch = {
    sources: 1,
    live_now: stats.live_now,
    upcoming: stats.upcoming_count,
    observed_live_30d: stats.observed_live_streams_30d
  };
  bump(aggregates.by_country, source.country_code || source.country || 'unknown', patch);
  bump(aggregates.by_source_type, source.type || 'unknown', patch);
  for (const genre of source.genres || []) bump(aggregates.by_source_genre, genre, patch);
}

for (const record of observedLive) {
  const started = startTime(record);
  if (!started || !withinDays(started, 30, nowMs)) continue;
  const type = record.content_type || 'unknown';
  aggregates.by_verified_stream_content_type_30d[type] = (aggregates.by_verified_stream_content_type_30d[type] || 0) + 1;
}

const summary = {
  sources_total: sources.length,
  live_now: currentVerified.filter(record => record.status === 'live').length,
  upcoming: currentVerified.filter(record => record.status === 'upcoming').length,
  observed_live_streams_total: observedLive.length,
  observed_live_streams_7d: observedLive.filter(record => withinDays(startTime(record), 7, nowMs)).length,
  observed_live_streams_30d: observedLive.filter(record => withinDays(startTime(record), 30, nowMs)).length,
  history_records: history.length
};

const statsCore = {
  schema_version: 1,
  definitions: {
    observed_live_stream: 'A music_live_status=verified stream that was actually observed with status=live. Upcoming-only records are not counted as historical streams.',
    source_genres: 'Source coverage metadata only; never treated as verified stream genre.'
  },
  summary,
  by_source: bySource,
  aggregates
};

const coreChanged = JSON.stringify(withoutGeneratedAt(existingStats)) !== JSON.stringify(statsCore);
const stats = {
  schema_version: statsCore.schema_version,
  generated_at: coreChanged ? nowIso : (existingStats?.generated_at || nowIso),
  definitions: statsCore.definitions,
  summary: statsCore.summary,
  by_source: statsCore.by_source,
  aggregates: statsCore.aggregates
};

await fs.writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`);
await fs.writeFile(statsPath, `${JSON.stringify(stats, null, 2)}\n`);
await fs.rm(snapshotPath, { force: true });
console.log(`History/stats updated: ${archivedNow} newly archived live streams, ${history.length} history records, ${observedLive.length} observed live streams total, stats changed=${coreChanged}.`);
