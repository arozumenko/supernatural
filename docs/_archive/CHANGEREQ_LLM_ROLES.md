# CR: LLM Orchestrator Role System

**Status**: Proposed — 2026-03-29
**Depends on**: AGENT_API.md, AGENT_MEMORY.md, LLM_PROMPTS.md
**Modifies**: `shared/src/index.ts`, `shared/src/genome.ts`, `server/src/index.ts`, `server/src/GameLoop.ts`, `server/src/Agent.ts`, `server/src/ai/NeedsSystem.ts`
**New files**: `server/src/orchestrator/OrchestratorLoop.ts`, `server/src/orchestrator/roles.ts`, `server/src/orchestrator/AgentSummaryBuilder.ts`, `server/src/orchestrator/PlanExecutor.ts`, `server/src/api/routes.ts`, `server/src/api/middleware.ts`

---

## 1. Problem

The codebase has the scaffolding for LLM-driven agents (genome types, journal types, `LLMProviderConfig`, `agentLLMAssignments` in GameConfig, `llmProviderId` on AgentState) but no runtime logic to actually call an LLM, feed it agent state, and process its response. The prompts exist (docs/prompts/), the API spec exists (AGENT_API.md), but there is no orchestration engine connecting them.

### What exists today

| Layer | Status | Where |
|-------|--------|-------|
| Genome types | Done | `shared/src/genome.ts` — full BehaviorGenome, StrategyRule, GENOME_BOUNDS |
| Journal types | Done | `shared/src/journal.ts` — LifeJournal, DeathCause, LifeEvent |
| LLM provider config | Done | `server/src/config/llm-config.ts` — loads `llm-providers.json`, resolves env vars |
| Provider list endpoint | Done | `GET /api/llm-providers` — returns `{id, label}[]` (no keys) |
| Agent fields | Done | `livesRemaining`, `genomeVersion`, `llmProviderId`, `currentGenome` (as any) |
| GameConfig slot | Done | `agentLLMAssignments?: Record<number, string \| null>` — **not yet consumed** |
| Default genome factory | Done | `server/src/ai/BehaviorGenome.ts` — `createDefaultGenome()` |
| Prompt definitions | Done | `docs/prompts/` — 6 role prompts with API usage patterns |
| API spec | Done | `docs/AGENT_API.md` — observation, message, plan, genome patch endpoints |

### What is missing

| Layer | Status | Description |
|-------|--------|-------------|
| Orchestrator loop | Not started | Server-side loop that polls agent state and calls LLM per role schedule |
| Role system | Not started | Role type definitions, role-to-permissions mapping, prompt selection |
| Agent summary builder | Not started | `buildAgentSummary()` — converts raw AgentState to LLM-optimized view |
| Plan executor | Not started | `ActionPlan` on agents, step-by-step execution in NeedsSystem |
| REST API routes | Not started | Observation + instruction endpoints from AGENT_API.md |
| LLM caller | Not started | Generic HTTP caller for OpenAI/Anthropic/local APIs |
| GameConfig consumption | Not started | `agentLLMAssignments` → `agent.llmProviderId` wiring at spawn |

---

## 2. Design

### 2.1 Role Type System

