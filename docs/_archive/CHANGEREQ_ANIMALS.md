# Change Request: ANIMALS.md Implementation Gaps

**Status:** Pending
**Depends on:** PROGRESSION.md (base stats), DROPS_AND_MATERIALS.md (material types)
**Scope:** `server/src/ai/AnimalAI.ts`, `server/src/AnimalSpeciesConfig.ts`, `server/src/GameLoop.ts`, `server/src/ai/NeedsSystem.ts`

---

## Critical Gap: Awareness System

The single biggest issue in the current implementation is that **animals and agents exist in separate perception worlds**. Animals cannot see, target, or react to agents at all. Agents have limited awareness of animals but it's hardcoded and one-directional. This section designs the unified awareness system that replaces both.

### The Problem Today

| Interaction | Status | Where |
|---|---|---|
| Animal sees animal threat | ✅ Works | `AnimalAI.findThreats()` — checks `otherSpec.hunts.includes(mySpecies)` |
| Animal hunts animal prey | ✅ Works | `AnimalAI.findPrey()` — checks `mySpec.hunts.includes(otherSpecies)` |
| Animal sees agent | ❌ Missing | `findThreats()` and `findPrey()` only iterate `allAnimals[]` |
| Animal hunts agent | ❌ Missing | No species has `'agent'` in `hunts[]` array |
| Animal flees from agent | ❌ Missing | No code path exists |
| Agent sees animal threat | ⚠️ Hardcoded | `NeedsSystem.ts:119` — tier check, fixed 6-tile range |
| Agent hunts animal | ⚠️ Limited | `NeedsSystem.ts:236` — only small_prey/medium_herb, health<60 filter |
| Agent flees from animal | ⚠️ Crude | Flee direction is `(agent - animal) * 2`, no pathfinding |
| Animal reacts to agent attack | ❌ Missing | Animals don't know they're being attacked by agents |

### Design: Three-Sense Awareness

Every living entity (animal or agent) detects others through three channels. Each sense returns a list of detected entities with a confidence score (0–1).

#### 1. Sight

Primary detection method. Works during daytime for all entities, reduced at night.

```
sight_range = species.detectionRange (animals) or perception * 0.8 (agents)
sight_cone  = 120° centered on facing direction

detect(target):
  d = distance(self, target)
  if d > sight_range: return 0
  if not in sight_cone: return 0
  // Larger targets are easier to spot
  size_mod = target.size / 3  // size 1-5, so 0.33-1.67
  // Movement makes targets visible
  move_mod = target.isMoving ? 1.2 : 0.7
  return clamp((1 - d / sight_range) * size_mod * move_mod, 0, 1)
```

**Simplification for v1:** Skip the cone — use omnidirectional sight. Add facing direction in a later pass.

#### 2. Smell

How predators know there's meat in other beings. Smell propagates through tiles regardless of line of sight.

```
smell_range = species.detectionRange * 1.5 (carnivores/omnivores only)

// Every living entity emits a meat smell proportional to its body size
base_smell(entity):
  if entity is animal: return species.drops.meat / 20  // meat 2-15 → 0.1-0.75
  if entity is agent:  return 0.3  // agents always smell like ~6 units of meat

// Agents carrying raw meat smell stronger
carry_smell(agent):
  return agent.inventory.meat_carried / 20  // per DROPS_AND_MATERIALS.md

total_smell(entity) = base_smell(entity) + carry_smell(entity if agent)

detect(target):
  d = distance(self, target)
  effective_range = smell_range * total_smell(target)
  if d > effective_range: return 0
  // Wind direction could be added later — skip for v1
  return clamp((1 - d / effective_range) * total_smell(target), 0, 1)
```

**This answers concern #1: "How predators know meat is in other beings."** Every living entity has a `base_smell` derived from its meat drop value. A bear with `smell_range = 18` can detect a deer (`meat: 8`, smell = 0.4) at `18 * 0.4 = 7.2 tiles`. An agent (`smell = 0.3 + carried_meat/20`) becomes more detectable as they carry more raw meat. A wolf pack smells a meat-laden agent from further away than an empty-handed one.

