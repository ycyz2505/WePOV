#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const releaseDir = join(root, 'release')
const version = process.env.VERSION
const versionCode = Number(process.env.VERSION_CODE ?? '0')
const minSupported = Number(process.env.MIN_SUPPORTED ?? '0')
const repo = process.env.REPO ?? 'ycyz2505/WePOV'
const tag = process.env.TAG ?? `v${version}`

if (!version || !Number.isFinite(versionCode) || versionCode <= 0) {
  console.error('缺少 VERSION 或 VERSION_CODE')
  process.exit(1)
}

mkdirSync(releaseDir, { recursive: true })

const apkName = `wepov-android-${version}.apk`
const apkPath = join(releaseDir, apkName)
if (!existsSync(apkPath)) {
  console.error(`找不到 APK：${apkPath}`)
  process.exit(1)
}

async function sha256(file) {
  return await new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolveHash(hash.digest('hex')))
  })
}

const apkSha = await sha256(apkPath)

const assets = readdirSync(releaseDir)
  .filter((name) => !name.endsWith('.md') && name !== 'SHA256SUMS.txt' && name !== 'update-manifest.json')
  .sort()

const sums = []
for (const name of assets) {
  const path = join(releaseDir, name)
  if (!statSync(path).isFile()) continue
  sums.push(`${await sha256(path)}  ${name}`)
}
writeFileSync(join(releaseDir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`, 'utf8')

const releaseDownload = `https://github.com/${repo}/releases/download/${tag}/${apkName}`
const manifest = {
  versionCode,
  versionName: version,
  minSupportedVersionCode: minSupported,
  apkUrl: releaseDownload,
  apkSha256: apkSha,
  mirrors: [
    releaseDownload,
    `https://ghproxy.net/${releaseDownload}`,
    `https://gh-proxy.com/${releaseDownload}`,
    `https://ghfast.top/${releaseDownload}`,
    `https://github.moeyy.xyz/${releaseDownload}`,
  ],
  releaseNotes: '',
  publishedAt: new Date().toISOString(),
}

const notesCandidates = [
  join(root, 'CHANGELOG.md'),
  join(releaseDir, 'release-notes.md'),
]
let notes = ''
for (const candidate of notesCandidates) {
  if (existsSync(candidate)) {
    notes = await readFile(candidate, 'utf8')
    break
  }
}
if (!notes) {
  try {
    notes = execFileSync('git', ['log', '-1', '--pretty=%B'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    notes = ''
  }
}
manifest.releaseNotes = notes.slice(0, 8000)

writeFileSync(join(releaseDir, 'update-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

if (notes) {
  writeFileSync(join(releaseDir, 'release-notes.md'), notes, 'utf8')
}

const sbom = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `wepov-${version}`,
  documentNamespace: `https://github.com/${repo}/releases/${tag}/sbom`,
  creationInfo: {
    created: new Date().toISOString(),
    creators: ['Tool: wepov-release-script'],
  },
  packages: [
    {
      SPDXID: 'SPDXRef-Package-WePOV',
      name: 'WePOV',
      versionInfo: version,
      downloadLocation: `https://github.com/${repo}`,
      filesAnalyzed: false,
      licenseConcluded: 'NOASSERTION',
      licenseDeclared: 'NOASSERTION',
      supplier: 'NOASSERTION',
    },
  ],
}
writeFileSync(join(releaseDir, 'sbom.spdx.json'), `${JSON.stringify(sbom, null, 2)}\n`, 'utf8')

console.log(`已生成清单：${apkName} ${apkSha}`)
