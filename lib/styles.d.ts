import type { StyleId } from './config.js';
export interface StylePreset {
    camera: string;
    lighting: string;
    texture: string;
    motion: string;
    negatives: string[];
}
export declare const STYLE_PRESETS: Record<StyleId, StylePreset>;
