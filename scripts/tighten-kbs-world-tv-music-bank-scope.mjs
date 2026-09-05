import fs from 'node:fs/promises';

const sourcesUrl = new URL('../data/sources.json', import.meta.url);
const sources = JSON.parse(await fs.readFile(sourcesUrl, 'utf8'));
if (!Array.isArray(sources)) throw new Error('data/sources.json must contain an array');

const source = sources.find((item) => item?.id === 'kbs-world-tv');
if (!source) throw new Error('Canonical source kbs-world-tv not found');
if (source.youtube_channel_id !== 'UC5BMQOsAB8hKUyHu9KI6yig') {
  throw new Error(`Unexpected KBS WORLD TV channel: ${source.youtube_channel_id || '(missing)'}`);
}

source.music_live_policy = {
  ...(source.music_live_policy || {}),
  mode: 'mixed',
  allow_title_patterns: ['Music Bank', '뮤직뱅크'],
  deny_title_patterns: [
    'interview',
    'behind',
    'behind the scenes',
    'preview',
    'trailer',
    'teaser',
    'recap',
    'highlights',
    'shorts',
    '1hr loop',
    'loop'
  ],
  require_schedule_match_when_ambiguous: true,
  require_source_allow_match: true
};
source.verification = {
  ...(source.verification || {}),
  last_verified_at: '2026-09-06'
};
source.note = 'KBS WORLD TV is already canonical on the permanent channel UC5BMQOsAB8hKUyHu9KI6yig. Music Bank is the target recurring YouTube livestream; strict source title scope admits only Music Bank-branded records and rejects general KBS programming, loops, previews and interviews.';

await fs.writeFile(sourcesUrl, `${JSON.stringify(sources, null, 2)}\n`);
console.log('Tightened kbs-world-tv to strict Music Bank-only title scope.');
