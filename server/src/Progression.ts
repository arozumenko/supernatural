import type { SkillSet, SkillName, BaseStats, AnimalSpecies, Inventory, AnimalState, AgentState, Resources } from '../shared/src/index.ts';
import { clamp, randomInt } from '../shared/src/index.ts';
import { getItemDef } from './ItemDefinitions.ts';

// ─── Skill Set Creation ───

const SKILL_NAMES: SkillName[] = [
  'combat', 'defense', 'athletics',
  'woodcutting', 'mining', 'foraging',
  'building', 'crafting', 'survival', 'social',
];

function emptySkillState() {
  return { xp: 0, level: 0 };
}

export function createSkillSet(): SkillSet {
  return {
    combat: emptySkillState(),
    defense: emptySkillState(),
    athletics: emptySkillState(),
    woodcutting: emptySkillState(),
    mining: emptySkillState(),
    foraging: emptySkillState(),
    building: emptySkillState(),
    crafting: emptySkillState(),
    survival: emptySkillState(),
    social: emptySkillState(),
  };
}

// ─── Base Stats Creation ───

export function createAgentBaseStats(): BaseStats {
  return {
    strength: randomInt(5, 15),
    toughness: randomInt(5, 15),
    agility: randomInt(5, 15),
    endurance: randomInt(5, 15),
    perception: randomInt(5, 15),
    charisma: randomInt(5, 15),
  };
}

export function createAnimalBaseStats(species: AnimalSpecies): BaseStats {
  const socialMap: Record<string, number> = {
    solitary: 3,
    pair: 8,
    pack: 12,
    herd: 12,
    flock: 8,
    swarm: 8,
  };

  // ±30% variance around species midpoint for individuality
  const variance = 0.3;
  const rand = (mid: number) => clamp(
    Math.floor(mid * (1 - variance) + Math.random() * mid * variance * 2),
    3, 20
  );

  return {
    strength: rand(Math.round(species.attack / 3)),
    toughness: rand(Math.round(species.health / 20)),
    agility: rand(Math.round(species.speed * 20)),
    endurance: rand(10),
    perception: rand(species.detectionRange),
    charisma: rand(socialMap[species.social] ?? 8),
  };
}

// ─── XP and Leveling ───

export function xpToLevel(xp: number, cap: number = 99): number {
  const level = Math.floor(Math.sqrt(xp / 50));
  return Math.min(level, cap);
}

export function recalculateLevels(
  skills: SkillSet,
  caps?: Partial<Record<SkillName, number>>
): void {
  for (const name of SKILL_NAMES) {
    const cap = caps?.[name] ?? 99;
    skills[name].level = xpToLevel(skills[name].xp, cap);
  }
}

export function awardXP(
  skills: SkillSet,
  skill: SkillName,
  baseXP: number,
  difficultyMod: number = 1.0,
  caps?: Partial<Record<SkillName, number>>
): { leveled: boolean; newLevel: number } {
  const state = skills[skill];
  const oldLevel = state.level;
  const cap = caps?.[skill] ?? 99;

  // Diminishing returns: 1 / (1 + level/50)
  const diminishing = 1.0 / (1.0 + state.level / 50);
  const xpGained = baseXP * difficultyMod * diminishing;

  state.xp += xpGained;
  state.level = xpToLevel(state.xp, cap);

  return {
    leveled: state.level > oldLevel,
    newLevel: state.level,
  };
}

// ─── Death Penalty ───

export function applyDeathPenalty(
  skills: SkillSet,
  caps?: Partial<Record<SkillName, number>>,
  baseStats?: import('../shared/src/index.ts').BaseStats
): void {
  // Heavy XP penalty: lose 40% of all skill XP — guarantees level drops
  for (const name of SKILL_NAMES) {
    const state = skills[name];
    state.xp = Math.max(Math.floor(state.xp * 0.6), 0); // keep 60%, lose 40%
  }
  recalculateLevels(skills, caps);

  // Stat decay: lose 1 point from a random stat (min 3)
  if (baseStats) {
    const statKeys: (keyof import('../shared/src/index.ts').BaseStats)[] = [
      'strength', 'toughness', 'agility', 'endurance', 'perception', 'charisma'
    ];
    const key = statKeys[Math.floor(Math.random() * statKeys.length)];
    if (baseStats[key] > 3) {
      baseStats[key]--;
    }
  }
}

