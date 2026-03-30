# Crafting & Inventory — Specification

## Overview

Agents start with nothing — bare hands, empty inventory, no shelter. Everything they have, they build. The crafting system is a lightweight Minecraft-style loop: gather raw materials → process at crafting stations → produce tools, structures, armor, food. Tools make gathering faster, structures provide safety, armor keeps you alive longer. Material tiers (wood → stone → bone → iron) create a natural progression arc from "naked survivor" to "established citizen."

**Companion specs:**
- **[PROGRESSION.md](PROGRESSION.md)** — crafting/building skill levels gate recipe access
- **[DROPS_AND_MATERIALS.md](DROPS_AND_MATERIALS.md)** — body material sources (meat, bone, hide, etc.)
- **[ANIMALS.md](ANIMALS.md)** — animal behavior determines hunting difficulty

---

## Inventory System

### Weight-Based Carrying

No slot limits. Agents carry any combination of items, limited by total weight.

```
carry_capacity = 100 + (effective_endurance × 0.5)

A fresh agent (Endurance 10, no gear):
  capacity = 100 + 5 = 105 weight

A veteran agent (Endurance 10, Survival level 40 → +27 endurance bonus = 37 effective):
  capacity = 100 + 18.5 = 118.5 weight

With Leather Sack equipped: +20 capacity
With Pack Donkey tamed:    +50 capacity
```

### Item Weights

Every item in the game has a weight. Heavier items are more valuable but harder to transport.

```
RAW MATERIALS:
  wood           2.0    ← logs are heavy
  stone          3.0    ← rocks are heavier
  iron_ore       4.0    ← densest raw material
  seeds          0.2

BODY MATERIALS:
  meat           1.5
  bone           2.0
  hide           2.0
  sinew          0.5
  fat            1.0
  feathers       0.2
  teeth_claws    0.5
  scales         1.5

PROCESSED MATERIALS:
  iron_ingot     3.0    ← smelted from ore, slightly lighter
  sinew_rope     1.0    ← crafted from sinew
  plank          1.5    ← cut from wood (future)

FOOD & CONSUMABLES:
  raw_meat       1.5    ← same as meat (spoils)
  cooked_meat    1.0    ← lighter after cooking
  jerky          0.5    ← preserved, very light
  berries        0.3
  herbs          0.2
  stew           2.0    ← heavy but best nutrition
  water          1.0

TOOLS (equipped, still weighs):
  wooden_shovel  3.0
  stone_axe      4.0
  bone_knife     2.0
  iron_sword     5.0
  bow            3.0
  arrows (×5)    1.0
  scale_shield   6.0

ARMOR (equipped, still weighs):
  hide_vest      3.0
  hide_boots     1.5
  fur_cloak      4.0
  scale_armor    8.0    ← heaviest item in game

PLACED ITEMS (not carried, deployed in world):
  campfire, workbench, walls, floors, etc. → 0 weight (they're tiles)
```

### Weight Affects Gameplay

Weight feeds directly into the GOAP planner and utility AI:

```
// Movement cost scales with carried weight
move_cost = base_cost × (1 + current_weight / carry_capacity × 0.5)
  → At 50% capacity: 1.25× movement cost
  → At 100% capacity: 1.5× movement cost
  → Over capacity: cannot move (drop something)

// Stamina drain while moving scales with weight
stamina_per_move = base_drain × (1 + current_weight / carry_capacity × 0.3)

// GOAP planner accounts for weight
// A fully loaded agent plans shorter trips and returns to base more often
// An agent carrying iron ore + logs moves slowly — vulnerable to predators
```

### Consuming from Inventory

Agents can eat/drink items directly from inventory:

```
CONSUME ACTION (1 tick):
  Agent selects item from inventory → apply nutrition/effect → remove item

  Consumable items:
    raw_meat:     protein +10, spoilage risk (if old → health -15)
    cooked_meat:  protein +20
    jerky:        protein +15
    berries:      plant +12
    herbs:        varies by type (hunger/stamina/health)
    stew:         protein +25, plant +15, thirst +15
    water:        thirst +30

  Non-consumable items (cannot eat):
    wood, stone, iron, bone, hide, tools, armor, etc.

  AI decision: agents consume from inventory when need is low and they have the item,
  rather than traveling to a food source. Higher foraging skill → better choices
  (won't eat raw meat if cooked meat available).
```

---

## Material Tiers

