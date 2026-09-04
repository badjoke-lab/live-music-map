import fs from 'node:fs/promises';

const sourcesPath = new URL('../data/sources.json', import.meta.url);
const sources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
if (!Array.isArray(sources)) throw new Error('data/sources.json must contain an array');

let repaired = 0;
for (const source of sources) {
  const channelId = source?.youtube_channel_id;
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(channelId || '')) continue;
  if (typeof source.youtube_uploads_playlist_id === 'string' && source.youtube_uploads_playlist_id) continue;
  source.youtube_uploads_playlist_id = `UU${channelId.slice(2)}`;
  repaired += 1;
  console.log(`[${source.id}] restored missing uploads playlist ${source.youtube_uploads_playlist_id}`);
}

if (repaired > 0) {
  await fs.writeFile(sourcesPath, `${JSON.stringify(sources, null, 2)}\n`);
}

console.log(`Uploads playlist repair: ${repaired} source(s) repaired.`);
