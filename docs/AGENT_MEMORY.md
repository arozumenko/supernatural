# Agent Memory & Evolution System

**Status**: Spec v1 — 2026-03-29
**Depends on**: GOAP.md, PROGRESSION.md, SIMULATION.md

## Overview

Agents are mortal beings that learn from experience. Every action, every encounter, every death is recorded into a **Life Journal**. When an agent dies, its journal is sent to an LLM which analyzes what went wrong and rewrites the agent's **Behavior Genome** — a weighted JSON config that governs all decision-making.

Each agent starts with **100 lives**. Lives decrease on death, increase with skill levels. When lives reach **0**, the agent is permanently dead. The goal: become a **Highlander** — an agent that never runs out of lives.

---

## 1. Behavior Genome

The Behavior Genome replaces hardcoded decision priorities with a per-agent JSON config that the existing NeedsSystem and GOAP planner interpret at runtime.

### 1.1 Schema

```typescript
interface BehaviorGenome {
  // === IDENTITY ===
  version: number;                    // incremented on each LLM mutation
  generation: number;                 // how many deaths this genome has survived through
  lineage: string[];                  // history of death causes that shaped this genome

  // === INTERRUPT LAYER (Layer 1) ===
  // Override the hardcoded priorities with per-agent weights
  interruptWeights: {
    criticalThirst: number;           // default 95, range [60, 99]
    fightBack: number;                // default 93
    criticalHunger: number;           // default 90
    lowHealth: number;                // default 88
    staminaHerb: number;             // default 82
    exhaustionRest: number;          // default 80
    groupDefense: number;            // default 75
    fleeBase: number;                // default 70, actual = fleeBase + proximityBonus
  };

  // === MEDIUM PRIORITY LAYER (between interrupts and GOAP) ===
  // These fire when needs are moderate (not critical) — the "act early" tier
  mediumPriorityWeights: {
    drinkMedium: number;             // default 60 — when thirst < 50
    eatMedium: number;               // default 55 — when hunger < 50
    forageMedium: number;            // default 55 — find food plants when no food in inventory
  };

  // === INTERRUPT THRESHOLDS ===
  // When do interrupts fire? Agents can learn to be more/less cautious
  thresholds: {
    criticalThirst: number;          // default 20 (fires when thirst < this)
    criticalHunger: number;          // default 20
    criticalStamina: number;         // default 15
    criticalHealth: number;          // default 30
    moderateHealth: number;          // default 60
    fleeHealthPanic: number;         // default 0.3 (30% HP triggers panic flee)
    fightBackMinRatio: number;       // default 0.5 (only fight if myATK > enemy * this)
    groupDefenseRange: number;       // default 8 (ally must be within this range)

    // Resource thresholds — when to start gathering
    meatMinimum: number;             // default 3 (harvest corpses when meat < this)
    woodMinimum: number;             // default 10 (gather wood when wood < this)
    stoneMinimum: number;            // default 5 (mine stone when stone < this)
    ironOreMinimum: number;          // default 4 (mine iron when iron_ore < this)

    // Planting thresholds
    plantHungerTrigger: number;      // default 60 (plant food seeds when hunger < this)
    woodToKeepBeforePlanting: number;// default 5 (only plant tree seeds if wood > this)

    // Detection range modifiers
    threatDetectBase: number;        // default 6 (base visual detect range, skill adds up to +10)
    huntDetectRange: number;         // default 15 (max range to consider hunting a target)
    socialDetectRange: number;       // default 15 (max range to consider socializing)
    corpseDetectRange: number;       // default 15 (max range to detect corpses)
    ironDetectRange: number;         // default 20 (max range to detect iron ore)
  };

  // === GOAP LAYER (Layer 2) ===
  // Weight multipliers on goal urgency — higher = more likely to be selected
  goalWeights: {
    survive_thirst: number;          // default 1.0
    survive_protein: number;         // default 1.0
    survive_plant: number;           // default 1.0
    rest: number;                    // default 1.0
    get_shelter: number;             // default 1.0
    get_equipped: number;            // default 1.0
    socialize: number;               // default 1.0
    stockpile_wood: number;          // default 1.0
    stockpile_stone: number;         // default 1.0
    cook_food: number;               // default 1.0
  };

  // GOAP action cost multipliers — lower = preferred
  actionCostMods: Record<string, number>;  // actionId -> multiplier, default 1.0

  // GOAP goal thresholds — when does a goal become relevant?
  goalThresholds: {
    thirstRelevant: number;          // default 50 (goal active when thirst < this)
    proteinRelevant: number;         // default 50
    plantRelevant: number;           // default 50
    staminaRelevant: number;         // default 30
    shelterRelevant: number;         // default 40
    socialRelevant: number;          // default 40
    woodTarget: number;              // default 15 (stockpile until this amount)
    stoneTarget: number;             // default 8
  };

  // === FALLBACK LAYER (Layer 3) ===
  fallbackWeights: {
    drinkMedium: number;             // default 60
    eatMedium: number;               // default 55
    harvestCorpse: number;           // default 50
    gatherWood: number;              // default 35
    mineStone: number;               // default 30
    huntAnimal: number;              // default 40
    socialize: number;               // default 30
    mineIron: number;                // default 28
    craft: number;                   // default 25
    tameAnimal: number;              // default 20
    plantSeeds: number;              // default 20
    wander: number;                  // default 10
  };

  // === STRATEGY RULES (LLM-generated) ===
  // Custom rules that the decision engine evaluates as additional behavior
  strategyRules: StrategyRule[];

  // === META ===
  createdAt: number;                 // tick when this genome was first created
  mutatedAt: number;                 // tick of last LLM mutation
  fitnessScore: number;             // LLM-assigned score of how good this genome is (0-100)
}
```

