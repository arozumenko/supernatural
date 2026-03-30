# Drops & Materials — Specification

## Overview

Every living being in Supernatural is part of the food chain — including agents. When any being dies, it drops **materials** that others can collect. Animals attack agents not out of malice but because agents are meat. Agents hunt animals for the same reason. This symmetry is the foundation: nobody is above the ecosystem.

Materials are organized into **categories**, not per-species unique items. A bear and a cow both drop "meat" and "bone" — the bear just drops more. This keeps crafting balanced without needing 40+ unique ingredients.

## Material Categories

8 material types, all harvestable from dead beings:

```
MATERIAL       DESCRIPTION                             USED FOR
─────────────────────────────────────────────────────────────────────
meat           edible flesh, primary food source        eating (restores hunger), cooking recipes
bone           skeletal remains                         tools, weapons, structural reinforcement
hide           skin/fur/pelt                            armor, clothing, shelter upgrades, containers
sinew          tendons, connective tissue               bowstrings, binding, rope, stitching
fat            animal fat, rendered tallow              fuel (campfire boost), waterproofing, cooking
feathers       bird plumage                             arrows (future), insulation, bedding
teeth_claws    fangs, claws, talons, horns              weapons, jewelry (trade value), trophies
scales         alligator/fish scales                    armor, decoration (rare material)
```

Agents drop **meat only** when killed (no bone/hide/etc — keeps it less grim while maintaining food chain symmetry). Agents also drop their entire carried inventory (wood, stone, food, water, seeds, and any materials they were carrying).

## Drop Tables

### Drop Formula

```
drop_amount = base_drop × size_modifier × random(0.8, 1.2)

size_modifier:
  tiny:   0.25
  small:  0.5
  medium: 1.0
  large:  2.0
```

### Per-Species Drops

#### Apex Predators

```
BEAR (large)
  meat:        12
  bone:        6
  hide:        4
  fat:         5
  sinew:       3
  teeth_claws: 4

TIGER (large)
  meat:        8
  bone:        5
  hide:        5    ← premium hide (tiger pelt — same category, higher quantity)
  sinew:       3
  teeth_claws: 5

ALLIGATOR (large)
  meat:        14
  bone:        4
  scales:      8    ← only reliable source of scales
  fat:         3
  teeth_claws: 6
```

#### Mid Predators

```
FOX (small)
  meat:        3
  bone:        2
  hide:        2
  sinew:       1
  teeth_claws: 1

CAT (small)
  meat:        2
  bone:        1
  hide:        1
  sinew:       1
  teeth_claws: 1

DOG/WOLF (medium)
  meat:        5
  bone:        3
  hide:        3
  sinew:       2
  teeth_claws: 2

RAT (tiny)
  meat:        1
  bone:        0    ← too small
  hide:        0
  sinew:       0
  fat:         1    ← rat fat, unpleasant but functional
```

#### Large Herbivores

```
DEER (medium)
  meat:        8
  bone:        4
  hide:        4
  sinew:       3
  teeth_claws: 2    ← antlers count as this category

COW (large)
  meat:        14   ← most meat in the game
  bone:        6
  hide:        6    ← most hide in the game (leather)
  fat:         6
  sinew:       4

HORSE (large)
  meat:        10
  bone:        6
  hide:        5
  sinew:       4
  fat:         3
```

#### Medium Herbivores

```
PIG/BOAR (medium)
  meat:        8
  bone:        3
  hide:        2
  fat:         5    ← pigs are fatty, best fat source after cow
  sinew:       2
  teeth_claws: 2    ← tusks

GOAT (medium)
  meat:        5
  bone:        3
  hide:        3
  sinew:       2
  teeth_claws: 1    ← horns

SHEEP (medium)
  meat:        4
  bone:        2
  hide:        4    ← wool-bearing hide, counts as hide but thicker
  fat:         3
  sinew:       1

DONKEY (medium-large)
  meat:        7
  bone:        4
  hide:        4
  sinew:       3
```

#### Small Prey

```
RABBIT (tiny)
  meat:        2
  bone:        1
  hide:        1    ← rabbit fur
  sinew:       0

CHICKEN (tiny)
  meat:        2
  bone:        1
  feathers:    3    ← primary feather source
  fat:         1

DUCK (tiny)
  meat:        2
  bone:        1
  feathers:    4    ← best feather source (waterproof feathers)
  fat:         2    ← duck fat, prized for cooking

SQUIRREL (tiny)
  meat:        1
  hide:        1
  bone:        0

HEDGEHOG (tiny)
  meat:        1
  bone:        1
  teeth_claws: 1    ← spines count as this category

CAPYBARA (medium)
  meat:        5
  bone:        2
  hide:        3
  fat:         3
```

