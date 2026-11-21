# Altare 部署实施方案稿

> 本文只写「怎么在 Altare 上把东西跑起来」，不含任何业务功能设计。
> 所有数据均来自官方文档（docs.altare.gg）与 `altr` CLI 实际输出，已逐条核对。
> 核对日期：2026-11-21

---

## 0. 当前账号与工具状态

| 项 | 值 |
|---|---|
| 账号 | EtherealWish (etherealwish1314@gmail.com) |
| 团队 | Default |
| 套餐 | Always Free（免费） |
| CLI | `altr` 0.8.1，位于 `C:\Users\noilinux\.local\bin\altr.exe` |
| MCP | 已接入 Claude Desktop（`altr mcp`，134 个工具） |
| Go 机器 | 配额 3 台，当前 0 台，单台上限 720 分钟 |
| 服务器 | 0 台 |
| Workstations | **不可用**（beta 席位 30/30 已满） |

---

## 1. 平台产品线总览

选方案之前必须搞清楚每条产品线是什么，它们的限制完全不同。

| 产品 | 本质 | 持久性 | 图形界面 | 公网 IP | 免费可用 |
|---|---|---|---|---|---|
| **Apps** | 从 GitHub 拉代码构建运行 | 常驻 | 无 | 无（走域名） | ✅ |
| **Docker Apps** | 跑现成镜像 | 常驻 | 无 | 无 | ✅ |
| **Sandbox** | 持久 Linux，SSH 登录 | 常驻 | 无 | 无 | ✅ |
| **Altare Go** | 一次性容器 | 最长 12 小时 | 无 | 无 | ✅ |
| **Workstation** | 完整 Linux VM | 常驻 | ✅ noVNC | 无（NAT） | ❌ 需 beta 席位 |
| **Edge Functions** | 边缘 JS/TS | 无状态 | 无 | 无 | ✅ |
| **Tunnels** | 把本地端口映射到公网 | 跟随本地进程 | — | 无 | ✅ 部分 |

**关键结论：Altare 全线产品都不提供独立或静态公网 IPv4。** 所有对外访问都是平台控制的域名 + 端口。

---

## 2. 三条实施路线对比

### 方案 A：Apps + 托管数据库（推荐）

| 维度 | 说明 |
|---|---|
| 部署方式 | GitHub push 自动构建部署 |
| 端口成本 | **0**（每应用自带 1 个免费端口） |
| 运维负担 | 最低（自动重启、自动证书、自动备份） |
| 磁盘 | 从团队池扣（10 GB 共享） |
| 数据库 | 托管 Postgres，**不占资源池** |
| 适合 | 有代码、需要常驻、想零运维 |

### 方案 B：Sandbox 自建

| 维度 | 说明 |
|---|---|
| 部署方式 | SSH 进去手动装环境 |
| 端口成本 | **要钱**（主端口被 SSH 占用，额外端口 11.25 bolts + 0.25/天） |
| 运维负担 | 高（无 systemd，重启需手动拉起） |
| 磁盘 | 从团队池扣，但可以配大 |
| 数据库 | 可自建，能用全部磁盘 |
| 适合 | 需要装任意软件、需要大磁盘、能接受手动运维 |

### 方案 C：Docker App

| 维度 | 说明 |
|---|---|
| 部署方式 | 跑现成镜像 |
| 端口成本 | 0 |
| 限制 | 只能跑 linux/amd64；不能挂文件系统、不能改网络、不能用设备 |
| 适合 | 跑成熟开源软件，不写自己的业务逻辑 |

### 选型建议

**零成本且没有支付方式 → 方案 A。**

理由：Apps 在额度内运行时，官方明确不需要设置计费资料（"Within what's included, you don't need billing set up"）。方案 B 的端口费虽然一年只有约 $0.4，但需要 bolts，而 bolts 奖励要求绑定 Discord 账号，多一道门槛。

---

## 3. 方案 A 完整实施步骤

### 3.1 前置条件

1. **GitHub 账号**（免费，无需信用卡）
2. 本地已安装 `altr` 并登录（已完成）
3. 一个 Git 仓库

### 3.2 代码必须遵守的约定

这是最容易踩坑的地方，Apps 的运行环境有硬性要求：

| 要求 | 说明 |
|---|---|
| **监听地址** | 必须 `0.0.0.0`，不能是 `127.0.0.1` |
| **端口** | 必须读 `process.env.PORT`，不能写死 |
| **日志** | 写 stdout/stderr，平台自动收集 |
| **无状态** | 本地文件在重新部署时会被替换（除数据目录外） |
| **构建产物** | 平台自动识别 runtime；识别不对可在控制台改 |

