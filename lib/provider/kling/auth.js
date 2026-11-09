import { createHmac } from 'node:crypto';
const TTL_SEC = 1800;
const REFRESH_AHEAD_SEC = 60;
const NOT_BEFORE_SKEW_SEC = 5;
const JWT_HEADER = { alg: 'HS256', typ: 'JWT' };
function encodeSegment(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}
export function signJwt(ak, sk, nowSec) {
    const payload = {
        iss: ak,
        exp: nowSec + TTL_SEC,
        nbf: nowSec - NOT_BEFORE_SKEW_SEC,
    };
    const body = `${encodeSegment(JWT_HEADER)}.${encodeSegment(payload)}`;
    const signature = createHmac('sha256', sk).update(body).digest('base64url');
    return `${body}.${signature}`;
}
export class KlingAuth {
    ak;
    sk;
    now;
    cached = null;
    constructor(ak, sk, now = () => Math.floor(Date.now() / 1000)) {
        this.ak = ak;
        this.sk = sk;
        this.now = now;
    }
    getToken() {
        const now = this.now();
        if (this.cached !== null && this.cached.exp - now > REFRESH_AHEAD_SEC) {
            return this.cached.token;
        }
        const token = signJwt(this.ak, this.sk, now);
        this.cached = { token, exp: now + TTL_SEC };
        return token;
    }
    invalidate() {
        this.cached = null;
    }
}
//# sourceMappingURL=auth.js.map