import type { VideoProvider } from '../types.js';
export interface KlingOptions {
    apiBase: string;
    ak: string;
    sk: string;
    fetchImpl?: typeof fetch;
}
export declare function createKlingProvider(opts: KlingOptions): VideoProvider;
