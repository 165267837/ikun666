/* check-syntax.cjs — 《奶龙跑酷》语法 / 结构关卡
   用法: node check-syntax.cjs            （检查 main.js）
         node check-syntax.cjs a.js b.js  （检查指定文件）

   为什么不用 `node --check main.js`：
     main.js 是 ES module（含 import）。Node 对 .js 的 `--check` 会因模块检测规则
     **假通过** —— 文件里明明有 `Unexpected token '.'` 它也会返回 0。
     本脚本改用 vm.SourceTextModule 做真正的 ESM 解析，另加一遍定界符平衡扫描，
     能在没有浏览器的情况下把「括号少一个 / 多一个」这类错误定位到行。
   Node 需要 --experimental-vm-modules 才有 SourceTextModule，脚本自己带上了。
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const files = process.argv.slice(2);
if (!files.length) files.push('main.js');

// --- vm.SourceTextModule 需要该 flag；没有就自举重跑一次 ---
if (typeof vm.SourceTextModule !== 'function') {
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', __filename, ...files], {
    stdio: 'inherit', env: Object.assign({}, process.env, { __SYNTAX_BOOTSTRAPPED: '1' }),
  });
  if (r.error) { console.error('自举失败: ' + r.error.message); process.exit(1); }
  process.exit(r.status === null ? 1 : r.status);
}

const OPEN = { '(': ')', '[': ']', '{': '}' };
const CLOSE = { ')': '(', ']': '[', '}': '{' };

// 跳过注释 / 字符串 / 模板串 / 正则，只跟踪定界符
function scanDelims(src) {
  const stack = [];
  let i = 0, line = 1, prev = '';
  let firstBad = null;
  const lines = src.split('\n');
  const at = (n) => lines[n - 1] === undefined ? '' : lines[n - 1].trim().slice(0, 78);

  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '\n') { line++; i++; prev = '\n'; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2; continue;
    }
    if (c === "'" || c === '"') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; if (src[i] === '\n') line++; i++; }
      i++; prev = 's'; continue;
    }
    if (c === '`') {
      i++;
      while (i < src.length && src[i] !== '`') { if (src[i] === '\\') i++; if (src[i] === '\n') line++; i++; }
      i++; prev = 't'; continue;
    }
    // 正则字面量：只在上一个有效字符是运算符 / 分隔符时才可能开始
    if (c === '/' && prev !== 's' && prev !== 't' && prev !== 'r' &&
        /[=(,:;[!&|?{}+\-*%~^<>]/.test(prev || '=')) {
      i++; let cls = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '[') cls = true; else if (d === ']') cls = false;
        else if (d === '/' && !cls) break; else if (d === '\n') line++;
        i++;
      }
      i++; prev = 'r'; continue;
    }
    if (OPEN[c]) { stack.push({ c, line }); i++; prev = c; continue; }
    if (CLOSE[c]) {
      const top = stack.pop();
      if (!top || top.c !== CLOSE[c]) {
        if (!firstBad) firstBad = { line, ch: c, top, txt: at(line) };
        i++; prev = c; continue;
      }
      i++; prev = c; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return { stack, firstBad, at };
}

let bad = 0;
for (const f of files) {
  const p = path.resolve(f);
  if (!fs.existsSync(p)) { console.log('❌ 找不到文件: ' + f); bad++; continue; }
  const src = fs.readFileSync(p, 'utf8');
  const rel = path.basename(p);

  // 1) 定界符平衡（能给出准确行号）
  const { stack, firstBad, at } = scanDelims(src);
  let okDelim = true;
  if (firstBad) {
    okDelim = false;
    console.log('❌ ' + rel + ' 定界符不匹配：第 ' + firstBad.line + ' 行遇到 "' + firstBad.ch +
      '"（栈顶=' + (firstBad.top ? '"' + firstBad.top.c + '" 开于第 ' + firstBad.top.line + ' 行' : '空') + '）');
    console.log('     第 ' + firstBad.line + ' 行: ' + firstBad.txt);
  }
  if (stack.length) {
    okDelim = false;
    console.log('❌ ' + rel + ' 有 ' + stack.length + ' 个未闭合的定界符：');
    for (const o of stack.slice(-8)) console.log('     "' + o.c + '" 开于第 ' + o.line + ' 行 : ' + at(o.line));
  }

  // 2) 真正的 ESM 解析
  let okParse = true, msg = '';
  try { new vm.SourceTextModule(src, { identifier: rel }); }
  catch (e) { okParse = false; msg = e.message; }

  // 3) 兜底：把 import/export 注释掉再按脚本编译，能拿到精确行列 + 代码帧
  if (!okParse) {
    const stripped = src.split('\n')
      .map((l) => (/^\s*(import|export)\b/.test(l) ? '//' + l : l)).join('\n');
    try { new vm.Script(stripped, { filename: rel }); }
    catch (e2) {
      const m = (e2.stack || '').match(new RegExp(path.basename(p) + ':(\\d+)'));
      if (m) {
        const ln = Number(m[1]);
        console.log('❌ ' + rel + ' 语法错误 第 ' + ln + ' 行：' + e2.message);
        console.log('     ' + at(ln));
      } else {
        console.log('❌ ' + rel + ' 语法错误：' + e2.message);
      }
      okParse = false;
    }
  }

  if (okDelim && okParse && !stack.length && !firstBad) {
    console.log('✅ ' + rel + ' 定界符平衡 · ESM 解析通过  (' + src.length + ' 字符)');
  } else {
    if (okDelim && !okParse) console.log('❌ ' + rel + ' 定界符平衡但 ESM 解析失败：' + msg);
    bad++;
  }
}

console.log(bad ? '\n结果: ' + bad + ' 个文件未通过' : '\n结果: 全部通过');
process.exit(bad ? 1 : 0);
