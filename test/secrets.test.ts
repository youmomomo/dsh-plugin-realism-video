import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.js'
import { apply, resolveSecret, resolveSecrets } from '../src/index.js'
import { createFakeCtx } from './helpers.js'

const env = { KLING_AK: 'ak-from-env', KLING_SK: 'sk-from-env' }

describe('resolveSecret', () => {
  it('passes plain values through', () => {
    expect(resolveSecret('plain-ak', env)).toBe('plain-ak')
  })

  it('reads env: references', () => {
    expect(resolveSecret('env:KLING_AK', env)).toBe('ak-from-env')
  })

  it('returns empty string for missing env vars', () => {
    expect(resolveSecret('env:MISSING_VAR', env)).toBe('')
  })
})

describe('resolveSecrets', () => {
  it('resolves both credential fields without mutating the original config', () => {
    const config = Config({ accessKey: 'env:KLING_AK', secretKey: 'env:KLING_SK' })
    const resolved = resolveSecrets(config, env)
    expect(resolved.accessKey).toBe('ak-from-env')
    expect(resolved.secretKey).toBe('sk-from-env')
    expect(config.accessKey).toBe('env:KLING_AK')
  })

  it('locks generate when the referenced env var is missing', () => {
    const config = Config({ accessKey: 'env:MISSING_VAR', secretKey: 'env:KLING_SK' })
    const resolved = resolveSecrets(config, env)
    expect(resolved.accessKey).toBe('')
  })
})

describe('apply with env credentials', () => {
  it('loads all four tools without throwing', () => {
    const ctx = createFakeCtx()
    expect(() => apply(ctx as never, Config({
      accessKey: 'env:KLING_AK',
      secretKey: 'env:KLING_SK',
      workspace: '/tmp/realism-video-test',
    }))).not.toThrow()
    expect(ctx.tools.register).toHaveBeenCalledTimes(4)
  })
})