#### Agents (Humans)

```
AGENT (medium)
  meat:        6
  (+ entire carried inventory: wood, stone, food, water, seeds, materials)

No bone, hide, sinew, etc from agents. They're food, not a material source.
Animals gain hunger restoration from agent meat just like any other meat.
```

---

## Why Animals Attack Agents

Animals don't attack agents randomly. Every attack has an ecological reason, driven by the utility AI:

```
REASON                  WHICH ANIMALS              WHEN
──────────────────────────────────────────────────────────────────
Hunger (food)           all predators              hunger utility scores agent as prey
Territory defense       tiger, bear, boar          agent enters territory radius
Nest/young defense      any with offspring          agent approaches within 3 tiles of young
Cornered panic          any herbivore              agent blocks all flee paths
Pack confidence         wolves                     pack size ≥ 4 and agent is alone
Provoked               boar, cow, horse, donkey    agent attacks one, nearby group retaliates
Starvation desperation  any                        hunger < 10, agent has food (smell mechanic)
```

### The Smell Mechanic

Predators can detect agents carrying meat (protein sources). They don't care about berries.

```
smell_range = species.detectionRange × (agent_meat_carried / 20)

An agent carrying 40 meat near a hungry bear (detection 12):
  smell_range = 12 × (40/20) = 24 tiles
  → The bear smells the meat from 24 tiles away
  → Bear's utility AI scores "hunt_agent" based on protein_hunger level + meat amount

Carrying lots of meat makes you a target. Strategy: cook and eat it quickly, or stash it.
Berries and plant food don't trigger the smell mechanic — predators don't care about salad.
```

### Agent as Prey (Utility Scoring)

For a predator evaluating whether to hunt an agent:

```
hunt_agent_utility =
  hunger_curve(this.hunger)           // how hungry am I?
  × agent_food_value(agent)           // how much food does this agent represent?
  × safety_factor(agent)              // can I win this fight?
  × species.utilityWeights.aggression // am I the hunting type?

agent_food_value(agent):
  base: 6 meat (agent body)
  + agent.resources.food              // food they're carrying
  + agent.resources.meat (if any)     // meat they're carrying
  normalized to 0-1 scale

safety_factor(agent):
  my_effective_attack / agent_effective_attack
  × (1 if agent alone, 0.3 if agent near group)
  capped at 1.0

A starving tiger (hunger 15) near a lone agent carrying 20 food:
  hunger_curve(15) = 0.72
  food_value = (6 + 20) / 30 = 0.87
  safety = tiger_attack / agent_attack × 1.0 ≈ 0.9
  aggression = 1.6
  utility = 0.72 × 0.87 × 0.9 × 1.6 = 0.90  ← very high, will hunt

Same tiger, agent in group of 3:
  safety = 0.9 × 0.3 = 0.27
  utility = 0.72 × 0.87 × 0.27 × 1.6 = 0.27  ← low, probably won't risk it
```

---

## Material Uses in Crafting

Materials extend the current crafting system. Current recipes use wood/stone/food/water. New recipes use body materials.

### Updated Resource Type

```typescript
// Extend the existing Resources interface
type ResourceType =
  | 'wood' | 'stone' | 'food' | 'water' | 'seeds'   // existing
  | 'meat' | 'bone' | 'hide' | 'sinew'               // common body materials
  | 'fat' | 'feathers' | 'teeth_claws' | 'scales';   // uncommon body materials
```

### New Crafting Recipes

Recipes organized by category. All require workbench unless noted.

#### Tools & Weapons

```
RECIPE              REQUIRES                           SKILL REQ    PRODUCES
──────────────────────────────────────────────────────────────────────────────
Bone Knife          bone: 3, sinew: 1                  crafting 5   +5 attack, harvesting speed +10%
Bone Axe            bone: 4, wood: 2, sinew: 2         crafting 10  woodcutting speed +20%
Bone Pickaxe        bone: 4, stone: 2, sinew: 2        crafting 10  mining speed +20%
Bone Spear          bone: 5, wood: 3, sinew: 2         crafting 15  +10 attack, 2-tile range
Tooth Club          teeth_claws: 4, wood: 3            crafting 12  +8 attack, intimidation aura
Bow                 wood: 4, sinew: 3, feathers: 2     crafting 20  ranged attack (5 tiles), +7 attack
Arrows (×5)         wood: 1, feathers: 1, bone: 1      crafting 10  bow ammunition
Scale Shield        scales: 6, wood: 3, sinew: 2       crafting 25  +15 defense
```

