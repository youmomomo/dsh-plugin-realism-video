import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Aspect, StyleId } from '../config.js'
import type { ConsistencyCard } from '../storyboard.js'

const CACHE_DIR_NAME = 'characters'
const CACHE_KEY_PATTERN = /^[a-f0-9]{16}$/
const CACHE_KEY_LENGTH = 16

interface CacheEntry {
  url: string
  createdAt: number
}

function cachePath(workspace: string, key: string): string {
  if (!CACHE_KEY_PATTERN.test(key)) throw new Error(`invalid reference cache key: ${key}`)
  return join(workspace, CACHE_DIR_NAME, `${key}.json`)
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.url === 'string' && typeof entry.createdAt === 'number'
}

export function referenceCacheKey(card: ConsistencyCard, style: StyleId, aspect: Aspect): string {
  const material = JSON.stringify({ card, style, aspect })
  return createHash('sha256').update(material).digest('hex').slice(0, CACHE_KEY_LENGTH)
}

export function loadCachedReference(
  workspace: string,
  key: string,
  ttlMs: number,
  now: number = Date.now(),
): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(cachePath(workspace, key), 'utf8'))
  } catch {
    return null
  }
  if (!isCacheEntry(parsed)) return null
  if (now - parsed.createdAt > ttlMs) return null
  return parsed.url
}

export function saveCachedReference(
  workspace: string,
  key: string,
  url: string,
  now: number = Date.now(),
): void {
  const file = cachePath(workspace, key)
  mkdirSync(join(workspace, CACHE_DIR_NAME), { recursive: true })
  const tmp = `${file}.tmp`
  const entry: CacheEntry = { url, createdAt: now }
  writeFileSync(tmp, JSON.stringify(entry, null, 2), 'utf8')
  renameSync(tmp, file)
}