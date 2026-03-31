# Change Request: Metabolism Scaling

**Status:** Implemented (core), Spec extension needed for PROGRESSION.md
**Affects:** `server/src/ai/NeedsSystem.ts`, `docs/PROGRESSION.md`

---

## Problem

All agents had identical resource consumption regardless of power level. A freshly spawned level-0 agent and a veteran with 500 total skill levels burned hunger, thirst, and stamina at exactly the same rate. Leveling up was pure benefit with zero tradeoff — stronger agents had no additional upkeep cost. This breaks the natural balance: a bigger, more capable being should need more food, more water, and more rest.

The same problem applied to activity type. Chopping trees, fighting predators, and standing idle all drained stamina at the same flat 0.05/tick rate.

---

## Design: Two-Axis Metabolism

Metabolism multiplies all need decay rates. It has two axes that compound:

### Axis 1: Power Level (how big/skilled you are)

Based on sum of all 10 skill levels (0–990 theoretical max):

```
metabolism_level = 1 + total_skill_levels / 500

Examples:
  Fresh agent (0 total):     1.0× (baseline)
  Early game (~50 total):    1.1× (barely noticeable)
  Mid game (~200 total):     1.4× (needs ~40% more food)
  Late game (~500 total):    2.0× (double resource consumption)
  Near max (~990 total):     2.98× (triple — very expensive to sustain)
```

Rationale: a warrior who has trained combat to 99 and athletics to 80 has a bigger, more muscular body. It needs more fuel. The `/500` divisor means scaling is gentle in early game and steep in late game — you don't feel the cost until you're powerful enough to handle it.

### Axis 2: Activity (what you're doing right now)

Different actions have different physical costs:

```
ACTION        MULTIPLIER   WHY
──────────────────────────────────────────
resting       0.4×         near-sleep metabolic floor
idle          0.6×         standing around, low burn
socializing   0.8×         talking is light work
wandering     1.0×         baseline — walking pace
crafting      1.2×         focused hand work
fleeing       1.3×         sprinting but short burst
building      1.4×         heavy construction labor
harvesting    1.5×         chopping/mining/foraging
hunting       1.6×         tracking + bursts of speed
fighting      1.8×         maximum physical exertion
```

### Combined Formula

```
metabolism = metabolism_level × activity_multiplier

Examples:
  Fresh agent, idle:         1.0 × 0.6 = 0.6× (very low burn)
  Fresh agent, chopping:     1.0 × 1.5 = 1.5×
  Mid-game agent, idle:      1.4 × 0.6 = 0.84×
  Mid-game agent, fighting:  1.4 × 1.8 = 2.52×
  Max agent, fighting:       2.98 × 1.8 = 5.36× (burns through food fast)
  Max agent, resting:        2.98 × 0.4 = 1.19× (even rest costs more than a newborn walking)
```

---

## What Scales

### Hunger (protein + plant)

Both hunger bars decay at `base_rate × metabolism`:

```
protein_decay = HUNGER_DECAY × 0.6 × survival_reduction × metabolism
plant_decay   = HUNGER_DECAY × 0.6 × survival_reduction × metabolism
```

A maxed agent fighting burns protein at 5.36× the base rate. Since food restoration is flat (+12.5 per eat action), this means the agent needs to eat ~5× more often.

### Thirst

```
thirst_decay = THIRST_DECAY × survival_reduction × metabolism
```

Same principle. A high-level agent doing heavy labor needs to visit water sources much more frequently.

### Stamina (drain)

```
stamina_drain = STAMINA_DECAY × metabolism
```

Heavy activities on a big body drain stamina fast. A maxed agent fighting loses stamina at 5.36× the base rate — about 0.27/tick vs the baseline 0.05/tick. This forces rest cycles.

### Stamina (recovery)

Rest recovery scales **inversely** with power level — bigger body takes longer to recover:

```
rest_efficiency = 1 / (1 + total_skill_levels / 800)

Examples:
  Fresh agent:    1.0 / (1 + 0/800)   = 1.0× recovery speed
  Mid-game:       1.0 / (1 + 200/800) = 0.8× recovery speed
  Late game:      1.0 / (1 + 500/800) = 0.62× recovery speed
  Near max:       1.0 / (1 + 990/800) = 0.45× recovery speed
```

A near-maxed agent recovers stamina at ~45% the speed of a fresh one. Combined with faster drain, this means long rest periods between activity bursts.

---

## What Does NOT Scale

### Food restoration amounts

Eating food gives the same flat nutrition regardless of agent level:

```
Berry bush:    +12 plant hunger (always)
Cooked meat:   +20 protein (always)
Drinking:      +30 thirst (always)
```

A berry is a berry. The agent just needs to eat more of them. This creates real economic pressure: high-level agents are powerful but consume more of the world's resources, creating natural competition.

### Social and shelter decay

These stay flat — social need and shelter need don't scale with physical size. A big warrior still only needs one conversation and one shelter.

### Health regeneration

The slow health regen when needs are met (`+0.1/tick`) stays flat. Higher-level agents don't heal faster just because they're bigger.

