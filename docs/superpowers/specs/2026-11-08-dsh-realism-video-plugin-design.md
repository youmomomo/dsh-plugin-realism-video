# dsh 现实感视频插件（dsh-plugin-realism-video）设计

- 日期：2026-11-08
- 状态：已确认，待实现
- 宿主：DeepSeek Harness（dsh）
- 形态：dsh 组合包（bundle），单包单体架构

## 1. 背景与目标

DeepSeek Harness 本身不具备视频生成能力。本插件在 dsh 中提供「一句话 → 一组看起来像真实拍摄的分镜视频」的完整能力，并以插件市场中可直接安装的形式分发：发布到 GitHub 后，用户执行 `dsh plugin add github:<account>/dsh-plugin-realism-video` 即可使用，无需构建授权。

插件不只做提示词转发。它负责分镜规划、真实感提示词合成、角色一致性控制、供应商调用、后台任务管理、产物落盘与成本控制。

### 目标

1. 把一句创意转化为 2–8 个镜头的分镜脚本，每镜有可执行的提示词与参数。
2. 通过「角色/场景定妆图 + 图生视频」保持跨镜头一致性。
3. 生成前先预览分镜与估算费用，用户确认后才消耗额度。
4. 长任务后台执行，完成后通知，可查询、可取消。
5. 产物为分镜 mp4 + 可追溯的 `manifest.json`，不依赖 ffmpeg。

### 非目标（v2 及以后）

- 音频生成、旁白 TTS（后续版本）
- 自动拼接成片（后续可选，需宿主机 ffmpeg）
- 本地开源模型推理
- 第二家视频供应商（仅保留接口）
- 专用 Web UI 卡片（先用通用卡片，`presentationMeta` 为可选项）
- 调用 LLM 润色提示词（预留 `llmPolish` 开关，默认关闭）

## 2. 用户流程

```
用户：帮我生成一段“暴雨夜外卖员在楼下等电梯”的现实感视频
  ↓
video_plan      → 分镜表 + 每镜提示词 + 估算费用（不花钱）
  ↓ 模型向用户复述，请求确认
用户：可以，生成
  ↓
video_generate  → 校验确认/费用/凭据 → 提交后台任务 → 返回 jobId
  ↓
video_status    → 查询进度（可选，随时）
  ↓
完成通知        → shot-01.mp4 … + manifest.json
```

三个闸门缺一不可：先预览、显式确认、费用上限。

## 3. 总体架构

单包单体。provider 在包内以接口形式隔离，未来可将 Definition / Provider / Consumer 拆成三个包而不改动工具层。

```
dsh-plugin-realism-video/
├── package.json
├── cordis.patch.yml
├── README.md
├── lib/                    # 构建产物，随仓库提交
├── src/
│   ├── index.ts            # apply(ctx, config)，注册工具
│   ├── config.ts           # Schemastery 配置
│   ├── provider/
│   │   ├── types.ts        # VideoProvider 接口
│   │   └── kling.ts        # 可灵适配器：图像 + 视频 + 任务
│   ├── styles.ts           # 三个风格预设
│   ├── storyboard.ts       # 创意 → 分镜 → 七段提示词
│   ├── assets.ts           # 定妆图缓存、下载、manifest
│   └── tools/
│       ├── plan.ts
│       ├── generate.ts
│       ├── status.ts
│       └── cancel.ts
└── test/
```

### 接入方式

`package.json` 关键字段：

```json
{
  "name": "dsh-plugin-realism-video",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "files": ["lib", "cordis.patch.yml", "README.md"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "engines": { "dsh": ">=0.2.0" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-tools": "*",
    "@deepseek-ai/schemastery": "*"
  }
}
```

peer 依赖同时声明在 `devDependencies` 中，供本地类型检查；运行时从宿主解析，避免双实例。

`cordis.patch.yml`：

```yaml
- insert:
    - id: realism-video
      name: dsh-plugin-realism-video
```

插件入口导出 `name`、`inject`、`Config`、`apply`。`inject = ['tools', 'jobs']`。所有注册属于 effect，随 fiber 卸载自动撤销；未完成 job 由 `ctx.jobs` 的 owner cleanup 处理；定妆图缓存与已下载产物不随卸载删除。

## 4. 配置

