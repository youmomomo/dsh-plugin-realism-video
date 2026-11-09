import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadPlan, savePlan } from '../src/store/plans.js'
import { tempWorkspace } from './helpers.js'

const record = {
  planId: 'pl_test', createdAt: '2026-11-08T00:00:00.000Z',
  style: 'cinematic-real' as const, aspect: '16:9' as const, resolution: '1080p' as const,
  shots: [], totalEstimatedCostCny: null, card: { characterId: 'ch_1' },
}

describe('plan store', () => {
  it('round-trips a plan', () => {
    const ws = tempWorkspace()
    savePlan(ws, record as never)
    const loaded = loadPlan(ws, 'pl_test')
    expect(loaded?.planId).toBe('pl_test')
  })

  it('returns null for missing plan', () => {
    expect(loadPlan(tempWorkspace(), 'pl_missing')).toBeNull()
  })

  it('refuses ids that escape the plans directory', () => {
    const ws = tempWorkspace()
    expect(() => loadPlan(ws, '../../etc/passwd')).toThrow(/invalid plan id/)
    expect(() => savePlan(ws, { ...record, planId: '../x' } as never)).toThrow(/invalid plan id/)
    expect(join(ws, 'plans')).not.toBe('')
  })

  it('writes a parseable json file into the plans directory', () => {
    const ws = tempWorkspace()
    savePlan(ws, record as never)
    const raw = readFileSync(join(ws, 'plans', 'pl_test.json'), 'utf8')
    expect(JSON.parse(raw)).toMatchObject({ planId: 'pl_test' })
  })
})