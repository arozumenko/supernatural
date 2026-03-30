# Ecosystem Issues — Developer Action Required

**Date:** 2026-03-29
**Source:** Full ecosystem audit — every species, resource, and crafting chain reviewed
**Dashboard:** See `docs/ecosystem_dashboard.html` for interactive visualization

---

## Critical Issues (6)

### C1 — Scales: Single-Source Bottleneck

**Problem:** Alligator is the ONLY species that drops scales. Max 6 alligators alive. Scale recipes need 19 total scales (armor 10 + shield 6 + pendant 3). If alligators go extinct or are overhunted, entire scale crafting tree is permanently locked until respawn.

**Impact:** Blocks 3 recipes (scale_armor, scale_shield, scale_pendant) — the best armor and second-best shield in the game.

**Fix Options (pick one or combine):**
- **A) Add scales to another species.** Snake is the obvious candidate but doesn't exist yet. Alternatively, give fish/turtle scales if aquatic species are added. Cheapest fix: give large lizard-like creatures (hedgehog?) a small scale drop (1-2).
- **B) Add a second scale source.** Introduce a `fish` species (water_edge habitat, tiny/small, drops scales 2-3). Fills the aquatic niche gap anyway.
- **C) Scale recycling.** Allow dismantling scale items back into raw scales at a workbench (50% return).

**Files:** `server/src/AnimalSpeciesConfig.ts` (add drops), optionally new species

---

### C2 — Feathers: Dual-Source Fragility

**Problem:** Only chicken (3/kill) and duck (4/kill) drop feathers. Recipes need 19+ feathers (bedroll 8, crown 6, arrows 1×N, iron arrows 2×N). If both bird species die, arrows become uncraftable — locking the only ranged weapon in the game.

**Impact:** Blocks bow+arrow combat path, feather bedroll, feather crown. Ranged combat becomes impossible.

**Fix Options:**
- **A) Add feather drops to another species.** Squirrel could drop 1 feather (found in nests). Or add a new bird species (crow, pigeon) as a third feather source.
- **B) Alternative arrow recipe.** Add a `bone arrow` recipe that uses bone instead of feathers (bone 2 + wood 1 → 3 arrows, slightly weaker). Keeps ranged viable without birds.
- **C) Both A + B.** Safest option.

**Files:** `server/src/AnimalSpeciesConfig.ts`, `server/src/RecipeDefinitions.ts`

---

### C3 — Donkey Has No Mid-Tier Predators

**Problem:** Donkey `fleesFrom: [tiger, bear, alligator]` — all apex. No mid-tier predator hunts or threatens donkeys. If apex predators die, donkey population is completely uncontrolled — breeds to maxPop 8 and stays there, consuming plants without any predation check.

**Impact:** Unchecked herbivore → accelerated plant depletion → ecosystem destabilization.