全部通过 Schemastery 声明，凡不同部署可能取不同值的参数一律可配，不硬编码。

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `provider` | enum | `kling` | provider 标识 |
| `accessKey` | string | 空 | 可灵 AccessKey，支持 `env:KLING_AK` |
| `secretKey` | string | 空 | 可灵 SecretKey，支持 `env:KLING_SK` |
| `apiBase` | string | 官方地址 | 可覆盖，便于代理 |
| `workspace` | string | `<cwd>/realism-video` | 产物根目录 |
| `style` | enum | `cinematic-real` | 默认风格 |
| `maxShots` | number | `4` | 1–8 |
| `maxCostPerJob` | number | `20` | 单次估算费用上限（元） |
| `aspect` | enum | `16:9` | `16:9` / `9:16` / `1:1` |
| `resolution` | enum | `1080p` | `720p` / `1080p` |
| `shotDurationSec` | number | `5` | `5` / `10` |
| `pollIntervalMs` | number | `5000` | 轮询起始间隔 |
| `timeoutMs` | number | `900000` | 任务总超时 |
| `concurrency` | number | `2` | 分镜并发数 |
| `dryRun` | boolean | `false` | 只产出分镜，不调用生成 |
| `llmPolish` | boolean | `false` | 预留：用 `ctx.llm` 润色提示词 |
| `pricing` | object | 空表 | 单价表，未配置时费用显示「未知」 |

配置非法（如 `maxShots` 越界、`concurrency < 1`）在插件加载阶段即失败，并给出明确错误。

## 5. 工具契约

四个工具通过 `planId` / `jobId` 串联，不依赖模型解析自然语言。

### 5.1 `video_plan`

把创意变成可审阅的分镜表，纯本地，不发任何生成请求。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `idea` | string | 是 | 原始创意 |
| `style` | enum | 否 | 覆盖默认风格 |
| `shots` | number | 否 | 2–8，超过 `maxShots` 拒绝 |
| `aspect` | enum | 否 | 覆盖默认比例 |
| `resolution` | enum | 否 | 覆盖默认分辨率 |
| `durationSec` | number | 否 | 单镜时长 |
| `characterId` | string | 否 | 复用已有角色卡 |

返回规范值：

```json
{
  "planId": "pl_8f3a",
  "style": "cinematic-real",
  "shots": [
    {
      "index": 1,
      "durationSec": 5,
      "prompt": "...",
      "negativePrompt": "...",
      "camera": "...",
      "lighting": "...",
      "characterId": "ch_2b1c",
      "estimatedCostCny": 3.5
    }
  ],
  "totalEstimatedCostCny": 17.5,
  "warnings": ["估计费用接近上限"]
}
```

`render` 输出中文分镜表。plan 持久化到 `workspace/plans/<planId>.json`，进程重启后仍可继续生成。

### 5.2 `video_generate`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `planId` | string | 是 | 必须由 `video_plan` 产生 |
| `confirmed` | boolean | 是 | 显式确认，防止误花钱 |
| `characterId` | string | 否 | 复用角色卡 |

提交前校验：plan 存在且未过期、`confirmed === true`、估算费用 ≤ `maxCostPerJob`、凭据可用。任一不满足抛出异常，并给出修法。

返回后台句柄：

```json
{ "kind": "background", "jobId": "job_5c2e", "shotCount": 4, "estimatedCostCny": 17.5 }
```

后台流水线：解析一致性卡 → 生成或复用定妆图 → 按并发逐镜提交 → 轮询 → 下载 → 写 manifest → 通知。

当配置 `dryRun` 为 `true` 时，本工具不创建后台任务、不调用 provider，直接写出 `manifest.json`（每镜状态为 `planned`）并返回 `{ "kind": "dry-run", "jobId": "job_5c2e", "shotCount": 4, "manifestPath": "..." }`。这是 `generate` 层的语义，`video_plan` 本身始终不花钱。

### 5.3 `video_status`

入参 `jobId`，返回：

```json
{
  "jobId": "job_5c2e",
  "state": "running",
  "shots": [{ "index": 1, "state": "done", "file": "shot-01.mp4" }],
  "manifestPath": ".../manifest.json"
}
```

状态取值：`queued` / `running` / `done` / `partial` / `failed` / `cancelled`。纯读，不触发新请求。

### 5.4 `video_cancel`

入参 `jobId`，取消未完成镜头，返回已取消数量；已下载产物保留。

### 5.5 渲染

先使用 `generic` 卡片。`video_status` 可选提供 `presentationMeta`，投影逐镜进度。所有展示方法必须是纯函数，不做 I/O。

## 6. Provider 接口与可灵适配器

```ts
export interface VideoProvider {
  readonly id: string
  readonly capabilities: {
    textToVideo: boolean
    imageToVideo: boolean
    imageGeneration: boolean
    maxDurationSec: number
  }
  estimateCost(req: VideoRequest): number | null
  generateReferenceImage(req: ImageRequest, signal: AbortSignal): Promise<{ url: string }>
  createVideo(req: VideoRequest, signal: AbortSignal): Promise<{ taskId: string }>
  getTask(taskId: string, signal: AbortSignal): Promise<TaskState>
  cancelTask?(taskId: string): Promise<void>
}

export type TaskState =
  | { state: 'queued' | 'running' }
  | { state: 'done'; videoUrl: string }
  | { state: 'failed'; code: ErrorCode; message: string; retryable: boolean }
```

