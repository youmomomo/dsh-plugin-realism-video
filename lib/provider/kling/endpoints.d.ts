export type TaskKind = 'image' | 'video';
export declare const EP: {
    image: string;
    text2video: string;
    image2video: string;
    task: (kind: TaskKind, id: string) => string;
};
export declare const F: {
    readonly model: "model_name";
    readonly prompt: "prompt";
    readonly negative: "negative_prompt";
    readonly duration: "duration";
    readonly aspect: "aspect_ratio";
    readonly image: "image";
    readonly taskId: "task_id";
    readonly status: "task_status";
    readonly result: "task_result";
    readonly images: "images";
    readonly videos: "videos";
    readonly url: "url";
};
