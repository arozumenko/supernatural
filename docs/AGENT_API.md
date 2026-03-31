# Agent Observation & Instruction API

**Status**: Spec v1 — 2026-03-29
**Depends on**: AGENT_MEMORY.md, SIMULATION.md, PROGRESSION.md

## Overview

A public REST API that lets external LLMs (or any caller) observe agent state in an LLM-optimized format and send instructions at three levels of control: natural language messages, structured action queues, and direct genome patches.

All endpoints are authenticated via API key and rate-limited per key. The server exposes these alongside the existing Socket.IO transport — the WebSocket channel remains the real-time firehose for the game client, while REST serves the slower, richer queries that LLMs need.

---

## 1. Authentication & Rate Limiting

### 1.1 API Keys

```
Authorization: Bearer snk_live_abc123...
```

Keys are issued per player account. Each key is scoped to the agents that player owns (`agent.ownerId === key.playerId`). A key cannot observe or instruct another player's agents unless the agent's `obedience` allows public commands (future feature).

```typescript
interface ApiKey {
  id: string;
  playerId: string;
  name: string;                      // human label, e.g. "my-orchestrator"
  keyHash: string;                   // bcrypt hash of the actual key
  createdAt: number;
  lastUsedAt: number;
  rateLimit: RateLimit;
  permissions: ApiPermission[];
  active: boolean;
}

type ApiPermission = 'observe' | 'message' | 'plan' | 'genome';

interface RateLimit {
  observePerMinute: number;          // default 60
  messagePerMinute: number;          // default 10
  planPerMinute: number;             // default 5
  genomePatchPerMinute: number;      // default 2
}
```

### 1.2 Rate Limiting Strategy

Rate limits are enforced per API key using a sliding window counter (Redis-backed in production, in-memory Map for dev). Responses include standard headers:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 1711699200
```

When a limit is hit, the server returns `429 Too Many Requests` with a `Retry-After` header.

### 1.3 Key Management Endpoints

```
POST   /api/keys              — Create a new API key (returns the raw key ONCE)
GET    /api/keys              — List all keys for the authenticated player
DELETE /api/keys/:keyId       — Revoke a key
```

For the initial implementation, keys can also be set via server config (environment variable) to avoid needing a full auth system before the player account system exists.

---

## 2. Agent Observation API

### 2.1 LLM-Optimized Agent Summary

```
GET /api/agents/:agentId/state
```

Returns a curated summary designed to fit in an LLM context window (~1-2KB). Not the raw `AgentState` — fields are renamed for clarity, numbers are rounded, and context is added.

**Response:**

```typescript
interface AgentSummary {
  // Identity
  id: string;
  name: string;
  alive: boolean;
  age: number;                       // ticks alive this life
  totalDeaths: number;
  livesRemaining: number;

  // Location & surroundings
  position: { x: number; y: number };
  currentAction: string;
  actionReason: string;              // from the decision system's reason field
  biome: string;                     // derived from tile type: "grass", "near_water", "forest", etc.

  // Needs (0-100, higher = better)
  needs: {
    proteinHunger: number;
    plantHunger: number;
    thirst: number;
    stamina: number;
    health: number;
    social: number;
    shelter: number;
  };

  // Urgencies — which needs are most critical RIGHT NOW
  urgentNeeds: string[];             // e.g. ["thirst", "proteinHunger"] — needs below 30

  // Resources carried
  resources: {
    wood: number;
    stone: number;
    food: number;
    meat: number;
    iron_ore: number;
    iron_ingot: number;
    // other non-zero resources included dynamically
  };

  // Equipment summary (not full item defs, just names)
  equipment: {
    mainHand: string | null;         // e.g. "stone_axe"
    body: string | null;
    accessory: string | null;
  };
  carryWeight: number;
  carryCapacity: number;

  // Skills (level only, not XP)
  skills: Record<string, number>;    // { combat: 5, mining: 12, ... }

  // Personality & behavior
  personality: string[];
  obedience: number;
  socialScore: number;

