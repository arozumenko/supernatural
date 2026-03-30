# Progression System — Specification

## Overview

Every living being (agent or animal) has **base stats** determined at birth and **skills** that improve through practice. A being that fights a lot becomes a better fighter. A being that chops trees gets stronger and more efficient. Skills are capped at level 99, which doubles the base stat it governs. On death, beings respawn with stats reset to base — but skill levels persist. This creates a reinforcement loop: experienced beings are meaningfully stronger, and death is punishing but not a total reset.

## Core Concepts

### Base Stats

Every being is born with 6 base stats, randomized within a species range:

```
STAT          WHAT IT GOVERNS                              RANGE (agents)   RANGE (animals)
────────────────────────────────────────────────────────────────────────────────────────────
Strength      melee damage, harvest speed, carry capacity  5-15             species-specific
Toughness     damage reduction, max health bonus           5-15             species-specific
Agility       move speed, dodge chance, flee effectiveness 5-15             species-specific
Endurance     max stamina, stamina regen, need decay rate  5-15             species-specific
Perception    detection range, foraging yield, trap avoid  5-15             species-specific
Charisma      social influence, taming, trade, obedience   5-15             species-specific
```

Base stats are **fixed at birth** and never change. All progression comes from skill bonuses applied on top.

### Skills (the progression layer)

10 broad skills, each trained by performing related actions:

```
SKILL          TRAINED BY                           STAT IT BOOSTS         WHAT IMPROVES
──────────────────────────────────────────────────────────────────────────────────────────
Combat         fighting (any target)                Strength               attack damage, hit accuracy
Defense        taking damage, blocking, surviving   Toughness              damage reduction, health pool
Athletics      running, fleeing, chasing, swimming  Agility                move speed, dodge, flee success
Woodcutting    chopping trees                       Strength + Endurance   harvest speed, wood yield
Mining         breaking rocks                       Strength + Endurance   harvest speed, stone yield
Foraging       gathering plants, berries, herbs     Perception             yield, poison identification
Building       constructing floors, walls, camps    Endurance              build speed, resource efficiency
Crafting       using workbench, making items        Perception             recipe efficiency, quality
Survival       enduring hunger/thirst/damage/cold   Endurance              need decay reduction, health regen
Social         interacting with others, taming      Charisma               influence, taming speed, trade
```

Each skill has:
- **XP**: accumulated experience points (0 to ∞, but level caps at 99)
- **Level**: derived from XP (0-99)
- **Stat bonus**: level directly adds to the governing base stat(s)

### The +99 Cap Rule

```
effective_stat = base_stat + skill_bonus

where skill_bonus = skill_level (0-99)

Since base stats range 5-15:
  - A being born with Strength 10, Combat level 0  → effective Strength = 10
  - Same being at Combat level 50                   → effective Strength = 60
  - Same being at Combat level 99 (max)             → effective Strength = 109

Level 99 roughly doubles the birth stat. A being born strong (15) maxes at 114.
A being born weak (5) maxes at 104. Birth stats still matter, but practice matters more.
```

### Skills That Boost Two Stats

Some skills (Woodcutting, Mining, Building) boost two stats. The bonus is split:

```
Woodcutting level 60:
  → Strength bonus: +40  (⅔ of level, rounded)
  → Endurance bonus: +20 (⅓ of level, rounded)

The primary stat gets ⅔, secondary gets ⅓.
Both are still capped at +99 across ALL contributing skills.
```

#### Stat Bonus Cap (Important)

A single stat can receive bonuses from multiple skills, but the total bonus to any one stat is capped at +99:

```
Example: Strength receives bonuses from Combat, Woodcutting, and Mining.
  Combat level 80     → +80 to Strength
  Woodcutting level 60 → +40 to Strength (⅔ of 60)
  Mining level 45      → +30 to Strength (⅔ of 45)
  RAW TOTAL: 150

  CAPPED: min(150, 99) = 99

So effective Strength = base(10) + 99 = 109 max, no matter how many skills feed it.
```

---

## XP and Leveling

### XP Gain Formula

XP is earned by performing the associated action. Harder/riskier actions give more XP.

