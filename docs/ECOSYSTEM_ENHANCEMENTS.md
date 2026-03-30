# Ecosystem Enhancements

**Date:** 2026-03-29
**Status:** Approved directions, pending implementation
**Scope:** Stat unification, ecosystem sustainability, resource cycles

---

## Design Decisions (User-Approved)

1. **Stat Parity:** Fully unify — animals get randomized base stats within species range, skill caps removed, animals can train any skill like agents
2. **Feature Parity:** Role-based asymmetry — agents stay tool-users/builders, animals stay ecosystem creatures. Unify the math (combat/speed/defense formulas), keep different roles
3. **Ecosystem Loops:** Full cycle — decomposition, seed banking, seasonal cycles, carrying capacity
4. **Iron Ore:** Very slow respawn — ~1 new deposit every 30 real minutes

---

## Enhancement 1: Unified Stat System

### Problem

Agents and animals use fundamentally different stat calculations despite sharing the same `BaseStats` and `SkillSet` types:

| Aspect | Agent | Animal | Gap |
|---|---|---|---|
| Base stats | Random 5-15 | Species-derived, fixed | Animals are clones |
| Skill caps | None (99 max) | Species-capped (10-80) | Animals can't grow |
| Attack formula | `effectiveStrength × (0.8+rand×0.4) × weaponBonus/10` | `species.attack + combat×0.5` | Different math |
| Defense formula | `defense_level / (defense_level + 100)` (percentage) | `(health/20) + defense×0.3` (flat) | Different model |
| Speed formula | `(0.3 + stamina/200) × (1+athletics×0.005) / weightPenalty` | `species.speed × (1+athletics×0.005)` | Stamina vs fixed |
| Agent corpse | Fixed 6 meat | Randomized per species | Agents aren't in food chain |

### Changes

#### 1.1 — Randomize Animal Base Stats

Currently `createAnimalBaseStats()` derives deterministic stats from species config. Change to randomize within a species range.

**Current:**
```typescript
// Every bear is identical: STR 11, TGH 10, AGI 5, END 10, PER 8, CHA 3
strength = species.attack / 3;  // always 35/3 = 11
```

**Target:**
```typescript
// Each bear is unique within species band:
// STR 9-14, TGH 8-12, AGI 3-7, END 8-12, PER 6-10, CHA 2-5
function createAnimalBaseStats(species: AnimalSpecies): BaseStats {
  const variance = 0.3; // ±30% of species midpoint
  const rand = (mid: number) => Math.floor(mid * (1 - variance) + Math.random() * mid * variance * 2);
  return {
    strength: rand(species.attack / 3),
    toughness: rand(species.health / 20),
    agility: rand(species.speed * 20),
    endurance: rand(10),
    perception: rand(species.detectionRange),
    charisma: rand(socialMapping[species.social]),
  };
}
```

**Files:** `server/src/Agent.ts` (or wherever `createAnimalBaseStats` lives), `server/src/AnimalSpeciesConfig.ts`

#### 1.2 — Remove Animal Skill Caps

Remove `skillCaps` from species config. Animals can train any skill to 99 like agents — they'll just train slower because their environment provides less XP opportunity (a rabbit rarely fights, so its combat stays low naturally).

**Remove from AnimalSpeciesConfig.ts:** Delete all `skillCaps` entries.

**Remove from AnimalAI.ts:** Remove `skillCaps` parameter from all `awardXP()` calls. The `awardXP()` function in `Progression.ts` already caps at 99.