#### 3. Sound

How prey and agents know a predator is nearby before they see it. Large predators make noise when moving.

```
sound_range = 8 (base, omnidirectional)

// Predators make noise proportional to size
noise(entity):
  if entity is animal:
    if moving: return species.size * 0.3
    if hunting/fighting: return species.size * 0.5
    else: return 0
  if entity is agent:
    if chopping/mining/building: return 0.6  // tool use is loud
    if moving: return 0.2
    else: return 0

detect(target):
  d = distance(self, target)
  effective_range = sound_range * noise(target)
  if d > effective_range: return 0
  return clamp((1 - d / effective_range), 0, 1)
```

**This answers concern #2: "How prey/agents know predators should be avoided."** A bear (`size: 5`) moving through the forest emits `noise = 5 * 0.3 = 1.5`, audible at `8 * 1.5 = 12 tiles`. A rabbit doesn't need to know bears are predators from a config list — it hears something large crashing through brush and its flee utility spikes. Conversely, a stalking wolf (`size: 4, idle`) emits `noise = 0`, so it can ambush prey that hasn't seen or smelled it yet.

### Combined Awareness Score

```
awareness(self, target) = max(sight, smell, sound)

// Used in utility calculations:
threat_utility  = awareness(self, threat)  * threat_danger_score
prey_utility    = awareness(self, prey)    * hunger_score
flee_urgency    = awareness(self, threat)  * (1 - self.health/100) * threat_danger_score
```

Entities with `awareness = 0` of each other don't interact. This replaces all hardcoded species lookups.

### Threat Classification (replaces hardcoded tier checks)

Instead of checking `hunts.includes(species)`, entities evaluate **danger** from perceived entities:

```
danger_score(self, other):
  if other.attack > self.defense * 1.5: return 0.9  // much stronger
  if other.attack > self.defense:       return 0.6  // stronger
  if other.attack > self.defense * 0.5: return 0.3  // roughly equal
  return 0.1                                         // weaker

// Prey animals have an instinct bonus for known predator species
if self is animal AND other.species in species.fearedBy:
  danger_score *= 1.5
```

The `fearedBy` list (new field) captures evolutionary knowledge — deer instinctively fear wolves even before being attacked. But it's a **bonus**, not a gate. An agent wielding an iron sword (`attack: 45`) triggers high danger_score on any animal through stats alone, no species list needed.

---

## Change 1: Expand `findThreats()` and `findPrey()` to include agents

**File:** `server/src/ai/AnimalAI.ts` lines 115-165

Currently both functions only iterate `allAnimals[]`. They need a second parameter for agents.

```diff
 function findThreats(
   animal: AnimalState,
   species: AnimalSpecies,
   allAnimals: AnimalState[],
+  allAgents: AgentState[],
   tickCount: number
 ): { entity: AnimalState | AgentState; dist: number; type: 'animal' | 'agent' }[] {
-  const threats: { animal: AnimalState; dist: number }[] = [];
+  const threats: { entity: AnimalState | AgentState; dist: number; type: 'animal' | 'agent' }[] = [];

   // existing animal threat detection...

+  // Agents as threats: agents who recently attacked this animal,
+  // or agents wielding weapons (high effective attack stat)
+  for (const agent of allAgents) {
+    if (!agent.alive) continue;
+    const awareness = computeAwareness(animal, species, agent);
+    if (awareness === 0) continue;
+    const dangerScore = computeDangerScore(animal, species, agent);
+    if (dangerScore > 0.3) {
+      threats.push({ entity: agent, dist: distance(...), type: 'agent' });
+    }
+  }
 }
```

