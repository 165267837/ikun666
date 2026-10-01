// ============================================================================
//  奶龙跑酷 (Milk Dragon Parkour) — 三车道无限跑酷
//  Three.js r160 · 纯前端 · 无后端 · 可部署到 GitHub Pages / Vercel / Netlify
//  v3 玩法扩展版：皮肤系统 / 道具强化 / 成就 / 本地排行榜 / 设置 / 连击
// ============================================================================
import * as THREE from 'three';

// ============================================================================
//  CONFIG — 所有可调参数集中在此
// ============================================================================
const CONFIG = {
  LANE_X: [-3, 0, 3],
  LANE_CHANGE_TIME: 0.15,

  START_SPEED: 8,
  MAX_SPEED: 20,
  SPEED_INCREMENT: 0.1,
  GRAVITY: 32,
  JUMP_HEIGHT: 2.2,

  SLIDE_TIME: 0.8,

  CHUNK_LENGTH: 40,
  CHUNK_COUNT: 6,
  RECYCLE_BEHIND: 60,
  SIDE_WIDTH: 34,      // 赛道护栏外侧的地面宽度（两侧各一块）

  COIN_VALUE: 10,
  BOTTLE_VALUE: 25,
  POINT_PER_METER: 1,

  CAMERA_BASE_FOV: 70,
  CAMERA_SPEED_FOV: 12,
  CAM_FOLLOW: { x: 0, y: 4.2, z: 8 },
  CAM_LERP: 0.12,

  // 每跑满这么多米换一张地图。v3.5 从 320 提到 2000 —— 一张地图要跑够 2 千米才换，
  // 换来的是「跑很久才见到新风景」的期待感；也给 ui.pop 的「到达新地图」播报留出间隔。
  THEME_DISTANCE: 2000,

  POWERUP_INTERVAL: 240,
  MAGNET_TIME: 8,
  SHIELD_TIME: 6,
  SPEEDBOOST_TIME: 5,
  DOUBLE_TIME: 10,
  SPEEDBOOST_MULT: 1.4,
  MAGNET_RADIUS: 7,

  REVIVE_COST: 100,

  COMBO_WINDOW: 3.0,
  COMBO_STEP: 0.02,
  COMBO_MAX: 50,

  // ---------------- 赛道机关（踩上去触发，不是障碍） ----------------
  PAD_CHANCE: 0.55,       // 每个区块尝试投放机关的概率。净空校验会再刷掉约 2/3 的区块，实测约 1 个 / 200m
  PAD_CLEAR: 16,           // 机关「前方」需要多长的无遮挡净空（米）——后方障碍无害，不校验
  PAD_BOOST_MULT: 1.55,    // 加速带的速度倍率（比加速道具 1.4 更猛）
  PAD_BOOST_TIME: 1.8,
  PAD_SPRING_VY: 14.6,     // 弹跳板起跳初速：峰值 14.6²/(2·32) ≈ 3.33m，滞空 0.91s
                           // （普通跳跃峰值 2.2m / 滞空 0.74s）

  // ---------------- 上车顶：地铁车厢是可站立的平台 ----------------
  // 玩家能跳到「低矮车厢」的车顶，在上面跑，车顶还有一串金币（照「地铁跑酷」上车顶吃币）。
  // 两种车高各有分工：低矮款是「上车的门」，标准款仍然只能变道躲（或者从矮车顶再跳一次上去）。
  TRAIN_ROOF: 3.4,          // 标准车厢车顶高度（与 OBSTACLE_TYPES.train.maxY 一致）
  TRAIN_ROOF_LOW: 2.05,     // 低矮车厢车顶高度：普通跳跃峰值 2.2m ⇒ 能跳上去
  TRAIN_LOW_CHANCE: 0.5,    // 车厢里低矮款的比例
  // ⚠️ 攀爬辅助高度：脚底离车顶不到 0.85m 就算「攀上车顶」，辅助直接把你放到车顶；
  // 差得更多才算撞车身。为什么必须有这条辅助：车厢的判定窗在车头**前方 4.4m**
  // 就已经打开（halfZ 4.0 + 玩家 0.4），而跳跃是抛物线 —— 玩家「刚碰到车头」
  // 那一刻脚底不可能已经高于车顶，没有辅助的话「跳上车顶」物理上永远不可能成功。
  // 0.85 同时决定了标准车厢的门限 3.40 − 0.85 = 2.55m > 跳跃峰值 2.2m，
  // 所以标准车厢依然只能变道躲（这条路是故意留死的）。
  // 为什么用「偏移」而不是「车顶 × 比例」：偏移量就是「辅助最多把你抬多高」，
  // 语义直接可读；而且门限更低（矮车 1.20m vs 比例式的 1.54m），
  // 起跳时机窗从 0.43s 放宽到 0.54s，与跨栏（0.56s）同一量级，手感才对得上。
  TRAIN_CLIMB_ASSIST: 0.85,
  ROOF_COIN_Y: 0.85,        // 车顶金币悬在车顶上方多高
                            // 0.85 ⇒ 矮车顶（2.05m）的金币在 2.90m。站地面 pcY = 0.96，净差 1.94 > 判定窗 1.7
                            // ⇒ 只有站上车顶（pcY = 3.01）才吃得到。站地面起跳时 pcY 峰值 3.16 虽然够得着，
                            //   但同车道跳过去必然先撞进车头判定窗（触发攀爬或撞击），不存在「空手跳着白吃」的漏洞。
  PLATFORM_TOLERANCE: 0.4,  // 脚底离车顶多近算「站在车顶上」；走下车顶边缘也用它判定「该开始下落了」

  // ---------------- 冲刺段（定时的节奏高潮） ----------------
  RUSH_FIRST: 420,         // 第一次冲刺段出现距离
  RUSH_EVERY: 500,         // 之后每 500m 一次
  RUSH_LENGTH: 80,         // 冲刺段长度
  RUSH_SPEED_MULT: 1.35,
  RUSH_COIN_MULT: 2,
  RUSH_BONUS: 600,         // 顺利通过的奖励分

  PLAYER_HALF_X: 0.5,
  PLAYER_HALF_Z: 0.5,
  PLAYER_H_STAND: 2.4,
  PLAYER_H_SLIDE: 1.2,

  // 奶龙体型缩放：1 = 原始大小。视觉与碰撞盒一起缩放，
  // 避免出现「看起来很小、却被看不见的大盒子撞到」的不公平手感。
  PLAYER_SCALE: 0.8,
  // 头饰缩放：参考图里头的宽度只占身宽约 62%，比旧模型小一圈，
  // 头饰按同一比例收一点才不会像扣了个盆。纯视觉，与玩法无关。
  HAT_FIT: 0.62,

  // 天空云朵：数量 + 云带纵深（云会随玩家一起向前回收，跑多远天上都有云）
  CLOUD_COUNT: 18,
  CLOUD_SPREAD: 200,

  MAX_PIXEL_RATIO: 2,
  LOW_PIXEL_RATIO: 1.25,

  // ---------- 背景音乐（v4.0 起换成真实音频文件）----------
  // 原来是 AudioManager 用振荡器实时合成的 8 音琶音，现在改用 libs/bgm.m4a。
  // 该文件缺失 / 解不开时，startBGM() 会自动退回原来那套合成琶音，游戏不会变哑。
  BGM_SRC: './libs/bgm.m4a',
  BGM_VOLUME: 0.42,   // 0~1。与音效各自独立（音效统一走 Web Audio 的 master 0.35）
  BGM_LOOP: true,     // 无限跑酷，音乐循环播放

  // ---------- 兑换码（v4.2 新增）----------
  // 玩家在「游戏设置 → 兑换码」里输入 code 即可领取 coins 金币。
  // 同一台设备上每个码只能兑一次（用过的记录在存档 data.codes 里）。
  // 加新码只要往这个数组追加一项，UI 与闸门都不用改。
  REDEEM_CODES: [
    { code: '17班nb666', coins: 3000, label: '开学季福利' },
  ],
};

// 碰撞盒跟随体型一起缩放，保证「看到的体积」与「被撞的体积」一致。
// 因此跨栏必须跳、墙壁/列车必须变道、横杆下不能起跳等玩法关系全部保持不变，
// 只是整体判定按新体型等比收紧。
CONFIG.PLAYER_HALF_X *= CONFIG.PLAYER_SCALE;
CONFIG.PLAYER_HALF_Z *= CONFIG.PLAYER_SCALE;
CONFIG.PLAYER_H_STAND *= CONFIG.PLAYER_SCALE;
CONFIG.PLAYER_H_SLIDE *= CONFIG.PLAYER_SCALE;

const OBSTACLE_TYPES = {
  hurdle:   { minY: 0,   maxY: 1.0, halfX: 0.9, halfZ: 0.4 },
  overhead: { minY: 3.0, maxY: 4.0, halfX: 1.0, halfZ: 0.4 },
  // standable：车厢车顶可以站人（具体高度看实例上的 userData.roofY，两种车高不一样）。
  // 注意 minY/maxY/halfX/halfZ 这四个「契约数字」没有变 —— maxY 仍然是标准车厢的车顶。
  train:    { minY: 0,   maxY: 3.4, halfX: 1.4, halfZ: 4.0, standable: true },
  wall:     { minY: 0,   maxY: 3.6, halfX: 1.3, halfZ: 0.6 },
};

// 地铁车厢涂装（照「地铁跑酷」成排的彩车来）：车身 / 深色 / 名称。
// 三种涂装 = 三个对象池，但 userData.type 仍然是 'train'，所以碰撞、回收、E2E 断言全都不用改。
const TRAIN_LIVERIES = [
  { body: 0xffc93d, dark: 0xd99f12, name: 'yellow' },
  { body: 0x4f7cff, dark: 0x3358c4, name: 'blue' },
  { body: 0x57c15b, dark: 0x35893c, name: 'green' },
];

// ======================== 赛季与地图 ========================
// 第 1 赛季「阳光漫游」：玩家一开始就在跑的 4 张地图（糖果系，两侧是糖果树 / 棒棒糖 /
//   摩天轮 / 信号灯）。第 2 赛季「竹墨松林」：水墨系的 4 张，必须累计跑满 SEASONS[1].need
//   米才解锁，解锁后接在阳光漫游后面一起轮流 —— 于是「跑得更远 = 换一种画风」是连续的。
const SUN_COUNT = 4;
const SEASONS = [
  { id: 'sun', name: '阳光漫游', ico: '☀️', from: 0, count: 4, need: 0 },
  { id: 'ink', name: '竹墨松林', ico: '🎋', from: 4, count: 4, need: 10000 },
];

// 赛季解锁只看「累计里程统计」，不写进存档：省掉一次存档迁移，也杜绝存档被改坏后
// 赛季反复解锁 / 回退。写成顶层纯函数，是为了让假 DOM 闸门能直接抽出来断言。
function seasonUnlocked(si, data) {
  const s = SEASONS[si];
  if (!s) return false;
  if (!s.need) return true;
  const st = data && data.stats;
  const total = st && typeof st.totalDistance === 'number' ? st.totalDistance : 0;
  return total >= s.need;
}
// 一轮换要跑几张地图：没解锁竹墨松林只跑前 4 张，解锁后 8 张一起轮。
function themeCountFor(data) {
  return seasonUnlocked(1, data) ? SEASONS[1].from + SEASONS[1].count : SUN_COUNT;
}

const THEMES = [
  // cloud：云朵底色。云用不受光照影响的 Basic 材质，所以这里的颜色就是最终观感，
  // 不再被半球光的「地面色」打成灰石头。
  { name: '彩虹城市', sky: 0xbfe9ff, fog: 0xcfeaff, ground: 0xfff1a8, rail: 0xff7bac,
    side: 0x9be08a, far: 0xaecbe9, cloud: 0xffffff },
  { name: '糖果街道', sky: 0xffe3f1, fog: 0xffd6ec, ground: 0xffd1e8, rail: 0x7be08a,
    side: 0xffc2dd, far: 0xf0b6d4, cloud: 0xfff4fb },
  { name: '游乐园',   sky: 0xd6f5ff, fog: 0xcdeeff, ground: 0xa8e6a1, rail: 0xffd93d,
    side: 0xbfe8a8, far: 0xa9d0e6, cloud: 0xffffff },
  { name: '地铁轨道', sky: 0x2b2f3a, fog: 0x33384a, ground: 0x6b7280, rail: 0xffb300,
    side: 0x4a5160, far: 0x23262f, cloud: 0x8f9bb3 },
  // 竹墨松林赛季（v4.3）：四张地图统一走「水墨淡彩」——雾白 / 青灰打底，竹青与墨绿做主色。
  // 序号 0→3 沿用原来的「由明到暗」梯度（白天竹林 → 夜色竹林），
  // 于是既有的逐段难度观感一点没变，换掉的只是风格：糖果系 → 水墨系。
  // cloud：云朵底色。云用不受光照影响的 Basic 材质，所以这里的颜色就是最终观感，
  // 不再被半球光的「地面色」打成灰石头。
  { name: '墨竹初径', sky: 0xe9f2ec, fog: 0xf1f7f3, ground: 0xe4ecdd, rail: 0x5f8f63,
    side: 0xb3c9ab, far: 0xc3d3c8, cloud: 0xffffff },
  { name: '竹露清风', sky: 0xd5e7e2, fog: 0xe0eeea, ground: 0xc8dcc1, rail: 0x437f5f,
    side: 0x93b795, far: 0x9fb9ae, cloud: 0xeef7f3 },
  { name: '松涛深处', sky: 0x9db5aa, fog: 0xa9beb5, ground: 0x7f9d78, rail: 0x356b4e,
    side: 0x5f8b67, far: 0x6c8677, cloud: 0xd7e4dd },
  { name: '竹影夜灯', sky: 0x1b2825, fog: 0x22322e, ground: 0x3c4e46, rail: 0xe0ad63,
    side: 0x2b3a33, far: 0x15201d, cloud: 0x51665e },

];

// 世界地图：前 4 张沿用老规则（最高分门槛），后 4 张跟整个第 2 赛季一起解锁。
const WORLD_UNLOCK = [0, 400, 1000, 1800];
const WORLD_DESC = [
  '黄砖路 + 霓虹高楼，新手的起点。',
  '粉色糖霜地面，两侧是棒棒糖与糖果树。',
  '绿茵跑道，摩天轮与热气球缓缓转动。',
  '夜色轨道，信号灯闪烁，速度感拉满。',
  '墨竹夹道，宣纸似的路面，竹墨松林的入口。',
  '青灰天色、竹叶带露，两侧成丛翠竹沙沙作响。',
  '深绿松林，风声如涛，石灯笼散落在路旁。',
  '夜色竹林，暖灯点亮，竹影随路灯轻轻摇。',

];

// ------------------------------ 皮肤定义 ------------------------------
// v3.5：价格统一 ×5，并把 11 套皮肤按价格升序排 —— 商城从上往下读就是一条清晰的进阶曲线。
// 新增的 5 套各自带一套新头饰（choco / blossom / frost / band / star），
// 实现见 PlayerController._makeAccessory；星河龙还多了个 skin.aura 自定义光环颜色。
const SKINS = [
  { id: 'default',    name: '奶龙',     price: 0,     desc: '初始皮肤 · 圆润黄奶龙',
    body: 0xFFD93D, dark: 0xF0B429, belly: 0xFFF3C4, accent: 0xFF9A3D, hat: null },
  { id: 'blueberry',  name: '蓝莓龙',   price: 1500,  desc: '清爽蓝莓配色 + 棒球帽',
    body: 0x8CC9FF, dark: 0x5AA9E6, belly: 0xE4F4FF, accent: 0x3D7EFF, hat: 'cap' },
  { id: 'choco',      name: '巧克力龙', price: 2200,  desc: '可可棕配色 + 头顶巧克力棒',
    body: 0xB07A54, dark: 0x8A5A3B, belly: 0xF5E4D3, accent: 0x6B4226, hat: 'choco' },
  { id: 'strawberry', name: '草莓龙',   price: 3000,  desc: '草莓粉配色 + 蝴蝶结',
    body: 0xFFA6C1, dark: 0xF27EA6, belly: 0xFFE3EE, accent: 0xFF5A8A, hat: 'bow' },
  { id: 'matcha',     name: '抹茶龙',   price: 4500,  desc: '抹茶绿配色 + 叶子头饰',
    body: 0xA8E6A1, dark: 0x7BC47F, belly: 0xE8FBE0, accent: 0x4CAF50, hat: 'leaf' },
  { id: 'sakura',     name: '樱花龙',   price: 5000,  desc: '樱花粉配色 + 五瓣花环',
    body: 0xFFC2D6, dark: 0xF79EBE, belly: 0xFFF0F5, accent: 0xE85D91, hat: 'blossom' },
  { id: 'rainbow',    name: '彩虹龙',   price: 7500,  desc: '自带彩虹光环 + 派对帽',
    body: 0xFFD93D, dark: 0xFFB627, belly: 0xFFFFFF, accent: 0xB57EDC, hat: 'party', rainbow: true },
  { id: 'frost',      name: '冰霜龙',   price: 9000,  desc: '冰晶蓝配色 + 六棱冰冠',
    body: 0xBFE6F5, dark: 0x8FC9E6, belly: 0xF2FBFF, accent: 0x49A8D8, hat: 'frost' },
  { id: 'gold',       name: '黄金龙',   price: 15000, desc: '金属质感 + 黄金皇冠',
    body: 0xFFD24A, dark: 0xE0A800, belly: 0xFFF6CC, accent: 0xFFC107, hat: 'crown', metal: true },
  { id: 'ninja',      name: '忍者龙',   price: 20000, desc: '暗夜灰配色 + 忍者头带',
    body: 0x6E7280, dark: 0x4A4E5A, belly: 0xD8DCE6, accent: 0xD93A3A, hat: 'band' },
  { id: 'galaxy',     name: '星河龙',   price: 32000, desc: '星云紫金属质感 + 星冠 + 紫色光环',
    body: 0x8A7BE0, dark: 0x5F4FBE, belly: 0xEDE7FF, accent: 0x3ED6C8, hat: 'star', aura: 0x9C6BFF, metal: true },
];

// ------------------------------ 道具强化定义 ------------------------------
const UPGRADES = [
  { id: 'magnet',    name: '磁铁精通', base: 150, max: 5, desc: '磁铁持续时间 +2 秒/级' },
  { id: 'shield',    name: '护盾强化', base: 150, max: 5, desc: '护盾持续时间 +2 秒/级' },
  { id: 'coin',      name: '金币加成', base: 200, max: 5, desc: '金币价值 +10%/级' },
  { id: 'headstart', name: '开局冲刺', base: 300, max: 3, desc: '开局自动加速 3 秒/级' },
  { id: 'luck',      name: '幸运道具', base: 250, max: 3, desc: '道具出现更频繁/级' },
];

// ------------------------------ 成就定义 ------------------------------
const ACHIEVEMENTS = [
  { id: 'first_run',  name: '初次奔跑', desc: '完成第一局',        stat: 'runs',             goal: 1,    reward: 50 },
  { id: 'dist_1000',  name: '千里之行', desc: '累计奔跑 1000 米',  stat: 'totalDistance',    goal: 1000, reward: 100 },
  { id: 'dist_5000',  name: '长跑健将', desc: '累计奔跑 5000 米',  stat: 'totalDistance',    goal: 5000, reward: 300 },
  { id: 'coin_500',   name: '小金库',   desc: '累计收集 500 金币', stat: 'totalCoinsEarned', goal: 500,  reward: 150 },
  { id: 'coin_3000',  name: '富甲一方', desc: '累计收集 3000 金币', stat: 'totalCoinsEarned', goal: 3000, reward: 400 },
  { id: 'combo_20',   name: '连击达人', desc: '单局最高连击 20',   stat: 'bestCombo',        goal: 20,   reward: 200 },
  { id: 'power_10',   name: '道具控',   desc: '累计使用 10 个道具', stat: 'powerupsUsed',     goal: 10,   reward: 150 },
  { id: 'revive_3',   name: '顽强战士', desc: '累计复活 3 次',     stat: 'revives',          goal: 3,    reward: 200 },
  { id: 'rush_5',     name: '冲刺之王', desc: '通过 5 个冲刺段',    stat: 'rushCleared',      goal: 5,    reward: 300 },
];

// ============================================================================
//  工具 + 共享几何/材质缓存
// ============================================================================
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

// 分数/距离都是「速度 × dt」累加出来的浮点数（会出现 123.45678901234567 这种长尾），
// 所有显示到界面上的数字都必须先过这里取整，绝不能裸打印。
const int = (v) => { const n = Number(v); return isFinite(n) ? Math.floor(n) : 0; };
const byId = (id) => document.getElementById(id);

const MAT_CACHE = new Map();
function mat(color, params) {
  params = params || {};
  const key = color + '|' + JSON.stringify(params);
  if (!MAT_CACHE.has(key)) {
    const rest = {};
    for (const k in params) if (k !== 'std') rest[k] = params[k];
    MAT_CACHE.set(key, params.std
      ? new THREE.MeshStandardMaterial(Object.assign({ color }, rest))
      : new THREE.MeshLambertMaterial(Object.assign({ color }, rest)));
  }
  return MAT_CACHE.get(key);
}

const GEO_CACHE = new Map();
function geo(type) {
  const args = Array.prototype.slice.call(arguments, 1);
  const key = type + args.join(',');
  if (!GEO_CACHE.has(key)) {
    let g;
    // 注意：必须用展开运算符。写成 new X.apply(X, args) 会被解析成 new (X.apply)(...)，
    // 也就是把 Function.prototype.apply 当构造函数，运行时必然抛 "is not a constructor"。
    if (type === 'box') g = new THREE.BoxGeometry(...args);
    else if (type === 'cyl') g = new THREE.CylinderGeometry(...args);
    else if (type === 'sph') g = new THREE.SphereGeometry(...args);
    else if (type === 'cone') g = new THREE.ConeGeometry(...args);
    else if (type === 'torus') g = new THREE.TorusGeometry(...args);
    else if (type === 'capsule') g = new THREE.CapsuleGeometry(...args);
    GEO_CACHE.set(key, g);
  }
  return GEO_CACHE.get(key);
}

function starShape(outer, inner, points) {
  points = points || 5;
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}
let STAR_GEO = null;
function getStarGeo() {
  if (!STAR_GEO) {
    STAR_GEO = new THREE.ExtrudeGeometry(starShape(0.16, 0.075), { depth: 0.06, bevelEnabled: false });
    STAR_GEO.center();
  }
  return STAR_GEO;
}
let BOLT_GEO = null;
function getBoltGeo() {
  if (!BOLT_GEO) {
    const s = new THREE.Shape();
    s.moveTo(0.10, 0.50); s.lineTo(0.30, 0.50); s.lineTo(0.12, 0.14);
    s.lineTo(0.28, 0.14); s.lineTo(-0.12, -0.42); s.lineTo(0.02, 0.02);
    s.lineTo(-0.16, 0.02); s.closePath();
    BOLT_GEO = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false });
    BOLT_GEO.center();
  }
  return BOLT_GEO;
}
// ============================================================================
//  装饰物几何合并（降低 draw call）
//  一个装饰物往往由 5~20 个 Mesh 组成（树、楼、摩天轮…）。数量一多 draw call 就爆炸。
//  这里把一组 Mesh 按世界矩阵烘进一个 BufferGeometry，颜色写进顶点色，
//  于是 N 个 Mesh → 1 个 Mesh，可以用同样的性能摆下 4~5 倍的场景物件。
// ============================================================================
const MERGE_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });

// 判断 o 本身或其任一祖先是否在 list 中（用于跳过需要独立动画的子树）
function touchesAny(o, list) {
  if (!list || !list.length) return false;
  if (list.indexOf(o) >= 0) return true;
  for (let p = o.parent; p; p = p.parent) if (list.indexOf(p) >= 0) return true;
  return false;
}