```typescript
// shared/src/index.ts — new types

export type OrchestratorRole =
  | 'advisor'      // message only, respects autonomy
  | 'puppeteer'    // plan + message, tactical control
  | 'god'          // genome patch only, silent reshaping
  | 'darwinist'    // all tiers, cold optimization
  | 'parent'       // shifts over time based on skill level
  | 'chaos_demon'  // all tiers, entropy maximizer
  | 'none';        // no LLM — fallback-only evolution

export interface OrchestratorConfig {
  role: OrchestratorRole;
  providerId: string;          // which LLM provider to use
  observeIntervalMs: number;   // how often to poll (auto-set from role)
  enabled: boolean;
}

// Permissions per role — which API tiers each role is allowed to use
export const ROLE_PERMISSIONS: Record<OrchestratorRole, {
  canMessage: boolean;
  canPlan: boolean;
  canPatchGenome: boolean;
  observeIntervalMs: number;   // default observation interval
  description: string;
}> = {
  advisor:      { canMessage: true,  canPlan: false, canPatchGenome: false, observeIntervalMs: 30000, description: 'Quiet voice. Messages only.' },
  puppeteer:    { canMessage: true,  canPlan: true,  canPatchGenome: false, observeIntervalMs: 15000, description: 'Tactical commander. Plans + messages.' },
  god:          { canMessage: false, canPlan: false, canPatchGenome: true,  observeIntervalMs: 15000, description: 'Silent hand. Genome patches only.' },
  darwinist:    { canMessage: true,  canPlan: true,  canPatchGenome: true,  observeIntervalMs: 10000, description: 'Cold optimizer. All tiers.' },
  parent:       { canMessage: true,  canPlan: true,  canPatchGenome: false, observeIntervalMs: 15000, description: 'Teaches then lets go. Shifts over time.' },
  chaos_demon:  { canMessage: true,  canPlan: true,  canPatchGenome: true,  observeIntervalMs: 15000, description: 'Entropy agent. Unpredictable.' },
  none:         { canMessage: false, canPlan: false, canPatchGenome: false, observeIntervalMs: 0,     description: 'No LLM. Fallback evolution only.' },
};
```

### 2.2 GameConfig Extension

```typescript
// Extend existing GameConfig in shared/src/index.ts
export interface GameConfig {
  // ... existing fields ...
  agentLLMAssignments?: Record<number, {
    providerId: string;
    role: OrchestratorRole;
  } | null>;
}
```

This replaces the current `Record<number, string | null>` with a richer object that carries both the provider AND the role. The client config UI sends this when starting a game.

### 2.3 AgentState Extension

```typescript
// Add to AgentState in shared/src/index.ts
export interface AgentState {
  // ... existing fields ...
  llmProviderId?: string | null;      // already exists
  llmRole?: OrchestratorRole;         // NEW — which role controls this agent
  pendingPlan?: ActivePlan;           // NEW — structured plan from orchestrator
}

export interface ActivePlan {
  planId: string;
  name: string;
  steps: PlanStep[];
  currentStep: number;
  priority: number;
  startTick: number;
  expiresAtTick: number;
  abandonOnDanger: boolean;
  stepStartTick: number;
}

export interface PlanStep {
  action: AgentAction;
  target?: {
    type: 'position' | 'entity' | 'resource' | 'nearest';
    x?: number;
    y?: number;
    entityId?: string;
    resourceType?: string;
  };
  condition?: PlanCondition;
  maxTicks?: number;
}

export interface PlanCondition {
  type: 'resource_above' | 'need_above' | 'at_position' | 'item_crafted' | 'ticks_elapsed';
  field?: string;
  value?: number;
  position?: { x: number; y: number; radius: number };
}
```

### 2.4 Orchestrator Loop

New file: `server/src/orchestrator/OrchestratorLoop.ts`

This is the core engine. It runs as a separate `setInterval` loop (NOT tied to the game tick) that manages all LLM-controlled agents.

