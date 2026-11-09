import type { Aspect, StyleId } from './config.js';
export declare const BASE_NEGATIVES: string[];
export interface ConsistencyCard {
    characterId: string;
    character: {
        ageRange: string;
        face: string;
        hair: string;
        build: string;
        wardrobe: string;
        markers: string[];
    };
    scene: {
        place: string;
        time: string;
        weather: string;
        materials: string[];
        palette: string;
    };
}
export interface ShotPromptInput {
    card: ConsistencyCard;
    style: StyleId;
    index: number;
    action: string;
    durationSec: number;
    aspect: Aspect;
}
export interface RenderedShotPrompt {
    prompt: string;
    negativePrompt: string;
}
export declare function renderShotPrompt(input: ShotPromptInput): RenderedShotPrompt;
