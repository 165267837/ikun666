/* shots.cjs — 用 CDP 驱动无头 Edge 抓游戏截图 + 做 draw call 归因。
   用法: node shots.cjs [themeIndex...]
   不传参数则抓全部四个主题。 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;
const URL_ = 'http://127.0.0.1:5188/';
const PROF = path.join(__dirname, '__shotprof');
const OUT = path.join(__dirname, 'preview');
const W = 520, H = 900;

// 8 张地图 = 第 1 赛季「阳光漫游」4 张 + 第 2 赛季「竹墨松林」4 张。
// 后 4 张要先让累计里程达标，否则 spawner 只跑前 4 张，出图 / 校验都看不到竹墨松林。
const SEASON2_DIST = 10000;
const THEMES = ['彩虹城市', '糖果街道', '游乐园', '地铁轨道', '墨竹初径', '竹露清风', '松涛深处', '竹影夜灯'];
const wanted = process.argv.slice(2).map(Number).filter(function (n) { return n >= 0 && n < THEMES.length; });
const list = wanted.length ? wanted : [0, 1, 2, 3, 4, 5, 6, 7];

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function jsonList() {
  const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
  return r.json();
}

/* 让游戏进入「指定主题 + 正在跑」的状态，并跑一小段距离 */
function mkReady(theme) {
  return [
    '(function(){',
    ' var g=window.__nailongGame; if(!g) return "NO_GAME";',
    ' g.save.data.startTheme=' + theme + ';',
    ((theme >= 4) ? ' g.save.data.stats.totalDistance=' + SEASON2_DIST + ';' : ' /* 第 1 赛季保持未解锁 */'),
    ' g.startGame();',
    ' return g.state;',
    '})()',
  ].join('\n');
}

/* 冻结世界：_animate() 只在 state==="playing" 时 update()，改成别的值即可
   让画面停住但继续渲染 —— 这样绝不会截到「游戏结束」遮罩。
   同时检查正前方 14m / 身后 7m 内有没有障碍物挡住镜头：
   有就把 state 报成 "blocked"，让外层重开一局重抓（避免构图被障碍物糊住）。 */
const FREEZE = [
  '(function(){',
  ' var g=window.__nailongGame; if(!g) return "NO_GAME";',
  ' var info={state:g.state,distance:Math.round(g.distance),theme:-1,decos:0};',
  ' try{ info.theme=g.spawner.chunks[0].theme; info.decos=g.spawner.chunks[0].decos.length; }catch(e){}',
  ' var worst=null, kind="";',
  ' for(var i=0;i<g.spawner.chunks.length;i++){',
  '   var ch=g.spawner.chunks[i], cz=ch.group.position.z;',
  '   for(var j=0;j<ch.obstacles.length;j++){',
  '     var o=ch.obstacles[j];',
  '     if(!o.visible) continue;',
  '     if(Math.abs(o.position.x)>=4.5) continue;',
  '     var wz=o.position.z;   /* 池化对象挂在 scene 上，position.z 即世界 z */',
  '     if(wz<-14 || wz>7) continue;',
  '     if(worst===null || Math.abs(wz)<Math.abs(worst)){ worst=wz; kind=(o.userData&&o.userData.kind)||o.name||"?"; }',
  '   }',
  ' }',
  ' info.blockerZ = worst;',
  ' info.blockerKind = kind;',
  ' info.blocker = worst===null ? 0 : Math.round(Math.abs(worst));',
  ' var needClear = (window.__shotNeedClear !== false);',
  ' if(needClear && info.state==="playing" && info.blocker>0){ info.state="blocked"; }',
  ' else { g.state="frozen"; }',
  ' return JSON.stringify(info);',
  '})()',
].join('\n');

/* 俯视勘测：把相机抬到高空斜俯视，一眼看清两侧装饰的排布/浮空/重叠 */
const SURVEY = [
  '(function(){',
  ' var g=window.__nailongGame; if(!g) return "NO_GAME";',
  ' try{ g.camera.position.set(0, 30, 24); g.camera.lookAt(0, 0, -34); g.camera.fov=58; g.camera.updateProjectionMatrix(); }catch(e){ return "CAM_ERR "+e.message; }',
  ' return "survey ok  camera=("+g.camera.position.x+","+g.camera.position.y+","+g.camera.position.z+")";',
  '})()',
].join('\n');

/* 装饰物离地间隙检查：两侧地面顶面 y = -0.34 + 0.5/2 = -0.09
   贴地物体底边应落在 [-0.65, +0.12]；超出即为浮空 / 陷入地面。 */
const FLOAT_CHECK = [
  '(function(){',
  ' var g=window.__nailongGame; if(!g) return "NO_GAME";',
  ' var GROUND_TOP=-0.09;',
  ' var out=[], float=[], sink=[], rows=[], airDeck=[], buriedOk=[], grounded=0;',
  ' var tot=0;',
  ' for(var i=0;i<g.spawner.chunks.length;i++){',
  '   var ch=g.spawner.chunks[i]; ch.group.updateMatrixWorld(true);',
  '   for(var j=0;j<ch.decos.length;j++){',
  '     var d=ch.decos[j]; tot++;',
  '     var mn=1e9, mx=-1e9, minX=1e9, maxX=-1e9, minZ=1e9, maxZ=-1e9;',
  '     d.traverse(function(o){',
  '       if(!o.isMesh) return;',
  '       if(!o.geometry.boundingBox) o.geometry.computeBoundingBox();',
  '       var bb=o.geometry.boundingBox;',
  '       for(var k=0;k<8;k++){',
  '         var v=new g.camera.position.constructor(k&1?bb.max.x:bb.min.x, k&2?bb.max.y:bb.min.y, k&4?bb.max.z:bb.min.z);',
  '         v.applyMatrix4(o.matrixWorld);',
  '         if(v.y<mn)mn=v.y; if(v.y>mx)mx=v.y;',
  '         if(v.x<minX)minX=v.x; if(v.x>maxX)maxX=v.x;',
  '         if(v.z<minZ)minZ=v.z; if(v.z>maxZ)maxZ=v.z;',
  '       }',
  '     });',
  '     var gap=mn-GROUND_TOP;',
  '     var info="chunk"+i+" #"+j+" 底边y="+mn.toFixed(2)+" 离地+"+gap.toFixed(2)+" x="+((minX+maxX)/2).toFixed(1);',
  '     /* 两类「离地」只有在装饰自己声明过意图时才豁免：',
  '        airborne = 孔明灯（本来就该飘在天上）；halfBuried = 远坡（造型就是半埋）。',
  '        没声明的照旧算事故 —— 这样豁免不是放宽阈值，而是逼作者把意图写出来。 */',
  '     var ud=d.userData||{};',
  '     if(gap>-0.55 && gap<=0.22) grounded++;',
  '     if(gap>0.22){ if(ud.airborne) airDeck.push(info+" [airborne]"); else float.push(info+" h="+(mx-mn).toFixed(2)+" [未声明]"); }',
  '     if(gap<-0.55){ if(ud.halfBuried) buriedOk.push(info+" [halfBuried]"); else sink.push(info+" [未声明]"); }',
  '   }',
  ' }',
  ' out.push("装饰总数="+tot+"  贴地="+grounded);',
  ' out.push("【必须为 0】浮空(>0.22m 且未声明 airborne) = "+float.length);',
  ' for(var i=0;i<Math.min(float.length,14);i++) out.push("   "+float[i]);',
  ' out.push("【必须为 0】陷入地面(>0.55m 且未声明 halfBuried) = "+sink.length);',
  ' for(var i=0;i<Math.min(sink.length,14);i++) out.push("   "+sink[i]);',
  ' out.push("【豁免·已声明意图】孔明灯 airborne = "+airDeck.length+"   远坡 halfBuried = "+buriedOk.length);',
  ' out.push("【反向对照】贴地装饰数必须 > 0，否则说明分类逻辑把所有东西都豁免了： "+grounded);',

  ' /* 顺带统计：落在两侧装饰带区间内的装饰，各自最近/最远 x，用于判断是否有东西跑到赛道上 */',
  ' var onTrack=[];',
  ' for(var i=0;i<g.spawner.chunks.length;i++){',
  '   var ch=g.spawner.chunks[i];',
  '   for(var j=0;j<ch.decos.length;j++){',
  '     var d=ch.decos[j]; var cx=d.position.x;',
  '     if(Math.abs(cx)<6.0) onTrack.push("chunk"+i+" #"+j+" x="+cx.toFixed(2)+" (过近!)");',
  '   }',
  ' }',
  ' out.push("侵入赛道(|x|<6.0) = "+onTrack.length);',
  ' for(var i=0;i<Math.min(onTrack.length,10);i++) out.push("   "+onTrack[i]);',
  ' return out.join("\\n");',
  '})()',
].join('\n');

