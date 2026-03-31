# Animal System — Specification

## Overview

20 animal species inhabit the world as NPCs. No GenAI — instinct-driven hybrid AI (Utility AI + GOAP + Steering + Memory) that produces smart, preemptive survival behavior. Animals form a food chain: predators eat prey (including agents), prey eats plants, scavengers eat anything. They breed, fight, flee, and die. Agents can hunt them, tame them, or get killed by them.

**Companion specs** (animals depend on these, implement in order):
1. **[PROGRESSION.md](PROGRESSION.md)** — base stats (Strength, Toughness, Agility, Endurance, Perception, Charisma), 10 skills with XP/leveling, +99 cap, death/respawn with skill memory. Animals use the same system as agents, with per-tier skill caps.
2. **[DROPS_AND_MATERIALS.md](DROPS_AND_MATERIALS.md)** — 8 material categories (meat, bone, hide, sinew, fat, feathers, teeth_claws, scales), per-species drop tables, corpse system, crafting recipes. Agents are food too — symmetric food chain.

Species entries below show behavior and identity. For **drop tables** see DROPS_AND_MATERIALS.md. For **base stats and skill caps** see PROGRESSION.md.

## Available Sprites

Each animal has two frames (`0.png`, `1.png`) in `assets/animals/{name}/`. We pick 20 from the 32 available sets to form a coherent temperate forest/grassland ecosystem.

---

## The 20 Species

### Tier: Apex Predators (3)

These are dangerous. They hunt large and medium prey. Agents should fear them early game.

#### 1. Bear
```
sprite:     bear/
size:       large (occupies 1 tile, but has 2-tile threat radius)
diet:       omnivore — hunts deer, pig, rabbit, eats berry bushes, fish from water
habitat:    forest, near water
activity:   diurnal (day)
social:     solitary
speed:      0.25 (slow, but devastating in combat)
health:     200
attack:     35
flee_below: 15% health (almost never flees)
behavior:
  - roams home range (~15 tile radius)
  - eats berries when hunger < 60 (peaceful foraging)
  - hunts prey when hunger < 30 (switches to predator mode)
  - attacks agents only if cornered, starving, or agent enters 2-tile radius
  - sleeps at night in forest tiles
drops:      → see DROPS_AND_MATERIALS.md (meat 12, bone 6, hide 4, fat 5, sinew 3, teeth 4)
```

#### 2. Tiger
```
sprite:     tiger/
size:       large
diet:       carnivore — hunts deer, pig, goat, sheep, cow
habitat:    deep forest
activity:   crepuscular (dawn/dusk, +night)
social:     solitary, territorial
speed:      0.55 (fast ambush)
health:     160
attack:     40
flee_below: 20% health
behavior:
  - patrols territory (~20 tile radius), marks boundaries
  - stalks prey: moves slowly toward target, then burst sprint (2× speed for 3 sec)
  - avoids groups: won't attack if 3+ agents/animals clustered
  - extremely dangerous at night — expanded detection range
  - fights other tigers that enter territory
drops:      → see DROPS_AND_MATERIALS.md (meat 8, bone 5, hide 5, sinew 3, teeth 5)
```

#### 3. Alligator
```
sprite:     alligator/
size:       large
diet:       carnivore — ambushes anything near water (duck, deer, pig, agents)
habitat:    water edges ONLY (spawns on sand/grass adjacent to water)
activity:   diurnal
social:     solitary
speed:      0.15 in water-adjacent tiles, 0.08 on land (nearly immobile)
health:     180
attack:     45 (highest single-hit damage)
flee_below: never flees
behavior:
  - sits motionless on water edge tiles (appears as scenery)
  - when prey enters 2-tile radius: lunge attack (instant, no chase)
  - cannot pursue beyond 3 tiles from water — returns to water edge
  - eats, then goes dormant for ~60 seconds (digesting)
  - agents learn to avoid water edges
drops:      → see DROPS_AND_MATERIALS.md (meat 14, bone 4, scales 8, fat 3, teeth 6)
```

---

### Tier: Mid Predators (4)

Dangerous to small prey, nuisance to agents. Won't attack agents unless cornered.

#### 4. Fox
```
sprite:     fox/
size:       small
diet:       carnivore/scavenger — hunts rabbit, chicken, duck, rat; steals agent food
habitat:    forest edge, grassland
activity:   crepuscular (dawn/dusk)
social:     solitary or pair
speed:      0.50 (fast)
health:     40
attack:     10
flee_below: 50% health (cowardly)
behavior:
  - opportunistic: hunts weakest available prey
  - steals from agent campfires/workbenches if unguarded (takes 1 food)
  - flees from anything larger than itself
  - smart pathing: avoids open ground, prefers forest cover
  - den near forest edge — returns when full or scared
drops:      → see DROPS_AND_MATERIALS.md (meat 3, bone 2, hide 2, sinew 1, teeth 1)
```

#### 5. Cat (Wild)
```
sprite:     cat/
size:       small
diet:       carnivore — hunts rat, rabbit, squirrel, hamster
habitat:    forest, near settlements
activity:   nocturnal
social:     solitary
speed:      0.45
health:     25
attack:     8
flee_below: 40% health
behavior:
  - hunts at night, sleeps during day in sheltered tiles (under trees, in buildings)
  - attracted to agent settlements (warmth, rodents)
  - can be tamed: if agent feeds it 3× food over time, becomes passive
  - tamed cats reduce rat/squirrel population near settlement
  - hisses (warning) before fleeing — gives agents a sound cue
drops:      → see DROPS_AND_MATERIALS.md (meat 2, bone 1, hide 1, sinew 1, teeth 1)
tameable:   yes (passive after 3 feedings)
```

#### 6. Dog (Wolf)
```
sprite:     dog-0/
size:       medium
diet:       carnivore — hunts deer, rabbit, sheep in packs
habitat:    forest, grassland
activity:   nocturnal + crepuscular
social:     PACK (3-6 members) — this is the key differentiator
speed:      0.45
health:     60
attack:     15
flee_below: 30% health (braver in packs)
behavior:
  - pack behavior: travels in groups of 3-6
  - pack confidence: attack × (pack_size * 0.5) — a pack of 5 hits like 37 damage
  - lone wolf: if separated from pack, becomes cautious (flee_below rises to 60%)
  - pack hunts large prey cooperatively: surround, then attack from multiple sides
  - howl mechanic: when one detects prey, howls → pack members within 15 tiles converge
  - avoids agent groups of 3+
  - can be tamed: individual separated from pack, fed 5× food
drops:      → see DROPS_AND_MATERIALS.md (meat 5, bone 3, hide 3, sinew 2, teeth 2)
tameable:   yes (lone wolf only, 5 feedings)
```

