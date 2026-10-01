/* __cdp.cjs — 用 CDP 驱动无头 Edge 打开页面，抓运行时异常 + DOM/绑定/命中探针。
   用法: node __cdp.cjs [url] */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const URL_ = process.argv[2] || 'http://127.0.0.1:5188/';
const PROF = path.join(__dirname, '__cdpprof');

const PROBE = [
  '(function(){',
  ' var out=[], d=window.__diag||{errors:[]};',
  ' out.push("jsRan=" + (typeof window.__gameStarted === "undefined" ? "unknown" : window.__gameStarted));',
  ' out.push("errors="+d.errors.length);',
  ' for(var i=0;i<d.errors.length;i++) out.push(d.errors[i]);',
  ' var ids=["btn-sound","btn-music","btn-crown","btn-plus","btn-rank","btn-random","btn-boost","btn-play","nav-run","btn-pause","modal-close","btn-resume","btn-restart","btn-quit","btn-again","btn-menu","btn-revive"];',
  ' var missing=[];',
  ' for(var i=0;i<ids.length;i++){var el=document.getElementById(ids[i]);if(!el){missing.push(ids[i]);continue;}out.push(ids[i]+" onclick="+(el.onclick?"BOUND":"NULL"));}',
  ' if(missing.length) out.push("MISSING_IDS="+missing.join(","));',
  ' var tb=document.querySelectorAll(".side-btn[data-tab], .nav-item[data-tab]");',
  ' out.push("tabBtns="+tb.length);',
  ' for(var i=0;i<tb.length;i++) out.push("tab["+tb[i].dataset.tab+"]="+(tb[i].onclick?"BOUND":"NULL"));',
  ' function hit(sel){var el=document.querySelector(sel);if(!el)return sel+" MISSING";var r=el.getBoundingClientRect();if(!r.width||!r.height)return sel+" ZEROSIZE";var t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return sel+" -> "+(t?(t.tagName+(t.id?"#"+t.id:"")+(typeof t.className==="string"&&t.className?"."+t.className.split(" ").join("."):"")):"null");}',
  ' ["#btn-play","#btn-random","#btn-boost","#btn-sound","#nav-run","#btn-crown",".side-btn[data-tab=world]"].forEach(function(s){out.push(hit(s));});',
  ' var cv=document.getElementById("game-canvas");',
  ' out.push("canvas="+(cv?cv.width+"x"+cv.height:"MISSING"));',
  ' out.push("canvasVisible="+(cv?(cv.getBoundingClientRect().height>0):"n/a"));',
  ' var mn=document.getElementById("menu");',
  ' out.push("menuClass="+(mn?mn.className:"MISSING")+" menuVisible="+(mn?mn.getBoundingClientRect().height>0:"n/a"));',
  ' var res=performance.getEntriesByType("resource").map(function(r){return r.name.split("/").pop()+"("+(r.transferSize||0)+"B)";});',
  ' out.push("resources["+res.length+"]="+res.join(" | "));',
  ' out.push("threeLoaded="+(typeof window.__three_ok));',
  ' out.push("savedSkin="+(function(){try{return JSON.parse(localStorage.getItem("nailong_parkour_save_v2")||"{}").skin||"(none)";}catch(e){return "err";}})());',
  ' return out.join("\\n");',
  '})()',
].join('\n');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// reload / 首次加载后都要重新下载 three.module.js（1.27MB，服务端 no-store 不缓存），
// 固定 sleep 很容易在页面还没启动完就继续跑：表现为 querySelector 返回 null、
// window.__nailongGame 还是 undefined。这里改成轮询到游戏真的起来为止。
async function waitBoot(send, tries) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await send("Runtime.evaluate", {
        expression: "!!(window.__nailongGame && window.__nailongGame.ui)",
        returnByValue: true,
      });
      if (r && r.result && r.result.value === true) return true;
    } catch (e) { /* 执行上下文正在重建，忽略 */ }
    await sleep(400);
  }
  return false;
}

async function jsonList() {
  const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
  return r.json();
}

