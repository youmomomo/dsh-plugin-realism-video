import { describe, expect, it } from 'vitest'
import { KlingAuth, signJwt } from '../src/provider/kling/auth.js'

const ak = 'test-ak'
const sk = 'test-sk'

function decodeSegment(token: string, index: number): unknown {
  const segment = token.split('.')[index]
  return JSON.parse(Buffer.from(segment, 'base64url').toString())
}

describe('signJwt', () => {
  it('creates three base64url segments', () => {
    const token = signJwt(ak, sk, 1_700_000_000)
    expect(token.split('.')).toHaveLength(3)
  })
  it('puts issuer and expiry in the payload', () => {
    const token = signJwt(ak, sk, 1_700_000_000)
    const payload = decodeSegment(token, 1) as { iss: string; exp: number }
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