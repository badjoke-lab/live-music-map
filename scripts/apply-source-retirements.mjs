import fs from 'node:fs/promises';

const retiredPath = new URL('../data/source-retired.json', import.meta.url);
const sourcesPath = new URL('../data/sources.json', import.meta.url);
const streamsPath = new URL('../data/streams.json', import.meta.url);
const historyPath = new URL('../data/stream-history.json', import.meta.url);
const statePath = new URL('../data/youtube-state.json', import.meta.url);

const retired = JSON.parse(await fs.readFile(retiredPath, 'utf8'));
const retiredIds = new Set(Array.isArray(retired?.source_ids) ? retired.source_ids : []);
if (!retiredIds.size) throw new Error('data/source-retired.json has no source_ids');

const sources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
const streams = JSON.parse(await fs.readFile(streamsPath, 'utf8'));
const history = JSON.parse(await fs.readFile(historyPath, 'utf8'));
let state = {};
try { state = JSON.parse(await fs.readFile(statePath, 'utf8')); } catch {}

const beforeSources = sources.length;
const beforeStreams = streams.length;
const beforeHistory = history.length;

const removedSources = sources.filter((source) => retiredIds.has(source.id));
const keptSources = sources.filter((source) => !retiredIds.has(source.id));
const keptStreams = streams.filter((stream) => !retiredIds.has(stream.source_id));
const keptHistory = history.filter((stream) => !retiredIds.has(stream.source_id));

if (state?.feeds && typeof state.feeds === 'object') {
  for (const id of retiredIds) delete state.feeds[id];
}
if (state?.playlist_sweep?.sources && typeof state.playlist_sweep.sources === 'object') {
  for (const id of retiredIds) delete state.playlist_sweep.sources[id];
}

await fs.writeFile(sourcesPath, `${JSON.stringify(keptSources, null, 2)}\n`);
await fs.writeFile(streamsPath, `${JSON.stringify(keptStreams, null, 2)}\n`);
await fs.writeFile(historyPath, `${JSON.stringify(keptHistory, null, 2)}\n`);
if (state && typeof state === 'object') {
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

const missing = [...retiredIds].filter((id) => !removedSources.some((source) => source.id === id));
console.log(`Source retirements applied: ${removedSources.length} source(s) removed; ${beforeSources} -> ${keptSources.length}.`);
console.log(`Active streams pruned: ${beforeStreams - keptStreams.length}; ${beforeStreams} -> ${keptStreams.length}.`);
console.log(`History records pruned: ${beforeHistory - keptHistory.length}; ${beforeHistory} -> ${keptHistory.length}.`);
console.log(`Removed source ids: ${removedSources.map((source) => source.id).join(', ') || '(none)'}`);
if (missing.length) console.log(`Already absent retired ids: ${missing.join(', ')}`);
