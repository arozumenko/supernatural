# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Supernatural is a server-authoritative AI agent civilization simulator. Autonomous agents with needs, personalities, base stats, and learnable skills inhabit a procedurally generated tile world alongside 20 animal species forming a complete food chain. External LLMs observe, instruct, and evolve agents through a REST API — each playing a distinct "god" role (Advisor, Puppeteer, God, Darwinist, Parent, Chaos Demon).

## Commands

```bash
# Install all dependencies (root + shared + server + client)
npm run install:all

# Run full dev environment (server + client concurrently)
npm run dev

# Run server only (tsx watch, port 3001)
npm run dev:server

# Run client only (vite, port 5173)
npm run dev:client

# Build all (shared → server → client, order matters)
npm run build
```

Server status: `GET http://localhost:3001/api/status`
Dev API key: set `SUPERNATURAL_API_KEY=yourkey` env var

## Architecture

Monorepo with three packages: `shared/`, `server/`, `client/`. All TypeScript (ES modules, strict mode). Uses `tsx` runtime for server (no tsc compilation needed for dev).

### shared/src/
- **index.ts** — Central type hub. Re-exports from genome.ts, journal.ts, api-types.ts. Contains: world constants (120x90, 32px, 10Hz, max 50 agents), TileType enum (24 types including TOMBSTONE), AgentState (30+ fields including evolution: livesRemaining, genomeVersion, llmRole, activeStrategyRuleNames), GameConfig (with agentLLMAssignments carrying providerId + OrchestratorRole), OrchestratorRole type (7 roles), ROLE_PERMISSIONS const, Socket.IO event contracts.
- **genome.ts** — BehaviorGenome (interrupt weights, medium priorities, thresholds, GOAP goal weights, action cost mods, fallback weights, strategy rules), StrategyRule/RuleCondition/RuleEffect, GENOME_BOUNDS safety limits, LLMProviderConfig (supports 6 providers: anthropic, openai, google, ollama, bedrock, openai_compatible).
- **journal.ts** — LifeJournal, DeathCause (9 types), LifeMetrics, TimelineEntry, LifeEvent (18 types).
- **api-types.ts** — ActionPlan/ActivePlan/PlanStep/PlanCondition, AgentSummary/WorldSummary/NearbyEntity, ApiKey/ApiRateLimit, LLMResponse/LLMAction, JsonPatch.

### server/src/
- **index.ts** — Express + Socket.IO server on port 3001. Loads LLM providers, bootstraps dev API key, mounts API router (uses `() => game` getter pattern because game is reassigned on configure), instantiates OrchestratorLoop, handles agent:assign_llm/agent:remove_llm socket events, broadcasts agent:llm_action events.
- **GameLoop.ts** — Central tick loop at 10Hz. Death handler: 9-way cause detection → journal finalization → lives calculation → permadeath check → evolution (LLM or fallback mutation) → corpse spawn → respawn queue. Journal sampling every 100/300 ticks. Genome hot-swap on respawn. EventEmitter for API SSE streaming.
- **World.ts** — Procedural generation (9 passes), entity management, A* pathfinding, tile grid queries (findNearest*, get*At).
- **Agent.ts** — Factory with genome (`createDefaultGenome()`), lives (100), journal, all evolution fields. `llmRole: 'none'` default.
- **Progression.ts** — XP/leveling, effective stats, combat formulas, metabolism helpers.
- **WorldConfig.ts** — All tunable generation parameters.
- **AnimalSpeciesConfig.ts** — 20 animal species.
- **ItemDefinitions.ts** — 52 items. **RecipeDefinitions.ts** — 53 recipes.

