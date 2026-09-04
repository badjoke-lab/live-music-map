import fs from 'node:fs/promises';

const API_KEY = process.env.YOUTUBE_API_KEY?.trim();
const args = process.argv.slice(2);
const PREFLIGHT = args.includes('--preflight');
const batchArg = args.find((arg) => !arg.startsWith('--'));
const AUTO_PREFLIGHT = batchArg === 'data/source-batch-012.json';
if (!API_KEY) throw new Error('YOUTUBE_API_KEY is required for source onboarding');
if (!batchArg) throw new Error('Usage: node scripts/apply-source-batch.mjs <batch.json> [--preflight]');

const sourcesUrl = new URL('../data/sources.json', import.meta.url);
const batchUrl = new URL(`../${batchArg.replace(/^\.\//, '')}`, import.meta.url);
const sources = JSON.parse(await fs.readFile(sourcesUrl, 'utf8'));
const batch = JSON.parse(await fs.readFile(batchUrl, 'utf8'));
if (!Array.isArray(sources) || !Array.isArray(batch)) throw new Error('Source and batch files must contain arrays');

async function api(path, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries({ ...params, key: API_KEY })) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `${response.status} ${response.statusText}`);
  return body;
}

function youtubeRef(urlString) {
  const url = new URL(urlString);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'channel' && parts[1]) return { kind: 'channel', value: parts[1] };
  if (parts[0]?.startsWith('@')) return { kind: 'handle', value: parts[0].slice(1) };
  if (parts[0] === 'user' && parts[1]) return { kind: 'username', value: parts[1] };
  if (parts[0]) return { kind: 'custom', value: parts[0] };
  return null;
}

function normalizedChannelName(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

async function resolveChannel(source) {
  if (typeof source.youtube_channel_id === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(source.youtube_channel_id)) {
    return { id: source.youtube_channel_id, canonicalizeUrl: false };
  }

  const ref = youtubeRef(source.youtube_url);
  if (!ref) throw new Error(`[${source.id}] cannot parse YouTube URL`);
  if (ref.kind === 'channel') {
    if (!/^UC[A-Za-z0-9_-]{22}$/.test(ref.value)) throw new Error(`[${source.id}] invalid channel id in YouTube URL`);
    return { id: ref.value, canonicalizeUrl: false };
  }

  // YouTube bare paths such as /88rising are ambiguous: historically they may
  // resemble legacy usernames, while modern branded paths can map to handles.
  // Never let a bare path silently fall through to forUsername; only an explicit
  // /user/... URL is allowed to use that legacy lookup. If forHandle cannot
  // resolve a bare path, onboarding must pin youtube_channel_id explicitly.
  const lookups = ref.kind === 'username'
    ? [{ forUsername: ref.value }]
    : [{ forHandle: ref.value }];

  for (const lookup of lookups) {
    const result = await api('channels', { part: 'id', maxResults: 1, ...lookup });
    const id = result.items?.[0]?.id;
    if (typeof id === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(id)) {
      return { id, canonicalizeUrl: ref.kind === 'custom' };
    }
  }

  throw new Error(`[${source.id}] YouTube channel could not be resolved without search.list; pin youtube_channel_id explicitly`);
}

async function preflightBatch({ skipExistingIds = false } = {}) {
  const existingIds = new Set(sources.map((source) => source.id));
  const existingNames = new Map(sources.map((source) => [normalizedChannelName(source.name), source.id]));
  const existingChannels = new Map(sources.map((source) => [source.youtube_channel_id, source.id]).filter(([channelId]) => channelId));
  const batchIds = new Set();
  const batchChannels = new Map();
  const errors = [];
  const resolvedRows = [];

  for (const candidate of batch) {
    if (!candidate?.id) {
      errors.push('Batch source is missing id');
      continue;
    }
    if (existingIds.has(candidate.id)) {
      if (skipExistingIds) {
        console.log(`Preflight ${candidate.id}: already canonical, skipped.`);
        continue;
      }
      errors.push(`[${candidate.id}] duplicate source id already in canonical`);
      continue;
    }
    if (batchIds.has(candidate.id)) {
      errors.push(`[${candidate.id}] duplicate source id inside batch`);
      continue;
    }
    batchIds.add(candidate.id);

    const normalizedName = normalizedChannelName(candidate.name);
    if (existingNames.has(normalizedName)) errors.push(`[${candidate.id}] duplicate source name already used by ${existingNames.get(normalizedName)}`);

    try {
      const resolved = await resolveChannel(candidate);
      const existingSource = existingChannels.get(resolved.id);
      if (existingSource) errors.push(`[${candidate.id}] duplicate YouTube channel ${resolved.id}; already used by ${existingSource}`);
      if (batchChannels.has(resolved.id)) errors.push(`[${candidate.id}] duplicate YouTube channel ${resolved.id} inside batch; already used by ${batchChannels.get(resolved.id)}`);
      batchChannels.set(resolved.id, candidate.id);
      resolvedRows.push({ id: candidate.id, channelId: resolved.id });
    } catch (error) {
      errors.push(error.message);
    }
  }

  for (const row of resolvedRows) console.log(`Preflight ${row.id}: channel=${row.channelId}`);
  if (errors.length) {
    console.error(`Source batch preflight failed with ${errors.length} error(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`Source batch preflight OK: ${resolvedRows.length} pending candidates, ${batchChannels.size} unique YouTube channels, no canonical duplicates, search.list=0.`);
}

if (PREFLIGHT) {
  await preflightBatch();
  process.exit(0);
}

if (AUTO_PREFLIGHT) await preflightBatch({ skipExistingIds: true });

const existingIds = new Set(sources.map((source) => source.id));
const existingChannels = new Set(sources.map((source) => source.youtube_channel_id).filter(Boolean));
const added = [];
const skippedDuplicateChannels = [];
for (const candidate of batch) {
  if (!candidate?.id) throw new Error('Batch source is missing id');
  if (existingIds.has(candidate.id)) continue;
  const source = structuredClone(candidate);
  const resolved = await resolveChannel(source);
  source.youtube_channel_id = resolved.id;
  source.youtube_uploads_playlist_id = `UU${source.youtube_channel_id.slice(2)}`;
  if (resolved.canonicalizeUrl) {
    const canonicalUrl = `https://www.youtube.com/channel/${source.youtube_channel_id}`;
    source.youtube_url = canonicalUrl;
    for (const item of source.evidence || []) {
      if (item?.kind === 'official_youtube_channel') item.url = canonicalUrl;
    }
  }
  if (existingChannels.has(source.youtube_channel_id)) {
    skippedDuplicateChannels.push(`${source.id}:${source.youtube_channel_id}`);
    continue;
  }
  existingIds.add(source.id);
  existingChannels.add(source.youtube_channel_id);
  sources.push(source);
  added.push(source);
}

await fs.writeFile(sourcesUrl, `${JSON.stringify(sources, null, 2)}\n`);
console.log(`Source batch applied: ${added.length} added, ${sources.length} total. Duplicate channels skipped: ${skippedDuplicateChannels.length}${skippedDuplicateChannels.length ? ` (${skippedDuplicateChannels.join(', ')})` : ''}. Onboarding search.list: 0 calls by design; the normal Atom/playlist/videos.list refresh handles live and upcoming discovery.`);
