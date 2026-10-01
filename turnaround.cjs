/* __turnaround.cjs — 把角色单独渲染成正/侧/背三视图，用与参考图同口径的像素扫描测量。
 *
 * 为什么必须这样做：目视比对只能发现「明显不像」，
 * 而比例问题（眼睛偏高 5%、身体略窄、手臂藏进躯干）肉眼很难判定。
 * 把参考图和自己的模型放进**同一套测量代码**里，差异就变成可读的数字。
 *
 * 关键手法：
 *   1. THREE 在 main.js 里是模块作用域、没有挂到 window，但动态 import() 会命中
 *      同一个模块实例，所以能拿到完全相同的 THREE。
 *   2. 量之前必须把角色「摆成静止姿势」：跑步动画会甩手臂抬腿，
 *      在动画中间帧上量出来的宽度毫无意义。
 *   3. 量之前必须把场景里除角色以外的 mesh 全部隐藏，否则背景/赛道会污染轮廓。
 *   4. 不用 canvas.toDataURL（WebGL 没开 preserveDrawingBuffer 时读不到像素），
 *      改成渲染到 WebGLRenderTarget 再 readRenderTargetPixels —— 这条路径稳定。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9353;
const URL_ = 'http://127.0.0.1:5188/';
const PROF = path.join(__dirname, '__turnprof');
const OUT = path.join(__dirname, 'preview');

const W = 480, H = 720;

const PAGE = [
  '(async () => {',
  '  const THREE = await import("/libs/three.module.js");',
  '  const g = window.__nailongGame;',
  '  if (!g || !g.player || !g.scene || !g.renderer) return JSON.stringify({ err: "no game" });',
  '  const p = g.player, scene = g.scene, renderer = g.renderer;',
  '',
  '  /* ---- 1. 摆成静止姿势 ---- */',
  '  /* 只把**动画分量**（rotation.x，奔跑时甩手抬腿的那个）归零。',
  '     绝不能 rotation.set(0,0,0)：四肢的 rotation.z 是「向外八」这个**静止外形**的一部分，',
  '     一起清零会把手臂掰回贴着躯干，量出来的轮廓就完全不是实际外形（这一步踩过）。 */',
  '  const rig = p.rig, parts = p.parts;',
  '  const poseSaved = [];',
  '  for (const nm of ["armL","armR","legL","legR"]) {',
  '    if (p[nm] && p[nm].rotation) { poseSaved.push([p[nm], p[nm].rotation.x, "x"]); p[nm].rotation.x = 0; }',
  '  }',
  '  if (p.tail && p.tail.rotation) { poseSaved.push([p.tail, p.tail.rotation.clone(), "euler"]); p.tail.rotation.set(0,0,0); }',
  '  poseSaved.push([rig, rig.rotation.clone(), rig.position.clone(), rig.scale.clone()]);',
  '  rig.rotation.set(0,0,0); rig.position.set(0,0,0); rig.scale.set(1,1,1);',
  '  const partsRot = parts.rotation.y, partsScale = parts.scale.x;',
  '  parts.rotation.y = Math.PI;   /* 保持面朝 -z，与游戏里一致 */',
  '',
  '  /* ---- 2. 只留角色 ---- */',
  '  const hidden = [];',
  '  const isInPlayer = (o) => { let n = o; while (n) { if (n === p.group) return true; n = n.parent; } return false; };',
  '  /* 灯也一起藏：游戏里的主光在角色侧后方，正面是背光面，测出来一片暗；',
  '     这里换成一套中性三点光，才能和参考图的摄影棚光做同条件目视比对。 */',
  '  scene.traverse((o) => {',
  '    if ((o.isMesh || o.isSprite || o.isPoints || o.isLine || o.isLight) && !isInPlayer(o)) { hidden.push([o, o.visible]); o.visible = false; }',
  '  });',
  '  const oldBg = scene.background, oldFog = scene.fog;',
  '  scene.background = new THREE.Color(0xffffff);',
  '  scene.fog = null;',
  '  const keyLight = new THREE.DirectionalLight(0xffffff, 1.7);',
  '  const fillLight = new THREE.DirectionalLight(0xffffff, 0.7);',
  '  const ambLight = new THREE.AmbientLight(0xffffff, 1.0);',
  '  scene.add(keyLight); scene.add(keyLight.target); scene.add(fillLight); scene.add(ambLight);',
  '',
  '  /* ---- 3. 包围盒定相机取景 ---- */',
  '  p.group.updateMatrixWorld(true);',
  '  const bb = new THREE.Box3().setFromObject(parts);',
  '  const ctr = bb.getCenter(new THREE.Vector3());',
  '  const size = bb.getSize(new THREE.Vector3());',
  '  const ASP = ' + W + ' / ' + H + ';',
  '  let halfH = size.y * 0.58;',
  '  let halfW = halfH * ASP;',
  '  if (halfW < size.x * 0.55) { halfW = size.x * 0.55; halfH = halfW / ASP; }',
  '  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.05, 60);',
  '',
  '  const rt = new THREE.WebGLRenderTarget(' + W + ', ' + H + ');',
  '  /* 关键：渲染到 RenderTarget 时输出色彩空间由 RT 自己决定，默认是 Linear。',
  '     不设成 sRGB 的话写进缓冲的是线性值，看起来一片黑 —— 那是测量工具的缺陷，不是模型的问题。 */',
  '  rt.texture.colorSpace = THREE.SRGBColorSpace;',
  '  const buf = new Uint8Array(' + W + ' * ' + H + ' * 4);',
  '  const views = {};',
  '',
  '  const shoot = (name, dx, dz) => {',
  '    const d = 20;',
  '    cam.position.set(ctr.x + dx * d, ctr.y, ctr.z + dz * d);',
  '    cam.up.set(0, 1, 0);',
  '    cam.lookAt(ctr.x, ctr.y, ctr.z);',
  '    cam.updateMatrixWorld(true);',
  '    /* 主光跟着相机走：无论看哪一面，被看的那一面都是受光面 */',
  '    keyLight.position.set(cam.position.x, cam.position.y + 6, cam.position.z);',
  '    keyLight.target.position.copy(ctr); keyLight.target.updateMatrixWorld(true);',
  '    fillLight.position.set(ctr.x + dx * d * 0.5 + 6, ctr.y, ctr.z + dz * d * 0.5 + 6);',
  '    fillLight.target.position.copy(ctr); fillLight.target.updateMatrixWorld(true);',
  '    renderer.setRenderTarget(rt);',
  '    renderer.render(scene, cam);',
  '    renderer.readRenderTargetPixels(rt, 0, 0, ' + W + ', ' + H + ', buf);',
  '    renderer.setRenderTarget(null);',
  '    const copy = new Uint8Array(buf.length); copy.set(buf);',
  '    views[name] = copy;',
  '  };',
  '  shoot("front", 0, -1);',
  '  shoot("side", 1, 0);',
  '  shoot("back", 0, 1);',
  '',
  '  /* ---- 4. 还原场景 ---- */',
  '  scene.remove(keyLight); scene.remove(keyLight.target); scene.remove(fillLight); scene.remove(ambLight);',
  '  for (const [o, v] of hidden) o.visible = v;',
  '  scene.background = oldBg; scene.fog = oldFog;',
  '  for (const s of poseSaved) {',
  '    const o = s[0];',
  '    if (s.length === 4) { o.rotation.copy(s[1]); o.position.copy(s[2]); o.scale.copy(s[3]); }',
  '    else if (s[2] === "euler") { o.rotation.copy(s[1]); }',
  '    else { o.rotation.x = s[1]; }',
  '  }',
  '  parts.rotation.y = partsRot; parts.scale.setScalar(partsScale);',
  '  p.group.updateMatrixWorld(true);',
  '  rt.dispose();',
  '',
  '  /* ---- 5. 同口径扫描（与 __measure_ref2.cjs 完全相同的算法）---- */',
  '  const analyse = (px) => {',
  '    const m = new Uint8Array(' + W + ' * ' + H + ');',
  '    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;',
  '    for (let py = 0; py < ' + H + '; py++) {',
  '      const sy = ' + H + ' - 1 - py;   /* readPixels 自下而上，翻成图像坐标 */',
  '      for (let x = 0; x < ' + W + '; x++) {',
  '        const q = (sy * ' + W + ' + x) * 4;',
  '        const lum = (px[q] + px[q+1] + px[q+2]) / 3;',
  '        const on = lum <= 238 ? 1 : 0;',
  '        m[py * ' + W + ' + x] = on;',
  '        if (on) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (py < minY) minY = py; if (py > maxY) maxY = py; }',
  '      }',
  '    }',
  '    const Hh = maxY - minY + 1;',
  '    const xc = (minX + maxX) / 2;',
  '    const scan = [];',
  '    for (let k = 0; k <= 20; k++) {',
  '      const y = Math.round(maxY - (Hh - 1) * (k / 20));',
  '      const runs = []; let s = -1;',
  '      for (let x = 0; x < ' + W + '; x++) {',
  '        const on = m[y * ' + W + ' + x] === 1;',
  '        if (on && s < 0) s = x; else if (!on && s >= 0) { runs.push([+((s - xc) / Hh).toFixed(3), +((x - 1 - xc) / Hh).toFixed(3)]); s = -1; }',
  '      }',
  '      if (s >= 0) runs.push([+((s - xc) / Hh).toFixed(3), +(((' + W + ' - 1) - xc) / Hh).toFixed(3)]);',
  '      scan.push({ h: +(k / 20).toFixed(2), runs: runs });',
  '    }',
  '    /* 奶白肚皮区域：与参考图完全相同的判据，才能逐项对齐 */',
  '    /* 只在「该行躯干足够宽」的位置认斑块：肚皮长在宽躯干上，',
  '       眼睛高光附近那些窄行上的过渡色不该算进来（不加这条，高度区间会一路报到头上去）。 */',
  '    const rowW = new Float64Array(' + H + ');',
  '    for (let py = minY; py <= maxY; py++) {',
  '      let lo = 1e9, hi = -1;',
  '      for (let x = minX; x <= maxX; x++) if (m[py*' + W + '+x]) { if (x<lo)lo=x; if (x>hi)hi=x; }',
  '      rowW[py] = hi >= lo ? (hi - lo + 1) / Hh : 0;',
  '    }',
  '    const creamMask = new Uint8Array(' + W + ' * ' + H + ');',
  '    for (let py = minY; py <= maxY; py++) {',
  '      if (rowW[py] < 0.30) continue;',
  '      for (let x = minX; x <= maxX; x++) {',
  '        const sy = ' + H + ' - 1 - py;',
  '        const q = (sy * ' + W + ' + x) * 4;',
  '        const r = px[q], gg = px[q+1], b = px[q+2];',
  '        if (b >= 148 && b <= 224 && r >= 190 && gg >= 178 && (r - gg) < 42) creamMask[py*' + W + '+x] = 1;',
  '      }',
  '    }',
  '    /* 腐蚀一次：抗锯齿过渡带会沿着轮廓和眼球高光留下细线状的「奶白」像素，',
  '       不腐蚀的话它们会把最大连通块一路连到头上，高度区间直接报成 [0.45,0.94]。 */',
  '    const ero = new Uint8Array(' + W + ' * ' + H + ');',
  '    for (let y = 1; y < ' + H + ' - 1; y++) for (let x = 1; x < ' + W + ' - 1; x++) {',
  '      if (!creamMask[y*' + W + '+x]) continue;',
  '      const nb = (creamMask[y*' + W + '+x-1] ? 1:0) + (creamMask[y*' + W + '+x+1] ? 1:0) +',
  '                 (creamMask[(y-1)*' + W + '+x] ? 1:0) + (creamMask[(y+1)*' + W + '+x] ? 1:0);',
  '      if (nb >= 3) ero[y*' + W + '+x] = 1;',
  '    }',
  '    let bx0 = 1e9, bx1 = -1, by0 = 1e9, by1 = -1, bn = 0;',
  '    for (let py = minY; py <= maxY; py++) for (let x = minX; x <= maxX; x++) {',
  '      if (ero[py*' + W + '+x]) { bn++; if (x<bx0)bx0=x; if (x>bx1)bx1=x; if (py<by0)by0=py; if (py>by1)by1=py; }',
  '    }',
  '    /* 绿虹膜的水平位置：用来确认侧视图的**朝向**是否和参考图一致。',
  '       参考图侧视里虹膜偏 +0.08（面部在画面右侧）；如果这边算出负数，说明视图是镜像的，',
  '       那前/后厚度的标定就整体反了。 */',
  '    let gx0 = 1e9, gx1 = -1, gn = 0;',
  '    for (let py = minY; py <= minY + Hh * 0.22; py++) for (let x = minX; x <= maxX; x++) {',
  '      const sy = ' + H + ' - 1 - py;',
  '      const q = (sy * ' + W + ' + x) * 4;',
  '      const r = px[q], gg = px[q+1], b = px[q+2];',
  '      if (gg > 110 && gg > r * 1.5 && gg > b * 1.5) { gn++; if (x < gx0) gx0 = x; if (x > gx1) gx1 = x; }',
  '    }',
  '    const irisCx = gn > 20 ? +((((gx0+gx1)/2) - xc) / Hh).toFixed(3) : null;',
  '    const belly = bn > 300 ? { hw: +((bx1-bx0+1)/Hh).toFixed(3), hh: +((by1-by0+1)/Hh).toFixed(3), h0: +(((maxY-by1)/Hh)).toFixed(3), h1: +(((maxY-by0)/Hh)).toFixed(3), px: bn } : null;',
  '    return { Hpx: Hh, px0: minX, px1: maxX, py0: minY, py1: maxY, scan: scan, belly: belly, irisCx: irisCx };',
  '  };',
  '',
  '  const res = { bbox: { x: +size.x.toFixed(4), y: +size.y.toFixed(4), z: +size.z.toFixed(4) }, views: {} };',
  '  const pngs = {};',
  '  for (const k of ["front", "side", "back"]) {',
  '    const px = views[k];',
  '    res.views[k] = analyse(px);',
  '    /* 顺手导出一张 PNG 供目视：放进 2D canvas（避开 WebGL 读回限制）*/',
  '    const cv = document.createElement("canvas"); cv.width = ' + W + '; cv.height = ' + H + ';',
  '    const ctx = cv.getContext("2d");',
  '    const img = ctx.createImageData(' + W + ', ' + H + ');',
  '    for (let py = 0; py < ' + H + '; py++) {',
  '      const sy = ' + H + ' - 1 - py;',
  '      for (let x = 0; x < ' + W + '; x++) {',
  '        const q = (sy * ' + W + ' + x) * 4, t = (py * ' + W + ' + x) * 4;',
  '        img.data[t] = px[q]; img.data[t+1] = px[q+1]; img.data[t+2] = px[q+2]; img.data[t+3] = 255;',
  '      }',
  '    }',
  '    ctx.putImageData(img, 0, 0);',
  '    pngs[k] = cv.toDataURL("image/png");',
  '  }',
  '  res.pngs = pngs;',
  '  return JSON.stringify(res);',
  '})()',
].join('\n');

