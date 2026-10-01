/* check-ui.cjs — 从 main.js 抽出 UIManager 与数据表，用假 DOM 跑一遍渲染逻辑。
   目的：在不依赖浏览器 / WebGL 的前提下验证菜单与弹窗渲染不会抛错。 */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const src = fs.readFileSync(path.join(dir, 'main.js'), 'utf8');

function block(from, open, close) {
  const i = src.indexOf(from);
  if (i < 0) throw new Error('未找到: ' + from);
  const s = src.indexOf(open, i);
  let depth = 0, j = s;
  for (; j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close) { depth--; if (depth === 0) break; }
  }
  return src.slice(i, j + 1);
}
function lineConst(name) {
  const re = new RegExp('^const ' + name + ' = .*;$', 'm');
  const m = src.match(re);
  if (!m) throw new Error('未找到常量: ' + name);
  return m[0];
}

const pieces = [
  block('const CONFIG = {', '{', '}'),
  block('const THEMES = [', '[', ']'),
  block('const WORLD_UNLOCK = [', '[', ']'),
  block('const WORLD_DESC = [', '[', ']'),
  block('const SEASONS = [', '[', ']'),
  lineConst('SUN_COUNT'),
  block('function seasonUnlocked(', '{', '}'),
  block('function themeCountFor(', '{', '}'),
  block('const SKINS = [', '[', ']'),
  block('const UPGRADES = [', '[', ']'),
  block('const ACHIEVEMENTS = [', '[', ']'),
  lineConst('clamp'),
  lineConst('lerp'),
  lineConst('rand'),
  lineConst('hex'),
  lineConst('int'),
  lineConst('upgradeCost'),
  block('function normalizeCode(', '{', '}'),
  block('function findRedeemCode(', '{', '}'),
  block('class UIManager {', '{', '}'),
];

// ---------- 假 DOM ----------
// 从 index.html 抓 id，并连带抓取该标签上的初始 class。
// 初始 class 很重要：例如 #rush 必须是 class="rush hidden"，
// 否则进游戏第一帧就会看到冲刺段横幅挂在屏幕上。
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const initialClasses = {};
const ids = [];
for (const m of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
  const id = m[1];
  if (!ids.includes(id)) ids.push(id);
  const cm = m[0].match(/\bclass="([^"]*)"/);
  initialClasses[id] = cm ? cm[1] : '';
}
const missingHits = [];
function makeEl(id) {
  // className 与 classList 必须共用同一份集合（真实 DOM 就是这样），
  // 否则「el.className = 'a b'」之后 classList 看不到 b，断言会假通过。
  const set = new Set();
  const el = {
    id, textContent: '', innerHTML: '', _attrs: {}, style: {}, offsetWidth: 0,
    classList: {
      add(c) { set.add(c); }, remove(c) { set.delete(c); },
      contains(c) { return set.has(c); },
      toggle(c, on) { if (on) set.add(c); else set.delete(c); },
    },
    setAttribute(k, v) { this._attrs[k] = v; },
    removeAttribute(k) { delete this._attrs[k]; },
    getAttribute(k) { return this._attrs[k]; },
    addEventListener() {},
    // 媒体元素的最小桩：UIManager._goVideo() 会真的调 play() / pause()。
    // 记下调用次数，好在断言里验证「显示结算就播、离开就停」这条逻辑本身 ——
    // 若只让 showMenu/showHUD 不崩，那就是「只打印不断言」，等于没测。
    paused: true, currentTime: 0, muted: false, loop: false, _plays: 0, _pauses: 0,
    play() { this.paused = false; this._plays++; return { catch() {} }; },
    pause() { this.paused = true; this._pauses++; },
  };
  Object.defineProperty(el, 'className', {
    get() { return Array.from(set).join(' '); },
    set(v) { set.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => set.add(c)); },
  });
  return el;
}
const els = {};
ids.forEach(i => { els[i] = makeEl(i); els[i].className = initialClasses[i] || ''; });

