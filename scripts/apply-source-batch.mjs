import fs from 'node:fs/promises';

const batchArg = process.argv[2];
if (!batchArg) throw new Error('Usage: node scripts/apply-source-batch.mjs <batch.json>');

const sourcesUrl = new URL('../data/sources.json', import.meta.url);
const batchUrl = new URL(`../${batchArg.replace(/^\.\//, '')}`, import.meta.url);
const sources = JSON.parse(await fs.readFile(sourcesUrl, 'utf8'));
const batch = JSON.parse(await fs.readFile(batchUrl, 'utf8'));

if (!Array.isArray(sources) || !Array.isArray(batch)) throw new Error('Source files must contain arrays');

const ids = new Set(sources.map((source) => source.id));
let added = 0;
for (const source of batch) {
  if (!source?.id) throw new Error('Batch source is missing id');
  if (ids.has(source.id)) continue;
  sources.push(source);
  ids.add(source.id);
  added += 1;
}

if (added > 0) await fs.writeFile(sourcesUrl, `${JSON.stringify(sources)}\n`);
console.log(`Source batch applied: ${added} added, ${sources.length} total.`);