  // Current plan (if GOAP is active)
  currentPlan: {
    goal: string;
    steps: string[];                 // human-readable step names
    currentStep: number;
  } | null;

  // Nearby awareness (within detection range)
  nearby: {
    threats: NearbyEntity[];         // dangerous animals/agents
    resources: NearbyResource[];     // trees, rocks, plants, water, iron
    agents: NearbyAgent[];           // other agents
    corpses: NearbyCorpse[];
  };

  // Memory system (from AGENT_MEMORY.md)
  genome: {
    version: number;
    generation: number;
    activeStrategyRules: string[];   // rule names only
    fitnessScore: number;
  };
  currentLifeTicks: number;
  lifetimeBestSurvival: number;
  isHighlander: boolean;

  // Recent events (last 10 from journal)
  recentEvents: {
    tick: number;
    type: string;
    details: string;
  }[];

  // Messages
  pendingMessages: number;           // count of unprocessed player messages
  lastMessageFollowed: boolean | null;

  // Server context
  serverTick: number;
  serverTime: string;                // ISO timestamp
}

interface NearbyEntity {
  type: string;                      // species name or "agent"
  name?: string;
  distance: number;
  direction: string;                 // "north", "southeast", etc.
  dangerLevel: 'low' | 'medium' | 'high' | 'extreme';
}

interface NearbyResource {
  type: string;                      // "tree", "rock", "water", "berry_bush", "iron_ore", etc.
  distance: number;
  direction: string;
  quantity?: number;                 // for countable resources
}

interface NearbyAgent {
  id: string;
  name: string;
  distance: number;
  direction: string;
  relationship: number;              // -100 to 100
  alive: boolean;
}

