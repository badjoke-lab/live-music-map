const API_KEY = process.env.YOUTUBE_API_KEY?.trim();
const handles = String(process.env.YOUTUBE_HANDLES || '')
  .split(',')
  .map((value) => value.trim().replace(/^@/, ''))
  .filter(Boolean);

if (!API_KEY) throw new Error('YOUTUBE_API_KEY is required');
if (!handles.length) throw new Error('YOUTUBE_HANDLES is required');

async function api(params) {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  for (const [key, value] of Object.entries({ ...params, key: API_KEY })) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `${response.status} ${response.statusText}`);
  return body;
}

for (const handle of handles) {
  const result = await api({ part: 'id,snippet,contentDetails', forHandle: handle, maxResults: 1 });
  const channel = result.items?.[0];
  if (!channel?.id) {
    console.log(`UNRESOLVED @${handle}`);
    continue;
  }
  console.log(JSON.stringify({
    handle: `@${handle}`,
    title: channel.snippet?.title || null,
    youtube_channel_id: channel.id,
    youtube_uploads_playlist_id: channel.contentDetails?.relatedPlaylists?.uploads || null
  }));
}