// 把 sub 子树里「不被 keep 覆盖」的所有 Mesh 合并成 1 个 Mesh，挂回 sub。
// outMat 可选：指定合并后用的材质（默认是带顶点色的 Lambert）。
// 云朵就靠它换成不受光照影响的 Basic 材质，否则球体下半会被半球光的地面色打成灰石头。
function mergeSubtree(sub, keep, outMat) {
  sub.updateMatrixWorld(true);
  const meshes = [];
  sub.traverse((o) => { if (o.isMesh && !touchesAny(o, keep)) meshes.push(o); });
  if (meshes.length < 1) return null;
  if (meshes.length === 1) return meshes[0];   // 只有一个，无需合并

  const inv = new THREE.Matrix4().copy(sub.matrixWorld).invert();
  const parts = [];
  let total = 0;
  for (const m of meshes) {
    const src = m.geometry;
    const g = src.index ? src.toNonIndexed() : src.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const c = (m.material && m.material.color) || { r: 1, g: 1, b: 1 };
    // 自发光件（信号灯、窗户）直接把颜色提亮，合并后依然「像亮着」
    const em = m.material && m.material.emissive;
    const lit = em && (em.r + em.g + em.b) > 0.05 ? 1.25 : 1;
    const r = Math.min(1, c.r * lit), gg = Math.min(1, c.g * lit), b = Math.min(1, c.b * lit);
    for (let i = 0; i < n; i++) { col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
    total += n;
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let off = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    col.set(g.attributes.color.array, off * 3);
    off += g.attributes.position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  merged.computeBoundingSphere();

  for (const m of meshes) if (m.parent) m.parent.remove(m);
  const out = new THREE.Mesh(merged, outMat || MERGE_MAT);
  out.userData.merged = true;
  sub.add(out);
  return out;
}

// 合并整个装饰物：userData.anim 里的对象保持可独立动画（摩天轮旋转、气球浮动…）
function mergeDeco(g) {
  const anim = g.userData.anim || [];
  for (const a of anim) if (a.isGroup) mergeSubtree(a, null);   // 动画子树内部先各自合并
  mergeSubtree(g, anim);                                        // 其余部分合成 1 个
  return g;
}

const upgradeCost = (u, lv) => u.base * (lv + 1);

// 兑换码规范化：去掉所有空白、英文统一小写。
// JS 的 \s 覆盖全角空格 U+3000，所以玩家用全角空格分隔也能兑。
// 「是否已兑换」的判定也走同一个函数 —— 否则把码换个大小写就能重复领。
function normalizeCode(raw) {
  return String(raw == null ? '' : raw).replace(/\s+/g, '').toLowerCase();
}
// 在 CONFIG.REDEEM_CODES 里找码；找不到返回 null（不抛错，由调用方按「无效」处理）。
function findRedeemCode(raw) {
  const k = normalizeCode(raw);
  if (!k) return null;
  for (const c of CONFIG.REDEEM_CODES) if (normalizeCode(c.code) === k) return c;
  return null;
}

// 冲刺段判定：从 RUSH_FIRST 开始，每 RUSH_EVERY 米出现一段长 RUSH_LENGTH 的冲刺。
// 生成器（按区块距离决定障碍密度）和主循环（决定速度/金币倍率）共用这一份逻辑，
// 避免两边各写一套导致「看到在冲刺但不给倍率」这类错位。
function rushAt(distance) {
  if (distance < CONFIG.RUSH_FIRST) return { active: false, progress: 0, remain: 0 };
  const idx = Math.floor((distance - CONFIG.RUSH_FIRST) / CONFIG.RUSH_EVERY);
  const start = CONFIG.RUSH_FIRST + idx * CONFIG.RUSH_EVERY;
  const t = distance - start;
  const active = t < CONFIG.RUSH_LENGTH;
  return { active: active, progress: clamp(t / CONFIG.RUSH_LENGTH, 0, 1), remain: Math.max(0, CONFIG.RUSH_LENGTH - t) };
}

// 云朵用固定的小尺寸集，避免随机半径把几何缓存撑爆（geo() 按参数做键）
const CLOUD_RADII = [1.2, 1.6, 2.0];
const CLOUD_PUFF_COLORS = [0xffffff, 0xf7fbff, 0xeaf2ff];

// ============================================================================
//  SaveSystem v2 — 存档（货币 / 皮肤 / 强化 / 成就 / 排行 / 设置 / 统计）
// ============================================================================
class SaveSystem {
  constructor() {
    this.key = 'nailong_parkour_save_v2';
    this.data = this._defaults();
    this.load();
  }
  _defaults() {
    return {
      version: 2,
      best: 0, totalCoins: 0,
      muted: false, music: true, vibrate: true, quality: 'high',
      skin: 'default', skins: ['default'], startTheme: 0,
      upgrades: { magnet: 0, shield: 0, coin: 0, headstart: 0, luck: 0 },
      achv: {},
      codes: {},          // 已兑换的码：key = 规范化后的码，value = 兑换时间戳
      scores: [],
      stats: { runs: 0, totalDistance: 0, totalCoinsEarned: 0, powerupsUsed: 0, revives: 0, bestCombo: 0, rushCleared: 0 },
    };
  }
  load() {
    try {
      const raw = localStorage.getItem(this.key);
      const def = this._defaults();
      if (raw) {
        const d = JSON.parse(raw);
        // ⚠️ 顺序很重要：必须先把 defaults 里的嵌套对象「取出来」再做顶层浅合并。
        // 写成 Object.assign(def, d) 之后再 Object.assign(def.stats, d.stats) 是错的：
        // 顶层浅合并已经让 def.stats 指向存档里的那个对象，第二句就变成「自己合并自己」，
        // 于是旧存档里缺失的新统计字段（例如 rushCleared）永远补不回来 ——
        // stats.rushCleared++ 得到 NaN，界面显示 "NaN"，对应成就永久无法解锁。
        const defStats = def.stats;
        const defUpgrades = def.upgrades;
        this.data = Object.assign(def, d);
        this.data.upgrades = Object.assign(defUpgrades, d.upgrades || {});
        this.data.stats = Object.assign(defStats, d.stats || {});
        this.data.achv = d.achv || {};
        this.data.codes = d.codes || {};
        this.data.scores = d.scores || [];
        this.data.skins = Array.isArray(d.skins) ? d.skins : ['default'];
      } else {
        this.data = def;
        this._migrateV1();
      }
      this._normalize();
    } catch (e) { /* 忽略损坏存档 */ }
  }
  // 老版本 / 迁移过来的存档里 best、totalCoins、stats 可能带着小数长尾
  // （例如 123.45678901234567），统一在这里取整，界面与存档都保持干净。
  _normalize() {
    const d = this.data;
    d.best = int(d.best);
    d.totalCoins = int(d.totalCoins);
    d.startTheme = int(d.startTheme);
    // 兑换记录必须是普通对象：老存档没有这个字段、或被改坏成数组/字符串时兜回空表，
    // 否则 used[key] 这类写入会静默失败（数组上写字符串键不会抛错，也查不回来）。
    d.codes = (d.codes && typeof d.codes === 'object' && !Array.isArray(d.codes)) ? d.codes : {};
    const st = d.stats || {};
    for (const k in st) st[k] = int(st[k]);
    d.stats = st;
    const up = d.upgrades || {};
    for (const k in up) up[k] = int(up[k]);
    d.upgrades = up;
    d.scores = (Array.isArray(d.scores) ? d.scores : []).map((s) => ({
      score: int(s.score), dist: int(s.dist), coins: int(s.coins), date: s.date,
    }));
    this.save();
  }
  _migrateV1() {
    try {
      const raw = localStorage.getItem('nailong_parkour_save_v1');
      if (raw) {
        const o = JSON.parse(raw);
        this.data.best = o.best || 0;
        this.data.totalCoins = o.totalCoins || 0;
        this.data.muted = !!o.muted;
        this.save();
      }
    } catch (e) {}
  }
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {} }
  reset() { this.data = this._defaults(); this.save(); }
  setBest(score) {
    // 用取整后的值比较与存储：避免「123.5 分 > 123 分」被判定为新纪录，
    // 但界面上两者都显示成 123 的尴尬情况。
    const s = int(score);
    if (s > int(this.data.best)) { this.data.best = s; this.save(); return true; }
    return false;
  }
  addCoins(n) { this.data.totalCoins = int(this.data.totalCoins) + int(n); this.save(); }
  pushScore(score, dist, coins) {
    const d = new Date();
    const date = (d.getMonth() + 1) + '/' + d.getDate();
    this.data.scores.push({ score: int(score), dist: int(dist), coins: int(coins), date: date });
    this.data.scores.sort((a, b) => b.score - a.score);
    this.data.scores = this.data.scores.slice(0, 5);
    this.save();
  }
}

// ============================================================================
//  AudioManager — Web Audio 合成音效 + 真实音频文件的背景音乐
// ============================================================================
class AudioManager {
  constructor() {
    this.ctx = null; this.master = null; this.muted = false; this.musicOn = true; this.bgmTimer = null;
    // 背景音乐改用真实音频文件（CONFIG.BGM_SRC）；bgmTimer 从此只在「退回合成 BGM」时才用到。
    this.bgmEl = null; this.bgmFailed = false;
  }
  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
      }
    }
    this._initBGM();
  }
  // 只预热 BGM 文件、不创建 AudioContext（无手势时创建会触发浏览器告警）。
  // 游戏开局就调用，让玩家还在看菜单时先把音频下好。
  preloadBGM() { this._initBGM(); }
  // 创建 BGM 播放器（幂等）。用独立的 <audio> 元素而不是接进 Web Audio 图：
  // 既不依赖 AudioContext，也不受 createMediaElementSource 在 iOS 上那些怪癖影响。
  _initBGM() {
    if (this.bgmEl || this.bgmFailed || typeof Audio === 'undefined') return;
    const el = new Audio();
    const self = this;
    el.src = CONFIG.BGM_SRC;
    el.loop = CONFIG.BGM_LOOP;
    el.preload = 'auto';
    el.volume = CONFIG.BGM_VOLUME;
    el.muted = this.muted;
    el.addEventListener('error', function () {
      // 文件缺失 / 解不开：标记失败，下一次 startBGM() 会退回合成琶音，游戏不会变哑
      self.bgmFailed = true;
      self.bgmEl = null;
    });
    this.bgmEl = el;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.35;
    if (this.bgmEl) this.bgmEl.muted = m;   // BGM 不走 master，必须单独静音
  }
  setMusic(on) { this.musicOn = on; if (!on) this.stopBGM(); }
  tone(freq, dur, type, vol, when) {
    if (this.muted || !this.ctx) return;
    type = type || 'sine'; vol = vol === undefined ? 0.3 : vol; when = when || 0;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  jump()  { this.tone(420, 0.18, 'square', 0.25); this.tone(700, 0.18, 'square', 0.16, 0.02); }
  slide() { this.tone(320, 0.18, 'sawtooth', 0.2); this.tone(150, 0.2, 'sawtooth', 0.14, 0.02); }
  coin()  { this.tone(880, 0.08, 'square', 0.2); this.tone(1320, 0.1, 'square', 0.16, 0.05); }
  bottle(){ this.tone(660, 0.12, 'triangle', 0.22); this.tone(990, 0.12, 'triangle', 0.2, 0.05); this.tone(1320, 0.14, 'triangle', 0.18, 0.1); }
  hit()   { this.tone(150, 0.4, 'sawtooth', 0.35); this.tone(80, 0.5, 'square', 0.3, 0.05); }
  power() { this.tone(523, 0.15, 'triangle', 0.22); this.tone(659, 0.15, 'triangle', 0.22, 0.06); this.tone(784, 0.15, 'triangle', 0.22, 0.12); this.tone(1046, 0.15, 'triangle', 0.22, 0.18); }
  buy()   { this.tone(784, 0.14, 'triangle', 0.22); this.tone(1046, 0.14, 'triangle', 0.22, 0.07); this.tone(1318, 0.16, 'triangle', 0.22, 0.14); }
  // 机关：加速带是上扬的「嗖」，弹跳板是弹簧的「啵—嘤」
  boostPad() { this.tone(300, 0.3, 'sawtooth', 0.18); this.tone(900, 0.28, 'sawtooth', 0.14, 0.04); }
  spring()   { this.tone(220, 0.12, 'square', 0.24); this.tone(1200, 0.26, 'triangle', 0.2, 0.08); }
  // ---------------- 背景音乐 ----------------
  // 语义（v4.0 起音乐贯穿全局）：startBGM = 播放 / 继续（已在播就不打断）；
  // stopBGM = 暂停并记住进度，**现在只由「关掉音乐开关」触发** ——
  // 开跑 / 进结算 / 回主菜单 / 暂停，都不再停 BGM，主界面同样有音乐。
  _playBGM() {
    const el = this.bgmEl;
    if (!el) return;
    el.muted = this.muted;
    el.volume = CONFIG.BGM_VOLUME;
    const p = el.play();
    // 自动播放被拦时 play() 会返回 rejected Promise。静默吞掉 —— 既不让未处理拒绝
    // 冒到控制台，也不退回合成音（那会让玩家在「等一次点击」和「听错音乐」之间被误导）；
    // 下一次由用户手势触发的 startBGM 会自然接上。
    if (p && typeof p.catch === 'function') p.catch(function () {});
  }
  // 兜底：原来那套振荡器琶音，仅在 libs/bgm.m4a 加载失败时使用
  _startSynthBGM() {
    if (this.bgmTimer || !this.ctx || !this.musicOn) return;
    const scale = [523, 587, 659, 784, 880, 784, 659, 587];
    let step = 0;
    const self = this;
    this.bgmTimer = setInterval(function () {
      if (self.muted || !self.ctx || !self.musicOn) return;
      const f = scale[step % scale.length];
      self.tone(f, 0.22, 'sine', 0.10);
      if (step % 4 === 0) self.tone(f / 2, 0.4, 'triangle', 0.08);
      step++;
    }, 280);
  }
  startBGM() {
    if (!this.musicOn) return;
    this._initBGM();
    if (this.bgmEl) { this._playBGM(); return; }
    this._startSynthBGM();
  }
  stopBGM() {
    if (this.bgmEl) { try { this.bgmEl.pause(); } catch (e) { /* 忽略 */ } }
    if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; }
  }
}

// ============================================================================
//  InputManager — 键盘 + 触摸滑动
// ============================================================================
class InputManager {
  constructor(domElement, callbacks) {
    this.cb = callbacks;
    this.dom = domElement;
    this.touchStart = null;
    this.swipeThreshold = 28;
    this._bind();
  }
  _bind() {
    const cb = this.cb;
    window.addEventListener('keydown', (e) => {
      // 焦点在文本输入框（兑换码）里时让路：否则敲空格会被下面的 preventDefault 吃掉，
      // 敲 WASD 会变成变道 / 跳跃。Escape 只做「取消聚焦」，再按一次才轮到暂停 / 关弹窗。
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) {
        if (e.code === 'Escape') { try { ae.blur(); } catch (err) { /* 忽略 */ } }
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') cb.left();
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') cb.right();
      else if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') { cb.jump(); e.preventDefault(); }
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') cb.slide();
      else if (e.code === 'KeyP' || e.code === 'Escape') cb.pause();
    });
    this.dom.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this.touchStart = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    this.dom.addEventListener('touchend', (e) => {
      if (!this.touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - this.touchStart.x;
      const dy = t.clientY - this.touchStart.y;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      if (Math.max(adx, ady) > this.swipeThreshold) {
        if (adx > ady) { if (dx < 0) cb.left(); else cb.right(); }
        else { if (dy < 0) cb.jump(); else cb.slide(); }
      }
      this.touchStart = null;
    }, { passive: true });
  }
}

// ============================================================================
//  PlayerController — 奶龙（支持皮肤换装 / 头饰 / 光环）
// ============================================================================
class PlayerController {
  constructor(scene, initialSkinId) {
    this.scene = scene;
    this.laneIndex = 1;
    this.targetX = CONFIG.LANE_X[1];
    this.group = new THREE.Group();
    this.rig = new THREE.Group();
    this.group.add(this.rig);

    this.roles = { body: [], dark: [], belly: [], accent: [] };
    this.accessory = null;
    this._buildDragon();
    this.applySkin(initialSkinId || 'default');
    scene.add(this.group);

    this.vy = 0;
    this.onGround = true;
    this.platform = null;   // 当前踩着的「可站立平台」（车厢车顶），null = 站在赛道上
    this.sliding = false;
    this.slideTimer = 0;
    this.runTime = 0;
    this.blinkTimer = 0;
    this.idleTime = 0;

    this.invincibleTimer = 0;
    this.shieldTimer = 0;
    this.shieldMax = CONFIG.SHIELD_TIME;
    this.magnetTimer = 0;
    this.speedBoostTimer = 0;
    this.doubleTimer = 0;
    this.padBoostTimer = 0;   // 加速带（比「加速」道具更猛，单独计时以便分别播报）

    this.combo = 0;
    this.comboTimer = 0;
    this.bestCombo = 0;
  }
  // ==========================================================================
  //  角色建模 —— v3.7：按三视图重做（第二版：比例对齐）
  // ==========================================================================
  // v3.6 已经把「没有尾巴 / 没有角 / 没有耳朵 / 没有吻部、梨形一体、绿眼睛、
  // 奶白肚皮、深色手脚」这些**特征**做对了，但把比例量出来之后发现三处明显偏差：
  //   ① 头宽了 43%（参考图是「大梨形身体 + 小圆头」，头只有身体最宽处的 1/3）
  //   ② 手臂整条埋进躯干里 —— 前视图上手臂和身体合成一条边，看上去就像没有手
  //   ③ 裆太低、脚掌太短太靠内
  // 这一版按下面这些**从参考图里量出来**的数字重做（h = 相对总高的比例）：
  //   头顶        h=1.00（总高 2.75，与旧模型一致 → 跳跃 / 滑铲 / 站上车顶的比例不变）
  //   眼睛中心    h=0.926 → y=2.549；双眼外缘总跨度 0.149H，虹膜直径 0.041H
  //   头最宽      半宽 0.102H → 0.278
  //   躯干最宽    h=0.50，半宽 0.235H → 0.640（含手臂时整幅宽 0.601H）
  //   裆（两腿分开）h=0.28 → y=0.79
  //   手臂外缘    h=0.45~0.55 达 0.30H → 0.818，且与躯干之间**留出可见缝隙**
  //   脚掌        前后长 0.19H → 0.512，宽 0.077H → 0.21
  //   侧面最厚    0.390H → 1.063
  //   奶白肚皮    宽 0.417H → 1.136，高度区间 h[0.449,0.708] → y[1.248,1.955]
  //
  // 两个关键手法：
  //   · _sweep() 把球体按高度采样改写成旋转体。水平半宽由 BODY_KEYS 给，
  //     前后厚度由 ZF_KEYS / ZB_KEYS 给 —— **前后厚度必须是高度的函数**：
  //     参考图里头比身体「厚」（h=0.90 处前后 0.62 > 左右 0.56），
  //     而身体比头「宽」；用一个恒定的前后比两头都照顾不到。
  //     而且参考图侧视里胸口是**平**的（h=0.75 处前方只有半径的 0.51），
  //     后背是**圆**的（同一高度有 0.91），所以前后要分开给两套关键帧。
  //   · 手臂必须真的伸出躯干之外。参考图 h=0.35 处躯干半宽 0.490、手臂占
  //     [0.578, 0.736]，中间有一条 0.088 的空隙；手臂贴着身体是绝对不行的。
  //
  // 皮肤色角色（roles）与参考图的对应关系：
  //   body   → 身体 / 头 / 四肢 / 脚掌（参考图的黄色主体）
  //   belly  → 肚子上的奶白椭圆斑
  //   dark   → 手掌 + 脚趾尖（参考图里的深灰褐色末端）
  //   accent → 嘴巴这条细弧线；眼睛的绿色是固定的，不随皮肤走
  _buildDragon() {
    const parts = new THREE.Group();
    parts.rotation.y = Math.PI;   // 面朝前进方向(-z)
    parts.scale.setScalar(CONFIG.PLAYER_SCALE);  // 体型缩放（视觉）
    this.parts = parts;           // 暴露出来便于调试 / 自动化测量
    this.rig.add(parts);

    const ph = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
    // 眼睛用固定色：参考图里就是绿眼睛 + 深色外圈 + 白高光，不随皮肤变
    const EYE_RIM = mat(0x1C4A22);
    const EYE_IRIS = mat(0x35C24A, { std: true, emissive: 0x1E7A2C, emissiveIntensity: 0.25 });
    const EYE_PUPIL = mat(0x10240F);
    const EYE_GLINT = mat(0xFFFFFF);

    // ---- 横向轮廓：身体 + 头一体 ----
    // t = 0 → y = 0.79（裆）；t = 1 → y = 2.75（头顶）
    const B_Y0 = 0.79, B_H = 1.96;
    const BODY_KEYS = [
      [0.000, 0.000],
      [0.020, 0.190],
      [0.050, 0.330],
      [0.096, 0.490],   // 参考 h=0.35：躯干半宽
      [0.166, 0.554],   // 参考 h=0.40
      [0.235, 0.589],   // 参考 h=0.45
      [0.305, 0.640],   // 参考 h=0.50：躯干最宽
      [0.374, 0.652],   // 参考 h=0.55
      [0.444, 0.643],
      [0.513, 0.613],
      [0.583, 0.578],   // 参考 h=0.70
      [0.652, 0.511],   // 参考 h=0.75：头肩过渡
      [0.722, 0.382],   // 参考 h=0.80
      [0.792, 0.311],   // 参考 h=0.85
      [0.861, 0.278],   // 参考 h=0.90：头最宽
      [0.931, 0.245],   // 参考 h=0.95
      [0.966, 0.185],
      [0.988, 0.108],
      [1.000, 0.000],
    ];
    // ---- 前后厚度（占该高度半径的比例）----
    // 侧视图量出来：胸口平、后背圆、头前后比身体厚。
    const ZF_KEYS = [
      [0.000, 0.82], [0.100, 0.79], [0.170, 0.85], [0.240, 0.87], [0.310, 0.83],
      [0.440, 0.73], [0.530, 0.65], [0.600, 0.545], [0.660, 0.505],
      [0.730, 0.645], [0.800, 0.99], [0.870, 1.13], [0.940, 1.08], [1.000, 1.08],
    ];
    const ZB_KEYS = [
      [0.000, 0.82], [0.100, 0.83], [0.170, 0.87], [0.240, 0.88], [0.310, 0.83],
      [0.440, 0.81], [0.530, 0.83], [0.600, 0.86], [0.660, 0.91],
      [0.730, 1.11], [0.800, 1.17], [0.870, 1.10], [0.940, 0.91], [1.000, 0.91],
    ];
    const rOf = this._profile(BODY_KEYS);
    const zF = this._profile(ZF_KEYS);
    const zB = this._profile(ZB_KEYS);

    const body = new THREE.Mesh(this._sweep(BODY_KEYS, B_H, 24, 28, zF, zB), ph());
    body.position.y = B_Y0 + B_H / 2;
    parts.add(body); this.roles.body.push(body);

    // ---- 肚子上的奶白椭圆斑 ----
    // 参考图里它的宽度是身宽的 0.417H/0.601H ≈ 70%，高度区间换算成 t 是 [0.234, 0.594]。
    // 方位半角 = asin(0.878) ≈ 1.07：这样斑块边缘正好落在测量到的宽度上。
    const belly = new THREE.Mesh(
      this._bellyGeo(BODY_KEYS, B_H, 0.234, 0.594, 1.07, zF, zB, 20, 16), ph());
    belly.position.y = B_Y0 + B_H / 2;
    parts.add(belly); this.roles.belly.push(belly);

    // ---- 眼睛：贴在头的正前方，左右镜像 ----
    // 眼心落在头部曲面上，再把整只眼睛绕 Y 转到与曲面相切 ——
    // 否则正视看着还行、稍微侧一点就变成贴在球上的贴纸。
    const EYE_Y = 2.549, EYE_X = 0.147;
    const eyeT = (EYE_Y - B_Y0) / B_H;
    const eyeA = rOf(eyeT);
    const eyeUX = Math.min(0.95, EYE_X / eyeA);
    const eyeUZ = Math.sqrt(Math.max(0, 1 - eyeUX * eyeUX));
    const eyeB = eyeA * (zB(eyeT) + (zF(eyeT) - zB(eyeT)) * (eyeUZ + 1) * 0.5);
    const eyeZ = eyeUZ * eyeB;
    const eyeYaw = Math.atan2(EYE_X / (eyeA * eyeA), eyeZ / (eyeB * eyeB));
    for (const sx of [-1, 1]) {
      const eg = new THREE.Group();
      eg.position.set(sx * EYE_X, EYE_Y, eyeZ);
      eg.rotation.y = sx * eyeYaw;
      const layer = (r, m, z, flat, ox, oy) => {
        const mesh = new THREE.Mesh(geo('sph', r, 16, 8), m);
        mesh.scale.set(1, 1, flat);
        mesh.position.set(ox || 0, oy || 0, z);
        eg.add(mesh);
        return mesh;
      };
      // 一层层沿法线往前叠：外圈 → 虹膜 → 瞳孔 → 高光。
      // 每一层的 z 都要比上一层再前一点，否则会被上一层整个包住、根本看不见。
      layer(0.070, EYE_RIM, 0.000, 0.42);
      layer(0.058, EYE_IRIS, 0.016, 0.42);
      layer(0.034, EYE_PUPIL, 0.034, 0.42);
      layer(0.016, EYE_GLINT, 0.046, 0.55, -0.020, 0.020);
      parts.add(eg);
    }

    // ---- 嘴巴：一条很短的细弧线（参考图里只有 h[0.873,0.877] 这么一点点暗色）----
    const MOUTH_Y = 2.409;
    const mouthT = (MOUTH_Y - B_Y0) / B_H;
    const mouthZ = rOf(mouthT) * (zB(mouthT) + (zF(mouthT) - zB(mouthT)));
    const mouth = new THREE.Mesh(geo('torus', 0.055, 0.011, 6, 14, Math.PI), ph());
    mouth.rotation.z = Math.PI;   // 半环转成朝上的弧 = 微笑
    mouth.position.set(0, MOUTH_Y, mouthZ + 0.004);
    parts.add(mouth); this.roles.accent.push(mouth);

    // ---- 手臂：短粗、外八，末端是深色的手 ----
    // 位置是量出来的：参考图 h=0.35 处手臂占 [0.578,0.736]、h=0.45 处 [0.605,0.807]，
    // 也就是肩在 x≈0.55、手在 x≈0.72，因此整条手臂要往外倾约 9.5°。
    // 手的位置在 y≈1.03（参考图 h=0.33~0.42），不能像旧版那样垂到膝盖。
    const ARM_KEYS = [
      [0.000, 0.000], [0.030, 0.072], [0.100, 0.078], [0.240, 0.090],
      [0.450, 0.098], [0.700, 0.108], [0.900, 0.118], [0.970, 0.112], [1.000, 0.000],
    ];
    const ARM_LEN = 0.98;
    const armGeo = this._sweep(ARM_KEYS, ARM_LEN, 12, 16, 1, 1);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(sx * 0.55, 1.99, 0.06);
      arm.rotation.z = sx * 0.166;   // 9.5°：底端朝外撇到手的位置
      arm.rotation.x = -0.05;        // 略微前垂
      const am = new THREE.Mesh(armGeo, ph());
      am.position.y = -ARM_LEN / 2 + 0.02;   // 顶端圆头埋进肩膀里
      arm.add(am); this.roles.body.push(am);
      const hand = new THREE.Mesh(geo('sph', 0.092, 14, 12), ph());
      hand.scale.set(1.0, 0.95, 1.10);
      hand.position.set(0, -ARM_LEN + 0.02, 0.02);
      arm.add(hand); this.roles.dark.push(hand);
      // 一小撮拇指，免得手变成一个纯球
      const thumb = new THREE.Mesh(geo('sph', 0.042, 8, 8), ph());
      thumb.scale.set(1, 1.25, 1);
      thumb.position.set(-sx * 0.070, -ARM_LEN + 0.075, 0.075);
      arm.add(thumb); this.roles.dark.push(thumb);
      parts.add(arm);
      if (sx < 0) this.armL = arm; else this.armR = arm;
    }

    // ---- 腿 + 脚：脚掌上长三颗深色脚趾 ----
    // 裆抬到 y=0.79（参考图 h=0.28），腿因此比旧版长；腿心 x=±0.29，
    // 向下外八到脚踝处 x≈0.37（参考图 h=0.10 处踝心 0.380）。
    const LEG_KEYS = [
      [0.000, 0.000], [0.030, 0.050], [0.130, 0.064], [0.228, 0.070],
      [0.403, 0.101], [0.577, 0.127], [0.751, 0.158], [0.900, 0.176], [0.965, 0.170], [1.000, 0.000],
    ];
    const LEG_LEN = 0.78;
    const legGeo = this._sweep(LEG_KEYS, LEG_LEN, 12, 16, 1, 1);
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(sx * 0.29, 0.90, 0.00);
      leg.rotation.z = sx * 0.10;
      const lm = new THREE.Mesh(legGeo, ph());
      lm.position.y = -LEG_LEN / 2 + 0.02;
      leg.add(lm); this.roles.body.push(lm);

      // 脚掌与脚趾要分开挂：脚掌是压扁的（scale 0.70/0.55/1.70），
      // 脚趾若是它的子节点就会被一起压扁。所以中间垫一个只带旋转的空组。
      // 脚掌中心前移 0.09：参考图里脚往前伸 0.347、往后只有 0.166。
      // 脚掌是**扁长脚垫**而不是椭球：参考图里脚在 h=0.05 处就已经有全长 0.188H，
      // 椭球在那个高度已经收掉四分之一长度了。所以把 y 压得更扁（半高 0.10）
      // 而 z 保持不变（前后全长 0.513），同一高度读出来的长度才对得上。
      const footPivot = new THREE.Group();
      footPivot.position.set(sx * 0.06, -LEG_LEN, 0.09);
      footPivot.rotation.y = sx * 0.30;   // 脚尖明显外八
      const foot = new THREE.Mesh(geo('sph', 0.15, 16, 12), ph());
      foot.scale.set(0.70, 0.67, 1.71);
      footPivot.add(foot); this.roles.body.push(foot);
      for (let i = -1; i <= 1; i++) {
        const toe = new THREE.Mesh(geo('sph', 0.048, 10, 8), ph());
        toe.scale.set(1, 0.75, 1.35);
        toe.position.set(i * 0.062, -0.035, 0.225);
        footPivot.add(toe); this.roles.dark.push(toe);
      }
      leg.add(footPivot);
      parts.add(leg);
      if (sx < 0) this.legL = leg; else this.legR = leg;
    }