#### 7. Rat
```
sprite:     rat/
size:       tiny
diet:       omnivore/scavenger — eats agent food stores, seeds, berries, corpses
habitat:    everywhere, prefers settlements and forests
activity:   nocturnal
social:     swarm (loose groups of 3-10)
speed:      0.35
health:     8
attack:     2
flee_below: 70% health (flees from everything)
behavior:
  - breeds rapidly: 1 litter every 120 seconds if food available (2-4 offspring)
  - attracted to agent food stores — eats from campfires/workbenches
  - disease vector (future): agents near rats have small health drain
  - prey for: cat, fox, owl (if added), snake
  - population explodes if unchecked → drains settlement food
  - the "pest" archetype: agents WANT to kill these
drops:      → see DROPS_AND_MATERIALS.md (meat 1, fat 1)
```

---

### Tier: Large Herbivores (3)

Valuable to agents — lots of food, can potentially be domesticated. Dangerous when threatened.

#### 8. Deer
```
sprite:     deer/
size:       medium
diet:       herbivore — eats grass tiles, berry bushes, edible flowers
habitat:    forest edge, grassland
activity:   crepuscular (dawn/dusk)
social:     herd (4-8, gender-segregated outside mating)
speed:      0.55 (fastest herbivore — escape specialist)
health:     60
attack:     12 (antler charge, males only)
flee_below: 80% health (extremely flighty)
behavior:
  - herd grazing: group moves together to food-rich areas
  - sentinel system: 1 deer in herd always in "alert" state (detects threats at 12 tiles)
  - when sentinel detects threat: entire herd bolts in opposite direction
  - stag defense: male deer charges predators threatening fawns (rare, brave)
  - fast zigzag escape pattern — hard for predators to path toward
  - valuable hunt target for agents: best food-per-kill ratio
drops:      → see DROPS_AND_MATERIALS.md (meat 8, bone 4, hide 4, sinew 3, teeth 2)
```

#### 9. Cow
```
sprite:     cow-0/
size:       large
diet:       herbivore — eats grass (converts grass to dirt over time!)
habitat:    grassland, plains
activity:   diurnal
social:     herd (5-12)
speed:      0.20 (slow)
health:     120
attack:     15 (charge/kick)
flee_below: 40% (stands ground longer than deer)
behavior:
  - slow grazer: stays in one area, eats grass → tile temporarily becomes dirt
  - herd sticks together tightly — safety in numbers
  - mother-calf bond: mothers aggressively defend calves (attack doubles)
  - stampede: if 3+ cows spooked simultaneously, herd runs in one direction
    stampede damages anything in path (agents, fences, small animals)
  - can be domesticated with sustained feeding + proximity
drops:      → see DROPS_AND_MATERIALS.md (meat 14, bone 6, hide 6, fat 6, sinew 4)
tameable:   yes (feed 5× + stay near for 300 ticks)
```

#### 10. Horse
```
sprite:     horse/
size:       large
diet:       herbivore — eats grass
habitat:    open grassland (avoids dense forest)
activity:   diurnal
social:     herd (3-8, led by dominant stallion)
speed:      0.65 (FASTEST animal in the game)
health:     100
attack:     18 (rear kick)
flee_below: 60% (prefers flight over fight)
behavior:
  - always moving: horses rarely stand still, constant slow patrol
  - bolt response: fastest escape in game — no predator can catch a healthy horse
  - stallion charges threats to herd, then retreats
  - can be tamed: requires extended proximity (500 ticks near agent) + food
  - TAMED BONUS: agent moves 2× speed when "riding" (future mechanic)
drops:      → see DROPS_AND_MATERIALS.md (meat 10, bone 6, hide 5, sinew 4, fat 3)
tameable:   yes (longest taming process — 500 ticks proximity + 8 food)
```

---

### Tier: Medium Herbivores (4)

Common, herdable, the "livestock" tier. Good food source, manageable danger.

#### 11. Pig (Wild Boar)
```
sprite:     pig/
size:       medium
diet:       omnivore — eats mushrooms, roots (digs on grass/dirt), berries, carrion
habitat:    forest, forest edge
activity:   diurnal
social:     sounder (group of 4-8)
speed:      0.35
health:     80
attack:     20 (tusk charge — surprisingly dangerous!)
flee_below: 25% (very aggressive, fights before fleeing)
behavior:
  - rooting: digs in grass/dirt tiles for food (small chance to uncover seeds)
  - AGGRESSIVE when cornered or when piglets present
  - charges in straight line — predictable but hits hard
  - group defense: sounder circles young, adults face outward
  - eats mushrooms (including poison mushrooms — immune to poison!)
  - valuable but risky hunt target
drops:      → see DROPS_AND_MATERIALS.md (meat 8, bone 3, hide 2, fat 5, sinew 2, teeth 2)
```

#### 12. Goat
```
sprite:     goat/
size:       medium
diet:       herbivore — eats ANYTHING plant-based (grass, bushes, flowers, herbs, bark)
habitat:    rocky areas, hills, dirt patches
activity:   diurnal
social:     herd (3-6)
speed:      0.40
health:     50
attack:     10 (headbutt)
flee_below: 50%
behavior:
  - climbs: ignores some terrain penalties (rocks, steep areas)
  - eats everything: will consume hunger herbs, stamina herbs, flowers — competes with agents!
  - headbutt defense: rams predators, small knockback effect
  - stubborn: sometimes ignores flee response for 1-2 seconds (personality quirk)
  - easy to tame with food, but eats your garden
drops:      → see DROPS_AND_MATERIALS.md (meat 5, bone 3, hide 3, sinew 2, teeth 1)
tameable:   yes (3 feedings, but will eat your crops)
```

#### 13. Sheep
```
sprite:     sheep/
size:       medium
diet:       herbivore — eats grass
habitat:    grassland, gentle terrain
activity:   diurnal
social:     flock (6-15 — LARGEST groups)
speed:      0.25
health:     35
attack:     3 (basically defenseless)
flee_below: 90% (panics immediately)
behavior:
  - extreme flocking: never more than 3 tiles from nearest flock member
  - panic cascade: one sheep panics → entire flock panics → chaos scatter
  - after panic: slowly regroup over 30 seconds
  - completely defenseless — relies on numbers and early detection
  - easy prey for everything, easy tame for agents
  - wool resource (future): shearable when tamed
drops:      → see DROPS_AND_MATERIALS.md (meat 4, bone 2, hide 4, fat 3, sinew 1)
tameable:   yes (2 feedings — easiest tame)
```

#### 14. Donkey
```
sprite:     donkey/
size:       medium-large
diet:       herbivore — eats grass, tough plants
habitat:    grassland, rocky edges
activity:   diurnal
social:     small herd (2-4)
speed:      0.30
health:     90
attack:     16 (powerful kick)
flee_below: 30% (stubborn fighter)
behavior:
  - guardian instinct: if tamed and placed near sheep/chicken, actively DEFENDS them
  - powerful kick: can kill fox, rat, or cat in 2 hits
  - brays (alert sound) when predator detected — warns entire area
  - stubborn: occasionally refuses to move for 5-10 seconds (personality)
  - the "guard animal" — agents tame donkeys to protect livestock
drops:      → see DROPS_AND_MATERIALS.md (meat 7, bone 4, hide 4, sinew 3)
tameable:   yes (4 feedings — becomes guard animal)
```

