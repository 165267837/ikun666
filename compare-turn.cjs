/* __compare.cjs — 把参考三视图与自己的渲染并排拼成一张对比图（同高归一化）。
 *
 * 归一化到同一高度是关键：两张图原始像素尺寸不同，
 * 不缩放的话「谁大谁小」完全看不出来，眼睛会被绝对像素骗。
 * 拼图顺序：正(ref|mine) 侧(ref|mine) 背(ref|mine)。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9354;
const PROF = path.join(__dirname, '__cmpprof');
const OUT = path.join(__dirname, 'preview');

const REF = 'C:/Users/30429/Documents/xwechat_files/wxid_p994q47dthvc22_0122/temp/RWTemp/2026-10/9e20f478899dc29eb19741386f9343c8/789130d71b7d613fbbd5c2c3d397e7d9.jpg';
const MINE = { front: '97-三视图-front.png', side: '97-三视图-side.png', back: '97-三视图-back.png' };

const refB64 = 'data:image/jpeg;base64,' + fs.readFileSync(REF).toString('base64');
const mineB64 = {};
for (const k in MINE) mineB64[k] = 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, MINE[k])).toString('base64');

const COLW = 320, ROWH = 560, PAD = 10, TITLEH = 26;

const PAGE = [
  '(async () => {',
  '  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });',
  '  const refImg = await load(' + JSON.stringify(refB64) + ');',
  '  const mine = {};',
  '  const keys = ["front", "side", "back"];',
  '  const srcs = ' + JSON.stringify(mineB64) + ';',
  '  for (const k of keys) mine[k] = await load(srcs[k]);',
  '',
  '  /* 把一张图转成 canvas 以便逐像素分析 */',
  '  const toCv = (img) => { const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext("2d").drawImage(img, 0, 0); return c; };',
  '  const refCv = toCv(refImg);',
  '  const rd = refCv.getContext("2d").getImageData(0, 0, refCv.width, refCv.height).data;',
  '  const RW = refCv.width, RH = refCv.height;',
  '  const isFig = (p) => (rd[p] + rd[p+1] + rd[p+2]) / 3 <= 238;',
  '  /* 参考图切成三块（按列聚合） */',
  '  const colCnt = new Int32Array(RW);',
  '  for (let x = 0; x < RW; x++) { let n = 0; for (let y = 0; y < RH; y++) { const p = (y*RW+x)*4; if ((rd[p]+rd[p+1]+rd[p+2])/3 <= 238) n++; } colCnt[x] = n; }',
  '  const cols = []; let cur = null;',
  '  for (let x = 0; x < RW; x++) { if (colCnt[x] > 2) { if (!cur) cur = {x0:x, x1:x}; else cur.x1 = x; } else if (cur) { if (cur.x1-cur.x0 > 20) cols.push(cur); cur = null; } }',
  '  if (cur && cur.x1-cur.x0 > 20) cols.push(cur);',
  '',
  '  const refBox = cols.map((g) => {',
  '    let y0 = 1e9, y1 = -1;',
  '    for (let y = 0; y < RH; y++) { let n = 0; for (let x = g.x0; x <= g.x1; x++) { const p = (y*RW+x)*4; if ((rd[p]+rd[p+1]+rd[p+2])/3 <= 238) n++; } if (n > 1) { if (y < y0) y0 = y; if (y > y1) y1 = y; } }',
  '    return { x0: g.x0, x1: g.x1, y0: y0, y1: y1 };',
  '  });',
  '',
  '  /* 我自己的渲染图：裁到轮廓包围盒 */',
  '  const mineBox = {};',
  '  for (const k of keys) {',
  '    const cv = toCv(mine[k]);',
  '    const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;',
  '    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;',
  '    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {',
  '      const p = (y*cv.width+x)*4;',
  '      if ((d[p]+d[p+1]+d[p+2])/3 <= 238) { if (x<x0)x0=x; if (x>x1)x1=x; if (y<y0)y0=y; if (y>y1)y1=y; }',
  '    }',
  '    mineBox[k] = { cv: cv, x0: x0, x1: x1, y0: y0, y1: y1 };',
  '  }',
  '',
  '  const out = document.createElement("canvas");',
  '  out.width = COLW * 6 + PAD * 7;',
  '  out.height = ROWH + TITLEH + PAD * 2;',
  '  const g = out.getContext("2d");',
  '  g.fillStyle = "#ffffff"; g.fillRect(0, 0, out.width, out.height);',
  '',
  '  const refName = ["参考·正", "参考·侧", "参考·背"];',
  '  const myName  = ["重制·正", "重制·侧", "重制·背"];',
  '  const order = [0, 1, 2];',
  '  let cx = PAD;',
  '  for (let i = 0; i < 3; i++) {',
  '    const b = refBox[i];',
  '    const sw = b.x1 - b.x0 + 1, sh = b.y1 - b.y0 + 1;',
  '    const s = ROWH / sh;',
  '    const dw = sw * s;',
  '    g.drawImage(refCv, b.x0, b.y0, sw, sh, cx + (COLW - dw) / 2, TITLEH + PAD, dw, ROWH);',
  '    g.fillStyle = "#333"; g.font = "16px sans-serif"; g.textAlign = "center";',
  '    g.fillText(refName[i], cx + COLW / 2, 18);',
  '    g.strokeStyle = "#ddd"; g.strokeRect(cx, TITLEH + PAD, COLW, ROWH);',
  '    cx += COLW + PAD;',
  '',
  '    const m = mineBox[keys[i]];',
  '    const msw = m.x1 - m.x0 + 1, msh = m.y1 - m.y0 + 1;',
  '    const ms = ROWH / msh;',
  '    const mdw = msw * ms;',
  '    g.drawImage(m.cv, m.x0, m.y0, msw, msh, cx + (COLW - mdw) / 2, TITLEH + PAD, mdw, ROWH);',
  '    g.fillStyle = "#333"; g.fillText(myName[i], cx + COLW / 2, 18);',
  '    g.strokeStyle = "#ddd"; g.strokeRect(cx, TITLEH + PAD, COLW, ROWH);',
  '    cx += COLW + PAD;',
  '  }',
  '  /* 参考图的图形数量不是 3 就说明切分失败 */',
  '  return JSON.stringify({ n: refBox.length, png: out.toDataURL("image/png") });',
  '})()',
].join('\n')
  // 这几个是 Node 侧的常量，页面里必须变成字面量 —— 直接引用会 ReferenceError
  .replace(/\bCOLW\b/g, String(COLW))
  .replace(/\bROWH\b/g, String(ROWH))
  .replace(/\bTITLEH\b/g, String(TITLEH))
  .replace(/\bPAD\b/g, String(PAD));

(async () => {
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) {}
  const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--mute-audio','--hide-scrollbars',
    '--remote-debugging-port=' + PORT,'--user-data-dir=' + PROF,'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); targets = await r.json(); if (targets && targets.length) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }
  if (!targets) { console.log('无法连接调试端口'); child.kill(); process.exit(1); }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej, method }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', (msg) => { const mm = JSON.parse(msg.data); if (mm.id && pending.has(mm.id)) { const q = pending.get(mm.id); pending.delete(mm.id); if (mm.error) q.rej(new Error(JSON.stringify(mm.error))); else q.res(mm.result); } });
  await send('Runtime.enable'); await send('Page.enable');
  const r = await send('Runtime.evaluate', { expression: PAGE, awaitPromise: true, returnByValue: true });
  ws.close(); child.kill();
  if (r.exceptionDetails) { console.log('异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 400)); process.exit(1); }
  const o = JSON.parse(r.result.value);
  console.log('参考图切出 ' + o.n + ' 个图形');
  const b = Buffer.from(o.png.split(',')[1], 'base64');
  const f = path.join(OUT, '98-三视图对比.png');
  fs.writeFileSync(f, b);
  console.log('→ ' + f + ' (' + b.length + 'B)');
})();
