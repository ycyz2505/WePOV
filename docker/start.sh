#!/bin/sh
set -eu

: "${PORT:=3000}"
export PORT

# Altare 的数据库域名只在平台内网 DNS 里存在。若容器默认 resolver
# 没拿到该 zone，直接向团队 DNS 查询 A 记录，并通过环境变量交给 pg；
# /etc/resolv.conf 和 /etc/hosts 都是只读挂载，不能修改。
if [ -n "${DATABASE_URL:-}" ]; then
  DBHOST=$(node -e "try{console.log(new URL(process.env.DATABASE_URL).hostname)}catch{process.exit(1)}" 2>/dev/null || true)
  if [ -n "${DBHOST:-}" ] && ! getent hosts "$DBHOST" >/dev/null 2>&1; then
    echo "[start] $DBHOST 默认解析失败，查询 Altare 网络 DNS 100.100.100.100"
    DATABASE_RESOLVED_IP=$(dig +short @100.100.100.100 "$DBHOST" A 2>/dev/null | tail -1 || true)
    export DATABASE_RESOLVED_IP
    if [ -n "${DATABASE_RESOLVED_IP:-}" ]; then
      echo "[start] 内网 DNS 已返回数据库地址"
    else
      echo "[start] Altare 网络 DNS 仍未返回 $DBHOST" >&2
    fi
  fi
fi

# 迁移是幂等的：多实例同时启动时由 advisory lock 串行化。
if [ -n "${DATABASE_URL:-}" ]; then
  echo "[start] 执行数据库迁移"
  ./node_modules/.bin/tsx packages/database/src/migrate.ts
else
  echo "[start] 未设置 DATABASE_URL，跳过迁移" >&2
fi

# 首次部署时设 BOOTSTRAP_SEED=1，建班并创建总管理员；seed 自身幂等，
# 班级已存在时直接回滚，不会重复创建。初始化完成后建议移除该变量。
if [ "${BOOTSTRAP_SEED:-}" = "1" ] && [ -n "${DATABASE_URL:-}" ]; then
  echo "[start] 初始化班级数据"
  ./node_modules/.bin/tsx packages/database/src/seed.ts
fi

exec ./node_modules/.bin/tsx apps/api/src/index.ts
