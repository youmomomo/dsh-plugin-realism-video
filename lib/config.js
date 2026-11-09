import Schema from '@deepseek-ai/schemastery';
export const Config = Schema.object({
    provider: Schema.string().default('kling'),
    accessKey: Schema.string().default(''),
    secretKey: Schema.string().default(''),
    apiBase: Schema.string().default('https://api.klingai.com'),
    downloadHosts: Schema.array(Schema.string()).default([]),
    workspace: Schema.string().default('realism-video'),
    style: Schema.union(['cinematic-real', 'phone-raw', 'field-report']).default('cinematic-real'),
    maxShots: Schema.number().min(1).max(8).default(4),
    maxCostPerJob: Schema.number().min(0).default(20),
    aspect: Schema.union(['16:9', '9:16', '1:1']).default('16:9'),
    resolution: Schema.union(['720p', '1080p']).default('1080p'),
    shotDurationSec: Schema.union([5, 10]).default(5),
    pollIntervalMs: Schema.number().min(1000).default(5000),
    referenceCacheTtlMs: Schema.number().min(0).default(86_400_000),
    timeoutMs: Schema.number().min(60000).default(900000),
    concurrency: Schema.number().min(1).max(8).default(2),
    dryRun: Schema.boolean().default(false),
    llmPolish: Schema.boolean().default(false),
    pricing: Schema.dict(Schema.number()).default({}),
});
//# sourceMappingURL=config.js.map