```
xp_gained = base_xp × difficulty_modifier × diminishing_modifier

base_xp per action (per tick of performing the action):
  Combat:      3.0  (per tick of fighting)
  Defense:     2.0  (per tick of taking damage, scaled by damage taken)
  Athletics:   0.5  (per tick of moving at >50% max speed)
  Woodcutting: 1.0  (per tick of chopping)
  Mining:      1.2  (per tick of mining)
  Foraging:    0.8  (per tick of gathering)
  Building:    1.0  (per tick of building)
  Crafting:    1.5  (per craft action completed)
  Survival:    0.3  (per tick when any need is below 30 — learning from hardship)
  Social:      1.0  (per tick of social interaction)
```

#### Difficulty Modifier

Harder challenges teach more:

```
Combat:
  difficulty = opponent_effective_strength / this_effective_strength
  modifier = clamp(difficulty, 0.5, 3.0)
  → Fighting something stronger than you: up to 3× XP
  → Fighting something much weaker: 0.5× XP (still learn something)

Defense:
  modifier = clamp(damage_taken / max_health × 10, 0.5, 3.0)
  → Taking heavy hits teaches more about defense

Athletics:
  modifier = 1.0 (constant — running is running)
  → BUT: fleeing from a real threat gives 2.0× (adrenaline learning)

Woodcutting/Mining:
  modifier = 1.0 (trees and rocks don't vary in difficulty... yet)

Foraging:
  modifier = plant_rarity (berry bush: 0.8, poison shroom: 1.5, stamina herb: 1.2)
  → Rarer plants teach more about foraging

Survival:
  modifier = (100 - lowest_need) / 50
  → The closer to death, the more you learn about survival
  → At need=10: modifier = 1.8. At need=5: modifier = 1.9
```

#### Diminishing Returns

To prevent grinding the same easy action to level 99:

```
diminishing_modifier = 1.0 / (1.0 + current_level / 50)

At level 0:   modifier = 1.00  (full speed learning)
At level 10:  modifier = 0.83
At level 25:  modifier = 0.67
At level 50:  modifier = 0.50  (half speed)
At level 75:  modifier = 0.40
At level 99:  modifier = 0.34  (very slow — maintenance mode)
```

### Level Curve

XP required per level follows a quadratic curve:

```
xp_for_level(n) = 50 × n²

Level  1:     50 XP
Level  5:   1,250 XP
Level 10:   5,000 XP
Level 25:  31,250 XP
Level 50: 125,000 XP
Level 75: 281,250 XP
Level 99: 490,050 XP

current_level = floor(sqrt(total_xp / 50))
```

#### Time Estimates (at 10 ticks/sec)

```
Combat level 10:
  5,000 XP needed ÷ ~2.5 XP/tick average = 2,000 ticks = ~3.3 minutes of fighting

Combat level 50:
  125,000 XP ÷ ~1.5 XP/tick (diminished) = 83,333 ticks = ~2.3 hours of fighting

Combat level 99:
  490,050 XP ÷ ~1.0 XP/tick (heavily diminished) = ~490,000 ticks = ~13.6 hours

This means reaching max level in a single skill takes sustained effort over many
real-time hours. Most beings will naturally reach level 20-40 in their primary
activities and never max out. Level 99 is extraordinary and rare.
```

---

## Death and Respawn

### The Respawn Loop

When a being dies:

```
1. Drop resources (food, materials) at death location
2. Record death event (cause, location, killer)
3. PRESERVE: all skill XP totals (the "knowledge")
4. RESET: all base stats to birth values
5. RESET: health, hunger, thirst, stamina to 100
6. APPLY: skill bonuses recalculate on top of fresh base stats
7. Respawn at world center (agents) or random habitat tile (animals)
```

### What "Knowledge Remains" Means

The being keeps its skill levels but loses its physical condition:

```
BEFORE DEATH:
  base Strength: 12
  Combat level: 45 → +45 Strength bonus
  effective Strength: 57
  health: 0 (dead)

AFTER RESPAWN:
  base Strength: 12 (same birth stat)
  Combat level: 45 → +45 Strength bonus (KEPT)
  effective Strength: 57 (same power)
  health: 100 (full — fresh body)
  hunger: 100 (full)
  all needs: reset to 100
```

