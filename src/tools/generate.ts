import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { assertInside, downloadToFile } from '../assets/download.js'
import {
  loadCachedReference,
  referenceCacheKey,
  saveCachedReference,
} from '../assets/reference.js'
import type { ConfigShape } from '../config.js'
import { ProviderError } from '../provider/errors.js'
import { createKlingProvider } from '../provider/kling/index.js'
import { mapLimit } from '../provider/retry.js'
import type { ErrorCode, TaskState, VideoProvider } from '../provider/types.js'
import { isCancelRequested } from '../store/cancel.js'
import { readManifest, writeManifest, type Manifest, type ManifestShot } from '../store/manifest.js'
import { loadPlan, type PlanRecord } from '../store/plans.js'

type TerminalTaskState = Extract<TaskState, { state: 'done' | 'failed' }>

const REFERENCE_FALLBACK_WARNING = '参考图生成失败，已降级为无参考图'
const JOB_ID_PREFIX = 'job_'
const MANIFEST_FILE_NAME = 'manifest.json'
const TIMEOUT_CODE: ErrorCode = 'transient'
const UNKNOWN_FAILURE_CODE = 'unknown'
const SHOT_FILE_PATTERN = 'shot-'
const SHOT_FILE_PAD = 2
const JOB_ID_SLICE = 8
const CANCEL_CHECK_INTERVAL_MS = 200

export interface JobDeps {
  workspace: string
  jobId: string
  planId: string
  config: ConfigShape
  provider: VideoProvider
  download: (url: string, dest: string) => Promise<void>
  failShot?: number
  isCancelled?: () => boolean
}

interface ManifestStore {
  update(mutate: (manifest: Manifest) => void): Promise<void>
}

interface FailureDetail {
  code: string
  message: string
}

class PollTimeoutError extends Error {
  constructor(taskId: string) {
    super(`timeout waiting for task ${taskId}`)
    this.name = 'PollTimeoutError'
  }
}

class CancelledError extends Error {
  constructor() {
    super('job cancelled')
    this.name = 'CancelledError'
  }
}

function shotFileName(index: number): string {
  return `${SHOT_FILE_PATTERN}${String(index).padStart(SHOT_FILE_PAD, '0')}.mp4`
}

function createManifestStore(workspace: string, jobId: string): ManifestStore {
  let tail: Promise<void> = Promise.resolve()

  const update = (mutate: (manifest: Manifest) => void): Promise<void> => {
    const run = tail.then(() => {
      const manifest = readManifest(workspace, jobId)
      if (manifest === null) throw new Error(`manifest not found: ${jobId}`)
      mutate(manifest)
      writeManifest(workspace, manifest)
    })
    tail = run.catch(() => undefined)
    return run
  }

  return { update }
}

function patchShot(manifest: Manifest, index: number, patch: Partial<ManifestShot>): void {
  const shot = manifest.shots.find((item) => item.index === index)
  if (shot === undefined) throw new Error(`shot ${index} not found`)
  Object.assign(shot, patch)
}

function recordFailure(manifest: Manifest, index: number, code: string, message: string): void {
  patchShot(manifest, index, { status: 'failed' })
  manifest.failures.push({ index, code, message })
}

function failureOf(error: unknown): FailureDetail {
  if (error instanceof PollTimeoutError) return { code: TIMEOUT_CODE, message: error.message }
  if (error instanceof ProviderError) return { code: error.code, message: error.message }
  if (error instanceof Error) return { code: UNKNOWN_FAILURE_CODE, message: error.message }
  return { code: UNKNOWN_FAILURE_CODE, message: String(error) }
}

async function markShotCancelled(store: ManifestStore, index: number): Promise<void> {
  try {
    await store.update((manifest) => { patchShot(manifest, index, { status: 'cancelled' }) })
  } catch {
    return
  }
}

async function sleep(ms: number, isCancelled: () => boolean): Promise<void> {
  const deadline = Date.now() + Math.max(0, ms)
  for (;;) {
    if (isCancelled()) throw new CancelledError()
    const remaining = deadline - Date.now()
    if (remaining <= 0) return
    const chunk = Math.min(remaining, CANCEL_CHECK_INTERVAL_MS)
    await new Promise<void>((resolve) => { setTimeout(resolve, chunk) })
  }
}

