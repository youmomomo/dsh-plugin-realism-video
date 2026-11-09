import { describe, expect, it, vi } from 'vitest'
import { classifyError } from '../src/provider/errors.js'
import { mapLimit, withRetry } from '../src/provider/retry.js'

describe('classifyError', () => {
  it('maps auth failures and never retries them', () => {
    const e = classifyError(401, 'invalid signature')
    expect(e.code).toBe('auth')
    expect(e.retryable).toBe(false)
  })
  it('maps validation failures as invalid', () => {
    expect(classifyError(400, 'prompt rejected').code).toBe('invalid')
  })
  it('maps rate limits to quota with retry', () => {
    const e = classifyError(429, 'too many requests')
    expect(e.code).toBe('quota')
    expect(e.retryable).toBe(true)
  })
  it('maps 5xx to transient with retry', () => {
    expect(classifyError(503, 'unavailable').retryable).toBe(true)
  })
})

describe('withRetry', () => {
  it('retries retryable errors up to the limit', async () => {
    const fn = vi.fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { retryable: true }))
      .mockRejectedValueOnce(Object.assign(new Error('x'), { retryable: true }))
      .mockResolvedValue('ok')
    const out = await withRetry(fn, { retries: 3, baseDelayMs: 1 }, new AbortController().signal)
    expect(out).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })
  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn<(attempt: number) => Promise<string>>()
      .mockRejectedValue(Object.assign(new Error('bad'), { retryable: false }))
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 1 }, new AbortController().signal)).rejects.toThrow('bad')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('mapLimit', () => {
  it('never exceeds the concurrency limit and preserves order', async () => {
    let active = 0
    let peak = 0
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      active++; peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10])
    expect(peak).toBeLessThanOrEqual(2)
  })
})