The being is just as skilled as before death, but starts with a fresh body. The cost of death is:
- **Position loss**: respawn at center/random, not where you were
- **Resource loss**: everything carried is dropped
- **Memory loss** (animals): spatial memory (food/water locations) partially cleared — keep 30% of entries at 0.5 confidence
- **Momentum loss**: any plan/task in progress is abandoned
- **Taming reset**: tamed animals lose taming bond — owner must re-tame

### Death Penalty: Skill Rust

To make death sting without erasing knowledge, skills decay slightly on death:

```
on_death:
  for each skill:
    xp_lost = total_xp × 0.05  // lose 5% of total XP
    total_xp = max(total_xp - xp_lost, 0)
    recalculate level

A level 50 Combat skill (125,000 XP):
  loses 6,250 XP → drops to ~124,000 XP → still level 49
  Barely noticeable at high levels.

A level 10 Combat skill (5,000 XP):
  loses 250 XP → drops to ~4,750 XP → still level 9
  Also mild.

Repeated deaths DO compound: dying 10 times in a row loses ~40% of XP total.
This punishes reckless behavior without wiping progress from a single death.
```

---

## How Skills Apply to Gameplay

### Combat Skill → Fighting

```
effective_attack = base_strength + combat_level × (2/3)
attack_damage = effective_attack × weapon_modifier × (0.8 + random(0.4))

Higher combat also gives:
  hit_accuracy = 0.7 + combat_level × 0.003  // 70% at level 0, 100% at level 99
  → Missed attacks deal 0 damage (creates visible "miss" events)
  → Level 0 beings miss 30% of attacks. Level 50 misses 15%. Level 99 never misses.
```

### Defense Skill → Damage Reduction

```
damage_reduction = defense_level / (defense_level + 100)

Level  0: 0% reduction    (no armor skill)
Level 10: 9% reduction
Level 25: 20% reduction
Level 50: 33% reduction
Level 75: 43% reduction
Level 99: 50% reduction   (cap — can never reduce more than half)

actual_damage = incoming_damage × (1 - damage_reduction)
```

### Athletics Skill → Movement

```
speed_bonus = athletics_level × 0.005  // +0.5% speed per level
effective_speed = base_speed × (1 + speed_bonus)

Level  0: 1.00× speed
Level 25: 1.125× speed
Level 50: 1.25× speed
Level 99: 1.495× speed  (~50% faster)

Also:
  dodge_chance = athletics_level × 0.002  // 0% at 0, ~20% at 99
  flee_success = base_flee × (1 + athletics_level × 0.01)  // +1% per level
  stamina_cost_while_running = base_cost × (1 - athletics_level × 0.003)  // 30% cheaper at 99
```

### Woodcutting Skill → Tree Harvesting

```
chop_speed = base_chop × (1 + woodcutting_level × 0.01)  // +1% per level, 2× at 99
stamina_per_chop = base_cost × (1 - woodcutting_level × 0.005)  // 50% cheaper at 99
bonus_wood_chance = woodcutting_level × 0.005  // 0% at 0, ~50% at 99 for +1 bonus wood
```

### Mining Skill → Rock Harvesting

```
mine_speed = base_mine × (1 + mining_level × 0.01)
stamina_per_mine = base_cost × (1 - mining_level × 0.005)
bonus_stone_chance = mining_level × 0.005
```

### Foraging Skill → Plant Gathering

```
gather_speed = base_gather × (1 + foraging_level × 0.008)
poison_identification = foraging_level ≥ 15  // below 15: can't tell poison from safe
  → replaces the current random survival skill check
bonus_yield_chance = foraging_level × 0.004  // 0% at 0, ~40% at 99

Rare plant detection (future): foraging_level determines if you can see hidden herbs
```

### Building Skill → Construction

```
build_speed = base_build × (1 + building_level × 0.01)
resource_efficiency = 1.0 - building_level × 0.003  // 30% less resources at 99
  → a level 99 builder uses 70% of the normal resources for the same structure
```

### Crafting Skill → Workbench

```
craft_speed = base_craft × (1 + crafting_level × 0.01)
quality_bonus = crafting_level × 0.005  // future: higher quality items
recipe_unlock: some recipes require minimum crafting level (future)
```

### Survival Skill → Endurance

