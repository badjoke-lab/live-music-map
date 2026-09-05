import fs from 'node:fs/promises';

const TOKEN = process.env.GITHUB_TOKEN?.trim();
const REPOSITORY = process.env.GITHUB_REPOSITORY?.trim() || 'badjoke-lab/live-music-map';
const WORKFLOW = process.env.ACQUISITION_AUDIT_WORKFLOW?.trim() || 'youtube-refresh.yml';
const SAMPLE_SIZE = Math.max(10, Number.parseInt(process.env.ACQUISITION_AUDIT_SAMPLE_SIZE || '10', 10) || 10);
const [owner, repo] = REPOSITORY.split('/');

if (!TOKEN) throw new Error('GITHUB_TOKEN is required to build acquisition audit data');
if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: ${REPOSITORY}`);

const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
const outputPath = new URL('../data/acquisition-audit.json', import.meta.url);
const markdownPath = new URL('../docs/ACQUISITION_AUDIT.md', import.meta.url);

async function github(path, { accept = 'application/vnd.github+json', text = false } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      accept,
      authorization: `Bearer ${TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'live-music-map-acquisition-audit'
    },
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} ${response.statusText}: ${path}`);
  return text ? response.text() : response.json();
}

function int(match, index) {
  const value = match?.[index];
  return value === undefined ? null : Number.parseInt(value, 10);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function distribution(values) {
  return {
    p50: percentile(values, 0.50),
    p95: percentile(values, 0.95),
    max: values.length ? Math.max(...values) : null
  };
}

function parseLog(log) {
  const refresh = [...log.matchAll(/YouTube refresh complete: (\d+) RSS feeds \((\d+) failures\), (\d+) channel-resolution calls, (\d+) playlist backstop calls, (\d+) batched video calls, (\d+) active records \((\d+) verified music, (\d+) rejected, (\d+) unknown\), (\d+) preserved sources\./g)].at(-1);
  const sweep = [...log.matchAll(/Budgeted playlist sweep: selected=(\d+)\/(\d+), playlist calls=(\d+), playlist failures=(\d+), channel repair calls=(\d+), repaired playlists=(\d+), candidate video batches=(\d+), targeted processors=(\d+), processor failures=(\d+), projected full sweep <=(\d+)m\./g)].at(-1);
  const identity = [...log.matchAll(/Stream channel identity: (\d+) records checked in (\d+) videos\.list batches, (\d+) mismatches removed, (\d+) failed batches preserved\./g)].at(-1);
  const contracts = [...log.matchAll(/Source contract OK: (\d+) sources, (\d+) unique YouTube channels\./g)];
  const contract = contracts.at(-1);

  const parsed = {
    source_count: int(contract, 1),
    unique_youtube_channels: int(contract, 2),
    refresh: refresh ? {
      rss_fetches: int(refresh, 1),
      rss_failures: int(refresh, 2),
      channel_calls: int(refresh, 3),
      playlist_calls: int(refresh, 4),
      video_calls: int(refresh, 5),
      active_records: int(refresh, 6),
      verified_music: int(refresh, 7),
      rejected: int(refresh, 8),
      unknown: int(refresh, 9),
      preserved_sources: int(refresh, 10)
    } : null,
    rolling_sweep: sweep ? {
      selected_sources: int(sweep, 1),
      eligible_sources: int(sweep, 2),
      playlist_calls: int(sweep, 3),
      playlist_failures: int(sweep, 4),
      channel_repair_calls: int(sweep, 5),
      repaired_playlists: int(sweep, 6),
      video_calls: int(sweep, 7),
      targeted_processors: int(sweep, 8),
      processor_failures: int(sweep, 9),
      projected_full_sweep_minutes: int(sweep, 10)
    } : null,
    identity_check: identity ? {
      checked_records: int(identity, 1),
      video_calls: int(identity, 2),
      mismatches_removed: int(identity, 3),
      failed_batches_preserved: int(identity, 4)
    } : null
  };

  const refreshUnits = parsed.refresh
    ? parsed.refresh.channel_calls + parsed.refresh.playlist_calls + parsed.refresh.video_calls
    : 0;
  const sweepUnits = parsed.rolling_sweep
    ? parsed.rolling_sweep.playlist_calls
      + parsed.rolling_sweep.channel_repair_calls
      + parsed.rolling_sweep.video_calls
      + parsed.rolling_sweep.targeted_processors
    : 0;
  const identityUnits = parsed.identity_check?.video_calls || 0;

  parsed.api_units_estimated = refreshUnits + sweepUnits + identityUnits;
  parsed.api_units_breakdown = {
    refresh: refreshUnits,
    rolling_sweep: sweepUnits,
    identity_check: identityUnits
  };
  return parsed;
}

const runResponse = await github(`/actions/workflows/${encodeURIComponent(WORKFLOW)}/runs?branch=main&status=completed&per_page=50`);
const completedRuns = runResponse.workflow_runs || [];
const runs = [];

for (const run of completedRuns) {
  if (runs.length >= SAMPLE_SIZE) break;
  const jobsResponse = await github(`/actions/runs/${run.id}/jobs?per_page=100`);
  const refreshJob = (jobsResponse.jobs || []).find((job) => job.name === 'refresh' && job.conclusion === 'success');
  if (!refreshJob?.id || !refreshJob.started_at || !refreshJob.completed_at) continue;

  const log = await github(`/actions/jobs/${refreshJob.id}/logs`, { text: true });
  const parsed = parseLog(log);
  if (!parsed.refresh || !Number.isFinite(parsed.source_count)) continue;
  const durationSeconds = Math.max(0, Math.round((Date.parse(refreshJob.completed_at) - Date.parse(refreshJob.started_at)) / 1000));
  runs.push({
    run_id: run.id,
    run_number: run.run_number,
    workflow_conclusion: run.conclusion,
    event: run.event,
    head_sha: run.head_sha,
    created_at: run.created_at,
    duration_seconds: durationSeconds,
    ...parsed
  });
}

if (runs.length < SAMPLE_SIZE) {
  throw new Error(`Need at least ${SAMPLE_SIZE} successful refresh jobs with readable metrics; found ${runs.length}`);
}

const sampled = runs.slice(0, SAMPLE_SIZE);
const durations = sampled.map((run) => run.duration_seconds);
const apiUnits = sampled.map((run) => run.api_units_estimated);
const rssFetches = sampled.reduce((sum, run) => sum + (run.refresh?.rss_fetches || 0), 0);
const rssFailures = sampled.reduce((sum, run) => sum + (run.refresh?.rss_failures || 0), 0);
const playlistFailures = sampled.reduce((sum, run) => sum + (run.rolling_sweep?.playlist_failures || 0), 0);
const identityMismatches = sampled.reduce((sum, run) => sum + (run.identity_check?.mismatches_removed || 0), 0);
const preservedSources = sampled.reduce((sum, run) => sum + (run.refresh?.preserved_sources || 0), 0);
const sourceCounts = sampled.map((run) => run.source_count).filter(Number.isFinite);

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  repository: REPOSITORY,
  workflow: WORKFLOW,
  sample_size: sampled.length,
  sample_rule: 'latest completed workflow runs whose refresh job succeeded and exposed acquisition metrics, regardless of later Pages deployment result',
  percentile_method: 'nearest_rank',
  api_unit_method: {
    description: 'Estimated YouTube Data API v3 quota units used by acquisition steps whose calls are logged. Atom feed HTTP fetches cost 0 YouTube Data API units.',
    counted_as_one_unit_each: ['channels.list', 'playlistItems.list', 'videos.list'],
    includes: [
      'refresh-youtube-live channel resolution/playlist/video calls',
      'budgeted playlist sweep playlist/channel repair/video calls',
      'one videos.list per targeted processor invoked by the rolling sweep',
      'stream channel identity videos.list batches'
    ],
    excludes: 'Calls outside the acquisition steps above; search.list is not used by the current refresh path.'
  },
  summary: {
    duration_seconds: distribution(durations),
    api_units_estimated: distribution(apiUnits),
    api_units_total_sample: apiUnits.reduce((sum, value) => sum + value, 0),
    rss_fetches_total: rssFetches,
    rss_failures_total: rssFailures,
    rss_failure_rate: rssFetches ? rssFailures / rssFetches : null,
    rolling_playlist_failures_total: playlistFailures,
    identity_mismatches_removed_total: identityMismatches,
    detail_failure_preserved_sources_total: preservedSources,
    source_count_min: sourceCounts.length ? Math.min(...sourceCounts) : null,
    source_count_max: sourceCounts.length ? Math.max(...sourceCounts) : null
  },
  runs: sampled
};

await fs.writeFile(outputPath, `${JSON.stringify(report, null,2)}\n`);

const failurePct = report.summary.rss_failure_rate === null
  ? 'n/a'
  : `${(report.summary.rss_failure_rate * 100).toFixed(2)}%`;
const md = `# Acquisition audit\n\nGenerated: ${report.generated_at}\n\nThis is the M3 production audit for the YouTube acquisition path. It samples the latest ${report.sample_size} completed \`${WORKFLOW}\` runs whose **refresh job itself succeeded**, even if a later Pages deployment failed for an unrelated reason.\n\n## Runtime\n\n- p50: **${report.summary.duration_seconds.p50}s**\n- p95: **${report.summary.duration_seconds.p95}s**\n- max: **${report.summary.duration_seconds.max}s**\n\n## Estimated YouTube Data API quota\n\n- p50: **${report.summary.api_units_estimated.p50} units/run**\n- p95: **${report.summary.api_units_estimated.p95} units/run**\n- max: **${report.summary.api_units_estimated.max} units/run**\n- total across sample: **${report.summary.api_units_total_sample} units**\n\nThe estimate counts logged \`channels.list\`, \`playlistItems.list\`, and \`videos.list\` calls at one unit each. Official Atom feed fetches cost zero YouTube Data API quota units. The rolling sweep estimate also counts one \`videos.list\` call per targeted processor. \`search.list\` is not used by this refresh path.\n\n## Reliability\n\n- RSS fetches: **${report.summary.rss_fetches_total}**\n- RSS failures: **${report.summary.rss_failures_total}** (${failurePct})\n- rolling playlist failures: **${report.summary.rolling_playlist_failures_total}**\n- stream/source channel mismatches removed: **${report.summary.identity_mismatches_removed_total}**\n- source preservations caused by failed detail batches: **${report.summary.detail_failure_preserved_sources_total}**\n- source count represented in sample: **${report.summary.source_count_min ?? 'n/a'}–${report.summary.source_count_max ?? 'n/a'}**\n\n## Decision rule\n\nDo not increase the global polling cadence or add a permanent extra polling tier from source-count intuition alone. Use this audit plus the active/upcoming coverage audit to decide whether the current RSS + rolling playlist sweep is empirically insufficient. WebSub remains a complement/pilot path, not a replacement for the bridge.\n`;
await fs.writeFile(markdownPath, md);

console.log(`Acquisition audit: ${sampled.length} runs, duration p50/p95/max=${report.summary.duration_seconds.p50}/${report.summary.duration_seconds.p95}/${report.summary.duration_seconds.max}s, API units p50/p95/max=${report.summary.api_units_estimated.p50}/${report.summary.api_units_estimated.p95}/${report.summary.api_units_estimated.max}, RSS failures=${rssFailures}/${rssFetches}.`);
