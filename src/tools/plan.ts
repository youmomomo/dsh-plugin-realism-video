import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ConfigShape } from '../config.js'
import { buildStoryboard, estimateShotCost } from '../storyboard.js'
import { savePlan } from '../store/plans.js'

const UNKNOWN_COST_WARNING = '费用未知：未配置 pricing'

export function registerPlanTool(ctx: Context, config: ConfigShape) {
  ctx.tools.register(defineTool({
    name: 'video_plan',
    description: 'Turn a creative brief into an ordered realism-style shot list with prompts and estimated cost. Does not spend quota.',
    parameters: {
      idea: { type: 'string', required: true, description: 'Creative brief in natural language' },
      style: {
        type: 'string',
        enum: ['cinematic-real', 'phone-raw', 'field-report'],
        description: 'Realism style preset',
      },
      shots: { type: 'number', description: 'Number of shots, 2-8' },
      aspect: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: 'Frame aspect ratio' },
      resolution: { type: 'string', enum: ['720p', '1080p'], description: 'Output resolution' },
      durationSec: { type: 'number', description: 'Seconds per shot, 5 or 10' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) ?? '' }],
    },
    async execute(args) {
      const shots = args.shots ?? config.maxShots
      if (shots > config.maxShots) throw new Error(`shots exceeds maxShots (${config.maxShots})`)

      const style = args.style ?? config.style
      const aspect = args.aspect ?? config.aspect
      const resolution = args.resolution ?? config.resolution
      const durationSec = args.durationSec ?? config.shotDurationSec

      const storyboard = buildStoryboard({ idea: args.idea, style, shots, durationSec, aspect })
      const unitCost = estimateShotCost(style, durationSec, config.pricing)
      const totalCost = unitCost === null ? null : Number((unitCost * shots).toFixed(2))
      const planId = `pl_${randomUUID().slice(0, 8)}`

      const plannedShots = storyboard.shots.map((shot) => ({ ...shot, estimatedCostCny: unitCost }))

      savePlan(config.workspace, {
        planId,
        createdAt: new Date().toISOString(),
        style,
        aspect,
        resolution,
        shots: plannedShots,
        totalEstimatedCostCny: totalCost,
        card: storyboard.card,
      })

      return {
        planId,
        style,
        aspect,
        resolution,
        shots: plannedShots.map((shot) => ({
          index: shot.index,
          beat: shot.beat,
          durationSec: shot.durationSec,
          prompt: shot.prompt,
          negativePrompt: shot.negativePrompt,
          camera: shot.camera,
          lighting: shot.lighting,
          characterId: storyboard.card.characterId,
          estimatedCostCny: shot.estimatedCostCny,
        })),
        totalEstimatedCostCny: totalCost,
        warnings: totalCost === null ? [UNKNOWN_COST_WARNING] : [],
      }
    },
  }))
}