# PicNest 图屿

PicNest 是一个自托管、多用户的图片托管与资产管理系统。它支持粘贴、拖曳和批量选择上传，提供图库、相册、分享链接、用户权限、独立配额、API 密钥，以及可由管理员控制的游客上传。

图片可以保存在本机磁盘、腾讯云 COS、阿里云 OSS、华为云 OBS、WebDAV 或其他 S3 兼容对象存储中；账户、图片索引和加密后的存储配置保存在 SQLite。系统适合个人、工作室和小团队在自己的服务器上部署。

## 目录

- [主要功能](#主要功能)
- [项目目录](#项目目录)
- [运行要求](#运行要求)
- [本地开发](#本地开发)
- [Linux 生产部署](#linux-生产部署)
- [环境变量](#环境变量)
- [存储服务](#存储服务)
- [Nginx 反向代理](#nginx-反向代理)
- [Caddy 反向代理](#caddy-反向代理)
- [首次初始化与验收](#首次初始化与验收)
- [备份与恢复](#备份与恢复)
- [更新与升级](#更新与升级)
- [回滚](#回滚)
- [游客上传](#游客上传)
- [安全建议](#安全建议)
- [API](#api)
- [常见问题](#常见问题)
- [开发命令](#开发命令)

## 主要功能

- 粘贴、拖曳、单选和批量选择上传
- 工作台可选择目标相册，未选择时自动进入用户设置的默认相册
- 登录用户单张最大 20 MB，单次最多 20 张
- 管理员、普通成员两种角色
- 用户级图片、相册、配额、存储策略和 API 密钥隔离，支持为不同客户端创建多把独立密钥
- 管理员可编辑成员资料、角色、密码、存储配额和目标存储服务
- API 密钥调用按月统计次数、成功率、响应耗时和流量
- 首位用户自动成为管理员，后续账户由管理员创建
- 网格/列表图库、关键词、相册和格式筛选
- 直链、Markdown、HTML、BBCode 一键复制
- 上传时提取图片尺寸和完整 EXIF、GPS、XMP、IPTC、ICC 等原始元数据，历史图片首次查看时自动补提取
- Sharp 服务端图片处理：上传类型白名单、格式转换、质量设置、EXIF 自动旋转和元数据清理
- 可选游客上传，默认关闭
- 游客图片自动进入管理员的“游客上传”相册
- 本地、腾讯云 COS、阿里云 OSS、华为云 OBS、WebDAV 和通用 S3 存储
- 存储凭据 AES-256-GCM 加密、写入/删除连接检测和无中断切换
- SQLite 自动建表和增量迁移
- Express 同时提供 API、上传文件和生产前端

## 项目目录

```text
.
├─ deploy/                       # Nginx、Caddy、systemd、PM2 示例
├─ public/                       # 前端公共资源和演示图片
├─ server/
│  ├─ data/
│  │  ├─ picnest.db              # SQLite 数据库，首次运行后生成
│  │  └─ .session-secret         # 未显式配置密钥时自动生成
│  ├─ storage.js                 # 本地、对象存储和 WebDAV 适配器
│  ├─ uploads/                   # 用户上传文件
│  └─ index.js                   # Express 服务
├─ src/                          # React 前端
├─ dist/                         # npm run build 生成的生产前端
├─ package.json
└─ README.md
```

必须持久化和备份的内容：

- `server/data/picnest.db`
- `server/uploads/`，仅本地存储的图片文件
- `server/data/.session-secret`，或外部配置的 `PICNEST_SESSION_SECRET`
- 外部配置的 `PICNEST_STORAGE_SECRET`

远程对象本身还需要使用云厂商或 WebDAV 服务的版本控制、跨区域复制或备份能力单独保护。SQLite 只保存图片索引，不包含远程图片内容。

## 运行要求

- Node.js `20.x` 或 `22.x`，推荐 Node.js 22 LTS
- npm 10 或更高版本
- Linux、macOS 或 Windows
- 浏览器支持当前稳定版 Chrome、Edge、Firefox 和 Safari；自动化界面验收使用本机 Edge/Chrome/Chromium
- 生产环境推荐 Linux + systemd/PM2（二选一）+ Nginx/Caddy
- 安装原生依赖失败时需要 C/C++ 构建工具

检查环境：

```bash
node --version
npm --version
```

Ubuntu/Debian 可先安装部署工具，再使用 NodeSource 安装 Node.js 22：

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates openssl git build-essential python3 rsync
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
npm --version
```

## 本地开发

### Linux/macOS

```bash
git clone https://github.com/inspoaibox/opensurse-image.git picnest
cd picnest
npm ci
npm run dev
```

### Windows PowerShell

```powershell
git clone https://github.com/inspoaibox/opensurse-image.git picnest
Set-Location picnest
npm ci
npm run dev
```

开发地址：

- 前端：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:18765`

`npm run dev` 会同时启动 Vite 和 Express。开发模式下不要直接使用 `18765` 查看前端，因为 Express 只会托管已经存在的 `dist`。

## Linux 生产部署

以下示例面向 Ubuntu/Debian，把程序安装到 `/opt/picnest`，并使用专用系统用户运行。完整顺序为：准备环境、下载代码、构建、配置环境变量、选择 systemd 或 PM2、选择 Nginx 或 Caddy、启用 HTTPS、创建首位管理员。不要在 HTTPS 和反向代理完成前执行首次初始化。

### 1. 准备运行环境

如果尚未完成“运行要求”中的安装，执行：

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates openssl git build-essential python3 rsync
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
npm --version
```

确认 Node.js 为 `20.x` 或 `22.x`，推荐 `22.x`。

### 2. 创建用户并下载代码

```bash
sudo useradd --system --home-dir /opt/picnest --shell /usr/sbin/nologin picnest
sudo git clone https://github.com/inspoaibox/opensurse-image.git /opt/picnest
sudo chown -R picnest:picnest /opt/picnest
cd /opt/picnest
```

如果代码来自压缩包，将其解压到 `/opt/picnest` 后执行同样的 `chown`。

### 3. 安装依赖并构建

```bash
sudo -u picnest npm ci
sudo -u picnest npm run build
```

构建成功后应存在 `/opt/picnest/dist/index.html`。

### 4. 配置生产环境变量

```bash
sudo install -d -m 0755 /etc/picnest
sudo cp /opt/picnest/deploy/picnest.env.example /etc/picnest/picnest.env
sudo chmod 600 /etc/picnest/picnest.env
sudo editor /etc/picnest/picnest.env
```

分别生成会话密钥和存储凭据加密密钥：

```bash
openssl rand -hex 48
openssl rand -hex 48
```

把两次输出分别写入 `PICNEST_SESSION_SECRET` 和 `PICNEST_STORAGE_SECRET`，并把 `PICNEST_PUBLIC_URL` 中的 `img.example.com` 替换为实际域名。计划通过 HTTPS 对外服务时保持 `COOKIE_SECURE=true`；仅进行纯 HTTP 内网测试时才设为 `false`。

至少检查以下值，不能保留示例密钥或示例域名：

```dotenv
PORT=18765
PICNEST_SESSION_SECRET=第一次生成的随机值
PICNEST_STORAGE_SECRET=第二次生成的随机值
PICNEST_DB_PATH=/opt/picnest/server/data/picnest.db
PICNEST_PUBLIC_URL=https://你的实际域名
COOKIE_SECURE=true
```

已经投入使用后不要随意更换会话密钥，否则所有登录会话会立即失效；不要更换存储加密密钥，否则已经保存的云存储、WebDAV 凭据和可查看 API 密钥将无法解密。

### 5. 选择进程管理方式

systemd 和 PM2 只选择一个。不要同时启用 `picnest.service` 和 PM2 的 `picnest` 进程，否则第二个进程会因为端口已被占用而不断重启。

- systemd：Linux 原生、依赖更少，并可使用 `ProtectSystem`、`NoNewPrivileges` 等服务隔离，适合追求最小运行依赖的服务器。
- PM2：提供统一的进程列表、日志、重启、开机恢复和 Node 项目更新操作，适合更熟悉 Node.js 运维的用户。

#### 方案 A：systemd

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

#### 方案 B：PM2

全局安装 PM2，并把 PM2 配置复制到 `/etc/picnest`：

```bash
sudo npm install -g pm2
sudo cp /opt/picnest/deploy/ecosystem.config.cjs.example /etc/picnest/ecosystem.config.cjs
sudo chown root:picnest /etc/picnest/picnest.env /etc/picnest/ecosystem.config.cjs
sudo chmod 640 /etc/picnest/picnest.env /etc/picnest/ecosystem.config.cjs
```

启动 PicNest，保存进程列表并安装 PM2 的 systemd 开机恢复服务：

```bash
sudo -u picnest -H pm2 start /etc/picnest/ecosystem.config.cjs
sudo -u picnest -H pm2 save
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u picnest --hp /opt/picnest
sudo systemctl enable --now pm2-picnest
```

这里的 `pm2-picnest.service` 只负责服务器重启后恢复 PM2 已保存的进程列表；PicNest 的启动、停止、日志和重载仍由 PM2 管理，不要再启用 `picnest.service`。

检查进程、日志和健康状态：

```bash
sudo -u picnest -H pm2 status
sudo -u picnest -H pm2 logs picnest --lines 100
curl http://127.0.0.1:18765/api/health
```

PM2 模板会在启动时读取 `/etc/picnest/picnest.env`，无需重复填写密钥。当前部署应保持 `instances: 1`；不要直接启用 cluster 多实例，因为游客频率限制保存在进程内存中，多实例部署需要先接入共享限流。

PM2 模板默认使用 `/usr/bin/node`。如果 `command -v node` 返回其他路径，请同步修改 `/etc/picnest/ecosystem.config.cjs` 中的 `interpreter`；使用 NVM 安装 Node.js 时，还要确保该路径不会随着 Node.js 版本切换而失效。

升级、环境变量修改和回滚命令见“[更新与升级](#更新与升级)”与“[回滚](#回滚)”。

### 6. 选择反向代理并完成初始化

- 使用 Nginx：继续执行“[Nginx 反向代理](#nginx-反向代理)”全部步骤。
- 使用 Caddy：继续执行“[Caddy 反向代理](#caddy-反向代理)”全部步骤。
- 两者只需选择一个，不要让 Nginx 和 Caddy 同时监听 `80`、`443` 端口。

代理和 HTTPS 验证完成后，再执行“[首次初始化与验收](#首次初始化与验收)”。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `18765` | Express 监听端口，地址固定为 `127.0.0.1` |
| `PICNEST_DB_PATH` | `server/data/picnest.db` | SQLite 数据库路径，生产环境建议使用绝对路径 |
| `PICNEST_SESSION_SECRET` | 开发环境自动生成 | JWT 会话签名密钥；`NODE_ENV=production` 时必须显式配置至少 32 个字符并备份 |
| `PICNEST_STORAGE_SECRET` | 开发环境使用会话密钥 | 云存储、WebDAV 凭据和可查看 API 密钥的加密密钥；生产环境必须独立配置至少 32 个字符，投入使用后不可更换 |
| `PICNEST_API_MONTHLY_LIMIT` | `50000` | 每位用户的月度 API 密钥调用额度，达到上限后返回 `429` |
| `PICNEST_PUBLIC_URL` | 开发环境根据请求识别 | 对外访问根地址，例如 `https://img.example.com`；生产环境必须配置有效的 HTTPS 地址 |
| `COOKIE_SECURE` | `false` | `NODE_ENV=production` 时必须设为 `true`；纯 HTTP 本地测试保持 `false` |
| `NODE_ENV` | 未设置 | 生产服务建议设为 `production` |

生产模式会在启动时校验两个密钥、HTTPS 公网地址和安全 Cookie；缺失、长度不足或仍是示例值时会拒绝启动，避免带着不安全默认值上线。

生产部署统一在 `/etc/picnest/picnest.env` 中设置 `PORT`。如果把 `18765` 改成其他端口，必须同时修改所选 Nginx 配置的 `proxy_pass` 或 Caddy 配置的 `reverse_proxy`；本地开发还需要同步修改 `vite.config.ts` 中的两个代理地址。

使用 systemd 示例时，建议保留 `PICNEST_DB_PATH=/opt/picnest/server/data/picnest.db`。如果改到 `/var/lib/picnest` 等其他目录，必须先创建目录并授予 `picnest` 用户写权限，同时把该目录加入 `/etc/systemd/system/picnest.service` 的 `ReadWritePaths`，并调整备份与恢复命令。否则服务会因为目录不存在或 systemd 写入限制而启动失败。

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

## 存储服务

管理员可以在“系统设置 → 存储与域名 → 存储服务”添加和管理存储。普通成员可以看到当前存储状态，但不能新增、编辑、检测、切换或删除配置。

### 切换规则

- 系统始终保留不可删除的“本地文件系统”配置。
- “设为当前”会写入、读取并删除一个很小的检测对象，确认上传、浏览和删除权限都正常后才完成切换。
- 未指定用户存储策略时，登录用户、API 密钥上传和开启后的游客上传都会使用系统当前存储。
- 管理员可以在“成员管理”中把某位用户固定到指定存储服务；用户策略优先于系统当前存储。
- 切换只影响新上传，历史图片仍保存在原存储；每张图片会记录自己的存储服务和对象键。
- 删除历史图片时，系统会使用该图片对应的原存储配置删除对象。
- 仍被图片引用、分配给用户、正在使用或属于本地文件系统的存储配置不能删除。

### 用户配额与存储策略

管理员可以在“成员管理”中点击成员行末尾的编辑按钮，维护昵称、登录邮箱、可选新密码、角色、存储配额和存储策略。配额以 GB 输入，不能低于该用户当前已经占用的空间；选择“跟随系统当前存储”时会随全局存储切换，选择具体存储服务时则固定使用该服务进行后续上传。

### 腾讯云 COS

在腾讯云控制台创建 Bucket 和子账号密钥，然后填写：

| 字段 | 示例 |
| --- | --- |
| Region | `ap-guangzhou` |
| Bucket | `picnest-1250000000`，必须包含 AppId 后缀 |
| Endpoint | 通常留空，系统生成 `https://cos.ap-guangzhou.myqcloud.com` |
| 内网读写 | PicNest 部署在腾讯云同地域时开启，自动使用 `https://cos-internal.ap-guangzhou.tencentcos.cn` |
| AccessKey ID / SecretKey | 腾讯云 SecretId / SecretKey |

### 阿里云 OSS

阿里云通过 S3 兼容接口接入。Region 使用 OSS 地域 ID，不要填写中文地域名：

| 字段 | 示例 |
| --- | --- |
| Region | `cn-hangzhou` |
| Bucket | `picnest-images` |
| Endpoint | 通常留空，系统生成 `https://s3.oss-cn-hangzhou.aliyuncs.com` |
| 内网读写 | PicNest 部署在阿里云同地域时开启，自动使用 `https://s3.oss-cn-hangzhou-internal.aliyuncs.com` |
| AccessKey ID / SecretKey | RAM 用户 AccessKey ID / AccessKey Secret |

### 华为云 OBS

| 字段 | 示例 |
| --- | --- |
| Region | `cn-north-4` |
| Bucket | `picnest-images` |
| Endpoint | 通常留空；需要内网访问时填写 OBS 控制台为当前区域提供的内网 Endpoint |
| AccessKey ID / SecretKey | IAM 用户 AK / SK |

### WebDAV

“WebDAV 服务地址”是 PicNest 执行 `MKCOL`、`PUT`、`GET` 和 `DELETE` 的地址，可以包含已有的用户目录。WebDAV 可以保持私有，访客不会直接连接 WebDAV。

### 通用 S3

填写服务商提供的 Region、Endpoint、Bucket 和 S3 访问密钥。Endpoint 可以使用云厂商提供的内网地址；MinIO 等需要路径式 Bucket 地址的服务应勾选“使用 Path-style Bucket 地址”。对象路径前缀可用于把 PicNest 文件限制在 Bucket 的一个目录中，例如 `picnest/images`。

### 内网 Endpoint 与流量

- 腾讯云 COS 和阿里云 OSS 可以勾选“使用同地域内网 Endpoint”；手动填写 Endpoint 时，手动地址优先。
- 华为云 OBS 和通用 S3 可以在“服务端 Endpoint”中填写控制台提供的内网地址。不同区域的内网域名可能不同，系统不会猜测华为云或第三方服务商的专用地址。
- 内网 Endpoint 用于 PicNest 服务端执行上传、读取、连接检测和删除。图片直链统一指向 PicNest 的 `/media/:id`，访客不会直接连接对象存储。
- 只有 PicNest 服务器与 Bucket 位于同一云厂商的同地域网络，并且内网 DNS、路由和安全策略可达时，服务端传输才不会走公网。跨云、跨地域或本地电脑部署通常无法使用该内网地址。
- 请求链路为“访客 → PicNest/Nginx/CDN → PicNest 服务端 → 对象存储内网 Endpoint”。对象存储不产生面向访客的公网下行，但 PicNest 服务器、负载均衡或前置 CDN 会承担对访客的公网下行流量。
- 图片响应带有一年不可变缓存头，适合由浏览器、Nginx 或前置 CDN 缓存。未配置缓存层时，每次未命中浏览器缓存的访问都会由 PicNest 服务端读取并转发原图。

### 私有存储和最小权限

Bucket 和 WebDAV 可以保持私有，访客只访问 PicNest 生成的图片地址。存储密钥至少需要指定 Bucket 或路径前缀下的读取、写入和删除权限；连接检测不会修改 Bucket 权限，也不会把 Bucket 自动设为公开。

保存的 AccessKey、SecretKey 和 WebDAV 密码使用 AES-256-GCM 加密后写入 SQLite，API 和页面不会返回明文密钥。编辑配置时将密钥字段留空即可保留原密钥。

## Nginx 反向代理

### 1. 配置域名

先把域名的 A/AAAA 记录指向服务器，例如 `img.example.com`。

如果服务器启用了 UFW，允许 Web 端口：

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

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
DOMAIN=img.example.com
sudo cp /opt/picnest/deploy/nginx.conf.example /etc/nginx/sites-available/picnest
sudo sed -i "s/img.example.com/${DOMAIN}/g" /etc/nginx/sites-available/picnest
sudo ln -sfn /etc/nginx/sites-available/picnest /etc/nginx/sites-enabled/picnest
sudo nginx -t
sudo systemctl reload nginx
```

把 `DOMAIN` 改成实际域名。如果 `/etc/picnest/picnest.env` 中的 `PORT` 不是 `18765`，还要同步修改配置中的 `proxy_pass`。不要修改为公网 IP，Express 只监听本机回环地址。

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
DOMAIN=img.example.com
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d "${DOMAIN}"
```

把 `DOMAIN` 改成与 Nginx 配置相同的实际域名。

确认 HTTPS 正常后，在 `/etc/picnest/picnest.env` 中设置：

```dotenv
PICNEST_PUBLIC_URL=https://img.example.com
COOKIE_SECURE=true
```

这里必须使用实际域名，不能保留 `img.example.com`。然后按所选进程管理器重启 PicNest。

systemd：

```bash
sudo systemctl restart picnest
```

PM2：

```bash
sudo -u picnest -H pm2 restart /etc/picnest/ecosystem.config.cjs --only picnest --update-env
sudo -u picnest -H pm2 save
```

验证：

```bash
curl https://img.example.com/api/health
curl https://img.example.com/api/public/config
```

两个请求成功后再进行首次初始化。

## Caddy 反向代理

Caddy 会自动申请和续期 HTTPS 证书，适合希望减少证书配置工作的部署。

开始前先把域名的 A/AAAA 记录指向服务器，并确认 `80/tcp`、`443/tcp` 可从公网访问。使用 UFW 时执行：

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

### 1. 安装 Caddy

Ubuntu/Debian 使用 Caddy 官方软件源安装当前稳定版：

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy
caddy version
```

### 2. 安装站点配置

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
DOMAIN=img.example.com
sudo cp /opt/picnest/deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo sed -i "s/img.example.com/${DOMAIN}/g" /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

把 `DOMAIN` 改成实际域名。如果 `/etc/picnest/picnest.env` 中的 `PORT` 不是 `18765`，还要同步修改配置中的 `reverse_proxy`。

确保服务器防火墙允许 `80/tcp` 和 `443/tcp`，Caddy 将自动处理 HTTPS。

在 `/etc/picnest/picnest.env` 中设置：

```dotenv
PICNEST_PUBLIC_URL=https://img.example.com
COOKIE_SECURE=true
```

这里必须使用实际域名。然后按所选进程管理器重启 PicNest。

systemd：

```bash
sudo systemctl restart picnest
```

PM2：

```bash
sudo -u picnest -H pm2 restart /etc/picnest/ecosystem.config.cjs --only picnest --update-env
sudo -u picnest -H pm2 save
```

最后验证：

```bash
curl https://img.example.com/api/health
curl https://img.example.com/api/public/config
```

Caddy 默认会传递 `X-Forwarded-For` 和 `X-Forwarded-Proto`。PicNest 只信任来自本机回环地址的代理头，因此不要把 Express 端口直接暴露到公网。

## 首次初始化与验收

完成 systemd 或 PM2、Nginx/Caddy、DNS 和 HTTPS 配置后，再执行以下步骤：

1. 打开 `https://你的实际域名`，确认页面显示“创建你的空间”。
2. 创建首个账户；该账户自动成为管理员，公开注册接口随后自动关闭。
3. 登录后打开“系统设置”，确认存储服务、上传类型白名单和游客上传状态；游客上传默认关闭。
4. 上传一张测试图片，确认缩略图可以打开，直链、Markdown、HTML 和 BBCode 地址均使用实际公网域名。
5. 打开“成员管理”创建普通成员，并按需要设置配额和存储策略。
6. 打开“开发者”创建测试 API 密钥，按页面文档执行一次上传，再删除不再使用的测试密钥。

服务端验收命令：

```bash
curl https://你的实际域名/api/health
curl https://你的实际域名/api/public/config
```

使用 systemd 时查看：

```bash
sudo systemctl status picnest --no-pager
sudo journalctl -u picnest -n 50 --no-pager
```

使用 PM2 时查看：

```bash
sudo -u picnest -H pm2 status
sudo -u picnest -H pm2 logs picnest --lines 50
```

健康接口应返回 `"status":"ok"`。如果浏览器反复回到登录页，优先检查 `COOKIE_SECURE=true`、`PICNEST_PUBLIC_URL` 和代理传递的 `X-Forwarded-Proto`。

## 备份与恢复

### 创建一致性备份

SQLite 使用 WAL 模式。最稳妥的备份方式是短暂停止服务，再同时备份数据库、上传目录和会话密钥。

以下命令假设 `PICNEST_DB_PATH=/opt/picnest/server/data/picnest.db`。如果数据库放在其他目录，必须把实际数据库文件及其 `-wal`、`-shm` 文件所在目录一并纳入备份和恢复；服务停止后通常不会残留 WAL 内容，但仍应备份整个数据库目录。

```bash
PROCESS_MANAGER=systemd # 使用 PM2 时改为 pm2
sudo install -d -m 0700 /var/backups/picnest
STAMP=$(date +%Y%m%d-%H%M%S)

if [ "${PROCESS_MANAGER}" = "pm2" ]; then
  sudo -u picnest -H pm2 stop picnest
else
  sudo systemctl stop picnest
fi
sudo tar -C /opt/picnest -czf "/var/backups/picnest/picnest-data-${STAMP}.tar.gz" \
  server/data server/uploads
sudo cp /etc/picnest/picnest.env "/var/backups/picnest/picnest-env-${STAMP}"
if [ -f /etc/systemd/system/picnest.service ]; then
  sudo cp /etc/systemd/system/picnest.service \
    "/var/backups/picnest/picnest-service-${STAMP}"
fi
if [ -f /etc/picnest/ecosystem.config.cjs ]; then
  sudo cp /etc/picnest/ecosystem.config.cjs \
    "/var/backups/picnest/picnest-ecosystem-${STAMP}.config.cjs"
fi
if [ "${PROCESS_MANAGER}" = "pm2" ]; then
  sudo -u picnest -H pm2 restart /etc/picnest/ecosystem.config.cjs --only picnest --update-env
else
  sudo systemctl start picnest
fi
```

备份文件应复制到另一台服务器或对象存储。只保存在原服务器磁盘上不能抵御磁盘故障。使用远程存储时，还需要按照厂商方案备份 Bucket/WebDAV 文件；备份 SQLite 和本地上传目录不会下载远程对象。

### 恢复

```bash
PROCESS_MANAGER=systemd # 使用 PM2 时改为 pm2
if [ "${PROCESS_MANAGER}" = "pm2" ]; then
  sudo -u picnest -H pm2 stop picnest
else
  sudo systemctl stop picnest
fi
sudo tar -C /opt/picnest -xzf /var/backups/picnest/picnest-data-YYYYMMDD-HHMMSS.tar.gz
sudo cp /var/backups/picnest/picnest-env-YYYYMMDD-HHMMSS /etc/picnest/picnest.env
if [ -f /var/backups/picnest/picnest-service-YYYYMMDD-HHMMSS ]; then
  sudo cp /var/backups/picnest/picnest-service-YYYYMMDD-HHMMSS \
    /etc/systemd/system/picnest.service
fi
if [ -f /var/backups/picnest/picnest-ecosystem-YYYYMMDD-HHMMSS.config.cjs ]; then
  sudo cp /var/backups/picnest/picnest-ecosystem-YYYYMMDD-HHMMSS.config.cjs \
    /etc/picnest/ecosystem.config.cjs
fi
sudo chown -R picnest:picnest /opt/picnest/server/data /opt/picnest/server/uploads
if [ "${PROCESS_MANAGER}" = "pm2" ]; then
  sudo chown root:picnest /etc/picnest/picnest.env /etc/picnest/ecosystem.config.cjs
  sudo chmod 640 /etc/picnest/picnest.env /etc/picnest/ecosystem.config.cjs
  sudo -u picnest -H pm2 restart /etc/picnest/ecosystem.config.cjs --only picnest --update-env
  sudo -u picnest -H pm2 save
else
  sudo chown root:root /etc/picnest/picnest.env /etc/systemd/system/picnest.service
  sudo chmod 600 /etc/picnest/picnest.env
  sudo chmod 644 /etc/systemd/system/picnest.service
  sudo systemctl daemon-reload
  sudo systemctl start picnest
fi
```

恢复后检查：

```bash
curl http://127.0.0.1:18765/api/health
```

systemd 查看 `sudo systemctl status picnest --no-pager`；PM2 查看 `sudo -u picnest -H pm2 status`。

## 更新与升级

数据库迁移会在服务启动时自动执行。升级前必须备份，以便在新版本迁移数据库后仍可回滚。

### Git 部署：systemd 更新流程

```bash
cd /opt/picnest

# 1. 停止并备份
sudo systemctl stop picnest
STAMP=$(date +%Y%m%d-%H%M%S)
sudo install -d -m 0700 /var/backups/picnest
sudo tar -C /opt/picnest -czf "/var/backups/picnest/picnest-data-${STAMP}.tar.gz" \
  server/data server/uploads
sudo cp /etc/picnest/picnest.env "/var/backups/picnest/picnest-env-${STAMP}"
sudo cp /etc/systemd/system/picnest.service \
  "/var/backups/picnest/picnest-service-${STAMP}"

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

### Git 部署：PM2 更新流程

```bash
cd /opt/picnest

# 1. 停止并备份
sudo -u picnest -H pm2 stop picnest
STAMP=$(date +%Y%m%d-%H%M%S)
sudo install -d -m 0700 /var/backups/picnest
sudo tar -C /opt/picnest -czf "/var/backups/picnest/picnest-data-${STAMP}.tar.gz" \
  server/data server/uploads
sudo cp /etc/picnest/picnest.env "/var/backups/picnest/picnest-env-${STAMP}"
sudo cp /etc/picnest/ecosystem.config.cjs \
  "/var/backups/picnest/picnest-ecosystem-${STAMP}.config.cjs"

# 2. 更新代码、依赖和前端
sudo -u picnest git pull --ff-only
sudo -u picnest npm ci
sudo -u picnest npm run build

# 3. 重新读取 ecosystem 和环境变量，再启动
sudo -u picnest -H pm2 restart /etc/picnest/ecosystem.config.cjs --only picnest --update-env
sudo -u picnest -H pm2 save
sudo -u picnest -H pm2 status
curl http://127.0.0.1:18765/api/health
```

查看运行错误：

```bash
sudo -u picnest -H pm2 logs picnest --lines 100
```

需要升级 PM2 自身时单独执行，应用代码更新并不会自动升级全局 PM2：

```bash
sudo npm install -g pm2@latest
sudo -u picnest -H pm2 update
sudo -u picnest -H pm2 save
```

### 修改环境变量

环境变量统一保存在 `/etc/picnest/picnest.env`。修改后按当前进程管理器重新加载：

```bash
sudo editor /etc/picnest/picnest.env
```

systemd 使用 `sudo systemctl restart picnest`。PM2 使用：

```bash
sudo -u picnest -H pm2 restart /etc/picnest/ecosystem.config.cjs --only picnest --update-env
sudo -u picnest -H pm2 save
```

### 更新部署配置

`git pull` 只更新 `/opt/picnest` 中的示例文件，不会覆盖 `/etc` 下正在使用的生产配置。升级后检查当前进程管理器对应的模板差异。

systemd：

```bash
sudo diff -u /etc/systemd/system/picnest.service \
  /opt/picnest/deploy/picnest.service.example || true
```

PM2：

```bash
sudo diff -u /etc/picnest/ecosystem.config.cjs \
  /opt/picnest/deploy/ecosystem.config.cjs.example || true
```

若新版本确实修改了模板，应手动合并差异，保留本机路径和权限设置，然后重新加载。

systemd：

```bash
sudo editor /etc/systemd/system/picnest.service
sudo systemctl daemon-reload
sudo systemctl restart picnest
```

PM2：

```bash
sudo editor /etc/picnest/ecosystem.config.cjs
sudo chown root:picnest /etc/picnest/ecosystem.config.cjs
sudo chmod 640 /etc/picnest/ecosystem.config.cjs
sudo -u picnest -H pm2 startOrReload /etc/picnest/ecosystem.config.cjs --only picnest --update-env
sudo -u picnest -H pm2 save
```

### 压缩包部署升级流程

1. 停止服务并按上文备份。
2. 把新版本解压到临时目录，确认该目录根部存在 `package.json`。
3. 使用 `rsync` 更新程序文件，并明确排除 `server/data/`、`server/uploads/` 和 `.git/`。
4. 执行 `npm ci` 和 `npm run build`。
5. 修复文件所有者并启动服务。

```bash
NEW_RELEASE=/tmp/picnest-release
PROCESS_MANAGER=systemd # 使用 PM2 时改为 pm2
test -f "${NEW_RELEASE}/package.json"

if [ "${PROCESS_MANAGER}" = "pm2" ]; then
  sudo -u picnest -H pm2 stop picnest
else
  sudo systemctl stop picnest
fi
STAMP=$(date +%Y%m%d-%H%M%S)
sudo install -d -m 0700 /var/backups/picnest
sudo tar -C /opt/picnest -czf "/var/backups/picnest/picnest-data-${STAMP}.tar.gz" \
  server/data server/uploads
sudo cp /etc/picnest/picnest.env "/var/backups/picnest/picnest-env-${STAMP}"
if [ -f /etc/systemd/system/picnest.service ]; then
  sudo cp /etc/systemd/system/picnest.service \
    "/var/backups/picnest/picnest-service-${STAMP}"
fi
if [ -f /etc/picnest/ecosystem.config.cjs ]; then
  sudo cp /etc/picnest/ecosystem.config.cjs \
    "/var/backups/picnest/picnest-ecosystem-${STAMP}.config.cjs"
fi

sudo rsync -a --delete \
  --exclude 'server/data/' \
  --exclude 'server/uploads/' \
  --exclude '.git/' \
  "${NEW_RELEASE}/" /opt/picnest/

sudo chown -R picnest:picnest /opt/picnest
cd /opt/picnest
sudo -u picnest npm ci
sudo -u picnest npm run build

if [ "${PROCESS_MANAGER}" = "pm2" ]; then
  sudo -u picnest -H pm2 restart /etc/picnest/ecosystem.config.cjs --only picnest --update-env
  sudo -u picnest -H pm2 save
else
  sudo systemctl start picnest
fi
curl http://127.0.0.1:18765/api/health
```

`/etc/picnest/picnest.env` 位于程序目录之外，不会被上述命令覆盖。不要使用未带排除规则的 `rm -rf /opt/picnest`、`cp -a` 或 `rsync --delete-excluded` 更新生产目录。

不要使用 `npm update` 代替 `npm ci`。`npm ci` 会严格使用项目中的 `package-lock.json`，更适合可重复生产部署。

## 回滚

代码回滚必须和升级前的数据备份配套进行，尤其是在新版本已经修改数据库结构之后。

```bash
PROCESS_MANAGER=systemd # 使用 PM2 时改为 pm2
if [ "${PROCESS_MANAGER}" = "pm2" ]; then
  sudo -u picnest -H pm2 stop picnest
else
  sudo systemctl stop picnest
fi
cd /opt/picnest

# 回到之前验证过的版本或标签
sudo -u picnest git checkout <旧版本标签或提交>
sudo -u picnest npm ci
sudo -u picnest npm run build

# 恢复升级前的数据备份
sudo tar -C /opt/picnest -xzf /var/backups/picnest/picnest-data-YYYYMMDD-HHMMSS.tar.gz
sudo cp /var/backups/picnest/picnest-env-YYYYMMDD-HHMMSS /etc/picnest/picnest.env
sudo chown -R picnest:picnest /opt/picnest/server/data /opt/picnest/server/uploads

if [ "${PROCESS_MANAGER}" = "pm2" ]; then
  sudo cp /var/backups/picnest/picnest-ecosystem-YYYYMMDD-HHMMSS.config.cjs \
    /etc/picnest/ecosystem.config.cjs
  sudo chown root:picnest /etc/picnest/picnest.env /etc/picnest/ecosystem.config.cjs
  sudo chmod 640 /etc/picnest/picnest.env /etc/picnest/ecosystem.config.cjs
  sudo -u picnest -H pm2 restart /etc/picnest/ecosystem.config.cjs --only picnest --update-env
  sudo -u picnest -H pm2 save
else
  sudo cp /var/backups/picnest/picnest-service-YYYYMMDD-HHMMSS \
    /etc/systemd/system/picnest.service
  sudo chown root:root /etc/picnest/picnest.env /etc/systemd/system/picnest.service
  sudo chmod 600 /etc/picnest/picnest.env
  sudo chmod 644 /etc/systemd/system/picnest.service
  sudo systemctl daemon-reload
  sudo systemctl start picnest
fi
curl http://127.0.0.1:18765/api/health
```

上面的 Git 回滚适用于 Git 部署。压缩包部署应把 `NEW_RELEASE` 指向已验证的旧版本目录，按“压缩包部署升级流程”重新执行 `rsync`，并恢复对应升级前的数据备份。

## 游客上传

游客上传默认关闭。管理员可以在“系统设置 → 游客上传”中开启或关闭。

开启后的行为：

- 登录首页出现“无需登录，游客上传”入口
- 支持粘贴、拖曳和文件选择
- 单次最多 5 张，单张最大 10 MB
- 使用“系统设置 → 图片处理”维护的系统级上传白名单，默认包含 JPG、JPEG、PNG、GIF、WebP、SVG
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
- 妥善备份且不要更换 `PICNEST_STORAGE_SECRET`，不要把它提交到 Git
- 云存储使用权限受限的子账号密钥，不要使用主账号密钥
- 保持游客上传默认关闭，仅在确有需要时开启
- EXIF 可能包含精确 GPS 坐标、设备型号和拍摄时间；对外分享原图前请确认这些信息是否适合公开
- 定期备份 SQLite 数据库和上传目录
- 定期升级 Node.js LTS 和项目依赖
- 图片直链按图床用途设计为公开可访问；私密敏感文件不应作为普通图床图片上传
- 默认白名单包含 SVG；若开启游客上传且不希望接收第三方 SVG，请在“系统设置 → 图片处理”中移除 `svg`

## API

会话接口使用 HttpOnly Cookie。自动化工具可以在“开发者”页面创建 Bearer API 密钥：

```bash
curl -X POST https://img.example.com/api/images \
  -H "Authorization: Bearer pn_live_xxx" \
  -F "files=@cover.jpg" \
  -F "files=@banner.png" \
  -F "album=网站素材"
```

上传接口始终返回图片对象数组，即使只上传一张；成功状态码为 `201`。服务端根据图片内容识别真实格式，并核对文件名扩展名；扩展名与真实格式不一致或内容无法识别时返回 `400`。成功后返回带真实后缀的公开地址，例如 `/media/:id/cover.png`。`GET /api/images` 返回同结构的数组，`GET /api/images/:id` 和 `PATCH /api/images/:id` 返回单个图片对象。

图片对象包含 `filename`、绝对 `url`、相对 `path`、`type`、`format`、`extension`、`mimeType`、持久化的 `processing` 处理结果，以及 `links.direct`、`links.markdown`、`links.bbcode`、`links.html` 四种完整引用。生产环境应配置 `PICNEST_PUBLIC_URL=https://img.example.com`，避免反向代理环境下返回内部地址。

系统图片处理默认开启、默认保持原格式。管理员可在“系统设置 → 图片处理”中设置输出为 JPEG、PNG、WebP 或 AVIF，调整 1–100 的转换质量，并配置 EXIF 自动旋转和元数据清理。

同一页面还维护系统级上传扩展名白名单，默认包含 `jpg`、`jpeg`、`png`、`gif`、`webp`、`svg`。管理员可以增删 1–12 位字母或数字组成的扩展名，最多 32 项且至少保留一项。该白名单同时用于工作台选择、拖拽、粘贴、登录 API 和游客上传；服务端不会信任浏览器或请求提供的 MIME 类型，而会校验图片二进制内容。当前白名单可通过 `GET /api/public/config` 的 `allowedExtensions` 或 `GET /api/settings/image-processing` 读取。

API 上传可使用 multipart 字段 `format`、`quality`、`autoOrient`、`stripMetadata` 覆盖本次请求；`format=default` 使用系统设置。上传扩展名白名单不能由单次请求覆盖。游客上传为防止任意处理参数消耗资源，始终使用系统默认策略。

每位用户可以为 PicGo、ShareX、服务器脚本等客户端分别创建最多 50 把 Bearer API 密钥，并在开发者页面查看、复制或删除。完整密钥使用 `PICNEST_STORAGE_SECRET` 加密保存；升级前已经存在的旧密钥只有哈希，仍可继续使用，但无法恢复完整内容，需要查看时应删除后重新创建。密钥管理接口只接受网页登录会话；即使密钥属于管理员，Bearer 也不能访问成员管理、存储配置、游客开关或其他系统控制面接口。

使用 Bearer API 密钥访问受保护接口时，系统会按服务器时区的自然月聚合调用次数、成功/失败次数、平均响应时间和请求/响应流量。达到 `PICNEST_API_MONTHLY_LIMIT` 后，后续 API 密钥请求返回 `429`；网页端 Cookie 会话不计入 API 调用额度。

主要接口：

| 方法 | 路径 | 权限 | 作用 |
| --- | --- | --- | --- |
| `GET` | `/api/health` | 公开 | 健康检查 |
| `POST` | `/api/auth/register` | 仅首次初始化 | 创建首位管理员 |
| `POST` | `/api/auth/login` | 公开 | 登录 |
| `POST` | `/api/auth/logout` | 会话 | 退出登录 |
| `GET` | `/api/auth/me` | 会话 | 当前用户 |
| `GET` | `/api/public/config` | 公开 | 游客上传开关、限制和允许文件类型 |
| `POST` | `/api/public/images` | 游客开关开启 | 游客上传 |
| `GET/POST` | `/api/users` | 管理员会话 | 查看或创建成员 |
| `PATCH` | `/api/users/:id` | 管理员会话 | 修改成员资料、角色、密码、配额和存储策略 |
| `GET/POST` | `/api/images` | 用户/API 密钥 | 图片列表或上传 |
| `GET` | `/api/images/:id` | 图片所有者 | 读取单张图片的完整对象与引用地址 |
| `GET` | `/api/images/:id/metadata` | 图片所有者 | 按需读取并补提取完整图片元数据 |
| `PATCH/DELETE` | `/api/images/:id` | 图片所有者 | 修改或删除图片 |
| `POST` | `/api/images/bulk-delete` | 图片所有者 | 批量删除 |
| `GET/POST` | `/api/albums` | 用户/API 密钥 | 相册列表或创建 |
| `PATCH` | `/api/albums/:id/default` | 相册所有者 | 设置默认相册 |
| `GET/POST` | `/api/api-keys` | 用户会话 | 查看密钥列表或创建新密钥 |
| `GET` | `/api/api-keys/:id/secret` | 用户会话 | 查看自己可恢复的完整密钥 |
| `DELETE` | `/api/api-keys/:id` | 用户会话 | 删除自己的指定密钥 |
| `PATCH` | `/api/settings/guest-upload` | 管理员会话 | 开关游客上传 |
| `GET` | `/api/settings/image-processing` | 用户/API 密钥 | 读取系统图片处理默认策略 |
| `PATCH` | `/api/settings/image-processing` | 管理员会话 | 修改允许上传类型与默认图片处理策略 |
| `GET` | `/api/storage/providers` | 用户会话 | 查看已脱敏的存储服务列表 |
| `POST` | `/api/storage/providers` | 管理员会话 | 添加存储配置 |
| `PATCH/DELETE` | `/api/storage/providers/:id` | 管理员会话 | 修改或删除存储配置 |
| `POST` | `/api/storage/providers/:id/test` | 管理员会话 | 检测存储写入、读取和删除能力 |
| `PATCH` | `/api/storage/providers/:id/default` | 管理员会话 | 检测并切换当前存储 |
| `GET` | `/api/stats` | 用户/API 密钥 | 当前用户空间统计 |

公开图片由 `GET /media/:id/:filename.ext` 返回，响应包含实际 `Content-Type`、UTF-8 文件名、缓存头和 ETag；旧的 `/media/:id` 地址继续兼容。完整交互式文档可在登录后的“开发者 → 阅读 API 文档”中查看。

## 常见问题

### Nginx 返回 502 Bad Gateway

先检查后端健康接口：

```bash
curl http://127.0.0.1:18765/api/health
```

systemd 查看 `sudo systemctl status picnest --no-pager` 和 `sudo journalctl -u picnest -n 100 --no-pager`；PM2 查看 `sudo -u picnest -H pm2 status` 和 `sudo -u picnest -H pm2 logs picnest --lines 100`。

确认 Nginx 的 `proxy_pass` 端口与 `/etc/picnest/picnest.env` 中的 `PORT` 一致；默认都是 `18765`。使用 Caddy 时同样检查 `reverse_proxy`。

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
```

随后使用 `sudo systemctl restart picnest`，或在 PM2 部署中使用 `sudo -u picnest -H pm2 restart /etc/picnest/ecosystem.config.cjs --only picnest --update-env`。

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
```

然后使用 `sudo systemctl restart picnest`，或使用 `sudo -u picnest -H pm2 restart /etc/picnest/ecosystem.config.cjs --only picnest --update-env`。

### 如何确认游客上传是否关闭

```bash
curl https://img.example.com/api/public/config
```

返回的 `guestUploadEnabled` 为 `false` 时，游客上传接口会返回 `403`；`allowedExtensions` 是游客和登录用户共同使用的当前上传白名单。

## 开发命令

```bash
npm run dev        # 启动 Vite 和 Express 开发服务
npm run lint       # ESLint，任何警告都会失败
npm run typecheck  # 独立执行 TypeScript 检查
npm test           # Node 单元测试与 API/权限集成测试
npm run build      # TypeScript 检查并构建生产前端
npm run check      # 依次执行 lint、typecheck、test、build
npm run test:ui    # 构建后使用本机 Edge/Chrome/Chromium 完成桌面与移动端界面验收
npm start          # 由 Express 托管生产前端和 API
```

`npm run test:ui` 会自动使用常见安装路径中的 Edge、Chrome 或 Chromium；其他路径可通过 `PICNEST_BROWSER_PATH` 指定。测试使用临时数据库，不会写入正式 SQLite 数据。

## 技术栈

React 19、TypeScript、Vite、Express 5、Helmet、Express Rate Limit、Multer、SQLite、better-sqlite3、bcrypt、JWT 和 Lucide Icons。
