import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.js'
import { assertGenerateAllowed } from '../src/tools/generate.js'

const plan = { planId: 'pl_1', totalEstimatedCostCny: 50, shots: [{ index: 1 }] }

describe('generate gates', () => {
  it('requires explicit confirmation', () => {
    const config = Config({ accessKey: 'ak', secretKey: 'sk' })
    expect(() => assertGenerateAllowed(config, plan, false)).toThrow(/confirmed/)
  })

  it('refuses unknown credentials', () => {
    const config = Config({ accessKey: '', secretKey: '' })
    expect(() => assertGenerateAllowed(config, plan, true)).toThrow(/accessKey/)
  })

  it('refuses cost above maxCostPerJob', () => {
    const config = Config({ accessKey: 'ak', secretKey: 'sk', maxCostPerJob: 20 })
    expect(() => assertGenerateAllowed(config, plan, true)).toThrow(/maxCostPerJob/)
  })

  it('refuses a plan without shots', () => {
    const config = Config({ accessKey: 'ak', secretKey: 'sk' })
    expect(() => assertGenerateAllowed(config, { totalEstimatedCostCny: null, shots: [] }, true))
      .toThrow(/no shots/)
  })

  it('allows a valid request', () => {
    const config = Config({ accessKey: 'ak', secretKey: 'sk', maxCostPerJob: 100 })
    expect(() => assertGenerateAllowed(config, plan, true)).not.toThrow()
  })
})