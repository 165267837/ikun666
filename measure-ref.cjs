/* __measure_ref2.cjs — 细化测量：每个高度上的「横向游程」。
 *
 * 只给总宽是不够的：躯干、手臂、两条腿在同一个高度上是**分开的几段**。
 * 只有拿到游程，才能分别读出「躯干多宽」「手臂外缘到哪」「两腿间距多少」。
 * 侧视图同理：一条游程的前后端点就是「肚子最前」与「后背最后」。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9352;
const PROF = path.join(__dirname, '__refprof2');
const IMG = process.argv[2];

const b64 = fs.readFileSync(IMG).toString('base64');
const dataUrl = 'data:image/jpeg;base64,' + b64;

const EXPR = `(async () => {
  const img = new Image();
  img.src = ${JSON.stringify(dataUrl)};
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const W = c.width, H = c.height;
  const d = ctx.getImageData(0, 0, W, H).data;
  const m = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const r = d[p], g = d[p+1], b = d[p+2];
    m[i] = (r + g + b) / 3 <= 238 ? 1 : 0;
  }
  const colCnt = new Int32Array(W);
  for (let x = 0; x < W; x++) { let n = 0; for (let y = 0; y < H; y++) n += m[y*W+x]; colCnt[x] = n; }
  const groups = []; let cur = null;
  for (let x = 0; x < W; x++) {
    if (colCnt[x] > 2) { if (!cur) cur = { x0: x, x1: x }; else cur.x1 = x; }
    else if (cur) { if (cur.x1 - cur.x0 > 20) groups.push(cur); cur = null; }
  }
  if (cur && cur.x1 - cur.x0 > 20) groups.push(cur);

  function runsAt(rows, y, x0, x1) {
    const out = []; let s = -1;
    for (let x = x0; x <= x1; x++) {
      const on = rows[y] && rows[y][x] === 1;
      if (on && s < 0) s = x;
      else if (!on && s >= 0) { out.push([s, x - 1]); s = -1; }
    }
    if (s >= 0) out.push([s, x1]);
    return out;
  }

  const res = [];
  for (const g of groups) {
    const rows = [];
    for (let y = 0; y < H; y++) {
      const arr = new Uint8Array(W);
      for (let x = g.x0; x <= g.x1; x++) arr[x] = m[y*W+x];
      rows.push(arr);
    }
    let y0 = 1e9, y1 = -1;
    for (let y = 0; y < H; y++) { let n = 0; for (let x = g.x0; x <= g.x1; x++) n += rows[y][x]; if (n > 1) { if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    const Hh = y1 - y0 + 1;
    const xc = (g.x0 + g.x1) / 2;
    const scan = [];
    for (let k = 0; k <= 20; k++) {
      const y = Math.round(y1 - (Hh - 1) * (k / 20));
      const rs = runsAt(rows, y, g.x0, g.x1).filter(r => r[1] - r[0] >= 0)
        .map(r => [ +((r[0] - xc) / Hh).toFixed(3), +((r[1] - xc) / Hh).toFixed(3) ]);
      scan.push({ h: +(k / 20).toFixed(2), runs: rs });
    }
    // 奶白肚皮：实测参考图里奶白 b≈158~196（rgb 236,220,196），而黄色躯体 b≤100，
    // 所以判别量是**蓝通道**而不是亮度 —— 用亮度会把整条轮廓的过渡带全吃进去。
    // 判定之后还必须取**最大连通块**：柔和的渐变会在边缘散落零星杂点，
    // 直接用 min/max 会把包围盒撑到整张图（这一步已经踩过一次）。
    const creamMask = new Uint8Array(W * H);
    let creamN = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = g.x0; x <= g.x1; x++) {
        const p = (y*W+x)*4;
        const r = d[p], gg = d[p+1], b = d[p+2];
        if (b >= 148 && b <= 224 && r >= 190 && gg >= 178 && (r - gg) < 42) { creamMask[y*W+x] = 1; creamN++; }
      }
    }
    let cb = null;
    if (creamN > 300) {
      const seen = new Uint8Array(W * H);
      const stack = [];
      let bestN = 0, bx0 = 0, bx1 = 0, by0 = 0, by1 = 0;
      for (let i = 0; i < W * H; i++) {
        if (!creamMask[i] || seen[i]) continue;
        let n = 0, a0 = 1e9, a1 = -1, c0 = 1e9, c1 = -1;
        stack.length = 0; stack.push(i); seen[i] = 1;
        while (stack.length) {
          const j = stack.pop(); n++;
          const jx = j % W, jy = (j - jx) / W;
          if (jx < a0) a0 = jx; if (jx > a1) a1 = jx; if (jy < c0) c0 = jy; if (jy > c1) c1 = jy;
          if (jx > 0 && creamMask[j-1] && !seen[j-1]) { seen[j-1] = 1; stack.push(j-1); }
          if (jx < W-1 && creamMask[j+1] && !seen[j+1]) { seen[j+1] = 1; stack.push(j+1); }
          if (jy > 0 && creamMask[j-W] && !seen[j-W]) { seen[j-W] = 1; stack.push(j-W); }
          if (jy < H-1 && creamMask[j+W] && !seen[j+W]) { seen[j+W] = 1; stack.push(j+W); }
        }
        if (n > bestN) { bestN = n; bx0 = a0; bx1 = a1; by0 = c0; by1 = c1; }
      }
      cb = {
        hw: +((bx1-bx0+1)/Hh).toFixed(3), hh: +((by1-by0+1)/Hh).toFixed(3),
        h0: +(((y1-by1)/Hh)).toFixed(3), h1: +(((y1-by0)/Hh)).toFixed(3),
        cxOff: +((((bx0+bx1)/2) - xc)/Hh).toFixed(3), px: bestN,
      };
    }
    // 深色区域（手 / 脚趾 / 眼睛）——按行粗略分簇
    const darkRows = {};
    for (let y = y0; y <= y1; y++) {
      for (let x = g.x0; x <= g.x1; x++) {
        const p = (y*W+x)*4;
        if ((d[p]+d[p+1]+d[p+2])/3 < 115) { (darkRows[y] = darkRows[y] || []).push(x); }
      }
    }
    const darkBands = [];
    let band = null;
    for (let y = y0; y <= y1; y++) {
      const hit = darkRows[y] && darkRows[y].length > 3;
      if (hit && !band) band = { y0: y, y1: y, n: darkRows[y].length };
      else if (hit && band) { band.y1 = y; band.n += darkRows[y].length; }
      else if (!hit && band) { darkBands.push(band); band = null; }
    }
    if (band) darkBands.push(band);
    res.push({
      x0: g.x0, x1: g.x1, y0, y1, H: Hh,
      scan,
      belly: cb,
      darkBands: darkBands.filter(b => b.y1 - b.y0 >= 3).map(b => ({
        h0: +(((y1 - b.y1) / Hh)).toFixed(3), h1: +(((y1 - b.y0) / Hh)).toFixed(3),
        px: b.n,
      })),
    });
  }
  return JSON.stringify(res);
})()`;

(async () => {
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) {}
  const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--mute-audio',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF, 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); targets = await r.json(); if (targets && targets.length) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej, method }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', (msg) => { const mm = JSON.parse(msg.data); if (mm.id && pending.has(mm.id)) { const p = pending.get(mm.id); pending.delete(mm.id); if (mm.error) p.rej(new Error(JSON.stringify(mm.error))); else p.res(mm.result); } });
  await send('Runtime.enable'); await send('Page.enable');
  const r = await send('Runtime.evaluate', { expression: EXPR, awaitPromise: true, returnByValue: true });
  ws.close(); child.kill();
  if (r.exceptionDetails) { console.log('异常: ' + JSON.stringify(r.exceptionDetails).slice(0,300)); process.exit(1); }
  const gs = JSON.parse(r.result.value);
  const names = ['正视图', '侧视图', '背视图'];
  gs.forEach((g, i) => {
    console.log('');
    console.log('=== ' + (names[i] || ('图' + (i+1))) + ' === 高=' + g.H + 'px  横向中心=' + ((g.x0+g.x1)/2).toFixed(1));
    console.log('  h     游程（相对总高，以图形横向中心为 0；负数=左侧）');
    for (const s of g.scan) {
      console.log('  ' + s.h.toFixed(2) + '  ' + s.runs.map(rr => '[' + rr[0].toFixed(3) + ',' + rr[1].toFixed(3) + ']').join(' '));
    }
    console.log('  深色带（相对脚底的高度区间）: ' + g.darkBands.map(b => 'h[' + b.h0 + ',' + b.h1 + ']px' + b.px).join('  '));
    console.log('  奶白肚皮: ' + (g.belly ? ('宽=' + g.belly.hw + 'H 高=' + g.belly.hh + 'H 高度区间=[' + g.belly.h0 + ',' + g.belly.h1 + '] 横向偏移=' + g.belly.cxOff) : '未检出'));
  });
  fs.writeFileSync(path.join(__dirname, '__ref_scan.json'), JSON.stringify(gs, null, 1));
  console.log('');
  console.log('已写出 __ref_scan.json');
})();
