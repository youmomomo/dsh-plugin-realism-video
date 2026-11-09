import type { Aspect, Resolution, StyleId } from '../config.js';
export type ShotStatus = 'pending' | 'reference' | 'running' | 'done' | 'failed' | 'planned' | 'cancelled';
export interface ManifestShot {
    index: number;
    file: string;
    status: ShotStatus;
    prompt: string;
    seed?: number;
    taskId?: string;
    costCny?: number | null;
}
export interface ManifestFailure {
    index: number;
    code: string;
    message: string;
}
export interface Manifest {
    schemaVersion: 1;
    jobId: string;
    provider: string;
    style: StyleId;
    aspect: Aspect;
    resolution: Resolution;
    createdAt: string;
    shots: ManifestShot[];
    totalCostCny: number | null;
    warnings: string[];
    failures: ManifestFailure[];
}
export declare function writeManifest(workspace: string, m: Manifest): void;
export declare function readManifest(workspace: string, jobId: string): Manifest | null;
export declare function updateShot(workspace: string, jobId: string, index: number, patch: Partial<ManifestShot>): void;
