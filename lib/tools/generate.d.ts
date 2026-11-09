import type { Context } from '@deepseek-ai/cordis';
import type { ConfigShape } from '../config.js';
import type { VideoProvider } from '../provider/types.js';
export interface JobDeps {
    workspace: string;
    jobId: string;
    planId: string;
    config: ConfigShape;
    provider: VideoProvider;
    download: (url: string, dest: string) => Promise<void>;
    failShot?: number;
    isCancelled?: () => boolean;
}
export declare function runJob(deps: JobDeps): Promise<void>;
export declare function assertGenerateAllowed(config: ConfigShape, plan: {
    totalEstimatedCostCny: number | null;
    shots: readonly unknown[];
}, confirmed: boolean): void;
export declare function registerGenerateTool(ctx: Context, config: ConfigShape): void;
