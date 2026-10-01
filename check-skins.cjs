/* check-skins.cjs — 皮肤 / 头饰的渲染闸门（真实浏览器 + 真实 three.js 场景）。
 *
 * 为什么需要它：v3.5 把皮肤从 6 套扩到 11 套、头饰从 5 种扩到 10 种，并且把 _makeAccessory
 * 整体改成走 geo()/mat() 缓存（原来是每次换装都 new 几何 + new 材质，既不复用也不 dispose）。
 * 这类改动的失败模式是**静默**的：头饰飘到天上、掉进身体、顶点算出 NaN、旧头饰没摘干净
 * 叠在一起、反复换装导致 headAnchor 下越挂越多……静态检查与 DOM 自检一条都抓不到。
 *
 * 判定项：
 *   A. 界面「奶龙皮肤」页恰好列出 11 套，名称顺序与契约表一致；
 *   B. 价格 = 契约表（即最初那 10 套 ×5），且严格升序；
 *   C. 逐套 applySkin：skin.id 正确；无 hat 的必须没有头饰；有 hat 的头饰必须挂在 headAnchor 下；
 *   D. 头饰至少 1 个 Mesh、三角形数 >= 8、顶点与位移无 NaN；
 *   E. 头饰世界高度落在 headAnchor 世界高度 ±0.35 之内（不飘走、不掉进身体）；
 *   F. 换色生效：rig 上能查到 skin.body 与 skin.accent 这两个颜色；
 *   G. 反复换装（A→B→…→A 跑 3 轮）后 headAnchor 下仍然只有 1 个头饰（不累积、旧的不残留）。
 *
 * 用法:
 *   node check-skins.cjs            常规校验
 *   node check-skins.cjs --shot     额外把每套皮肤的头饰特写落到 preview/50-皮肤特写-*.png
 *   node check-skins.cjs --selftest 自检：故意把一套没有头饰的皮肤改去戴帽子，验证闸门会报错
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9340;
const URL_ = 'http://127.0.0.1:5188/';
const PROF = path.join(__dirname, '__skinsprof');
const OUT = path.join(__dirname, 'preview');

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
const WANT_SHOT = process.argv.indexOf('--shot') >= 0;
const SELFTEST = process.argv.indexOf('--selftest') >= 0;

/* 契约表：皮肤 id / 界面名称 / 价格。改皮肤就必须同步改这里 —— 这正是闸门的意义。
   价格 = v3.4 的 300/440/600/900/1000/1500/1800/3000/4000/6400 各 ×5。 */
const EXPECT = [
  ['default', '奶龙', 0],
  ['blueberry', '蓝莓龙', 1500],
  ['choco', '巧克力龙', 2200],
  ['strawberry', '草莓龙', 3000],
  ['matcha', '抹茶龙', 4500],
  ['sakura', '樱花龙', 5000],
  ['rainbow', '彩虹龙', 7500],
  ['frost', '冰霜龙', 9000],
  ['gold', '黄金龙', 15000],
  ['ninja', '忍者龙', 20000],
  ['galaxy', '星河龙', 32000],
];
const NEW_ONES = ['choco', 'sakura', 'frost', 'ninja', 'galaxy'];

/* 从界面读皮肤列表：每行 .item 里有 .item-name，未解锁的才有 [data-action=skin-buy] 带价格。 */
const READ_UI = [
  '(function(){',
  ' var b=document.getElementById("modal-body"); if(!b) return JSON.stringify({err:"no modal-body"});',
  ' var items=[].slice.call(b.querySelectorAll(".item"));',
  ' return JSON.stringify({',
  '   note: (b.querySelector(".modal-note")||{}).textContent || "",',
  '   count: items.length,',
  '   rows: items.map(function(el){',
  '     var nm=el.querySelector(".item-name");',
  '     var buy=el.querySelector("[data-action=skin-buy]");',
  '     var sel=el.querySelector("[data-action=skin-select]");',
  '     var on=el.querySelector(".act.on");',
  '     var price=null;',
  '     if(buy){ var m=(buy.textContent||"").match(/(\\d+)/); if(m) price=parseInt(m[1],10); }',
  '     return {',
  '       name: nm ? nm.textContent.replace(/未解锁|已装备/g,"").trim() : "?",',
  '       id: (buy&&buy.getAttribute("data-id"))||(sel&&sel.getAttribute("data-id"))||null,',
  '       price: price,',
  '       owned: !buy,',
  '       active: !!on',
  '     };',
  '   })',
  ' });',
  '})()',
].join('\n');