```
need_decay_reduction = survival_level × 0.002  // 0% at 0, ~20% at 99
  → hunger/thirst/stamina decay 20% slower at max level

health_regen = survival_level × 0.01 per tick (when not in combat, needs > 50)
  → 0 at level 0, ~1 HP/sec at level 99

cold/exposure resistance (future): survival_level reduces environmental damage
```

### Social Skill → Influence

```
For agents:
  taming_speed = base_tame × (1 + social_level × 0.015)  // 50% faster at 99... wait
  → Actually: +1.5% per level → 1.0 + 99×0.015 = 2.485× at 99
  message_influence = social_level × 0.005  // how much other agents listen to you
  trade_bonus = social_level × 0.003  // future: better trade deals

For animals:
  pack_cohesion = social_level × 0.01  // stronger pack bonds
  taming_resistance = base_resistance × (1 - social_level × 0.005)
    → more social animals are easier to tame at higher social levels
```

---

## Nutrition System: Protein & Plant

The old system had a single "hunger" bar and a single "food" resource. That lets a wolf survive on berries and a rabbit eat steak. In reality, diet matters — and it creates strategic pressure.

### Two Hunger Bars

Every being tracks two separate nutrition needs:

```
protein_hunger: number;   // 0-100, decays over time. Restored by meat, eggs, insects.
plant_hunger: number;     // 0-100, decays over time. Restored by berries, herbs, mushrooms, grass.
```

Both decay independently. When either hits 0, the being starts taking health damage — same as the old hunger system, but now you can starve from protein deficiency even with a full belly of berries.

### Diet Types

Each species has a diet type that determines which hunger bars matter and how fast they decay:

```
DIET TYPE       PROTEIN DECAY   PLANT DECAY    WHAT THEY EAT
──────────────────────────────────────────────────────────────────
carnivore       1.0× (full)     0.0× (none)    meat, eggs only. Cannot eat plants.
herbivore       0.0× (none)     1.0× (full)    plants, berries, grass only. Cannot eat meat.
omnivore        0.6× (slower)   0.6× (slower)  both — but needs BOTH to stay healthy.
```

Omnivores get a discount on each bar (0.6× decay instead of 1.0×) because they have flexibility — but they must eat both types or the neglected bar still drops.

### Species Diet Mapping

```
CARNIVORES (protein only):
  Tiger, Alligator, Cat, Fox, Dog/Wolf

HERBIVORES (plant only):
  Deer, Cow, Horse, Goat, Sheep, Donkey, Rabbit, Squirrel, Capybara

OMNIVORES (both):
  Bear, Pig/Boar, Rat, Chicken, Duck, Hedgehog, Agents (humans)
```

### Food Source Classification

Every food source in the game is tagged as protein, plant, or both:

```
PROTEIN SOURCES:
  raw meat         → +10 protein per unit (from corpses)
  cooked meat      → +20 protein (cooking doubles value)
  eggs             → +8 protein (chicken/duck production)
  stew             → +25 protein, +15 plant (mixed recipe)
  bone broth       → +10 protein
  jerky            → +15 protein

PLANT SOURCES:
  berry bush       → +12 plant (foraging)
  edible flower    → +6 plant
  hunger herb      → +10 plant
  mushroom         → +8 plant
  grass tile       → +3 plant (grazing — herbivores only, very slow)
  cooked stew      → +15 plant (mixed)
  fat rations      → +10 protein, +5 plant

SPECIAL:
  poison mushroom  → +8 plant BUT -25 health (if not identified)
  rotten meat      → +3 protein BUT -15 health
```

### How It Affects Behavior

The utility AI now scores food-seeking separately for each hunger type:

```
// For an omnivore agent:
seek_protein_utility = (1 - protein_hunger/100)² × diet.proteinWeight
seek_plant_utility   = (1 - plant_hunger/100)² × diet.plantWeight

// The AI naturally balances: if protein is at 80 but plant is at 30,
// plant-seeking scores much higher → agent goes foraging, not hunting.

// For a carnivore wolf:
seek_protein_utility = (1 - protein_hunger/100)² × 1.0
seek_plant_utility   = 0  // always zero — wolf never seeks plants

// For a herbivore deer:
seek_protein_utility = 0  // always zero — deer never hunts
seek_plant_utility   = (1 - plant_hunger/100)² × 1.0
```

