import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ConfigShape } from '../config.js'
import { readManifest, type Manifest } from '../store/manifest.js'

const MANIFEST_FILE_NAME = 'manifest.json'

type JobState = 'planned' | 'done' | 'partial' | 'cancelled' | 'running'

function jobState(manifest: Manifest): JobState {
  if (manifest.failures.length > 0) return 'partial'
  if (manifest.shots.every((shot) => shot.status === 'done')) return 'done'
  if (manifest.shots.every((shot) => shot.status === 'planned')) return 'planned'
  const cancelled = manifest.shots.some((shot) => shot.status === 'cancelled')
  const active = manifest.shots.some((shot) => shot.status === 'running' || shot.status === 'pending')
  if (cancelled && !active) return 'cancelled'
  return 'running'
}

export function registerStatusTool(ctx: Context, config: ConfigShape): void {
  ctx.tools.register(defineTool({
    name: 'video_status',
    description: 'Read the state of a video generation job without triggering new work.',
    parameters: {
      jobId: { type: 'string', required: true, description: 'Job id returned by video_generate' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) ?? '' }],
    },
    async execute(args) {
      const manifest = readManifest(config.workspace, args.jobId)
      if (manifest === null) throw new Error(`job not found: ${args.jobId}`)
      return {
        jobId: manifest.jobId,
        state: jobState(manifest),
        shots: manifest.shots.map((shot) => ({
          index: shot.index,
          state: shot.status,
          file: shot.status === 'done' ? shot.file : null,
        })),
        manifestPath: join(config.workspace, manifest.jobId, MANIFEST_FILE_NAME),
      }
    },
  }))
}