```diff
 function findPrey(
   animal: AnimalState,
   species: AnimalSpecies,
   allAnimals: AnimalState[],
+  allAgents: AgentState[]
 ): { entity: AnimalState | AgentState; dist: number; type: 'animal' | 'agent' } | null {
   // existing animal prey detection...

+  // Agents as prey: only if species hunts 'agent' AND smell/sight detects them
+  if (species.hunts.includes('agent')) {
+    for (const agent of allAgents) {
+      if (!agent.alive) continue;
+      const awareness = computeAwareness(animal, species, agent);
+      if (awareness === 0) continue;
+      const d = distance(animal.x, animal.y, agent.x, agent.y);
+      // Prefer weaker/injured agents (opportunistic predation)
+      const preyScore = (1 - agent.needs.health / 100) * awareness;
+      if (preyScore > 0.3 && (!best || d < best.dist)) {
+        best = { entity: agent, dist: d, type: 'agent' };
+      }
+    }
+  }
 }
```

---

## Change 2: Add `'agent'` to predator `hunts` arrays

**File:** `server/src/AnimalSpeciesConfig.ts`

Currently no species has `'agent'` in their hunts list. Predators that would realistically hunt humans need it added, but with lower priority than natural prey (agents are risky targets).

```diff
 // Bear
-hunts: ['deer', 'pig', 'rabbit'],
+hunts: ['deer', 'pig', 'rabbit', 'agent'],

 // Wolf
-hunts: ['deer', 'rabbit', 'sheep', 'pig', 'chicken'],
+hunts: ['deer', 'rabbit', 'sheep', 'pig', 'chicken', 'agent'],

 // Alligator
-hunts: ['deer', 'pig', 'duck'],
+hunts: ['deer', 'pig', 'duck', 'agent'],

 // Mountain Lion
-hunts: ['deer', 'rabbit', 'goat', 'sheep'],
+hunts: ['deer', 'rabbit', 'goat', 'sheep', 'agent'],
```

Mid-predators (fox, coyote, hawk) should **not** hunt agents — they're too small and agents aren't worth the risk. They should still flee from agents though (via the danger_score system).

### New `fearedBy` field

Add to AnimalSpecies config to encode evolutionary threat knowledge:

```typescript
// Deer, rabbit, sheep, etc.
fearedBy: ['wolf', 'bear', 'mountain_lion', 'coyote', 'fox', 'hawk', 'eagle']

// All small prey
fearedBy: ['fox', 'coyote', 'hawk', 'eagle', 'wolf']
```

This is a **hint** to the awareness system, not a hard gate. Animals can still flee from entities not in `fearedBy` if the danger_score is high enough.

---

## Change 3: Replace GameLoop.ts predator splash damage with proper combat

**File:** `server/src/GameLoop.ts` lines 246-262

The current code is a hack: when an animal is already hunting another animal and happens to be within 2 tiles of an agent, it deals `attack * 0.3 * 0.1` (= 3% of base attack) to the agent. This means:
- A bear (attack 35) does 1.05 damage per tick to a nearby agent — barely noticeable
- The animal never actually *targets* the agent
- The animal doesn't change its behavior after "attacking"

**Replace with:** Animals that have targeted an agent through `findPrey()` should enter proper combat using the same stat-based damage formula agents use (from `NeedsSystem.ts:564-587`):

```diff
-    // Predator attacks on agents
-    for (const animal of this.world.animals) {
-      if (!animal.alive) continue;
-      if (animal.action !== 'hunting' && animal.action !== 'fighting') continue;
-      ...
-      agent.needs.health = clamp(agent.needs.health - damage * 0.1, 0, 100);
-    }

+    // Animal-Agent combat (symmetric with agent-animal combat)
+    for (const animal of this.world.animals) {
+      if (!animal.alive) continue;
+      if (animal.action !== 'hunting' && animal.action !== 'fighting') continue;
+      if (!animal.targetEntityId) continue;
+
+      // Find target — could be agent or animal
+      const targetAgent = this.agents.find(a => a.id === animal.targetEntityId);
+      if (!targetAgent || !targetAgent.alive) continue;
+
+      const d = distance(animal.x, animal.y, targetAgent.x, targetAgent.y);
+      if (d > 1.5) continue; // must be adjacent
+
+      const species = getSpecies(animal.species);
+      const agentDefense = getEffectiveStat(targetAgent, 'toughness');
+      const damage = Math.max(1, species.attack - agentDefense * 0.3);
+      targetAgent.needs.health = clamp(targetAgent.needs.health - damage * 0.1, 0, 100);
+
+      // Agent should become aware they're being attacked
+      targetAgent.lastAttackedBy = { type: 'animal', id: animal.id, tick: this.tickCount };
+    }
```