Four material tiers, each unlocking better equipment. Later tiers require earlier infrastructure.

```
TIER 0: HAND (bare hands)
  Available: immediately
  Gather: punch trees (slow, 3× normal time), pick berries, drink from water
  Craft: nothing — need workbench

TIER 1: WOOD
  Available: after first tree chopped
  Gather: wood tools make harvesting 1.5× faster
  Craft: at workbench (wood + stone to build)
  Unlocks: wooden shovel, wooden club, wooden wall, wooden floor, campfire

TIER 2: STONE
  Available: after mining rocks
  Gather: stone tools are 2× faster than wood
  Craft: at workbench
  Unlocks: stone axe, stone pickaxe, stone knife, stone wall

TIER 3: BONE + HIDE (from hunting)
  Available: after killing animals
  Gather: bone tools = stone speed but lighter, hide = armor
  Craft: at workbench
  Unlocks: bone knife, bone axe, bone spear, hide armor, bow, rope

TIER 4: IRON (endgame)
  Available: after mining iron ore + smelting at forge
  Gather: iron tools are 3× faster than wood
  Craft: at forge (upgraded workbench)
  Unlocks: iron sword, iron axe, iron pickaxe, iron shovel, iron-reinforced wall
```

### Iron System

Iron adds one new world resource and one new crafting station.

#### Iron Ore

```
WORLD GENERATION:
  Iron ore appears as small deposits (1×1 tiles) in rocky/stone areas
  ~15-20 deposits per world (rare but not extreme)
  Tile type: IRON_ORE (new)
  Walkable: no (must mine like stone)
  Mining: requires stone pickaxe or better
  Yield: 2-4 iron_ore per deposit
  Respawn: never (finite resource — iron is precious)

  Distribution: clustered near stone outcrops, never near water
  Visual: darker stone with reddish streaks
```

#### Forge (Crafting Station)

```
RECIPE: Forge
  Requires: stone 12, wood 8, campfire adjacent
  Skill: building 20
  Placed as tile: FORGE (new tile type)
  Size: 1×1
  Function: smelts iron ore → iron ingots, crafts iron items

SMELTING:
  iron_ore: 2 + wood: 2 (fuel) → iron_ingot: 1
  Time: 30 ticks (3 seconds)
  The forge consumes wood as fuel for each smelting operation
```

Iron is deliberately finite — deposits don't respawn. This makes iron tools precious, worth protecting, and a major driver of territorial conflict between agents. An agent with an iron sword is significantly more powerful, but everyone else wants that iron deposit.

---

## Complete Recipe List

All recipes organized by category and tier. Crafting stations required are noted.

### Hand Recipes (no station needed)

```
RECIPE              REQUIRES                    SKILL     WEIGHT   EFFECT
──────────────────────────────────────────────────────────────────────────
Campfire            wood: 3, stone: 2           build 0   placed   cooking station, warmth, light
Workbench           wood: 8, stone: 4           build 5   placed   unlocks all Tier 1-3 recipes
```

These two bootstrapping recipes can be crafted with bare hands — everything else needs a workbench or forge.

### Tier 1: Wood Tools (workbench)

```
RECIPE              REQUIRES                    SKILL     WEIGHT   EFFECT
──────────────────────────────────────────────────────────────────────────
Wooden Shovel       wood: 4                     craft 0   3.0      digging speed +30%, plant seeds
Wooden Club         wood: 5                     craft 0   3.5      +3 attack
Wooden Spear        wood: 6, stone: 1           craft 5   4.0      +5 attack, 2-tile range
Wooden Floor        wood: 3                     build 5   placed   walkable floor tile
Wooden Wall         wood: 5                     build 8   placed   blocks movement, 50 HP
Wooden Door         wood: 6, sinew: 1           build 10  placed   agents pass, animals blocked
Wooden Storage      wood: 10                    build 12  placed   stores 200 weight of items at location
```

### Tier 2: Stone Tools (workbench)

```
RECIPE              REQUIRES                    SKILL     WEIGHT   EFFECT
──────────────────────────────────────────────────────────────────────────
Stone Axe           wood: 2, stone: 3           craft 5   4.0      woodcutting +50%, +4 attack
Stone Pickaxe       wood: 2, stone: 3           craft 5   4.5      mining +50%
Stone Knife         wood: 1, stone: 2           craft 3   2.0      +4 attack, harvesting +20%
Stone Wall          stone: 8                    build 15  placed   blocks movement, 150 HP (3× wood)
Stone Shovel        wood: 2, stone: 3           craft 5   4.0      digging +60%, plant seeds
```

