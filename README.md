# 第一人称 / WePOV

班级学生自治社区。完整设计见 [WePOV-软件B完整设计稿.md](WePOV-软件B完整设计稿.md)。

## 结构

```text
apps/
  web/        Preact 响应式前端（Web / PWA / Android 共用）
  api/        Fastify API 与静态托管
  android/    Capacitor 壳 + 原生强制更新器
packages/
  contracts/  API 契约与权限常量
  database/   迁移、查询、种子
  security/   会话、加密、限流、审计
  ui/         设计令牌
scripts/      打包、校验值、发布清单
.github/workflows/  CI、Release、Deploy
```

## 本地开发

```powershell
npm install
npm run db:migrate
npm run dev
```

本地只用于编写与调试，**正式构建全部在 GitHub Actions 完成**。

## 发布

打标签即发布：

```powershell
git tag v0.1.0
git push origin v0.1.0
```

Release 工作流会构建签名 APK、服务器包、`SHA256SUMS.txt`、`sbom.spdx.json` 和 `update-manifest.json`，并自动创建 GitHub Release。

## App 强制更新

App 与网页端唯一的功能差异。App 启动、回到前台、每 6 小时检查 `update-manifest.json`（多加速源自动切换），校验 SHA-256 与签名证书后拉起安装器；低于 `minSupportedVersionCode` 时全屏硬门禁，无法进入任何页面。网页端不做版本拦截。

## 必需的 GitHub Secrets

| 名称 | 用途 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 发布签名密钥（base64） |
| `ANDROID_KEY_ALIAS` | 密钥别名 |
| `ANDROID_KEY_PASSWORD` | 密钥密码 |
| `ANDROID_STORE_PASSWORD` | 密钥库密码 |
| `ALTR_TOKEN` | 部署到 Altare（可选） |

`ALTR_APP_NAME` 作为仓库变量配置。