---

### Tier: Small Prey (6)

Fast breeders, easy kills, bottom of the food chain. Ecosystem backbone.

#### 15. Rabbit
```
sprite:     rabbit/
size:       tiny
diet:       herbivore — eats grass, flowers, hunger herbs
habitat:    grassland, forest edge
activity:   crepuscular
social:     colony (loose groups near warren)
speed:      0.50 (fast burst, tires quickly)
health:     12
attack:     0 (cannot fight)
flee_below: 100% (ALWAYS flees from everything)
behavior:
  - warren: creates burrow on grass tiles (invisible, just a "home" marker)
  - breeds fast: 1 litter every 90 seconds (2-3 offspring) if near warren + food
  - zigzag escape: randomized flee direction, hard to predict
  - freezes for 1 second when first detecting threat (realistic freeze response)
  - population booms if predators suppressed → eats all the herbs
  - the ecosystem "canary" — if rabbits disappear, something is wrong
drops:      → see DROPS_AND_MATERIALS.md (meat 2, bone 1, hide 1)
```

#### 16. Chicken
```
sprite:     chicken/
size:       tiny
diet:       omnivore — eats seeds, insects (grass tiles), mushrooms
habitat:    grassland, near settlements
activity:   diurnal
social:     flock (3-8)
speed:      0.20 (slowest animal — can't really escape)
health:     15
attack:     1 (peck, pathetic)
flee_below: 80%
behavior:
  - ground nester: stays on grass tiles, scratches ground for food
  - eggs: produces 1 egg every 180 seconds if well-fed (egg = 2 food, no kill needed)
  - attracted to agent settlements (food scraps, warmth)
  - nearly defenseless — depends on being near agents or donkeys
  - rooster variant (future): alerts flock to predators
drops:      → see DROPS_AND_MATERIALS.md (meat 2, bone 1, feathers 3, fat 1) + periodic eggs
tameable:   yes (1 feeding — trivially easy)
egg_rate:   1 egg per 180 seconds (2 food each)
```

#### 17. Duck
```
sprite:     duck/
size:       tiny
diet:       omnivore — eats water plants (water-adjacent tiles), seeds, insects
habitat:    water edges, ponds
activity:   diurnal
social:     flock (4-10)
speed:      0.30 land / 0.45 water-adjacent (faster near water)
health:     15
attack:     1
flee_below: 80%
behavior:
  - water escape: when threatened, moves TO water (predators can't follow into water)
  - forages on water-edge tiles — natural niche that avoids competition
  - eggs: like chickens, produces eggs near water nests (1 per 200 seconds)
  - flock V-formation when moving between water bodies
  - coexists with alligator risk — ducks near water = alligator ambush bait
drops:      → see DROPS_AND_MATERIALS.md (meat 2, bone 1, feathers 4, fat 2) + periodic eggs
tameable:   yes (2 feedings near water)
```

#### 18. Squirrel
```
sprite:     squirrel/
size:       tiny
diet:       herbivore — eats seeds, nuts (from tree tiles), berries
habitat:    forest ONLY (won't leave tree cover)
activity:   diurnal
social:     solitary or pair
speed:      0.45
health:     10
attack:     0
flee_below: 100% (always flees)
behavior:
  - tree escape: flees TO nearest tree tile (becomes untargetable for 5 sec in tree)
  - hoards: carries seeds, occasionally drops them → new plants grow (ecosystem service!)
  - acorn mechanic: squirrels near trees cause random seed drops within 5 tiles
  - only exists in forested areas — deforestation kills squirrel population
  - indicator species: lots of squirrels = healthy forest
drops:      → see DROPS_AND_MATERIALS.md (meat 1, hide 1)
ecosystem:  seed dispersal (plants grow near squirrel routes)
```

#### 19. Hedgehog
```
sprite:     hedgehog/
size:       tiny
diet:       omnivore — eats mushrooms, insects (grass), berries
habitat:    forest edge, bushes
activity:   nocturnal
social:     solitary
speed:      0.15 (SLOWEST animal)
health:     20
attack:     0
flee_below: never flees — uses CURL defense
behavior:
  - curl defense: when threatened, curls into ball (takes 50% reduced damage for 10 sec)
  - slow but hardy — survives via defense, not escape
  - eats poison mushrooms safely (immune, like pigs)
  - nocturnal forager: only moves at night
  - adorable and useless — agents gain no reason to kill, no reason to tame
  - the "leave it alone" animal
drops:      → see DROPS_AND_MATERIALS.md (meat 1, bone 1, teeth 1)
```

#### 20. Capybara
```
sprite:     capybara/
size:       medium
diet:       herbivore — eats grass, water plants
habitat:    water edges, grassland near water
activity:   diurnal
social:     group (4-8 — very social)
speed:      0.25 land / 0.40 water-adjacent
health:     45
attack:     3 (basically won't fight)
flee_below: 70%
behavior:
  - universal friend: ALL animals have reduced aggression within 3 tiles of capybara
    predators near capybara are 50% less likely to attack other prey
  - water affinity: stays near water, faster at water edges
  - social grooming: capybara groups passively restore 1 social need to nearby agents
  - group rest: entire group rests together in sunlit water-edge tiles
  - the "peace" animal — agents want capybaras near their settlement
drops:      → see DROPS_AND_MATERIALS.md (meat 5, bone 2, hide 3, fat 3)
aura:       aggression suppression (3-tile radius), agent social boost
```

---

## Base Stats & Progression

Animals use the same stat + skill system as agents (see **PROGRESSION.md** for full formulas). Key points:

### Per-Species Base Stat Ranges

Each species defines a range for 6 base stats, rolled at birth:

```
SPECIES         STR    TGH    AGI    END    PER    CHA
──────────────────────────────────────────────────────
Bear            18-25  15-20  5-10   12-18  8-12   3-6
Tiger           16-22  12-16  14-20  10-15  12-18  2-5
Alligator       20-28  18-24  2-5    15-20  6-10   1-3
Fox             4-8    3-6    12-16  8-12   14-18  5-10
Cat             3-6    3-5    14-18  6-10   16-20  8-14
Dog/Wolf        8-14   6-10   10-14  10-15  10-14  10-16
Rat             1-3    1-2    8-12   6-10   10-14  3-8
Deer            5-10   5-8    16-22  12-16  14-18  8-12
Cow             10-16  12-18  3-6    14-20  4-8    6-10
Horse           8-14   8-12   18-24  16-22  8-12   6-10
Pig/Boar        10-16  8-14   6-10   10-16  8-12   4-8
Goat            6-10   6-10   10-14  10-14  8-12   5-8
Sheep           2-5    3-6    6-10   8-12   8-14   10-16
Donkey          10-14  10-14  6-10   14-18  8-12   6-10
Rabbit          1-2    1-2    14-20  8-12   16-20  6-10
Chicken         1-2    1-2    4-8    5-8    8-12   5-8
Duck            1-2    1-2    6-10   6-10   8-12   6-10
Squirrel        1-2    1-2    16-20  6-10   14-18  4-8
Hedgehog        1-2    6-12   2-4    8-14   10-14  3-6
Capybara        2-5    4-8    5-10   8-14   8-12   14-20

STR=Strength TGH=Toughness AGI=Agility END=Endurance PER=Perception CHA=Charisma
```

