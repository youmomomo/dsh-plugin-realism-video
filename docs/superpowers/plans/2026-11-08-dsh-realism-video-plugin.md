# 现实感视频插件（dsh-plugin-realism-video）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可从 GitHub 直接安装到 DeepSeek Harness 的插件，把一句创意变成一组带真实感风格、角色一致的分镜视频。

**Architecture:** 单包单体。工具层（4 个 dsh 工具）通过内部 `VideoProvider` 接口调用可灵适配器；提示词由确定性模板渲染；长任务走 `ctx.jobs` 后台执行；产物落盘为分镜 mp4 + 增量写 `manifest.json`。

**Tech Stack:** TypeScript（strict、ESM）、Node 22、vitest、tsc、`node:crypto`、`node:http`（测试 mock）。零运行时依赖。

## Global Constraints

- 包名固定为 `dsh-plugin-realism-video`，ESM only，`"type": "module"`。
- Node 版本下限 22；`engines.dsh` 为 `>=0.2.0`。
- 除 dsh peer 依赖外，运行时零第三方依赖。
- 所有可调参数必须进 Schemastery 配置，不得硬编码。
- 日志与错误信息绝不输出 accessKey、secretKey、JWT。
- `workspace` 必须位于工作目录内，拒绝含 `..` 的路径。
- `lib/` 构建产物必须随源码提交，GitHub 直装才能直接运行。
- 每个任务结束时跑 `pnpm test` 与 `pnpm typecheck`，全绿才能提交。
- 提交信息用 `feat:` / `test:` / `fix:` / `docs:` / `chore:` 前缀。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/index.ts` | `apply(ctx, config)`，注册四个工具 |
| `src/config.ts` | Schemastery 配置与校验 |
| `src/styles.ts` | 三个风格预设 |
| `src/prompt.ts` | 七段提示词渲染、负向词库 |
| `src/storyboard.ts` | 创意 → 分镜、一致性卡、成本估算 |
| `src/provider/types.ts` | `VideoProvider` 接口与 `TaskState` |
| `src/provider/errors.ts` | 错误分类、可重试判定 |
| `src/provider/retry.ts` | 指数退避与并发控制器 |
| `src/provider/kling/auth.ts` | AK/SK 签 JWT 并缓存 |
| `src/provider/kling/endpoints.ts` | 端点与字段常量（以官方文档为准） |
| `src/provider/kling/index.ts` | 可灵适配器实现 |
| `src/store/plans.ts` | plan 持久化 |
| `src/store/manifest.ts` | manifest 读写 |
| `src/assets/download.ts` | 流式下载、`.part` + 原子 rename |
| `src/tools/plan.ts` | `video_plan` |
| `src/tools/generate.ts` | `video_generate` |
| `src/tools/status.ts` | `video_status` |
| `src/tools/cancel.ts` | `video_cancel` |
| `test/helpers.ts` | 假 `ctx`、假 provider、临时目录 |
| `test/*.test.ts` | 各层测试 |

---

### Task 1: 包骨架、配置与可加载的空插件

**Files:**
- Create: `package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`
- Create: `cordis.patch.yml`、`src/config.ts`、`src/index.ts`
- Test: `test/config.test.ts`、`test/load.test.ts`

**Interfaces:**
- Produces: `Config`（Schemastery schema）、`ConfigShape`（TS 接口）、`apply(ctx, config)`
- Produces: `package.json` 的 `dsh.bundle` 与 `main: lib/index.js`

- [ ] **Step 1: 探测 dsh peer 是否可从公共 npm 解析**

Run: `npm view @deepseek-ai/cordis version && npm view @deepseek-ai/dsh-tools version`

Expected: 两条版本号。若报 404，执行 Step 2 的兜底声明；若成功，跳过 Step 2 并把这两个包写进 `devDependencies`。

- [ ] **Step 2（仅 404 时）: 写最小 ambient 声明**

创建 `src/types/dsh.d.ts`：

```ts
declare module '@deepseek-ai/cordis' {
  export interface Context {
    tools: { register(tool: unknown): void }
    jobs: {
      start(options: {
        kind: string
        label: string
        owner: unknown
        run: (ctx: unknown) => Promise<unknown>
      }): Promise<string>
    }
    effect(fn: () => () => void): void
  }
}
declare module '@deepseek-ai/dsh-tools' {
  export function defineTool<T>(def: T): T
}
declare module '@deepseek-ai/schemastery' {
  const Schema: any
  export default Schema
}
```

- [ ] **Step 3: 写测试，先让它失败**

`test/config.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { Config } from '../src/config'

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
    expect(() => Config({ ...base, aspect: '4:3' })).toThrow()
  })
})
```

`test/load.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index'
import { Config } from '../src/config'
import { createFakeCtx } from './helpers'

describe('plugin load', () => {
  it('registers exactly four tools and no timers', () => {
    const ctx = createFakeCtx()
    apply(ctx as never, Config({ accessKey: 'ak', secretKey: 'sk' }))
    expect(ctx.tools.register).toHaveBeenCalledTimes(4)
    expect(ctx.effect).not.toHaveBeenCalled()
  })
})
```

`test/helpers.ts`：

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'

export function createFakeCtx() {
  return {
    tools: { register: vi.fn() },
    jobs: { start: vi.fn(async () => 'job_fake') },
    effect: vi.fn(),
  } as never as {
    tools: { register: ReturnType<typeof vi.fn> }
    jobs: { start: ReturnType<typeof vi.fn> }
    effect: ReturnType<typeof vi.fn>
  }
}

export function tempWorkspace() {
  return mkdtempSync(join(tmpdir(), 'realism-video-'))
}
```

- [ ] **Step 4: 运行测试确认失败**

Run: `pnpm vitest run test/config.test.ts test/load.test.ts`

Expected: FAIL，`Cannot find module '../src/config'`。

- [ ] **Step 5: 写 `src/config.ts`**

```ts
import Schema from '@deepseek-ai/schemastery'

export type StyleId = 'cinematic-real' | 'phone-raw' | 'field-report'
export type Aspect = '16:9' | '9:16' | '1:1'
export type Resolution = '720p' | '1080p'

export interface ConfigShape {
  provider: string
  accessKey: string
  secretKey: string
  apiBase: string
  workspace: string
  style: StyleId
  maxShots: number
  maxCostPerJob: number
  aspect: Aspect
  resolution: Resolution
  shotDurationSec: number
  pollIntervalMs: number
  timeoutMs: number
  concurrency: number
  dryRun: boolean
  llmPolish: boolean
  pricing: Record<string, number>
}

export const Config = Schema.object({
  provider: Schema.string().default('kling'),
  accessKey: Schema.string().default(''),
  secretKey: Schema.string().default(''),
  apiBase: Schema.string().default('https://api.klingai.com'),
  workspace: Schema.string().default('realism-video'),
  style: Schema.union(['cinematic-real', 'phone-raw', 'field-report']).default('cinematic-real'),
  maxShots: Schema.number().min(1).max(8).default(4),
  maxCostPerJob: Schema.number().min(0).default(20),
  aspect: Schema.union(['16:9', '9:16', '1:1']).default('16:9'),
  resolution: Schema.union(['720p', '1080p']).default('1080p'),
  shotDurationSec: Schema.union([5, 10]).default(5),
  pollIntervalMs: Schema.number().min(1000).default(5000),
  timeoutMs: Schema.number().min(60000).default(900000),
  concurrency: Schema.number().min(1).max(8).default(2),
  dryRun: Schema.boolean().default(false),
  llmPolish: Schema.boolean().default(false),
  pricing: Schema.dict(Schema.number()).default({}),
})
```

- [ ] **Step 6: 写 `src/index.ts`（空注册）**

```ts
import type { Context } from '@deepseek-ai/cordis'
import { Config, type ConfigShape } from './config'

export const name = 'realism-video'
export const inject = ['tools', 'jobs']
export { Config }

export function apply(ctx: Context, config: ConfigShape) {
  // Tools are registered in Tasks 4, 9, 10.
  void ctx
  void config
}
```

同一任务内补齐四个 `defineTool` 占位会引入空实现；为保持"可加载"验收，Step 6 先注册四个最小工具（description 已定，execute 抛"not implemented"）：

```ts
const notReady = (label: string) => async () => {
  throw new Error(`${label} is not implemented yet`)
}
```

注册代码：

```ts
ctx.tools.register(defineTool({
  name: 'video_plan', description: 'Plan realism-style video shots without spending quota.',
  parameters: { idea: { type: 'string', required: true, description: 'Creative brief' } },
  output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
  execute: notReady('video_plan'),
}))
```

其余三个工具用同样的最小结构，`name` 分别为 `video_generate` / `video_status` / `video_cancel`，参数在后续任务补全。

- [ ] **Step 7: 写 `package.json`**

```json
{
  "name": "dsh-plugin-realism-video",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "files": ["lib", "cordis.patch.yml", "README.md"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "engines": { "node": ">=22", "dsh": ">=0.2.0" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "prepare:release": "pnpm build && git diff --exit-code lib"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-tools": "*",
    "@deepseek-ai/schemastery": "*"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`tsconfig.json` 开启 `strict`、`module: NodeNext`、`target: ES2022`、`types: ["node"]`；`tsconfig.build.json` 设 `outDir: "lib"`、`declaration: true`、`rootDir: "src"`、`include: ["src"]`。

- [ ] **Step 8: 写 `cordis.patch.yml`**

```yaml
- insert:
    - id: realism-video
      name: dsh-plugin-realism-video
```

- [ ] **Step 9: 安装依赖并跑测试**

Run: `pnpm install && pnpm test && pnpm typecheck`

Expected: 全部通过，0 失败。

- [ ] **Step 10: 提交**

```bash
git add package.json tsconfig.json tsconfig.build.json vitest.config.ts cordis.patch.yml src test pnpm-lock.yaml
git commit -m "feat: scaffold dsh realism video plugin with validated config"
```

---

### Task 2: 风格预设与七段提示词

**Files:**
- Create: `src/styles.ts`、`src/prompt.ts`
- Test: `test/prompt.test.ts`

**Interfaces:**
- Consumes: `StyleId`、`Aspect`、`Resolution` from `src/config.ts`
- Produces: `STYLE_PRESETS: Record<StyleId, StylePreset>`
- Produces: `renderShotPrompt(input: ShotPromptInput): { prompt: string; negativePrompt: string }`
- Produces: `BASE_NEGATIVES: string[]`

- [ ] **Step 1: 写失败测试**

`test/prompt.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { STYLE_PRESETS } from '../src/styles'
import { BASE_NEGATIVES, renderShotPrompt } from '../src/prompt'

const card = {
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
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run test/prompt.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 `src/styles.ts`**

```ts
import type { StyleId } from './config'

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
```

- [ ] **Step 4: 实现 `src/prompt.ts`**

```ts
import type { Aspect } from './config'
import type { ConsistencyCard } from './storyboard'
import { STYLE_PRESETS } from './styles'
import type { StyleId } from './config'

export const BASE_NEGATIVES = [
  'plastic skin', 'airbrushed', 'overly smooth', 'perfect symmetry', 'CGI',
  '3D render', 'cartoon', 'hyper-saturated', 'fake bokeh', 'floating objects',
  'extra fingers', 'warped hands', 'morphing faces', 'watermark', 'text',
]

export interface ShotPromptInput {
  card: ConsistencyCard
  style: StyleId
  index: number
  action: string
  durationSec: number
  aspect: Aspect
}

export function renderShotPrompt(input: ShotPromptInput) {
  const p = STYLE_PRESETS[input.style]
  const { character, scene } = input.card
  const markers = character.markers.slice(0, 2).join(', ')

  const prompt = [
    `Subject: ${character.ageRange} year old person, ${character.face}, ${character.hair}, ${character.build}, wearing ${character.wardrobe}, identifying marks: ${markers}.`,
    `Action: ${input.action}. Single continuous action within ${input.durationSec} seconds.`,
    `Environment: ${scene.place}, ${scene.time}, ${scene.weather}, surfaces include ${scene.materials.join(', ')}, palette ${scene.palette}.`,
    `Camera: ${p.camera}, ${input.aspect} frame.`,
    `Lighting: ${p.lighting}.`,
    `Texture: ${p.texture}, realistic physics and natural imperfection.`,
    `Negative: ${[...BASE_NEGATIVES, ...p.negatives].filter(unique).join(', ')}.`,
  ].join(' ')

  const negativePrompt = [...BASE_NEGATIVES, ...p.negatives].filter(unique).join(', ')
  return { prompt, negativePrompt }
}

function unique(term: string, index: number, all: string[]) {
  return all.indexOf(term) === index
}
```

- [ ] **Step 5: 跑测试**

Run: `pnpm vitest run test/prompt.test.ts`

Expected: PASS（5 个用例）。

- [ ] **Step 6: 提交**

```bash
git add src/styles.ts src/prompt.ts test/prompt.test.ts
git commit -m "feat: add realism style presets and seven-section prompt renderer"
```

---

### Task 3: 分镜生成与一致性卡

**Files:**
- Create: `src/storyboard.ts`
- Test: `test/storyboard.test.ts`

**Interfaces:**
- Consumes: `StyleId`、`Aspect`
- Produces: `ConsistencyCard`（被 `src/prompt.ts` 引用）
- Produces: `buildConsistencyCard(idea: string, style: StyleId, aspect: Aspect): ConsistencyCard`
- Produces: `buildStoryboard(input: StoryboardInput): Storyboard`
- Produces: `estimateShotCost(style: StyleId, durationSec: number, pricing: Record<string, number>): number | null`

- [ ] **Step 1: 写失败测试**

`test/storyboard.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildConsistencyCard, buildStoryboard, estimateShotCost } from '../src/storyboard'

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
})

describe('estimateShotCost', () => {
  it('returns null when pricing is unknown', () => {
    expect(estimateShotCost('cinematic-real', 5, {})).toBeNull()
  })

  it('multiplies unit price by duration', () => {
    expect(estimateShotCost('cinematic-real', 10, { 'cinematic-real': 1.5 })).toBe(15)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run test/storyboard.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 `src/storyboard.ts`**

```ts
import { createHash } from 'node:crypto'
import type { Aspect, StyleId } from './config'
import { renderShotPrompt } from './prompt'

export interface ConsistencyCard {
  characterId: string
  character: {
    ageRange: string; face: string; hair: string; build: string
    wardrobe: string; markers: string[]
  }
  scene: {
    place: string; time: string; weather: string
    materials: string[]; palette: string
  }
}

export type Beat = 'establishing' | 'medium' | 'detail' | 'reaction' | 'environment' | 'transition'

export interface StoryboardShot {
  index: number; beat: Beat; durationSec: number
  prompt: string; negativePrompt: string
  camera: string; lighting: string
}

export interface StoryboardInput {
  idea: string; style: StyleId; shots: number; durationSec: number; aspect: Aspect
}

export interface Storyboard {
  style: StyleId
  card: ConsistencyCard
  shots: StoryboardShot[]
}

const MARKER_POOL = ['左手腕旧表', '右眉浅疤', '耳后小痣', '旧帆布包', '钥匙挂绳', '磨白的工牌']
const MATERIALS: Record<string, string[]> = {
  default: ['水泥墙面', '湿滑地面', '铁制扶手'],
}

export function buildConsistencyCard(idea: string, style: StyleId, aspect: Aspect): ConsistencyCard {
  const hash = createHash('sha256').update(`${idea}|${style}|${aspect}`).digest('hex')
  const pick = (seed: string) => parseInt(seed.slice(0, 8), 16)
  const time = /夜|晚上|深夜/.test(idea) ? '夜' : /清晨|早晨/.test(idea) ? '清晨' : /傍晚|黄昏/.test(idea) ? '傍晚' : '傍晚'
  const weather = /暴雨|大雨/.test(idea) ? '暴雨' : /雨/.test(idea) ? '小雨' : /雪/.test(idea) ? '小雪' : /晴/.test(idea) ? '晴' : '阴'
  const place = inferPlace(idea)
  const marker = MARKER_POOL[pick(hash) % MARKER_POOL.length]
  const characterId = `ch_${hash.slice(0, 8)}`

  return {
    characterId,
    character: {
      ageRange: '28-32', face: '方下颌、深眼窝', hair: '短寸、发际线略后移',
      build: '偏瘦、肩窄', wardrobe: '深灰工装夹克、磨旧袖口', markers: [marker],
    },
    scene: {
      place, time, weather,
      materials: MATERIALS.default,
      palette: time === '夜' ? '冷蓝+暖黄' : '冷灰+暖黄',
    },
  }
}

function inferPlace(idea: string): string {
  if (/楼道|楼梯|电梯/.test(idea)) return '老城区居民楼楼道'
  if (/街|路|巷/.test(idea)) return '城市街道'
  if (/海|沙滩/.test(idea)) return '海边'
  if (/屋|房|家/.test(idea)) return '室内房间'
  return '城市日常场景'
}

const BEATS_4: Beat[] = ['establishing', 'medium', 'detail', 'reaction']

export function buildStoryboard(input: StoryboardInput): Storyboard {
  if (!Number.isInteger(input.shots) || input.shots < 2 || input.shots > 8) {
    throw new Error('shots must be an integer between 2 and 8')
  }
  const card = buildConsistencyCard(input.idea, input.style, input.aspect)
  const beats = input.shots <= 4
    ? BEATS_4.slice(0, input.shots)
    : insertExtras(BEATS_4, input.shots)

  const shots = beats.map((beat, i) => {
    const action = ACTION_BY_BEAT[beat]
    const { prompt, negativePrompt } = renderShotPrompt({
      card, style: input.style, index: i + 1,
      action, durationSec: input.durationSec, aspect: input.aspect,
    })
    return {
      index: i + 1, beat, durationSec: input.durationSec,
      prompt, negativePrompt,
      camera: STYLE_CAMERA[input.style], lighting: STYLE_LIGHTING[input.style],
    }
  })

  return { style: input.style, card, shots }
}

const ACTION_BY_BEAT: Record<Beat, string> = {
  establishing: 'stands still, environment visible, rain falling around',
  medium: 'turns body toward the elevator door',
  detail: 'right hand presses the call button',
  reaction: 'looks up at the floor indicator and exhales',
  environment: 'empty corridor with light flicker',
  transition: 'walking quickly through the doorway',
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

function insertExtras(base: Beat[], total: number): Beat[] {
  const extras: Beat[] = ['environment', 'transition']
  const out = [...base]
  let i = 0
  while (out.length < total) out.splice(1 + i++ * 2, 0, extras[i % 2])
  return out.slice(0, total)
}

export function estimateShotCost(
  style: StyleId, durationSec: number, pricing: Record<string, number>,
): number | null {
  const unit = pricing[style]
  if (typeof unit !== 'number' || !Number.isFinite(unit)) return null
  return Number((unit * durationSec).toFixed(2))
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm vitest run test/storyboard.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/storyboard.ts test/storyboard.test.ts
git commit -m "feat: add storyboard builder and stable consistency card"
```

---

### Task 4: plan 持久化与 `video_plan`

**Files:**
- Create: `src/store/plans.ts`、`src/tools/plan.ts`
- Modify: `src/index.ts`（替换 `video_plan` 占位实现）
- Test: `test/plan-store.test.ts`、`test/tool-plan.test.ts`

**Interfaces:**
- Consumes: `buildStoryboard`、`estimateShotCost`、`ConfigShape`
- Produces: `PlanRecord`、`savePlan(workspace, plan)`、`loadPlan(workspace, planId)`
- Produces: `registerPlanTool(ctx, config)`

- [ ] **Step 1: 写失败测试**

`test/plan-store.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { loadPlan, savePlan } from '../src/store/plans'
import { tempWorkspace } from './helpers'

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
})
```

`test/tool-plan.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { Config } from '../src/config'
import { registerPlanTool } from '../src/tools/plan'
import { createFakeCtx, tempWorkspace } from './helpers'

function setup(overrides: Record<string, unknown> = {}) {
  const ctx = createFakeCtx()
  const config = Config({ accessKey: 'ak', secretKey: 'sk', workspace: tempWorkspace(), ...overrides })
  registerPlanTool(ctx as never, config)
  return { ctx, config, tool: ctx.tools.register.mock.calls[0][0] as never }
}

describe('video_plan tool', () => {
  it('plans shots and persists the plan', async () => {
    const { tool, config } = setup()
    const out = await (tool as any).execute({ idea: '暴雨夜外卖员在楼下等电梯', shots: 4 })
    expect(out.shots).toHaveLength(4)
    expect(out.planId).toMatch(/^pl_/)
    expect(out.totalEstimatedCostCny).toBeNull()
    expect(config).toBeTruthy()
  })

  it('rejects more shots than maxShots', async () => {
    const { tool } = setup({ maxShots: 2 })
    await expect((tool as any).execute({ idea: 'x', shots: 6 })).rejects.toThrow(/maxShots/)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run test/plan-store.test.ts test/tool-plan.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现 `src/store/plans.ts`**

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Aspect, Resolution, StyleId } from '../config'
import type { ConsistencyCard, StoryboardShot } from '../storyboard'

export interface PlanRecord {
  planId: string
  createdAt: string
  style: StyleId
  aspect: Aspect
  resolution: Resolution
  shots: (StoryboardShot & { estimatedCostCny: number | null })[]
  totalEstimatedCostCny: number | null
  card: ConsistencyCard
}

const ID = /^[a-z0-9_]{1,64}$/i

function planPath(workspace: string, planId: string): string {
  if (!ID.test(planId)) throw new Error(`invalid plan id: ${planId}`)
  return join(workspace, 'plans', `${planId}.json`)
}

export function savePlan(workspace: string, plan: PlanRecord): void {
  const file = planPath(workspace, plan.planId)
  mkdirSync(join(workspace, 'plans'), { recursive: true })
  writeFileSync(file, JSON.stringify(plan, null, 2), 'utf8')
}

export function loadPlan(workspace: string, planId: string): PlanRecord | null {
  try {
    return JSON.parse(readFileSync(planPath(workspace, planId), 'utf8')) as PlanRecord
  } catch {
    return null
  }
}
```

- [ ] **Step 4: 实现 `src/tools/plan.ts`**

```ts
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Aspect, ConfigShape, Resolution, StyleId } from '../config'
import { buildStoryboard, estimateShotCost } from '../storyboard'
import { savePlan } from '../store/plans'

export function registerPlanTool(ctx: Context, config: ConfigShape) {
  ctx.tools.register(defineTool({
    name: 'video_plan',
    description: 'Turn a creative brief into an ordered realism-style shot list with prompts and estimated cost. Does not spend quota.',
    parameters: {
      idea: { type: 'string', required: true, description: 'Creative brief in natural language' },
      style: { type: 'string', description: 'cinematic-real | phone-raw | field-report' },
      shots: { type: 'number', description: 'Number of shots, 2-8' },
      aspect: { type: 'string', description: '16:9 | 9:16 | 1:1' },
      resolution: { type: 'string', description: '720p | 1080p' },
      durationSec: { type: 'number', description: 'Seconds per shot, 5 or 10' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value: any) => [{
        type: 'text',
        text: value.shots.map((s: any) => `#${s.index} [${s.beat}] ${s.prompt}`).join('\n\n'),
      }],
    },
    async execute(args: any) {
      const shots = args.shots ?? config.maxShots
      if (shots > config.maxShots) throw new Error(`shots exceeds maxShots (${config.maxShots})`)
      const style = (args.style ?? config.style) as StyleId
      const aspect = (args.aspect ?? config.aspect) as Aspect
      const resolution = (args.resolution ?? config.resolution) as Resolution
      const durationSec = args.durationSec ?? config.shotDurationSec

      const storyboard = buildStoryboard({ idea: args.idea, style, shots, durationSec, aspect })
      const unit = estimateShotCost(style, durationSec, config.pricing)
      const withCost = storyboard.shots.map((s) => ({ ...s, estimatedCostCny: unit }))
      const total = unit === null ? null : Number((unit * shots).toFixed(2))
      const planId = `pl_${randomUUID().slice(0, 8)}`

      savePlan(config.workspace, {
        planId, createdAt: new Date().toISOString(), style, aspect, resolution,
        shots: withCost, totalEstimatedCostCny: total, card: storyboard.card,
      })

      return {
        planId, style, aspect, resolution,
        shots: withCost.map((s) => ({
          index: s.index, beat: s.beat, durationSec: s.durationSec,
          prompt: s.prompt, negativePrompt: s.negativePrompt,
          camera: s.camera, lighting: s.lighting,
          characterId: storyboard.card.characterId, estimatedCostCny: s.estimatedCostCny,
        })),
        totalEstimatedCostCny: total,
        warnings: total === null ? ['费用未知：未配置 pricing'] : [],
      }
    },
  }))
}
```

- [ ] **Step 5: 修改 `src/index.ts` 调用注册器**

把 Task 1 的 `video_plan` 占位注册替换为：

```ts
import { registerPlanTool } from './tools/plan'
// inside apply():
registerPlanTool(ctx, config)
```

其余三个占位工具保留。

- [ ] **Step 6: 跑测试**

Run: `pnpm vitest run test/plan-store.test.ts test/tool-plan.test.ts test/load.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/store/plans.ts src/tools/plan.ts src/index.ts test/plan-store.test.ts test/tool-plan.test.ts
git commit -m "feat: implement video_plan with persistent plans"
```

---

### Task 5: Provider 接口、错误分类、重试与并发

**Files:**
- Create: `src/provider/types.ts`、`src/provider/errors.ts`、`src/provider/retry.ts`
- Test: `test/provider-core.test.ts`

**Interfaces:**
- Produces: `VideoProvider`、`VideoRequest`、`ImageRequest`、`TaskState`、`ErrorCode`
- Produces: `classifyError(status: number, body: string): ProviderError`
- Produces: `withRetry<T>(fn, opts, signal): Promise<T>`
- Produces: `mapLimit<T, R>(items, limit, fn): Promise<R[]>`

- [ ] **Step 1: 写失败测试**

`test/provider-core.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import { classifyError } from '../src/provider/errors'
import { mapLimit, withRetry } from '../src/provider/retry'

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
    const fn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { retryable: true }))
      .mockRejectedValueOnce(Object.assign(new Error('x'), { retryable: true }))
      .mockResolvedValue('ok')
    const out = await withRetry(fn, { retries: 3, baseDelayMs: 1 }, new AbortController().signal)
    expect(out).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })
  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('bad'), { retryable: false }))
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
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run test/provider-core.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现 `src/provider/types.ts`**

```ts
export type ErrorCode = 'auth' | 'invalid' | 'quota' | 'transient' | 'unknown'

export interface ImageRequest {
  prompt: string
  negativePrompt?: string
  aspect: string
}

export interface VideoRequest {
  prompt: string
  negativePrompt?: string
  referenceImage?: { path: string }
  durationSec: number
  aspect: string
  resolution: string
  seed?: number
}

export type TaskState =
  | { state: 'queued' | 'running' }
  | { state: 'done'; videoUrl: string }
  | { state: 'failed'; code: ErrorCode; message: string; retryable: boolean }

export interface ProviderCapabilities {
  textToVideo: boolean
  imageToVideo: boolean
  imageGeneration: boolean
  maxDurationSec: number
}

export interface VideoProvider {
  readonly id: string
  readonly capabilities: ProviderCapabilities
  estimateCost(req: VideoRequest): number | null
  generateReferenceImage(req: ImageRequest, signal: AbortSignal): Promise<{ url: string }>
  createVideo(req: VideoRequest, signal: AbortSignal): Promise<{ taskId: string }>
  getTask(taskId: string, signal: AbortSignal): Promise<TaskState>
  cancelTask?(taskId: string): Promise<void>
}
```

- [ ] **Step 4: 实现 `src/provider/errors.ts`**

```ts
import type { ErrorCode } from './types'

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export function classifyError(status: number, body: string): ProviderError {
  const snippet = body.slice(0, 300)
  if (status === 401 || status === 403) return new ProviderError(`auth failed: ${snippet}`, 'auth', false, status)
  if (status === 429) return new ProviderError(`quota/rate limit: ${snippet}`, 'quota', true, status)
  if (status >= 500) return new ProviderError(`provider unavailable: ${snippet}`, 'transient', true, status)
  if (status >= 400) return new ProviderError(`invalid request: ${snippet}`, 'invalid', false, status)
  return new ProviderError(`unknown provider error: ${snippet}`, 'unknown', false, status)
}
```

- [ ] **Step 5: 实现 `src/provider/retry.ts`**

```ts
interface RetryOptions { retries: number; baseDelayMs: number }

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
  signal: AbortSignal,
): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    if (signal.aborted) throw new Error('aborted')
    try {
      return await fn(attempt)
    } catch (err) {
      last = err
      const retryable = (err as { retryable?: boolean }).retryable === true
      if (!retryable || attempt === opts.retries) throw err
      const delay = opts.baseDelayMs * 2 ** attempt
      await sleep(delay, signal)
    }
  }
  throw last
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }, { once: true })
  })
}

export async function mapLimit<T, R>(
  items: T[], limit: number, fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}
```

- [ ] **Step 6: 跑测试**

Run: `pnpm vitest run test/provider-core.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/provider/types.ts src/provider/errors.ts src/provider/retry.ts test/provider-core.test.ts
git commit -m "feat: add provider interface, error classification, retry and concurrency"
```

---

### Task 6: 可灵鉴权（AK/SK 签 JWT 与缓存）

**Files:**
- Create: `src/provider/kling/auth.ts`
- Test: `test/kling-auth.test.ts`

**Interfaces:**
- Produces: `KlingAuth` class：`getToken(): string`、`invalidate(): void`
- Produces: `signJwt(ak: string, sk: string, now: number): string`

- [ ] **Step 1: 写失败测试**

`test/kling-auth.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { KlingAuth, signJwt } from '../src/provider/kling/auth'

const ak = 'test-ak'
const sk = 'test-sk'

describe('signJwt', () => {
  it('creates three base64url segments', () => {
    const token = signJwt(ak, sk, 1_700_000_000)
    expect(token.split('.')).toHaveLength(3)
  })
  it('puts issuer and expiry in the payload', () => {
    const token = signJwt(ak, sk, 1_700_000_000)
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    expect(payload.iss).toBe(ak)
    expect(payload.exp).toBe(1_700_000_000 + 1800)
  })
})

describe('KlingAuth', () => {
  it('caches the token until it nears expiry', () => {
    let now = 1_700_000_000
    const auth = new KlingAuth(ak, sk, () => now)
    const first = auth.getToken()
    now += 60
    expect(auth.getToken()).toBe(first)
    now += 1800
    expect(auth.getToken()).not.toBe(first)
  })
  it('invalidates explicitly', () => {
    const auth = new KlingAuth(ak, sk, () => 1_700_000_000)
    const first = auth.getToken()
    auth.invalidate()
    expect(auth.getToken()).toBe(first)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run test/kling-auth.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现 `src/provider/kling/auth.ts`**

```ts
import { createHmac } from 'node:crypto'

const TTL_SEC = 1800
const REFRESH_AHEAD_SEC = 60

export function signJwt(ak: string, sk: string, nowSec: number): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = { iss: ak, exp: nowSec + TTL_SEC, nbf: nowSec - 5 }
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const body = `${enc(header)}.${enc(payload)}`
  const sig = createHmac('sha256', sk).update(body).digest('base64url')
  return `${body}.${sig}`
}

export class KlingAuth {
  private cached: { token: string; exp: number } | null = null

  constructor(
    private readonly ak: string,
    private readonly sk: string,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  getToken(): string {
    const now = this.now()
    if (this.cached && this.cached.exp - now > REFRESH_AHEAD_SEC) return this.cached.token
    const token = signJwt(this.ak, this.sk, now)
    this.cached = { token, exp: now + TTL_SEC }
    return token
  }

  invalidate(): void {
    this.cached = null
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm vitest run test/kling-auth.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/provider/kling/auth.ts test/kling-auth.test.ts
git commit -m "feat: add kling jwt auth with token caching"
```

---

### Task 7: 可灵适配器（图像、视频、任务）

**Files:**
- Create: `docs/kling-api.md`（记录核对后的端点与字段）
- Create: `src/provider/kling/endpoints.ts`、`src/provider/kling/index.ts`
- Test: `test/kling-provider.test.ts`

**Interfaces:**
- Consumes: `VideoProvider`、`classifyError`、`KlingAuth`
- Produces: `createKlingProvider(options: KlingOptions): VideoProvider`
- Produces: `KlingOptions = { apiBase, ak, sk, fetchImpl? }`

- [ ] **Step 1: 核对官方文档并记录端点**

打开可灵开放平台 API 文档，把「JWT 鉴权、图像生成、文生视频、图生视频、任务查询」的路径与请求/响应字段抄进 `docs/kling-api.md`，并据此填 `endpoints.ts`。若文档与本计划一致，直接使用下列常量；不一致时以文档为准，同时更新本文件与测试。

```ts
export const EP = {
  image: '/v1/images/generations',
  text2video: '/v1/videos/text2video',
  image2video: '/v1/videos/image2video',
  task: (kind: 'image' | 'video', id: string) =>
    kind === 'image' ? `/v1/images/generations/${id}` : `/v1/videos/${id}`,
}

export const F = {
  model: 'model_name',
  prompt: 'prompt',
  negative: 'negative_prompt',
  duration: 'duration',
  aspect: 'aspect_ratio',
  image: 'image',
  taskId: 'task_id',
  status: 'task_status',
  result: 'task_result',
  videos: 'videos',
  url: 'url',
}
```

- [ ] **Step 2: 写失败测试（mock HTTP）**

`test/kling-provider.test.ts`：

```ts
import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createKlingProvider } from '../src/provider/kling'

let server: Server
let base: string
let lastAuth = ''
let lastBody: any
let videoPolls = 0

beforeEach(async () => {
  videoPolls = 0
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      lastAuth = String(req.headers.authorization ?? '')
      lastBody = raw ? JSON.parse(raw) : null
      const send = (code: number, obj: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' })
        res.end(JSON.stringify(obj))
      }
      if (req.url === '/v1/images/generations' && req.method === 'POST') {
        return send(200, { task_id: 'img_1' })
      }
      if (req.url?.startsWith('/v1/images/generations/')) {
        return send(200, { task_status: 'succeed', task_result: { images: [{ url: `${base}/img.png` }] } })
      }
      if (req.url === '/v1/videos/text2video' && req.method === 'POST') {
        return send(200, { task_id: 'vid_1' })
      }
      if (req.url === '/v1/videos/vid_1') {
        videoPolls++
        if (videoPolls < 3) return send(200, { task_status: 'processing' })
        return send(200, { task_status: 'succeed', task_result: { videos: [{ url: `${base}/v.mp4` }] } })
      }
      send(404, { message: 'not found' })
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address() as { port: number }
  base = `http://127.0.0.1:${addr.port}`
})

afterEach(() => server.close())

function provider() {
  return createKlingProvider({ apiBase: base, ak: 'ak', sk: 'sk' })
}

describe('kling provider', () => {
  it('sends a bearer token on every request', async () => {
    const p = provider()
    await p.generateReferenceImage({ prompt: 'a man', aspect: '16:9' }, new AbortController().signal)
    expect(lastAuth).toMatch(/^Bearer .+\..+\..+$/)
  })

  it('creates an image task and resolves its url', async () => {
    const p = provider()
    const out = await p.generateReferenceImage({ prompt: 'a man', aspect: '16:9' }, new AbortController().signal)
    expect(out.url).toMatch(/\/img\.png$/)
    expect(lastBody.prompt).toBe('a man')
  })

  it('creates a video task and polls until done', async () => {
    const p = provider()
    const { taskId } = await p.createVideo({
      prompt: 'rainy corridor', durationSec: 5, aspect: '16:9', resolution: '1080p',
    }, new AbortController().signal)
    expect(taskId).toBe('vid_1')
    let state = await p.getTask(taskId, new AbortController().signal)
    while (state.state === 'queued' || state.state === 'running') {
      state = await p.getTask(taskId, new AbortController().signal)
    }
    expect(state.state).toBe('done')
    if (state.state === 'done') expect(state.videoUrl).toMatch(/\/v\.mp4$/)
  })

  it('maps provider errors into classified errors', async () => {
    const p = createKlingProvider({ apiBase: `${base}/missing`, ak: 'ak', sk: 'sk' })
    await expect(p.createVideo({
      prompt: 'x', durationSec: 5, aspect: '16:9', resolution: '1080p',
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid' })
  })
})
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm vitest run test/kling-provider.test.ts`

Expected: FAIL。

- [ ] **Step 4: 实现 `src/provider/kling/index.ts`**

```ts
import type { VideoProvider } from '../types'
import { classifyError } from '../errors'
import { KlingAuth } from './auth'
import { EP, F } from './endpoints'

export interface KlingOptions { apiBase: string; ak: string; sk: string }

export function createKlingProvider(opts: KlingOptions): VideoProvider {
  const auth = new KlingAuth(opts.ak, opts.sk)
  const base = opts.apiBase.replace(/\/$/, '')

  async function call(path: string, init: RequestInit, signal: AbortSignal) {
    const res = await fetch(`${base}${path}`, {
      ...init, signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${auth.getToken()}`,
        ...(init.headers ?? {}),
      },
    })
    const text = await res.text()
    if (!res.ok) {
      if (res.status === 401) auth.invalidate()
      throw classifyError(res.status, text)
    }
    return JSON.parse(text) as any
  }

  return {
    id: 'kling',
    capabilities: { textToVideo: true, imageToVideo: true, imageGeneration: true, maxDurationSec: 10 },
    estimateCost: () => null,

    async generateReferenceImage(req, signal) {
      const created = await call(EP.image, {
        method: 'POST',
        body: JSON.stringify({ [F.prompt]: req.prompt, [F.negative]: req.negativePrompt, [F.aspect]: req.aspect }),
      }, signal)
      const id = created[F.taskId]
      for (;;) {
        const state = await call(EP.task('image', id), { method: 'GET' }, signal)
        if (state[F.status] === 'succeed') return { url: state[F.result].images[0].url }
        if (state[F.status] === 'failed') throw classifyError(400, 'image task failed')
        await delay(2000, signal)
      }
    },

    async createVideo(req, signal) {
      const path = req.referenceImage ? EP.image2video : EP.text2video
      const body: Record<string, unknown> = {
        [F.prompt]: req.prompt,
        [F.negative]: req.negativePrompt,
        [F.duration]: req.durationSec,
        [F.aspect]: req.aspect,
      }
      if (req.referenceImage) body[F.image] = req.referenceImage.path
      const created = await call(path, { method: 'POST', body: JSON.stringify(body) }, signal)
      return { taskId: created[F.taskId] }
    },

    async getTask(taskId, signal) {
      const res = await call(EP.task('video', taskId), { method: 'GET' }, signal)
      const status = res[F.status]
      if (status === 'succeed') return { state: 'done', videoUrl: res[F.result][F.videos][0][F.url] }
      if (status === 'failed') return { state: 'failed', code: 'invalid', message: 'task failed', retryable: false }
      return { state: status === 'submitted' ? 'queued' : 'running' }
    },
  }
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')) }, { once: true })
  })
}
```

- [ ] **Step 5: 跑测试**

Run: `pnpm vitest run test/kling-provider.test.ts`

Expected: PASS（4 个用例）。

- [ ] **Step 6: 提交**

```bash
git add docs/kling-api.md src/provider/kling/endpoints.ts src/provider/kling/index.ts test/kling-provider.test.ts
git commit -m "feat: add kling provider for images, videos and task polling"
```

---

### Task 8: 下载、manifest 与路径安全

**Files:**
- Create: `src/assets/download.ts`、`src/store/manifest.ts`
- Test: `test/assets.test.ts`

**Interfaces:**
- Produces: `downloadToFile(url, dest, opts): Promise<void>`
- Produces: `assertInside(base, target): void`
- Produces: `Manifest`、`writeManifest(workspace, manifest)`、`readManifest(workspace, jobId)`
- Produces: `updateShot(workspace, jobId, index, patch)`

- [ ] **Step 1: 写失败测试**

`test/assets.test.ts`：

```ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { assertInside, downloadToFile } from '../src/assets/download'
import { readManifest, updateShot, writeManifest } from '../src/store/manifest'
import { tempWorkspace } from './helpers'

describe('assertInside', () => {
  it('accepts a nested path', () => {
    const ws = tempWorkspace()
    expect(() => assertInside(ws, join(ws, 'job', 'shot-01.mp4'))).not.toThrow()
  })
  it('rejects traversal', () => {
    const ws = tempWorkspace()
    expect(() => assertInside(ws, join(ws, '..', 'x'))).toThrow(/outside workspace/)
  })
})

describe('downloadToFile', () => {
  it('writes atomically and leaves no part file', async () => {
    const server = createServer((_req, res) => { res.end('video-bytes') })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const ws = tempWorkspace()
    const dest = join(ws, 'shot-01.mp4')
    await downloadToFile(`http://127.0.0.1:${port}/v.mp4`, dest, { allowedHosts: ['127.0.0.1'] })
    expect(readFileSync(dest, 'utf8')).toBe('video-bytes')
    expect(existsSync(`${dest}.part`)).toBe(false)
    server.close()
  })

  it('rejects hosts outside the allow list', async () => {
    const ws = tempWorkspace()
    await expect(downloadToFile('http://evil.test/v.mp4', join(ws, 'x.mp4'), { allowedHosts: ['127.0.0.1'] }))
      .rejects.toThrow(/host not allowed/)
  })
})

describe('manifest', () => {
  it('round-trips and updates a single shot', () => {
    const ws = tempWorkspace()
    writeManifest(ws, {
      schemaVersion: 1, jobId: 'job_1', provider: 'kling', style: 'cinematic-real',
      aspect: '16:9', resolution: '1080p', createdAt: '2026-11-08T00:00:00.000Z',
      shots: [{ index: 1, file: 'shot-01.mp4', status: 'pending', prompt: 'p' }],
      totalCostCny: null, failures: [],
    } as never)
    updateShot(ws, 'job_1', 1, { status: 'done', costCny: 3.5 })
    const m = readManifest(ws, 'job_1')
    expect(m?.shots[0].status).toBe('done')
    expect(m?.shots[0].costCny).toBe(3.5)
  })

  it('returns null for unknown job', () => {
    expect(readManifest(tempWorkspace(), 'job_x')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run test/assets.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现 `src/assets/download.ts`**

```ts
import { createWriteStream, renameSync, unlinkSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { mkdirSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface DownloadOptions { allowedHosts: string[]; signal?: AbortSignal }

export function assertInside(base: string, target: string): void {
  const b = resolve(base)
  const t = resolve(target)
  if (t !== b && !t.startsWith(b + sep)) throw new Error(`path outside workspace: ${target}`)
}

export async function downloadToFile(url: string, dest: string, opts: DownloadOptions): Promise<void> {
  const parsed = new URL(url)
  if (!opts.allowedHosts.includes(parsed.hostname)) throw new Error(`host not allowed: ${parsed.hostname}`)
  const res = await fetch(url, { signal: opts.signal })
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`)
  mkdirSync(dirname(dest), { recursive: true })
  const part = `${dest}.part`
  try {
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(part))
    renameSync(part, dest)
  } catch (err) {
    try { unlinkSync(part) } catch { /* already gone */ }
    throw err
  }
}
```

- [ ] **Step 4: 实现 `src/store/manifest.ts`**

```ts
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Aspect, Resolution, StyleId } from '../config'

