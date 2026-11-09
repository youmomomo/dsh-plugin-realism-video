export interface DownloadOptions {
    allowedHosts: string[];
    signal?: AbortSignal;
}
export declare function assertInside(base: string, target: string): void;
export declare function downloadToFile(url: string, dest: string, opts: DownloadOptions): Promise<void>;