```typescript
class OrchestratorLoop {
  private agents: Map<string, OrchestratorState>;  // agentId -> state
  private timers: Map<string, NodeJS.Timeout>;

  constructor(
    private game: GameLoop,
    private llmCaller: LLMCaller,
  ) {}

  // Called when a game starts or is reconfigured
  registerAgent(agent: AgentState, config: OrchestratorConfig): void {
    const state: OrchestratorState = {
      agentId: agent.id,
      role: config.role,
      providerId: config.providerId,
      observationLog: [],         // last N state snapshots
      lastActionTick: 0,
      lastPlanId: null,
      phaseOverride: null,        // for Parent role phase tracking
    };
    this.agents.set(agent.id, state);

    // Start observation timer for this agent
    const perms = ROLE_PERMISSIONS[config.role];
    if (perms.observeIntervalMs > 0) {
      const timer = setInterval(
        () => this.tick(agent.id),
        perms.observeIntervalMs,
      );
      this.timers.set(agent.id, timer);
    }
  }

  // Called every observation interval per agent
  private async tick(agentId: string): Promise<void> {
    const orchState = this.agents.get(agentId);
    if (!orchState) return;

    const agent = this.game.getAgent(agentId);
    if (!agent || !agent.alive) return;

    // Build LLM-optimized summary
    const summary = buildAgentSummary(agent, this.game.world, this.game.tickCount);

    // Store in observation log (ring buffer of last 20)
    orchState.observationLog.push(summary);
    if (orchState.observationLog.length > 20) orchState.observationLog.shift();

    // Build role-specific system prompt
    const systemPrompt = getRolePrompt(orchState.role);

    // Build user message from summary + observation history
    const userMessage = buildUserMessage(orchState, summary);

    // Call LLM
    const provider = getLLMProvider(orchState.providerId);
    if (!provider) return;

    try {
      const response = await this.llmCaller.call(provider, systemPrompt, userMessage);
      await this.processResponse(orchState, agent, response);
    } catch (err) {
      console.error(`Orchestrator LLM call failed for ${agentId}:`, err);
    }
  }

  // Parse and apply the LLM's response
  private async processResponse(
    orchState: OrchestratorState,
    agent: AgentState,
    response: LLMResponse,
  ): Promise<void> {
    const perms = ROLE_PERMISSIONS[orchState.role];

    for (const action of response.actions) {
      switch (action.type) {
        case 'message':
          if (!perms.canMessage) break;
          this.game.sendMessage(agent.id, `llm:${orchState.role}`, action.content);
          break;

        case 'plan':
          if (!perms.canPlan) break;
          this.game.setAgentPlan(agent.id, action.plan);
          break;

        case 'genome_patch':
          if (!perms.canPatchGenome) break;
          this.game.patchGenome(agent.id, action.patches, action.reason);
          break;

        case 'observe_only':
          // LLM chose to do nothing this cycle — that's fine
          break;
      }
    }
  }
}
```

### 2.5 LLM Caller

New file: `server/src/orchestrator/LLMCaller.ts`

Generic HTTP client that speaks to OpenAI-compatible and Anthropic APIs.

```typescript
class LLMCaller {
  // Semaphore per provider to enforce maxConcurrent
  private semaphores: Map<string, number> = new Map();

  async call(
    provider: LLMProviderConfig,
    systemPrompt: string,
    userMessage: string,
  ): Promise<LLMResponse> {
    // Enforce concurrency limit
    const current = this.semaphores.get(provider.id) ?? 0;
    if (current >= provider.maxConcurrent) {
      throw new Error(`Concurrency limit reached for ${provider.id}`);
    }
    this.semaphores.set(provider.id, current + 1);

    try {
      const rawText = await this.callProvider(provider, systemPrompt, userMessage);
      return this.parseResponse(rawText);
    } finally {
      this.semaphores.set(provider.id, (this.semaphores.get(provider.id) ?? 1) - 1);
    }
  }

  private async callProvider(
    provider: LLMProviderConfig,
    system: string,
    user: string,
  ): Promise<string> {
    switch (provider.provider) {
      case 'openai':
        return this.callOpenAI(provider, system, user);
      case 'anthropic':
        return this.callAnthropic(provider, system, user);
      case 'local':
        return this.callLocal(provider, system, user);
    }
  }

  // OpenAI-compatible API (also covers local servers like Ollama/vLLM)
  private async callOpenAI(p: LLMProviderConfig, system: string, user: string): Promise<string> {
    const baseUrl = p.provider === 'local' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${p.apiKey}`,
      },
      body: JSON.stringify({
        model: p.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: p.maxTokens,
        temperature: p.temperature,
      }),
      signal: AbortSignal.timeout(p.timeout),
    });
    const json = await res.json();
    return json.choices[0].message.content;
  }

  // Anthropic Messages API
  private async callAnthropic(p: LLMProviderConfig, system: string, user: string): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': p.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: p.model,
        system,
        messages: [{ role: 'user', content: user }],
        max_tokens: p.maxTokens,
        temperature: p.temperature,
      }),
      signal: AbortSignal.timeout(p.timeout),
    });
    const json = await res.json();
    return json.content[0].text;
  }

  // Local inference (same as OpenAI format)
  private async callLocal(p: LLMProviderConfig, system: string, user: string): Promise<string> {
    return this.callOpenAI(p, system, user);
  }
}
```

### 2.6 Response Format

The LLM returns structured JSON. The system prompt instructs it to respond in this format:

```typescript
interface LLMResponse {
  actions: LLMAction[];
  reasoning?: string;          // internal reasoning (logged, not sent to agent)
}

