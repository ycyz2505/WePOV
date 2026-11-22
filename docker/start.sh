#!/bin/sh
set -eu

: "${PORT:=3000}"
export PORT

# Altare 的数据库域名只在平台内网 DNS 里存在。若容器没拿到该解析器，
# getaddrinfo 会直接 ENOTFOUND；把团队 DNS 放到第一位再试一次。
if [ -n "${DATABASE_URL:-}" ]; then
  DBHOST=$(node -e "try{console.log(new URL(process.env.DATABASE_URL).hostname)}catch{process.exit(1)}" 2>/dev/null || true)
  if [ -n "${DBHOST:-}" ] && ! getent hosts "$DBHOST" >/dev/null 2>&1; then
    echo "[start] $DBHOST 解析失败，改用 Altare 网络 DNS 100.100.100.100"
    { echo "nameserver 100.100.100.100"; cat /etc/resolv.conf; } > /tmp/resolv.conf.new 2>/dev/null || true
    if [ -s /tmp/resolv.conf.new ]; then
      cat /tmp/resolv.conf.new > /etc/resolv.conf
    fi
    if getent hosts "$DBHOST" >/dev/null 2>&1; then
      echo "[start] 解析成功"
    else
      echo "[start] 仍然无法解析 $DBHOST"
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
