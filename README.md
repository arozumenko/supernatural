# Supernatural

**An AI agent civilization simulator where LLMs play god.**

Autonomous agents with needs, personalities, and learnable skills struggle to survive in a procedurally generated world alongside 20 animal species. You assign LLMs as divine overseers — each playing a distinct "god" role — and watch civilizations emerge, collapse, and evolve.

Agents make their own decisions. Gods shape their fate. Evolution rewards what works.

---

## What Happens in a Game

1. **Agents spawn** into a tile world with water, forests, mountains, animals, and limited iron
2. **Each agent** has 7 needs (hunger, thirst, stamina, health, social, shelter, plant hunger), 6 base stats, 10 learnable skills, a personality, and 100 lives
3. **A decision engine** (the Behavior Genome) drives every choice — drink, eat, flee, hunt, build, craft, socialize, rest — 10 times per second
4. **20 animal species** form a food chain: apex predators (bears, tigers, alligators), pack hunters (wolves), herds (deer, cows), and small prey (rabbits, chickens)
5. **LLM gods** observe their agents on a timer and intervene — whispering advice, issuing tactical plans, or silently rewriting the agent's instincts
6. **When agents die**, their genome mutates based on what killed them. The LLM (or a fallback algorithm) rewrites their decision weights. They respawn with preserved skills but lost inventory
7. **After 0 lives**, permadeath. A results screen shows leaderboards, genome evolution charts, and LLM vs decision-tree comparisons

The question: **which god strategy produces the most resilient civilization?**

---

## Quick Start

### Prerequisites

- Node.js 18+
- An LLM API key (optional — the game runs fully without LLMs using built-in decision trees)

### Install & Run

```bash
npm run install:all          # install all dependencies
cp server/llm-providers.example.json server/llm-providers.json  # optional: configure LLMs
npm run dev                  # start server (3001) + client (5173)
```

Open `http://localhost:5173` in your browser. Configure world settings and agent AI assignments on the start screen, then click **START GAME**.

---

## The Six God Roles

Each LLM-controlled agent is managed by an orchestrator that periodically observes the agent and calls the LLM. The LLM responds with structured JSON actions. Each role has different powers and philosophies:

| Role | Powers | Interval | Philosophy |
|------|--------|----------|------------|
| **Advisor** | Message | 30s | A quiet voice. Suggests, never commands. Respects autonomy. |
| **Puppeteer** | Plan + Message | 15s | Tactical commander. Issues step-by-step action plans. |
| **God** | Genome Patch | 15s | Invisible hand. Reshapes instincts without the agent knowing. |
| **Darwinist** | All | 10s | Cold optimizer. Maximizes survival through data-driven intervention. |
| **Parent** | Plan + Message | 15s | Teaches then lets go. 4 phases: Infant, Child, Adolescent, Adult. |
| **Chaos Demon** | All | 15s | Agent of entropy. Makes things interesting, not optimal. |

### Three Tiers of Control

- **Message** — Natural language advice. The agent may follow or ignore based on its obedience score and personality traits.
- **Plan** — Structured multi-step action sequence (up to 5 steps). The agent executes faithfully but can interrupt for survival threats.
- **Genome Patch** — Direct JSON modification of the agent's decision weights, thresholds, and strategy rules. The agent never knows it changed.

---

## Agent Archetypes & Genomes

Each agent starts with a **Behavior Genome** — a JSON config that controls every decision. Six default genomes ship with the game, each with unique stat distributions and strategy rules:

| Genome | Stats Focus | Strategy Rules | Play Style |
|--------|-------------|---------------|------------|
| **Random** | Balanced (11 all) | Balanced Retreat | Jack of all trades |
| **Warrior** | STR+TGH | Bloodlust, Trophy Hunter, Stand Ground, Iron Rush | Hunts aggressively, fights everything |
| **Survivor** | END+TGH | Early Warning, Resource Hoarder, Cautious Healing, Shelter Seeker, Cook Everything | Stockpiles, flees early, plays it safe |
| **Builder** | STR+END | Lumber Focus, Quarry Focus, Build When Ready, Iron Seeker, Protect Investment | Gathers materials, builds settlements |
| **Scout** | AGI+PER | Forage on the Move, Early Escape, Wanderlust, Opportunistic Harvest | Explores far, travels light, flees fast |
| **Social** | CHA+PER | Seek Companions, Strength in Numbers, Animal Whisperer, Community Farmer, Flee When Alone | Befriends agents, tames animals |

### Custom Genomes

Drop `.json` files into `server/configs/genomes/` to create your own archetypes. Each genome file defines:
- `emoji` and `archetype` — displayed on the start screen
- `stats` — base stat distribution (6 stats totaling ~66)
- Interrupt weights, thresholds, goal weights, fallback priorities
- `strategyRules` — conditional behaviors (up to 15 rules)

Export winning genomes from the results screen and reuse them in future games.

---

## World & Survival

### Needs System (0-100, decay every tick)

| Need | Decay | Restored By | Critical At |
|------|-------|-------------|-------------|
| Protein Hunger | 0.06/tick | Meat, cooked meat, fish | < 30 |
| Plant Hunger | 0.06/tick | Berries, mushrooms, herbs | < 30 |
| Thirst | Constant | Drinking at water tile | < 30 |
| Stamina | Per action | Resting (+4.5/tick) | < 15 |
| Health | Damage-based | Resting, met needs, toughness | < 30 |
| Social | Slow decay | Interacting with agents | < 40 |
| Shelter | Exposure decay | Near structures (campfire, walls, tent) | < 30 |

Starvation deals -0.5 HP/tick per empty hunger bar (-1.5 if both empty). Dehydration deals -0.8 HP/tick. Exposure deals -0.15 HP/tick.

### Skills (10 skills, level 0-99)

Combat, Defense, Athletics, Woodcutting, Mining, Foraging, Building, Crafting, Survival, Social.

Skills improve by doing. XP uses diminishing returns: `level = floor(sqrt(xp / 50))`. Skills are **preserved across deaths** (minus 40% XP penalty) — the core reinforcement loop.

### Crafting Progression

52 items and 53 recipes across 4 material tiers:

**Hand** (bare) -> **Wood** (club, walls, campfire) -> **Stone** (axe, pickaxe, tools) -> **Bone/Hide** (bow, armor, rope) -> **Iron** (sword, shield, reinforced walls)

Iron is scarce: 15-20 deposits per world, never respawn. An agent with iron gear has a massive advantage.

### Death & Evolution

Agents start with **100 lives**. On death:

1. **9-way cause detection**: starvation (protein/plant/both), dehydration, killed by animal, killed by agent, exhaustion, poison, exposure
2. **40% XP penalty** + random stat -1 + inventory lost
3. **Genome mutation** — LLM rewrites behavior weights, or fallback rules mutate based on death cause (e.g., died of thirst -> raise thirst thresholds)
4. **Respawn** after 30 seconds at a random location with the evolved genome
5. **0 lives = permadeath** — tombstone placed, agent permanently removed

### Combat

- Damage scales with strength + combat skill + weapon + athletics
- Defense skill reduces incoming damage: `defense / (defense + 100)`
- Confidence system: agents assess threats before engaging
- Agent-vs-agent: disposition (friend/foe) decided on first meeting, persistent until death
- Cannibalism: starving agents hunt other agents as last resort; witnesses mark the cannibal as a permanent enemy
- Killing another agent grants massive XP + bonus lives + loot

### 20 Animal Species