const sandbox = {
  CONFIG: undefined, THREE: {}, console,
  byId: (id) => {
    if (!els[id]) { missingHits.push(id); return makeEl(id); }
    return els[id];
  },
  window: { addEventListener() {} },
  document: { querySelectorAll: () => [] },
  setTimeout: () => 0, clearTimeout: () => {},
  navigator: {}, localStorage: { getItem: () => null, setItem() {} },
};

const code = pieces.join('\n') + '\nreturn { UIManager, CONFIG, SKINS, THEMES, UPGRADES, ACHIEVEMENTS, WORLD_UNLOCK, WORLD_DESC, normalizeCode, findRedeemCode, SUN_COUNT, SEASONS, seasonUnlocked, themeCountFor };';
let mod;
try {
  mod = new Function('sandbox', 'with (sandbox) { ' + code + ' }')(sandbox);
} catch (e) {
  console.error('❌ 抽取/求值失败:', e.message);
  process.exit(1);
}

const { UIManager, CONFIG, SKINS, ACHIEVEMENTS, UPGRADES, normalizeCode, findRedeemCode,
  THEMES, WORLD_UNLOCK, WORLD_DESC, SUN_COUNT, SEASONS, seasonUnlocked, themeCountFor } = mod;

// ---------- 假存档：两套（空档 / 满档）----------
function fakeSave(opts) {
  return {
    data: {
      version: 2, best: opts.best, totalCoins: opts.coins,
      muted: opts.muted, music: opts.music, vibrate: true, quality: 'high',
      skin: opts.skin, skins: opts.skins, startTheme: opts.startTheme,
      upgrades: opts.upgrades,
      achv: opts.achv,
      scores: opts.scores,
      stats: opts.stats,
    },
  };
}
const emptySave = fakeSave({
  best: 0, coins: 0, muted: false, music: true, skin: 'default', skins: ['default'], startTheme: 0,
  upgrades: { magnet: 0, shield: 0, coin: 0, headstart: 0, luck: 0 },
  achv: {}, scores: [],
  stats: { runs: 0, totalDistance: 0, totalCoinsEarned: 0, powerupsUsed: 0, revives: 0, bestCombo: 0, rushCleared: 0 },
});
const richSave = fakeSave({
  best: 2600, coins: 5000, muted: true, music: false, skin: 'gold',
  skins: SKINS.map(s => s.id), startTheme: 3,
  upgrades: { magnet: 5, shield: 5, coin: 3, headstart: 2, luck: 3 },
  achv: { first_run: { claimed: true }, dist_1000: { claimed: true } },
  scores: [{ score: 2600, dist: 1300, coins: 640, date: '9/20' }, { score: 980, dist: 410, coins: 300, date: '9/18' }],
  stats: { runs: 12, totalDistance: 8600, totalCoinsEarned: 4200, powerupsUsed: 14, revives: 3, bestCombo: 31, rushCleared: 7 },
});
// 第 2 赛季解锁档：同样满级装备，但累计里程已过 10000 米（startTheme=6，故意落在竹墨那半边）。
const inkSave = fakeSave({
  best: 2600, coins: 5000, muted: true, music: false, skin: 'gold',
  skins: SKINS.map((s) => s.id), startTheme: 6,
  upgrades: { magnet: 5, shield: 5, coin: 3, headstart: 2, luck: 3 },
  achv: { first_run: { claimed: true }, dist_1000: { claimed: true } },
  scores: [{ score: 2600, dist: 1300, coins: 640, date: '9/20' }],
  stats: { runs: 30, totalDistance: 12000, totalCoinsEarned: 6000, powerupsUsed: 30, revives: 5, bestCombo: 44, rushCleared: 12 },
});

