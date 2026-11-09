import type { StyleId } from './config.js'

export interface StylePreset {
  camera: string
  lighting: string
  texture: string
  motion: string
  negatives: string[]
}

export const STYLE_PRESETS: Record<StyleId, StylePreset> = {
  'cinematic-real': {
    camera: '35mm lens, shallow depth of field, gimbal or slider, slow push-in',
    lighting: 'motivated practical light, soft key, high dynamic range, natural falloff',
    texture: 'visible skin pores, fine hair strands, subtle asymmetry, true optical bokeh',
    motion: 'slow dolly-in or gentle tracking, stable horizon',
    negatives: ['plastic skin', 'airbrushed', 'overly smooth', 'fake bokeh', 'CGI'],
  },
  'phone-raw': {
    camera: 'handheld vertical phone, wide lens, autofocus breathing, slight lens smudge',
    lighting: 'ambient light, mild overexposure, mixed color temperature',
    texture: 'night noise, gentle motion blur, imperfect framing',
    motion: 'walking shake, sudden pan, natural micro-jitter',
    negatives: ['tripod look', 'perfect composition', 'studio lighting', '3D render'],
  },
  'field-report': {
    camera: 'handheld wide, slight low angle, documentary framing',
    lighting: 'available light, backlight or overcast, real exposure',
    texture: 'film grain, subtle flicker, motion blur, real skin texture',
    motion: 'follow cam, quick whip pan, reactive movement',
    negatives: ['studio setup', 'controlled lighting', 'cartoon', 'hyper-saturated'],
  },
}