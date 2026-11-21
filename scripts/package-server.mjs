#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = process.env.VERSION ?? pkg.version ?? '0.0.0'
const staging = join(root, 'release', `wepov-server-${version}`)
const outFile = join(root, 'release', `wepov-server-${version}.zip`)

rmSync(staging, { recursive: true, force: true })
rmSync(outFile, { force: true })
mkdirSync(staging, { recursive: true })

// 与 Dockerfile 同构：直接跑 TypeScript 源码（各 workspace 的 exports 都指向 ./src/index.ts），
// 因此不需要逐包编译，也不会出现 dist 路径不存在的问题。
const copies = [
  ['apps/api/src', 'apps/api/src'],
  ['apps/api/package.json', 'apps/api/package.json'],
  ['apps/web/dist', 'apps/web/dist'],
  ['packages', 'packages'],
  ['package.json', 'package.json'],
  ['package-lock.json', 'package-lock.json'],
  ['.npmrc', '.npmrc'],
  ['docker/start.sh', 'start.sh'],
]

for (const [from, to] of copies) {
  const source = join(root, from)
  if (!existsSync(source)) {
    if (from === '.npmrc' || from === 'apps/web/dist') {
      console.warn(`跳过可选路径：${from}`)
      continue
    }
    throw new Error(`缺少必需路径：${from}`)
  }
  cpSync(source, join(staging, to), { recursive: true })
}

// 打包后不需要 android 与 web 源码，删掉以缩小体积
rmSync(join(staging, 'packages/ui'), { recursive: true, force: true })

const runner = `#!/bin/sh
set -eu
: "\${PORT:=3000}"
export PORT
if [ ! -d node_modules ]; then
  npm ci --include=dev
fi
if [ -n "\${DATABASE_URL:-}" ]; then
  echo "[start] 执行数据库迁移"
  ./node_modules/.bin/tsx packages/database/src/migrate.ts
fi
exec ./node_modules/.bin/tsx apps/api/src/index.ts
`
writeFileSync(join(staging, 'start.sh'), runner, { mode: 0o755 })
writeFileSync(join(staging, 'Procfile'), 'web: sh start.sh\n', 'utf8')

execFileSync('zip', ['-qr', outFile, '.'], { cwd: staging })
console.log(`已生成 ${outFile}`)
