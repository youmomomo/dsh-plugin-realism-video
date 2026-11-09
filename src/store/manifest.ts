import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Aspect, Resolution, StyleId } from '../config.js'

export type ShotStatus = 'pending' | 'reference' | 'running' | 'done' | 'failed' | 'planned' | 'cancelled'

export interface ManifestShot {
  index: number
  file: string
  status: ShotStatus
  prompt: string
  seed?: number
  taskId?: string
  costCny?: number | null
}

export interface ManifestFailure {
  index: number
  code: string
  message: string
}

export interface Manifest {
  schemaVersion: 1
  jobId: string
  provider: string
  style: StyleId
  aspect: Aspect
  resolution: Resolution
  createdAt: string
  shots: ManifestShot[]
  totalCostCny: number | null
  warnings: string[]
  failures: ManifestFailure[]
}

const JOB_ID_PATTERN = /^[a-z0-9_]{1,64}$/
const MANIFEST_FILE = 'manifest.json'

function jobDir(workspace: string, jobId: string): string {
  if (!JOB_ID_PATTERN.test(jobId)) throw new Error(`invalid job id: ${jobId}`)
  return join(workspace, jobId)
}

function manifestPath(workspace: string, jobId: string): string {
  return join(jobDir(workspace, jobId), MANIFEST_FILE)
}

export function writeManifest(workspace: string, m: Manifest): void {
  const file = manifestPath(workspace, m.jobId)
  mkdirSync(jobDir(workspace, m.jobId), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(m, null, 2), 'utf8')
  renameSync(tmp, file)
}

export function readManifest(workspace: string, jobId: string): Manifest | null {
  const file = manifestPath(workspace, jobId)
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Manifest
  } catch {
    return null
  }
}

export function updateShot(
  workspace: string,
  jobId: string,
  index: number,
  patch: Partial<ManifestShot>,
): void {
  const m = readManifest(workspace, jobId)
  if (!m) throw new Error(`manifest not found for ${jobId}`)
  const shot = m.shots.find((s) => s.index === index)
  if (!shot) throw new Error(`shot ${index} not found in ${jobId}`)
  Object.assign(shot, patch)
  writeManifest(workspace, m)
}