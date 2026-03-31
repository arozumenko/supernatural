## World
- Tile grid (configurable size, default 120×90), 10 ticks/second.
- Biomes: grass, forest, desert (sand), mountains (rock/stone), water (impassable), beach, swamp.
- Resources on map: trees (wood), rocks (stone), berry bushes (berries), iron ore (rare, finite — 15-20 deposits, never respawn).
- Animals: 20 species across 5 tiers — apex predators (bear, tiger, alligator), mid predators (fox, cat, dog/wolf, rat), large herbivores (deer, cow, horse), medium herbivores (pig, goat, sheep, donkey), small prey (rabbit, chicken, duck, squirrel, hedgehog, capybara).
- Seasons cycle and affect resource availability.

## Agent Needs (0-100 each, decay every tick)
- **proteinHunger** — decays 0.06/tick. Restored by eating meat, cooked meat, fish. Below 30 = critical.
- **plantHunger** — decays 0.06/tick. Restored by eating berries, mushrooms, cooked plants. Below 30 = critical.
- **thirst** — decays constantly. Restored by drinking at adjacent water tile (+30). Below 30 = critical.
- **stamina** — drains from movement and actions, recovers by resting (+4.5/tick). Below 15 = exhaustion.
- **health** — regenerates slowly when hunger > 50, thirst > 50, stamina > 30. Damaged by combat, starvation (-0.5/tick per unfilled hunger bar, -1.5/tick if both depleted), exposure (no shelter = -0.15/tick), poison.
- **social** — decays slowly, restored by interacting with other agents. Agents decide friend/foe on first meeting; friends chat (+healing), foes fight.
- **shelter** — restored near structures (campfire, walls, tent). Decays when exposed.

## Agent Decision Priority System (every tick, highest priority wins)
The agent has a built-in decision engine controlled by its Behavior Genome. Decisions are evaluated each tick — the action with the highest priority score executes.

**Tier 1 — Critical Interrupts (priority 70-99):**
- Flee from predator/threat (~75)
- Critical thirst < 30 → find water (priority ~95)
- Fight back when attacked (~93 if strong enough, ~85 otherwise)
- Critical hunger < 30 → find food (priority ~90)
- Low health → rest or flee (~88)
- Exhaustion stamina < 15 → rest (~80)

**Tier 2 — API Plan Execution (priority up to 70):**
- If an active plan exists (from Puppeteer, Darwinist, etc.), the current step executes at the plan's priority.
- Plans are abandoned if expired, all steps complete, or if abandonOnDanger=true and a threat is nearby.

**Tier 3 — GOAP Planning (priority ~50):**
- Agent's built-in goal planner evaluates multi-step goals: survive_thirst, survive_protein, survive_plant, rest, get_shelter, get_equipped, socialize, stockpile_wood, stockpile_stone, cook_food.
- Goal urgency is weighted by genome goalWeights. Relevance thresholds determine when goals activate.

**Tier 4 — Medium Priorities (priority 53-63):**
- Moderate thirst (< genome threshold, default 80) → drink
- Moderate hunger → eat or forage

**Tier 5 — Fallback Activities (priority 20-50):**
- Harvest corpses, gather wood, mine stone, hunt animals, socialize, mine iron, craft items, tame animals, plant seeds.
- Each weighted by genome fallbackWeights.

**Tier 6 — Wander (priority 10):**
- Random 5-tile walk if nothing else to do.

**Strategy Rules** can override any of the above — they evaluate conditions (need levels, nearby entities, skill levels, lives remaining) and apply effects (boost/suppress priorities, force actions, modify thresholds).

## Death, Lives & Respawn
- Agents start with 100 lives.
- 9 death causes: starvation_protein, starvation_plant, starvation_both, dehydration, killed_by_animal, killed_by_agent, exhaustion, poison, exposure.
- On death: **40% XP loss** across all skills, random base stat -1, all needs/health reset.
- Skills are preserved (levels remain) — the skill knowledge carries over between lives.
- After death, agent respawns at a random grass tile with reset inventory.
- Lives decrease by 1 per death. At 0 lives = permadeath (agent permanently removed).
- Achievements can grant bonus lives (high skill levels, survival milestones).

## Combat
- Melee damage = effective_strength × weapon_modifier.
- effective_stat = base_stat + skill_level (capped at base + 99).
- Agents gain Combat XP from fighting, Defense XP from being hit.
- Confidence system: agents assess threats using (totalSkills/100 + attack/20 + equipment/20) × healthPercent.
- Agents flee from threats they can't handle, fight those they can.
- Agent-vs-agent combat: disposition decided on first meeting. Aggression scales with level (10% base → 50% at max).
- Cannibalism: starving agents (protein < 15) may hunt other agents as last resort. Witnesses permanently mark cannibals as enemies.
- Killing another agent grants large XP bonus.

## Crafting & Building
- 52 items, 53 recipes across 4 material tiers: hand → wood → stone → bone/hide → iron.
- Tool durability: wood 50 uses, stone 120, bone 100, iron 300.
- Key structures: campfire (cooking/light/shelter), workbench (crafting), forge (iron smelting), walls (defense), tent (shelter/sleep), storage (200 weight).
- Crafting skill gates: level 0-5 basic, 10-15 intermediate, 20-25 advanced, 35 endgame.
- Iron is extremely scarce: 15-20 deposits total, 2-4 ore each, never respawn. Agent with iron gear has massive advantage.

## Skills (10 skills, level 0-99)
- Combat, Defense, Athletics, Woodcutting, Mining, Foraging, Building, Crafting, Survival, Social.
- Level formula: floor(sqrt(total_xp / 50)) — quadratic, slowing curve.
- Skills improve by performing related actions. Higher skill = faster/better at that action.
- Perception base stat affects detection range. Agility affects movement speed. Endurance affects carry capacity.

## Obedience
- Each agent has an obedience score (0-100). Higher = more likely to follow messages/plans.
- Personality traits affect obedience: 'obedient' trait = higher base, 'independent' = lower.
- Plans from darwinist and chaos_demon roles bypass obedience checks.

## What You See Each Observation
You receive a structured summary containing:
- Agent's current position, biome, action, and reason for action
- All 7 need levels with CRITICAL/LOW/OK indicators and urgent needs list
- Resources in inventory (wood, stone, meat, berries, iron_ore, etc.)
- Equipment (mainHand, body, accessory slots)
- All 10 skill levels
- Personality traits and obedience score
- Nearby threats (species, distance, direction, danger level)
- Nearby resources (type, distance, direction)
- Nearby agents (name, distance, direction, relationship score)
- Nearby corpses (species, distance, direction, ticks remaining before despawn)
- Current plan status (if any)
- Genome version, active strategy rules, fitness score
- Current life duration, best life duration, lives remaining, Highlander status
- Last 5 recent events (combat, kills, crafting, discoveries, etc.)
- Trends (thirst/health rising or falling over last few observations)