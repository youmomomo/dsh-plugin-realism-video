import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ConfigShape } from '../config.js'
import { requestCancel } from '../store/cancel.js'
import { readManifest, writeManifest } from '../store/manifest.js'

export function registerCancelTool(ctx: Context, config: ConfigShape): void {
  ctx.tools.register(defineTool({
    name: 'video_cancel',
    description: 'Cancel the unfinished shots of a video generation job. Finished shots are kept.',
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
      requestCancel(config.workspace, args.jobId)
      let cancelledCount = 0
      for (const shot of manifest.shots) {
        if (shot.status === 'done') continue
        shot.status = 'cancelled'
        cancelledCount++
      }
      writeManifest(config.workspace, manifest)
      return { jobId: manifest.jobId, cancelledCount }
    },
  }))
}