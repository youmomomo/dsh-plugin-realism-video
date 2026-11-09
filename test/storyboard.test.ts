import { describe, expect, it } from 'vitest'
import {
  buildConsistencyCard,
  buildStoryboard,
  estimateShotCost,
  type ConsistencyCard,
} from '../src/storyboard.js'

describe('buildConsistencyCard', () => {
  it('extracts place, time and weather from the idea', () => {
    const card = buildConsistencyCard('暴雨夜外卖员在楼下等电梯', 'cinematic-real', '16:9')
    expect(card.scene.time).toBe('夜')
    expect(card.scene.weather).toBe('暴雨')
    expect(card.scene.place.length).toBeGreaterThan(0)
  })

  it('fills missing fields with style defaults', () => {
    const card = buildConsistencyCard('一个人在走路', 'phone-raw', '16:9')
    expect(card.scene.time.length).toBeGreaterThan(0)
    expect(card.character.markers.length).toBeGreaterThan(0)
  })

  it('is stable for the same idea and varies across ideas', () => {
    const a = buildConsistencyCard('暴雨夜外卖员在楼下等电梯', 'cinematic-real', '16:9')
    const b = buildConsistencyCard('暴雨夜外卖员在楼下等电梯', 'cinematic-real', '16:9')
    const c = buildConsistencyCard('晴天海边有人跑步', 'cinematic-real', '16:9')
    expect(a.characterId).toBe(b.characterId)
    expect(a.characterId).not.toBe(c.characterId)
  })

  it('recognises Chinese time and weather keywords', () => {
    expect(buildConsistencyCard('晴天傍晚在街边', 'field-report', '9:16').scene.weather).toBe('晴')
    expect(buildConsistencyCard('晴天傍晚在街边', 'field-report', '9:16').scene.time).toBe('傍晚')
    expect(buildConsistencyCard('雨夜路口', 'field-report', '9:16').scene.weather).toBe('小雨')
  })

  it('re-exports the ConsistencyCard type', () => {
    const card: ConsistencyCard = buildConsistencyCard('雨夜路口', 'cinematic-real', '16:9')
    expect(card.characterId.startsWith('ch_')).toBe(true)
  })
})

describe('buildStoryboard', () => {
  it('produces the requested number of ordered shots', () => {
    const sb = buildStoryboard({ idea: '暴雨夜外卖员在楼下等电梯', style: 'cinematic-real', shots: 4, durationSec: 5, aspect: '16:9' })
    expect(sb.shots.map((s) => s.index)).toEqual([1, 2, 3, 4])
    expect(sb.shots.every((s) => s.prompt.includes('Negative:'))).toBe(true)
  })

  it('uses the documented four-beat template for four shots', () => {
    const sb = buildStoryboard({ idea: '暴雨夜外卖员在楼下等电梯', style: 'cinematic-real', shots: 4, durationSec: 5, aspect: '16:9' })
    expect(sb.shots.map((s) => s.beat)).toEqual(['establishing', 'medium', 'detail', 'reaction'])
  })

  it('rejects shot counts outside 2..8', () => {
    expect(() => buildStoryboard({ idea: 'x', style: 'phone-raw', shots: 1, durationSec: 5, aspect: '16:9' })).toThrow()
    expect(() => buildStoryboard({ idea: 'x', style: 'phone-raw', shots: 9, durationSec: 5, aspect: '16:9' })).toThrow()
  })

  it('keeps the four narrative beats in order when extra shots are inserted', () => {
    for (const shots of [5, 6, 7, 8]) {
      const sb = buildStoryboard({ idea: '暴雨夜外卖员在楼下等电梯', style: 'cinematic-real', shots, durationSec: 5, aspect: '16:9' })
      expect(sb.shots).toHaveLength(shots)
      expect(sb.shots.map((s) => s.beat).filter((b) => b === 'environment' || b === 'transition').length).toBe(shots - 4)
    }
  })

  it('keeps shot actions free of hardcoded weather and place', () => {
    const sb = buildStoryboard({ idea: '晴天海边有人跑步', style: 'cinematic-real', shots: 4, durationSec: 5, aspect: '16:9' })
    const text = sb.shots.map((s) => s.prompt).join(' ')
    expect(text).not.toMatch(/rain falling|elevator door|call button/)
    expect(text).toContain('海边')
  })

  it('inserts environment and transition beats for six shots', () => {
    const sb = buildStoryboard({ idea: '暴雨夜外卖员在楼下等电梯', style: 'cinematic-real', shots: 6, durationSec: 5, aspect: '16:9' })
    const beats = sb.shots.map((s) => s.beat)
    expect(sb.shots).toHaveLength(6)
    expect(beats).toContain('environment')
    expect(beats).toContain('transition')
    expect(beats.filter((b) => b === 'establishing' || b === 'medium' || b === 'detail' || b === 'reaction')).toEqual(['establishing', 'medium', 'detail', 'reaction'])
  })
})

describe('estimateShotCost', () => {
  it('returns null when pricing is unknown', () => {
    expect(estimateShotCost('cinematic-real', 5, {})).toBeNull()
  })

  it('multiplies unit price by duration', () => {
    expect(estimateShotCost('cinematic-real', 10, { 'cinematic-real': 1.5 })).toBe(15)
  })
})