    // 参考图的三视图里**没有尾巴**：侧视与背视的背部都是光滑的一条线。
    // 这里保留一个空组，只是为了不动 update() / idle() 里那几行 tail.rotation 动画代码。
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.85, -0.30);
    parts.add(this.tail);

    // 头饰挂点：头顶 = 0.79 + 1.96 = 2.75
    this.headAnchor = new THREE.Group();
    this.headAnchor.position.set(0, 2.72, 0.0);
    parts.add(this.headAnchor);

    this.shieldMesh = new THREE.Mesh(geo('sph', 1.25, 18, 18),
      mat(0x4fc3f7, { transparent: true, opacity: 0.22, depthWrite: false }));
    // 护盾/光环挂在 group 上（不在 parts 里），需要单独跟随体型缩放
    this.shieldMesh.scale.setScalar(CONFIG.PLAYER_SCALE);
    this.shieldMesh.position.y = 1.25 * CONFIG.PLAYER_SCALE;
    this.shieldMesh.visible = false;
    this.group.add(this.shieldMesh);

    this.aura = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.08, 8, 40),
      new THREE.MeshStandardMaterial({ color: 0xff7bac, emissive: 0xff7bac, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 }));
    this.aura.rotation.x = Math.PI / 2;
    this.aura.scale.setScalar(CONFIG.PLAYER_SCALE);
    this.aura.position.y = 0.14 * CONFIG.PLAYER_SCALE;
    this.aura.visible = false;
    this.group.add(this.aura);
  }

  // 轮廓关键帧 → 取值函数（线性插值）。
  // 环距是 1/heightSeg，环够密（本模型 28 环）线性插值就足够光滑。
  _profile(keys) {
    return (t) => {
      if (t <= keys[0][0]) return keys[0][1];
      for (let i = 1; i < keys.length; i++) {
        if (t <= keys[i][0]) {
          const a = keys[i - 1], b = keys[i];
          const k = (b[0] - a[0]) > 1e-9 ? (t - a[0]) / (b[0] - a[0]) : 0;
          return a[1] + (b[1] - a[1]) * k;
        }
      }
      return keys[keys.length - 1][1];
    };
  }

  // 把球体按「高度采样轮廓」改写成旋转体：t = 0 是底、t = 1 是顶。
  // keys 的 t 必须升序，两端 r 必须是 0（闭合）。
  // zF / zB 是**前后厚度占该高度半径的比例**（可以是数值，也可以是 t 的函数）：
  //   z = uz * r * (uz >= 0 ? zF : zB)，中间线性过渡 ——
  //   这样胸口可以平、后背可以圆，正是参考图侧视的样子。
  _sweep(keys, height, radialSeg, heightSeg, zF, zB) {
    const zFF = typeof zF === 'function' ? zF : () => zF;
    const zBB = typeof zB === 'function' ? zB : () => zB;
    const g = new THREE.SphereGeometry(1, radialSeg, heightSeg);
    const pos = g.attributes.position;
    const rAt = this._profile(keys);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const t = (y + 1) / 2;
      const horiz = Math.sqrt(x * x + z * z);
      const ux = horiz > 1e-6 ? x / horiz : 0;
      const uz = horiz > 1e-6 ? z / horiz : 0;
      const r = rAt(t);
      // uz=+1（正前方）→ zF；uz=-1（正后方）→ zB
      const zr = zBB(t) + (zFF(t) - zBB(t)) * (uz + 1) * 0.5;
      pos.setX(i, ux * r);
      pos.setZ(i, uz * r * zr);
      pos.setY(i, (t - 0.5) * height);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    // 顶点被挪过就必须重算包围球，否则外扩出去的部分会被视锥剔除
    g.computeBoundingSphere();
    return g;
  }

  // 肚子上的奶白椭圆斑：用同一个轮廓函数生成一片「贴着身体的壳」，
  // 保证任何角度都不穿模、不悬空。边界在 (高度 t, 方位角 a) 空间里是一条椭圆，
  // 投影出来就是干净的卵形 —— 拿两个球相交是给不出这种边界的。
  _bellyGeo(keys, height, t0, t1, halfAngle, zF, zB, aroundSeg, ringSeg) {
    const zFF = typeof zF === 'function' ? zF : () => zF;
    const zBB = typeof zB === 'function' ? zB : () => zB;
    const rAt = this._profile(keys);
    const tMid = (t0 + t1) / 2, tHalf = (t1 - t0) / 2;
    const off = 0.012;   // 往外浮一点：贴得太死会和身体表面 z-fighting
    const pos = [], idx = [];
    for (let i = 0; i <= ringSeg; i++) {
      const t = t0 + (t1 - t0) * (i / ringSeg);
      // 越靠近上下两端允许的方位角越小 → 边界是个椭圆
      const kk = Math.sqrt(Math.max(0, 1 - Math.pow((t - tMid) / tHalf, 2)));
      const aMax = halfAngle * kk;
      for (let j = 0; j <= aroundSeg; j++) {
        const a = -aMax + 2 * aMax * (j / aroundSeg);
        const ux = Math.sin(a), uz = Math.cos(a);
        const r = rAt(t) + off;
        const zr = zBB(t) + (zFF(t) - zBB(t)) * (uz + 1) * 0.5;
        pos.push(ux * r, (t - 0.5) * height, uz * r * zr);
      }
    }
    for (let i = 0; i < ringSeg; i++) {
      for (let j = 0; j < aroundSeg; j++) {
        const a = i * (aroundSeg + 1) + j;
        const b = a + aroundSeg + 1;
        // 绕序：t 增大朝上、a 增大朝 +x ⇒ 这个顺序让法线朝外(+z)。
        // 写反了斑块会因为背面剔除而整个看不见。
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  applySkin(skinId) {
    let skin = SKINS[0];
    for (const s of SKINS) if (s.id === skinId) skin = s;
    this.skin = skin;
    const metal = !!skin.metal;
    const mk = (c) => metal
      ? new THREE.MeshStandardMaterial({ color: c, metalness: 0.85, roughness: 0.22 })
      : new THREE.MeshLambertMaterial({ color: c });
    const assign = (role, color) => {
      const meshes = this.roles[role];
      const olds = new Set();
      for (const m of meshes) olds.add(m.material);
      const m2 = mk(color);
      for (const mesh of meshes) mesh.material = m2;
      olds.forEach((o) => { if (o && o.dispose) o.dispose(); });
    };
    assign('body', skin.body);
    assign('dark', skin.dark);
    assign('belly', skin.belly);
    assign('accent', skin.accent);
    if (this.accessory) { this.headAnchor.remove(this.accessory); this.accessory = null; }
    if (skin.hat) {
      this.accessory = this._makeAccessory(skin.hat, skin);
      this.accessory.scale.setScalar(CONFIG.HAT_FIT);   // 新头更小，头饰同比收紧
      this.headAnchor.add(this.accessory);
    }
    // 光环：彩虹龙用默认粉色，其它皮肤可以用 skin.aura 指定自己的颜色（星河龙 = 紫色）
    const auraColor = skin.aura != null ? skin.aura : 0xff7bac;
    this.aura.material.color.setHex(auraColor);
    this.aura.material.emissive.setHex(auraColor);
    this.aura.visible = !!(skin.rainbow || skin.aura != null);
  }

  // 头饰：全部走 geo() / mat() 缓存。原来是每次换皮肤都 new 一份几何 + 材质、
  // 换了却不 dispose —— 皮肤多了以后反复切换会一直漏。缓存化之后就没有东西需要释放。
  _makeAccessory(hat, skin) {
    const g = new THREE.Group();
    const accent = mat(skin.accent);
    const gold = mat(0xFFC93D, { std: true, metalness: 0.9, roughness: 0.2 });
    if (hat === 'cap') {
      const dome = new THREE.Mesh(geo('sph', 0.46, 16, 12), accent);
      dome.scale.set(1, 0.72, 1); dome.position.y = 0.05; g.add(dome);
      const brim = new THREE.Mesh(geo('box', 0.78, 0.07, 0.5), accent);
      brim.position.set(0, 0.0, 0.4); g.add(brim);
      const btn = new THREE.Mesh(geo('sph', 0.07, 8, 8), mat(0xffffff));
      btn.position.y = 0.36; g.add(btn);
    } else if (hat === 'bow') {
      for (const sx of [-0.2, 0.2]) {
        const petal = new THREE.Mesh(geo('cone', 0.17, 0.34, 8), mat(0xFF7BAC));
        petal.rotation.z = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
        petal.position.set(sx, 0.12, 0); g.add(petal);
      }
      const knot = new THREE.Mesh(geo('sph', 0.1, 10, 10), mat(0xFF5A8A));
      knot.position.y = 0.12; g.add(knot);
    } else if (hat === 'leaf') {
      const stem = new THREE.Mesh(geo('cyl', 0.03, 0.03, 0.22, 6), mat(0x7BC47F));
      stem.position.y = 0.14; g.add(stem);
      const leaf = new THREE.Mesh(geo('cone', 0.16, 0.44, 8), mat(0x7BE08A));
      leaf.rotation.z = -0.5; leaf.position.set(0.1, 0.34, 0); g.add(leaf);
    } else if (hat === 'party') {
      const cone = new THREE.Mesh(geo('cone', 0.3, 0.62, 14), accent);
      cone.position.y = 0.3; g.add(cone);
      const pom = new THREE.Mesh(geo('sph', 0.1, 10, 10), mat(0xffffff));
      pom.position.y = 0.66; g.add(pom);
    } else if (hat === 'crown') {
      const band = new THREE.Mesh(geo('cyl', 0.3, 0.32, 0.16, 14), gold);
      band.position.y = 0.1; g.add(band);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const spike = new THREE.Mesh(geo('cone', 0.07, 0.24, 6), gold);
        spike.position.set(Math.cos(a) * 0.26, 0.28, Math.sin(a) * 0.26); g.add(spike);
      }
      const jewel = new THREE.Mesh(geo('sph', 0.08, 10, 10),
        mat(0xff3b30, { std: true, emissive: 0xff3b30, emissiveIntensity: 0.7 }));
      jewel.position.set(0, 0.1, 0.32); g.add(jewel);
    } else if (hat === 'choco') {
      // 巧克力龙：三根巧克力棒斜插在头顶（直立会像蜡烛，斜一点才像零食），底下加一圈奶油色糖纸
      for (let i = -1; i <= 1; i++) {
        const bar = new THREE.Mesh(geo('box', 0.11, 0.52, 0.09), mat(0x6B4226));
        bar.position.set(i * 0.16, 0.27, i * 0.03);
        bar.rotation.z = i * 0.24;
        g.add(bar);
      }
      const wrap = new THREE.Mesh(geo('cyl', 0.19, 0.22, 0.15, 12), mat(0xF5E4D3));
      wrap.position.y = 0.06; g.add(wrap);
    } else if (hat === 'blossom') {
      // 樱花龙：五瓣花环 —— 花瓣用压扁的球，绕头顶一圈 + 中间一颗黄色花蕊
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const petal = new THREE.Mesh(geo('sph', 0.14, 10, 8), mat(0xFFF0F5));
        petal.scale.set(1, 0.5, 1.3);
        petal.position.set(Math.cos(a) * 0.31, 0.1, Math.sin(a) * 0.31);
        petal.rotation.y = -a;
        g.add(petal);
      }
      const core = new THREE.Mesh(geo('sph', 0.09, 10, 10), mat(0xFFE066));
      core.position.y = 0.2; g.add(core);
    } else if (hat === 'frost') {
      // 冰霜龙：六棱冰冠 —— 6 根六棱柱高低交错（顶面收到 0.001 就是尖的），底下套一圈冰环
      const ice = mat(0xE8F8FF, { std: true, emissive: 0x6fc9ff, emissiveIntensity: 0.45, transparent: true, opacity: 0.92 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const h = i % 2 === 0 ? 0.46 : 0.3;
        const spike = new THREE.Mesh(geo('cyl', 0.001, 0.075, h, 6), ice);
        spike.position.set(Math.cos(a) * 0.27, h / 2, Math.sin(a) * 0.27);
        g.add(spike);
      }
      const ring = new THREE.Mesh(geo('torus', 0.29, 0.045, 8, 20), ice);
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.02; g.add(ring);
    } else if (hat === 'band') {
      // 忍者龙：一圈头带 + 两条向后飘的布条（倾角固定，不做布料模拟），正面一枚白色护额
      const loop = new THREE.Mesh(geo('torus', 0.31, 0.055, 8, 22), accent);
      loop.rotation.x = Math.PI / 2; loop.position.y = 0.14; g.add(loop);
      for (const tx of [-0.07, 0.07]) {
        const tail = new THREE.Mesh(geo('box', 0.08, 0.62, 0.03), accent);
        tail.position.set(tx, -0.1, -0.33);
        tail.rotation.x = -0.55; tail.rotation.z = tx > 0 ? -0.18 : 0.18;
        g.add(tail);
      }
      const badge = new THREE.Mesh(geo('sph', 0.075, 10, 10),
        mat(0xffffff, { std: true, emissive: 0xffffff, emissiveIntensity: 0.45 }));
      badge.scale.set(1, 1, 0.45); badge.position.set(0, 0.14, 0.31); g.add(badge);
    } else if (hat === 'star') {
      // 星河龙：星冠 —— 中间一颗大星 + 一圈小星点。星形几何直接复用金币那颗（getStarGeo 有缓存）
      const starMat = mat(skin.accent, { std: true, emissive: skin.accent, emissiveIntensity: 0.55, metalness: 0.5, roughness: 0.3 });
      const big = new THREE.Mesh(getStarGeo(), starMat);
      big.scale.setScalar(1.55); big.position.set(0, 0.42, 0.02); g.add(big);
      const base = new THREE.Mesh(geo('cyl', 0.3, 0.34, 0.1, 16), gold);
      base.position.y = 0.07; g.add(base);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.6;
        const dot = new THREE.Mesh(getStarGeo(), starMat);
        dot.scale.setScalar(0.5);
        dot.position.set(Math.cos(a) * 0.26, 0.17, Math.sin(a) * 0.26);
        dot.rotation.y = a;
        g.add(dot);
      }
    }
    return g;
  }

  reset() {
    this.laneIndex = 1;
    this.targetX = CONFIG.LANE_X[1];
    this.group.position.set(0, 0, 0);
    this.vy = 0; this.onGround = true;
    this.platform = null;
    this.sliding = false; this.slideTimer = 0;
    this.invincibleTimer = 0; this.shieldTimer = 0;
    this.magnetTimer = 0; this.speedBoostTimer = 0; this.doubleTimer = 0;
    this.padBoostTimer = 0;
    this.combo = 0; this.comboTimer = 0; this.bestCombo = 0;
    this.rig.scale.set(1, 1, 1);
    this.rig.rotation.set(0, 0, 0);
    this.rig.position.y = 0;
    this.rig.visible = true;
    this.blinkTimer = 0;
  }

  moveLeft()  { this.laneIndex = clamp(this.laneIndex - 1, 0, 2); this.targetX = CONFIG.LANE_X[this.laneIndex]; }
  moveRight() { this.laneIndex = clamp(this.laneIndex + 1, 0, 2); this.targetX = CONFIG.LANE_X[this.laneIndex]; }
  jump() { if (this.onGround) { this.vy = Math.sqrt(2 * CONFIG.GRAVITY * CONFIG.JUMP_HEIGHT); this.onGround = false; return true; } return false; }
  slide() { if (this.onGround && !this.sliding) { this.sliding = true; this.slideTimer = CONFIG.SLIDE_TIME; return true; } return false; }

  // ---- 赛道机关 ----
  // 加速带：地面上的发射条，踩上去给一段速度爆发
  padBoost() {
    if (this.padBoostTimer > 0) return false;   // 已在加速中就不重复疊加
    this.padBoostTimer = CONFIG.PAD_BOOST_TIME;
    return true;
  }
  // 弹跳板：把玩家弹到 3.3m 左右，用来吃空中金币弧线 / 拉长滞空
  spring() {
    this.vy = CONFIG.PAD_SPRING_VY;
    this.onGround = false;
    // 弹起时立刻结束滑铲，否则会带着压扁的姿势飞起来
    this.sliding = false;
    this.slideTimer = 0;
    this.rig.scale.y = 1;
    return true;
  }

  addCombo() {
    this.combo++;
    this.comboTimer = CONFIG.COMBO_WINDOW;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
  }
  comboMult() { return 1 + Math.min(this.combo, CONFIG.COMBO_MAX) * CONFIG.COMBO_STEP; }

  getBox() {
    const x = this.group.position.x;
    const yBase = this.group.position.y;
    const h = this.sliding ? CONFIG.PLAYER_H_SLIDE : CONFIG.PLAYER_H_STAND;
    return {
      min: new THREE.Vector3(x - CONFIG.PLAYER_HALF_X, yBase, this.group.position.z - CONFIG.PLAYER_HALF_Z),
      max: new THREE.Vector3(x + CONFIG.PLAYER_HALF_X, yBase + h, this.group.position.z + CONFIG.PLAYER_HALF_Z),
    };
  }

  // ==========================================================================
  //  可站立平台（地铁车厢车顶）
  // ==========================================================================
  // 照《地铁跑酷》的招牌动作：低矮车厢车顶 2.05m「跳得上去」，在上面接着跑；
  // 标准车厢 3.4m 只能变道躲（或者先站上矮车顶、再补跳一次）。
  //
  // 这里集中查询「本帧所有能踩的车顶」，重力段与撞车判定共用同一份数据，
  // 免得两处各写一遍「玩家到底在不在车顶上」而跑偏。
  getPlatforms() {
    const out = [];
    const sp = this.game && this.game.spawner;
    if (!sp || !sp.chunks) return out;
    for (const chunk of sp.chunks) {
      for (const o of chunk.obstacles) {
        if (!o.visible) continue;
        const def = OBSTACLE_TYPES[o.userData.type];
        if (!def || !def.standable) continue;
        out.push({
          o: o,
          def: def,
          // 车顶高度看实例：矮车 2.05 / 标准车 3.4。没标就退回契约里的 maxY。
          roofY: (o.userData.roofY != null ? o.userData.roofY : def.maxY),
          x: o.position.x,
          z: o.position.z,
        });
      }
    }
    return out;
  }

  // 脚底「能踩到」的最高平台，返回 { y, o }：y = 0 且 o = null 表示踩在赛道上。
  // 只接受「不高于 脚底 + PLATFORM_TOLERANCE」的车顶 —— 否则站在矮车顶上时，
  // 会把旁边标准车厢的顶当成脚下的地，把玩家瞬移到 3.4m 高。
  _support() {
    const py = this.group.position.y;
    const pz = this.group.position.z;
    const px = this.group.position.x;
    let bestY = 0, bestO = null;
    for (const p of this.getPlatforms()) {
      // 判定窗必须与 _checkCollisions 的撞车窗口「逐字一致」（半身位 + 0.2 容差）——
      // ⚠️ 这两个窗口必须与 _checkCollisions 的撞车窗口「逐字一致」（半身位 + 0.2 容差）。
      // 否则车顶边缘会留出一条「撞车判定窗内、但脚下踩不到」的死带：玩家在那里每帧
      // 「离台 → 立刻又被攀爬辅助提回车顶」，看起来就是粘在边缘不掉下来。
      if (Math.abs(px - p.x) > p.def.halfX + CONFIG.PLAYER_HALF_X) continue;
      if (Math.abs(pz - p.z) > p.def.halfZ + CONFIG.PLAYER_HALF_Z + 0.2) continue;
      if (p.roofY > py + CONFIG.PLATFORM_TOLERANCE) continue;
      if (p.roofY > bestY) { bestY = p.roofY; bestO = p.o; }
    }
    return { y: bestY, o: bestO };
  }

  // 落到平台上：贴到车顶高度、清零垂直速度、标记「踩地」。
  // 注意不在这里碰 rig.scale.y —— 滑铲有它自己的计时器在管，重复设会闪一帧。
  _landOn(roofY, o) {
    this.group.position.y = roofY;
    this.vy = 0;
    this.onGround = true;
    this.platform = o || null;
  }

  // 攀爬辅助：车厢的判定窗在车头「前方 4.4m」就打开了，而跳跃是抛物线 ——
  // 玩家刚碰到车头的那一刻，脚底不可能已经高于车顶。所以只要脚底离车顶
  // 不到 TRAIN_CLIMB_ASSIST 就算攀上去，差更多才算撞车身。
  // 副作用正好是想要的：矮车门限 1.20m（跳得上去）、标准车门限 2.55m > 跳跃峰值 2.2m（只能躲）。
  canClimb(roofY) {
    return this.group.position.y >= roofY - CONFIG.TRAIN_CLIMB_ASSIST;
  }

  // 从车顶边缘「走出去」：自然掉落（不是跳、也不是被推下去），水平速度照旧。
  _leavePlatform() {
    this.onGround = false;
    this.vy = 0;
    this.platform = null;
  }

  _updateAura(dt) {
    if (!this.aura.visible) return;
    this.aura.rotation.z += dt * 1.2;
    const c = new THREE.Color().setHSL((this.idleTime * 0.12) % 1, 0.85, 0.6);
    this.aura.material.color.copy(c);
    this.aura.material.emissive.copy(c);
  }

  idle(dt) {
    this.idleTime += dt;
    this.runTime += dt * 6;
    const s = Math.sin(this.runTime);
    this.rig.position.y = Math.abs(s) * 0.05;
    this.legL.rotation.x = s * 0.15; this.legR.rotation.x = -s * 0.15;
    this.armL.rotation.x = -s * 0.22; this.armR.rotation.x = s * 0.22;
    this.tail.rotation.y = Math.sin(this.runTime * 0.6) * 0.45;
    this.rig.rotation.x = lerp(this.rig.rotation.x, 0, 0.1);
    this.rig.rotation.z = lerp(this.rig.rotation.z, 0, 0.1);
    this.shieldMesh.visible = false;
    this.rig.visible = true;
    this._updateAura(dt);
  }

  update(dt) {
    this.idleTime += dt;
    this.group.position.x = lerp(this.group.position.x, this.targetX, clamp(dt / CONFIG.LANE_CHANGE_TIME, 0, 1));
    const tilt = (this.targetX - this.group.position.x) * 0.12;
    this.rig.rotation.z = lerp(this.rig.rotation.z, -tilt, 0.2);

    // ---- 重力 / 站立平台 ----
    // sup = 当前 x/z 下脚下能踩到的最高车顶（y = 0 就是赛道地面）。
    // 站在车顶上「走出去」时 sup 会突然掉回 0，这时让玩家自然掉落；
    // 原来写死 `position.y <= 0` 会把玩家瞬移贴地，站上车顶就走不下来了。
    const sup = this._support();
    if (!this.onGround) {
      this.vy -= CONFIG.GRAVITY * dt;
      this.group.position.y += this.vy * dt;
      if (this.vy <= 0 && this.group.position.y <= sup.y) this._landOn(sup.y, sup.o);
    } else if (sup.y < this.group.position.y - CONFIG.PLATFORM_TOLERANCE) {
      this._leavePlatform();
    }
    if (this.sliding) {
      this.slideTimer -= dt;
      const k = clamp(this.slideTimer / CONFIG.SLIDE_TIME, 0, 1);
      this.rig.scale.y = lerp(0.5, 1.0, 1 - k);
      if (this.slideTimer <= 0) { this.sliding = false; this.rig.scale.y = 1; }
    }
    if (this.onGround && !this.sliding) {
      this.runTime += dt * 11;
      const s = Math.sin(this.runTime);
      this.legL.rotation.x = s * 0.75;  this.legR.rotation.x = -s * 0.75;
      this.armL.rotation.x = -s * 0.55; this.armR.rotation.x = s * 0.55;
      this.rig.position.y = Math.abs(s) * 0.1;
      this.rig.rotation.x = lerp(this.rig.rotation.x, -0.07, 0.1);
      this.tail.rotation.y = Math.sin(this.runTime * 0.7) * 0.35;
    } else if (!this.onGround) {
      this.legL.rotation.x = lerp(this.legL.rotation.x, -1.0, 0.25);
      this.legR.rotation.x = lerp(this.legR.rotation.x, -1.0, 0.25);
      this.armL.rotation.x = lerp(this.armL.rotation.x, -2.4, 0.25);
      this.armR.rotation.x = lerp(this.armR.rotation.x, -2.4, 0.25);
      this.rig.rotation.x = lerp(this.rig.rotation.x, 0.12, 0.1);
      this.tail.rotation.y = lerp(this.tail.rotation.y, 0, 0.1);
    } else {
      this.legL.rotation.x = lerp(this.legL.rotation.x, 1.25, 0.3);
      this.legR.rotation.x = lerp(this.legR.rotation.x, 1.25, 0.3);
      this.armL.rotation.x = lerp(this.armL.rotation.x, -0.7, 0.3);
      this.armR.rotation.x = lerp(this.armR.rotation.x, -0.7, 0.3);
      this.tail.rotation.y = lerp(this.tail.rotation.y, 0, 0.1);
    }
    if (this.invincibleTimer > 0) this.invincibleTimer -= dt;
    if (this.shieldTimer > 0) this.shieldTimer -= dt;
    if (this.magnetTimer > 0) this.magnetTimer -= dt;
    if (this.speedBoostTimer > 0) this.speedBoostTimer -= dt;
    if (this.doubleTimer > 0) this.doubleTimer -= dt;
    if (this.padBoostTimer > 0) this.padBoostTimer -= dt;
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }

    this.shieldMesh.visible = this.shieldTimer > 0;
    if (this.invincibleTimer > 0) {
      this.blinkTimer += dt;
      this.rig.visible = Math.floor(this.blinkTimer * 8) % 2 === 0;
    } else { this.rig.visible = true; this.blinkTimer = 0; }
    this._updateAura(dt);
  }
}

// ============================================================================
//  ChunkSpawner — 无限跑道 / 障碍 / 收集物 / 道具 / 主题装饰
// ============================================================================
class ChunkSpawner {
  constructor(scene) {
    this.scene = scene;
    this.chunks = [];
    this.powerupInterval = CONFIG.POWERUP_INTERVAL;
    this.themeOffset = 0;   // 起始主题偏移（由「世界地图」页设置）
    this.themeCount = SUN_COUNT; // 一轮换跑几张地图；竹墨松林解锁后由 startGame 改成 8
    this.pools = {
      // 车厢 = 3 种涂装 × 2 种车高（标准 / 低矮）。低矮款必须独立成池，否则会互相串到对方的几何。
      hurdle: [], overhead: [],
      train0: [], train1: [], train2: [],
      train0L: [], train1L: [], train2L: [],
      wall: [],
      coin: [], bottle: [],
      magnet: [], shield: [], speed: [], double: [],
      boost: [], spring: [],   // 赛道机关（加速带 / 弹跳板）
    };
    // 「安全带」：保证每一排障碍都至少留一条活路，而且安全带每次只平移一格。
    // 没有这个约束，随机封车道会出现「上一排留 2 号道、下一排留 0 号道」——
    // 高速时来不及变道，玩家会觉得是必死局。这里把公平性做成硬约束。
    this.safeLane = 1;
    // 道具投放游标（里程，米）：下一次该在哪个里程放道具。跨区块单调推进。
    this._powerCursor = CONFIG.POWERUP_INTERVAL;
    this._init();
  }

  _init() {
    for (let i = 0; i < CONFIG.CHUNK_COUNT; i++) {
      const chunk = { group: new THREE.Group(), obstacles: [], coins: [], powerups: [], pads: [], theme: 0, decos: [], bobbers: [], spinners: [] };
      chunk.group.position.z = -i * CONFIG.CHUNK_LENGTH;
      this._buildFloor(chunk);
      this.scene.add(chunk.group);
      this.chunks.push(chunk);
    }
  }

  _buildFloor(chunk) {
    const th = THEMES[chunk.theme];
    chunk.floorMat = new THREE.MeshLambertMaterial({ color: th.ground });
    chunk.railMat = new THREE.MeshLambertMaterial({ color: th.rail });
    chunk.sideMat = new THREE.MeshLambertMaterial({ color: th.side });
    const L = CONFIG.CHUNK_LENGTH;
    const floor = new THREE.Mesh(geo('box', 10, 0.5, L), chunk.floorMat);
    floor.position.y = -0.25; chunk.group.add(floor);

    // 两侧大地面：铺满护栏以外的区域。没有它，装饰物会像悬在天空里。
    for (const sx of [-1, 1]) {
      const g = new THREE.Mesh(geo('box', CONFIG.SIDE_WIDTH, 0.5, L), chunk.sideMat);
      g.position.set(sx * (5 + CONFIG.SIDE_WIDTH / 2), -0.34, 0);
      chunk.group.add(g);
      // 护栏外沿的一道浅色路肩，让地面和赛道有分界
      const lip = new THREE.Mesh(geo('box', 0.5, 0.5, L), chunk.floorMat);
      lip.position.set(sx * 5.25, -0.16, 0);
      chunk.group.add(lip);
    }

    for (const sx of [-5, 5]) {
      const rail = new THREE.Mesh(geo('box', 0.4, 0.55, L), chunk.railMat);
      rail.position.set(sx, 0.12, 0); chunk.group.add(rail);
      for (let z = -L / 2 + 4; z < L / 2; z += 8) {
        const post = new THREE.Mesh(geo('box', 0.55, 0.5, 0.55), chunk.railMat);
        post.position.set(sx, 0.05, z); chunk.group.add(post);
      }
    }
    for (const lx of [-1.5, 1.5]) {
      for (let z = -16; z <= 16; z += 5.4) {
        const dash = new THREE.Mesh(geo('box', 0.09, 0.02, 1.7), mat(0xffffff));
        dash.position.set(lx, 0.012, z); chunk.group.add(dash);
      }
    }
    this._buildDecorations(chunk);
  }

