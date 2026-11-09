import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const JOB_ID_PATTERN = /^[a-z0-9_]{1,64}$/;
const MANIFEST_FILE = 'manifest.json';
function jobDir(workspace, jobId) {
    if (!JOB_ID_PATTERN.test(jobId))
        throw new Error(`invalid job id: ${jobId}`);
    return join(workspace, jobId);
}
function manifestPath(workspace, jobId) {
    return join(jobDir(workspace, jobId), MANIFEST_FILE);
}
export function writeManifest(workspace, m) {
    const file = manifestPath(workspace, m.jobId);
    mkdirSync(jobDir(workspace, m.jobId), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(m, null, 2), 'utf8');
    renameSync(tmp, file);
}
export function readManifest(workspace, jobId) {
    const file = manifestPath(workspace, jobId);
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    }
    catch {
        return null;
    }
}
export function updateShot(workspace, jobId, index, patch) {
    const m = readManifest(workspace, jobId);
    if (!m)
        throw new Error(`manifest not found for ${jobId}`);
    const shot = m.shots.find((s) => s.index === index);
    if (!shot)
        throw new Error(`shot ${index} not found in ${jobId}`);
    Object.assign(shot, patch);
    writeManifest(workspace, m);
}
//# sourceMappingURL=manifest.js.map