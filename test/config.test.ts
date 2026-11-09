import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.js'

const base = { accessKey: 'ak', secretKey: 'sk' }

describe('Config', () => {
  it('applies documented defaults', () => {
    const c = Config(base)
    expect(c.maxShots).toBe(4)
    expect(c.aspect).toBe('16:9')
    expect(c.resolution).toBe('1080p')
    expect(c.shotDurationSec).toBe(5)
    expect(c.concurrency).toBe(2)
    expect(c.dryRun).toBe(false)
    expect(c.llmPolish).toBe(false)
  })

  it('rejects maxShots outside 1..8', () => {
    expect(() => Config({ ...base, maxShots: 99 })).toThrow()
    expect(() => Config({ ...base, maxShots: 0 })).toThrow()
  })

  it('rejects concurrency below 1', () => {
    expect(() => Config({ ...base, concurrency: 0 })).toThrow()
  })

  it('rejects unknown aspect', () => {
    expect(() => Config({ ...base, aspect: '4:3' } as never)).toThrow()
  })
})