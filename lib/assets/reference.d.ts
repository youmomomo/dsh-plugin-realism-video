import type { Aspect, StyleId } from '../config.js';
import type { ConsistencyCard } from '../storyboard.js';
export declare function referenceCacheKey(card: ConsistencyCard, style: StyleId, aspect: Aspect): string;
export declare function loadCachedReference(workspace: string, key: string, ttlMs: number, now?: number): string | null;
export declare function saveCachedReference(workspace: string, key: string, url: string, now?: number): void;