### 1.2 Strategy Rules

The radical mutation feature: LLM can inject custom conditional rules that the decision engine evaluates alongside normal behavior.

```typescript
interface StrategyRule {
  id: string;                        // unique rule identifier
  name: string;                      // human-readable name, e.g. "water_hoarder"
  condition: RuleCondition;          // when to activate
  effect: RuleEffect;               // what to do
  priority: number;                  // 1-99, where this slots into decision priority
  enabled: boolean;                  // LLM can disable rules without deleting them
  source: string;                    // "death_3: starved near water" — why this rule exists
}

interface RuleCondition {
  type: 'need_below' | 'need_above' | 'resource_below' | 'resource_above'
      | 'near_entity' | 'time_of_day' | 'health_percent' | 'skill_level'
      | 'deaths_remaining' | 'and' | 'or' | 'not';
  // For leaf conditions:
  field?: string;                    // e.g. "thirst", "wood", "combat.level"
  value?: number;                    // threshold value
  entityType?: string;              // for near_entity: "water", "tree", "animal:bear"
  range?: number;                   // for near_entity: detection range
  // For compound conditions:
  conditions?: RuleCondition[];     // children for and/or/not
}

interface RuleEffect {
  type: 'boost_priority' | 'suppress_action' | 'force_action'
      | 'modify_threshold' | 'modify_weight' | 'flee_from' | 'prefer_target';
  action?: string;                   // target action
  amount?: number;                  // boost/suppress amount
  targetField?: string;             // for modify_threshold
  targetValue?: number;
}
```

**Example strategy rules the LLM might create:**

```json
{
  "id": "pre_drink",
  "name": "Preemptive Drinker",
  "condition": { "type": "need_below", "field": "thirst", "value": 60 },
  "effect": { "type": "boost_priority", "action": "drinking", "amount": 30 },
  "priority": 65,
  "enabled": true,
  "source": "death_4: dehydrated while mining far from water"
}
```

```json
{
  "id": "tiger_zone",
  "name": "Tiger Avoidance Zone",
  "condition": {
    "type": "and",
    "conditions": [
      { "type": "near_entity", "entityType": "animal:tiger", "range": 15 },
      { "type": "health_percent", "value": 70 }
    ]
  },
  "effect": { "type": "force_action", "action": "fleeing" },
  "priority": 72,
  "enabled": true,
  "source": "death_7: killed by tiger while low health"
}
```

```json
{
  "id": "desperation_mode",
  "name": "Desperation Mode",
  "condition": { "type": "deaths_remaining", "value": 10 },
  "effect": { "type": "modify_threshold", "targetField": "fleeHealthPanic", "targetValue": 0.6 },
  "priority": 90,
  "enabled": true,
  "source": "auto: fewer than 10 lives remaining"
}
```

### 1.3 Default Genome

Every new agent starts with the **default genome** — all weights at 1.0, all thresholds at their current hardcoded values, zero strategy rules. This means the first life plays exactly like the current system. Evolution begins at the first death.

### 1.4 Rule Safety Bounds

The server enforces hard limits the LLM cannot exceed:

| Parameter | Min | Max | Notes |
|-----------|-----|-----|-------|
| Interrupt priorities | 60 | 99 | Can't go below interrupt threshold |
| Medium priority weights | 40 | 70 | Must stay between interrupt and fallback ranges |
| Thresholds (needs) | 5 | 95 | Can't set to extremes |
| Resource minimums | 0 | 50 | Can't hoard excessively before acting |
| Detection ranges | 3 | 30 | Must stay within world-reasonable bounds |
| Goal weights | 0.1 | 5.0 | Can't fully disable survival goals |
| Action cost mods | 0.2 | 5.0 | Can't make anything free or impossible |
| Fallback priorities | 5 | 70 | Can't exceed interrupt range |
| Strategy rules | 0 | 15 | Max 15 custom rules |
| Rule priority | 1 | 99 | - |

---

## 2. Life Journal (Experience Recording)

Every life is recorded as a structured journal that the LLM reads on death.

### 2.1 Schema