const ui = new UIManager();
const results = [];
function t(name, fn) {
  try { const out = fn(); results.push([name, 'OK', out]); }
  catch (e) { results.push([name, 'FAIL ' + e.message, '']); }
}
// 真断言：不满足就抛错 → t() 记为 FAIL。
// （只 return 一个字符串是「只打印不断言」，永远不会失败，等于没测。）
function must(cond, msg) { if (!cond) throw new Error(msg); }

t('updateMenu(空档)', () => {
  ui.updateMenu(emptySave);
  return 'coins=' + ui.el.menuCoins.textContent + ' best=' + ui.el.menuBest.textContent +
    ' runs=' + ui.el.bRuns.textContent + ' skins=' + ui.el.bSkins.textContent + ' achv=' + ui.el.bAchv.textContent +
    ' boost=' + ui.el.boostSub.textContent + ' sound=' + ui.el.btnSound.textContent + ' music=' + ui.el.btnMusic.textContent +
    ' dotShop=' + ('hidden' in ui.el.dotShop._attrs) + ' dotChal=' + ('hidden' in ui.el.dotChal._attrs);
});
t('updateMenu(满档)', () => {
  ui.updateMenu(richSave);
  return 'sound=' + ui.el.btnSound.textContent + ' music=' + ui.el.btnMusic.textContent +
    ' off声=' + ui.el.btnSound.classList.contains('off') + ' off乐=' + ui.el.btnMusic.classList.contains('off') +
    ' dotShop=' + !('hidden' in ui.el.dotShop._attrs) + ' dotChal=' + !('hidden' in ui.el.dotChal._attrs) +
    ' dotCrown=' + !('hidden' in ui.el.dotCrown._attrs);
});
t('renderWorld(空档-全锁)', () => {
  const h = ui.renderWorld(emptySave);
  return 'len=' + h.length + ' locked按钮=' + (h.match(/最高分 \d+/g) || []).length + ' 出发地按钮=' + (h.match(/出发地/g) || []).length;
});
t('renderWorld(满档-可选)', () => {
  const h = ui.renderWorld(richSave);
  return '可选出发=' + (h.match(/从这里出发/g) || []).length + ' 当前=' + (h.match(/出发地/g) || []).length + ' 未解锁标签=' + (h.match(/未解锁/g) || []).length;
});
t('seasonUnlocked（只认累计里程，不认最高分）', () => {
  must(seasonUnlocked(0, { stats: { totalDistance: 0 } }) === true, '第 1 赛季 need=0，任何存档都该直接解锁');
  must(seasonUnlocked(1, { stats: { totalDistance: 9999 } }) === false, '差 1 米也必须还是锁着的（不能提前剧透竹墨松林）');
  must(seasonUnlocked(1, { stats: { totalDistance: 10000 } }) === true, '刚好 10000 米就该解锁（是 >= 不是 >）');
  must(seasonUnlocked(1, { stats: { totalDistance: 24000 } }) === true, '跑更多米当然继续解锁');
  must(seasonUnlocked(1, {}) === false, '缺 stats 时必须兜底为锁，不能 undefined   false 之外的值');
  must(seasonUnlocked(1, { stats: { totalDistance: 'abc' } }) === false, 'totalDistance 不是数字时要兜底为锁');
  must(seasonUnlocked(1, null) === false, 'data 为 null 时要兜底为锁而不是抛错');
  must(seasonUnlocked(9, { stats: { totalDistance: 999999 } }) === false, '越界赛季下标应返回 false，而不是崩');
  return 'need=0→true / 9999→false / 10000→true / 24000→true / 缺stats→false / 非数字→false / null→false / 越界→false';
});
t('themeCountFor（一轮换 4 张还是 8 张）', () => {
  must(SEASONS.length === 2, '赛季表应有 2 项（阳光漫游 / 竹墨松林），实际 ' + SEASONS.length);
  must(SEASONS[1].need === 10000, '第 2 赛季门槛应是 10000 米，实际 ' + SEASONS[1].need);
  must(SEASONS[1].from === SUN_COUNT, '第 2 赛季要从第 5 张（from=' + SUN_COUNT + '）接上，否则会和前 4 张撞号');
  must(themeCountFor({ stats: { totalDistance: 0 } }) === 4, '没解锁时只能跑前 4 张（阳光漫游）');
  must(themeCountFor({ stats: { totalDistance: 9999 } }) === 4, '差 1 米也不能提前把竹墨松林算进轮换');
  must(themeCountFor({ stats: { totalDistance: 10000 } }) === 8, '解锁后应 8 张一起轮');
  must(THEMES.length === 8 && WORLD_DESC.length === 8, 'THEMES 与 WORLD_DESC 都该是 8 项，实际 ' + THEMES.length + '/' + WORLD_DESC.length);
  return '未解锁=' + themeCountFor({ stats: { totalDistance: 0 } }) + ' 张 / 解锁=' + themeCountFor({ stats: { totalDistance: 10000 } }) + ' 张';
});
t('renderWorld（累计满 10000 米后竹墨松林整季解锁）', () => {
  const h = ui.renderWorld(inkSave);
  const here = (h.match(/从这里出发/g) || []).length;
  const cur = (h.match(/出发地</g) || []).length;
  const un = (h.match(/未解锁/g) || []).length;
  must(here === 7, '解锁后除当前这张外 7 张都该可选，实际 ' + here);
  must(cur === 1, '当前出发地只应有 1 张，实际 ' + cur);
  must(un === 0, '整季解锁后不该再出现「未解锁」标签，实际 ' + un);
  must(h.indexOf('累计 10000 m') < 0, '解锁后不该再出现累计门槛按钮');
  must(h.includes('已解锁'), '说明文案应切成已解锁语气');
  must(THEMES.slice(SUN_COUNT).every((x) => /竹|松|墨|露|灯/.test(x.name)), '后 4 张应全是竹墨松林主题');
  return '可选=' + here + ' 当前=' + cur + ' 未解锁=' + un + ' 含已解锁文案=true';
});
t('renderWorld（旧 4 张的开关不被累计里程带飞）', () => {
  // 反向对照：把累计里程刷到 99999，但最高分仍是 0 —— 旧图必须照旧只认最高分。
  const cheat = fakeSave({
    best: 0, coins: 9000, muted: false, music: true, skin: 'default',
    skins: ['default'], startTheme: 0,
    upgrades: { magnet: 0, shield: 0, coin: 0, headstart: 0, luck: 0 }, achv: {}, scores: [],
    stats: { runs: 99, totalDistance: 99999, totalCoinsEarned: 9000, powerupsUsed: 99, revives: 9, bestCombo: 99, rushCleared: 99 },
  });
  const h = ui.renderWorld(cheat);
  const sun = (h.match(/最高分 \d+/g) || []).length;
  const ink = (h.match(/累计 10000 m/g) || []).length;
  must(sun === 3, '最高分 0 时旧图后 3 张该按最高分锁着，实际 ' + sun);
  must(ink === 0, '累计里程够不代表旧图该解锁 —— 旧 4 张各走各的最高分门槛（实际露出 ' + ink + ' 张累计门槛卡）');
  must(h.includes('第 2 赛季') && h.includes('第 1 赛季'), '两种赛季标签都要出现');
  return '旧图最高分门槛卡=' + sun + '（累计 99999 也未放行） 竹墨锁卡=' + ink;
});
t('renderRank(空档)', () => ui.renderRank(emptySave).length);
t('renderRank(满档)', () => {
  const h = ui.renderRank(richSave);
  return 'len=' + h.length + ' 含最高分=' + h.includes('2600') + ' Top5行=' + (h.match(/rank-no/g) || []).length;
});
['renderSkins', 'renderShop', 'renderAchievements', 'renderSettings'].forEach(m => {
  t(m + '(空档)', () => ui[m](emptySave).length);
  t(m + '(满档)', () => ui[m](richSave).length);
});
t('updateHUD/updateCombo/updatePowerups', () => {
  ui.updateHUD(1234, 456.7, 88);
  ui.updateCombo(12, 1.24);
  ui.updatePowerups({ shieldTimer: 3, shieldMax: 6, magnetTimer: 4, speedBoostTimer: 0, doubleTimer: 5 });
  return 'hudScore=' + ui.el.hudScore.textContent + ' comboN=' + ui.el.comboN.textContent +
    ' chip数=' + (ui.el.powerups.innerHTML.match(/pu-chip/g) || []).length;
});
t('updatePowerups(加速带芯片)', () => {
  // 机关加速带要有独立的 HUD 芯片，否则玩家不知道自己正在被加速
  ui.updatePowerups({ padBoostTimer: 1.2, shieldTimer: 0, magnetTimer: 0, speedBoostTimer: 0, doubleTimer: 0 });
  const html = ui.el.powerups.innerHTML;
  const n = (html.match(/pu-chip/g) || []).length;
  must(n === 1, '加速中应只显示 1 个芯片，实际 ' + n);
  must(html.includes('加速带'), '芯片文案里没有「加速带」');
  return 'chip数=' + n + ' 含加速带=true';
});
t('冲刺段横幅 show/update/hide', () => {
  must(ui.el.rush.classList.contains('hidden'), '初始就应该是隐藏的');
  ui.showRush();
  must(!ui.el.rush.classList.contains('hidden'), 'showRush 之后没有显示');
  ui.updateRush(0.25, 60);
  must(ui.el.rushFill.style.width === '25.0%', '进度条宽度应为 25.0%，实际 ' + ui.el.rushFill.style.width);
  must(/剩\s*60m/.test(ui.el.rushText.textContent), '倒计时文案不对: ' + ui.el.rushText.textContent);
  ui.hideRush();
  must(ui.el.rush.classList.contains('hidden'), 'hideRush 之后没有隐藏');
  return '进度条宽=25.0% 文案="' + ui.el.rushText.textContent + '"';
});
t('飘字 pop（连续触发要能重播动画）', () => {
  ui.pop('加速带！', 'pad');
  must(ui.el.pop.textContent === '加速带！', '文案不对');
  must(ui.el.pop.classList.contains('show'), '没有加 show，动画不会播放');
  must(ui.el.pop.classList.contains('pad'), 'pad 修饰类丢了');
  must(ui.el.pop.className === 'pop pad show', 'className 不对: ' + ui.el.pop.className);
  // 连续第二次：类名必须被重置（去掉上一次的 pad），这样动画才能重新播放
  ui.pop('弹跳板！', 'big');
  must(ui.el.pop.className === 'pop big show', '第二次 className 不对: ' + ui.el.pop.className);
  must(!ui.el.pop.classList.contains('pad'), '第二次没清掉上一次的 pad');
  return '第一次="加速带！"/pop pad show  第二次="弹跳板！"/pop big show';
});
t('成就表（「擦身而过」已移除）', () => {
  const ids = ACHIEVEMENTS.map((a) => a.stat);
  must(ids.includes('rushCleared'), '缺少统计冲刺段的成就');
  must(!ids.includes('nearMiss'), 'nearMiss 成就应随「擦身而过」机制一并删除');
  must(ACHIEVEMENTS.length === 9, '成就数应为 9（删掉 near_50 之后的 9 条），实际 ' + ACHIEVEMENTS.length);
  return '成就数=' + ACHIEVEMENTS.length + ' 含 rushCleared=true / nearMiss=false';
});
t('结算视频（显示结算就播 / 一离开就停）', () => {
  const v = ui.el.goVideo;
  must(!!v, 'byId("go-video") 没拿到元素 —— index.html 里少了结算视频');
  const p0 = v._plays, q0 = v._pauses;
  v.paused = false;   // 假装正在播（真实场景：玩家刚死过，视频正在放）
  ui.showMenu();
  must(v._pauses === q0 + 1 && v.paused === true, 'showMenu 应当把正在播的视频暂停');
  ui.showGameOver(1234, 567, 89, 2600, true, true, 100);
  must(v._plays === p0 + 1, 'showGameOver 应当调一次 play（实际 ' + (v._plays - p0) + ' 次）');
  must(v.paused === false, 'play 之后 paused 应为 false');
  must(v.currentTime === 0, '结算时应当从片头开始（currentTime 应为 0）');
  ui.showHUD();
  must(v.paused === true, 'showHUD（重新开始 / 复活）应当暂停视频');
  // 模拟「上一局已经播到一半」—— 验证第二次结算真的重头播，而不是接着上一局的尾巴
  v.currentTime = 3.5;
  ui.showGameOver(10, 10, 10, 2600, false, false, 0);
  must(v.currentTime === 0, '第二次结算必须把进度重置为 0（否则只会看到上一局剩下的半段）');
  must(v.paused === false, '第二次结算同样要播');
  return 'plays=' + v._plays + ' pauses=' + v._pauses + ' 末态 paused=' + v.paused;
});
t('兑换码表（17班nb666 → 3000 金币）', () => {
  must(Array.isArray(CONFIG.REDEEM_CODES) && CONFIG.REDEEM_CODES.length >= 1, 'CONFIG.REDEEM_CODES 应是至少 1 项的数组');
  const hit = findRedeemCode('17班nb666');
  must(!!hit, '正确的兑换码 17班nb666 没被识别');
  must(hit.coins === 3000, '金币数应为 3000，实际 ' + hit.coins);
  return '码数=' + CONFIG.REDEEM_CODES.length + ' 命中=' + hit.code + ' 金币=' + hit.coins;
});
t('兑换码规范化（空格 / 全角空格 / 大小写）', () => {
  must(normalizeCode('17班nb666') === '17班nb666', '原样输入不该被改动');
  must(normalizeCode('  17班nb666  ') === '17班nb666', '首尾半角空格没去掉');
  must(normalizeCode('17班\u3000nb666') === '17班nb666', '全角空格 U+3000 没去掉');
  must(normalizeCode('17班NB666') === '17班nb666', '英文没转成小写');
  must(!!findRedeemCode('  \u3000 17班NB666 \u3000 '), '同一个码换个大小写 / 加空格应当还是能兑');
  return '规范化 5 项全部正确';
});
t('兑换码无效输入（8 种都必须是 null，不是抛错）', () => {
  const bads = ['17班nb66', '17班nb6666', 'nb666', '', '   ', '\u3000', null, undefined];
  const leaked = [];
  bads.forEach((b) => { let r; try { r = findRedeemCode(b); } catch (e) { leaked.push(String(b) + '→抛错'); return; } if (r !== null) leaked.push(JSON.stringify(b) + '→' + (r && r.code)); });
  must(leaked.length === 0, '这些输入不该命中：' + leaked.join(' / '));
  return '8 种无效输入全部返回 null';
});
t('toast/开关', () => { ui.toast('测试'); ui.showMenu(); ui.showHUD(); ui.openModal('t', 'b'); ui.closeModal(); return 'ok'; });

console.log('\n=== UIManager 渲染自检 ===');
let bad = 0;
results.forEach(([n, s, o]) => { if (s !== 'OK') bad++; console.log((s === 'OK' ? '✅ ' : '❌ ') + n + (o !== '' ? ' → ' + o : ' → ' + s)); });
console.log('\nbyId 缺省命中（HTML 里没有的 id）:', missingHits.length ? [...new Set(missingHits)].join(', ') : '无');
console.log('结果: ' + (results.length - bad) + '/' + results.length + ' 通过');
process.exit(bad ? 1 : 0);