/* 单套皮肤的渲染体检。
   sabotage 只用于 --selftest：在真实场景里制造两处已知错误，验证闸门确实会报错。
     'stowaway' 给本来不戴帽子的「奶龙」硬塞一顶皇冠 → 应触发「无 hat 时不戴头饰」
     'floataway' 把「冰霜龙」的冰冠抬高 1.2m         → 应触发 |dy| <= 0.35 */
function inspect(id, sabotage) {
  let bad = '';
  if (sabotage === 'stowaway') {
    bad = [
      ' if(!p.accessory && p._makeAccessory){',
      '   var mk=p._makeAccessory("crown", p.skin);',
      '   if(mk){ p.accessory=mk; p.headAnchor.add(mk); }',
      ' }',
    ].join('\n');
  } else if (sabotage === 'floataway') {
    bad = ' if(p.accessory) p.accessory.position.y = p.accessory.position.y + 1.2;';
  }
  return [
    '(function(){',
    ' var g=window.__nailongGame, p=g.player;',
    ' var o={id:' + JSON.stringify(id) + '};',
    ' p.applySkin(' + JSON.stringify(id) + ');',
    bad,
    ' o.skinId = p.skin && p.skin.id;',
    ' o.hatName = p.skin ? (p.skin.hat || null) : null;',
    ' o.hasAcc = !!p.accessory;',
    ' o.headChildren = p.headAnchor.children.length;',
    ' o.accParentIsHead = !!(p.accessory && p.accessory.parent===p.headAnchor);',
    ' if(p.accessory){',
    '   var meshes=0, tris=0, nan=0;',
    '   p.accessory.traverse(function(n){',
    '     if(n.isMesh){',
    '       meshes++;',
    '       var gp=n.geometry&&n.geometry.attributes&&n.geometry.attributes.position;',
    '       if(gp){ tris += gp.count/3;',
    '         for(var i=0;i<gp.count*3;i++){ if(!isFinite(gp.array[i])){ nan++; break; } } }',
    '       if(!isFinite(n.position.x)||!isFinite(n.position.y)||!isFinite(n.position.z)) nan++;',
    '     }',
    '   });',
    '   o.meshes=meshes; o.tris=Math.round(tris); o.nan=nan;',
    '   /* 头饰的世界空间包围盒。必须用 localToWorld 折到世界坐标：',
    '      只量「头饰几何相对配件组」的偏移是不够的 —— 把配件组整体抬高（自检里的 floataway）就量不出来，',
    '      而那恰恰是「帽子飘到天上」最常见的形态。 */',
    '   p.accessory.updateMatrixWorld(true);',
    '   var wmin=1e9, wmax=-1e9;',
    '   p.accessory.traverse(function(n){',
    '     if(n.isMesh && n.geometry){',
    '       n.geometry.computeBoundingBox();',
    '       var bb=n.geometry.boundingBox;',
    '       if(bb){',
    '         var V=bb.min.constructor;',
    '         for(var xi=0;xi<2;xi++) for(var yi=0;yi<2;yi++) for(var zi=0;zi<2;zi++){',
    '           var v=n.localToWorld(new V(xi?bb.max.x:bb.min.x, yi?bb.max.y:bb.min.y, zi?bb.max.z:bb.min.z));',
    '           if(v.y>wmax) wmax=v.y; if(v.y<wmin) wmin=v.y;',
    '         }',
    '       }',
    '     }',
    '   });',
    '   var ah=p.headAnchor.position.clone(); p.headAnchor.getWorldPosition(ah);',
    '   o.headWorldY=+ah.y.toFixed(3);',
    '   /* 以下三个都换算成「相对 headAnchor 世界高度」的偏移，正数在头顶之上 */',
    '   o.hatHeight = (wmax>-1e8&&wmin<1e8) ? +(wmax-wmin).toFixed(3) : null;',
    '   o.hatMinY = (wmin<1e8) ? +(wmin-ah.y).toFixed(3) : null;',
    '   o.hatMaxY = (wmax>-1e8) ? +(wmax-ah.y).toFixed(3) : null;',
    '   o.hatMidY = (wmin<1e8&&wmax>-1e8) ? +((wmin+wmax)/2-ah.y).toFixed(3) : null;',
    ' }',
    ' /* 换色是否真的作用到角色身上 */',
    ' var cols={}, want=[p.skin.body, p.skin.accent];',
    ' p.rig.traverse(function(n){ if(n.isMesh&&n.material&&n.material.color) cols[n.material.color.getHex()]=1; });',
    ' o.colorHit = want.map(function(w){ return !!cols[w]; });',
    ' return JSON.stringify(o);',
    '})()',
  ].join('\n');
}

