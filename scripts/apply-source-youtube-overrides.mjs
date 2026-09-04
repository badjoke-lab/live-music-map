import fs from 'node:fs/promises';

const API_KEY = process.env.YOUTUBE_API_KEY?.trim();
const sourcesPath = new URL('../data/sources.json', import.meta.url);
const overridesPath = new URL('../data/source-youtube-overrides.json', import.meta.url);
const sources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
const overrides = JSON.parse(await fs.readFile(overridesPath, 'utf8'));

if (!Array.isArray(sources) || !Array.isArray(overrides)) throw new Error('Sources and YouTube overrides must be arrays');

function normalized(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

function assertOverrideShape(override) {
  if (!override?.source_id) throw new Error('YouTube override is missing source_id');
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(override.youtube_channel_id || '')) throw new Error(`[${override.source_id}] invalid override channel id`);
  if (!/^UU[A-Za-z0-9_-]{22}$/.test(override.youtube_uploads_playlist_id || '')) throw new Error(`[${override.source_id}] invalid override uploads playlist id`);
  if (override.youtube_uploads_playlist_id !== `UU${override.youtube_channel_id.slice(2)}`) throw new Error(`[${override.source_id}] override uploads playlist does not match channel id`);
  if (!override.youtube_url) throw new Error(`[${override.source_id}] override is missing youtube_url`);
  if (!override.expected_title) throw new Error(`[${override.source_id}] override is missing expected_title`);
}

async function api(path, params) {
  if (!API_KEY) throw new Error('YOUTUBE_API_KEY is required to verify a pending YouTube identity correction');
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries({ ...params, key: API_KEY })) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${body?.error?.message || `${response.status} ${response.statusText}`}`);
  return body;
}

let changed = 0;
let verified = 0;
let alreadyApplied = 0;

for (const override of overrides) {
  assertOverrideShape(override);
  const source = sources.find((candidate) => candidate.id === override.source_id);
  if (!source) throw new Error(`[${override.source_id}] override Source not found`);

  const alreadyMatches = source.youtube_channel_id === override.youtube_channel_id
    && source.youtube_uploads_playlist_id === override.youtube_uploads_playlist_id
    && source.youtube_url === override.youtube_url;
  if (alreadyMatches) {
    alreadyApplied += 1;
    continue;
  }

  const channelResult = await api('channels', {
    part: 'snippet,contentDetails',
    id: override.youtube_channel_id,
    maxResults: 1
  });
  const channel = channelResult.items?.[0];
  if (!channel || channel.id !== override.youtube_channel_id) throw new Error(`[${override.source_id}] pinned channel id was not returned by YouTube`);
  if (normalized(channel.snippet?.title) !== normalized(override.expected_title)) {
    throw new Error(`[${override.source_id}] pinned channel title mismatch: expected ${override.expected_title}, got ${channel.snippet?.title || 'unknown'}`);
  }
  if (override.expected_handle && channel.snippet?.customUrl && normalized(channel.snippet.customUrl) !== normalized(override.expected_handle)) {
    throw new Error(`[${override.source_id}] pinned channel handle mismatch: expected ${override.expected_handle}, got ${channel.snippet.customUrl}`);
  }
  const authoritativeUploads = channel.contentDetails?.relatedPlaylists?.uploads || null;
  if (authoritativeUploads !== override.youtube_uploads_playlist_id) {
    throw new Error(`[${override.source_id}] uploads playlist mismatch: expected ${override.youtube_uploads_playlist_id}, got ${authoritativeUploads || 'unknown'}`);
  }

  const playlistProof = await api('playlistItems', {
    part: 'contentDetails',
    playlistId: override.youtube_uploads_playlist_id,
    maxResults: 1
  });
  if (!Array.isArray(playlistProof.items)) throw new Error(`[${override.source_id}] uploads playlist proof did not return an items array`);
  verified += 1;

  const oldChannelId = source.youtube_channel_id || null;
  source.youtube_url = override.youtube_url;
  source.youtube_channel_id = override.youtube_channel_id;
  source.youtube_uploads_playlist_id = override.youtube_uploads_playlist_id;
  for (const evidence of source.evidence || []) {
    if (evidence?.kind === 'official_youtube_channel') evidence.url = override.youtube_url;
  }
  changed += 1;
  console.log(`[${override.source_id}] verified YouTube identity correction: ${oldChannelId || 'none'} -> ${override.youtube_channel_id}; uploads=${override.youtube_uploads_playlist_id}.`);
}

if (changed) await fs.writeFile(sourcesPath, `${JSON.stringify(sources, null, 2)}\n`);
console.log(`YouTube source overrides: ${overrides.length} configured, ${verified} verified now, ${changed} changed, ${alreadyApplied} already applied.`);
