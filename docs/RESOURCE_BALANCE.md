# Resource Balance Formula

## The Core Rule

Nature covers **40% of placeable land**. The rest is open grass for agents to walk, build, and live on. The 40% must contain enough food, wood, stone, and utility plants that agents can sustain themselves indefinitely — as long as they're smart enough to find it.

## World Budget

```
Total tiles:            W × H
Terrain (water/sand/dirt): ~22% of total  →  not placeable
Placeable land:         ~78% of total     →  grass + dirt that can hold resources
Nature budget:          40% of placeable  →  tiles occupied by trees, rocks, plants
Open ground:            60% of placeable  →  empty grass for agents
```

For a 120×90 world: 10,800 total → ~8,400 placeable → **~3,370 nature tiles** to distribute.

## Distribution Formula

Of the 40% nature budget:

| Resource | % of budget | What it is | Size | Yield |
|---|---|---|---|---|
| **Trees** | 55% | Forests. Dominant landscape feature. | 2×2 | 100 wood per tree |
| **Rocks** | 10% | Stone outcrops. 30% big (100 stone), 70% small (20 stone) | 1×1 | 20–100 stone |
| **Berry bushes** | 10% | Primary food. Near forest edges. | 1×1 | 30 food (depletable) |
| **Edible mushrooms** | 6% | Secondary food. Forest floor. | 1×1 | 3 food + 15 hunger |
| **Poison mushrooms** | 2% | Looks like food. Drains 25 health. | 1×1 | Danger |
| **Edible flowers** | 4% | Mild food + visual variety. | 1×1 | ~10 hunger |
| **Healing flowers** | 4% | Health recovery. | 1×1 | +30 health |
| **Stamina herbs** | 4% | Stamina recovery. | 1×1 | +35 stamina |
| **Hunger herbs** | 5% | Hunger supplement. | 1×1 | +20 hunger |

**Trees dominate** because that's what forests look like. Over half the nature budget is trees. Food sources are scattered through and around the forest — agents have to forage, not feast.

## Why These Numbers

### Agent consumption (per agent, per minute)

```
Hunger decays:     90 points/min
Each food unit restores: 25 hunger
→ Agent needs:     3.6 food/min to not starve
```

Thirst is free (just walk to water). Stamina recovers by resting. Food is the only consumable resource that actually runs out.

### Food supply check

At the 55/10/10/6/4/5 distribution on a 120×90 map:

```
Berry bushes:   ~337 × 30 food     = 10,109 food-eq
Mushrooms:      ~202 × 3.6 food-eq =    728 food-eq
Edible flowers: ~135 × 0.4 food-eq =     54 food-eq
Hunger herbs:   ~168 × 0.8 food-eq =    135 food-eq
─────────────────────────────────────────────────
TOTAL:                               ~11,000 food-eq
```

How long does this last without any regrowth?

| Agents | Food/min | Initial supply lasts |
|---|---|---|
| 8 | 29 | **6.4 hours** |
| 20 | 72 | **2.6 hours** |
| 50 | 180 | **1.0 hour** |

At 8 agents (starting population), the world has over 6 hours of food. At max population, about 1 hour. Regrowth is what makes it indefinite.

### Building material check

```
~463 trees × 100 wood = 46,000 wood
~337 rocks (mixed)    = 14,800 stone

Per agent basic shelter: 19 wood + 6 stone
50 agents need: 950 wood + 300 stone
Supply covers ~49× that amount
```

Building materials are abundant. Wood is never the bottleneck — food is.

### The real constraint: accessibility

The reason agents die isn't lack of food in the world — it's failing to reach food before hunger kills them.

```
Food sources on map:          ~842 tiles
Average spacing:              1 food per ~10 tiles
Average distance to food:     ~3 tiles
Time to reach nearest food:   ~1 second
Time from full to death:      ~267 seconds (hunger drain → health drain)
Safety margin:                ~460× (can reach hundreds of food sources before dying)
```

A safety margin above 5× means the distribution is viable. At 460×, agents have to be incredibly unlucky or incredibly stupid to starve. The challenge isn't density — it's prioritization. An agent that wanders away from food sources or ignores its hunger too long will still die.

## Regrowth Requirements

For the world to sustain agents *indefinitely*, depleted food must regenerate. Required regrowth rates at steady state:

| Agents | Bushes regrowing/min | Mushrooms regrowing/min |
|---|---|---|
| 8 | 0.5 | 2.4 |
| 20 | 1.3 | 6.0 |
| 50 | 3.3 | 15.0 |

**Regrowth rule:** Each tick, food plants have a small chance to spawn a new plant of the same type on an adjacent grass tile, if one exists. The chance should be calibrated so that when ~50% of initial food remains, regrowth matches consumption for the design population (~20 agents).

Suggested regrowth probability per food plant per tick:

```
P(regrow) = 0.001 per tick per existing plant
```

At 337 berry bushes, 50% remaining = ~169 plants × 0.001 = 0.169 regrowth events per tick × 10 ticks/sec × 60 sec = **~1.0 bushes/min** — close to the 1.3/min needed for 20 agents. The system naturally balances: fewer plants → slower regrowth → population drops → pressure eases → plants recover.

## Poison Mushroom Ratio

Poison mushrooms are 2% of the nature budget — about **25% of all mushroom-looking things** (edible mushrooms are 6%). This creates real danger for low-survival-skill agents who can't tell the difference. As agents' survival skill improves, they learn to avoid poison. This is the skill-gate: dumb agents die, experienced agents thrive.

## Scaling to Different World Sizes

The formula is resolution-independent. For any world:

```
nature_tiles = (W × H) × 0.78 × 0.40

trees       = nature_tiles × 0.55 ÷ 4   (entities, each 2×2)
rocks       = nature_tiles × 0.10
berry_bush  = nature_tiles × 0.10
mushroom    = nature_tiles × 0.06
poison_mush = nature_tiles × 0.02
edible_flow = nature_tiles × 0.04
heal_flower = nature_tiles × 0.04
stam_herb   = nature_tiles × 0.04
hunger_herb = nature_tiles × 0.05
```

The 0.78 factor accounts for water/sand/dirt terrain. Adjust if your terrain generation produces different ratios.

## Summary

The formula guarantees survival by flooding the world with food relative to agent needs (460× safety margin), while making the world *feel* like a forest (55% trees). The real gameplay tension comes from agent decision-making — not from resource scarcity at the world level, but from individual agents being too lazy, too independent, or too dumb to eat on time.

Scarcity emerges locally (an area gets harvested clean) and temporarily (population spike outpaces regrowth). The formula ensures the world always *could* support its population. Whether agents actually survive is up to them.
