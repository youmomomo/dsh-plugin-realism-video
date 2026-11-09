export type ErrorCode = 'auth' | 'invalid' | 'quota' | 'transient' | 'unknown'

export interface ImageRequest {
  prompt: string
  negativePrompt?: string
  aspect: string
}

export interface VideoRequest {
  prompt: string
  negativePrompt?: string
  referenceImage?: { url: string }
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