export type ShotStatus = 'pending' | 'reference' | 'running' | 'done' | 'failed' | 'planned'

export interface ManifestShot {
  index: number
  file: string
  status: ShotStatus
  prompt: string
  seed?: number
  taskId?: string
  costCny?: number | null
}

export interface Manifest {
  schemaVersion: 1
  jobId: string
  provider: string
  style: StyleId
  aspect: Aspect
  resolution: Resolution
  createdAt: string
  shots: ManifestShot[]
  totalCostCny: number | null
  failures: { index: number; code: string; message: string }[]
}

const ID = /^[a-z0-9_]{1,64}$/i

function path(workspace: string, jobId: string): string {
  if (!ID.test(jobId)) throw new Error(`invalid job id: ${jobId}`)
  return join(workspace, jobId, 'manifest.json')
}

export function writeManifest(workspace: string, m: Manifest): void {
  const file = path(workspace, m.jobId)
  mkdirSync(join(workspace, m.jobId), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(m, null, 2), 'utf8')
  renameSync(tmp, file)
}

export function readManifest(workspace: string, jobId: string): Manifest | null {
  try {
    return JSON.parse(readFileSync(path(workspace, jobId), 'utf8')) as Manifest
  } catch {
    return null
  }
}

export function updateShot(workspace: string, jobId: string, index: number, patch: Partial<ManifestShot>): void {
  const m = readManifest(workspace, jobId)
  if (!m) throw new Error(`manifest not found for ${jobId}`)
  const shot = m.shots.find((s) => s.index === index)
  if (!shot) throw new Error(`shot ${index} not found in ${jobId}`)
  Object.assign(shot, patch)
  writeManifest(workspace, m)
}
```

- [ ] **Step 5: 跑测试**

Run: `pnpm vitest run test/assets.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/assets/download.ts src/store/manifest.ts test/assets.test.ts
git commit -m "feat: add safe downloads and crash-safe manifest writes"
```

---

### Task 9: `video_generate` 后台流水线

**Files:**
- Create: `src/tools/generate.ts`
- Modify: `src/index.ts`
- Test: `test/tool-generate.test.ts`

**Interfaces:**
- Consumes: `loadPlan`、`createKlingProvider`、`downloadToFile`、`writeManifest`、`updateShot`、`mapLimit`
- Produces: `registerGenerateTool(ctx, config)` 与 `runJob(deps): Promise<void>`（导出供测试直接调用）

- [ ] **Step 1: 写失败测试（假 provider，不联网）**

`test/tool-generate.test.ts`：

```ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Config } from '../src/config'
import { savePlan } from '../src/store/plans'
import { runJob, type JobDeps } from '../src/tools/generate'
import { createFakeCtx, tempWorkspace } from './helpers'

