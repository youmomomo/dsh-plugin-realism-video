export const EP = {
    image: '/v1/images/generations',
    text2video: '/v1/videos/text2video',
    image2video: '/v1/videos/image2video',
    task: (kind, id) => kind === 'image' ? `/v1/images/generations/${id}` : `/v1/videos/${id}`,
};
export const F = {
    model: 'model_name',
    prompt: 'prompt',
    negative: 'negative_prompt',
    duration: 'duration',
    aspect: 'aspect_ratio',
    image: 'image',
    taskId: 'task_id',
    status: 'task_status',
    result: 'task_result',
    images: 'images',
    videos: 'videos',
    url: 'url',
};
//# sourceMappingURL=endpoints.js.map