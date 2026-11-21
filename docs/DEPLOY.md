# 第一人称 / WePOV 部署清单

部署目标：Altare Always Free。**不在本地构建**，所有产物来自 GitHub Actions。

## 1. 前置

- GitHub 仓库：`ycyz2505/WePOV`，主分支 `main`
- Altare 团队：Default
- 无需自有域名，使用 `altr domains add` 免费获得 `<name>.altare.app`

## 2. 创建资源

本仓库不依赖「控制台里手工建的 App」。镜像由 GitHub Actions 推到 GHCR，`deploy.yml` 用 `altr docker create` 首次创建、之后 `altr docker set` + `redeploy` 更新。唯一前提是 GitHub 能拉取 GHCR 上的公开镜像——仓库若为私有，需要把 GHCR 包设为 Public（Package settings → Change visibility）。

```bash
altr postgres create wepov --size micro
altr u3 create wepov-media
altr u3 create wepov-logs
altr u3 create wepov-export
```

应用第一次部署成功后：

```bash
altr postgres attach wepov <app>
altr u3 attach wepov-media <app>
altr u3 attach wepov-logs <app>
altr u3 attach wepov-export <app>
altr domains add <app> wepov
```

`altr domains add <app> wepov` 会得到免费的 `wepov.altare.app`（重名时自动加后缀）。无需购买域名。

`altr postgres attach` / `altr u3 attach` 会注入连接串与对象存储变量并触发一次重启，所以顺序必须是「先部署、再 attach」。

## 3. 应用环境变量

由 `altr attach` 自动注入数据库与 U3 变量。其余必须手动设置：

| 变量 | 说明 |
|---|---|
| `SESSION_PEPPER` | 32 字节随机值，**必填** |
| `DATA_ENCRYPTION_KEY` | base64 编码的 32 字节密钥 |
| `DATA_ENCRYPTION_KEY_VERSION` | 默认 1，轮换时递增 |
| `TREE_IDENTITY_HMAC_KEY` | 32 字节随机值，与上一项不同 |
| `CLASS_GATEWAY_PEPPER` | 32 字节随机值 |
| `MAINTENANCE_SIGNING_SECRET` | 32 字节随机值 |
| `PUBLIC_ORIGIN` | 正式访问地址，例如 `https://wepov.altare.app` |
| `GITHUB_REPO` | `ycyz2505/WePOV`，用于拼 Release 清单地址 |
| `UPDATE_MANIFEST_URL` | 可选，显式指定清单地址（优先于 `GITHUB_REPO`） |
| `UPDATE_MANIFEST_MIRRORS` | 逗号分隔的下载加速前缀，App 按顺序回退 |
| `UPDATE_MANIFEST_CACHE_SECONDS` | 清单缓存秒数，默认 300 |
| `MIN_APP_VERSION_CODE` | 服务端版本门禁，默认 0（网页不受影响） |
| `BODY_LIMIT_BYTES` | 请求体上限，默认 1 MiB |
| `MEDIA_QUOTA_BYTES` | 全班媒体总配额，默认约 9.2 GiB |
| `LOG_LEVEL` | 默认 `info`，生产不要设 `debug` |
| `U3_FORCE_PATH_STYLE` | 默认 `true` |
| `U3_PRESIGN_EXPIRY_SECONDS` | 预签名有效期，默认 900 |
| `TRUSTED_PROXY_HOPS` | 仅在能确认代理可信时大于 0 |

`PASSWORD_MATCH_KEY`、`ABUSE_HMAC_KEY`、`LOG_IP_HMAC_KEY` 留空时会由 `SESSION_PEPPER` 经 HKDF 派生；分别独立设置可以让单个密钥泄露的影响面更小。

生成随机值（本机一次性执行，不要提交）：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 4. 首次迁移与初始化

容器启动时 `docker/start.sh` 会自动执行迁移（幂等，多实例由 advisory lock 串行化）。首次还需播种班级与总管理员：

```bash
altr logs <app>            # 取 DATABASE_URL 之外的运行状态
DATABASE_URL="<生产连接串>" SEED_GATEWAY_PASSCODE="<自定义班级口令>" npm run db:seed
```

`db:seed` 只在本地或 CI 跑一次，不要在容器里重复执行。种子脚本会创建班级、生成班级口令与总管理员初始密码。**这些值只显示一次**，请立即离线保存。

生产连接串在控制台 Database → wepov → Connection string 查看；`altr postgres` 子命令不会把密码打印到终端。

## 5. GitHub 配置

Secrets：

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_STORE_PASSWORD`
- `ALTR_TOKEN`（本机执行 `altr token` 得到）

Variables：

- `ALTR_APP_NAME`（例如 `wepov`）

另需在仓库 Settings → Actions → General 允许 Actions 创建 Pull Request 之外无需额外权限；镜像推送到 GHCR 使用内置 `GITHUB_TOKEN`，不需要额外 secret。

## 6. 生成签名密钥（只做一次）

```bash
keytool -genkeypair -v -keystore wepov-release.jks -alias wepov \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass <密码> -keypass <密码> -dname "CN=WePOV, O=WePOV, C=CN"
```

转 base64 后写入 `ANDROID_KEYSTORE_BASE64`。**此密钥必须永久保存**：更换后老版本无法覆盖安装，只能卸载重装。

## 7. 发布

```bash
git tag v0.1.0
git push origin v0.1.0
```

工作流自动创建 Release，并把 `update-manifest.json` 推送到 `latest` 分支，App 从该分支读取版本信息。

## 8. 验证

- `/health` 返回 200
- `/ready` 报告数据库与 U3 状态
- 未输入班级口令时页面与标题无产品信息
- 临时登录关闭标签后失效
- 低于 `minSupportedVersionCode` 的 App 收到 426
