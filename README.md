# dsh-plugin-realism-video

给 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) 用的现实感视频生成插件。把一句创意变成一组「看起来像真实拍摄」的分镜视频：先出分镜和费用估算，用户确认后才调用视频模型，长任务后台执行。

## 能做什么

- **三种现实感风格**：超写实电影感、手机随手拍、新闻纪实。
- **多镜头分镜**：一句话拆成 2–8 个镜头，每镜一个动作，使用固定的七段提示词结构。
- **角色一致性**：从创意生成结构化一致性卡，先生成定妆图，再以参考图生成每个镜头；定妆图按角色缓存复用。
- **三道花钱闸门**：分镜预览 → 显式确认 → 单次费用上限。
- **可控的长任务**：提交、查询进度、取消；取消会真正阻止后续镜头继续消耗额度。
- **可追溯产物**：每个镜头一个 mp4，加一份增量写入的 `manifest.json`。

## 安装

```sh
dsh plugin add github:<account>/dsh-plugin-realism-video
```

或使用 Release 里的 tarball：

```sh
dsh plugin add ./dsh-plugin-realism-video-0.1.0.tgz
```

仓库内已提交构建好的 `lib/`，因此从 GitHub 安装不需要 `allowBuilds` 授权，也不会在安装时执行构建脚本。

## 配置

```yaml
- id: realism-video
  name: dsh-plugin-realism-video
  config:
    accessKey: env:KLING_AK
    secretKey: env:KLING_SK
```

`accessKey` / `secretKey` 支持 `env:变量名` 形式，插件启动时读取环境变量，不把密钥写进配置文件。

| 字段 | 默认 | 说明 |
|---|---|---|
| `provider` | `kling` | 供应商标识 |
| `accessKey` / `secretKey` | 空 | 可灵凭据，支持 `env:VAR` |
| `apiBase` | `https://api.klingai.com` | 可覆盖，便于代理 |
| `downloadHosts` | `[]` | 视频下载的 host 白名单；为空时只允许 `apiBase` 的 host |
| `workspace` | `realism-video` | 产物根目录 |
| `style` | `cinematic-real` | `cinematic-real` / `phone-raw` / `field-report` |
| `maxShots` | `4` | 单次镜头上限，1–8 |
| `maxCostPerJob` | `20` | 单次估算费用上限（元） |
| `aspect` | `16:9` | `16:9` / `9:16` / `1:1` |
| `resolution` | `1080p` | `720p` / `1080p` |
| `shotDurationSec` | `5` | `5` / `10` |
| `pollIntervalMs` | `5000` | 轮询间隔 |
| `referenceCacheTtlMs` | `86400000` | 定妆图缓存有效期（24 小时） |
| `timeoutMs` | `900000` | 单镜任务总超时 |
| `concurrency` | `2` | 分镜并发数 |
| `dryRun` | `false` | 只产出分镜与 `planned` 状态 manifest，不调用生成 |
| `llmPolish` | `false` | 预留开关，当前版本未启用 |
| `pricing` | `{}` | 单价表；为空时费用显示「未知」，不伪造数字 |

## 使用

```text
1. video_plan       一句话 → 分镜表 + 每镜提示词 + 估算费用（不花钱）
2. video_generate   planId + confirmed=true → 后台任务，返回 jobId
3. video_status     查询进度
4. video_cancel     取消未完成镜头，已完成的保留
```

`video_generate` 会依次校验：`confirmed === true`、凭据非空、估算费用不超过 `maxCostPerJob`。任一不满足直接报错，不会开始生成。

`dryRun: true` 时，`video_generate` 不调用供应商、不创建后台任务，只写出全 `planned` 状态的 manifest，返回 `{ kind: "dry-run", ... }`。

## 产物

```text
<workspace>/
├── plans/<planId>.json
├── characters/<hash>.json          # 定妆图缓存
└── <jobId>/
    ├── manifest.json
    ├── cancel.json                 # 仅取消后存在
    ├── shot-01.mp4
    └── shot-02.mp4
```

`manifest.json` 字段：

- `shots[].status`：`pending` / `running` / `done` / `failed` / `planned` / `cancelled`
- `shots[].taskId`、`shots[].costCny`
- `failures[]`：失败镜头的 `index`、`code`、`message`
- `warnings[]`：当前用于记录「参考图生成失败，已降级为无参考图」
- `totalCostCny`：估算值；供应商回传实际值时以实际为准

下载先写 `.part` 再原子 `rename`，中途失败不会留下半截 mp4。

## 成本与失败语义

- 单镜失败不连坐：其余镜头继续，`video_status` 返回 `partial`。
- 全部失败才视为整体失败。
- 取消会写入 `cancel.json`，后台流水线在每个镜头开始、轮询和下载前检查并停止后续请求。
- 参考图生成失败会降级为无参考图继续执行，并在 `manifest.warnings` 记录。

## 安全

- 日志与错误信息不输出 accessKey、secretKey、JWT。
- 下载只接受 host 在白名单内的 URL。
- `jobId` / `planId` / 缓存 key 均做字符校验，拒绝路径穿越。
- 凭据只从配置或环境变量读取，不写入任何产物文件。

## 关于可灵接口

`src/provider/kling/endpoints.ts` 中的路径与字段名是本项目对可灵开放平台的封装，**上线前必须按可灵最新官方文档核对**。核对清单记录在 `docs/kling-api.md`。若真实接口把任务 id 包在 `data` 中，或图生视频要求 URL/base64 而非 URL 字段，需要调整适配器。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

构建产物在 `lib/`，需随源码提交。CI 会校验 `pnpm build && git diff --exit-code lib`，防止产物与源码漂移。

## 已知限制

- 第一版不含音频与旁白。
- 不自动拼接成片（需要宿主机 ffmpeg）。
- 只实现可灵一家供应商；provider 接口已隔离，可新增适配器。
- `llmPolish` 未启用，提示词由确定性模板生成。