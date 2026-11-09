import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.js'
import { Config } from '../src/config.js'
import { createFakeCtx } from './helpers.js'

describe('plugin load', () => {
  it('registers exactly four tools and no timers', () => {
    const ctx = createFakeCtx()
    apply(ctx as never, Config({ accessKey: 'ak', secretKey: 'sk' }))
    expect(ctx.tools.register).toHaveBeenCalledTimes(4)
    expect(ctx.effect).not.toHaveBeenCalled()
  })
})