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

# 首次部署时设 BOOTSTRAP_SEED=1，建班并创建总管理员；seed 自身幂等，
# 班级已存在时直接回滚，不会重复创建。初始化完成后建议移除该变量。
if [ "${BOOTSTRAP_SEED:-}" = "1" ] && [ -n "${DATABASE_URL:-}" ]; then
  echo "[start] 初始化班级数据"
  ./node_modules/.bin/tsx packages/database/src/seed.ts
fi

exec ./node_modules/.bin/tsx apps/api/src/index.ts
