/* shot-gameover.cjs — 专门抓「死亡结算」界面的截图。
   shots.cjs 在第 276 行会主动隐藏 #gameover，所以不能复用，单独写一个。
   用法: node shot-gameover.cjs [url] */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335;
const URL_ = process.argv[2] || 'http://127.0.0.1:5188/';
const PROF = path.join(__dirname, '__shotprof');

const VIEWPORTS = [
  { name: '390x844', w: 390, h: 844, dpr: 2 },
  { name: '360x640', w: 360, h: 640, dpr: 2 },
];

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function jsonList() {
  const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
  return r.json();
}
async function waitBoot(send, tries) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await send('Runtime.evaluate', {
        expression: '!!(window.__nailongGame && window.__nailongGame.ui)', returnByValue: true });
      if (r && r.result && r.result.value === true) return true;
    } catch (e) { /* 执行上下文重建中 */ }
    await sleep(400);
  }
  return false;
}

/* 把游戏推进到「死亡结算」状态 */
const DRIVE_START = '(function(){var g=window.__nailongGame;if(!g)return "NO_GAME";'
  + 'if(g.state!=="playing")g.startGame();return g.state;})()';
const DRIVE_DIE = '(function(){var g=window.__nailongGame;if(!g)return "NO_GAME";'
  + 'g._die();return g.state;})()';

/* 读取结算界面 + 视频元素的实测几何与播放状态 */
const MEASURE = '(function(){'
  + 'var v=document.getElementById("go-video");if(!v)return "NO_VIDEO";'
  + 'var go=document.getElementById("gameover");'
  + 'var r=v.getBoundingClientRect();var gr=go?go.getBoundingClientRect():{left:0,top:0,width:0,height:0};'
  + 'var card=v.parentNode;var cr=card?card.getBoundingClientRect():{top:0,height:0};'
  + 'return JSON.stringify({'
  + 'goState:(window.__nailongGame?window.__nailongGame.state:"?"),'
  + 'goClass:(go?go.className:"MISSING"),'
  + 'v:{x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)},'
  + 'vRatio:+(r.width/r.height).toFixed(3),'
  + 'vPaused:v.paused,vTime:+v.currentTime.toFixed(2),vReady:v.readyState,'
  + 'vIntrinsic:v.videoWidth+"x"+v.videoHeight,vMuted:v.muted,vLoop:v.loop,'
  + 'go:{x:Math.round(gr.left),y:Math.round(gr.top),w:Math.round(gr.width),h:Math.round(gr.height)},'
  + 'cardTop:Math.round(cr.top),cardH:Math.round(cr.height),'
  + 'win:{w:window.innerWidth,h:window.innerHeight},'
  + 'docH:document.documentElement.scrollHeight,'
  + 'bodyH:document.body.scrollHeight'
  + '});})()';

(async () => {
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) {}
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--disable-dev-shm-usage', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-port=' + String(PORT), '--user-data-dir=' + PROF, 'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await jsonList(); if (targets && targets.length) break; } catch (e) {}
    await sleep(250);
  }
  if (!targets) { console.log('❌ 无法连接调试端口'); child.kill(); process.exit(1); }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  await new Promise(r => ws.addEventListener('open', r));
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.rej(new Error(JSON.stringify(msg.error))); else p.res(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text;
      logs.push('EXCEPTION: ' + String(desc).split('\n')[0]);
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      logs.push('LOG: ' + msg.params.entry.text.slice(0, 200));
    }
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  const shots = [];
  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: true,
    });
    await send('Page.navigate', { url: URL_ });
    const booted = await waitBoot(send, 40);
    if (!booted) { console.log('❌ ' + vp.name + ' 启动超时'); continue; }

    // 起跑 -> 死
    const s1 = await send('Runtime.evaluate', { expression: DRIVE_START, returnByValue: true });
    await sleep(700);
    const s2 = await send('Runtime.evaluate', { expression: DRIVE_DIE, returnByValue: true });
    await sleep(1500); // 等结算面板弹出动画 + 视频出画面

    const m1 = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
    const t1 = await send('Runtime.evaluate', {
      expression: 'document.getElementById("go-video")?+document.getElementById("go-video").currentTime.toFixed(2):-1',
      returnByValue: true });
    await sleep(700);
    const t2 = await send('Runtime.evaluate', {
      expression: 'document.getElementById("go-video")?+document.getElementById("go-video").currentTime.toFixed(2):-1',
      returnByValue: true });

    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 84 });
    const file = path.join(__dirname, '__go_' + vp.name + '.jpg');
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    shots.push({ vp: vp.name, file, bytes: fs.statSync(file).size });

    console.log('--- ' + vp.name + ' ---');
    console.log('  start=' + (s1.result ? s1.result.value : '?') + '  die=' + (s2.result ? s2.result.value : '?'));
    console.log('  ' + (m1.result ? m1.result.value : JSON.stringify(m1)));
    console.log('  currentTime: ' + (t1.result ? t1.result.value : '?') + ' -> ' + (t2.result ? t2.result.value : '?')
      + '  (两次数值不同 = 视频真的在播)');
    console.log('  截图: ' + file + '  ' + fs.statSync(file).size + ' B');
  }

  if (logs.length) { console.log('--- 页面异常/错误 ---'); logs.forEach(l => console.log('  ' + l)); }
  else console.log('页面无异常、无 error 级日志');

  try { ws.close(); } catch (e) {}
  child.kill();
  await sleep(400);
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})();