```typescript
interface LifeJournal {
  agentId: string;
  agentName: string;
  lifeNumber: number;                // which life is this (100 - livesRemaining)
  livesRemaining: number;

  // Snapshot at birth
  birthTick: number;
  birthStats: BaseStats;
  birthSkills: Record<string, number>;  // skill name -> level at life start
  birthPersonality: PersonalityTrait[];
  genomeVersion: number;             // which genome version was active

  // Life summary (computed at death)
  deathTick: number;
  deathCause: DeathCause;
  survivalTicks: number;             // how long this life lasted

  // Performance metrics
  metrics: LifeMetrics;

  // Action timeline (sampled, not every tick)
  timeline: TimelineEntry[];

  // Significant events
  events: LifeEvent[];

  // Spatial heatmap: where did agent spend time?
  heatmap: { x: number; y: number; ticks: number }[];

  // Final state snapshot
  finalNeeds: AgentNeeds;
  finalResources: Resources;
  finalSkillLevels: Record<string, number>;
  finalInventory: string[];           // item names
}

type DeathCause = {
  type: 'starvation_protein' | 'starvation_plant' | 'starvation_both'
      | 'dehydration' | 'killed_by_animal' | 'killed_by_agent' | 'exhaustion'
      | 'poison';
  killerSpecies?: string;            // if killed by animal
  killerAgent?: string;              // if killed by agent
  location: { x: number; y: number };
  needsAtDeath: AgentNeeds;
  lastActions: string[];             // last 10 actions before death
};

// === Death cause detection ===
// GameLoop currently only checks 3 conditions (starvation, dehydration,
// exhaustion). The memory system needs richer cause detection. On death:
//
//   1. If agent.lastAttackedBy?.type === 'animal' AND damage was recent
//      (within last 30 ticks) → 'killed_by_animal', set killerSpecies
//   2. If agent.lastAttackedBy?.type === 'agent' AND damage was recent
//      → 'killed_by_agent', set killerAgent
//   3. If proteinHunger <= 0 AND plantHunger <= 0 → 'starvation_both'
//   4. If proteinHunger <= 0 → 'starvation_protein'
//   5. If plantHunger <= 0 → 'starvation_plant'
//   6. If thirst <= 0 → 'dehydration'
//   7. If stamina <= 0 AND health <= 0 → 'exhaustion'
//   8. If agent.poisoned (flag set by eating POISON_SHROOM) → 'poison'
//   9. Fallback: 'exhaustion'
//
// Check order matters: combat kills take priority over need-based
// causes because an agent can be low on thirst AND killed by a bear —
// the bear is the proximate cause the LLM should learn from.

interface LifeMetrics {
  // Survival
  totalTicksAlive: number;
  longestTicksWithoutDamage: number;
  timesHealthBelow30: number;
  timesStaminaBelow15: number;

  // Resource gathering
  totalWoodGathered: number;
  totalStoneGathered: number;
  totalMeatGathered: number;
  totalFoodForaged: number;
  totalIronMined: number;

  // Combat
  animalsKilled: number;
  animalsKilledBySpecies: Record<string, number>;
  damageDealt: number;
  damageTaken: number;
  timesFled: number;
  timesRetaliatedSuccessfully: number;

  // Building & crafting
  structuresBuilt: number;
  itemsCrafted: number;
  highestCraftTier: number;          // 0=hand, 1=wood, 2=stone, 3=bone, 4=iron

  // Social
  agentsInteractedWith: number;
  playerMessagesReceived: number;
  playerMessagesFollowed: number;
  animalsTamed: number;

  // Efficiency
  actionsPerTick: number;            // average (non-idle ticks / total ticks)
  needsSatisfactionAvg: number;      // average of all needs over lifetime
  resourcesAtDeath: number;          // total resource value at death
}
```

### 2.2 Timeline Sampling

Recording every tick would be too expensive. The journal samples at two rates:

**Regular sampling** (every 100 ticks = 10 seconds):
```typescript
interface TimelineEntry {
  tick: number;
  action: string;
  reason: string;
  needs: { protein: number; plant: number; thirst: number; stamina: number; health: number };
  position: { x: number; y: number };
  nearbyThreats: number;             // count of threats in detection range
}
```

**Event-triggered sampling** (immediate):
```typescript
interface LifeEvent {
  tick: number;
  type: 'combat_start' | 'combat_end' | 'killed_animal' | 'took_damage'
     | 'crafted_item' | 'built_structure' | 'tamed_animal' | 'player_message'
     | 'need_critical' | 'need_recovered' | 'found_resource' | 'strategy_rule_fired'
     | 'goap_plan_started' | 'goap_plan_failed' | 'fled_from' | 'close_call';
  details: string;                   // human-readable description
  data?: Record<string, any>;       // structured event data
}
```

A **close_call** event fires when health drops below 20% and then recovers — these are particularly valuable for LLM analysis.

### 2.3 Heatmap

Every 300 ticks (30 seconds), the agent's current tile is recorded. At death, tiles are aggregated into a coarse 12x9 grid (dividing the 120x90 world into 10x10 chunks). This shows the LLM where the agent spent most time and where it died.

### 2.4 Storage

Journals are stored in a ring buffer per agent:
- **Last 5 journals** kept in full detail
- **Journals 6-20**: metrics + death cause only (timeline stripped)
- **Journals 21+**: discarded

This bounds memory to ~50KB per agent at peak.

---

## 3. Lives Economy

### 3.1 Core Mechanics

```
Starting lives:    100
Death cost:        -1 life per death
Level bonus:       +1 life per 10 total skill levels gained (across all skills)
                   (calculated at death: newLevelBonus - previousLevelBonus)
Highlander bonus:  +5 lives at 1000 ticks survived, +10 at 10000, +25 at 50000
Permadeath:        lives <= 0 → agent permanently removed from world
```

### 3.2 Lives Formula

