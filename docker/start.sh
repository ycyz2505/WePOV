#!/bin/sh
set -eu

: "${PORT:=3000}"
export PORT

# 迁移是幂等的：多实例同时启动时由 advisory lock 串行化。
if [ -n "${DATABASE_URL:-}" ]; then
  echo "[start] 执行数据库迁移"
  ./node_modules/.bin/tsx packages/database/src/migrate.ts
else
  echo "[start] 未设置 DATABASE_URL，跳过迁移" >&2
fi

exec ./node_modules/.bin/tsx apps/api/src/index.ts