**Rationale:** In a real ecosystem, any animal CAN learn — a crow can use tools, an old bear is a better hunter. Caps are artificial. Natural XP scarcity (rabbits don't fight) provides organic limits.

#### 1.3 — Unify Combat Formulas

Both agents and animals should use the same attack/defense formulas from `Progression.ts`.

**Attack damage (unified):**
```typescript
export function getAttackDamage(
  attacker: { baseStats: BaseStats; skills: SkillSet; inventory?: Inventory },
  isAnimal: boolean = false
): number {
  const effectiveStr = getEffectiveStat('strength', attacker.baseStats, attacker.skills);
  const weaponBonus = isAnimal ? 0 : getEquippedWeaponBonus(attacker.inventory);
  return effectiveStr * (0.8 + Math.random() * 0.4) + weaponBonus;
}
```

**Defense (unified):**
```typescript
export function getDamageReduction(
  defender: { baseStats: BaseStats; skills: SkillSet; inventory?: Inventory },
  isAnimal: boolean = false
): number {
  const effectiveTough = getEffectiveStat('toughness', defender.baseStats, defender.skills);
  const armorBonus = isAnimal ? 0 : getEquippedArmorBonus(defender.inventory);
  const totalDefense = effectiveTough + armorBonus;
  return totalDefense / (totalDefense + 100); // same percentage model for all
}
```

**Speed (unified):**
```typescript
export function getSpeed(
  being: { baseStats: BaseStats; skills: SkillSet; needs: { stamina: number }; inventory?: Inventory },
  speciesBaseSpeed?: number // animals pass this; agents use 0.3
): number {
  const base = speciesBaseSpeed ?? 0.3;
  const staminaFactor = being.needs.stamina / 200; // both use stamina now
  const athleticsBonus = being.skills.athletics.level * 0.005;
  const weightPenalty = being.inventory ? getWeightPenalty(being.inventory) : 1.0;
  return (base + staminaFactor) * (1 + athleticsBonus) / weightPenalty;
}
```

**Key change:** Animals now use stamina-dependent speed too. A tired bear runs slower than a fresh bear.

**Files:** `server/src/Progression.ts`, `server/src/ai/AnimalAI.ts`, `server/src/ai/NeedsSystem.ts`

#### 1.4 — Agent Corpse Drops Based on Stats

Currently agents drop fixed 6 meat. Change to stat-based drops like animals:

```typescript
function getAgentDrops(agent: AgentState): Partial<DropTable> {
  const size = (agent.baseStats.strength + agent.baseStats.toughness + agent.baseStats.endurance) / 3;
  return {
    meat: Math.floor(4 + size / 3),      // 5-9 based on build
    bone: Math.floor(2 + size / 5),      // 3-5
    hide: Math.floor(1 + size / 5),      // 2-4
    sinew: Math.floor(1 + size / 7),     // 1-3
    fat: Math.floor(1 + size / 5),       // 2-4
  };
}
```

**Files:** `server/src/GameLoop.ts` (agent death handler)

---

## Enhancement 2: Ecosystem Nutrient Cycle

### Problem

The ecosystem is an open loop: resources are consumed and never returned. Dead bodies vanish after 60s, contributing nothing to soil/regrowth. If plants hit 0, regrowth = 0 forever (multiplicative death trap).

### Changes

#### 2.1 — Soil Fertility System

Add a per-tile fertility value that boosts local plant regrowth. Corpse decomposition enriches nearby tiles.

**New type in shared/src/index.ts:**
```typescript
// Fertility grid: parallel to tile grid, values 0.0-3.0
// 1.0 = normal regrowth rate, 2.0 = double, 0.5 = depleted
```

**Mechanic:**
- Each tile has a fertility value (default 1.0)
- When a corpse decays (600 tick timer expires), boost fertility of surrounding 3×3 tiles by +0.3
- When a plant is harvested, reduce that tile's fertility by -0.1
- Fertility decays toward 1.0 over time (0.001 per tick toward baseline)
- Plant regrowth chance per tick = `BASE_REGROWTH × fertility` instead of flat 0.1%

**Files:** `server/src/World.ts` (new fertility grid), `server/src/GameLoop.ts` (corpse decay → fertility boost)

#### 2.2 — Seed Banking (Dormant Soil Seeds)

Prevent the 0→0 extinction trap. The world maintains a "seed bank" count per plant type that persists even when all visible plants are gone.

**Mechanic:**
- When a plant drops seeds (90% chance), 50% of seeds go to agent inventory, 50% enter the soil seed bank for that tile region
- Soil seeds have a 0.02% chance per tick to sprout into a new plant (independent of existing plant count)
- This means even if ALL visible plants are destroyed, dormant seeds slowly regenerate them
- Seed bank is per-region (divide world into 12×9 regions of 10×10 tiles each), max 20 dormant seeds per region

**Formula:**
```
spontaneous_regrowth = seed_bank[region] × 0.0002 per tick
// At max 20 seeds: 0.4% per tick = ~1 new plant every 25 seconds per region
// With 108 regions: world-wide ~4 plants/second recovery from extinction
```

**Files:** `server/src/World.ts` (seed bank array, sprouting logic)

#### 2.3 — Implement Squirrel Seed Dispersal

The `seed_disperse` special ability exists on squirrels but does nothing. Make it functional:

**Mechanic:**
- Every 200 ticks, if a squirrel is on or adjacent to a tree/bush, it picks up a seed
- Squirrel deposits seed at a random location within 10 tiles of its next rest location
- Deposited seeds go into the soil seed bank for that region
- This gives squirrels a keystone ecological role: they spread forests

**Files:** `server/src/ai/AnimalAI.ts` (seed_disperse ability handler)

#### 2.4 — Seasonal Cycles

Add a 4-season cycle that affects resource production and animal behavior.

**Cycle:** 1 full year = 24,000 ticks (40 minutes real time)
- **Spring** (ticks 0-6000): Plant regrowth ×2.0, breeding cooldowns ×0.5, animal activity +20%
- **Summer** (ticks 6000-12000): Normal rates (×1.0 baseline), max food availability
- **Autumn** (ticks 12000-18000): Plant regrowth ×0.5, berry bushes produce double food, animals fatten (+50% food drops)
- **Winter** (ticks 18000-24000): Plant regrowth ×0.1, no breeding, stamina decay ×1.5, animal migration toward center

**Gameplay impact:**
- Agents must stockpile food in autumn for winter survival
- Winter creates natural population pressure (weak agents/animals die)
- Spring creates population recovery (breeding boom, plant regrowth)
- Creates natural cycles of scarcity and abundance

**New in shared/src/index.ts:**
```typescript
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASON_LENGTH = 6000; // ticks per season
export const YEAR_LENGTH = 24000; // ticks per year
```

**Files:** `shared/src/index.ts` (types), `server/src/World.ts` (season calculator), `server/src/GameLoop.ts` (apply season multipliers), `server/src/ai/AnimalAI.ts` (seasonal breeding/migration), `client/src/scenes/UIScene.ts` (season display)

#### 2.5 — Carrying Capacity

Plant density controls how many herbivores a region can support. When herbivore density exceeds local plant density, plant regrowth drops (overgrazing).

**Mechanic:**
- Each 10×10 region tracks: plant count, herbivore count
- `carrying_capacity = plant_count × 2` (each plant supports 2 herbivores)
- If `herbivore_count > carrying_capacity`: plant regrowth in region ×0.25 (trampled/overgrazed)
- If `herbivore_count < carrying_capacity × 0.5`: plant regrowth in region ×1.5 (undergrazed, flourishing)

**Files:** `server/src/World.ts` (region tracking), `server/src/GameLoop.ts` (apply overgrazing modifier)

---

## Enhancement 3: Iron Ore Slow Respawn

### Problem

Iron ore (15-20 deposits) never respawns. Once mined, advanced crafting is permanently locked.

### Change

Add very slow iron respawn: 1 new deposit every 18,000 ticks (30 real minutes).

**Mechanic:**
- Every 18,000 ticks, if `ironDepositCount < MAX_IRON_DEPOSITS`:
  - Find a random dirt tile adjacent to stone
  - Place new iron ore deposit (health 50, yield 2-4)
  - Max deposits capped at initial count (15-20)
- Flavor: "geological upwelling" — iron naturally surfaces over time

**Implementation:**
```typescript
// In GameLoop.ts tick processing:
if (this.tickCount % 18000 === 0) {
  const currentIron = this.world.countTileType(TileType.IRON_ORE);
  if (currentIron < this.world.initialIronCount) {
    this.world.spawnIronDeposit(); // finds valid dirt-near-rock tile
  }
}
```

**Files:** `server/src/GameLoop.ts`, `server/src/World.ts` (spawnIronDeposit method)

---

## Enhancement 4: Ecosystem Safety Nets

### 4.1 — Minimum Plant Floor

Never allow total plant count to drop below 5% of initial. If plants approach this threshold, temporarily boost regrowth rate.

```typescript
const MIN_PLANT_RATIO = 0.05;
const currentRatio = world.plantCount / world.initialPlantCount;
const emergencyMultiplier = currentRatio < MIN_PLANT_RATIO
  ? 5.0  // 5× regrowth when critically low
  : currentRatio < 0.2
    ? 2.0  // 2× regrowth when low
    : 1.0; // normal
```

#### 4.2 — Predator-Prey Feedback Loop (Enhanced)

Current system only adjusts predator breeding based on prey count. Extend to also adjust herbivore breeding based on plant density:

```typescript
// Existing (keep):
if (totalPrey < lowPreyThreshold) predatorBreedCooldown *= 2;
if (totalPrey > highPreyThreshold) predatorBreedCooldown *= 0.5;

// New:
const plantRatio = world.plantCount / world.initialPlantCount;
if (plantRatio < 0.3) herbivoreBreedCooldown *= 2;    // low plants → slow herbivore breeding
if (plantRatio > 0.8) herbivoreBreedCooldown *= 0.7;  // abundant plants → faster breeding
```

#### 4.3 — Adaptive Predator Diet

Currently each predator has a fixed `hunts[]` list. If all preferred prey are extinct, predator starves. Add fallback hunting:

```typescript
// If no preferred prey found within detection range, expand to ANY animal smaller than self
if (!target && animal.needs.proteinHunger < 20) {
  const desperatePrey = nearbyAnimals.find(a =>
    a.species !== animal.species &&
    getSpecies(a).size < species.size &&
    a.alive
  );
  if (desperatePrey) target = desperatePrey;
}
```

---

## Enhancement 5: Minor Parity Fixes (Role-Based)

These keep agents and animals in different roles but make the shared math consistent:

#### 5.1 — Animal Stamina Affects Speed

Currently animal speed = `species.speed × (1 + athletics×0.005)` with no stamina factor. Add stamina dependence so tired animals slow down:

```typescript
// Before: speed = species.speed * (1 + athletics * 0.005)
// After:  speed = species.speed * (1 + athletics * 0.005) * (0.5 + stamina / 200)
```

A fully-rested animal moves at full species speed. An exhausted animal moves at 50%.

#### 5.2 — Unified Health Scale

Agents use 0-100 health. Animals use 0-maxHealth (varies 8-200). Unify to percentage-based internally, display as actual HP in UI:

**No code change needed** — just ensure all combat formulas use percentage-of-max for threshold checks (e.g. "flee when health < 20%" not "flee when health < 20").

#### 5.3 — Animal Spatial Memory Upgrade

Animals currently have primitive 3-field memory (lastFoodX/Y, lastWaterX/Y, lastDangerX/Y). Upgrade to use the same `SpatialMemoryEntry[]` system as agents, with species-appropriate limits:

```typescript
// On AnimalState (shared/src/index.ts):
spatialMemory?: SpatialMemoryEntry[];  // same type as agents

// Limits by species tier:
// apex: max 15 entries, 2000 tick expiry
// mid_predator: max 10 entries, 1500 tick expiry
// herbivore: max 8 entries, 1000 tick expiry
// small_prey: max 5 entries, 500 tick expiry
```

---

## Implementation Priority

### Phase 1: Critical Ecosystem (prevent collapse)
1. Soil fertility system (2.1)
2. Seed banking (2.2)
3. Minimum plant floor (4.1)
4. Enhanced predator-prey feedback (4.2)
5. Iron slow respawn (3)

### Phase 2: Stat Unification (same math for all beings)
6. Randomize animal base stats (1.1)
7. Remove skill caps (1.2)
8. Unify combat/defense/speed formulas (1.3)
9. Agent corpse drops (1.4)

### Phase 3: Ecosystem Enrichment
10. Seasonal cycles (2.4)
11. Carrying capacity / overgrazing (2.5)
12. Squirrel seed dispersal (2.3)
13. Adaptive predator diet (4.3)

### Phase 4: Parity Polish
14. Animal stamina → speed (5.1)
15. Animal spatial memory upgrade (5.3)
16. Unified health percentage thresholds (5.2)

---

## Success Criteria

The ecosystem is "fish tank ready" when:
- A world with 0 agents runs for 2 hours without any species going extinct
- Plants oscillate between 40-90% of initial count (never 0, never 100%)
- Predator/prey populations oscillate naturally (boom-bust cycles, not death spirals)
- Seasonal variation creates visible behavior changes
- An agent stripped of all resources can recover by foraging within 2 minutes
- Iron is scarce but never permanently gone
- Every animal in the same species looks slightly different in stats
- A bear and an agent of equivalent skill use the exact same damage formula
