import fs from 'node:fs/promises';

const streamsPath = new URL('../data/streams.json', import.meta.url);
const DEFAULT_GRACE_HOURS = 24;
const GRACE_HOURS = Math.max(0, Number.parseFloat(process.env.UPCOMING_STALE_GRACE_HOURS || String(DEFAULT_GRACE_HOURS)) || DEFAULT_GRACE_HOURS);
const GRACE_MS = GRACE_HOURS * 60 * 60 * 1000;
const now = Date.now();

const streams = JSON.parse(await fs.readFile(streamsPath, 'utf8'));
if (!Array.isArray(streams)) throw new Error('data/streams.json must contain an array');

function isStaleUpcoming(record) {
  if (!record || record.status !== 'upcoming') return false;
  if (record.actual_start || record.actual_end) return false;
  const scheduled = Date.parse(record.scheduled_start || '');
  if (!Number.isFinite(scheduled)) return false;
  return scheduled < now - GRACE_MS;
}

const stale = streams.filter(isStaleUpcoming);
const next = streams.filter((record) => !isStaleUpcoming(record));

if (stale.length) {
  await fs.writeFile(streamsPath, `${JSON.stringify(next, null, 2)}\n`);
}

for (const record of stale) {
  console.log(`Pruned stale upcoming: ${record.id} source=${record.source_id || 'unknown'} scheduled_start=${record.scheduled_start}`);
}
console.log(`Stale upcoming prune: removed=${stale.length}, remaining=${next.length}, grace_hours=${GRACE_HOURS}.`);