interface NearbyCorpse {
  species: string;
  distance: number;
  direction: string;
  ticksRemaining: number;            // before decay
}
```

**Building the summary** — server-side function:

```typescript
function buildAgentSummary(agent: AgentState, world: World, tickCount: number): AgentSummary {
  const ax = Math.floor(agent.x);
  const ay = Math.floor(agent.y);
  const detectRange = 6 + (agent.skills.survival.level * 0.1);

  return {
    id: agent.id,
    name: agent.name,
    alive: agent.alive,
    age: agent.age,
    totalDeaths: agent.totalDeaths,
    livesRemaining: agent.livesRemaining ?? 100,

    position: { x: ax, y: ay },
    currentAction: agent.action,
    actionReason: extractActionReason(agent),
    biome: describeBiome(world, ax, ay),

    needs: { ...agent.needs },
    urgentNeeds: findUrgentNeeds(agent.needs, 30),

    resources: filterNonZero(agent.resources),
    equipment: {
      mainHand: agent.inventory.equipped.mainHand?.itemId ?? null,
      body: agent.inventory.equipped.body?.itemId ?? null,
      accessory: agent.inventory.equipped.accessory?.itemId ?? null,
    },
    carryWeight: agent.carryWeight ?? 0,
    carryCapacity: agent.carryCapacity ?? 100,

    skills: extractSkillLevels(agent.skills),
    personality: agent.personality,
    obedience: agent.obedience,
    socialScore: agent.socialScore,

    currentPlan: agent.currentPlanGoal ? {
      goal: agent.currentPlanGoal,
      steps: (agent.currentPlanSteps ?? []).map(s => s.name),
      currentStep: agent.planStepIndex ?? 0,
    } : null,

    nearby: scanNearby(agent, world, detectRange),
    genome: summarizeGenome(agent.currentGenome),
    currentLifeTicks: tickCount - (agent.currentJournal?.birthTick ?? 0),
    lifetimeBestSurvival: agent.lifetimeBestSurvival ?? 0,
    isHighlander: agent.isHighlander ?? false,

    recentEvents: (agent.currentJournal?.events ?? []).slice(-10).map(e => ({
      tick: e.tick, type: e.type, details: e.details,
    })),

    pendingMessages: agent.messageQueue.length,
    lastMessageFollowed: agent.lastMessage?.followed ?? null,

    serverTick: tickCount,
    serverTime: new Date().toISOString(),
  };
}
```

### 2.2 Available Genomes

```
GET /api/genomes
```

Public endpoint (no authentication required). Returns a list of all available preset genomes that can be assigned to agents.

**Response:**

```typescript
interface GenomeListEntry {
  id: string;                        // unique genome identifier
  label: string;                     // human-readable name
  emoji: string;                     // display emoji
  archetype: string;                 // behavioral archetype (e.g. "balanced", "aggressive", "cautious")
  description: string;               // brief description of the genome's behavior
  stats: Record<string, number>;     // key genome parameters
  rules: {                           // summary of strategy rules
    name: string;
    description?: string;
  }[];
}
```

**Example response:**

```json
[
  {
    "id": "default",
    "label": "Balanced",
    "emoji": "⚖️",
    "archetype": "balanced",
    "description": "Default genome with balanced priorities and no special rules.",
    "stats": { "fleeBase": 60, "criticalThirst": 20, "criticalHunger": 20 },
    "rules": []
  }
]
```

### 2.3 World Context Endpoint

```
GET /api/world/summary
```

Returns a compact world overview for LLM orientation — not per-agent, but the overall state of the simulation.

```typescript
interface WorldSummary {
  tick: number;
  season: string;
  population: {
    agents: { alive: number; dead: number; total: number };
    animals: Record<string, number>;   // species -> count
  };
  resources: {
    ironDepositsRemaining: number;
    averageTreeDensity: number;        // trees per 100 tiles
  };
  recentEvents: {                      // last 20 world events
    tick: number;
    type: string;
    message: string;
  }[];
  highlander: { id: string; name: string } | null;
}
```

### 2.4 Multi-Agent Query

```
GET /api/agents?alive=true&fields=id,name,needs,position
```

Returns a lightweight list of all agents the key owner has access to. Supports field selection to keep payloads small.

### 2.5 Agent History

```
GET /api/agents/:agentId/history
```

Returns journal summaries (not full journals — those are large):

```typescript
interface AgentHistory {
  agentId: string;
  name: string;
  livesRemaining: number;
  achievements: string[];
  lives: {
    lifeNumber: number;
    survivalTicks: number;
    deathCause: string;
    killerSpecies?: string;
    topSkillGained: string;            // skill with most XP gained this life
    genomeVersion: number;
  }[];
}
```

### 2.6 Full Genome (on demand)

```
GET /api/agents/:agentId/genome
```

Returns the complete `BehaviorGenome` JSON. Only needed for deep analysis or debugging — the summary endpoint already includes genome version and active rule names.

---

## 3. Agent Instruction API

Three tiers of control, from gentle nudge to full rewrite.

### 3.1 Tier 1: Natural Language Message

```
POST /api/agents/:agentId/message
```

Same as the existing `player:message` socket event, but via REST. The agent interprets the message based on its `obedience` score and personality. It may choose to ignore it.

**Request:**

```json
{
  "content": "There's a bear to your north, go south and gather wood instead",
  "urgent": false
}
```

**Response:**

```json
{
  "messageId": "msg_abc123",
  "cost": 3,
  "agentObedience": 78,
  "estimatedFollowChance": "high",
  "queuePosition": 0
}
```

The `urgent` flag pushes the message to the front of the queue (costs 2x). The `estimatedFollowChance` is derived from obedience + personality alignment but is not a guarantee.

**Limits**: Rate-limited to `messagePerMinute` (default 10). Cost still applies as per the social ladder formula.

### 3.2 Tier 2: Structured Action Queue

```
POST /api/agents/:agentId/plan
```

Sends a structured plan the agent will attempt to follow. Unlike messages, plans bypass the NLP interpretation layer — the agent receives exact action sequences. However, the agent's `obedience` still determines if it accepts the plan, and survival interrupts can still override plan steps.

**Request:**

```typescript
interface ActionPlan {
  name: string;                      // human-readable plan name
  steps: PlanStep[];
  priority: number;                  // 1-80 (capped below interrupt range)
  expireAfterTicks: number;          // plan auto-cancels after this many ticks
  abandonOnDanger: boolean;          // if true, plan is dropped when threats appear
}

