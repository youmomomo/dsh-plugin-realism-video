import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createKlingProvider } from '../src/provider/kling/index.js'

let server: Server
let base: string
let lastAuth = ''
let lastBody: unknown = null
let videoPolls = 0

beforeEach(async () => {
  videoPolls = 0
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      lastAuth = String(req.headers.authorization ?? '')
      if (raw !== '') lastBody = JSON.parse(raw)
      const send = (code: number, obj: unknown): void => {
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
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  base = `http://127.0.0.1:${addr.port}`
})

afterEach(() => {
  server.close()
})

function provider() {
  return createKlingProvider({ apiBase: base, ak: 'ak', sk: 'sk' })
}

function lastBodyField(field: string): unknown {
  if (typeof lastBody !== 'object' || lastBody === null) return undefined
  return (lastBody as Record<string, unknown>)[field]
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
    expect(lastBodyField('prompt')).toBe('a man')
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