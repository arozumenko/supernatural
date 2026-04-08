import type { Request, Response } from 'express';
import type { GameLoop } from '../../GameLoop.ts';
import type { ActionPlan, ActivePlan, JsonPatch } from '../../../shared/src/index.ts';
import { generateId } from '../../../shared/src/index.ts';
import { validateGenome, clampGenome } from '../../ai/BehaviorGenome.ts';
import { applyJsonPatches } from '../json-patch.ts';

// ─── Tier 1: Message ───

export function sendMessage(getGame: () => GameLoop) {
  return (req: Request, res: Response) => {
    const game = getGame();
    const agent = game.agents.find(a => a.id === req.params.agentId);
    if (!agent) {
      return res.status(404).json({ error: 'agent_not_found', message: 'Agent not found' });
    }
    if (!agent.alive) {
      return res.status(409).json({ error: 'agent_dead', message: 'Agent is dead' });
    }

    const { content, urgent } = req.body;
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'invalid_request', message: 'Missing content field' });
    }

    const messageId = generateId();
    const cost = urgent ? 6 : 3;

    agent.messageQueue.push({
      id: messageId,
      fromPlayer: 'api',
      toAgent: agent.id,
      content,
      timestamp: Date.now(),
      cost,
      followed: null,
    });

    // If urgent, move to front
    if (urgent && agent.messageQueue.length > 1) {
      const msg = agent.messageQueue.pop()!;
      agent.messageQueue.unshift(msg);
    }

    const followChance = agent.obedience > 70 ? 'high' : agent.obedience > 40 ? 'medium' : 'low';

    res.json({
      messageId,
      cost,
      agentObedience: agent.obedience,
      estimatedFollowChance: followChance,
      queuePosition: urgent ? 0 : agent.messageQueue.length - 1,
    });
  };
}

// ─── Tier 2: Plan ───

export function sendPlan(getGame: () => GameLoop) {
  return (req: Request, res: Response) => {
    const game = getGame();
    const agent = game.agents.find(a => a.id === req.params.agentId);
    if (!agent) {
      return res.status(404).json({ error: 'agent_not_found', message: 'Agent not found' });
    }
    if (!agent.alive) {
      return res.status(409).json({ error: 'agent_dead', message: 'Agent is dead' });
    }

    const existingPlan = (agent as any).pendingPlan;
    if (existingPlan) {
      return res.status(409).json({
        error: 'plan_conflict',
        message: 'Agent already has an active plan. Cancel it first.',
      });
    }

    const plan = req.body as ActionPlan;
    if (!plan.name || !plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      return res.status(400).json({ error: 'invalid_plan', message: 'Plan must have name and non-empty steps array' });
    }

    // Clamp priority to [1, 80]
    const priority = Math.max(1, Math.min(80, plan.priority ?? 50));

    // Obedience check
    if (Math.random() * 100 > agent.obedience) {
      return res.json({
        planId: null,
        accepted: false,
        reason: `Agent refused plan (obedience: ${agent.obedience})`,
      });
    }

    const planId = 'plan_' + generateId();
    const activePlan: ActivePlan = {
      ...plan,
      priority,
      planId,
      currentStep: 0,
      startTick: game.tickCount,
      stepStartTick: game.tickCount,
      expiresAtTick: game.tickCount + (plan.expireAfterTicks ?? 2000),
    };

    (agent as any).pendingPlan = activePlan;

    res.json({
      planId,
      accepted: true,
      reason: `Agent accepted plan (obedience: ${agent.obedience})`,
      estimatedTicks: plan.steps.reduce((sum, s) => sum + (s.maxTicks ?? 200), 0),
      currentStep: 0,
      expiresAtTick: activePlan.expiresAtTick,
    });
  };
}

export function getPlanStatus(getGame: () => GameLoop) {
  return (req: Request, res: Response) => {
    const game = getGame();
    const agent = game.agents.find(a => a.id === req.params.agentId);
    if (!agent) {
      return res.status(404).json({ error: 'agent_not_found', message: 'Agent not found' });
    }

    const plan: ActivePlan | undefined = (agent as any).pendingPlan;
    if (!plan) {
      return res.json({ active: false, plan: null });
    }

    res.json({
      active: true,
      plan: {
        planId: plan.planId,
        name: plan.name,
        currentStep: plan.currentStep,
        totalSteps: plan.steps.length,
        priority: plan.priority,
        expiresAtTick: plan.expiresAtTick,
        ticksRemaining: Math.max(0, plan.expiresAtTick - game.tickCount),
        currentStepAction: plan.steps[plan.currentStep]?.action ?? null,
      },
    });
  };
}

export function cancelPlan(getGame: () => GameLoop) {
  return (req: Request, res: Response) => {
    const game = getGame();
    const agent = game.agents.find(a => a.id === req.params.agentId);
    if (!agent) {
      return res.status(404).json({ error: 'agent_not_found', message: 'Agent not found' });
    }

    const plan: ActivePlan | undefined = (agent as any).pendingPlan;
    if (!plan) {
      return res.json({ cancelled: false, message: 'No active plan' });
    }

    (agent as any).pendingPlan = undefined;
    res.json({ cancelled: true, planId: plan.planId });
  };
}

// ─── Tier 3: Genome Patch ───

export function patchGenome(getGame: () => GameLoop) {
  return (req: Request, res: Response) => {
    const game = getGame();
    const agent = game.agents.find(a => a.id === req.params.agentId);
    if (!agent) {
      return res.status(404).json({ error: 'agent_not_found', message: 'Agent not found' });
    }

    const genome = (agent as any).currentGenome;
    if (!genome) {
      return res.status(404).json({ error: 'agent_not_found', message: 'Agent has no genome' });
    }

    const { patches, reason } = req.body;
    if (!patches || !Array.isArray(patches)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Missing patches array' });
    }

    const draft = structuredClone(genome);
    try {
      applyJsonPatches(draft, patches as JsonPatch[]);
    } catch (err: any) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'Failed to apply patches: ' + err.message,
      });
    }

    const validation = validateGenome(draft);
    if (!validation.valid) {
      return res.status(400).json({
        applied: false,
        errors: validation.errors,
      });
    }

    const previousVersion = genome.version;
    draft.version = genome.version + 1;
    draft.mutatedAt = game.tickCount;
    if (!draft.lineage) draft.lineage = [];
    draft.lineage.push('api: ' + (reason ?? 'manual patch'));

    const totalLvl = Object.values(agent.skills).reduce((sum, s) => sum + s.level, 0);
    clampGenome(draft, totalLvl);
    (agent as any).currentGenome = draft;
    agent.genomeVersion = draft.version;
    agent.activeStrategyRuleNames = draft.strategyRules
      .filter((r: any) => r.enabled).map((r: any) => r.name);

    res.json({
      applied: true,
      previousVersion,
      newVersion: draft.version,
      validationWarnings: [],
      changedFields: patches.map((p: JsonPatch) => p.path),
    });
  };
}
