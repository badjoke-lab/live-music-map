const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function allowedChannels(env) {
  return new Set(String(env.PROTOTYPE_CHANNEL_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => CHANNEL_ID_RE.test(value)));
}

function callbackPath(env) {
  const raw = String(env.CALLBACK_PATH || '/youtube').trim() || '/youtube';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function topicChannelId(topic) {
  try {
    const url = new URL(topic);
    if (url.hostname !== 'www.youtube.com') return null;
    if (url.pathname !== '/feeds/videos.xml') return null;
    const channelId = url.searchParams.get('channel_id');
    return CHANNEL_ID_RE.test(channelId || '') ? channelId : null;
  } catch {
    return null;
  }
}

function parseAtomNotification(xml) {
  const videoId = xml.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]?.trim() || null;
  const channelId = xml.match(/<yt:channelId>([^<]+)<\/yt:channelId>/)?.[1]?.trim() || null;
  if (!VIDEO_ID_RE.test(videoId || '') || !CHANNEL_ID_RE.test(channelId || '')) return null;
  return { videoId, channelId };
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifySignature(body, secret, header) {
  if (!secret) return true;
  const match = String(header || '').match(/^sha1=([a-f0-9]{40})$/i);
  if (!match) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return bytesToHex(digest).toLowerCase() === match[1].toLowerCase();
}

async function dispatchToGitHub(env, payload) {
  if (String(env.DRY_RUN || '') === '1') return;
  const repository = String(env.GITHUB_REPOSITORY || 'badjoke-lab/live-music-map').trim();
  const token = String(env.GITHUB_DISPATCH_TOKEN || '').trim();
  if (!token) throw new Error('GITHUB_DISPATCH_TOKEN is required');
  const response = await fetch(`https://api.github.com/repos/${repository}/dispatches`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'live-music-map-websub',
      'x-github-api-version': '2022-11-28'
    },
    body: JSON.stringify({
      event_type: 'youtube_websub',
      client_payload: {
        video_id: payload.videoId,
        channel_id: payload.channelId,
        received_at: new Date().toISOString()
      }
    })
  });
  if (!response.ok) throw new Error(`GitHub repository_dispatch failed: ${response.status} ${response.statusText}`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== callbackPath(env)) return new Response('Not found', { status: 404 });

    const allowed = allowedChannels(env);
    if (allowed.size === 0) return new Response('Prototype channel allowlist is empty', { status: 503 });

    if (request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const topic = url.searchParams.get('hub.topic');
      const challenge = url.searchParams.get('hub.challenge');
      const channelId = topicChannelId(topic);
      if (!['subscribe', 'unsubscribe'].includes(mode || '') || !challenge || !channelId || !allowed.has(channelId)) {
        return new Response('Verification rejected', { status: 404 });
      }
      return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }

    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, POST' } });

    const body = await request.text();
    const signatureOk = await verifySignature(body, String(env.WEBSUB_SECRET || ''), request.headers.get('x-hub-signature'));
    if (!signatureOk) return new Response('Invalid signature', { status: 401 });

    const notification = parseAtomNotification(body);
    if (!notification) return new Response('Invalid Atom notification', { status: 400 });
    if (!allowed.has(notification.channelId)) return new Response('Channel not in prototype allowlist', { status: 403 });

    try {
      await dispatchToGitHub(env, notification);
      return new Response('Accepted', { status: 202 });
    } catch (error) {
      console.error(error);
      return new Response('Dispatch failed', { status: 502 });
    }
  }
};
