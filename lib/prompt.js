import { STYLE_PRESETS } from './styles.js';
export const BASE_NEGATIVES = [
    'plastic skin', 'airbrushed', 'overly smooth', 'perfect symmetry', 'CGI',
    '3D render', 'cartoon', 'hyper-saturated', 'fake bokeh', 'floating objects',
    'extra fingers', 'warped hands', 'morphing faces', 'watermark', 'text',
];
export function renderShotPrompt(input) {
    const preset = STYLE_PRESETS[input.style];
    const { character, scene } = input.card;
    const markers = character.markers.slice(0, 2).join(', ');
    const negatives = dedupe([...BASE_NEGATIVES, ...preset.negatives]);
    const prompt = [
        `Subject: ${character.ageRange} year old person, ${character.face}, ${character.hair}, ${character.build}, wearing ${character.wardrobe}, identifying marks: ${markers}.`,
        `Action: ${input.action}. Single continuous action within ${input.durationSec} seconds.`,
        `Environment: ${scene.place}, ${scene.time}, ${scene.weather}, surfaces include ${scene.materials.join(', ')}, palette ${scene.palette}.`,
        `Camera: ${preset.camera}, ${input.aspect} frame.`,
        `Lighting: ${preset.lighting}.`,
        `Texture: ${preset.texture}, realistic physics and natural imperfection.`,
        `Negative: ${negatives.join(', ')}.`,
    ].join(' ');
    return { prompt, negativePrompt: negatives.join(', ') };
}
function dedupe(terms) {
    const seen = new Set();
    const result = [];
    for (const term of terms) {
        const value = term.trim();
        if (value.length === 0 || seen.has(value))
            continue;
        seen.add(value);
        result.push(value);
    }
    return result;
}
//# sourceMappingURL=prompt.js.map