import fs from 'node:fs/promises';

const STATE_URL = new URL('../data/rss-outage-fallback-state.json', import.meta.url);
const SOURCES_URL = new URL('../data/sources.json', import.meta.url);
const MODE = process.argv[2] || 'probe';
const WIDESPREAD_THRESHOLD = Number.parseFloat(process.env.RSS_OUTAGE_THRESHOLD || '0.5');
const FULL_SWEEP_COOLDOWN_HOURS = Math.max(1, Number.parseInt(process.env.RSS_OUTAGE_FULL_SWEEP_COOLDOWN_HOURS || '24', 10) || 24);
const CONCURRENCY = 25;

async function readJson(url, fallback) {
  try {
    return JSON.parse(await fs.readFile(url, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeOutput(key, value) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  await fs.appendFile(output, `${key}=${value}\n`);
}

function chunks(values, size) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

async function probe(source) {
  try {
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(source.youtube_channel_id)}`, {
      headers: { accept: 'application/atom+xml,application/xml,text/xml' }
    });
    return { source_id: source.id, ok: response.ok, status: response.status };
  } catch (error) {
    return { source_id: source.id, ok: false, status: 0, error: error.message };
  }
}

const state = await readJson(STATE_URL, {
  schema_version: 1,
  last_full_sweep_at: null,
  last_probe_at: null,
  last_probe: null
});

if (MODE === 'mark-full-sweep') {
  const now = new Date().toISOString();
  state.schema_version = 1;
  state.last_full_sweep_at = now;
  state.last_full_sweep_source_count = Number.parseInt(process.env.RSS_OUTAGE_SWEEP_SOURCE_COUNT || '0', 10) || null;
  state.last_full_sweep_reason = 'widespread_youtube_atom_failure';
  await fs.writeFile(STATE_URL, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`RSS outage guard marked full playlist fallback at ${now}.`);
  process.exit(0);
}

if (MODE !== 'probe') throw new Error(`Unknown mode: ${MODE}`);

const sources = await readJson(SOURCES_URL, []);
const enabled = sources.filter((source) =>
  source.acquisition?.enabled !== false
  && /^UC[A-Za-z0-9_-]{22}$/.test(source.youtube_channel_id || '')
  && /^UU[A-Za-z0-9_-]{22}$/.test(source.youtube_uploads_playlist_id || '')
);

const results = [];
for (const batch of chunks(enabled, CONCURRENCY)) {
  results.push(...await Promise.all(batch.map(probe)));
}

const failed = results.filter((result) => !result.ok);
const statusCounts = {};
for (const result of failed) {
  const key = String(result.status || 'network');
  statusCounts[key] = (statusCounts[key] || 0) + 1;
}

const failureRate = enabled.length ? failed.length / enabled.length : 0;
const widespread = enabled.length > 0 && failureRate >= WIDESPREAD_THRESHOLD;
const lastSweepMs = Date.parse(state.last_full_sweep_at || '');
const cooldownMs = FULL_SWEEP_COOLDOWN_HOURS * 60 * 60 * 1000;
const cooldownElapsed = !Number.isFinite(lastSweepMs) || Date.now() - lastSweepMs >= cooldownMs;
const runFullSweep = widespread && cooldownElapsed;
const now = new Date().toISOString();

state.schema_version = 1;
state.last_probe_at = now;
state.last_probe = {
  source_count: enabled.length,
  healthy: enabled.length - failed.length,
  failed: failed.length,
  failure_rate: failureRate,
  widespread,
  status_counts: statusCounts,
  full_sweep_due: runFullSweep
};

await writeOutput('source_count', enabled.length);
await writeOutput('healthy_count', enabled.length - failed.length);
await writeOutput('failed_count', failed.length);
await writeOutput('failure_rate', failureRate.toFixed(6));
await writeOutput('widespread', widespread ? 'true' : 'false');
await writeOutput('run_full_sweep', runFullSweep ? 'true' : 'false');

console.log(`RSS outage guard: ${enabled.length} sources, ${failed.length} failed (${(failureRate * 100).toFixed(1)}%), widespread=${widespread}, last_full_sweep=${state.last_full_sweep_at || 'never'}, run_full_sweep=${runFullSweep}, statuses=${JSON.stringify(statusCounts)}.`);