### New field: `targetEntityId` on AnimalState

Animals need to track what they're targeting, whether it's an animal or an agent:

```diff
 export interface AnimalState {
   // ...existing fields...
+  targetEntityId?: string;  // id of animal OR agent being hunted/fought
+  targetEntityType?: 'animal' | 'agent';
 }
```

---

## Change 4: Upgrade agent flee logic in NeedsSystem.ts

**File:** `server/src/ai/NeedsSystem.ts` lines 119-138

Current flee logic is hardcoded: check if any apex/mid_predator is within 6 tiles, flee in the opposite direction with priority 92. Problems:
- Fixed 6-tile range ignores perception stat
- No consideration of agent's combat ability (a high-level agent with iron sword shouldn't flee from a fox)
- Only checks tier, not actual threat level
- Flee direction is raw vector math, not pathfinded

**Replace with awareness-based threat evaluation:**

```diff
-  // --- Flee from dangerous animals nearby ---
-  for (const animal of world.animals) {
-    if (!animal.alive) continue;
-    const species = getSpecies(animal.species);
-    if (species.tier === 'apex' || (species.tier === 'mid_predator' && species.attack > 15)) {
-      const dist = distance(agent.x, agent.y, animal.x, animal.y);
-      if (dist < 6) {
-        ...flee with priority 92...
-      }
-    }
-  }

+  // --- Evaluate threats from all nearby animals ---
+  for (const animal of world.animals) {
+    if (!animal.alive) continue;
+    const species = getSpecies(animal.species);
+    const dist = distance(agent.x, agent.y, animal.x, animal.y);
+    const detectRange = getEffectiveStat(agent, 'perception') * 0.8;
+    if (dist > detectRange) continue;
+
+    // Sound detection — hear large moving predators beyond sight range
+    const noise = species.size * (animal.action === 'hunting' ? 0.5 : 0.3);
+    const soundRange = 8 * noise;
+    const canHear = dist <= soundRange && noise > 0;
+
+    if (dist > detectRange && !canHear) continue;
+
+    // Evaluate danger: compare animal's attack to agent's defense
+    const agentCombat = getEffectiveStat(agent, 'strength');
+    const agentDefense = getEffectiveStat(agent, 'toughness');
+    const dangerRatio = species.attack / Math.max(1, agentDefense);
+
+    // High-level combat agents don't flee from weak threats
+    if (dangerRatio < 0.5) continue;
+
+    // Flee priority scales with danger and proximity
+    const proximityUrgency = 1 - (dist / detectRange);
+    const fleePriority = Math.floor(60 + (dangerRatio * proximityUrgency * 35));
+
+    // Was recently attacked? Extra urgency
+    if (agent.lastAttackedBy?.type === 'animal' && agent.lastAttackedBy.id === animal.id) {
+      fleePriority = Math.min(fleePriority + 20, 98);
+    }
+
+    decisions.push({
+      action: 'fleeing',  // new action type
+      priority: clamp(fleePriority, 60, 98),
+      target: computeFleeTarget(agent, animal, world),
+      reason: `threatened by ${species.name} (danger: ${dangerRatio.toFixed(1)})`
+    });
+  }
```

---

## Change 5: Expand agent hunting to all edible animals

