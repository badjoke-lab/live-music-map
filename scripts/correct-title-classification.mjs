import fs from 'node:fs/promises';

const sourcesPath = new URL('../data/sources.json', import.meta.url);
const streamsPath = new URL('../data/streams.json', import.meta.url);

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

function contentTypeFromPattern(pattern, source) {
  const p = normalizeText(pattern);
  const mapped = GLOBAL_ALLOW_PATTERNS.find(([candidate]) => candidate === p)?.[1];
  if (mapped) return mapped;
  if (p.includes('dj')) return 'dj_set';
  if (p.includes('festival')) return 'festival_stream';
  if (p.includes('session')) return 'studio_session';
  if (p.includes('opera')) return 'opera';
  if (p.includes('concert') || p.includes('orchestra') || p.includes('symphony') || p.includes('recital')) return 'concert';
  if (source?.formats?.length === 1) return source.formats[0];
  return 'music_live_unspecified';
}

const sources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
const streams = JSON.parse(await fs.readFile(streamsPath, 'utf8'));
const sourceById = new Map(sources.map((source) => [source.id, source]));

let corrected = 0;
const correctedIds = [];

for (const stream of streams) {
  if (stream.music_live_status !== 'rejected' && stream.music_live_status !== 'unknown') continue;

  const source = sourceById.get(stream.source_id);
  if (!source) continue;

  const title = normalizeText(stream.title);
  const policy = source.music_live_policy || { mode: 'mixed' };
  const sourceDeny = Array.isArray(policy.deny_title_patterns) ? policy.deny_title_patterns : [];
  const titleDeny = [...sourceDeny, ...GLOBAL_DENY_PATTERNS].find((pattern) => matchesPattern(title, pattern));

  // A non-music signal in the title remains authoritative. This correction only
  // repairs cases where a deny word appeared elsewhere in YouTube metadata.
  if (titleDeny) continue;

  const sourceAllow = Array.isArray(policy.allow_title_patterns) ? policy.allow_title_patterns : [];
  const sourceAllowMatch = sourceAllow.find((pattern) => matchesPattern(title, pattern));
  const globalAllowMatch = GLOBAL_ALLOW_PATTERNS.find(([pattern]) => matchesPattern(title, pattern));

  if (!sourceAllowMatch && !globalAllowMatch) continue;

  const matchedPattern = sourceAllowMatch || globalAllowMatch[0];
  stream.music_live_status = 'verified';
  stream.content_type = sourceAllowMatch
    ? contentTypeFromPattern(sourceAllowMatch, source)
    : globalAllowMatch[1];
  stream.music_live_decision = sourceAllowMatch
    ? 'source_allow_title_precedence'
    : 'global_allow_title_precedence';
  stream.music_live_evidence = [{ type: 'youtube_title_pattern', value: matchedPattern }];
  stream.music_live_requires_schedule_match = false;
  stream.classifier_version = Math.max(Number(stream.classifier_version) || 1, 2);
  corrected += 1;
  correctedIds.push(stream.id);
}

if (corrected > 0) {
  await fs.writeFile(streamsPath, `${JSON.stringify(streams, null, 2)}\n`);
}

console.log(`Title classification precedence: corrected ${corrected} stream(s)${correctedIds.length ? `: ${correctedIds.join(', ')}` : '.'}`);
