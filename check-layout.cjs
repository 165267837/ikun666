/* check-layout.cjs — 主界面布局的响应式闸门（真实浏览器 + 多视口实测）。
 *
 * 为什么需要它：主界面 v3.5 把原来「左右两条绝对定位悬浮竖列」改成了居中的 2×3 宫格。
 * 旧布局时代留下的两条媒体查询里写死了 .side-btn{width:56px / 54px}——那对悬浮竖列是对的，
 * 但对网格单元就是灾难：390x844（iPhone 14 尺寸）上按钮被压到 54px，
 * 430px 宽的宫格里三格只占左边一小块。静态检查（check-syntax / check-ui）完全看不出来，
 * 出图脚本也只抓 520x900 这一个尺寸。所以补这道关卡：在 6 个视口下量真实盒子。
 *
 * 判定原则（都是「必须成立」的不变量，不是快照比对）：
 *   1. 6 个宫格按钮都可见、尺寸一致、两行各自顶边对齐；
 *   2. 每个按钮宽度 ≈ 宫格宽度 / 每行列数 —— 允许 -12px 的 padding 余量，
 *      写死宽度这类错误会被这条直接抓住（行/列数按实测分组算，不写死 3 或 6）；
 *   3. 按钮高度 >= 40px（触摸可用性下限）；
 *   4. 任何按钮都不能被挤出 #menu 底部；
 *   5. 视口高 >= 640 时任务横幅必须可见（旧版 760px 就藏，白白浪费中间的空档）。
 *
 * 用法:
 *   node check-layout.cjs             常规校验（需要静态服务器已在 5188 跑着）
 *   node check-layout.cjs --selftest  自检：故意注入一条已知坏样式，验证闸门确实会报错
 *   node check-layout.cjs --shot      失败时把当屏画面落到 preview/
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9337;
const URL_ = 'http://127.0.0.1:5188/';
const PROF = path.join(__dirname, '__layoutprof');
const OUT = path.join(__dirname, 'preview');

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
const WANT_SHOT = process.argv.indexOf('--shot') >= 0;
const SELFTEST = process.argv.indexOf('--selftest') >= 0;

/* [宽, 高, 期望横幅可见, 说明] */
const VIEWPORTS = [
  [520, 900, true, '常见手机 520x900'],
  [520, 660, true, '矮屏 520x660'],
  [390, 844, true, '真机 390x844 (iPhone 14)'],
  [360, 640, true, '小屏 360x640'],
  [360, 600, false, '极矮 360x600 (620 档应收缩)'],
  [430, 932, true, '大屏 430x932'],
];

/* 自检用的坏样式：写死尺寸压扁网格单元。
   v3.9 宫格变成一行 6 格之后，56px 已经不算「被压扁」（格宽下限约 44~68px），
   自检会恒过；换成 28px —— 任何视口下都远小于格宽下限，也低于 40px 触摸下限，必定触发两条失败。 */
const BAD_CSS = '.side-btn{width:28px !important;height:28px !important;}';

const MEASURE = [
  '(function(){',
  ' var m=document.getElementById("menu"); if(!m) return JSON.stringify({err:"no #menu"});',
  ' var w=document.querySelector(".menu-tiles");',
  ' var bs=[].slice.call(document.querySelectorAll(".menu-tiles .side-btn"));',
  ' var o={vw:innerWidth, vh:innerHeight, n:bs.length};',
  ' o.tilesW = w ? Math.round(w.getBoundingClientRect().width) : -1;',
  ' var rects = bs.map(function(b){return b.getBoundingClientRect();});',
  ' o.btnW = rects.map(function(r){return Math.round(r.width);});',
  ' o.btnH = rects.map(function(r){return Math.round(r.height);});',
  ' o.rowTops = rects.map(function(r){return Math.round(r.top);});',
  ' // 按顶边把按钮分组 → 行数 / 每行列数 / 每行是否等宽 / 各行数量是否一致。',
  ' // 断言不写死 3 列或 6 列：v3.5 的 2×3 与 v3.9 的一行 6 格都能正确判定。',
  ' var groups = {}; rects.forEach(function(r){ var k=Math.round(r.top); (groups[k]=groups[k]||[]).push(Math.round(r.width)); });',
  ' var gkeys = Object.keys(groups);',
  ' o.rows = gkeys.length;',
  ' o.cols = gkeys.reduce(function(a,k){ return Math.max(a, groups[k].length); }, 0);',
  ' o.rowsEven = gkeys.length>0 && gkeys.every(function(k){ return groups[k].every(function(v){ return v===groups[k][0]; }); });',
  ' o.evenPerRow = gkeys.length>0 && gkeys.every(function(k){ return groups[k].length===groups[gkeys[0]].length; });',
  ' o.bannerVisible = (function(){var b=document.querySelector(".banner-stack");return b?getComputedStyle(b).display!=="none":false;})();',
  ' o.overflow = [];',
  ' var mr=m.getBoundingClientRect();',
  ' m.querySelectorAll("button").forEach(function(e){var q=e.getBoundingClientRect();',
  '   if(q.width>0 && q.bottom>mr.bottom+2) o.overflow.push((e.id||e.getAttribute("data-tab")||e.className)+"@"+Math.round(q.bottom)+">"+Math.round(mr.bottom));});',
  ' o.visible = rects.filter(function(r){return r.width>0&&r.height>0;}).length;',
  ' return JSON.stringify(o);',
  '})()',
].join('\n');