(async () => {
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) {}
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const child = spawn(EDGE, ['--headless=new','--disable-gpu','--enable-unsafe-swiftshader','--no-sandbox',
    '--disable-dev-shm-usage','--mute-audio','--hide-scrollbars','--force-device-scale-factor=1',
    '--window-size=900,900','--remote-debugging-port=' + PORT,'--user-data-dir=' + PROF,'about:blank'], { stdio: 'ignore' });

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
  await send('Page.navigate', { url: URL_ });
  await new Promise(r => setTimeout(r, 7000));
  const chk = await send('Runtime.evaluate', { expression: 'typeof window.__nailongGame', returnByValue: true });
  if (chk.result.value !== 'object') { console.log('❌ 游戏实例没起来'); ws.close(); child.kill(); process.exit(1); }

  const r = await send('Runtime.evaluate', { expression: PAGE, awaitPromise: true, returnByValue: true });
  ws.close(); child.kill();
  if (r.exceptionDetails) { console.log('异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 500)); process.exit(1); }
  const o = JSON.parse(r.result.value);
  if (o.err) { console.log('页面返回错误: ' + o.err); process.exit(1); }

  console.log('角色视觉包围盒（含 PLAYER_SCALE）: ' + o.bbox.x + ' x ' + o.bbox.y + ' x ' + o.bbox.z);
  const names = { front: '正视图', side: '侧视图', back: '背视图' };
  for (const k of ['front','side','back']) {
    const v = o.views[k];
    console.log('');
    console.log('=== ' + names[k] + ' === 高=' + v.Hpx + 'px  x=[' + v.px0 + ',' + v.px1 + ']  虹膜横位=' + v.irisCx);
    for (const s of v.scan) console.log('  ' + s.h.toFixed(2) + '  ' + s.runs.map(rr => '[' + rr[0].toFixed(3) + ',' + rr[1].toFixed(3) + ']').join(' '));
    if (v.belly) console.log('  奶白肚皮: 宽=' + v.belly.hw + 'H 高=' + v.belly.hh + 'H 高度区间=[' + v.belly.h0 + ',' + v.belly.h1 + ']');
    const b = Buffer.from(o.pngs[k].split(',')[1], 'base64');
    const f = path.join(OUT, '97-三视图-' + k + '.png');
    fs.writeFileSync(f, b);
    console.log('  → ' + f + ' (' + b.length + 'B)');
  }
  fs.writeFileSync(path.join(__dirname, '__turn_scan.json'), JSON.stringify({ bbox: o.bbox, views: o.views }, null, 1));
  console.log('');
  console.log('已写出 __turn_scan.json');
})();
