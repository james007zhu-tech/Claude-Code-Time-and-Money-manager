# 用 Cloudflare 通道发布到 https://finance.zhu.com.ai

应用是纯静态文件，在自己的电脑或服务器上跑一个本机服务器，再用 Cloudflare Tunnel（通道）把
`finance.zhu.com.ai` 转进来。HTTPS 证书由 Cloudflare 提供（摄像头和麦克风要求 HTTPS）。
本机服务器只提供应用文件，不会暴露 `.git`、`tests`、`deploy` 等内部文件。

## 1. 在 Cloudflare 建通道（一次）

1. Cloudflare 后台 → Zero Trust → Networks → Tunnels → Create a tunnel → 选 Cloudflared，起名 `finance`。
2. 复制页面上显示的令牌（安装命令里 `--token` 后面那一长串）。
3. Public Hostname：Subdomain 填 `finance`，Domain 选 `zhu.com.ai`，Service 选 `HTTP`：
   - 用下面的 Docker 方式：URL 填 `web:80`
   - 不用 Docker：URL 填 `localhost:8080`

## 2A. 用 Docker（推荐，开机自动运行）

```bash
cd deploy
cp .env.example .env        # 把令牌填进 .env：TUNNEL_TOKEN=...
docker compose up -d
```

更新应用：`git pull` 之后不用重启（文件是直接挂载进去的）。

## 2B. 不用 Docker

```bash
python3 deploy/serve.py --port 8080          # 本机服务器（只监听 127.0.0.1）
cloudflared service install <令牌>            # 安装 cloudflared 并设为开机启动
```

cloudflared 安装：Mac `brew install cloudflared`；Windows / Linux 从 Cloudflare 官网下载。
`serve.py` 需要一直开着；可以像电脑记录器一样设成开机运行。

## 出现 502 怎么办

502 表示 Cloudflare 连上了通道，但通道后面的本机服务器没回应：

- 确认本机服务器在运行：在那台机器上打开 `http://localhost:8080`（Docker 方式：`docker compose ps`）。
- 确认通道 Public Hostname 里的 Service 地址和端口与实际一致。
- 看 cloudflared 日志：`docker compose logs tunnel`，或 `journalctl -u cloudflared -n 50`。