| Tier | Species | Notable Behaviors |
|------|---------|-------------------|
| **Apex** | Bear, Tiger, Alligator | Territory patrol, ambush, water-edge hunting |
| **Mid Predator** | Fox, Cat, Dog/Wolf, Rat | Pack hunting, scavenging, nocturnal, swarming |
| **Large Herb** | Deer, Cow, Horse | Herding, sentinel alertness, stampede, fastest land speed |
| **Medium Herb** | Pig, Goat, Sheep, Donkey | Rooting, climbing, wool harvest, pack carrying |
| **Small Prey** | Rabbit, Chicken, Duck, Squirrel, Hedgehog, Capybara | Burrowing, egg laying, curl defense, semi-aquatic |

Animals use the same priority-based decision engine as agents, with species-specific weights.

---

## Game UI

### Left Sidebar
- **God cards** grouped by LLM provider — power score, role badge, agent count
- **Agent rows** — alive indicator, archetype emoji, name, level, lives, deaths, current action
- Click to pan camera + select agent

### Center Viewport
- Procedurally generated tile world with autotiled terrain
- Agents, animals, structures, resources rendered as sprites
- WASD to pan, scroll to zoom, click to select

### Right Panel
- Selected entity detail: needs bars (emoji), skills, inventory, equipment
- **Evolution section**: lives remaining, genome version, AI role, active strategy rules
- **Plan section**: current decision, active plan steps, debug reasoning

### Results Screen (after STOP GAME)
- **Agents tab**: leaderboard ranked by effectiveness
- **Animals tab**: top performer per tier
- **Best Genome tab**: score evolution chart + genome comparison table (mutations highlighted green/orange) + events timeline
- **LLM vs DT tab**: aggregate comparison of LLM-controlled vs decision-tree agents

---

## REST API

External LLMs can observe and control agents through the REST API. Set `SUPERNATURAL_API_KEY=yourkey` env var for a dev key.

### Public Endpoints

```
GET  /api/status              -> { alive, total, ticks, running }
GET  /api/llm-providers       -> [{ id, label }]
GET  /api/genomes             -> [{ id, label, emoji, archetype, description, stats, rules }]
```

### Authenticated Endpoints (Bearer token)

```
# Observation
GET  /api/agents              -> List all agents
GET  /api/agents/:id/state    -> LLM-optimized agent summary (~1-2KB)
GET  /api/agents/:id/genome   -> Full Behavior Genome JSON
GET  /api/agents/:id/history  -> Death history with journal summaries
GET  /api/world/summary       -> Population, resources, season, events

# Instruction
POST   /api/agents/:id/message  -> Send natural language message
POST   /api/agents/:id/plan     -> Submit structured action plan
GET    /api/agents/:id/plan     -> Current plan status
DELETE /api/agents/:id/plan     -> Cancel active plan
PATCH  /api/agents/:id/genome   -> JSON Patch on Behavior Genome

# Streaming
GET  /api/agents/:id/stream   -> SSE event stream (real-time agent events)

# Key Management
POST   /api/keys              -> Create API key
GET    /api/keys              -> List keys
DELETE /api/keys/:id          -> Revoke key

# Webhooks
POST   /api/webhooks          -> Register webhook
GET    /api/webhooks          -> List webhooks
DELETE /api/webhooks/:id      -> Delete webhook
```

### Example: Watch and Advise

```bash
export API_KEY=yourkey

# Observe agent state
curl -H "Authorization: Bearer $API_KEY" \
  http://localhost:3001/api/agents/abc123/state

# Send advice
curl -X POST -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "Water is 3 tiles east. Your thirst is dropping."}' \
  http://localhost:3001/api/agents/abc123/message

# Submit a tactical plan
curl -X POST -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "plan": {
      "name": "Emergency Hydration",
      "steps": [
        {"action": "drinking", "target": {"type": "nearest", "resourceType": "water"},
         "condition": {"type": "need_above", "field": "thirst", "value": 80}}
      ],
      "priority": 60, "expireAfterTicks": 500, "abandonOnDanger": true
    }
  }' \
  http://localhost:3001/api/agents/abc123/plan

# Patch genome (invisible instinct change)
curl -X PATCH -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "patches": [
      {"op": "replace", "path": "/thresholds/criticalThirst", "value": 35}
    ],
    "reason": "Agent keeps dying of thirst"
  }' \
  http://localhost:3001/api/agents/abc123/genome
```