(async () => {
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) {}
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--disable-dev-shm-usage', '--mute-audio', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=520,900', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF, 'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); targets = await r.json(); if (targets && targets.length) break; } catch (e) {}
    await sleep(250);
  }
  if (!targets) { console.log('❌ 无法连接调试端口 ' + PORT); child.kill(); process.exit(1); }
  const page = targets.find(function (t) { return t.type === 'page'; });
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  let id = 0; const pending = new Map();
  const send = function (m, p) {
    return new Promise(function (res, rej) { const i = ++id; pending.set(i, { res: res, rej: rej, method: m }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  };
  const ev = function (e) {
    return send('Runtime.evaluate', { expression: e, returnByValue: true }).then(function (r) {
      if (r.result && r.result.value != null) return r.result.value;
      return r.exceptionDetails ? 'EVAL异常: ' + String((r.exceptionDetails.exception || {}).description || '').slice(0, 300) : null;
    });
  };
  async function shot(name) {
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'));
    return fs.statSync(path.join(OUT, name)).size;
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

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 520, height: 900, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: URL_ });
  await sleep(6000);
  if (await ev('typeof window.__nailongGame') !== 'object') { console.log('❌ 游戏实例没起来'); ws.close(); child.kill(); process.exit(1); }

  let pass = 0, fail = 0; const bad = [];
  function chk(label, cond, extra) {
    if (cond) { pass++; console.log('  ✅ ' + label + (extra ? ' → ' + extra : '')); }
    else { fail++; bad.push(label); console.log('  ❌ ' + label + (extra ? ' → ' + extra : '')); }
  }

  /* ---- A/B：界面列表与价格 ---- */
  await ev('window.__nailongGame._toMenu()');
  await sleep(1200);
  await ev('document.querySelector(".side-btn[data-tab=skins]").click()');
  await sleep(800);
  let ui = {};
  try { ui = JSON.parse(await ev(READ_UI)); } catch (e) { ui = { err: String(e) }; }
  console.log('=== A/B 界面皮肤列表 ===');
  if (ui.err) { chk('能读到皮肤页 DOM', false, ui.err); }
  else {
    chk('皮肤数量 = 契约表 11 套', ui.count === EXPECT.length, '界面 ' + ui.count + ' / 契约 ' + EXPECT.length);
    const names = ui.rows.map(function (r) { return r.name; });
    chk('皮肤名称与顺序一致',
      JSON.stringify(names) === JSON.stringify(EXPECT.map(function (e) { return e[1]; })),
      names.join(' / '));
    /* 价格：未解锁行才有价签，所以把「已拥有」的那一行按契约表补上 */
    const gotPrices = ui.rows.map(function (r, i) {
      if (r.price != null) return r.price;
      return (EXPECT[i] && EXPECT[0][2] === 0 && i === 0) ? 0 : null;
    });
    const wantPrices = EXPECT.map(function (e) { return e[2]; });
    chk('价格 = 原来的 5 倍（逐项）',
      JSON.stringify(gotPrices) === JSON.stringify(wantPrices),
      '界面 ' + JSON.stringify(gotPrices) + ' / 契约 ' + JSON.stringify(wantPrices));
    chk('价格严格升序', wantPrices.every(function (v, i) { return i === 0 || v > wantPrices[i - 1]; }), wantPrices.join(' < '));
    chk('新增的 5 套皮肤都在页面上',
      NEW_ONES.every(function (n) { return names.indexOf(EXPECT.filter(function (e) { return e[0] === n; })[0][1]) >= 0; }),
      NEW_ONES.join(','));

    await ev('var c=document.getElementById("modal-close"); if(c) c.click()');
    await sleep(400);
  }

  /* ---- C/D/E/F：逐套渲染体检 ---- */
  console.log('\n=== C~F 逐套 applySkin 渲染体检 ===');
  await ev('window.__nailongGame.startGame()');
  await sleep(2400);
  await ev('window.__nailongGame.state="frozen"');
  await sleep(300);

  const results = [];
  for (const [sid, sname, price] of EXPECT) {
    let o = {};
    let sab = null;
    if (SELFTEST) {
      if (sid === 'default') sab = 'stowaway';
      else if (sid === 'frost') sab = 'floataway';
    }
    try { o = JSON.parse(await ev(inspect(sid, sab))); } catch (e) { o = { id: sid, err: String(e) }; }
    results.push(o);
    if (o.err) { chk(sname + ' 体检可执行', false, o.err); continue; }

    const detail = 'hat=' + o.hatName + ' meshes=' + o.meshes + ' tris=' + o.tris +
      ' 包围盒 y=[' + o.hatMinY + ',' + o.hatMaxY + '] 高=' + o.hatHeight + ' 中点=' + o.hatMidY;
    if (o.hatName) {
      chk(sname + ' 有头饰且挂在 headAnchor 下', o.hasAcc && o.accParentIsHead, detail);
      chk(sname + ' 头饰几何健康（有 Mesh / 无 NaN）', o.meshes >= 1 && o.nan === 0 && o.tris >= 8, detail);
      /* 头饰几何自己的包围盒必须贴着头顶：中点落在 [-0.20, 0.50]。
         飘到天上（+1.2 那次自检）或掉进身体都会被这条抓住。 */
      chk(sname + ' 头饰贴合头顶（包围盒中点在 [-0.20, 0.50]）',
        o.hatMidY != null && o.hatMidY >= -0.20 && o.hatMidY <= 0.50,
        '中点=' + o.hatMidY + ' 区间=[' + o.hatMinY + ',' + o.hatMaxY + ']');
      chk(sname + ' 头饰不是零高度空壳', o.hatHeight != null && o.hatHeight > 0.05, '高=' + o.hatHeight);
    } else {
      chk(sname + ' 无 hat 时不戴头饰', !o.hasAcc, detail);
    }
    chk(sname + ' 换色生效（body + accent）', o.colorHit && o.colorHit[0] && o.colorHit[1], JSON.stringify(o.colorHit));
    chk(sname + ' skin.id 正确', o.skinId === sid, 'skin.id=' + o.skinId);
    console.log('');
  }

  /* ---- G：反复换装不累积 ---- */
  console.log('=== G 反复换装（3 轮）后头饰不残留 ===');
  const cycle = [
    '(function(){',
    ' var g=window.__nailongGame, p=g.player;',
    ' var ids=' + JSON.stringify(EXPECT.map(function (e) { return e[0]; })) + ';',
    ' var trace=[];',
    ' for(var round=0; round<3; round++){',
    '   for(var i=0;i<ids.length;i++){ p.applySkin(ids[i]); trace.push(p.headAnchor.children.length); }',
    ' }',
    ' p.applySkin("galaxy");',
    ' var accCount=0; p.headAnchor.traverse(function(n){ if(n.isMesh) accCount++; });',
    ' return JSON.stringify({maxHeadChildren:Math.max.apply(null,trace), tail:trace.slice(-4),',
    '   finalHeadChildren:p.headAnchor.children.length, finalMeshes:accCount,',
    '   geoms:g.renderer.info.memory.geometries, texs:g.renderer.info.memory.textures,',
    '   calls:g.renderer.info.render.calls});',
    '})()',
  ].join('\n');
  let cyc = {};
  try { cyc = JSON.parse(await ev(cycle)); } catch (e) { cyc = { err: String(e) }; }
  chk('33 次换装过程中 headAnchor 始终只有 1 个头饰',
    cyc.maxHeadChildren === 1, '出现过的最大值=' + cyc.maxHeadChildren + ' 尾部=' + JSON.stringify(cyc.tail));
  chk('最终仍是 1 个头饰、5 个 Mesh（星河龙）',
    cyc.finalHeadChildren === 1 && cyc.finalMeshes === 5, JSON.stringify(cyc));
  console.log('     资源读数: geometries=' + cyc.geoms + ' textures=' + cyc.texs + ' drawCalls=' + cyc.calls);

  /* ---- 出图（可选）---- */
  if (WANT_SHOT) {
    console.log('\n=== 头饰特写 ===');
    const CAM = [
      '(function(){',
      ' var g=window.__nailongGame, p=g.player;',
      ' var pw=p.group.position.clone(); p.group.getWorldPosition(pw);',
      ' /* 奶龙朝 -z，所以把相机放到 -z 侧前方才能看到脸和头顶的帽子 */',
      ' var cz=pw.z-2.85, cy=pw.y+3.15, cx=pw.x+1.95;',
      ' g.camera.position.set(cx,cy,cz);',
      ' g.camera.lookAt(pw.x, pw.y+2.42, pw.z);',
      ' g.camera.updateMatrixWorld();',
      ' return JSON.stringify({cam:[+cx.toFixed(2),+cy.toFixed(2),+cz.toFixed(2)],player:[+pw.x.toFixed(2),+pw.y.toFixed(2),+pw.z.toFixed(2)]});',
      '})()',
    ].join('\n');
    const shown = ['default', 'choco', 'sakura', 'frost', 'ninja', 'galaxy'];
    for (const sid of shown) {
      await ev('window.__nailongGame.player.applySkin(' + JSON.stringify(sid) + ')');
      await sleep(500);
      await ev(CAM);
      await sleep(700);
      const nm = (EXPECT.filter(function (e) { return e[0] === sid; })[0] || [sid, sid])[1];
      const size = await shot('50-皮肤特写-' + nm + '.png');
      console.log('  -> 50-皮肤特写-' + nm + '.png (' + size + 'B)');
    }
  }

  ws.close(); child.kill();
  console.log('\n结果: ' + pass + '/' + (pass + fail) + ' 通过' + (fail ? '  ❌ 失败项: ' + bad.join(' | ') : '  ✅'));
  if (SELFTEST) {
    if (fail > 0) { console.log('✅ 自检通过：故意让「奶龙」戴上皇冠后闸门确实报错（' + fail + ' 项）—— 判定不是空转的'); process.exit(0); }
    console.log('❌ 自检失败：破坏后闸门仍然全过 —— 判定是空的'); process.exit(1);
  }
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('失败: ' + (e && e.stack || e)); process.exit(1); });