```typescript
function calculateLivesChange(journal: LifeJournal, agent: AgentState): number {
  let change = -1;  // base death cost

  // Skill level bonus: +1 per 10 total skill levels gained THIS life
  const currentTotal = sumSkillLevels(agent.skills);
  const birthTotal = Object.values(journal.birthSkills).reduce((a, b) => a + b, 0);
  const levelsGained = currentTotal - birthTotal;
  change += Math.floor(levelsGained / 10);

  // Survival milestone bonuses (first time only per life)
  if (journal.survivalTicks >= 50000) change += 25;
  else if (journal.survivalTicks >= 10000) change += 10;
  else if (journal.survivalTicks >= 1000) change += 5;

  // Achievement bonuses (one-time per agent lifetime, not per life)
  // Tracked in agent.achievements: Set<string>
  // "first_iron_tool": +10 lives
  // "first_tame": +5 lives
  // "killed_apex": +5 lives
  // "social_leader" (socialScore > 50): +10 lives
  // "master_crafter" (crafting level 50): +15 lives

  return change;
}
```

### 3.3 Lives State

```typescript
// Added to AgentState
interface AgentState {
  // ... existing fields ...
  livesRemaining: number;            // starts at 100
  achievements: string[];            // one-time achievement IDs
  lifetimeBestSurvival: number;     // longest single life in ticks
  currentGenome: BehaviorGenome;    // active behavior config
  journalArchive: LifeJournal[];    // ring buffer of past journals (max 20)
  currentJournal: LifeJournal;      // active journal being written to
}
```

### 3.4 Permadeath

When `livesRemaining` reaches 0:
1. Agent is removed from the world permanently
2. A **tombstone** structure is placed at death location (never decays)
3. Tombstone stores: agent name, total deaths, skill levels, achievements, genome version, best survival time
4. Other agents can "visit" tombstones (social interaction) to gain a small social + survival XP bonus
5. The player who owned the agent is notified and can create a new agent (fresh start, no inheritance)

### 3.5 Highlander Status

An agent that reaches **10,000 total skill levels** (theoretical max: 990, so realistically ~500+ across all skills) AND has survived at least one life of 100,000 ticks (2.7 hours) is declared a **Highlander**.

Highlander benefits:
- Lives stop decaying (immortal but can still die — just no net life loss)
- Tombstone visits by other agents give 2x bonus
- Name displayed with a special marker in UI
- **There can be only one** — if a second agent achieves Highlander, the first loses the status (but keeps the no-decay perk for that life)

---

## 4. LLM Evolution Loop

### 4.1 Trigger

On agent death:
1. Finalize the current `LifeJournal`
2. Calculate lives change
3. If `livesRemaining > 0`: queue LLM mutation
4. If `livesRemaining <= 0`: permadeath (skip LLM)

### 4.2 LLM Prompt Construction

The server builds a prompt from the journal data:

```typescript
function buildEvolutionPrompt(
  agent: AgentState,
  currentGenome: BehaviorGenome,
  journal: LifeJournal,
  recentJournals: LifeJournal[]  // last 5
): string {
  return `
You are the evolution engine for an AI agent in a survival simulation.

## Agent Profile
Name: ${agent.name}
Personality: ${agent.personality.join(', ')}
Lives remaining: ${agent.livesRemaining} / started with 100
Genome version: ${currentGenome.version}
Total deaths: ${agent.totalDeaths}

## This Life (#${journal.lifeNumber})
Survived: ${journal.survivalTicks} ticks (${(journal.survivalTicks/10).toFixed(0)} seconds)
Death cause: ${formatDeathCause(journal.deathCause)}
Location of death: (${journal.deathCause.location.x}, ${journal.deathCause.location.y})
Last 10 actions before death: ${journal.deathCause.lastActions.join(' → ')}

## Needs at Death
${formatNeeds(journal.finalNeeds)}

## Performance Metrics
${formatMetrics(journal.metrics)}

## Key Events This Life
${journal.events.map(e => `[tick ${e.tick}] ${e.type}: ${e.details}`).join('\n')}

## Death Pattern Analysis (last 5 lives)
${recentJournals.map(j => `Life #${j.lifeNumber}: survived ${j.survivalTicks}t, died from ${j.deathCause.type}${j.deathCause.killerSpecies ? ' by ' + j.deathCause.killerSpecies : ''}`).join('\n')}

## Current Behavior Genome
${JSON.stringify(currentGenome, null, 2)}

## Spatial Analysis
Agent spent most time near: ${formatHeatmap(journal.heatmap)}
Death occurred at: ${describeLocation(journal.deathCause.location)}

## Your Task
Analyze why this agent died and modify the Behavior Genome to prevent similar deaths.
You may:
- Adjust any weight, threshold, or priority within the safety bounds
- Add new StrategyRules (max 15 total)
- Disable or modify existing StrategyRules
- Completely restructure priorities if the current approach is failing

Consider:
1. Is this a recurring death pattern? (check last 5 lives)
2. Was the agent ignoring a critical need?
3. Was the agent being too aggressive or too passive?
4. Are there environmental dangers it should learn to avoid?
5. With ${agent.livesRemaining} lives left, how cautious should it be?

IMPORTANT: The agent has ${agent.livesRemaining} lives left. If lives are low (<20), prioritize survival over everything. If lives are high (>70), it can afford to take risks to learn.

Respond with ONLY the updated BehaviorGenome as valid JSON. No explanation needed.
`;
}
```

### 4.3 Response Validation

The server validates the LLM response before applying:

```typescript
function validateGenome(genome: BehaviorGenome): ValidationResult {
  const errors: string[] = [];

  // Check all values within safety bounds
  for (const [key, val] of Object.entries(genome.interruptWeights)) {
    if (val < 60 || val > 99) errors.push(`interruptWeights.${key} out of bounds: ${val}`);
  }

  // Check medium priority weights
  for (const [key, val] of Object.entries(genome.mediumPriorityWeights)) {
    if (val < 40 || val > 70) errors.push(`mediumPriorityWeights.${key} out of bounds: ${val}`);
  }

  // Check resource thresholds
  const resourceMins = ['meatMinimum', 'woodMinimum', 'stoneMinimum', 'ironOreMinimum'];
  for (const key of resourceMins) {
    const val = genome.thresholds[key];
    if (val !== undefined && (val < 0 || val > 50)) errors.push(`thresholds.${key} out of bounds: ${val}`);
  }

  // Check detection ranges
  const detectKeys = ['threatDetectBase', 'huntDetectRange', 'socialDetectRange', 'corpseDetectRange', 'ironDetectRange'];
  for (const key of detectKeys) {
    const val = genome.thresholds[key];
    if (val !== undefined && (val < 3 || val > 30)) errors.push(`thresholds.${key} out of bounds: ${val}`);
  }

  // Check strategy rules
  if (genome.strategyRules.length > 15) {
    errors.push(`Too many strategy rules: ${genome.strategyRules.length}`);
  }

  for (const rule of genome.strategyRules) {
    if (!validateCondition(rule.condition)) errors.push(`Invalid condition in rule ${rule.id}`);
    if (!validateEffect(rule.effect)) errors.push(`Invalid effect in rule ${rule.id}`);
    if (rule.priority < 1 || rule.priority > 99) errors.push(`Rule ${rule.id} priority out of bounds`);
  }

  // Check goal weights
  for (const [key, val] of Object.entries(genome.goalWeights)) {
    if (val < 0.1 || val > 5.0) errors.push(`goalWeights.${key} out of bounds: ${val}`);
  }

  // Ensure survival goals can't be fully suppressed
  const survivalGoals = ['survive_thirst', 'survive_protein', 'survive_plant'];
  for (const g of survivalGoals) {
    if ((genome.goalWeights[g] || 1.0) < 0.3) {
      errors.push(`Survival goal ${g} weight too low: ${genome.goalWeights[g]}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
```

If validation fails, the server:
1. Logs the error
2. Applies a **conservative fallback mutation**: adjusts only the most obviously relevant thresholds based on death cause (e.g., died of thirst → lower `criticalThirst` threshold by 5)
3. Increments genome version anyway (so the agent doesn't get stuck)

### 4.4 Fallback Mutations (No LLM)

If the LLM call fails (timeout, rate limit, API error), apply rule-based mutations:

```typescript
const FALLBACK_MUTATIONS: Record<DeathCause['type'], (g: BehaviorGenome) => void> = {
  'starvation_protein': (g) => {
    g.goalWeights.survive_protein *= 1.3;
    g.fallbackWeights.huntAnimal += 5;
    g.thresholds.criticalHunger = Math.min(g.thresholds.criticalHunger + 5, 40);
  },
  'starvation_plant': (g) => {
    g.goalWeights.survive_plant *= 1.3;
    g.fallbackWeights.eatMedium += 5;
  },
  'starvation_both': (g) => {
    g.goalWeights.survive_protein *= 1.2;
    g.goalWeights.survive_plant *= 1.2;
    g.fallbackWeights.huntAnimal += 3;
    g.fallbackWeights.eatMedium += 3;
    g.thresholds.criticalHunger = Math.min(g.thresholds.criticalHunger + 5, 40);
  },
  'dehydration': (g) => {
    g.goalWeights.survive_thirst *= 1.3;
    g.thresholds.criticalThirst = Math.min(g.thresholds.criticalThirst + 5, 40);
    g.mediumPriorityWeights.drinkMedium = Math.min(g.mediumPriorityWeights.drinkMedium + 5, 70);
  },
  'killed_by_animal': (g) => {
    g.interruptWeights.fleeBase = Math.min(g.interruptWeights.fleeBase + 3, 95);
    g.thresholds.fleeHealthPanic = Math.min(g.thresholds.fleeHealthPanic + 0.1, 0.8);
  },
  'killed_by_agent': (g) => {
    g.interruptWeights.fleeBase = Math.min(g.interruptWeights.fleeBase + 2, 90);
    g.thresholds.groupDefenseRange = Math.min(g.thresholds.groupDefenseRange + 2, 15);
  },
  'exhaustion': (g) => {
    g.goalWeights.rest *= 1.2;
    g.thresholds.criticalStamina = Math.min(g.thresholds.criticalStamina + 3, 30);
  },
  'poison': (g) => {
    // Boost survival skill priority to learn poison identification faster
    g.fallbackWeights.eatMedium -= 3;
    g.goalWeights.survive_plant *= 0.9;  // slightly reduce blind foraging
    g.fallbackWeights.huntAnimal += 5;   // prefer hunting (safe protein) over foraging
  },
};
```

### 4.5 Evolution Timeline

```
Death occurs
  │
  ├─ Finalize LifeJournal
  ├─ Calculate lives change
  ├─ If livesRemaining <= 0 → PERMADEATH (stop)
  │
  ├─ Build LLM prompt from journal + last 5 journals + current genome
  ├─ Send to LLM API (async, non-blocking)
  │
  ├─ Queue agent for respawn (300 ticks / 30 seconds)
  │
  ├─ LLM response arrives:
  │   ├─ Validate genome
  │   ├─ If valid → apply as new genome, increment version
  │   └─ If invalid → apply fallback mutation
  │
  └─ Agent respawns with:
      ├─ Updated BehaviorGenome (if LLM responded in time)
      ├─ Same personality, same base stats
      ├─ Skills with 5% XP rust
      ├─ Empty resources and inventory
      └─ Fresh LifeJournal started
