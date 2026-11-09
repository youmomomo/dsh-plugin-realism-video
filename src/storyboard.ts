import { createHash } from 'node:crypto'
import type { Aspect, StyleId } from './config.js'
import { renderShotPrompt, type ConsistencyCard } from './prompt.js'

export type { ConsistencyCard }

export type Beat =
  | 'establishing'
  | 'medium'
  | 'detail'
  | 'reaction'
  | 'environment'
  | 'transition'

export interface StoryboardShot {
  index: number
  beat: Beat
  durationSec: number
  prompt: string
  negativePrompt: string
  camera: string
  lighting: string
}

export interface StoryboardInput {
  idea: string
  style: StyleId
  shots: number
  durationSec: number
  aspect: Aspect
}

export interface Storyboard {
  style: StyleId
  card: ConsistencyCard
  shots: StoryboardShot[]
}

const MARKER_POOL = ['左手腕旧表', '右眉浅疤', '耳后小痣', '旧帆布包', '钥匙挂绳', '磨白的工牌']

const SCENE_MATERIALS = ['水泥墙面', '湿滑地面', '铁制扶手']

const BASE_BEATS: Beat[] = ['establishing', 'medium', 'detail', 'reaction']

const EXTRA_BEATS: Beat[] = ['environment', 'transition']

const ACTION_BY_BEAT: Record<Beat, string> = {
  establishing: 'stands still, full environment visible',
  medium: 'turns body toward the main subject of the scene',
  detail: 'hands perform one small everyday action',
  reaction: 'looks toward the strongest light source and exhales',
  environment: 'empty environment with a subtle light change',
  transition: 'moves quickly across the frame toward the next space',
}

const STYLE_CAMERA: Record<StyleId, string> = {
  'cinematic-real': '35mm, shallow depth of field, slow push-in',
  'phone-raw': 'handheld vertical, wide lens, slight shake',
  'field-report': 'handheld wide, documentary framing',
}

const STYLE_LIGHTING: Record<StyleId, string> = {
  'cinematic-real': 'motivated practical light, soft key',
  'phone-raw': 'ambient mixed light, mild overexposure',
  'field-report': 'available light, overcast, real exposure',
}

export function buildConsistencyCard(idea: string, style: StyleId, aspect: Aspect): ConsistencyCard {
  const hash = createHash('sha256').update(`${idea}|${style}|${aspect}`).digest('hex')
  const seed = parseInt(hash.slice(0, 8), 16)
  const time = inferTime(idea)
  const weather = inferWeather(idea)
  const marker = MARKER_POOL[seed % MARKER_POOL.length]

  return {
    characterId: `ch_${hash.slice(0, 8)}`,
    character: {
      ageRange: '28-32',
      face: '方下颌、深眼窝',
      hair: '短寸、发际线略后移',
      build: '偏瘦、肩窄',
      wardrobe: '深灰工装夹克、磨旧袖口',
      markers: [marker],
    },
    scene: {
      place: inferPlace(idea),
      time,
      weather,
      materials: [...SCENE_MATERIALS],
      palette: time === '夜' ? '冷蓝+暖黄' : '冷灰+暖黄',
    },
  }
}

function inferTime(idea: string): string {
  if (/夜|晚上|深夜/.test(idea)) return '夜'
  if (/清晨|早晨/.test(idea)) return '清晨'
  if (/傍晚|黄昏/.test(idea)) return '傍晚'
  return '傍晚'
}

function inferWeather(idea: string): string {
  if (/暴雨|大雨/.test(idea)) return '暴雨'
  if (/雨/.test(idea)) return '小雨'
  if (/雪/.test(idea)) return '小雪'
  if (/晴/.test(idea)) return '晴'
  return '阴'
}

function inferPlace(idea: string): string {
  if (/楼道|楼梯|电梯/.test(idea)) return '老城区居民楼楼道'
  if (/街|路|巷/.test(idea)) return '城市街道'
  if (/海|沙滩/.test(idea)) return '海边'
  if (/屋|房|家/.test(idea)) return '室内房间'
  return '城市日常场景'
}

export function buildStoryboard(input: StoryboardInput): Storyboard {
  if (!Number.isInteger(input.shots) || input.shots < 2 || input.shots > 8) {
    throw new Error('shots must be an integer between 2 and 8')
  }

  const card = buildConsistencyCard(input.idea, input.style, input.aspect)
  const beats = arrangeBeats(input.shots)

  const shots = beats.map((beat, position) => {
    const { prompt, negativePrompt } = renderShotPrompt({
      card,
      style: input.style,
      index: position + 1,
      action: ACTION_BY_BEAT[beat],
      durationSec: input.durationSec,
      aspect: input.aspect,
    })
    return {
      index: position + 1,
      beat,
      durationSec: input.durationSec,
      prompt,
      negativePrompt,
      camera: STYLE_CAMERA[input.style],
      lighting: STYLE_LIGHTING[input.style],
    }
  })

  return { style: input.style, card, shots }
}

function arrangeBeats(total: number): Beat[] {
  if (total <= BASE_BEATS.length) return BASE_BEATS.slice(0, total)

  const extrasNeeded = total - BASE_BEATS.length
  const beats: Beat[] = [BASE_BEATS[0]]
  let extrasUsed = 0

  for (let position = 1; position < BASE_BEATS.length; position++) {
    if (extrasUsed < extrasNeeded) {
      beats.push(EXTRA_BEATS[extrasUsed % EXTRA_BEATS.length])
      extrasUsed += 1
    }
    beats.push(BASE_BEATS[position])
  }

  while (extrasUsed < extrasNeeded) {
    beats.push(EXTRA_BEATS[extrasUsed % EXTRA_BEATS.length])
    extrasUsed += 1
  }

  return beats
}

export function estimateShotCost(
  style: StyleId,
  durationSec: number,
  pricing: Record<string, number>,
): number | null {
  const unit = pricing[style]
  if (typeof unit !== 'number' || !Number.isFinite(unit)) return null
  return Number((unit * durationSec).toFixed(2))
}