/* draw call 归因：逐类隐藏后重测，得到每类内容的真实开销。
   注意 renderer.info.render.calls 是「最后一帧」的统计，
   所以每次改完可见性都要等 2 个 rAF 再读。 */
const ATTRIB = [
  '(async function(){',
  ' var g=window.__nailongGame; if(!g) return "NO_GAME";',
  ' function raf(){return new Promise(function(res){requestAnimationFrame(function(){requestAnimationFrame(res);});});}',
  ' function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}',
  ' var out=[], cats={decos:[],coins:[],obstacles:[],powerups:[],track:[]};',
  ' for(var i=0;i<g.spawner.chunks.length;i++){',
  '   var ch=g.spawner.chunks[i], other=[];',
  '   for(var j=0;j<ch.decos.length;j++) cats.decos.push(ch.decos[j]);',
  '   for(var j=0;j<ch.coins.length;j++){ cats.coins.push(ch.coins[j]); other.push(ch.coins[j]); }',
  '   for(var j=0;j<ch.obstacles.length;j++){ cats.obstacles.push(ch.obstacles[j]); other.push(ch.obstacles[j]); }',
  '   for(var j=0;j<ch.powerups.length;j++){ cats.powerups.push(ch.powerups[j]); other.push(ch.powerups[j]); }',
  '   // 轨道 = 区块里的「非 Group 直接子节点」：地面/路肩/护栏/立柱/车道虚线',
  '   var cc=ch.group.children;',
  '   for(var j=0;j<cc.length;j++){ var o=cc[j]; if(o.isGroup) continue; if(other.indexOf(o)>=0) continue; cats.track.push(o); }',
  ' }',
  ' function meshN(a){var n=0;for(var i=0;i<a.length;i++){a[i].traverse(function(m){if(m.isMesh)n++;});}return n;}',
  ' function setVis(a,v){for(var i=0;i<a.length;i++)a[i].visible=v;}',
  ' g.player.shieldTimer=99999;',
  ' await raf(); await sleep(250);',
  ' var base=g.renderer.info.render.calls, btri=g.renderer.info.render.triangles;',
  ' out.push("[游玩帧全量] draw="+base+"  tri="+btri);',
  ' var keys=["decos","coins","obstacles","powerups","track"];',
  ' for(var i=0;i<keys.length;i++){',
  '   var k=keys[i];',
  '   var before=g.renderer.info.render.calls, btr=g.renderer.info.render.triangles;',
  '   setVis(cats[k], false); await raf(); await sleep(80);',
  '   var after=g.renderer.info.render.calls, atr=g.renderer.info.render.triangles;',
  '   setVis(cats[k], true); await raf(); await sleep(80);',
  '   var label=("            "+k).slice(-10);',
  '   out.push(label+"  对象"+String(cats[k].length)+"个 / Mesh "+String(meshN(cats[k]))+"   关掉后 draw="+after+"  => 占 "+(before-after)+" draw call, "+(btr-atr)+" tri");',
  ' }',
  ' return out.join("\\n");',
  '})()',
].join('\n');

function mkProbe() {
  return [
    '(function(){',
    ' var g=window.__nailongGame; if(!g) return "NO_GAME";',
    ' var out=[];',
    ' var c=new g.camera.position.constructor();',
    ' out.push("state="+g.state+" distance="+Math.round(g.distance)+"m speed="+g.speed.toFixed(1));',
    ' g.camera.updateMatrixWorld(true);',
    ' var inv=g.camera.matrixWorld.clone().invert();',
    ' var names=[];',
    ' for(var i=0;i<g.spawner.chunks.length;i++){',
    '   var ch=g.spawner.chunks[i];',
    '   names.push("chunk"+i+"[theme="+ch.theme+",z="+ch.group.position.z.toFixed(0)+",decos="+ch.decos.length+"]");',
    ' }',
    ' out.push(names.join("  "));',
    ' /* 统计「可见装饰」：把每个装饰的包围盒中心投到 NDC，落进 -1..1 且 z<1 的算可见 */',
    ' var vis=0,tot=0;var bands={near:0,mid:0,far:0};',
    ' for(var i=0;i<g.spawner.chunks.length;i++){',
    '   var ds=g.spawner.chunks[i].decos;',
    '   for(var j=0;j<ds.length;j++){',
    '     var d=ds[j]; tot++;',
    '     if(!d.geometry){ d.traverse(function(m){ if(!m.geometry) return; if(!m.geometry.boundingBox) m.geometry.computeBoundingBox(); var b=m.geometry.boundingBox; var bb=b.clone(); bb.applyMatrix4(m.matrixWorld); var cx=(bb.min.x+bb.max.x)/2, cy=(bb.min.y+bb.max.y)/2, cz=(bb.min.z+bb.max.z)/2; var v=new g.camera.position.constructor(cx,cy,cz); var w=v.clone().applyMatrix4(inv); var frag=new g.camera.position.constructor(); if(Math.abs(w.x)>1e-6){ v.project(g.camera); if(Math.abs(v.x)<=1 && Math.abs(v.y)<=1 && v.z<=1){ vis++; var ax=Math.abs(cx); if(ax<11) bands.near++; else if(ax<19) bands.mid++; else bands.far++; } } }); }',
    '   }',
    ' }',
    ' out.push("装饰总数="+tot+"  画面内可见="+vis+"  (近带"+bands.near+"/中带"+bands.mid+"/远带"+bands.far+")");',
    ' out.push("draw calls="+g.renderer.info.render.calls+"  triangles="+g.renderer.info.render.triangles);',
    ' return out.join("\\n");',
    '})()',
  ].join('\n');
}

