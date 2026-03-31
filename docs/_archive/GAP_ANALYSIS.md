# Gap Analysis: Spec vs Implementation (v3)

**Date:** 2026-03-29 (re-verified after Critical/High/Medium dev pass)
**Scope:** All spec docs vs actual codebase

Legend: ✅ Implemented | ⚠️ Partial | ❌ Missing | 🔧 Differs from spec

---

## 1. PROGRESSION SYSTEM (PROGRESSION.md)

### Base Stats & Skills Core
| Feature | Status | Notes |
|---|---|---|
| 6 base stats | ✅ | random 5-15, fixed at birth |
| 10 skills with XP/leveling | ✅ | `createSkillSet()`, all 10 |
| Level curve `floor(sqrt(xp/50))` | ✅ | `xpToLevel()` |
| Diminishing returns `1/(1+level/50)` | ✅ | In `awardXP()` |
| +99 stat bonus cap | ✅ | `getEffectiveStat()` |
| Dual-stat skills (⅔ + ⅓) | ✅ | Woodcutting/Mining/Building |
| Skill caps per animal tier | ✅ | `skillCaps` in config |

### XP Awards
| Feature | Status | Notes |
|---|---|---|
| Combat XP (3.0 base) | ✅ | With difficulty modifier |
| Combat difficulty modifier | ✅ | `clamp(animalAttack / max(1, 10+combat*0.5), 0.5, 3.0)` |
| Athletics XP (0.5 base) | ✅ | Awarded when agent moves >0.1 distance during actions |
| Athletics 2× flee bonus | ✅ | 2.0 multiplier when decision reason includes "flee"/"threatened" |
| Woodcutting XP (1.0) | ✅ | Per harvest tick |
| Mining XP (1.2) | ✅ | Per harvest tick |
| Foraging XP (0.8) | ✅ | Per harvest tick |
| Building XP (1.0) | ✅ | Per build action |
| Crafting XP (1.5) | ✅ | Per craft completion |
| Survival XP (0.3) | ✅ | When needs < 30, scaled by desperation |
| Social XP (1.0) | ✅ | Per social/taming tick |
| **Defense XP from taking damage** | ✅ | Awarded from animal attacks (AnimalAI), poison damage, and environmental damage (starvation/dehydration/exhaustion) |
| **Foraging difficulty by plant rarity** | ❌ | Spec says 0.8-1.5 by plant type. Code uses flat 0.8 for berries, varying for others but not matching spec |

### Skill Effects on Gameplay
| Feature | Status | Notes |
|---|---|---|
| Hit accuracy `0.7 + combat×0.003` | ✅ | `getHitAccuracy()` |
| Attack damage formula | ✅ | `getAttackDamage()` with miss chance |
| Damage reduction `defense/(defense+100)` | ✅ | `getDamageReduction()` |
| Dodge chance `athletics×0.002` | ✅ | `getDodgeChance()` — applied in animal hunting code |
| Speed bonus `athletics×0.005` | ✅ | In `getAgentSpeed()` and `getAnimalSpeed()` |
| Harvest speed bonuses | ✅ | Per type (wood/stone/plant) |
| Building efficiency `1-level×0.003` | ✅ | In building execution |
| Need decay reduction `survival×0.002` | ✅ | `getNeedDecayReduction()` |
| Bonus wood/stone chance | ✅ | `skill_level × 0.005` |
| Health regen scaled by survival | ✅ | `max(0.05, 0.01 * survival_level)` per tick when needs > 50 |
| Poison check uses foraging | ✅ | `canIdentifyPoison(skills)` at foraging level 15 |
| Weight penalty on movement | ✅ | `getAgentSpeed()` — overloaded = can't move, 1.5× slower at full capacity |
| Carry capacity formula | ✅ | `100 + endurance×0.5`, +20 leather sack |
| **Flee success modifier** | ✅ | `base_flee × (1+athletics×0.01)` applied to flee movement speed |
| **Per-action stamina costs** | ✅ | Each action has distinct stamina cost with skill-based reduction |
| **Craft quality bonus** | ✅ | `1 + crafting_level×0.005` durability multiplier on crafted items |
| **Message influence from social** | ✅ | Effective obedience = base + social_level × 0.2 |

