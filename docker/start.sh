#!/bin/sh
set -eu

: "${PORT:=3000}"
export PORT

WAIT_PID=""
start_wait_server() {
  node -e '
    const http = require("node:http")
    const port = Number(process.env.PORT || 3000)
    const server = http.createServer((req, res) => {
      res.writeHead(req.url === "/health" ? 200 : 503, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "retry-after": "10",
      })
      res.end(JSON.stringify(
        req.url === "/health"
          ? { status: "starting", uptimeSeconds: Math.round(process.uptime()) }
          : { code: "starting", message: "服务正在连接数据库，请稍后重试" },
      ))
    })
    server.listen(port, "0.0.0.0")
  ' &
  WAIT_PID=$!
  echo "[start] 临时健康检查已监听 $PORT"
}

stop_wait_server() {
  if [ -n "$WAIT_PID" ]; then
    kill "$WAIT_PID" 2>/dev/null || true
    wait "$WAIT_PID" 2>/dev/null || true
    WAIT_PID=""
  fi
}

# Altare 的数据库域名只在平台内网 DNS 里存在。Docker 容器的
# resolv.conf/hosts 都是只读挂载，因此直接查询团队 DNS，把合法 A 记录
# 交给 pg；等待期间先监听健康检查端口，让平台私网节点保持 online。
if [ -n "${DATABASE_URL:-}" ]; then
  DBHOST=$(node -e "try{console.log(new URL(process.env.DATABASE_URL).hostname)}catch{process.exit(1)}" 2>/dev/null || true)
  if [ -n "${DBHOST:-}" ] && ! getent hosts "$DBHOST" >/dev/null 2>&1; then
    start_wait_server
    echo "[start] $DBHOST 默认解析失败，等待 Altare 网络 DNS 100.100.100.100"
    attempt=1
    while [ "$attempt" -le 60 ]; do
      # Docker 网络可能拦截 UDP/53，但团队 DNS 的 TCP/53 可用；先 TCP，
      # 无结果再回退 UDP。只接受严格 IPv4，绝不把 dig 错误文本当地址。
      LOOKUP=$(dig +tcp +time=3 +tries=1 +short @100.100.100.100 "$DBHOST" A 2>/dev/null || true)
      if [ -z "$LOOKUP" ]; then
        LOOKUP=$(dig +time=3 +tries=1 +short @100.100.100.100 "$DBHOST" A 2>/dev/null || true)
      fi
      DATABASE_RESOLVED_IP=$(printf '%s\n' "$LOOKUP" | grep -E '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' | tail -1 || true)
      if [ -n "${DATABASE_RESOLVED_IP:-}" ]; then
        export DATABASE_RESOLVED_IP
        echo "[start] 内网 DNS 已返回有效数据库地址（第 $attempt 次）"
        break
      fi
      if [ "$attempt" -eq 1 ] || [ $((attempt % 10)) -eq 0 ]; then
        echo "[start] 团队 DNS 暂未返回数据库地址（第 $attempt 次）"
      fi
      attempt=$((attempt + 1))
      sleep 5
    done
    if [ -z "${DATABASE_RESOLVED_IP:-}" ]; then
      echo "[start] 等待 5 分钟后仍无数据库 A 记录" >&2
      stop_wait_server
      exit 1
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

stop_wait_server
exec ./node_modules/.bin/tsx apps/api/src/index.ts
