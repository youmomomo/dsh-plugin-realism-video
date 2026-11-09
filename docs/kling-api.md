# 可灵开放平台接口常量

> **这些常量需在上线前按可灵开放平台最新文档核对，路径与字段名可能变化。**

本文只记录 `src/provider/kling/endpoints.ts` 中定义、并被 `src/provider/kling/index.ts`
使用的端点与字段名，用于说明本项目对可灵 API 的假设，不包含未经验证的额外细节。

## 鉴权

所有请求携带 `Authorization: Bearer <jwt>`，JWT 由 `src/provider/kling/auth.ts`
用 accessKey / secretKey 以 HS256 签名并缓存。

## 端点（`EP`）

| 常量 | 路径 | 方法 | 用途 |
|---|---|---|---|
| `EP.image` | `/v1/images/generations` | POST | 创建图像生成任务，返回任务 id |
| `EP.text2video` | `/v1/videos/text2video` | POST | 创建文生视频任务，返回任务 id |
| `EP.image2video` | `/v1/videos/image2video` | POST | 创建图生视频任务，返回任务 id |
| `EP.task('image', id)` | `/v1/images/generations/{id}` | GET | 查询图像任务状态与结果 |
| `EP.task('video', id)` | `/v1/videos/{id}` | GET | 查询视频任务状态与结果 |

## 字段名（`F`）

| 常量 | 字段名 | 方向 | 用途 |
|---|---|---|---|
| `F.model` | `model_name` | 请求 | 模型名 |
| `F.prompt` | `prompt` | 请求 | 正向提示词 |
| `F.negative` | `negative_prompt` | 请求 | 负向提示词 |
| `F.duration` | `duration` | 请求 | 视频时长（秒） |
| `F.aspect` | `aspect_ratio` | 请求 | 画幅比例 |
| `F.image` | `image` | 请求 | 图生视频的参考图 |
| `F.taskId` | `task_id` | 响应 | 任务 id |
| `F.status` | `task_status` | 响应 | 任务状态 |
| `F.result` | `task_result` | 响应 | 任务结果对象 |
| `F.images` | `images` | 响应 | 图像结果数组 |
| `F.videos` | `videos` | 响应 | 视频结果数组 |
| `F.url` | `url` | 响应 | 单个结果条目的下载地址 |

## 任务状态取值

适配器按以下取值解释 `task_status`：

- `succeed`：成功，读取 `task_result.images[0].url` 或 `task_result.videos[0].url`。
- `failed`：失败，图像任务抛分类错误，视频任务返回 `failed` 状态。
- `submitted`：映射为 `queued`。
- 其他取值（如 `processing`）：映射为 `running`。

## 请求体

- 图像生成：`prompt`、`negative_prompt`、`aspect_ratio`。
- 视频生成：`prompt`、`negative_prompt`、`duration`、`aspect_ratio`；图生视频额外携带 `image`。

本项目不在请求体发送 `model_name`，`F.model` 仅作为字段名映射保留。