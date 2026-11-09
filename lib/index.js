import { Config } from './config.js';
import { registerCancelTool } from './tools/cancel.js';
import { registerGenerateTool } from './tools/generate.js';
import { registerPlanTool } from './tools/plan.js';
import { registerStatusTool } from './tools/status.js';
export const name = 'realism-video';
export const inject = ['tools', 'jobs'];
export { Config };
const ENV_PREFIX = 'env:';
export function resolveSecret(value, env = process.env) {
    if (!value.startsWith(ENV_PREFIX))
        return value;
    return env[value.slice(ENV_PREFIX.length)] ?? '';
}
export function resolveSecrets(config, env = process.env) {
    return {
        ...config,
        accessKey: resolveSecret(config.accessKey, env),
        secretKey: resolveSecret(config.secretKey, env),
    };
}
export function apply(ctx, config) {
    const resolved = resolveSecrets(config);
    registerPlanTool(ctx, resolved);
    registerGenerateTool(ctx, resolved);
    registerStatusTool(ctx, resolved);
    registerCancelTool(ctx, resolved);
}
//# sourceMappingURL=index.js.map