async function waitForTask(
  provider: VideoProvider,
  taskId: string,
  pollIntervalMs: number,
  deadline: number,
  signal: AbortSignal,
  isCancelled: () => boolean,
): Promise<TerminalTaskState> {
  for (;;) {
    if (isCancelled()) throw new CancelledError()
    const state = await provider.getTask(taskId, signal)
    if (isCancelled()) throw new CancelledError()
    if (state.state === 'done' || state.state === 'failed') return state
    if (Date.now() >= deadline) throw new PollTimeoutError(taskId)
    await sleep(pollIntervalMs, isCancelled)
  }
}

async function resolveReferenceUrl(
  deps: JobDeps,
  plan: PlanRecord,
  store: ManifestStore,
  signal: AbortSignal,
): Promise<string | null> {
  const key = referenceCacheKey(plan.card, plan.style, plan.aspect)
  const cached = loadCachedReference(deps.workspace, key, deps.config.referenceCacheTtlMs)
  if (cached !== null) return cached

  const first = plan.shots[0]
  if (first === undefined) return null

  try {
    const image = await deps.provider.generateReferenceImage(
      { prompt: first.prompt, negativePrompt: first.negativePrompt, aspect: plan.aspect },
      signal,
    )
    saveCachedReference(deps.workspace, key, image.url)
    return image.url
  } catch {
    await store.update((manifest) => { manifest.warnings.push(REFERENCE_FALLBACK_WARNING) })
    return null
  }
}

async function runShot(
  deps: JobDeps,
  plan: PlanRecord,
  index: number,
  referenceUrl: string | null,
  store: ManifestStore,
  isCancelled: () => boolean,
): Promise<void> {
  const shot = plan.shots.find((item) => item.index === index)
  if (shot === undefined) return

  const signal = new AbortController().signal

  if (isCancelled()) {
    await markShotCancelled(store, index)
    return
  }

  try {
    if (deps.failShot === index) throw new ProviderError('simulated failure', 'invalid', false)
    await store.update((manifest) => { patchShot(manifest, index, { status: 'running' }) })

    const deadline = Date.now() + deps.config.timeoutMs
    const created = await deps.provider.createVideo({
      prompt: shot.prompt,
      negativePrompt: shot.negativePrompt,
      referenceImage: referenceUrl === null ? undefined : { url: referenceUrl },
      durationSec: shot.durationSec,
      aspect: plan.aspect,
      resolution: plan.resolution,
    }, signal)
    await store.update((manifest) => { patchShot(manifest, index, { taskId: created.taskId }) })

    const state = await waitForTask(
      deps.provider,
      created.taskId,
      deps.config.pollIntervalMs,
      deadline,
      signal,
      isCancelled,
    )
    if (isCancelled()) {
      await markShotCancelled(store, index)
      return
    }
    if (state.state === 'failed') {
      await store.update((manifest) => { recordFailure(manifest, index, state.code, state.message) })
      return
    }

    if (isCancelled()) {
      await markShotCancelled(store, index)
      return
    }
    const dest = join(deps.workspace, deps.jobId, shotFileName(index))
    assertInside(deps.workspace, dest)
    await deps.download(state.videoUrl, dest)
    await store.update((manifest) => { patchShot(manifest, index, { status: 'done' }) })
  } catch (error) {
    if (error instanceof CancelledError) {
      await markShotCancelled(store, index)
      return
    }
    const failure = failureOf(error)
    await store.update((manifest) => {
      recordFailure(manifest, index, failure.code, failure.message)
    }).catch(() => undefined)
  }
}

