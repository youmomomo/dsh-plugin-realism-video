export interface RetryOptions {
  retries: number
  baseDelayMs: number
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
  signal: AbortSignal,
): Promise<T> {
  const attempts = Math.max(1, Math.floor(opts.retries) + 1)
  let last: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal.aborted) throw abortedError()
    try {
      return await fn(attempt)
    } catch (err) {
      last = err
      if (!isRetryable(err) || attempt === attempts - 1) throw err
      await sleep(opts.baseDelayMs * 2 ** attempt, signal)
    }
  }

  throw last
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []

  const width = Math.max(1, Math.min(Math.floor(limit), items.length))
  const results = new Array<R>(items.length)
  let next = 0

  const worker = async (): Promise<void> => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: width }, () => worker()))
  return results
}

function isRetryable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  return (err as { retryable?: unknown }).retryable === true
}

function abortedError(): Error {
  return new Error('aborted')
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortedError()

  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortedError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}