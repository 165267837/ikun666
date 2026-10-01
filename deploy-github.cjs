#!/usr/bin/env node
/**
 * deploy-github.cjs —— 一键把《奶龙跑酷》发布到 GitHub Pages。
 *
 * 用法：
 *   node deploy-github.cjs --check                                        # 只看体检结果，不动任何东西
 *   node deploy-github.cjs <你的GitHub用户名> "提交显示的名字" "提交用的邮箱"
 *
 * 例：
 *   node deploy-github.cjs zhangsan "Zhang San" "zhangsan@example.com"
 *
 * 它做的事（每一步都先自检，失败就停，不会留下半成品）：
 *   1. 找到 git、确认游戏必需的 4 个文件都在
 *   2. 补上 .nojekyll（阻止 GitHub Pages 走 Jekyll 处理）
 *   3. git init（默认分支 main）→ 配置提交身份（只写在本仓库，不动你的全局配置）
 *   4. git add -A → git commit
 *   5. 配 remote origin → git push
 *   6. 打印在线地址与「还差最后一步」的提醒
 *
 * ⚠️ 唯一不能自动做的一步：在仓库 Settings → Pages 里把 Source 设成
 *    「Deploy from a branch / main / (root)」。GitHub 没给免登录的开关接口。
 *
 * 实现说明：全程用**异步 spawn**，不用 execSync / spawnSync。
 * 除了「别塞住事件循环」这条常规理由，还有个实际原因：某些受限环境里
 * spawnSync 会直接 EBUSY（连派生 node 自己都失败），而异步 spawn 正常。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const REPO_NAME = 'ikun666';          // 想换仓库名就改这里
const REQUIRED = ['index.html', 'style.css', 'main.js', 'libs/three.module.js'];

/** 跑一条命令跑不跑得起来 + 拿它的输出（不打印）。 */
function probe(exe, args) {
  return new Promise((resolve) => {
    let p;
    try { p = spawn(exe, args, { encoding: 'utf8' }); } catch (e) { return resolve(null); }
    let out = '';
    p.stdout && p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(null));
    p.on('close', (code) => resolve(code === 0 ? out.trim() : null));
  });
}

/**
 * 找到可用的 git 命令。
 * 为什么不直接写 'git'：Node 在 Windows 上是通过 cmd.exe 派生子进程的，
 * 它只认系统 PATH；Git 装在「便携包 / 非默认路径」时 cmd.exe 里就找不到
 * （本机正是如此：Git Bash 里 which git 有，cmd.exe 里没有）。
 * 所以先试 PATH，再退回到几个常见安装位置。
 */
async function probeGit() {
  for (const c of ['git', 'git.exe']) {
    const v = await probe(c, ['--version']);
    if (v && /git version/i.test(v)) return { cmd: c, ver: v };
  }
  const cands = [];
  if (process.platform === 'win32') {
    cands.push(
      'C:/Program Files/Git/cmd/git.exe',
      'C:/Program Files (x86)/Git/cmd/git.exe',
    );
    if (process.env.LOCALAPPDATA) cands.push(process.env.LOCALAPPDATA + '/Programs/Git/cmd/git.exe');
    if (process.env.ProgramFiles) cands.push(process.env.ProgramFiles + '/Git/cmd/git.exe');
    // 便携版：<base>/<版本>/{cmd,mingw64/bin}/git.exe
    const bases = [
      (process.env.USERPROFILE || '') + '/.workbuddy/binaries/PortableGit/versions',
      (process.env.LOCALAPPDATA || '') + '/Programs/PortableGit/versions',
    ];
    for (const b of bases) {
      try {
        for (const v of fs.readdirSync(b)) {
          cands.push(b + '/' + v + '/cmd/git.exe', b + '/' + v + '/mingw64/bin/git.exe');
        }
      } catch (e) { /* 目录不存在就算了 */ }
    }
  } else {
    cands.push('/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git');
  }
  for (const p of cands) {
    try { if (!fs.statSync(p).isFile()) continue; } catch (e) { continue; }
    const v = await probe(p, ['--version']);
    if (v && /git version/i.test(v)) return { cmd: '"' + p + '"', ver: v };
  }
  return null;
}

let GIT = null;
const g = (a) => GIT.cmd + ' ' + a;

/** 跑一条命令，直接继承终端（能看到 git 的实时输出）。失败就整体停下。 */
function run(cmd) {
  return new Promise((resolve) => {
    console.log('\n$ ' + cmd);
    const p = spawn(cmd, { cwd: ROOT, stdio: 'inherit', shell: true });
    p.on('error', (e) => { console.log('  ↑ 无法执行：' + e.message + '，已停下。'); process.exit(1); });
    p.on('close', (code) => {
      if (code === 0) return resolve();
      console.log('  ↑ 这条命令失败了（退出码 ' + code + '），已停下。');
      process.exit(1);
    });
  });
}
/** 拿一条命令的输出（不打印）。 */
function capture(cmd) {
  return new Promise((resolve) => {
    const p = spawn(cmd, { cwd: ROOT, shell: true });
    let out = '';
    p.stdout && p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(''));
    p.on('close', () => resolve(out.trim()));
  });
}