  _clearDecorations(chunk) {
    for (const d of chunk.decos) {
      // 合并出来的几何体是我们自己 new 的，必须显式释放，否则换主题时会持续泄漏显存。
      // 注意：绝不能碰 geo() 缓存里的共享几何体，所以只释放带 userData.merged 标记的。
      d.traverse((o) => {
        if (o.isMesh && o.userData.merged && o.geometry) o.geometry.dispose();
      });
      chunk.group.remove(d);
    }
    chunk.decos.length = 0;
    chunk.bobbers.length = 0;
    chunk.spinners.length = 0;
  }

  // 三层纵深：近带（护栏边小物件）→ 中带（立体物件）→ 远带（剪影，负责空间纵深）
  _buildDecorations(chunk) {
    this._clearDecorations(chunk);
    const half = CONFIG.CHUNK_LENGTH / 2;
    const bands = [
      { n: 10, sun: this._sunNearDeco, ink: this._makeNearDeco, x0: 6.6, x1: 10.4 },
      { n: 8,  sun: this._sunMidDeco,  ink: this._makeMidDeco,  x0: 11.5, x1: 18.5 },
      { n: 6,  sun: this._sunFarDeco,  ink: this._makeFarDeco,  x0: 20,  x1: 35 }
    ];
    for (const b of bands) {
      for (let i = 0; i < b.n; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        // 前 4 张（阳光漫游）走糖果系旧构造器，后 4 张（竹墨松林）走水墨系构造器。
        // b.sun / b.ink 存的是未绑定的方法引用，必须 .call(this, ...) 才拿得到 this.geo / this._makeBamboo。
        const maker = chunk.theme < SUN_COUNT ? b.sun : b.ink;
        const deco = maker.call(this, chunk.theme, side);
        if (!deco) continue;
        mergeDeco(deco);
        deco.position.set(side * rand(b.x0, b.x1), 0, rand(-half + 3, half - 3));
        chunk.group.add(deco);
        chunk.decos.push(deco);
        if (deco.userData.wheel) chunk.spinners.push(deco.userData.wheel);
        if (deco.userData.bobber) chunk.bobbers.push(deco.userData.bobber);
      }
    }
  }

  // ---------------- 近带：贴着护栏的小物件（竹林脚下的细处） ----------------
  _makeNearDeco(theme, side) {
    const r = Math.random();
    if (theme === 0) {          // 墨竹初径：竹丛 / 石灯笼 / 矮丛 / 野花
      if (r < 0.34) return this._makeBamboo();
      if (r < 0.52) return this._makeStoneLamp(false);
      if (r < 0.78) return this._makeBush();
      return this._makeFlower();
    }
    if (theme === 1) {          // 竹露清风：竹更密，多山石
      if (r < 0.44) return this._makeBamboo();
      if (r < 0.64) return this._makeRock();
      if (r < 0.84) return this._makeStoneLamp(false);
      return this._makeFlower();
    }
    if (theme === 2) {          // 松涛深处：松 + 石
      if (r < 0.40) return this._makePine();
      if (r < 0.66) return this._makeRock(1.3);
      if (r < 0.84) return this._makeBush();
      return this._makeStoneLamp(false);
    }
    // 竹影夜灯：夜竹 + 亮着灯的石灯笼
    if (r < 0.40) return this._makeBamboo();
    if (r < 0.64) return this._makeStoneLamp(true);
    if (r < 0.84) return this._makeRock(1.15);
    return this._makeLamp(true);
  }

  // ---------------- 中带：稍远的立体物件 ----------------
  _makeMidDeco(theme, side) {
    const r = Math.random();
    if (theme === 0) {          // 竹亭 + 高竹 + 山石
      if (r < 0.28) return this._makePavilion();
      if (r < 0.58) return this._makeBamboo(1.5);
      if (r < 0.80) return this._makeRock(1.6);
      return this._makePine(1.3);
    }
    if (theme === 1) {
      if (r < 0.30) return this._makeBamboo(1.7);
      if (r < 0.54) return this._makeRock(1.8);
      if (r < 0.76) return this._makePine(1.4);
      return this._makePavilion();
    }
    if (theme === 2) {
      if (r < 0.36) return this._makePine(1.7);
      if (r < 0.62) return this._makeRock(2.0);
      if (r < 0.82) return this._makeBamboo(1.6);
      return this._makePavilion();
    }
    if (r < 0.30) return this._makeBamboo(1.7);
    if (r < 0.52) return this._makePine(1.6);
    if (r < 0.72) return this._makeRock(1.8);
    if (r < 0.90) return this._makePavilion();
    return this._makeSkyLantern();
  }

  // ---------------- 远带：水墨山峦剪影，负责空间纵深 ----------------
  _makeFarDeco(theme, side) {
    // 夜灯主题的远带偶尔飘一盏孔明灯：天上有一点暖色，纵深就活了
    if (theme === 3 && Math.random() < 0.22) return this._makeSkyLantern();
    // 三成概率换成「水墨丘」（圆缓的远坡），远带就不是清一色的尖峰
    if (Math.random() < 0.32) {
      return this._makeMounds(THEMES[theme].far, this._inkFade(THEMES[theme].far, 0.30));
    }
    return this._makeInkMountains(theme, side);
  }

  // 把颜色朝「雾白」方向掺一点 —— 水墨画里「远山如黛」靠的就是层层被雾冲淡。
  _inkFade(hexColor, t) {
    const c = new THREE.Color(hexColor);
    c.lerp(new THREE.Color(0xffffff), t);
    return c.getHex();
  }

  // ---------------- 剪影 / 地形 ----------------
  // 水墨远山：一排三角峰、前后两层。近峰用主题的「远景色」，远峰掺雾变淡，
  // 于是在一片平铺的远景里也能读出前后层次。radialSegments 取 5 —— 段数一低，
  // 峰就成了带棱角的笔触，正好是水墨山的样子。
  _makeInkMountains(theme, side) {
    const g = new THREE.Group();
    const base = THEMES[theme].far;
    const near = mat(base);
    const far = mat(this._inkFade(base, 0.34));
    const n = 4 + Math.floor(Math.random() * 3);
    const step = rand(4.2, 6.2);
    for (let i = 0; i < n; i++) {
      const h = rand(6, 15), r = rand(2.6, 4.6);
      const isFar = i % 2 === 1;
      const peak = new THREE.Mesh(geo('cone', r, h, 5), isFar ? far : near);
      peak.position.set(rand(-2.6, 2.6), h / 2, 10 - i * step - (isFar ? 3.2 : 0));
      peak.rotation.y = rand(0, Math.PI);
      g.add(peak);
      if (!isFar) {
        // 山脚一层薄雾带：让山「插进」地平线，而不是浮在半空
        const haze = new THREE.Mesh(geo('sph', r * 1.15, 8, 5), far);
        haze.scale.set(1, 0.16, 1);
        haze.position.set(peak.position.x, 0.35, peak.position.z);
        g.add(haze);
      }
    }
    return g;
  }
  // 水墨丘：圆缓的远坡。做法是把球体压扁后「半埋」进地面，只露出顶上的穹面 ——
  // 所以底边必然远低于地面，这是造型本身要的，显式打 userData.halfBuried 说明意图。
  _makeMounds(c1, c2) {
    const g = new THREE.Group();
    g.userData.halfBuried = true;
    for (let i = 0; i < 4; i++) {
      const r = rand(3.2, 6.5);
      const m = new THREE.Mesh(geo('sph', r, 10, 8), mat(i % 2 ? c1 : c2));
      m.scale.y = rand(0.4, 0.6);
      m.position.set(rand(-3.5, 3.5), 0, -i * rand(3.5, 5.5));
      g.add(m);
    }
    return g;
  }

  // ---------------- 竹墨松林：四种主力装饰 ----------------
  // 竹丛：3~5 根细高竹竿 + 竹节环 + 顶部竹叶簇。
  // 每根竹竿的倾斜角都不一样，否则远看就是一排电线杆。
  _makeBamboo(scale) {
    const g = new THREE.Group();
    const s = scale || 1;
    const n = 3 + Math.floor(Math.random() * 3);
    const stalkColors = [0x5f8f4e, 0x6f9c58, 0x4f7f46, 0x7aa862];
    const leafColors = [0x3f6b3a, 0x4e7d42, 0x2f5a34];
    for (let i = 0; i < n; i++) {
      const h = rand(2.2, 4.4) * s;
      const rad = rand(0.045, 0.075) * s;
      const x = rand(-0.42, 0.42) * s, z = rand(-0.34, 0.34) * s;
      const tilt = rand(-0.07, 0.07);
      const stalk = new THREE.Mesh(geo('cyl', rad * 0.72, rad, h, 6), mat(pick(stalkColors)));
      stalk.position.set(x, h / 2, z);
      stalk.rotation.z = tilt;
      g.add(stalk);
      // 竹节：等距套几个细环 —— 这是「一眼认出是竹子」的关键细节
      const nodes = Math.max(2, Math.floor(h / 0.85));
      for (let k = 1; k <= nodes; k++) {
        const ring = new THREE.Mesh(geo('cyl', rad * 1.18, rad * 1.18, 0.05 * s, 6), mat(0x3f6b3a));
        ring.position.set(x, (h / (nodes + 1)) * k, z);
        ring.rotation.z = tilt;
        g.add(ring);
      }
      // 叶簇：几片压扁的球斜插在竹梢
      const lc = pick(leafColors);
      for (let k = 0; k < 4; k++) {
        const leaf = new THREE.Mesh(geo('sph', rand(0.22, 0.4) * s, 7, 5), mat(lc));
        leaf.scale.set(1.55, 0.28, 0.6);
        leaf.position.set(x + rand(-0.42, 0.42) * s, h * rand(0.72, 0.99), z + rand(-0.32, 0.32) * s);
        leaf.rotation.set(rand(-0.5, 0.5), rand(0, 6.28), rand(-0.6, 0.6));
        g.add(leaf);
      }
    }
    return g;
  }

  // 松树：树干 + 三层锥形树冠（越往上越小），梢头再补一个小尖。
  _makePine(scale) {
    const g = new THREE.Group();
    const s = scale || 1;
    const h = rand(3.2, 5.4) * s;
    const trunk = new THREE.Mesh(geo('cyl', 0.1 * s, 0.16 * s, h * 0.55, 7), mat(0x6b503a));
    trunk.position.y = h * 0.275;
    g.add(trunk);
    const greens = [0x2f5a3c, 0x3a6b46, 0x27502f];
    for (let i = 0; i < 3; i++) {
      const t = i / 2;
      const cone = new THREE.Mesh(geo('cone', (1.25 - 0.5 * t) * s, (1.5 - 0.32 * t) * s, 8), mat(pick(greens)));
      cone.position.y = h * 0.42 + t * h * 0.4;
      g.add(cone);
    }
    const tip = new THREE.Mesh(geo('cone', 0.34 * s, 0.7 * s, 8), mat(0x2b5233));
    tip.position.y = h * 0.94;
    g.add(tip);
    return g;
  }

