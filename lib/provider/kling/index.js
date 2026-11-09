import { classifyError, ProviderError } from '../errors.js';
import { KlingAuth } from './auth.js';
import { EP, F } from './endpoints.js';
const POLL_INTERVAL_MS = 2000;
const STATUS_SUCCEED = 'succeed';
const STATUS_FAILED = 'failed';
const STATUS_SUBMITTED = 'submitted';
const IMAGE_FAILED_STATUS = 400;
const IMAGE_FAILED_BODY = 'image task failed';
const VIDEO_FAILED_MESSAGE = 'task failed';
const MAX_DURATION_SEC = 10;
const MALFORMED_JSON_BODY = 'provider returned malformed json';
function isJsonObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function toJsonObject(value, field) {
    if (!isJsonObject(value)) {
        throw new ProviderError(`provider payload has no object field ${field}`, 'unknown', false);
    }
    return value;
}
function readString(obj, key) {
    const value = obj[key];
    if (typeof value !== 'string') {
        throw new ProviderError(`provider payload has no string field ${key}`, 'unknown', false);
    }
    return value;
}
function readStatus(obj) {
    return readString(obj, F.status);
}
function readFirstUrl(state, listKey) {
    const result = toJsonObject(state[F.result], F.result);
    const list = result[listKey];
    if (!Array.isArray(list) || list.length === 0) {
        throw new ProviderError(`provider payload has no entries in ${listKey}`, 'unknown', false);
    }
    return readString(toJsonObject(list[0], listKey), F.url);
}
function headersOf(init) {
    const headers = init.headers;
    if (headers === undefined)
        return {};
    if (headers instanceof Headers)
        return Object.fromEntries(headers.entries());
    if (Array.isArray(headers))
        return Object.fromEntries(headers);
    return { ...headers };
}
function parseBody(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new ProviderError(MALFORMED_JSON_BODY, 'unknown', false);
    }
    return toJsonObject(parsed, 'body');
}
function abortedError() {
    return new Error('aborted');
}
async function delay(ms, signal) {
    if (signal.aborted)
        throw abortedError();
    await new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortedError());
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
    });
}
export function createKlingProvider(opts) {
    const auth = new KlingAuth(opts.ak, opts.sk);
    const base = opts.apiBase.replace(/\/+$/, '');
    const fetchImpl = opts.fetchImpl ?? fetch;
    async function call(path, init, signal) {
        const res = await fetchImpl(`${base}${path}`, {
            ...init,
            signal,
            headers: {
                ...headersOf(init),
                'content-type': 'application/json',
                authorization: `Bearer ${auth.getToken()}`,
            },
        });
        const text = await res.text();
        if (!res.ok) {
            if (res.status === 401)
                auth.invalidate();
            throw classifyError(res.status, text);
        }
        return parseBody(text);
    }
    return {
        id: 'kling',
        capabilities: {
            textToVideo: true,
            imageToVideo: true,
            imageGeneration: true,
            maxDurationSec: MAX_DURATION_SEC,
        },
        estimateCost: () => null,
        async generateReferenceImage(req, signal) {
            const body = {
                [F.prompt]: req.prompt,
                [F.negative]: req.negativePrompt,
                [F.aspect]: req.aspect,
            };
            const created = await call(EP.image, { method: 'POST', body: JSON.stringify(body) }, signal);
            const taskId = readString(created, F.taskId);
            for (;;) {
                const state = await call(EP.task('image', taskId), { method: 'GET' }, signal);
                const status = readStatus(state);
                if (status === STATUS_SUCCEED)
                    return { url: readFirstUrl(state, F.images) };
                if (status === STATUS_FAILED)
                    throw classifyError(IMAGE_FAILED_STATUS, IMAGE_FAILED_BODY);
                await delay(POLL_INTERVAL_MS, signal);
            }
        },
        async createVideo(req, signal) {
            const path = req.referenceImage === undefined ? EP.text2video : EP.image2video;
            const body = {
                [F.prompt]: req.prompt,
                [F.negative]: req.negativePrompt,
                [F.duration]: req.durationSec,
                [F.aspect]: req.aspect,
            };
            if (req.referenceImage !== undefined)
                body[F.image] = req.referenceImage.url;
            const created = await call(path, { method: 'POST', body: JSON.stringify(body) }, signal);
            return { taskId: readString(created, F.taskId) };
        },
        async getTask(taskId, signal) {
            const res = await call(EP.task('video', taskId), { method: 'GET' }, signal);
            const status = readStatus(res);
            if (status === STATUS_SUCCEED)
                return { state: 'done', videoUrl: readFirstUrl(res, F.videos) };
            if (status === STATUS_FAILED) {
                return { state: 'failed', code: 'invalid', message: VIDEO_FAILED_MESSAGE, retryable: false };
            }
            return { state: status === STATUS_SUBMITTED ? 'queued' : 'running' };
        },
    };
}
//# sourceMappingURL=index.js.map