import fs from 'node:fs/promises';

const sourcesUrl = new URL('../data/sources.json', import.meta.url);
const sources = JSON.parse(await fs.readFile(sourcesUrl, 'utf8'));
if (!Array.isArray(sources)) throw new Error('data/sources.json must contain an array');

const updates = [
  {
    id: 'mixmag',
    channel: 'UCQdCIrTpkhEH5Z8KPsn7NvQ',
    allow: ['Mixmag Lab', 'The Mixmag Lab', 'The Lab LDN', 'The Lab LA', 'The Lab NYC'],
    deny: ['interview', 'podcast', 'talk', 'documentary', 'tutorial', 'how to', 'trailer', 'teaser', 'recap', 'highlights', 'shorts', 'replay'],
    note: 'The Lab is Mixmag’s target recurring livestream series. Strict source title scope admits Lab-branded live records only; editorial, interviews, tutorials, promos, recaps and replays fail closed.'
  },
  {
    id: 'dj-mag',
    channel: 'UCJEKlziKdxoos1qbptjGgLg',
    allow: ['DJ Mag HQ', 'Live From DJ Mag', 'Live from DJ Mag', 'DJ Mag Live'],
    deny: ['interview', 'podcast', 'talk', 'documentary', 'tutorial', 'how to', 'trailer', 'teaser', 'recap', 'highlights', 'shorts', 'replay'],
    note: 'Strict source title scope admits DJ Mag HQ and explicitly DJ Mag-branded live sets only; editorial, interviews, tutorials, promos, recaps and replays fail closed.'
  },
  {
    id: 'kbs-world-tv',
    channel: 'UC5BMQOsAB8hKUyHu9KI6yig',
    allow: ['Music Bank', '뮤직뱅크'],
    deny: ['interview', 'behind', 'behind the scenes', 'preview', 'trailer', 'teaser', 'recap', 'highlights', 'shorts', '1hr loop', 'loop'],
    note: 'KBS WORLD TV is a mixed international broadcaster. Strict source title scope admits only Music Bank-branded live records; general KBS programming, loops, previews and interviews fail closed.'
  },
  {
    id: 'insomniac',
    channel: 'UCr45VhwCBYwMfdN-gz7W_OA',
    allow: ['EDC', 'Electric Daisy Carnival', 'Beyond Wonderland', 'Escape Halloween', 'Dreamstate', 'HARD Summer', 'Nocturnal Wonderland'],
    deny: ['interview', 'podcast', 'talk', 'news', 'trailer', 'teaser', 'recap', 'highlights', 'shorts', 'replay', 'after movie', 'aftermovie'],
    note: 'Strict source title scope admits named Insomniac music-festival live records only; recap, replay, promotional and non-performance programming fail closed. Event locations override the Los Angeles operator base when available.'
  },
  {
    id: 'kcon-official',
    channel: 'UC2aul0Y3jUJ9sMzOhWPT9AA',
    allow: ['LIVE I KCON', 'M COUNTDOWN', 'MCOUNTDOWN', 'ARTIST STAGE', 'X STAGE'],
    deny: ['red carpet', 'meet & greet', 'meet and greet', 'check-in', 'check in', 'loading', 'interview', 'talk', 'behind', 'trailer', 'teaser', 'recap', 'highlights', 'shorts', 're-streaming', 'restream', 'replay'],
    note: 'Strict source title scope admits KCON performance-stage live records only; red carpet, meet-and-greet, check-in, loading, re-streaming and other K-culture programming fail closed. Event locations override the Seoul operator base when available.'
  }
];

for (const update of updates) {
  const source = sources.find((item) => item?.id === update.id);
  if (!source) throw new Error(`Canonical source ${update.id} not found`);
  if (source.youtube_channel_id !== update.channel) {
    throw new Error(`[${update.id}] unexpected permanent YouTube channel: ${source.youtube_channel_id || '(missing)'}`);
  }
  const existingDeny = Array.isArray(source.music_live_policy?.deny_title_patterns)
    ? source.music_live_policy.deny_title_patterns
    : [];
  source.music_live_policy = {
    ...(source.music_live_policy || {}),
    mode: 'mixed',
    allow_title_patterns: update.allow,
    deny_title_patterns: [...new Set([...existingDeny, ...update.deny])],
    require_schedule_match_when_ambiguous: true,
    require_source_allow_match: true
  };
  source.verification = {
    ...(source.verification || {}),
    last_verified_at: '2026-09-06'
  };
  source.note = update.note;
}

await fs.writeFile(sourcesUrl, `${JSON.stringify(sources, null, 2)}\n`);
console.log(`Tightened strict title scope for ${updates.length} existing sources: ${updates.map((item) => item.id).join(', ')}.`);
