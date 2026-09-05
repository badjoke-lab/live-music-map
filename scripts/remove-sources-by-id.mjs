import fs from 'node:fs/promises';

const ids = new Set(process.argv.slice(2));
if (!ids.size) throw new Error('Usage: node scripts/remove-sources-by-id.mjs <source-id> [source-id...]');

const sourcesUrl = new URL('../data/sources.json', import.meta.url);
const sources = JSON.parse(await fs.readFile(sourcesUrl, 'utf8'));
if (!Array.isArray(sources)) throw new Error('data/sources.json must contain an array');

const before = sources.length;
const removed = sources.filter((source) => ids.has(source.id));
const kept = sources.filter((source) => !ids.has(source.id));

const missing = [...ids].filter((id) => !removed.some((source) => source.id === id));
if (missing.length) console.log(`Already absent: ${missing.join(', ')}`);

await fs.writeFile(sourcesUrl, `${JSON.stringify(kept, null, 2)}\n`);
console.log(`Removed ${removed.length} source(s): ${removed.map((source) => source.id).join(', ') || '(none)'}. ${before} -> ${kept.length}.`);