#### Armor & Clothing

```
RECIPE              REQUIRES                           SKILL REQ    PRODUCES
──────────────────────────────────────────────────────────────────────────────
Hide Vest           hide: 4, sinew: 2                  crafting 8   +5 defense, cold resistance
Hide Boots          hide: 2, sinew: 1                  crafting 5   +5% move speed (terrain penalty reduced)
Fur Cloak           hide: 6, sinew: 3                  crafting 15  +8 defense, cold/rain resistance
Scale Armor         scales: 10, hide: 4, sinew: 4      crafting 30  +20 defense (best armor)
Feather Bedroll     feathers: 8, hide: 3               crafting 12  sleep quality ×2 (stamina regen)
```

#### Structures & Upgrades

```
RECIPE              REQUIRES                           SKILL REQ    PRODUCES
──────────────────────────────────────────────────────────────────────────────
Leather Sack        hide: 3, sinew: 1                  crafting 8   +20 carry capacity
Hide Tent           hide: 8, wood: 6, sinew: 3         building 15  portable shelter (shelter need)
Bone Fence          bone: 6, wood: 4                   building 10  barrier tile (blocks animals)
Fat Torch           fat: 2, wood: 1                    crafting 3   light source, campfire fuel boost
Tallow Candle       fat: 3                             crafting 5   long-duration light (300 ticks)
Sinew Rope          sinew: 4                           crafting 8   required for bridges, traps, pens
Animal Pen          wood: 12, sinew_rope: 2, bone: 4   building 25  enclosure for tamed animals
```

#### Food & Cooking

All food now restores **protein** and/or **plant** hunger separately (see PROGRESSION.md "Nutrition System"). Omnivores need both types.

```
RECIPE              REQUIRES                           SKILL REQ    PRODUCES
──────────────────────────────────────────────────────────────────────────────
Cooked Meat         meat: 2 + campfire                 crafting 0   protein: +20 (raw meat: +10)
Stew                meat: 3, water: 2, berries: 2      crafting 10  protein: +25, plant: +15, thirst: +15
Jerky               meat: 4, fat: 1                    crafting 8   protein: +15, doesn't spoil (future)
Bone Broth          bone: 3, water: 3                  crafting 5   protein: +10, health: +5 regen boost
Fat Rations         fat: 3, berries: 2                 crafting 5   protein: +10, plant: +5, stamina: +10
Berry Salad         berries: 4, edible_flower: 2       crafting 3   plant: +25 (best plant-only meal)
Herb Mix            hunger_herb: 2, stamina_herb: 1    crafting 5   plant: +15, stamina: +10
```

#### Trade & Social

```
RECIPE              REQUIRES                           SKILL REQ    PRODUCES
──────────────────────────────────────────────────────────────────────────────
Tooth Necklace      teeth_claws: 3, sinew: 1           crafting 5   +5 social score (vanity item)
Trophy               teeth_claws: 5, bone: 3, wood: 2  crafting 15  +10 social score, placed at camp
Feather Crown       feathers: 6, sinew: 2              crafting 12  +8 social score
Scale Pendant       scales: 3, sinew: 1                crafting 18  +12 social score (rarest materials)
```

---

## Material Economy Balance

### Supply Side: How Much Material Exists?

```
At world gen (~130 animals alive):
  Approximate total body materials in the ecosystem:

  meat:        ~500 (if every animal died)
  bone:        ~250
  hide:        ~250
  sinew:       ~150
  fat:         ~200
  feathers:    ~80  (only chickens + ducks)
  teeth_claws: ~100
  scales:      ~48  (only alligators — truly rare)

But animals don't all die at once. Realistic supply from natural deaths + hunting:
  ~15-25 animal deaths per real-hour (predation, starvation, agent hunting)
  → ~100-150 meat, ~40-60 bone, ~40-60 hide per hour flowing into the economy
```

### Demand Side: What Do Agents Need?