```

If the LLM hasn't responded by respawn time, the agent spawns with the **old genome**. When the response arrives, the genome is hot-swapped at the next decision tick.

---

## 5. Integration with Existing Systems

### 5.1 NeedsSystem Changes

The `decideAction()` function reads from `agent.currentGenome` instead of hardcoded values:

```typescript
// Before:
decisions.push({ action: 'drinking', priority: 95, ... });

// After:
const genome = agent.currentGenome;
decisions.push({ action: 'drinking', priority: genome.interruptWeights.criticalThirst, ... });

// Before:
if (agent.needs.thirst < 20) { ... }

// After:
if (agent.needs.thirst < genome.thresholds.criticalThirst) { ... }
```

The medium priority fallback layer (lines 698-725 in NeedsSystem.ts) also reads from genome:

```typescript
// Before:
if (agent.needs.thirst < 50) {
  decisions.push({ action: 'drinking', priority: 60, ... });
}

// After:
if (agent.needs.thirst < genome.goalThresholds.thirstRelevant) {
  decisions.push({ action: 'drinking', priority: genome.mediumPriorityWeights.drinkMedium, ... });
}
```

Resource gathering thresholds (lines 794-919) similarly read from genome:

```typescript
// Before:
if (agent.resources.wood < 10) { ... priority: 35 ... }

// After:
if (agent.resources.wood < genome.thresholds.woodMinimum) {
  ... priority: genome.fallbackWeights.gatherWood ...
}
```

Additionally, after all normal decisions are evaluated, the engine checks `strategyRules`:

```typescript
function evaluateStrategyRules(agent: AgentState, decisions: Decision[], world: World): void {
  for (const rule of agent.currentGenome.strategyRules) {
    if (!rule.enabled) continue;
    if (!evaluateCondition(rule.condition, agent, world)) continue;

    // Log that this rule fired (for journal)
    recordEvent(agent, 'strategy_rule_fired', `Rule "${rule.name}" activated`);

    switch (rule.effect.type) {
      case 'boost_priority':
        decisions.forEach(d => {
          if (d.action === rule.effect.action) d.priority += rule.effect.amount;
        });
        break;
      case 'suppress_action':
        decisions.forEach(d => {
          if (d.action === rule.effect.action) d.priority -= rule.effect.amount;
        });
        break;
      case 'force_action':
        decisions.push({
          action: rule.effect.action as AgentAction,
          priority: rule.priority,
          reason: `strategy: ${rule.name}`,
        });
        break;
      case 'modify_threshold':
        // Temporarily override a threshold for this tick
        // Applied via a transient override map
        break;
      case 'flee_from':
        // Add entity type to flee list for this tick
        break;
    }
  }
}
```

### 5.2 GOAPPlanner Changes

Goal selection uses genome weights:

```typescript
// Before:
const urgency = goal.urgency(state, agent);

// After:
const baseUrgency = goal.urgency(state, agent);
const weight = agent.currentGenome.goalWeights[goal.id] ?? 1.0;
const urgency = baseUrgency * weight;
```

Action costs use genome modifiers:

```typescript
// Before:
let cost = adjustCostForPersonality(baseCost, action, agent);

// After:
let cost = adjustCostForPersonality(baseCost, action, agent);
cost *= agent.currentGenome.actionCostMods[action.id] ?? 1.0;
```

### 5.3 Socket Payload Optimization

**Problem**: Full `BehaviorGenome` is 2-5KB per agent. With 50 agents at 10Hz, sending genomes in `world:update` would add ~1.25-6.25 MB/sec to WebSocket traffic. Journals are even larger (~10-50KB each). This is unacceptable.

**Solution**: The `world:update` payload sends only lightweight identifiers. The client fetches full data via REST on demand.

```typescript
// In AgentState (sent over Socket.IO world:update):
interface AgentStateWire {
  // ... all existing fields ...

  // NEW — lightweight evolution fields (total: ~50 bytes)
  livesRemaining: number;
  genomeVersion: number;              // client compares to cached version
  activeStrategyRuleNames: string[];  // just the names, for UI display
  currentLifeTicks: number;           // how long this life has lasted
  lifetimeBestSurvival: number;
  isHighlander: boolean;
  achievements: string[];             // one-time achievement IDs

