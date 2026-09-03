import fs from 'node:fs/promises';

const sourcesPath = new URL('../data/sources.json', import.meta.url);
const sources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));

const errors = [];
const allowedPrecision = new Set(['venue_exact', 'event_exact', 'city_confirmed', 'source_base', 'operator_city_only', 'country_only', 'unknown']);
const allowedLocationRole = new Set(['source_base', 'operator_base', 'origin', 'event_home', 'unknown']);
const allowedSchedulePattern = new Set(['continuous', 'recurring', 'event_based', 'seasonal', 'irregular', 'mixed']);
const allowedLifecycle = new Set(['active', 'inactive', 'paused', 'unknown']);
const allowedPolicyMode = new Set(['music_only', 'mixed']);
const allowedAcquisitionMethod = new Set(['youtube_atom_feed']);
const allowedPriority = new Set(['low', 'normal', 'high']);
const allowedEvidenceKinds = new Set(['official_site', 'official_youtube_channel', 'official_schedule', 'official_event_page', 'other_official']);
const allowedEvidenceSupports = new Set(['identity', 'official_channel', 'music_live_capability', 'schedule_pattern', 'source_location']);

function fail(source, message) {
  errors.push(`${source?.id || '(unknown source)'}: ${message}`);
}

function isHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim());
}

if (!Array.isArray(sources)) {
  throw new Error('data/sources.json must contain an array');
}

const ids = new Map();
const channelIds = new Map();
const youtubeUrls = new Map();

