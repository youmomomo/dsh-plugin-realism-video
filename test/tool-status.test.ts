import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.js'
import { writeManifest } from '../src/store/manifest.js'
import { registerCancelTool } from '../src/tools/cancel.js'
import { registerStatusTool } from '../src/tools/status.js'
import { createFakeCtx, tempWorkspace } from './helpers.js'

interface ToolLike<A, R> {
  execute(args: A): Promise<R>
}

interface StatusOutput {
  jobId: string
  state: string
  shots: { index: number; state: string; file: string | null }[]
  manifestPath: string
}

interface CancelOutput {
  jobId: string
  cancelledCount: number
}

function setup(ws: string) {
  const ctx = createFakeCtx()
  const config = Config({ accessKey: 'ak', secretKey: 'sk', workspace: ws })
  registerStatusTool(ctx as never, config)
  registerCancelTool(ctx as never, config)
  return ctx
}

function registeredAt<T>(ctx: ReturnType<typeof createFakeCtx>, index: number): T {
  return ctx.tools.register.mock.calls[index][0] as unknown as T
}

describe('video_status', () => {
  it('reports partial when some shots failed', async () => {
    const ws = tempWorkspace()
    writeManifest(ws, {
      schemaVersion: 1, jobId: 'job_1', provider: 'kling', style: 'cinematic-real',
      aspect: '16:9', resolution: '1080p', createdAt: 'x',
      shots: [
        { index: 1, file: 'shot-01.mp4', status: 'done', prompt: 'p' },
        { index: 2, file: 'shot-02.mp4', status: 'failed', prompt: 'p' },
      ],
      totalCostCny: null,
      warnings: [],
      failures: [{ index: 2, code: 'invalid', message: 'bad prompt' }],
    })
    const ctx = setup(ws)
    const tool = registeredAt<ToolLike<{ jobId: string }, StatusOutput>>(ctx, 0)
    const out = await tool.execute({ jobId: 'job_1' })
    expect(out.state).toBe('partial')
    expect(out.shots).toHaveLength(2)
  })

  it('reports planned for a dry-run job', async () => {
    const ws = tempWorkspace()
    writeManifest(ws, {
      schemaVersion: 1, jobId: 'job_dry', provider: 'kling', style: 'cinematic-real',
      aspect: '16:9', resolution: '1080p', createdAt: 'x',
      shots: [
        { index: 1, file: 'shot-01.mp4', status: 'planned', prompt: 'p' },
        { index: 2, file: 'shot-02.mp4', status: 'planned', prompt: 'p' },
      ],
      totalCostCny: 3,
      warnings: [],
      failures: [],
    })
    const ctx = setup(ws)
    const tool = registeredAt<ToolLike<{ jobId: string }, StatusOutput>>(ctx, 0)
    const out = await tool.execute({ jobId: 'job_dry' })
    expect(out.state).toBe('planned')
  })

  it('throws a clear error for unknown job', async () => {
    const ctx = setup(tempWorkspace())
    const tool = registeredAt<ToolLike<{ jobId: string }, StatusOutput>>(ctx, 0)
    await expect(tool.execute({ jobId: 'job_none' })).rejects.toThrow(/job not found/)
  })
})

describe('video_cancel', () => {
  it('marks pending shots cancelled and keeps finished ones', async () => {
    const ws = tempWorkspace()
    writeManifest(ws, {
      schemaVersion: 1, jobId: 'job_1', provider: 'kling', style: 'cinematic-real',
      aspect: '16:9', resolution: '1080p', createdAt: 'x',
      shots: [
        { index: 1, file: 'shot-01.mp4', status: 'done', prompt: 'p' },
        { index: 2, file: 'shot-02.mp4', status: 'running', prompt: 'p' },
      ],
      totalCostCny: null,
      warnings: [],
      failures: [],
    })
    const ctx = setup(ws)
    const cancel = registeredAt<ToolLike<{ jobId: string }, CancelOutput>>(ctx, 1)
    const out = await cancel.execute({ jobId: 'job_1' })
    expect(out.cancelledCount).toBe(1)
  })
})