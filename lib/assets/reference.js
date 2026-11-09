import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const CACHE_DIR_NAME = 'characters';
const CACHE_KEY_PATTERN = /^[a-f0-9]{16}$/;
const CACHE_KEY_LENGTH = 16;
function cachePath(workspace, key) {
    if (!CACHE_KEY_PATTERN.test(key))
        throw new Error(`invalid reference cache key: ${key}`);
    return join(workspace, CACHE_DIR_NAME, `${key}.json`);
}
function isCacheEntry(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const entry = value;
    return typeof entry.url === 'string' && typeof entry.createdAt === 'number';
}
export function referenceCacheKey(card, style, aspect) {
    const material = JSON.stringify({ card, style, aspect });
    return createHash('sha256').update(material).digest('hex').slice(0, CACHE_KEY_LENGTH);
}
export function loadCachedReference(workspace, key, ttlMs, now = Date.now()) {
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(cachePath(workspace, key), 'utf8'));
    }
    catch {
        return null;
    }
    if (!isCacheEntry(parsed))
        return null;
    if (now - parsed.createdAt > ttlMs)
        return null;
    return parsed.url;
}
export function saveCachedReference(workspace, key, url, now = Date.now()) {
    const file = cachePath(workspace, key);
    mkdirSync(join(workspace, CACHE_DIR_NAME), { recursive: true });
    const tmp = `${file}.tmp`;
    const entry = { url, createdAt: now };
    writeFileSync(tmp, JSON.stringify(entry, null, 2), 'utf8');
    renameSync(tmp, file);
}
//# sourceMappingURL=reference.js.map