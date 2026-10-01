/* serve.cjs — 零依赖本地静态服务器（预览用）
   用法: node serve.cjs  → 打开 http://127.0.0.1:5188/  */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT ? Number(process.env.PORT) : 5188;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  // 背景音乐（libs/bgm.m4a）用的音频类型。MIME 不对时部分浏览器会拒播 <audio>。
  '.m4a': 'audio/mp4', '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[\\/])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('403'); }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('404 Not Found'); }
    const head = {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes',
    };

    // Range 支持：媒体元素（尤其 Safari）在播放与拖动进度条时依赖 206 分段响应，
    // 只回整文件（200）时音频有可能整段播不出来。这里只处理单段 range，够用。
    let start = 0, end = st.size - 1, code = 200;
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
    if (m && (m[1] || m[2])) {
      if (m[1]) {
        start = parseInt(m[1], 10);
        if (m[2]) end = Math.min(parseInt(m[2], 10), st.size - 1);
      } else {
        start = Math.max(0, st.size - parseInt(m[2], 10));
      }
      if (isNaN(start) || start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + st.size });
        return res.end();
      }
      code = 206;
      head['Content-Range'] = 'bytes ' + start + '-' + end + '/' + st.size;
    }
    head['Content-Length'] = end - start + 1;
    res.writeHead(code, head);
    if (req.method === 'HEAD') return res.end();
    const rs = fs.createReadStream(file, { start: start, end: end });
    rs.on('error', () => res.end());
    res.on('close', () => rs.destroy());
    rs.pipe(res);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log('奶龙跑酷 · 预览服务已启动 → http://127.0.0.1:' + PORT + '/');
});
