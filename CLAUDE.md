# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Supernatural is a server-authoritative AI agent civilization simulator with a full ecosystem. Autonomous agents with needs, personalities, base stats, and learnable skills inhabit a procedurally generated tile world alongside 20 animal species forming a complete food chain. Players observe and can influence (but not control) agents via messages.

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

Server status endpoint: `GET http://localhost:3001/api/status`

## Architecture

Monorepo with three packages: `shared/`, `server/`, `client/`. All TypeScript (ES modules, strict mode).

### shared/src/index.ts
Central type definitions shared between server and client. Contains:
- **World constants**: 120x90 tiles, 32px tile size, 10 ticks/sec, max 50 agents
- **TileType enum**: GRASS, WATER, TREE, STONE, BERRY_BUSH, SAND, DIRT, TREE_STUMP, ROCK_RUBBLE, BUILT_FLOOR, BUILT_WALL, CAMPFIRE, WORKBENCH, FORGE, STONE_WALL, IRON_WALL, WOOD_DOOR, BONE_FENCE, STORAGE, TENT, BEDROLL, ANIMAL_PEN, IRON_ORE
- **Resources**: wood, stone, food, water, seeds + 8 body materials (meat, bone, hide, sinew, fat, feathers, teeth_claws, scales) + iron_ore, iron_ingot
- **Progression types**: BaseStats (6 stats), SkillSet (10 skills with XP/level), SkillState
- **Dual nutrition**: AgentNeeds has proteinHunger + plantHunger (not single hunger)
- **Entity interfaces**: TreeState, RockState, PlantState (7 types), AnimalState (20 species), CorpseState, StructureState
- **Items & Inventory**: ItemDefinition, InventoryItem, Equipment (3 slots), Inventory
- **Animal types**: AnimalAction (15 states), AnimalSpecies (full config), PlantType (7 types)
- **Socket.IO event contracts**: world:init and world:update include agents, tiles, trees, rocks, plants, animals, corpses, structures

### server/src/
- **index.ts** — Express + Socket.IO server on port 3001. Broadcasts all entity types.
- **GameLoop.ts** — Central orchestrator at 10 ticks/sec. Processes agents, animals (staggered 1/5 per tick), breeding, corpse decay, structure decay, meat spoilage, respawn queues.
- **World.ts** — Procedural world generation with budget-based resource placement. Manages tile grid, entity systems (trees, rocks, plants, animals, corpses, structures), A* pathfinding support.
- **WorldConfig.ts** — All tunable generation parameters: water coverage (20%), terrain thresholds, nature budget (40% of land), resource distribution ratios, tree/rock/plant health values, animal spawn counts, population control, structure HP, iron deposits.
- **Agent.ts** — Agent factory with base stats, skill set, dual nutrition, inventory.
- **Progression.ts** — XP/leveling engine, effective stat calculators, combat formulas (attack damage, hit accuracy, damage reduction, dodge chance), speed calculations with weight penalty, harvest/build bonuses, metabolism helpers.
- **AnimalSpeciesConfig.ts** — All 20 animal species with stats, drops, breeding, taming, abilities, skill caps, flocking weights, awareness config.
- **ItemDefinitions.ts** — 52 item definitions (tools, weapons, armor, food, materials) with weights, stats, durability.
- **RecipeDefinitions.ts** — 53 crafting recipes across 4 tiers (hand → wood → stone → bone/iron) with station requirements and skill gates.
- **ai/NeedsSystem.ts** — Agent AI: metabolism-scaled need decay, priority-based decisions with awareness-based threat evaluation, utility-scored hunting, crafting/building with station checks, tool auto-equip, combat with accuracy/dodge, taming, trading.
- **ai/AnimalAI.ts** — Animal AI: utility scoring (quadratic/logistic curves), 3-sense awareness (sight/smell/sound), GOAP-lite decisions, metabolism scaling, breeding, special abilities (ambush/curl/howl/trample/steal/egg/seed/peace aura), flocking, pack behavior, attack cooldown combat with flee impulse.
- **ai/Pathfinding.ts** — A* pathfinding with excludeTiles support (doors block animals).

### client/src/
- **main.ts** — Phaser 3 config.
- **network/SocketClient.ts** — Socket.IO wrapper with full entity type support.
- **scenes/GameScene.ts** — Renders tiles, trees, rocks, plants, animals (20 species with walk animation), corpses, agents, tombstones. Camera controls, entity selection (agents > animals > trees > rocks > plants > corpses > structures > iron ore > water).
- **scenes/UIScene.ts** — Info panels for all selectable entities. Agent panel shows: dual nutrition bars, all 10 skill levels, inventory (resources + materials + equipped items), metabolism indicator, carry weight. Animal panel shows: health/hunger/thirst/stamina bars, skills, drops table, taming progress, breed cooldown. Also: tree, rock, plant, corpse, structure, water, iron ore panels.
- **sprites/TileGenerator.ts** — Autotile terrain renderer + procedural textures for all tile types including iron ore, forge, walls, doors, fences, storage, tent, bedroll, animal pen.

### Data Flow
1. Server runs simulation at 10 ticks/sec, broadcasts `world:update` with all entity states
2. Client receives updates, lerps positions, reconciles sprite maps
3. Player actions (`create_agent`, `message`) sent client→server, processed next tick
4. Agents respawn 30s after death at world center with preserved skills (5% XP rust)
5. Animals respawn based on breed cooldown if below population cap

## Key Systems