interface PlanStep {
  action: AgentAction;               // "harvesting", "drinking", "crafting", etc.
  target?: {
    type: 'position' | 'entity' | 'resource' | 'nearest';
    x?: number;
    y?: number;
    entityId?: string;
    resourceType?: string;           // for 'nearest': "water", "tree", "iron_ore"
  };
  condition?: PlanCondition;         // when to consider this step "done"
  maxTicks?: number;                 // timeout per step
}

interface PlanCondition {
  type: 'resource_above' | 'need_above' | 'at_position' | 'item_crafted' | 'ticks_elapsed';
  field?: string;
  value?: number;
  position?: { x: number; y: number; radius: number };
}
```

**Example — "stockpile then build" plan:**

```json
{
  "name": "Prepare for shelter",
  "steps": [
    {
      "action": "harvesting",
      "target": { "type": "nearest", "resourceType": "tree" },
      "condition": { "type": "resource_above", "field": "wood", "value": 20 },
      "maxTicks": 500
    },
    {
      "action": "harvesting",
      "target": { "type": "nearest", "resourceType": "rock" },
      "condition": { "type": "resource_above", "field": "stone", "value": 10 },
      "maxTicks": 300
    },
    {
      "action": "building",
      "condition": { "type": "ticks_elapsed", "value": 100 },
      "maxTicks": 200
    }
  ],
  "priority": 55,
  "expireAfterTicks": 2000,
  "abandonOnDanger": true
}
```

**Response:**

```json
{
  "planId": "plan_xyz789",
  "accepted": true,
  "reason": "Agent accepted plan (obedience: 78, threshold: 60)",
  "estimatedTicks": 800,
  "currentStep": 0,
  "expiresAtTick": 45200
}
```

**Rejection reasons**: Agent can reject if obedience is too low, plan priority conflicts with a critical need, or the plan contains invalid actions. The response always explains why.

**Plan execution**:
- Plans are stored as a `pendingPlan` on the agent, separate from the GOAP planner
- Each tick, if no interrupt fires and no GOAP goal outweighs the plan priority, the plan step executes
- Step transitions happen when the condition is met or maxTicks is reached
- The plan is abandoned if `abandonOnDanger` is true and a threat enters detection range
- Plan status is visible in the observation endpoint under `currentPlan`

```
GET /api/agents/:agentId/plan
```

Returns current plan status, step progress, and time remaining.

```
DELETE /api/agents/:agentId/plan
```

Cancels the current plan immediately.

### 3.3 Tier 3: Genome Patch

```
PATCH /api/agents/:agentId/genome
```

Directly modifies the agent's Behavior Genome. This is the most powerful instruction tier — it changes how the agent thinks, not just what it does right now. All patches go through the same `validateGenome()` safety bounds defined in AGENT_MEMORY.md §1.4.

**Request** — JSON Patch format ([RFC 6902](https://datatracker.ietf.org/doc/html/rfc6902)):

```json
{
  "patches": [
    { "op": "replace", "path": "/interruptWeights/fleeBase", "value": 80 },
    { "op": "replace", "path": "/thresholds/criticalThirst", "value": 30 },
    { "op": "add", "path": "/strategyRules/-", "value": {
      "id": "water_hoarder",
      "name": "Preemptive Water Seeking",
      "condition": { "type": "need_below", "field": "thirst", "value": 70 },
      "effect": { "type": "boost_priority", "action": "drinking", "amount": 25 },
      "priority": 65,
      "enabled": true,
      "source": "external_llm: ensure hydration"
    }}
  ],
  "reason": "Agent keeps dying of thirst while mining far from water"
}
```

**Response:**

```json
{
  "applied": true,
  "previousVersion": 3,
  "newVersion": 4,
  "validationWarnings": [],
  "changedFields": ["interruptWeights.fleeBase", "thresholds.criticalThirst", "strategyRules[3]"],
  "genomeSizeBytes": 2847
}
```

**Validation failures** return `400` with details:

```json
{
  "applied": false,
  "errors": [
    "interruptWeights.fleeBase value 120 exceeds max bound 99",
    "strategyRules count 16 exceeds max 15"
  ]
}
```

**Safeguards**:
- All patches validated against the safety bounds table (AGENT_MEMORY.md §1.4)
- Survival goal weights (`survive_thirst`, `survive_protein`, `survive_plant`) cannot be set below 0.3
- Maximum 15 strategy rules enforced
- Patches are logged with the API key ID and reason for audit
- Genome version is incremented on every successful patch
- The `reason` field is stored in `genome.lineage` for evolution history

**Limits**: Rate-limited to `genomePatchPerMinute` (default 2). This is intentionally low — genome changes should be infrequent and deliberate.

---

## 4. Streaming & Webhooks (Future)

### 4.1 Server-Sent Events (SSE)

```
GET /api/agents/:agentId/stream
```

Opens an SSE stream for real-time agent events. More efficient than polling the observation endpoint. Events are the same `LifeEvent` types from the journal system:

```
event: need_critical
data: {"tick": 4523, "type": "need_critical", "details": "thirst dropped to 18"}

