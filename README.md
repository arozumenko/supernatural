# Supernatural

A server-authoritative AI agent civilization simulator. Autonomous agents with needs, personalities, stats, and learnable skills inhabit a procedurally generated tile world alongside 20 animal species forming a complete food chain. External LLMs can observe, instruct, and evolve agents through a REST API — each playing a distinct "god" role.

## Quick Start

### Prerequisites

- Node.js 18+
- An LLM API key (Anthropic or OpenAI) — optional, game runs without LLMs

### 1. Install

```bash
npm run install:all
```

### 2. Configure LLM Providers (optional)

Copy the example config and edit it with your API keys:

```bash
cp server/llm-providers.example.json server/llm-providers.json
```

Then edit `server/llm-providers.json` — keep only the providers you want to use. See below for all supported providers.

#### Supported Providers

**Anthropic Claude** (`"provider": "anthropic"`)
```json
{
  "id": "claude-sonnet",
  "label": "Claude Sonnet",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5-20250514",
  "apiKey": "$ANTHROPIC_API_KEY",
  "maxTokens": 4096,
  "temperature": 0.7,
  "timeout": 15000,
  "maxConcurrent": 3,
  "rateLimitPerMinute": 20
}
```

**OpenAI GPT** (`"provider": "openai"`)
```json
{
  "id": "gpt-4o",
  "label": "GPT-4o",
  "provider": "openai",
  "model": "gpt-4o",
  "apiKey": "$OPENAI_API_KEY",
  "maxTokens": 4096,
  "temperature": 0.7,
  "timeout": 15000,
  "maxConcurrent": 3,
  "rateLimitPerMinute": 20
}
```

**Google Gemini** (`"provider": "google"`)
```json
{
  "id": "gemini-flash",
  "label": "Gemini Flash",
  "provider": "google",
  "model": "gemini-2.0-flash",
  "apiKey": "$GOOGLE_API_KEY",
  "maxTokens": 4096,
  "temperature": 0.7,
  "timeout": 15000,
  "maxConcurrent": 3,
  "rateLimitPerMinute": 20
}
```

**Ollama** (`"provider": "ollama"`) — local inference, no API key needed
```json
{
  "id": "ollama-llama",
  "label": "Ollama Llama 3.1",
  "provider": "ollama",
  "model": "llama3.1",
  "apiKey": "",
  "baseUrl": "http://localhost:11434",
  "maxTokens": 4096,
  "temperature": 0.7,
  "timeout": 30000,
  "maxConcurrent": 1,
  "rateLimitPerMinute": 10
}
```

**Any OpenAI-compatible API** (`"provider": "openai_compatible"`) — works with vLLM, Together, LM Studio, Groq, Mistral, DeepSeek, etc.
```json
{
  "id": "together-mixtral",
  "label": "Together Mixtral",
  "provider": "openai_compatible",
  "model": "mistralai/Mixtral-8x7B-Instruct-v0.1",
  "apiKey": "$TOGETHER_API_KEY",
  "baseUrl": "https://api.together.xyz/v1",
  "maxTokens": 4096,
  "temperature": 0.7,
  "timeout": 15000,
  "maxConcurrent": 3,
  "rateLimitPerMinute": 20
}
```

#### Config Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier used internally |
| `label` | Yes | Display name shown in the game UI |
| `provider` | Yes | One of: `anthropic`, `openai`, `google`, `ollama`, `openai_compatible` |
| `model` | Yes | Model name (provider-specific) |
| `apiKey` | Yes | API key, or `$ENV_VAR` to read from environment. Empty string for Ollama. |
| `baseUrl` | No | Custom API endpoint. Required for `ollama` and `openai_compatible`. |
| `maxTokens` | Yes | Maximum response tokens |
| `temperature` | Yes | Sampling temperature (0.0-2.0) |
| `timeout` | Yes | Request timeout in milliseconds |
| `maxConcurrent` | Yes | Max parallel requests to this provider |
| `rateLimitPerMinute` | Yes | Max requests per minute |

You can configure multiple providers simultaneously — each agent can be assigned a different LLM on the start screen.

### 3. Run

```bash
npm run dev
```

This starts:
- **Server** on `http://localhost:3001` (Express + Socket.IO, game simulation at 10 ticks/sec)
- **Client** on `http://localhost:5173` (Phaser 3 browser UI)

Open the client URL in your browser.

### 4. Start a Game

The **Start Game** screen lets you configure:

| Setting | Options | Default |
|---------|---------|---------|
| Map Size | Small / Medium / Large | Medium (120x90) |
| Agents | 3-20 | 8 |
| Water | 10-40% | 20% |
| Trees | Sparse / Normal / Dense | Normal |
| Animals | Low / Normal / High | Normal (200) |

#### Agent AI Assignment

Below the world settings, the **AGENT AI** section shows one row per agent. For each agent you can assign:

- **LLM Provider** — cycle through configured providers or "No LLM" (decision tree only)
- **Role** — the orchestrator role that defines how the LLM interacts with the agent

If no LLM is assigned, agents use the built-in decision tree (GOAP planner + need-based priorities). They still evolve via rule-based fallback mutations on death.

Click **START GAME** to begin.

---

## LLM Orchestrator Roles

Each LLM-controlled agent is managed by an orchestrator that polls the agent's state on a timer and calls the LLM with a role-specific system prompt. The LLM responds with structured JSON actions.

| Role | Tiers | Interval | Philosophy |
|------|-------|----------|------------|
| **Advisor** | Message only | 30s | Quiet voice. Suggests, never commands. Respects agent autonomy. |
| **Puppeteer** | Plan + Message | 15s | Tactical commander. Issues structured action sequences. |
| **God** | Genome only | 15s | Silent hand. Reshapes instincts without the agent's knowledge. |
| **Darwinist** | All tiers | 10s | Cold optimizer. Maximizes survival metrics through data-driven intervention. |
| **Parent** | Plan + Message | 15s | Nurturing. Teaches then lets go as agent gains skills. 4 developmental phases. |
| **Chaos Demon** | All tiers | 15s | Entropy agent. Makes things interesting, not optimal. |

### Three Tiers of Control

1. **Message** — Natural language sent to the agent. The agent may follow or ignore based on its `obedience` stat and personality.
2. **Plan** — Structured multi-step action sequence. The agent executes steps in order but can interrupt for survival.
3. **Genome Patch** — Direct modification of the agent's Behavior Genome (decision weights, thresholds, strategy rules). The agent never knows.

---

## Game UI

### Left Sidebar (260px)

God overview panel showing:
- **God cards** — Each LLM provider with assigned agents gets a card showing aggregate power score, role badge (color-coded), and provider label
- **Agent rows** — Under each god card: alive dot, name, total level, current action
- **Unassigned section** — Agents with no LLM at the bottom
- Click any agent row to pan the camera and select them

### Game Viewport (center)

Procedurally generated tile world with:
- Terrain: grass, water, sand, dirt, iron ore
- Entities: trees, rocks, plants (7 types), animals (20 species), corpses, structures
- Agents: animated sprites with name, action text, and needs bars
- WASD to pan, scroll to zoom, click to select

### Right Panel (380px)

Detailed info for the selected entity:
- **Agent**: needs bars, skills, inventory, equipment, metabolism, obedience, evolution stats (lives remaining, genome version, AI role, active strategy rules, Highlander badge)
- **Animal**: health, hunger, skills, drops, taming progress
- **Tree/Rock/Plant/Corpse/Structure**: relevant stats

---

## Agent Evolution System

Agents have **100 lives**. On death:

1. **Death cause detection** — 9-way classification (starvation protein/plant/both, dehydration, killed by animal/agent, exhaustion, poison)
2. **Life journal finalization** — Timeline, events, metrics, heatmap archived
3. **Lives calculation** — Base -1, +1 per 10 skill levels gained, +5/+10/+25 survival milestones
4. **Evolution** — LLM-assigned agents get async LLM call to rewrite their Behavior Genome. Non-LLM agents get rule-based fallback mutations.
5. **Respawn** — 30 seconds later with updated genome, preserved skills (5% XP rust)

When lives reach **0**, the agent is **permanently dead** (tombstone placed).

**Highlander**: An agent with 500+ total skill levels and 100,000+ tick survival becomes immortal.

---

## REST API

The server exposes a full REST API for LLM observation and instruction. Set `SUPERNATURAL_API_KEY=yourkey` env var to bootstrap a dev API key.

### Public Endpoints (no auth)

```
GET  /api/status                 → { alive, total, ticks }
GET  /api/llm-providers          → [{ id, label }]
```

### Authenticated Endpoints (Bearer token)