  // 水墨山石：3~4 块不规则石块叠成一叠，石缝里再钻两簇草。
  // 石块用 6x5 的低模球 + 随机三轴缩放 —— 段数越低，棱角越像石头。
  _makeRock(scale) {
    const g = new THREE.Group();
    const s = scale || 1;
    const colors = [0x8c9a92, 0x7d8b84, 0x9aa79f, 0x6f7d76];
    const n = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const r = rand(0.28, 0.6) * s * (1 - i * 0.14);
      const rock = new THREE.Mesh(geo('sph', r, 6, 5), mat(pick(colors)));
      rock.scale.set(rand(0.85, 1.25), rand(0.6, 0.95), rand(0.85, 1.25));
      rock.position.set(rand(-0.3, 0.3) * s, r * 0.62 + i * r * 0.5, rand(-0.3, 0.3) * s);
      rock.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
      g.add(rock);
    }
    for (let i = 0; i < 2; i++) {
      const blade = new THREE.Mesh(geo('sph', 0.12 * s, 6, 5), mat(0x4e7d42));
      blade.scale.set(0.5, 1.5, 0.5);
      blade.position.set(rand(-0.5, 0.5) * s, 0.16 * s, rand(-0.45, 0.45) * s);
      g.add(blade);
    }
    return g;
  }

  // 石灯笼：底座 → 柱 → 灯室 → 檐 → 顶珠。灯室用自发光材质，
  // 夜里它是整条路上唯一的暖色，正好跟水墨冷调打反差。
  _makeStoneLamp(night, tall) {
    const g = new THREE.Group();
    const stone = 0x9aa79f, stoneDark = 0x7d8b84;
    const h = tall ? 2.1 : 1.55;
    const base = new THREE.Mesh(geo('cyl', 0.26, 0.34, 0.16, 8), mat(stoneDark));
    base.position.y = 0.08; g.add(base);
    const pole = new THREE.Mesh(geo('cyl', 0.11, 0.14, h * 0.5, 8), mat(stone));
    pole.position.y = 0.16 + h * 0.25; g.add(pole);
    const plate = new THREE.Mesh(geo('cyl', 0.32, 0.26, 0.08, 8), mat(stoneDark));
    plate.position.y = 0.16 + h * 0.5; g.add(plate);
    const box = new THREE.Mesh(geo('box', 0.5, 0.44, 0.5),
      mat(0xffe6b0, { std: true, emissive: 0xffc66a, emissiveIntensity: night ? 1.15 : 0.5 }));
    box.position.y = 0.16 + h * 0.5 + 0.28; g.add(box);
    const roof = new THREE.Mesh(geo('cone', 0.5, 0.36, 6), mat(stoneDark));
    roof.position.y = 0.16 + h * 0.5 + 0.68; g.add(roof);
    const bead = new THREE.Mesh(geo('sph', 0.1, 8, 6), mat(stone));
    bead.position.y = 0.16 + h * 0.5 + 0.94; g.add(bead);
    return g;
  }

  // 竹亭：中带的地标 —— 四柱撑一顶四角攒尖顶，远远就认得出「有人烟」。
  _makePavilion() {
    const g = new THREE.Group();
    const s = rand(1.0, 1.35);
    const h = 2.2 * s;
    const posts = [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]];
    for (let i = 0; i < posts.length; i++) {
      const post = new THREE.Mesh(geo('cyl', 0.075 * s, 0.09 * s, h, 6), mat(0x7a5a3a));
      post.position.set(posts[i][0] * s, h / 2, posts[i][1] * s);
      g.add(post);
    }
    const floor = new THREE.Mesh(geo('box', 2.0 * s, 0.12 * s, 2.0 * s), mat(0x8a6a48));
    floor.position.y = 0.06 * s; g.add(floor);
    const eave = new THREE.Mesh(geo('box', 1.55 * s, 0.08 * s, 1.55 * s), mat(0x2c4433));
    eave.rotation.y = Math.PI / 4;
    eave.position.y = h + 0.02 * s; g.add(eave);
    const roof = new THREE.Mesh(geo('cone', 1.62 * s, 0.9 * s, 4), mat(0x37533f));
    roof.rotation.y = Math.PI / 4;
    roof.position.y = h + 0.42 * s; g.add(roof);
    const knob = new THREE.Mesh(geo('sph', 0.13 * s, 8, 6), mat(0xb0bda9));
    knob.position.y = h + 0.94 * s; g.add(knob);
    return g;
  }

  // 孔明灯：夜里的暖色小品。整盏灯装在一个 Group 里挂进 userData.bobber，
  // 并把这个组记进 userData.anim —— 合并时它不会被烘进静态网格，于是能一直上下浮动。
  // （浮动机制完全沿用旧版的气球，没有新增任何每帧逻辑。）
  // 高度取 5.6m、明明白白地飘在竹梢之上：它是唯一「离地」的装饰，
  // 所以显式打上 userData.airborne —— 出图脚本的贴地校验靠这个标记把它和「摆放事故」区分开。
  _makeSkyLantern() {
    const g = new THREE.Group();
    const l = new THREE.Group();
    l.position.y = 5.6;
    g.userData.airborne = true;
    const body = new THREE.Mesh(geo('cyl', 0.34, 0.24, 0.62, 10),
      mat(0xffd9a0, { std: true, emissive: 0xffb45e, emissiveIntensity: 0.85 }));
    body.position.y = 0.05; l.add(body);
    const cap = new THREE.Mesh(geo('cone', 0.34, 0.26, 10), mat(0xe8b06a));
    cap.position.y = 0.49; l.add(cap);
    const ring = new THREE.Mesh(geo('cyl', 0.25, 0.25, 0.06, 10), mat(0x8a6a48));
    ring.position.y = -0.33; l.add(ring);
    const flame = new THREE.Mesh(geo('sph', 0.09, 8, 6),
      mat(0xfff0b0, { std: true, emissive: 0xffc040, emissiveIntensity: 1.4 }));
    flame.scale.y = 1.4; flame.position.y = -0.23; l.add(flame);
    g.add(l);
    g.userData.bobber = { o: l, baseY: 5.6, amp: 0.22, speed: 1.1, phase: rand(0, 6.28) };
    g.userData.anim = [l];
    return g;
  }

  // ---------------- 小型道具（结构沿用旧版，配色换成竹青 / 石青） ----------------
  _makeBush() {
    const g = new THREE.Group();
    const c = pick([0x6f9c58, 0x5f8f4e, 0x7aa862, 0x4e7d42]);
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(geo('sph', rand(0.3, 0.46), 10, 10), mat(c));
      s.position.set(rand(-0.28, 0.28), rand(0.24, 0.44), rand(-0.22, 0.22));
      g.add(s);
    }
    // 两朵小野花：只取淡紫 / 米白这类水墨淡彩
    for (let i = 0; i < 2; i++) {
      const f = new THREE.Mesh(geo('sph', 0.07, 8, 8), mat(pick([0xd9c6e8, 0xfff4c2, 0xe8e0f0])));
      f.position.set(rand(-0.35, 0.35), rand(0.5, 0.62), rand(-0.3, 0.3));
      g.add(f);
    }
    return g;
  }
  _makeFlower() {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(geo('cyl', 0.03, 0.04, 0.8, 6), mat(0x5f8f4e));
    stem.position.y = 0.4; g.add(stem);
    const leaf = new THREE.Mesh(geo('sph', 0.12, 8, 8), mat(0x6f9c58));
    leaf.scale.set(1, 0.3, 0.55); leaf.position.set(0.09, 0.4, 0); g.add(leaf);
    const c = pick([0xd9c6e8, 0xfff4c2, 0xf2f7f3, 0xc9b3e0]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const p = new THREE.Mesh(geo('sph', 0.11, 8, 8), mat(c));
      p.scale.set(1, 0.55, 1);
      p.position.set(Math.cos(a) * 0.15, 0.84, Math.sin(a) * 0.15);
      g.add(p);
    }
    const core = new THREE.Mesh(geo('sph', 0.09, 8, 8), mat(0xfff6cc));
    core.position.y = 0.86; g.add(core);
    return g;
  }
  // 路灯：竹林路边的一盏暖灯（夜灯主题里它是主光源的替身）
  _makeLamp(night, tall) {
    const g = new THREE.Group();
    const h = tall ? 3.2 : 2.4;
    const dark = night ? 0x2e3a34 : 0x5a6b62;
    const pole = new THREE.Mesh(geo('cyl', 0.07, 0.1, h, 8), mat(dark));
    pole.position.y = h / 2; g.add(pole);
    const arm = new THREE.Mesh(geo('box', 0.7, 0.09, 0.09), mat(dark));
    arm.position.set(0.32, h - 0.1, 0); g.add(arm);
    const head = new THREE.Mesh(geo('sph', 0.18, 10, 10),
      mat(0xffe6b0, { std: true, emissive: 0xffc66a, emissiveIntensity: night ? 1.0 : 0.4 }));
    head.scale.set(1, 0.7, 1);
    head.position.set(0.6, h - 0.18, 0); g.add(head);
    if (night) {
      const base = new THREE.Mesh(geo('cyl', 0.22, 0.28, 0.3, 10), mat(0x2a3530));
      base.position.y = 0.15; g.add(base);
    }
    return g;
  }

  // ---------------- 近带：贴着护栏的小物件 ----------------
  _sunNearDeco(theme, side) {
    const r = Math.random();
    if (theme === 0) {
      if (r < 0.30) return this._makeCandyTree();
      if (r < 0.52) return this._sunBush();
      if (r < 0.74) return this._sunLamp(false);
      return this._sunFlower();
    }
    if (theme === 1) {
      if (r < 0.34) return this._makeLollipop();
      if (r < 0.60) return this._makeGumdrop();
      if (r < 0.82) return this._makeCandyCane(false);
      return this._makeCandyTree();
    }
    if (theme === 2) {
      if (r < 0.34) return this._makeCandyTree();
      if (r < 0.58) return this._makeBalloon();
      if (r < 0.80) return this._makeTent(false);
      return this._sunBush();
    }
    if (r < 0.32) return this._makeSignal();
    if (r < 0.56) return this._sunLamp(true);
    if (r < 0.80) return this._makeCrate();
    return this._makeBarrier();
  }

  // ---------------- 中带：稍远的立体物件 ----------------
  _sunMidDeco(theme, side) {
    const r = Math.random();
    if (theme === 0) {
      if (r < 0.34) return this._makeBuilding(side);
      if (r < 0.58) return this._makeRainbow();
      if (r < 0.80) return this._sunLamp(false, true);
      return this._makeCandyTree(1.5);
    }
    if (theme === 1) {
      if (r < 0.34) return this._makeCandyCane(true);
      if (r < 0.60) return this._makeGumdrop(1.6);
      if (r < 0.82) return this._makeCandyTree(1.6);
      return this._makeLollipop(1.7);
    }
    if (theme === 2) {
      if (r < 0.24) return this._makeFerris();
      if (r < 0.48) return this._makeCarousel();
      if (r < 0.72) return this._makeTent(true);
      return this._makeBalloon();
    }
    if (r < 0.34) return this._makePillar();
    if (r < 0.58) return this._makeSignal(1.6);
    if (r < 0.80) return this._makeBuilding(side);
    return this._sunLamp(true, true);
  }

  // ---------------- 远带：剪影，负责纵深 ----------------
  _sunFarDeco(theme, side) {
    if (theme === 1) return this._makeMounds(THEMES[1].far, 0xffb8db);
    if (theme === 2) return Math.random() < 0.45 ? this._makeFerris(1.8) : this._makeMounds(THEMES[2].far, 0x9fd8b0);
    return this._makeSkyline(theme, side);
  }

  // ---------------- 剪影 / 地形 ----------------
  _makeSkyline(theme, side) {
    const g = new THREE.Group();
    const base = THEMES[theme].far;
    const n = 5 + Math.floor(Math.random() * 3);
    const step = rand(3.2, 4.6);
    for (let i = 0; i < n; i++) {
      // 面朝镜头的是「宽 w × 高 h」这一面，所以 w 决定剪影宽度；
      // 纵深 d 沿赛道方向铺开，一排楼才像一条街区。
      // （早先这里把整排绕 Y 轴转了 ±90°，结果朝向镜头只剩 1.6~2.8 的薄边，
      //   远看就是一片插在地上的纸板 —— 已经去掉该旋转。）
      const w = rand(2.6, 5.2), h = rand(4.5, 13), d = rand(3.2, 6.2);
      const b = new THREE.Mesh(geo('box', 1, 1, 1), mat(base));
      b.scale.set(w, h, d);
      b.position.set(rand(-2.2, 2.2), h / 2, 12 - i * step);
      g.add(b);
      // 顶部小尖顶，避免成一排方盒子
      if (Math.random() < 0.5) {
        const t = new THREE.Mesh(geo('box', 0.5, 0.5, 0.5), mat(base));
        t.scale.set(w * 0.35, rand(0.8, 2.2), d * 0.5);
        t.position.set(b.position.x, h + t.scale.y / 2, b.position.z);
        g.add(t);
      }
    }
    return g;
  }

  // ---------------- 新增中小型道具（阳光漫游糖果系）----------------
  // 注意：这三个是「阳光漫游」的糖果配色版，必须带 _sun 前缀。
  // 竹墨松林那一段里另有 _makeBush / _makeFlower / _makeLamp（竹青配色），
  // 两者同名会被 JS 类「后定义覆盖」静默吃掉一份 —— 第 2 赛季会串成糖果色。
  _sunBush() {
    const g = new THREE.Group();
    const c = pick([0x7be08a, 0x9be08a, 0x5fbf6e]);
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(geo('sph', rand(0.3, 0.46), 10, 10), mat(c));
      s.position.set(rand(-0.28, 0.28), rand(0.24, 0.44), rand(-0.22, 0.22));
      g.add(s);
    }
    // 两朵小花
    for (let i = 0; i < 2; i++) {
      const f = new THREE.Mesh(geo('sph', 0.08, 8, 8), mat(pick([0xff7bac, 0xffd93d, 0xffffff])));
      f.position.set(rand(-0.35, 0.35), rand(0.5, 0.62), rand(-0.3, 0.3));
      g.add(f);
    }
    return g;
  }
  _sunFlower() {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(geo('cyl', 0.035, 0.045, 0.85, 6), mat(0x5fbf6e));
    stem.position.y = 0.42; g.add(stem);
    const leaf = new THREE.Mesh(geo('sph', 0.13, 8, 8), mat(0x7be08a));
    leaf.scale.set(1, 0.35, 0.6); leaf.position.set(0.1, 0.42, 0); g.add(leaf);
    const c = pick([0xff6fa8, 0xffd93d, 0xb57edc, 0xff9a3d]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const p = new THREE.Mesh(geo('sph', 0.12, 8, 8), mat(c));
      p.scale.set(1, 0.6, 1);
      p.position.set(Math.cos(a) * 0.16, 0.88, Math.sin(a) * 0.16);
      g.add(p);
    }
    const core = new THREE.Mesh(geo('sph', 0.1, 8, 8), mat(0xfff6cc));
    core.position.y = 0.9; g.add(core);
    return g;
  }
  _sunLamp(night, tall) {
    const g = new THREE.Group();
    const h = tall ? 3.4 : 2.5;
    const pole = new THREE.Mesh(geo('cyl', 0.07, 0.1, h, 8), mat(night ? 0x3a3f4a : 0x6b7f8e));
    pole.position.y = h / 2; g.add(pole);
    const arm = new THREE.Mesh(geo('box', 0.7, 0.09, 0.09), mat(night ? 0x3a3f4a : 0x6b7f8e));
    arm.position.set(0.32, h - 0.1, 0); g.add(arm);
    const head = new THREE.Mesh(geo('sph', 0.19, 10, 10),
      mat(night ? 0xffe08a : 0xfff4c2, { std: true, emissive: 0xffe08a, emissiveIntensity: night ? 1.0 : 0.45 }));
    head.scale.set(1, 0.7, 1);
    head.position.set(0.62, h - 0.18, 0); g.add(head);
    if (night) {
      const base = new THREE.Mesh(geo('cyl', 0.22, 0.28, 0.3, 10), mat(0x2f343d));
      base.position.y = 0.15; g.add(base);
    }
    return g;
  }
  _makeCandyCane(big) {
    const g = new THREE.Group();
    const s = big ? 2.1 : 1.5;
    const pole = new THREE.Mesh(geo('cyl', 0.1 * s, 0.1 * s, s, 10), mat(0xffffff));
    pole.position.y = s / 2; g.add(pole);
    const hook = new THREE.Mesh(geo('torus', 0.28 * s, 0.1 * s, 8, 16, Math.PI), mat(0xff5a8a));
    hook.rotation.z = Math.PI;
    hook.position.set(0.28 * s, s, 0); g.add(hook);
    // 斜条纹
    for (let i = 0; i < 4; i++) {
      const st = new THREE.Mesh(geo('box', 0.23 * s, 0.11 * s, 0.05 * s), mat(0xff5a8a));
      st.position.set(0, 0.28 * s + i * 0.28 * s, 0.1 * s);
      st.rotation.z = 0.5; g.add(st);
    }
    return g;
  }
  _makeGumdrop(scale) {
    const g = new THREE.Group();
    const s = scale || 1;
    const c = pick([0xff6fa8, 0x7be08a, 0x4fc3f7, 0xffd93d, 0xb57edc]);
    const body = new THREE.Mesh(geo('cone', 0.45 * s, 0.8 * s, 14), mat(c));
    body.position.y = 0.4 * s; g.add(body);
    const dome = new THREE.Mesh(geo('sph', 0.28 * s, 12, 10), mat(c));
    dome.scale.y = 0.7; dome.position.y = 0.72 * s; g.add(dome);
    for (let i = 0; i < 5; i++) {
      const d = new THREE.Mesh(geo('sph', 0.05 * s, 6, 6), mat(0xffffff));
      const a = rand(0, 6.28), rr = rand(0.1, 0.4) * s;
      d.position.set(Math.cos(a) * rr, rand(0.3, 0.75) * s, Math.sin(a) * rr);
      g.add(d);
    }
    return g;
  }
  _makeTent(big) {
    const g = new THREE.Group();
    const s = big ? 1.7 : 1.15;
    const roof = new THREE.Mesh(geo('cone', 1.35 * s, 1.5 * s, 10), mat(pick([0xff5a8a, 0x4fc3f7, 0xffd93d])));
    roof.position.y = 1.0 * s; g.add(roof);
    const band = new THREE.Mesh(geo('cyl', 1.05 * s, 1.05 * s, 0.3 * s, 10), mat(0xffffff));
    band.position.y = 0.42 * s; g.add(band);
    const pole = new THREE.Mesh(geo('cyl', 0.05 * s, 0.05 * s, 1.9 * s, 6), mat(0xfff2b0));
    pole.position.y = 1.9 * s; g.add(pole);
    const flag = new THREE.Mesh(geo('box', 0.5 * s, 0.3 * s, 0.04), mat(pick([0x7be08a, 0xff7bac])));
    flag.position.set(0.3 * s, 2.7 * s, 0); g.add(flag);
    return g;
  }
  _makeCarousel() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(geo('cyl', 1.6, 1.75, 0.35, 16), mat(0xf0e6ff));
    base.position.y = 0.18; g.add(base);
    const roof = new THREE.Mesh(geo('cone', 1.9, 1.2, 12), mat(0xff5a8a));
    roof.position.y = 3.1; g.add(roof);
    const hub = new THREE.Mesh(geo('cyl', 0.16, 0.16, 2.2, 8), mat(0xffd93d));
    hub.position.y = 1.9; g.add(hub);
    const top = new THREE.Mesh(geo('sph', 0.22, 10, 10), mat(0xffd93d));
    top.position.y = 3.75; g.add(top);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const pole = new THREE.Mesh(geo('cyl', 0.05, 0.05, 1.9, 6), mat(0xfff2b0));
      pole.position.set(Math.cos(a) * 1.15, 1.3, Math.sin(a) * 1.15); g.add(pole);
      const horse = new THREE.Mesh(geo('box', 0.4, 0.34, 0.5), mat(pick([0xfff2b0, 0x9be08a, 0x4fc3f7, 0xffd93d])));
      horse.position.set(Math.cos(a) * 1.15, 0.85, Math.sin(a) * 1.15);
      horse.rotation.y = -a; g.add(horse);
    }
    return g;
  }
  _makePillar() {
    const g = new THREE.Group();
    const h = rand(4.2, 6.0);
    for (const sx of [-1.25, 1.25]) {
      const p = new THREE.Mesh(geo('box', 0.55, h, 0.55), mat(0x5a616e));
      p.position.set(sx, h / 2, 0); g.add(p);
      const cap = new THREE.Mesh(geo('box', 0.8, 0.3, 0.8), mat(0x454b56));
      cap.position.set(sx, h + 0.15, 0); g.add(cap);
    }
    const beam = new THREE.Mesh(geo('box', 3.1, 0.5, 0.6), mat(0x4a5160));
    beam.position.y = h + 0.4; g.add(beam);
    const lamp = new THREE.Mesh(geo('box', 0.7, 0.16, 0.16),
      mat(0xffe08a, { std: true, emissive: 0xffe08a, emissiveIntensity: 0.9 }));
    lamp.position.y = h + 0.1; g.add(lamp);
    return g;
  }
  _makeCrate() {
    const g = new THREE.Group();
    const c = 0x9b6b3f;
    const box = new THREE.Mesh(geo('box', 0.75, 0.75, 0.75), mat(c));
    box.position.y = 0.375; g.add(box);
    for (const sx of [-0.38, 0.38]) {
      const s = new THREE.Mesh(geo('box', 0.08, 0.8, 0.8), mat(0x7a5230));
      s.position.set(sx, 0.375, 0); g.add(s);
    }
    const top = new THREE.Mesh(geo('box', 0.82, 0.1, 0.82), mat(0x7a5230));
    top.position.y = 0.78; g.add(top);
    return g;
  }
  _makeBarrier() {
    const g = new THREE.Group();
    const bar = new THREE.Mesh(geo('box', 1.9, 0.26, 0.14), mat(0xffb300));
    bar.position.y = 0.85; g.add(bar);
    for (let i = 0; i < 3; i++) {
      const st = new THREE.Mesh(geo('box', 0.26, 0.34, 0.15), mat(0x2b2f3a));
      st.position.set(-0.62 + i * 0.62, 0.85, 0); g.add(st);
    }
    for (const sx of [-0.8, 0.8]) {
      const leg = new THREE.Mesh(geo('box', 0.14, 0.75, 0.14), mat(0xd9d9d9));
      leg.position.set(sx, 0.38, 0); g.add(leg);
      const foot = new THREE.Mesh(geo('box', 0.36, 0.1, 0.42), mat(0xb5b5b5));
      foot.position.set(sx, 0.05, 0); g.add(foot);
    }
    return g;
  }
  _makeCandyTree(scale) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(geo('cyl', 0.13, 0.18, 1.1, 8), mat(0x8d6e63));
    trunk.position.y = 0.55; g.add(trunk);
    const top = new THREE.Mesh(geo('sph', 0.55, 12, 12), mat(pick([0xff7bac, 0x4fc3f7, 0xb57edc, 0x7be08a, 0xffd93d])));
    top.position.y = 1.45; g.add(top);
    const top2 = new THREE.Mesh(geo('sph', 0.36, 10, 10), mat(0xffffff));
    top2.position.set(0.18, 1.75, 0.1); g.add(top2);
    if (scale) g.scale.setScalar(scale);
    return g;
  }
  _makeLollipop(scale) {
    const g = new THREE.Group();
    const stick = new THREE.Mesh(geo('cyl', 0.055, 0.055, 1.5, 8), mat(0xffffff));
    stick.position.y = 0.75; g.add(stick);
    const head = new THREE.Mesh(geo('cyl', 0.42, 0.42, 0.14, 18), mat(pick([0xff5a8a, 0xffa726, 0x4fc3f7, 0xb57edc])));
    head.rotation.x = Math.PI / 2; head.position.y = 1.62; g.add(head);
    const swirl = new THREE.Mesh(geo('cyl', 0.2, 0.2, 0.16, 14), mat(0xffffff));
    swirl.rotation.x = Math.PI / 2; swirl.position.y = 1.62; g.add(swirl);
    if (scale) g.scale.setScalar(scale);
    return g;
  }
  _makeBuilding(side) {
    const g = new THREE.Group();
    const w = rand(2.0, 3.0), h = rand(2.6, 5), d = 1.8;
    const body = new THREE.Mesh(geo('box', 1, 1, 1), mat(pick([0xffb3c7, 0xa8d8ff, 0xc7f0ce, 0xfff3b0, 0xd8c7ff])));
    body.scale.set(w, h, d); body.position.y = h / 2; g.add(body);
    const roof = new THREE.Mesh(geo('box', 1, 1, 1), mat(0x6b5b8e));
    roof.scale.set(w * 1.12, 0.28, d * 1.12); roof.position.y = h + 0.1; g.add(roof);
    const winMat = mat(0xfff2b0, { std: true, emissive: 0xffe08a, emissiveIntensity: 0.65 });
    const rows = Math.max(2, Math.floor(h / 1.1));
    for (let r = 0; r < rows; r++) {
      for (const wx of [-w * 0.24, w * 0.24]) {
        const win = new THREE.Mesh(geo('box', 0.3, 0.36, 0.06), winMat);
        win.position.set(wx, 0.8 + r * 1.0, d / 2 + 0.02); g.add(win);
      }
    }
    // 窗户开在 +z 面，正好朝向玩家身后的镜头。
    // （早先整栋楼绕 Y 轴转 ±90°，窗户被转到朝着赛道的那一侧，
    //   镜头只能看到一块没有窗户的空白板 —— 已经去掉该旋转。）
    return g;
  }
  _makeRainbow() {
    const g = new THREE.Group();
    const cols = [0xff5a5a, 0xffa726, 0xffd93d, 0x7be08a, 0x4fc3f7];
    for (let i = 0; i < cols.length; i++) {
      g.add(new THREE.Mesh(geo('torus', 1.9 + i * 0.17, 0.09, 8, 28, Math.PI), mat(cols[i])));
    }
    g.rotation.y = rand(-0.4, 0.4);
    return g;
  }
  _makeFerris(scale) {
    const g = new THREE.Group();
    for (const sx of [-0.9, 0.9]) {
      const leg = new THREE.Mesh(geo('box', 0.14, 2.4, 0.14), mat(0x8d99ae));
      leg.position.set(sx, 1.2, 0); leg.rotation.z = sx < 0 ? 0.35 : -0.35; g.add(leg);
    }
    const wheel = new THREE.Group(); wheel.position.y = 2.3;
    wheel.add(new THREE.Mesh(geo('torus', 1.25, 0.08, 8, 28), mat(0xff7bac)));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const spoke = new THREE.Mesh(geo('box', 0.05, 2.4, 0.05), mat(0xffd93d));
      spoke.rotation.z = a; wheel.add(spoke);
      const cab = new THREE.Mesh(geo('box', 0.26, 0.22, 0.26), mat(pick([0x4fc3f7, 0xffd93d, 0x7be08a, 0xff5a8a])));
      cab.position.set(Math.cos(a) * 1.25, Math.sin(a) * 1.25, 0); wheel.add(cab);
    }
    g.add(wheel);
    g.userData.wheel = wheel;
    g.userData.anim = [wheel];      // 轮子要独立旋转，合并时不能烘进去
    if (scale) g.scale.setScalar(scale);
    return g;
  }
  _makeBalloon() {
    const g = new THREE.Group();
    const c = pick([0xff5a8a, 0xffa726, 0x4fc3f7, 0x7be08a, 0xb57edc]);
    const ball = new THREE.Mesh(geo('sph', 0.36, 12, 12), mat(c));
    ball.scale.y = 1.15; ball.position.y = 2.3; g.add(ball);
    const knot = new THREE.Mesh(geo('cone', 0.07, 0.1, 6), mat(c));
    knot.position.y = 1.86; knot.rotation.x = Math.PI; g.add(knot);
    const string = new THREE.Mesh(geo('cyl', 0.012, 0.012, 1.6, 4), mat(0xffffff));
    string.position.y = 1.0; g.add(string);
    g.userData.bobber = { o: ball, baseY: 2.3, amp: 0.12, speed: 1.5, phase: rand(0, 6.28) };
    g.userData.anim = [ball];       // 气球要独立上下浮动
    return g;
  }
  _makeSignal(scale) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(geo('cyl', 0.06, 0.08, 2.2, 8), mat(0x3a3f4a));
    pole.position.y = 1.1; g.add(pole);
    const headBox = new THREE.Mesh(geo('box', 0.3, 0.75, 0.16), mat(0x2b2f3a));
    headBox.position.y = 2.35; g.add(headBox);
    const red = new THREE.Mesh(geo('sph', 0.09, 8, 8), mat(0xff3b30, { std: true, emissive: 0xff3b30, emissiveIntensity: 0.9 }));
    red.position.set(0, 2.55, 0.1); g.add(red);
    const green = new THREE.Mesh(geo('sph', 0.09, 8, 8), mat(0x34c759, { std: true, emissive: 0x34c759, emissiveIntensity: 0.9 }));
    green.position.set(0, 2.2, 0.1); g.add(green);
    if (scale) g.scale.setScalar(scale);
    return g;
  }

  _applyTheme(chunk) {
    const theme = THEMES[chunk.theme];
    chunk.floorMat.color.setHex(theme.ground);
    chunk.railMat.color.setHex(theme.rail);
    chunk.sideMat.color.setHex(theme.side);
    this._buildDecorations(chunk);
  }

  _get(pool, factory) {
    for (const o of pool) if (!o.visible) { o.visible = true; return o; }
    const o = factory(); this.scene.add(o); pool.push(o); o.visible = true; return o;
  }

  _makeObstacle(type, variant, low) {
    if (type === 'hurdle') return this._buildHurdle();
    if (type === 'overhead') return this._buildOverhead();
    if (type === 'train') return this._buildTrain(variant || 0, !!low);
    return this._buildWall();
  }

  // ---------------------------------------------------------------------------
  //  障碍物全部照「地铁跑酷」重做。三条硬约束：
  //   ① 命中盒（OBSTACLE_TYPES）一个字节都不改 —— 玩法、公平性、E2E 断言全部照旧；
  //   ② 每个障碍最后都过一遍 mergeDeco()，48 个 Mesh 合成 1 个（原来 21 个障碍要 280~442
  //      次 draw call，是全场景最大的一笔开销）。
  //   ③ 细节一律做在 +z 面：玩家沿 -z 前进，迎面看到的永远是 +z 那一侧。
  // ---------------------------------------------------------------------------

  // ---- 施工路障（可跳过）--------------------------------------------------
  // 地铁跑酷里最标志性的「跳过去」障碍：黄黑条纹护栏 + 两只琥珀警示灯。
  // 斜纹用「黄底 + 黑色 chevron 块」而不用旋转的长条 —— 旋转条会捅出面板边框。
  _buildHurdle() {
    const g = new THREE.Group();
    const steel = mat(0x3b3f4a), steelL = mat(0x5a6070);
    const yellow = mat(0xffc400), black = mat(0x23262f);
    const lampOn = mat(0xffb300, { std: true, emissive: 0xff8a00, emissiveIntensity: 0.9 });
    const reflect = mat(0xffffff, { std: true, emissive: 0xdddddd, emissiveIntensity: 0.5 });
    for (const sx of [-0.78, 0.78]) {
      const leg = new THREE.Mesh(geo('box', 0.12, 0.94, 0.12), steel);
      leg.position.set(sx, 0.47, 0); g.add(leg);
      const foot = new THREE.Mesh(geo('box', 0.6, 0.09, 0.58), steelL);
      foot.position.set(sx, 0.045, 0); g.add(foot);
      const brace = new THREE.Mesh(geo('box', 0.46, 0.07, 0.07), steelL);
      brace.position.set(sx, 0.3, 0.2); g.add(brace);
      const lamp = new THREE.Mesh(geo('cyl', 0.09, 0.11, 0.13, 10), lampOn);
      lamp.position.set(sx, 0.98, 0); g.add(lamp);
    }
    // 面板：黄底 + 黑框（上下两根横梁）
    const panel = new THREE.Mesh(geo('box', 1.8, 0.42, 0.18), yellow);
    panel.position.set(0, 0.72, 0); g.add(panel);
    const railT = new THREE.Mesh(geo('box', 1.86, 0.07, 0.22), black);
    railT.position.set(0, 0.96, 0.02); g.add(railT);
    const railB = new THREE.Mesh(geo('box', 1.86, 0.07, 0.22), black);
    railB.position.set(0, 0.48, 0.02); g.add(railB);
    // 正面三道黑色 chevron（地铁跑酷路障的经典标记）
    for (let i = 0; i < 3; i++) {
      const cx = -0.6 + i * 0.6;
      const a = new THREE.Mesh(geo('box', 0.5, 0.11, 0.22), black);
      a.rotation.z = -0.7; a.position.set(cx - 0.08, 0.72, 0.02); g.add(a);
      const b = new THREE.Mesh(geo('box', 0.5, 0.11, 0.22), black);
      b.rotation.z = 0.7; b.position.set(cx + 0.08, 0.72, 0.02); g.add(b);
    }
    // 下沿两条反光贴
    for (const sx of [-0.5, 0.5]) {
      const r = new THREE.Mesh(geo('box', 0.52, 0.09, 0.02), reflect);
      r.position.set(sx, 0.585, 0.1); g.add(r);
    }
    return mergeDeco(g);
  }

  // ---- 限高门架（必须滑铲 / 跳跃会撞头）-----------------------------------
  // 地铁跑酷里的「低矮门洞」：粗立柱 + 黄黑警示顶梁 + 悬挂限高牌。
  // 视觉必须传达「千万别跳」：顶梁实心段正好对应命中盒的 3.0~4.0。
  _buildOverhead() {
    const g = new THREE.Group();
    const concrete = mat(0x7b8191), concreteD = mat(0x5c6170);
    const yellow = mat(0xffc400), black = mat(0x23262f), white = mat(0xf2f5f8), orange = mat(0xff8a3d);
    const lampOn = mat(0xffb300, { std: true, emissive: 0xff8a00, emissiveIntensity: 0.8 });
    for (const sx of [-1.06, 1.06]) {
      const post = new THREE.Mesh(geo('box', 0.24, 4.0, 0.26), concrete);
      post.position.set(sx, 2.0, 0); g.add(post);
      const base = new THREE.Mesh(geo('box', 0.62, 0.14, 0.64), concreteD);
      base.position.set(sx, 0.07, 0); g.add(base);
      const band = new THREE.Mesh(geo('box', 0.27, 0.46, 0.29), yellow);
      band.position.set(sx, 0.52, 0); g.add(band);
      const bandD = new THREE.Mesh(geo('box', 0.28, 0.16, 0.3), black);
      bandD.position.set(sx, 0.52, 0); g.add(bandD);
    }
    // 顶梁：黄底 + 黑色斜纹块（交替），上下各压一根深色横梁
    const beam = new THREE.Mesh(geo('box', 2.6, 0.86, 0.5), yellow);
    beam.position.set(0, 3.5, 0); g.add(beam);
    for (let i = 0; i < 7; i++) {
      const w = 2.6 / 7;
      const blk = new THREE.Mesh(geo('box', w * 0.52, 0.9, 0.54), black);
      blk.position.set(-1.3 + w * (i + 0.5), 3.5, 0); g.add(blk);
    }
    const capT = new THREE.Mesh(geo('box', 2.82, 0.12, 0.6), concreteD);
    capT.position.set(0, 3.98, 0); g.add(capT);
    const capB = new THREE.Mesh(geo('box', 2.62, 0.1, 0.54), concreteD);
    capB.position.set(0, 3.05, 0); g.add(capB);
    // 悬挂限高牌：橙框 + 白底 + 黑色下箭头（= 滑铲）
    const frame = new THREE.Mesh(geo('box', 1.62, 0.74, 0.05), orange);
    frame.position.set(0, 2.72, 0.3); g.add(frame);
    const board = new THREE.Mesh(geo('box', 1.5, 0.62, 0.05), white);
    board.position.set(0, 2.72, 0.33); g.add(board);
    const stem = new THREE.Mesh(geo('box', 0.15, 0.3, 0.05), black);
    stem.position.set(0, 2.83, 0.36); g.add(stem);
    for (const s of [-1, 1]) {
      const arw = new THREE.Mesh(geo('box', 0.15, 0.26, 0.05), black);
      arw.rotation.z = s * 0.8; arw.position.set(s * 0.12, 2.63, 0.36); g.add(arw);
    }
    for (const sx of [-0.8, 0.8]) {
      const l = new THREE.Mesh(geo('cyl', 0.075, 0.075, 0.12, 10), lampOn);
      l.rotation.x = Math.PI / 2; l.position.set(sx, 2.9, 0.3); g.add(l);
    }
    return mergeDeco(g);
  }

  // ---- 地铁车厢（必须变道）------------------------------------------------
  // 三种涂装，对应地铁跑酷里成排的彩车。组成：车身 / 白窗带 / 车窗 / 双开门 /
  // 裙板转向架 / 车头（风挡 + 路牌 + 前照灯 + 尾灯 + 车钩）。
  // 车头朝 +z：玩家沿 -z 迎面上来，看到的正是车厢正面 —— 和地铁跑酷一样「迎面来车」。
  _buildTrain(variant, low) {
    const L = TRAIN_LIVERIES[variant % TRAIN_LIVERIES.length];
    const g = new THREE.Group();
    const body = mat(L.body), bodyD = mat(L.dark);
    const skirt = mat(0x2b303b), metal = mat(0x9aa3b2);
    const band = mat(0xf3f6fa), glass = mat(0x24303f), glassD = mat(0x1b232e);
    const head = mat(0xfff8e2, { std: true, emissive: 0xffe9a8, emissiveIntensity: 1.0 });
    const tail = mat(0xff5a5a, { std: true, emissive: 0xff2b2b, emissiveIntensity: 0.8 });
    const sign = mat(0x23262f);
    const edge = mat(0xffd93d);   // 车顶边缘黄条：告诉玩家「这节车顶可以站」

    // ---- 两种车高 ----
    // 标准款 3.4m：必须变道躲（车顶只有从相邻矮车顶再跳一次才上得去）。
    // 低矮款 2.05m：普通跳跃峰值 2.2m ⇒ 直接跳上去，是「上车顶」的正门。
    // ⚠️ 低矮款不用「整体纵向缩放」实现 —— 缩放会把车轮压成椭圆、门窗比例全歪；
    //    所以两套 Y 是手写的，X/Z 尺寸两者共用以保持车道占位完全一致。
    // ⚠️ 车顶面必须精确等于 CONFIG.TRAIN_ROOF(_LOW)：那是玩家的落脚高度。
    const D = low ? {
      bodyCY: 1.35, bodyH: 0.78,
      skirtCY: 0.72, skirtH: 0.44,
      roofCY: 1.925, roofH: 0.25,        // 顶面 = 1.925 + 0.125 = 2.05 ✔
      ventCY: 2.03,  ventH: 0.10,
      bandCY: 1.42,  bandH: 0.44,
      winCY: 1.42,   winH: 0.30,
      doorCY: 1.10,  doorH: 1.06,
      dwinCY: 1.40,  dwinH: 0.28,
      bogieCY: 0.34, wheelCY: 0.30, wheelR: 0.30, wheelZ: 0.34,
      shieldCY: 1.40, shieldH: 0.55,
      destCY: 1.68,  destH: 0.20,
      headCY: 0.92,  headR: 0.14,
      tailCY: 0.62,
      bumperCY: 0.50, couplerCY: 0.38,
      rearCY: 1.12,  rearH: 1.24,
      edgeY: 2.065,
    } : {
      bodyCY: 2.32, bodyH: 1.78,
      skirtCY: 1.08, skirtH: 0.7,
      roofCY: 3.28, roofH: 0.2,          // 顶面 = 3.28 + 0.10 = 3.38，空调箱顶 3.40 = 命中盒 maxY
      ventCY: 3.31, ventH: 0.18,
      bandCY: 2.62, bandH: 0.92,
      winCY: 2.62,  winH: 0.6,
      doorCY: 1.85, doorH: 1.95,
      dwinCY: 2.6,  dwinH: 0.5,
      bogieCY: 0.40, wheelCY: 0.36, wheelR: 0.36, wheelZ: 0.45,
      shieldCY: 2.62, shieldH: 0.95,
      destCY: 3.14, destH: 0.3,
      headCY: 1.6,  headR: 0.17,
      tailCY: 1.15,
      bumperCY: 0.85, couplerCY: 0.62,
      rearCY: 2.0,  rearH: 2.1,
      edgeY: 3.395,
    };

    // 车身主体 + 下部裙板
    const upper = new THREE.Mesh(geo('box', 2.6, D.bodyH, 7.6), body);
    upper.position.set(0, D.bodyCY, 0); g.add(upper);
    const lower = new THREE.Mesh(geo('box', 2.56, D.skirtH, 7.6), bodyD);
    lower.position.set(0, D.skirtCY, 0); g.add(lower);
    // 车顶（可站立面）+ 两台空调箱
    const roof = new THREE.Mesh(geo('box', 2.34, D.roofH, 7.52), bodyD);
    roof.position.set(0, D.roofCY, 0); g.add(roof);
    for (const sz of [-2.0, 1.2]) {
      const ac = new THREE.Mesh(geo('box', 1.5, D.ventH, 1.5), metal);
      ac.position.set(0, D.ventCY, sz); g.add(ac);
    }
    // 车顶两侧黄条：只画在「跳得上去」的矮车厢上 —— 它是「这节能上」的视觉承诺。
    // 画到 3.4m 的标准车厢上就变成骗人的提示（跳不上去），只会误导玩家。
    // 所以标准款的 D.edgeY 现在是不用的（留着当「车顶面」的文档）。
    if (low) {
      for (const sx of [-1.04, 1.04]) {
        const strip = new THREE.Mesh(geo('box', 0.12, 0.03, 7.44), edge);
        strip.position.set(sx, D.edgeY, 0); g.add(strip);
      }
    }
    // 白色窗带（比车身略宽，形成一圈腰线）
    const bandL = new THREE.Mesh(geo('box', 2.66, D.bandH, 7.62), band);
    bandL.position.set(0, D.bandCY, 0); g.add(bandL);
    // 侧窗（每侧 4 扇）
    for (const sx of [-1.33, 1.33]) {
      for (let i = 0; i < 4; i++) {
        const win = new THREE.Mesh(geo('box', 0.08, D.winH, 1.05), glass);
        win.position.set(sx, D.winCY, -2.85 + i * 1.9); g.add(win);
      }
    }
    // 双开门（每侧 2 组：门板 + 门缝 + 门上窗）
    for (const sx of [-1.32, 1.32]) {
      for (const sz of [-1.2, 1.9]) {
        const door = new THREE.Mesh(geo('box', 0.1, D.doorH, 0.98), glassD);
        door.position.set(sx, D.doorCY, sz); g.add(door);
        const seam = new THREE.Mesh(geo('box', 0.12, D.doorH, 0.06), band);
        seam.position.set(sx, D.doorCY, sz); g.add(seam);
        const dwin = new THREE.Mesh(geo('box', 0.13, D.dwinH, 0.72), glass);
        dwin.position.set(sx, D.dwinCY, sz); g.add(dwin);
      }
    }
    // 转向架 + 车轮
    for (const sz of [-2.45, 2.45]) {
      const bogie = new THREE.Mesh(geo('box', 2.3, D.wheelR, 1.35), skirt);
      bogie.position.set(0, D.bogieCY, sz); g.add(bogie);
      for (const sx of [-1.16, 1.16]) {
        for (const dz of [-D.wheelZ, D.wheelZ]) {
          const w = new THREE.Mesh(geo('cyl', D.wheelR, D.wheelR, 0.18, 12), metal);
          w.rotation.z = Math.PI / 2; w.position.set(sx, D.wheelCY, sz + dz); g.add(w);
        }
      }
    }
    // 车头：风挡 / 路牌 / 前照灯 / 尾灯 / 保险杠 / 车钩
    const shield = new THREE.Mesh(geo('box', 1.95, D.shieldH, 0.12), glass);
    shield.position.set(0, D.shieldCY, 3.82); g.add(shield);
    const shieldF = new THREE.Mesh(geo('box', 2.05, D.shieldH + 0.1, 0.06), bodyD);
    shieldF.position.set(0, D.shieldCY, 3.79); g.add(shieldF);
    const dest = new THREE.Mesh(geo('box', 1.5, D.destH, 0.1), sign);
    dest.position.set(0, D.destCY, 3.83); g.add(dest);
    const destL = new THREE.Mesh(geo('box', 1.2, D.destH * 0.47, 0.06), head);
    destL.position.set(0, D.destCY, 3.88); g.add(destL);
    for (const sx of [-0.78, 0.78]) {
      const hl = new THREE.Mesh(geo('cyl', D.headR, D.headR, 0.12, 12), head);
      hl.rotation.x = Math.PI / 2; hl.position.set(sx, D.headCY, 3.83); g.add(hl);
    }
    for (const sx of [-0.28, 0.28]) {
      const tl = new THREE.Mesh(geo('box', 0.22, 0.2, 0.1), tail);
      tl.position.set(sx, D.tailCY, 3.83); g.add(tl);
    }
    const bumper = new THREE.Mesh(geo('box', 2.62, 0.26, 0.24), skirt);
    bumper.position.set(0, D.bumperCY, 3.82); g.add(bumper);
    const coupler = new THREE.Mesh(geo('box', 0.42, 0.24, 0.3), skirt);
    coupler.position.set(0, D.couplerCY, 3.95); g.add(coupler);
    // 车尾（对称，用深色封板即可）
    const rear = new THREE.Mesh(geo('box', 2.5, D.rearH, 0.12), bodyD);
    rear.position.set(0, D.rearCY, -3.82); g.add(rear);
    return mergeDeco(g);
  }

  // ---- 集装箱 / 施工围挡（必须变道）--------------------------------------
  // 波纹侧板 + 四角立柱 + 黄黑警示带 + 门锁杆，正面一块白色编号牌。
  _buildWall() {
    const g = new THREE.Group();
    const body = mat(0xc0392b), bodyD = mat(0x8f2a1f), rib = mat(0xd4493a);
    const dark = mat(0x23262f), yellow = mat(0xffc400), cream = mat(0xe8ecf0), metal = mat(0x9aa3b2);
    const main = new THREE.Mesh(geo('box', 2.6, 3.3, 1.02), body);
    main.position.set(0, 1.72, 0); g.add(main);
    // 波纹侧板：竖直棱条（前后两侧）
    for (let i = 0; i < 8; i++) {
      const x = -1.16 + i * 0.332;
      for (const sz of [-0.53, 0.53]) {
        const r = new THREE.Mesh(geo('box', 0.17, 3.2, 0.06), rib);
        r.position.set(x, 1.72, sz); g.add(r);
      }
    }
    // 四角立柱 + 上下横梁
    for (const sx of [-1.3, 1.3]) for (const sz of [-0.51, 0.51]) {
      const c = new THREE.Mesh(geo('box', 0.18, 3.44, 0.18), bodyD);
      c.position.set(sx, 1.72, sz); g.add(c);
    }
    const top = new THREE.Mesh(geo('box', 2.72, 0.16, 1.18), bodyD);
    top.position.set(0, 3.44, 0); g.add(top);
    const bot = new THREE.Mesh(geo('box', 2.72, 0.14, 1.18), bodyD);
    bot.position.set(0, 0.07, 0); g.add(bot);
    // 正面黄黑警示带
    for (let i = 0; i < 8; i++) {
      const w = 2.6 / 8;
      const b = new THREE.Mesh(geo('box', w * 0.55, 0.42, 0.06), i % 2 ? dark : yellow);
      b.position.set(-1.3 + w * (i + 0.5), 2.98, 0.56); g.add(b);
    }
    // 正面编号牌（深色边框在后、白色板在前，靠投影做出描边）
    const plateEdge = new THREE.Mesh(geo('box', 1.3, 0.68, 0.04), dark);
    plateEdge.position.set(0, 1.95, 0.53); g.add(plateEdge);
    const plate = new THREE.Mesh(geo('box', 1.16, 0.54, 0.05), cream);
    plate.position.set(0, 1.95, 0.58); g.add(plate);
    // 门锁杆
    for (const sx of [-0.34, 0.34]) {
      const bar = new THREE.Mesh(geo('cyl', 0.055, 0.055, 2.9, 8), metal);
      bar.position.set(sx, 1.75, 0.57); g.add(bar);
      for (const y of [0.6, 2.9]) {
        const hinge = new THREE.Mesh(geo('box', 0.2, 0.14, 0.1), metal);
        hinge.position.set(sx, y, 0.58); g.add(hinge);
      }
    }
    return mergeDeco(g);
  }

  _makeCoin() {
    const g = new THREE.Group();
    const gold = mat(0xffc93d, { std: true, emissive: 0xff9a00, emissiveIntensity: 0.35, metalness: 0.7, roughness: 0.25 });
    const goldD = mat(0xe8a820, { std: true, emissive: 0xa85f00, emissiveIntensity: 0.3, metalness: 0.7, roughness: 0.3 });
    g.add(new THREE.Mesh(geo('torus', 0.32, 0.09, 10, 24), gold));
    const disc = new THREE.Mesh(geo('cyl', 0.26, 0.26, 0.08, 20), goldD);
    disc.rotation.x = Math.PI / 2; g.add(disc);
    const star = new THREE.Mesh(getStarGeo(), gold);
    star.position.z = 0.06; g.add(star);
    g.userData = { kind: 'coin' };
    return g;
  }
  _makeBottle() {
    const g = new THREE.Group();
    const milk = mat(0xffffff, { std: true, emissive: 0xfff0f5, emissiveIntensity: 0.15, roughness: 0.4 });
    const pink = mat(0xff9ec4);
    g.add(new THREE.Mesh(geo('cyl', 0.24, 0.28, 0.5, 14), milk));
    const neck = new THREE.Mesh(geo('cyl', 0.13, 0.19, 0.18, 12), milk); neck.position.y = 0.33; g.add(neck);
    const cap = new THREE.Mesh(geo('cyl', 0.15, 0.15, 0.09, 12), pink); cap.position.y = 0.46; g.add(cap);
    const label = new THREE.Mesh(geo('cyl', 0.29, 0.29, 0.16, 14), pink); label.position.y = -0.04; g.add(label);
    g.userData = { kind: 'bottle' };
    return g;
  }
  _makePower(type) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo('sph', 0.58, 16, 16),
      mat(0xffffff, { transparent: true, opacity: 0.22, depthWrite: false })));
    let icon;
    if (type === 'magnet') {
      icon = new THREE.Group();
      const u = new THREE.Mesh(geo('torus', 0.2, 0.09, 10, 20, Math.PI), mat(0xff4d4d));
      u.rotation.z = Math.PI; icon.add(u);
      for (const sx of [-0.2, 0.2]) {
        const tip = new THREE.Mesh(geo('box', 0.18, 0.14, 0.18), mat(0xffffff));
        tip.position.set(sx, 0.07, 0); icon.add(tip);
      }
    } else if (type === 'shield') {
      icon = new THREE.Group();
      const hx = new THREE.Mesh(geo('cyl', 0.3, 0.3, 0.12, 6), mat(0x4fc3f7));
      hx.rotation.x = Math.PI / 2; icon.add(hx);
      const core = new THREE.Mesh(geo('sph', 0.1, 10, 10), mat(0xffffff));
      core.position.z = 0.1; icon.add(core);
    } else if (type === 'speed') {
      icon = new THREE.Mesh(getBoltGeo(), mat(0xffa726, { std: true, emissive: 0xffa726, emissiveIntensity: 0.35 }));
    } else {
      icon = new THREE.Group();
      const green = mat(0x66bb6a);
      const segs = [[-0.05, 0.3, 0.45, 0.09], [0.17, 0.1, 0.09, 0.3], [0, 0.0, 0.35, 0.09], [-0.17, -0.2, 0.09, 0.3], [-0.02, -0.38, 0.4, 0.09]];
      for (const sg of segs) {
        const b = new THREE.Mesh(geo('box', sg[2], sg[3], 0.08), green);
        b.position.set(sg[0], sg[1], 0); icon.add(b);
      }
      for (const r of [0.7, -0.7]) {
        const b = new THREE.Mesh(geo('box', 0.09, 0.5, 0.08), green);
        b.rotation.z = r; b.position.set(0.55, 0, 0); icon.add(b);
      }
    }
    g.add(icon);
    g.userData = { kind: 'power', ptype: type };
    return g;
  }

  // ---------------- 赛道机关 ----------------
  // 与障碍物相反：机关是「踩上去有好处」的地面装置，不吃碰撞判定。
  // 两者都贴着地面，所以必须用颜色/朝向把「该躲」和「该踩」区分得非常明显：
  //   加速带 = 青蓝发光 + 三个朝前的箭头（踩了往前冲）
  //   弹跳板 = 粉色弹簧 + 顶板（踩了往上弹）
  // 生成后立刻 mergeDeco()，两个机关都只占 1 个 draw call。
  _makePad(type) {
    const g = new THREE.Group();

    if (type === 'boost') {
      const glow = mat(0x38d9ff, { std: true, emissive: 0x18a8d8, emissiveIntensity: 0.85, roughness: 0.3 });
      const arrowMat = mat(0xdffaff, { std: true, emissive: 0xbdefff, emissiveIntensity: 0.9 });
      const dark = mat(0x0f4c66);
      const base = new THREE.Mesh(geo('box', 2.55, 0.16, 3.6), dark);
      base.position.y = 0.03; g.add(base);
      const top = new THREE.Mesh(geo('box', 2.35, 0.1, 3.3), glow);
      top.position.y = 0.13; g.add(top);
      // 三道朝前(-z)的 V 形箭头，一眼看出「往前冲」
      for (let i = 0; i < 3; i++) {
        const z = 1.0 - i * 1.0;
        for (const sx of [-1, 1]) {
          const wing = new THREE.Mesh(geo('box', 0.9, 0.09, 0.32), arrowMat);
          wing.position.set(sx * 0.42, 0.2, z);
          wing.rotation.y = sx * Math.PI * 0.25;   // 两片斜杆拼成 V
          g.add(wing);
        }
      }
      // 两侧灯带
      for (const sx of [-1.32, 1.32]) {
        const strip = new THREE.Mesh(geo('box', 0.16, 0.22, 3.5), glow);
        strip.position.set(sx, 0.12, 0); g.add(strip);
      }
    } else {
      const pink = mat(0xff5f9e, { std: true, emissive: 0xd8306f, emissiveIntensity: 0.5 });
      const grey = mat(0xbfc7d4);
      const white = mat(0xffffff, { std: true, emissive: 0xffffff, emissiveIntensity: 0.7 });
      const dark = mat(0x4a5160);
      const base = new THREE.Mesh(geo('box', 2.5, 0.16, 2.4), dark);
      base.position.y = 0.03; g.add(base);
      // 弹簧线圈：三层逐渐收窄的环
      for (let i = 0; i < 3; i++) {
        const r = 0.62 - i * 0.06;
        const coil = new THREE.Mesh(geo('cyl', r, r, 0.16, 14), grey);
        coil.position.y = 0.22 + i * 0.2; g.add(coil);
      }
      const top = new THREE.Mesh(geo('box', 2.1, 0.18, 1.9), pink);
      top.position.y = 0.88; g.add(top);
      for (const sx of [-0.8, 0.8]) {
        const bar = new THREE.Mesh(geo('box', 0.22, 0.1, 1.7), white);
        bar.position.set(sx, 0.99, 0); g.add(bar);
      }
      // 四角支脚，避免看起来是浮着的一块板
      for (const sx of [-1.05, 1.05]) for (const sz of [-0.9, 0.9]) {
        const leg = new THREE.Mesh(geo('box', 0.18, 0.2, 0.18), dark);
        leg.position.set(sx, 0.1, sz); g.add(leg);
      }
    }

    mergeDeco(g);
    g.userData = { kind: 'pad', padType: type };
    return g;
  }

  _recycleContents(chunk) {
    for (const o of chunk.obstacles) { o.visible = false; o.position.set(0, -999, 0); }
    for (const c of chunk.coins) { c.visible = false; c.position.set(0, -999, 0); }
    for (const p of chunk.powerups) { p.visible = false; p.position.set(0, -999, 0); }
    for (const p of chunk.pads) { p.visible = false; p.position.set(0, -999, 0); p.userData.used = false; }
    chunk.obstacles.length = 0;
    chunk.coins.length = 0;
    chunk.powerups.length = 0;
    chunk.pads.length = 0;
  }

  // 从对象池取一个收集物并摆好
  _coin(chunk, kind, x, y, z) {
    const c = this._get(this.pools[kind], () => kind === 'bottle' ? this._makeBottle() : this._makeCoin());
    c.userData.kind = kind;
    c.position.set(x, y, z);
    c.rotation.y = Math.random() * Math.PI;
    c.visible = true;
    chunk.coins.push(c);
    return c;
  }

  // ---------------- 金币路线图案 ----------------
  // 以前所有金币都是「一条直线 + 轻弧」，玩家待在同一条车道就全收了。
  // 现在金币本身就是路线指引：拱形教你跳、斜线教你变道、圆环教你穿心。
  _spawnCoinPattern(chunk, kind, z0, lane, forceKind) {
    const pattern = forceKind || pick(['line', 'line', 'arc', 'swap', 'ring']);
    const X = CONFIG.LANE_X;

    if (pattern === 'arc') {
      // 拱形：中间抬到约 3.25m，只有跳起来才能全收
      const n = randInt(5, 7);
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        this._coin(chunk, kind, X[lane], 0.95 + Math.sin(t * Math.PI) * 2.3, z0 + k * 1.5);
      }
    } else if (pattern === 'swap') {
      // 斜线：从一条车道斜穿到相邻车道，引导平滑变道
      const other = lane + (lane === 0 ? 1 : lane === 2 ? -1 : (Math.random() < 0.5 ? -1 : 1));
      const n = randInt(5, 7);
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        this._coin(chunk, kind, lerp(X[lane], X[other], t), 1.0, z0 + k * 1.5);
      }
    } else if (pattern === 'ring') {
      // 圆环：立在车道里的圆环，穿过去一次收 2~3 枚
      const n = 10, R = 1.6;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        this._coin(chunk, kind, X[lane] + Math.sin(a) * R, 1.7 + Math.cos(a) * R, z0 + Math.sin(a) * 0.35);
      }
    } else {
      // 直线（沿用原来的轻弧手感）
      const n = randInt(3, 6);
      for (let k = 0; k < n; k++) {
        const arc = Math.sin((k / (n - 1)) * Math.PI) * 1.0;
        this._coin(chunk, kind, X[lane], 1.0 + arc, z0 + k * 1.4);
      }
    }
    return pattern;
  }

  _generate(chunk, distance) {
    chunk.theme = (Math.floor(distance / CONFIG.THEME_DISTANCE) + this.themeOffset) % this.themeCount;
    this._applyTheme(chunk);

    const difficulty = clamp(distance / 1200, 0, 1);
    // 冲刺段：障碍密度拉满（但下面的「安全带」约束保证永远有活路）
    // 用区块中心的里程判定，密集区大致覆盖 400~520m，与 HUD 播报的 420~500m 对齐
    const rush = rushAt(distance);
    chunk.rush = rush.active;
    const obstacleChance = rush.active ? 0.95 : lerp(0.45, 0.85, difficulty);

    const obstacleZs = [];   // 本区块所有障碍的 z，用于机关的净空校验
    let coinSlot = 0;

    // ---- 道具投放：按里程每 powerupInterval 米一个 ----
    // 以前这里写的是 `worldZ > lastPowerDist`：worldZ 是「负数世界坐标」，lastPowerDist 是
    // 「正数里程」，两边量纲都不一样，条件几乎永不成立 —— 道具实际上从头到尾刷不出几个，
    // 商店里的磁铁 / 护盾强化等于摆设。
    // 现在统一在「里程」空间里定位（z 越负里程越大 ⇒ worldDist = distance - z），
    // 并用一个存在 spawner 上的游标跨区块推进，位置不再吸附到 8m 栅格，
    // 这样光标永远不会卡在两个区块的缝里。
    const dNear = distance - (CONFIG.CHUNK_LENGTH / 2 - 4);
    const dFar = distance + (CONFIG.CHUNK_LENGTH / 2 - 6);
    while (this._powerCursor < dNear) this._powerCursor += this.powerupInterval;
    let powerLocalZ = null;
    if (this._powerCursor <= dFar) {
      if (Math.random() < 0.9) {
        const ptype = pick(['magnet', 'shield', 'speed', 'double']);
        const p = this._get(this.pools[ptype], () => this._makePower(ptype));
        p.userData.ptype = ptype;
        powerLocalZ = distance - this._powerCursor;
        p.position.set(pick(CONFIG.LANE_X), 1.2, chunk.group.position.z + powerLocalZ);
        p.userData.baseY = 1.2;
        p.userData.phase = Math.random() * Math.PI * 2;
        p.visible = true;
        chunk.powerups.push(p);
      }
      this._powerCursor += this.powerupInterval;
    }

    for (let z = -CONFIG.CHUNK_LENGTH / 2 + 6; z < CONFIG.CHUNK_LENGTH / 2 - 4; z += 8) {
      const worldZ = chunk.group.position.z + z;

      // 道具旁边 6m 内不放障碍，否则道具会藏进火车/墙体里根本看不见
      if (powerLocalZ !== null && Math.abs(z - powerLocalZ) < 6) {
        this._coin(chunk, 'coin', CONFIG.LANE_X[randInt(0, 2)], 1.0, worldZ);
        continue;
      }

      if (Math.random() < obstacleChance && worldZ < -8) {
        // ---- 公平性硬约束 ----
        // safeLane 是「本排一定空着」的车道，且每次只平移一格（相邻排之间必定走得过去）。
        // 其余车道再随机封。这样无论速度多快、密度多高，都不会出现必死局。
        if (Math.random() < lerp(0.15, 0.5, difficulty)) {
          this.safeLane = clamp(this.safeLane + (Math.random() < 0.5 ? -1 : 1), 0, 2);
        }
        const others = [0, 1, 2].filter((l) => l !== this.safeLane);
        others.sort(() => Math.random() - 0.5);
        const blockCount = rush.active
          ? (Math.random() < 0.6 ? 2 : 1)
          : (Math.random() < difficulty * 0.6 ? 2 : 1);
        // 最多封 2 条，且必定不含 safeLane ⇒ 至少留一条活路
        const lanes = others.slice(0, Math.min(blockCount, others.length));
        for (const lane of lanes) {
          const type = pick(['hurdle', 'overhead', 'train', 'wall']);
          // 车厢有「标准 / 低矮」两种车高，低矮款 2.05m 是「跳上车顶」的正门。
          // 两种车高必须独立成池（池键带 L 后缀）：_get() 复用池对象时不会重建几何，
          // 混在一个池里会让「低矮车」偶尔串成标准车的外观，车顶高度就和看到的样子对不上了。
          const low = type === 'train' && Math.random() < CONFIG.TRAIN_LOW_CHANCE;
          // 车厢三种涂装：池子按涂装分开取，但 userData.type 保持 'train'，
          // 于是 getBox() 查 OBSTACLE_TYPES、_recycleContents、E2E 断言全都不受影响。
          const livery = type === 'train' ? randInt(0, TRAIN_LIVERIES.length - 1) : 0;
          const poolKey = type === 'train' ? ('train' + livery + (low ? 'L' : '')) : type;
          const o = this._get(this.pools[poolKey], () => this._makeObstacle(type, livery, low));
          o.userData.type = type;
          o.userData.livery = livery;   // 仅作标记：截图/调试时按涂装定位车厢
          o.userData.low = low;
          // 车顶高度写进实例：矮车 2.05 / 标准车 3.4。站立平台与攀爬判定都读它，
          // 绝不能读 OBSTACLE_TYPES.train.maxY —— 那是标准车厢的契约高度，
          // 拿它判矮车厢，玩家站上 2.05m 的车顶会被当成撞车身。
          o.userData.roofY = low ? CONFIG.TRAIN_ROOF_LOW : CONFIG.TRAIN_ROOF;
          o.position.set(CONFIG.LANE_X[lane], 0, worldZ);
          o.visible = true;
          chunk.obstacles.push(o);
          // ---- 车顶金币（照《地铁跑酷》车顶吃币）----
          // 只铺在「跳得上去」的矮车厢上：金币串是「这节能上、上去了还有奖」的强指引。
          // 铺到 3.4m 标准车厢上就成了永远吃不到的诱饵，只会让玩家误判。
          // 高度 = 车顶 2.05 + ROOF_COIN_Y 0.85 = 2.90m ⇒ 站地面 pcY 0.96，净差 1.94 > 判定窗 1.7
          // ⇒ 站地面吃不到；站上车顶 pcY 3.01，净差 0.11 ⇒ 一跑过去全收。
          if (low) {
            const roofCoinY = CONFIG.TRAIN_ROOF_LOW + CONFIG.ROOF_COIN_Y;
            for (let k = 0; k < 4; k++) {
              this._coin(chunk, 'coin', CONFIG.LANE_X[lane], roofCoinY, worldZ - 3.2 + k * 2.13);
            }
          }
        }
        obstacleZs.push(worldZ);
        // 封了两条道时，在安全带上方铺一串「诱导金币」，把活路指出来
        if (lanes.length === 2) {
          for (let k = 0; k < 3; k++) {
            this._coin(chunk, 'coin', CONFIG.LANE_X[this.safeLane], 1.0, worldZ - 2.6 + k * 2.6);
          }
        }
      } else {
        const lane = randInt(0, 2);
        const kind = coinSlot % 6 === 5 ? 'bottle' : (Math.random() < 0.12 ? 'bottle' : 'coin');
        coinSlot++;
        this._spawnCoinPattern(chunk, kind, worldZ, lane);
      }
    }

    // ---- 机关投放：只放在「前方 PAD_CLEAR 米内没有任何障碍」的净空里 ----
    // 为什么只看前方：玩家沿 -z 前进，踩到机关被弹出去之后迎面撞上的才是前方障碍；
    // 后方障碍在踩机关之前就已经过去了，构不成危险。
    // 反过来，如果前后都要求 16m 净空，在 40m 一个区块、障碍又多的情况下几乎挑不出位置，
    // 结果就是 PAD_CHANCE 开得再高，也只有约 1/9 的区块能挑出合格位置。
    // 跨区块也不用担心：更靠前的那个区块总是「稍后才生成」，而它最近的障碍在
    // local -14，离本块最靠后的机关位 (local +12) 仍有 54-12 = 42m > PAD_CLEAR。
    if (Math.random() < CONFIG.PAD_CHANCE) {
      let best = null;
      for (let z = -CONFIG.CHUNK_LENGTH / 2 + 8; z < CONFIG.CHUNK_LENGTH / 2 - 8; z += 6) {
        const worldZ = chunk.group.position.z + z;
        if (worldZ > -14) continue;                    // 开局留白
        let ok = true;
        for (const oz of obstacleZs) if (oz < worldZ && worldZ - oz < CONFIG.PAD_CLEAR) { ok = false; break; }
        if (ok) for (const p of chunk.powerups) if (Math.abs(p.position.z - worldZ) < 6) { ok = false; break; }
        if (!ok) continue;
        best = worldZ; break;
      }
      if (best !== null) {
        const ptype = Math.random() < 0.5 ? 'boost' : 'spring';
        const pad = this._get(this.pools[ptype], () => this._makePad(ptype));
        pad.userData.padType = ptype;
        pad.position.set(pick(CONFIG.LANE_X), 0, best);
        pad.visible = true;
        chunk.pads.push(pad);
      }
    }
  }

  animateProps(dt, t) {
    for (const chunk of this.chunks) {
      for (const c of chunk.coins) c.rotation.y += dt * 3.2;
      for (const p of chunk.powerups) {
        p.rotation.y += dt * 2.2;
        const base = p.userData.baseY === undefined ? 1.2 : p.userData.baseY;
        const ph = p.userData.phase || 0;
        p.position.y = base + Math.sin(t * 3 + ph) * 0.14;
      }
      for (const b of chunk.bobbers) b.o.position.y = b.baseY + Math.sin(t * b.speed + b.phase) * b.amp;
      for (const s of chunk.spinners) s.rotation.z += dt * 0.4;
    }
  }

  update(playerZ, distance) {
    let minZ = Infinity;
    for (const c of this.chunks) minZ = Math.min(minZ, c.group.position.z);
    for (const c of this.chunks) {
      if (c.group.position.z - playerZ > CONFIG.RECYCLE_BEHIND) {
        this._recycleContents(c);
        minZ -= CONFIG.CHUNK_LENGTH;
        c.group.position.z = minZ;
        // ⚠️ 这里传的必须是「该区块自己对应的里程」= |新 z|，与 reset() 保持同一约定。
        // 以前写的是 distance + Math.abs(minZ)，等于把「玩家已跑里程」又加了一遍，
        // 生成出来的里程约是真实值的 2.4 倍 —— 后果是难度按 2 倍速爬升、
        // 主题在里程一半处就换、冲刺段的「密集区块」和 HUD 播报的里程完全对不上。
        this._generate(c, Math.abs(minZ));
      }
    }
  }

  reset() {
    this.safeLane = 1;   // 安全带从头开始，保证重开一局的序列和开局一致
    this._powerCursor = this.powerupInterval;   // 道具游标也重置，否则第二局开头会长期没有道具
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      this._recycleContents(c);
      c.group.position.z = -i * CONFIG.CHUNK_LENGTH;
      this._generate(c, Math.abs(c.group.position.z));
    }
  }
}

