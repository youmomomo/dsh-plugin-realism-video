export type StyleId = 'cinematic-real' | 'phone-raw' | 'field-report';
export type Aspect = '16:9' | '9:16' | '1:1';
export type Resolution = '720p' | '1080p';
export interface ConfigShape {
    provider: string;
    accessKey: string;
    secretKey: string;
    apiBase: string;
    downloadHosts: string[];
    workspace: string;
    style: StyleId;
    maxShots: number;
    maxCostPerJob: number;
    aspect: Aspect;
    resolution: Resolution;
    shotDurationSec: number;
    pollIntervalMs: number;
    referenceCacheTtlMs: number;
    timeoutMs: number;
    concurrency: number;
    dryRun: boolean;
    llmPolish: boolean;
    pricing: Record<string, number>;
}
export declare const Config: Schemastery<any, ConfigShape>;
