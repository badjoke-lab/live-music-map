import fs from 'node:fs/promises';

const batchArg = process.argv[2];
if (!batchArg) throw new Error('Usage: node scripts/validate-source-batch-policy.mjs <batch.json>');

const sourcesUrl = new URL('../data/sources.json', import.meta.url);
const policyUrl = new URL('../data/source-onboarding-policy.json', import.meta.url);
const batchUrl = new URL(`../${batchArg.replace(/^\.\//, '')}`, import.meta.url);

const [sources, batch, policyDoc] = await Promise.all([
  fs.readFile(sourcesUrl, 'utf8').then(JSON.parse),
  fs.readFile(batchUrl, 'utf8').then(JSON.parse),
  fs.readFile(policyUrl, 'utf8').then(JSON.parse)
]);

if (!Array.isArray(sources) || !Array.isArray(batch)) throw new Error('Canonical sources and batch must be arrays');

const policy = policyDoc?.new_source_policy || {};
const blockedGenres = new Set(policy.blocked_genres || []);
const blockedSchedulePatterns = new Set(policy.blocked_schedule_patterns || []);
const blockedFormats = new Set(policy.blocked_formats || []);
const requirePermanentId = policy.require_permanent_youtube_channel_id === true;

const normalize = (value) => String(value || '').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
const validUcId = (value) => typeof value === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(value);

const existingById = new Map(sources.map((source) => [source.id, source]));
const existingNames = new Map(sources.map((source) => [normalize(source.name), source.id]));
const existingChannels = new Map(sources.map((source) => [source.youtube_channel_id, source.id]).filter(([id]) => id));

const batchIds = new Map();
const batchNames = new Map();
const batchChannels = new Map();
const errors = [];
let pending = 0;
let alreadyCanonical = 0;

for (const candidate of batch) {
  const id = candidate?.id;
  const name = normalize(candidate?.name);
  const channelId = candidate?.youtube_channel_id;

  if (!id) {
    errors.push('(unknown): missing source id');
    continue;
  }

  if (batchIds.has(id)) errors.push(`[${id}] duplicate source id inside batch; first used by ${batchIds.get(id)}`);
  else batchIds.set(id, id);

  if (!name) errors.push(`[${id}] missing source name`);
  else if (batchNames.has(name)) errors.push(`[${id}] duplicate normalized source name inside batch; first used by ${batchNames.get(name)}`);
  else batchNames.set(name, id);

  if (requirePermanentId && !validUcId(channelId)) {
    errors.push(`[${id}] permanent youtube_channel_id is required before merge`);
  }
  if (channelId) {
    if (batchChannels.has(channelId)) errors.push(`[${id}] duplicate YouTube channel ${channelId} inside batch; first used by ${batchChannels.get(channelId)}`);
    else batchChannels.set(channelId, id);
  }

  const existing = existingById.get(id);
  if (existing) {
    const sameName = normalize(existing.name) === name;
    const sameChannel = existing.youtube_channel_id === channelId;
    if (!sameName || !sameChannel) {
      errors.push(`[${id}] id already canonical but identity differs (canonical name/channel: ${existing.name} / ${existing.youtube_channel_id || '(missing)'})`);
    } else {
      alreadyCanonical += 1;
    }
    continue;
  }

  pending += 1;

  const existingNameOwner = existingNames.get(name);
  if (existingNameOwner) errors.push(`[${id}] duplicate normalized source name; canonical owner=${existingNameOwner}`);

  const existingChannelOwner = existingChannels.get(channelId);
  if (existingChannelOwner) errors.push(`[${id}] duplicate permanent YouTube channel ${channelId}; canonical owner=${existingChannelOwner}`);

  const candidateGenres = Array.isArray(candidate.genres) ? candidate.genres : [];
  const hitGenres = candidateGenres.filter((genre) => blockedGenres.has(genre));
  if (hitGenres.length) errors.push(`[${id}] blocked new-source genre(s): ${hitGenres.join(', ')}`);

  if (blockedSchedulePatterns.has(candidate.schedule_pattern)) {
    errors.push(`[${id}] blocked new-source schedule_pattern: ${candidate.schedule_pattern}`);
  }

  const candidateFormats = Array.isArray(candidate.formats) ? candidate.formats : [];
  const hitFormats = candidateFormats.filter((format) => blockedFormats.has(format));
  if (hitFormats.length) errors.push(`[${id}] blocked new-source format(s): ${hitFormats.join(', ')}`);
}

if (errors.length) {
  console.error(`Source candidate gate FAILED with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Source candidate gate OK: ${pending} pending, ${alreadyCanonical} already canonical, ${batchChannels.size} unique batch UC IDs; policy and canonical duplicate checks passed.`);