### Death & Respawn
| Feature | Status | Notes |
|---|---|---|
| 5% XP rust on death | ✅ | `applyDeathPenalty()` |
| Drop all resources + corpse | ✅ | Corpse with carried resources |
| Respawn at world center | ✅ | Center ±5 tiles, seeks walkable grass |
| 30-second respawn delay | ✅ | 300 ticks |
| **Agent spatial memory** | ✅ | Agents remember food/water/wood/stone/danger locations (max 20, 5-min expiry) |
| **Taming reset on death** | ✅ | All animals tamed by dying agent have tamed/tamedBy/tamingProgress reset |

### Nutrition System
| Feature | Status | Notes |
|---|---|---|
| Dual hunger bars | ✅ | `proteinHunger` + `plantHunger` |
| Diet types | ✅ | Carnivore/herbivore/omnivore with decay modifiers |
| Starvation damage | ✅ | Per-bar and combined |
| **Size-based decay rates** | ✅ | Hunger scaled by size: tiny 0.5×, small 0.75×, medium 1.0×, large 1.5× |
| **DietConfig enforcement** | ✅ | Agents eat diet-aware (meat→protein, food→plant). Animals eat by diet type. |
| **Grass grazing for herbivores** | ✅ | Herbivores/omnivores on grass gain +3 plant hunger per 5 ticks |

### Metabolism Scaling
| Feature | Status | Notes |
|---|---|---|
| Agent metabolism (level + activity) | ✅ | `getMetabolismMultiplier()` |
| Animal metabolism scaling | ✅ | `getAnimalMetabolism()` with `ANIMAL_ACTIVITY_MULTIPLIERS` |
| Rest recovery inverse scaling | ✅ | Both agents and animals |

---

## 2. DROPS & MATERIALS (DROPS_AND_MATERIALS.md)

| Feature | Status | Notes |
|---|---|---|
| 8 material categories | ✅ | All in Resources type |
| Per-species drop tables | ✅ | Full config |
| Randomized drops (0.8-1.2) | ✅ | In corpse creation |
| Corpse system (600 tick decay) | ✅ | Full implementation |
| Smell mechanic (sight/smell/sound) | ✅ | Full 3-sense awareness |
| Agent-as-prey | ✅ | Apex predators + dog hunt agents |
| Animal scavenging | ✅ | Scavengers find corpses, consume meat |
| Spoilage system | ✅ | `spoilsAfter` on ItemDefinition, meat decays at -1/300 ticks in GameLoop |
| **Scavenge vs hunt utility (1.3× bonus)** | ❌ | Animals scavenge but no explicit utility comparison favoring scavenging |
| **Rotten meat as item** | ✅ | Spoiled meat becomes rotten_meat inventory item, eating it gives +5 protein but -10 health |

---

## 3. CRAFTING SYSTEM (CRAFTING.md)

### Inventory & Weight
| Feature | Status | Notes |
|---|---|---|
| Weight-based inventory | ✅ | `getCarryWeight()` / `getCarryCapacity()` |
| 3 equipment slots | ✅ | mainHand, body, accessory |
| Movement speed penalty from weight | ✅ | `getAgentSpeed()` with weight ratio |
| Overweight = can't move | ✅ | Returns 0 speed when over capacity |
| 52 item definitions | ✅ | Full catalog in `ItemDefinitions.ts` |
| **Pack Donkey +50 carry** | ❌ | Not implemented |

### Recipes & Crafting
| Feature | Status | Notes |
|---|---|---|
| 63 recipes | ✅ | Full list in `RecipeDefinitions.ts` across 4 stations |
| Station proximity check | ✅ | `isAdjacentToTile()` for campfire/workbench/forge |
| Skill-gated recipes | ✅ | `skillRequired` checked |
| Craft time / stamina cost | ✅ | Per-recipe in definitions |
| Food recipes (cooking) | ✅ | Cooked meat, stew, jerky, bone broth, etc. |
| Auto-prioritize food crafting when hungry | ✅ | Priority 48 for food recipes vs 25 for others |
| Auto-equip best tool | ✅ | Tool bonus lookup in harvesting execution |
| **Iron ore requires iron pickaxe** | ✅ | Decision and execution both require `iron_pickaxe` specifically |
| **Tool repair mechanic** | ❌ | Durability depletes, no repair |