**Fix:** Add dog-0 to donkey's `fleesFrom` list AND add donkey to dog-0's `hunts` array. Dogs are pack hunters (3-6 pack size) which makes them a believable threat to a donkey. Also consider adding fox to fleesFrom (foxes harass but don't kill — creates flee behavior without actual kills).

**Files:** `server/src/AnimalSpeciesConfig.ts`
```
donkey.fleesFrom: add 'dog-0'
dog-0.hunts: add 'donkey'
```

---

### C4 — Horse Is Never Actively Hunted

**Problem:** Horse appears in ZERO `hunts[]` arrays across all 20 species. No predator targets horses. Horse `fleesFrom: [tiger, bear, dog-0, alligator]` triggers flee behavior, but none of these predators actively seek horses. Population controlled only by starvation.

**Impact:** With grass grazing + 0.65 speed (fastest large animal), horses are nearly invulnerable. They'll breed to maxPop 10 and hold steady, consuming plant resources without population control.

**Fix:** Add horse to tiger's and bear's `hunts` arrays. Tiger (0.55 speed) can't outrun horse (0.65 speed), making it a challenging but rewarding hunt — this is good gameplay. Bear is slower (0.25) so would only catch resting/low-stamina horses.

**Files:** `server/src/AnimalSpeciesConfig.ts`
```
tiger.hunts: add 'horse'
bear.hunts: add 'horse'
```

---

### C5 — Goat Only Hunted by Tiger

**Problem:** Goat appears in only tiger's `hunts` array. Tiger maxPop is 4 — easily the first apex to go extinct. When tigers die, goat population (maxPop 12) has zero predation pressure.

**Impact:** Similar to C3/C4 — unchecked herbivore breeding.

**Fix:** Add goat to dog-0's and fox's `hunts` arrays. Dogs can hunt medium prey (they already hunt deer and sheep). Foxes hunting goat kids is ecologically realistic.

**Files:** `server/src/AnimalSpeciesConfig.ts`
```
dog-0.hunts: add 'goat'
fox.hunts: add 'goat'
```

---

### C6 — Capybara Tier Mismatch

**Problem:** Capybara is `size: medium`, `diet: herbivore`, `hp: 45`, `social: herd`, `packSize: 4-8` — identical profile to medium_herb species (goat, sheep). But it's classified as `tier: small_prey`. This causes:
- Incorrect breeding rate assumptions (small_prey has faster base rates)
- Wrong predator-prey balance calculations
- AI behavior expectations mismatch (small_prey flees more aggressively)

**Fix:** Reclassify capybara to `tier: medium_herb`. Review hungerDecay (currently 0.12, matching medium_herb — already correct). Verify flee behavior thresholds align with new tier.

**Files:** `server/src/AnimalSpeciesConfig.ts`
```
capybara.tier: 'small_prey' → 'medium_herb'
```

---

## Warnings (8)

### W1 — Pig Attack Power Is Anomalous

**Problem:** Pig has 20 ATK — higher than deer (12), goat (10), sheep (3), and comparable to horse (18) and donkey (16). Pig is classified as `medium_herb` but fights harder than most predators. A pig has higher attack than a fox (10) or cat (8).

**Recommendation:** Either reduce pig ATK to 12 (matching deer) OR reclassify pig as a more aggressive species. Its omnivore diet + scavenger ability + 20 ATK makes it more of a mid-tier opportunist than an herbivore.

**Suggested fix:** Reduce `pig.attack` from 20 to 14. Still the toughest medium_herb, but no longer predator-tier.

---

### W2 — Rat Is Mid-Predator That Hunts Nothing

**Problem:** Rat is `tier: mid_predator` with an empty `hunts[]` array. It's really a scavenger (steal_food ability). Being classified as mid_predator means it's counted in predator population totals and affected by predator-specific breeding adjustments.

**Recommendation:** Reclassify rat to `tier: small_prey` or create a new `scavenger` tier. Alternatively, add small insects/worms as prey if we want to keep mid_predator classification (but this would require new food entities).

**Suggested fix:** Reclassify `rat.tier` to `small_prey`. Adjust maxPopulation calculations accordingly.

---

### W3 — Bear Never Forages Despite Omnivore Diet

**Problem:** Bear's `diet: omnivore` but `hunts: [deer, pig, rabbit, agent]` — all animal prey. The AnimalAI does have omnivore plant eating, but bears don't prioritize foraging. In nature, bears get 70%+ of calories from plants/berries. A purely hunting bear burns too much stamina and dies when prey is scarce.

**Recommendation:** Verify that AnimalAI's omnivore eating logic allows bears to eat plants/berries when protein is satisfied but plantHunger is low. If not, add explicit foraging behavior for omnivore predators.

---

### W4 — Six Species Have Zero Predators

**Problem:** These species appear in no predator's `hunts[]` array:
- **Horse** (maxPop 10) — covered in C4
- **Donkey** (maxPop 8) — covered in C3
- **Capybara** (maxPop 12) — needs predators added
- **Hedgehog** (maxPop 8) — curl ability is only defense, but nobody actually hunts it
- **Squirrel** (maxPop 15) — cat hunts squirrel ✓, but fox and dog don't
- **Goat** (maxPop 12) — only tiger, covered in C5

**Fix for remaining gaps:**
```
fox.hunts: add 'squirrel' (already in cat.hunts, add fox too)
dog-0.hunts: add 'capybara'
tiger.hunts: add 'capybara'
fox.hunts: add 'hedgehog' (foxes eat hedgehogs in nature)
```

---

### W5 — Alligator Speed Makes It Ineffective on Land

**Problem:** Alligator speed 0.15 — slowest of all predators. Even rabbit (0.50) outruns it easily. Alligator relies entirely on ambush ability near water. If prey doesn't come to water, alligator starves.

**Recommendation:** This is partially by design (ambush predator). But verify that alligator habitat spawning guarantees water adjacency. Consider adding a small speed boost in water tiles (0.15 → 0.30 on water-adjacent tiles) to make ambush range more viable.

---

### W6 — Sinew Rope as Crafting Intermediate Blocks GOAP

**Problem:** Animal Pen requires `sinew_rope × 2` — a crafted item, not a raw material. Agent must first craft sinew rope (sinew 4 → 1 rope) then use it. If GOAP planner doesn't model multi-step crafting dependencies (craft intermediate → use in recipe), agents will never build animal pens.

**Verify:** Check that `GOAPPlanner.ts` handles crafting chains where the output of one recipe is the input to another. If not, either:
- A) Add a GOAP action for crafting intermediates, or
- B) Change animal pen recipe to use raw sinew directly: `sinew 8 + wood 12 + bone 4`