**File:** `server/src/ai/NeedsSystem.ts` lines 236-264

Current hunting only targets `small_prey` and `medium_herb` with `health < 60`. This is too restrictive:
- Agents can't hunt any mid_predator even if they're well-armed
- The `health < 60` check means agents only attack injured animals (no initiation)
- No risk assessment — a naked agent tries to hunt the same targets as an iron-armed warrior

**Replace with utility-scored hunting:**

```diff
-  if (effectiveHunger < 40 && agent.resources.food < 3) {
-    for (const animal of world.animals) {
-      ...only small_prey/medium_herb with health < 60...
-    }
-  }

+  if (agent.needs.proteinHunger < 50) {
+    for (const animal of world.animals) {
+      if (!animal.alive) continue;
+      const species = getSpecies(animal.species);
+      const dist = distance(agent.x, agent.y, animal.x, animal.y);
+      if (dist > 15) continue;
+
+      // Can I take this animal? Compare my combat to its defense/health
+      const myAttack = getEffectiveStat(agent, 'strength');
+      const meatValue = species.drops?.meat ?? 0;
+      if (meatValue === 0) continue;
+
+      const riskScore = species.attack / Math.max(1, myAttack);
+      const rewardScore = meatValue / 15;  // normalize to 0-1
+      const hungerUrgency = 1 - (agent.needs.proteinHunger / 100);
+
+      // Don't hunt things much stronger than us unless starving
+      if (riskScore > 1.5 && hungerUrgency < 0.7) continue;
+
+      const huntPriority = Math.floor(30 + (rewardScore * hungerUrgency * 30) - (riskScore * 10));
+
+      if (huntPriority > 30) {
+        decisions.push({
+          action: 'hunting',
+          priority: huntPriority,
+          target: { x: Math.floor(animal.x), y: Math.floor(animal.y) },
+          targetAnimalId: animal.id,
+          reason: `hunting ${species.name} (risk: ${riskScore.toFixed(1)}, meat: ${meatValue})`
+        });
+      }
+    }
+  }
```

---

## Change 6: Animal reacts to being attacked by agent

**File:** `server/src/ai/AnimalAI.ts`

Currently when an agent attacks an animal, the animal has no reaction. It continues whatever it was doing. Animals need an `attackedBy` memory that triggers fight-or-flight:

```typescript
// New field on AnimalState
lastAttackedBy?: { type: 'animal' | 'agent'; id: string; tick: number };

// In AnimalAI.decideAction(), add before other utility evaluations:
if (animal.lastAttackedBy && (tickCount - animal.lastAttackedBy.tick) < 50) {
  const attacker = findEntityById(animal.lastAttackedBy.id, allAnimals, allAgents);
  if (attacker && attacker.alive) {
    const d = distance(animal.x, animal.y, attacker.x, attacker.y);

    // Fight or flight based on species temperament and relative strength
    if (species.aggression > 0.5 && species.attack > 15) {
      // Fight back — predators and aggressive animals retaliate
      return {
        action: 'fighting',
        targetId: attacker.id,
        targetType: animal.lastAttackedBy.type,
        utility: 0.95  // very high — being attacked demands response
      };
    } else {
      // Flight — prey animals flee
      return {
        action: 'fleeing',
        fleeFrom: { x: attacker.x, y: attacker.y },
        utility: 0.95
      };
    }
  }
}
```

---

## Change 7: Pack/herd defensive behaviors

**File:** `server/src/ai/AnimalAI.ts`

Partially implemented: wolves have `packHunting` and `packHowl` behaviors. Missing:

- **Pack aggression toward agents:** When one wolf targets an agent, nearby packmates should join. Currently pack coordination only works for animal prey.
- **Herd alarm:** When one deer flees, nearby deer should also flee (sheep panic cascade exists but doesn't trigger from agent threats since animals can't see agents).
- **Mobbing:** Small animals in groups should mob predators. Crows/chickens near an agent taking their resources should become agitated, alerting nearby predators.

