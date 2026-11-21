import type { UploadTier } from './types'

export interface TierPreset {
  label: string
  maxEdge: number | null
  quality: number | null
  targetBytes: number | null
  description: string
}

export const TIER_PRESETS: Record<UploadTier, TierPreset> = {
  original: {
    label: '原图',
    maxEdge: null,
    quality: null,
    targetBytes: null,
    description: '不缩放，保留原始像素；会移除 GPS 等隐私信息。',
  },
  high: {
    label: '高清',
    maxEdge: 2560,
    quality: 0.85,
    targetBytes: null,
    description: '长边约 2560 px，WebP 质量约 85。',
  },
  standard: {
    label: '标准',
    maxEdge: 1920,
    quality: 0.8,
    targetBytes: null,
    description: '长边约 1920 px，WebP 质量约 80。',
  },
  compact: {
    label: '省空间',
    maxEdge: 1280,
    quality: 0.75,
    targetBytes: null,
    description: '长边约 1280 px，WebP 质量约 75。',
  },
  custom: {
    label: '自定义',
    maxEdge: 1920,
    quality: null,
    targetBytes: 500 * 1024,
    description: '按目标体积在浏览器内二分搜索编码质量。',
  },
}

export interface EncodedImage {
  blob: Blob
  mime: string
  width: number
  height: number
  bytes: number
  sha256: string
}

export interface CompressOptions {
  tier: UploadTier
  targetBytes?: number
  cropAspect?: number
}

function supportsWebp(): boolean {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  return canvas.toDataURL('image/webp').startsWith('data:image/webp')
}

let webpSupport: boolean | null = null
function canEncodeWebp(): boolean {
  if (webpSupport === null) webpSupport = supportsWebp()
  return webpSupport
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法读取这张图片，请换一张试试'))
    }
    image.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('图片编码失败'))
      },
      mime,
      quality,
    )
  })
}

function drawToCanvas(
  image: HTMLImageElement,
  maxEdge: number | null,
  cropAspect: number | undefined,
): HTMLCanvasElement {
  let sourceX = 0
  let sourceY = 0
  let sourceWidth = image.naturalWidth
  let sourceHeight = image.naturalHeight

  if (cropAspect) {
    const currentAspect = sourceWidth / sourceHeight
    if (currentAspect > cropAspect) {
      sourceWidth = Math.round(sourceHeight * cropAspect)
      sourceX = Math.round((image.naturalWidth - sourceWidth) / 2)
    } else {
      sourceHeight = Math.round(sourceWidth / cropAspect)
      sourceY = Math.round((image.naturalHeight - sourceHeight) / 2)
    }
  }

  let targetWidth = sourceWidth
  let targetHeight = sourceHeight
  if (maxEdge !== null) {
    const longest = Math.max(sourceWidth, sourceHeight)
    if (longest > maxEdge) {
      const scale = maxEdge / longest
      targetWidth = Math.round(sourceWidth * scale)
      targetHeight = Math.round(sourceHeight * scale)
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器不支持图片处理')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    targetWidth,
    targetHeight,
  )
  return canvas
}

async function sha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function encodeImage(
  file: File,
  options: CompressOptions,
): Promise<EncodedImage> {
  const image = await loadImage(file)
  const preset = TIER_PRESETS[options.tier]
  const mime = canEncodeWebp() ? 'image/webp' : 'image/jpeg'

  if (options.tier === 'original' && !options.cropAspect) {
    const sha256 = await sha256Hex(file)
    return {
      blob: file,
      mime: file.type || mime,
      width: image.naturalWidth,
      height: image.naturalHeight,
      bytes: file.size,
      sha256,
    }
  }

  const canvas = drawToCanvas(image, preset.maxEdge, options.cropAspect)

  if (options.tier === 'custom') {
    const target = options.targetBytes ?? preset.targetBytes ?? 500 * 1024
    let low = 0.4
    let high = 0.92
    let best = await canvasToBlob(canvas, mime, high)
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const mid = (low + high) / 2
      const candidate = await canvasToBlob(canvas, mime, mid)
      best = candidate
      if (candidate.size > target) high = mid
      else low = mid
      if (Math.abs(candidate.size - target) < target * 0.05) break
    }
    const sha256 = await sha256Hex(best)
    return {
      blob: best,
      mime,
      width: canvas.width,
      height: canvas.height,
      bytes: best.size,
      sha256,
    }
  }

  const quality = preset.quality ?? 0.82
  const blob = await canvasToBlob(canvas, mime, quality)
  const sha256 = await sha256Hex(blob)
  return {
    blob,
    mime,
    width: canvas.width,
    height: canvas.height,
    bytes: blob.size,
    sha256,
  }
}

export async function estimateEncodedSize(file: File, options: CompressOptions): Promise<number> {
  try {
    const encoded = await encodeImage(file, options)
    return encoded.bytes
  } catch {
    return file.size
  }
}

export interface AvatarResult {
  blob: Blob
  mime: string
  width: number
  height: number
  bytes: number
  withinLimit: boolean
}

const AVATAR_MAX = 40 * 1024
const BACKGROUND_MAX = 120 * 1024

export async function processAvatar(file: File): Promise<AvatarResult> {
  const image = await loadImage(file)
  const mime = canEncodeWebp() ? 'image/webp' : 'image/jpeg'
  const canvas = drawToCanvas(image, 256, 1)
  let quality = 0.9
  let blob = await canvasToBlob(canvas, mime, quality)
  while (blob.size > AVATAR_MAX && quality > 0.4) {
    quality -= 0.1
    blob = await canvasToBlob(canvas, mime, quality)
  }
  return {
    blob,
    mime,
    width: canvas.width,
    height: canvas.height,
    bytes: blob.size,
    withinLimit: blob.size <= AVATAR_MAX,
  }
}

export async function processBackground(file: File): Promise<AvatarResult> {
  const image = await loadImage(file)
  const mime = canEncodeWebp() ? 'image/webp' : 'image/jpeg'
  const canvas = drawToCanvas(image, 960, 3)
  let quality = 0.88
  let blob = await canvasToBlob(canvas, mime, quality)
  while (blob.size > BACKGROUND_MAX && quality > 0.4) {
    quality -= 0.08
    blob = await canvasToBlob(canvas, mime, quality)
  }
  return {
    blob,
    mime,
    width: canvas.width,
    height: canvas.height,
    bytes: blob.size,
    withinLimit: blob.size <= BACKGROUND_MAX,
  }
}