type LLMAction =
  | { type: 'observe_only' }
  | { type: 'message'; content: string; urgent?: boolean }
  | { type: 'plan'; plan: ActionPlan }
  | { type: 'genome_patch'; patches: JsonPatch[]; reason: string };

interface ActionPlan {
  name: string;
  steps: PlanStep[];
  priority: number;
  expireAfterTicks: number;
  abandonOnDanger: boolean;
}

interface JsonPatch {
  op: 'replace' | 'add' | 'remove';
  path: string;
  value?: any;
}
```

Every role prompt must include this response format specification as a suffix. The response parser:
1. Strips markdown fences if present
2. Attempts `JSON.parse()`
3. Falls back to regex extraction of JSON from mixed text
4. Validates against `LLMResponse` shape
5. Enforces role permissions (strips disallowed action types)
6. Validates genome patches against `GENOME_BOUNDS`

### 2.7 Agent Summary Builder

New file: `server/src/orchestrator/AgentSummaryBuilder.ts`

Converts raw AgentState + World context into the LLM-optimized `AgentSummary` defined in AGENT_API.md §2.1. Key functions:

```typescript
export function buildAgentSummary(agent: AgentState, world: World, tick: number): AgentSummary;
export function buildWorldSummary(agents: AgentState[], world: World, tick: number): WorldSummary;

// Helpers
function describeBiome(world: World, x: number, y: number): string;
function scanNearby(agent: AgentState, world: World, range: number): NearbyContext;
function directionTo(fromX: number, fromY: number, toX: number, toY: number): string;
function findUrgentNeeds(needs: AgentNeeds, threshold: number): string[];
```

### 2.8 Plan Executor

New file: `server/src/orchestrator/PlanExecutor.ts`

Integrates into `decideAction()` in NeedsSystem.ts. Checks `agent.pendingPlan` and generates decisions:

```typescript
export function evaluatePendingPlan(
  agent: AgentState,
  world: World,
  tickCount: number,
  decisions: Decision[],
): void;

export function resolvePlanTarget(
  target: PlanStep['target'],
  agent: AgentState,
  world: World,
): { x: number; y: number } | undefined;

