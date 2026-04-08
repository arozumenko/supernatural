# Fallback Mutation System

When an agent dies without an LLM assigned (or LLM call fails), the genome receives a **fallback mutation** based on death cause. Mutations use a **tier system** — repeated deaths from the same cause escalate the effect (tier 1–10). Tiers are permanent and each cause tracks independently.

Mutation history shows: `fallback: exhaustion +5`, `fallback: killed_by_animal +2`

## Mutation Matrix

### Starvation (Protein) — `starvation_protein`

| Parameter | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 | +10 |
|---|---|---|---|---|---|---|---|---|---|---|
| `goalWeights.survive_protein` (cap 8.0) | +0.3 | +0.6 | +0.9 | +1.2 | +1.5 | +1.8 | +2.1 | +2.4 | +2.7 | +3.0 |
| `fallbackWeights.huntAnimal` (cap 90) | +2 | +4 | +6 | +8 | +10 | +12 | +14 | +16 | +18 | +20 |
| `thresholds.criticalHunger` (cap 50) | +2 | +4 | +6 | +8 | +10 | +12 | +14 | +16 | +18 | +20 |
| `thresholds.huntDetectRange` (cap 40) | — | — | — | +4 | +5 | +6 | +7 | +8 | +9 | +10 |
| `fallbackWeights.craft` (cap 60) | — | — | — | — | — | — | +7 | +8 | +9 | +10 |

### Starvation (Plant) — `starvation_plant`

| Parameter | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 | +10 |
|---|---|---|---|---|---|---|---|---|---|---|
| `goalWeights.survive_plant` (cap 8.0) | +0.3 | +0.6 | +0.9 | +1.2 | +1.5 | +1.8 | +2.1 | +2.4 | +2.7 | +3.0 |
| `mediumPriorityWeights.forageMedium` (cap 85) | +2 | +4 | +6 | +8 | +10 | +12 | +14 | +16 | +18 | +20 |
| `fallbackWeights.plantSeeds` (cap 70) | +3 | +6 | +9 | +12 | +15 | +18 | +21 | +24 | +27 | +30 |
| `thresholds.criticalHunger` (cap 50) | — | — | — | +8 | +10 | +12 | +14 | +16 | +18 | +20 |
| `fallbackWeights.huntAnimal` (cap 70) | — | — | — | — | — | — | +7 | +8 | +9 | +10 |

### Starvation (Both) — `starvation_both`

| Parameter | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 | +10 |
|---|---|---|---|---|---|---|---|---|---|---|
| `goalWeights.survive_protein` (cap 7.0) | +0.2 | +0.4 | +0.6 | +0.8 | +1.0 | +1.2 | +1.4 | +1.6 | +1.8 | +2.0 |
| `goalWeights.survive_plant` (cap 7.0) | +0.2 | +0.4 | +0.6 | +0.8 | +1.0 | +1.2 | +1.4 | +1.6 | +1.8 | +2.0 |
| `fallbackWeights.huntAnimal` (cap 85) | +2 | +4 | +6 | +8 | +10 | +12 | +14 | +16 | +18 | +20 |
| `mediumPriorityWeights.forageMedium` (cap 80) | +2 | +4 | +6 | +8 | +10 | +12 | +14 | +16 | +18 | +20 |
| `thresholds.criticalHunger` (cap 50) | +2 | +4 | +6 | +8 | +10 | +12 | +14 | +16 | +18 | +20 |
| `fallbackWeights.plantSeeds` (cap 60) | — | — | — | — | +10 | +12 | +14 | +16 | +18 | +20 |

### Dehydration — `dehydration`

| Parameter | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 | +10 |
|---|---|---|---|---|---|---|---|---|---|---|
| `goalWeights.survive_thirst` (cap 8.0) | +0.3 | +0.6 | +0.9 | +1.2 | +1.5 | +1.8 | +2.1 | +2.4 | +2.7 | +3.0 |
| `thresholds.criticalThirst` (cap 50) | +2 | +4 | +6 | +8 | +10 | +12 | +14 | +16 | +18 | +20 |
| `mediumPriorityWeights.drinkMedium` (cap 85) | +2 | +4 | +6 | +8 | +10 | +12 | +14 | +16 | +18 | +20 |
| `thresholds.waterDetectRange` (cap 30) | — | — | — | — | +5 | +6 | +7 | +8 | +9 | +10 |