(async () => {
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) {}
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--disable-dev-shm-usage', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=' + W + ',' + H,
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF, 'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await jsonList(); if (targets && targets.length) break; } catch (e) {}
    await sleep(250);
  }
  if (!targets) { console.log('无法连接调试端口'); child.kill(); process.exit(1); }
  const page = targets.find(function (t) { return t.type === 'page'; });
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  const events = [];
  let id = 0;
  const pending = new Map();
  const send = function (method, params) {
    return new Promise(function (res, rej) {
      const mid = ++id;
      pending.set(mid, { res: res, rej: rej, method: method });   // 记住方法名，空返回时报得出是哪一步
      ws.send(JSON.stringify({ id: mid, method: method, params: params || {} }));
    });
  };

  await new Promise(function (r) { ws.addEventListener('open', r); });
  ws.addEventListener('message', function (ev) {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
      else if (msg.result == null) p.rej(new Error("CDP 返回空 result: " + p.method + "（浏览器可能已经崩了/连接已断）"));
      else p.res(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text;
      events.push('EXCEPTION: ' + String(desc).split('\n').slice(0, 3).join(' | '));
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 1, mobile: true,
  });
  await send('Page.navigate', { url: URL_ });
  await sleep(5000);

  /* 先确认页面活着 */
  const boot = await send('Runtime.evaluate', { expression: 'typeof window.__nailongGame', returnByValue: true });
  console.log('boot:', boot.result && boot.result.value);
  if (!boot.result || boot.result.value !== 'object') {
    console.log('游戏实例不存在，无法截图');
    ws.close(); child.kill(); process.exit(1);
  }

  /* 先抓一张主菜单（云朵/天空改了也会影响菜单背景） */
  await send('Runtime.evaluate', { expression: 'window.__nailongGame._toMenu()', returnByValue: true });
  await sleep(1500);
  {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const p = path.join(OUT, '90-主菜单.png');
    fs.writeFileSync(p, Buffer.from(shot.data, 'base64'));
    console.log('=== 主菜单 -> 90-主菜单.png (' + fs.statSync(p).size + 'B) ===');
  }

  /* 防御性隐藏结算层/提示层，避免干净的画面被弹窗盖住 */
  const HIDE_UI = [
    '(function(){',
    ' ["gameover","pause","toast","modal","touch-hint"].forEach(function(id){',
    '   var e=document.getElementById(id); if(e) e.classList.add("hidden");',
    ' /* 触摸提示被 UIManager 每帧重新决定显隐，只有行内 !important 压得住 */',
    ' var th=document.getElementById("touch-hint"); if(th) th.style.setProperty("display","none","important");',
    ' });',
    ' return "ok";',
    '})()',
  ].join('\n');

  /* 稳定抓帧：反复重开，直到拿到「正在跑且没死」的状态再冻结世界。
     障碍物约 13m 就会出现，所以固定等待时长会随机撞车 —— 必须重试。 */
  async function freezeClean(theme, ms) {
    let wait = ms;
    for (let a = 1; a <= 8; a++) {
      await send('Runtime.evaluate', { expression: mkReady(theme), returnByValue: true });
      await sleep(wait);
      const st = await send('Runtime.evaluate', { expression: FREEZE, returnByValue: true });
      let info = {};
      try { info = JSON.parse(st.result.value); } catch (e) { info = { state: String(st.result.value) }; }
      if (info.state === 'playing' || info.state === 'paused') {
        info.attempts = a;
        await send('Runtime.evaluate', { expression: HIDE_UI, returnByValue: true });
        return info;
      }
      wait = Math.max(900, wait - 300);   // 缩短时长再试，降低撞车概率
    }
    return { state: 'GIVE_UP', attempts: 8 };
  }

  /* 干净的跑动画面：要求正前方无遮挡（构图不被障碍物糊住）。只抓这两个主题，省时间 */
  await send('Runtime.evaluate', { expression: 'window.__shotNeedClear=true', returnByValue: true });
  for (let k = 0; k < list.length; k++) {
    const t = list[k];
    const info = await freezeClean(t, 2300);
    await sleep(300);

    let probeTxt = '';
    try {
      const pr = await send('Runtime.evaluate', { expression: mkProbe(), returnByValue: true });
      probeTxt = pr.result && pr.result.value ? pr.result.value : JSON.stringify(pr).slice(0, 300);
    } catch (e) { probeTxt = 'probe 失败: ' + e.message; }

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const name = '0' + (t + 1) + '-场景-' + THEMES[t] + '.png';
    const p = path.join(OUT, name);
    fs.writeFileSync(p, Buffer.from(shot.data, 'base64'));
    /* 截图后立刻读 draw call —— 这就是刚被渲染的那一帧 */
    const dc = await send('Runtime.evaluate', {
      expression: 'window.__nailongGame.renderer.info.render.calls + " draw / " + window.__nailongGame.renderer.info.render.triangles + " tri（截图那一帧）"',
      returnByValue: true,
    });
    console.log('\n=== 主题 ' + t + ' ' + THEMES[t] + ' -> ' + name + ' (' + fs.statSync(p).size + 'B) ===');
    console.log('抓帧状态: ' + JSON.stringify(info));
    console.log(probeTxt);
    console.log('实测: ' + (dc.result && dc.result.value));
  }

  /* 装饰物离地 / 越界检查（在最后一个主题的画面上做） */
  console.log('\n--- 装饰物贴地 / 越界检查 ---');
  try {
    const rf = await send('Runtime.evaluate', { expression: FLOAT_CHECK, returnByValue: true });
    console.log(rf.result && rf.result.value ? rf.result.value : JSON.stringify(rf).slice(0, 400));
  } catch (e) { console.log('检查失败: ' + e.message); }

  /* 俯视勘测图：四个主题各来一张。相机在半空，不需要排除障碍物遮挡 */
  console.log('\n--- 俯视勘测 ---');
  await send('Runtime.evaluate', { expression: 'window.__shotNeedClear=false', returnByValue: true });
  for (let k = 0; k < list.length; k++) {
    const t = list[k];
    const info = await freezeClean(t, 2300);
    const sv = await send('Runtime.evaluate', { expression: SURVEY, returnByValue: true });
    await sleep(300);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const name = '1' + (t + 1) + '-勘测-' + THEMES[t] + '.png';
    const p = path.join(OUT, name);
    fs.writeFileSync(p, Buffer.from(shot.data, 'base64'));
    console.log(THEMES[t] + ': ' + JSON.stringify(info) + '  ' + (sv.result && sv.result.value) + '  -> ' + name + ' (' + fs.statSync(p).size + 'B)');
  }

  /* ================= Phase 8：新玩法特写 ================= */
  /* 取景思路：把玩家瞬移到机关正后方 N 米 → 清场 → 冻结世界 → 显式摆机位。
     为什么最后选了「冻结 + 显式机位」而不是「让游戏自己跑」：跑动时相机会 lerp 回
     车位（CAM_LERP≈0.06），侧移偏移根本留不住；冻结后 `_animate()` 不再 update()，
     但 `renderer.render()` 照常执行，于是「定帧 + 自由摆机位 + HUD 仍是真实数字」三者兼得。
     四个实测踩出来的坑（每一个都单独毁过一版截图）：
       ① invincibleTimer > 0 → 奶龙以 4Hz 闪烁（rig.visible 每帧取反），360ms 窗口约 22 帧，
          50% 概率抓到「隐形」的那一帧；
       ② shieldTimer > 0 → 护盾球（半径 1.25）把奶龙整个罩住，画面里只剩一颗随地面变色的球；
       ③ 相机是 lerp 跟随：瞬移 98m 后只跑 360ms，相机才追到 73% —— 奶龙被留在 60m 外，
          投影实测只有 26px，看上去就是「模型不见了」；
       ④ 障碍/金币/机关都是**对象池 + scene.add**，`o.position.z` 本身就是**世界 z**
          （`chunk.group.position.z` 只对非池化的区块子节点成立）。按「区块 z + 局部 z」
          去清场会整体偏一个区块，一个也清不掉，镜头前那个门框会照样把机关挡死。
     另外两个构图细节：镜头附近那枚金币会在画面底部占掉一大块，必须一起清掉；
     障碍/金币的清场区间要含 `[pz, pz+16]`（相机在玩家后方 8m，那一带若有火车，相机会卡进车里）。 */
  function mkAim(kind, lead, py, camOff) {
    const air = py > 0;
    return [
      '(function(){',
      ' var g=window.__nailongGame; if(!g) return "NO_GAME";',
      ' var C=window.__nailongConfig, sp=g.spawner;',
      ' if(g.state!=="playing") g.startGame();',
      ' g.player.invincibleTimer=0; g.player.shieldTimer=0;',
      ' function find(k){',
      '   for(var i=0;i<sp.chunks.length;i++){',
      '     var ch=sp.chunks[i];',
      '     if(k==="coin"){',
      '       /* 只挑「离地的最高那枚」，保证画面里一定看得见空中金币的弧线 */',
      '       var bestC=null;',
      '       for(var j=0;j<ch.coins.length;j++){ var c=ch.coins[j]; if(c.visible && c.position.y>2.8 && (!bestC || c.position.y>bestC.position.y)) bestC=c; }',
      '       if(bestC) return bestC;',
      '     } else {',
      '       for(var j2=0;j2<ch.pads.length;j2++){ var pd=ch.pads[j2]; if(pd.visible && pd.userData.padType===k) return pd; }',
      '     }',
      '   }',
      '   return null;',
      ' }',
      ' var o=find("' + kind + '");',
      ' for(var n=0;n<160 && !o;n++){ g.player.group.position.z-=8; g.distance=-g.player.group.position.z; sp.update(g.player.group.position.z,g.distance); o=find("' + kind + '"); }',
      ' if(!o) return "NOT_FOUND";',
      ' var pz=o.position.z + ' + lead + ';',
      ' var idx=0,best=1e9;',
      ' for(var i2=0;i2<3;i2++){ var dd=Math.abs(C.LANE_X[i2]-o.position.x); if(dd<best){best=dd;idx=i2;} }',
      ' g.player.laneIndex=idx; g.player.targetX=C.LANE_X[idx];',
      ' g.player.group.position.set(C.LANE_X[idx], ' + py + ', pz);',
      ' g.player.sliding=false; g.player.onGround=' + (air ? 'false' : 'true') + '; g.player.vy=' + (air ? '2.2' : '0') + ';',
      ' g.distance=Math.max(g.distance, -pz);',
      ' sp.update(pz, g.distance);',
      ' /* 清场：障碍清 [pz-45, pz+16]（前方保命 + 后方给相机留位）；',
      '    金币只清真·贴近镜头的 [pz-6, pz+16]，空中金币那张的弧线必须留着 */',
      ' window.__cleared=[];',
      ' for(var i3=0;i3<sp.chunks.length;i3++){ var ch2=sp.chunks[i3];',
      '   for(var j3=0;j3<ch2.obstacles.length;j3++){ var ob=ch2.obstacles[j3];',
      '     if(!ob.visible) continue; var wz=ob.position.z;',
      '     if(wz<pz+16 && wz>pz-45){ window.__cleared.push([ob,ob.position.x,ob.position.y,ob.position.z]); ob.visible=false; ob.position.set(0,-999,0); }',
      '   }',
      '   for(var j4=0;j4<ch2.coins.length;j4++){ var cn=ch2.coins[j4];',
      '     if(!cn.visible) continue; var cz2=cn.position.z;',
      '     if(cz2<pz+16 && cz2>pz-6){ window.__cleared.push([cn,cn.position.x,cn.position.y,cn.position.z]); cn.visible=false; cn.position.set(0,-999,0); }',
      '   }',
      ' }',
      ' /* 冻结：世界停住（不会撞死、不会漂位），但继续渲染 */',
      ' g.state="frozen";',
      ' g.player.rig.visible=true; g.player.shieldMesh.visible=false;',
      ' /* 冻结后主循环不再刷新 HUD，会停在瞬移前的旧值（实测出现过「距离 4 m」），',
      '    这里按主循环同一口径补刷一次 —— 用的是当前真实数值，不是造数 */',
      ' g.ui.updateHUD(Math.floor(g.score), g.distance, g.coins);',
      ' var laneX=C.LANE_X[idx];',
      ' g.camera.position.set(laneX*0.4 + ' + camOff + ', 4.5, pz + 8.2);',
      ' g.camera.lookAt(laneX*0.55, ' + (air ? '1.5' : '1.05') + ', pz - 8);',
      ' g.camera.updateProjectionMatrix();',
      ' return JSON.stringify({kind:(o.userData&&o.userData.padType)||"coin", lane:idx, lead:' + lead + ', py:' + py + ', camOff:' + camOff + ', cleared:window.__cleared.length, dist:Math.round(g.distance), rigVisible:g.player.rig.visible});',
      '})()',
    ].join('\n');
  }

  /* 冲刺段：瞬移到冲刺段起点、先清空前后障碍保命，让游戏自己播报横幅，
     再挑一个「前后都留得开」的落点、重新清掉镜头附近的东西并冻结世界 ——
     既拍到「障碍密集」（中远景保留），又不会撞死、也不会让相机卡在火车里。 */
  const RUSH_GOTO = [
    '(function(){',
    ' var g=window.__nailongGame; if(!g) return "NO_GAME";',
    ' var C=window.__nailongConfig, sp=g.spawner;',
    ' g.player.invincibleTimer=0; g.player.shieldTimer=0;',
    ' var guard=0;',
    ' while(g.distance < C.RUSH_FIRST + 14 && guard++ < 300){ g.player.group.position.z-=8; g.distance=-g.player.group.position.z; sp.update(g.player.group.position.z, g.distance); }',
    ' var pz=g.player.group.position.z;',
    ' window.__cleared=[];',
    ' for(var i=0;i<sp.chunks.length;i++){ var ch=sp.chunks[i];',
    '   for(var j=0;j<ch.obstacles.length;j++){ var ob=ch.obstacles[j];',
    '     if(!ob.visible) continue; var wz=ob.position.z;',
    '     if(wz<pz+16 && wz>pz-45){ window.__cleared.push([ob,ob.position.x,ob.position.y,ob.position.z]); ob.visible=false; ob.position.set(0,-999,0); }',
    '   }',
    ' }',
    ' return "teleport distance="+Math.round(g.distance)+"  冲刺段="+C.RUSH_FIRST+"~"+(C.RUSH_FIRST+C.RUSH_LENGTH)+"  临时清障="+window.__cleared.length;',
    '})()',
  ].join('\n');

  const RUSH_SHOT = [
    '(function(){',
    ' var g=window.__nailongGame; if(!g) return "NO_GAME";',
    ' var C=window.__nailongConfig, sp=g.spawner;',
    ' /* 先把刚才为了保命藏起来的障碍原样恢复，再重新挑落点 */',
    ' if(window.__cleared){ for(var i=0;i<window.__cleared.length;i++){ var a=window.__cleared[i]; a[0].visible=true; a[0].position.set(a[1],a[2],a[3]); } window.__cleared=[]; }',
    ' var pp=g.player.group.position;',
    ' function nearest(zc){',
    '   var m=1e9;',
    '   for(var i=0;i<sp.chunks.length;i++){ var ch=sp.chunks[i];',
    '     for(var j=0;j<ch.obstacles.length;j++){ var o=ch.obstacles[j];',
    '       if(!o.visible) continue;',
    '       var wz=o.position.z;   /* 池化对象挂在 scene 上，position.z 即世界 z */',
    '       var d=Math.abs(wz-zc); if(d<m) m=d;',
    '     }',
    '   }',
    '   return m;',
    ' }',
    ' var bestZ=pp.z, bestC=0;',
    ' for(var z=pp.z-6; z>pp.z-52; z-=2){',
    '   var cl=Math.min(nearest(z), nearest(z+8));',
    '   if(cl>bestC){ bestC=cl; bestZ=z; }',
    ' }',
    ' var idx=g.player.laneIndex;',
    ' g.player.group.position.set(C.LANE_X[idx], 0, bestZ);',
    ' g.player.onGround=true; g.player.vy=0; g.player.sliding=false;',
    ' /* 落点定下来后再清一遍「贴身区」：相机位 + 玩家位那一带绝不留东西，',
    '    中远景（>7m）的密障碍全部保留 —— 那才是这张图要表达的东西 */',
    ' var hid=0;',
    ' for(var i2=0;i2<sp.chunks.length;i2++){ var ch2=sp.chunks[i2];',
    '   for(var j2=0;j2<ch2.obstacles.length;j2++){ var ob=ch2.obstacles[j2];',
    '     if(!ob.visible) continue; var wz=ob.position.z;',
    '     if(wz<bestZ+15 && wz>bestZ-7){ ob.visible=false; ob.position.set(0,-999,0); hid++; }',
    '   }',
    '   for(var j3=0;j3<ch2.coins.length;j3++){ var cn=ch2.coins[j3];',
    '     if(!cn.visible) continue; var cz=cn.position.z;',
    '     if(cz<bestZ+15 && cz>bestZ-4){ cn.visible=false; cn.position.set(0,-999,0); hid++; }',
    '   }',
    ' }',
    ' g.state="frozen";',
    ' g.player.rig.visible=true; g.player.shieldMesh.visible=false;',
    ' g.ui.updateHUD(Math.floor(g.score), g.distance, g.coins);',
    ' var camX=C.LANE_X[idx]*0.4 + 1.4;',
    ' g.camera.position.set(camX, 4.4, bestZ + 8.2);',
    ' g.camera.lookAt(C.LANE_X[idx]*0.5, 1.05, bestZ - 10);',
    ' g.camera.updateProjectionMatrix();',
    ' var th=(Math.floor(g.distance / C.THEME_DISTANCE) + sp.themeOffset) % 4;',
    ' var banner=!!(g.ui && g.ui.el && g.ui.el.rush && !g.ui.el.rush.classList.contains("hidden"));',
    ' return JSON.stringify({dist:Math.round(g.distance), rush:!!g.rushActive, banner:banner, theme:th, rigVisible:g.player.rig.visible, clearance:+bestC.toFixed(1), moved:+(pp.z-bestZ).toFixed(1), hidTight:hid});',
    '})()',
  ].join('\n');

  console.log("\n=== Phase 8 新玩法特写 ===");
  await send("Runtime.evaluate", { expression: "window.__shotNeedClear=false", returnByValue: true });
  /* [类型, 中文名, 前置距离, 玩家离地高度, 相机侧移] */
  const aims = [["boost", "加速带", 13, 0, 1.9], ["spring", "弹跳板", 14, 0, 2.1], ["coin", "空中金币", 9, 1.5, 0.55]];
  for (let k = 0; k < aims.length; k++) {
    /* 机关是随机刷的（PAD_CHANCE 0.55 × 净空校验），个别局会在 1280m 内一枚都不出。
       所以这里要「重试 + 失败不覆盖」：否则会把上一版的良品 PNG 覆盖成一张空场景垃圾帧。 */
    let ra = null, txt = '', ok = false;
    for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
      await send("Runtime.evaluate", { expression: mkReady(0), returnByValue: true });
      await sleep(1500);
      ra = await send("Runtime.evaluate", { expression: mkAim(aims[k][0], aims[k][2], aims[k][3], aims[k][4]), returnByValue: true });
      txt = String((ra.result && ra.result.value) || '');
      ok = txt.indexOf('NOT_FOUND') < 0 && txt.indexOf('TARGET_MOVED') < 0 && txt.indexOf('NO_GAME') < 0;
      if (!ok) console.log('   （第 ' + attempt + ' 次没刷出「' + aims[k][1] + '」，重开一局再试）');
    }
    if (!ok) { console.log(aims[k][1] + ': 连续 4 次都没生成出来 -> 保留上一版 PNG，不覆盖'); continue; }
    await sleep(150);
    await send("Runtime.evaluate", { expression: HIDE_UI, returnByValue: true });
    await sleep(80);
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const name = "2" + k + "-机关与金币-" + aims[k][1] + ".png";
    const pp = path.join(OUT, name);
    fs.writeFileSync(pp, Buffer.from(shot.data, "base64"));
    console.log(aims[k][1] + ": " + txt + "  -> " + name + " (" + fs.statSync(pp).size + "B)");
  }

  /* 冲刺段：startTheme 3/0 ⇒ 434m 处分别是 墨竹初径 / 竹露清风 */

  const rushStart = [3, 0];
  for (let k = 0; k < 2; k++) {
    await send("Runtime.evaluate", { expression: mkReady(rushStart[k]), returnByValue: true });
    await sleep(1500);
    const rg = await send("Runtime.evaluate", { expression: RUSH_GOTO, returnByValue: true });
    await sleep(340);                       /* 跑到冲刺段里，让游戏自己播报横幅 */
    const rs = await send("Runtime.evaluate", { expression: RUSH_SHOT, returnByValue: true });
    await sleep(120);
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    let th = 0;
    try { th = JSON.parse(rs.result.value).theme; } catch (e) {}
    const name = "3" + k + "-冲刺段-" + THEMES[th] + ".png";
    const pp = path.join(OUT, name);
    fs.writeFileSync(pp, Buffer.from(shot.data, "base64"));
    console.log("冲刺段: " + (rg.result && rg.result.value) + "  |  抓帧 " + (rs.result && rs.result.value) + "  -> " + name + " (" + fs.statSync(pp).size + "B)");
  }

  /* ================= 障碍物特写（地铁跑酷风） ================= */
  /* 每种障碍单独出一张产品图：瞬移到它旁边 → 清掉挡镜头的邻近物件（保留目标本身，
     包括"贴着镜头的那枚金币"这个老坑）→ 冻结世界 → 显式摆机位。
     两种模式都用「奶龙站非障碍车道 + 相机跟在同车道后方」的过肩视角（竖屏水平半视角只有 ~22°，
     横向摆开必然出画）；拍完用 NDC 投影自检，两个主体有一个出框就打 ⚠️ 并把相机往后拉重算。 */
  function mkObAim(type, livery, mode, lowMode) {
    return [
      '(function(){',
      ' var g=window.__nailongGame; if(!g) return "NO_GAME";',
      ' var C=window.__nailongConfig, sp=g.spawner;',
      ' if(g.state!=="playing") g.startGame();',
      ' g.player.invincibleTimer=0; g.player.shieldTimer=0;',
      ' function hit(t, lv){',
      ' var LF="' + (lowMode || '') + '";',
      '   for(var i=0;i<sp.chunks.length;i++){ var ch=sp.chunks[i];',
      '     for(var j=0;j<ch.obstacles.length;j++){ var o=ch.obstacles[j];',
      '       if(!o.visible || o.userData.type!==t) continue;',
      '       if(lv>=0 && o.userData.livery!==lv) continue;',
      '       if(LF==="low" && o.userData.low!==true) continue;',
      '       if(LF==="std" && o.userData.low===true) continue;',
      '       return o; } }',
      '   return null;',
      ' }',
      ' var o=hit("' + type + '", ' + livery + ');',
      ' for(var n=0;n<200 && !o;n++){ g.player.group.position.z-=8; g.distance=-g.player.group.position.z; sp.update(g.player.group.position.z,g.distance); o=hit("' + type + '", ' + livery + '); }',
      ' if(!o) return "NOT_FOUND";',
      ' var oz=o.position.z, ox=o.position.x;',
      ' /* 取景：竖屏截图窗口的水平半视角只有 ~22°，横向摆太开一定出画。',
      '    所以奶龙站「非障碍车道」，相机就放在同一车道正后方、视线略微朝障碍偏 ——',
      '    两个主体在画面里一近一远、左右分开约 19°，都能进框。 */',
      ' var lngMode = "' + mode + '" === "long";',
      ' var refX = (ox === 0) ? 3 : 0;        /* 奶龙站不是障碍所在的那条车道 */',
      ' var lookX = refX * 0.6 + ox * 0.4;    /* 视线偏向障碍一点，把两者一起框进来 */',
      ' var refZ = oz + (lngMode ? 5.0 : 4.2);',
      ' g.player.laneIndex = refX < 0 ? 0 : (refX === 0 ? 1 : 2);',
      ' g.player.targetX = refX;',
      ' g.player.group.position.set(refX, 0, refZ);',
      ' g.player.sliding=false; g.player.onGround=true; g.player.vy=0;',
      ' g.distance=Math.max(g.distance, -refZ);',
      ' /* 清场：附近的其它障碍（保留目标）＋ 贴着镜头的金币 */',
      ' /* ⚠️ 目标位置必须「最后再读一次」：障碍是对象池对象，sp.update() 一旦回收它的区块，',
      '    它会被 _get() 复用并挪到别处 —— 用早先读到的旧 ox/oz 去摆机位，机位就偏了，',
      '    表现就是「奶龙正好把障碍挡住」（40-路障 那次就是这样）。 */',
      ' oz=o.position.z; ox=o.position.x;',
      ' if(!o.visible || o.userData.type!=="' + type + '") return "TARGET_MOVED";',
      ' var hid=0;',
      ' for(var i2=0;i2<sp.chunks.length;i2++){ var ch2=sp.chunks[i2];',
      '   for(var j2=0;j2<ch2.obstacles.length;j2++){ var ob=ch2.obstacles[j2];',
      '     if(!ob.visible || ob===o) continue; var wz=ob.position.z;',
      '     if(wz<oz+24 && wz>oz-30){ ob.visible=false; ob.position.set(0,-999,0); hid++; }',
      '   }',
      '   for(var j3=0;j3<ch2.coins.length;j3++){ var cn=ch2.coins[j3];',
      '     if(!cn.visible) continue; var cz=cn.position.z;',
      '     if(cz<oz+20 && cz>oz-4){ cn.visible=false; cn.position.set(0,-999,0); hid++; }',
      '   }',
      ' }',
      ' g.state="frozen";',
      ' g.player.rig.visible=true; g.player.shieldMesh.visible=false;',
      ' g.ui.updateHUD(Math.floor(g.score), g.distance, g.coins);',
      ' var lng = "' + mode + '" === "long";',
      ' var lookY = lng ? 1.3 : 0.9, lookZ = oz + (lng ? 1.0 : 0.5);',
      ' g.camera.position.set(refX, lng ? 3.2 : 2.4, oz + (lng ? 14.0 : 8.5));',
      ' g.camera.lookAt(lookX, lookY, lookZ);',
      ' g.camera.updateProjectionMatrix(); g.camera.updateMatrixWorld(true);',
      ' var mc=0; o.traverse(function(m){ if(m.isMesh) mc++; });',
      ' /* NDC 自检：出画就把相机自动往后拉（越拉两个主体越靠拢、越小），最多 6 次 */',
      ' function inside(v){ return Math.abs(v.x)<0.98 && Math.abs(v.y)<0.98; }',
      ' var rw=g.player.rig.getWorldPosition(g.player.group.position.clone());',
      ' var rn=rw.clone().project(g.camera), on=o.position.clone().project(g.camera);',
      ' var okFrame=inside(rn)&&inside(on), camBack=0;',
      ' while(!okFrame && camBack<6){',
      '   camBack++; g.camera.position.z += 1.6; g.camera.position.y += 0.35;',
      '   g.camera.lookAt(lookX, lookY, lookZ);',
      '   g.camera.updateProjectionMatrix(); g.camera.updateMatrixWorld(true);',
      '   rn=rw.clone().project(g.camera); on=o.position.clone().project(g.camera);',
      '   okFrame=inside(rn)&&inside(on);',
      ' }',
      ' return JSON.stringify({type:"' + type + '", livery:o.userData.livery, x:+ox.toFixed(1), z:+oz.toFixed(1), hid:hid, meshes:mc, rigVisible:g.player.rig.visible, inFrame:okFrame, camBack:camBack, rigNDC:[+rn.x.toFixed(2),+rn.y.toFixed(2)], obNDC:[+on.x.toFixed(2),+on.y.toFixed(2)]});',
      '})()',
    ].join('\n');
  }

  /* ================= 站上车顶（照「地铁跑酷」） ================= */
  /* 这张图要同时说明三件事：矮车厢车顶站得上人 / 车顶黄条是「能上」的提示 / 车顶有一串金币。
     所以它和上一组「障碍物特写」不同：奶龙要摆在车顶（y = TRAIN_ROOF_LOW），
     而且**必须保留车顶金币**（它跟奶龙一样是主角），只清掉车顶高度以外的杂物。
     顺带白拿一个集成校验：摆好之后世界还会跑几帧，奶龙要能稳稳站在车顶上不掉下来 ——
     这正是 player.update() 里 _support() 在真实主循环里的表现。 */
  function mkRoofAim() {
    return [
      '(function(){',
      ' var g=window.__nailongGame; if(!g) return "NO_GAME";',
      ' var C=window.__nailongConfig, sp=g.spawner;',
      ' if(g.state!=="playing") g.startGame();',
      ' g.player.invincibleTimer=0; g.player.shieldTimer=0;',
      ' function findLow(){',
      '   for(var i=0;i<sp.chunks.length;i++){ var ch=sp.chunks[i];',
      '     for(var j=0;j<ch.obstacles.length;j++){ var o=ch.obstacles[j];',
      '       if(o.visible && o.userData.type==="train" && o.userData.low===true) return o; } }',
      '   return null;',
      ' }',
      ' var o=findLow();',
      ' for(var n=0;n<200 && !o;n++){ g.player.group.position.z-=8; g.distance=-g.player.group.position.z; sp.update(g.player.group.position.z,g.distance); o=findLow(); }',
      ' if(!o) return "NOT_FOUND";',
      ' var oz=o.position.z, ox=o.position.x, roofY=o.userData.roofY;',
      ' g.player.laneIndex = ox<0?0:(ox===0?1:2);',
      ' g.player.targetX = ox;',
      ' g.player.group.position.set(ox, roofY, oz+2.1);',
      ' g.player.sliding=false; g.player.onGround=true; g.player.vy=0; g.player.platform=o;',
      ' g.distance=Math.max(g.distance, -(oz+2.1));',
      ' /* ⚠️ 池化对象的坐标必须最后再读一次：sp.update() 一旦回收它的区块，它就被复用挪走了 */',
      ' oz=o.position.z; ox=o.position.x;',
      ' if(!o.visible || o.userData.type!=="train" || o.userData.low!==true) return "TARGET_MOVED";',
      ' var roofCoinY = roofY + C.ROOF_COIN_Y, keptCoin=0, hid=0, roofCoins=[];',
      ' for(var i2=0;i2<sp.chunks.length;i2++){ var ch2=sp.chunks[i2];',
      '   for(var j2=0;j2<ch2.obstacles.length;j2++){ var ob=ch2.obstacles[j2];',
      '     if(!ob.visible || ob===o) continue; ob.visible=false; ob.position.set(0,-999,0); hid++;',
      '   }',
      '   for(var j3=0;j3<ch2.coins.length;j3++){ var cn=ch2.coins[j3];',
      '     if(!cn.visible) continue;',
      '     var isRoof = Math.abs(cn.position.y-roofCoinY)<0.06 && Math.abs(cn.position.x-ox)<0.6 && Math.abs(cn.position.z-oz)<5.0;',
      '     if(isRoof){ keptCoin++; roofCoins.push(cn); continue; }   /* 车顶金币是本图主角之一，必须留着 */',
      '     cn.visible=false; cn.position.set(0,-999,0); hid++;',
      '   }',
      ' }',
      ' g.state="frozen";',
      ' g.player.rig.visible=true; g.player.shieldMesh.visible=false;',
      ' g.ui.updateHUD(Math.floor(g.score), g.distance, g.coins);',
      ' /* 机位：斜后方 3/4 视角 —— 竖屏水平半视角只有 ~22°，正后方会看不见车顶面，',
      '    所以往侧面拉开再稍抬高，一眼能看到「车顶面 + 黄条 + 金币串 + 站在车顶的奶龙」。',
      '    【v3.4 补丁16】原来的入画自检只看「奶龙 + 车厢原点」，金币串被裁掉两枚也不知道；',
      '    【v3.4 补丁16j】相机再从侧面拉开（x +4.4→+7.5、距离 13.2→11.0、抬高 3.8→4.2）：',
      '    近轴视角下「奶龙身后 1m 内」那枚金币会被他本人挡掉（投影只差 30 余 px，而他有 90px 宽）；',
      '    侧拉后「相机→金币」的连线在奶龙的 z 平面上横向错开 ≥0.67m，4 枚才全部真正可见。',
      '    现在把 4 枚车顶金币也算主体（coinMax < 0.96，比奶龙的 0.98 略严），拿不到就继续后拉。 */',
      ' g.camera.position.set(ox+7.5, roofY+4.2, oz+11.0);',
      ' g.camera.lookAt(ox, roofY+0.6, oz-0.8);',
      ' g.camera.updateProjectionMatrix(); g.camera.updateMatrixWorld(true);',
      ' var mc=0; o.traverse(function(m){ if(m.isMesh) mc++; });',
      ' function inside(v){ return Math.abs(v.x)<0.98 && Math.abs(v.y)<0.98; }',
      ' var rw=g.player.rig.getWorldPosition(g.player.group.position.clone());',
      ' var rn=rw.clone().project(g.camera), on=o.position.clone().project(g.camera);',
      ' // 金币也是本图主角之一：只要有一枚出画，整张图就算不合格，触发自动后拉',
      ' function coinsOK(){ var w=0; for(var q=0;q<roofCoins.length;q++){',
      '   var cv=roofCoins[q].position.clone().project(g.camera);',
      '   w=Math.max(w,Math.abs(cv.x),Math.abs(cv.y)); } return w; }',
      ' // ⚠️ 入画 ≠ 可见：NDC 在 ±0.98 内只说明在视锥里，证明不了没被奶龙挡住。',
      ' // 用「相机→金币」的连线在奶龙所在的 z 平面上穿过的位置，粗略判断是不是被他挡住。',
      ' function coinBehind(){ var n=0, cp=g.camera.position, pp=g.player.group.position;',
      '   for(var q=0;q<roofCoins.length;q++){ var cn=roofCoins[q];',
      '     var s2=(cp.z-pp.z)/(cp.z-cn.position.z);',
      '     if(!(s2>0 && s2<1)) continue;',
      '     var hx=cp.x+s2*(cn.position.x-cp.x), hy=cp.y+s2*(cn.position.y-cp.y);',
      '     if(Math.abs(hx-pp.x)<0.55 && hy<pp.y+1.95) n++; }',
      '   return n; }',
      ' var coinMax=coinsOK(), okFrame=inside(rn)&&inside(on)&&coinMax<0.96, camBack=0;',
      ' while(!okFrame && camBack<6){',
      '   camBack++;',
      '   g.camera.position.z += 2.0; g.camera.position.y += 0.6; g.camera.position.x += 0.6;',
      '   g.camera.lookAt(ox, roofY+0.6, oz-0.8);',
      '   g.camera.updateProjectionMatrix(); g.camera.updateMatrixWorld(true);',
      '   rn=rw.clone().project(g.camera); on=o.position.clone().project(g.camera);',
      '   coinMax=coinsOK();',
      '   okFrame=inside(rn)&&inside(on)&&coinMax<0.96;',
      ' }',
      ' return JSON.stringify({low:true, roofY:roofY, x:+ox.toFixed(1), z:+oz.toFixed(1), roofCoins:keptCoin, hid:hid, meshes:mc, playerY:+g.player.group.position.y.toFixed(2), onRoof:!!(g.player.platform===o), rigVisible:g.player.rig.visible, coinNDC:+coinMax.toFixed(2), coinBehind:coinBehind(), inFrame:okFrame, camBack:camBack, rigNDC:[+rn.x.toFixed(2),+rn.y.toFixed(2)], obNDC:[+on.x.toFixed(2),+on.y.toFixed(2)]});',
      '})()',
    ].join('\n');
  }
  console.log("\n=== 障碍物特写（地铁跑酷风） ===");
  const obsShots = [
    ['hurdle', -1, 'thin', '路障（可跳）'],
    ['overhead', -1, 'thin', '限高门架（禁止跳）'],
['train', 0, 'long', '车厢-黄（标准款）', 'std'],
['train', 1, 'long', '车厢-蓝（标准款）', 'std'],
['train', 2, 'long', '车厢-绿（标准款）', 'std'],
    ['wall', -1, 'thin', '集装箱（必变道）'],
  ];
  for (let k = 0; k < obsShots.length; k++) {
    let ra = null, txt = '', ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      await send("Runtime.evaluate", { expression: mkReady(0), returnByValue: true });
      await sleep(1500);
      ra = await send("Runtime.evaluate", { expression: mkObAim(obsShots[k][0], obsShots[k][1], obsShots[k][2], obsShots[k][4] || ''), returnByValue: true });
      txt = String((ra.result && ra.result.value) || '');
      ok = txt.indexOf('NOT_FOUND') < 0 && txt.indexOf('NO_GAME') < 0;
      if (!ok) console.log('   （第 ' + attempt + ' 次没找到 ' + obsShots[k][3] + '，重开一局再试）');
    }
    if (!ok) { console.log(obsShots[k][3] + ': 连续 3 次都没生成出来 -> 跳过'); continue; }
    await sleep(140);
    await send("Runtime.evaluate", { expression: HIDE_UI, returnByValue: true });
    await sleep(80);
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const name = "4" + k + "-障碍-" + obsShots[k][3] + ".png";
    const pp = path.join(OUT, name);
    fs.writeFileSync(pp, Buffer.from(shot.data, "base64"));
    console.log(obsShots[k][3] + ": " + txt + "  -> " + name + " (" + fs.statSync(pp).size + "B)");
    if (txt.indexOf('inFrame:false') >= 0) console.log('   ⚠️ ' + obsShots[k][3] + ' 有主体出画（rigNDC / obNDC 有一个超出 ±0.98）');
  }


  /* 站上车顶特写（照「地铁跑酷」上车顶吃币） */
  console.log("\n=== 站上车顶（矮车厢可跳上 / 车顶金币） ===");
  {
    let txt = '', ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      await send("Runtime.evaluate", { expression: mkReady(0), returnByValue: true });
      await sleep(1500);
      const ra = await send("Runtime.evaluate", { expression: mkRoofAim(), returnByValue: true });
      txt = String((ra.result && ra.result.value) || '');
      ok = txt.indexOf('NOT_FOUND') < 0 && txt.indexOf('NO_GAME') < 0 && txt.indexOf('TARGET_MOVED') < 0;
      if (!ok) console.log('   （第 ' + attempt + ' 次没找到矮车厢，重开一局再试）');
    }
    if (!ok) console.log('站上车顶: 连续 3 次都没生成出矮车厢 -> 跳过');
    else {
      await sleep(140);
      await send("Runtime.evaluate", { expression: HIDE_UI, returnByValue: true });
      await sleep(80);
      const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const name = "46-站上车顶-矮车厢.png";
      const pp = path.join(OUT, name);
      fs.writeFileSync(pp, Buffer.from(shot.data, "base64"));
      console.log("站上车顶: " + txt + "  -> " + name + " (" + fs.statSync(pp).size + "B)");
      if (txt.indexOf('inFrame:false') >= 0) console.log('   ⚠️ 站上车顶 有主体出画（rigNDC / obNDC 超 ±0.98，或 coinNDC ≥ 0.96）');
      if (txt.indexOf('"onRoof":true') < 0) console.log('   ⚠️ 奶龙没站在车顶平台上（player.platform 不是那节车厢）');
      if (txt.indexOf('"roofCoins":0') >= 0) console.log('   ⚠️ 这节矮车厢顶上没有金币串');
      if (txt.indexOf('coinNDC:') >= 0) { const m = txt.match(/coinNDC:([0-9.]+)/); if (m && Number(m[1]) >= 0.96) console.log('   ⚠️ 车顶金币串有一枚贴着画边（coinNDC=' + m[1] + '），4 枚没全进画面'); }
      if (txt.indexOf('"coinBehind":0') < 0) console.log('   ℹ️ 有车顶金币被奶龙挡住（coinBehind > 0）；若画面上它是「挡在身前可见」则无妨');
    }
  }
  /* draw call 归因（在最后一个主题的画面上做） */
  console.log('\n--- draw call 归因 ---');
  try {
    const ra = await send('Runtime.evaluate', { expression: ATTRIB, returnByValue: true, awaitPromise: true });
    console.log(ra.result && ra.result.value ? ra.result.value : JSON.stringify(ra).slice(0, 400));
  } catch (e) { console.log('归因失败: ' + e.message); }

  console.log('\n--- 捕获到的异常 (' + events.length + ') ---');
  console.log(events.length ? events.join('\n') : '(无)');

  ws.close();
  child.kill();
  await sleep(400);
  process.exit(0);
})().catch(function (e) { console.log('harness error: ' + e.message); process.exit(1); });