### Tier 3: Bone, Hide & Advanced (workbench)

```
RECIPE              REQUIRES                    SKILL     WEIGHT   EFFECT
──────────────────────────────────────────────────────────────────────────
WEAPONS:
Bone Knife          bone: 3, sinew: 1           craft 8   2.0      +5 attack, harvesting +25%
Bone Axe            bone: 4, wood: 2, sinew: 2  craft 12  3.5      woodcutting +60%, +5 attack
Bone Pickaxe        bone: 4, stone: 2, sinew: 2 craft 12  4.0      mining +60%
Bone Spear          bone: 5, wood: 3, sinew: 2  craft 15  3.0      +10 attack, 2-tile range
Tooth Club          teeth: 4, wood: 3           craft 12  4.0      +8 attack, intimidation aura
Bow                 wood: 4, sinew: 3, feat: 2  craft 20  3.0      ranged 5 tiles, +7 attack
Arrows (×5)         wood: 1, feat: 1, bone: 1   craft 10  1.0      bow ammunition (consumed on use)

ARMOR:
Hide Vest           hide: 4, sinew: 2           craft 10  3.0      +5 defense
Hide Boots          hide: 2, sinew: 1           craft 8   1.5      +5% move speed
Fur Cloak           hide: 6, sinew: 3           craft 18  4.0      +8 defense, cold resist
Scale Shield        scales: 6, wood: 3, sinew: 2 craft 25 6.0      +15 defense
Scale Armor         scales: 10, hide: 4, sinew: 4 craft 35 8.0     +20 defense (best in game)

UTILITY:
Sinew Rope          sinew: 4                    craft 8   1.0      crafting ingredient
Leather Sack        hide: 3, sinew: 1           craft 10  1.0      +20 carry capacity (equipped)
Fat Torch           fat: 2, wood: 1             craft 3   1.5      light source, 120 tick duration
Tallow Candle       fat: 3                      craft 5   0.5      light source, 300 tick duration
Feather Bedroll     feat: 8, hide: 3            craft 15  3.0      placed, sleep ×2 stamina regen

STRUCTURES:
Bone Fence          bone: 6, wood: 4            build 12  placed   barrier tile, 80 HP
Hide Tent           hide: 8, wood: 6, sinew: 3  build 18  placed   shelter, sleep spot
Animal Pen          wood: 12, rope: 2, bone: 4  build 25  placed   encloses tamed animals (4×4 area)
```

### Tier 4: Iron (forge required)

```
RECIPE              REQUIRES                    SKILL     WEIGHT   EFFECT
──────────────────────────────────────────────────────────────────────────
SMELTING (forge):
Iron Ingot          iron_ore: 2, wood: 2        craft 15  3.0      processed iron, crafting ingredient

CRAFTING (forge):
Forge               stone: 12, wood: 8          build 20  placed   iron smelting + crafting station
Iron Sword          iron: 3, wood: 1, hide: 1   craft 25  5.0      +15 attack (best melee weapon)
Iron Axe            iron: 2, wood: 2            craft 22  4.5      woodcutting +100%, +8 attack
Iron Pickaxe        iron: 2, wood: 2            craft 22  5.0      mining +100%
Iron Shovel         iron: 2, wood: 2            craft 20  4.0      digging +100%, plant seeds
Iron-Reinforced Wall stone: 6, iron: 2, wood: 2 build 28  placed   blocks movement, 300 HP (best wall)
Iron Shield         iron: 4, hide: 2            craft 28  7.0      +18 defense
Iron-Tipped Arrows  iron: 1, wood: 2, feat: 2   craft 20  1.5      +12 attack (vs. +7 bone arrows)
Iron Nails (×10)    iron: 1                     craft 10  0.5      building ingredient, +structure HP
```

### Food & Cooking (campfire or workbench)

All food restores **protein** and/or **plant** hunger (see PROGRESSION.md "Nutrition System").