const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes('--check');
const args = argv.filter((a) => a !== '--check');
const [username, gitName, gitEmail] = args;

let failed = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); failed++; };
const info = (m) => console.log('     ' + m);

(async function main() {
  console.log('\n=== 发布前体检 ===');

  // 1. git 可用？
  GIT = await probeGit();
  if (GIT) ok('找到 git：' + GIT.ver + (GIT.cmd === 'git' ? '（来自 PATH）' : '  →  ' + GIT.cmd));
  else bad('找不到 git —— 先装 Git for Windows：https://git-scm.com/download/win（装完重开终端）');

  // 2. 必需文件齐全？
  REQUIRED.forEach((f) => {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p) && fs.statSync(p).size > 0) ok(f + ' 就位');
    else bad('缺少 ' + f + ' —— 这个文件不能没有');
  });

  // 3. 参数
  if (!CHECK_ONLY) {
    if (!username) bad('没给 GitHub 用户名。用法：node deploy-github.cjs <用户名> "名字" "邮箱"');
    if (!gitName) bad('没给提交显示的名字（第二个参数）');
    if (!gitEmail) bad('没给提交用的邮箱（第三个参数，要和 GitHub 账号一致才好认领贡献）');
  } else {
    info('--check 模式：只体检，不写文件、不提交、不推送。');
  }

  if (failed) {
    console.log('\n❌ 体检没过（' + failed + ' 项），先修上面红色的再跑一次。\n');
    process.exit(1);
  }
  console.log('\n✅ 体检通过');

  if (CHECK_ONLY) {
    console.log('\n接着真正发布，就加三个参数再来一次：');
    console.log('  node deploy-github.cjs <你的GitHub用户名> "你的名字" "你的邮箱"\n');
    process.exit(0);
  }

  // 4. .nojekyll（内容是空的，靠「存在」本身生效）
  const nojekyll = path.join(ROOT, '.nojekyll');
  if (!fs.existsSync(nojekyll)) { fs.writeFileSync(nojekyll, ''); ok('已创建 .nojekyll'); }
  else ok('.nojekyll 已存在');

  // 5. git init / 身份 / 提交
  if (!fs.existsSync(path.join(ROOT, '.git'))) await run(g('init -b main'));
  else ok('已经是 git 仓库，跳过 init');

  await run(g('config user.name "' + String(gitName).replace(/"/g, '') + '"'));
  await run(g('config user.email "' + String(gitEmail).replace(/"/g, '') + '"'));
  info('（只写在本仓库的 .git/config 里，没有动你的全局 git 配置）');

  await run(g('add -A'));
  const staged = await capture(g('diff --cached --numstat'));
  if (!staged) {
    console.log('\n工作区没有任何变化，没有东西可提交 —— 直接去第 6 步。');
  } else {
    console.log('\n本次将提交 ' + staged.split('\n').filter(Boolean).length + ' 个文件。');
    await run(g('commit -m "feat: 奶龙跑酷 3D 无限跑酷游戏"'));
  }

  // 6. remote + push
  const url = 'https://github.com/' + username + '/' + REPO_NAME + '.git';
  const remotes = await capture(g('remote'));
  if (remotes.split(/\s+/).indexOf('origin') >= 0) await run(g('remote set-url origin ' + url));
  else await run(g('remote add origin ' + url));

  info('推送时如果弹出登录窗口，用 GitHub 账号登录即可；');
  info('命令行登录不了的话，改用 Personal Access Token 当密码（Settings → Developer settings → Tokens）。');
  await run(g('push -u origin main'));

  // 7. 收尾提醒
  console.log('\n============================================================');
  console.log('🎉 代码已经推上 GitHub 了！还差最后一步（只能你手动点）：');
  console.log('');
  console.log('   1. 打开 https://github.com/' + username + '/' + REPO_NAME + '/settings/pages');
  console.log('   2. Source 选 “Deploy from a branch”');
  console.log('   3. Branch 选 “main”，目录选 “/ (root)”，点 Save');
  console.log('');
  console.log('   等 1~2 分钟，你的游戏就在这个地址上线了：');
  console.log('   🎮 https://' + username + '.github.io/' + REPO_NAME + '/');
  console.log('');
  console.log('   以后每次改完代码，三条命令即可重新发布：');
  console.log('     git add -A && git commit -m "改了什么" && git push');
  console.log('============================================================\n');
})();
