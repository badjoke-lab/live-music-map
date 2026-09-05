import fs from 'node:fs/promises';

const sourcesPath = new URL('../data/sources.json', import.meta.url);
const outputPath = new URL('../data/source-hygiene-audit.json', import.meta.url);
const sources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));

const PERFORMANCE_FORMATS = new Set([
  'dj_set',
  'live_performance',
  'concert',
  'festival_stream',
  'studio_session',
  'award_show',
  'music_event_stream',
  'music_awards_live',
  'music_tv_live',
  'opera',
  'recital'
]);

const BACKGROUND_PATTERNS = [
  /\blo[ -]?fi\b/i,
  /\bchillhop\b/i,
  /\bchill(?:out)?\b/i,
  /\bambient\b/i,
  /\brelax(?:ing|ation)?\b/i,
  /\bmeditation\b/i,
  /\bsleep\b/i,
  /\bbgm\b/i,
  /\bbackground\b/i,
  /\bfocus\b/i,
  /\bstudy\b/i,
  /\bjazzhop\b/i,
  /\bcafe music\b/i,
  /作業用/i,
  /睡眠/i,
  /癒し/i
];

function textFor(source) {
  return [
    source.id,
    source.name,
    source.type,
    ...(source.genres || []),
    ...(source.formats || []),
    source.note,
    ...(source.music_live_policy?.allow_title_patterns || [])
  ].filter(Boolean).join(' ');
}

function hasPerformanceFormat(source) {
  return (source.formats || []).some((format) => PERFORMANCE_FORMATS.has(format));
}

function isContinuousLike(source) {
  return source.schedule_pattern === 'continuous'
    || source.status === 'continuous'
    || (source.formats || []).includes('continuous_stream')
    || ((source.formats || []).length === 1 && source.formats[0] === 'music_radio_live');
}

function isBackgroundLike(source) {
  const text = textFor(source);
  return BACKGROUND_PATTERNS.some((pattern) => pattern.test(text));
}

const remove = [];
const retainContinuousPerformance = [];
const review = [];

for (const source of sources) {
  const continuousLike = isContinuousLike(source);
  const performance = hasPerformanceFormat(source);
  const backgroundLike = isBackgroundLike(source);

  if (continuousLike && !performance && backgroundLike) {
    remove.push({
      id: source.id,
      name: source.name,
      country: source.country,
      schedule_pattern: source.schedule_pattern,
      formats: source.formats || [],
      genres: source.genres || [],
      reason: 'continuous/background-only source without DJ/performance/concert/event format'
    });
    continue;
  }

  if (continuousLike && performance) {
    retainContinuousPerformance.push({
      id: source.id,
      name: source.name,
      country: source.country,
      schedule_pattern: source.schedule_pattern,
      formats: source.formats || [],
      reason: 'continuous-capable but has explicit human performance/event format'
    });
    continue;
  }

  if (backgroundLike && !performance) {
    review.push({
      id: source.id,
      name: source.name,
      country: source.country,
      schedule_pattern: source.schedule_pattern,
      formats: source.formats || [],
      genres: source.genres || [],
      reason: 'background-like metadata but not continuous-like; manual review before any removal'
    });
  }
}

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  source_count_before: sources.length,
  rule: {
    remove: 'continuous-like AND no explicit performance/event format AND strong background/lofi/BGM metadata',
    retain: 'continuous-like sources with DJ/live-performance/concert/festival/studio/award/music-TV formats',
    review_only: 'background-like but not continuous-like'
  },
  remove_count: remove.length,
  remove,
  retain_continuous_performance_count: retainContinuousPerformance.length,
  retain_continuous_performance: retainContinuousPerformance,
  review_count: review.length,
  review
};

await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Source hygiene audit: ${sources.length} total; ${remove.length} remove; ${retainContinuousPerformance.length} retained continuous-performance; ${review.length} review-only.`);
for (const source of remove) console.log(`REMOVE ${source.id} :: ${source.name}`);
for (const source of retainContinuousPerformance) console.log(`KEEP ${source.id} :: ${source.name}`);