export async function runJob(deps: JobDeps): Promise<void> {
  const plan = loadPlan(deps.workspace, deps.planId)
  if (plan === null) throw new Error(`plan not found: ${deps.planId}`)

  writeManifest(deps.workspace, {
    schemaVersion: 1,
    jobId: deps.jobId,
    provider: deps.provider.id,
    style: plan.style,
    aspect: plan.aspect,
    resolution: plan.resolution,
    createdAt: new Date().toISOString(),
    shots: plan.shots.map((shot) => ({
      index: shot.index,
      file: shotFileName(shot.index),
      status: 'pending',
      prompt: shot.prompt,
      costCny: shot.estimatedCostCny,
    })),
    totalCostCny: plan.totalEstimatedCostCny,
    warnings: [],
    failures: [],
  })

  const store = createManifestStore(deps.workspace, deps.jobId)
  const isCancelled = deps.isCancelled ?? (() => isCancelRequested(deps.workspace, deps.jobId))
  const referenceUrl = isCancelled()
    ? null
    : await resolveReferenceUrl(deps, plan, store, new AbortController().signal)

  await mapLimit(plan.shots, deps.config.concurrency, async (shot) => {
    if (isCancelled()) {
      await markShotCancelled(store, shot.index)
      return
    }
    await runShot(deps, plan, shot.index, referenceUrl, store, isCancelled)
  })
}

export function assertGenerateAllowed(
  config: ConfigShape,
  plan: { totalEstimatedCostCny: number | null; shots: readonly unknown[] },
  confirmed: boolean,
): void {
  if (confirmed !== true) throw new Error('confirmed must be true: show the plan to the user first')
  if (config.accessKey === '' || config.secretKey === '') {
    throw new Error('missing accessKey/secretKey for the video provider')
  }
  if (plan.shots.length === 0) throw new Error('plan has no shots')
  const cost = plan.totalEstimatedCostCny
  if (cost !== null && cost > config.maxCostPerJob) {
    throw new Error(`estimated cost ${cost} exceeds maxCostPerJob ${config.maxCostPerJob}`)
  }
}

function buildPlannedManifest(config: ConfigShape, plan: PlanRecord, jobId: string): Manifest {
  return {
    schemaVersion: 1,
    jobId,
    provider: config.provider,
    style: plan.style,
    aspect: plan.aspect,
    resolution: plan.resolution,
    createdAt: new Date().toISOString(),
    shots: plan.shots.map((shot) => ({
      index: shot.index,
      file: shotFileName(shot.index),
      status: 'planned',
      prompt: shot.prompt,
      costCny: shot.estimatedCostCny,
    })),
    totalCostCny: plan.totalEstimatedCostCny,
    warnings: [],
    failures: [],
  }
}

function resolveAllowedHosts(config: ConfigShape): string[] {
  if (config.downloadHosts.length > 0) return config.downloadHosts
  return [new URL(config.apiBase).hostname]
}

export function registerGenerateTool(ctx: Context, config: ConfigShape): void {
  ctx.tools.register(defineTool({
    name: 'video_generate',
    description: 'Generate realism-style shot videos from an approved plan. Requires confirmed=true and runs in the background.',
    parameters: {
      planId: { type: 'string', required: true, description: 'Plan id returned by video_plan' },
      confirmed: { type: 'boolean', required: true, description: 'Must be true once the user approves the plan and its cost' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) ?? '' }],
    },
    async execute(args, exec): Promise<Record<string, string | number | null>> {
      const plan = loadPlan(config.workspace, args.planId)
      if (plan === null) throw new Error(`plan not found: ${args.planId}`)
      assertGenerateAllowed(config, plan, args.confirmed === true)

      const jobId = `${JOB_ID_PREFIX}${randomUUID().slice(0, JOB_ID_SLICE)}`
      if (config.dryRun) {
        writeManifest(config.workspace, buildPlannedManifest(config, plan, jobId))
        return {
          kind: 'dry-run',
          jobId,
          shotCount: plan.shots.length,
          manifestPath: join(config.workspace, jobId, MANIFEST_FILE_NAME),
        }
      }

      const provider = createKlingProvider({
        apiBase: config.apiBase,
        ak: config.accessKey,
        sk: config.secretKey,
      })
      const allowedHosts = resolveAllowedHosts(config)

      await ctx.jobs.start({
        kind: 'video',
        label: `generate ${plan.planId}`,
        owner: exec.agent,
        run: async () => {
          await runJob({
            workspace: config.workspace,
            jobId,
            planId: plan.planId,
            config,
            provider,
            download: (url, dest) => downloadToFile(url, dest, { allowedHosts }),
          })
        },
      })

      return {
        kind: 'background',
        jobId,
        shotCount: plan.shots.length,
        estimatedCostCny: plan.totalEstimatedCostCny,
      }
    },
  }))
}