event: combat_start
data: {"tick": 4530, "type": "combat_start", "details": "attacked by wolf"}

event: strategy_rule_fired
data: {"tick": 4531, "type": "strategy_rule_fired", "details": "Rule 'flee_predators' activated"}
```

### 4.2 Webhooks

```
POST /api/webhooks
```

Register a URL to receive callbacks on agent events:

```json
{
  "agentId": "agent_abc",
  "url": "https://my-llm-service.com/hooks/agent-events",
  "events": ["death", "need_critical", "combat_start", "plan_completed"],
  "secret": "whsec_..."
}
```

The server POSTs a signed payload (HMAC-SHA256) to the URL when matching events occur. This enables reactive LLM orchestration — the LLM doesn't need to poll, it gets notified when something important happens.

---

## 5. Integration with Existing Systems

### 5.1 Server Router Setup

New file: `server/src/api/routes.ts`

```typescript
import { Router } from 'express';
import { GameLoop } from '../GameLoop.ts';
import { authenticateApiKey, rateLimit } from './middleware.ts';

export function createApiRouter(game: GameLoop): Router {
  const router = Router();

  // Public (no auth)
  router.get('/genomes', getAvailableGenomes(game));

  // All remaining routes require API key auth
  router.use(authenticateApiKey);

  // Observation
  router.get('/agents/:agentId/state', rateLimit('observe'), getAgentState(game));
  router.get('/agents', rateLimit('observe'), listAgents(game));
  router.get('/agents/:agentId/history', rateLimit('observe'), getAgentHistory(game));
  router.get('/agents/:agentId/genome', rateLimit('observe'), getAgentGenome(game));
  router.get('/world/summary', rateLimit('observe'), getWorldSummary(game));

  // Instructions
  router.post('/agents/:agentId/message', rateLimit('message'), sendMessage(game));
  router.post('/agents/:agentId/plan', rateLimit('plan'), sendPlan(game));
  router.get('/agents/:agentId/plan', rateLimit('observe'), getPlanStatus(game));
  router.delete('/agents/:agentId/plan', rateLimit('plan'), cancelPlan(game));
  router.patch('/agents/:agentId/genome', rateLimit('genome'), patchGenome(game));

  // Key management (authenticated via player session, not API key)
  router.post('/keys', createApiKey);
  router.get('/keys', listApiKeys);
  router.delete('/keys/:keyId', revokeApiKey);

  // Streaming
  router.get('/agents/:agentId/stream', rateLimit('observe'), streamAgentEvents(game));

  // Webhooks
  router.post('/webhooks', rateLimit('plan'), registerWebhook(game));
  router.get('/webhooks', listWebhooks(game));
  router.delete('/webhooks/:hookId', deleteWebhook(game));

  return router;
}
```

### 5.2 Mounting in index.ts

```typescript
// In server/src/index.ts, after game creation:
import { createApiRouter } from './api/routes.ts';

