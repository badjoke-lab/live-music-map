import fs from 'node:fs/promises';

const sourcesPath = new URL('../data/sources.json', import.meta.url);
const overridesPath = new URL('../data/source-location-overrides.json', import.meta.url);

const sources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
const overrides = JSON.parse(await fs.readFile(overridesPath, 'utf8'));
if (!Array.isArray(sources) || !Array.isArray(overrides)) throw new Error('sources and location overrides must be arrays');

let changed = 0;
for (const override of overrides) {
  const source = sources.find((item) => item?.id === override?.id);
  if (!source) throw new Error(`[${override?.id || 'unknown'}] source location override target not found`);
  if (!override.location || !Number.isFinite(override.location.lat) || !Number.isFinite(override.location.lon)) {
    throw new Error(`[${override.id}] location override requires finite lat/lon`);
  }

  const before = JSON.stringify({ region: source.region, city: source.city, location: source.location, note: source.note, evidence: source.evidence });
  source.region = override.region ?? null;
  source.city = override.city ?? null;
  source.location = structuredClone(override.location);
  if (typeof override.note === 'string' && override.note.trim()) source.note = override.note;

  if (override.evidence) {
    source.evidence = Array.isArray(source.evidence) ? source.evidence : [];
    const same = source.evidence.some((item) => item?.url === override.evidence.url && Array.isArray(item?.supports) && item.supports.includes('source_location'));
    if (!same) source.evidence.push(structuredClone(override.evidence));
  }

  const after = JSON.stringify({ region: source.region, city: source.city, location: source.location, note: source.note, evidence: source.evidence });
  if (before !== after) changed += 1;
}

await fs.writeFile(sourcesPath, `${JSON.stringify(sources, null, 2)}\n`);
console.log(`Source location overrides applied: ${changed} changed, ${overrides.length} checked.`);