// ============================================================================
//  UIManager — 菜单 / HUD / 弹窗 / Toast
// ============================================================================
class UIManager {
  constructor() {
    this.el = {
      menu: byId('menu'), menuCoins: byId('menu-coins'), menuBest: byId('menu-best'), menuSkinName: byId('menu-skin-name'),
      modal: byId('modal'), modalTitle: byId('modal-title'), modalBody: byId('modal-body'),
      hud: byId('hud'), hudScore: byId('hud-score'), hudDistance: byId('hud-distance'), hudCoins: byId('hud-coins'),
      powerups: byId('powerups'), combo: byId('combo'), comboN: byId('combo-n'), comboX: byId('combo-x'),
      rush: byId('rush'), rushText: byId('rush-text'), rushFill: byId('rush-fill'), pop: byId('pop'),
      pause: byId('pause'), gameover: byId('gameover'), goRecord: byId('go-record'), goVideo: byId('go-video'),
      goScore: byId('go-score'), goDistance: byId('go-distance'), goCoins: byId('go-coins'), goBest: byId('go-best'),
      btnRevive: byId('btn-revive'), reviveCost: byId('revive-cost'), toast: byId('toast'), touchHint: byId('touch-hint'),
      // 主界面（按参考图布局）
      btnSound: byId('btn-sound'), btnMusic: byId('btn-music'),
      btnCrown: byId('btn-crown'), btnPlus: byId('btn-plus'), btnRank: byId('btn-rank'),
      btnRandom: byId('btn-random'), btnBoost: byId('btn-boost'), boostSub: byId('boost-sub'),
      bRuns: byId('b-runs'), bSkins: byId('b-skins'), bAchv: byId('b-achv'),
      dotCrown: byId('dot-crown'), dotShop: byId('dot-shop'), dotChal: byId('dot-chal'),
      dotNavShop: byId('dot-nav-shop'), dotNavAchv: byId('dot-nav-achv'),
    };
    // 结算视频缺失 / 解不开时，把整张卡片收掉 ——
    // 否则结算界面上会留一个空白的白框加金圈，比干脆没有视频更难看。
    if (this.el.goVideo && this.el.goVideo.addEventListener) {
      const gv = this.el.goVideo;
      gv.addEventListener('error', function () { gv.classList.add('hidden'); });
    }
  }
  updateMenu(save) {
    const d = save.data, st = d.stats;
    this.el.menuCoins.textContent = int(d.totalCoins);
    this.el.menuBest.textContent = int(d.best);

    // 顶栏音效 / 音乐图标状态
    this._toggleIcon(this.el.btnSound, !d.muted, '🔊', '🔇');
    this._toggleIcon(this.el.btnMusic, d.music, '🎵', '🔇');

    // 活动横幅
    this.el.bRuns.textContent = '共 ' + st.runs + ' 局';
    this.el.bSkins.textContent = d.skins.length + '/' + SKINS.length;
    let claimed = 0, claimable = 0;
    for (let i = 0; i < ACHIEVEMENTS.length; i++) {
      const a = ACHIEVEMENTS[i];
      const rec = d.achv[a.id] || {};
      if (rec.claimed) claimed++;
      else if ((st[a.stat] || 0) >= a.goal) claimable++;
    }
    this.el.bAchv.textContent = '成就 ' + claimed + '/' + ACHIEVEMENTS.length;

    // 红点提示
    let shopDot = false;
    for (let i = 0; i < UPGRADES.length; i++) {
      const u = UPGRADES[i], lv = d.upgrades[u.id] || 0;
      if (lv < u.max && d.totalCoins >= upgradeCost(u, lv)) { shopDot = true; break; }
    }
    this._dot(this.el.dotChal, claimable > 0);
    this._dot(this.el.dotNavAchv, claimable > 0);
    this._dot(this.el.dotShop, shopDot);
    this._dot(this.el.dotNavShop, shopDot);
    this._dot(this.el.dotCrown, d.best >= WORLD_UNLOCK[1]);

    // 底部按钮文案
    let skinName = SKINS[0].name;
    for (let i = 0; i < SKINS.length; i++) if (SKINS[i].id === d.skin) skinName = SKINS[i].name;
    this.el.menuSkinName.textContent = skinName;
    let lvTotal = 0;
    for (let i = 0; i < UPGRADES.length; i++) lvTotal += d.upgrades[UPGRADES[i].id] || 0;
    this.el.boostSub.textContent = '总等级 Lv.' + lvTotal + ' · 点击强化';
  }
  _toggleIcon(el, on, onIco, offIco) {
    if (!el) return;
    el.textContent = on ? onIco : offIco;
    el.classList.toggle('off', !on);
  }
  _dot(el, show) {
    if (!el) return;
    if (show) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  }
  showMenu() {
    this.el.menu.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.gameover.classList.add('hidden');
    this.el.combo.classList.add('hidden');
    this._goVideo(false);
  }
  showHUD() {
    this.el.menu.classList.add('hidden');
    this.el.modal.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.gameover.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this._goVideo(false);
  }
  updateHUD(score, distance, coins) {
    this.el.hudScore.textContent = int(score);
    this.el.hudDistance.textContent = int(distance);
    this.el.hudCoins.textContent = int(coins);
  }
  updateCombo(combo, mult) {
    if (combo >= 3) {
      this.el.combo.classList.remove('hidden');
      this.el.comboN.textContent = combo;
      this.el.comboX.textContent = '×' + mult.toFixed(1);
    } else {
      this.el.combo.classList.add('hidden');
    }
  }
  updatePowerups(p) {
    const chips = [];
    const add = (label, ratio, color) => chips.push(
      '<div class="pu-chip">' + label + '<div class="pu-bar"><i style="width:' +
      (clamp(ratio, 0, 1) * 100) + '%;background:' + color + '"></i></div></div>');
    if (p.shieldTimer > 0) add('🛡 护盾', p.shieldTimer / (p.shieldMax || CONFIG.SHIELD_TIME), '#4fc3f7');
    if (p.magnetTimer > 0) add('🧲 磁铁', p.magnetTimer / CONFIG.MAGNET_TIME, '#ff4d4d');
    if (p.speedBoostTimer > 0) add('⚡ 加速', p.speedBoostTimer / CONFIG.SPEEDBOOST_TIME, '#ffa726');
    if (p.padBoostTimer > 0) add('💨 加速带', p.padBoostTimer / CONFIG.PAD_BOOST_TIME, '#22b6d6');
    if (p.doubleTimer > 0) add('×2 双倍', p.doubleTimer / CONFIG.DOUBLE_TIME, '#66bb6a');
    this.el.powerups.innerHTML = chips.join('');
  }
  // ---- 冲刺段横幅 ----
  showRush() { this.el.rush.classList.remove('hidden'); }
  hideRush() { this.el.rush.classList.add('hidden'); }
  updateRush(ratio, remain) {
    this.el.rushFill.style.width = (clamp(ratio, 0, 1) * 100).toFixed(1) + '%';
    this.el.rushText.textContent = '金币 ×' + CONFIG.RUSH_COIN_MULT + ' · 剩 ' + Math.ceil(remain) + 'm';
  }
  // ---- 飘字（机关触发 / 地图切换 / 破纪录等即时反馈）----
  // 动画挂在 .show 上，每次重加类名就会重新播放，连续触发也不会「只闪第一次」。
  pop(text, cls) {
    const el = this.el.pop;
    el.className = 'pop' + (cls ? ' ' + cls : '');
    el.textContent = text;
    void el.offsetWidth;          // 强制重排，让动画能被重新触发
    el.classList.add('show');
  }
  openModal(title, html) {
    this.el.modalTitle.textContent = title;
    this.el.modalBody.innerHTML = html;
    this.el.modal.classList.remove('hidden');
  }
  closeModal() { this.el.modal.classList.add('hidden'); }
  showPause() { this.el.pause.classList.remove('hidden'); }
  hidePause() { this.el.pause.classList.add('hidden'); }
  // 结算界面里的「奶龙大笑」视频：只在结算遮罩可见时播放，其余时机一律暂停。
  // 放在 UIManager 而不是 GameManager —— 「谁显示结算层谁负责播」，
  // 于是无论从哪条路径离开（重新开始 / 复活 / 回主菜单 / 静默重开）都不会漏掉暂停，
  // 不会出现「人已经回到主界面了，还有一段视频在后台空转」。
  _goVideo(play) {
    const v = this.el.goVideo;
    if (!v) return;
    if (play) {
      // 每次死亡都从头播，不然第二次只会看到上一局剩下的半段
      try { v.currentTime = 0; } catch (e) { /* 元数据还没到，忽略即可 */ }
      const p = v.play();
      // 自动播放被拦时 play() 返回 rejected Promise，必须吞掉，否则是未处理拒绝
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } else if (!v.paused) {
      v.pause();
    }
  }
  showGameOver(score, distance, coins, best, isRecord, canRevive, reviveCost) {
    this.el.goRecord.classList.toggle('hidden', !isRecord);
    this.el.goScore.textContent = int(score);
    this.el.goDistance.textContent = int(distance);
    this.el.goCoins.textContent = int(coins);
    this.el.goBest.textContent = int(best);
    if (canRevive) { this.el.btnRevive.classList.remove('hidden'); this.el.reviveCost.textContent = reviveCost; }
    else this.el.btnRevive.classList.add('hidden');
    this.el.gameover.classList.remove('hidden');
    this.el.combo.classList.add('hidden');
    this.el.rush.classList.add('hidden');
    this._goVideo(true);
  }
  toast(msg, ms) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    const self = this;
    this._toastTimer = setTimeout(function () { self.el.toast.classList.add('hidden'); }, ms || 1400);
  }

  // ---------------- 弹窗内容渲染 ----------------
  renderWorld(save) {
    const best = save.data.best;
    const cur = save.data.startTheme || 0;
    const inkOn = seasonUnlocked(1, save.data);
    const rows = THEMES.map((t, i) => {
      // 前 4 张属第 1 赛季「阳光漫游」（看最高分），后 4 张属第 2 赛季「竹墨松林」（整季一起解锁）。
      const isSun = i < SUN_COUNT;
      const unlocked = isSun ? best >= WORLD_UNLOCK[i] : inkOn;
      const active = cur === i;
      let act;
      if (!unlocked) {
        act = '<button class="act" disabled>' + (isSun ? '最高分 ' + WORLD_UNLOCK[i] : '累计 ' + SEASONS[1].need + ' m') + '</button>';
      } else if (active) {
        act = '<button class="act on" disabled>出发地</button>';
      } else {
        act = '<button class="act" data-action="theme-set" data-id="' + i + '">从这里出发</button>';
      }
      const tag = active ? '<span class="tag">当前</span>' : (unlocked ? '' : '<span class="tag new">未解锁</span>');
      const season = isSun ? '第 1 赛季' : '第 2 赛季';
      return '<div class="item ' + (active ? 'active' : (unlocked ? 'owned' : '')) + '">' +
        '<div class="swatch" style="background:linear-gradient(135deg,' + hex(t.ground) + ',' + hex(t.rail) + ')"></div>' +
        '<div class="item-info"><div class="item-name">' + t.name + tag + '</div>' +
        '<div class="item-desc">' + WORLD_DESC[i] + '<br>' + season + ' · 轮换里的第 ' + (i + 1) + ' 张（' +
        int(i * CONFIG.THEME_DISTANCE) + '~' + int((i + 1) * CONFIG.THEME_DISTANCE) + ' 米）</div></div>' + act + '</div>';
    }).join('');
    return '<p class="modal-note">跑动中每 ' + int(CONFIG.THEME_DISTANCE) + ' 米到达一张新地图（按顺序轮换）；「出发地」只决定开局风景。' +
      (inkOn ? '第 2 赛季「竹墨松林」已解锁，接在阳光漫游后面一起轮换。'
             : '第 2 赛季「竹墨松林」的 4 张地图要<b>累计</b>跑满 ' + SEASONS[1].need + ' 米才解锁。') + '</p>' +
      '<div class="list">' + rows + '</div>';
  }
  renderRank(save) {
    const d = save.data, st = d.stats;
    const scores = d.scores || [];
    let board = '<p class="modal-note">还没有记录，去跑一局吧！</p>';
    if (scores.length) {
      board = scores.map((s, i) => '<div class="rank-row">' +
        '<span class="rank-no ' + (i === 0 ? 'top1' : '') + '">' + (i + 1) + '</span>' +
        '<div style="flex:1"><div style="font-weight:900">' + int(s.score) + ' 分</div>' +
        '<div class="rank-sub">' + int(s.dist) + ' m · 🪙' + int(s.coins) + ' · ' + s.date + '</div></div></div>').join('');
    }
    return '<div style="display:flex;align-items:center;gap:14px;padding:14px;border-radius:16px;' +
        'background:linear-gradient(135deg,var(--accent-a),var(--accent-b));margin-bottom:14px;box-shadow:0 6px 18px var(--accent-shadow)">' +
        '<div style="font-size:34px">🏆</div>' +
        '<div><div style="font-size:12px;font-weight:800;color:#dff0e4">历史最高分</div>' +
        '<div style="font-size:26px;font-weight:900;color:#fff;text-shadow:0 2px 6px rgba(0,0,0,.2)">' + int(d.best) + '</div></div>' +
      '</div>' +
      '<div class="section-title">本地 TOP 5</div><div class="list">' + board + '</div>' +
      '<div class="section-title">生涯统计</div><div class="list">' +
        '<div class="rank-row"><span>总局数</span><span class="rank-score">' + st.runs + '</span></div>' +
        '<div class="rank-row"><span>累计距离</span><span class="rank-score">' + int(st.totalDistance) + ' m</span></div>' +
        '<div class="rank-row"><span>累计金币</span><span class="rank-score">🪙 ' + int(st.totalCoinsEarned) + '</span></div>' +
        '<div class="rank-row"><span>最高连击</span><span class="rank-score">' + st.bestCombo + '</span></div>' +
        '<div class="rank-row"><span>道具使用</span><span class="rank-score">' + st.powerupsUsed + '</span></div>' +
        '<div class="rank-row"><span>复活次数</span><span class="rank-score">' + st.revives + '</span></div>' +
      '</div>';
  }
  renderSkins(save) {
    const rows = SKINS.map((s) => {
      const owned = save.data.skins.indexOf(s.id) >= 0;
      const active = save.data.skin === s.id;
      let act;
      if (!owned) act = '<button class="act buy" data-action="skin-buy" data-id="' + s.id + '"' +
        (save.data.totalCoins < s.price ? ' disabled' : '') + '>🪙 ' + s.price + '</button>';
      else if (active) act = '<button class="act on" disabled>使用中</button>';
      else act = '<button class="act" data-action="skin-select" data-id="' + s.id + '">使用</button>';
      const tag = !owned ? '<span class="tag new">未解锁</span>' : (active ? '<span class="tag">已装备</span>' : '');
      return '<div class="item ' + (active ? 'active' : (owned ? 'owned' : '')) + '">' +
        '<div class="swatch" style="background:linear-gradient(135deg,' + hex(s.body) + ',' + hex(s.accent) + ')"></div>' +
        '<div class="item-info"><div class="item-name">' + s.name + tag + '</div>' +
        '<div class="item-desc">' + s.desc + '</div></div>' + act + '</div>';
    }).join('');
    return '<p class="modal-note">选中后立即应用到身后的 3D 预览。</p><div class="list">' + rows + '</div>';
  }
  renderShop(save) {
    const rows = UPGRADES.map((u) => {
      const lv = save.data.upgrades[u.id] || 0;
      const maxed = lv >= u.max;
      const cost = upgradeCost(u, lv);
      const can = !maxed && save.data.totalCoins >= cost;
      const btn = maxed
        ? '<button class="act on" disabled>已满级</button>'
        : '<button class="act buy" data-action="upg-buy" data-id="' + u.id + '"' + (can ? '' : ' disabled') + '>🪙 ' + cost + '</button>';
      return '<div class="item ' + (maxed ? 'owned' : '') + '">' +
        '<div class="swatch" style="background:linear-gradient(135deg,var(--accent-a),var(--accent-b))"></div>' +
        '<div class="item-info"><div class="item-name">' + u.name + '<span class="tag">Lv.' + lv + '/' + u.max + '</span></div>' +
        '<div class="item-desc">' + u.desc + '</div></div>' + btn + '</div>';
    }).join('');
    return '<p class="modal-note">强化永久生效，金币来自每局收集。</p><div class="list">' + rows + '</div>';
  }
  renderAchievements(save) {
    const rows = ACHIEVEMENTS.map((a) => {
      const cur = Math.min(int(save.data.stats[a.stat]), a.goal);
      const done = cur >= a.goal;
      const rec = save.data.achv[a.id] || {};
      const claimed = !!rec.claimed;
      const pct = Math.round((cur / a.goal) * 100);
      let btn;
      if (claimed) btn = '<button class="act on" disabled>已领取</button>';
      else if (done) btn = '<button class="act claim" data-action="achv-claim" data-id="' + a.id + '">领取 🪙' + a.reward + '</button>';
      else btn = '<button class="act" disabled>' + pct + '%</button>';
      return '<div class="item ' + (done ? 'owned' : '') + '">' +
        '<div class="swatch" style="background:linear-gradient(135deg,var(--accent-a),var(--accent-b))"></div>' +
        '<div class="item-info"><div class="item-name">' + a.name + '</div>' +
        '<div class="item-desc">' + a.desc + ' · ' + cur + '/' + a.goal + '</div>' +
        '<div class="progress ' + (done ? 'done' : '') + '"><i style="width:' + pct + '%"></i></div></div>' + btn + '</div>';
    }).join('');
    return '<div class="list">' + rows + '</div>';
  }
  renderSettings(save) {
    const d = save.data;
    const sw = (key, on) => '<button class="switch ' + (on ? 'on' : '') + '" data-action="set-toggle" data-id="' + key + '"></button>';
    const scores = d.scores || [];
    let ranks = '<p class="modal-note">还没有记录，去跑一局吧！</p>';
    if (scores.length) {
      ranks = scores.map((s, i) => '<div class="rank-row">' +
        '<span class="rank-no ' + (i === 0 ? 'top1' : '') + '">' + (i + 1) + '</span>' +
        '<div><div style="font-weight:900">' + int(s.score) + '</div>' +
        '<div class="rank-sub">' + int(s.dist) + ' m · 🪙' + int(s.coins) + ' · ' + s.date + '</div></div></div>').join('');
    }
    const st = d.stats;
    // 兑换码：输入框 + 按钮，走 modalBody 上已有的 [data-action] 事件代理
    // （modalBody 本身不重建，只有 innerHTML 换，所以代理一直有效）。
    const usedCodes = Object.keys(d.codes || {});
    const redeem = '<div class="redeem">' +
      '<input id="redeem-input" class="redeem-input" type="text" inputmode="text" maxlength="24" ' +
        'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" ' +
        'placeholder="输入兑换码" aria-label="兑换码">' +
      '<button id="redeem-btn" class="redeem-btn" type="button" data-action="redeem">兑换</button>' +
      '</div>' +
      '<p class="modal-note" style="margin-top:8px">' +
        (usedCodes.length ? '已兑换：' + usedCodes.join('、') : '输入有效的兑换码，可领取金币奖励。') +
      '</p>';
    return '<div class="list">' +
      '<div class="setting">音效 ' + sw('muted', !d.muted) + '</div>' +
      '<div class="setting">背景音乐 ' + sw('music', d.music) + '</div>' +
      '<div class="setting">震动反馈 ' + sw('vibrate', d.vibrate) + '</div>' +
      '<div class="setting">画质<div class="seg">' +
        '<button data-action="set-quality" data-id="high" class="' + (d.quality === 'high' ? 'on' : '') + '">高清</button>' +
        '<button data-action="set-quality" data-id="low" class="' + (d.quality === 'low' ? 'on' : '') + '">省电</button>' +
      '</div></div></div>' +
      '<div class="section-title">兑换码</div><div class="list">' + redeem + '</div>' +
      '<div class="section-title">本地排行榜</div><div class="list">' + ranks + '</div>' +
      '<div class="section-title">统计</div><div class="list">' +
        '<div class="rank-row"><span>总局数</span><span class="rank-score">' + st.runs + '</span></div>' +
        '<div class="rank-row"><span>累计距离</span><span class="rank-score">' + int(st.totalDistance) + ' m</span></div>' +
        '<div class="rank-row"><span>累计金币</span><span class="rank-score">🪙 ' + int(st.totalCoinsEarned) + '</span></div>' +
        '<div class="rank-row"><span>最高连击</span><span class="rank-score">' + st.bestCombo + '</span></div>' +
        '<div class="rank-row"><span>复活次数</span><span class="rank-score">' + st.revives + '</span></div>' +
      '</div>' +
      '<button class="btn btn-ghost" style="margin-top:14px;color:#c0392b" data-action="reset-data">清除存档</button>';
  }
}