app.use(express.json());
app.use('/api', createApiRouter(game));
```

### 5.3 GameLoop Additions

The GameLoop needs new methods to support the API:

```typescript
class GameLoop {
  // ... existing ...

  // Observation
  getAgent(agentId: string): AgentState | undefined {
    return this.agents.find(a => a.id === agentId);
  }

  getAgentSummary(agentId: string): AgentSummary | null {
    const agent = this.getAgent(agentId);
    if (!agent) return null;
    return buildAgentSummary(agent, this.world, this.tickCount);
  }

  getWorldSummary(): WorldSummary {
    return buildWorldSummary(this.agents, this.world, this.tickCount);
  }

  // Instructions
  setAgentPlan(agentId: string, plan: ActionPlan): PlanResult {
    const agent = this.getAgent(agentId);
    if (!agent || !agent.alive) return { accepted: false, reason: 'Agent not found or dead' };
    // Obedience check
    if (Math.random() * 100 > agent.obedience) {
      return { accepted: false, reason: `Agent refused (obedience: ${agent.obedience})` };
    }
    agent.pendingPlan = {
      ...plan,
      planId: generateId(),
      currentStep: 0,
      startTick: this.tickCount,
      expiresAtTick: this.tickCount + plan.expireAfterTicks,
    };
    return {
      accepted: true,
      planId: agent.pendingPlan.planId,
      reason: `Agent accepted plan (obedience: ${agent.obedience})`,
      expiresAtTick: agent.pendingPlan.expiresAtTick,
    };
  }

  patchGenome(agentId: string, patches: JsonPatch[], reason: string): GenomePatchResult {
    const agent = this.getAgent(agentId);
    if (!agent || !agent.currentGenome) return { applied: false, errors: ['Agent not found'] };

    const draft = structuredClone(agent.currentGenome);
    applyJsonPatches(draft, patches);

    const validation = validateGenome(draft);
    if (!validation.valid) return { applied: false, errors: validation.errors };

    draft.version = agent.currentGenome.version + 1;
    draft.mutatedAt = this.tickCount;
    draft.lineage.push(`api: ${reason}`);
    agent.currentGenome = draft;

    return { applied: true, previousVersion: draft.version - 1, newVersion: draft.version };
  }
}
```

### 5.4 Plan Execution in NeedsSystem

Plans integrate into the existing decision architecture as a mid-priority decision source:

```typescript
// In decideAction(), after interrupt checks but before GOAP:
if (agent.pendingPlan) {
  const plan = agent.pendingPlan;

  // Check expiry
  if (tickCount >= plan.expiresAtTick) {
    agent.pendingPlan = undefined;
  }
  // Check danger abandonment
  else if (plan.abandonOnDanger && hasNearbyThreat(agent, world)) {
    recordLifeEvent(agent, 'plan_abandoned', `Plan "${plan.name}" abandoned due to danger`);
    agent.pendingPlan = undefined;
  }
  // Execute current step
  else {
    const step = plan.steps[plan.currentStep];
    if (!step) {
      // Plan complete
      recordLifeEvent(agent, 'plan_completed', `Plan "${plan.name}" finished`);
      agent.pendingPlan = undefined;
    } else {
      // Check step completion condition
      if (evaluatePlanCondition(step.condition, agent, tickCount - plan.stepStartTick)) {
        plan.currentStep++;
        plan.stepStartTick = tickCount;
      }
      // Check step timeout
      else if (step.maxTicks && (tickCount - plan.stepStartTick) > step.maxTicks) {
        plan.currentStep++;
        plan.stepStartTick = tickCount;
      }
      // Execute step action at plan priority
      else {
        const target = resolvePlanTarget(step.target, agent, world);
        decisions.push({
          action: step.action,
          priority: plan.priority,
          target,
          reason: `plan: ${plan.name} step ${plan.currentStep + 1}/${plan.steps.length}`,
        });
      }
    }
  }
}
```

---

## 6. Error Responses

All error responses follow a consistent format:

```typescript
interface ApiError {
  error: string;                     // machine-readable error code
  message: string;                   // human-readable explanation
  details?: Record<string, any>;     // additional context
}
```

| Status | Error Code | When |
|--------|-----------|------|
| 400 | `invalid_request` | Malformed JSON, missing required fields |
| 400 | `validation_failed` | Genome patch violates safety bounds |
| 400 | `invalid_plan` | Plan contains unknown actions or invalid targets |
| 401 | `unauthorized` | Missing or invalid API key |
| 403 | `forbidden` | Key doesn't have permission for this agent |
| 404 | `agent_not_found` | Agent ID doesn't exist |
| 409 | `agent_dead` | Agent is permanently dead (0 lives) |
| 409 | `plan_conflict` | Agent already has an active plan (must cancel first) |
| 429 | `rate_limited` | Rate limit exceeded |
| 500 | `internal_error` | Server error |

---

## 7. LLM Orchestration Patterns

### 7.1 Observation Loop

The simplest pattern: an external LLM polls agent state and sends messages.

```
Every 30 seconds:
  1. GET /api/agents/:id/state
  2. LLM analyzes needs, threats, recent events
  3. POST /api/agents/:id/message with advice