Node.js 示例骨架：

```js
const port = process.env.PORT || 3000
app.listen(port, '0.0.0.0', () => {
  console.log(`listening on ${port}`)
})
```

### 3.3 平台自动注入的环境变量

不要自己定义这些名字，也不要让变量名以 `ALTARE` 开头：

| 变量 | 值 |
|---|---|
| `ALTARE` | `1` |
| `ALTARE_ENV` | `production` 或 `preview` |
| `ALTARE_DEPLOY` | 本次部署 ID |
| `ALTARE_GIT_REPO` | `owner/repo` |
| `ALTARE_GIT_BRANCH` | 分支名 |
| `ALTARE_GIT_COMMIT_SHA` | 提交 SHA |
| `ALTARE_URL` | 应用的 HTTPS 地址 |
| `ALTARE_HEALTH_PATH` | 健康检查路径 |
| `PORT` | 监听端口 |

变量总数上限 200 个，总计 32 KB。

### 3.4 创建并部署

**方式一：控制台**

1. Apps → New app
2. 选 GitHub repository → Connect GitHub（安装 Altare GitHub App）
3. 检查 Build and run 里识别的 runtime / 分支 / 根目录 / 构建命令，不对就改
4. 选 region 和 size，创建
5. 首次部署自动开始

**方式二：CLI**

```bash
altr deploy                    # 在仓库目录内，自动匹配应用
altr deploy my-app             # 指定应用
altr deploy my-app --ref v1.2.0
altr deploy --no-wait          # 不等构建日志
```

**重要：`altr deploy` 部署的是 GitHub 上的最新提交，不是本地文件。必须先 push。**

### 3.5 创建并连接数据库

```bash
altr postgres create main
altr postgres attach main my-app
```

`attach` 会自动把 `DATABASE_URL` 等变量写入应用并触发重新部署。变量前缀可用 `--prefix` 改。

常用数据库命令：

| 命令 | 作用 |
|---|---|
| `altr postgres ls` | 列出数据库 |
| `altr postgres info main` | 状态、大小、连接信息 |
| `altr postgres connect main` | 打开 psql |
| `altr postgres url main` | 打印含密码的连接串 |
| `altr postgres backups ls main` | 备份列表 |
| `altr postgres reset-password main` | 重置密码（已连接的应用会自动更新并重部署） |
| `altr postgres restart main` | 重启 |
| `altr postgres delete main` | 删除（备份会保留一段时间） |

创建时可指定：`--size micro|small`、`--disk <GB>`、`--region us|eu|asia`。不指定则用套餐允许的最小规格。

### 3.6 配置环境变量

```bash
altr env set my-app KEY=value DEBUG=1
altr env set my-app --file .env.production
```

**保存变量会触发重新部署。**

### 3.7 绑定自定义二级域名

```bash
altr domains add my-app my-name     # → my-name.altare.app
altr domains ls my-app
```

规则：

- 名字自己挑，**免费**
- 被占用时不会报错，自动加随机后缀（如 `my-name-k3xq.altare.app`），先到先得
- 每个应用最多 5 个域名
- 证书自动签发

### 3.8 健康检查与回滚

- **健康检查路径**：Deployments → Settings → Health and caching，填 `/health`。新版本要在这个路径返回非 5xx 才上线，超时 90 秒；不设则只要存活 5 秒就上线。
- **回滚**：Deployments → History 列出每次部署及构建日志，任意历史提交可一键 Roll back。
- **失败保护**：构建在旧版本旁边进行，构建失败不影响线上版本，旧版本继续运行。

### 3.9 部署触发方式

| 方式 | 说明 |
|---|---|
| Deploy automatically（默认） | push 即部署 |
| Ask me first | 控制台显示新提交，手动点 Deploy |
| Do nothing | 不自动部署 |
| Deploy hook | `POST https://console.altare.gg/api/deploy-hooks/<id>/<secret>` |

### 3.10 后台进程与定时任务

**常驻进程**（每个应用最多 8 个，与主进程共享文件/变量/资源，异常自动重启）：

在应用 Processes 页面添加，或写在 Procfile 里：

```
web: node server.js
worker: node worker.js
```

**命令任务**（每个应用最多 20 个，UTC 时间）：

- 支持预设（每小时、每天 00:00 UTC）或自定义 cron 表达式
- `Stop it after` 1 分钟到 6 小时，默认 1 小时
- `Allow overlapping runs` 关闭时，上一轮未结束会跳过本轮
- 每次运行显示退出码和最后 4 KB 输出

