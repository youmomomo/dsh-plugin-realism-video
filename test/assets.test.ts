import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { assertInside, downloadToFile } from '../src/assets/download.js'
import { readManifest, updateShot, writeManifest } from '../src/store/manifest.js'
import { tempWorkspace } from './helpers.js'

describe('assertInside', () => {
  it('accepts a nested path', () => {
    const ws = tempWorkspace()
    expect(() => assertInside(ws, join(ws, 'job', 'shot-01.mp4'))).not.toThrow()
  })
  it('rejects traversal', () => {
    const ws = tempWorkspace()
    expect(() => assertInside(ws, join(ws, '..', 'x'))).toThrow(/outside workspace/)
  })
})

describe('downloadToFile', () => {
  it('writes atomically and leaves no part file', async () => {
    const server = createServer((_req, res) => { res.end('video-bytes') })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const ws = tempWorkspace()
    const dest = join(ws, 'shot-01.mp4')
    await downloadToFile(`http://127.0.0.1:${port}/v.mp4`, dest, { allowedHosts: ['127.0.0.1'] })
    expect(readFileSync(dest, 'utf8')).toBe('video-bytes')
    expect(existsSync(`${dest}.part`)).toBe(false)
    server.close()
  })

  it('rejects non-2xx responses and removes the part file', async () => {
    const server = createServer((_req, res) => { res.statusCode = 404; res.end('missing') })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const ws = tempWorkspace()
    const dest = join(ws, 'shot-02.mp4')
    await expect(downloadToFile(`http://127.0.0.1:${port}/v.mp4`, dest, { allowedHosts: ['127.0.0.1'] }))
      .rejects.toThrow(/download failed/)
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
    server.close()
  })

  it('rejects hosts outside the allow list', async () => {
    const ws = tempWorkspace()
    await expect(downloadToFile('http://evil.test/v.mp4', join(ws, 'x.mp4'), { allowedHosts: ['127.0.0.1'] }))
      .rejects.toThrow(/host not allowed/)
  })
})

describe('manifest', () => {
  it('round-trips and updates a single shot', () => {
    const ws = tempWorkspace()
    writeManifest(ws, {
      schemaVersion: 1, jobId: 'job_1', provider: 'kling', style: 'cinematic-real',
      aspect: '16:9', resolution: '1080p', createdAt: '2026-11-08T00:00:00.000Z',
      shots: [{ index: 1, file: 'shot-01.mp4', status: 'pending', prompt: 'p' }],
      totalCostCny: null, failures: [],
    } as never)
    updateShot(ws, 'job_1', 1, { status: 'done', costCny: 3.5 })
    const m = readManifest(ws, 'job_1')
    expect(m?.shots[0].status).toBe('done')
    expect(m?.shots[0].costCny).toBe(3.5)
  })

  it('returns null for unknown job', () => {
    expect(readManifest(tempWorkspace(), 'job_x')).toBeNull()
  })

  it('rejects an invalid job id', () => {
    const ws = tempWorkspace()
    expect(() => readManifest(ws, '../escape')).toThrow(/invalid job id/)
  })

  it('throws when updating a missing shot', () => {
    const ws = tempWorkspace()
    writeManifest(ws, {
      schemaVersion: 1, jobId: 'job_3', provider: 'kling', style: 'cinematic-real',
      aspect: '16:9', resolution: '1080p', createdAt: '2026-11-08T00:00:00.000Z',
      shots: [], totalCostCny: null, failures: [],
    } as never)
    expect(() => updateShot(ws, 'job_3', 1, { status: 'done' })).toThrow(/shot 1 not found/)
  })

  it('leaves no tmp file behind', () => {
    const ws = tempWorkspace()
    writeManifest(ws, {
      schemaVersion: 1, jobId: 'job_2', provider: 'kling', style: 'cinematic-real',
      aspect: '16:9', resolution: '1080p', createdAt: '2026-11-08T00:00:00.000Z',
      shots: [], totalCostCny: null, failures: [],
    } as never)
    expect(existsSync(join(ws, 'job_2', 'manifest.json.tmp'))).toBe(false)
  })
})