```

### 7.2 Tactical Planner

A more sophisticated pattern: the LLM builds structured plans.

```
Every 60 seconds:
  1. GET /api/agents/:id/state
  2. GET /api/world/summary (for context)
  3. LLM generates an ActionPlan based on agent state + world state
  4. POST /api/agents/:id/plan
  5. Poll GET /api/agents/:id/plan every 10s to monitor progress
  6. If plan stalls → DELETE plan, generate new one
```

### 7.3 Evolution Advisor

The LLM acts as a strategic advisor, modifying the genome over time.

```
On webhook "death" event:
  1. GET /api/agents/:id/history
  2. GET /api/agents/:id/genome
  3. LLM analyzes death patterns + genome
  4. PATCH /api/agents/:id/genome with improvements
```

### 7.4 Hybrid (Recommended)

Combine all three tiers based on urgency:

```
URGENT (threat detected via SSE):
  → POST /message "Run south NOW"

TACTICAL (routine optimization):
  → POST /plan { gather resources, then build }

STRATEGIC (after death, periodic review):
  → PATCH /genome { adjust thresholds based on patterns }
```

---

## 8. Server Configuration

```typescript
interface ApiConfig {
  enabled: boolean;                  // feature flag for entire API
  cors: {
    allowedOrigins: string[];        // default: ['*'] for dev
  };
  auth: {
    devKey?: string;                 // bypass key for development
    maxKeysPerPlayer: number;        // default 5
  };
  rateLimits: {
    default: RateLimit;              // applied when key has no custom limits
  };
  webhooks: {
    enabled: boolean;
    maxPerPlayer: number;            // default 3
    timeoutMs: number;               // default 5000
    retryAttempts: number;           // default 3
  };
  sse: {
    enabled: boolean;
    maxConnectionsPerKey: number;    // default 5
    heartbeatIntervalMs: number;     // default 15000
  };
}
```

---

## 9. Prerequisites & New Fields

This API spec assumes several types and fields that **do not yet exist** in the codebase. They must be added before or alongside API implementation.

### 9.1 AgentState Extensions (shared/src/index.ts)

Fields the observation and instruction endpoints require that are **not yet in AgentState**:

| Field | Type | Added By | Needed For |
|-------|------|----------|------------|
| `livesRemaining` | `number` | AGENT_MEMORY.md Phase 3 | Observation summary |
| `currentGenome` | `BehaviorGenome` | AGENT_MEMORY.md Phase 1 | Genome endpoint, patch endpoint |
| `currentJournal` | `LifeJournal` | AGENT_MEMORY.md Phase 2 | Recent events in summary |
| `journalArchive` | `LifeJournal[]` | AGENT_MEMORY.md Phase 2 | History endpoint |
| `lifetimeBestSurvival` | `number` | AGENT_MEMORY.md Phase 3 | Observation summary |
| `isHighlander` | `boolean` | AGENT_MEMORY.md Phase 3 | Observation summary |
| `achievements` | `string[]` | AGENT_MEMORY.md Phase 3 | History endpoint |
| `pendingPlan` | `ActivePlan \| undefined` | **This spec (Phase 3)** | Plan system |

### 9.2 New Types Needed

| Type | Defined In | Needed For |
|------|-----------|------------|
| `BehaviorGenome` | AGENT_MEMORY.md §1.1 | Genome observation & patch |
| `LifeJournal` | AGENT_MEMORY.md §2.1 | History & event streaming |
| `StrategyRule` | AGENT_MEMORY.md §1.2 | Genome patch validation |
| `ActionPlan` | **This spec §3.2** | Plan instruction tier |
| `ApiKey` | **This spec §1.1** | Auth system |

### 9.3 New Utility Functions

| Function | Purpose | Phase |
|----------|---------|-------|
| `buildAgentSummary()` | Construct LLM-optimized view from AgentState + World | Phase 1 |
| `buildWorldSummary()` | Construct world overview | Phase 1 |
| `scanNearby()` | Find threats/resources/agents near a position | Phase 1 |
| `describeBiome()` | Derive biome string from tile type at position | Phase 1 |
| `validateGenome()` | Safety bounds checking (from AGENT_MEMORY.md §4.3) | Phase 4 |
| `evaluatePlanCondition()` | Check if a plan step's completion condition is met | Phase 3 |
| `resolvePlanTarget()` | Convert plan target spec to world coordinates | Phase 3 |

### 9.4 New Files

| File | Purpose |
|------|---------|
| `server/src/api/routes.ts` | Express router with all API endpoints |
| `server/src/api/middleware.ts` | Auth, rate limiting, error handling middleware |
| `server/src/api/summary.ts` | Summary builder functions (buildAgentSummary, etc.) |
| `server/src/api/plans.ts` | Plan validation, execution, storage |

---

## 10. Implementation Order

1. **Phase 1: Observation endpoints** — `/agents/:id/state`, `/world/summary`, `/agents`. No auth yet, just the data layer. Build `summary.ts` with the helper functions. Validate that the LLM-optimized summary is useful by testing with actual prompts. **No AGENT_MEMORY dependency** — gracefully omit genome/journal fields if they don't exist yet.

2. **Phase 2: Message endpoint** — `/agents/:id/message` via REST. Thin wrapper over existing `sendMessage()`. Add basic API key auth (env-var dev key).

3. **Phase 3: Plan system** — `ActionPlan` type, `pendingPlan` field on AgentState, plan execution in NeedsSystem, plan CRUD endpoints. Most complex phase — requires integration testing. **No AGENT_MEMORY dependency.**

4. **Phase 4: Genome patch** — PATCH endpoint with JSON Patch support + validation. **Requires AGENT_MEMORY.md Phase 1** (Behavior Genome types and `validateGenome()`).

5. **Phase 5: Auth & rate limiting** — Full API key management, rate limiter middleware, permission scoping.

6. **Phase 6: Streaming** — SSE endpoint + webhook registration. **Requires AGENT_MEMORY.md Phase 2** (Life Journal event recording hooks).

7. **Phase 7: History & debugging** — `/agents/:id/history`, `/agents/:id/genome`, genome diff endpoint. **Requires AGENT_MEMORY.md Phases 1-3.**