**团队级 cron job**（免费 5 个，最快 5 分钟一次）：

| 类型 | 说明 |
|---|---|
| URL | 任意公网 HTTPS 地址，可设方法/头/体（JSON，最大 64 KB） |
| 你的应用 | 指定应用 HTTPS 地址上的路径 |
| Edge Function | 调用函数的 `scheduled()` 处理器 |
| 命令任务 | 在应用内跑命令 |

**cron 请求带签名，必须校验**：

- `X-Altare-Timestamp`：Unix 秒
- `X-Altare-Signature`：`sha256=` + HMAC-SHA256(`<timestamp>.<body>`, signing secret) 的十六进制

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

function fromAltare(req, body, secret) {
  const ts = req.headers['x-altare-timestamp']
  const expected = 'sha256=' + createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
  const given = req.headers['x-altare-signature'] ?? ''
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}
```

cron 的 URL 调用超时 1–30 秒，不跟随重定向，拒绝私有网络地址。

---

## 4. 方案 B：Sandbox 自建

### 4.1 创建

```bash
altr server create box --template "Generic - Debian" --memory 2048 --disk 8192 --cpu 100 --location de-fra
```

参数：

| 参数 | 默认值 |
|---|---|
| `--cpu` | 100（百分比，100 = 1 核） |
| `--disk` | 5120 MB |
| `--memory` | 1024 MB |
| `--location` | `us-iad` |
| `--template` | 必填 |
| `--no-team-keys` | 不加团队 SSH key |
| `--password` | 设置 SSH 密码 |

可用系统：Ubuntu 26.04 / 24.04、Debian 13 / 12、Alpine 3.23、Fedora 44、Rocky 9、AlmaLinux 10、Arch Rolling、任意 Docker Hub 公开镜像（需 linux/amd64）。

`altr server templates` 可列出所有模板 ID。

### 4.2 连接

```bash
altr ssh box                    # 自动查地址
altr ssh box uptime             # 执行单条命令
ssh root@box.go.altare.global -p 25506
sftp -P 25506 root@box.go.altare.global
scp -P 25506 ./app.tar.gz root@box.go.altare.global:/root/
ssh -L 5432:localhost:5432 root@box.go.altare.global -p 25506   # 端口转发
```

控制台内也能直接在浏览器里敲命令。

隐藏登录欢迎语：`touch ~/.hushlogin`

### 4.3 进程保活（必读）

**Sandbox 没有 systemd。** 官方原文：

> Stopping or restarting the sandbox stops everything in it, so start your apps again afterwards. There's no systemd.

两种做法：

**做法一：tmux（手动）**

```bash
apt install -y tmux
tmux new -s app
# 在里面跑你的服务，Ctrl-B D 脱离
```

**做法二：supervisord（自动，推荐）**

supervisord 是用户态进程管理器，不依赖 systemd，重启后一条命令拉起全部服务：

```bash
apt install -y supervisor
# 配置写到 /etc/supervisor/conf.d/app.conf
supervisord -c /etc/supervisor/supervisord.conf
```

### 4.4 开放 Web 端口

主端口被 SSH 占用。要给网站/API 开端口：

1. 控制台 → Sandbox → Network → 添加端口
2. 费用：11.25 bolts 一次性槽位费 + 0.25 bolts/天保留费
3. 同一页面可以给该端口加 HTTPS 域名
4. 应用必须监听 `0.0.0.0`

### 4.5 防止被自动暂停

`Settings → General → Pause when idle`：CPU 和网络安静一段时间后自动停止（10 分钟到 12 小时可设），文件保留，团队会收到带 Start 按钮的通知。**默认关闭**，但团队级默认值可能被设过，需确认。

### 4.6 快照与镜像

| 项 | 免费额度 |
|---|---|
| 快照 | 3 个（团队共享） |
| 保存的镜像 | 3 个 |
| 每镜像版本数 | 3 |
| 单镜像最大 | 5 GB |

`Save as image` 会把整个系统（已装软件、文件、配置）存成镜像，可用于创建新 Sandbox 或 Go 机器。Reinstall 会重置系统但保留 `/root` 和 `/home`。

---

## 5. 方案 C：Docker App

```bash
altr docker create web nginx:1.27 --port 80
altr docker create api ghcr.io/acme/api:latest -e LOG_LEVEL=info --location de-fra
altr docker env set api LOG_LEVEL=debug
```

镜像写法：`nginx`（= `nginx:latest`）、`bitnami/redis:7.4`、`ghcr.io/owner/app:v1`、`registry.example.com:5000/team/app:2`、`quay.io/org/img@sha256:…`（固定摘要，永不更新）。

**硬限制**：

- 只支持 linux/amd64
- 只支持 TCP 流量
- 应用以镜像自己的用户运行（包括 root），在应用内
- **需要挂载文件系统、修改网络、使用设备的应用跑不了**
- 重新部署时数据目录以外的文件会被替换
- 构建期间应用离线；新镜像安装失败会自动回退旧镜像

其他字段：

| 字段 | 说明 |
|---|---|
| Private registry | 用户名 + token/密码，加密存储，只用于拉镜像 |
| Port | 应用监听端口，默认取镜像第一个暴露端口 |
| Data folder | 重新部署时保留的目录，如 `/data` |
| Start command | 替换镜像命令，支持 `$PORT` 和变量 |
| Update automatically | 每 15 分钟检查 tag，变化则重新部署（默认关） |

---

## 6. 域名与二级域名

### 6.1 自定义二级域名（无需拥有域名）

```bash
altr domains add <app> <name>     # → <name>.altare.app
```

官方 CLI 帮助原文：

> Adds `<name>` on Altare's domain (my-app becomes my-app.altare.app), or your own domain when `<name>` has a dot that isn't Altare's.

- 免费
- 名字被占用会自动加随机后缀
- 每应用最多 5 个

### 6.2 应用默认地址

新建应用自动获得 `my-api.go.altare.global`（以应用名命名），重名时加随机后缀。

### 6.3 接入自己的域名

**做法一：托管整个 DNS**

把注册商处的 NS 改成：

```
ns1.altare.global
ns2.altare.global
ns3.altare.global
ns4.altare.global
```

```bash
altr dns add example.com
altr dns check example.com
altr dns add example.com --no-import     # 不导入现有记录
```

**做法二：只绑单个应用（不迁 DNS）**

DNS records 页面 → Connect to app，或：

```bash
altr domains add my-app www.example.com
```

然后在你自己的 DNS 里加 CNAME 指向控制台显示的地址。

### 6.4 DNS 记录管理

```bash
altr dns records add example.com A @ 203.0.113.10
altr dns records add example.com CNAME www example.com --proxied
altr dns records add example.com MX @ mail.example.com --priority 10
altr dns records ls example.com
altr dns import example.com ./example.com.zone
altr dns export example.com > example.com.zone
```

- 支持类型：A、AAAA、CNAME、MX、TXT、SRV、CAA、NS
- TTL Auto 为 5 分钟
- 导入 zone 文件最大 1 MB，已存在的记录会跳过

### 6.5 Proxied（边缘代理）

给 A/AAAA/CNAME 记录打开 Proxied 后获得：

| 功能 | 默认 |
|---|---|
| 免费证书（根域名也支持） | 开启 |
| Always use HTTPS | 开 |
| 最低 TLS | 1.2 |
| HSTS（含 max age / includeSubdomains / preload） | 关 |
| 防火墙规则 | 每 zone 50 条 |
| 限速规则 | 每 zone 10 条 |
| 安全级别 | Normal / High / Under attack |
| Block known bad bots / Hotlink protection | 可开 |
| DNSSEC | 可开 |

**回源规则（容易踩坑）**：

- A / AAAA 记录：回源走 **HTTP 80**
- CNAME 记录：回源走 **HTTPS 443**

防火墙规则可基于 IP、国家、AS 号、路径、方法、主机名、User-Agent 设条件，动作有 block / allow / challenge / log，按顺序执行，第一条 block/allow/challenge 生效。

### 6.6 配额

| 项 | 免费 |
|---|---|
| DNS zone | 5 个 |
| 每 zone 记录数 | 1000 |

---

## 7. Tunnels（本地端口映射到公网）

```bash
altr tunnel 3000                              # 快速隧道，下次还是同一地址
altr tunnel 3000 --name shop                  # 命名隧道（Plus）
altr tunnel 3000 --name shop --domain dev.example.com   # 绑自己域名（Plus）
altr tunnel 3000 --auth demo:secret           # 加用户名密码
altr tunnel tcp 25565                         # 裸 TCP（Plus）
altr tunnel ls | rm | logs | token
```

关键特性：

- **HTTP/1.1、HTTP/2、WebSocket 都会以 HTTP/1.1 形式到达本地端口**
- altr 主动外连 Altare，因此能穿透 NAT 和防火墙
- 断开自动重连，直到 Ctrl-C
- 30 天无人连接会被删除

**免费额度**：2 个隧道，**0 个 TCP 隧道**，无命名隧道、无自有域名，保留 1 天。

---

## 8. 存储与缓存

### 8.1 U3 对象存储（S3 兼容）

```bash
altr u3 create uploads
altr u3 put ./cat.png uploads/images/cat.png
altr u3 get uploads/images/cat.png .
altr u3 ls uploads/images/
altr u3 url uploads/images/cat.png      # 临时下载链接
altr u3 attach uploads my-app           # 把访问密钥注入应用变量
```

免费：10 GB、5 个 bucket、10 个 access key。

### 8.2 KV

```bash
altr kv create sessions
altr kv put sessions key value
altr kv get sessions key
altr kv attach sessions my-app
```

免费：5 个命名空间、1 GB、每月 300 万读 / 30 万写。

---

## 9. Edge Functions

```bash
altr functions create hello
altr functions deploy hello ./worker
altr functions logs hello -f
altr functions bindings add api CACHE --kv sessions
altr functions bindings add api FILES --bucket uploads --read-only
altr functions bindings add api DB --postgres main
altr functions cron add ...
```

免费：10 个函数、每月 300 万请求、每月 1000 万毫秒 CPU、**单次请求 50 ms**。

**50 ms 是硬限制**，任何重计算都不该放这里。

---

## 10. 成本模型

### 10.1 免费额度（Always Free）

| 类别 | 额度 |
|---|---|
| 内存 | 6 GB |
| CPU | 150%（1.5 核） |
| 磁盘 | 10 GB |
| 服务器槽位 | 4 |
| 快照 | 3（团队共享） |
| 端口 | 每应用 1 个 |
| U3 | 10 GB / 5 bucket / 10 key |
| KV | 5 命名空间 / 1 GB / 3M 读 / 300K 写 |
| Postgres | 1 个，256 MB 内存 / 1 GB 存储，备份保留 3 天 |
| MySQL | 1 个，同上 |
| Valkey | 1 个，64 MB |
| 队列 | 3 个，每月 100 万次操作 |
| Edge Functions | 10 个，每月 300 万请求 |
| DNS zone | 5 |
| Cron（HTTP） | 5 个，最快 5 分钟 |
| 邮件发送 | **不包含** |
| 可拥有的团队数 | 2 |
| API 速率 | 每分钟 600 次/令牌 |

**免费计划没有 SLA**（99.9% 是 Business 专属）。

### 10.2 超出额度时的价格

| 项目 | 价格 |
|---|---|
| 1 GB 内存（一次性） | 222.75 bolts / $0.89 |
| 10 GB 磁盘（一次性） | 222.75 bolts / $0.89 |
| 50% CPU（一次性） | 148.5 bolts / $0.59 |
| 1 个服务器槽位（一次性） | 123.75 bolts / $0.50 |
| **1 个额外端口槽位（一次性）** | **11.25 bolts / $0.05** |
| 1 个额外快照槽位 | 18 bolts / $0.07 |
| 自动每日快照 | 1.67 bolts/天/应用 |
| **保留端口** | **0.25 bolts/天/端口**（Plus 也要付） |

Postgres 超额：内存 $3.00/GB-月，存储 $0.10/GB-月。
U3 超额：$0.01/GB-月。
KV 超额：存储 $0.25/GB-月，读 $0.25/百万，写 $1.00/百万。

### 10.3 免费获取 bolts

250 bolts = $1。

| 来源 | 数量 |
|---|---|
| 每日奖励 | 13.33/天，连续签到每天 +0.67，最多 +6.67（上限 20/天） |
| 挂机（AFK） | 0.04/分钟，上限 30/天 |
| 绑定 Discord | 一次性 50 |
| 推荐 | 被推荐人 20，推荐人 10，24 小时内最多 5 次 |

**奖励和商店功能需要绑定 Discord 账号。**

对比一下：光每日签到 13.33 bolts，而端口保留费只要 0.25/天。

---

## 11. 运维手册

### 11.1 日志

```bash
altr logs my-api                          # 实时流
altr logs my-api --tail 200
altr logs my-api --since 1h --grep error
altr logs my-api --since 2026-11-09T14:00 --until 2026-11-09T15:00 --stream stderr
altr logs my-api --tail 50 --follow
```

| 项 | 免费 | Plus / Business |
|---|---|---|
| 保留时长 | 3 天 | 14 天 |
| 容量 | 100 MB | 500 MB |

保留日志不超过应用磁盘的十分之一。

### 11.2 监控与告警

**Uptime 监控**：Deployments → Settings → Health and caching 开启。每分钟请求一次应用 HTTPS 地址（有健康检查路径则请求该路径），连续失败 3 次标记为 down 并通知。

**告警规则**（每应用 20 条）：

| 监控项 | 触发条件 |
|---|---|
| Memory / CPU / Disk | 超过限制的百分比，窗口内每分钟 |
| Restarts | 窗口内启动次数超阈值（崩溃循环） |
| Error rate | 5xx 占比超阈值（需窗口内 20 个请求） |
| Response time (p95) | 95 分位响应时间超阈值 |
| Log match | 文本或正则出现 N 次 |
| App down | Uptime 检查判定 down |
| Deploy failed | 生产部署失败 |
| Preview failed | 预览部署失败 |

通知渠道：团队铃铛 + Discord / Slack / Webhook / Edge Function。

### 11.3 备份

| 类型 | 说明 | 免费额度 |
|---|---|---|
| Postgres 备份 | 每日自动 | 保留 3 天 |
| 快照（Snapshot） | 应用整体异地副本 | 3 个（团队共享） |
| Sandbox 快照 | Sandbox 专用 | 3 个 |

**自建数据库必须自己备份**，Sandbox 没有自动备份：

```bash
# 每天凌晨 3 点
0 3 * * * pg_dump -U user db | gzip > /root/backup-$(date +\%F).sql.gz
```

### 11.4 团队协作

```bash
altr teams
altr team use "My team"
altr <cmd> --team <name or ID>
```

**CI / 远程代理**用团队 API token：

```bash
export ALTARE_TOKEN="alt_…"
altr deploy my-bot
```

团队 token 的限制：**不能**使用 `altr go`、`altr workstations`、`altr experiments`、`altr teams`、跨团队的 `altr apps`。这些需要 `altr token` 生成的个人 token。

---

## 12. 限制与坑（逐条）

### 12.1 硬性技术限制

| 限制 | 影响 | 规避 |
|---|---|---|
| **没有公网 IP** | 无法做 IP 白名单、反向解析 | 只能走域名 |
| **Edge Function 单次 50 ms** | 不能做重计算 | 用常驻 App |
| **免费不发邮件** | 无法发验证码/通知 | 用第三方 SMTP，或改用邀请码登录 |
| **Postgres 只有 256 MB / 1 GB** | 数据量受限 | 大文件存 U3；必要时迁 Sandbox 自建 |
| **免费只有 1 个 Postgres** | 不能多库 | 用 schema 分隔 |
| **Go 机器最长 12 小时** | 不能常驻 | 用 Sandbox |
| **Go/Sandbox 无 systemd** | 重启后服务不自启 | supervisord / tmux |
| **Sandbox 不能跑 Docker** | 无法用容器化部署 | 直接装运行时，或用 Workstation |
| **Docker App 只支持 linux/amd64、只支持 TCP** | 部分镜像跑不了 | 改用 Apps |
| **Docker App 不能挂文件系统/改网络** | 需要特权操作的应用不行 | 改用 Sandbox |
| **免费 TCP 隧道为 0** | 无法暴露裸 TCP | 只能用 HTTP(S) |
| **Workstation 在 NAT 后** | 无独立 IP | 用 `xxx.ws.altare.global:46xxx` |
| **Workstation 仅伦敦** | 延迟 | 无解 |
| **免费无 SLA** | 无可用性保证 | 商业用途需评估 |

### 12.2 容易踩的细节

**端口计费的真相**

- Apps：每应用**自带 1 个免费端口**
- Sandbox：主端口被 SSH 占用，额外端口才收费（11.25 bolts 槽位费 + 0.25/天）
- 收费的是「额外的公网端口」，不是端口功能本身

**自定义子域名的抢占机制**

名字被占用不会报错，而是静默加随机后缀。如果你很在意名字，早点占。

**`altr deploy` 不部署本地代码**

它部署 GitHub 上的最新提交。改了代码忘了 push，部署的还是旧的。

**Proxied 回源端口**

A/AAAA 回源 HTTP 80，CNAME 回源 HTTPS 443。后端监听错端口会 502。

**变量改动会触发重新部署**

`altr env set` 保存即重部署，不是立即生效在旧进程上。

**cron 请求必须验签**

不验签等于开放一个任何人都能调的接口。

**Sandbox 的 Pause when idle**

默认关闭，但团队级默认值可能被改过。长时间无流量会被暂停，需要手动 Start。

**Sandbox 登录爆破保护**

同一 IP 10 分钟内失败 10 次会被临时拒绝登录。

**团队 token 权限残缺**

CI 里用团队 token 跑 `altr go` 或 `altr workstations` 会失败。

### 12.3 Workstation 现状

当前账号 `access.allowed: false`，原因：

> Workstations are in beta for Altare Plus and Business. On Altare Free, the team's owner can join the beta in Account → Experiments.

早期测试席位 **30 个已满**（`0 of 30 seats left`）。加入方式：

```bash
altr experiments list
altr experiments join workstations
```

有席位时免费额度：2 vCPU、4 GB 内存、60 GB 磁盘，最多 2 台工作站，每台 1–4 vCPU / 2–8 GB / 20–120 GB，**空闲 2 小时自动停止**。

支持的桌面发行版：

| 发行版 | 桌面环境 |
|---|---|
| Ubuntu 24.04 LTS | XFCE / GNOME / KDE Plasma |
| Ubuntu 26.04 LTS | XFCE / GNOME / KDE Plasma |
| Debian 13 | XFCE / GNOME / KDE Plasma |
| Fedora latest | XFCE / GNOME / KDE Plasma |
| Kali rolling | XFCE（仅桌面） |

Debian 12、AlmaLinux 10、Arch 无桌面，仅服务器模式。

桌面通过浏览器 noVNC 打开，无需安装客户端：

```bash
altr ws desktop desk
```

---

## 13. 合规红线（务必先读）

Altare 服务条款第 8 条 Acceptable use 明确禁止：

| 禁止项 | 原文关键词 |
|---|---|
| **公共代理 / VPN** | "Run public proxies or VPNs, or tools designed to hide abuse or evade bans" |
| 转卖 / 出租 / 赠送资源 | "reselling, renting or giving away free resources or accounts" |
| 挖矿 | "Mine cryptocurrency or run other workloads designed to use as much compute as possible" |
| 攻击他人 | DoS、压力测试、booter、端口扫描、暴力破解 |
| 恶意软件 | malware、botnets、C2 服务器 |
| 垃圾邮件 | spam、phishing、open mail relays |
| 盗版 | pirated software、cracked servers |
| 绕过限制 | "getting around resource limits, bans, rate limits or other restrictions" |
| 小号 | "creating or using alt accounts" |

**处罚**：可移除内容、暂停服务器、终止账号，且无需事先通知。

**这对本方案的影响**：

- ❌ 不能拿它搭翻墙代理或公共代理
- ❌ 不能开小号薅免费额度
- ✅ 给自己的网站做反向代理（nginx/Caddy）没问题，禁止的是对外给第三方中转流量
- ✅ 用 Altare Mesh（WireGuard）访问自己的资源没问题，但免费版不支持 Altare 节点当出口节点

---

## 14. 验证清单

部署完成后逐项确认：

| # | 检查项 | 命令 / 方法 |
|---|---|---|
| 1 | 应用已上线 | `altr apps` |
| 2 | 日志正常无报错 | `altr logs <app> --tail 50` |
| 3 | 健康检查通过 | 访问 `/health` |
| 4 | 数据库已连接 | `altr postgres info <db>` |
| 5 | 变量已注入 | 控制台 Deployments → Settings |
| 6 | 自定义域名生效 | `altr domains ls <app>`，浏览器访问 |
| 7 | 证书有效 | 浏览器地址栏锁标 |
| 8 | HTTPS 强制跳转 | 用 `http://` 访问应跳转 |
| 9 | 端口监听正确 | 必须 `0.0.0.0`，读 `PORT` |
| 10 | 定时任务可跑 | `altr functions cron run` 或控制台 Run by hand |
| 11 | Uptime 监控已开 | Deployments → Overview |
| 12 | 告警渠道已配 | Team → Settings → Notifications，发测试消息 |
| 13 | 备份策略就位 | 托管库确认自动备份；自建库确认 cron |
| 14 | 回滚演练 | Deployments → History → Roll back |
| 15 | 资源占用未超限 | 控制台查看内存/CPU/磁盘 |