### Progression System (PROGRESSION.md)
- **6 base stats** (Strength, Toughness, Agility, Endurance, Perception, Charisma) — fixed at birth
- **10 skills** (Combat, Defense, Athletics, Woodcutting, Mining, Foraging, Building, Crafting, Survival, Social) — trained by doing
- **XP formula**: base_xp × difficulty_mod × diminishing_returns. Level = floor(sqrt(xp/50)), cap 99
- **Effective stats**: base + skill bonuses (capped at +99 per stat from all contributing skills)
- **Skill effects**: hit accuracy, damage reduction, dodge chance, speed bonus, harvest bonuses, building efficiency, need decay reduction, poison identification

### Dual Nutrition (protein + plant)
- Carnivores need protein only, herbivores need plants only, omnivores need both at 0.6x rate
- Agents are omnivores — must hunt AND forage
- Separate starvation damage per bar, 1.5x if both empty

### Metabolism Scaling (CHANGEREQ_METABOLISM.md)
- `metabolism = (1 + totalSkillLevels/500) × activityMultiplier`
- Scales hunger, thirst, stamina drain for both agents and animals
- Rest recovery inversely scaled — bigger beings recover slower
- Applies to all 15 animal action types

### Animal System (ANIMALS.md)
- **20 species** across 5 tiers with full food chain
- **3-sense awareness**: sight (range + movement), smell (meat-based), sound (size × action)
- **Utility AI** with quadratic/logistic response curves (not cliff-based priorities)
- **Special abilities**: ambush, curl, howl, trample, steal_food, egg_laying, seed_disperse, peace_aura
- **Breeding** with population caps, prey/predator balance
- **Taming** via food offering, multiple species tameable

### Drops & Materials (DROPS_AND_MATERIALS.md)
- 8 body material types from animal/agent corpses
- Per-species drop tables with randomization
- Corpse entities with 60s decay timer
- Scavenger behavior (bear, fox, rat, pig eat corpses)
- Smell mechanic (predators detect meat-carrying agents)

### Crafting System (CRAFTING.md)
- 4 material tiers: Hand → Wood → Stone → Bone/Hide → Iron
- 52 items, 53 recipes with station requirements and skill gates
- 3 equipment slots (mainHand, body, accessory) with passive bonuses
- Tool durability, weight-based carrying, auto-equip for tasks
- Iron ore (finite, 15-20 deposits, never respawns)

### Combat System
- **Attack cooldown**: 10 ticks (1 second) between attacks for all beings
- **Stat-based damage**: attackPower - targetDefense, with accuracy roll and dodge chance
- **Flee impulse**: surviving prey pushed 0.5 tiles away + forced into flee state
- **Speed-based pursuit**: predators give up if prey's flee speed exceeds chase speed
- **Agent self-defense**: agents fight back when attacked (priority 93)

### World Generation (WorldConfig.ts)
- **Pass 1**: Lakes (≥20% water coverage) via noise-distorted ellipses
- **Pass 2**: Sand beaches around water
- **Pass 3**: Dirt patches in dry elevated zones
- **Pass 4**: Sand widening for autotile transitions
- **Pass 5**: Water guarantee
- **Pass 6**: Budget-based vegetation (trees 55%, rocks 10%, plants 35% of nature budget)
- **Pass 7**: Iron ore deposits on dirt near rocks
- **Pass 8**: Center clearing for spawn area
- **Pass 9**: Animal spawning by species habitat

## Terrain Rendering (Client)

Sequential layer compositing with Pipoya autotile spritesheets (8×6 = 48 frames per variant):
1. **Grass** base (frame 14)
2. **Dirt** overlay (original Pipoya autotile)
3. **Sand** overlay
4. **Built floor** (masked autotile: dirt shape + floor texture)
5. **Water** overlay (on top)

`groundType(t)` maps object tiles to their underlying ground type for autotile calculations. IRON_ORE maps to DIRT; most objects map to GRASS.

### Entity Sprites
- Trees: 64×64 sprites (r2_c0, r2_c1 from BaseChip), stumps 32×32
- Rocks: 32×32 entity overlays on terrain (r8_c0 small, r8_c1 big, r8_c5 rubble)
- Plants: 7 types from BaseChip rows 6-7 (mushroom, poison, flower, stamina, hunger, bush, edible flower)
- Animals: 20 species in `assets/animals/{species}/0.png` and `1.png` (32×32, 2-frame animation)
- Tombstones: r8_c4 cross at agent death positions, 2-minute decay
- Corpses: r8_c4 cross with brown tint, 60s server-side decay

## Spec Documents (docs/)
- `SIMULATION.md` — Original design document
- `RESOURCE_BALANCE.md` — Resource distribution formula and food chain math
- `PROGRESSION.md` — Stats, skills, XP, nutrition, death/respawn
- `ANIMALS.md` — 20 species, utility AI, awareness, breeding, taming, abilities
- `DROPS_AND_MATERIALS.md` — Body materials, corpse system, scavenging, smell
- `CRAFTING.md` — Items, recipes, tools, structures, inventory, iron
- `CHANGEREQ_METABOLISM.md` — Metabolism scaling system
- `CHANGEREQ_ANIMALS.md` — Awareness system gaps and fixes
- `CHANGEREQ_DROPS_MATERIALS.md` — Iron ore, recipe cleanup
- `GAP_ANALYSIS.md` — Spec vs implementation gap tracking
- `CHANGEREQ_LLM_ROLES.md` — LLM orchestrator role system (wiring prompts + API into runtime)
- `AGENT_MEMORY.md` — Agent memory & evolution system (behavior genome, life journal, lives economy, LLM evolution loop)
- `AGENT_API.md` — Public REST API for LLM observation & instruction (3-tier: message, plan, genome patch)
- `LLM_PROMPTS.md` — All LLM orchestrator prompts in one file (reference copy)
- `prompts/` — Individual LLM orchestrator role prompts: Advisor, Puppeteer, God, Darwinist, Parent, Chaos Demon
- `LEFT_SIDEBAR.md` — Always-visible left panel showing god cards (LLM power) and agent rows
