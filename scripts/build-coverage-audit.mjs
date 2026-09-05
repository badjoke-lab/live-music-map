import fs from 'node:fs/promises';

const sources = JSON.parse(await fs.readFile(new URL('../data/sources.json', import.meta.url), 'utf8'));
const streams = JSON.parse(await fs.readFile(new URL('../data/streams.json', import.meta.url), 'utf8'));
const stats = JSON.parse(await fs.readFile(new URL('../data/source-stats.json', import.meta.url), 'utf8'));

const outputUrl = new URL('../data/coverage-audit.json', import.meta.url);
const markdownUrl = new URL('../docs/COVERAGE_AUDIT.md', import.meta.url);
const bySourceStats = stats?.by_source || {};
const backgroundPatterns = [
  /\b24\s*\/\s*7\b/i,
  /\blo-?fi\b/i,
  /\bchill(?:out)?\b/i,
  /\bstudy\b/i,
  /\brelax(?:ing|ation)?\b/i,
  /\bbackground\b/i,
  /\bbgm\b/i,
  /\bsleep\b/i,
  /\bcoffee\s+jazz\b/i,
  /\bambient\s+(?:music|radio)\b/i
];

function countBy(values, keyFn) {
  const out = {};
  for (const value of values) {
    const key = keyFn(value) ?? 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function isBackgroundLike(record) {
  return backgroundPatterns.some((pattern) => pattern.test(record.title || ''));
}

const sourceById = new Map(sources.map((source) => [source.id, source]));
const currentBySource = new Map();
for (const record of streams) {
  if (!currentBySource.has(record.source_id)) currentBySource.set(record.source_id, []);
  currentBySource.get(record.source_id).push(record);
}

const verified = streams.filter((record) => record.music_live_status === 'verified');
const rejected = streams.filter((record) => record.music_live_status === 'rejected');
const unknown = streams.filter((record) => record.music_live_status === 'unknown');
const live = streams.filter((record) => record.status === 'live');
const upcoming = streams.filter((record) => record.status === 'upcoming');
const verifiedLive = verified.filter((record) => record.status === 'live');
const verifiedUpcoming = verified.filter((record) => record.status === 'upcoming');
const backgroundLikeVerified = verified.filter(isBackgroundLike).map((record) => ({
  source_id: record.source_id,
  source_name: sourceById.get(record.source_id)?.name || record.source_id,
  video_id: record.youtube_video_id,
  status: record.status,
  title: record.title,
  decision: record.music_live_decision,
  classifier_version: record.classifier_version
}));

const unknownRecords = unknown.map((record) => ({
  source_id: record.source_id,
  source_name: sourceById.get(record.source_id)?.name || record.source_id,
  video_id: record.youtube_video_id,
  status: record.status,
  title: record.title,
  decision: record.music_live_decision,
  requires_schedule_match: record.music_live_requires_schedule_match === true,
  evidence: record.music_live_evidence || []
}));

const sourceRows = sources.map((source) => {
  const current = currentBySource.get(source.id) || [];
  const sourceStat = bySourceStats[source.id] || {};
  return {
    source_id: source.id,
    name: source.name,
    country_code: source.country_code,
    country: source.country,
    region: source.region,
    city: source.city,
    type: source.type,
    schedule_pattern: source.schedule_pattern,
    lifecycle_status: source.lifecycle_status,
    current_live: current.filter((record) => record.status === 'live').length,
    current_upcoming: current.filter((record) => record.status === 'upcoming').length,
    current_verified: current.filter((record) => record.music_live_status === 'verified').length,
    current_unknown: current.filter((record) => record.music_live_status === 'unknown').length,
    current_rejected: current.filter((record) => record.music_live_status === 'rejected').length,
    observed_live_total: sourceStat.observed_live_streams_total || 0,
    observed_live_30d: sourceStat.observed_live_streams_30d || 0,
    active_days_30d: sourceStat.active_days_30d || 0,
    last_live_at: sourceStat.last_live_at || null,
    next_live_at: sourceStat.next_live_at || null
  };
});

const neverObserved = sourceRows.filter((row) => row.observed_live_total === 0);
const noCurrentOrHistory = sourceRows.filter((row) =>
  row.current_live === 0 && row.current_upcoming === 0 && row.observed_live_total === 0
);
const noRecentObserved = sourceRows.filter((row) => row.observed_live_30d === 0);
const currentVerifiedSources = sourceRows.filter((row) => row.current_verified > 0);
const currentLiveSources = sourceRows.filter((row) => row.current_live > 0);
const currentUpcomingSources = sourceRows.filter((row) => row.current_upcoming > 0);

const cityDensity = Object.entries(countBy(
  sources.filter((source) => source.city),
  (source) => `${source.city}, ${source.country_code}`
)).map(([place, count]) => ({ place, count })).slice(0, 20);

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  summary: {
    sources_total: sources.length,
    stream_records_total: streams.length,
    live_records: live.length,
    upcoming_records: upcoming.length,
    verified_records: verified.length,
    rejected_records: rejected.length,
    unknown_records: unknown.length,
    verified_live_records: verifiedLive.length,
    verified_upcoming_records: verifiedUpcoming.length,
    sources_with_current_live: currentLiveSources.length,
    sources_with_current_upcoming: currentUpcomingSources.length,
    sources_with_current_verified: currentVerifiedSources.length,
    sources_never_observed_live: neverObserved.length,
    sources_without_observed_live_30d: noRecentObserved.length,
    sources_without_current_or_history: noCurrentOrHistory.length,
    background_like_verified_records: backgroundLikeVerified.length
  },
  classification: {
    status: countBy(streams, (record) => record.music_live_status),
    content_type: countBy(streams, (record) => record.content_type),
    decision: countBy(streams, (record) => record.music_live_decision),
    classifier_version: countBy(streams, (record) => String(record.classifier_version ?? 'unknown'))
  },
  background_like_verified_records: backgroundLikeVerified,
  unknown_records: unknownRecords,
  sources_never_observed_live: neverObserved,
  sources_without_current_or_history: noCurrentOrHistory,
  top_city_source_density: cityDensity,
  source_rows: sourceRows
};

await fs.writeFile(outputUrl, `${JSON.stringify(report, null, 2)}\n`);

const md = `# Coverage audit\n\nGenerated: ${report.generated_at}\n\n## Current acquisition coverage\n\n- registered Sources: **${report.summary.sources_total}**\n- active stream records: **${report.summary.stream_records_total}**\n- LIVE records: **${report.summary.live_records}**\n- Upcoming records: **${report.summary.upcoming_records}**\n- verified records: **${report.summary.verified_records}**\n- rejected records: **${report.summary.rejected_records}**\n- unknown records: **${report.summary.unknown_records}**\n- Sources with current LIVE: **${report.summary.sources_with_current_live}**\n- Sources with current Upcoming: **${report.summary.sources_with_current_upcoming}**\n- Sources with current verified record: **${report.summary.sources_with_current_verified}**\n- Sources never observed LIVE: **${report.summary.sources_never_observed_live}**\n- Sources with no observed LIVE in 30d: **${report.summary.sources_without_observed_live_30d}**\n- Sources with neither current records nor observed-live history: **${report.summary.sources_without_current_or_history}**\n\n## Classification review queues\n\n- background/BGM-like titles currently marked verified: **${report.summary.background_like_verified_records}**\n- ambiguous records currently marked unknown: **${report.summary.unknown_records}**\n\nThe background/BGM-like queue is a heuristic audit queue, not an automatic deletion rule. It exists because 24/7, lo-fi, chill, study, relaxation, BGM and similar streams are not the target for new Source expansion and can pollute discovery if left mixed with event/live-performance streams.\n\n## Highest Source density cities\n\n${report.top_city_source_density.map((row) => `- ${row.place}: **${row.count}**`).join('\n')}\n`;
await fs.writeFile(markdownUrl, md);

console.log(`Coverage audit: ${sources.length} sources, ${streams.length} active records, ${verified.length} verified, ${unknown.length} unknown, ${rejected.length} rejected, ${neverObserved.length} never observed live, ${backgroundLikeVerified.length} background-like verified.`);