export function evaluatePlanCondition(
  condition: PlanCondition | undefined,
  agent: AgentState,
  elapsedTicks: number,
): boolean;
```

**Injection point** in NeedsSystem.ts `decideAction()` — after interrupt checks (line ~490), before GOAP:

```typescript
// === PLAN LAYER (between interrupts and GOAP) ===
if (agent.pendingPlan) {
  evaluatePendingPlan(agent, world, tickCount, decisions);
}
```

Plan priority is capped at 70 (below interrupt range) so survival instincts always override.

### 2.9 User Message Builder

The user message sent to the LLM changes based on role. Each role gets a different view of the data:

```typescript
function buildUserMessage(orchState: OrchestratorState, summary: AgentSummary): string {
  const role = orchState.role;

  // Common header
  let msg = `## Current State of ${summary.name}\n`;
  msg += `Tick: ${summary.serverTick} | Life: ${summary.currentLifeTicks}t | Lives: ${summary.livesRemaining}\n`;
  msg += `Position: (${summary.position.x}, ${summary.position.y}) | Biome: ${summary.biome}\n`;
  msg += `Action: ${summary.currentAction} — ${summary.actionReason}\n\n`;

  // Needs
  msg += `## Needs\n`;
  for (const [k, v] of Object.entries(summary.needs)) {
    const bar = v < 20 ? '🔴' : v < 50 ? '🟡' : '🟢';
    msg += `${bar} ${k}: ${Math.round(v)}\n`;
  }
  if (summary.urgentNeeds.length > 0) {
    msg += `\n⚠️ URGENT: ${summary.urgentNeeds.join(', ')}\n`;
  }

  // Nearby
  msg += `\n## Nearby\n`;
  if (summary.nearby.threats.length > 0) {
    msg += `Threats: ${summary.nearby.threats.map(t => `${t.type} (${t.distance.toFixed(1)} tiles ${t.direction}, danger: ${t.dangerLevel})`).join(', ')}\n`;
  }
  if (summary.nearby.resources.length > 0) {
    msg += `Resources: ${summary.nearby.resources.map(r => `${r.type} (${r.distance.toFixed(1)} tiles ${r.direction})`).join(', ')}\n`;
  }

  // Recent events
  if (summary.recentEvents.length > 0) {
    msg += `\n## Recent Events\n`;
    for (const e of summary.recentEvents.slice(-5)) {
      msg += `[tick ${e.tick}] ${e.type}: ${e.details}\n`;
    }
  }

  // Role-specific additions
  switch (role) {
    case 'god':
    case 'darwinist':
      // Include genome highlights for roles that can patch
      msg += `\n## Active Genome (v${summary.genome.version})\n`;
      msg += `Strategy rules: ${summary.genome.activeStrategyRules.join(', ') || 'none'}\n`;
      msg += `Fitness: ${summary.genome.fitnessScore}\n`;
      break;

    case 'puppeteer':
      // Include current plan status
      if (summary.currentPlan) {
        msg += `\n## Active Plan\n`;
        msg += `Goal: ${summary.currentPlan.goal}\n`;
        msg += `Step ${summary.currentPlan.currentStep + 1}/${summary.currentPlan.steps.length}: ${summary.currentPlan.steps[summary.currentPlan.currentStep]}\n`;
      } else {
        msg += `\n## No active plan.\n`;
      }
      break;

    case 'parent':
      // Include skill summary for phase detection
      const totalLevels = Object.values(summary.skills).reduce((a, b) => a + b, 0);
      const phase = totalLevels < 50 ? 'Infant' : totalLevels < 150 ? 'Child' : totalLevels < 300 ? 'Adolescent' : 'Adult';
      msg += `\n## Development\n`;
      msg += `Total skill levels: ${totalLevels} (Phase: ${phase})\n`;
      msg += `Skills: ${Object.entries(summary.skills).map(([k, v]) => `${k}:${v}`).join(', ')}\n`;
      break;
  }

  // Observation history trends (last 5 snapshots)
  if (orchState.observationLog.length >= 3) {
    const recent = orchState.observationLog.slice(-5);
    const thirstTrend = recent[recent.length - 1].needs.thirst - recent[0].needs.thirst;
    const healthTrend = recent[recent.length - 1].needs.health - recent[0].needs.health;
    msg += `\n## Trends (last ${recent.length} observations)\n`;
    msg += `Thirst: ${thirstTrend > 0 ? '↑' : '↓'} ${Math.abs(thirstTrend).toFixed(0)} | Health: ${healthTrend > 0 ? '↑' : '↓'} ${Math.abs(healthTrend).toFixed(0)}\n`;
  }

  // Response format instruction
  msg += `\n## Your Response\n`;
  msg += `Respond with ONLY valid JSON matching this schema:\n`;
  msg += `{"actions": [{"type": "observe_only"} | {"type": "message", "content": "..."} | {"type": "plan", "plan": {...}} | {"type": "genome_patch", "patches": [...], "reason": "..."}], "reasoning": "..."}\n`;

  return msg;
}
```

### 2.10 Role Prompt Loader

New file: `server/src/orchestrator/roles.ts`

Loads the system prompt for each role. Prompts are stored as embedded strings (compiled from docs/prompts/ at build time) or loaded from disk.

```typescript
const ROLE_PROMPTS: Record<OrchestratorRole, string> = {
  advisor: `You are The Advisor — a quiet voice that speaks to a living being...`,
  puppeteer: `You are The Puppeteer — a tactical intelligence...`,
  god: `You are The God — an unseen force...`,
  darwinist: `You are The Darwinist — a cold optimization engine...`,
  parent: `You are The Parent — a nurturing intelligence...`,
  chaos_demon: `You are The Chaos Demon — an agent of entropy...`,
  none: '',
};