### Structures
| Feature | Status | Notes |
|---|---|---|
| Structure HP by type | ✅ | Full config |
| Wood decay over time | ✅ | -1 HP / 600 ticks |
| Storage containers | ✅ | 200 weight capacity |
| Door blocks animals | ✅ | Pathfinding treats as non-walkable for animals |
| **Structure damage/destruction** | ✅ | Large/medium predators bash structures when blocked during hunting |

### Trading
| Feature | Status | Notes |
|---|---|---|
| Basic resource swap | ✅ | 10% chance during socializing: food↔wood, food↔stone (2 units) |
| **Dedicated trading action** | ❌ | `trading` action type exists but no standalone logic — only happens inside socializing |
| **Trade negotiation / social skill** | ❌ | Random swap, no skill influence |

---

## 4. ANIMALS SYSTEM (ANIMALS.md)

### Core Systems
| Feature | Status | Notes |
|---|---|---|
| 20+ species with full config | ✅ | |
| Utility AI with response curves | ✅ | quadratic/linear/logistic |
| 3-sense awareness (sight/smell/sound) | ✅ | |
| Animals detect + hunt agents | ✅ | Proper combat, not splash damage |
| Pack coordination | ✅ | Howl alerts, pack damage bonus |
| All 9 special abilities | ✅ | Ambush, curl, howl, trample, steal, seed, egg, peace aura, panic |
| Day/night activity | ✅ | Diurnal/nocturnal/crepuscular |
| Flocking behaviors | ✅ | Separation/alignment/cohesion |
| Breed system with litter sizes | ✅ | Population-capped |
| Animal metabolism scaling | ✅ | Level + activity multipliers |

### Taming
| Feature | Status | Notes |
|---|---|---|
| Taming decision | ✅ | Priority 20, targets tameable animals within 3 tiles |
| Taming execution (feed food) | ✅ | -1 meat/food per tick, increments `tamingProgress` |
| Taming completion | ✅ | When `tamingProgress >= tamingCost`: tamed=true, home set |
| Tamed follow/guard behaviors | ✅ | Both implemented |
| Taming progress on UI | ✅ | Shows progress and "TAMED" label |
| **Tamed animals carry items** | ❌ | No pack animal system |
| **Taming reset on owner death** | ✅ | Bond reset on agent death |

### Agent Self-Defense
| Feature | Status | Notes |
|---|---|---|
| Agent fights back when attacked | ✅ | Priority 93, auto-equips weapon, attacks if strong enough |
| Condition check | ✅ | Only if agent's attack > attacker's attack × 0.5 |
| **Agent group defense** | ✅ | Agents within 8 tiles rush to defend allies under attack (priority 75) |

---

## 5. CLIENT/UI

| Feature | Status | Notes |
|---|---|---|
| All 10 skill levels | ✅ | In agent panel |
| Dual hunger bars | ✅ | Protein + plant separate |
| Inventory + equipment | ✅ | With durability |
| Taming progress | ✅ | Shows on animal panel |
| Metabolism multiplier | ✅ | Displayed as "Metabolism: X.Xx" |
| Carry weight estimate | ✅ | Approximate weight shown |
| Animal drops on panel | ✅ | Full drop table |
| Corpse rendering + panel | ✅ | Materials + carried items |
| **Exact carry weight/capacity** | ✅ | Server sends computed carryWeight/carryCapacity, client displays exact values |
| **Crafting recipe browser** | ❌ | No way for player to see available recipes |
| **Smell/detection visualization** | ❌ | Can't see awareness radii |
| **Tool icon on agent sprite** | ❌ | Agents look same regardless of equipment |

