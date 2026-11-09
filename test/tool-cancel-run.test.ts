import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.js'
import type { TaskState, VideoProvider } from '../src/provider/types.js'
import { requestCancel } from '../src/store/cancel.js'
import type { Manifest } from '../src/store/manifest.js'
import { savePlan } from '../src/store/plans.js'
import { runJob, type JobDeps } from '../src/tools/generate.js'
import { tempWorkspace } from './helpers.js'

const SHOT_COUNT = 4
const JOB_ID = 'job_cancel'

function makePlan(ws: string): void {
  savePlan(ws, {
    planId: 'pl_cancel',
    createdAt: '2026-11-08T00:00:00.000Z',
    style: 'cinematic-real',
    aspect: '16:9',
    resolution: '1080p',
    shots: Array.from({ length: SHOT_COUNT }, (_unused, offset) => ({
      index: offset + 1,
      beat: 'medium',
      durationSec: 5,
      prompt: `p${offset + 1}`,
      negativePrompt: 'n',
      camera: 'c',
      lighting: 'l',
      estimatedCostCny: 1,
    })),
    totalEstimatedCostCny: SHOT_COUNT,
    card: {
      characterId: 'ch_1',
      character: { ageRange: '30', face: 'f', hair: 'h', build: 'b', wardrobe: 'w', markers: ['m'] },
      scene: { place: 'p', time: '夜', weather: '雨', materials: ['m'], palette: 'p' },
    },
  })
}

async function fakeDownload(_url: string, dest: string): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, 'bytes')
}

function readManifestFile(ws: string): Manifest {
  return JSON.parse(readFileSync(join(ws, JOB_ID, 'manifest.json'), 'utf8')) as Manifest
}

describe('runJob cancellation', () => {
  it('stops polling and skips unstarted shots after a cancel request', async () => {
    const ws = tempWorkspace()
    makePlan(ws)

    let createCalls = 0
    let getTaskCalls = 0

    const provider: VideoProvider = {
      id: 'fake',
      capabilities: { textToVideo: true, imageToVideo: true, imageGeneration: true, maxDurationSec: 10 },
      estimateCost: () => 1,
      generateReferenceImage: async () => ({ url: 'http://127.0.0.1/ref.png' }),
      createVideo: async () => {
        createCalls++
        return { taskId: `t${createCalls}` }
      },
      getTask: async (): Promise<TaskState> => {
        getTaskCalls++
        if (getTaskCalls === 1) {
          const running: TaskState = { state: 'running' }
          requestCancel(ws, JOB_ID)
          return running
        }
        if (getTaskCalls <= 2) return { state: 'running' }
        return { state: 'done', videoUrl: 'http://127.0.0.1/v.mp4' }
      },
    }

    const config = {
      ...Config({ accessKey: 'ak', secretKey: 'sk', workspace: ws }),
      pollIntervalMs: 1,
    }
    const deps: JobDeps = {
      workspace: ws,
      jobId: JOB_ID,
      planId: 'pl_cancel',
      config,
      provider,
      download: fakeDownload,
    }

    await expect(runJob(deps)).resolves.toBeUndefined()

    const manifest = readManifestFile(ws)
    expect(createCalls).toBeGreaterThanOrEqual(1)
    expect(createCalls).toBeLessThan(SHOT_COUNT)
    expect(manifest.shots.every((shot) => shot.status === 'cancelled')).toBe(true)
    expect(manifest.failures).toEqual([])
  })
})