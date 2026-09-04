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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const retryDelaysMs = [0, 10_000];
const hubUrl = 'https://pubsubhubbub.appspot.com/subscribe';

function compactResponseBody(text) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return '(empty)';
  return compact.length <= 500 ? compact : `${compact.slice(0, 500)}…`;
}

async function requestSubscription(source) {
  const body = new URLSearchParams({
    'hub.callback': callback,
    'hub.mode': 'subscribe',
    'hub.topic': `https://www.youtube.com/feeds/videos.xml?channel_id=${source.youtube_channel_id}`,
    'hub.verify': 'async'
  });
  if (secret) body.set('hub.secret', secret);

  let lastError = null;
  for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
    if (retryDelaysMs[attempt] > 0) await sleep(retryDelaysMs[attempt]);

    try {
      const response = await fetch(hubUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(30_000)
      });
      const responseBody = compactResponseBody(await response.text());

      if (response.ok) {
        console.log(`WebSub subscription accepted: ${source.id} ${source.youtube_channel_id} HTTP ${response.status} (attempt ${attempt + 1}) body=${responseBody}`);
        return { sourceId: source.id, ok: true, status: response.status };
      }

      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      lastError = new Error(`[${source.id}] hub subscription failed: HTTP ${response.status} ${response.statusText}; body=${responseBody}`);
      if (!retryable || attempt === retryDelaysMs.length - 1) break;

      console.warn(`${lastError.message}; retrying (${attempt + 1}/${retryDelaysMs.length})`);
    } catch (error) {
      lastError = error;
      if (attempt === retryDelaysMs.length - 1) break;
      console.warn(`[${source.id}] hub subscription request error: ${error.message}; retrying (${attempt + 1}/${retryDelaysMs.length})`);
    }
  }

  return {
    sourceId: source.id,
    ok: false,
    error: lastError?.message || `[${source.id}] hub subscription failed after retries`
  };
}

const results = [];
for (const source of selected) {
  const result = await requestSubscription(source);
  results.push(result);
  if (!result.ok) console.error(result.error);
}

const accepted = results.filter((result) => result.ok);
const failed = results.filter((result) => !result.ok);
console.log(`WebSub prototype subscription summary: accepted=${accepted.length} failed=${failed.length} total=${selected.length}`);

if (failed.length > 0) {
  throw new Error(`WebSub hub rejected ${failed.length}/${selected.length} prototype subscriptions: ${failed.map((result) => result.sourceId).join(', ')}`);
}
