import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.js'
import { registerPlanTool } from '../src/tools/plan.js'
import { createFakeCtx, tempWorkspace } from './helpers.js'

function setup(overrides: Record<string, unknown> = {}) {
  const ctx = createFakeCtx()
  const config = Config({ accessKey: 'ak', secretKey: 'sk', workspace: tempWorkspace(), ...overrides })
  registerPlanTool(ctx as never, config)
  return { ctx, config, tool: ctx.tools.register.mock.calls[0][0] as never }
}

describe('video_plan tool', () => {
  it('plans shots and persists the plan', async () => {
    const { tool, config } = setup()
    const out = await (tool as any).execute({ idea: '暴雨夜外卖员在楼下等电梯', shots: 4 })
    expect(out.shots).toHaveLength(4)
    expect(out.planId).toMatch(/^pl_/)
    expect(out.totalEstimatedCostCny).toBeNull()
    expect(config).toBeTruthy()
  })

  it('rejects more shots than maxShots', async () => {
    const { tool } = setup({ maxShots: 2 })
    await expect((tool as any).execute({ idea: 'x', shots: 6 })).rejects.toThrow(/maxShots/)
  })
})