---

## 15. 升级路径

当免费额度不够时的选项：

| 触发条件 | 升级动作 | 成本 |
|---|---|---|
| 内存/磁盘不够 | 商店买一次性扩容 | 1 GB 内存 222.75 bolts |
| 需要多端口 | 买端口槽位 | 11.25 bolts + 0.25/天 |
| 需要自动每日快照 | 开启 | 1.67 bolts/天/应用 |
| 数据库吃紧 | 迁到 Sandbox 自建 | 端口费 + 自己运维 |
| 需要 SLA / 邮件 / 更多数据库 | 升 Plus | $7.99/团队/月 |
| 需要 Workstation | Plus 或 beta 席位 | $7.99/月 |
| 需要 99.9% SLA / 用量后付费 | 升 Business | $40/团队/月 |

**注意**：升级 Plus 后端口槽位免费（每应用最多 10 个），但**保留端口的 0.25 bolts/天仍然要付**。

---

## 16. 相关命令速查

### 账号与团队

```bash
altr login / altr login --no-browser
altr whoami / altr logout
altr teams / altr team use "name"
altr token                       # 生成个人 token
```

### 应用

```bash
altr apps
altr deploy [app] [--ref <ref>] [--no-wait]
altr logs <app> [--tail N] [--since 1h] [--grep X] [--stream stderr] [--follow]
altr env set <app> KEY=val [--file .env]
altr domains add <app> <name> / altr domains ls <app> / altr domains rm
```