Design notes: predators have high STR, prey have high AGI/PER, social animals have high CHA. Alligator has the highest STR but the lowest AGI — immense ambush power, nearly immobile. Horse has the highest AGI in the game. Capybara has the highest CHA (peace aura).

### Skill Caps Per Tier

Animals can't learn all skills. See PROGRESSION.md "Animal Skill Caps" for the full table. Summary: apex predators cap Combat at 80, small prey cap Athletics at 60, no animal can learn Woodcutting/Mining/Building/Crafting (those are agent-only).

### How Stats Affect Behavior

Effective stats (base + skill bonus) feed directly into the AI layers:

```
effective_strength  → attack damage, harvest speed (GOAP action costs)
effective_toughness → damage reduction formula, max health bonus
effective_agility   → move speed, dodge chance, flee success (steering layer)
effective_endurance → max stamina, stamina regen, GOAP energy budgeting
effective_perception → detection range, foraging yield (utility scoring)
effective_charisma  → pack cohesion strength, taming resistance (social utility)
```

Old animals with high skill levels have meaningfully different stats than newborns — a veteran wolf pack alpha with Combat 38 and Athletics 31 hits harder, runs faster, and plans better routes than a fresh spawn.

---

## Behavior System Architecture

Every animal runs the same four-layer decision engine, configured entirely by species data. No special code per species — just config + response curves. This architecture is designed to produce animals that are "1000× smarter" than the current priority-list agents. The key insight: agents die because they react to crises instead of preventing them. Animals must plan ahead.

### Why Not a Simple Priority List

The current agent NeedsSystem uses fixed priority numbers: "if hunger < 20, eat (priority 90)." This creates two fatal patterns:

1. **Cliff behavior** — an agent at 21 hunger ignores food entirely, then at 19 hunger drops everything. No gradual response.
2. **No planning** — the agent picks the best action *this tick* with no concept of "if I walk 30 tiles for food, I'll run out of stamina and die on the way back."

Animals replace this with a hybrid of four systems that work together:

```
┌──────────────────────────────────────────────────────┐
│                   DECISION PIPELINE                   │
│                                                      │
│  ┌─────────────┐   What should I do right now?       │
│  │ UTILITY AI  │   Scores every possible action      │
│  │ (immediate) │   using smooth response curves.     │
│  └──────┬──────┘   Output: ranked action list.       │
│         │                                            │
│  ┌──────▼──────┐   Can I chain actions for a goal?   │
│  │    GOAP     │   Plans multi-step sequences.       │
│  │ (planning)  │   Output: action queue.             │
│  └──────┬──────┘                                     │
│         │                                            │
│  ┌──────▼──────┐   Where do I remember resources?    │
│  │   MEMORY    │   Spatial map of food, water,       │
│  │ (knowledge) │   danger zones. Decays over time.   │
│  └──────┬──────┘                                     │
│         │                                            │
│  ┌──────▼──────┐   How do I move there smoothly?     │
│  │  STEERING   │   Boids flocking, obstacle          │
│  │ (movement)  │   avoidance, flee vectors.          │
│  └─────────────┘                                     │
└──────────────────────────────────────────────────────┘
```

### Animal State

```typescript
interface AnimalState {
  id: string;
  species: AnimalSpecies;           // config reference
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  hunger: number;                   // 0-100
  thirst: number;                   // 0-100
  stamina: number;                  // 0-100
  action: AnimalAction;             // current output action
  actionTimer: number;              // ticks remaining in current action
  target?: { x: number; y: number };
  targetEntityId?: string;          // prey/threat/resource ID
  packId?: string;                  // for social animals
  homeX: number;                    // center of home range
  homeY: number;
  tamed: boolean;
  tamedBy?: string;                 // agent ID
  tamingProgress: number;           // 0 to species.tamingCost
  age: number;                      // ticks alive
  breedCooldown: number;            // ticks until can breed again
  alive: boolean;

  // --- Smart AI additions ---
  memory: SpatialMemory;            // remembered resource locations
  currentPlan: GOAPPlan | null;     // multi-step action plan
  planCooldown: number;             // ticks until next replan (avoid thrashing)
  energyBudget: number;             // estimated stamina cost of current plan
  dangerMap: DangerMemory[];        // remembered threat locations
  lastAteAt?: { x: number; y: number; tick: number };
  lastDrankAt?: { x: number; y: number; tick: number };
}
```

### Action States

Actions are the *output* of the decision pipeline, not the decision mechanism itself. An animal is always performing exactly one action:

```
IDLE        — standing, scanning surroundings. Brief pauses between decisions.
GRAZING     — eating food at current tile. Herbivores/omnivores.
HUNTING     — pursuing prey. Predators only.
FLEEING     — running from threat. Direction computed by steering layer.
FIGHTING    — engaged in combat. Locked until one party flees or dies.
DRINKING    — at water edge, restoring thirst.
SLEEPING    — inactive. Reduced detection. Restores stamina.
WANDERING   — exploring, with bias toward unexplored areas.
BREEDING    — near mate, producing offspring.
CURLED      — hedgehog defense mode. Damage reduction.
STALKING    — pre-hunt stealth approach. Tiger/alligator.
FOLLOWING   — tamed animal following owner agent. Suppressed when animal has urgent survival needs (hunger/thirst < 40) — animal eats/drinks first, then catches up. Owner waits in place while pet handles survival.
GUARDING    — tamed donkey defending area.
TRAVELING   — moving to a remembered or planned destination (not random).
```

---

### Layer 1: Utility AI (Immediate Decisions)

Every tick, each possible action gets a **utility score** from 0.0 to 1.0, computed by smooth response curves — not boolean thresholds. The highest-scoring action wins.

#### Response Curves

Each need maps to a utility score via a curve function. The curve shape determines *when* the animal starts caring about that need:

```
QUADRATIC (aggressive preemption):
  score(need) = (1 - need/100)²
  → At 60% hunger: score = 0.16 (already noticeable)
  → At 40% hunger: score = 0.36 (strong motivation)
  → At 20% hunger: score = 0.64 (urgent)
  → At 10% hunger: score = 0.81 (critical)

LINEAR (steady response):
  score(need) = 1 - need/100
  → Used for thirst (water is usually nearby)

LOGISTIC (sudden onset):
  score(need) = 1 / (1 + e^(0.15 * (need - 30)))
  → Near-zero above 50, ramps sharply below 30
  → Used for flee/fight triggers
```