```
A single agent building full equipment needs:
  Hide Vest:     hide 4, sinew 2
  Hide Boots:    hide 2, sinew 1
  Bone Knife:    bone 3, sinew 1
  Bone Spear:    bone 5, wood 3, sinew 2
  Leather Sack:  hide 3, sinew 1
  ────────────
  TOTAL: hide 9, bone 8, sinew 7

That's roughly 2 medium herbivore kills (cow = hide 6 + bone 6 + sinew 4).
Achievable but not trivial — requires hunting skill and risk.

10 agents all wanting full gear: ~20 medium animal kills.
With ~15-25 natural deaths/hour, agents need to actively hunt to equip everyone.
This creates healthy competition + motivation to protect animal populations.
```

### Scarcity Design

Materials are deliberately tiered by rarity:

```
ABUNDANT:    meat, bone, hide    ← most animals drop these, basic crafting covered
MODERATE:    sinew, fat          ← most animals drop small amounts, need several kills
SCARCE:      feathers            ← only 2 species (chicken, duck), valuable for ranged
RARE:        teeth_claws         ← predators mainly, risky to obtain
VERY RARE:   scales              ← only alligators, most dangerous source in the game

This creates natural trade value:
  scales > teeth_claws > feathers > sinew > fat > hide > bone > meat

Agents with scale armor are visibly powerful — everyone knows they killed alligators.
```

---

## Material Spoilage (Future System)

Raw meat and fat spoil over time. This prevents hoarding and encourages cooking.

```
SPOILAGE TIMERS:
  raw meat:    300 ticks (30 sec) → becomes "rotten_meat" (0 food value, 0 craft value)
  fat:         600 ticks (60 sec) → becomes rancid (half craft value)
  cooked meat: no spoilage (cooking preserves)
  jerky:       no spoilage
  bone/hide/sinew/feathers/teeth/scales: never spoil

This drives cooking and crafting: raw materials must be processed or used quickly.
Rotten meat has one use: bait (place on ground to attract predators/scavengers).
```

---

## How Drops Work (Mechanics)

### Death → Loot Spawn

When any being dies:

```
1. Calculate drops from species drop table × size_modifier × random(0.8-1.2)
2. For agents: also include entire carried inventory
3. Create a "corpse" entity at death position:
   - Visible on map (sprite change or marker)
   - Contains all dropped materials
   - Persists for 600 ticks (60 seconds)
   - Any being can interact with corpse to take materials
4. After 600 ticks: corpse decays, remaining materials vanish
   - OR: scavenger animals (rat, fox, bear) eat corpse for hunger restoration
```

### Scavenger Behavior

Some animals can eat corpses instead of hunting:

```
SCAVENGERS: rat, fox, bear, pig (omnivores)

When a scavenger detects a corpse within detection range:
  scavenge_utility = hunger_curve × corpse_food_value × safety_factor

  // Scavenging is always preferred over hunting (less risky):
  scavenge_utility *= 1.3  // 30% bonus vs. hunt utility for same food value

This means:
  - Dead animals attract scavengers → creates dangerous gathering spots
  - Agents must collect their kill quickly or lose materials to scavengers
  - Rats swarm corpses → attracts cats/foxes → creates mini food chain events
  - Battlefields (after wolf pack vs. deer herd) become scavenger feasts
```

### Harvesting a Corpse

Agents (and scavenger animals) must spend time at a corpse to collect materials:

```
For agents:
  harvest_time = total_material_units × 3 ticks
  Each tick: extract 1 unit of a random remaining material
  Agent action: 'harvesting' (same as tree/rock, reuses existing system)
  Can be interrupted by threats (lose remaining materials)

  A cow corpse (14 meat, 6 bone, 6 hide, 6 fat, 4 sinew = 36 units):
    → 108 ticks to fully harvest (10.8 seconds)
    → Meaningful time investment, vulnerable to predators while harvesting

For animals:
  Scavengers only take meat (they eat, don't craft)
  Eat rate: 3 ticks per meat unit consumed
  Hunger restored: meat × 10 per unit
```

---

## Inventory Expansion

The current `Resources` interface only tracks 5 types. Materials add 8 more. The inventory system needs to accommodate this.

### Carrying Capacity

```
BASE CAPACITY: each resource type has unlimited stacking (for now)
TOTAL WEIGHT LIMIT: 100 units base, modified by:
  + Endurance stat bonus (endurance × 0.5)
  + Leather Sack: +20
  + (future) Pack animal: +50

Weight per unit:
  wood: 2    stone: 3    food: 1    water: 1    seeds: 0.5
  meat: 1.5  bone: 2     hide: 2    sinew: 0.5  fat: 1
  feathers: 0.2  teeth_claws: 0.5  scales: 1.5

A fresh agent (Endurance 10, no gear):
  capacity = 100 + (10 × 0.5) = 105 weight units
  Can carry: ~50 wood OR ~35 stone OR ~70 meat

Weight matters for GOAP planning:
  travel_cost increases with carried weight
  → Heavy agents plan shorter trips
  → Encourages base-building near resource sources
```

