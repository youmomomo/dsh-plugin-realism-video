import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Config } from '../src/config.js'
import { savePlan } from '../src/store/plans.js'
import type { Manifest } from '../src/store/manifest.js'
import type { VideoProvider } from '../src/provider/types.js'
import { registerGenerateTool, runJob, type JobDeps } from '../src/tools/generate.js'
import { createFakeCtx, tempWorkspace } from './helpers.js'

const klingMock = vi.hoisted(() => ({ createKlingProvider: vi.fn() }))

vi.mock('../src/provider/kling/index.js', () => ({
  createKlingProvider: klingMock.createKlingProvider,
}))

interface ToolLike {
  execute(args: unknown, exec: unknown): Promise<unknown>
}

function makePlan(ws: string): void {
  savePlan(ws, {
    planId: 'pl_1',
    createdAt: '2026-11-08T00:00:00.000Z',
    style: 'cinematic-real',
    aspect: '16:9',
    resolution: '1080p',
    shots: [
      {
        index: 1, beat: 'establishing', durationSec: 5, prompt: 'p1', negativePrompt: 'n',
        camera: 'c', lighting: 'l', estimatedCostCny: 1,
      },
      {
        index: 2, beat: 'medium', durationSec: 5, prompt: 'p2', negativePrompt: 'n',
        camera: 'c', lighting: 'l', estimatedCostCny: 1,
      },
    ],
    totalEstimatedCostCny: 2,
    card: {
      characterId: 'ch_1',
      character: { ageRange: '30', face: 'f', hair: 'h', build: 'b', wardrobe: 'w', markers: ['m'] },
      scene: { place: 'p', time: '夜', weather: '雨', materials: ['m'], palette: 'p' },
    },
  })
}

function fakeProvider(overrides: Partial<VideoProvider> = {}): VideoProvider {
  return {
    id: 'fake',
    capabilities: { textToVideo: true, imageToVideo: true, imageGeneration: true, maxDurationSec: 10 },
    estimateCost: () => 1,
    generateReferenceImage: async () => ({ url: 'http://127.0.0.1/ref.png' }),
    createVideo: async () => ({ taskId: 't1' }),
    getTask: async () => ({ state: 'done', videoUrl: 'http://127.0.0.1/v.mp4' }),
    ...overrides,
  }
}

async function fakeDownload(_url: string, dest: string): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, 'bytes')
}

function deps(ws: string, opts: { failShot?: number; provider?: VideoProvider } = {}): JobDeps {
  return {
    workspace: ws,
    jobId: 'job_1',
    planId: 'pl_1',
    config: Config({ accessKey: 'ak', secretKey: 'sk', workspace: ws }),
    provider: opts.provider ?? fakeProvider(),
    download: fakeDownload,
    failShot: opts.failShot,
  }
}

function readManifestFile(ws: string): Manifest {
  return JSON.parse(readFileSync(join(ws, 'job_1', 'manifest.json'), 'utf8')) as Manifest
}

function registeredTool(ctx: ReturnType<typeof createFakeCtx>): ToolLike {
  return ctx.tools.register.mock.calls[0][0] as ToolLike
}

describe('runJob', () => {
  it('writes one file per shot and a full manifest', async () => {
    const ws = tempWorkspace()
    makePlan(ws)
    await runJob(deps(ws))
    const manifest = readManifestFile(ws)
    expect(manifest.shots.map((s) => s.status)).toEqual(['done', 'done'])
    expect(existsSync(join(ws, 'job_1', 'shot-01.mp4'))).toBe(true)
    expect(manifest.failures).toEqual([])
  })

  it('marks a single failed shot without failing the job', async () => {
    const ws = tempWorkspace()
    makePlan(ws)
    await runJob(deps(ws, { failShot: 2 }))
    const manifest = readManifestFile(ws)
    expect(manifest.shots[0].status).toBe('done')
    expect(manifest.shots[1].status).toBe('failed')
    expect(manifest.failures).toHaveLength(1)
  })

  it('reuses the cached reference image and skips generation on the next job', async () => {
    const ws = tempWorkspace()
    makePlan(ws)
    await runJob(deps(ws))

    let calls = 0
    const second = fakeProvider({
      generateReferenceImage: async () => {
        calls++
        return { url: 'http://127.0.0.1/ref-2.png' }
      },
    })
    await runJob(deps(ws, { provider: second }))

    expect(calls).toBe(0)
  })

  it('keeps the job alive and records a warning when the reference image fails', async () => {
    const ws = tempWorkspace()
    makePlan(ws)
    const provider = fakeProvider({
      generateReferenceImage: async () => { throw new Error('image service down') },
    })
    await runJob(deps(ws, { provider }))
    const manifest = readManifestFile(ws)
    expect(manifest.shots.map((s) => s.status)).toEqual(['done', 'done'])
    expect(manifest.warnings.length).toBeGreaterThan(0)
  })

  it('fails a shot when polling passes the deadline', async () => {
    const ws = tempWorkspace()
    makePlan(ws)
    const config = {
      ...Config({ accessKey: 'ak', secretKey: 'sk', workspace: ws }),
      timeoutMs: 1,
      pollIntervalMs: 1,
    }
    const provider = fakeProvider({ getTask: async () => ({ state: 'running' }) })
    await runJob({ ...deps(ws, { provider }), config })
    const manifest = readManifestFile(ws)
    expect(manifest.shots.map((s) => s.status)).toEqual(['failed', 'failed'])
    expect(manifest.failures[0].code).toBe('transient')
    expect(manifest.failures[0].message).toContain('timeout')
  })
})

describe('video_generate tool', () => {
  it('rejects calls without explicit confirmation', async () => {
    const ws = tempWorkspace()
    makePlan(ws)
    const ctx = createFakeCtx()
    registerGenerateTool(ctx as never, Config({ accessKey: 'ak', secretKey: 'sk', workspace: ws }))
    const tool = registeredTool(ctx)
    await expect(tool.execute({ planId: 'pl_1', confirmed: false }, undefined))
      .rejects.toThrow(/confirmed/)
  })

  it('returns a dry-run result and never touches the provider', async () => {
    const ws = tempWorkspace()
    makePlan(ws)
    const ctx = createFakeCtx()
    registerGenerateTool(ctx as never, Config({ accessKey: 'ak', secretKey: 'sk', workspace: ws, dryRun: true }))
    const tool = registeredTool(ctx)

    const out = await tool.execute({ planId: 'pl_1', confirmed: true }, undefined) as {
      kind: string
      jobId: string
      shotCount: number
      manifestPath: string
    }

    expect(out.kind).toBe('dry-run')
    expect(out.shotCount).toBe(2)
    expect(klingMock.createKlingProvider).not.toHaveBeenCalled()
    expect(ctx.jobs.start).not.toHaveBeenCalled()

    const manifest = JSON.parse(readFileSync(out.manifestPath, 'utf8')) as Manifest
    expect(manifest.shots.map((s) => s.status)).toEqual(['planned', 'planned'])
  })
})