import { describe, expect, it } from 'vitest'
import { STYLE_PRESETS } from '../src/styles.js'
import { BASE_NEGATIVES, renderShotPrompt } from '../src/prompt.js'

const card = {
  characterId: 'ch_test',
  character: {
    ageRange: '28-32', face: '方下颌、深眼窝', hair: '短寸',
    build: '偏瘦', wardrobe: '深灰工装夹克', markers: ['左手腕旧表'],
  },
  scene: { place: '老城区楼道', time: '傍晚', weather: '阴', materials: ['水磨石地面'], palette: '冷灰+暖黄' },
}

describe('style presets', () => {
  it('exposes the three documented styles', () => {
    expect(Object.keys(STYLE_PRESETS).sort()).toEqual(['cinematic-real', 'field-report', 'phone-raw'])
  })

  it('each preset has camera, lighting, texture and motion guidance', () => {
    for (const p of Object.values(STYLE_PRESETS)) {
      expect(p.camera.length).toBeGreaterThan(0)
      expect(p.lighting.length).toBeGreaterThan(0)
      expect(p.texture.length).toBeGreaterThan(0)
      expect(p.motion.length).toBeGreaterThan(0)
    }
  })
})

describe('renderShotPrompt', () => {
  it('emits seven labelled sections in fixed order', () => {
    const { prompt } = renderShotPrompt({
      card, style: 'cinematic-real', index: 1,
      action: '转身看向电梯', durationSec: 5, aspect: '16:9',
    })
    const order = ['Subject:', 'Action:', 'Environment:', 'Camera:', 'Lighting:', 'Texture:', 'Negative:']
    const positions = order.map((k) => prompt.indexOf(k))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('always includes at least one character marker', () => {
    const { prompt } = renderShotPrompt({
      card, style: 'phone-raw', index: 2,
      action: '抬头看楼层灯', durationSec: 5, aspect: '9:16',
    })
    expect(prompt).toContain('左手腕旧表')
  })

  it('keeps negative terms unique and non-empty', () => {
    const { negativePrompt } = renderShotPrompt({
      card, style: 'field-report', index: 1,
      action: '快步走进楼道', durationSec: 5, aspect: '16:9',
    })
    const terms = negativePrompt.split(', ')
    expect(terms.length).toBe(new Set(terms).size)
    expect(negativePrompt.length).toBeGreaterThan(0)
  })

  it('exposes the documented base negative vocabulary', () => {
    expect(BASE_NEGATIVES).toContain('plastic skin')
    expect(BASE_NEGATIVES).toContain('morphing faces')
  })
})