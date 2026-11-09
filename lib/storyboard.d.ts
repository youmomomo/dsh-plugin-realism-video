import type { Aspect, StyleId } from './config.js';
import { type ConsistencyCard } from './prompt.js';
export type { ConsistencyCard };
export type Beat = 'establishing' | 'medium' | 'detail' | 'reaction' | 'environment' | 'transition';
export interface StoryboardShot {
    index: number;
    beat: Beat;
    durationSec: number;
    prompt: string;
    negativePrompt: string;
    camera: string;
    lighting: string;
}
export interface StoryboardInput {
    idea: string;
    style: StyleId;
    shots: number;
    durationSec: number;
    aspect: Aspect;
}
export interface Storyboard {
    style: StyleId;
    card: ConsistencyCard;
    shots: StoryboardShot[];
}
export declare function buildConsistencyCard(idea: string, style: StyleId, aspect: Aspect): ConsistencyCard;
export declare function buildStoryboard(input: StoryboardInput): Storyboard;
export declare function estimateShotCost(style: StyleId, durationSec: number, pricing: Record<string, number>): number | null;