可灵适配器能力映射：定妆图走图像生成，镜头走图生视频（带参考图），任务查询与取消走任务接口。

鉴权：AccessKey + SecretKey 本地签发 JWT，缓存到过期前 60 秒刷新，不逐请求重签。endpoint 路径、字段名与枚举值以实现时的可灵官方文档为准，细节不向上泄漏。

### 错误分类

| 类型 | 触发 | 策略 |
|---|---|---|
| `auth` | 401/403、签名错误 | 不重试，提示检查 accessKey/secretKey |
| `invalid` | 400、提示词违规、参数越界 | 不重试，回传原因并给改写建议 |
| `quota` | 429、余额不足 | 指数退避重试 3 次，仍失败则终止 |
| `transient` | 5xx、网络中断 | 指数退避重试 3 次，失败标记该镜 |

### 轮询与并发

- 轮询间隔从 `pollIntervalMs` 起指数退避，上限 30 秒；总时长超过 `timeoutMs` 判超时。
- 分镜按 `concurrency` 并发，使用自实现的并发控制器，不引入额外依赖。
- 单镜失败不连坐，其余镜头继续。

## 7. 提示词工程

### 7.1 原则

v1 使用确定性模板 + 变量填充，不调用 LLM 自由写作，保证可测试、可复现。`llmPolish` 为预留开关，默认关闭。

### 7.2 七段结构

```
① 主体：谁 / 什么，稳定特征
② 动作：这一镜只有一个动作
③ 环境：地点、时段、天气、前景遮挡
④ 摄影机：机位、焦段、运动方式
⑤ 光线：光源类型、方向、色温
⑥ 质感锚点：真实感细节
⑦ 负面词：去 AI 味
```

### 7.3 三个风格预设

| 维度 | `cinematic-real` | `phone-raw` | `field-report` |
|---|---|---|---|
| 机位 | 稳定器/滑轨、浅景深 | 手持竖屏、广角、对焦呼吸 | 手持、略仰拍、广角 |
| 光线 | 动机光、柔光、高动态 | 环境光、轻微过曝 | 现场光、逆光、阴天 |
| 质感 | 皮肤纹理、毛孔、真实景深 | 夜景噪点、镜头轻微脏污 | 颗粒、轻微闪烁、动态模糊 |
| 运动 | 缓慢推拉、跟拍 | 走动晃动、突然转镜 | 追拍、快速甩镜 |
| 负面重点 | 塑料感、过度磨皮、假景深 | 三脚架感、完美构图 | 棚拍感、布光痕迹 |

### 7.4 镜头节奏模板

5 秒/镜：`建立镜 → 主体中景 → 细节特写 → 反应镜`；6 镜时插入环境空镜与运动过渡镜。每镜只承载一个动作，避免手部变形与物体漂移。

### 7.5 一致性卡

```json
{
  "character": {
    "ageRange": "28-32",
    "face": "方下颌、深眼窝、左眉浅疤",
    "hair": "短寸、发际线略后移",
    "build": "偏瘦、肩窄",
    "wardrobe": "深灰工装夹克、磨旧袖口",
    "markers": ["左手腕旧表"]
  },
  "scene": {
    "place": "老城区楼道",
    "time": "傍晚",
    "weather": "阴",
    "materials": ["水磨石地面", "铁栏杆掉漆"],
    "palette": "冷灰+暖黄"
  }
}
```

每个镜头的提示词都从同一张卡渲染，`markers` 至少命中一项，作为跨镜头识别的强制钩子。

**卡的来源（v1 确定性策略）**

1. 从 `idea` 中按关键词表抽取地点、时段、天气、人物身份；命中即填。
2. 未命中的字段用风格预设的安全默认值补全（例如时段默认「傍晚」、天气默认「阴」）。
3. `markers` 由固定清单中按 hash(idea) 稳定选取 1–2 项，保证同一创意每次得到同一组标记。
4. 卡的 `characterId = sha256(角色字段 + 风格 + 比例)`；同一角色跨任务复用同一 id。

`video_plan` 只产出卡描述与 `characterId`，**不生成图片**；定妆图在 `video_generate` 阶段才真正生成，未确认就不花钱。

### 7.6 去 AI 味负面词库

```
plastic skin, airbrushed, overly smooth, perfect symmetry, CGI, 3D render,
cartoon, hyper-saturated, fake bokeh, floating objects, extra fingers,
warped hands, morphing faces, watermark, text
```

按风格取子集，不整段堆砌。

## 8. 产物与可靠性

