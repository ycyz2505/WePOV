import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { loadManifest, clearManifestCache, type UpdateManifest } from '../src/lib/manifest.js'

/**
 * The update manifest is consumed by both the Preact updater and the Android
 * client, so its shape is a hard contract: `apkUrl` is one string and `mirrors`
 * is a separate array. These tests pin that shape and the fallback behaviour.
 */

function fakeApp(url: string | null, mirrors: string[] = ['https://mirror.example/']) {
  return {
    config: {
      minAppVersionCode: 7,
      manifest: { url, repo: null, cacheSeconds: 30, mirrors },
    },
  } as unknown as Parameters<typeof loadManifest>[0]
}

async function serve(body: unknown): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}/update-manifest.json` }
}

test('an upstream manifest is passed through with its shape intact', async () => {
  clearManifestCache()
  const upstream = {
    versionCode: 12,
    versionName: '1.2.0',
    minSupportedVersionCode: 9,
    apkUrl: 'https://github.com/o/r/releases/download/v1.2.0/wepov.apk',
    apkSha256: 'f'.repeat(64),
    releaseNotes: '修复若干问题',
    publishedAt: '2026-11-01T00:00:00.000Z',
    mirrors: ['https://ghproxy.net/x'],
  }
  const { server, url } = await serve(upstream)
  try {
    const manifest = await loadManifest(fakeApp(url))
    assert.deepEqual(manifest, upstream satisfies UpdateManifest)
  } finally {
    server.close()
    clearManifestCache()
  }
})

test('mirrors fall back to configured prefixes when the release has none', async () => {
  clearManifestCache()
  const { server, url } = await serve({ versionCode: 3, versionName: '0.3.0', apkUrl: 'x' })
  try {
    const manifest = await loadManifest(fakeApp(url, ['https://a.example/', 'https://b.example/']))
    assert.deepEqual(manifest.mirrors, ['https://a.example/', 'https://b.example/'])
    assert.equal(manifest.minSupportedVersionCode, 7, 'falls back to config min version')
  } finally {
    server.close()
    clearManifestCache()
  }
})

test('an invalid upstream manifest yields a usable default', async () => {
  clearManifestCache()
  const { server, url } = await serve({ nope: true })
  try {
    const manifest = await loadManifest(fakeApp(url))
    assert.equal(manifest.versionCode, 0)
    assert.equal(manifest.minSupportedVersionCode, 7)
    assert.ok(Array.isArray(manifest.mirrors))
  } finally {
    server.close()
    clearManifestCache()
  }
})

test('an unreachable manifest source does not throw', async () => {
  clearManifestCache()
  const manifest = await loadManifest(fakeApp('http://127.0.0.1:1/update-manifest.json'))
  assert.equal(manifest.versionCode, 0)
  assert.equal(manifest.minSupportedVersionCode, 7)
})

test('with no source configured the default manifest is returned', async () => {
  clearManifestCache()
  const manifest = await loadManifest(fakeApp(null, ['https://m1/']))
  assert.equal(manifest.versionName, '0.0.0')
  assert.deepEqual(manifest.mirrors, ['https://m1/'])
})

test('a cached manifest is reused within the cache window', async () => {
  clearManifestCache()
  let hits = 0
  const server = createServer((_req, res) => {
    hits += 1
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ versionCode: 1, versionName: '0.1.0' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    const app = fakeApp(`http://127.0.0.1:${port}/update-manifest.json`)
    await loadManifest(app)
    await loadManifest(app)
    await loadManifest(app)
    assert.equal(hits, 1)
  } finally {
    server.close()
    clearManifestCache()
  }
})
