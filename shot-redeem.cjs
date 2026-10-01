/* shot-redeem.cjs — 抓「设置 → 兑换码」面板的兑换前 / 兑换后两帧。
   复用 check-e2e 的 CDP 脚手架（Edge 无头 + Emulation 固定视口）。
   用法: node shot-redeem.cjs [url] */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9336;
const URL_ = process.argv[2] || 'http://127.0.0.1:5188/';
const PROF = path.join(__dirname, '__shotprof2');
const VP = { w: 390, h: 844, dpr: 2 };

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
    } catch (e) { /* 上下文重建中 */ }
    await sleep(400);
  }
  return false;
}

const SETUP = '(async function(){'
  + 'var g=window.__nailongGame; if(!g) return "NO_GAME";'
  + 'g._toMenu();'
  + 'g.save.data.codes={}; g.save.data.totalCoins=250; g.save.save(); g.ui.updateMenu(g.save);'
  + 'g._openTab("settings");'
  + 'await new Promise(function(r){setTimeout(r,400);});'
  + 'var i=document.getElementById("redeem-input");'
  + 'if(i) i.scrollIntoView({block:"center"});'
  + 'await new Promise(function(r){setTimeout(r,300);});'
  + 'return g.state+"|"+g.save.data.totalCoins;'
  + '})()';

const MEASURE = '(function(){'
  + 'var g=window.__nailongGame;'
  + 'var i=document.getElementById("redeem-input"), b=document.getElementById("redeem-btn");'
  + 'var mb=document.getElementById("modal-body");'
  + 'var panel=document.querySelector("#modal .modal-panel");'
  + 'if(!i||!b) return "NO_REDEEM_UI";'
  + 'function R(e){var r=e.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),bot:Math.round(r.bottom)};}'
  + 'return JSON.stringify({'
  + 'coins:g.save.data.totalCoins,'
  + 'codes:Object.keys(g.save.data.codes||{}).length,'
  + 'input:R(i),btn:R(b),panel:R(panel),'
  + 'inputVal:i.value,inputW:i.offsetWidth,btnW:b.offsetWidth,btnH:b.offsetHeight,'
  + 'bodyScroll:Math.round(mb.scrollTop),bodyScrollH:mb.scrollHeight,bodyH:Math.round(mb.getBoundingClientRect().height),'
  + 'toast:g.ui.el.toast.textContent,toastHidden:g.ui.el.toast.classList.contains("hidden"),'
  + 'hintShown:mb.textContent.indexOf("已兑换")>=0,'
  + 'menuCoins:g.ui.el.menuCoins.textContent,'
  + 'win:{w:window.innerWidth,h:window.innerHeight}'
  + '});})()';

const DO = '(async function(){'
  + 'var i=document.getElementById("redeem-input");'
  + 'if(!i) return "NO_INPUT";'
  + 'i.focus(); i.value="  17班NB666  ";'
  + 'i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));'
  + 'await new Promise(function(r){setTimeout(r,520);});'
  + 'var j=document.getElementById("redeem-input"); if(j) j.scrollIntoView({block:"center"});'
  + 'await new Promise(function(r){setTimeout(r,260);});'
  + 'return "ok";'
  + '})()';

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
  if (!targets) { console.log('无法连接调试端口'); child.kill(); process.exit(1); }
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
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',
    { width: VP.w, height: VP.h, deviceScaleFactor: VP.dpr, mobile: true });
  await send('Page.navigate', { url: URL_ });
  if (!(await waitBoot(send, 40))) { console.log('启动超时'); child.kill(); process.exit(1); }

  const st = await send('Runtime.evaluate', { expression: SETUP, returnByValue: true, awaitPromise: true });
  console.log('铺底: ' + (st.result ? st.result.value : '?'));

  const shotA = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  const fa = path.join(__dirname, '__redeem_before.jpg');
  fs.writeFileSync(fa, Buffer.from(shotA.data, 'base64'));
  const mA = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
  console.log('兑换前: ' + (mA.result ? mA.result.value : JSON.stringify(mA)));
  console.log('  图 → ' + fa + '  ' + fs.statSync(fa).size + ' B');

  const dr = await send('Runtime.evaluate', { expression: DO, returnByValue: true, awaitPromise: true });
  console.log('兑换动作: ' + (dr.result ? dr.result.value : '?'));

  const shotB = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  const fb = path.join(__dirname, '__redeem_after.jpg');
  fs.writeFileSync(fb, Buffer.from(shotB.data, 'base64'));
  const mB = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
  console.log('兑换后: ' + (mB.result ? mB.result.value : JSON.stringify(mB)));
  console.log('  图 → ' + fb + '  ' + fs.statSync(fb).size + ' B');

  console.log(logs.length ? ('页面异常: ' + logs.join(' | ')) : '页面无异常');
  try { ws.close(); } catch (e) {}
  child.kill();
  await sleep(400);
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})();
