/**
 * Minimal streaming ZIP writer. Emits a valid ZIP archive without buffering the
 * whole archive in memory. Supports two sinks: File System Access API writable
 * stream (true streaming to disk) or an in-memory Blob (fallback).
 */

export interface ZipEntryInput {
  filename: string
  data: Blob
}

interface Sink {
  write: (chunk: Uint8Array) => Promise<void>
  close: () => Promise<void>
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] ?? 0
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day =
    (((date.getFullYear() - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: day }
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let counter = 2
  let candidate = `${base} (${counter})${ext}`
  while (used.has(candidate)) {
    counter += 1
    candidate = `${base} (${counter})${ext}`
  }
  used.add(candidate)
  return candidate
}

class MemorySink implements Sink {
  private readonly chunks: Uint8Array[] = []
  async write(chunk: Uint8Array): Promise<void> {
    this.chunks.push(chunk.slice())
  }
  async close(): Promise<void> {
    /* noop */
  }
  toBlob(): Blob {
    return new Blob(this.chunks as BlobPart[], { type: 'application/zip' })
  }
}

interface WritableStreamLike {
  write: (chunk: Uint8Array) => Promise<void>
  close: () => Promise<void>
}

class StreamSink implements Sink {
  constructor(private readonly writer: WritableStreamLike) {}
  async write(chunk: Uint8Array): Promise<void> {
    await this.writer.write(chunk)
  }
  async close(): Promise<void> {
    await this.writer.close()
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.length
  }
  return merged
}

export interface ZipProgress {
  completed: number
  total: number
  filename: string
}

async function buildZip(
  entries: ZipEntryInput[],
  sink: Sink,
  onProgress?: (progress: ZipProgress) => void,
): Promise<void> {
  const encoder = new TextEncoder()
  const usedNames = new Set<string>()
  const central: Uint8Array[] = []
  let offset = 0
  const now = new Date()
  const stamp = dosDateTime(now)

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) continue
    const name = uniqueName(entry.filename, usedNames)
    const nameBytes = encoder.encode(name)
    const dataBytes = new Uint8Array(await entry.data.arrayBuffer())
    const crc = crc32(dataBytes)
    const size = dataBytes.length

    const localHeader = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(localHeader.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0x0800, true)
    localView.setUint16(8, 0, true)
    localView.setUint16(10, stamp.time, true)
    localView.setUint16(12, stamp.date, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, size, true)
    localView.setUint32(22, size, true)
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true)
    localHeader.set(nameBytes, 30)

    await sink.write(localHeader)
    await sink.write(dataBytes)
    offset += localHeader.length + size

    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(centralHeader.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, stamp.time, true)
    centralView.setUint16(14, stamp.date, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, size, true)
    centralView.setUint32(24, size, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, 0, true)
    centralHeader.set(nameBytes, 46)
    central.push(centralHeader)

    onProgress?.({ completed: index + 1, total: entries.length, filename: name })
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  await sink.write(concat(central))

  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(4, 0, true)
  endView.setUint16(6, 0, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  endView.setUint16(20, 0, true)
  await sink.write(end)
}

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window
}

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName?: string
    types?: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<{ createWritable: () => Promise<WritableStreamLike> }>
}

export async function zipToDisk(
  entries: ZipEntryInput[],
  suggestedName: string,
  onProgress?: (progress: ZipProgress) => void,
): Promise<'saved' | 'fallback'> {
  const pickerWindow = window as SaveFilePickerWindow
  if (!pickerWindow.showSaveFilePicker) return 'fallback'
  try {
    const handle = await pickerWindow.showSaveFilePicker({
      suggestedName,
      types: [{ description: 'ZIP 压缩包', accept: { 'application/zip': ['.zip'] } }],
    })
    const writable = await handle.createWritable()
    const sink = new StreamSink(writable)
    await buildZip(entries, sink, onProgress)
    await sink.close()
    return 'saved'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'saved'
    return 'fallback'
  }
}

export async function zipToBlob(
  entries: ZipEntryInput[],
  onProgress?: (progress: ZipProgress) => void,
): Promise<Blob> {
  const sink = new MemorySink()
  await buildZip(entries, sink, onProgress)
  return sink.toBlob()
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function downloadUrl(url: string, filename: string): Promise<void> {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('下载失败')
  const blob = await response.blob()
  downloadBlob(blob, filename)
}
