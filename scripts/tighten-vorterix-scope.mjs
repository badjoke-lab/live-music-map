import fs from 'node:fs/promises';

const sourcesUrl = new URL('../data/sources.json', import.meta.url);
const sources = JSON.parse(await fs.readFile(sourcesUrl, 'utf8'));
if (!Array.isArray(sources)) throw new Error('data/sources.json must contain an array');

const source = sources.find((item) => item?.id === 'vorterix');
if (!source) throw new Error('Canonical source vorterix not found');

const existingDeny = Array.isArray(source.music_live_policy?.deny_title_patterns)
  ? source.music_live_policy.deny_title_patterns
  : [];

source.music_live_policy = {
  ...(source.music_live_policy || {}),
  mode: 'mixed',
  allow_title_patterns: [
    'música en vivo',
    'musica en vivo',
    'live session',
    'sesión en vivo',
    'sesion en vivo',
    'concierto',
    'recital',
    'full concert',
    'showcase'
  ],
  deny_title_patterns: [...new Set([
    ...existingDeny,
    'no preguntes por rusia',
    'paren la mano',
    'zona liberada',
    'qué rompimos',
    'que rompimos',
    'cohete al sol',
    'cortina de humo',
    'suban los vidrios',
    'maldición',
    'maldicion',
    'cross over',
    'nos anotó un amigo',
    'nos anoto un amigo',
    'interview',
    'entrevista',
    'podcast',
    'talk',
    'debate',
    'noticias',
    'news',
    'gaming',
    'humor',
    'política',
    'politica',
    'economía',
    'economia',
    'trailer',
    'teaser',
    'promo',
    'recap',
    'resumen',
    'highlights',
    'shorts',
    'replay'
  ])],
  require_schedule_match_when_ambiguous: true,
  require_source_allow_match: true
};
source.verification = {
  ...(source.verification || {}),
  last_verified_at: '2026-09-08'
};
source.note = 'Vorterix is a mixed music-and-entertainment broadcaster. Generic EN VIVO/LIVE wording is not evidence of a music performance. Strict title scope admits only explicitly music-performance titles (music live/session/concert/recital/showcase); named talk, news, humor, gaming and editorial programs fail closed.';

await fs.writeFile(sourcesUrl, `${JSON.stringify(sources, null, 2)}\n`);
console.log('Tightened strict music-live title scope for Vorterix; generic en vivo/live no longer qualifies.');