The key difference from priority lists: a quadratic hunger curve means an animal at 60% hunger already scores 0.16 for "seek food." It won't drop everything, but if no other action scores higher, it'll opportunistically forage on the way to wherever it's going. By 40% hunger it's actively seeking food. By 20% it's desperate. No cliff, no surprises.

#### Utility Scoring Table

```
ACTION          SCORE FORMULA                                        NOTES
─────────────────────────────────────────────────────────────────────────────
seek_food       (1 - hunger/100)² × diet_modifier                   quadratic
seek_water      (1 - thirst/100) × 1.2                              linear, scaled up
rest            (1 - stamina/100)² × 0.8                            quadratic, damped
flee            logistic(threat_proximity) × threat_severity         sudden onset
fight           logistic(threat_proximity) × courage × cornered     predators prefer
hunt            (1 - hunger/100)² × prey_available × 0.9            only if prey near
socialize       (1 - pack_distance/range)² × species.social_weight  pack animals only
breed           breed_readiness × mate_proximity × 0.4              low base priority
guard           tamed × threat_near_ward × 0.85                     donkey special
sleep           activity_cycle_score × (1 - stamina/100) × 0.7     time-gated
explore         base_curiosity × (1 - familiarity) × 0.3            fills memory map
follow_owner    tamed × owner_distance × 0.6                        tamed animals
```

#### Personality Modifiers (per species)

Species config includes multipliers that shift the utility curves:

```typescript
utilityWeights: {
  food: 1.0,      // bear: 0.8 (relaxed forager), rabbit: 1.3 (always nibbling)
  water: 1.0,
  safety: 1.0,    // sheep: 1.8 (hyper-vigilant), bear: 0.4 (fears nothing)
  social: 1.0,    // capybara: 1.5, cat: 0.2 (solitary)
  explore: 1.0,   // fox: 1.4 (curious), alligator: 0.1 (sits and waits)
  aggression: 1.0 // tiger: 1.6, hedgehog: 0.0
}
```

#### Preemptive Behavior (The Core Upgrade)

With quadratic curves, animals naturally exhibit "smart" behavior without special code:

- **Bear at 55% hunger** → food score = 0.20. If nothing else scores higher, bear wanders toward remembered berry bush location. Arrives at 40% hunger, eats. Never hits crisis.
- **Deer at 70% thirst** → water score = 0.36. Herd drifts toward remembered water source while grazing. Arrives well before crisis.
- **Rabbit at 80% hunger** → food score = 0.04. Ignores it (still high). At 50%: score = 0.25, starts actively foraging. Plenty of time.

Compare to current agents: agent at 21% hunger does nothing. Agent at 19% hunger panics. That's why they die.

---

### Layer 2: GOAP (Multi-Step Planning)

Utility AI picks *what* to do. GOAP figures out *how*, when the goal requires multiple steps.

#### How It Works

GOAP defines the world as a set of boolean/numeric conditions, and actions as transitions between conditions. The planner searches backward from the goal to find a sequence of actions that gets there from the current state.

```
GOAL: hunger > 60

CURRENT STATE:
  hunger = 25
  position = (40, 30)
  nearest_food_memory = berry_bush at (55, 42), distance = 18
  stamina = 45

PLANNER SEARCHES:
  Action "eat_food"
    precondition: adjacent_to_food = true
    effect: hunger += 30
    cost: 1

  Action "travel_to_food"
    precondition: food_location_known = true
    effect: adjacent_to_food = true
    cost: distance × stamina_cost_per_tile  ← energy budget!

  Action "forage_nearby"
    precondition: none (always available)
    effect: food_location_known = true (probabilistic)
    cost: 10 + random_search_penalty

PLAN OUTPUT:
  1. travel_to_food(55, 42)  — cost: 18 × 0.5 = 9 stamina
  2. eat_food                — cost: 1
  TOTAL COST: 10 stamina (affordable at stamina=45) ✓
```

#### Energy Budgeting

Before committing to a plan, the animal checks:

```
estimated_cost = sum(action.stamina_cost for action in plan)

if estimated_cost > stamina * 0.7:
  REJECT plan — not enough energy margin
  → look for closer alternative
  → or rest first, then replan

if estimated_cost > stamina * 0.5 AND hunger < 30:
  REJECT plan — too risky when already hungry
  → prefer closer, safer option even if less optimal
```

This prevents the fatal "walk 50 tiles for food, collapse from exhaustion on the way" pattern.

#### When to Replan

Animals don't replan every tick (expensive). Replanning triggers:

```
REPLAN when:
  - Current plan completes or fails
  - Any need drops below 20% (emergency override)
  - Threat detected (immediate flee/fight, plan abandoned)
  - Plan cost exceeds remaining stamina
  - 50 ticks since last plan (staleness check)
  - Memory updated with better resource location
```

#### GOAP Action Library

```
ACTION              PRECONDITIONS                     EFFECTS                 COST
────────────────────────────────────────────────────────────────────────────────────
travel_to(x,y)      knows location                    at(x,y)                 distance × move_cost
eat_plant           adjacent to plant                 hunger += plant.value   1
eat_prey            prey.health <= 0, adjacent        hunger += prey.food     1
hunt_prey           prey visible, stamina > 30        prey.health -= attack   stamina_per_attack
drink               adjacent to water                 thirst += 30            1
rest                safe location (no threats)        stamina += rest_rate    time_cost
flee_to(x,y)        threat detected                   distance_from_threat++  stamina × 0.8
stalk_toward(x,y)   prey visible, not detected        closer_to_prey          stamina × 0.3
forage_area(x,y)    none                              discover food (maybe)   exploration_cost
regroup             pack exists                       near_pack = true        distance_to_pack
```

---

### Layer 3: Spatial Memory

Animals remember where resources and threats are. Memory decays over time so animals don't rely on stale information forever.

```typescript
interface SpatialMemory {
  foodSources: MemoryEntry[];     // remembered food locations
  waterSources: MemoryEntry[];    // remembered water locations
  dangerZones: MemoryEntry[];     // where predators/threats were seen
  safeSleepSpots: MemoryEntry[];  // where the animal slept safely before
  packLastSeen?: { x: number; y: number; tick: number };
}

interface MemoryEntry {
  x: number;
  y: number;
  type: string;          // 'berry_bush', 'water_edge', 'tiger', etc.
  value: number;         // how good/bad (food amount, threat level)
  lastSeen: number;      // tick when last observed
  confidence: number;    // 0-1, decays over time
  visits: number;        // how many times visited
}
```

#### Memory Rules