### Why This Matters for Gameplay

**Agents (omnivores)** must balance two food sources. You can't just spam berry bushes — you also need to hunt or keep chickens for eggs. This drives crafting (cooking combines both), animal husbandry (egg production), and hunting as ongoing necessities rather than optional activities.

**Predators** are forced to hunt. A wolf pack can't survive in a barren area — they need prey animals. If prey population crashes, predators starve. This makes the food chain mechanically real, not just flavor.

**Herbivores** need plant-rich areas. Overgrazing (too many cows in one spot) depletes grass/berry resources, forcing herds to migrate. Deforestation by agents destroys herbivore habitat.

**Bears and pigs (omnivores)** are the most flexible animals — they can switch between berries and hunting depending on availability. This is why they're the most successful survivors in the ecosystem.

### Decay Rates (per tick)

The old single hunger decay is replaced by two separate decays:

```
SIZE      PROTEIN DECAY (×diet_mod)   PLANT DECAY (×diet_mod)
──────────────────────────────────────────────────────────────
Tiny      0.04                         0.05
Small     0.05                         0.06
Medium    0.06                         0.07
Large     0.08                         0.09

Agent:    0.06                         0.06

Survival skill reduces both decays equally (see Survival Skill section).

Examples:
  Tiger (large carnivore):    protein = 0.08 × 1.0 = 0.08/tick, plant = 0 (doesn't need)
  Deer (medium herbivore):    protein = 0 (doesn't need), plant = 0.07 × 1.0 = 0.07/tick
  Bear (large omnivore):      protein = 0.08 × 0.6 = 0.048/tick, plant = 0.09 × 0.6 = 0.054/tick
  Agent (medium omnivore):    protein = 0.06 × 0.6 = 0.036/tick, plant = 0.06 × 0.6 = 0.036/tick
  Rat (tiny omnivore):        protein = 0.04 × 0.6 = 0.024/tick, plant = 0.05 × 0.6 = 0.030/tick
```

### Starvation Damage

When either hunger bar hits 0, health damage starts — same formula as before but per-bar:

```
if protein_hunger <= 0:
  health -= 0.5 per tick (protein starvation)

if plant_hunger <= 0:
  health -= 0.5 per tick (vitamin deficiency)

if BOTH <= 0:
  health -= 1.5 per tick (total starvation — accelerated, not just additive)
```

### Types (for implementation)

```typescript
// Replace single hunger in AgentNeeds / AnimalState
interface NutritionNeeds {
  proteinHunger: number;    // 0-100, 0 = protein-starving
  plantHunger: number;      // 0-100, 0 = plant-starving
  thirst: number;           // 0-100 (unchanged)
  stamina: number;          // 0-100 (unchanged)
  health: number;           // 0-100 (unchanged)
  social: number;           // 0-100 (unchanged, agents only)
  shelter: number;          // 0-100 (unchanged, agents only)
}

type DietType = 'carnivore' | 'herbivore' | 'omnivore';

interface DietConfig {
  type: DietType;
  proteinDecayModifier: number;  // carnivore: 1.0, herbivore: 0.0, omnivore: 0.6
  plantDecayModifier: number;    // carnivore: 0.0, herbivore: 1.0, omnivore: 0.6
  canEatMeat: boolean;
  canEatPlants: boolean;
  canEatEggs: boolean;           // only omnivores and carnivores
  canGraze: boolean;             // only herbivores (eat grass tiles)
}

// Food item nutrition values
interface FoodNutrition {
  protein: number;    // hunger points restored to proteinHunger
  plant: number;      // hunger points restored to plantHunger
  health?: number;    // bonus/penalty to health (poison = negative)
  stamina?: number;   // bonus to stamina (stamina herb)
}
```

---

## Animals vs. Agents

Both use the same system, but animals have narrower skill profiles:

### Animal Skill Caps (by tier)

Animals don't have access to all 10 skills. Each tier unlocks a subset:

