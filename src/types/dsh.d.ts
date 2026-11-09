import type { Context } from '@deepseek-ai/cordis'

export interface JobsStartOptions {
  kind: string
  label: string
  owner?: unknown
  run: (ctx: Context) => Promise<unknown>
}

export interface JobsService {
  start(options: JobsStartOptions): Promise<unknown>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    jobs: JobsService
  }
}