#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? join(import.meta.dirname, '..', 'release'))

if (!existsSync(dir)) {
  console.error(`目录不存在：${dir}`)
  process.exit(1)
}

function sha256(file) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolveHash(hash.digest('hex')))
  })
}

const files = readdirSync(dir)
  .filter((name) => !name.endsWith('.md') && name !== 'SHA256SUMS.txt')
  .sort()

const lines = []
for (const name of files) {
  const path = join(dir, name)
  if (!statSync(path).isFile()) continue
  lines.push(`${await sha256(path)}  ${name}`)
}

writeFileSync(join(dir, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8')
console.log(lines.join('\n'))
