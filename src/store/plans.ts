import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Aspect, Resolution, StyleId } from '../config.js'
import type { ConsistencyCard, StoryboardShot } from '../storyboard.js'

export interface PlanShot extends StoryboardShot {
  estimatedCostCny: number | null
}

export interface PlanRecord {
  planId: string
  createdAt: string
  style: StyleId
  aspect: Aspect
  resolution: Resolution
  shots: PlanShot[]
  totalEstimatedCostCny: number | null
  card: ConsistencyCard
}

const PLAN_ID_PATTERN = /^[a-z0-9_]{1,64}$/
const PLANS_DIR_NAME = 'plans'

function plansDir(workspace: string): string {
  return join(workspace, PLANS_DIR_NAME)
}

function planPath(workspace: string, planId: string): string {
  if (!PLAN_ID_PATTERN.test(planId)) throw new Error(`invalid plan id: ${planId}`)
  return join(plansDir(workspace), `${planId}.json`)
}

export function savePlan(workspace: string, plan: PlanRecord): void {
  const file = planPath(workspace, plan.planId)
  mkdirSync(plansDir(workspace), { recursive: true })
  writeFileSync(file, JSON.stringify(plan, null, 2), 'utf8')
}

export function loadPlan(workspace: string, planId: string): PlanRecord | null {
  const file = planPath(workspace, planId)
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PlanRecord
  } catch {
    return null
  }
}