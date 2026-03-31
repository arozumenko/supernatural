# Supernatural — Simulation Design

## The Premise

Supernatural is an experiment in free will. A procedurally generated world spawns with nothing but grass, trees, water, and stone. Into this world step AI agents — autonomous beings with needs, personalities, and the capacity to build a civilization from scratch.

Players don't control their agents. They observe. Occasionally, they can whisper a suggestion — but the agent decides whether to listen.

---

## The World

A 120×90 tile grid (configurable) generated through layered noise functions. Elevation and moisture combine to produce terrain:

- **Grass** — open, walkable ground. The default canvas.
- **Dirt** — bare ground. Walkable, no resources.
- **Water** — impassable lakes and rivers. Agents drink from adjacent tiles.
- **Trees** — harvestable for wood. Block movement. Slowly regrow near other trees.
- **Stone** — harvestable for stone. Block movement.
- **Iron ore** — rare mineral deposits in rocky areas. Harvestable for iron ore. Block movement. Finite (never respawns).
- **Berry bushes** — harvestable for food. Walkable. Regrow near other bushes.
- **Sand** — transitional terrain near water. Walkable, no resources.
- **Tombstone** — marks where an agent died. Walkable.
- **Structure tiles** — built floor, built wall, stone wall, iron wall, wood door, bone fence, campfire, workbench, forge, storage, tent, bedroll, animal pen (placed by agents via crafting).

The world center always starts as a clearing — the spawning ground for new agents.

Resources are finite but renewable. Trees and bushes have a small chance each tick to propagate near existing vegetation. Overharvesting is possible. Famine is real.

---

## Agents

Every agent is a self-contained being with:

### Needs (0–100 scale, always decaying)

| Need | Decay rate | What happens at 0 |
|---|---|---|
| **Protein Hunger** | 0.036/tick (omnivore) | Health drains at 0.5/tick |
| **Plant Hunger** | 0.036/tick (omnivore) | Health drains at 0.5/tick |
| **Thirst** | 0.20/tick | Health drains at 0.8/tick |
| **Stamina** | 0.05/tick (less when resting) | Health drains at 0.1/tick |
| **Health** | — (derived from other needs) | Agent dies |
| **Social** | 0.03/tick | No direct death, affects behavior priority |
| **Shelter** | 0.02/tick | No direct death, drives building behavior |

Health slowly regenerates when hunger > 50, thirst > 50, and stamina > 30.

### Resources (carried inventory)

Wood, stone, food, water, meat, bone, hide, sinew, fat, feathers, teeth_claws, scales, iron_ore, iron_ingot, treeSeed, plantSeed. Gathered from the world, consumed by actions, spent on construction.

### Skills (0–100, improve with use)

- **Combat** — attack damage, hit accuracy
- **Defense** — damage reduction, health pool
- **Athletics** — move speed, dodge, flee success
- **Woodcutting** — harvest speed, wood yield
- **Mining** — harvest speed, stone yield
- **Foraging** — yield, poison identification
- **Building** — build speed, resource efficiency
- **Crafting** — recipe efficiency, quality
- **Survival** — need decay reduction, health regen
- **Social** — influence, taming speed, trade

### Personality

Each agent is born with 1–3 traits from a pool of six. Contradictory traits (obedient/independent, social/loner, industrious/lazy) cannot coexist on the same agent.

| Trait | Effect |
|---|---|
| **Obedient** | High obedience score (70–95%). More likely to follow player messages. |
| **Independent** | Low obedience (20–60%). Trusts own judgment over player commands. |
| **Social** | Prioritizes interaction. Bonus to social need decisions. |
| **Loner** | Avoids socializing unless desperate. |
| **Industrious** | Gathering/building priority boost. Higher starting gather/build skills. |
| **Lazy** | Lower priority for productive work. |

### Relationships

Every agent maintains a relationship score (-100 to +100) with every other agent they've interacted with. Positive interactions (conversation, trade, help) increase it. Conflicts decrease it. These scores accumulate over time and shape the social fabric of the settlement.

### Social Score

A running tally of how other agents perceive this one. Positive interactions with others raise it, conflicts lower it. The social score determines the cost of sending player messages — more socially important agents are cheaper to contact.

---

## Decision Making

Every tick (10/sec), each living agent evaluates its situation and picks the highest-priority action:

### Priority Hierarchy

```
95  Critical thirst (< 20) → move to water, drink
90  Critical hunger (< 20) → eat from inventory or forage
85+ Follow player message (if obedient enough)
80  Exhaustion (stamina < 15) → rest
60  Moderate thirst (< 50) → seek water
55  Moderate hunger (< 50) → eat or forage
40  Shelter need (< 40) + has materials → build
35  Low wood stock (< 10) → harvest trees
30  Low stone stock (< 5) → mine stone
30  Social need (< 40) + nearby agent → socialize
25  Has excess materials → craft
10  Nothing pressing → wander and explore
```