export function getRolePrompt(role: OrchestratorRole): string {
  return ROLE_PROMPTS[role] ?? ROLE_PROMPTS.none;
}
```

---

## 3. Wiring Changes

### 3.1 GameLoop Constructor

Consume `agentLLMAssignments` when spawning initial agents:

```typescript
// In GameLoop constructor, after agent creation loop:
if (config?.agentLLMAssignments) {
  for (const [slotIndex, assignment] of Object.entries(config.agentLLMAssignments)) {
    const idx = parseInt(slotIndex);
    if (idx < this.agents.length && assignment) {
      this.agents[idx].llmProviderId = assignment.providerId;
      this.agents[idx].llmRole = assignment.role;
    }
  }
}
```

### 3.2 GameLoop New Methods

```typescript
class GameLoop {
  // ... existing ...

  getAgent(agentId: string): AgentState | undefined {
    return this.agents.find(a => a.id === agentId);
  }

  get world(): World { return this._world; }
  get tickCount(): number { return this._tickCount; }

  setAgentPlan(agentId: string, plan: ActionPlan): { accepted: boolean; reason: string } {
    const agent = this.getAgent(agentId);
    if (!agent?.alive) return { accepted: false, reason: 'Agent not found or dead' };
    if (Math.random() * 100 > agent.obedience && agent.llmRole !== 'darwinist') {
      return { accepted: false, reason: `Agent refused (obedience: ${agent.obedience})` };
    }
    agent.pendingPlan = {
      planId: generateId(),
      ...plan,
      currentStep: 0,
      startTick: this._tickCount,
      expiresAtTick: this._tickCount + plan.expireAfterTicks,
      stepStartTick: this._tickCount,
    };
    return { accepted: true, reason: 'Plan accepted' };
  }

  patchGenome(agentId: string, patches: JsonPatch[], reason: string): { applied: boolean; errors?: string[] } {
    const agent = this.getAgent(agentId);
    if (!agent) return { applied: false, errors: ['Agent not found'] };
    const genome = (agent as any).currentGenome as BehaviorGenome;
    if (!genome) return { applied: false, errors: ['No genome'] };

    const draft = structuredClone(genome);
    for (const patch of patches) {
      applyPatch(draft, patch);  // JSON Patch apply logic
    }

    const errors = validateGenome(draft);
    if (errors.length > 0) return { applied: false, errors };

    draft.version++;
    draft.mutatedAt = this._tickCount;
    draft.lineage.push(`${reason}`);
    (agent as any).currentGenome = draft;
    agent.genomeVersion = draft.version;
    agent.activeStrategyRuleNames = draft.strategyRules.filter(r => r.enabled).map(r => r.name);

    return { applied: true };
  }
}
```

### 3.3 NeedsSystem Integration

In `decideAction()`, add plan evaluation between interrupts and GOAP:

```diff
  // === HIGH PRIORITY INTERRUPTS (lines 430-580) ===
  // ... existing interrupt code ...

