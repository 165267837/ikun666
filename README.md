# 🐉 奶龙跑酷 · Milk Dragon Parkour

一个用 **Three.js（r160）** 手写的 3D 无限跑酷小游戏。**纯静态单页**，没有任何后端：
只要能把 `index.html` / `style.css` / `main.js` / `libs/` 放到一个静态服务器上，就能玩。

**🎮 在线试玩：** https://<你的用户名>.github.io/nailong-parkour/

> 手机竖屏就是目标比例（约 9:16），桌面浏览器也能玩。首次进入需要点一下「开始 / 开跑」
> —— 这是浏览器的自动播放策略要求，不是 bug。

![主界面](preview/90-主菜单.png)

## 怎么玩

| 操作 | 键盘 | 触屏 |
| --- | --- | --- |
| 左右变道 | `←` `→` / `A` `D` | 左右滑动 |
| 跳跃 | `↑` / `空格` | 上滑 |
| 滑铲 | `↓` / `S` | 下滑 |
| 暂停 | `Esc` / `P` | 右上角暂停键 |

撞到障碍就结束。沿途有金币、道具（护盾 / 磁铁 / 加速 / 双倍）、连击、冲刺段，
以及皮肤、成就、排行榜和兑换码。

## 8 张地图、两个赛季

跑动中每 **2000 米**换一张地图，按顺序轮换。

| 赛季 | 地图 | 解锁条件 |
| --- | --- | --- |
| 第 1 赛季 · ☀️ 阳光漫游 | 彩虹城市 → 糖果街道 → 游乐园 → 地铁轨道 | 默认开放，逐张按**最高分**解锁（0 / 400 / 1000 / 1800） |
| 第 2 赛季 · 🎋 竹墨松林 | 墨竹初径 → 竹露清风 → 松涛深处 → 竹影夜灯 | **累计跑满 10000 米**整季解锁，之后接在阳光漫游后面一起轮流跑 |

两个赛季各有自己的配色皮肤：解锁竹墨松林后，界面会整体切换成水墨竹青。

**🎋 累计 1 万米解锁后的主界面：**

![竹墨松林](preview/93-主菜单-竹墨松林（累计1万米解锁态）.png)

## 在本地跑

游戏用的是 **ES Module + importmap**，所以**不能直接双击 `index.html`**（`file://` 会被浏览器的
CORS 策略拦掉）。起一个本地静态服务器即可：

```bash
# 方式一：仓库自带的零依赖服务器（需要 Node）
node serve.cjs          # 然后打开 http://127.0.0.1:5188/

# 方式二：装了 Python 的话
python -m http.server 5188
```

## 目录结构

```
index.html          入口：DOM 骨架 + importmap + 显式的 THREE 预加载探针
style.css           全部样式（含两套赛季主题，靠 html[data-season] 切换）
main.js             全部游戏逻辑（建模 / 玩法 / 存档 / UI 渲染）
libs/three.module.js 本地 three.js r160（不依赖 CDN，离线可用）
libs/bgm.m4a        背景音乐
libs/gameover.mp4   结算界面里循环播放的静音短片
serve.cjs           零依赖静态服务器
check-*.cjs         自检闸门（语法 / UI 渲染 / 布局 / 皮肤 / 端到端 / 子路径部署）
shots.cjs           截图 + 几何校验（装饰有没有浮空 / 陷地 / 侵入赛道）
deploy-github.cjs   一键发布到 GitHub Pages
preview/            截图产物
```

> 部署相关的两个脚本：
> `node check-subpath.cjs` 会在本地模拟 `https://<用户名>.github.io/<仓库名>/` 这个**子路径**环境，
> 确认游戏不是只在「网站根目录」下才能跑（绝对路径引用一上线就会 404 白屏，本地 `serve.cjs` 测不出来）。
> `node deploy-github.cjs --check` 只做发布前体检，不写文件不推送。

## 部署到 GitHub Pages

1. 在 GitHub 上新建一个 **public** 仓库，名字建议就叫 `nailong-parkour`（不要勾选任何初始化文件）。
2. 在本目录下执行：

   ```bash
   git init -b main
   git config user.name  "你的名字"
   git config user.email "你的邮箱"
   git add -A
   git commit -m "feat: 奶龙跑酷 3D 无限跑酷游戏"
   git remote add origin https://github.com/<你的用户名>/nailong-parkour.git
   git push -u origin main
   ```

   > 更省事：`node deploy-github.cjs <你的用户名> "你的名字" "你的邮箱"` 一次做完上面全部步骤。

3. 打开仓库的 **Settings → Pages**，把 **Source** 设为 `Deploy from a branch`，
   **Branch** 选 `main` / `/ (root)`，保存。
4. 等 1~2 分钟，访问 **https://<你的用户名>.github.io/nailong-parkour/** 即可。

之后每次改完代码，只要 `git add -A && git commit -m "..." && git push`，Pages 会自动重新发布。