(async () => {
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) {}
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--disable-dev-shm-usage', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=' + String(PORT),
    '--user-data-dir=' + PROF, 'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await jsonList(); if (targets && targets.length) break; } catch (e) {}
    await sleep(250);
  }
  if (!targets) { console.log('❌ 无法连接调试端口'); child.kill(); process.exit(1); }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  const events = [];
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });

  await new Promise(r => ws.addEventListener('open', r));
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
      events.push('EXCEPTION: ' + String(desc).split('\n').slice(0, 4).join(' | ')
        + '  @line ' + (d.lineNumber + 1) + ':' + (d.columnNumber + 1));
    } else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
      events.push(msg.params.type.toUpperCase() + ': ' + msg.params.args.map(a => a.description || a.value).join(' ').split('\n')[0]);
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      events.push('LOG: ' + msg.params.entry.text.slice(0, 300));
    }
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_ });
  await waitBoot(send, 40);

  let probeOut = '';
  try {
    const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    probeOut = r.result && r.result.value ? r.result.value : JSON.stringify(r);
  } catch (e) { probeOut = '探针执行失败: ' + e.message; }

  // 直接测模块解析：import('three') / import('./main.js') 的真实失败原因
  const IMPORT_TEST = [
    '(async function(){',
    ' var out=[];',
    ' try{ var m=await import("three"); out.push("import(three)=OK Scene:"+(typeof m.Scene)); }',
    ' catch(e){ out.push("import(three)=ERR "+(e&&(e.message||e))); }',
    ' try{ await import("./main.js"); out.push("import(main.js)=OK"); }',
    ' catch(e){ out.push("import(main.js)=ERR "+(e&&(e.message||e))); }',
    ' return out.join("\\n");',
    '})()',
  ].join('\n');
  // 角色尺寸测量：遍历 parts 子树的可见网格，算出真实包围盒
  // （不依赖全局 THREE：用 mesh.position.constructor 拿到 Vector3）
  const SIZE_TEST = [
    '(function(){',
    ' var g=window.__nailongGame; if(!g||!g.player) return "拿不到 player";',
    ' var p=g.player;',
    ' if(!p.parts) return "player.parts 未暴露（需要在 _buildDragon 里存 this.parts）";',
    ' p.reset();',
    ' p.group.position.set(0,0,0); p.group.rotation.set(0,0,0); p.group.updateMatrixWorld(true);',
    ' var mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];',
    ' p.parts.traverse(function(o){',
    '  if(!o.isMesh||o.visible===false) return;',
    '  if(o.userData && o.userData.skipMeasure) return;',
    '  if(!o.geometry.boundingBox) o.geometry.computeBoundingBox();',
    '  var bb=o.geometry.boundingBox;',
    '  for(var i=0;i<8;i++){',
    '   var v=new o.position.constructor(i&1?bb.max.x:bb.min.x, i&2?bb.max.y:bb.min.y, i&4?bb.max.z:bb.min.z);',
    '   v.applyMatrix4(o.matrixWorld);',
    '   mn[0]=Math.min(mn[0],v.x); mn[1]=Math.min(mn[1],v.y); mn[2]=Math.min(mn[2],v.z);',
    '   mx[0]=Math.max(mx[0],v.x); mx[1]=Math.max(mx[1],v.y); mx[2]=Math.max(mx[2],v.z);',
    '  }',
    ' });',
    ' var out=[];',
    ' function f(n){return (Math.round(n*100)/100).toFixed(2);}',
    ' var sc=p.parts.scale.x;',
    ' out.push("parts.scale(体型系数) = "+sc.toFixed(3));',
    ' out.push("视觉包围盒  宽(X)="+f(mx[0]-mn[0])+"  高(Y)="+f(mx[1]-mn[1])+"  深(Z)="+f(mx[2]-mn[2]));',
    ' out.push("（对照）原始尺寸  宽="+f((mx[0]-mn[0])/sc)+"  高="+f((mx[1]-mn[1])/sc)+"  深="+f((mx[2]-mn[2])/sc));',
    ' out.push("视觉底部 y="+f(mn[1])+"   顶部 y="+f(mx[1]));',
    ' var box=p.getBox();',
    ' out.push("碰撞盒      宽(X)="+f(box.max.x-box.min.x)+"  高(Y)="+f(box.max.y-box.min.y)+"  深(Z)="+f(box.max.z-box.min.z));',
    ' var c=window.__nailongConfig||{}, ob=window.__nailongObstacles||{};',
    ' out.push("CONFIG  PLAYER_SCALE="+c.PLAYER_SCALE+"  HALF_X="+f(c.PLAYER_HALF_X)+"  HALF_Z="+f(c.PLAYER_HALF_Z)+"  H_STAND="+f(c.PLAYER_H_STAND)+"  H_SLIDE="+f(c.PLAYER_H_SLIDE));',
    ' function chk(label,cond,detail){out.push((cond?"[OK]  ":"[FAIL]")+" "+label+(detail?"  "+detail:""));}',
    ' var hx=c.PLAYER_HALF_X, hz=c.PLAYER_HALF_Z, hs=c.PLAYER_H_STAND, hl=c.PLAYER_H_SLIDE;',
    ' if(ob.hurdle) chk("跨栏仍需跳跃（滑铲高度不足以钻过）", hl < ob.hurdle.maxY, "滑铲高="+f(hl)+" < 栏顶="+f(ob.hurdle.maxY));',
    ' if(ob.overhead) chk("横杆站立可安全通过（不能起跳）", hs < ob.overhead.minY, "站立高="+f(hs)+" < 杆底="+f(ob.overhead.minY));',
    ' if(ob.wall) chk("墙壁从相邻车道仍会被撞（变道仍必要）", hx + ob.wall.halfX > 1.5, "判定间距="+f(hx+ob.wall.halfX)+" > 1.5");',
    ' if(ob.train) chk("列车从相邻车道仍会被撞", hx + ob.train.halfX > 1.5, "判定间距="+f(hx+ob.train.halfX)+" > 1.5");',
    ' chk("视觉底部贴合地面（脚不悬空/不陷地）", Math.abs(mn[1]) < 0.06, "底部 y="+f(mn[1]));',
    ' var vw=mx[0]-mn[0], vh=mx[1]-mn[1];',
    ' chk("碰撞盒不高于视觉（不会被看不见的高度撞到）", hs <= vh + 1e-6, "碰撞高="+f(hs)+" <= 视觉高="+f(vh));',
    ' chk("碰撞盒不宽于视觉（不会被看不见的宽度撞到）", hx*2 <= vw + 1e-6, "碰撞宽="+f(hx*2)+" <= 视觉宽="+f(vw));',
    ' chk("视觉体积小于单条车道(3.00)与障碍物间隔，不会挤满赛道", vw < 2.0, "视觉宽="+f(vw)+" < 2.00");',
    ' return out.join("\\n");',
    '})()',
  ].join('\n');
  let sizeOut = '';
  try {
    const rs = await send('Runtime.evaluate', { expression: SIZE_TEST, returnByValue: true });
    sizeOut = rs.result && rs.result.value ? rs.result.value
      : (rs.exceptionDetails ? 'EVAL异常: ' + JSON.stringify(rs.exceptionDetails).slice(0, 300) : JSON.stringify(rs));
  } catch (e) { sizeOut = '尺寸测量失败: ' + e.message; }

  // 性能预算：draw call / 三角形 / 装饰物 Mesh 数 / 实测 FPS
  // ⚠️ renderer.info.render.calls 是「最后渲染那一帧」的统计。
  //    如果 startGame() 之后立刻读，读到的是上一个「菜单帧」——会严重低估。
  //    必须让游戏真的渲染过几帧再读，所以这里用 async + 等帧 + 等时间。
  const PERF_TEST = [
    '(async function(){',
    ' var g=window.__nailongGame; if(!g) return "拿不到 game";',
    ' function raf(){return new Promise(function(res){requestAnimationFrame(function(){requestAnimationFrame(res);});});}',
    ' function fps(ms){return new Promise(function(res){var a=g.renderer.info.render.frame,t0=performance.now();setTimeout(function(){var f=g.renderer.info.render.frame-a;var dt=(performance.now()-t0)/1000;res(f/dt);},ms);});}',
    ' function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}',
    ' if(g.state!=="playing") g.startGame();',
    ' // 护盾只能挡一次（撞到就归零），所以要不断续上，否则测到一半就 gameover。',
    ' // 不用无敌帧是因为它会闪烁 rig.visible，会让 draw call 读数抖动。',
    ' var keepAlive=setInterval(function(){ if(g.player.shieldTimer<=0) g.player.shieldTimer=999; },120);',
    ' await sleep(400);',
    ' var r=g.renderer, out=[];',
    ' var c1=r.info.render.calls, t1=r.info.render.triangles;',
    ' out.push("draw calls(游玩帧) = "+c1);',
    ' out.push("triangles(游玩帧)   = "+t1);',
    ' out.push("geometries="+r.info.memory.geometries+"  textures="+r.info.memory.textures+"  programs="+(r.info.programs?r.info.programs.length:0));',
    ' var meshes=0; g.scene.traverse(function(o){ if(o.isMesh) meshes++; });',
    ' out.push("场景内 Mesh 总数 = "+meshes);',
    ' var decos=[];',
    ' for(var i=0;i<g.spawner.chunks.length;i++){var d=g.spawner.chunks[i].decos;for(var j=0;j<d.length;j++)decos.push(d[j]);}',
    ' var decoMeshes=0; for(var i=0;i<decos.length;i++) decos[i].traverse(function(o){if(o.isMesh)decoMeshes++;});',
    ' out.push("装饰物 "+decos.length+" 个 → 占用 "+decoMeshes+" 个 Mesh（6 区块合计）");',
    ' var f1 = await fps(1500);',
    ' for(var i=0;i<decos.length;i++) decos[i].visible=false;',
    ' await raf(); await sleep(200);',
    ' var c2=r.info.render.calls, t2=r.info.render.triangles;',
    ' var f2 = await fps(1500);',
    ' for(var i=0;i<decos.length;i++) decos[i].visible=true;',
    ' clearInterval(keepAlive);',
    ' out.push("");',
    ' out.push("实测 FPS（含两侧场景装饰）≈ "+f1.toFixed(1));',
    ' out.push("实测 FPS（关掉装饰对照）  ≈ "+f2.toFixed(1)+"   该帧 draw calls="+c2+"  triangles="+t2);',
    ' out.push("→ 场景装饰的代价：draw call +"+(c1-c2)+"，FPS 相对下降 "+((f2-f1)/f2*100).toFixed(0)+"%");',
    ' out.push("（无头 SwiftShader 是纯 CPU 软渲染，FPS 绝对值不代表真机，只看相对差值）");',
    ' return out.join("\\n");',
    '})()',
  ].join('\n');
  let perfOut = '';
  try {
    const rp = await send('Runtime.evaluate', { expression: PERF_TEST, returnByValue: true, awaitPromise: true });
    perfOut = rp.result && rp.result.value ? rp.result.value
      : (rp.exceptionDetails ? 'EVAL异常: ' + JSON.stringify(rp.exceptionDetails).slice(0, 300) : JSON.stringify(rp));
  } catch (e) { perfOut = '性能测量失败: ' + e.message; }
  let importOut = '';
  try {
    const r2 = await send('Runtime.evaluate', { expression: IMPORT_TEST, returnByValue: true, awaitPromise: true });
    importOut = r2.result && r2.result.value ? r2.result.value
      : (r2.exceptionDetails ? 'EVAL异常: ' + JSON.stringify(r2.exceptionDetails).slice(0, 400) : JSON.stringify(r2));
  } catch (e) { importOut = '导入测试失败: ' + e.message; }

  // 真实交互测试：逐个点击按钮，看状态是否变化
  const CLICK_TEST = [
    '(function(){',
    ' var out=[]; function L(s){out.push(s);}',
    ' function vis(id){var e=document.getElementById(id);if(!e)return id+"=MISSING";return id+(e.classList.contains("hidden")?"=隐藏":"=可见");}',
    ' function title(){return document.getElementById("modal-title").textContent;}',
    ' function bodyLen(){return document.getElementById("modal-body").innerHTML.length;}',
    ' function st(){return window.__nailongGame?window.__nailongGame.state:"n/a";}',
    ' function click(sel){var e=document.querySelector(sel);if(!e){L("  !! 找不到 "+sel);return false;}e.click();return true;}',
    ' var s0=JSON.parse(localStorage.getItem("nailong_parkour_save_v2")||"{}");',
    ' click("#btn-sound");',
    ' var s1=JSON.parse(localStorage.getItem("nailong_parkour_save_v2")||"{}");',
    ' L((s0.muted!==s1.muted?"[OK]  ":"[FAIL]")+" btn-sound 音效开关: muted "+s0.muted+" -> "+s1.muted);',
    ' click("#btn-music");',
    ' var s2=JSON.parse(localStorage.getItem("nailong_parkour_save_v2")||"{}");',
    ' L((s1.music!==s2.music?"[OK]  ":"[FAIL]")+" btn-music 音乐开关: music "+s1.music+" -> "+s2.music);',
    ' click(".side-btn[data-tab=world]"); L((title().indexOf("世界")>=0?"[OK]  ":"[FAIL]")+" 世界地图: 标题=\\""+title()+"\\" 内容="+bodyLen()+"B");',
    ' click("#modal-close"); L((vis("modal").indexOf("隐藏")>=0?"[OK]  ":"[FAIL]")+" modal-close 关闭: "+vis("modal"));',
    ' click(".side-btn[data-tab=rank]"); L((title().indexOf("排行")>=0?"[OK]  ":"[FAIL]")+" 排行榜: 标题=\\""+title()+"\\" 内容="+bodyLen()+"B"); click("#modal-close");',
    ' click(".side-btn[data-tab=skins]"); L((bodyLen()>100?"[OK]  ":"[FAIL]")+" 皮肤页: 内容="+bodyLen()+"B"); click("#modal-close");',
    ' click(".side-btn[data-tab=shop]"); L((bodyLen()>100?"[OK]  ":"[FAIL]")+" 商店页: 内容="+bodyLen()+"B"); click("#modal-close");',
    ' click(".side-btn[data-tab=achv]"); L((bodyLen()>100?"[OK]  ":"[FAIL]")+" 成就页: 内容="+bodyLen()+"B"); click("#modal-close");',
    ' click(".side-btn[data-tab=settings]"); L((bodyLen()>100?"[OK]  ":"[FAIL]")+" 设置页: 内容="+bodyLen()+"B"); click("#modal-close");',
    ' click(".nav-item[data-tab=achv]"); L((title().indexOf("挑战")>=0?"[OK]  ":"[FAIL]")+" 底部导航[成就]: 标题=\\""+title()+"\\""); click("#modal-close");',
    ' click("#btn-boost"); L((title().indexOf("道具")>=0?"[OK]  ":"[FAIL]")+" btn-boost 道具强化: 标题=\\""+title()+"\\""); click("#modal-close");',
    ' click("#btn-crown"); L((title().indexOf("荣誉")>=0?"[OK]  ":"[FAIL]")+" btn-crown 荣誉殿堂: 标题=\\""+title()+"\\""); click("#modal-close");',
    ' click("#btn-plus"); L((bodyLen()>100?"[OK]  ":"[FAIL]")+" btn-plus 金币帮助: 内容="+bodyLen()+"B"); click("#modal-close");',
    ' click("#btn-rank"); L((title().indexOf("排行")>=0?"[OK]  ":"[FAIL]")+" btn-rank: 标题=\\""+title()+"\\""); click("#modal-close");',
    ' click("#btn-random"); L((title().indexOf("皮肤")>=0?"[OK]  ":"[FAIL]")+" btn-random 随机换装(仅1套皮肤应引导去商店): 标题=\\""+title()+"\\""); click("#modal-close");',
    ' click("#nav-run");',
    ' L((st()==="playing"?"[OK]  ":"[FAIL]")+" nav-run 开始奔跑: state="+st()+" "+vis("menu")+" "+vis("hud"));',
    ' L("     canvas="+document.getElementById("game-canvas").width+"x"+document.getElementById("game-canvas").height);',
    ' click("#btn-pause"); L((st()==="paused"?"[OK]  ":"[FAIL]")+" btn-pause 暂停: state="+st()+" "+vis("pause"));',
    ' click("#btn-resume"); L((st()==="playing"?"[OK]  ":"[FAIL]")+" btn-resume 继续: state="+st());',
    ' click("#btn-quit"); L((st()==="menu"?"[OK]  ":"[FAIL]")+" btn-quit 返回菜单: state="+st()+" "+vis("menu"));',
    ' click("#btn-play"); L((st()==="playing"?"[OK]  ":"[FAIL]")+" btn-play 点击开跑: state="+st());',
    ' L("bootError="+(window.__nailongGame&&window.__nailongGame.bootError?"有":"无"));',
    ' L("boot-error面板="+(document.getElementById("boot-error")?"存在(异常!)":"无(正常)"));',
    ' return out.join("\\n");',
    '})()',
  ].join('\n');
  let clickOut = '';
  try {
    const r3 = await send('Runtime.evaluate', { expression: CLICK_TEST, returnByValue: true });
    clickOut = r3.result && r3.result.value ? r3.result.value
      : (r3.exceptionDetails ? 'EVAL异常: ' + JSON.stringify(r3.exceptionDetails).slice(0, 500) : JSON.stringify(r3));
  } catch (e) { clickOut = '交互测试失败: ' + e.message; }

  // 等 1.2 秒后检查渲染/更新循环是否真的在推进。
  // 先给玩家一段长时间无敌帧：障碍物约 13m 就可能撞死，
  // 而这里要验证的是「主循环在跑」，不能靠运气（否则会偶发 FAIL state=gameover）。
  await send('Runtime.evaluate', {
    expression: 'window.__nailongGame && (window.__nailongGame.player.invincibleTimer = 99999)',
    returnByValue: true,
  });
  await sleep(1200);
  const LOOP_TEST = [
    '(function(){',
    ' var g=window.__nailongGame;',
    ' if(!g) return "[FAIL] 拿不到 GameManager 实例（构造函数抛异常了）";',
    ' var o=[];',
    ' o.push((g.state==="playing"?"[OK]  ":"[FAIL]")+" state="+g.state);',
    ' o.push((g.time>0.5?"[OK]  ":"[FAIL]")+" 主循环在跑 time="+g.time.toFixed(2)+"s");',
    ' o.push((g.distance>1?"[OK]  ":"[FAIL]")+" 正在前进 distance="+g.distance.toFixed(1)+"m");',
    ' o.push((g.score>0?"[OK]  ":"[FAIL]")+" 分数在涨 score="+Math.floor(g.score));',
    ' o.push((g.player&&g.player.group?"[OK]  ":"[FAIL]")+" 玩家对象存在 y="+(g.player?g.player.group.position.y.toFixed(2):"n/a"));',
    ' o.push((g.spawner&&g.spawner.chunks.length>0?"[OK]  ":"[FAIL]")+" 赛道区块="+(g.spawner?g.spawner.chunks.length:0));',
    ' o.push("相机 pos=("+g.camera.position.x.toFixed(1)+","+g.camera.position.y.toFixed(1)+","+g.camera.position.z.toFixed(1)+") fov="+g.camera.fov.toFixed(0));',
    ' o.push("bootError="+(g.bootError?"有":"无"));',
    ' return o.join("\\n");',
    '})()',
  ].join('\n');
  let loopOut = '';
  try {
    const r4 = await send('Runtime.evaluate', { expression: LOOP_TEST, returnByValue: true });
    loopOut = r4.result && r4.result.value ? r4.result.value
      : (r4.exceptionDetails ? 'EVAL异常: ' + JSON.stringify(r4.exceptionDetails).slice(0, 400) : JSON.stringify(r4));
  } catch (e) { loopOut = '循环测试失败: ' + e.message; }

  // 浮点显示回归：塞入带长尾小数的存档 → 重载 → 检查界面绝不出现小数点
  const SEED = [
    '(function(){',
    ' var s={version:2,best:123.45678901234567,totalCoins:9876.543210987,',
    '  muted:false,music:false,vibrate:true,quality:"high",skin:"default",skins:["default"],startTheme:1,',
    '  upgrades:{magnet:2,shield:0,coin:1,headstart:0,luck:0},',
    '  achv:{},',
    '  scores:[{score:123.45678901234567,dist:412.987654321,coins:33.5,date:"9/26"}],',
    '  stats:{runs:3,totalDistance:5432.1987654321,totalCoinsEarned:2100.99887766,powerupsUsed:2,revives:1,bestCombo:31.7}};',
    ' localStorage.setItem("nailong_parkour_save_v2", JSON.stringify(s));',
    ' return "seeded";',
    '})()',
  ].join('\n');
  await send('Runtime.evaluate', { expression: SEED, returnByValue: true });
  await send('Runtime.evaluate', { expression: 'location.reload()' });
  await waitBoot(send, 40);

  const FLOAT_TEST = [
    '(function(){',
    ' var out=[];',
    ' function txt(id){var e=document.getElementById(id);return e?e.textContent.trim():"(MISSING)";}',
    ' function eq(label,got,want){out.push((got===want?"[OK]  ":"[FAIL]")+" "+label+": \\""+got+"\\""+(got===want?"":" (期望 \\""+want+"\\")"));}',
    ' function noDot(label,body){out.push((String(body).indexOf(".")<0?"[OK]  ":"[FAIL]")+" "+label+" 不含小数点");}',
    ' eq("顶栏历史最高分 #menu-best", txt("menu-best"), "123");',
    ' eq("顶栏金币 #menu-coins", txt("menu-coins"), "9876");',
    ' document.querySelector(".side-btn[data-tab=rank]").click();',
    ' var rank=document.getElementById("modal-body").textContent;',
    ' noDot("排行榜面板", rank);',
    ' out.push("     排行榜片段: "+rank.replace(/\\s+/g," ").slice(0,110));',
    ' document.getElementById("modal-close").click();',
    ' document.querySelector(".side-btn[data-tab=achv]").click();',
    ' var ach=document.getElementById("modal-body").textContent;',
    ' noDot("成就面板（累计距离曾是浮点）", ach);',
    ' out.push("     "+(ach.match(/累计奔跑|千里之行|\\d+\\/5000/)?"含进度数字":"")+ach.replace(/\\s+/g," ").slice(40,150));',
    ' document.getElementById("modal-close").click();',
    ' document.querySelector(".side-btn[data-tab=settings]").click();',
    ' var set=document.getElementById("modal-body").textContent;',
    ' noDot("设置面板（含统计）", set);',
    ' out.push("     设置片段: "+set.replace(/\\s+/g," ").slice(60,180));',
    ' document.getElementById("modal-close").click();',
    ' var sv=JSON.parse(localStorage.getItem("nailong_parkour_save_v2")||"{}");',
    ' eq("存档 best 已被规范化", String(sv.best), "123");',
    ' eq("存档 totalCoins 已被规范化", String(sv.totalCoins), "9876");',
    ' eq("存档 stats.bestCombo 已被规范化", String(sv.stats.bestCombo), "31");',
    ' eq("存档 scores[0].score 已被规范化", String(sv.scores[0].score), "123");',
    ' return out.join("\\n");',
    '})()',
  ].join('\n');
  let floatOut = '';
  try {
    const r5 = await send('Runtime.evaluate', { expression: FLOAT_TEST, returnByValue: true });
    floatOut = r5.result && r5.result.value ? r5.result.value
      : (r5.exceptionDetails ? 'EVAL异常: ' + JSON.stringify(r5.exceptionDetails).slice(0, 400) : JSON.stringify(r5));
  } catch (e) { floatOut = '浮点测试失败: ' + e.message; }

  // ==========================================================================
  //  新玩法机制校验（Phase 8）：机关 / 冲刺段 / 空中金币 / 高频防穿模 / 擦身而过已移除的回归护栏
  //  顺带体检两处历史遗留：区块生成里程是否被算成 2 倍、道具到底刷没刷出来
  // ==========================================================================
  const MECH_TEST = [
    '(async function(){',
    ' var g=window.__nailongGame; if(!g) return "[FAIL] 拿不到 game";',
    ' var C=window.__nailongConfig, OT=window.__nailongObstacles;',
    ' var out=[]; function L(s){out.push(s);}',
    ' function ok(c,msg){L((c?"[OK]  ":"[FAIL] ")+msg);}',
    ' function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}',
    ' function vis(id){return !document.getElementById(id).classList.contains("hidden");}',
    ' if(g.state!=="playing") g.startGame();',
    ' g.player.invincibleTimer=99999;',
    ' var keep=setInterval(function(){ g.player.invincibleTimer=99999; },80);',
    ' await sleep(250);',
    '',
    ' // ---- A. 存档字段兜底：旧存档缺少新统计字段时必须能补齐（load 合并顺序） ----',
    ' var missKeys=["rushCleared"].filter(function(k){return !(k in g.save.data.stats);});',
    ' ok(missKeys.length===0, "存档 stats 已补齐新字段（load 里 defaults 的合并顺序）：缺失 "+JSON.stringify(missKeys));',
    '',
    ' // ---- B. 扫描新生成的区块（用 z 变化判定，避免同一个区块被反复计数） ----',
    ' var sp=g.spawner;',
    ' var vworst=C.MAX_SPEED*C.PAD_BOOST_MULT*C.RUSH_SPEED_MULT;',
    ' var nPad=0,nBoost=0,nSpring=0,nPower=0,minPadGap=1e9,minPadPower=1e9;',
    ' var rows=0,maxBlocked=0,badRows=0,maxJump=-1,minMargin=1e9,minMarginTxt="";',
    ' var rushMiles=[],plainMiles=[],rowsByZ={};',
    ' function scan(){',
    '   for(var i=0;i<sp.chunks.length;i++){',
    '     var ch=sp.chunks[i];',
    '     if(ch.__z===ch.group.position.z) continue;',
    '     ch.__z=ch.group.position.z;',
    '     var mile=Math.abs(ch.group.position.z);',
    '     if(ch.rush) rushMiles.push(mile); else plainMiles.push(mile);',
    '     nPower+=ch.powerups.length;',
    '     var byZ={};',
    '     for(var m=0;m<ch.obstacles.length;m++){',
    '       var o=ch.obstacles[m], kz=o.position.z.toFixed(1), lane=Math.round(o.position.x/3)+1;',
    '       if(!byZ[kz]) byZ[kz]=[]; byZ[kz].push(lane);',
    '       if(!rowsByZ[kz]) rowsByZ[kz]=[]; if(rowsByZ[kz].indexOf(lane)<0) rowsByZ[kz].push(lane);',
    '     }',
    '     for(var k2 in byZ){ rows++; if(byZ[k2].length>maxBlocked)maxBlocked=byZ[k2].length; if(byZ[k2].length>=3)badRows++; }',
    '     for(var j=0;j<ch.pads.length;j++){',
    '       var p=ch.pads[j]; nPad++;',
    '       if(p.userData.padType==="boost")nBoost++; else nSpring++;',
    '       for(var a=0;a<sp.chunks.length;a++){',
    '         var co=sp.chunks[a];',
    '         for(var b=0;b<co.obstacles.length;b++){',
    '           var d1=co.obstacles[b].position.z-p.position.z;',
    '           if(d1>0) continue;          // 玩家沿 -z 前进，障碍 z 更小才是「前方」',
    '           if(-d1<minPadGap) minPadGap=-d1;',
    '         }',
    '         for(var b2=0;b2<co.powerups.length;b2++){var d2=Math.abs(co.powerups[b2].position.z-p.position.z); if(d2<minPadPower)minPadPower=d2;}',
    '       }',
    '     }',
    '   }',
    ' }',
    ' scan();',
    ' var pushed=0;',
    ' for(var t=0;t<600;t++){ g.player.group.position.z-=8; g.distance=-g.player.group.position.z; sp.update(g.player.group.position.z,g.distance); pushed+=8; scan(); }',
    ' var spanMiles=Math.round(pushed+240);',
    ' var zkeys=Object.keys(rowsByZ).map(Number).sort(function(a,b){return b-a;});',
    ' for(var i2=1;i2<zkeys.length;i2++){',
    '   var kA=zkeys[i2-1].toFixed(1), kB=zkeys[i2].toFixed(1);',
    '   var fa=[0,1,2].filter(function(l){return rowsByZ[kA].indexOf(l)<0;});',
    '   var fb=[0,1,2].filter(function(l){return rowsByZ[kB].indexOf(l)<0;});',
    '   var best=9; for(var u=0;u<fa.length;u++)for(var v=0;v<fb.length;v++){var dd=Math.abs(fa[u]-fb[v]); if(dd<best)best=dd;}',
    '   if(best>maxJump)maxJump=best;',
    '   var dZ=Math.abs(zkeys[i2-1]-zkeys[i2]);',
    '   var need=best*vworst*C.LANE_CHANGE_TIME;',
    '   if(dZ-need<minMargin){ minMargin=dZ-need; minMarginTxt="挪 "+best+" 条道 / 两排相距 "+dZ.toFixed(0)+"m / 极限速度下最少要 "+need.toFixed(1)+"m"; }',
    ' }',
    ' L("推进 "+spanMiles+"m：新生成 "+(rushMiles.length+plainMiles.length)+" 个区块 / "+rows+" 排障碍");',
    ' // ⚠️ 统计型断言不能拿一次随机采样去卡严格上限：PAD_CHANCE=0.55 是掷骰子，净空校验再刷掉约 2/3，',
    ' //    有效命中率约 0.18/区块。旧的「平均间距 <=400m」在 45 区块样本里等于 nPad>=5，',
    ' //    而 λ≈8.25 时 P(nPad<=4)≈3.7% —— 每跑 27 次就误报一次 FAIL（实测已撞到 4 个 / 460m）。',
    ' //    改成「按实际区块数算的下界」：4800m 推进后区块≈123、λ≈22.6，下界取 5% → 6，',
    ' //    误报概率 <1e-5，同时仍能抓住「机关几乎刷不出来」这种真回归（命中率腰斩时会抓到 ~97%）。',
    ' var nChunks=plainMiles.length+rushMiles.length;',
    ' var padSpacing=nPad?Math.round(spanMiles/nPad):1e9;',
    ' var padFloor=Math.max(2, Math.round(nChunks*0.05));',
    ' ok(nPad>=padFloor, "赛道机关投放正常："+nChunks+" 个区块里 "+nPad+" 个（加速带 "+nBoost+" / 弹跳板 "+nSpring+"），平均 "+padSpacing+"m 一个（下界 "+padFloor+"，防「机关几乎刷不出来」回归）");',
    ' ok(maxBlocked<=2 && badRows===0, "公平性：任意一排最多封 "+maxBlocked+" 条道，必死排 "+badRows+" 个");',
    ' ok(maxJump<=2, "公平性：相邻排之间最多只需挪 "+maxJump+" 条道（<=2 即整条赛道都过得去）");',
    ' ok(minMargin>=0, "公平性：极限速度("+vworst.toFixed(1)+"m/s)下也来得及变道 —— 最紧一处「"+minMarginTxt+"」，余量 "+minMargin.toFixed(2)+"m");',
    ' ok(nPad===0 || minPadGap>=C.PAD_CLEAR, "机关净空：机关前方最近的障碍 "+minPadGap.toFixed(1)+"m（要求 >= "+C.PAD_CLEAR+"m，保证弹跳板不会变成必死陷阱）");',
    ' L("     机关-道具最近距离: "+(minPadPower>1e8?"(本次样本内没有道具)":minPadPower.toFixed(1)+"m"));',
    ' var wantPower=Math.round(spanMiles/C.POWERUP_INTERVAL);',
    ' ok(nPower>=Math.floor(wantPower*0.6), "道具按 "+C.POWERUP_INTERVAL+"m 里程刷新：样本 "+nPower+" 个，期望约 "+wantPower+" 个");',
    ' var lo=1e9,hi=-1e9;',
    ' for(var q=0;q<rushMiles.length;q++){ if(rushMiles[q]<lo)lo=rushMiles[q]; if(rushMiles[q]>hi)hi=rushMiles[q]; }',
    ' if(rushMiles.length){',
    '   L("     冲刺段密集区块落在里程 "+lo+" ~ "+hi+"m（HUD 每 "+C.RUSH_EVERY+"m 播报一次，首段 "+C.RUSH_FIRST+" ~ "+(C.RUSH_FIRST+C.RUSH_LENGTH)+"m）");',
    '   ok(hi>C.RUSH_FIRST && lo<C.RUSH_FIRST+C.RUSH_LENGTH, "冲刺段密集区块与 HUD 播报区间重叠（里程换算没跑偏）");',
    ' } else L("[FAIL] 一个冲刺段区块都没生成");',
    '',
    ' // ---- C. 「擦身而过」已彻底移除（回归护栏：防止代码回滚时悄悄复活）----',
    ' var nmLeft=[];',
    ' if(typeof g._nearMiss==="function") nmLeft.push("game._nearMiss()");',
    ' if("NEAR_MISS_GAP" in C) nmLeft.push("CONFIG.NEAR_MISS_GAP");',
    ' if("NEAR_MISS_TIGHT" in C) nmLeft.push("CONFIG.NEAR_MISS_TIGHT");',
    ' if("NEAR_MISS_SCORE" in C) nmLeft.push("CONFIG.NEAR_MISS_SCORE");',
    ' if("NEAR_MISS_POP_CD" in C) nmLeft.push("CONFIG.NEAR_MISS_POP_CD");',
    ' if("nearMiss" in g.save.data.stats) nmLeft.push("save.stats.nearMiss");',
    ' if(g.nearMissCount!==undefined) nmLeft.push("game.nearMissCount");',
    ' ok(nmLeft.length===0, "擦身而过已彻底移除（残留："+JSON.stringify(nmLeft)+"）");',
    ' var achvStats=(window.__nailongAchievements||[]).map(function(a){return a.stat;});',
    ' ok(achvStats.length===9 && achvStats.indexOf("nearMiss")<0, "成就表已同步："+achvStats.length+" 条，仍含 nearMiss="+(achvStats.indexOf("nearMiss")>=0));',
    ' var nmShop=g.ui.renderShop(g.save), nmAchv=g.ui.renderAchievements(g.save);',
    ' ok(nmShop.indexOf("擦身")<0 && nmAchv.indexOf("擦身")<0 && nmAchv.indexOf("刀尖舞者")<0, "商店页 / 成就页都不再出现该机制文案");',
    ' var nmOb=null;',
    ' for(var i6=0;i6<sp.chunks.length&&!nmOb;i6++){var c6=sp.chunks[i6];for(var j6=0;j6<c6.obstacles.length;j6++){if(c6.obstacles[j6].visible){nmOb=c6.obstacles[j6];break;}}}',
    ' ok(!nmOb || nmOb.userData.nearDone===undefined, "障碍实例上不再挂 nearDone 结算标记");',
    ' // ---- D. 机关踩上去真的生效（找不到就继续往前推，直到出现机关） ----',
    ' function findPad(){',
    '   for(var i4=0;i4<sp.chunks.length;i4++){',
    '     var c4=sp.chunks[i4];',
    '     for(var j4=0;j4<c4.pads.length;j4++){ if(c4.pads[j4].visible) return c4.pads[j4]; }',
    '   }',
    '   return null;',
    ' }',
    ' function findPadType(t){',
    '   for(var i4=0;i4<sp.chunks.length;i4++){',
    '     var c4=sp.chunks[i4];',
    '     for(var j4=0;j4<c4.pads.length;j4++){ if(c4.pads[j4].visible && c4.pads[j4].userData.padType===t) return c4.pads[j4]; }',
    '   }',
    '   return null;',
    ' }',
    ' // 搜不到就手工造一个垫在脚下（挂到某个活区块的 pads 上，回收逻辑照旧收得走）。',
    ' // 这样加速带 / 弹跳板两条机制在任何一次运行里都必定被覆盖，不再靠运气。',
    ' function synthPad(t){',
    '   var pd=sp._get(sp.pools[t], function(){ return sp._makePad(t); });',
    '   pd.userData.padType=t; pd.userData.used=false;',
    '   pd.position.set(0, 0, g.player.group.position.z - 2);',
    '   pd.visible=true;',
    '   sp.chunks[0].pads.push(pd);',
    '   return pd;',
    ' }',
    ' // 先往前推 640m 找真实刷出来的机关（保真），找不到再补造',
    ' for(var h=0;h<80 && (!findPadType("boost") || !findPadType("spring"));h++){ g.player.group.position.z-=8; g.distance=-g.player.group.position.z; sp.update(g.player.group.position.z,g.distance); }',
    ' var synthBoost=false, synthSpring=false;',
    ' var boostPad=findPadType("boost"); if(!boostPad){ boostPad=synthPad("boost"); synthBoost=true; }',
    ' var springPad=findPadType("spring"); if(!springPad){ springPad=synthPad("spring"); synthSpring=true; }',
    ' if(synthBoost||synthSpring) L("     （样本里没刷出来的机关改由测试手工造：加速带"+(synthBoost?"造":"有")+" / 弹跳板"+(synthSpring?"造":"有")+"）");',
    ' function testPad(pad,isBoost){',
    '   var tag=isBoost?"加速带":"弹跳板";',
    '   g.player.padBoostTimer=0; g.player.vy=0; g.player.onGround=true; g.player.sliding=false;',
    '   g.player.group.position.set(pad.position.x,0,pad.position.z);',
    '   pad.userData.used=false;',
    '   g._checkCollisions();',
    '   if(isBoost) ok(g.player.padBoostTimer>0, "加速带被踩生效：padBoostTimer="+g.player.padBoostTimer.toFixed(2)+"s（速度 ×"+C.PAD_BOOST_MULT+"）");',
    '   else ok(g.player.vy>5, "弹跳板被踩生效：vy="+g.player.vy.toFixed(2)+"（普通跳约 11.9，弹跳板 "+C.PAD_SPRING_VY+"）");',
    '   ok(pad.userData.used===true, tag+"只触发一次：used="+pad.userData.used);',
    '   var tAfter=g.player.padBoostTimer, vAfter=g.player.vy;',
    '   g._checkCollisions();',
    '   ok(g.player.padBoostTimer===tAfter && g.player.vy===vAfter, tag+"不会重复触发（第二次判定无变化）");',
    ' }',
    ' testPad(boostPad,true);',
    ' testPad(springPad,false);',
    '',
    ' // ---- E. 空中金币：跳起来才吃得到 ----',
    ' var hc=null;',
    ' for(var i5=0;i5<sp.chunks.length&&!hc;i5++){var c5=sp.chunks[i5];for(var j5=0;j5<c5.coins.length;j5++){var cc=c5.coins[j5];if(cc.visible&&cc.position.y>=3.0){hc=cc;break;}}}',
      ' // 样本里没刷出空中金币 → 测试手工造一枚（和 D 段机关用例同一套路：',
      ' // 机制类断言必须确定性，不能让 5% 的运行因为「没刷出来」把这条核心机制整段跳过）。',
      ' var synthCoin=false;',
      ' if(!hc){ hc=sp._coin(sp.chunks[0], "coin", g.player.group.position.x, 3.25, g.player.group.position.z-6); synthCoin=true; L("     （样本里没有 >=3.0m 的空中金币，改由测试手工造一枚 3.25m 高的）"); }',
    ' if(hc){',
    '   var coinY=hc.position.y;',
    '   g.player.group.position.x=hc.position.x; g.player.group.position.z=hc.position.z;',
    '   g.player.group.position.y=0; g.player.vy=0; g.player.sliding=false;',
    '   g._checkCollisions();',
    '   ok(hc.visible===true, "站在地面吃不到 "+coinY.toFixed(2)+"m 高的金币");',
    '   g.player.group.position.y=coinY-C.PLAYER_H_STAND*0.5;',
    '   g._checkCollisions();',
    '   ok(hc.visible===false, "跳到 "+coinY.toFixed(2)+"m 就能吃到同一枚金币（旧代码把判定高度写死 1.2，跳起来会漏收）");',
      ' }',
    '',
    ' // ---- F. 冲刺段：进入 / 横幅 / 退出奖励 ----',
    ' clearInterval(keep);',
    ' g.rushCleared=0; g.rushActive=false; g.player.invincibleTimer=99999;',
    ' var stR=g.save.data.stats.rushCleared;',
    ' g.player.group.position.z=-(C.RUSH_FIRST+5); g.distance=C.RUSH_FIRST+5;',
    ' var scR=g.score;',
    ' await sleep(250);',
    ' ok(g.rushActive===true, "冲刺段已激活：rushActive="+g.rushActive);',
    ' ok(vis("rush"), "冲刺段横幅已显示");',
    ' L("     横幅："+JSON.stringify(document.getElementById("rush-text").textContent)+"  进度条="+document.getElementById("rush-fill").style.width);',
    ' g.player.group.position.z=-(C.RUSH_FIRST+C.RUSH_LENGTH+5); g.distance=C.RUSH_FIRST+C.RUSH_LENGTH+5;',
    ' await sleep(300);',
    ' ok(g.rushActive===false, "冲刺段已结束：rushActive="+g.rushActive);',
    ' ok(g.rushCleared===1, "通过计数 +1：rushCleared="+g.rushCleared);',
    ' ok(g.save.data.stats.rushCleared===stR+1, "通过次数已落盘：stats.rushCleared="+g.save.data.stats.rushCleared);',
    ' ok(g.score-scR>=C.RUSH_BONUS, "通过奖励 "+C.RUSH_BONUS+" 已发放（分数 +"+Math.round(g.score-scR)+"）");',
    ' ok(!vis("rush"), "横幅已隐藏");',
    '',
    ' // ---- G. 高频防穿模：单帧跨越 >2m 也不能穿过障碍 ----',
    ' sp.reset();',
    ' g.dead=false; g.player.shieldTimer=0; g.player.invincibleTimer=0; g.player.speedBoostTimer=0;',
    ' g.player.padBoostTimer=C.PAD_BOOST_TIME; g.speed=C.MAX_SPEED;',
    ' var laneX=C.LANE_X[1], pz0=-20, perFrame=C.MAX_SPEED*C.PAD_BOOST_MULT;',
    ' g.player.group.position.set(laneX,0,pz0); g.player.vy=0; g.player.onGround=true; g.distance=-pz0;',
    ' var victim=null;',
    ' for(var i6=0;i6<sp.chunks.length&&!victim;i6++){for(var j6=0;j6<sp.chunks[i6].obstacles.length;j6++){victim=sp.chunks[i6].obstacles[j6];break;}}',
    ' if(victim){',
    '   var dzf=perFrame*0.15, oz=pz0-dzf/2;',
    '   victim.userData.type="hurdle"; victim.userData.nearDone=true; victim.visible=true;',
    '   victim.position.set(laneX,0,oz);',
    '   L("     单帧位移 "+perFrame.toFixed(1)+"m/s × 0.15s = "+dzf.toFixed(2)+"m，障碍判定窗只有 ±1.0m");',
    '   L("     起点净距 "+Math.abs(pz0-oz).toFixed(2)+"m、终点净距 "+Math.abs((pz0-dzf)-oz).toFixed(2)+"m —— 两端都在窗外，只有子步进采样才撞得上");',
    '   g.update(0.15);',
    '   ok(g.dead===true, "高速跨帧仍撞上障碍（未穿模）：dead="+g.dead+" state="+g.state);',
    ' } else L("[SKIP] 重置后没有可用障碍");',
    ' return out.join("\\n");',
    '})()',
  ].join('\n');
  let mechOut = '';
  try {
    const r6 = await send('Runtime.evaluate', { expression: MECH_TEST, returnByValue: true, awaitPromise: true });
    mechOut = r6.result && r6.result.value ? r6.result.value
      : (r6.exceptionDetails ? 'EVAL异常: ' + JSON.stringify(r6.exceptionDetails).slice(0, 500) : JSON.stringify(r6));
  } catch (e) { mechOut = '新玩法测试失败: ' + e.message; }

  // ==========================================================================
  //  站上车顶（照《地铁跑酷》）：矮车厢能跳上去 / 车顶有金币 / 标准车厢仍须变道
  //  ⚠️ 机制类断言必须确定性：物理用例全部用「手工摆一节车厢 + 自己驱动子步进」，
  //     不依赖某次运行恰好刷出矮车厢；同时单独扫一遍真实生成物，证明它不是只在测试里成立。
  // ==========================================================================
  const ROOF_TEST = [
    '(async function(){',
    ' var g=window.__nailongGame; if(!g) return "[FAIL] 拿不到 game";',
    ' var C=window.__nailongConfig, OT=window.__nailongObstacles;',
    ' var out=[]; function L(s){out.push(s);}',
    ' function ok(c,msg){L((c?"[OK]  ":"[FAIL] ")+msg);}',
    ' function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}',
    ' if(g.state!=="playing") g.startGame();',
    ' var sp=g.spawner;',
    ' await sleep(150);',
    '',
    ' // ---- A. 契约层没动：站位盒四个数字必须和改造前一模一样 ----',
    ' var D=OT.train;',
    ' ok(D.minY===0&&D.maxY===3.4&&D.halfX===1.4&&D.halfZ===4.0,',
    '    "车厢命中盒契约未变：["+D.minY+","+D.maxY+"] halfX="+D.halfX+" halfZ="+D.halfZ);',
    ' ok(D.standable===true, "车厢标记为可站立平台：standable="+D.standable);',
    ' // 硬约束：门限必须「矮车跳得上去 + 标准车跳不上去」，两者是同一个常数决定的，必须一起守',
    ' ok(C.TRAIN_ROOF-C.TRAIN_CLIMB_ASSIST>C.JUMP_HEIGHT,',
    '    "标准车厢够不着：门限 "+(C.TRAIN_ROOF-C.TRAIN_CLIMB_ASSIST).toFixed(2)+"m > 跳跃峰值 "+C.JUMP_HEIGHT+"m（余量 "+(C.TRAIN_ROOF-C.TRAIN_CLIMB_ASSIST-C.JUMP_HEIGHT).toFixed(2)+"m）");',
    ' ok(C.TRAIN_ROOF_LOW<=C.JUMP_HEIGHT+C.TRAIN_CLIMB_ASSIST,',
    '    "矮车厢跳得上去：车顶 "+C.TRAIN_ROOF_LOW+"m <= 峰值 "+C.JUMP_HEIGHT+"+辅助 "+C.TRAIN_CLIMB_ASSIST+"m");',
    '',
    ' // ---- B. 真实生成物扫描：矮/标准两种车高都会被刷出来，车顶金币只铺在矮车上 ----',
    ' var nLow=0,nStd=0,nLowCoin=0,nStdCoin=0,badRoof=0;',
    ' function scanTrains(){',
    '   for(var i=0;i<sp.chunks.length;i++){',
    '     var c=sp.chunks[i];',
    '     if(c.__zT===c.group.position.z) continue;',
    '     c.__zT=c.group.position.z;',
    '     for(var j=0;j<c.obstacles.length;j++){',
    '       var o=c.obstacles[j];',
    '       if(!o.visible||o.userData.type!=="train") continue;',
    '       var isLow=o.userData.low===true, want=isLow?C.TRAIN_ROOF_LOW:C.TRAIN_ROOF;',
    '       if(Math.abs(o.userData.roofY-want)>1e-6) badRoof++;',
    '       if(isLow) nLow++; else nStd++;',
    '       var hasCoin=false;',
    '       for(var k=0;k<c.coins.length;k++){',
    '         var co=c.coins[k];',
    '         if(!co.visible) continue;',
    '         if(Math.abs(co.position.x-o.position.x)<0.1&&Math.abs(co.position.z-o.position.z)<4.2&&Math.abs(co.position.y-(want+C.ROOF_COIN_Y))<0.05) hasCoin=true;',
    '       }',
    '       if(isLow&&hasCoin) nLowCoin++;',
    '       if(!isLow&&hasCoin) nStdCoin++;',
    '     }',
    '   }',
    ' }',
    ' for(var h=0;h<90;h++){ g.player.group.position.z-=8; g.distance=-g.player.group.position.z; sp.update(g.player.group.position.z,g.distance); scanTrains(); }',
    ' ok(nLow>0&&nStd>0, "两种车高都真的会被刷出来：矮款 "+nLow+" 节 / 标准款 "+nStd+" 节（矮款比例 "+C.TRAIN_LOW_CHANCE+"）");',
    ' ok(badRoof===0, "每节车厢的 userData.roofY 都与它的车高一致：不一致 "+badRoof+" 节");',
    ' ok(nLowCoin===nLow&&nLow>0, "矮车厢车顶都铺了金币串："+nLowCoin+"/"+nLow+" 节");',
    ' ok(nStdCoin===0, "标准车厢车顶不铺金币（3.4m 跳不上去，铺了就是永远吃不到的诱饵）："+nStdCoin+" 节");',
    '',
    ' // ---- C. 物理用例：手工摆一节车厢，自己驱动子步进（与主循环同结构，只是不调 spawner.update） ----',
    ' function clearTrack(){',
    '   for(var i=0;i<sp.chunks.length;i++){',
    '     var c=sp.chunks[i], j;',
    '     for(j=0;j<c.obstacles.length;j++){ c.obstacles[j].visible=false; c.obstacles[j].position.set(0,-999,0); c.obstacles[j].userData.nearDone=false; }',
    '     c.obstacles.length=0;',
    '     for(j=0;j<c.coins.length;j++){ c.coins[j].visible=false; c.coins[j].position.set(0,-999,0); }',
    '     c.coins.length=0;',
    '     for(j=0;j<c.pads.length;j++) c.pads[j].visible=false;',
    '     c.pads.length=0;',
    '     for(j=0;j<c.powerups.length;j++) c.powerups[j].visible=false;',
    '     c.powerups.length=0;',
    '   }',
    ' }',
    ' function makeTrain(isLow){',
    '   var o=sp._get(sp.pools[isLow?"train0L":"train0"], function(){ return sp._makeObstacle("train",0,isLow); });',
    '   o.userData.type="train"; o.userData.nearDone=true; o.userData.livery=0;',
    '   o.userData.low=isLow; o.userData.roofY=isLow?C.TRAIN_ROOF_LOW:C.TRAIN_ROOF;',
    '   o.visible=true;',
    '   sp.chunks[0].obstacles.push(o);',
    '   return o;',
    ' }',
    ' // tJump = 起跳时刻距「玩家前缘碰到车头面」还有多少秒。实测可用时机窗 0.12~0.62s',
    ' // （与速度无关 —— 抛物线是时间域的），取 0.35s 落在正中。',
    ' function drive(car,isLow,tJump,coins){',
    '   var roofY=car.userData.roofY, px=C.LANE_X[0], startZ=-60;',
    '   car.position.set(px,0,startZ-14);',
    '   g.dead=false; g.state="playing"; g.coins=coins?0:g.coins;',
    '   g.player.laneIndex=0; g.player.targetX=px; g.player.group.position.set(px,0,startZ);',
    '   g.player.vy=0; g.player.onGround=true; g.player.platform=null; g.player.sliding=false;',
    '   g.player.invincibleTimer=0; g.player.shieldTimer=0; g.player.speedBoostTimer=0;',
    '   g.player.padBoostTimer=0; g.player.magnetTimer=0; g.player.runTime=0;',
    '   g.speed=C.START_SPEED; sp.safeLane=0;',
    '   var contact=(car.position.z+4.0)+C.PLAYER_HALF_Z;',
    '   var jumped=false, climbed=false, climbY=0, climbGround=false, coinsLeft=0, xdrift=0, t=0, dt=1/60;',
    '   while(t<4&&!g.dead){',
    '     var v=g.speed;',
    '     if(!jumped&&(g.player.group.position.z-contact)/v<=tJump){ g.player.jump(); jumped=true; }',
    '     var sub=Math.max(1,Math.ceil((v*dt)/0.6)), sdt=dt/sub;',
    '     for(var s=0;s<sub;s++){',
    '       g.player.group.position.z-=v*sdt;',
    '       g.player.update(sdt);',
    '       if(Math.abs(g.player.group.position.x-px)>xdrift) xdrift=Math.abs(g.player.group.position.x-px);',
    '       g._checkCollisions();',
    '       if(g.dead) break;',
    '       if(g.player.platform===car&&Math.abs(g.player.group.position.y-roofY)<1e-6){ climbed=true; climbY=g.player.group.position.y; climbGround=g.player.onGround; }',
    '     }',
    '     t+=dt;',
    '     if(g.player.group.position.z<car.position.z-14) break;',
    '   }',
    '   if(coins){ for(var k=0;k<sp.chunks[0].coins.length;k++) if(sp.chunks[0].coins[k].visible&&Math.abs(sp.chunks[0].coins[k].position.y-(roofY+C.ROOF_COIN_Y))<0.05) coinsLeft++; }',
    '   return { dead:g.dead, climbed:climbed, climbY:climbY, climbGround:climbGround, y:g.player.group.position.y, onGround:g.player.onGround, coinsLeft:coinsLeft, xdrift:xdrift, t:t };',
    ' }',
    '',
    ' // ---- D. 矮车厢：跳上去 ----',
    ' clearTrack();',
    ' var lowCar=makeTrain(true);',
    ' var rLow=drive(lowCar,true,0.35,false);',
    ' ok(!rLow.dead&&rLow.climbed, "矮车厢(2.05m)跳上去成功：dead="+rLow.dead+" 上车顶瞬间 y="+rLow.climbY.toFixed(2)+"，跑完整节后已落回地面 y="+rLow.y.toFixed(2)+"（全程 "+rLow.t.toFixed(2)+"s）");',
    ' ok(Math.abs(rLow.climbY-C.TRAIN_ROOF_LOW)<1e-6&&rLow.climbGround, "上车顶那一刻落脚高度精确等于 TRAIN_ROOF_LOW：y="+rLow.climbY.toFixed(3)+" onGround="+rLow.climbGround);',
    ' ok(rLow.xdrift<0.05, "测试期间玩家始终留在目标车道（没被变道插值拉走）：横向漂移 "+rLow.xdrift.toFixed(3)+"m");',
    '',
    ' // ---- E. 矮车厢：不起跳必死 ----',
    ' clearTrack();',
    ' var lowCar2=makeTrain(true);',
    ' var rNoJump=drive(lowCar2,true,-99,false);',
    ' ok(rNoJump.dead===true, "矮车厢不起跳 → 撞车身：dead="+rNoJump.dead);',
    '',
    ' // ---- F. 标准车厢：起跳也必死（只能变道躲） ----',
    ' clearTrack();',
    ' var stdCar=makeTrain(false);',
    ' var rStd=drive(stdCar,false,0.35,false);',
    ' ok(rStd.dead===true&&!rStd.climbed, "标准车厢(3.4m)同车道起跳仍然必死 ⇒ 只能变道躲：dead="+rStd.dead+" climbed="+rStd.climbed);',
    '',
    ' // ---- G. 车顶金币：站上车顶才吃得到 ----',
    ' clearTrack();',
    ' var c3=makeTrain(true); c3.position.set(C.LANE_X[0],0,-74);   // 先挪到位再摆金币，否则金币会挂到旧坐标上',
    ' var roofCoinY=C.TRAIN_ROOF_LOW+C.ROOF_COIN_Y, mk3=[];',
    ' for(var k3=0;k3<4;k3++) mk3.push(sp._coin(sp.chunks[0],"coin",C.LANE_X[0],roofCoinY,c3.position.z-3.2+k3*2.13));',
    ' // G1 站地面（同车道）先试一次：必须吃不到',
    ' var gz=C.LANE_X[0], gzz=mk3[0].position.z;',
    ' g.player.group.position.set(gz,0,gzz); g.player.onGround=true; g.player.platform=null;',
    ' g._checkCollisions();',
    ' var gotOnGround=false; for(var k4=0;k4<mk3.length;k4++) if(!mk3[k4].visible) gotOnGround=true;',
    ' ok(gotOnGround===false, "站地面（同车道）吃不到 "+roofCoinY.toFixed(2)+"m 的车顶金币：pcY="+(0+C.PLAYER_H_STAND*0.5).toFixed(2)+"，净差 "+Math.abs(C.PLAYER_H_STAND*0.5-roofCoinY).toFixed(2)+" > 判定窗 1.7");',
    ' // G2 邻车道再试：必须吃不到',
    ' g.player.group.position.set(C.LANE_X[1],0,gzz);',
    ' g._checkCollisions();',
    ' var gotSide=false; for(var k5=0;k5<mk3.length;k5++) if(!mk3[k5].visible) gotSide=true;',
    ' ok(gotSide===false, "邻车道（3.0m 外）吃不到车顶金币：横向判定窗只有 0.95m");',
    ' // G3 真跑一趟：上车顶后必须把整串收走',
    ' clearTrack();',
    ' var c4=makeTrain(true); c4.position.set(C.LANE_X[0],0,-74);   // 同上：drive() 稍后会把车挪到同一位置',
    ' for(var k6=0;k6<4;k6++) sp._coin(sp.chunks[0],"coin",C.LANE_X[0],roofCoinY,c4.position.z-3.2+k6*2.13);',
    ' var coinsBefore=g.coins;',
    ' var rCoin=drive(c4,true,0.35,true);',
    ' ok(!rCoin.dead&&rCoin.coinsLeft===0&&g.coins>0, "站上车顶跑过整节车厢 → 车顶金币全部收走：剩 "+rCoin.coinsLeft+" 枚，本局金币 "+g.coins+"（drive 前重置为 0）");',
    '',
    ' // ---- H. 走出车顶边缘 → 自然落回赛道 ----',
    ' clearTrack();',
    ' var c5=makeTrain(true);',
    ' var rOff=drive(c5,true,0.35,false);',
    ' ok(Math.abs(rOff.y)<1e-6&&rOff.onGround&&!rOff.dead, "跑出车尾后自然落回赛道地面（不是贴地瞬移）：y="+rOff.y+" onGround="+rOff.onGround);',
    ' return out.join("\\n");',
    '})()',
  ].join('\n');
  let roofOut = '';
  try {
    const r7 = await send('Runtime.evaluate', { expression: ROOF_TEST, returnByValue: true, awaitPromise: true });
    roofOut = r7.result && r7.result.value ? r7.result.value
      : (r7.exceptionDetails ? 'EVAL异常: ' + JSON.stringify(r7.exceptionDetails).slice(0, 500) : JSON.stringify(r7));
  } catch (e) { roofOut = '车顶玩法测试失败: ' + e.message; }

  // ==========================================================================
  //  背景音乐（v4.0 起改用真实音频文件 libs/bgm.m4a，不再是振荡器合成的琶音）
  //  ⚠️ 这一节必须自带一条**反向对照**（指向不存在的文件要能被检测出来）。
  //     否则「bgmFailed === false / duration ≈ 140s」完全可能是恒真的假通过 ——
  //     本轮之前那版换轨就是把「坏文件」验成了「通过」。
  // ==========================================================================
  const BGM_TEST = [
    '(async function(){',
    ' var g=window.__nailongGame; if(!g) return "[FAIL] 拿不到 game";',
    ' var C=window.__nailongConfig;',
    ' var out=[]; function L(s){out.push(s);}',
    ' function ok(c,msg){L((c?"[OK]  ":"[FAIL] ")+msg);}',
    ' function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}',
    ' var A=g.audio;',
    ' // 先让「存档」和「运行时」一致 —— 真实玩家开着音乐时就是这个状态。',
    ' // 只改 A.musicOn 而不动 save.data.music 的话，startGame() 里的 setMusic(save.data.music)',
    ' // 会按存档把音乐重新关掉（这是上一轮 3 条 FAIL 的真正原因，不是功能缺陷）。',
    ' g.save.data.music = true; g.save.save(); A.setMusic(true);',
    '',
    ' // ---- A. 契约层：指向本地音频文件 ----',
    ' ok(C.BGM_SRC==="./libs/bgm.m4a", "BGM 指向本地文件：BGM_SRC=「"+C.BGM_SRC+"」");',
    ' ok(typeof C.BGM_VOLUME==="number"&&C.BGM_VOLUME>0&&C.BGM_VOLUME<=1, "BGM 音量落在 (0,1]：BGM_VOLUME="+C.BGM_VOLUME);',
    ' ok(C.BGM_LOOP===true, "BGM 开循环：BGM_LOOP="+C.BGM_LOOP);',
    '',
    ' // ---- B. 音频文件真的取到了（404 / 解不开都会在这一组露馅）----',
    ' var el=A.bgmEl;',
    ' ok(!!el, "已建 <audio> 播放器、没退回合成 BGM：bgmFailed="+A.bgmFailed);',
    ' if(!el){ L("[SKIP] 没有 bgmEl，播放类断言整组跳过"); return out.join("\\n"); }',
    ' if(el.readyState<1){ await new Promise(function(res){ var d=false; function fin(){ if(d)return; d=true; res(); } el.addEventListener("loadedmetadata",fin); el.addEventListener("error",fin); setTimeout(fin,6000); }); }',
    ' ok(!el.error, "音频无解码错误：error="+(el.error?("code "+el.error.code):"null"));',
    ' ok(el.readyState>=1, "音频元数据已就绪：readyState="+el.readyState+"（0=没拿到 · >0=真的解开了）");',
    ' ok(el.currentSrc.indexOf("bgm.m4a")>=0, "音源就是 bgm.m4a：…"+el.currentSrc.slice(-8));',
    ' var dur=el.duration;',
    ' ok(isFinite(dur)&&Math.abs(dur-140.06)<1.0, "曲长与那段视频的音乐一致：duration="+(isFinite(dur)?dur.toFixed(2):String(dur))+"s（期望 140.06s）");',
    ' ok(el.loop===true, "循环属性已打开：loop="+el.loop);',
    '',
    ' // ---- C. 播放行为：真的在放，且走的是音频文件而不是合成兜底 ----',
    ' if(g.state!=="playing") g.startGame();',
    ' A.setMusic(true); A.setMuted(g.save.data.muted); A.startBGM();',
    ' await sleep(900);',
    ' var t0=el.currentTime;',
    ' await sleep(700);',
    ' var t1=el.currentTime;',
    ' ok(el.paused===false, "开跑后 BGM 在播放：paused="+el.paused);',
    ' ok(t1>t0, "播放进度真的在走：currentTime "+t0.toFixed(2)+"s → "+t1.toFixed(2)+"s");',
    ' ok(A.bgmTimer===null, "没有同时跑合成 BGM：bgmTimer="+A.bgmTimer);',
    ' ok(Math.abs(el.volume-C.BGM_VOLUME)<1e-6, "音量已应用：volume="+el.volume+"（CONFIG="+C.BGM_VOLUME+"）");',
    '',
    ' // ---- D. 暂停 / 继续：暂停记住进度，继续从原处接着放 ----',
    ' A.stopBGM(); var tp=el.currentTime;',
    ' ok(el.paused===true, "stopBGM 会暂停：paused="+el.paused);',
    ' await sleep(500);',
    ' ok(Math.abs(el.currentTime-tp)<0.3, "暂停期间进度不动：停在 "+tp.toFixed(2)+"s（现 "+el.currentTime.toFixed(2)+"s）");',
    ' A.startBGM(); await sleep(400);',
    ' ok(el.paused===false&&el.currentTime>=tp-0.1, "startBGM 从原处接着放：currentTime="+el.currentTime.toFixed(2)+"s（暂停点 "+tp.toFixed(2)+"s）");',
    '',
    ' // ---- E. 音乐开关 / 静音联动 ----',
    ' A.setMusic(false);',
    ' ok(el.paused===true, "关掉背景音乐会停：paused="+el.paused);',
    ' A.setMusic(true); A.startBGM(); await sleep(300);',
    ' ok(el.paused===false, "重新打开会继续放：paused="+el.paused);',
    ' A.setMuted(true);',
    ' ok(el.muted===true, "静音必须联动到 BGM：el.muted="+el.muted+"（不能只静音音效）");',
    ' A.setMuted(false);',
    ' ok(el.muted===false, "取消静音后 BGM 恢复：el.muted="+el.muted);',
    '',
    ' // ---- G. 贯穿全局：主界面 / 暂停页 / 结算页都不该把音乐停掉 ----',
    ' A.setMusic(true); A.startBGM(); await sleep(300);',
    ' g._toMenu(); await sleep(350);',
    ' ok(g.state==="menu"&&el.paused===false, "回主菜单后 BGM 仍在放（主界面也有音乐）：state="+g.state+" paused="+el.paused);',
    ' g.startGame(); await sleep(350);',
    ' ok(el.paused===false, "开跑后仍接着同一条音轨放：paused="+el.paused);',
    ' g._onPause(); await sleep(300);',
    ' ok(g.state==="paused"&&el.paused===false, "暂停页 BGM 继续放：state="+g.state+" paused="+el.paused);',
    ' g._onPause(); await sleep(300);',
    ' ok(g.state==="playing", "再按一次暂停键恢复游戏：state="+g.state);',
    ' g._die(); await sleep(350);',
    ' ok(g.state==="gameover"&&el.paused===false, "结算页 BGM 继续放：state="+g.state+" paused="+el.paused);',
    ' ok(A.bgmTimer===null, "全程都没退回合成 BGM：bgmTimer="+A.bgmTimer);',
    '',
    ' // ---- F. 反向对照：指向不存在的文件必须能被检测出来 ----',
    ' var probe=new Audio("./libs/__no_such_audio__.m4a");',
    ' var probeErr=await new Promise(function(res){ var d=false; function fin(v){ if(d)return; d=true; res(v); } probe.addEventListener("error",function(){fin(true);}); setTimeout(function(){fin(false);},3000); });',
    ' ok(probeErr===true, "反向对照：指向不存在的音频确实会触发 error（证明上面那组就绪断言不是恒真）");',
    ' ok(probe.readyState===0, "反向对照：坏音源 readyState 停在第 0 级（对照组读数与实验组确实不同）");',
    ' return out.join("\\n");',
    '})()',
  ].join('\n');
  let bgmOut = '';
  try {
    const r8 = await send('Runtime.evaluate', { expression: BGM_TEST, returnByValue: true, awaitPromise: true });
    bgmOut = r8.result && r8.result.value ? r8.result.value
      : (r8.exceptionDetails ? 'EVAL异常: ' + JSON.stringify(r8.exceptionDetails).slice(0, 500) : JSON.stringify(r8));
  } catch (e) { bgmOut = '背景音乐测试失败: ' + e.message; }

  // ---- 追加：真正的「开箱即播」——重载后一次都不点，主界面就该有音乐 ----
  //  本 harness 带 --autoplay-policy=no-user-gesture-required，正好能验证「不依赖任何点击」这条路径
  //  （真实浏览器首次访问仍会被自动播放策略拦住，必须有一次用户手势，那是平台限制、不是代码缺陷）。
  let bgmBootOut = '';
  try {
    // 先把音乐开关存成「开」，否则重载后音乐本来就是关的，这条测试就没意义
    await send('Runtime.evaluate', { expression: '(function(){var g=window.__nailongGame;if(g){g.save.data.music=true;g.save.save();}return "music-on";})()', returnByValue: true });
    await send('Runtime.evaluate', { expression: 'location.reload()' });
    await waitBoot(send, 40);
    const BOOT_TEST = [
      '(async function(){',
      ' var g=window.__nailongGame; var out=[];',
      ' function ok(c,m){out.push((c?"[OK]  ":"[FAIL] ")+m);}',
      ' function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}',
      ' if(!g) return "[FAIL] 重载后拿不到 game";',
      ' var A=g.audio, el=A.bgmEl;',
      ' ok(g.state==="menu", "重载后停在主界面：state="+g.state);',
      ' if(el&&el.readyState<1){ await new Promise(function(res){ var d=false; function fin(){ if(d)return; d=true; res(); } el.addEventListener("loadedmetadata",fin); el.addEventListener("error",fin); setTimeout(fin,6000); }); }',
      ' ok(!!el&&A.bgmFailed===false, "主界面阶段就已建好播放器：bgmFailed="+A.bgmFailed);',
      ' await sleep(1400);',
      ' ok(el&&el.paused===false, "一次都没点，主界面 BGM 就已经在放：paused="+(el?el.paused:"n/a"));',
      ' ok(el&&el.currentTime>0.05, "而且进度真的在走：currentTime="+(el?el.currentTime.toFixed(2):"n/a")+"s");',
      ' return out.join("\\n");',
      '})()',
    ].join('\n');
    const rb = await send('Runtime.evaluate', { expression: BOOT_TEST, returnByValue: true, awaitPromise: true });
    bgmBootOut = rb.result && rb.result.value ? rb.result.value
      : (rb.exceptionDetails ? 'EVAL异常: ' + JSON.stringify(rb.exceptionDetails).slice(0, 400) : JSON.stringify(rb));
  } catch (e) { bgmBootOut = '开箱即播测试失败: ' + e.message; }
  bgmOut = bgmOut + '\n' + bgmBootOut;   // 并入 BGM 段统一打印，避免重复输出

  // ==========================================================================
  //  结算界面视频（v4.1 新增）：死亡后 #gameover 里的那段 libs/gameover.mp4
  //  ⚠️ 与 BGM 段同理，必须自带**反向对照**，否则 "paused===false" 完全可能恒真。
  //     这里有两组对照：① 主界面/游玩中必须不播；② 指向不存在文件的视频必须报错。
  //  视口固定成 390x844（本 harness 默认 800x600，不是本游戏的移动端目标尺寸）。
  // ==========================================================================
  let goOut = '';
  try {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    });
    await send('Page.navigate', { url: URL_ });
    await waitBoot(send, 40);

    const GOVIDEO_TEST = [
      '(async function(){',
      ' var g=window.__nailongGame; if(!g) return "[FAIL] 拿不到 game";',
      ' var out=[]; function L(s){out.push(s);}',
      ' function ok(c,m){L((c?"[OK]  ":"[FAIL] ")+m);}',
      ' function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}',
      ' var v=document.getElementById("go-video");',
      ' ok(!!v, "结算面板里有视频元素 #go-video");',
      ' if(!v){ L("[SKIP] 没有 #go-video，整组跳过"); return out.join("\\n"); }',
      ' L("     视口 " + window.innerWidth + "x" + window.innerHeight);',
      '',
      ' // ---- A. 契约层 ----',
      ' var src=v.getAttribute("src")||"";',
      ' ok(src.indexOf("libs/gameover.mp4")>=0, "视频指向本地文件：src=「"+src+"」");',
      ' ok(v.muted===true, "视频是静音的（否则会和全局 BGM 打架）：muted="+v.muted);',
      ' ok(v.loop===true, "视频循环播放：loop="+v.loop);',
      ' ok(v.hasAttribute("playsinline"), "带 playsinline（避免 iOS 全屏劫持）：" + v.hasAttribute("playsinline"));',
      '',
      ' // ---- B. 反向对照之一：主界面 / 游玩中都不该播 ----',
      ' g._toMenu(); await sleep(500);',
      ' ok(g.state==="menu"&&v.paused===true, "主界面阶段视频不播：state="+g.state+" paused="+v.paused);',
      ' g.startGame(); await sleep(600);',
      ' ok(v.paused===true, "游玩中视频也不播（只在结算界面出现）：paused="+v.paused);',
      '',
      ' // ---- C. 死亡后开始播，且从头开始 ----',
      ' try{ v.currentTime=5; }catch(e){}', 
      ' g._die(); await sleep(900);',
      ' ok(g.state==="gameover", "已进入结算状态：state="+g.state);',
      ' ok(v.paused===false, "死亡结算后视频开始播：paused="+v.paused);',
      ' ok(v.currentTime<1.5, "而且是从头播的（进结算会把 currentTime 归零）：currentTime="+v.currentTime.toFixed(2)+"s");',
      ' var t0=v.currentTime; await sleep(700); var t1=v.currentTime;',
      ' ok(t1>t0, "播放进度真的在走：currentTime "+t0.toFixed(2)+"s → "+t1.toFixed(2)+"s");',
      '',
      ' // ---- D. 素材真的解开了（404 / 编解码失败会在这组露馅）----',
      ' ok(!v.error, "视频无解码错误：error="+(v.error?("code "+v.error.code):"null"));',
      ' ok(v.readyState>=2, "视频已拿到可播数据：readyState="+v.readyState+"（0=没拿到 · >=2=已有当前帧）");',
      ' ok(v.currentSrc.indexOf("gameover.mp4")>=0, "实际加载的就是 gameover.mp4：…"+v.currentSrc.slice(-14));',
      ' ok(v.videoWidth>0&&v.videoHeight>0, "内禀分辨率已解出："+v.videoWidth+"x"+v.videoHeight);',
      ' var ar=v.videoHeight>0?v.videoWidth/v.videoHeight:0;',
      ' ok(Math.abs(ar-480/644)<0.02, "内禀宽高比 = 480:644（裁掉黑边后的真实比例）：实测 "+ar.toFixed(3));',
      '',
      ' // ---- E. 版面：视频在结算面板内、没被拉伸、没把面板顶出屏幕 ----',
      ' var card=v.parentNode, cr=card?card.getBoundingClientRect():null;',
      ' ok(!!cr, "视频挂在结算面板卡片里：parent=「"+(card?(card.tagName+"."+card.className):"null")+"」");',
      ' var r=v.getBoundingClientRect();',
      ' ok(r.width>0&&r.height>0, "视频可见且有尺寸："+Math.round(r.width)+"x"+Math.round(r.height));',
      ' var boxAr=r.height>0?r.width/r.height:0;',
      ' ok(Math.abs(boxAr-ar)<0.03, "渲染比例与内禀比例一致（未被拉伸变形）："+boxAr.toFixed(3)+" vs "+ar.toFixed(3));',
      ' ok(r.top>=cr.top-1&&r.bottom<=cr.bottom+1, "视频完整落在面板卡片内（没顶出卡片）：video ["+Math.round(r.top)+","+Math.round(r.bottom)+"] ⊂ card ["+Math.round(cr.top)+","+Math.round(cr.bottom)+"]");',
      ' ok(cr.height<=window.innerHeight+2, "面板卡片本身没超出视口：cardH="+Math.round(cr.height)+" winH="+window.innerHeight);',
      ' ok(document.documentElement.scrollHeight<=window.innerHeight+2, "结算界面没有溢出成可滚动：scrollH="+document.documentElement.scrollHeight+" winH="+window.innerHeight);',
      '',
      ' // ---- F. 离开结算就停（不能挂在后台一直解码）----',
      ' g._toMenu(); await sleep(400);',
      ' ok(v.paused===true, "回主菜单后视频停下：paused="+v.paused);',
      ' g.startGame(); await sleep(400); g._die(); await sleep(700);',
      ' var p1=v.paused; g._toMenu(); await sleep(350);',
      ' ok(p1===false&&v.paused===true, "再次结算会重播、再离开又会停：结算时 paused="+p1+" → 离开后 paused="+v.paused);',
      '',
      ' // ---- G. 反向对照之二：指向不存在的视频必须能被检测出来 ----',
      ' var probe=document.createElement("video");',
      ' probe.muted=true; probe.preload="metadata";',
      ' document.body.appendChild(probe);',
      ' probe.src="./libs/__no_such_video__.mp4";',
      ' var pErr=await new Promise(function(res){ var d=false; function fin(val){ if(d)return; d=true; res(val); } probe.addEventListener("error",function(){fin(true);}); setTimeout(function(){fin(false);},3000); });',
      ' ok(pErr===true, "反向对照：指向不存在的视频确实会触发 error（证明上面那组就绪断言不是恒真）");',
      ' ok(probe.readyState===0, "反向对照：坏视频源 readyState 停在第 0 级：readyState="+probe.readyState);',
      ' ok(probe.videoWidth===0, "反向对照：坏视频源解不出尺寸：videoWidth="+probe.videoWidth);',
      ' try{ probe.remove(); }catch(e){}',
      ' return out.join("\\n");',
      '})()',
    ].join('\n');
    const rv = await send('Runtime.evaluate', { expression: GOVIDEO_TEST, returnByValue: true, awaitPromise: true });
    goOut = rv.result && rv.result.value ? rv.result.value
      : (rv.exceptionDetails ? 'EVAL异常: ' + JSON.stringify(rv.exceptionDetails).slice(0, 500) : JSON.stringify(rv));
  } catch (e) { goOut = '结算视频测试失败: ' + e.message; }

  // ==========================================================================
  //  兑换码（v4.2 新增）：设置面板输入「17班nb666」→ +3000 金币，一码只能兑一次
  //  视口沿用上一段的 390x844。
  //  ⚠️ 自带两组反向对照：① 非法码 / 表外码永远兑不出来；② 焦点在输入框时
  //     全局键盘（空格跳跃）必须让路，而焦点离开后必须重新接管 —— 否则那条
  //     「空格没被吃掉」的断言就是恒真的。
  // ==========================================================================
  let redeemOut = '';
  try {
    const REDEEM_TEST = [
      '(async function(){',
      ' var g=window.__nailongGame; if(!g) return "[FAIL] 拿不到 game";',
      ' var C=window.__nailongConfig;',
      ' var out=[]; function ok(c,m){out.push((c?"[OK]  ":"[FAIL] ")+m);}',
      ' function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}',
      ' function coins(){ return g.save.data.totalCoins; }',
      ' function codes(){ return g.save.data.codes||{}; }',
      ' function inp(){ return document.getElementById("redeem-input"); }',
      ' function btn(){ return document.getElementById("redeem-btn"); }',
      '',
      ' // ---- A. 契约层 ----',
      ' ok(Array.isArray(C.REDEEM_CODES)&&C.REDEEM_CODES.length>=1, "CONFIG 里有兑换码表：n="+(C.REDEEM_CODES?C.REDEEM_CODES.length:"无"));',
      ' var hit=null; for(var i=0;i<C.REDEEM_CODES.length;i++) if(C.REDEEM_CODES[i].code==="17班nb666") hit=C.REDEEM_CODES[i];',
      ' ok(!!hit, "表里确实有 17班nb666");',
      ' ok(!!hit&&hit.coins===3000, "该码兑 3000 金币：" + (hit?hit.coins:"n/a"));',
      '',
      ' // ---- 铺干净底：清空兑换记录，金币设成 100，便于验证「净增 3000」----',
      ' g._toMenu();',
      ' g.save.data.codes={}; g.save.data.totalCoins=100; g.save.save();',
      ' var earned0=g.save.data.stats.totalCoinsEarned;',
      ' g._openTab("settings"); await sleep(300);',
      ' ok(!g.ui.el.modal.classList.contains("hidden"), "设置弹窗已打开");',
      ' ok(!!inp(), "设置面板里有兑换码输入框 #redeem-input");',
      ' ok(!!btn(), "设置面板里有兑换按钮 #redeem-btn");',
      ' if(!inp()||!btn()){ out.push("[SKIP] 缺输入框/按钮，后面整组跳过"); return out.join("\\n"); }',
      ' ok(g.ui.el.modalBody.contains(btn()), "按钮在 #modal-body 内（事件代理能收到）");',
      ' ok(btn().getAttribute("data-action")==="redeem", "按钮带 data-action=redeem：" + btn().getAttribute("data-action"));',
      ' ok(inp().type==="text", "输入框 type=text：" + inp().type);',
      '',
      ' // ---- B. 非法码：不加钱、不写记录、**不重绘**（玩家输的字要留着好改）----',
      ' var el0=inp();',
      ' el0.value="hello"; btn().click(); await sleep(180);',
      ' ok(coins()===100, "非法码不加金币：" + coins());',
      ' ok(Object.keys(codes()).length===0, "非法码不写兑换记录：" + Object.keys(codes()).length);',
      ' ok(inp()===el0&&inp().value==="hello", "失败时不重绘，输入内容还在：" + JSON.stringify(inp().value));',
      ' ok(/兑换码无效/.test(g.ui.el.toast.textContent), "提示「兑换码无效」：" + g.ui.el.toast.textContent);',
      '',
      ' // ---- C. 空输入 ----',
      ' inp().value=String(); btn().click(); await sleep(180);',
      ' ok(coins()===100, "空输入不加金币：" + coins());',
      ' ok(/请输入兑换码/.test(g.ui.el.toast.textContent), "提示「请输入兑换码」：" + g.ui.el.toast.textContent);',
      '',
      ' // ---- D. 焦点守卫：在输入框里敲空格不能变成跳跃 ----',
      ' inp().focus();',
      ' ok(document.activeElement===inp(), "输入框已聚焦");',
      ' var evSpace=new KeyboardEvent("keydown",{key:" ",code:"Space",bubbles:true,cancelable:true});',
      ' inp().dispatchEvent(evSpace);',
      ' ok(evSpace.defaultPrevented===false, "焦点在输入框时，空格不被全局键盘接管（defaultPrevented=false）");',
      '',
      ' // ---- E. 正确码：带空格 + 全大写，而且走「回车」而不是点按钮 ----',
      ' inp().value="  17班NB666  ";',
      ' inp().dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));',
      ' await sleep(320);',
      ' ok(coins()===3100, "兑换成功净增 3000 金币：" + coins() + "（100 → 3100）");',
      ' var ks=Object.keys(codes());',
      ' ok(ks.length===1, "写入了 1 条兑换记录：" + ks.length);',
      ' ok(ks[0]==="17班nb666", "记录键是规范化后的码：" + ks[0]);',
      ' ok(/3000/.test(g.ui.el.toast.textContent), "提示里带金币数：" + g.ui.el.toast.textContent);',
      ' ok(inp()!==el0, "成功后重绘了面板");',
      ' ok(inp().value.length===0, "成功后输入框被清空");',
      ' ok(g.ui.el.menuCoins.textContent===String(3100), "顶栏金币同步为 3100：" + g.ui.el.menuCoins.textContent);',
      ' ok(g.save.data.stats.totalCoinsEarned===earned0, "不动 totalCoinsEarned（兑换不算跑图收集）：" + g.save.data.stats.totalCoinsEarned + " vs " + earned0);',
      ' ok(/已兑换/.test(g.ui.el.modalBody.innerHTML), "面板下方列出了已兑换的码");',
      '',
      ' // ---- F. 一码只能用一次（换个大小写也不行）----',
      ' inp().value="17班nb666"; btn().click(); await sleep(220);',
      ' ok(coins()===3100, "重复兑不加钱：" + coins());',
      ' ok(Object.keys(codes()).length===1, "重复兑不新增记录：" + Object.keys(codes()).length);',
      ' ok(/已经用过/.test(g.ui.el.toast.textContent), "提示「已经用过」：" + g.ui.el.toast.textContent);',
      ' inp().value="17班NB666"; btn().click(); await sleep(220);',
      ' ok(coins()===3100, "换成全大写也领不到：" + coins());',
      '',
      ' // ---- G. 存档往返：兑换记录必须真的落到 localStorage ----',
      ' var rawTxt=localStorage.getItem("nailong_parkour_save_v2")||String();',
      ' ok(rawTxt.indexOf("17班nb666")>=0, "兑换记录落到了 localStorage");',
      ' var parsed=JSON.parse(rawTxt);',
      ' ok(!!parsed.codes&&parsed.codes["17班nb666"]>0, "存档 codes 里记着这个码");',
      '',
      ' // ---- H. 反向对照一：表外的码永远兑不出来 ----',
      ' g.save.data.codes={}; g.save.save();',
      ' var before2=coins(), el2=inp();',
      ' el2.value="17班nb666x"; btn().click(); await sleep(220);',
      ' ok(coins()===before2&&Object.keys(codes()).length===0, "反向对照：表外的码确实兑不出来（证明上面那组不是恒真）");',
      '',
      ' // ---- I. 反向对照二：焦点离开输入框后，空格必须重新被全局键盘接管 ----',
      ' inp().blur(); await sleep(80);',
      ' var evSpace2=new KeyboardEvent("keydown",{key:" ",code:"Space",bubbles:true,cancelable:true});',
      ' window.dispatchEvent(evSpace2);',
      ' ok(evSpace2.defaultPrevented===true, "反向对照：焦点不在输入框时，空格确实被接管（defaultPrevented=true）");',
      ' return out.join("\\n");',
      '})()',
    ].join('\n');
    const rr = await send('Runtime.evaluate', { expression: REDEEM_TEST, returnByValue: true, awaitPromise: true });
    redeemOut = rr.result && rr.result.value ? rr.result.value
      : (rr.exceptionDetails ? 'EVAL异常: ' + JSON.stringify(rr.exceptionDetails).slice(0, 500) : JSON.stringify(rr));
  } catch (e) { redeemOut = '兑换码测试失败: ' + e.message; }

  // ==========================================================================
  //  双赛季（v4.4）：赛季 UI 必须「冷启动就对」
  //  ⚠️ 这里踩过坑：主界面文案与 <html data-season> 只在 _refresh() 里同步，
  //     而启动路径不调 _refresh() → 累计里程早已过 1 万米的老玩家刷新页面，
  //     看到的还是「阳光漫游」的文案+配色（进度像丢了）。手写探针才发现，故落成常驻断言。
  //  ⚠️ 必须「写存档 + 重载」来测：只在同一个页面里改内存，测不出启动路径这一环。
  // ==========================================================================
  let seasonOut = '';
  try {
    const SEASON_PROBE = [
      '(function(){',
      ' var root=document.documentElement;',
      ' var g=window.__nailongGame;',
      ' var hn=document.querySelector(".hdr-name");',
      ' var rs=getComputedStyle(root);',
      ' var td=g&&g.save&&g.save.data&&g.save.data.stats?g.save.data.stats.totalDistance:"?";',
      ' return "[META] data-season="+root.getAttribute("data-season")',
      '   +" totalDistance="+td',
      '   +" accent="+rs.getPropertyValue("--accent-a").trim()',
      '   +" hdr="+(hn?hn.textContent:"?");',
      '})()',
    ].join('\n');

    async function seasonSnap() {
      const r = await send('Runtime.evaluate', { expression: SEASON_PROBE, returnByValue: true });
      return r.result && r.result.value ? r.result.value
        : (r.exceptionDetails ? 'EVAL异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300) : JSON.stringify(r));
    }
    const readMeta = function (txt) {
      const m = String(txt).match(/\[META\] data-season=(\S+) totalDistance=(\S+) accent=(\S+) hdr=(.*)$/);
      return m ? { ds: m[1], td: m[2], accent: m[3], hdr: m[4] } : null;
    };

    // ---- A. 清空存档 → 重载 → 应停在第 1 赛季「阳光漫游」 ----
    await send('Runtime.evaluate', { expression: 'localStorage.removeItem("nailong_parkour_save_v2"); "cleared"', returnByValue: true });
    await send('Runtime.evaluate', { expression: 'location.reload()' });
    await waitBoot(send, 40);
    const aTxt = await seasonSnap();

    // ---- B. 写入「累计 12000 米」存档 → 重载 → 应整季切到「竹墨松林」 ----
    const SEED_SAVE = 'localStorage.setItem("nailong_parkour_save_v2", JSON.stringify({'
      + 'version:2,best:2600,totalCoins:5000,muted:true,music:false,vibrate:true,quality:"high",'
      + 'skin:"default",skins:["default"],startTheme:0,'
      + 'upgrades:{magnet:0,shield:0,coin:0,headstart:0,luck:0},achv:{},codes:{},scores:[],'
      + 'stats:{runs:30,totalDistance:12000,totalCoinsEarned:6000,powerupsUsed:30,revives:5,bestCombo:44,rushCleared:12}})); "seeded"';
    await send('Runtime.evaluate', { expression: SEED_SAVE, returnByValue: true });
    await send('Runtime.evaluate', { expression: 'location.reload()' });
    await waitBoot(send, 40);
    const bTxt = await seasonSnap();

    const ma = readMeta(aTxt), mb = readMeta(bTxt);
    const lines = [];
    const ok = function (c, m) { lines.push((c ? '[OK]  ' : '[FAIL] ') + m); };
    ok(!!ma, 'A 段（清空存档 + 重载）拿到赛季探针' + (ma ? '' : ' → ' + String(aTxt).slice(0, 200)));
    if (ma) {
      ok(ma.td === '0', '全新存档累计里程为 0：' + ma.td);
      ok(ma.ds === 'sun', '冷启动默认停在第 1 赛季「阳光漫游」：data-season=' + ma.ds);
      ok(ma.hdr.indexOf('阳光漫游') >= 0, '主界面标题是阳光漫游：' + ma.hdr);
    }
    ok(!!mb, 'B 段（写存档 + 重载）拿到赛季探针' + (mb ? '' : ' → ' + String(bTxt).slice(0, 200)));
    if (mb) {
      ok(Number(mb.td) === 12000, '存档里的累计里程确实是 12000：' + mb.td);
      ok(mb.ds === 'ink', '★ 冷启动就切到第 2 赛季「竹墨松林」：data-season=' + mb.ds);
      ok(mb.hdr.indexOf('竹墨松林') >= 0, '主界面标题换成竹墨松林：' + mb.hdr);
      // 反向对照：A/B 两段的主色必须不同 —— 否则说明 data-season 变了但 CSS 前缀没接管
      ok(!!ma && ma.accent !== mb.accent, '两套赛季主色不同（CSS 前缀真接管了）：sun=' + (ma ? ma.accent : '?') + ' ink=' + mb.accent);
      ok(mb.accent.indexOf('8fae86') >= 0, '第 2 赛季主色是竹青 #8fae86：' + mb.accent);
    }
    seasonOut = lines.join('\n');
  } catch (e) { seasonOut = '[FAIL] 双赛季测试失败: ' + e.message; }

  console.log('=== 页面: ' + URL_ + ' ===');
  console.log('--- 捕获到的错误事件 (' + events.length + ') ---');
  console.log(events.length ? events.join('\n') : '(无)');
  console.log('\n--- 模块导入测试 ---');
  console.log(importOut);
  console.log('\n--- 按钮交互测试 ---');
  console.log(clickOut);
  console.log('\n--- 渲染/更新循环测试（开跑 1.2s 后）---');
  console.log(loopOut);
  console.log('\n--- 浮点/小数点显示回归（塞入带长尾小数的存档）---');
  console.log(floatOut);
  console.log('\n--- 新玩法机制（机关 / 冲刺段 / 空中金币 / 防穿模 / 擦身护栏）---');
  console.log(mechOut);
  console.log('\n--- 站上车顶（矮车厢可跳上 / 车顶金币 / 标准车厢仍须变道）---');
  console.log(roofOut);
  console.log('\n--- 背景音乐（真实音频文件 + 反向对照）---');
  console.log(bgmOut);
  console.log('\n--- 结算界面视频（死亡后 #gameover 内嵌 mp4）---');
  console.log(goOut);
  console.log('\n--- 兑换码（17班nb666 → 3000 金币，一码一次）---');
  console.log(redeemOut);
  console.log('\n--- 双赛季（冷启动写存档 + 重载后赛季 UI 是否正确）---');
  console.log(seasonOut);
  console.log('\n--- 角色尺寸测量 ---');
  console.log(sizeOut);
  console.log('\n--- 性能预算（draw call / FPS）---');
  console.log(perfOut);
  console.log('\n--- DOM / 绑定 / 命中探针 ---');
  console.log(probeOut);

  // 汇总：数出 OK / FAIL / SKIP，并且**只有 0 FAIL 才 exit(0)**。
  // 原来无条件 exit(0)，断言失败时 `node check-e2e.cjs && next` 这条链照样往下走 —— 静默假通过。
  const allOut = [clickOut, loopOut, floatOut, mechOut, roofOut, bgmOut, goOut, redeemOut, seasonOut, sizeOut, perfOut, probeOut].join('\n');
  const nOK = (allOut.match(/\[OK\]/g) || []).length;
  const nSkip = (allOut.match(/\[SKIP\]/g) || []).length;
  // ⚠️ 「整段断言蒸发」也必须算失败：只数 [FAIL] 的话，某一段在页面里抛异常（例如生成出来的探针代码有语法错）
  //    会让它的断言一条都不输出，结果 0 FAIL 全绿 —— 本轮就踩到：MECH_TEST 语法错，凭空少了 28 条断言却"通过"。
  const segs = [['按钮交互', clickOut], ['主循环', loopOut], ['显示回归', floatOut], ['新玩法机制', mechOut], ['站上车顶', roofOut], ['背景音乐', bgmOut], ['结算视频', goOut], ['兑换码', redeemOut], ['双赛季', seasonOut], ['角色尺寸', sizeOut]];
  const gone = segs.filter(function (s) { return !/\[OK\]|\[FAIL\]|\[SKIP\]/.test(s[1]); }).map(function (s) { return s[0]; });
  if (!/errors=/.test(probeOut)) gone.push('DOM探针(没输出)');   // 这一段输出的是 xxx=BOUND 转储、本就不带断言，只要求它确实跑到了
  const errs = (allOut.match(/EVAL异常|harness error|测试失败|拿不到/g) || []).length;
  const nFail = (allOut.match(/\[FAIL\]/g) || []).length + gone.length + errs;
  console.log('\n=== 汇总: ' + nOK + ' OK / ' + nFail + ' FAIL / ' + nSkip + ' SKIP ===');
  if (gone.length) console.log('❌ 整段断言消失（该段在页面里抛异常了）: ' + gone.join(' / '));
  if (errs) console.log('❌ 捕获到 ' + errs + ' 处执行异常（EVAL异常 / 测试失败 / 拿不到实例）');
  if (nFail > 0) console.log('❌ 闸门不通过');
ws.close();
  child.kill();
  await sleep(400);
  process.exit(nFail > 0 ? 1 : 0);
})().catch(e => { console.log('harness error: ' + e.message); process.exit(1); });