// ============================================================================
//  GameManager — 串联所有系统
// ============================================================================
class GameManager {
  constructor() {
    this.state = 'menu'; // menu | playing | paused | gameover
    this.save = new SaveSystem();
    this.audio = new AudioManager();
    this.audio.muted = this.save.data.muted;
    this.audio.musicOn = this.save.data.music;
    this.audio.preloadBGM();   // 玩家还在看菜单时就把 BGM 下好，第一次开跑不会缺一小节
    this.ui = new UIManager();

    this.currentTab = 'skins';
    this.showcaseTime = 0;
    this._achvToasted = new Set(Object.keys(this.save.data.achv || {}));
    this.bootError = null;

    // 本局的玩法计数（每次 resetRun 清零）
    this.rushActive = false;    // 当前是否处于冲刺段
    this.rushCleared = 0;       // 本局通过的冲刺段数

    // 先把 UI 事件绑好。这样即使后面 3D 初始化出任何问题，
    // 按钮也不会变成「点了完全没反应」——所有 3D 相关调用都在 try 里。
    this._bindUI();
    this._armBGMOnGesture();   // 主界面就要有音乐：首次任意交互即起播
    this.ui.showMenu();

    try {
      this._initThree();
      this.player = new PlayerController(this.scene, this.save.data.skin);
      this.player.game = this;   // 让玩家能查询「可站立平台」（车厢车顶）
      this.spawner = new ChunkSpawner(this.scene);

      this.input = new InputManager(this.renderer.domElement, {
        left: () => this._onLeft(), right: () => this._onRight(),
        jump: () => this._onJump(), slide: () => this._onSlide(), pause: () => this._onPause(),
      });

      // 所有会碰到 3D 对象的调用都留在 try 里，任何一种失败都不该拖垮 UI
      this._paintMenuScene();
    } catch (e) {
      this._fatal(e);
      return;
    }

    this.resetRun();
    this.applyQuality();
    window.addEventListener('resize', () => this._onResize());
    if ('ontouchstart' in window) this.ui.el.touchHint.classList.remove('hidden');

    // 冷启动就要同步赛季 UI：累计里程早就过 1 万的老玩家，打开页面第一眼就该是「竹墨松林」，
    // 而不是等下一次 _refresh()（例如跑完一局回主界面）才被纠正 —— 否则首页文案与整套配色
    // 会停在阳光漫游，玩家会以为自己的进度丢了。
    // 先把 _inkAnnounced 预置成「本次会话之前就已解锁」，这样启动时不会给老玩家白弹一次
    // 「新赛季解锁」播报（那播报只该出现在本次会话里刚跨过阈值的瞬间）。
    this._inkAnnounced = seasonUnlocked(1, this.save.data);
    this._checkSeasonUnlock();
    this.ui.updateMenu(this.save);
    this.ui.showMenu();

    this.clock = new THREE.Clock();
    this._animate();
  }

  // ---------------- 启动失败兜底 ----------------
  // 把错误显式呈现出来，而不是留一个「点了完全没反应」的死界面。
  _fatal(err) {
    this.bootError = err;
    try { console.error('[奶龙跑酷] 3D 初始化失败:', err); } catch (e) {}
    const msg = (err && (err.message || err)) ? String(err.message || err) : String(err);
    this.ui.showMenu();
    this._showBanner('⚠️ 3D 初始化失败（菜单仍可用）', msg +
      '\n\n皮肤 / 商店 / 成就 / 设置等界面功能不受影响，但无法开始跑酷。' +
      '\n常见原因：浏览器未启用 WebGL，或显卡驱动被禁用。');
  }
  _showBanner(title, desc) {
    let box = byId('boot-error');
    if (!box) {
      box = document.createElement('div');
      box.id = 'boot-error';
      (byId('game-container') || document.body).appendChild(box);
    }
    box.innerHTML = '';
    const t = document.createElement('b');
    t.textContent = title;
    const p = document.createElement('pre');
    p.textContent = desc;
    box.appendChild(t);
    box.appendChild(p);
  }

  _initThree() {
    const canvas = byId('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(THEMES[0].fog, 30, 160);

    this.camera = new THREE.PerspectiveCamera(CONFIG.CAMERA_BASE_FOV, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, CONFIG.CAM_FOLLOW.y, CONFIG.CAM_FOLLOW.z);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8888aa, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(6, 12, 8);
    this.scene.add(dir);

    this.clouds = [];
    for (let i = 0; i < CONFIG.CLOUD_COUNT; i++) {
      const cloud = this._makeCloud();
      cloud.position.set(rand(-26, 26), rand(10, 22), rand(-CONFIG.CLOUD_SPREAD, 12));
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }
    this._cloudTheme = -1;
  }
  // 云朵：4~5 个压扁的球体，合并成 1 个 draw call。
  // 材质用 Basic（不受光照），所以云永远是云的颜色，不会被半球光地面色打成灰球。
  _makeCloud() {
    const g = new THREE.Group();
    const n = 4 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const r = CLOUD_RADII[i % CLOUD_RADII.length];
      const puff = new THREE.Mesh(geo('sph', r, 9, 7), mat(CLOUD_PUFF_COLORS[i % CLOUD_PUFF_COLORS.length]));
      puff.position.set(rand(-2.3, 2.3), rand(-0.4, 0.5), rand(-0.7, 0.7));
      puff.scale.set(1, 0.78, 1);   // 压扁，更像云而不是球
      g.add(puff);
    }
    g.rotation.y = rand(0, Math.PI * 2);
    const mesh = mergeSubtree(g, null, new THREE.MeshBasicMaterial({ vertexColors: true }));
    // 每朵云一份材质，方便按主题单独调色（Basic + vertexColors：color 会乘到顶点色上）
    if (mesh) g.userData.mesh = mesh;
    return g;
  }