```
RECORDING:
  When animal eats food:     add/update foodSources entry, confidence = 1.0
  When animal drinks water:  add/update waterSources entry, confidence = 1.0
  When animal sees predator: add dangerZones entry, confidence = 1.0
  When animal sleeps safely: add safeSleepSpots entry

DECAY:
  Every 100 ticks: confidence -= 0.05 for food (food gets eaten/depleted)
  Every 200 ticks: confidence -= 0.05 for water (water is stable)
  Every 50 ticks:  confidence -= 0.1 for danger (threats move)
  When confidence < 0.1: remove entry

CAPACITY:
  Max 20 food memories, 10 water memories, 10 danger memories per animal
  When full: replace lowest-confidence entry

SHARING (pack animals only):
  When two pack members are adjacent:
    each shares their highest-confidence food/water memory
    received memories start at 0.5 confidence (secondhand info)
```

#### How Memory Drives Decisions

When the utility layer says "seek food" and GOAP needs a destination:

```
1. Check foodSources for highest (confidence × value / distance) entry
2. If found → GOAP plans route to that location
3. If not found → animal enters WANDERING with explore bias
   → while wandering, scan for food within detection range
   → when food found, record to memory and switch to approach

This is why animals get smarter over time: a bear that has lived 5 minutes
knows where 8 berry bushes and 3 water sources are. A newborn knows nothing
and has to explore. Older animals survive better — emergent "wisdom."
```

---

### Layer 4: Steering Behaviors (Movement)

Once the decision pipeline picks an action and destination, the steering layer handles *how* the animal moves there. This replaces raw A* for most movement, with A* as a fallback for long-distance pathfinding.

#### Base Behaviors

```
SEEK(target)        — steer toward target position
FLEE(threat)        — steer directly away from threat
ARRIVE(target)      — seek but decelerate as you get close
WANDER              — gentle random drift (Perlin noise heading changes)
PURSUE(target)      — seek where the target WILL BE (velocity prediction)
EVADE(threat)       — flee from where the threat WILL BE
```

#### Flocking Behaviors (herds, packs, flocks)

Social animals combine three forces every tick:

```
SEPARATION  — steer away from nearby flockmates (avoid crowding)
             force = sum(away_from_neighbor / distance²) for neighbors within 2 tiles
             weight: 1.5

ALIGNMENT   — steer toward average heading of nearby flockmates
             force = average(neighbor.velocity) - this.velocity
             weight: 1.0

COHESION    — steer toward center of nearby flockmates
             force = center_of_neighbors - this.position
             weight: 0.8

FINAL_VELOCITY = normalize(
  separation * 1.5 +
  alignment * 1.0 +
  cohesion * 0.8 +
  goal_seek * 1.2     // the actual destination from GOAP/utility
) × species.speed
```

This produces natural-looking herd movement: deer graze together, drift as a group toward water, scatter realistically when a predator appears, then slowly reform.

#### Species-Specific Steering

```
DEER:     high separation (spread out), high alignment (synchronized movement)
          flee behavior: zigzag modifier (±30° random deviation every 5 ticks)

SHEEP:    low separation (crowd together), very high cohesion (tight flock)
          panic cascade: when one flees, ALL within 8 tiles flee same direction

WOLF:     moderate all three + PURSUE behavior during hunts
          pack hunt: surround pattern — each wolf seeks a point around the prey

COW:      high cohesion, low alignment (blob movement, not V-formation)
          stampede: when 3+ flee simultaneously, override with shared direction

HORSE:    high alignment (move in sync), moderate separation
          bolt: 2× speed flee, straight line, no zigzag

ALLIGATOR: no flocking. WAIT behavior — stationary until prey in range, then PURSUE for max 3 tiles

TIGER:    no flocking. STALK behavior — slow SEEK at 0.3× speed, then PURSUE burst at 2× for 3 seconds
```

---

### Threat Detection and Combat

These use the same formulas as before, but now threat detection feeds into the utility scoring system instead of being a hard priority override.

#### Threat Detection

```
detection_range = species.detectionRange (6-15 tiles)

for each entity within detection_range:
  threat_level = 0.0  // 0-1 scale now

  if entity is predator of this species:
    threat_level = clamp(entity.attack / this.health, 0, 1)

  if entity is agent:
    threat_level = 0.3  (neutral caution)
    if agent is actively attacking nearby: threat_level = 0.9

  if entity.species == this.species AND is rival:
    threat_level = 0.2

  // Modifiers
  if near capybara (3 tiles): threat_level *= 0.5
  if in pack: threat_level *= 1 / sqrt(pack_size)
  if is nocturnal AND daytime: threat_level *= 0.5
  if is mother with young: threat_level *= 1.5 (more alert, not less)

  // Feed into utility system
  flee_utility = logistic(threat_level) × species.utilityWeights.safety
  fight_utility = logistic(threat_level) × species.utilityWeights.aggression × courage

  // These compete with ALL other utilities — a hungry bear might ignore a low threat
  // A sheep with safety weight 1.8 will flee from much lower threat levels than a bear
```

#### Fight vs. Flight

Now emergent from utility scores instead of a hardcoded threshold:

```
courage = (health / maxHealth) × species.utilityWeights.aggression

// Pack bonus
if pack_size > 1:
  courage += pack_size * 0.1

// Mother defense
if has_nearby_young:
  courage += 0.4

fight_utility = threat_level × courage
flee_utility = threat_level × (1 - courage) × species.utilityWeights.safety

// The animal fights if fight_utility > flee_utility AND fight_utility is top action
// This means a bear (aggression: 1.6, safety: 0.4) almost always fights
// A sheep (aggression: 0.1, safety: 1.8) almost always flees
// A wolf in a pack of 5: courage boosted enough to take on a deer
```

#### Combat

```
// Per-tick combat (when FIGHTING)
damage = species.attack × (0.8 + random(0.4))  // ±20% variance

// Damage modifiers
if is_pack AND pack_nearby: damage *= (1 + pack_size × 0.3)
if is_ambush AND first_strike: damage *= 2.0  // tiger/alligator ambush bonus
if target_is_curled: damage *= 0.5  // hedgehog defense
if target_is_fleeing: damage *= 1.2  // back attack bonus

// Combat resolution
target.health -= damage
if target.health <= 0:
  target dies, drop resources
  attacker gains food = target.species.foodDrop × 10 hunger points
  attacker records danger zone at combat location
```

### Risk Assessment

Before traveling, animals evaluate path safety using their danger memory:

```
path_risk(from, to) =
  sum(
    danger.value × danger.confidence / distance_to_danger²
    for danger in memory.dangerZones
    if danger is within 5 tiles of the straight-line path
  )

// Used by GOAP planner as an action cost modifier:
travel_cost = base_distance_cost × (1 + path_risk × 3)

// High-risk paths become "expensive" — the planner prefers safer routes
// even if they're longer. A deer won't walk past a remembered tiger location
// to reach a berry bush when there's a safer bush in the other direction.
```

### Breeding

Breeding is scored by the utility system like everything else, but with lower base priority:

```
breed_readiness:
  conditions (all must be true for score > 0):
    - breedCooldown == 0
    - hunger > 60
    - thirst > 50
    - no threats in detection range
    - mate of same species within 5 tiles

  if all conditions:
    breed_utility = 0.4 × mate_proximity_score
    // competes with other actions — animal won't breed if moderately hungry

when breed_utility wins:
  action = BREEDING for 30 ticks (3 seconds)
  then spawn 1-4 offspring (species.litterSize) at parent position
  offspring start at 50% parent size/health, grow over 600 ticks (1 min)
  offspring inherit parent's memory (food/water sources at 0.3 confidence)
  breedCooldown = species.breedCooldown

breed cooldowns (ticks):
  rabbit:    900   (90 sec — fast breeder)
  rat:       1200  (120 sec)
  chicken:   1500  (150 sec)
  duck:      1800  (180 sec)
  sheep:     3000  (5 min)
  deer:      6000  (10 min — slow breeder)
  cow:       6000
  horse:     9000  (15 min — slowest)
  predators: 12000 (20 min — very slow, keeps population low)
```

---

### Performance Architecture

With up to 200 animals at 10 ticks/sec, the decision pipeline must be fast.

#### Spatial Hashing (O(1) neighbor queries)

```
GRID_CELL_SIZE = 8  // tiles per hash cell

spatial_hash = Map<string, AnimalState[]>

// Every tick, rebuild hash (or update incrementally on movement):
cell_key(x, y) = `${floor(x/8)},${floor(y/8)}`

// "Find all animals within 12 tiles" becomes:
// Check 9 cells (3×3 around animal's cell) instead of scanning all 200 animals
// At 200 animals in a 120×90 world: ~1.3 animals per cell on average
// Neighbor query: ~12 comparisons instead of 200
```

#### Tick Budget

```
Per animal per tick budget: ~0.5ms (200 animals × 0.5ms = 100ms budget at 10 ticks/sec)

Utility scoring:    ~0.05ms (12 actions × simple math)
GOAP planning:      ~0.2ms  (only when replanning, amortized over 50 ticks = 0.004ms/tick)
Memory lookup:      ~0.02ms (array scan, max 20 entries)
Steering:           ~0.05ms (3 flocking forces + goal)
Spatial hash query: ~0.02ms (check 9 cells)
Pathfinding (A*):   ~0.1ms  (only for long-distance travel, cached)
──────────────────────────────
TOTAL:              ~0.15ms/tick average, ~0.5ms peak (with replanning)
```

#### Staggered Processing

Not every animal needs full processing every tick:

```
EVERY TICK:
  - Steering forces (movement must be smooth)
  - Threat detection (safety-critical)
  - Action execution (current action continues)

EVERY 5 TICKS (staggered — 1/5 of animals per tick):
  - Full utility scoring
  - Memory decay
  - Plan validity check

EVERY 50 TICKS (staggered):
  - GOAP replanning (if no emergency)
  - Pack cohesion check
  - Breeding eligibility
```

This means each tick processes: 200 animals × simple + 40 animals × medium + 4 animals × heavy. Well within the 100ms budget.

---

## Food Chain Map

```
                    ┌─────────┐
                    │  TIGER  │
                    └────┬────┘
                         │ hunts
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
     ┌────────┐    ┌─────────┐    ┌─────────┐
     │  DEER  │    │   COW   │    │  HORSE  │
     └────────┘    └─────────┘    └─────────┘

     ┌──────────┐
     │   BEAR   │ hunts deer, pig, rabbit; also eats berries
     └────┬─────┘
          │
     ┌────┴──────────────────────────┐
     ▼              ▼                ▼
┌─────────┐   ┌──────────┐    ┌──────────┐
│  DEER   │   │   PIG    │    │  RABBIT  │
└─────────┘   └──────────┘    └──────────┘

     ┌──────────────┐
     │  ALLIGATOR   │ ambushes anything near water
     └──────┬───────┘
            │
     ┌──────┴───────────┐
     ▼                  ▼
┌──────────┐      ┌──────────┐
│   DUCK   │      │   DEER   │ (at water's edge)
└──────────┘      └──────────┘

     ┌─────────┐
     │ DOG/WOLF│ pack hunts
     └────┬────┘
          │
     ┌────┴─────────────────┐
     ▼         ▼            ▼
┌────────┐ ┌───────┐  ┌─────────┐
│  DEER  │ │ SHEEP │  │ RABBIT  │
└────────┘ └───────┘  └─────────┘

     ┌───────┐
     │  FOX  │ hunts small prey, steals agent food
     └───┬───┘
         │
    ┌────┴────────────────────┐
    ▼       ▼        ▼       ▼
┌────────┐┌───────┐┌──────┐┌──────┐
│CHICKEN ││RABBIT ││ DUCK ││ RAT  │
└────────┘└───────┘└──────┘└──────┘

     ┌───────┐
     │  CAT  │ hunts rodents
     └───┬───┘
         │
    ┌────┴──────────┐
    ▼       ▼       ▼
┌──────┐┌────────┐┌──────────┐
│ RAT  ││SQUIRREL││ RABBIT   │
└──────┘└────────┘└──────────┘
```

## Population Control

The ecosystem self-balances through predation and breeding rates, but we add guardrails:

```
HARD CAPS (per world):
  Total animals:         200 max
  Per species:           species.maxPopulation (see table)
  Apex predators total:  15 max (bear + tiger + alligator combined)

SOFT BALANCE:
  If prey_count < 30:   predator breed cooldown × 2 (slow down predators)
  If prey_count > 150:  predator breed cooldown × 0.5 (speed up predators)
  If predator_count = 0: no prey breeding limit (rabbits everywhere)

SPAWN ON GENERATION:
  Based on RESOURCE_BALANCE.md formula, animals get ~5% of open land tiles as spawn points:
  Apex predators: 2-3 each (6-9 total)
  Mid predators:  3-5 each (12-20 total)
  Large herbs:    4-6 each (12-18 total)
  Medium herbs:   5-8 each (20-32 total)
  Small prey:     8-15 each (48-90 total)
  TOTAL at world gen: ~100-170 animals
```

### Max Population Per Species

| Species | Max | Breed cooldown | Litter size |
|---|---|---|---|
| Bear | 5 | 12000 ticks | 1-2 |
| Tiger | 4 | 12000 | 1 |
| Alligator | 6 | 10000 | 2-3 |
| Fox | 12 | 4000 | 2-3 |
| Cat | 10 | 5000 | 1-3 |
| Dog/Wolf | 15 | 6000 | 2-4 |
| Rat | 30 | 1200 | 2-4 |
| Deer | 20 | 6000 | 1-2 |
| Cow | 15 | 6000 | 1 |
| Horse | 10 | 9000 | 1 |
| Pig | 15 | 4000 | 2-4 |
| Goat | 12 | 4000 | 1-2 |
| Sheep | 20 | 3000 | 1-2 |
| Donkey | 8 | 6000 | 1 |
| Rabbit | 30 | 900 | 2-3 |
| Chicken | 20 | 1500 | 1-2 (+eggs) |
| Duck | 15 | 1800 | 1-3 (+eggs) |
| Squirrel | 15 | 3000 | 1-2 |
| Hedgehog | 8 | 5000 | 1-2 |
| Capybara | 12 | 4000 | 1-2 |