### Killed by Animal — `killed_by_animal`

| Parameter | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 | +10 |
|---|---|---|---|---|---|---|---|---|---|---|
| `thresholds.threatDetectBase` (cap 20) | +1 | +2 | +3 | +4 | — | — | — | — | — | — |
| `interruptWeights.fleeBase` (cap 80 / min 30) | +1 | +2 | +3 | +4 | -5 | -6 | -7 | -8 | -9 | -10 |
| `interruptWeights.fightBack` (cap 98) | — | — | — | — | +10 | +12 | +14 | +16 | +18 | +20 |
| `thresholds.fightBackMinRatio` (min 0.2) | — | — | — | — | -0.15 | -0.18 | -0.21 | -0.24 | -0.27 | -0.30 |
| `fallbackWeights.craft` (cap 60) | — | — | — | — | — | — | — | +8 | +9 | +10 |

> Tiers 1–4: flee better. Tiers 5+: stop fleeing, fight back, arm yourself.

### Killed by Agent — `killed_by_agent`

| Parameter | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 | +10 |
|---|---|---|---|---|---|---|---|---|---|---|
| `thresholds.groupDefenseRange` (cap 20) | +1 | +2 | +3 | — | — | — | — | — | — | — |
| `interruptWeights.fleeBase` (cap 75) | +1 | +2 | +3 | — | — | — | — | — | — | — |
| `interruptWeights.fightBack` (cap 98) | — | — | — | +8 | +10 | +12 | +14 | +16 | +18 | +20 |
| `thresholds.fightBackMinRatio` (min 0.15) | — | — | — | -0.16 | -0.20 | -0.24 | -0.28 | -0.32 | -0.36 | -0.40 |
| `fallbackWeights.craft` (cap 60) | — | — | — | — | — | — | +7 | +8 | +9 | +10 |

> Tiers 1–3: flee and group up. Tiers 4+: become aggressive, fight back, craft weapons.

### Exhaustion — `exhaustion`

| Parameter | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 | +10 |
|---|---|---|---|---|---|---|---|---|---|---|
| `goalWeights.rest` (cap 8.0) | +0.3 | +0.6 | +0.9 | +1.2 | +1.5 | +1.8 | +2.1 | +2.4 | +2.7 | +3.0 |
| `thresholds.criticalStamina` (cap 40) | +2 | +4 | +6 | +8 | +10 | +12 | +14 | +16 | +18 | +20 |
| `mediumPriorityWeights.eatMedium` (cap 75) | — | — | +3 | +4 | +5 | +6 | +7 | +8 | +9 | +10 |
| `fallbackWeights.wander` (min 5) | — | — | — | — | -5 | -6 | -7 | -8 | -9 | -10 |
| `fallbackWeights.craft` (min 10) | — | — | — | — | — | — | -3 | -3 | -3 | -3 |
| `fallbackWeights.plantSeeds` (min 10) | — | — | — | — | — | — | -2 | -2 | -2 | -2 |

> Low tiers: rest more. High tiers: conserve energy by reducing non-essential activities.

### Poison — `poison`

| Parameter | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 | +10 |
|---|---|---|---|---|---|---|---|---|---|---|
| `fallbackWeights.huntAnimal` (cap 80) | +2 | +4 | +6 | +8 | +10 | +12 | +14 | +16 | +18 | +20 |
| `goalWeights.survive_plant` (min 0.5) | — | — | -0.3 | -0.4 | -0.5 | -0.6 | -0.7 | -0.8 | -0.9 | -1.0 |
| `fallbackWeights.craft` (cap 50) | — | — | — | — | +5 | +6 | +7 | +8 | +9 | +10 |

> Prefer hunting over foraging. High tiers: cook food to avoid raw plants.

## Lives Economy

| Source | Lives Change |
|--------|-------------|
| Any death | -1 |
| Survived 5+ min | +1 (break even) |
| Kill another agent | +5 (instant, not on death) |
| Kill apex predator (one-time) | +3 |

Agents start with 100 lives. At 0 lives → permadeath.
