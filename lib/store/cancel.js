import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const JOB_ID_PATTERN = /^[a-z0-9_]{1,64}$/;
const CANCEL_FILE_NAME = 'cancel.json';
function jobDir(workspace, jobId) {
    if (!JOB_ID_PATTERN.test(jobId))
        throw new Error(`invalid job id: ${jobId}`);
    return join(workspace, jobId);
}
function cancelFilePath(workspace, jobId) {
    return join(jobDir(workspace, jobId), CANCEL_FILE_NAME);
}
export function requestCancel(workspace, jobId) {
    const dir = jobDir(workspace, jobId);
    const file = join(dir, CANCEL_FILE_NAME);
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ requestedAt: new Date().toISOString() }, null, 2), 'utf8');
    renameSync(tmp, file);
}
export function isCancelRequested(workspace, jobId) {
    const file = cancelFilePath(workspace, jobId);
    try {
        readFileSync(file, 'utf8');
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=cancel.js.map