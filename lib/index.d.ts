import type { Context } from '@deepseek-ai/cordis';
import { Config, type ConfigShape } from './config.js';
export declare const name = "realism-video";
export declare const inject: string[];
export { Config };
export declare function resolveSecret(value: string, env?: NodeJS.ProcessEnv): string;
export declare function resolveSecrets(config: ConfigShape, env?: NodeJS.ProcessEnv): ConfigShape;
export declare function apply(ctx: Context, config: ConfigShape): void;