---

## Agent Interactions

### Hunting
Agents can target animals for food. Hunt works like harvesting: move adjacent, attack. Animal fights back or flees.

### Taming
Some animals can be tamed by feeding them repeatedly. Tamed animals follow the taming agent and provide benefits:

| Animal | Taming cost | Benefit when tamed |
|---|---|---|
| Cat | 3 food | Kills rats near settlement |
| Dog/Wolf | 5 food (lone only) | Guards agent, warns of predators, helps hunt |
| Cow | 5 food + 300 tick proximity | Periodic food (milk, future) |
| Horse | 8 food + 500 tick proximity | Agent speed ×2 (riding, future) |
| Chicken | 1 food | Eggs (2 food per 180 ticks) |
| Duck | 2 food | Eggs near water |
| Sheep | 2 food | Wool (future) |
| Goat | 3 food | Eats plants (clearing), but also your garden |
| Donkey | 4 food | Guards livestock from predators |

### Being Hunted
Predators can attack agents. Agents take damage, can fight back or flee. Low-skill agents near water at night = alligator bait. Tiger encounters at dusk = dangerous. The world is not safe.

---

## Needs Decay Rates (per tick)

Animals use the dual-hunger nutrition system (see **PROGRESSION.md "Nutrition System"**). Hunger is split into **protein** and **plant** bars, with decay modified by diet type:

| Size | Protein decay | Plant decay | Thirst decay | Stamina decay |
|---|---|---|---|---|
| Tiny | 0.04 | 0.05 | 0.10 | 0.03 |
| Small | 0.05 | 0.06 | 0.12 | 0.04 |
| Medium | 0.06 | 0.07 | 0.15 | 0.05 |
| Large | 0.08 | 0.09 | 0.18 | 0.04 |

These are **base rates** — multiplied by the species' diet modifier (carnivore: protein ×1.0, plant ×0.0; herbivore: protein ×0.0, plant ×1.0; omnivore: both ×0.6). A carnivore tiger only has protein decay; a herbivore deer only has plant decay; an omnivore bear has both at reduced rates. Either bar hitting 0 causes health damage.

Larger animals eat more but have more stamina. Small animals eat less but breed faster. The math mirrors the resource balance formula — the world produces enough food for ~200 animals at these rates, with regrowth handling the rest.

---

## Species Config Type (for implementation)

```typescript
interface AnimalSpecies {
  // --- Identity ---
  id: string;
  name: string;
  sprite: string;                     // folder name in assets/animals/
  size: 'tiny' | 'small' | 'medium' | 'large';
  tier: 'apex' | 'mid_predator' | 'large_herb' | 'medium_herb' | 'small_prey';
  diet: DietConfig;                   // protein/plant nutrition config (see PROGRESSION.md)
  habitat: ('forest' | 'grassland' | 'water_edge' | 'rocky' | 'settlement')[];
  activity: 'diurnal' | 'nocturnal' | 'crepuscular';
  social: 'solitary' | 'pair' | 'pack' | 'herd' | 'flock' | 'swarm';
  packSize: [number, number];         // [min, max] group size
  speed: number;                      // base tiles per tick (modified by agility + athletics)
  health: number;                     // base max health (modified by toughness + defense skill)
  attack: number;                     // base attack (modified by strength + combat skill)
  detectionRange: number;             // base tiles (modified by perception + survival skill)
  hunts: string[];                    // species IDs this animal preys on (includes 'agent')
  fearedBy: string[];                 // species that flee from this
  isScavenger: boolean;               // can eat corpses (rat, fox, bear, pig)
  specialAbility?: string;            // 'ambush' | 'curl' | 'howl' | 'trample' | 'seed_disperse' | 'peace_aura' | 'steal_food' | 'egg_laying'

  // --- Taming ---
  tameable: boolean;
  tamingCost: number;                 // food needed to tame
  tamingProximity: number;            // ticks of proximity needed
  tamedBehavior: 'follow' | 'guard' | 'produce' | 'passive';

  // --- Breeding ---
  breedCooldown: number;              // ticks between breeding
  litterSize: [number, number];       // [min, max] offspring
  maxPopulation: number;              // world cap

  // --- Needs ---
  hungerDecay: number;                // per tick (see Needs Decay Rates section)
  thirstDecay: number;
  staminaDecay: number;

  // --- Base Stats (PROGRESSION.md) ---
  baseStats: {
    strength: [number, number];       // [min, max] range rolled at birth
    toughness: [number, number];
    agility: [number, number];
    endurance: [number, number];
    perception: [number, number];
    charisma: [number, number];
  };

  // --- Skill Caps (PROGRESSION.md) ---
  skillCaps: {
    combat: number;       // max level (apex: 80, small_prey: 10)
    defense: number;
    athletics: number;
    foraging: number;
    survival: number;
    social: number;
    // woodcutting, mining, building, crafting: always 0 for animals
  };

  // --- Drops (DROPS_AND_MATERIALS.md) ---
  drops: {
    meat: number;
    bone: number;
    hide: number;
    sinew: number;
    fat: number;
    feathers: number;
    teeth_claws: number;
    scales: number;
  };

  // --- Utility AI weights (species personality) ---
  utilityWeights: {
    food: number;        // hunger response sensitivity (rabbit: 1.3, bear: 0.8)
    water: number;       // thirst response sensitivity
    safety: number;      // flee threshold sensitivity (sheep: 1.8, bear: 0.4)
    social: number;      // pack cohesion drive (capybara: 1.5, cat: 0.2)
    explore: number;     // curiosity / willingness to wander (fox: 1.4, alligator: 0.1)
    aggression: number;  // fight-over-flight preference (tiger: 1.6, hedgehog: 0.0)
    rest: number;        // sleep/stamina sensitivity
  };

  // --- Steering behavior config ---
  steering: {
    separationWeight: number;   // avoid crowding (sheep: 0.5, deer: 1.5)
    alignmentWeight: number;    // match neighbors' direction (horse: 1.5, cow: 0.3)
    cohesionWeight: number;     // stay near group center (sheep: 2.0, fox: 0.0)
    fleeDeviation: number;      // zigzag angle in degrees (deer: 30, horse: 0)
    maxStalkSpeed: number;      // fraction of speed during stealth (tiger: 0.3)
    burstSpeedMultiplier: number; // sprint multiplier (tiger: 2.0, deer: 1.5)
    burstDuration: number;      // ticks of burst speed (tiger: 30, deer: 15)
  };

  // --- Memory config ---
  memory: {
    maxFoodEntries: number;     // capacity (bear: 20, rat: 5)
    maxDangerEntries: number;
    foodDecayRate: number;      // confidence lost per 100 ticks
    dangerDecayRate: number;    // confidence lost per 50 ticks
    sharesMemory: boolean;      // pack animals share food/water info
  };
}
```