+ // === PLAN LAYER ===
+ if (agent.pendingPlan) {
+   evaluatePendingPlan(agent, world, tickCount, decisions);
+ }

  // === GOAP LAYER (lines 580-690) ===
  // ... existing GOAP code ...
```

### 3.4 index.ts — Orchestrator Startup

```typescript
// After game creation:
import { OrchestratorLoop } from './orchestrator/OrchestratorLoop.ts';
import { LLMCaller } from './orchestrator/LLMCaller.ts';

const llmCaller = new LLMCaller();
let orchestrator = new OrchestratorLoop(game, llmCaller);

// Register LLM-assigned agents after game starts
function registerOrchestrators() {
  for (const agent of game.getState().agents) {
    if (agent.llmProviderId && agent.llmRole && agent.llmRole !== 'none') {
      orchestrator.registerAgent(agent, {
        role: agent.llmRole,
        providerId: agent.llmProviderId,
        observeIntervalMs: ROLE_PERMISSIONS[agent.llmRole].observeIntervalMs,
        enabled: true,
      });
    }
  }
}

// On game:configure, rebuild orchestrator
socket.on('game:configure', (config: GameConfig) => {
  // ... existing restart logic ...
  orchestrator.stop();
  orchestrator = new OrchestratorLoop(game, llmCaller);
  registerOrchestrators();
});
```

### 3.5 REST API (from AGENT_API.md)

Mount the observation and instruction endpoints alongside existing routes:

```typescript
// In index.ts:
import { createApiRouter } from './api/routes.ts';

app.use('/api', createApiRouter(game));
```

Phase 1 endpoints (no auth, used internally by orchestrator and for debugging):

```
GET  /api/agents/:id/state     → buildAgentSummary()
GET  /api/agents/:id/genome    → agent.currentGenome
GET  /api/agents/:id/history   → agent.journalArchive (summary)
GET  /api/world/summary        → buildWorldSummary()
POST /api/agents/:id/message   → game.sendMessage()
POST /api/agents/:id/plan      → game.setAgentPlan()
PATCH /api/agents/:id/genome   → game.patchGenome()
```

---

## 4. Socket Events

### 4.1 New Client → Server Events

```typescript
// Add to ClientToServerEvents
'agent:assign_llm': (data: {
  agentId: string;
  providerId: string;
  role: OrchestratorRole;
}) => void;

'agent:remove_llm': (data: { agentId: string }) => void;
```

### 4.2 New Server → Client Events

```typescript
// Add to ServerToClientEvents
'agent:llm_action': (data: {
  agentId: string;
  role: OrchestratorRole;
  actionType: 'message' | 'plan' | 'genome_patch' | 'observe_only';
  details: string;           // human-readable summary for UI log
}) => void;

'agent:plan_update': (data: {
  agentId: string;
  planName: string;
  currentStep: number;
  totalSteps: number;
  status: 'active' | 'completed' | 'abandoned' | 'expired';
}) => void;

