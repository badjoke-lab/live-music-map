import assert from 'node:assert/strict';
import worker from '../websub/worker.mjs';

const channelId = 'UCmfF7JZv26UUKyRedViGIlw';
const env = {
  PROTOTYPE_CHANNEL_IDS: channelId,
  CALLBACK_PATH: '/youtube',
  DRY_RUN: '1'
};

const topic = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
const verifyUrl = new URL('https://example.workers.dev/youtube');
verifyUrl.searchParams.set('hub.mode', 'subscribe');
verifyUrl.searchParams.set('hub.topic', topic);
verifyUrl.searchParams.set('hub.challenge', 'challenge-123');
let response = await worker.fetch(new Request(verifyUrl), env);
assert.equal(response.status, 200);
assert.equal(await response.text(), 'challenge-123');

const badVerifyUrl = new URL(verifyUrl);
badVerifyUrl.searchParams.set('hub.topic', 'https://www.youtube.com/feeds/videos.xml?channel_id=UC0000000000000000000000');
response = await worker.fetch(new Request(badVerifyUrl), env);
assert.equal(response.status, 404);

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>abcdefghijk</yt:videoId>
    <yt:channelId>${channelId}</yt:channelId>
    <title>Prototype notification</title>
  </entry>
</feed>`;
response = await worker.fetch(new Request('https://example.workers.dev/youtube', {
  method: 'POST',
  headers: { 'content-type': 'application/atom+xml' },
  body: xml
}), env);
assert.equal(response.status, 202);

const wrongChannelXml = xml.replace(channelId, 'UC3I2GFN_F8WudD_2jUZbojA');
response = await worker.fetch(new Request('https://example.workers.dev/youtube', {
  method: 'POST',
  headers: { 'content-type': 'application/atom+xml' },
  body: wrongChannelXml
}), env);
assert.equal(response.status, 403);

response = await worker.fetch(new Request('https://example.workers.dev/not-the-callback'), env);
assert.equal(response.status, 404);

console.log('WebSub Worker prototype tests passed.');