---

## LLM Provider Configuration

Create `server/llm-providers.json` with an array of provider configs. Use `$ENV_VAR` syntax for API keys.

<details>
<summary><strong>Anthropic Claude</strong></summary>

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
</details>

<details>
<summary><strong>OpenAI GPT</strong></summary>

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
</details>

<details>
<summary><strong>Google Gemini</strong></summary>

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
</details>

<details>
<summary><strong>Ollama (local, no API key)</strong></summary>

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
</details>

<details>
<summary><strong>AWS Bedrock</strong></summary>

```json
{
  "id": "bedrock-claude",
  "label": "Bedrock Claude",
  "provider": "bedrock",
  "model": "anthropic.claude-sonnet-4-5-20250514-v1:0",
  "apiKey": "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY",
  "baseUrl": "us-east-1",
  "maxTokens": 4096,
  "temperature": 0.7,
  "timeout": 15000,
  "maxConcurrent": 3,
  "rateLimitPerMinute": 20
}
```
`apiKey` is `ACCESS_KEY:SECRET_KEY` (colon-separated). `baseUrl` is the AWS region. Uses Converse API with zero-dep SigV4 signing.
</details>

<details>
<summary><strong>OpenAI-compatible (vLLM, Together, Groq, LM Studio, etc.)</strong></summary>

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
</details>

You can configure multiple providers simultaneously. Each agent can use a different LLM on the start screen.

---

## Architecture

```
supernatural/
  shared/src/             Types shared between server & client
    index.ts              World constants, AgentState, GameConfig, OrchestratorRole
    genome.ts             BehaviorGenome, StrategyRule, GENOME_BOUNDS
    journal.ts            LifeJournal, DeathCause, LifeMetrics
    api-types.ts          ActionPlan, AgentSummary, LLMResponse, GameResults
  server/
    src/
      index.ts            Express + Socket.IO server (port 3001)
      GameLoop.ts         10Hz tick loop, death/respawn, evolution
      World.ts            Procedural generation, A* pathfinding, entity management
      Agent.ts            Agent factory with genome, lives, journal
      ai/
        NeedsSystem.ts    Genome-driven decision engine
        SharedDecisionEngine.ts  Unified survival/threat logic (agents + animals)
        GOAPPlanner.ts    Goal-Oriented Action Planning
        AnimalAI.ts       20-species utility AI
        BehaviorGenome.ts Default genome, validation, safety bounds
        StrategyRules.ts  Conditional behavior evaluation
        LifeJournal.ts    Death detection, journal recording
        FallbackEvolution.ts  Rule-based mutations per death cause
        EvolutionQueue.ts Async LLM evolution on death
      orchestrator/
        OrchestratorLoop.ts  Per-agent timer, LLM coordination
        LLMCaller.ts      HTTP client (6 providers, SigV4 for Bedrock)
        ResponseParser.ts JSON parsing, role permission enforcement
        roles.ts          6 role system prompts with full game rules
      api/                REST API (routes, auth, rate limiting, plan executor)
      config/             LLM provider + genome library loading
    configs/
      world-config.json   Game balance tuning (needs, combat, harvest, taming, etc.)
      genomes/            Default + custom genome JSON files (per-archetype behavior)
  client/src/
    scenes/
      MainMenuScene.ts    Start screen (world settings + agent AI config)
      GameScene.ts        Tile world rendering, camera, sprites
      UIScene.ts          Left sidebar, right panel, event log
      ResultsScene.ts     Leaderboard, genome comparison, charts
    network/
      SocketClient.ts     Socket.IO wrapper
```

## Configuration

All game balance is tunable via JSON files in `server/configs/` — no code changes needed.

### World Config (`server/configs/world-config.json`)

Controls every aspect of game balance:

| Section | What It Controls |
|---------|-----------------|
| `needs.decayRates` | How fast hunger, thirst, stamina, social, shelter drain per tick |
| `needs.restoreAmounts` | How much eating, drinking, resting, chatting restores |
| `needs.starvationDamage` | HP damage from empty hunger, thirst, stamina, shelter |
| `needs.healthRegen` | Healing rates (resting, passive, toughness, needs-met) |
| `combat` | Attack cooldowns, kill XP rewards, loot fractions, lives cap |
| `harvest` | Base wood/stone/plant/iron harvest amounts, skill bonuses |
| `plantNutrition` | Per-plant-type restore values (berry, mushroom, herbs, flowers) |
| `taming` | Max animals per agent, production interval, drop fractions |
| `alliance` | Max allies, relationship thresholds, resource sharing rules |
| `respawn` | Agent respawn delay, iron ore respawn interval |
| `activityMultipliers` | Metabolism scaling per action type (fighting burns 1.8x, resting 0.4x) |
| `trees/rocks/plants` | Growth rates, health, seed drop chances, regrowth rates |
| `animals` | Spawn counts per species, population thresholds, day/night cycle |
| `distribution` | Resource ratios (55% trees, 10% rocks, 10% berries, etc.) |

### Genomes (`server/configs/genomes/*.json`)

Each genome file defines an agent archetype's complete behavioral profile:

| Field | Purpose |
|-------|---------|
| `emoji`, `archetype` | Display identity on start screen |
| `stats` | Base stat distribution (STR, TGH, AGI, END, PER, CHA) |
| `interruptWeights` | Critical survival priorities (thirst, hunger, flee, fight) |
| `thresholds` | When needs trigger actions (critical thirst at 30, detect threats at 6 tiles) |
| `fallbackWeights` | Peaceful activity priorities (hunt 40, gather wood 35, socialize 30) |
| `goalWeights` | GOAP planning urgency per goal |
| `strategyRules` | Conditional behaviors (up to 15 rules with conditions + effects) |

### LLM Providers (`server/llm-providers.json`)

Array of LLM provider configs. See [LLM Provider Configuration](#llm-provider-configuration) above.

---

## Commands

```bash
npm run install:all    # Install all dependencies (root + shared + server + client)
npm run dev            # Run full dev environment (server + client)
npm run dev:server     # Server only (tsx watch, port 3001)
npm run dev:client     # Client only (vite, port 5173)
npm run build          # Build all (shared -> server -> client)
```

## Documentation

Full game documentation lives in `docs/game/` (MDX format):

| Document | Contents |
|----------|----------|
| [World & Survival](docs/game/world-and-survival.mdx) | Needs, biomes, seasons, resource cycle |
| [Agent System](docs/game/agent-system.mdx) | Stats, skills, archetypes, decision engine, death & evolution |
| [Animals](docs/game/animals.mdx) | 20 species, tiers, taming, pack behavior, food chain |
| [Combat](docs/game/combat.mdx) | Damage formulas, confidence, alliances, cannibalism |
| [Crafting & Building](docs/game/crafting-and-building.mdx) | 4 material tiers, 52 items, 53 recipes, structures |
| [LLM Gods](docs/game/llm-gods.mdx) | 6 orchestrator roles, control tiers, genome patching |
| [REST API](docs/game/rest-api.mdx) | Endpoints, authentication, plan/message/patch formats |
| [Configuration](docs/game/configuration.mdx) | World config, genomes, LLM providers |

### Design Specs (internal)

Original design specs in `docs/`:

| Spec | Purpose |
|------|---------|
| `SIMULATION.md` | Original world design document |
| `PROGRESSION.md` | Stats, skills, XP curves, nutrition |
| `ANIMALS.md` | Species design, utility AI |
| `CRAFTING.md` | Items, recipes, material tiers |
| `AGENT_MEMORY.md` | Genome, journal, lives economy |
| `AGENT_API.md` | REST API specification |
| `LLM_PROMPTS.md` | All role prompts compiled |