'agent:permadeath': (data: {
  agentId: string;
  name: string;
  achievements: string[];
}) => void;  // already exists in current index.ts
```

---

## 5. Client UI Changes

### 5.1 Agent Panel Additions

When an agent is selected, the info panel should show:

- **LLM badge**: role name + provider label (e.g. "🤖 Puppeteer via Claude")
- **Active plan**: plan name, step progress bar, time remaining
- **LLM log**: last 5 actions the LLM took (messages sent, plans issued, genome patches applied) — fed from `agent:llm_action` events
- **Lives bar**: color-coded lives remaining (green > 50, yellow 20-50, red < 20)

### 5.2 Agent Creation UI

When creating an agent, add:
- LLM provider dropdown (populated from `GET /api/llm-providers`)
- Role selector (6 role cards with name + short description from `ROLE_PERMISSIONS`)
- "No LLM" option as default

### 5.3 Game Config Panel

Extend the existing game:configure UI to include per-slot LLM assignment:
- For each agent slot (1..agentCount), show provider + role dropdowns
- "Apply to all" button for bulk assignment

---

## 6. New Files Summary

| File | Purpose | Lines (est.) |
|------|---------|-------------|
| `server/src/orchestrator/OrchestratorLoop.ts` | Main orchestrator timer + LLM call coordination | ~250 |
| `server/src/orchestrator/LLMCaller.ts` | HTTP client for OpenAI/Anthropic/local APIs | ~150 |
| `server/src/orchestrator/AgentSummaryBuilder.ts` | `buildAgentSummary()` + `buildWorldSummary()` | ~200 |
| `server/src/orchestrator/PlanExecutor.ts` | Plan step evaluation, condition checking, target resolution | ~150 |
| `server/src/orchestrator/roles.ts` | Role prompts, permissions, user message builder | ~400 |
| `server/src/orchestrator/ResponseParser.ts` | Parse + validate LLM JSON response, enforce role permissions | ~120 |
| `server/src/api/routes.ts` | REST endpoints from AGENT_API.md | ~200 |
| `server/src/api/middleware.ts` | API key auth, rate limiter (Phase 2) | ~80 |

**Total new code**: ~1,550 lines

---

## 7. Modified Files Summary

| File | Changes |
|------|---------|
| `shared/src/index.ts` | Add `OrchestratorRole`, `ROLE_PERMISSIONS`, `ActivePlan`, `PlanStep`, `PlanCondition`. Extend `AgentState` with `llmRole`, `pendingPlan`. Extend `GameConfig.agentLLMAssignments` to carry role. Add new socket events. |
| `server/src/index.ts` | Import + instantiate OrchestratorLoop, mount API routes, handle `agent:assign_llm` / `agent:remove_llm` socket events. |
| `server/src/GameLoop.ts` | Add `getAgent()`, `setAgentPlan()`, `patchGenome()` methods. Expose `world` and `tickCount`. Wire `agentLLMAssignments` at construction. |
| `server/src/Agent.ts` | Add `llmRole: 'none'` and `pendingPlan: undefined` to default agent state. |
| `server/src/ai/NeedsSystem.ts` | Insert `evaluatePendingPlan()` call between interrupt checks and GOAP layer. |
| `client/src/scenes/UIScene.ts` | Add LLM badge, plan progress, LLM log, lives bar to agent info panel. |
| `client/src/scenes/GameScene.ts` | Handle `agent:llm_action` and `agent:plan_update` events. |

---

## 8. Implementation Phases

### Phase 1: Core Loop (no UI)
- OrchestratorLoop + LLMCaller + AgentSummaryBuilder
- roles.ts with prompt loading + user message builder
- ResponseParser
- GameLoop methods (getAgent, setAgentPlan, patchGenome)
- Hardcode one agent with a role via server config for testing
- Verify LLM calls work end-to-end with console logging

### Phase 2: Plan Execution
- PlanExecutor + NeedsSystem integration
- ActivePlan on AgentState
- Plan step conditions + target resolution
- Test: Puppeteer sends plan, agent follows steps, plan completes

### Phase 3: REST API
- api/routes.ts — observation + instruction endpoints
- Used by orchestrator internally, also exposed for external tools
- Verify with curl

### Phase 4: Socket Wiring
- agent:assign_llm / agent:remove_llm events
- agent:llm_action / agent:plan_update broadcast
- GameConfig consumption of agentLLMAssignments

### Phase 5: Client UI
- LLM badge on agent panel
- Plan progress display
- LLM action log
- Role selector in agent creation
- Per-slot assignment in game config panel

### Phase 6: Polish
- Rate limiting per provider
- Error recovery (retry with backoff)
- LLM response caching (don't re-call if state hasn't changed)
- Metrics logging (LLM call latency, token usage, action distribution per role)