```typescript
// Pack aggression propagation
function propagatePackTarget(
  hunter: AnimalState,
  targetId: string,
  targetType: 'animal' | 'agent',
  allAnimals: AnimalState[]
) {
  const species = getSpecies(hunter.species);
  if (!species.flocking?.enabled) return;

  for (const packmate of allAnimals) {
    if (packmate.species !== hunter.species) continue;
    if (!packmate.alive || packmate.id === hunter.id) continue;
    const d = distance(hunter.x, hunter.y, packmate.x, packmate.y);
    if (d > species.flocking.neighborRadius) continue;

    // Packmate joins the hunt if not already busy with higher priority
    if (packmate.action === 'idle' || packmate.action === 'wandering') {
      packmate.targetEntityId = targetId;
      packmate.targetEntityType = targetType;
      packmate.action = 'hunting';
    }
  }
}
```

---

## Change 8: Taming system — skeleton exists, logic missing

**File:** `server/src/ai/AnimalAI.ts`

The code has `tameness`, `tamedBy`, and `tamingProgress` fields on AnimalState and checks like `if (animal.tameness > 0.5)` that modify flee behavior. But the taming *process* is missing:

- **No agent action to tame:** NeedsSystem.ts has no `taming` action type
- **No food offering:** Agents can't offer food to animals to build trust
- **No proximity habituation:** Being near an animal without attacking should slowly increase tameness
- **Tamed behavior incomplete:** Tamed animals follow their owner but don't help in combat, carry items, or defend

This is lower priority than the awareness system but should be spec'd for the next pass.

---

## Change 9: Scavenger behavior — config exists, unused

**File:** `server/src/AnimalSpeciesConfig.ts`

Several species have `isScavenger: true` (coyote, crow, vulture) and the ANIMALS.md spec describes scavengers being attracted to corpses. However:

- `AnimalAI.ts` has no corpse detection logic
- No `findNearestCorpse()` call from animal AI (only agents use this in NeedsSystem.ts)
- Scavenger animals should compete with agents for corpse resources

This connects directly to DROPS_AND_MATERIALS.md — once the corpse system is implemented, animals need to interact with it.

---

## Change 10: Egg laying — skeleton only

**File:** `server/src/ai/AnimalAI.ts`

The code has commented-out egg laying logic and species configs have `layEggs: true` for chickens and ducks. The spec describes eggs as a renewable food source. Currently no egg entities exist in the world.

Lower priority — implement after awareness system and corpse system are working.

---

## Implementation Order

```
Phase 1 — Awareness Foundation (enables all other phases)
  1. Add awareness computation functions (sight, smell, sound)
  2. Add targetEntityId/targetEntityType to AnimalState
  3. Add lastAttackedBy to both AnimalState and AgentState
  4. Add fearedBy to AnimalSpecies config
  5. Add 'agent' to apex predator hunts arrays

Phase 2 — Animal→Agent Interaction
  6. Expand findThreats() to include agents
  7. Expand findPrey() to include agents
  8. Replace GameLoop.ts splash damage with proper combat
  9. Add animal retaliation when attacked by agent

Phase 3 — Agent→Animal Upgrades
  10. Replace hardcoded flee logic with awareness-based evaluation
  11. Expand hunting to utility-scored risk/reward
  12. Add agent lastAttackedBy tracking for flee urgency

Phase 4 — Social Behaviors
  13. Pack aggression propagation toward agents
  14. Herd alarm from agent proximity
  15. Scavenger corpse competition

Phase 5 — Advanced (post-core)
  16. Taming system
  17. Egg laying
  18. Mobbing behavior
```

---

## Priority

Phase 1-2 are **critical** — without them, the food chain is one-directional and the core gameplay loop (agents surviving among dangerous wildlife) doesn't work. Phase 3 improves agent intelligence but the current hardcoded system is functional. Phase 4-5 are enhancements.