---

## 6. REMAINING GAPS — PRIORITY

### Critical
1. ✅ **GOAP multi-step planning** — Verified 2026-03-29. Backward-chaining A* planner with 10 goals, 22 actions, personality cost modifiers (industrious/lazy/social/loner), plan persistence via server-side Map, staggered re-planning (1 agent/tick), 3-layer decision architecture (interrupts → GOAP → fallback), plan invalidation (precondition/validity/age checks), and full UI display with step indicators. See `server/src/ai/GOAPPlanner.ts` + NeedsSystem integration.

### High
2. ✅ **Defense XP for agents** — Verified 2026-03-29. Awarded from: animal attacks (AnimalAI:1231), poison mushrooms (NeedsSystem:1209), rotten meat (NeedsSystem:1059), environmental damage (NeedsSystem:429). All non-PvP damage sources covered.
3. ✅ **Per-action stamina costs** — Verified 2026-03-29. 12 distinct action costs (NeedsSystem:382-405): idle 0.02 → harvesting 0.12. Skill reduction `relevant_skill × 0.002`, scaled by metabolism.
4. ✅ **Flee success modifier** — Verified 2026-03-29. Flee speed = base × `(1 + athletics × 0.01)` (NeedsSystem:1603). Plus dodge chance `athletics × 0.002` (Progression:279).
5. ✅ **Diet enforcement** — Verified 2026-03-29. Agents are omnivores by spec design. Eating routes meat→protein, food→plant (NeedsSystem:1040-1061). Animals enforce diet throughout AnimalAI.
6. ✅ **Iron ore tool requirement** — Verified 2026-03-29. Execution checks `ironTool?.itemId === 'iron_pickaxe'` (NeedsSystem:1338). Silent no-op if missing.
7. ✅ **Rotten meat item** — Verified 2026-03-29. Spoilage: meat→rotten_meat every 300 ticks (GameLoop:363-375). Eating: +5 protein, −10 health, defense XP (NeedsSystem:1052-1060).

### Medium — All Verified 2026-03-29
8. ✅ Size-based hunger decay rates — 4-tier scaling (AnimalAI:520-524): tiny 0.5×, small 0.75×, medium 1.0×, large 1.5×.
9. ✅ Craft quality bonus — `1 + crafting_level × 0.005` durability multiplier (NeedsSystem:1487-1491). ~1.5× at level 99.
10. ✅ Social skill influence on obedience — `effectiveObedience = base + social × 0.2` (NeedsSystem:469-471). Message cost scales with socialScore (GameLoop:409).
11. ✅ Agent spatial memory — `rememberLocation()` / `recallLocation()` (NeedsSystem:94-120). 6 types, max 20 entries, 5-min expiry. Used for water, wood, stone, food fallback.
12. ✅ Structure attack/destruction — `damageStructure()` in World.ts:1139. Large/medium predators bash when path-blocked (AnimalAI:1587-1594). Structures removed at HP ≤ 0.
13. ✅ Grass grazing for herbivores — Herbivores/omnivores on GRASS tiles gain +3 plantHunger every 5 ticks (AnimalAI:1108-1115).
14. ✅ Agent group defense coordination — Allies within 8 tiles join fight at priority 75 (NeedsSystem:561-582). Only when helper not already under attack.
15. ✅ Taming reset when owner dies — GameLoop:96-103 iterates all animals, resets `tamed`/`tamedBy`/`tamingProgress` for dead agent's animals.
16. ✅ Client carry weight is exact — Server computes `carryWeight`/`carryCapacity` (GameLoop:79-80). Client displays exact floor values (UIScene:399-403).

### Low / Future
17. ❌ Tool repair mechanic
18. ❌ Pack donkey carry bonus (+50)
19. ❌ Tamed animals carry items
20. ❌ Crafting recipe UI for players
21. ❌ Detection range visualization
22. ❌ Agent equipped tool visible on sprite
23. ❌ Scavenge vs hunt utility comparison (1.3× bonus)
24. ❌ Foraging XP difficulty by plant rarity
