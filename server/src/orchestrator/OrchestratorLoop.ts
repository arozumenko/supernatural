import type { AgentState, OrchestratorConfig, OrchestratorRole, ActivePlan, ActionPlan, JsonPatch } from '../../shared/src/index.ts';
import { ROLE_PERMISSIONS, generateId } from '../../shared/src/index.ts';
import type { GameLoop } from '../GameLoop.ts';
import { LLMCaller } from './LLMCaller.ts';
import { getRolePrompt, buildUserMessage, type OrchestratorState } from './roles.ts';
import { parseResponse } from './ResponseParser.ts';
import { buildAgentSummary } from '../api/summary.ts';
import { getLLMProvider } from '../config/llm-config.ts';
import { applyJsonPatches } from '../api/json-patch.ts';
import { validateGenome, clampGenome } from '../ai/BehaviorGenome.ts';

/**
 * Server-side orchestrator that manages LLM-controlled agents.
 * Runs on per-agent timers (not tied to game tick), calls LLMs, processes responses.
 */
export class OrchestratorLoop {
  private agents = new Map<string, OrchestratorState>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private llmCaller: LLMCaller;
  private getGame: () => GameLoop;
  private onAction?: (agentId: string, role: OrchestratorRole, actionType: string, details: string) => void;

  constructor(getGame: () => GameLoop, llmCaller: LLMCaller, onAction?: typeof OrchestratorLoop.prototype.onAction) {
    this.getGame = getGame;
    this.llmCaller = llmCaller;
    this.onAction = onAction;
  }

  registerAgent(agent: AgentState, config: OrchestratorConfig): void {
    // Don't double-register
    if (this.agents.has(agent.id)) {
      this.unregisterAgent(agent.id);
    }

    const state: OrchestratorState = {
      agentId: agent.id,
      role: config.role,
      providerId: config.providerId,
      observationLog: [],
      lastActionTick: 0,
      lastPlanId: null,
    };
    this.agents.set(agent.id, state);

    const perms = ROLE_PERMISSIONS[config.role];
    if (perms.observeIntervalMs > 0 && config.enabled) {
      const timer = setInterval(() => {
        this.tick(agent.id).catch(err => {
          console.error('[Orchestrator] Tick error for ' + agent.id + ':', err.message);
        });
      }, config.observeIntervalMs);
      this.timers.set(agent.id, timer);
      console.log('[Orchestrator] Registered ' + agent.name + ' as ' + config.role + ' (every ' + (config.observeIntervalMs / 1000) + 's)');
    }
  }

  unregisterAgent(agentId: string): void {
    const timer = this.timers.get(agentId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(agentId);
    }
    this.agents.delete(agentId);
  }

  stop(): void {
    for (const [id, timer] of this.timers) {
      clearInterval(timer);
    }
    this.timers.clear();
    this.agents.clear();
    console.log('[Orchestrator] Stopped all agents');
  }

  private async tick(agentId: string): Promise<void> {
    const orchState = this.agents.get(agentId);
    if (!orchState) return;

    const game = this.getGame();
    const agent = game.getAgent(agentId);
    if (!agent || !agent.alive) return;

    // Build LLM-optimized summary
    const summary = buildAgentSummary(agent, game.world, game.tickCount, game.agents);

    // Store in observation log (ring buffer of 20)
    orchState.observationLog.push(summary);
    if (orchState.observationLog.length > 20) orchState.observationLog.shift();

    // Get role prompt and build user message
    const systemPrompt = getRolePrompt(orchState.role);
    if (!systemPrompt) return; // 'none' role

    const userMessage = buildUserMessage(orchState, summary);

    // Get LLM provider
    const provider = getLLMProvider(orchState.providerId);
    if (!provider) {
      console.warn('[Orchestrator] Provider not found: ' + orchState.providerId);
      return;
    }

    // Call LLM
    try {
      const rawResponse = await this.llmCaller.call(provider, systemPrompt, userMessage);
      const response = parseResponse(rawResponse, orchState.role);

      if (response.reasoning) {
        console.log('[Orchestrator] ' + agent.name + ' (' + orchState.role + ') reasoning: ' + response.reasoning.slice(0, 100));
      }

      this.processResponse(orchState, agent, response, game);
    } catch (err: any) {
      console.error('[Orchestrator] LLM call failed for ' + agent.name + ':', err.message);
    }
  }