```
APEX PREDATORS (bear, tiger, alligator):
  Combat:    cap 80     ← primary
  Defense:   cap 60
  Athletics: cap 50
  Survival:  cap 70
  Social:    cap 20     ← mostly solitary
  Others:    cap 0      ← animals don't build or craft

MID PREDATORS (fox, cat, dog, rat):
  Combat:    cap 60
  Defense:   cap 40
  Athletics: cap 70     ← fast and agile
  Survival:  cap 60
  Social:    cap 50     ← pack animals score higher
  Foraging:  cap 30     ← omnivores forage too

LARGE HERBIVORES (deer, cow, horse):
  Combat:    cap 30     ← can fight but not great
  Defense:   cap 50     ← tough hides
  Athletics: cap 80     ← speed is survival
  Survival:  cap 70
  Social:    cap 60     ← herd animals
  Foraging:  cap 40

MEDIUM HERBIVORES (pig, goat, sheep, donkey):
  Combat:    cap 40     ← boars fight hard
  Defense:   cap 50
  Athletics: cap 40
  Survival:  cap 60
  Social:    cap 50
  Foraging:  cap 50     ← goats eat everything

SMALL PREY (rabbit, chicken, duck, squirrel, hedgehog, capybara):
  Combat:    cap 10     ← basically can't fight
  Defense:   cap 30     ← hedgehog: cap 70 (curl defense)
  Athletics: cap 60     ← running is everything
  Survival:  cap 50
  Social:    cap 40     ← flock/colony
  Foraging:  cap 40

AGENTS (humans):
  All skills: cap 99    ← no restrictions, full potential
```

### Animal XP Gain (Passive)

Animals earn XP naturally through their behavior — no special "training" needed:

```
A deer that flees from wolves every day:
  → Athletics XP every time it runs (0.5 base × 2.0 flee bonus = 1.0/tick)
  → After 20 real-minutes of being chased: Athletics ~level 8
  → Noticeably faster than a deer that was never chased

A bear that fights agents:
  → Combat XP per fight tick (3.0 base × difficulty modifier)
  → A bear that has survived 5 fights: Combat ~level 15
  → Hits harder, misses less often

An old wolf pack leader:
  → Combat 40, Athletics 35, Social 45, Survival 50
  → Genuinely dangerous — not the same as a fresh-spawned wolf
```

This creates **emergent difficulty scaling**: the longer an animal lives, the harder it becomes. Old apex predators are boss-tier encounters. New players face fresh animals; established areas have veteran wildlife.

---

## Respawn Rules by Being Type

### Agent Respawn

```
trigger:    health reaches 0
delay:      30 seconds (death screen / spectate mode)
location:   world center clearing
preserves:  all skill XP (minus 5% rust penalty)
resets:     position, health, all needs to 100, carried resources dropped
inventory:  empty (everything dropped at death location)
memory:     agents keep full spatial memory (they're smarter)
```

Players can also re-seed agents manually via `player:create_agent`, which creates a fresh being with 0 skill XP. Respawning preserves XP; re-seeding does not.

### Animal Respawn

```
trigger:    health reaches 0
delay:      60-300 seconds (species.breedCooldown × 0.1)
            → rabbits respawn in ~90 sec, horses in ~900 sec
location:   random valid habitat tile for species
preserves:  all skill XP (minus 5% rust penalty)
resets:     position, health, all needs, taming progress, spatial memory (keep 30%)
condition:  species population < maxPopulation (otherwise no respawn — death is final)
```

Animal respawn is gated by population caps. If bears are at max population and one dies, it doesn't respawn until the count drops. This prevents immortal populations.

---

## UI Display

### What Players See (Level Only)

Players see skill levels as compact badges on the agent/animal info panel. No XP bars, no numbers — just the level.

```
Selected agent info panel:
┌──────────────────────────────┐
│ Agent: Marcus                │
│ Health: ████████░░ 82        │
│                              │
│ Skills:                      │
│  ⚔ Combat 23   🛡 Defense 8  │
│  🏃 Athletics 15  🪓 Wood 31  │
│  ⛏ Mining 5    🌿 Forage 18  │
│  🏗 Build 12   🔧 Craft 7    │
│  ❤ Survival 20  💬 Social 11 │
│                              │
│ Action: chopping tree        │
└──────────────────────────────┘
```

Level-up events appear in the event log:

```
[12:34] Marcus reached Woodcutting level 32!
[12:35] A bear reached Combat level 51!
```

Animals show simplified skills (only their non-zero ones):

