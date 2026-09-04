import fs from 'node:fs/promises';

const API_KEY = process.env.YOUTUBE_API_KEY?.trim();
if (!API_KEY) throw new Error('YOUTUBE_API_KEY is required to enforce stream channel identity');

const sourcesPath = new URL('../data/sources.json', import.meta.url);
const streamsPath = new URL('../data/streams.json', import.meta.url);
const sources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
const streams = JSON.parse(await fs.readFile(streamsPath, 'utf8'));
const sourceById = new Map(sources.map((source) => [source.id, source]));

function chunks(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

async function api(path, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries({ ...params, key: API_KEY })) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${body?.error?.message || `${response.status} ${response.statusText}`}`);
  return body;
}

const youtubeRecords = streams.filter((record) =>
  record.origin === 'youtube_api'
  && /^[A-Za-z0-9_-]{11}$/.test(record.youtube_video_id || '')
);
const recordIdsByVideoId = new Map();
for (const record of youtubeRecords) {
  if (!recordIdsByVideoId.has(record.youtube_video_id)) recordIdsByVideoId.set(record.youtube_video_id, []);
  recordIdsByVideoId.get(record.youtube_video_id).push(record.id);
}

const invalidRecordIds = new Set();
let videoQueries = 0;
let protectedBatches = 0;
let checkedRecords = 0;

for (const ids of chunks([...recordIdsByVideoId.keys()], 50)) {
  let details;
  try {
    details = await api('videos', { part: 'snippet', id: ids.join(',') });
    videoQueries += 1;
  } catch (error) {
    protectedBatches += 1;
    console.error(`[stream-channel-identity] video batch failed closed to preservation: ${error.message}`);
    continue;
  }

  const returned = new Map((details.items || []).map((video) => [video.id, video]));
  for (const videoId of ids) {
    const video = returned.get(videoId);
    if (!video) continue;
    for (const recordId of recordIdsByVideoId.get(videoId) || []) {
      const record = streams.find((candidate) => candidate.id === recordId);
      if (!record) continue;
      const source = sourceById.get(record.source_id);
      if (!source?.youtube_channel_id) continue;
      checkedRecords += 1;
      if (video.snippet?.channelId !== source.youtube_channel_id) {
        invalidRecordIds.add(record.id);
        console.error(`[stream-channel-identity] removed ${record.id}: source=${source.id} expects ${source.youtube_channel_id}, video belongs to ${video.snippet?.channelId || 'unknown'}.`);
      }
    }
  }
}

if (invalidRecordIds.size) {
  const next = streams.filter((record) => !invalidRecordIds.has(record.id));
  await fs.writeFile(streamsPath, `${JSON.stringify(next, null, 2)}\n`);
}

console.log(`Stream channel identity: ${checkedRecords} records checked in ${videoQueries} videos.list batches, ${invalidRecordIds.size} mismatches removed, ${protectedBatches} failed batches preserved.`);
