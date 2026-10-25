// Run inside the built image with --experimental-test-module-mocks.
// Only identity/memo lookup is synthetic; routing, cache, extraction and HTTP are real.
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createReadStream, statSync } from 'node:fs';
const require = createRequire('/app/packages/server/package.json');
const express = require('express');
const { settingsStore } = await import('/app/packages/core/dist/config/index.js');
const { SettingsRepository } = await import('/app/packages/core/dist/db/repositories/settings.js');
SettingsRepository.getAll = async () => [];
SettingsRepository.getVersion = async () => 0;
await settingsStore.initialise();
let source;
mock.module('/app/packages/server/dist/routes/jellyfin/playback.js', { namedExports: {
  locate: async req => ({ ctx: { uuid: 'synthetic-viewer' }, requestedMsid: req.params.mediaSourceId }),
  ensureMemo: async () => ({ sources: [source] }),
  pickSource: (memo, id) => memo.sources.find(s => s.msid === id),
} });
mock.module('/app/packages/server/dist/routes/jellyfin/context.js', { namedExports: {
  jfOptional: handler => (req,res,next) => Promise.resolve(handler(req,res)).catch(next),
  param: (req,name) => req.params[name], qs: (req,name) => req.query[name],
} });
const { default: subtitles } = await import('/app/packages/server/dist/routes/jellyfin/subtitles.js');
const { rememberPlayedFile } = await import('/app/packages/server/dist/routes/jellyfin/played-file.js');
const app = express();
let resolverHits = 0, rangeReads = 0;
const file='/fixtures/test.mkv', size=statSync(file).size;
app.get('/file.mkv',(req,res)=> {
  rangeReads++;
  const m=/bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  const start=m ? Number(m[1]) : 0, end=m && m[2] ? Math.min(Number(m[2]),size-1) : size-1;
  res.status(m ? 206 : 200).set({ 'Content-Length': String(end-start+1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
  const stream=createReadStream(file,{start,end}); res.on('close',()=>stream.destroy()); stream.pipe(res);
});
app.get('/api/v1/debrid/playback/synthetic/a/b/c/file.mkv', (req,res)=> { resolverHits++; res.status(500).end(); });
app.use('/jellyfin', subtitles);
app.get('/test/stats', (req,res) => res.json({ resolverHits, rangeReads }));
const server=app.listen(8791,'0.0.0.0');
await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:8791';
source={ msid: 'source', url: base+'/api/v1/debrid/playback/synthetic/a/b/c/file.mkv', subtitles: [] };
const endpoint=base+'/jellyfin/Videos/item/source/SubtitlePreview?PositionMs=45000';
try {
  assert.equal((await fetch(endpoint)).status,409);
  assert.equal(resolverHits,0);
  rememberPlayedFile(source.url,base+'/file.mkv');
  const response=await fetch(endpoint);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.Tracks.length,2);
  assert.ok(result.Tracks[0].cues.some(c=>c.text==='English ahead, with commas'));
  const reads=rangeReads;
  await fetch(endpoint);
  assert.equal(rangeReads,reads,'repeat focus uses cached extraction');
  assert.equal(resolverHits,0,'preview never reopens source resolver');
  assert.equal((await fetch(endpoint.replace('45000','-1'))).status,400);
  assert.equal((await fetch(endpoint.replace('/source/','/missing/'))).status,404);
  console.log('PASS: real packaged subtitle endpoint, extraction, cache, invalid source/time, zero resolver calls');
  if (process.env.KEEP_TEST_SERVER !== '1') server.close();
} catch (e) { server.close(); throw e; }