---

### W7 — Agent Corpse Drops Are Unrewarding

**Problem:** With random 5-15 base stats, average agent corpse drops ~6 meat, 3 bone, 2 hide, 2 fat, 1 sinew. This is less than a sheep kill (4 meat, 2 bone, 4 hide, 3 fat, 1 sinew) and far less than cow (14 meat, 6 bone, 6 hide, 6 fat, 4 sinew). Predators hunting agents get poor return for high risk.

**Impact:** Apex predators that hunt agents are making a bad caloric choice. A tiger gets more food from a sheep than an agent.

**Recommendation:** Increase agent base drops or add agent-specific materials. Consider: agents carry inventory, so their corpse should also include carried items (already implemented — verify it works for predator access).

---

### W8 — Winter Breeding Freeze + Slow Respawn = Population Crash

**Problem:** Winter disables ALL breeding for 6000 ticks (10 min real time). Combined with slow breed cooldowns (bear: 12000 ticks, horse: 9000 ticks), any deaths during winter can't be replaced until spring. A single aggressive agent hunting during winter could cause species extinction.

**Recommendation:** Instead of complete breeding freeze in winter, use `breedingCooldownMult: 3.0` (3× slower, not infinite). This allows emergency replacement of killed animals while still reducing population growth.

**Files:** `server/src/GameLoop.ts` — change winter `breedingCooldownMult` from `Infinity` to `3.0`

---

## Summary: Required Hunt Array Changes

This table consolidates all the `hunts[]` and `fleesFrom[]` changes from C3-C5 and W4:

| Predator | Add to hunts[] | Rationale |
|---|---|---|
| tiger | horse, capybara | Horse is never hunted; capybara has no predators |
| bear | horse | Horse is never hunted; bear is opportunistic |
| dog-0 | donkey, goat, capybara | Fill mid-tier predation gap for 3 unhunted herbivores |
| fox | goat, squirrel, hedgehog | Fill small-predator gap; ecologically accurate |

| Prey | Add to fleesFrom[] | Rationale |
|---|---|---|
| donkey | dog-0 | Currently only flees apex |
| capybara | bear, fox | Currently only flees tiger, alligator, dog |
| hedgehog | cat | Currently only flees fox, dog, bear |

---

## Summary: Reclassifications

| Species | Current | Proposed | Reason |
|---|---|---|---|
| capybara | small_prey | medium_herb | Size, diet, HP, social all match medium_herb |
| rat | mid_predator | small_prey | Hunts nothing; is scavenger not predator |
| pig | attack 20 | attack 14 | ATK higher than most predators; anomalous for herbivore |

---

## Summary: Crafting Fixes

| Issue | Fix |
|---|---|
| Scales single-source | Add new aquatic species with scale drops, OR add scale recycling recipe |
| Feathers dual-source | Add bone arrow recipe (no feathers), OR add feather drops to squirrel |
| Sinew rope intermediate | Verify GOAP handles it, OR replace with raw sinew in animal pen recipe |
| Winter breeding freeze | Change from `Infinity` to `3.0` multiplier |

---

## Implementation Order

1. **Hunt array fixes** (C3, C4, C5, W4) — pure config changes, zero risk, immediate balance improvement
2. **Tier reclassifications** (C6, W2) — config changes, verify AI behavior
3. **Pig ATK nerf** (W1) — single number change
4. **Winter breeding softening** (W8) — single constant change
5. **Feather alternative recipe** (C2) — add bone arrow recipe to RecipeDefinitions
6. **Scale second source** (C1) — either new species or recycling recipe
7. **GOAP intermediate crafting verification** (W6) — code audit