```
RECIPE              REQUIRES                    STATION   SKILL     EFFECT
──────────────────────────────────────────────────────────────────────────────
Cooked Meat         meat: 2                     campfire  craft 0   protein: +20
Stew                meat: 3, water: 2, berries: 2 campfire craft 10 protein: +25, plant: +15, thirst: +15
Jerky               meat: 4, fat: 1             campfire  craft 8   protein: +15, no spoilage
Bone Broth          bone: 3, water: 3           campfire  craft 5   protein: +10, health: +5
Fat Rations         fat: 3, berries: 2          workbnch  craft 5   protein: +10, plant: +5, stamina: +10
Berry Salad         berries: 4, edible_flwr: 2  workbnch  craft 3   plant: +25 (best plant-only meal)
Herb Mix            hunger_herb: 2, stam_herb: 1 workbnch craft 5   plant: +15, stamina: +10
```

### Social & Trade Items (workbench)

```
RECIPE              REQUIRES                    SKILL     WEIGHT   EFFECT
──────────────────────────────────────────────────────────────────────────
Tooth Necklace      teeth: 3, sinew: 1          craft 5   0.3      +5 social score
Feather Crown       feat: 6, sinew: 2           craft 12  0.3      +8 social score
Trophy              teeth: 5, bone: 3, wood: 2  craft 15  2.0      +10 social, placed at camp
Scale Pendant       scales: 3, sinew: 1         craft 18  0.3      +12 social (rarest)
```

---

## Tool System

### Equipment Slots

Agents have 3 equipment slots (worn/held items that provide passive bonuses):

```
SLOT          ACCEPTS                              CURRENTLY EQUIPPED
──────────────────────────────────────────────────────────────────────
Main Hand     any one tool or weapon                stone_axe
Body          any one armor piece                   hide_vest
Accessory     sack, necklace, pendant, cloak        leather_sack
```

Equipped items still count toward carry weight. Agents can swap equipment freely (1 tick).

### Tool Effects

Tools modify the action they're designed for. Only the equipped main hand tool applies:

```
ACTION: CHOP TREE
  bare hands:    1 damage/tick to tree, stamina cost 1.0
  wooden_shovel: not applicable (wrong tool, no bonus)
  stone_axe:     1.5 damage/tick, stamina cost 0.8
  bone_axe:      1.6 damage/tick, stamina cost 0.75
  iron_axe:      2.0 damage/tick, stamina cost 0.6

ACTION: MINE ROCK
  bare hands:    cannot mine (too hard)
  stone_pickaxe: 1.5 damage/tick, stamina cost 0.8
  bone_pickaxe:  1.6 damage/tick, stamina cost 0.75
  iron_pickaxe:  2.0 damage/tick, stamina cost 0.6

ACTION: FIGHT
  bare hands:    base_strength damage, accuracy 70%
  stone_knife:   +4 damage, accuracy +5%
  bone_spear:    +10 damage, 2-tile range, accuracy +5%
  iron_sword:    +15 damage, accuracy +10%
  bow + arrows:  +7/+12 damage at 5 tiles (consumes arrows)

ACTION: DIG/PLANT
  bare hands:    2× time to plant seeds
  wooden_shovel: normal planting speed
  stone_shovel:  1.5× planting speed, can dig dirt tiles
  iron_shovel:   2× planting speed, can dig dirt/create irrigation (future)
```

### Tool Durability

Tools break after use. Iron lasts longest, wood breaks fastest.

```
DURABILITY (hits before breaking):
  Wood tools:   50 uses
  Stone tools:  120 uses
  Bone tools:   100 uses (less than stone, but lighter + sharper)
  Iron tools:   300 uses (best by far)

When durability hits 0:
  Tool breaks → removed from inventory
  Agent gets a "tool broke" event → utility AI recalculates (may craft replacement)
  Broken tool drops 1 unit of its primary material (wood stick, stone chip, etc.)

REPAIR (future):
  At workbench: tool + 1 unit of its material → restores 50% durability
  Crafting skill affects repair efficiency
```

### AI Tool Selection

The GOAP planner considers tool availability when planning:

```
// Agent wants to chop a tree
if has_axe:
  chop_cost = base_cost × axe_speed_modifier  // cheaper with good tool
else:
  chop_cost = base_cost × 3.0  // bare hands = 3× more expensive

// Agent wants to mine
if has_pickaxe:
  mine_cost = base_cost × pick_speed_modifier
else:
  mine_cost = INFINITY  // can't mine without pickaxe → GOAP won't plan this

// Agent evaluates: "should I craft a stone axe first, then chop?"
// GOAP chains: gather_stone → gather_wood → go_to_workbench → craft_axe → chop_tree
// Total plan cost might be LESS than chopping 10 trees bare-handed
```