### 数据库

```bash
altr postgres create <name> [--size micro|small] [--disk GB] [--region us|eu|asia]
altr postgres attach <db> <app> [--prefix P]
altr postgres connect <db>
altr postgres url <db>
altr postgres info <db>
altr postgres backups ls <db>
altr postgres reset-password <db>
altr postgres restart <db>
```

### Docker

```bash
altr docker create <name> <image> --port N [-e K=V] [--location X]
altr docker env set <app> K=V
```

### 服务器

```bash
altr server templates
altr server create <name> --template <t> [--cpu N] [--disk MB] [--memory MB] [--location X]
altr servers
altr ssh <box> [command]
```

### 存储

```bash
altr u3 create/ls/put/get/rm/url/attach/info
altr kv create/ls/put/get/rm/keys/attach
```

### 函数

```bash
altr functions create/deploy/logs/bindings/cron/domains/buckets/email
```

### 网络

```bash
altr dns add/check/ls/rm/records/import/export
altr tunnel <port> [--name] [--domain] [--auth]
altr tunnel tcp <port>
altr mesh up/status/down/logout/keys/devices/routes/exit-node
```

### Workstation / Go

```bash
altr ws catalog / create / list / desktop / ssh
altr experiments list / join workstations / leave workstations
altr go start / exec / stop / pause / resume / fork / expose / images / list
```