```
GET  /api/agents                 → List agents (supports ?alive=true&fields=id,name)
GET  /api/agents/:id/state       → LLM-optimized agent summary
GET  /api/agents/:id/genome      → Full Behavior Genome JSON
GET  /api/agents/:id/history     → Death history with journal summaries
GET  /api/world/summary          → World overview (population, resources, season)

POST /api/agents/:id/message     → Send natural language message
POST /api/agents/:id/plan        → Submit structured action plan
GET  /api/agents/:id/plan        → Plan status
DELETE /api/agents/:id/plan      → Cancel plan
PATCH /api/agents/:id/genome     → JSON Patch on Behavior Genome

GET  /api/agents/:id/stream      → SSE event stream
POST /api/keys                   → Create API key
GET  /api/keys                   → List keys
DELETE /api/keys/:id             → Revoke key
```

### Example: Observe an Agent

```bash
export API_KEY=yourkey
curl -H "Authorization: Bearer $API_KEY" http://localhost:3001/api/agents
curl -H "Authorization: Bearer $API_KEY" http://localhost:3001/api/agents/abc123/state
```

### Example: Send a Message

```bash
curl -X POST -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "There is water to your east", "urgent": false}' \
  http://localhost:3001/api/agents/abc123/message
```

---

## Architecture

```
supernatural/
  shared/src/          → Types shared between server & client
    index.ts           → World constants, AgentState, GameConfig, OrchestratorRole
    genome.ts          → BehaviorGenome, StrategyRule, GENOME_BOUNDS
    journal.ts         → LifeJournal, DeathCause, LifeMetrics
    api-types.ts       → ActionPlan, AgentSummary, LLMResponse, ApiKey
  server/src/
    index.ts           → Express + Socket.IO server, orchestrator wiring
    GameLoop.ts        → 10Hz simulation tick, death/respawn, journal sampling
    Agent.ts           → Agent factory with genome, lives, journal
    World.ts           → Procedural generation, entity management, A* pathfinding
    ai/
      NeedsSystem.ts   → Genome-driven decision engine (interrupts → plans → GOAP → fallbacks)
      GOAPPlanner.ts   → Goal-Oriented Action Planning with genome weights
      AnimalAI.ts      → 20-species utility AI with awareness system
      BehaviorGenome.ts→ Default genome, validation, safety bounds
      LifeJournal.ts   → Journal recording, death detection, metrics
      LivesEconomy.ts  → Lives calculation, achievements, Highlander
      FallbackEvolution.ts → Rule-based mutations per death cause
      StrategyRules.ts → Condition/effect evaluation engine
      EvolutionQueue.ts→ Async LLM evolution on death
      LLMClient.ts     → HTTP client for Anthropic/OpenAI/local
    orchestrator/
      OrchestratorLoop.ts → Per-agent timer, LLM call coordination
      LLMCaller.ts     → System+user message HTTP client
      ResponseParser.ts→ Parse LLM JSON, enforce role permissions
      roles.ts         → 6 role system prompts, user message builder
    api/
      routes.ts        → All REST endpoints
      middleware.ts     → Auth, rate limiting
      summary.ts       → buildAgentSummary(), buildWorldSummary()
      plan-executor.ts → Plan step evaluation in NeedsSystem
      json-patch.ts    → RFC 6902 JSON Patch
      key-store.ts     → In-memory API key store
      rate-limiter.ts  → Sliding window rate limiter
    config/
      llm-config.ts    → Load llm-providers.json
  client/src/
    scenes/
      MainMenuScene.ts → Start screen with world settings + agent AI assignment
      GameScene.ts     → Tile world rendering, camera, entity sprites, selection
      UIScene.ts       → Left sidebar (god cards), right panel (selection detail), event log
    network/
      SocketClient.ts  → Socket.IO wrapper
    sprites/
      TileGenerator.ts → Procedural tile textures
```

## Commands

```bash
npm run install:all    # Install all dependencies
npm run dev            # Run server + client (dev mode)
npm run dev:server     # Server only (tsx watch, port 3001)
npm run dev:client     # Client only (vite, port 5173)
npm run build          # Build all (shared → server → client)
```

## Spec Documents

Design specs live in `docs/`:

| Doc | Description |
|-----|-------------|
| `SIMULATION.md` | Original design document |
| `PROGRESSION.md` | Stats, skills, XP, nutrition, death/respawn |
| `ANIMALS.md` | 20 species, utility AI, awareness, breeding, taming |
| `CRAFTING.md` | 52 items, 53 recipes, 4 material tiers |
| `AGENT_MEMORY.md` | Behavior Genome, Life Journal, Lives Economy, LLM Evolution |
| `AGENT_API.md` | REST API for LLM observation & instruction |
| `CHANGEREQ_LLM_ROLES.md` | Orchestrator role system (6 roles) |
| `LEFT_SIDEBAR.md` | God overview panel spec |
| `LLM_PROMPTS.md` | All LLM orchestrator role prompts |