---

## Interaction with Survival Skill

The survival skill's `need_decay_reduction` (up to ~20% at level 99) partially offsets metabolism scaling but can never fully counteract it:

```
At 500 total skill levels (metabolism 2.0×):
  Without survival: decay = base × 2.0
  With survival 99: decay = base × 2.0 × 0.80 = base × 1.6
  → Still 60% more than a fresh agent

At 990 total skill levels (metabolism 2.98×):
  Without survival: decay = base × 2.98
  With survival 99: decay = base × 2.98 × 0.80 = base × 2.38
  → Still 138% more than a fresh agent
```

This makes survival skill increasingly valuable at higher levels — it's the tax break for the wealthy — but never eliminates the cost of being powerful.

---

## Gameplay Implications

### Natural power curve flattening

Without metabolism scaling, power growth is linear and unbounded — more levels = strictly better. With it, there's a soft ceiling where the upkeep cost of maintaining a powerful agent approaches the benefit. A level-50-in-everything agent might spend 40% of their time eating and resting, compared to 15% for a fresh agent.

### Specialization incentive

Since metabolism scales with **total** skill levels, a specialist (one skill at 99, rest at 0 = 99 total, metabolism 1.2×) is much cheaper to sustain than a generalist (all at 50 = 500 total, metabolism 2.0×). This naturally encourages agents to specialize, which makes cooperation between agents more valuable.

### Resource territory becomes critical

High-level agents burn through local food/water fast. They need larger foraging territories or reliable food production (farming, animal husbandry) to sustain themselves. This drives expansion, conflict over resource-rich areas, and investment in infrastructure.

### Death becomes more punishing

A high-level agent that dies respawns with skills intact but needs reset to 100. With metabolism at 2-3×, those full bars drain fast — the agent immediately needs to secure food and water. Dying far from resources is extra dangerous because the walk back burns more than it would for a newborn.

### Player message cost alignment

Players can message agents more often if the agent has high social standing. But high-standing agents are also the most expensive to keep alive. This creates a natural tension: your most influential agent is also the one most likely to die if you don't help it secure resources.

---

## Applies to Animals Too

The same system should apply to animal metabolism. A veteran wolf pack leader (combat 40, athletics 35, survival 50 = 125 total levels) has metabolism 1.25× — needs to hunt more often than a fresh-spawned pup. This makes old apex predators more dangerous but also more vulnerable to starvation, creating natural population cycling.

### Implementation note for animals

Animal metabolism uses the same `getTotalSkillLevels()` and `getMetabolismMultiplier()` functions. The activity multiplier maps to animal actions:

```
ANIMAL ACTION    MULTIPLIER   MAPS TO
──────────────────────────────────────
sleeping         0.4×         resting
grazing          0.8×         socializing
idle             0.6×         idle
wandering        1.0×         wandering
fleeing          1.3×         fleeing
hunting          1.6×         hunting
fighting         1.8×         fighting
breeding         1.0×         wandering
```

**Status:** Currently only implemented for agents in `NeedsSystem.ts`. Extending to `AnimalAI.ts` is a separate task.

---

## Changes to PROGRESSION.md

Add a new section after "Survival Skill → Endurance" (line 370):

### Metabolism Scaling — The Cost of Power

```
Every living being's resource consumption scales with its total power level
and current activity. Bigger, more skilled beings burn more fuel.

metabolism = (1 + total_skill_levels / 500) × activity_multiplier

This affects: hunger decay (protein + plant), thirst decay, stamina drain.
This does NOT affect: food restoration amounts, social/shelter decay, health regen.

Stamina recovery during rest is additionally slowed:
  rest_efficiency = 1 / (1 + total_skill_levels / 800)

See CHANGEREQ_METABOLISM.md for full formula table and gameplay analysis.
```

Update the "Survival Skill → Endurance" section (line 360) to reference metabolism:

```
need_decay_reduction = survival_level × 0.002  // 0% at 0, ~20% at 99
  → Partially offsets metabolism scaling but cannot eliminate it.
  → At 500 total levels: survival 99 reduces effective decay from 2.0× to 1.6×.
```

---

## Implementation Status

| Component | Status | File |
|---|---|---|
| `getTotalSkillLevels()` | ✅ Done | `NeedsSystem.ts` |
| `getMetabolismMultiplier()` | ✅ Done | `NeedsSystem.ts` |
| `ACTIVITY_MULTIPLIERS` table | ✅ Done | `NeedsSystem.ts` |
| Agent hunger/thirst decay scaling | ✅ Done | `NeedsSystem.ts:decayNeeds()` |
| Agent stamina drain scaling | ✅ Done | `NeedsSystem.ts:decayNeeds()` |
| Agent rest recovery inverse scaling | ✅ Done | `NeedsSystem.ts:decayNeeds()` |
| Animal metabolism scaling | ❌ Pending | `AnimalAI.ts` |
| PROGRESSION.md spec update | ❌ Pending | `docs/PROGRESSION.md` |
