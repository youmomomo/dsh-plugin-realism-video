import { createHmac } from 'node:crypto'

const TTL_SEC = 1800
const REFRESH_AHEAD_SEC = 60
const NOT_BEFORE_SKEW_SEC = 5
const JWT_HEADER = { alg: 'HS256', typ: 'JWT' }

function encodeSegment(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function signJwt(ak: string, sk: string, nowSec: number): string {
  const payload = {
    iss: ak,
    exp: nowSec + TTL_SEC,
    nbf: nowSec - NOT_BEFORE_SKEW_SEC,
  }
  const body = `${encodeSegment(JWT_HEADER)}.${encodeSegment(payload)}`
  const signature = createHmac('sha256', sk).update(body).digest('base64url')
  return `${body}.${signature}`
}

export class KlingAuth {
  private cached: { token: string; exp: number } | null = null

  constructor(
    private readonly ak: string,
    private readonly sk: string,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  getToken(): string {
    const now = this.now()
    if (this.cached !== null && this.cached.exp - now > REFRESH_AHEAD_SEC) {
      return this.cached.token
    }
    const token = signJwt(this.ak, this.sk, now)
    this.cached = { token, exp: now + TTL_SEC }
    return token
  }

  invalidate(): void {
    this.cached = null
  }
}