// ─── Effective Stats ───

export function getEffectiveStat(base: number, ...bonuses: number[]): number {
  let totalBonus = 0;
  for (const b of bonuses) {
    totalBonus += b;
  }
  // Cap total skill bonus at 99
  totalBonus = Math.min(totalBonus, 99);
  return base + totalBonus;
}

export function getEffectiveStrength(baseStats: BaseStats, skills: SkillSet): number {
  // strength + combat_level + woodcutting_level*2/3 + mining_level*2/3
  return getEffectiveStat(
    baseStats.strength,
    skills.combat.level,
    Math.round(skills.woodcutting.level * 2 / 3),
    Math.round(skills.mining.level * 2 / 3),
  );
}

export function getEffectiveToughness(baseStats: BaseStats, skills: SkillSet): number {
  // toughness + defense_level
  return getEffectiveStat(baseStats.toughness, skills.defense.level);
}

export function getEffectiveAgility(baseStats: BaseStats, skills: SkillSet): number {
  // agility + athletics_level
  return getEffectiveStat(baseStats.agility, skills.athletics.level);
}

export function getEffectiveEndurance(baseStats: BaseStats, skills: SkillSet): number {
  // endurance + survival_level*2/3 + woodcutting_level*1/3 + mining_level*1/3 + building_level*2/3
  return getEffectiveStat(
    baseStats.endurance,
    Math.round(skills.survival.level * 2 / 3),
    Math.round(skills.woodcutting.level * 1 / 3),
    Math.round(skills.mining.level * 1 / 3),
    Math.round(skills.building.level * 2 / 3),
  );
}

export function getEffectivePerception(baseStats: BaseStats, skills: SkillSet): number {
  // perception + foraging_level*2/3 + crafting_level*2/3
  return getEffectiveStat(
    baseStats.perception,
    Math.round(skills.foraging.level * 2 / 3),
    Math.round(skills.crafting.level * 2 / 3),
  );
}

export function getEffectiveCharisma(baseStats: BaseStats, skills: SkillSet): number {
  // charisma + social_level
  return getEffectiveStat(baseStats.charisma, skills.social.level);
}

// ─── Gameplay Modifiers ───

export function getHitAccuracy(skills: SkillSet): number {
  // 0.7 + combat_level * 0.003
  return 0.7 + skills.combat.level * 0.003;
}

export function getAttackDamage(
  baseStats: BaseStats,
  skills: SkillSet,
  baseDamage: number
): number {
  const effStrength = getEffectiveStrength(baseStats, skills);
  const accuracy = getHitAccuracy(skills);
  // Roll hit/miss
  if (Math.random() > accuracy) return 0; // miss
  return effStrength * (0.8 + Math.random() * 0.4) * (baseDamage / 10);
}

export function getDamageReduction(skills: SkillSet): number {
  // defense_level / (defense_level + 100)
  return skills.defense.level / (skills.defense.level + 100);
}

export function getSpeedBonus(skills: SkillSet): number {
  // athletics_level * 0.005
  return skills.athletics.level * 0.005;
}

export function getHarvestSpeedBonus(
  skills: SkillSet,
  type: 'wood' | 'stone' | 'plant'
): number {
  switch (type) {
    case 'wood':
      return skills.woodcutting.level * 0.01;
    case 'stone':
      return skills.mining.level * 0.01;
    case 'plant':
      return skills.foraging.level * 0.01;
  }
}

export function getNeedDecayReduction(skills: SkillSet): number {
  // survival_level * 0.002
  return skills.survival.level * 0.002;
}

export function canIdentifyPoison(skills: SkillSet): boolean {
  // foraging level >= 15
  return skills.foraging.level >= 15;
}

// ─── Weight & Carry Capacity ───

const RESOURCE_WEIGHTS: Record<string, number> = {
  wood: 0.5, stone: 0.8, food: 0.2, water: 0.3, meat: 0.3,
  bone: 0.2, hide: 0.3, sinew: 0.1, fat: 0.2, feathers: 0.05,
  teeth_claws: 0.1, scales: 0.15, iron_ore: 1.0, iron_ingot: 1.2,
  treeSeed: 0.05, plantSeed: 0.05,
};