```
Selected animal panel:
┌──────────────────────────────┐
│ Wolf (Pack Alpha)            │
│ Health: ██████████ 60        │
│                              │
│  ⚔ 38  🛡 22  🏃 31  ❤ 44   │
└──────────────────────────────┘
```

---

## Integration with Existing Systems

### With Agent NeedsSystem

Skills modify the existing needs decay and action execution:

```
// In NeedsSystem.decayNeeds():
hunger_decay = base_decay × (1 - survival_bonus)
thirst_decay = base_decay × (1 - survival_bonus)
stamina_decay = base_decay × (1 - endurance_bonus)

// In NeedsSystem.executeAction():
if action == 'harvesting' && target is tree:
  damage_to_tree *= (1 + woodcutting_speed_bonus)
  stamina_cost *= (1 - woodcutting_efficiency_bonus)
  earn_woodcutting_xp(base=1.0)

if action == 'fighting':
  attack_damage = effective_strength × weapon_mod × accuracy_roll
  earn_combat_xp(base=3.0, difficulty=opponent_strength/this_strength)
```

### With Animal Utility AI

Skills feed into the utility scoring as modifiers:

```
// Higher athletics → flee action is more effective → utility system values it more
flee_utility = threat_level × safety_weight × (1 + athletics_level × 0.005)

// Higher combat → fight action is more effective → predators prefer fighting
fight_utility = threat_level × aggression_weight × (1 + combat_level × 0.005)

// Higher foraging → gathering is faster → slightly increases food-seeking utility
seek_food_utility = hunger_curve × (1 + foraging_level × 0.002)
```

### With GOAP Planner

Skills affect action costs in the planner:

```
// A high-woodcutting being plans "chop tree" as cheaper
chop_tree_cost = base_cost × (1 - woodcutting_level × 0.005)

// A high-athletics being plans "travel far" as cheaper
travel_cost = distance × base_move_cost × (1 - athletics_level × 0.003)

// This means skilled beings naturally make better plans —
// a skilled woodcutter's GOAP will prefer chopping over foraging for food,
// because chopping is cheaper (in stamina) for them.
```

---

## Types (for implementation)

```typescript
// Add to shared/src/index.ts

type SkillName =
  | 'combat' | 'defense' | 'athletics'
  | 'woodcutting' | 'mining' | 'foraging'
  | 'building' | 'crafting' | 'survival' | 'social';

interface SkillState {
  xp: number;           // total accumulated XP
  level: number;        // derived: floor(sqrt(xp / 50)), capped at species skill cap
}

interface SkillSet {
  combat: SkillState;
  defense: SkillState;
  athletics: SkillState;
  woodcutting: SkillState;
  mining: SkillState;
  foraging: SkillState;
  building: SkillState;
  crafting: SkillState;
  survival: SkillState;
  social: SkillState;
}

interface BaseStats {
  strength: number;      // 5-15 at birth, fixed
  toughness: number;
  agility: number;
  endurance: number;
  perception: number;
  charisma: number;
}

// Effective stat calculation
function getEffectiveStat(base: number, ...bonuses: number[]): number {
  const totalBonus = Math.min(bonuses.reduce((a, b) => a + b, 0), 99);
  return base + totalBonus;
}

// Example: effective strength
function getEffectiveStrength(being: { baseStats: BaseStats; skills: SkillSet }): number {
  return getEffectiveStat(
    being.baseStats.strength,
    being.skills.combat.level,                           // full combat bonus
    Math.floor(being.skills.woodcutting.level * 2 / 3),  // ⅔ of woodcutting
    Math.floor(being.skills.mining.level * 2 / 3)        // ⅔ of mining
  );
}

// Add to AnimalSpecies config
interface AnimalSpeciesSkillConfig {
  skillCaps: Partial<Record<SkillName, number>>;  // max level per skill (0 = can't learn)
  xpRates: Partial<Record<SkillName, number>>;    // multiplier on base XP gain (default 1.0)
}

// Add to AgentState / AnimalState
interface LivingBeingProgression {
  baseStats: BaseStats;
  skills: SkillSet;
  totalDeaths: number;         // lifetime death counter
  totalXpEarned: number;       // lifetime XP across all skills (vanity stat)
}
```