---

## Structure System

### Placeable Structures

Structures are placed as tiles in the world. They provide functional benefits.

```
STRUCTURE       TILE TYPE       HP     FUNCTION
──────────────────────────────────────────────────────────────────
Campfire        CAMPFIRE        -      cooking station, warmth, light (3-tile radius)
Workbench       WORKBENCH       -      crafting station (Tier 1-3 recipes)
Forge           FORGE           -      smelting + iron crafting (Tier 4)
Wooden Floor    BUILT_FLOOR     -      walkable surface, building foundation
Wooden Wall     BUILT_WALL      50     blocks movement, agents can build on top
Stone Wall      STONE_WALL      150    blocks movement, much tougher
Iron-R. Wall    IRON_WALL       300    blocks movement, toughest wall
Wooden Door     WOOD_DOOR       30     agents pass through, animals blocked
Bone Fence      BONE_FENCE      80     blocks animals, agents can step over
Wooden Storage  STORAGE         60     holds 200 weight of items, accessible to owner
Hide Tent       TENT            40     shelter need restored while inside, sleep spot
Feather Bedroll BEDROLL         -      placed on floor, sleep ×2 stamina regen
Animal Pen      ANIMAL_PEN      80     4×4 fenced area for tamed animals
```

### Wall HP and Destruction

Walls can be destroyed by agents (attacking), animals (ramming), and natural decay:

```
ATTACK DAMAGE TO STRUCTURES:
  bare hands:     1 damage/tick (would take 50 ticks to break a wooden wall)
  stone tools:    3 damage/tick
  bone tools:     4 damage/tick
  iron tools:     6 damage/tick
  bear charge:    10 damage/hit (bears can break wooden walls in 5 hits)
  wolf pack:      3 damage/hit per wolf
  stampede:       15 damage/hit (cow stampede destroys wooden fences)

NATURAL DECAY (future):
  Wooden structures lose 1 HP per 600 ticks (~1 min) if not maintained
  Stone/iron structures don't decay
  Maintenance: agent spends 1 unit of material + 5 ticks near structure

This means:
  - Wooden walls keep sheep in and foxes out
  - Stone walls keep wolves and boars out
  - Iron walls keep everything out (bears can try, 50 hits to break)
  - Nothing is truly permanent without maintenance
```

### Storage

Agents can store items in placed Storage containers:

```
WOODEN STORAGE:
  capacity: 200 weight
  access: owner agent + agents with positive relationship (opinion > 30)
  protection: items inside don't spoil (sealed container)
  theft: other agents CAN steal if they break in (attack the storage)

STASH STRATEGY:
  Agents without storage must carry everything → heavy → slow → vulnerable
  Building storage near work sites = efficiency
  Building storage inside walled compound = safety

AI BEHAVIOR:
  Agent utility: "store excess materials" triggers when:
    - carry weight > 70% capacity
    - own a storage within 20 tiles
    - not in immediate danger
  Agent utility: "retrieve from storage" triggers when:
    - need a specific material for crafting
    - own a storage containing that material
```

---

## Crafting Process

### How Crafting Works (Mechanically)

```
1. REQUIREMENTS CHECK:
   - Agent is adjacent to required station (workbench/campfire/forge)
   - Agent has required materials in inventory
   - Agent meets minimum skill level
   - Recipe is "known" (all recipes are known — no unlock discovery needed)

2. CRAFTING ACTION:
   - Agent enters 'crafting' action state
   - Duration: recipe.craft_time ticks (typically 10-30)
   - Stamina cost: recipe.stamina_cost (typically 2-5)
   - Materials consumed from inventory at START (committed)
   - If interrupted (attacked, need crisis): materials lost, item not produced

3. OUTPUT:
   - Item added to inventory (tools, armor, food, materials)
   - OR tile placed adjacent to agent (structures)
   - Crafting XP earned (see PROGRESSION.md)
   - Event logged: "Marcus crafted a Stone Axe"

4. QUALITY (future):
   - Crafting skill affects output quality
   - Higher quality = more durability, slightly better stats
   - Visual indicator: "Stone Axe" vs "Fine Stone Axe" vs "Masterwork Stone Axe"
```

### Craft Times