### server/src/ai/
- **NeedsSystem.ts** — Genome-driven decision engine. All priorities/thresholds read from `agent.currentGenome` (via `(agent as any).currentGenome`). Flow: player messages → threats/flee → self-defense → critical survival → **pending plan execution** → GOAP → fallback priorities → strategy rules → wander. Sets `agent.lastDecisionReason`.
- **GOAPPlanner.ts** — 8 goals with genome-weighted urgency, genome-modified action costs, genome-driven relevance thresholds.
- **AnimalAI.ts** — Utility AI, 3-sense awareness, special abilities, flocking.
- **BehaviorGenome.ts** — `createDefaultGenome()` (all current hardcoded values), `validateGenome()`, `clampGenome()`.
- **LifeJournal.ts** — `initJournal()`, `recordTimelineEntry()`, `recordHeatmapEntry()`, `recordLifeEvent()`, `detectDeathCause()` (9-way), `finalizeJournal()`, metrics tracking. Emits to `apiEventEmitter` for SSE.
- **LivesEconomy.ts** — `calculateLivesChange()`, achievements, Highlander check.
- **FallbackEvolution.ts** — 8 death-cause-specific mutation functions (starvation_protein/plant/both, dehydration, killed_by_animal/agent, exhaustion, poison).
- **StrategyRules.ts** — Recursive condition evaluator (and/or/not, need/resource checks, near_entity, skill_level, deaths_remaining), effect applicator (boost/suppress/force/flee/modify).
- **EvolutionQueue.ts** — Async non-blocking LLM queue for death-triggered genome evolution.
- **LLMClient.ts** — HTTP client for evolution calls. Supports all 6 providers with SigV4 signing for Bedrock.
- **Pathfinding.ts** — A* with excludeTiles.

### server/src/orchestrator/
- **OrchestratorLoop.ts** — Per-agent timer-based orchestrator. `registerAgent()` starts observation interval per role. `tick()`: builds AgentSummary → role prompt + user message → LLM call → parse response → apply actions (message/plan/genome_patch). Enforces role permissions.
- **LLMCaller.ts** — System+user message HTTP client. All 6 providers: Anthropic (Messages API), OpenAI (Chat Completions), Google Gemini (GenerateContent), Ollama (native /api/chat), AWS Bedrock (Converse API with zero-dep SigV4 signing), OpenAI-compatible (vLLM/Together/Groq/etc).
- **ResponseParser.ts** — Parses LLM JSON responses, strips markdown fences, enforces role permissions, validates genome patches, caps plan priority at 70.
- **roles.ts** — 6 embedded role system prompts, `getRolePrompt()`, `buildUserMessage()` with role-specific context (god/darwinist get genome info, puppeteer gets plan status, parent gets skill phases).

