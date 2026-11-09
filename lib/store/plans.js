import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const PLAN_ID_PATTERN = /^[a-z0-9_]{1,64}$/;
const PLANS_DIR_NAME = 'plans';
function plansDir(workspace) {
    return join(workspace, PLANS_DIR_NAME);
}
function planPath(workspace, planId) {
    if (!PLAN_ID_PATTERN.test(planId))
        throw new Error(`invalid plan id: ${planId}`);
    return join(plansDir(workspace), `${planId}.json`);
}
export function savePlan(workspace, plan) {
    const file = planPath(workspace, plan.planId);
    mkdirSync(plansDir(workspace), { recursive: true });
    writeFileSync(file, JSON.stringify(plan, null, 2), 'utf8');
}
export function loadPlan(workspace, planId) {
    const file = planPath(workspace, planId);
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=plans.js.map