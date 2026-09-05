import fs from 'node:fs/promises';

const args = process.argv.slice(2);
const VALIDATE_ONLY = args[0] === 'validate';
const validateTarget = VALIDATE_ONLY ? args[1] : null;

const sourcesPath = VALIDATE_ONLY && validateTarget
  ? new URL(`../${validateTarget.replace(/^\.\//, '')}`, import.meta.url)
  : new URL('../data/sources.json', import.meta.url);
const streamsPath = new URL('../data/streams.json', import.meta.url);

const sources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
if (!Array.isArray(sources)) throw new Error('Source scope input must contain an array');

const GLOBAL_DENY_PATTERNS = [
  'interview',
  'podcast',
  'news',
  'discussion',
  'press conference',
  'panel discussion',
  'q&a'
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

function validateStrictPolicies(input) {
  const errors = [];
  let strictCount = 0;

  for (const source of input) {
    const policy = source?.music_live_policy;
    if (!policy || typeof policy !== 'object') continue;
    if ('require_source_allow_match' in policy && typeof policy.require_source_allow_match !== 'boolean') {
      errors.push(`[${source?.id || '(unknown)'}] require_source_allow_match must be boolean when present`);
      continue;
    }
    if (policy.require_source_allow_match !== true) continue;
    strictCount += 1;
    if (policy.mode !== 'mixed') errors.push(`[${source.id}] strict source scope requires music_live_policy.mode=mixed`);
    if (!Array.isArray(policy.allow_title_patterns) || policy.allow_title_patterns.length === 0) {
      errors.push(`[${source.id}] strict source scope requires at least one allow_title_patterns entry`);
    } else if (policy.allow_title_patterns.some((pattern) => typeof pattern !== 'string' || !pattern.trim())) {
      errors.push(`[${source.id}] strict source scope allow_title_patterns must contain non-empty strings`);
    }
    if (!Array.isArray(policy.deny_title_patterns)) errors.push(`[${source.id}] strict source scope requires deny_title_patterns array`);
  }

  if (errors.length) {
    console.error(`Strict source scope validation FAILED with ${errors.length} error(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  return strictCount;
}

const strictCount = validateStrictPolicies(sources);
if (VALIDATE_ONLY) {
  console.log(`Strict source scope validation OK: ${strictCount} strict source(s) in ${validateTarget || 'input'}.`);
  process.exit(0);
}

const streams = JSON.parse(await fs.readFile(streamsPath, 'utf8'));
if (!Array.isArray(streams)) throw new Error('data/streams.json must contain an array');

const strictSources = new Map(
  sources
    .filter((source) => source?.music_live_policy?.require_source_allow_match === true)
    .map((source) => [source.id, source])
);

let changed = 0;
let inspected = 0;
let deniedByPattern = 0;
let deniedMissingAllow = 0;

for (const record of streams) {
  const source = strictSources.get(record?.source_id);
  if (!source) continue;
  inspected += 1;

  const title = normalizeText(record.title);
  const policy = source.music_live_policy;
  const sourceDeny = Array.isArray(policy.deny_title_patterns) ? policy.deny_title_patterns : [];
  const denyMatch = [...sourceDeny, ...GLOBAL_DENY_PATTERNS].find((pattern) => matchesPattern(title, pattern));
  const allowMatch = (policy.allow_title_patterns || []).find((pattern) => matchesPattern(title, pattern));

  let decision = null;
  let evidenceValue = null;
  if (denyMatch) {
    decision = 'strict_source_deny_pattern';
    evidenceValue = denyMatch;
    deniedByPattern += 1;
  } else if (!allowMatch) {
    decision = 'source_title_allow_required';
    evidenceValue = 'require_source_allow_match';
    deniedMissingAllow += 1;
  }

  if (!decision) continue;
  if (record.music_live_status === 'rejected' && record.music_live_decision === decision) continue;

  record.music_live_status = 'rejected';
  record.content_type = 'unknown';
  record.music_live_decision = decision;
  record.music_live_evidence = [{
    type: decision === 'strict_source_deny_pattern' ? 'youtube_title_pattern' : 'source_policy',
    value: evidenceValue
  }];
  record.music_live_requires_schedule_match = false;
  changed += 1;
}

if (changed > 0) await fs.writeFile(streamsPath, `${JSON.stringify(streams, null, 2)}\n`);
console.log(`Strict source title scope enforced: ${strictSources.size} configured sources, ${inspected} active records inspected, ${changed} records changed (${deniedByPattern} deny-pattern, ${deniedMissingAllow} missing source allow).`);