for (const source of sources) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    errors.push('(unknown source): each source must be an object');
    continue;
  }

  if (source.schema_version !== 2) fail(source, 'schema_version must be 2');
  if (typeof source.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.id)) fail(source, 'id must be lower-kebab-case');
  if (typeof source.name !== 'string' || !source.name.trim()) fail(source, 'name is required');
  if (!(source.operator_name === null || (typeof source.operator_name === 'string' && source.operator_name.trim()))) fail(source, 'operator_name must be null or a non-empty string');
  if (typeof source.type !== 'string' || !source.type.trim()) fail(source, 'type is required');
  if (typeof source.country !== 'string' || !source.country.trim()) fail(source, 'country is required');
  if (typeof source.country_code !== 'string' || !/^[A-Z]{2}$/.test(source.country_code)) fail(source, 'country_code must be ISO-like two-letter uppercase');
  if (!(source.region === null || typeof source.region === 'string')) fail(source, 'region must be string or null');
  if (!(source.city === null || typeof source.city === 'string')) fail(source, 'city must be string or null');

  const location = source.location;
  if (!location || typeof location !== 'object' || Array.isArray(location)) {
    fail(source, 'location object is required');
  } else {
    if (!allowedPrecision.has(location.precision)) fail(source, `unsupported location.precision: ${location.precision}`);
    if (!allowedLocationRole.has(location.role)) fail(source, `unsupported location.role: ${location.role}`);
    if (typeof location.label !== 'string' || !location.label.trim()) fail(source, 'location.label is required');
    const hasLat = Number.isFinite(location.lat);
    const hasLon = Number.isFinite(location.lon);
    if (hasLat !== hasLon) fail(source, 'location lat/lon must either both exist or both be null');
    if (hasLat && (location.lat < -90 || location.lat > 90)) fail(source, 'location.lat is out of range');
    if (hasLon && (location.lon < -180 || location.lon > 180)) fail(source, 'location.lon is out of range');
    if (!hasLat && location.precision !== 'country_only' && location.precision !== 'unknown') fail(source, 'mapped precision requires coordinates');
  }

  if (!stringArray(source.genres)) fail(source, 'genres must be an array of non-empty strings');
  if (!stringArray(source.formats) || source.formats.length === 0) fail(source, 'formats must contain at least one music-live format');
  if (!stringArray(source.languages)) fail(source, 'languages must be an array of non-empty strings');
  if (!allowedSchedulePattern.has(source.schedule_pattern)) fail(source, `unsupported schedule_pattern: ${source.schedule_pattern}`);
  if (!allowedLifecycle.has(source.lifecycle_status)) fail(source, `unsupported lifecycle_status: ${source.lifecycle_status}`);

  if (!isHttps(source.official_site)) fail(source, 'official_site must be an https URL');
  if (!(source.schedule_url === null || isHttps(source.schedule_url))) fail(source, 'schedule_url must be null or an https URL');
  if (!isHttps(source.youtube_url)) fail(source, 'youtube_url must be an https URL');

  const policy = source.music_live_policy;
  if (!policy || typeof policy !== 'object') {
    fail(source, 'music_live_policy object is required');
  } else {
    if (!allowedPolicyMode.has(policy.mode)) fail(source, `unsupported music_live_policy.mode: ${policy.mode}`);
    if (!stringArray(policy.allow_title_patterns)) fail(source, 'allow_title_patterns must be a string array');
    if (!stringArray(policy.deny_title_patterns)) fail(source, 'deny_title_patterns must be a string array');
    if (typeof policy.require_schedule_match_when_ambiguous !== 'boolean') fail(source, 'require_schedule_match_when_ambiguous must be boolean');
  }

  const verification = source.verification;
  if (!verification || typeof verification !== 'object') {
    fail(source, 'verification object is required');
  } else {
    if (typeof verification.official_channel !== 'boolean') fail(source, 'verification.official_channel must be boolean');
    if (typeof verification.music_live_capable !== 'boolean') fail(source, 'verification.music_live_capable must be boolean');
    if (typeof verification.last_verified_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(verification.last_verified_at)) fail(source, 'verification.last_verified_at must be YYYY-MM-DD');
  }

  const evidence = source.evidence;
  if (!Array.isArray(evidence) || evidence.length === 0) {
    fail(source, 'evidence must contain official provenance records');
  } else {
    const supported = new Set();
    for (const item of evidence) {
      if (!item || typeof item !== 'object') {
        fail(source, 'each evidence item must be an object');
        continue;
      }
      if (!allowedEvidenceKinds.has(item.kind)) fail(source, `unsupported evidence.kind: ${item.kind}`);
      if (!isHttps(item.url)) fail(source, 'evidence.url must be an https URL');
      if (!stringArray(item.supports) || item.supports.length === 0) fail(source, 'evidence.supports must be a non-empty string array');
      for (const support of item.supports || []) {
        if (!allowedEvidenceSupports.has(support)) fail(source, `unsupported evidence support: ${support}`);
        supported.add(support);
      }
    }
    for (const required of ['identity', 'official_channel', 'music_live_capability']) {
      if (!supported.has(required)) fail(source, `evidence must support ${required}`);
    }
  }

  const acquisition = source.acquisition;
  if (!acquisition || typeof acquisition !== 'object') {
    fail(source, 'acquisition object is required');
  } else {
    if (typeof acquisition.enabled !== 'boolean') fail(source, 'acquisition.enabled must be boolean');
    if (!allowedAcquisitionMethod.has(acquisition.method)) fail(source, `unsupported acquisition.method: ${acquisition.method}`);
    if (!allowedPriority.has(acquisition.priority)) fail(source, `unsupported acquisition.priority: ${acquisition.priority}`);
  }

  if (typeof source.youtube_channel_id !== 'string' || !/^UC[A-Za-z0-9_-]{22}$/.test(source.youtube_channel_id)) fail(source, 'youtube_channel_id must be a 24-character UC channel id');
  if (typeof source.youtube_uploads_playlist_id !== 'string') {
    fail(source, 'youtube_uploads_playlist_id is required');
  } else if (typeof source.youtube_channel_id === 'string') {
    const expected = `UU${source.youtube_channel_id.slice(2)}`;
    if (source.youtube_uploads_playlist_id !== expected) fail(source, `uploads playlist must be ${expected}`);
  }

  for (const [map, value, label] of [
    [ids, source.id, 'source id'],
    [channelIds, source.youtube_channel_id, 'YouTube channel id'],
    [youtubeUrls, source.youtube_url, 'YouTube URL']
  ]) {
    if (!value) continue;
    if (map.has(value)) fail(source, `duplicate ${label}; already used by ${map.get(value)}`);
    else map.set(value, source.id);
  }
}

if (errors.length) {
  console.error(`Source contract validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Source contract OK: ${sources.length} sources, ${channelIds.size} unique YouTube channels.`);