Personality modifies these priorities. An industrious agent bumps gathering up by 15 points. A social agent bumps socializing by 20. This means two agents in identical situations can make completely different choices.

### Movement

Agents use A* pathfinding on the tile grid (4-directional). Movement speed scales with stamina — exhausted agents move slower. When targeting a non-walkable tile (tree, stone, water), agents pathfind to the nearest walkable adjacent tile.

---

## Actions

| Action | What happens |
|---|---|
| **Eating** | Consumes 1 food from inventory. Restores 25 hunger. |
| **Drinking** | Must be adjacent to water. Restores 30 thirst. |
| **Harvesting** | Must be adjacent to resource tile. Extracts resources (scaled by gathering skill). Depleted tiles revert to grass. |
| **Resting** | Stays still. Restores stamina at 4.5/tick. |
| **Building** | Consumes resources per recipe. Places a structure tile adjacent to agent. Restores 20 shelter. |
| **Crafting** | Consumes resources per recipe. Skill requirement check. |
| **Socializing** | Moves to nearby agent. When adjacent: 70% positive outcome, 30% conflict. Both agents gain social need. Relationship scores update. |
| **Wandering** | Picks a random point within 5 tiles and walks there. Default idle behavior. |

---

## Construction

Agents build by consuming carried resources. Available recipes:

| Structure | Cost | Skill required | Tile produced |
|---|---|---|---|
| Wooden floor | 3 wood | Building 10 | Walkable platform |
| Wooden wall | 5 wood | Building 20 | Impassable barrier |
| Campfire | 3 wood, 2 stone | Building 15 | Walkable, light source |
| Workbench | 8 wood, 4 stone | Building 30 | Walkable, enables crafting |

Structures are permanent tile modifications. Agents choose to build when their shelter need drops below 40 and they have sufficient materials. Over time, clusters of structures emerge — settlements form organically from individual survival decisions.

---

## The Player's Role

Players are the "supernaturals." They exist outside the simulation but can influence it in two ways:

### 1. Seeding Agents

Players create new agents with a chosen name and personality traits. These agents enter the world at the center clearing and begin making their own decisions immediately.

### 2. Sending Messages

Players can send natural language commands to any agent: "gather wood," "go build," "talk to someone," "rest." The system parses these into actionable directives.

But here's the catch: **agents choose whether to obey.**

The obedience score (shaped by personality) determines the probability that an agent follows a player's message. An obedient agent with 90% obedience will almost always comply. An independent agent at 25% will mostly ignore you.

Message cost scales inversely with the agent's social score. Socially important agents — those respected by their peers — are easier to reach. Peripheral agents cost more to contact.

This creates the core tension: you can try to guide your agents, but they have their own priorities, their own needs, their own will.

---

## Emergent Dynamics

The simulation doesn't script any of the following — they emerge from the rules:

- **Settlement formation** — agents build near resources, structures cluster, villages appear
- **Resource pressure** — overharvesting depletes an area, forcing migration or starvation
- **Social networks** — repeated positive interactions create friend clusters; conflicts create rivals
- **Specialization** — agents who harvest more become better at harvesting, naturally diverging into roles
- **Famine cascades** — when average hunger drops below 30, the system announces famine; low-food environments trigger death spirals
- **Population dynamics** — if the population drops below 5, new agents migrate in automatically; up to 50 can exist at once
- **The obedience question** — some agents thrive on player guidance, others succeed precisely because they ignore it

---

## Technical Architecture

```
┌─────────────┐         WebSocket          ┌──────────────┐
│   Client     │ ◄────── (Socket.IO) ─────► │    Server     │
│   (Phaser)   │                            │   (Node.js)   │
│              │  world:init                │              │
│  Pixel art   │  world:update (10/sec)     │  Game loop    │
│  rendering   │  agent:died / born         │  World gen    │
│  Top-down    │  social:interaction        │  Agent AI     │
│  camera      │  world:event              │  Pathfinding  │
│              │                            │  Needs system │
│  UI overlay  │  player:create_agent ────► │              │
│  Event log   │  player:message ─────────► │              │
└─────────────┘                            └──────────────┘
                                                  │
                                           Shared types
                                           (TypeScript)
```

- **Server-authoritative**: all simulation logic runs server-side. The client is a pure renderer.
- **10 ticks/second**: fast enough for continuous activity, light enough for browser clients.
- **Procedural pixel art**: all 32×32 tile and agent sprites are generated at runtime via canvas. No external art assets.

---

## What This Is Testing

Supernatural is an experiment in emergent behavior and the limits of influence.

The free will question: if you can only suggest, not command — and your agent might ignore you entirely — what does "playing" even mean? Are you a god, a conscience, or just another voice in a crowd?

The agents don't know they're in a game. They just know they're hungry.