```
CATEGORY              BASE CRAFT TIME (ticks)    STAMINA COST
────────────────────────────────────────────────────────────────
Hand recipes          20                          3
Wood tools            15                          2
Stone tools           20                          3
Bone/hide items       25                          4
Iron smelting         30                          5
Iron tools            35                          6
Food/cooking          10                          1
Structures (placed)   30                          5
Complex structures    50                          8

Craft time modified by crafting skill:
  actual_time = base_time × (1 - crafting_level × 0.005)
  At level 0:  1.0× time
  At level 50: 0.75× time
  At level 99: 0.505× time (about half)
```

### AI Crafting Decisions

The GOAP planner evaluates crafting as a multi-step investment:

```
// Agent has no axe and needs wood
OPTION A: chop trees bare-handed
  cost: 3.0 × base_chop × num_trees = expensive, slow

OPTION B: craft stone axe first, then chop
  cost: gather_stone(3) + gather_wood(2) + travel_to_workbench + craft_time + chop(1.5× faster)
  → cheaper if agent needs 5+ trees

// GOAP picks the cheaper total plan
// Early game: bare-hand a few trees to build workbench
// Mid game: always tool up first
// Late game: maintain iron tools, repair before they break

// Agent evaluates tool upgrade:
if has_stone_axe AND has_materials_for_bone_axe:
  upgrade_value = time_saved_per_tree × estimated_trees_needed
  upgrade_cost = craft_time + material_gathering
  if upgrade_value > upgrade_cost: craft bone_axe
```

---

## Progression Gating

Recipes require minimum skill levels. This prevents fresh agents from immediately crafting endgame gear, even if materials are available.

```
CRAFTING SKILL GATES:
  Level 0:   campfire, workbench, cooked meat, wooden shovel, wooden club
  Level 3:   stone knife, fat torch, berry salad
  Level 5:   stone axe, stone pickaxe, bone broth, herb mix, tooth necklace
  Level 8:   bone knife, leather sack, hide vest, hide boots, sinew rope, jerky
  Level 10:  stew, arrows, wooden door, wooden storage, bone fence
  Level 12:  bone axe, bone pickaxe, tooth club, feather crown, bedroll
  Level 15:  bone spear, iron ingot (smelting), hide tent, trophy
  Level 18:  fur cloak, scale pendant
  Level 20:  bow, forge, iron shovel, iron-tipped arrows
  Level 22:  iron axe, iron pickaxe
  Level 25:  iron sword, scale shield, animal pen
  Level 28:  iron shield, iron-reinforced wall
  Level 30:  iron nails (future building component)
  Level 35:  scale armor (best armor, requires high skill + rare materials)

BUILDING SKILL GATES:
  Level 0:   campfire
  Level 5:   workbench, wooden floor
  Level 8:   wooden wall
  Level 10:  wooden door, bone fence
  Level 12:  wooden storage
  Level 15:  stone wall
  Level 18:  hide tent
  Level 20:  forge
  Level 25:  animal pen
  Level 28:  iron-reinforced wall

Note: each recipe requires EITHER crafting OR building skill, not both.
The requirement type matches the recipe category (tools/armor → crafting, structures → building).
```

---

## Economy Balance

### Time-to-Equip Analysis

How long does it take an agent to go from nothing to fully equipped?

```
PHASE 1: Bootstrap (0-2 minutes real time)
  Punch trees → 8 wood (bare hand, slow)
  Pick up stone → 4 stone (from ground near rocks)
  Craft campfire (bare hands)
  Craft workbench (bare hands)
  Craft stone axe + stone pickaxe
  STATUS: basic tools, can gather efficiently

PHASE 2: Basic Survival (2-10 minutes)
  Chop trees with stone axe → wood supply
  Mine rocks → stone supply
  Build wooden walls (2-3 for shelter)
  Build wooden storage
  Hunt small animal (rabbit/chicken) → meat, bone, feathers
  Cook meat at campfire
  STATUS: shelter, food, storage, stone tools

PHASE 3: Bone/Hide Upgrade (10-30 minutes)
  Hunt medium animal (deer, pig) → bone, hide, sinew, meat
  Craft bone tools (replace stone where useful)
  Craft hide vest + boots
  Craft leather sack (+carry capacity)
  Build bone fence for tamed animals
  Tame chicken/sheep for passive food
  STATUS: bone tools, light armor, animal farm started

PHASE 4: Advanced (30-90 minutes)
  Hunt predators (dangerous) → teeth_claws, large hide
  Craft bow + arrows (ranged combat)
  Craft fur cloak (better armor)
  Find iron ore deposit → mine, smelt, craft iron tools
  Build stone walls (upgrade base)
  STATUS: iron tools, good armor, fortified base

PHASE 5: Endgame (hours)
  Kill alligator → scales → scale armor
  Full iron tool set
  Iron-reinforced walls
  Multiple tamed animals
  High crafting/building skills (30+)
  STATUS: apex agent, others want your stuff
```