  applyQuality() {
    const cap = this.save.data.quality === 'low' ? CONFIG.LOW_PIXEL_RATIO : CONFIG.MAX_PIXEL_RATIO;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));
  }

  _lvl(id) { return this.save.data.upgrades[id] || 0; }
  _vibrate(ms) { if (this.save.data.vibrate && navigator.vibrate) navigator.vibrate(ms); }

  resetRun() {
    this.speed = CONFIG.START_SPEED;
    this.distance = 0;
    this.score = 0;
    this.coins = 0;
    this.time = 0;
    this.dead = false;
    this.rushActive = false;
    this.rushCleared = 0;
    this._themeIdx = null;   // 新地图播报用：记录上一帧的场景下标
    this.ui.hideRush();
    this.player.reset();
    this.spawner.powerupInterval = Math.max(90, CONFIG.POWERUP_INTERVAL - 40 * this._lvl('luck'));
    this.spawner.themeCount = themeCountFor(this.save.data);
    this.spawner.themeOffset = this.save.data.startTheme || 0;
    this.spawner.reset();
    // 云朵也回到出生点附近：否则上一局跑远了，这局开局天上会是空的
    if (this.clouds) {
      for (let i = 0; i < this.clouds.length; i++) {
        const c = this.clouds[i];
        c.position.set(rand(-34, 34), rand(10, 22), -i * (CONFIG.CLOUD_SPREAD / this.clouds.length) + 12);
      }
      this._setCloudTint(this.save.data.startTheme || 0);
    }
  }

  startGame() {
    this.audio.init();
    this.audio.resume();
    this.audio.setMuted(this.save.data.muted);
    this.audio.setMusic(this.save.data.music);
    this.audio.startBGM();
    this.resetRun();
    const hs = this._lvl('headstart');
    if (hs > 0) this.player.speedBoostTimer = 3 * hs;
    this.state = 'playing';
    this.ui.showHUD();
  }

  _onLeft() { if (this.state === 'playing') this.player.moveLeft(); }
  _onRight() { if (this.state === 'playing') this.player.moveRight(); }
  _onJump() { if (this.state === 'playing' && this.player.jump()) this.audio.jump(); }
  _onSlide() { if (this.state === 'playing' && this.player.slide()) this.audio.slide(); }
  _onPause() {
    // 背景音乐贯穿全局：暂停页照放，所以这里不碰 BGM（只有「关掉音乐开关」才会停）
    if (this.state === 'playing') { this.state = 'paused'; this.ui.showPause(); }
    else if (this.state === 'paused') { this.state = 'playing'; this.ui.hidePause(); }
  }

  // 背景音乐要贯穿「主界面 → 游戏 → 结算 → 主界面」，所以不能等到 startGame() 才播。
  // 但浏览器的自动播放策略要求「先有用户手势」，否则 play() 会被拒绝。
  // 于是两手准备：加载完立刻试一次（部分环境允许直接播），同时挂一次性手势钩子兜底。
  _armBGMOnGesture() {
    const EVENTS = ['pointerdown', 'touchstart', 'mousedown', 'keydown'];
    const kick = () => {
      EVENTS.forEach((e) => window.removeEventListener(e, kick));
      // AudioContext 也放进手势里创建，免得浏览器告警「无手势就创建音频上下文」
      this.audio.init();
      this.audio.resume();
      this.audio.setMuted(this.save.data.muted);
      this.audio.setMusic(this.save.data.music);
      this.audio.startBGM();
    };
    EVENTS.forEach((e) => window.addEventListener(e, kick, { passive: true }));
    this.audio.startBGM();   // 先试一次；被自动播放策略拒绝时 _playBGM() 会静默吞掉
  }

  _bindUI() {
    const el = this.ui.el;
    byId('btn-play').onclick = () => this.startGame();
    byId('btn-pause').onclick = () => this._onPause();
    byId('btn-resume').onclick = () => this._onPause();
    byId('btn-restart').onclick = () => this.startGame();
    byId('btn-quit').onclick = () => this._toMenu();
    byId('btn-again').onclick = () => this.startGame();
    byId('btn-menu').onclick = () => this._toMenu();
    byId('btn-revive').onclick = () => this._revive();
    byId('modal-close').onclick = () => this.ui.closeModal();

    // ---- 主界面顶栏 / 货币行 ----
    if (el.btnSound) el.btnSound.onclick = () => this._toggleSound();
    if (el.btnMusic) el.btnMusic.onclick = () => this._toggleMusic();
    if (el.btnCrown) el.btnCrown.onclick = () => this._showCrown();
    if (el.btnPlus) el.btnPlus.onclick = () => this._showCoinHelp();
    if (el.btnRank) el.btnRank.onclick = () => this._openTab('rank');

    // ---- 底部操作区 ----
    if (el.btnRandom) el.btnRandom.onclick = () => this._randomSkin();
    if (el.btnBoost) el.btnBoost.onclick = () => this._openTab('shop');
    if (byId('nav-run')) byId('nav-run').onclick = () => this.startGame();

    // ---- 侧列 + 底部导航（统一按 data-tab 分发）----
    const tabs = document.querySelectorAll('.side-btn[data-tab], .nav-item[data-tab]');
    for (let i = 0; i < tabs.length; i++) tabs[i].onclick = () => this._openTab(tabs[i].dataset.tab);

    this.ui.el.modalBody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || btn.disabled) return;
      const act = btn.dataset.action, id = btn.dataset.id;
      if (act === 'skin-buy') this._buySkin(id);
      else if (act === 'skin-select') this._selectSkin(id);
      else if (act === 'upg-buy') this._buyUpgrade(id);
      else if (act === 'achv-claim') this._claimAchv(id);
      else if (act === 'set-toggle') this._toggleSetting(id);
      else if (act === 'set-quality') this._setQuality(id);
      else if (act === 'theme-set') this._setStartTheme(parseInt(id, 10));
      else if (act === 'reset-data') this._resetData();
      else if (act === 'redeem') this._redeem();
    });

    // 兑换码输入框里按回车 = 点「兑换」。
    // 只判 id，不做全局键盘拦截 —— 全局那层已经会在「焦点在输入框」时让路（见 InputManager._bind）。
    this.ui.el.modalBody.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.keyCode !== 13) return;
      const t = e.target;
      if (t && t.id === 'redeem-input') { e.preventDefault(); this._redeem(); }
    });
  }

  _openTab(tab) {
    this.currentTab = tab;
    const titles = {
      skins: '🎨 奶龙皮肤', shop: '🧰 道具强化', achv: '🏆 挑战之路',
      world: '🗺️ 世界地图', rank: '👑 排行榜', settings: '⚙️ 游戏设置',
    };
    this.ui.openModal(titles[tab] || '菜单', this._renderTab(tab));
  }
  _renderTab(tab) {
    if (tab === 'skins') return this.ui.renderSkins(this.save);
    if (tab === 'shop') return this.ui.renderShop(this.save);
    if (tab === 'achv') return this.ui.renderAchievements(this.save);
    if (tab === 'world') return this.ui.renderWorld(this.save);
    if (tab === 'rank') return this.ui.renderRank(this.save);
    return this.ui.renderSettings(this.save);
  }
  _refresh() {
    this._checkSeasonUnlock();
    this.ui.updateMenu(this.save);
    if (!this.ui.el.modal.classList.contains('hidden')) {
      this.ui.el.modalBody.innerHTML = this._renderTab(this.currentTab);
    }
  }

  _buySkin(id) {
    let s = null;
    for (const x of SKINS) if (x.id === id) s = x;
    if (!s) return;
    if (this.save.data.skins.indexOf(id) >= 0) return this._selectSkin(id);
    if (this.save.data.totalCoins < s.price) return this.ui.toast('金币不足');
    this.save.data.totalCoins -= s.price;
    this.save.data.skins.push(id);
    this.save.data.skin = id;
    this.save.save();
    this.player.applySkin(id);
    this.audio.buy();
    this.ui.toast('解锁并装备：' + s.name);
    this._refresh();
  }
  _selectSkin(id) {
    if (this.save.data.skins.indexOf(id) < 0) return this.ui.toast('尚未解锁');
    this.save.data.skin = id;
    this.save.save();
    this.player.applySkin(id);
    let name = id;
    for (const x of SKINS) if (x.id === id) name = x.name;
    this.ui.toast('已装备：' + name);
    this._refresh();
  }
  _buyUpgrade(id) {
    let u = null;
    for (const x of UPGRADES) if (x.id === id) u = x;
    if (!u) return;
    const lv = this._lvl(id);
    if (lv >= u.max) return;
    const cost = upgradeCost(u, lv);
    if (this.save.data.totalCoins < cost) return this.ui.toast('金币不足');
    this.save.data.totalCoins -= cost;
    this.save.data.upgrades[id] = lv + 1;
    this.save.save();
    this.audio.buy();
    this.ui.toast(u.name + ' 提升至 Lv.' + (lv + 1));
    this._refresh();
  }
  _claimAchv(id) {
    let a = null;
    for (const x of ACHIEVEMENTS) if (x.id === id) a = x;
    if (!a) return;
    const rec = this.save.data.achv[id] || {};
    if (rec.claimed) return;
    if ((this.save.data.stats[a.stat] || 0) < a.goal) return;
    this.save.data.achv[id] = { claimed: true };
    this.save.data.totalCoins += a.reward;
    this.save.save();
    this.audio.buy();
    this.ui.toast('成就奖励 +🪙' + a.reward);
    this._refresh();
  }
  _toggleSetting(key) {
    const d = this.save.data;
    if (key === 'muted') { d.muted = !d.muted; this.audio.setMuted(d.muted); }
    // 不再限定 state === 'playing'：主界面 / 结算页打开开关也要立刻响
    else if (key === 'music') { d.music = !d.music; this.audio.setMusic(d.music); this.audio.startBGM(); }
    else if (key === 'vibrate') { d.vibrate = !d.vibrate; }
    this.save.save();
    this._refresh();
  }
  _setQuality(q) {
    this.save.data.quality = q;
    this.save.save();
    this.applyQuality();
    this._refresh();
  }

  // ---------------- 兑换码 ----------------
  // 三种失败各给不同提示，并且**失败时不刷新面板** ——
  // 一刷新 innerHTML 就把输入框连同玩家刚敲的那串字一起重建了，改一个字符重试都做不到。
  _redeem() {
    const inp = document.getElementById('redeem-input');
    const raw = inp ? inp.value : '';
    if (!normalizeCode(raw)) return this.ui.toast('请输入兑换码');
    const hit = findRedeemCode(raw);
    if (!hit) return this.ui.toast('兑换码无效');
    const used = this.save.data.codes || (this.save.data.codes = {});
    const key = normalizeCode(hit.code);
    if (used[key]) return this.ui.toast('这个兑换码已经用过了');
    used[key] = Date.now();
    // 只加金币余额，**不动** stats.totalCoinsEarned：
    // 那个统计是「跑图收集到的金币」，兑换码发的钱不该拿去刷「累计收集」类成就。
    this.save.addCoins(hit.coins);
    this.audio.buy();
    this.ui.toast('🎉 兑换成功！+🪙' + int(hit.coins));
    this._refresh();
  }

  // ---------------- 主界面快捷交互 ----------------
  _toggleSound() {
    this._toggleSetting('muted');
    this.ui.toast(this.save.data.muted ? '🔇 音效已关闭' : '🔊 音效已开启');
  }
  _toggleMusic() {
    this._toggleSetting('music');
    this.ui.toast(this.save.data.music ? '🎵 背景音乐已开启' : '🎵 背景音乐已关闭');
  }
  _randomSkin() {
    const owned = this.save.data.skins;
    if (owned.length <= 1) {
      this.ui.toast('先去解锁更多皮肤吧！');
      return this._openTab('skins');
    }
    let pick = this.save.data.skin;
    for (let i = 0; i < 12 && pick === this.save.data.skin; i++) {
      pick = owned[Math.floor(Math.random() * owned.length)];
    }
    // 实在随机到同一个就取下一个
    if (pick === this.save.data.skin) {
      pick = owned[(owned.indexOf(this.save.data.skin) + 1) % owned.length];
    }
    this._selectSkin(pick);
  }
  _setStartTheme(i) {
    if (isNaN(i) || i < 0 || i >= THEMES.length) return;
    // 前 4 张看「最高分」（老门槛），后 4 张看整季解锁（累计里程）。
    if (i < SUN_COUNT) {
      if (this.save.data.best < WORLD_UNLOCK[i]) return this.ui.toast('最高分不足，尚未解锁');
    } else if (!seasonUnlocked(1, this.save.data)) {
      return this.ui.toast('累计跑满 ' + SEASONS[1].need + ' 米后解锁「竹墨松林」');
    }
    this.save.data.startTheme = i;
    this.save.save();
    this.spawner.themeOffset = i;
    this._paintMenuScene();
    this.audio.buy();
    this.ui.toast('出发地：' + THEMES[i].name);
    this._refresh();
  }
  // ---------------- 赛季 UI ----------------
  // 「当前是第几赛季」= 第 2 赛季解锁没有（看累计里程统计，不进存档）。
  _syncSeasonUI() {
    const s = seasonUnlocked(1, this.save.data) ? SEASONS[1] : SEASONS[0];
    if (document && document.documentElement && document.documentElement.setAttribute) {
      const hn = document.querySelector('.hdr-name');
      if (hn) hn.textContent = '奶龙跑酷 · ' + s.name;
      const rb = document.querySelector('.logo-ribbon');
      if (rb) rb.textContent = s.ico + ' ' + s.name + ' · 第 ' + (s.from ? 2 : 1) + ' 赛季';
      document.documentElement.setAttribute('data-season', s.id);
    }
  }
  // 每次回到主界面都调：只有「本次会话里刚跨过阈值」才播报一次（运行期标记 _inkAnnounced）。
  // 冷启动时 _inkAnnounced 会被预置成「早已解锁」，所以老玩家刷新页面不会被反复弹窗。
  _checkSeasonUnlock() {
    if (seasonUnlocked(1, this.save.data) && !this._inkAnnounced) {
      this._inkAnnounced = true;
      if (this.ui && this.ui.toast) this.ui.toast('🎋 新赛季解锁：竹墨松林！', 2600);
    }
    this._syncSeasonUI();
  }

  _paintMenuScene() {
    if (!this.scene) return;
    const t = THEMES[this.save.data.startTheme || 0];
    // scene.background 默认是 null，不能直接 .setHex()
    if (this.scene.background && this.scene.background.isColor) this.scene.background.setHex(t.sky);
    else this.scene.background = new THREE.Color(t.sky);
    if (this.scene.fog && this.scene.fog.color) this.scene.fog.color.setHex(t.fog);
    this._setCloudTint(this.save.data.startTheme || 0);
  }
  // 按主题给云朵上色（云用 Basic + vertexColors，material.color 直接乘到顶点色上）
  _setCloudTint(themeIdx) {
    if (!this.clouds || themeIdx === this._cloudTheme) return;
    this._cloudTheme = themeIdx;
    const cc = new THREE.Color(THEMES[themeIdx].cloud || 0xffffff);
    for (const cloud of this.clouds) {
      const m = cloud.userData.mesh;
      if (m && m.material) m.material.color.copy(cc);
    }
  }
  _showCoinHelp() {
    this.ui.openModal('🪙 获得金币', '<div class="list">' +
      '<div class="item owned"><div class="item-info"><div class="item-name">跑一局就好</div>' +
      '<div class="item-desc">每局收集的金币会自动存入账户，跑得越远金币越多。</div></div></div>' +
      '<div class="item owned"><div class="item-info"><div class="item-name">连击翻倍</div>' +
      '<div class="item-desc">连续吃金币不断连，连击越高分数倍率越高（上限 ×' +
      (1 + CONFIG.COMBO_MAX * CONFIG.COMBO_STEP).toFixed(1) + '）。</div></div></div>' +
      '<div class="item owned"><div class="item-info"><div class="item-name">成就奖励</div>' +
      '<div class="item-desc">在「挑战之路」领取已完成成就的金币奖励。</div></div></div>' +
      '<div class="item owned"><div class="item-info"><div class="item-name">兑换码</div>' +
      '<div class="item-desc">打开「⚙️ 游戏设置 → 兑换码」，输入兑换码即可直接领取金币。</div></div></div>' +
      '</div><p class="modal-note">本作为学习原型，暂无内购。</p>');
  }
  _showCrown() {
    const d = this.save.data, best = int(this.save.data.best);
    const tiers = [
      { name: '青铜奶龙', need: 0, ico: '🥉' },
      { name: '白银奶龙', need: 400, ico: '🥈' },
      { name: '黄金奶龙', need: 1000, ico: '🥇' },
      { name: '传奇奶龙', need: 1800, ico: '👑' },
    ];
    let curIdx = 0;
    for (let i = 0; i < tiers.length; i++) if (best >= tiers[i].need) curIdx = i;
    const rows = tiers.map((t, i) => {
      const got = best >= t.need;
      return '<div class="item ' + (got ? 'owned' : '') + (i === curIdx ? ' active' : '') + '">' +
        '<div class="swatch" style="background:linear-gradient(135deg,var(--accent-a),var(--accent-b))"></div>' +
        '<div class="item-info"><div class="item-name">' + t.ico + ' ' + t.name +
        (i === curIdx ? '<span class="tag">当前</span>' : '') + '</div>' +
        '<div class="item-desc">最高分 ' + t.need + ' 分达成</div></div>' +
        '<button class="act ' + (got ? 'on' : '') + '" disabled>' + (got ? '已达成' : '未达成') + '</button></div>';
    }).join('');
    this.ui.openModal('👑 荣誉殿堂', '<p class="modal-note">当前最高分 ' + best +
      ' 分，继续刷新纪录解锁更高段位。</p><div class="list">' + rows + '</div>');
  }
  _resetData() {
    if (!window.confirm('确定清除全部存档吗？此操作不可恢复。')) return;
    this.save.reset();
    this.audio.setMuted(this.save.data.muted);
    this.audio.setMusic(this.save.data.music);
    this.player.applySkin('default');
    this.applyQuality();
    this._achvToasted = new Set();
    this.ui.toast('存档已清除');
    this._refresh();
  }

  _toMenu() {
    this.state = 'menu';   // 回主菜单不停 BGM：主界面本来就该有音乐
    this.ui.closeModal();
    this.resetRun();
    this.showcaseTime = 0;
    this._paintMenuScene();
    this._checkSeasonUnlock();   // 回主界面一律对齐赛季：这一局可能刚好跨过了 1 万米
    this.ui.updateMenu(this.save);
    this.ui.showMenu();
  }

  _revive() {
    if (this.coins >= CONFIG.REVIVE_COST && this.state === 'gameover') {
      this.coins -= CONFIG.REVIVE_COST;
      this.player.invincibleTimer = 3;
      this.save.data.stats.revives++;
      this.save.save();
      this.dead = false;
      this.state = 'playing';
      this.ui.showHUD();
      this.audio.startBGM();
    }
  }

  _die() {
    if (this.dead) return;
    this.dead = true;
    this.state = 'gameover';
    this.audio.hit();
    this._vibrate(60);   // 结算页不停 BGM
    const isRecord = this.save.setBest(this.score);
    this.save.addCoins(this.coins);
    const st = this.save.data.stats;
    st.runs++;
    st.totalDistance += this.distance;
    this._checkSeasonUnlock();
    st.totalCoinsEarned += this.coins;
    st.bestCombo = Math.max(st.bestCombo, this.player.bestCombo);
    this.save.pushScore(this.score, this.distance, this.coins);
    this.save.save();
    this._checkAchievements();
    this.ui.updateMenu(this.save);
    this.ui.showGameOver(this.score, this.distance, this.coins, this.save.data.best,
      isRecord, this.coins >= CONFIG.REVIVE_COST, CONFIG.REVIVE_COST);
  }

  _checkAchievements() {
    for (const a of ACHIEVEMENTS) {
      const cur = this.save.data.stats[a.stat] || 0;
      if (cur >= a.goal && !this._achvToasted.has(a.id)) {
        this._achvToasted.add(a.id);
        const rec = this.save.data.achv[a.id] || {};
        if (!rec.claimed) this.ui.toast('🏆 成就达成：' + a.name, 1800);
      }
    }
  }

  _checkCollisions() {
    const pbox = this.player.getBox();
    const px = this.player.group.position.x;
    const py = this.player.group.position.y;
    const pz = this.player.group.position.z;
    // 收集判定必须跟着玩家的实际高度走。原来写死比较 `Math.abs(1.2 - c.position.y)`
    // （常量 1.2，与玩家无关），导致「跳起来吃空中金币」永远吃不到 —— 金币图案再花也没用。
    const pcY = py + (this.player.sliding ? CONFIG.PLAYER_H_SLIDE : CONFIG.PLAYER_H_STAND) * 0.5;
    const coinMult = (1 + 0.1 * this._lvl('coin')) * (this.rushActive ? CONFIG.RUSH_COIN_MULT : 1);

    for (const chunk of this.spawner.chunks) {
      for (const o of chunk.obstacles) {
        if (!o.visible) continue;
        const def = OBSTACLE_TYPES[o.userData.type];

        if (Math.abs(pz - o.position.z) > (CONFIG.PLAYER_HALF_Z + def.halfZ) + 0.2) continue;
        if (Math.abs(px - o.position.x) > (CONFIG.PLAYER_HALF_X + def.halfX)) continue;
        // ---- 可站立平台（车厢车顶）：脚底够高就算「上车顶」，不判死 ----
        // 矮车厢车顶 2.05m（跳得上去）、标准车厢 3.4m（只能变道躲）。
        // 门限用的是「车顶 − TRAIN_CLIMB_ASSIST」这条攀爬辅助线，而不是车顶本身：
        // 车头判定窗提前 4.4m 就开了，而跳跃是抛物线 —— 玩家刚碰到车头那一刻脚底
        // 不可能已经高过车顶，拿真实车顶当门限，「跳上车顶」在物理上永远不可能成功。
        // 车顶高度必须取实例上的 userData.roofY：def.maxY 是标准车厢的契约高度，
        // 拿它去判矮车厢，玩家站上 2.05m 的车顶反而会被当成撞车身。
        if (def.standable) {
          const roofY = (o.userData.roofY != null ? o.userData.roofY : def.maxY);
          if (this.player.canClimb(roofY)) {
            // 脚底还在车顶下方 ⇒ 攀爬辅助把他提上去；已经在车顶上方（比如从矮车顶补跳）
            // 就什么都不做，交给重力段的 _support() 自然落到车顶，别把空中的人往下瞬移。
            if (this.player.group.position.y < roofY) this.player._landOn(roofY, o);
            continue;
          }
        }
        if (pbox.min.y < def.maxY && pbox.max.y > def.minY) {
          if (this.player.invincibleTimer > 0) { o.visible = false; o.position.set(0, -999, 0); continue; }
          if (this.player.shieldTimer > 0) {
            this.player.shieldTimer = 0;
            o.visible = false; o.position.set(0, -999, 0);
            this.audio.power(); this._vibrate(30);
            continue;
          }
          this._die();
          return;
        }
      }
      for (const c of chunk.coins) {
        if (!c.visible) continue;
        if (this.player.magnetTimer > 0) {
          const d = Math.hypot(px - c.position.x, pz - c.position.z);
          if (d < CONFIG.MAGNET_RADIUS) {
            c.position.x = lerp(c.position.x, px, 0.25);
            c.position.z = lerp(c.position.z, pz, 0.25);
            c.position.y = lerp(c.position.y, pcY, 0.25);   // 吸向玩家实际高度，跳起来也吸得到
          }
        }
        if (Math.abs(px - c.position.x) < 0.95 &&
            Math.abs(pz - c.position.z) < 0.95 &&
            Math.abs(pcY - c.position.y) < 1.7) {
          c.visible = false; c.position.set(0, -999, 0);
          const base = c.userData.kind === 'bottle' ? CONFIG.BOTTLE_VALUE : CONFIG.COIN_VALUE;
          this.player.addCombo();
          this.coins += Math.round(base * coinMult * this.player.comboMult());
          if (c.userData.kind === 'bottle') this.audio.bottle(); else this.audio.coin();
        }
      }
      for (const p of chunk.powerups) {
        if (!p.visible) continue;
        if (Math.abs(px - p.position.x) < 1.0 &&
            Math.abs(pz - p.position.z) < 1.0) {
          p.visible = false; p.position.set(0, -999, 0);
          this._applyPower(p.userData.ptype);
        }
      }
      // ---- 赛道机关：踩上去才生效，且只有贴地时算 ----
      for (const p of chunk.pads) {
        if (!p.visible || p.userData.used) continue;
        if (Math.abs(pz - p.position.z) > 1.6) continue;
        if (Math.abs(px - p.position.x) > 1.0) continue;
        if (py > 0.9) continue;                  // 空中掠过不算，避免连跳重复触发
        p.userData.used = true;                  // 机关留在原地（看得见），但只触发一次
        if (p.userData.padType === 'boost') {
          if (this.player.padBoost()) {
            this.audio.boostPad(); this.ui.pop('加速带！', 'pad'); this._vibrate(20);
          }
        } else {
          this.player.spring();
          this.audio.spring(); this.ui.pop('弹跳板！', 'pad'); this._vibrate(20);
        }
      }
    }
  }

  _applyPower(type) {
    const p = this.player;
    if (type === 'magnet') p.magnetTimer = CONFIG.MAGNET_TIME + 2 * this._lvl('magnet');
    else if (type === 'shield') { p.shieldMax = CONFIG.SHIELD_TIME + 2 * this._lvl('shield'); p.shieldTimer = p.shieldMax; }
    else if (type === 'speed') p.speedBoostTimer = CONFIG.SPEEDBOOST_TIME;
    else if (type === 'double') p.doubleTimer = CONFIG.DOUBLE_TIME;
    this.save.data.stats.powerupsUsed++;
    this.save.save();
    this.audio.power();
    this._vibrate(25);
  }

  update(dt) {
    this.time += dt;

    // 冲刺段：进入/退出时播报一次，并在段内叠加速度倍率
    const rush = rushAt(this.distance);
    if (rush.active !== this.rushActive) {
      this.rushActive = rush.active;
      if (rush.active) {
        this.ui.showRush();
        this.ui.toast('⚡ 冲刺段！障碍密集 · 金币双倍');
        this.audio.power();
        this._vibrate(25);
      } else {
        this.rushCleared++;
        this.save.data.stats.rushCleared++;
        this.score += CONFIG.RUSH_BONUS;
        this.ui.hideRush();
        this.ui.pop('冲刺段通过 +' + CONFIG.RUSH_BONUS, 'big');
        this.audio.bottle();
      }
    }
    if (this.rushActive) this.ui.updateRush(1 - rush.progress, rush.remain);

    let curSpeed = this.speed;
    // 机关加速带比「加速」道具更猛，优先覆盖
    if (this.player.padBoostTimer > 0) curSpeed *= CONFIG.PAD_BOOST_MULT;
    else if (this.player.speedBoostTimer > 0) curSpeed *= CONFIG.SPEEDBOOST_MULT;
    if (this.rushActive) curSpeed *= CONFIG.RUSH_SPEED_MULT;
    this.speed = Math.min(CONFIG.MAX_SPEED, this.speed + CONFIG.SPEED_INCREMENT * dt);

    // ---- 位移子步进 ----
    // 最坏情况：MAX_SPEED(20) × 加速带(1.55) × 冲刺段(1.35) = 41.9 m/s，
    // dt 上限 0.05 ⇒ 单帧前进 2.09m，已经超过障碍判定窗（2×(|pz|+halfZ) ≈ 2.0m），
    // 会出现「穿过火车却没死」的穿模。这里把位移切成 ≤0.6m 的小步，
    // 每一步都跑一次碰撞/收集判定（判定窗内至少有 3 次采样）。
    const dz = curSpeed * dt;
    const steps = Math.max(1, Math.ceil(dz / 0.6));
    const sdt = dt / steps;

    let gain = curSpeed * dt * CONFIG.POINT_PER_METER;
    if (this.player.doubleTimer > 0) gain *= 2;
    this.score += gain;

    for (let s = 0; s < steps; s++) {
      this.player.group.position.z -= curSpeed * sdt;
      this.distance = Math.max(this.distance, -this.player.group.position.z);
      this.player.update(sdt);
      this.spawner.update(this.player.group.position.z, this.distance);
      this._checkCollisions();
      if (this.dead) break;   // 撞死了就不用跑完剩下的子步
    }
    this.spawner.animateProps(dt, this.time);

    const px = this.player.group.position.x * 0.4;
    const pz = this.player.group.position.z;
    this.camera.position.lerp(new THREE.Vector3(px + CONFIG.CAM_FOLLOW.x, CONFIG.CAM_FOLLOW.y, pz + CONFIG.CAM_FOLLOW.z), CONFIG.CAM_LERP);
    this.camera.lookAt(px, 1.2, pz - 6);
    const targetFov = CONFIG.CAMERA_BASE_FOV + (this.speed - CONFIG.START_SPEED) / (CONFIG.MAX_SPEED - CONFIG.START_SPEED) * CONFIG.CAMERA_SPEED_FOV;
    this.camera.fov = lerp(this.camera.fov, targetFov, 0.05);
    this.camera.updateProjectionMatrix();

    const themeIdx = (Math.floor(this.distance / CONFIG.THEME_DISTANCE) + this.spawner.themeOffset) % THEMES.length;
    // 跑满 THEME_DISTANCE（2000 米）换一张地图 —— 必须给明确播报：
    // 场景色是 0.02 的 lerp 渐变，高速跑动里眼睛几乎不会注意到，玩家会以为「地图根本没换」。
    // _themeIdx 为 null 表示这一局还没记录过（开局那次不播报）。
    if (this._themeIdx !== themeIdx) {
      if (this._themeIdx != null) {
        this.ui.pop('🗺️ 到达新地图 · ' + THEMES[themeIdx].name, 'map');
        this.audio.power();
      }
      this._themeIdx = themeIdx;
    }
    const theme = THEMES[themeIdx];
    this.scene.background.lerp(new THREE.Color(theme.sky), 0.02);
    this.scene.fog.color.lerp(new THREE.Color(theme.fog), 0.02);

    // 云朵：横向慢漂 + 随玩家向前回收（否则跑出 120m 后天空会永久空掉）
    const cloudZ = this.player.group.position.z;
    for (const cloud of this.clouds) {
      cloud.position.x += dt * 0.5;
      if (cloud.position.x > 28) cloud.position.x = -28;
      if (cloud.position.z > cloudZ + 26) {
        cloud.position.z = cloudZ - rand(CONFIG.CLOUD_SPREAD * 0.7, CONFIG.CLOUD_SPREAD);
        cloud.position.x = rand(-26, 26);
        cloud.position.y = rand(10, 22);
      }
    }
    // 主题切换时把云的底色一起换掉（竹影夜灯是夜景，云要压暗）
    this._setCloudTint(themeIdx);

    this.ui.updateHUD(Math.floor(this.score), this.distance, this.coins);
    this.ui.updatePowerups(this.player);
    this.ui.updateCombo(this.player.combo, this.player.comboMult());
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.applyQuality();
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.state === 'playing') {
      this.update(dt);
    } else if (this.state === 'menu') {
      this.showcaseTime += dt;
      const a = this.showcaseTime * 0.45;
      this.camera.position.set(Math.sin(a) * 6.2, 2.6 + Math.sin(this.showcaseTime * 0.7) * 0.3, Math.cos(a) * 6.2);
      this.camera.lookAt(0, 1.5, 0);
      this.camera.fov = 55; this.camera.updateProjectionMatrix();
      this.player.idle(dt);
      this.spawner.animateProps(dt, this.showcaseTime);
    }
    this.renderer.render(this.scene, this.camera);
  }
}

// 启动
// 模块脚本（type="module"）本身就是在文档解析完成后才执行的，
// 因此不要再依赖 DOMContentLoaded —— 它有可能已经触发过，那样就永远不启动。
function __nailongBoot() {
  if (window.__nailongBooted) return;
  window.__nailongBooted = true;
  // 暴露配置与障碍物表，方便在控制台调试 / 自动化校验读取
  window.__nailongConfig = CONFIG;
  window.__nailongObstacles = OBSTACLE_TYPES;
  window.__nailongAchievements = ACHIEVEMENTS;   // 校验脚本要断言「已删玩法」不再出现在成就表里
  try {
    window.__nailongGame = new GameManager();
  } catch (e) {
    if (window.__nailongFail) window.__nailongFail(e);
    else console.error('[奶龙跑酷] 启动失败:', e);
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', __nailongBoot);
} else {
  __nailongBoot();
}
