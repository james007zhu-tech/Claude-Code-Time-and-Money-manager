#!/usr/bin/env python3
"""时间账本 · 本机静态服务器（给 Cloudflare Tunnel 用）

只在本机 127.0.0.1 上提供应用文件，由 cloudflared 把 https://finance.zhu.com.ai 转发进来。
不会对外暴露 .git、tests、deploy 等内部文件。只用 Python 标准库。

    python3 deploy/serve.py            # 默认端口 8080
    python3 deploy/serve.py --port 9000
"""

import argparse
import http.server
import mimetypes
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# 不对外提供的目录和文件
BLOCKED_DIRS = {'tests', 'deploy', 'node_modules', '__pycache__'}
BLOCKED_FILES = {'package.json', 'package-lock.json', 'CNAME'}

mimetypes.add_type('application/manifest+json', '.webmanifest')
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('text/javascript', '.mjs')
mimetypes.add_type('image/svg+xml', '.svg')


class Handler(http.server.SimpleHTTPRequestHandler):
    def _blocked(self):
        # 按解码后的真实文件路径判断（防止 %2Egit 这类编码绕过）
        try:
            rel = Path(self.translate_path(self.path)).resolve().relative_to(ROOT)
        except ValueError:
            return True                                        # 跑出了应用目录
        parts = rel.parts
        if any(p.startswith('.') for p in parts):              # .git、.env 等
            return True
        if parts and parts[0] in BLOCKED_DIRS:
            return True
        return bool(parts) and parts[-1] in BLOCKED_FILES

    def send_head(self):
        if self._blocked():
            self.send_error(404)
            return None
        return super().send_head()

    def end_headers(self):
        path = self.path.split('?', 1)[0]
        # 入口页和 Service Worker 不缓存，保证更新后马上生效；其他文件由 Service Worker 管理
        if path in ('/', '/index.html', '/sw.js', '/manifest.webmanifest'):
            self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 安静运行；需要看访问日志时删掉这行


def main():
    ap = argparse.ArgumentParser(description='时间账本本机服务器（配合 Cloudflare Tunnel）')
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--host', default='127.0.0.1', help='默认只在本机监听；cloudflared 在同一台机器上即可')
    args = ap.parse_args()
    server = http.server.ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(ROOT)))
    print(f'时间账本已在 http://{args.host}:{args.port} 运行（目录 {ROOT}），按 Ctrl+C 停止')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
