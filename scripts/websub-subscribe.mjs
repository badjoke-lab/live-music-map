import fs from 'node:fs/promises';

const callback = process.env.WEBSUB_CALLBACK_URL?.trim();
const secret = process.env.WEBSUB_SECRET?.trim() || '';
const sourceIds = (process.env.WEBSUB_PROTOTYPE_SOURCE_IDS || 'hoer-berlin,the-lot-radio,dommune,kexp,boiler-room')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (!callback || !/^https:\/\//.test(callback)) throw new Error('WEBSUB_CALLBACK_URL must be an https URL');

const sources = JSON.parse(await fs.readFile(new URL('../data/sources.json', import.meta.url), 'utf8'));
const sourceById = new Map(sources.map((source) => [source.id, source]));
const selected = sourceIds.map((id) => {
  const source = sourceById.get(id);
  if (!source) throw new Error(`Prototype Source not found: ${id}`);
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(source.youtube_channel_id || '')) throw new Error(`Prototype Source lacks canonical channel id: ${id}`);
  return source;
});

for (const source of selected) {
  const body = new URLSearchParams({
    'hub.callback': callback,
    'hub.mode': 'subscribe',
    'hub.topic': `https://www.youtube.com/feeds/videos.xml?channel_id=${source.youtube_channel_id}`,
    'hub.verify': 'async'
  });
  if (secret) body.set('hub.secret', secret);

  const response = await fetch('https://pubsubhubbub.appspot.com/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!response.ok) throw new Error(`[${source.id}] hub subscription request failed: ${response.status} ${response.statusText}`);
  console.log(`WebSub subscription requested: ${source.id} ${source.youtube_channel_id}`);
}

console.log(`WebSub prototype subscription requests accepted by hub: ${selected.length} sources.`);