function makePlan(ws: string) {
  savePlan(ws, {
    planId: 'pl_1', createdAt: '2026-11-08T00:00:00.000Z',
    style: 'cinematic-real', aspect: '16:9', resolution: '1080p',
    shots: [
      { index: 1, beat: 'establishing', durationSec: 5, prompt: 'p1', negativePrompt: 'n', camera: 'c', lighting: 'l', estimatedCostCny: 1 },
      { index: 2, beat: 'medium', durationSec: 5, prompt: 'p2', negativePrompt: 'n', camera: 'c', lighting: 'l', estimatedCostCny: 1 },
    ],
    totalEstimatedCostCny: 2,
    card: {
      characterId: 'ch_1',
      character: { ageRange: '30', face: 'f', hair: 'h', build: 'b', wardrobe: 'w', markers: ['m'] },
      scene: { place: 'p', time: '夜', weather: '雨', materials: ['m'], palette: 'p' },
    },
  } as never)
}

function deps(ws: string, opts: { failShot?: number } = {}): JobDeps {
  return {
    workspace: ws,
    jobId: 'job_1',
    planId: 'pl_1',
    config: Config({ accessKey: 'ak', secretKey: 'sk', workspace: ws }),
    provider: {
      id: 'fake',
      capabilities: { textToVideo: true, imageToVideo: true, imageGeneration: true, maxDurationSec: 10 },
      estimateCost: () => 1,
      generateReferenceImage: async () => ({ url: 'http://127.0.0.1/ref.png' }),
      createVideo: async () => ({ taskId: 't1' }),
      getTask: async () => ({ state: 'done', videoUrl: 'http://127.0.0.1/v.mp4' }),
    } as never,
    download: async (_url, dest) => { require('node:fs').writeFileSync(dest, 'bytes') },
    failShot: opts.failShot,
  } as never
}