(async () => {
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) {}
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--disable-dev-shm-usage', '--mute-audio', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=520,900',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF, 'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      targets = await r.json();
      if (targets && targets.length) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!targets) { console.log('❌ 无法连接调试端口 ' + PORT + '（静态服务器 / 浏览器没起来？）'); child.kill(); process.exit(1); }
  const page = targets.find(function (t) { return t.type === 'page'; });
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  let id = 0; const pending = new Map();
  const send = function (method, params) {
    return new Promise(function (res, rej) {
      const mid = ++id; pending.set(mid, { res: res, rej: rej, method: method });
      ws.send(JSON.stringify({ id: mid, method: method, params: params || {} }));
    });
  };
  const ev = function (expr) {
    return send('Runtime.evaluate', { expression: expr, returnByValue: true })
      .then(function (r) { return r.result ? r.result.value : null; });
  };
  async function shot(name) {
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'));
  }

  await new Promise(function (r) { ws.addEventListener('open', r); });
  ws.addEventListener('message', function (m) {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
      else if (msg.result == null) p.rej(new Error('CDP 空 result: ' + p.method));
      else p.res(msg.result);
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 520, height: 900, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: URL_ });
  await sleep(6000);
  const boot = await ev('typeof window.__nailongGame');
  if (boot !== 'object') { console.log('❌ 游戏实例没起来，无法进入主界面（boot=' + boot + '）'); ws.close(); child.kill(); process.exit(1); }
  await ev('window.__nailongGame._toMenu()');
  await sleep(1400);

  let pass = 0, fail = 0;
  const bad = [];
  function chk(label, cond, extra) {
    if (cond) { pass++; console.log('  ✅ ' + label + (extra ? ' → ' + extra : '')); }
    else { fail++; bad.push(label); console.log('  ❌ ' + label + (extra ? ' → ' + extra : '')); }
  }

  async function runSuite(title) {
    pass = 0; fail = 0; bad.length = 0;
    console.log('=== ' + title + ' ===\n');
    for (const [w, h, bannerWant, label] of VIEWPORTS) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
      await sleep(700);
      let o = {};
      try { o = JSON.parse(await ev(MEASURE)); } catch (e) { o = { err: String(e) }; }
      if (o.err || o.tilesW < 0) { chk('[' + label + '] 能取到 #menu 与宫格', false, o.err || 'tilesW<0'); continue; }

      console.log('[' + label + ']  宫格 ' + o.rows + ' 行 × ' + o.cols + ' 列（宽 ' + o.tilesW + '）  按钮=' + JSON.stringify(o.btnW) + ' x ' + JSON.stringify(o.btnH));
      const cellW = o.tilesW / (o.cols || 1);
      chk('6 个宫格按钮全部可见', o.n === 6 && o.visible === 6, 'n=' + o.n + ' visible=' + o.visible);
      chk('同一行按钮宽度一致', o.rowsEven, JSON.stringify(o.btnW));
      chk('每行按钮数一致（宫格没被拆散）', o.evenPerRow, o.rows + ' 行 × ' + o.cols + ' 列');
      /* 关键不变量：网格单元必须占满格宽的 1/列数，写死宽度会在这里挂 */
      chk('按钮宽度 ≈ 格宽 1/' + o.cols + '（未被固定尺寸压扁）',
        o.btnW.every(function (b) { return b >= cellW - 12; }),
        '最小 ' + Math.min.apply(null, o.btnW) + ' vs 格宽 ' + Math.round(cellW) + '（下限 ' + Math.round(cellW - 12) + '）');
      chk('按钮高度 >= 40px（触摸可用）', o.btnH.every(function (b) { return b >= 40; }), '最小 ' + Math.min.apply(null, o.btnH));
      chk('没有按钮被挤出 #menu 底部', o.overflow.length === 0, JSON.stringify(o.overflow));
      chk(bannerWant ? '任务横幅可见' : '极矮屏已收缩掉横幅', o.bannerVisible === bannerWant, 'bannerVisible=' + o.bannerVisible);

      if (WANT_SHOT && (!o.rowsEven || !o.evenPerRow || o.overflow.length)) await shot('__layout-fail-' + w + 'x' + h + '.png');
      console.log('');
    }
    return { pass: pass, fail: fail, bad: bad.slice() };
  }

  if (SELFTEST) {
    await ev('(function(){var s=document.createElement("style");s.textContent=' + JSON.stringify(BAD_CSS) + ';document.head.appendChild(s);return 1;})()');
    await sleep(600);
    const r = await runSuite('自检 · 已故意注入坏样式 ' + BAD_CSS);
    ws.close(); child.kill();
    if (r.fail > 0) {
      console.log('✅ 自检通过：注入已知坏样式后闸门确实报错（' + r.fail + ' 项失败）—— 闸门不是空转的');
      console.log('   失败项示例: ' + r.bad.slice(0, 3).join(' | '));
      process.exit(0);
    }
    console.log('❌ 自检失败：注入坏样式后闸门仍然全过 —— 这个闸门的判定是空的，必须修');
    process.exit(1);
  }

  const r = await runSuite('主界面响应式布局闸门');
  ws.close(); child.kill();
  console.log('结果: ' + r.pass + '/' + (r.pass + r.fail) + ' 通过' + (r.fail ? '  ❌ 失败项: ' + r.bad.join(' | ') : '  ✅'));
  process.exit(r.fail ? 1 : 0);
})().catch(function (e) { console.log('失败: ' + (e && e.stack || e)); process.exit(1); });