---

## Integration Points

### With Progression System (PROGRESSION.md)

Skills affect material gathering:

```
Combat skill:     determines how fast you kill (less damage to materials)
Foraging skill:   better yield from corpse harvesting (+bonus materials)
Crafting skill:   required for recipes, determines quality
Survival skill:   meat spoilage timer extended by survival_level × 2 ticks
```

### With Animal AI (ANIMALS.md)

The utility AI now scores "hunt agent" alongside "hunt deer":

```
// In the utility scoring for predators:
for each potential_prey in detection_range:
  food_value = potential_prey.drops.meat × 10  // hunger restoration potential
  risk = potential_prey.effective_attack / this.effective_attack
  hunt_utility = hunger_curve × (food_value / 100) × (1 / risk) × aggression_weight

// Agents and animals are scored identically.
// A hungry tiger evaluates a deer and an agent using the same formula.
// Whichever scores higher utility gets hunted.
```

### With Existing Crafting (shared/index.ts)

The `CraftingRecipe` interface expands to use material types:

```typescript
// Updated interface
export interface CraftingRecipe {
  name: string;
  requires: Partial<Record<ResourceType | MaterialType, number>>;
  produces: CraftProduct;
  skillRequired: number;           // minimum crafting level (from PROGRESSION.md)
  category: 'tool' | 'weapon' | 'armor' | 'structure' | 'food' | 'social';
  nearCampfire?: boolean;          // must be adjacent to campfire (cooking)
  nearWorkbench?: boolean;         // must be adjacent to workbench
}

type MaterialType = 'meat' | 'bone' | 'hide' | 'sinew' | 'fat' | 'feathers' | 'teeth_claws' | 'scales';

// CraftProduct can be a tile (existing) or an inventory item (new)
type CraftProduct =
  | { type: 'tile'; tileType: TileType }
  | { type: 'item'; item: ItemType; quantity: number }
  | { type: 'food'; proteinRestore: number; plantRestore: number; thirstRestore?: number; healthBoost?: number; staminaBoost?: number };
```

### With World Events

Material scarcity creates emergent events:

```
EVENT: "Famine Hunt"
  When: 3+ agents have hunger < 30 AND no food/meat in any inventory
  Effect: agents become desperate, prioritize hunting even dangerous animals
  → Likely agent deaths → more corpses → scavenger swarms → drama

EVENT: "Trophy Hunter"
  When: agent kills an apex predator
  Effect: social score +20, nearby agents gain +10 opinion
  → Encourages risky hunts for social status

EVENT: "Scavenger Swarm"
  When: 3+ corpses exist within 10-tile radius
  Effect: all scavengers in 30-tile radius converge
  → Dangerous area for agents, but material bonanza if they can defend
```

---

## Types (for implementation)

```typescript
// Add to shared/src/index.ts

export type MaterialType = 'meat' | 'bone' | 'hide' | 'sinew' | 'fat' | 'feathers' | 'teeth_claws' | 'scales';

export interface DropTable {
  meat: number;
  bone: number;
  hide: number;
  sinew: number;
  fat: number;
  feathers: number;
  teeth_claws: number;
  scales: number;
}

export interface CorpseState {
  id: string;
  x: number;
  y: number;
  sourceType: 'agent' | 'animal';
  sourceSpecies?: string;            // animal species ID
  sourceName?: string;               // agent name
  materials: Partial<DropTable>;     // remaining harvestable materials
  carriedResources?: Partial<Resources>;  // agent inventory (agents only)
  createdAt: number;                 // tick when created
  decayAt: number;                   // tick when corpse vanishes (createdAt + 600)
}

// Extend existing Resources to include materials
export interface Inventory extends Resources {
  meat: number;
  bone: number;
  hide: number;
  sinew: number;
  fat: number;
  feathers: number;
  teeth_claws: number;
  scales: number;
}

// Add to AnimalSpecies config
interface AnimalSpeciesDrops {
  drops: Partial<DropTable>;         // base drop amounts
  isScavenger: boolean;              // can eat corpses
  meatFoodValue: number;            // hunger restored per meat unit when this species eats
}
```
