import type { Aspect, Resolution, StyleId } from '../config.js';
import type { ConsistencyCard, StoryboardShot } from '../storyboard.js';
export interface PlanShot extends StoryboardShot {
    estimatedCostCny: number | null;
}
export interface PlanRecord {
    planId: string;
    createdAt: string;
    style: StyleId;
    aspect: Aspect;
    resolution: Resolution;
    shots: PlanShot[];
    totalEstimatedCostCny: number | null;
    card: ConsistencyCard;
}
export declare function savePlan(workspace: string, plan: PlanRecord): void;
export declare function loadPlan(workspace: string, planId: string): PlanRecord | null;