### Resource Sink Balance

The economy needs sinks (things that consume resources permanently) to prevent hoarding:

```
SINKS:
  Tool durability     — tools break, must be replaced (wood/stone/bone/iron consumed)
  Food consumption    — constant drain, must keep hunting/foraging
  Meat spoilage       — raw meat rots in 30 seconds if not cooked
  Wall decay          — wooden structures rot without maintenance
  Arrow consumption   — arrows used in combat are gone
  Death               — drop all inventory (others may take it)
  Animal feeding      — tamed animals need food too

FAUCETS:
  Trees regrow (slow)
  Plants regrow (slow)
  Animal breeding (population replaces hunted animals)
  Iron: NEVER regrows (finite, forces competition)
```

---

## Types (for implementation)

```typescript
// Add to shared/src/index.ts

// --- Items ---

type ItemCategory = 'tool' | 'weapon' | 'armor' | 'accessory' | 'food' | 'material' | 'structure';

type EquipSlot = 'mainHand' | 'body' | 'accessory';

interface ItemDefinition {
  id: string;
  name: string;
  category: ItemCategory;
  weight: number;
  stackable: boolean;             // materials stack, tools don't
  maxStack: number;               // materials: 99, tools: 1
  equipSlot?: EquipSlot;          // if equippable
  durability?: number;            // max uses before breaking (tools only)

  // Combat stats (weapons/armor)
  attackBonus?: number;
  defenseBonus?: number;
  range?: number;                 // tiles (spear: 2, bow: 5)

  // Tool bonuses
  woodcuttingBonus?: number;      // multiplier on chop speed
  miningBonus?: number;           // multiplier on mine speed
  diggingBonus?: number;          // multiplier on plant/dig speed
  harvestBonus?: number;          // multiplier on general harvest speed

  // Utility
  carryCapacityBonus?: number;    // leather sack: +20
  speedBonus?: number;            // hide boots: +0.05
  socialBonus?: number;           // necklace: +5

  // Food (consumable)
  nutrition?: {
    protein: number;
    plant: number;
    thirst?: number;
    health?: number;
    stamina?: number;
  };
  spoilsAfter?: number;           // ticks until spoiled (raw meat: 300)
}

// --- Inventory ---

interface InventoryItem {
  itemId: string;                 // references ItemDefinition.id
  quantity: number;               // 1 for tools, N for materials
  durability?: number;            // current durability (tools)
  createdAt?: number;             // tick when created (for spoilage)
}

interface Inventory {
  items: InventoryItem[];
  equipped: {
    mainHand?: InventoryItem;
    body?: InventoryItem;
    accessory?: InventoryItem;
  };
}

function getCarryWeight(inventory: Inventory): number {
  return inventory.items.reduce((total, item) => {
    const def = ITEM_DEFINITIONS[item.itemId];
    return total + def.weight * item.quantity;
  }, 0);
}

function getCarryCapacity(being: LivingBeing): number {
  const base = 100;
  const enduranceBonus = getEffectiveEndurance(being) * 0.5;
  const gearBonus = being.inventory.equipped.accessory?.itemId === 'leather_sack' ? 20 : 0;
  return base + enduranceBonus + gearBonus;
}

// --- Recipes ---

interface CraftingRecipe {
  id: string;
  name: string;
  requires: Record<string, number>;     // itemId/materialId → quantity
  produces: {
    type: 'item' | 'tile';
    itemId?: string;                    // if type === 'item'
    tileType?: TileType;               // if type === 'tile'
    quantity?: number;                  // default 1
  };
  station: 'none' | 'campfire' | 'workbench' | 'forge';
  skillType: 'crafting' | 'building';
  skillRequired: number;                // minimum level
  craftTime: number;                    // ticks
  staminaCost: number;
}

// --- Structure ---

interface StructureState {
  tileType: TileType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  ownerId?: string;                     // agent who placed it
  storedItems?: InventoryItem[];        // for STORAGE type
  lastMaintained?: number;              // tick (for decay)
}
```
