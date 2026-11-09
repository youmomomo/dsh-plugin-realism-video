import { createWriteStream, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface DownloadOptions {
  allowedHosts: string[]
  signal?: AbortSignal
}

export function assertInside(base: string, target: string): void {
  const resolvedBase = resolve(base)
  const resolvedTarget = resolve(target)
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + sep)) {
    throw new Error(`path outside workspace: ${target}`)
  }
}

export async function downloadToFile(url: string, dest: string, opts: DownloadOptions): Promise<void> {
  const parsed = new URL(url)
  if (!opts.allowedHosts.includes(parsed.hostname)) {
    throw new Error(`host not allowed: ${parsed.hostname}`)
  }
  const res = await fetch(url, { signal: opts.signal })
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  if (!res.body) throw new Error('download failed: empty body')
  mkdirSync(dirname(dest), { recursive: true })
  const part = `${dest}.part`
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(part))
    renameSync(part, dest)
  } catch (err) {
    rmSync(part, { force: true })
    throw err
  }
}