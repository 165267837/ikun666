/* __subpath_check.cjs — 验证「部署到 GitHub Pages 的子路径下还能不能跑起来」。
 *
 * 为什么需要这个：GitHub Pages 的项目站点地址是
 *     https://<用户名>.github.io/<仓库名>/
 * 也就是游戏**不在网站根目录**，而在一个子路径里。任何写成 `/libs/xxx` 的绝对路径、
 * 或 `fetch('/api')` 之类的根相对请求，在本地 `node serve.cjs`（根目录 = /）下
 * 完全测不出来，一上线就 404 白屏。
 *
 * 做法：把「真正会推送的那份文件」复制到 <临时根>/ikun666/，
 * 用本地服务把 <临时根> 当网站根 → 访问 /ikun666/ 就等价于线上环境。
 * 跑完自动清理。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const STAGE = path.join(ROOT, '__subpath_stage');
const SUB = 'ikun666';
const PORT = 5190;
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9351;
const PROF = path.join(ROOT, '__subpathprof');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
};

// ---- 1. 导出「会上传的那份」到 <stage>/ikun666/ ----
// 只搬部署必需的顶层条目；正好也是 .gitignore 之外、线上真正会被请求的东西。
const DEPLOY_ITEMS = ['index.html', 'style.css', 'main.js', 'libs'];
fs.rmSync(STAGE, { recursive: true, force: true });
const dest = path.join(STAGE, SUB);
fs.mkdirSync(dest, { recursive: true });
let copied = 0, bytes = 0;
for (const item of DEPLOY_ITEMS) {
  const src = path.join(ROOT, item);
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.cpSync(src, path.join(dest, item), { recursive: true });
    for (const f of fs.readdirSync(path.join(dest, item))) { copied++; bytes += fs.statSync(path.join(dest, item, f)).size; }
  } else {
    fs.copyFileSync(src, path.join(dest, item));
    copied++; bytes += st.size;
  }
}
console.log('已导出部署产物到 ' + path.relative(ROOT, dest) + '：' + copied + ' 个文件 / ' + (bytes / 1048576).toFixed(2) + ' MB');

// ---- 2. 起静态服务，网站根 = STAGE（所以游戏在 /ikun666/ 子路径下）----
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  // GitHub Pages 会把「以 / 结尾的目录请求」自动映射到该目录下的 index.html，
  // 这里的临时服务器必须照做 —— 否则 /ikun666/ 会直接 404，
  // 测出来的失败是「服务器不像 Pages」而不是「游戏不能部署」。
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(STAGE, path.normalize(p).replace(/^(\.\.[\\/])+/, ''));
  if (!file.startsWith(STAGE)) { res.writeHead(403); return res.end('403'); }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('404 Not Found'); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  });
});

(async function () {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + PORT + '/' + SUB + '/';
  console.log('模拟线上地址: ' + BASE + '  （游戏在子路径里，不在根目录）\n');

  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    '--window-size=520,900', '--user-data-dir=' + PROF,
    '--remote-debugging-port=' + CDP_PORT, BASE,
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 70; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch (e) { /* 还没起来 */ }
    await sleep(300);
  }
  if (!target) { console.error('拿不到 CDP target'); child.kill(); server.close(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const bad = [];               // 收集页面级错误（异常 / 控制台 error / 失败请求）
  let id = 0;
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      bad.push('未捕获异常: ' + (d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      bad.push('console.error: ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 160));
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      bad.push('日志错误: ' + m.params.entry.text.slice(0, 160) + '  [' + (m.params.entry.url || '') + ']');
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable');
  await send('Log.enable');
  await sleep(6500);

  const probe = await ev(`(function(){
    var out = [];
    var g = window.__nailongGame;
    var cv = document.querySelector('canvas');
    var menu = document.getElementById('menu');
    out.push('__nailongGame 存在 = ' + (!!g));
    out.push('游戏状态 = ' + (g ? g.state : 'n/a'));
    out.push('three.js 载入 = ' + (window.__nailongThreeOk === undefined ? '(无标记)' : window.__nailongThreeOk));
    out.push('canvas = ' + (cv ? cv.width + 'x' + cv.height + ' 可见=' + (cv.offsetWidth > 0) : '缺失'));
    out.push('主菜单可见 = ' + (menu ? !menu.classList.contains('hidden') : '缺失'));
    out.push('顶栏文案 = ' + (document.querySelector('.hdr-name') || {}).textContent);
    var res = performance.getEntriesByType('resource').map(function(r){ return r.name.split('/').slice(-1)[0] + '(' + Math.round(r.transferSize/1024) + 'KB)'; });
    out.push('实际成功加载的资源 = ' + res.length + ' 个');
    out.push('  ' + res.join(', '));
    return out.join(String.fromCharCode(10));
  })()`);
  console.log('--- 页面探针 ---');
  console.log(probe || '(探针没返回)');

  const state = await ev('window.__nailongGame ? window.__nailongGame.state : null');
  const hasCanvas = await ev('!!document.querySelector("canvas") && document.querySelector("canvas").width > 0');
  const menuShown = await ev('(function(){var m=document.getElementById("menu");return !!m && !m.classList.contains("hidden");})()');

  console.log('\n--- 结论 ---');
  let fail = 0;
  const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) fail++; };
  ok(state === 'menu', '游戏在子路径下正常启动并停在主界面（state=' + state + '）');
  ok(hasCanvas === true, 'WebGL canvas 正常创建');
  ok(menuShown === true, '主菜单渲染成功（不是白屏）');
  // favicon.ico 是无头浏览器自己发起的默认探测（页面里并没有引用它），
  // 线上同样会 404 且不影响任何东西 —— 从判定里排除，避免假警报。
  const real = bad.filter((b) => !/favicon\.ico/.test(b));
  ok(!real.some((b) => /404|Failed to load|ERR_/.test(b)), '没有资源 404 / 加载失败' + (real.length ? '' : '（favicon 探测已排除）'));
  bad.length = 0; bad.push(...real);
  console.log(fail === 0 && bad.length === 0
    ? '\n✅ 子路径部署验证通过：这份文件原样丢到 GitHub Pages 的项目站点就能跑。'
    : '\n❌ 有问题，见上。捕获到的页面错误 ' + bad.length + ' 条：');
  bad.slice(0, 12).forEach((b) => console.log('  · ' + b));

  ws.close(); child.kill(); server.close();
  await sleep(600);
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.rmSync(PROF, { recursive: true, force: true });
  console.log('（临时产物已清理）');
  process.exit(fail === 0 && bad.length === 0 ? 0 : 1);
})();