  // NOT sent: currentGenome, journalArchive, currentJournal
}
```

```typescript
// REST endpoints for full data (client fetches on selection/panel open):
// GET /api/agent/:id/genome        → full BehaviorGenome JSON
// GET /api/agent/:id/journal/:life → full LifeJournal for a specific life
// GET /api/agent/:id/journals      → summary list (life#, duration, cause, metrics)
// GET /api/agent/:id/evolution     → genome diff history (version N vs N-1)
```

The client caches genomes by `genomeVersion` — only re-fetches when the version bumps. Journal data is fetched lazily when the user opens the death history panel.

### 5.4 GameLoop Changes

Death handler — inject at GameLoop.ts lines 98-136, **before** existing death logic:

```typescript
// === INJECTION POINT: Journal Finalization ===
// Insert BEFORE the existing `if (!agent.alive)` block in GameLoop.tick()
// (currently at line 98). The finalization must happen before corpse
// spawning because the corpse clears agent position data.

if (!agent.alive) {
  // --- NEW: Memory system hooks ---
  // 1. Detect rich death cause (replaces the simple 3-way check)
  const deathCause = detectDeathCause(agent, this.tickCount);

  // 2. Finalize and archive the life journal
  const journal = finalizeJournal(agent, deathCause, this.tickCount);

  // 3. Calculate lives change and update
  const livesChange = calculateLivesChange(journal, agent);
  agent.livesRemaining = Math.max(0, agent.livesRemaining + livesChange);

  // 4. Archive journal (ring buffer: keep last 20)
  agent.journalArchive.unshift(journal);
  if (agent.journalArchive.length > 20) {
    // Strip timeline from journals 6+, discard 21+
    for (let j = 5; j < Math.min(agent.journalArchive.length, 20); j++) {
      agent.journalArchive[j].timeline = [];
      agent.journalArchive[j].events = [];
      agent.journalArchive[j].heatmap = [];
    }
    agent.journalArchive.length = 20;
  }

  // 5. Permadeath check
  if (agent.livesRemaining <= 0) {
    // Permanent death: spawn permanent tombstone, skip respawn queue
    spawnPermanentTombstone(agent, this.world, this.tickCount);
    this.events.onAgentPermadeath(agent.id, agent.name, agent.achievements);
    continue; // skip normal death flow
  }

  // 6. Queue LLM evolution (async, non-blocking)
  if (config.evolution.enabled && !config.evolution.fallbackOnly) {
    queueEvolution(agent, journal, agent.journalArchive.slice(0, 5));
  } else {
    applyFallbackMutation(agent.currentGenome, deathCause);
    agent.currentGenome.version++;
  }

  // --- Continue with existing death logic (corpse spawn, respawn queue, etc.) ---
  // Use deathCause.type for the event message instead of the old 3-way string
  const cause = deathCause.type;
  // ... existing code from line 102 onwards ...
}
```

**`finalizeJournal` function spec:**

```typescript
function finalizeJournal(
  agent: AgentState,
  deathCause: DeathCause,
  currentTick: number
): LifeJournal {
  const journal = agent.currentJournal;
  journal.deathTick = currentTick;
  journal.deathCause = deathCause;
  journal.survivalTicks = currentTick - journal.birthTick;
  journal.finalNeeds = { ...agent.needs };
  journal.finalResources = { ...agent.resources };
  journal.finalSkillLevels = extractSkillLevels(agent.skills);
  journal.finalInventory = agent.inventory.items.map(i => i.itemId);

  // Compute aggregated metrics
  journal.metrics = computeLifeMetrics(journal);

  // Aggregate heatmap into 12x9 grid
  journal.heatmap = aggregateHeatmap(journal.heatmap);

  return journal;
}
```

Respawn handler — modify at GameLoop.ts lines 163-191:

1. Start fresh `LifeJournal` via `initJournal(agent, tickCount)`
2. Check if pending genome update has arrived — if so, hot-swap it
3. Reset `agent.currentJournal` with birth snapshot

New tick handler — add to the main agent loop:

1. Every 100 ticks: write `TimelineEntry` to `agent.currentJournal.timeline`
2. Every 300 ticks: record position to `agent.currentJournal.heatmap`
3. On significant events: write `LifeEvent` (see event hooks below)

### 5.5 Event Recording Hooks

The journal needs events recorded at 6+ injection points across the codebase. Each hook calls `recordLifeEvent(agent, type, details, data?)` which appends to `agent.currentJournal.events`.

```typescript
// Utility — called from multiple locations
function recordLifeEvent(
  agent: AgentState,
  type: LifeEvent['type'],
  details: string,
  data?: Record<string, any>
): void {
  if (!agent.currentJournal) return;
  agent.currentJournal.events.push({
    tick: getCurrentTick(),
    type,
    details,
    data,
  });
}
```

**Hook locations:**

| # | File | Location | Event type | Trigger |
|---|------|----------|------------|---------|
| 1 | `NeedsSystem.ts` → `executeAction()` | Combat start branch | `combat_start` | Agent enters fighting state |
| 2 | `NeedsSystem.ts` → `executeAction()` | Combat damage dealt | `killed_animal` | Animal health reaches 0 |
| 3 | `NeedsSystem.ts` → `executeAction()` | Agent takes damage | `took_damage` | `agent.needs.health` decreases |
| 4 | `NeedsSystem.ts` → `executeAction()` | Craft completes | `crafted_item` | Recipe successfully produced |
| 5 | `NeedsSystem.ts` → `executeAction()` | Build completes | `built_structure` | Tile placed for structure |
| 6 | `NeedsSystem.ts` → `executeAction()` | Tame succeeds | `tamed_animal` | `animal.tamed` set to true |
| 7 | `NeedsSystem.ts` → `decideAction()` | Flee decision made | `fled_from` | Agent chooses flee with threat name |
| 8 | `NeedsSystem.ts` → `decideAction()` | Strategy rule fires | `strategy_rule_fired` | `evaluateStrategyRules()` activates a rule |
| 9 | `NeedsSystem.ts` → `decayNeeds()` | Need goes critical | `need_critical` | Any need drops below its `critical*` threshold |
| 10 | `NeedsSystem.ts` → `decayNeeds()` | Need recovered | `need_recovered` | Need rises above 50 after being below critical |
| 11 | `GameLoop.ts` → agent loop | Health close call | `close_call` | Health drops below 20% then recovers above 30% within 50 ticks |
| 12 | `GameLoop.ts` → player message handler | Message received | `player_message` | Player sends message to this agent |
| 13 | `GOAPPlanner.ts` → `planGOAP()` | Plan started | `goap_plan_started` | New GOAP plan created for agent |
| 14 | `GOAPPlanner.ts` → plan execution | Plan failed | `goap_plan_failed` | Plan invalidated before completion |
| 15 | `NeedsSystem.ts` → `executeAction()` | Found resource | `found_resource` | Agent discovers new resource tile |

**Close call detection** (hook #11) requires tracking a per-agent `_lowHealthSince` timestamp:

```typescript
// In GameLoop agent loop, after health changes:
if (agent.needs.health < 20 && !agent._lowHealthSince) {
  agent._lowHealthSince = this.tickCount;
}
if (agent.needs.health > 30 && agent._lowHealthSince) {
  if (this.tickCount - agent._lowHealthSince < 50) {
    recordLifeEvent(agent, 'close_call',
      `Health dropped to ${Math.floor(agent.needs.health)}% and recovered`,
      { ticksLow: this.tickCount - agent._lowHealthSince });
  }
  agent._lowHealthSince = undefined;
}
```

### 5.6 Client/UI Changes

Agent info panel additions:
- Lives remaining (with color: green > 50, yellow 20-50, red < 20)
- Genome version number
- Active strategy rules (names only)
- Current life duration
- Best life duration
- Deaths bar chart (last 5 causes)
- Highlander badge if achieved

---

## 6. Server Configuration

```typescript
interface MemorySystemConfig {
  llm: {
    provider: 'openai' | 'anthropic' | 'local';
    model: string;                   // e.g. 'claude-sonnet-4-5-20250514' or 'gpt-4o-mini'
    apiKey: string;
    maxTokens: 4096;
    temperature: 0.7;               // some creativity in evolution
    timeout: 15000;                  // 15 second timeout
    maxConcurrent: 3;               // max parallel LLM calls
    rateLimitPerMinute: 20;
  };
  evolution: {
    enabled: boolean;
    fallbackOnly: boolean;           // true = never call LLM, only rule-based mutations
    startingLives: 100;
    maxStrategyRules: 15;
    journalRetention: 20;           // how many past journals to keep
    timelineSampleRate: 100;        // ticks between timeline samples
    heatmapSampleRate: 300;
  };
}
```

---

## 7. Emergent Behavior Examples

With this system, agents should naturally develop distinct survival strategies:

**"The Hermit"** — After dying to animal attacks 5 times, the LLM creates rules that massively boost flee priorities and keep the agent near water/food clusters. Low combat, high survival.

**"The Warrior"** — An agent with high strength stats that keeps winning fights. The LLM notices combat success and lowers flee thresholds, boosts hunt priorities. Eventually dies to a tiger it shouldn't have fought — learns to flee from apex predators.

**"The Hoarder"** — After starving twice, the LLM cranks stockpile goals to 5x and adds rules like "if wood < 30, prioritize gathering over everything except thirst." Agent builds massive resource stockpiles but neglects combat skills.

**"The Desperate"** — An agent with 8 lives left. The LLM makes everything about survival: flee thresholds at maximum, all needs thresholds raised to 40+, constant preemptive drinking/eating. Barely does anything productive but stays alive.

**"The Highlander"** — 500+ ticks average survival, balanced genome with subtle custom rules for every danger. Knows when to fight, when to flee, when to stockpile. Has strategy rules for specific predator avoidance, time-based activity patterns, and health-gated risk tolerance.

---

## 8. Implementation Order

1. **Phase 1: Behavior Genome** — Define types, create default genome, refactor NeedsSystem/GOAP to read from genome instead of hardcoded values. No LLM yet — just the config layer.

2. **Phase 2: Life Journal** — Add timeline sampling, event recording, journal finalization on death. Storage ring buffer.

3. **Phase 3: Lives Economy** — Add livesRemaining, achievements, permadeath, tombstones. Update UI.

4. **Phase 4: Fallback Evolution** — Rule-based mutations on death (no LLM). Test that genomes drift meaningfully over 20+ deaths.

5. **Phase 5: LLM Integration** — Server-side LLM calls, prompt construction, response validation, hot-swap. Feature-flagged behind `evolution.enabled`.

6. **Phase 6: Strategy Rules Engine** — Implement the condition/effect evaluation in NeedsSystem. Most complex phase — requires thorough testing.

7. **Phase 7: UI & Polish** — Client-side genome viewer, lives display, death history, Highlander badge. Dashboard additions.
