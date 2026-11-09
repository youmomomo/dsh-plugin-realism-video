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