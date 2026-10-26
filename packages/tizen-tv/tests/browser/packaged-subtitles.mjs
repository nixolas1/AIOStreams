import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../tools/devserver.mjs';
import { findPlaywright, findChromium } from './runtime.mjs';
const pkgRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const server=createServer({ appDir: path.join(pkgRoot,'build/app') });
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const pw=findPlaywright(), exe=findChromium();
assert.ok(pw && exe,'Playwright and Chromium are required; do not silently skip');
const browser=await pw.chromium.launch({ executablePath:exe });
try {
 const page=await browser.newPage({ viewport:{width:1920,height:1080} });
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(base=>{
   localStorage.setItem('atv.session',JSON.stringify({base,token:'synthetic',userId:'mock-user',userName:'Demo'}));
   localStorage.setItem('atv.player.subLang',JSON.stringify('en'));
   window.testCalls=[]; window.testTime=45000;
   let state='NONE', selected=null, silent=true;
   window.webapis={avplay:{
     open(){state='IDLE';},close(){state='NONE';},stop(){state='IDLE';},
     setListener(listener){window.testListener=listener;},setDisplayRect(){},setDisplayMethod(){},
     prepareAsync(done){state='READY';done();},play(){state='PLAYING';},pause(){state='PAUSED';},
     getState(){return state;},getDuration(){return 180000;},getCurrentTime(){return window.testTime;},
     seekTo(ms,done){window.testTime=ms;done();},
     getTotalTrackInfo(){if(state!=='PLAYING')throw Error('tracks before PLAYING');return [0,1].map(index=>({index,type:'TEXT',extra_info:JSON.stringify({track_lang:index?'nor':'eng'})}));},
     getCurrentStreamInfo(){return selected===null?[]:[{type:'TEXT',index:selected}];},
     setSelectTrack(type,id){if(state!=='PLAYING'&&state!=='PAUSED')throw Error('selection before PLAYING');selected=id;window.testCalls.push([type,id]);},
     setSilentSubtitle(value){silent=value;},
   }};
   window.emitDialogue=()=>{if(selected!==null&&!silent)window.testListener.onsubtitlechange(60000,selected===0?'English playback dialogue':'Norsk avspilling');};
 },origin+'/mock/jellyfin');
 await page.route('**/PlaybackInfo*',route=>route.fulfill({json:{PlaySessionId:'synthetic',MediaSources:[{Id:'source',Name:'Synthetic multilingual fixture',Type:'Default',Path:'https://example.test/test.mkv',Protocol:'Http',Container:'mkv',SupportsDirectPlay:true,MediaStreams:[]}]}}));
 let previewRequests=0;
 await page.route('**/SubtitlePreview?*',async route=>{
   previewRequests++;
   await route.abort();
 });
 await page.goto(origin);
 console.log('packaged: boot');
 await page.waitForFunction(()=>window.__booted);
 await page.waitForSelector('.hero-title', { state: 'attached' });
 await page.waitForFunction(()=>document.querySelector('.hero-title').textContent.length>0);
 console.log('packaged: open detail');
 await page.keyboard.press('Enter');
 await page.waitForSelector('.screen.detail');
 await page.keyboard.press('Enter');
 console.log('packaged: start player');
 await page.waitForSelector('.av-object');
 console.log('packaged: wait for automatic subtitle');
 await page.waitForFunction(()=>window.testCalls.length===1);
 assert.deepEqual(await page.evaluate(()=>window.testCalls),[['TEXT',0]]);
 await page.evaluate(()=>window.emitDialogue());
 assert.equal(await page.locator('.subs').last().textContent(),'English playback dialogue');
 assert.equal(previewRequests,0,'no automatic media read on playback startup');
 await page.keyboard.press('ArrowDown');
 await page.waitForSelector('.tracks:not(.hidden)');
 assert.equal(await page.locator('.tracks-description').filter({hasText:'In this video'}).count(),2);
 assert.equal(await page.locator('.tracks-label').filter({hasText:'1. English'}).count(),1);
 assert.equal(await page.locator('.tracks-label').filter({hasText:'2. Norwegian'}).count(),1);
 await page.keyboard.press('ArrowDown');
 assert.deepEqual(await page.evaluate(()=>window.testCalls),[['TEXT',0]],'focus does not select');
 assert.equal(await page.locator('.subs').last().textContent(),'English playback dialogue');
 await page.screenshot({path:process.env.TV_PACKAGED_SCREENSHOT||'/tmp/tv-packaged-subtitles.png'});
 await page.keyboard.press('Enter');
 await page.evaluate(()=>window.emitDialogue());
 assert.equal(await page.locator('.subs').last().textContent(),'Norsk avspilling');
 assert.equal(previewRequests,0,'picker must never scan the video for previews');
 assert.deepEqual(errors,[]);
 await page.screenshot({path:'/tmp/tv-packaged-subtitle-playback.png'});
 console.log('PASS: production bundle, automatic English rendering, track descriptions without preview requests, focus isolation, manual subtitle switch');
} finally { await browser.close(); server.close(); }