### server/src/api/
- **routes.ts** — `createApiRouter(getGame)`. Public: /status, /llm-providers. Authenticated: /agents, /agents/:id/state, /agents/:id/genome, /agents/:id/history, /world/summary, /agents/:id/message, /agents/:id/plan (CRUD), /agents/:id/genome (PATCH), /agents/:id/stream (SSE), /keys (CRUD), /webhooks (CRUD).
- **middleware.ts** — `authenticateApiKey` (Bearer token), `rateLimit(category)` (sliding window), `requirePermission(perm)`.
- **summary.ts** — `buildAgentSummary()` (nearby scan with distance/direction), `buildWorldSummary()`, `describeBiome()`.
- **plan-executor.ts** — `executePendingPlan()` integrated into NeedsSystem between interrupts and GOAP. `evaluatePlanCondition()`, `resolvePlanTarget()`, `hasNearbyThreat()`.
- **json-patch.ts** — Minimal RFC 6902 (add/replace/remove, array index, `/path/-` append).
- **key-store.ts** — In-memory API keys with SHA-256 hashing, dev key bootstrap from env.
- **rate-limiter.ts** — Sliding window per-key rate limiter.
- **handlers/** — observation.ts, instruction.ts, keys.ts, streaming.ts.

### server/src/config/
- **llm-config.ts** — Loads `server/llm-providers.json`, resolves `$ENV_VAR` in apiKey, provides `getLLMProvider(id)`.

### client/src/
- **main.ts** — Phaser 3 config.
- **network/SocketClient.ts** — Socket.IO wrapper. Handles: world:init/update, agent:died/born/permadeath/llm_action/plan_update, social:interaction, message:result, world:event.
- **scenes/MainMenuScene.ts** — Start screen: world settings (map size, agents 3-20, water, trees, animals) + AGENT AI section with per-agent **provider cycling** + **role cycling** (advisor/puppeteer/god/darwinist/parent/chaos_demon). Fetches `/api/llm-providers` on create. Bulk assignment buttons. Config flows as `agentLLMAssignments: Record<number, {providerId, role} | null>`.
- **scenes/GameScene.ts** — Tile world renderer. Camera viewport: `setViewport(SIDEBAR_W, 0, width - SIDEBAR_W - PANEL_W, height)` where SIDEBAR_W=260, PANEL_W=380. Click guards exclude both panels. Public `selectAgentById(id)` for sidebar interaction.
- **scenes/UIScene.ts** — Three-panel layout:
  - **Left sidebar** (260px): God cards grouped by LLM provider (power score, role badge with color: ADV/PUP/GOD/DAR/PAR/CHO, provider label, agent count). Agent rows (alive dot, name, total level, action label). Unassigned section at bottom. Scrollable. Click → camera pan + selection.
  - **Right panel** (380px): Selected entity detail. Agent panel includes: needs bars, skills, inventory, metabolism, obedience, **evolution section** (lives remaining color-coded, genome version, life/best duration, Highlander badge, AI role + provider, active strategy rules).
  - **Event log**: Last 16 world events.
- **sprites/TileGenerator.ts** — Autotile renderer + procedural textures.

### Data Flow
1. Server runs simulation at 10 ticks/sec, broadcasts `world:update` with all entity states
2. Client receives updates, lerps positions, reconciles sprite maps, updates sidebar
3. Player actions (`create_agent`, `message`) sent client→server via Socket.IO
4. OrchestratorLoop polls agent state per role interval (10-30s), calls LLM, applies actions
5. On death: journal finalized → lives calculated → LLM evolution (async) or fallback mutation → respawn with updated genome
6. REST API enables external LLM orchestration (observe → message/plan/genome_patch)

## Key Conventions

- **Non-wire fields**: Heavy data stored as `(agent as any).currentGenome`, `(agent as any).currentJournal`, `(agent as any).journalArchive`, `(agent as any).pendingPlan`, `(agent as any)._metricsAccum` — avoids sending over Socket.IO every tick.
- **PlantType array typing**: When building arrays that may include POISON_SHROOM, explicitly type as `PlantType[]` to avoid narrowing issues.
- **Genome reads**: Always `const genome: BehaviorGenome = (agent as any).currentGenome ?? createDefaultGenome()` at function top. Default genome values match pre-refactor hardcoded constants exactly.
- **LLM provider config**: `server/llm-providers.json` loaded at startup. `$ENV_VAR` syntax in apiKey field. For Bedrock: `apiKey = "ACCESS_KEY:SECRET_KEY"`, `baseUrl = region`. For Ollama: `apiKey = ""`, `baseUrl = "http://localhost:11434"`.
- **Router getter pattern**: `createApiRouter(() => game)` because `game` is reassigned on `game:configure`.

## LLM Provider Support

| Provider | Type | Auth |
|----------|------|------|
| Anthropic | `anthropic` | x-api-key header |
| OpenAI | `openai` | Bearer token |
| Google Gemini | `google` | API key in URL |
| Ollama | `ollama` | None (local) |
| AWS Bedrock | `bedrock` | SigV4 (native crypto, zero deps) |
| OpenAI-compatible | `openai_compatible` | Bearer token + custom baseUrl |

## Orchestrator Roles

| Role | Tiers | Interval | Key Behavior |
|------|-------|----------|-------------|
| advisor | message | 30s | Suggestive, respects autonomy |
| puppeteer | plan+message | 15s | Tactical multi-step plans |
| god | genome | 15s | Silent instinct reshaping |
| darwinist | all | 10s | Cold optimization, metrics-driven |
| parent | plan+message | 15s | 4 phases: infant→child→adolescent→adult |
| chaos_demon | all | 15s | Entropy maximizer, contradictions |

## Spec Documents (docs/)
- `SIMULATION.md` — Original design document
- `PROGRESSION.md` — Stats, skills, XP, nutrition, death/respawn
- `ANIMALS.md` — 20 species, utility AI, awareness, breeding, taming
- `CRAFTING.md` — Items, recipes, tools, structures, inventory, iron
- `AGENT_MEMORY.md` — Behavior Genome, Life Journal, Lives Economy, LLM Evolution
- `AGENT_API.md` — REST API (observation, message, plan, genome patch, SSE, webhooks)
- `CHANGEREQ_LLM_ROLES.md` — Orchestrator role system (6 roles, timer-based polling)
- `LEFT_SIDEBAR.md` — God overview panel (power scores, agent rows)
- `LLM_PROMPTS.md` — All role prompts compiled
- `prompts/` — Individual role prompts: advisor, puppeteer, god, darwinist, parent, chaos_demon
- `RESOURCE_BALANCE.md`, `DROPS_AND_MATERIALS.md`, `CHANGEREQ_METABOLISM.md`, `CHANGEREQ_ANIMALS.md`, `CHANGEREQ_DROPS_MATERIALS.md`, `GAP_ANALYSIS.md`