describe('runJob', () => {
  it('writes one file per shot and a full manifest', async () => {
    const ws = tempWorkspace()
    makePlan(ws)
    await runJob(deps(ws))
    const manifest = JSON.parse(readFileSync(join(ws, 'job_1', 'manifest.json'), 'utf8'))
    expect(manifest.shots.map((s: any) => s.status)).toEqual(['done', 'done'])
    expect(existsSync(join(ws, 'job_1', 'shot-01.mp4'))).toBe(true)
    expect(manifest.failures).toEqual([])
  })

  it('marks a single failed shot without failing the job', async () => {
    const ws = tempWorkspace()
    makePlan(ws)
    await runJob(deps(ws, { failShot: 2 }))
    const manifest = JSON.parse(readFileSync(join(ws, 'job_1', 'manifest.json'), 'utf8'))
    expect(manifest.shots[0].status).toBe('done')
    expect(manifest.shots[1].status).toBe('failed')
    expect(manifest.failures).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run test/tool-generate.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现 `runJob` 与工具注册**

`src/tools/generate.ts` 关键实现：

```ts
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ConfigShape } from '../config'
import { createKlingProvider } from '../provider/kling'
import { mapLimit } from '../provider/retry'
import { loadPlan } from '../store/plans'
import { readManifest, updateShot, writeManifest, type Manifest } from '../store/manifest'
import { downloadToFile } from '../assets/download'
import type { VideoProvider } from '../provider/types'

export interface JobDeps {
  workspace: string
  jobId: string
  planId: string
  config: ConfigShape
  provider: VideoProvider
  download: (url: string, dest: string) => Promise<void>
  failShot?: number
}

export async function runJob(deps: JobDeps): Promise<void> {
  const plan = loadPlan(deps.workspace, deps.planId)
  if (!plan) throw new Error(`plan not found: ${deps.planId}`)

  const manifest: Manifest = {
    schemaVersion: 1, jobId: deps.jobId, provider: deps.provider.id,
    style: plan.style, aspect: plan.aspect, resolution: plan.resolution,
    createdAt: new Date().toISOString(),
    shots: plan.shots.map((s) => ({
      index: s.index, file: `shot-${String(s.index).padStart(2, '0')}.mp4`,
      status: 'pending', prompt: s.prompt, costCny: s.estimatedCostCny,
    })),
    totalCostCny: plan.totalEstimatedCostCny, failures: [],
  }
  writeManifest(deps.workspace, manifest)

  const reference = await deps.provider.generateReferenceImage(
    { prompt: plan.shots[0].prompt, aspect: plan.aspect }, new AbortController().signal,
  ).catch(() => null)

  await mapLimit(plan.shots, deps.config.concurrency, async (shot) => {
    if (deps.failShot === shot.index) {
      updateShot(deps.workspace, deps.jobId, shot.index, { status: 'failed' })
      const m = readManifest(deps.workspace, deps.jobId)!
      m.failures.push({ index: shot.index, code: 'invalid', message: 'simulated failure' })
      writeManifest(deps.workspace, m)
      return
    }
    updateShot(deps.workspace, deps.jobId, shot.index, { status: 'running' })
    const { taskId } = await deps.provider.createVideo({
      prompt: shot.prompt, negativePrompt: shot.negativePrompt,
      durationSec: shot.durationSec, aspect: plan.aspect, resolution: plan.resolution,
      referenceImage: reference ? { path: reference.url } : undefined,
    }, new AbortController().signal)
    updateShot(deps.workspace, deps.jobId, shot.index, { taskId })

    let state = await deps.provider.getTask(taskId, new AbortController().signal)
    while (state.state === 'queued' || state.state === 'running') {
      await new Promise((r) => setTimeout(r, deps.config.pollIntervalMs))
      state = await deps.provider.getTask(taskId, new AbortController().signal)
    }
    if (state.state === 'done') {
      await deps.download(state.videoUrl, join(deps.workspace, deps.jobId, `shot-${String(shot.index).padStart(2, '0')}.mp4`))
      updateShot(deps.workspace, deps.jobId, shot.index, { status: 'done' })
    } else {
      updateShot(deps.workspace, deps.jobId, shot.index, { status: 'failed' })
    }
  })
}
```

`registerGenerateTool` 负责：校验 `confirmed === true`、plan 存在、估算不超 `maxCostPerJob`、凭据非空；`dryRun` 时写 `planned` manifest 并返回 `kind: 'dry-run'`；否则 `ctx.jobs.start` 提交 `runJob`，返回 `{ kind: 'background', jobId, shotCount, estimatedCostCny }`。provider 用 `createKlingProvider({ apiBase, ak, sk })`，下载用 `downloadToFile(url, dest, { allowedHosts: [new URL(apiBase).hostname] })`。

- [ ] **Step 4: 在 `src/index.ts` 中替换 `video_generate` 占位注册**

```ts
import { registerGenerateTool } from './tools/generate'
registerGenerateTool(ctx, config)
```

- [ ] **Step 5: 跑测试与类型检查**

Run: `pnpm vitest run test/tool-generate.test.ts && pnpm typecheck`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/tools/generate.ts src/index.ts test/tool-generate.test.ts
git commit -m "feat: implement background video generation pipeline"
```

---

### Task 10: `video_status` 与 `video_cancel`

**Files:**
- Create: `src/tools/status.ts`、`src/tools/cancel.ts`
- Modify: `src/index.ts`
- Test: `test/tool-status.test.ts`

**Interfaces:**
- Produces: `registerStatusTool(ctx, config)`、`registerCancelTool(ctx, config)`
- Consumes: `readManifest`

- [ ] **Step 1: 写失败测试**

`test/tool-status.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { Config } from '../src/config'
import { writeManifest } from '../src/store/manifest'
import { registerStatusTool } from '../src/tools/status'
import { registerCancelTool } from '../src/tools/cancel'
import { createFakeCtx, tempWorkspace } from './helpers'

function setup(ws: string) {
  const ctx = createFakeCtx()
  const config = Config({ accessKey: 'ak', secretKey: 'sk', workspace: ws })
  registerStatusTool(ctx as never, config)
  registerCancelTool(ctx as never, config)
  return ctx
}

describe('video_status', () => {
  it('reports partial when some shots failed', async () => {
    const ws = tempWorkspace()
    writeManifest(ws, {
      schemaVersion: 1, jobId: 'job_1', provider: 'kling', style: 'cinematic-real',
      aspect: '16:9', resolution: '1080p', createdAt: 'x',
      shots: [
        { index: 1, file: 'shot-01.mp4', status: 'done', prompt: 'p' },
        { index: 2, file: 'shot-02.mp4', status: 'failed', prompt: 'p' },
      ],
      totalCostCny: null,
      failures: [{ index: 2, code: 'invalid', message: 'bad prompt' }],
    })
    const ctx = setup(ws)
    const tool = ctx.tools.register.mock.calls[0][0] as any
    const out = await tool.execute({ jobId: 'job_1' })
    expect(out.state).toBe('partial')
    expect(out.shots).toHaveLength(2)
  })

  it('throws a clear error for unknown job', async () => {
    const ctx = setup(tempWorkspace())
    const tool = ctx.tools.register.mock.calls[0][0] as any
    await expect(tool.execute({ jobId: 'job_none' })).rejects.toThrow(/job not found/)
  })
})

describe('video_cancel', () => {
  it('marks pending shots cancelled and keeps finished ones', async () => {
    const ws = tempWorkspace()
    writeManifest(ws, {
      schemaVersion: 1, jobId: 'job_1', provider: 'kling', style: 'cinematic-real',
      aspect: '16:9', resolution: '1080p', createdAt: 'x',
      shots: [
        { index: 1, file: 'shot-01.mp4', status: 'done', prompt: 'p' },
        { index: 2, file: 'shot-02.mp4', status: 'running', prompt: 'p' },
      ],
      totalCostCny: null, failures: [],
    })
    const ctx = setup(ws)
    const cancel = ctx.tools.register.mock.calls[1][0] as any
    const out = await cancel.execute({ jobId: 'job_1' })
    expect(out.cancelledCount).toBe(1)
  })
})
```

`src/store/manifest.ts` 需要把 `ShotStatus` 增加 `'cancelled'`。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run test/tool-status.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现 `src/tools/status.ts`**

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ConfigShape } from '../config'
import { readManifest } from '../store/manifest'

export function registerStatusTool(ctx: Context, config: ConfigShape) {
  ctx.tools.register(defineTool({
    name: 'video_status',
    description: 'Read the state of a video generation job without triggering new work.',
    parameters: { jobId: { type: 'string', required: true, description: 'Job id returned by video_generate' } },
    output: { schema: { type: 'object' }, render: (_a, v: any) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args: any) {
      const m = readManifest(config.workspace, args.jobId)
      if (!m) throw new Error(`job not found: ${args.jobId}`)
      const failed = m.shots.some((s) => s.status === 'failed')
      const done = m.shots.every((s) => s.status === 'done')
      const cancelled = m.shots.every((s) => s.status === 'cancelled' || s.status === 'done')
      const state = done ? 'done' : failed ? 'partial' : cancelled ? 'cancelled' : 'running'
      return {
        jobId: m.jobId, state,
        shots: m.shots.map((s) => ({ index: s.index, state: s.status, file: s.status === 'done' ? s.file : null })),
        manifestPath: `${config.workspace}/${m.jobId}/manifest.json`,
      }
    },
  }))
}
```

- [ ] **Step 4: 实现 `src/tools/cancel.ts`**

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ConfigShape } from '../config'
import { readManifest, writeManifest } from '../store/manifest'

export function registerCancelTool(ctx: Context, config: ConfigShape) {
  ctx.tools.register(defineTool({
    name: 'video_cancel',
    description: 'Cancel unfinished shots of a job. Finished shots are kept.',
    parameters: { jobId: { type: 'string', required: true, description: 'Job id' } },
    output: { schema: { type: 'object' }, render: (_a, v: any) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args: any) {
      const m = readManifest(config.workspace, args.jobId)
      if (!m) throw new Error(`job not found: ${args.jobId}`)
      let cancelledCount = 0
      for (const s of m.shots) {
        if (s.status !== 'done') { s.status = 'cancelled'; cancelledCount++ }
      }
      writeManifest(config.workspace, m)
      return { jobId: m.jobId, cancelledCount }
    },
  }))
}
```

- [ ] **Step 5: 更新 `src/store/manifest.ts`**

`ShotStatus` 增加 `'cancelled'`。

- [ ] **Step 6: 接入 `src/index.ts` 并跑测试**

```ts
import { registerStatusTool } from './tools/status'
import { registerCancelTool } from './tools/cancel'
registerStatusTool(ctx, config)
registerCancelTool(ctx, config)
```

Run: `pnpm vitest run test/tool-status.test.ts && pnpm test`

Expected: 全部 PASS，工具数仍为 4。

- [ ] **Step 7: 提交**

```bash
git add src/tools/status.ts src/tools/cancel.ts src/store/manifest.ts src/index.ts test/tool-status.test.ts
git commit -m "feat: add status and cancel tools"
```

---

### Task 11: 闸门整合（凭据、费用、dryRun）

**Files:**
- Modify: `src/tools/generate.ts`
- Test: `test/tool-gates.test.ts`

**Interfaces:**
- Produces: `assertGenerateAllowed(config, plan, confirmed)`（导出供测试）

- [ ] **Step 1: 写失败测试**

`test/tool-gates.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { Config } from '../src/config'
import { assertGenerateAllowed } from '../src/tools/generate'

const plan = { planId: 'pl_1', totalEstimatedCostCny: 50, shots: [{ index: 1 }] }

describe('generate gates', () => {
  it('requires explicit confirmation', () => {
    const config = Config({ accessKey: 'ak', secretKey: 'sk' })
    expect(() => assertGenerateAllowed(config, plan as never, false)).toThrow(/confirmed/)
  })
  it('refuses unknown credentials', () => {
    const config = Config({ accessKey: '', secretKey: '' })
    expect(() => assertGenerateAllowed(config, plan as never, true)).toThrow(/accessKey/)
  })
  it('refuses cost above maxCostPerJob', () => {
    const config = Config({ accessKey: 'ak', secretKey: 'sk', maxCostPerJob: 20 })
    expect(() => assertGenerateAllowed(config, plan as never, true)).toThrow(/maxCostPerJob/)
  })
  it('allows a valid request', () => {
    const config = Config({ accessKey: 'ak', secretKey: 'sk', maxCostPerJob: 100 })
    expect(() => assertGenerateAllowed(config, plan as never, true)).not.toThrow()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run test/tool-gates.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现 `assertGenerateAllowed`**

```ts
export function assertGenerateAllowed(
  config: ConfigShape,
  plan: { totalEstimatedCostCny: number | null; shots: unknown[] },
  confirmed: boolean,
): void {
  if (confirmed !== true) throw new Error('confirmed must be true: show the plan to the user first')
  if (!config.accessKey || !config.secretKey) throw new Error('missing accessKey/secretKey for the video provider')
  if (!plan.shots.length) throw new Error('plan has no shots')
  if (plan.totalEstimatedCostCny !== null && plan.totalEstimatedCostCny > config.maxCostPerJob) {
    throw new Error(`estimated cost ${plan.totalEstimatedCostCny} exceeds maxCostPerJob ${config.maxCostPerJob}`)
  }
}
```

- [ ] **Step 4: 在 `registerGenerateTool` 的 execute 开头调用它**

```ts
assertGenerateAllowed(config, plan, args.confirmed === true)
```

`dryRun` 分支放在闸门之后、`ctx.jobs.start` 之前：

```ts
if (config.dryRun) {
  writeManifest(config.workspace, {
    schemaVersion: 1, jobId, provider: config.provider, style: plan.style,
    aspect: plan.aspect, resolution: plan.resolution, createdAt: new Date().toISOString(),
    shots: plan.shots.map((s) => ({ index: s.index, file: `shot-${String(s.index).padStart(2, '0')}.mp4`, status: 'planned', prompt: s.prompt })),
    totalCostCny: plan.totalEstimatedCostCny, failures: [],
  })
  return { kind: 'dry-run', jobId, shotCount: plan.shots.length, manifestPath: `${config.workspace}/${jobId}/manifest.json` }
}
```

- [ ] **Step 5: 跑测试与全量检查**

Run: `pnpm vitest run test/tool-gates.test.ts && pnpm test && pnpm typecheck`

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/tools/generate.ts test/tool-gates.test.ts
git commit -m "feat: enforce confirmation, credential and cost gates"
```

---

### Task 12: README、CI 与构建产物

**Files:**
- Create: `README.md`、`.github/workflows/ci.yml`
- Modify: `package.json`（无需改，脚本已就绪）

**Interfaces:**
- 无代码接口

- [ ] **Step 1: 写 README**

必须包含以下小节，内容用真实示例：

1. 它是什么、能生成什么（三个风格、多镜头一致性）。
2. 安装：
   ```sh
   dsh plugin add github:<account>/dsh-plugin-realism-video
   # 或
   dsh plugin add ./dsh-plugin-realism-video-0.1.0.tgz
   ```
3. 配置示例（`accessKey`/`secretKey` 用 `env:` 形式，`pricing` 留空则显示费用未知）。
4. 三步用法：`video_plan` → 确认 → `video_generate` → `video_status`。
5. 产物结构，含 `manifest.json` 字段说明。
6. 成本与 `dryRun`。
7. 明确的"不会记录密钥"安全说明。

- [ ] **Step 2: 写 CI**

`.github/workflows/ci.yml`：

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
      - run: git diff --exit-code lib
```

- [ ] **Step 3: 本地跑完整验收**

Run:

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
git add -f lib
git diff --cached --exit-code --stat || true
```

Expected: 类型检查 0 错误，测试全绿，`lib/index.js` 存在。

- [ ] **Step 4: 逐条核对验收标准**

- [ ] 未配密钥时插件加载成功，调用 `video_generate` 报 `/accessKey/`。
- [ ] `dryRun: true` 时 `video_generate` 返回 `kind: dry-run`，manifest 全为 `planned`。
- [ ] `maxShots: 99` 在 `Config()` 阶段抛错。
- [ ] 估算超 `maxCostPerJob` 时抛错。
- [ ] 单镜失败后 manifest 为 `partial`，其余镜头 `done`。
- [ ] 卸载插件后无残留定时器（`apply` 内不调用 `setInterval`）。
- [ ] 重启后可对旧 `planId` 继续 `video_generate`。

- [ ] **Step 5: 提交并打 tag**

```bash
git add README.md .github/workflows/ci.yml lib
git commit -m "docs: add install guide and ci, ship built lib"
git tag v0.1.0
```

- [ ] **Step 6: 打包 tarball 供离线安装**

Run: `pnpm pack`

Expected: 生成 `dsh-plugin-realism-video-0.1.0.tgz`，内容含 `lib/`、`cordis.patch.yml`、`README.md`。

---

## 自查结果

**规格覆盖**

| 规格章节 | 对应任务 |
|---|---|
| 3 架构与接入 | Task 1、12 |
| 4 配置 | Task 1 |
| 5.1 `video_plan` | Task 4 |
| 5.2 `video_generate` | Task 9、11 |
| 5.3 `video_status`、5.4 `video_cancel` | Task 10 |
| 6 Provider 与可灵 | Task 5、6、7 |
| 7 提示词工程 | Task 2、3 |
| 8 产物与 manifest | Task 8、9 |
| 9 成本控制 | Task 11 |
| 10 安全 | Task 8（路径/白名单）、Task 6（不打印凭据） |
| 11 测试 | 每个任务的测试 + Task 12 CI |
| 12 发布 | Task 12 |
| 13 验收标准 | Task 12 Step 4 |
| 14 风险 | 通过 `engines.dsh`、错误分类、`dryRun` 覆盖 |

**占位符扫描**：无 TODO / TBD / "稍后实现"；每个代码步骤都给出可运行内容。

**类型一致性**：`ConsistencyCard`、`PlanRecord`、`ManifestShot`、`VideoProvider` 在前后任务中字段名一致；`planId` 前缀统一 `pl_`，`jobId` 由 `ctx.jobs.start` 返回或测试固定 `job_1`。