---

## 17. 全局参数

所有命令通用：

| 参数 | 说明 |
|---|---|
| `--json` | 输出机器可读 JSON |
| `--team <name or ID>` | 临时指定团队 |
| `--token <token>` | 用 API token 代替登录态（或设 `ALTARE_TOKEN`） |

环境变量：

| 变量 | 用途 |
|---|---|
| `ALTARE_TOKEN` | 团队 API token |
| `ALTARE_TEAM` | 默认团队 |
| `ALTARE_MESH_AUTH_KEY` | Mesh 认证密钥 |
| `ALTARE_INSTALL_DIR` | CLI 安装目录 |
| `ALTARE_VERSION` | 固定 CLI 版本 |

---

## 18. 附：CLI 与 MCP 安装（已完成，留档备查）

**CLI 安装**

```bash
# macOS / Linux
curl -fsSL https://altare.gg/install.sh | sh

# Windows：下载 altr-windows-amd64.exe，重命名为 altr.exe 放入 PATH
# 下载地址：https://altare.gg/downloads/altr/0.8.1/altr-windows-amd64.exe
# 校验：SHA256SUMS
```

本机实测 SHA-256：`e2934fb2846b9e27ca1ce93f2f6863615d1dc647f47ed0a52262d7ad38ab6600`（与官方清单一致）

**MCP 配置**（Claude Desktop）

配置文件：`C:\Users\noilinux\AppData\Local\Claude-3p\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "altare": {
      "command": "C:\\Users\\noilinux\\.local\\bin\\altr.exe",
      "args": ["mcp"]
    }
  }
}
```

`altr mcp` 通过 stdio 提供 MCP 服务，实测暴露 **134 个工具**，覆盖服务器、数据库、存储、域名、函数、网络等全部能力。

**Skill**

```bash
altr skill install     # 安装到 C:\Users\noilinux\.claude\skills\altare\SKILL.md
```

---

*本文档所有数字均取自 docs.altare.gg 官方页面与 `altr` CLI 实际输出。平台处于持续迭代中，执行前建议用 `altr <command> --help` 复核参数。*