  private processResponse(
    orchState: OrchestratorState,
    agent: AgentState,
    response: { actions: any[]; reasoning?: string },
    game: GameLoop,
  ): void {
    for (const action of response.actions) {
      switch (action.type) {
        case 'message': {
          game.sendMessage(agent.id, 'llm:' + orchState.role, action.content);
          orchState.lastActionTick = game.tickCount;
          this.emitAction(agent.id, orchState.role, 'message', 'Sent: "' + action.content.slice(0, 80) + '"');
          break;
        }

        case 'plan': {
          const plan: ActionPlan = action.plan;
          const result = this.setAgentPlan(game, agent, plan);
          if (result.accepted) {
            orchState.lastPlanId = (agent as any).pendingPlan?.planId ?? null;
            this.emitAction(agent.id, orchState.role, 'plan', 'Plan: ' + plan.name + ' (' + plan.steps.length + ' steps)');
          } else {
            this.emitAction(agent.id, orchState.role, 'plan', 'Plan rejected: ' + result.reason);
          }
          orchState.lastActionTick = game.tickCount;
          break;
        }

        case 'genome_patch': {
          const result = this.patchGenome(game, agent, action.patches, action.reason);
          if (result.applied) {
            this.emitAction(agent.id, orchState.role, 'genome_patch', 'Patched genome: ' + action.reason);
          } else {
            this.emitAction(agent.id, orchState.role, 'genome_patch', 'Patch failed: ' + (result.errors?.join(', ') ?? 'unknown'));
          }
          orchState.lastActionTick = game.tickCount;
          break;
        }

        case 'observe_only':
          // Do nothing — that's fine
          break;
      }
    }
  }

  private setAgentPlan(game: GameLoop, agent: AgentState, plan: ActionPlan): { accepted: boolean; reason: string } {
    if (!agent.alive) return { accepted: false, reason: 'Agent not alive' };

    // Clear existing plan
    (agent as any).pendingPlan = undefined;

    // Obedience check (darwinist/chaos_demon bypass)
    const role = agent.llmRole;
    if (role !== 'darwinist' && role !== 'chaos_demon') {
      if (Math.random() * 100 > agent.obedience) {
        return { accepted: false, reason: 'Agent refused (obedience: ' + agent.obedience + ')' };
      }
    }

    const activePlan: ActivePlan = {
      ...plan,
      planId: 'plan_' + generateId(),
      currentStep: 0,
      startTick: game.tickCount,
      stepStartTick: game.tickCount,
      expiresAtTick: game.tickCount + (plan.expireAfterTicks ?? 1000),
    };

    (agent as any).pendingPlan = activePlan;
    return { accepted: true, reason: 'Plan accepted' };
  }

  private patchGenome(game: GameLoop, agent: AgentState, patches: JsonPatch[], reason: string): { applied: boolean; errors?: string[] } {
    const genome = (agent as any).currentGenome;
    if (!genome) return { applied: false, errors: ['No genome'] };

    const draft = structuredClone(genome);
    try {
      applyJsonPatches(draft, patches);
    } catch (err: any) {
      return { applied: false, errors: ['Patch error: ' + err.message] };
    }

    const validation = validateGenome(draft);
    if (!validation.valid) {
      return { applied: false, errors: validation.errors };
    }

    const totalLvl = Object.values(agent.skills).reduce((sum, s) => sum + s.level, 0);
    clampGenome(draft, totalLvl);
    draft.version = genome.version + 1;
    draft.mutatedAt = game.tickCount;
    if (!draft.lineage) draft.lineage = [];
    draft.lineage.push(agent.llmRole + ': ' + reason);

    (agent as any).currentGenome = draft;
    agent.genomeVersion = draft.version;
    agent.activeStrategyRuleNames = draft.strategyRules?.filter((r: any) => r.enabled).map((r: any) => r.name) ?? [];

    return { applied: true };
  }

  private emitAction(agentId: string, role: OrchestratorRole, actionType: string, details: string): void {
    console.log('[Orchestrator] ' + role + ' → ' + actionType + ': ' + details);
    if (this.onAction) {
      this.onAction(agentId, role, actionType, details);
    }
  }

  getRegisteredCount(): number {
    return this.agents.size;
  }
}
