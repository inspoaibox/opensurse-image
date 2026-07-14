# PicNest 图屿

PicNest 是一个自托管、多用户的图片托管与资产管理系统。它支持粘贴、拖曳和批量选择上传，提供图库、相册、分享链接、用户权限、独立配额、API 密钥，以及可由管理员控制的游客上传。

上传文件保存在本机磁盘，账户和图片元数据保存在 SQLite。系统适合个人、工作室和小团队在自己的服务器上部署。

## 目录

- [主要功能](#主要功能)
- [运行要求](#运行要求)
- [本地开发](#本地开发)
- [Linux 生产部署](#linux-生产部署)
- [环境变量](#环境变量)
- [首次初始化](#首次初始化)
- [Nginx 反向代理](#nginx-反向代理)
- [Caddy 反向代理](#caddy-反向代理)
- [备份与恢复](#备份与恢复)
- [升级](#升级)
- [回滚](#回滚)
- [游客上传](#游客上传)
- [安全建议](#安全建议)
- [API](#api)
- [常见问题](#常见问题)

## 主要功能

- 粘贴、拖曳、单选和批量选择上传
- 登录用户单张最大 20 MB，单次最多 20 张
- 管理员、普通成员两种角色
- 用户级图片、相册、配额和 API 密钥隔离
- 首位用户自动成为管理员，后续账户由管理员创建
- 网格/列表图库、关键词、相册和格式筛选
- 直链、Markdown、HTML、BBCode 一键复制
- 可选游客上传，默认关闭
- 游客图片自动进入管理员的“游客上传”相册
- SQLite 自动建表和增量迁移
- Express 同时提供 API、上传文件和生产前端

## 项目目录

```text
.
├─ deploy/                       # Nginx、Caddy、systemd 示例
├─ public/                       # 前端公共资源和演示图片
├─ server/
│  ├─ data/
│  │  ├─ picnest.db              # SQLite 数据库，首次运行后生成
│  │  └─ .session-secret         # 未显式配置密钥时自动生成
│  ├─ uploads/                   # 用户上传文件
│  └─ index.js                   # Express 服务
├─ src/                          # React 前端
├─ dist/                         # npm run build 生成的生产前端
├─ package.json
└─ README.md
```

必须持久化和备份的内容：

- `server/data/picnest.db`
- `server/uploads/`
- `server/data/.session-secret`，或外部配置的 `PICNEST_SESSION_SECRET`

## 运行要求

- Node.js `20.x` 或 `22.x`，推荐 Node.js 22 LTS
- npm 10 或更高版本
- Linux、macOS 或 Windows
- 生产环境推荐 Linux + systemd + Nginx/Caddy
- 安装原生依赖失败时需要 C/C++ 构建工具

检查环境：

```bash
node --version
npm --version
```

Ubuntu/Debian 可使用 NodeSource 安装 Node.js 22：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential
```

## 本地开发

### Linux/macOS

```bash
git clone <仓库地址> picnest
cd picnest
npm ci
npm run dev
```

### Windows PowerShell

```powershell
git clone <仓库地址> picnest
Set-Location picnest
npm ci
npm run dev
```

开发地址：

- 前端：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:18765`

`npm run dev` 会同时启动 Vite 和 Express。开发模式下不要直接使用 `18765` 查看前端，因为 Express 只会托管已经存在的 `dist`。

## Linux 生产部署

以下示例把程序安装到 `/opt/picnest`，并使用专用系统用户运行。

### 1. 创建用户并下载代码

```bash
sudo useradd --system --home-dir /opt/picnest --shell /usr/sbin/nologin picnest
sudo git clone <仓库地址> /opt/picnest
sudo chown -R picnest:picnest /opt/picnest
cd /opt/picnest
```

如果代码来自压缩包，将其解压到 `/opt/picnest` 后执行同样的 `chown`。

### 2. 安装依赖并构建

```bash
sudo -u picnest npm ci
sudo -u picnest npm run build
```

构建成功后应存在 `/opt/picnest/dist/index.html`。

### 3. 配置生产环境变量

```bash
sudo install -d -m 0755 /etc/picnest
sudo cp /opt/picnest/deploy/picnest.env.example /etc/picnest/picnest.env
sudo chmod 600 /etc/picnest/picnest.env
sudo editor /etc/picnest/picnest.env
```

生成会话密钥：

```bash
openssl rand -hex 48
```

把输出写入 `PICNEST_SESSION_SECRET`。已经投入使用后不要随意更换该密钥，否则所有登录会话会立即失效。

### 4. 安装 systemd 服务

```bash
sudo cp /opt/picnest/deploy/picnest.service.example /etc/systemd/system/picnest.service
sudo systemctl daemon-reload
sudo systemctl enable --now picnest
sudo systemctl status picnest
```

示例服务使用 `/usr/bin/node`。如果 `command -v node` 返回其他路径，请同步修改 `/etc/systemd/system/picnest.service` 中的 `ExecStart`。

查看日志：

```bash
sudo journalctl -u picnest -f
```

检查服务：

```bash
curl http://127.0.0.1:18765/api/health
```

预期返回：

```json
{"status":"ok","service":"PicNest","database":"sqlite"}
```

服务只监听 `127.0.0.1`，不能直接从公网访问。生产环境必须在同一台服务器上使用 Nginx 或 Caddy 反向代理。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `18765` | Express 监听端口，地址固定为 `127.0.0.1` |
| `PICNEST_DB_PATH` | `server/data/picnest.db` | SQLite 数据库路径，生产环境建议使用绝对路径 |
| `PICNEST_SESSION_SECRET` | 自动生成 | JWT 会话签名密钥，生产环境应显式配置并备份 |
| `COOKIE_SECURE` | `false` | HTTPS 反代时必须设为 `true`；纯 HTTP 本地测试保持 `false` |
| `NODE_ENV` | 未设置 | 生产服务建议设为 `production` |

命令行临时配置示例：

```bash
PORT=18765 COOKIE_SECURE=false npm start
```

PowerShell：

```powershell
$env:PORT = "18765"
$env:COOKIE_SECURE = "false"
npm start
```

## 首次初始化

1. 打开部署域名。
2. 页面会显示“创建你的空间”。
3. 创建首个账户，该账户自动成为管理员。
4. 登录后在“成员管理”中创建其他成员。
5. 在“系统设置”中确认游客上传状态，默认关闭。

初始化完成后，公开注册接口会自动关闭。后续用户不能自行注册，只能由管理员创建。

## Nginx 反向代理

### 1. 配置域名

先把域名的 A/AAAA 记录指向服务器，例如 `img.example.com`。

确认 PicNest 正在运行：

```bash
curl http://127.0.0.1:18765/api/health
```

### 2. 安装 Nginx

Ubuntu/Debian：

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

### 3. 安装站点配置

项目提供了 [deploy/nginx.conf.example](deploy/nginx.conf.example)：

```bash
sudo cp /opt/picnest/deploy/nginx.conf.example /etc/nginx/sites-available/picnest
sudo sed -i 's/img.example.com/你的域名/g' /etc/nginx/sites-available/picnest
sudo ln -s /etc/nginx/sites-available/picnest /etc/nginx/sites-enabled/picnest
sudo nginx -t
sudo systemctl reload nginx
```

核心配置如下：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name img.example.com;

    client_max_body_size 420m;

    location / {
        proxy_pass http://127.0.0.1:18765;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
```

`client_max_body_size 420m` 用于覆盖登录用户最多 20 张、每张 20 MB 的批量请求和 multipart 额外开销。可以根据实际需要降低，但不能低于业务允许的请求体大小。

### 4. 配置 HTTPS

使用 Certbot：

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d img.example.com
```

确认 HTTPS 正常后，在 `/etc/picnest/picnest.env` 中设置：

```dotenv
COOKIE_SECURE=true
```

然后重启：

```bash
sudo systemctl restart picnest
```

验证：

```bash
curl https://img.example.com/api/health
```

## Caddy 反向代理

Caddy 会自动申请和续期 HTTPS 证书，适合希望减少证书配置工作的部署。

### 1. 安装配置

项目提供了 [deploy/Caddyfile.example](deploy/Caddyfile.example)。将内容写入 `/etc/caddy/Caddyfile` 并替换域名：

```caddyfile
img.example.com {
    encode zstd gzip

    request_body {
        max_size 420MB
    }

    reverse_proxy 127.0.0.1:18765
}
```

安装示例配置：

```bash
sudo cp /opt/picnest/deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo sed -i 's/img.example.com/你的域名/g' /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

确保服务器防火墙允许 `80/tcp` 和 `443/tcp`，Caddy 将自动处理 HTTPS。

在 `/etc/picnest/picnest.env` 中设置：

```dotenv
COOKIE_SECURE=true
```

然后执行：

```bash
sudo systemctl restart picnest
curl https://img.example.com/api/health
```

Caddy 默认会传递 `X-Forwarded-For` 和 `X-Forwarded-Proto`。PicNest 只信任来自本机回环地址的代理头，因此不要把 Express 端口直接暴露到公网。

## 备份与恢复

### 创建一致性备份

SQLite 使用 WAL 模式。最稳妥的备份方式是短暂停止服务，再同时备份数据库、上传目录和会话密钥。

```bash
sudo install -d -m 0700 /var/backups/picnest
STAMP=$(date +%Y%m%d-%H%M%S)

sudo systemctl stop picnest
sudo tar -C /opt/picnest -czf "/var/backups/picnest/picnest-data-${STAMP}.tar.gz" \
  server/data server/uploads
sudo cp /etc/picnest/picnest.env "/var/backups/picnest/picnest-env-${STAMP}"
sudo systemctl start picnest
```

备份文件应复制到另一台服务器或对象存储。只保存在原服务器磁盘上不能抵御磁盘故障。

### 恢复

```bash
sudo systemctl stop picnest
sudo tar -C /opt/picnest -xzf /var/backups/picnest/picnest-data-YYYYMMDD-HHMMSS.tar.gz
sudo cp /var/backups/picnest/picnest-env-YYYYMMDD-HHMMSS /etc/picnest/picnest.env
sudo chown -R picnest:picnest /opt/picnest/server/data /opt/picnest/server/uploads
sudo chmod 600 /etc/picnest/picnest.env
sudo systemctl start picnest
```

恢复后检查：

```bash
sudo systemctl status picnest
curl http://127.0.0.1:18765/api/health
```

## 升级

数据库迁移会在服务启动时自动执行。升级前必须备份，以便在新版本迁移数据库后仍可回滚。

### Git 部署升级流程

```bash
cd /opt/picnest

# 1. 停止并备份
sudo systemctl stop picnest
STAMP=$(date +%Y%m%d-%H%M%S)
sudo tar -C /opt/picnest -czf "/var/backups/picnest/picnest-data-${STAMP}.tar.gz" \
  server/data server/uploads

# 2. 更新代码和依赖
sudo -u picnest git pull --ff-only
sudo -u picnest npm ci
sudo -u picnest npm run build

# 3. 启动并验证
sudo systemctl start picnest
sudo systemctl status picnest
curl http://127.0.0.1:18765/api/health
```

查看启动迁移或运行错误：

```bash
sudo journalctl -u picnest -n 100 --no-pager
```

### 压缩包部署升级流程

1. 停止服务并按上文备份。
2. 解压新版本到临时目录。
3. 用新版本代码替换 `/opt/picnest` 中的程序文件。
4. 不要覆盖或删除 `server/data/`、`server/uploads/` 和 `/etc/picnest/picnest.env`。
5. 执行 `npm ci` 和 `npm run build`。
6. 修复文件所有者并启动服务。

```bash
sudo chown -R picnest:picnest /opt/picnest
cd /opt/picnest
sudo -u picnest npm ci
sudo -u picnest npm run build
sudo systemctl start picnest
```

不要使用 `npm update` 代替 `npm ci`。`npm ci` 会严格使用项目中的 `package-lock.json`，更适合可重复生产部署。

## 回滚

代码回滚必须和升级前的数据备份配套进行，尤其是在新版本已经修改数据库结构之后。

```bash
sudo systemctl stop picnest
cd /opt/picnest

# 回到之前验证过的版本或标签
sudo -u picnest git checkout <旧版本标签或提交>
sudo -u picnest npm ci
sudo -u picnest npm run build

# 恢复升级前的数据备份
sudo tar -C /opt/picnest -xzf /var/backups/picnest/picnest-data-YYYYMMDD-HHMMSS.tar.gz
sudo chown -R picnest:picnest /opt/picnest/server/data /opt/picnest/server/uploads

sudo systemctl start picnest
curl http://127.0.0.1:18765/api/health
```

## 游客上传

游客上传默认关闭。管理员可以在“系统设置 → 游客上传”中开启或关闭。

开启后的行为：

- 登录首页出现“无需登录，游客上传”入口
- 支持粘贴、拖曳和文件选择
- 单次最多 5 张，单张最大 10 MB
- 仅允许 JPG、PNG、GIF、WebP
- 每个来源每小时最多 10 次提交
- 游客不能浏览图库、相册和用户信息
- 图片进入管理员的“游客上传”相册并显示游客标记

当前游客频率限制保存在进程内存中，服务重启后会重新计数。多实例部署时应在反向代理或 Redis 层增加共享限流。

## 安全建议

- 生产环境始终启用 HTTPS，并设置 `COOKIE_SECURE=true`
- 不要把 `18765` 端口开放到公网
- 仅开放防火墙端口 `80` 和 `443`
- 使用独立的 `picnest` 系统用户运行服务
- 妥善备份 `PICNEST_SESSION_SECRET`，不要提交到 Git
- 保持游客上传默认关闭，仅在确有需要时开启
- 定期备份 SQLite 数据库和上传目录
- 定期升级 Node.js LTS 和项目依赖
- 图片直链按图床用途设计为公开可访问；私密敏感文件不应作为普通图床图片上传
- 登录用户可上传 SVG，公开展示第三方 SVG 前应确认内容可信

## API

会话接口使用 HttpOnly Cookie。自动化工具可以在“开发者”页面创建 Bearer API 密钥：

```bash
curl -X POST https://img.example.com/api/images \
  -H "Authorization: Bearer pn_live_xxx" \
  -F "files=@cover.jpg"
```

主要接口：

| 方法 | 路径 | 权限 | 作用 |
| --- | --- | --- | --- |
| `GET` | `/api/health` | 公开 | 健康检查 |
| `POST` | `/api/auth/register` | 仅首次初始化 | 创建首位管理员 |
| `POST` | `/api/auth/login` | 公开 | 登录 |
| `POST` | `/api/auth/logout` | 会话 | 退出登录 |
| `GET` | `/api/auth/me` | 会话 | 当前用户 |
| `GET` | `/api/public/config` | 公开 | 游客上传开关和限制 |
| `POST` | `/api/public/images` | 游客开关开启 | 游客上传 |
| `GET/POST` | `/api/users` | 管理员 | 查看或创建成员 |
| `PATCH` | `/api/users/:id` | 管理员 | 修改成员角色 |
| `GET/POST` | `/api/images` | 用户/API 密钥 | 图片列表或上传 |
| `PATCH/DELETE` | `/api/images/:id` | 图片所有者 | 修改或删除图片 |
| `POST` | `/api/images/bulk-delete` | 图片所有者 | 批量删除 |
| `GET/POST` | `/api/albums` | 用户/API 密钥 | 相册列表或创建 |
| `GET/POST` | `/api/api-keys` | 用户会话 | 管理 API 密钥 |
| `PATCH` | `/api/settings/guest-upload` | 管理员 | 开关游客上传 |
| `GET` | `/api/stats` | 用户/API 密钥 | 当前用户空间统计 |

## 常见问题

### Nginx 返回 502 Bad Gateway

检查后端：

```bash
sudo systemctl status picnest
sudo journalctl -u picnest -n 100 --no-pager
curl http://127.0.0.1:18765/api/health
```

确认 Nginx 的 `proxy_pass` 是 `http://127.0.0.1:18765`。

### 上传返回 413 Request Entity Too Large

Nginx 检查 `client_max_body_size`，Caddy 检查 `request_body max_size`。修改后验证并重新加载代理配置。

### HTTPS 下反复返回登录页

确认：

- 公网访问确实使用 HTTPS
- `COOKIE_SECURE=true`
- Nginx 传递 `X-Forwarded-Proto $scheme`
- 修改环境变量后已经重启 PicNest

如果只使用 HTTP 测试，必须设置 `COOKIE_SECURE=false`。

### 数据库或上传目录提示 Permission denied

```bash
sudo chown -R picnest:picnest /opt/picnest/server/data /opt/picnest/server/uploads
sudo systemctl restart picnest
```

### better-sqlite3 安装失败

确认 Node.js 版本受支持，并安装构建工具：

```bash
node --version
sudo apt-get install -y build-essential python3
rm -rf node_modules
npm ci
```

### 修改代码后页面没有变化

生产模式需要重新构建前端：

```bash
npm run build
sudo systemctl restart picnest
```

### 如何确认游客上传是否关闭

```bash
curl https://img.example.com/api/public/config
```

返回的 `guestUploadEnabled` 为 `false` 时，游客上传接口会返回 `403`。

## 开发命令

```bash
npm run dev      # 启动 Vite 和 Express 开发服务
npm run build    # TypeScript 检查并构建生产前端
npm start        # 由 Express 托管生产前端和 API
```

## 技术栈

React 19、TypeScript、Vite、Express 5、Multer、SQLite、better-sqlite3、bcrypt、JWT 和 Lucide Icons。