```
<workspace>/<jobId>/
├── manifest.json
├── shot-01.mp4
├── shot-02.mp4
├── characters/ch_<hash>.png
└── plan.json
```

`manifest.json` 字段：

```json
{
  "schemaVersion": 1,
  "jobId": "job_5c2e",
  "provider": "kling",
  "style": "cinematic-real",
  "aspect": "16:9",
  "resolution": "1080p",
  "createdAt": "2026-11-08T13:00:00Z",
  "shots": [
    {
      "index": 1,
      "file": "shot-01.mp4",
      "status": "done",
      "prompt": "...",
      "seed": 42,
      "taskId": "k_88a",
      "costCny": 3.5
    }
  ],
  "totalCostCny": 17.5,
  "failures": []
}
```

写盘规则：

- 文件名零填充，字典序即分镜顺序。
- 下载先写 `.part`，完成后原子 rename，杜绝半截文件。
- 状态变化立即 flush manifest，崩溃后可凭 manifest 重建进度。

## 9. 成本控制

1. `video_plan` 给出估算费用。
2. `video_generate` 要求 `confirmed === true` 且估算 ≤ `maxCostPerJob`。
3. `dryRun` 为 `true` 时，`video_generate` 跳过 provider 与后台任务，仅写 `planned` 状态的 manifest，不发送任何生成请求。

单价来自配置 `pricing`，provider 只做换算。拿不到单价时返回 `null` 并显示「费用未知」，不伪造数字。manifest 同时记录估算值与 provider 回传的实际值。

## 10. 安全

- 日志与错误信息脱敏，绝不输出 accessKey、secretKey、JWT。
- 下载仅接受 provider 返回的 URL，host 必须在允许列表内。
- `workspace` 必须位于工作目录内，路径含 `..` 直接拒绝。
- 凭据只从配置或环境变量读取，不写入产物文件。

## 11. 测试

| 层 | 对象 | 方式 |
|---|---|---|
| 纯逻辑 | 预设渲染、七段组装、一致性卡 hash、费用估算、manifest 读写 | 单元测试，无网络 |
| Provider | 建任务、轮询、错误分类、退避重试、JWT 缓存 | `node:http` mock 服务 |
| 工具 | 参数校验、`confirmed` 闸、费用闸、缺凭据 | 假 `ctx` + 假 provider |
| 冒烟（可选） | 真实密钥生成 1 个 5 秒镜头 | 标 `@e2e`，CI 跳过 |

工具链：`tsdown` 构建、`vitest` 测试、TypeScript 严格模式，零运行时依赖。

## 12. 发布

1. `pnpm build` 产出 `lib/`。
2. `lib/` 随源码提交，这是 GitHub 直装可用的前提。
3. CI 执行 `pnpm build && git diff --exit-code lib`，防止产物与源码漂移。
4. 打 tag `v0.1.0`，Release 附 `pnpm pack` 生成的 tarball。
5. 用户安装：

```sh
dsh plugin add github:<account>/dsh-plugin-realism-video
dsh plugin add ./dsh-plugin-realism-video-0.1.0.tgz
```

两种方式都不需要 `allowBuilds` 授权。

## 13. 验收标准

- 未配置密钥时插件正常加载，调用工具给出明确提示，不崩溃。
- `dryRun` 产出分镜与 manifest，且不发送任何生成请求。
- 非法配置在加载阶段失败。
- 费用超限的任务被拒绝，不继续执行。
- 单镜失败时 job 状态为 `partial`，其余镜头完好。
- 卸载插件后四个工具立即消失，无残留定时器。
- 进程重启后，已 plan 未 generate 的任务仍可继续。

## 14. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 可灵 API 字段/枚举变更 | 适配器失效 | 适配器层隔离，错误分类可观测，版本范围声明 |
| 图生视频一致性仍不穩定 | 人物漂移 | 一致性卡 + markers 强制命中 + 定妆图复用 |
| 生成失败消耗额度 | 成本浪费 | 三道闸 + 单镜隔离 + dryRun |
| dsh peer 版本升级 | 加载失败 | `engines.dsh` 范围 + CI 对最近版本冒烟 |
| 费用单价不公开 | 估算不准 | 显示「费用未知」，不阻塞但明确提示 |

## 15. 实现顺序

1. 包骨架、manifest、配置 schema、空工具注册，加载即通过。
2. 风格预设 + 七段提示词 + 分镜模板 + 单元测试。
3. `video_plan` + plan 持久化。
4. 可灵适配器（JWT、图像、视频、任务）+ mock 测试。
5. `video_generate` 后台流水线 + manifest + 下载。
6. `video_status` / `video_cancel` + 崩溃恢复。
7. `dryRun`、费用闸、凭据校验、错误分类收敛。
8. README、安装说明、CI、tag 发布。