export function getCarryWeight(inventory: Inventory, resources?: Resources): number {
  let total = 0;
  for (const item of inventory.items) {
    const def = getItemDef(item.itemId);
    total += def.weight * item.quantity;
  }
  // Equipped items also count
  for (const slot of ['mainHand', 'body', 'accessory'] as const) {
    const eq = inventory.equipped[slot];
    if (eq) {
      const def = getItemDef(eq.itemId);
      total += def.weight * eq.quantity;
    }
  }
  // Resources weight
  if (resources) {
    for (const [res, amount] of Object.entries(resources)) {
      total += (RESOURCE_WEIGHTS[res] ?? 0.1) * (amount as number);
    }
  }
  return Math.floor(total);
}

export function getCarryCapacity(baseStats: BaseStats, skills: SkillSet, inventory: Inventory): number {
  const effectiveEndurance = getEffectiveEndurance(baseStats, skills);
  let capacity = 100 + effectiveEndurance * 0.5;
  // Leather sack bonus
  if (inventory.equipped.accessory?.itemId === 'leather_sack') {
    capacity += 20;
  }
  return capacity;
}

// ─── Unified Combat Stats (same math for agents and animals) ───

/** Unified attack damage: effectiveStrength × (0.8-1.2 roll) + weaponBonus. Animals pass weaponBonus=0. */
export function getUnifiedAttackDamage(
  baseStats: BaseStats, skills: SkillSet, weaponBonus: number = 0
): number {
  const effStrength = getEffectiveStrength(baseStats, skills);
  const accuracy = getHitAccuracy(skills);
  if (Math.random() > accuracy) return 0; // miss
  return effStrength * (0.8 + Math.random() * 0.4) + weaponBonus;
}

/** Unified damage reduction: percentage model — totalDef / (totalDef + 100). */
export function getUnifiedDamageReduction(
  baseStats: BaseStats, skills: SkillSet, armorBonus: number = 0
): number {
  const effTough = getEffectiveToughness(baseStats, skills);
  const totalDefense = effTough + armorBonus;
  return totalDefense / (totalDefense + 100);
}

/** Unified speed: base × (1 + athletics bonus) × stamina factor / weight penalty. */
export function getUnifiedSpeed(
  baseStats: BaseStats, skills: SkillSet,
  baseSpeed: number, stamina: number,
  inventory?: Inventory, resources?: Resources
): number {
  const athleticsBonus = skills.athletics.level * 0.005;
  const staminaFactor = 0.5 + stamina / 200; // stamina 0→0.5x, stamina 100→1.0x
  let weightPenalty = 1.0;
  if (inventory) {
    const weight = getCarryWeight(inventory, resources);
    const capacity = getCarryCapacity(baseStats, skills, inventory);
    if (weight > capacity) return 0; // overloaded
    const weightRatio = Math.min(1, weight / Math.max(1, capacity));
    weightPenalty = 1 + weightRatio * 0.5;
  }
  return baseSpeed * (1 + athleticsBonus) * staminaFactor / weightPenalty;
}

/** Get dodge chance based on athletics skill: 0% at 0, ~20% at 99 */
export function getDodgeChance(skills: SkillSet): number {
  return skills.athletics.level * 0.002;
}

// ─── Backward-compatible wrappers (deprecated — use unified functions) ───

export function getAnimalAttackPower(animal: AnimalState, species: AnimalSpecies): number {
  // Returns effective attack power (caller applies their own roll/accuracy)
  return getEffectiveStrength(animal.baseStats, animal.skills);
}

export function getAnimalDefense(animal: AnimalState, species: AnimalSpecies): number {
  return getUnifiedDamageReduction(animal.baseStats, animal.skills, 0);
}

export function getAnimalSpeed(animal: AnimalState, species: AnimalSpecies): number {
  return getUnifiedSpeed(animal.baseStats, animal.skills, species.speed, animal.stamina);
}

export function getAgentSpeed(agent: AgentState): number {
  return getUnifiedSpeed(
    agent.baseStats, agent.skills,
    0.3, agent.needs.stamina,
    agent.inventory, agent.resources
  );
}
