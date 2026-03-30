import {
  AnimalState, AnimalSpecies, AnimalAction, TileType, PlantType,
  clamp, distance, randomInt, WORLD_WIDTH, WORLD_HEIGHT
} from '../../shared/src/index.ts';
import type { SkillName, AgentState } from '../../shared/src/index.ts';
import { World } from '../World.ts';
import { WorldConfig } from '../WorldConfig.ts';
import { getSpecies } from '../AnimalSpeciesConfig.ts';
import { findPath } from './Pathfinding.ts';
import { awardXP, getSpeedBonus, getHarvestSpeedBonus, canIdentifyPoison, getHitAccuracy, getDamageReduction, getDodgeChance, getAnimalAttackPower, getAnimalDefense, getAnimalSpeed, getAgentSpeed, getUnifiedDamageReduction } from '../Progression.ts';
import { evaluateSurvivalNeeds, evaluateThreats, type SurvivalConfig, type ThreatConfig, type SharedDecision } from './SharedDecisionEngine.ts';

// ============================================================
// Types
// ============================================================

export interface AnimalDecision {
  action: AnimalAction;
  target?: { x: number; y: number };
  targetEntityId?: string;
  score: number;
}

/** Offspring produced by breeding — caller is responsible for adding to the world */
export interface AnimalOffspring {
  species: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  proteinHunger: number;
  plantHunger: number;
  thirst: number;
  stamina: number;
  breedCooldown: number;
  packId?: string;
}

// ============================================================
// Constants
// ============================================================

const MEMORY_FOOD_EXPIRY = 500;
const MEMORY_WATER_EXPIRY = 500;
const MEMORY_DANGER_EXPIRY = 200;
const CREPUSCULAR_FRACTION = 0.15;
const FLOCKING_RANGE = 5;
const SEPARATION_MIN_DIST = 1;
const PACK_HOWL_RANGE = 15;
const PEACE_AURA_RANGE = 3;
const TRAMPLE_RANGE = 3;
const STEAL_RANGE = 2;
const ZIGZAG_INTERVAL = 5;
const SHEEP_PANIC_RANGE = 8;
const AMBUSH_BURST_RANGE = 3;
const CURL_DURATION = 50;
const CURL_DAMAGE_MULT = 0.5;
const ATTACK_COOLDOWN_TICKS = 10; // 1 second between attacks at 10 ticks/sec

// ============================================================
// Day/Night Helpers
// ============================================================

const DAY_LENGTH = WorldConfig.animals.dayLengthTicks;
const HALF_DAY = DAY_LENGTH / 2;

/** Returns true if tickCount falls in the daytime half of the cycle */
export function isDaytime(tickCount: number): boolean {
  const phase = tickCount % DAY_LENGTH;
  return phase < HALF_DAY;
}

/** Returns true if tickCount falls in the dawn/dusk transition windows */
function isCrepuscularTime(tickCount: number): boolean {
  const phase = tickCount % DAY_LENGTH;
  const dawnEnd = HALF_DAY * CREPUSCULAR_FRACTION;
  const duskStart = HALF_DAY * (1 - CREPUSCULAR_FRACTION);
  const nightDawnEnd = HALF_DAY + HALF_DAY * CREPUSCULAR_FRACTION;
  const nightDuskStart = HALF_DAY + HALF_DAY * (1 - CREPUSCULAR_FRACTION);

  if (phase < dawnEnd) return true;
  if (phase > duskStart && phase < HALF_DAY) return true;
  if (phase > HALF_DAY && phase < nightDawnEnd) return true;
  if (phase > nightDuskStart) return true;
  return false;
}

/** Returns true if this animal should be active right now */
function isActiveTime(activity: 'diurnal' | 'nocturnal' | 'crepuscular', tickCount: number): boolean {
  switch (activity) {
    case 'diurnal': return isDaytime(tickCount);
    case 'nocturnal': return !isDaytime(tickCount);
    case 'crepuscular': return isCrepuscularTime(tickCount);
  }
}

// ============================================================
// Response Curves
// ============================================================

function quadratic(need: number): number {
  return Math.pow(1 - need / 100, 2);
}

function linear(need: number): number {
  return 1 - need / 100;
}

function logistic(dist: number, midpoint: number = 5): number {
  return 1 / (1 + Math.exp(0.4 * (dist - midpoint)));
}

// ============================================================
// Awareness System (sight, smell, sound)
// ============================================================

function computeSightAwareness(
  observer: { x: number; y: number },
  target: { x: number; y: number },
  sightRange: number,
  targetIsMoving: boolean
): number {
  const d = distance(observer.x, observer.y, target.x, target.y);
  if (d > sightRange) return 0;
  const moveMod = targetIsMoving ? 1.2 : 0.7;
  return clamp((1 - d / sightRange) * moveMod, 0, 1);
}

function computeSmellAwareness(
  observer: { x: number; y: number },
  observerSpecies: AnimalSpecies,
  target: { x: number; y: number; resources?: any; species?: string },
  isAgent: boolean
): number {
  if (observerSpecies.diet === 'herbivore') return 0; // herbivores don't smell meat
  const smellRange = observerSpecies.detectionRange * 1.5;

  let targetSmell = 0;
  if (isAgent) {
    targetSmell = 0.3; // base agent smell
    const meat = ((target.resources?.meat as number) || 0) + ((target.resources?.food as number) || 0);
    targetSmell += meat / 20;
  } else if (target.species) {
    const targetSpec = getSpecies(target.species);
    targetSmell = (targetSpec.drops?.meat || 0) / 20;
  }

  const effectiveRange = smellRange * targetSmell;
  const d = distance(observer.x, observer.y, target.x, target.y);
  if (d > effectiveRange || effectiveRange <= 0) return 0;
  return clamp((1 - d / effectiveRange) * targetSmell, 0, 1);
}

function computeSoundAwareness(
  observer: { x: number; y: number },
  target: { x: number; y: number; action?: string },
  targetSize: number // 1=tiny, 2=small, 3=medium, 4=large
): number {
  let noise = 0;
  const action = target.action || '';
  if (action === 'hunting' || action === 'fighting') noise = targetSize * 0.5;
  else if (action === 'wandering' || action === 'fleeing' || action === 'traveling') noise = targetSize * 0.3;
  else if (action === 'harvesting' || action === 'building') noise = 0.6; // tool use is loud
  // idle/sleeping/grazing = no noise

  if (noise <= 0) return 0;
  const soundRange = 8 * noise;
  const d = distance(observer.x, observer.y, target.x, target.y);
  if (d > soundRange) return 0;
  return clamp(1 - d / soundRange, 0, 1);
}

function getSizeNum(size: string): number {
  switch (size) { case 'tiny': return 1; case 'small': return 2; case 'medium': return 3; case 'large': return 4; default: return 3; }
}

/** Combined awareness: max of all senses */
function computeAwareness(
  animal: AnimalState, species: AnimalSpecies,
  target: AnimalState | AgentState, isAgent: boolean
): number {
  const targetIsMoving = target.action !== 'idle' && target.action !== 'sleeping' && target.action !== 'resting';
  const sight = computeSightAwareness(animal, target, species.detectionRange, targetIsMoving);
  const smell = computeSmellAwareness(animal, species, target as any, isAgent);
  const targetSize = isAgent ? 3 : getSizeNum(getSpecies((target as AnimalState).species)?.size || 'medium');
  const sound = computeSoundAwareness(animal, target as any, targetSize);
  return Math.max(sight, smell, sound);
}

/** Danger score: how threatening is the target? */
function computeDangerScore(
  self: AnimalState, selfSpecies: AnimalSpecies,
  other: AnimalState | AgentState, isAgent: boolean
): number {
  let otherAttack = 0;
  const selfDefense = selfSpecies.health / 10; // rough proxy

  if (isAgent) {
    const agent = other as AgentState;
    otherAttack = 10 + (agent.skills?.combat?.level || 0) * 0.5;
  } else {
    const otherAnimal = other as AnimalState;
    const otherSpec = getSpecies(otherAnimal.species);
    otherAttack = otherSpec.attack;
  }

  let dangerScore = 0;
  if (otherAttack > selfDefense * 1.5) dangerScore = 0.9;
  else if (otherAttack > selfDefense) dangerScore = 0.6;
  else if (otherAttack > selfDefense * 0.5) dangerScore = 0.3;
  else dangerScore = 0.1;

  // Instinct bonus for known predator species
  if (!isAgent) {
    const otherAnimal = other as AnimalState;
    if (selfSpecies.fearedBy?.includes(otherAnimal.species)) {
      dangerScore = Math.min(1.0, dangerScore * 1.5);
    }
  }

  return dangerScore;
}

// ============================================================
// Sensing Helpers
// ============================================================

function findThreats(
  animal: AnimalState,
  species: AnimalSpecies,
  allAnimals: AnimalState[],
  tickCount: number,
  allAgents?: AgentState[]
): { entity: AnimalState | AgentState; dist: number; type: 'animal' | 'agent'; danger: number }[] {
  const threats: { entity: AnimalState | AgentState; dist: number; type: 'animal' | 'agent'; danger: number }[] = [];
  const hasPeaceAura = hasNearbyPeaceAura(animal, allAnimals);

  // Animal threats
  for (const other of allAnimals) {
    if (!other.alive || other.id === animal.id) continue;
    const awareness = computeAwareness(animal, species, other, false);
    if (awareness <= 0) continue;
    const otherSpec = getSpecies(other.species);
    const isPredator = otherSpec.hunts.includes(animal.species);
    const dangerScore = computeDangerScore(animal, species, other, false);
    if (isPredator || dangerScore > 0.5) {
      const d = distance(animal.x, animal.y, other.x, other.y);
      // Peace aura reduces effective threat level
      const effectiveDanger = hasPeaceAura ? dangerScore * 0.5 : dangerScore;
      threats.push({ entity: other, dist: d, type: 'animal', danger: effectiveDanger * awareness });
    }
  }

  // Agent threats
  if (allAgents) {
    for (const agent of allAgents) {
      if (!agent.alive) continue;
      const awareness = computeAwareness(animal, species, agent, true);
      if (awareness <= 0) continue;
      const dangerScore = computeDangerScore(animal, species, agent, true);
      // Agents are threats if: recently attacked us, or high danger score
      const wasAttackedByThis = animal.lastAttackedBy?.type === 'agent' && animal.lastAttackedBy.id === agent.id;
      if (dangerScore > 0.3 || wasAttackedByThis) {
        const d = distance(animal.x, animal.y, agent.x, agent.y);
        threats.push({
          entity: agent,
          dist: d,
          type: 'agent',
          danger: dangerScore * awareness * (wasAttackedByThis ? 2.0 : 1.0),
        });
      }
    }
  }

  threats.sort((a, b) => b.danger - a.danger);
  return threats;
}

function hasNearbyPeaceAura(animal: AnimalState, allAnimals: AnimalState[]): boolean {
  for (const other of allAnimals) {
    if (!other.alive || other.id === animal.id) continue;
    if (other.species !== 'capybara') continue;
    const otherSpec = getSpecies(other.species);
    if (otherSpec.specialAbility !== 'peace_aura') continue;
    if (distance(animal.x, animal.y, other.x, other.y) <= PEACE_AURA_RANGE) return true;
  }
  return false;
}

function findPrey(
  animal: AnimalState,
  species: AnimalSpecies,
  allAnimals: AnimalState[],
  allAgents?: AgentState[]
): { entity: AnimalState | AgentState; dist: number; type: 'animal' | 'agent' } | null {
  let best: { entity: AnimalState | AgentState; dist: number; type: 'animal' | 'agent' } | null = null;

  // Animal prey
  for (const other of allAnimals) {
    if (!other.alive || other.id === animal.id) continue;
    if (!species.hunts.includes(other.species)) continue;
    const awareness = computeAwareness(animal, species, other, false);
    if (awareness <= 0) continue;
    const d = distance(animal.x, animal.y, other.x, other.y);
    if (!best || d < best.dist) {
      best = { entity: other, dist: d, type: 'animal' };
    }
  }

  // Agent prey (only for species that hunt 'agent')
  if (species.hunts.includes('agent') && allAgents) {
    for (const agent of allAgents) {
      if (!agent.alive) continue;
      const awareness = computeAwareness(animal, species, agent, true);
      if (awareness <= 0) continue;
      const d = distance(animal.x, animal.y, agent.x, agent.y);
      if (!best || d < best.dist) {
        best = { entity: agent, dist: d, type: 'agent' };
      }
    }
  }

  // Adaptive diet: if no preferred prey found and critically hungry, hunt any smaller animal
  if (!best && animal.proteinHunger < 20) {
    const sizeOrder: Record<string, number> = { tiny: 1, small: 2, medium: 3, large: 4 };
    const mySize = sizeOrder[species.size] ?? 2;
    for (const other of allAnimals) {
      if (!other.alive || other.id === animal.id) continue;
      if (other.species === animal.species) continue;
      const otherSpecies = getSpecies(other.species);
      const otherSize = sizeOrder[otherSpecies.size] ?? 2;
      if (otherSize >= mySize) continue; // only hunt smaller
      const d = distance(animal.x, animal.y, other.x, other.y);
      if (d > species.detectionRange) continue;
      if (!best || d < best.dist) {
        best = { entity: other, dist: d, type: 'animal' };
      }
    }
  }

  return best;
}

function findMate(
  animal: AnimalState,
  species: AnimalSpecies,
  allAnimals: AnimalState[]
): AnimalState | null {
  let closest: AnimalState | null = null;
  let closestDist = Infinity;
  for (const other of allAnimals) {
    if (!other.alive || other.id === animal.id) continue;
    if (other.species !== animal.species) continue;
    if (other.breedCooldown > 0) continue;
    const d = distance(animal.x, animal.y, other.x, other.y);
    if (d <= 5 && d < closestDist) {
      closest = other;
      closestDist = d;
    }
  }
  return closest;
}

function findNearbySpecies(
  animal: AnimalState,
  allAnimals: AnimalState[],
  range: number
): AnimalState[] {
  const neighbors: AnimalState[] = [];
  for (const other of allAnimals) {
    if (!other.alive || other.id === animal.id) continue;
    if (other.species !== animal.species) continue;
    if (distance(animal.x, animal.y, other.x, other.y) <= range) neighbors.push(other);
  }
  return neighbors;
}

function findPackMembers(
  animal: AnimalState,
  allAnimals: AnimalState[],
  range: number
): AnimalState[] {
  if (!animal.packId) return [];
  const members: AnimalState[] = [];
  for (const other of allAnimals) {
    if (!other.alive || other.id === animal.id) continue;
    if (other.packId !== animal.packId) continue;
    if (distance(animal.x, animal.y, other.x, other.y) <= range) members.push(other);
  }
  return members;
}

function countByCategory(allAnimals: AnimalState[]): { prey: number; predators: number } {
  let prey = 0;
  let predators = 0;
  for (const a of allAnimals) {
    if (!a.alive) continue;
    const s = getSpecies(a.species);
    if (s.tier === 'small_prey' || s.tier === 'medium_herb' || s.tier === 'large_herb') prey++;
    else if (s.tier === 'apex' || s.tier === 'mid_predator') predators++;
  }
  return { prey, predators };
}

function countSpecies(speciesId: string, allAnimals: AnimalState[]): number {
  let count = 0;
  for (const a of allAnimals) {
    if (a.alive && a.species === speciesId) count++;
  }
  return count;
}

function countTotalAlive(allAnimals: AnimalState[]): number {
  let count = 0;
  for (const a of allAnimals) {
    if (a.alive) count++;
  }
  return count;
}

// ============================================================
// Spatial Memory Helpers (unified SpatialMemoryEntry[] system)
// ============================================================

// Memory limits by species tier
const MEMORY_LIMITS: Record<string, number> = {
  apex: 15, mid_predator: 10, large_herb: 8, medium_herb: 8, small_prey: 5,
};
const MEMORY_EXPIRY: Record<string, number> = {
  apex: 2000, mid_predator: 1500, large_herb: 1000, medium_herb: 1000, small_prey: 500,
};

function getMemoryLimit(animal: AnimalState): number {
  const species = getSpecies(animal.species);
  return MEMORY_LIMITS[species.tier] ?? 8;
}

function getMemoryExpiry(animal: AnimalState): number {
  const species = getSpecies(animal.species);
  return MEMORY_EXPIRY[species.tier] ?? 1000;
}

function rememberLocation(
  animal: AnimalState, type: 'food' | 'water' | 'danger', x: number, y: number, tickCount: number
): void {
  if (!animal.spatialMemory) animal.spatialMemory = [];
  // Update existing entry of same type nearby, or add new
  const existing = animal.spatialMemory.find(m => m.type === type && distance(m.x, m.y, x, y) < 3);
  if (existing) {
    existing.x = x;
    existing.y = y;
    existing.tick = tickCount;
  } else {
    animal.spatialMemory.push({ type, x, y, tick: tickCount });
    // Enforce limit: remove oldest if over
    const limit = getMemoryLimit(animal);
    while (animal.spatialMemory.length > limit) {
      let oldestIdx = 0;
      for (let i = 1; i < animal.spatialMemory.length; i++) {
        if (animal.spatialMemory[i].tick < animal.spatialMemory[oldestIdx].tick) oldestIdx = i;
      }
      animal.spatialMemory.splice(oldestIdx, 1);
    }
  }
  // Also update legacy fields for client compatibility
  if (type === 'food') { animal.lastFoodX = x; animal.lastFoodY = y; animal.lastFoodTick = tickCount; }
  if (type === 'water') { animal.lastWaterX = x; animal.lastWaterY = y; animal.lastWaterTick = tickCount; }
  if (type === 'danger') { animal.lastDangerX = x; animal.lastDangerY = y; animal.lastDangerTick = tickCount; }
}

function findMemory(
  animal: AnimalState, type: 'food' | 'water' | 'danger', tickCount: number
): { x: number; y: number; tick: number } | null {
  if (!animal.spatialMemory) return null;
  const expiry = getMemoryExpiry(animal);
  let best: { x: number; y: number; tick: number } | null = null;
  for (const m of animal.spatialMemory) {
    if (m.type !== type) continue;
    if (tickCount - m.tick > expiry) continue;
    if (!best || m.tick > best.tick) best = m;
  }
  return best;
}

function rememberFood(animal: AnimalState, x: number, y: number, tickCount: number): void {
  rememberLocation(animal, 'food', x, y, tickCount);
}

function rememberWater(animal: AnimalState, x: number, y: number, tickCount: number): void {
  rememberLocation(animal, 'water', x, y, tickCount);
}

function rememberDanger(animal: AnimalState, x: number, y: number, tickCount: number): void {
  rememberLocation(animal, 'danger', x, y, tickCount);
}

function hasRecentFoodMemory(animal: AnimalState, tickCount: number): boolean {
  return findMemory(animal, 'food', tickCount) !== null;
}

function hasRecentWaterMemory(animal: AnimalState, tickCount: number): boolean {
  return findMemory(animal, 'water', tickCount) !== null;
}

function hasRecentDangerMemory(animal: AnimalState, tickCount: number): boolean {
  return findMemory(animal, 'danger', tickCount) !== null;
}

function isNearDanger(animal: AnimalState, tx: number, ty: number, tickCount: number): boolean {
  const danger = findMemory(animal, 'danger', tickCount);
  if (!danger) return false;
  return distance(tx, ty, danger.x, danger.y) < 5;
}

// ============================================================
// Flocking / Steering (simplified)
// ============================================================

function computeFlockingBias(
  animal: AnimalState,
  species: AnimalSpecies,
  allAnimals: AnimalState[]
): { x: number; y: number } | null {
  if (!species.flockingWeights || species.social === 'solitary') return null;

  const neighbors = findNearbySpecies(animal, allAnimals, FLOCKING_RANGE);
  if (neighbors.length === 0) return null;

  const weights = species.flockingWeights;

  // Cohesion: average position
  let cx = 0, cy = 0;
  for (const n of neighbors) { cx += n.x; cy += n.y; }
  cx /= neighbors.length;
  cy /= neighbors.length;

  // Separation: push away from very close neighbors
  let sx = 0, sy = 0;
  for (const n of neighbors) {
    const d = distance(animal.x, animal.y, n.x, n.y);
    if (d < SEPARATION_MIN_DIST && d > 0) {
      sx += (animal.x - n.x) / d;
      sy += (animal.y - n.y) / d;
    }
  }

  const totalWeight = weights.cohesion + weights.separation;
  if (totalWeight === 0) return null;

  const bx = (cx * weights.cohesion + (animal.x + sx) * weights.separation) / totalWeight;
  const by = (cy * weights.cohesion + (animal.y + sy) * weights.separation) / totalWeight;

  return {
    x: clamp(Math.round(bx), 0, WORLD_WIDTH - 1),
    y: clamp(Math.round(by), 0, WORLD_HEIGHT - 1),
  };
}

// ============================================================
// Needs Decay
// ============================================================

// ─── Animal Metabolism ───

const ANIMAL_ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sleeping: 0.4, curled: 0.5, idle: 0.6,
  grazing: 0.8, following: 0.8,
  wandering: 1.0, breeding: 1.0, traveling: 1.0, guarding: 1.0,
  stalking: 1.2, fleeing: 1.3,
  hunting: 1.6, fighting: 1.8,
  dying: 0,
};

function getAnimalTotalSkillLevels(animal: AnimalState): number {
  const s = animal.skills;
  return s.combat.level + s.defense.level + s.athletics.level +
    s.woodcutting.level + s.mining.level + s.foraging.level +
    s.building.level + s.crafting.level + s.survival.level + s.social.level;
}

function getAnimalMetabolism(animal: AnimalState): number {
  const levelMod = 1 + getAnimalTotalSkillLevels(animal) / 500;
  const activityMod = ANIMAL_ACTIVITY_MULTIPLIERS[animal.action] ?? 1.0;
  return levelMod * activityMod;
}

export function decayAnimalNeeds(animal: AnimalState, species: AnimalSpecies, staminaDecayMult: number = 1.0): void {
  if (!animal.alive) return;

  // Metabolism: scales with total skill levels and current activity
  const metabolism = getAnimalMetabolism(animal);

  // Size-based hunger scaling: larger animals burn more energy
  const sizeMultiplier = species.size === 'tiny' ? 0.5
    : species.size === 'small' ? 0.75
    : species.size === 'medium' ? 1.0
    : 1.5; // large
  const hungerDecay = species.hungerDecay * sizeMultiplier;
  let proteinDecay: number;
  let plantDecay: number;
  switch (species.diet) {
    case 'carnivore':
      proteinDecay = hungerDecay * 1.0;
      plantDecay = 0;
      break;
    case 'herbivore':
      proteinDecay = 0;
      plantDecay = hungerDecay * 1.0;
      break;
    case 'omnivore':
      proteinDecay = hungerDecay * 0.6;
      plantDecay = hungerDecay * 0.6;
      break;
  }
  animal.proteinHunger = clamp(animal.proteinHunger - proteinDecay * metabolism, 0, 100);
  animal.plantHunger = clamp(animal.plantHunger - plantDecay * metabolism, 0, 100);
  animal.thirst = clamp(animal.thirst - species.thirstDecay * metabolism, 0, 100);

  // Stamina drain scaled by metabolism and season
  const staminaRate = species.staminaDecay * metabolism * staminaDecayMult;
  animal.stamina = clamp(animal.stamina - staminaRate, 0, 100);

  // Sleeping restores stamina (inversely scaled — bigger body recovers slower)
  if (animal.action === 'sleeping') {
    const restEfficiency = 1 / (1 + getAnimalTotalSkillLevels(animal) / 800);
    animal.stamina = clamp(animal.stamina + 0.2 * restEfficiency, 0, 100);
  }

  // Health damage from critical needs (diet-aware)
  const needsProtein = species.diet !== 'herbivore';
  const needsPlants = species.diet !== 'carnivore';
  const proteinCritical = needsProtein && animal.proteinHunger <= 0;
  const plantCritical = needsPlants && animal.plantHunger <= 0;

  if (proteinCritical && plantCritical) {
    // Omnivore with both depleted: extra penalty
    animal.health = clamp(animal.health - 1.5, 0, animal.maxHealth);
  } else {
    if (proteinCritical) animal.health = clamp(animal.health - 0.5, 0, animal.maxHealth);
    if (plantCritical) animal.health = clamp(animal.health - 0.5, 0, animal.maxHealth);
  }
  if (animal.thirst <= 0) animal.health = clamp(animal.health - 0.8, 0, animal.maxHealth);

  // Slow health regen when relevant needs are met
  const proteinOk = !needsProtein || animal.proteinHunger > 50;
  const plantOk = !needsPlants || animal.plantHunger > 50;
  if (proteinOk && plantOk && animal.thirst > 50) {
    animal.health = clamp(animal.health + 0.1, 0, animal.maxHealth);
  }

  // Award survival XP when any relevant need is critically low
  const anyNeedLow =
    (needsProtein && animal.proteinHunger < 30) ||
    (needsPlants && animal.plantHunger < 30) ||
    animal.thirst < 30;
  if (anyNeedLow) {
    const diffMod = 1.0;
    awardXP(animal.skills, 'survival', 0.3, diffMod);
  }

  // Decrement breed cooldown
  if (animal.breedCooldown > 0) {
    animal.breedCooldown--;
  }

  // Decrement attack cooldown
  if (animal.attackCooldown > 0) {
    animal.attackCooldown--;
  }

  // Death check
  if (animal.health <= 0) {
    animal.alive = false;
    animal.action = 'dying';
  }

  animal.age++;
}

// ============================================================
// Decision (Utility-based AI)
// ============================================================

export function decideAnimalAction(
  animal: AnimalState,
  species: AnimalSpecies,
  world: World,
  allAnimals: AnimalState[],
  tickCount: number,
  agents?: AgentState[]
): AnimalDecision {
  if (!animal.alive) return { action: 'dying', score: 0 };

  const candidates: AnimalDecision[] = [];
  const ax = Math.floor(animal.x);
  const ay = Math.floor(animal.y);
  const active = isActiveTime(species.activity, tickCount);

  // ──────────────────────────────────────────────
  // Shared survival decisions (same engine as agents)
  // ──────────────────────────────────────────────
  const survivalConfig: SurvivalConfig = {
    criticalThirst: 20, criticalHunger: 20, criticalStamina: 15,
    criticalHealth: 30, mediumThirst: 50, mediumHunger: 50,
    drinkPriority: 60, eatPriority: 55, restPriority: 80,
    searchRadius: species.detectionRange, criticalSearchRadius: 40,
    diet: species.diet,
  };

  const being = {
    x: animal.x, y: animal.y,
    health: animal.health / (animal.maxHealth / 100), // normalize to 0-100
    proteinHunger: animal.proteinHunger, plantHunger: animal.plantHunger,
    thirst: animal.thirst, stamina: animal.stamina,
    baseStats: animal.baseStats, skills: animal.skills as any,
    alive: animal.alive, action: animal.action,
    lastAttackedBy: animal.lastAttackedBy, attackCooldown: animal.attackCooldown,
    spatialMemory: animal.spatialMemory, age: animal.age,
  };

  const survivalDecisions = evaluateSurvivalNeeds(being, world, survivalConfig);
  // Convert SharedDecision → AnimalDecision (score = priority / 100)
  for (const sd of survivalDecisions) {
    candidates.push({
      action: (sd.action === 'harvesting' ? 'grazing' : sd.action) as AnimalAction,
      target: sd.target,
      targetEntityId: sd.targetId,
      score: sd.priority / 100, // normalize to 0-1 range
    });
  }

  // Shared threat evaluation
  const totalSkills = Object.values(animal.skills).reduce((sum, s) => sum + s.level, 0);
  const threatConfig: ThreatConfig = {
    detectBase: Math.floor(species.detectionRange / 2),
    fleeBase: Math.floor(species.fleeThreshold * 100),
    confidence: Math.min(1.5, 0.5 + totalSkills / 100),
    desperation: (animal.proteinHunger < 15 || animal.thirst < 15) ? 25 : 0,
    huntsList: species.hunts,
  };
  const threatDecisions = evaluateThreats(being, world, threatConfig, 'animal');
  for (const td of threatDecisions) {
    candidates.push({
      action: td.action as AnimalAction,
      target: td.target,
      score: td.priority / 100,
    });
  }

  // ──────────────────────────────────────────────
  // Tamed behaviors
  // ──────────────────────────────────────────────

  if (animal.tamed && animal.tamedBy) {
    if (species.tamedBehavior === 'follow') {
      const d = distance(animal.x, animal.y, animal.homeX, animal.homeY);
      const followScore = 0.6 * Math.min(d / 10, 1);
      if (followScore > 0.05) {
        candidates.push({
          action: 'following',
          target: { x: animal.homeX, y: animal.homeY },
          score: followScore,
        });
      }
    }

    if (species.tamedBehavior === 'guard') {
      const guardScore = computeGuardingScore(animal, species, allAnimals);
      if (guardScore > 0.05) {
        const guardThreats = findThreats(animal, species, allAnimals, tickCount, agents);
        const nearHomeThreat = guardThreats.find(t =>
          distance(t.entity.x, t.entity.y, animal.homeX, animal.homeY) <= 5
        );
        if (nearHomeThreat) {
          candidates.push({
            action: 'guarding',
            target: { x: Math.floor(nearHomeThreat.entity.x), y: Math.floor(nearHomeThreat.entity.y) },
            targetEntityId: nearHomeThreat.type === 'agent' ? 'agent:' + (nearHomeThreat.entity as AgentState).id : (nearHomeThreat.entity as AnimalState).id,
            score: guardScore,
          });
        } else {
          candidates.push({
            action: 'guarding',
            target: { x: animal.homeX, y: animal.homeY },
            score: 0.3,
          });
        }
      }
    }
  }

  // ──────────────────────────────────────────────
  // Curl defense (hedgehog)
  // ──────────────────────────────────────────────
  if (species.specialAbility === 'curl') {
    const curlThreats = findThreats(animal, species, allAnimals, tickCount, agents);
    if (curlThreats.length > 0 && curlThreats[0].dist < species.detectionRange) {
      candidates.push({ action: 'curled', score: 0.95 });
    }
  }

  // ──────────────────────────────────────────────
  // Retaliation check (recently attacked — fight or flight)
  // ──────────────────────────────────────────────
  if (animal.lastAttackedBy && tickCount && (tickCount - animal.lastAttackedBy.tick) < 50) {
    if (species.utilityWeights.aggression > 0.5 && species.attack > 15) {
      // Fight back
      candidates.push({
        action: 'fighting',
        targetEntityId: (animal.lastAttackedBy.type === 'agent' ? 'agent:' : '') + animal.lastAttackedBy.id,
        target: undefined,
        score: 0.95,
      });
    } else {
      // Flee from attacker — look up entity position
      let attackerPos: { x: number; y: number } | null = null;
      if (animal.lastAttackedBy.type === 'agent' && agents) {
        const attacker = agents.find(a => a.id === animal.lastAttackedBy!.id && a.alive);
        if (attacker) attackerPos = { x: attacker.x, y: attacker.y };
      } else {
        const attacker = allAnimals.find(a => a.id === animal.lastAttackedBy!.id && a.alive);
        if (attacker) attackerPos = { x: attacker.x, y: attacker.y };
      }
      if (attackerPos) {
        candidates.push({
          action: 'fleeing',
          target: computeFleeTarget(animal, species, attackerPos, tickCount),
          score: 0.95,
        });
      }
    }
  }

  // ──────────────────────────────────────────────
  // Flee
  // ──────────────────────────────────────────────
  const threats = findThreats(animal, species, allAnimals, tickCount, agents);
  const closestThreat = threats[0] ?? null;

  if (closestThreat && species.specialAbility !== 'curl') {
    rememberDanger(animal, Math.floor(closestThreat.entity.x), Math.floor(closestThreat.entity.y), tickCount);

    // Pack courage
    let fleeReduction = 0;
    if (species.social === 'pack' && animal.packId) {
      const packMates = findPackMembers(animal, allAnimals, 10);
      fleeReduction = packMates.length * 0.1;
    }

    let fleeScore = logistic(closestThreat.dist, species.detectionRange * 0.4) * species.utilityWeights.safety * closestThreat.danger;
    fleeScore = Math.max(0, fleeScore - fleeReduction);

    if (fleeScore > 0.05) {
      const fleeTarget = computeFleeTarget(animal, species, closestThreat.entity, tickCount);
      candidates.push({
        action: 'fleeing',
        target: fleeTarget,
        targetEntityId: closestThreat.type === 'agent' ? 'agent:' + (closestThreat.entity as AgentState).id : (closestThreat.entity as AnimalState).id,
        score: fleeScore,
      });

      // Sheep panic cascade
      if (animal.species === 'sheep') {
        triggerSheepPanic(animal, allAnimals, fleeTarget);
      }
    }
  }

  // High-priority flee when actively under attack
  if (animal.health < animal.maxHealth * 0.7 && closestThreat && closestThreat.dist < 3 && species.specialAbility !== 'curl') {
    const existingFlee = candidates.find(c => c.action === 'fleeing');
    candidates.push({
      action: 'fleeing',
      target: existingFlee?.target ?? computeFleeTarget(animal, species, closestThreat.entity, tickCount),
      score: 0.95,
    });
  }

  // ──────────────────────────────────────────────
  // Hunting (predators + ambush) — now includes agents via findPrey
  // ──────────────────────────────────────────────
  if (species.hunts.length > 0) {
    const huntHunger = species.diet === 'herbivore' ? 100 : animal.proteinHunger;
    const huntScore = quadratic(huntHunger) * species.utilityWeights.aggression * 0.9;
    if (huntScore > 0.05) {
      const prey = findPrey(animal, species, allAnimals, agents);
      if (prey) {
        const preyEntityId = prey.type === 'agent'
          ? 'agent:' + (prey.entity as AgentState).id
          : (prey.entity as AnimalState).id;

        // Howl: alert pack members (animal prey only)
        if (species.specialAbility === 'howl' && animal.packId && prey.type === 'animal') {
          triggerPackHowl(animal, prey.entity as AnimalState, allAnimals);
        }

        if (species.specialAbility === 'ambush' && prey.dist > AMBUSH_BURST_RANGE) {
          candidates.push({
            action: 'stalking',
            target: { x: Math.floor(prey.entity.x), y: Math.floor(prey.entity.y) },
            targetEntityId: preyEntityId,
            score: huntScore,
          });
        } else {
          candidates.push({
            action: 'hunting',
            target: { x: Math.floor(prey.entity.x), y: Math.floor(prey.entity.y) },
            targetEntityId: preyEntityId,
            score: huntScore,
          });
        }
      } else if (huntHunger < 30) {
        // No prey found but critically hungry — wander to search for food
        const foodMem = findMemory(animal, 'food', tickCount);
        const searchTarget = foodMem
          ? { x: foodMem.x, y: foodMem.y }
          : { x: animal.homeX + randomInt(-15, 15), y: animal.homeY + randomInt(-15, 15) };
        candidates.push({
          action: 'wandering',
          target: searchTarget,
          score: huntScore * 0.6,
        });
      }
    }
  }

  // ──────────────────────────────────────────────
  // Scavenge corpses (scavenger species only)
  // ──────────────────────────────────────────────
  if (species.isScavenger) {
    const corpse = world.findNearestCorpse(ax, ay, species.detectionRange);
    if (corpse && corpse.materials.meat && corpse.materials.meat > 0) {
      const hungerVal = species.diet === 'herbivore' ? 100 : animal.proteinHunger;
      const scavengeScore = quadratic(hungerVal) * species.utilityWeights.food * 1.3; // 30% bonus over hunting
      candidates.push({
        action: 'grazing',  // reuse grazing action for eating from corpse
        target: { x: Math.floor(corpse.x), y: Math.floor(corpse.y) },
        targetEntityId: 'corpse:' + corpse.id,
        score: scavengeScore,
      });
    }
  }

  // ──────────────────────────────────────────────
  // Seek food (herbivores/omnivores)
  // ──────────────────────────────────────────────
  if (species.diet !== 'carnivore') {
    const isCriticalHunger = animal.plantHunger < 20;
    const foodSearchRange = isCriticalHunger ? 40 : species.detectionRange;
    const foodScore = quadratic(animal.plantHunger) * species.utilityWeights.food;
    const foodUrgency = isCriticalHunger ? Math.max(foodScore, 2.0) : foodScore;
    if (foodUrgency > 0.05) {
      const foodPlant = world.findNearestPlant(ax, ay, [
        PlantType.BERRY_BUSH, PlantType.MUSHROOM,
        PlantType.EDIBLE_FLOWER, PlantType.HUNGER_HERB,
      ], foodSearchRange);

      if (foodPlant) {
        candidates.push({
          action: 'grazing',
          target: { x: foodPlant.x, y: foodPlant.y },
          targetEntityId: foodPlant.id,
          score: foodUrgency,
        });
      } else if (hasRecentFoodMemory(animal, tickCount)) {
        const foodMem = findMemory(animal, 'food', tickCount);
        if (foodMem) {
          candidates.push({
            action: 'grazing',
            target: { x: foodMem.x, y: foodMem.y },
            score: foodUrgency * 0.7,
          });
        }
      } else if (isCriticalHunger) {
        // Desperate search: wander randomly looking for food
        candidates.push({
          action: 'wandering',
          target: { x: ax + Math.floor(Math.random() * 20) - 10, y: ay + Math.floor(Math.random() * 20) - 10 },
          score: foodUrgency * 0.5,
        });
      }
    }
  }

  // ──────────────────────────────────────────────
  // Seek water
  // ──────────────────────────────────────────────
  // Critical needs get wider search range (like agents)
  const isCriticalThirst = animal.thirst < 20;
  const searchRange = isCriticalThirst ? 40 : species.detectionRange;
  const waterScore = linear(animal.thirst) * 1.2 * species.utilityWeights.water;
  // Boost score when critically thirsty to override everything else
  const waterUrgency = isCriticalThirst ? Math.max(waterScore, 2.0) : waterScore;
  if (waterUrgency > 0.05) {
    const waterTile = world.findNearest(ax, ay, TileType.WATER, searchRange);
    if (waterTile) {
      const walkable = world.findNearestWalkable(ax, ay, waterTile.x, waterTile.y);
      candidates.push({ action: 'drinking', target: walkable, score: waterUrgency });
    } else if (hasRecentWaterMemory(animal, tickCount)) {
      const waterMem = findMemory(animal, 'water', tickCount);
      if (waterMem) {
        candidates.push({
          action: 'drinking',
          target: { x: waterMem.x, y: waterMem.y },
          score: waterUrgency * 0.7,
        });
      }
    } else if (isCriticalThirst) {
      // Desperate: wander randomly looking for water
      candidates.push({
        action: 'wandering',
        target: { x: ax + Math.floor(Math.random() * 20) - 10, y: ay + Math.floor(Math.random() * 20) - 10 },
        score: waterUrgency * 0.5,
      });
    }
  }

  // ──────────────────────────────────────────────
  // Breeding
  // ──────────────────────────────────────────────
  const breedScore = computeBreedScore(animal, species, allAnimals, tickCount);
  if (breedScore > 0.05) {
    const mate = findMate(animal, species, allAnimals);
    if (mate) {
      candidates.push({
        action: 'breeding',
        target: { x: Math.floor(mate.x), y: Math.floor(mate.y) },
        targetEntityId: mate.id,
        score: breedScore,
      });
    }
  }

  // ──────────────────────────────────────────────
  // Rest / sleep (with inactive-period bonus)
  // ──────────────────────────────────────────────
  let restScore = quadratic(animal.stamina) * 0.8;
  if (!active) restScore += 0.5;
  // Suppress sleep when critically hungry/thirsty — survival takes priority
  const critProtein = (species.diet !== 'herbivore') && animal.proteinHunger < 20;
  const critPlant = (species.diet !== 'carnivore') && animal.plantHunger < 20;
  if (critProtein || critPlant || animal.thirst < 20) {
    restScore *= 0.1; // drastically reduce sleep desire when starving/dehydrated
  }
  if (restScore > 0.1) {
    candidates.push({ action: 'sleeping', score: restScore });
  }

  // ──────────────────────────────────────────────
  // Return home if far
  // ──────────────────────────────────────────────
  const homeDist = distance(animal.x, animal.y, animal.homeX, animal.homeY);
  if (homeDist > 15) {
    candidates.push({
      action: 'traveling',
      target: { x: animal.homeX, y: animal.homeY },
      score: 0.3 + (homeDist - 15) * 0.02,
    });
  }

  // ──────────────────────────────────────────────
  // Wander (with flocking bias)
  // ──────────────────────────────────────────────
  const flockTarget = computeFlockingBias(animal, species, allAnimals);
  candidates.push({
    action: 'wandering',
    target: flockTarget ?? undefined,
    score: 0.12,
  });

  // Pick highest scoring action
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return best.score < 0.05 ? { action: 'idle', score: 0 } : best;
}

// ============================================================
// Utility Sub-computations
// ============================================================

function computeBreedScore(
  animal: AnimalState,
  species: AnimalSpecies,
  allAnimals: AnimalState[],
  tickCount: number
): number {
  if (animal.breedCooldown > 0) return 0;
  const effectiveBreedHunger = species.diet === 'carnivore' ? animal.proteinHunger
    : species.diet === 'herbivore' ? animal.plantHunger
    : Math.min(animal.proteinHunger, animal.plantHunger);
  if (effectiveBreedHunger <= 60 || animal.thirst <= 50) return 0;

  const breedThreats = findThreats(animal, species, allAnimals, tickCount);
  if (breedThreats.length > 0 && breedThreats[0].dist < species.detectionRange) return 0;

  const mate = findMate(animal, species, allAnimals);
  if (!mate) return 0;

  const speciesCount = countSpecies(animal.species, allAnimals);
  if (speciesCount >= species.maxPopulation) return 0;
  if (countTotalAlive(allAnimals) >= WorldConfig.animals.maxTotal) return 0;

  return 0.4;
}

function computeGuardingScore(
  animal: AnimalState,
  species: AnimalSpecies,
  allAnimals: AnimalState[]
): number {
  if (!animal.tamed) return 0;
  for (const other of allAnimals) {
    if (!other.alive || other.id === animal.id) continue;
    const otherSpec = getSpecies(other.species);
    if (otherSpec.tier === 'apex' || otherSpec.tier === 'mid_predator') {
      if (distance(other.x, other.y, animal.homeX, animal.homeY) <= 5) return 0.85;
    }
  }
  return 0.3;
}

// ============================================================
// Flee Target Computation
// ============================================================

function computeFleeTarget(
  animal: AnimalState,
  species: AnimalSpecies,
  threat: { x: number; y: number },
  tickCount: number
): { x: number; y: number } {
  let dx = animal.x - threat.x;
  let dy = animal.y - threat.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= len;
  dy /= len;

  let fleeDist = 8;

  // Horse bolt: longer flee distance
  if (animal.species === 'horse') fleeDist = 16;

  // Deer zigzag: add ±30° deviation every ZIGZAG_INTERVAL ticks
  if (animal.species === 'deer' && animal.age % ZIGZAG_INTERVAL === 0) {
    const angle = (Math.random() * 60 - 30) * (Math.PI / 180);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const ndx = dx * cos - dy * sin;
    const ndy = dx * sin + dy * cos;
    dx = ndx;
    dy = ndy;
  }

  let fleeX = clamp(Math.floor(animal.x + dx * fleeDist), 0, WORLD_WIDTH - 1);
  let fleeY = clamp(Math.floor(animal.y + dy * fleeDist), 0, WORLD_HEIGHT - 1);

  // Avoid remembered danger
  if (isNearDanger(animal, fleeX, fleeY, tickCount)) {
    fleeX = clamp(Math.floor(animal.x + dy * fleeDist), 0, WORLD_WIDTH - 1);
    fleeY = clamp(Math.floor(animal.y - dx * fleeDist), 0, WORLD_HEIGHT - 1);
  }

  return { x: fleeX, y: fleeY };
}

// ============================================================
// Cascade Behaviors
// ============================================================

function triggerSheepPanic(
  animal: AnimalState,
  allAnimals: AnimalState[],
  fleeTarget: { x: number; y: number }
): void {
  for (const other of allAnimals) {
    if (!other.alive || other.id === animal.id) continue;
    if (other.species !== 'sheep') continue;
    if (other.action === 'fleeing') continue;
    if (distance(animal.x, animal.y, other.x, other.y) <= SHEEP_PANIC_RANGE) {
      other.action = 'fleeing';
      other.target = { ...fleeTarget };
    }
  }
}

function triggerPackHowl(
  animal: AnimalState,
  prey: AnimalState,
  allAnimals: AnimalState[]
): void {
  if (!animal.packId) return;
  for (const other of allAnimals) {
    if (!other.alive || other.id === animal.id) continue;
    if (other.packId !== animal.packId) continue;
    if (distance(animal.x, animal.y, other.x, other.y) <= PACK_HOWL_RANGE) {
      other.action = 'hunting';
      other.target = { x: Math.floor(prey.x), y: Math.floor(prey.y) };
      other.targetEntityId = prey.id;
    }
  }
}

// ============================================================
// Action Execution
// ============================================================

export function executeAnimalAction(
  animal: AnimalState,
  decision: AnimalDecision,
  species: AnimalSpecies,
  world: World,
  allAnimals: AnimalState[],
  agents?: AgentState[]
): AnimalOffspring[] {
  animal.action = decision.action;
  animal.target = decision.target;
  animal.targetEntityId = decision.targetEntityId;

  const offspring: AnimalOffspring[] = [];
  const tickCount = animal.age;

  switch (decision.action) {
    case 'idle': {
      if (animal.actionTimer > 0) animal.actionTimer--;
      handlePassiveAbilities(animal, species, world, allAnimals, tickCount);
      break;
    }

    case 'wandering': {
      if (!animal.target || distance(animal.x, animal.y, animal.target.x, animal.target.y) < 1) {
        const baseX = decision.target?.x ?? animal.homeX;
        const baseY = decision.target?.y ?? animal.homeY;
        for (let attempt = 0; attempt < 10; attempt++) {
          const wx = baseX + randomInt(-8, 8);
          const wy = baseY + randomInt(-8, 8);
          if (wx >= 0 && wx < WORLD_WIDTH && wy >= 0 && wy < WORLD_HEIGHT && world.isWalkable(wx, wy)) {
            animal.target = { x: wx, y: wy };
            break;
          }
        }
      }
      if (animal.target) {
        moveAnimalPathfind(animal, animal.target.x, animal.target.y, species.speed * (1 + getSpeedBonus(animal.skills)), world);
      }
      handlePassiveAbilities(animal, species, world, allAnimals, tickCount);
      break;
    }

    case 'grazing': {
      // Check if this is corpse scavenging
      if (decision.targetEntityId?.startsWith('corpse:')) {
        const corpseId = decision.targetEntityId.slice(7); // remove 'corpse:' prefix
        const corpse = world.corpses.find(c => c.id === corpseId);
        if (!corpse || !corpse.materials.meat || corpse.materials.meat <= 0) {
          animal.action = 'idle';
          break;
        }
        const d = distance(animal.x, animal.y, corpse.x, corpse.y);
        if (d <= 1.5) {
          // Eat meat from corpse (1 unit per 3 ticks)
          if (animal.age % 3 === 0) {
            corpse.materials.meat -= 1;
            animal.proteinHunger = clamp(animal.proteinHunger + 10, 0, 100);
            rememberFood(animal, corpse.x, corpse.y, tickCount);
          }
          // Remove corpse if all materials depleted
          const remaining = Object.values(corpse.materials).reduce((s, v) => s + (v || 0), 0);
          if (remaining <= 0) {
            world.corpses = world.corpses.filter(c => c.id !== corpse.id);
          }
        } else {
          moveAnimalPathfind(animal, corpse.x, corpse.y, species.speed * (1 + getSpeedBonus(animal.skills)), world);
        }
        break;
      }

      if (!decision.target) {
        // Grass grazing: herbivores on grass tiles eat grass for +3 plant hunger
        if (species.diet === 'herbivore' || species.diet === 'omnivore') {
          const animalTile = world.getTile(Math.floor(animal.x), Math.floor(animal.y));
          if (animalTile === TileType.GRASS && animal.age % 5 === 0) {
            animal.plantHunger = clamp(animal.plantHunger + 3, 0, 100);
          }
        }
        break;
      }
      const d = distance(animal.x, animal.y, decision.target.x, decision.target.y);
      if (d <= 1.5) {
        if (decision.targetEntityId) {
          const plant = world.plants.find(p => p.id === decision.targetEntityId);
          if (plant) {
            if (plant.type === PlantType.BERRY_BUSH) {
              const result = world.harvestPlant(plant.id, 5);
              if (result) {
                animal.plantHunger = clamp(animal.plantHunger + 15, 0, 100);
                rememberFood(animal, plant.x, plant.y, tickCount);
                awardXP(animal.skills, 'foraging', 0.8, 1.0);
              }
            } else {
              const consumed = world.consumePlant(plant.id);
              if (consumed) {
                const restore = plant.type === PlantType.MUSHROOM ? 15
                  : plant.type === PlantType.HUNGER_HERB ? 20
                  : 10;
                animal.plantHunger = clamp(animal.plantHunger + restore, 0, 100);
                rememberFood(animal, decision.target.x, decision.target.y, tickCount);
                awardXP(animal.skills, 'foraging', 0.8, 1.0);
              }
            }
          }
        } else {
          // No specific plant target but on grass — graze
          if (species.diet === 'herbivore' || species.diet === 'omnivore') {
            const animalTile = world.getTile(Math.floor(animal.x), Math.floor(animal.y));
            if (animalTile === TileType.GRASS && animal.age % 5 === 0) {
              animal.plantHunger = clamp(animal.plantHunger + 3, 0, 100);
            }
          }
        }
      } else {
        moveAnimalPathfind(animal, decision.target.x, decision.target.y, species.speed * (1 + getSpeedBonus(animal.skills)), world);
      }
      break;
    }

    case 'stalking': {
      if (!decision.targetEntityId) break;
      const prey = allAnimals.find(a => a.id === decision.targetEntityId);
      if (!prey || !prey.alive) { animal.action = 'idle'; break; }

      const d = distance(animal.x, animal.y, prey.x, prey.y);
      if (d <= AMBUSH_BURST_RANGE) {
        // Ambush first strike: 2x damage with hit accuracy
        animal.action = 'hunting';
        // Attack cooldown check
        if (animal.attackCooldown > 0) { animal.attackCooldown--; break; }
        animal.attackCooldown = ATTACK_COOLDOWN_TICKS;

        const ambushAccuracy = getHitAccuracy(animal.skills);
        if (Math.random() > ambushAccuracy) break; // miss
        const attackPower = getAnimalAttackPower(animal, species);
        let damage = attackPower * 2 * (0.8 + Math.random() * 0.4);
        // Apply target defense
        const preySpec = getSpecies(prey.species);
        const targetDefense = getAnimalDefense(prey, preySpec);
        damage = Math.max(1, damage * (1 - targetDefense));
        if (prey.action === 'curled') damage *= CURL_DAMAGE_MULT;

        prey.health = clamp(prey.health - damage, 0, prey.maxHealth);
        prey.lastAttackedBy = { type: 'animal', id: animal.id, tick: animal.age };
        awardXP(animal.skills, 'combat', 3.0, 1.0);
        if (prey.health <= 0) {
          prey.alive = false;
          prey.action = 'dying';
          animal.proteinHunger = clamp(animal.proteinHunger + preySpec.foodDrop * 10, 0, 100);
        } else {
          forceFleeWithPush(prey, animal, world);
        }
      } else {
        moveAnimalPathfind(animal, Math.floor(prey.x), Math.floor(prey.y), species.speed * 0.3 * (1 + getSpeedBonus(animal.skills)), world);
      }
      break;
    }

    case 'hunting': {
      if (!decision.targetEntityId) break;

      // Handle agent targets (awareness-based)
      if (decision.targetEntityId.startsWith('agent:')) {
        const agentId = decision.targetEntityId.slice(6); // remove 'agent:' prefix
        const targetAgent = agents?.find(a => a.id === agentId && a.alive);
        if (!targetAgent) { animal.action = 'idle'; break; }
        const d = distance(animal.x, animal.y, targetAgent.x, targetAgent.y);
        if (d <= 1.5) {
          // Attack cooldown check
          if (animal.attackCooldown > 0) { animal.attackCooldown--; break; }
          animal.attackCooldown = ATTACK_COOLDOWN_TICKS;

          // Hit accuracy check
          const huntAccuracy = getHitAccuracy(animal.skills);
          if (Math.random() <= huntAccuracy) {
            // Dodge check for agent
            const dodgeChance = getDodgeChance(targetAgent.skills);
            if (Math.random() < dodgeChance) {
              // Dodged! No damage
              awardXP(targetAgent.skills, 'athletics', 1.0);
            } else {
              const attackPower = getAnimalAttackPower(animal, species);
              let rawDamage = attackPower * (0.8 + Math.random() * 0.4);
              // Pack bonus
              if (species.social === 'pack' && animal.packId) {
                const packMates = findPackMembers(animal, allAnimals, 10);
                rawDamage *= (1 + packMates.length * 0.3);
              }
              const reduction = getDamageReduction(targetAgent.skills);
              const actualDamage = rawDamage * (1 - reduction);
              // Agent health is 0-100 scale; divide by 10 for proportional damage
              targetAgent.needs.health = clamp(targetAgent.needs.health - actualDamage / 10, 0, 100);
              awardXP(animal.skills, 'combat', 3.0, 1.0);
              // Agent gains defense XP from taking damage
              awardXP(targetAgent.skills, 'defense', 2.0, Math.min(3.0, actualDamage / 10));
              // Mark agent as attacked by this animal
              targetAgent.lastAttackedBy = { type: 'animal', id: animal.id, tick: animal.age };
              // If agent dies from this attack
              if (targetAgent.needs.health <= 0) {
                targetAgent.alive = false;
                targetAgent.action = 'dying';
                animal.proteinHunger = clamp(animal.proteinHunger + 60, 0, 100); // big meal
              }
            }
          }
        } else {
          // Speed-based chase: check if agent can outrun predator
          const predatorSpeed = getAnimalSpeed(animal, species);
          let chaseSpeed = predatorSpeed;
          if (species.specialAbility === 'ambush' && d <= AMBUSH_BURST_RANGE * 2) {
            chaseSpeed = predatorSpeed * 2;
          }
          moveAnimalPathfind(animal, Math.floor(targetAgent.x), Math.floor(targetAgent.y), chaseSpeed, world, species);
        }
        break;
      }

      const prey = allAnimals.find(a => a.id === decision.targetEntityId);
      if (!prey || !prey.alive) { animal.action = 'idle'; break; }

      const d = distance(animal.x, animal.y, prey.x, prey.y);
      if (d <= 1.5) {
        // Attack cooldown check
        if (animal.attackCooldown > 0) { animal.attackCooldown--; break; }
        animal.attackCooldown = ATTACK_COOLDOWN_TICKS;

        // Hit accuracy check
        const huntAccuracy = getHitAccuracy(animal.skills);
        if (Math.random() > huntAccuracy) break; // miss

        // Dodge check for prey animal
        const preyDodge = getDodgeChance(prey.skills);
        if (Math.random() < preyDodge) {
          awardXP(prey.skills, 'athletics', 1.0, 1.0);
          break; // dodged
        }

        const attackPower = getAnimalAttackPower(animal, species);
        let damage = attackPower * (0.8 + Math.random() * 0.4);

        // Back attack bonus
        if (prey.action === 'fleeing') damage *= 1.2;
        // Curl defense
        if (prey.action === 'curled') damage *= CURL_DAMAGE_MULT;
        // Pack bonus
        if (species.social === 'pack' && animal.packId) {
          const packMates = findPackMembers(animal, allAnimals, 10);
          damage *= (1 + packMates.length * 0.3);
        }

        // Apply target's defense (stat-based)
        const preySpec = getSpecies(prey.species);
        const targetDefense = getAnimalDefense(prey, preySpec);
        damage = Math.max(1, damage * (1 - targetDefense));

        prey.health = clamp(prey.health - damage, 0, prey.maxHealth);
        prey.lastAttackedBy = { type: 'animal', id: animal.id, tick: animal.age };
        awardXP(animal.skills, 'combat', 3.0, 1.0);
        // Prey gains defense XP from taking damage
        if (prey.alive) {
          const damageMod = damage / prey.maxHealth;
          awardXP(prey.skills, 'defense', 2.0, damageMod);
        }
        if (prey.health <= 0) {
          prey.alive = false;
          prey.action = 'dying';
          animal.proteinHunger = clamp(animal.proteinHunger + preySpec.foodDrop * 10, 0, 100);
        } else {
          forceFleeWithPush(prey, animal, world);
        }
      } else {
        // Speed-based pursuit: compare speeds to determine if predator can catch prey
        const predatorSpeed = getAnimalSpeed(animal, species);
        let chaseSpeed = predatorSpeed;
        if (species.specialAbility === 'ambush' && d <= AMBUSH_BURST_RANGE * 2) {
          chaseSpeed = predatorSpeed * 2;
        }
        // If prey is fleeing and faster, predator may give up
        if (prey.action === 'fleeing' && d > 2) {
          const preySpec = getSpecies(prey.species);
          const preyFleeSpeed = getAnimalSpeed(prey, preySpec) * 1.3; // flee speed multiplier
          if (chaseSpeed <= preyFleeSpeed) {
            // Can't catch — increment give-up counter using actionTimer
            animal.actionTimer = (animal.actionTimer || 0) + 1;
            if (animal.actionTimer > 30) { // give up after 3 seconds
              animal.action = 'idle';
              animal.actionTimer = 0;
              break;
            }
          } else {
            animal.actionTimer = 0; // reset give-up counter when gaining
          }
        }
        moveAnimalPathfind(animal, Math.floor(prey.x), Math.floor(prey.y), chaseSpeed, world, species);
      }
      break;
    }

    case 'fleeing': {
      if (!decision.target) break;
      const speedBonus = 1 + getSpeedBonus(animal.skills);
      let fleeSpeed = species.speed * 1.3 * speedBonus;
      if (animal.species === 'horse') fleeSpeed = species.speed * 2 * speedBonus;
      moveAnimalPathfind(animal, decision.target.x, decision.target.y, fleeSpeed, world);
      awardXP(animal.skills, 'athletics', 0.5, 1.0);

      if (species.specialAbility === 'trample') {
        handleTrample(animal, species, allAnimals);
      }
      break;
    }

    case 'fighting': {
      if (!decision.targetEntityId) break;

      // Handle agent targets
      if (decision.targetEntityId.startsWith('agent:')) {
        const agentId = decision.targetEntityId.slice(6);
        const targetAgent = agents?.find(a => a.id === agentId && a.alive);
        if (!targetAgent) { animal.action = 'idle'; break; }
        const d = distance(animal.x, animal.y, targetAgent.x, targetAgent.y);
        if (d <= 1.5) {
          // Attack cooldown check
          if (animal.attackCooldown > 0) { animal.attackCooldown--; break; }
          animal.attackCooldown = ATTACK_COOLDOWN_TICKS;

          const fightAccuracy = getHitAccuracy(animal.skills);
          if (Math.random() <= fightAccuracy) {
            // Dodge check for agent
            const dodgeChance = getDodgeChance(targetAgent.skills);
            if (Math.random() < dodgeChance) {
              awardXP(targetAgent.skills, 'athletics', 1.0);
            } else {
              const attackPower = getAnimalAttackPower(animal, species);
              let rawDamage = attackPower * (0.8 + Math.random() * 0.4);
              // Pack bonus
              if (species.social === 'pack' && animal.packId) {
                const packMates = findPackMembers(animal, allAnimals, 10);
                rawDamage *= (1 + packMates.length * 0.3);
              }
              const reduction = getDamageReduction(targetAgent.skills);
              const actualDamage = rawDamage * (1 - reduction);
              // Agent health is 0-100 scale; divide by 10 for proportional damage
              targetAgent.needs.health = clamp(targetAgent.needs.health - actualDamage / 10, 0, 100);
              awardXP(animal.skills, 'combat', 3.0, 1.0);
              // Agent gains defense XP from taking damage
              awardXP(targetAgent.skills, 'defense', 2.0, Math.min(3.0, actualDamage / 10));
              targetAgent.lastAttackedBy = { type: 'animal', id: animal.id, tick: animal.age };
              if (targetAgent.needs.health <= 0) {
                targetAgent.alive = false;
                targetAgent.action = 'dying';
                animal.proteinHunger = clamp(animal.proteinHunger + 60, 0, 100);
              }
            }
          }
        } else {
          moveAnimalPathfind(animal, Math.floor(targetAgent.x), Math.floor(targetAgent.y), getAnimalSpeed(animal, species), world);
        }
        break;
      }

      const opponent = allAnimals.find(a => a.id === decision.targetEntityId);
      if (!opponent || !opponent.alive) { animal.action = 'idle'; break; }

      const fightDist = distance(animal.x, animal.y, opponent.x, opponent.y);
      if (fightDist <= 1.5) {
        // Attack cooldown check
        if (animal.attackCooldown > 0) { animal.attackCooldown--; break; }
        animal.attackCooldown = ATTACK_COOLDOWN_TICKS;

        // Hit accuracy check
        const fightAccuracy = getHitAccuracy(animal.skills);
        if (Math.random() > fightAccuracy) break; // miss

        // Dodge check for opponent
        const opponentDodge = getDodgeChance(opponent.skills);
        if (Math.random() < opponentDodge) {
          awardXP(opponent.skills, 'athletics', 1.0, 1.0);
          break; // dodged
        }

        const attackPower = getAnimalAttackPower(animal, species);
        let damage = attackPower * (0.8 + Math.random() * 0.4);
        if (opponent.action === 'curled') damage *= CURL_DAMAGE_MULT;
        if (species.social === 'pack' && animal.packId) {
          const packMates = findPackMembers(animal, allAnimals, 10);
          damage *= (1 + packMates.length * 0.3);
        }

        // Apply target's defense (stat-based)
        const opponentSpec = getSpecies(opponent.species);
        const targetDefense = getAnimalDefense(opponent, opponentSpec);
        damage = Math.max(1, damage * (1 - targetDefense));

        opponent.health = clamp(opponent.health - damage, 0, opponent.maxHealth);
        opponent.lastAttackedBy = { type: 'animal', id: animal.id, tick: animal.age };
        awardXP(animal.skills, 'combat', 3.0, 1.0);
        // Opponent gains defense XP from taking damage
        if (opponent.alive) {
          const damageMod = damage / opponent.maxHealth;
          awardXP(opponent.skills, 'defense', 2.0, damageMod);
        }
        if (opponent.health <= 0) { opponent.alive = false; opponent.action = 'dying'; }
        if (animal.health < species.fleeThreshold * animal.maxHealth) {
          animal.action = 'fleeing';
        }
      } else {
        moveAnimalPathfind(animal, Math.floor(opponent.x), Math.floor(opponent.y), getAnimalSpeed(animal, species), world);
      }
      break;
    }

    case 'drinking': {
      if (!decision.target) break;
      const d = distance(animal.x, animal.y, decision.target.x, decision.target.y);
      if (d <= 2) {
        animal.thirst = clamp(animal.thirst + 30, 0, 100);
        rememberWater(animal, decision.target.x, decision.target.y, tickCount);
      } else {
        moveAnimalPathfind(animal, decision.target.x, decision.target.y, species.speed * (1 + getSpeedBonus(animal.skills)), world);
      }
      break;
    }

    case 'sleeping': {
      animal.stamina = clamp(animal.stamina + 0.2, 0, 100);
      if (animal.actionTimer <= 0) animal.actionTimer = 50;
      animal.actionTimer--;
      // Wake up early if critically hungry/thirsty or fully rested
      const needsProtein = species.diet !== 'herbivore';
      const needsPlants = species.diet !== 'carnivore';
      const criticalHunger = (needsProtein && animal.proteinHunger < 15) || (needsPlants && animal.plantHunger < 15);
      if (animal.actionTimer <= 0 || animal.stamina >= 95 || criticalHunger || animal.thirst < 15) {
        animal.action = 'idle';
        animal.actionTimer = 0;
      }
      break;
    }

    case 'curled': {
      if (animal.actionTimer <= 0) animal.actionTimer = CURL_DURATION;
      animal.actionTimer--;
      if (animal.actionTimer <= 0) animal.action = 'idle';
      break;
    }

    case 'breeding': {
      if (!decision.targetEntityId) break;
      const mate = allAnimals.find(a => a.id === decision.targetEntityId);
      if (!mate || !mate.alive) { animal.action = 'idle'; break; }

      const d = distance(animal.x, animal.y, mate.x, mate.y);
      if (d <= 2) {
        if (animal.actionTimer <= 0) animal.actionTimer = 30;
        animal.actionTimer--;
        if (animal.actionTimer <= 0) {
          const babies = spawnOffspring(animal, species, allAnimals);
          offspring.push(...babies);
          animal.breedCooldown = getAdjustedBreedCooldown(species, allAnimals);
          mate.breedCooldown = getAdjustedBreedCooldown(species, allAnimals);
          animal.action = 'idle';
        }
      } else {
        moveAnimalPathfind(animal, Math.floor(mate.x), Math.floor(mate.y), species.speed * (1 + getSpeedBonus(animal.skills)), world);
      }
      break;
    }

    case 'following': {
      if (!decision.target) break;
      if (distance(animal.x, animal.y, decision.target.x, decision.target.y) > 2) {
        moveAnimalPathfind(animal, decision.target.x, decision.target.y, species.speed * (1 + getSpeedBonus(animal.skills)), world);
      }
      break;
    }

    case 'guarding': {
      if (!decision.target) break;
      if (decision.targetEntityId) {
        const threat = allAnimals.find(a => a.id === decision.targetEntityId);
        if (threat && threat.alive) {
          const d = distance(animal.x, animal.y, threat.x, threat.y);
          if (d <= 1.5) {
            // Attack cooldown check
            if (animal.attackCooldown > 0) { animal.attackCooldown--; break; }
            animal.attackCooldown = ATTACK_COOLDOWN_TICKS;

            // Hit accuracy check
            const guardAccuracy = getHitAccuracy(animal.skills);
            if (Math.random() <= guardAccuracy) {
              const attackPower = getAnimalAttackPower(animal, species);
              let damage = attackPower * (0.8 + Math.random() * 0.4);
              if (threat.action === 'curled') damage *= CURL_DAMAGE_MULT;
              // Apply target defense
              const threatSpec = getSpecies(threat.species);
              const targetDefense = getAnimalDefense(threat, threatSpec);
              damage = Math.max(1, damage * (1 - targetDefense));
              threat.health = clamp(threat.health - damage, 0, threat.maxHealth);
              threat.lastAttackedBy = { type: 'animal', id: animal.id, tick: animal.age };
              if (threat.health <= 0) { threat.alive = false; threat.action = 'dying'; }
            }
          } else {
            moveAnimalPathfind(animal, Math.floor(threat.x), Math.floor(threat.y), getAnimalSpeed(animal, species), world);
          }
        }
      } else {
        if (distance(animal.x, animal.y, decision.target.x, decision.target.y) > 3) {
          moveAnimalPathfind(animal, decision.target.x, decision.target.y, getAnimalSpeed(animal, species) * 0.8, world);
        }
      }
      break;
    }

    case 'traveling': {
      if (!decision.target) break;
      moveAnimalPathfind(animal, decision.target.x, decision.target.y, species.speed * (1 + getSpeedBonus(animal.skills)), world);
      if (distance(animal.x, animal.y, decision.target.x, decision.target.y) < 2) {
        animal.action = 'idle';
      }
      break;
    }

    case 'dying':
    default:
      break;
  }

  return offspring;
}

// ============================================================
// Movement: A* Pathfinding
// ============================================================

function moveAnimalPathfind(
  animal: AnimalState,
  tx: number, ty: number,
  speed: number,
  world: World,
  species?: AnimalSpecies
): void {
  const ax = Math.floor(animal.x);
  const ay = Math.floor(animal.y);
  // Animals cannot pass through doors
  const path = findPath(world, ax, ay, Math.floor(tx), Math.floor(ty), 200, [TileType.WOOD_DOOR]);

  if (path.length > 0) {
    const next = path[0];
    const dx = next.x - animal.x;
    const dy = next.y - animal.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0) {
      const step = Math.min(speed, d);
      animal.x += (dx / d) * step;
      animal.y += (dy / d) * step;
    }
  } else if (species && (species.size === 'large' || species.size === 'medium') && animal.action === 'hunting') {
    // Large/medium predators bash adjacent structures when path is blocked
    const dirs = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
    for (const { dx, dy } of dirs) {
      const bx = ax + dx, by = ay + dy;
      const structure = world.structures.find(s => s.x === bx && s.y === by);
      if (structure) {
        const bashDamage = species.attack * 0.3;
        world.damageStructure(structure.id, bashDamage);
        break;
      }
    }
  }

  // Toggle walk animation frame every 5 ticks
  if (animal.age % 5 === 0) {
    animal.frame = animal.frame === 0 ? 1 : 0;
  }
}

// ============================================================
// Special Ability Handlers
// ============================================================

/** Passive abilities that trigger each tick regardless of action */
function handlePassiveAbilities(
  animal: AnimalState,
  species: AnimalSpecies,
  world: World,
  allAnimals: AnimalState[],
  tickCount: number
): void {
  // Egg laying (chicken, duck)
  if (species.specialAbility === 'egg_laying' && species.eggRate) {
    if (animal.plantHunger > 50 && tickCount > 0 && tickCount % species.eggRate === 0) {
      const ax = Math.floor(animal.x);
      const ay = Math.floor(animal.y);
      if (world.isWalkable(ax, ay)) {
        world.placePlant(ax, ay, PlantType.EDIBLE_FLOWER);
      }
    }
  }

  // Seed disperse (squirrel): every 200 ticks, pick up seed from nearby plant → deposit at rest location via seed bank
  if (species.specialAbility === 'seed_disperse') {
    if (tickCount > 0 && tickCount % 200 === 0) {
      const ax = Math.floor(animal.x);
      const ay = Math.floor(animal.y);
      // Check if near a tree or bush — pick up seed
      let foundSeedType: number | null = null;
      for (let dx = -1; dx <= 1 && foundSeedType === null; dx++) {
        for (let dy = -1; dy <= 1 && foundSeedType === null; dy++) {
          const tile = world.getTile(ax + dx, ay + dy);
          if (tile === TileType.TREE) foundSeedType = PlantType.MUSHROOM; // trees → forest floor seeds
          const plant = world.getPlantAt(ax + dx, ay + dy);
          if (plant) foundSeedType = plant.type;
        }
      }
      if (foundSeedType !== null) {
        // Deposit seed at a random location within 10 tiles into the soil seed bank
        const rx = ax + randomInt(-10, 10);
        const ry = ay + randomInt(-10, 10);
        if (rx >= 0 && rx < WORLD_WIDTH && ry >= 0 && ry < WORLD_HEIGHT) {
          world.addSeedToBank(rx, ry, foundSeedType as PlantType);
        }
      }
    }
    // Fallback: low chance to directly place a plant (reduced from 1% to 0.2%)
    if (Math.random() < 0.002) {
      const rx = Math.floor(animal.x) + randomInt(-5, 5);
      const ry = Math.floor(animal.y) + randomInt(-5, 5);
      if (rx >= 0 && rx < WORLD_WIDTH && ry >= 0 && ry < WORLD_HEIGHT && world.isWalkable(rx, ry)) {
        const plantTypes = [PlantType.MUSHROOM, PlantType.EDIBLE_FLOWER, PlantType.HUNGER_HERB, PlantType.BERRY_BUSH];
        const chosen = plantTypes[randomInt(0, plantTypes.length - 1)];
        world.placePlant(rx, ry, chosen);
      }
    }
  }

  // Social XP: near pack members
  if (species.social === 'pack' || species.social === 'herd' || species.social === 'flock') {
    const nearby = findNearbySpecies(animal, allAnimals, FLOCKING_RANGE);
    if (nearby.length > 0) {
      awardXP(animal.skills, 'social', 1.0, 1.0);
    }
  }

  // Steal food (fox, rat): near campfire/workbench
  if (species.specialAbility === 'steal_food') {
    const ax = Math.floor(animal.x);
    const ay = Math.floor(animal.y);
    for (let dx = -STEAL_RANGE; dx <= STEAL_RANGE; dx++) {
      for (let dy = -STEAL_RANGE; dy <= STEAL_RANGE; dy++) {
        const tx = ax + dx;
        const ty = ay + dy;
        if (tx < 0 || tx >= WORLD_WIDTH || ty < 0 || ty >= WORLD_HEIGHT) continue;
        const tile = world.getTile(tx, ty);
        if (tile === TileType.CAMPFIRE || tile === TileType.WORKBENCH) {
          if (Math.random() < 0.02) {
            // Stolen food restores both hunger types for omnivores
            if (species.diet !== 'herbivore') animal.proteinHunger = clamp(animal.proteinHunger + 10, 0, 100);
            if (species.diet !== 'carnivore') animal.plantHunger = clamp(animal.plantHunger + 10, 0, 100);
            return;
          }
        }
      }
    }
  }
}

/** Trample: cows fleeing with 3+ nearby fleeing cows damage anything in path */
function handleTrample(
  animal: AnimalState,
  species: AnimalSpecies,
  allAnimals: AnimalState[]
): void {
  let fleeingCowCount = 0;
  for (const other of allAnimals) {
    if (!other.alive || other.id === animal.id) continue;
    if (other.species !== animal.species) continue;
    if (other.action !== 'fleeing') continue;
    if (distance(animal.x, animal.y, other.x, other.y) <= TRAMPLE_RANGE) fleeingCowCount++;
  }
  if (fleeingCowCount < 3) return;

  for (const other of allAnimals) {
    if (!other.alive || other.id === animal.id) continue;
    if (other.species === animal.species) continue;
    if (distance(animal.x, animal.y, other.x, other.y) <= 1.5) {
      other.health = clamp(other.health - 10, 0, other.maxHealth);
      if (other.health <= 0) { other.alive = false; other.action = 'dying'; }
    }
  }
}

// ============================================================
// Breeding & Population Control
// ============================================================

function getAdjustedBreedCooldown(species: AnimalSpecies, allAnimals: AnimalState[]): number {
  let cooldown = species.breedCooldown;
  const isPredator = species.tier === 'apex' || species.tier === 'mid_predator';

  if (isPredator) {
    const { prey } = countByCategory(allAnimals);
    if (prey < WorldConfig.animals.lowPreyThreshold) {
      cooldown *= 2;
    } else if (prey > WorldConfig.animals.highPreyThreshold) {
      cooldown = Math.floor(cooldown / 2);
    }
  }

  return cooldown;
}

function spawnOffspring(
  parent: AnimalState,
  species: AnimalSpecies,
  allAnimals: AnimalState[]
): AnimalOffspring[] {
  const result: AnimalOffspring[] = [];
  const [minLitter, maxLitter] = species.litterSize;
  let count = randomInt(minLitter, maxLitter);

  const currentSpeciesCount = countSpecies(parent.species, allAnimals);
  const currentTotal = countTotalAlive(allAnimals);

  count = Math.min(count, species.maxPopulation - currentSpeciesCount);
  count = Math.min(count, WorldConfig.animals.maxTotal - currentTotal);
  count = Math.max(0, count);

  for (let i = 0; i < count; i++) {
    result.push({
      species: parent.species,
      x: parent.x + (Math.random() - 0.5),
      y: parent.y + (Math.random() - 0.5),
      health: species.health * 0.5,
      maxHealth: species.health,
      proteinHunger: 70,
      plantHunger: 70,
      thirst: 70,
      stamina: 70,
      breedCooldown: species.breedCooldown * 2,
      packId: parent.packId,
    });
  }

  return result;
}

// ============================================================
// Combat Helpers
// ============================================================

function forceFlee(prey: AnimalState, attacker: AnimalState): void {
  prey.action = 'fleeing';
  const fdx = prey.x - attacker.x;
  const fdy = prey.y - attacker.y;
  const flen = Math.sqrt(fdx * fdx + fdy * fdy) || 1;
  prey.target = {
    x: clamp(Math.floor(prey.x + (fdx / flen) * 10), 0, WORLD_WIDTH - 1),
    y: clamp(Math.floor(prey.y + (fdy / flen) * 10), 0, WORLD_HEIGHT - 1),
  };
}

/** Force flee with an immediate 0.5-tile push away from attacker (flee impulse) */
function forceFleeWithPush(prey: AnimalState, attacker: AnimalState, world: World): void {
  const pushDx = prey.x - attacker.x;
  const pushDy = prey.y - attacker.y;
  const pushLen = Math.sqrt(pushDx * pushDx + pushDy * pushDy) || 1;
  // Push prey 0.5 tiles away from attacker immediately
  const newX = prey.x + (pushDx / pushLen) * 0.5;
  const newY = prey.y + (pushDy / pushLen) * 0.5;
  if (newX >= 0 && newX < WORLD_WIDTH && newY >= 0 && newY < WORLD_HEIGHT &&
      world.isWalkable(Math.floor(newX), Math.floor(newY))) {
    prey.x = newX;
    prey.y = newY;
  }
  // Set flee action and target
  prey.action = 'fleeing';
  prey.target = {
    x: clamp(Math.floor(prey.x + (pushDx / pushLen) * 10), 0, WORLD_WIDTH - 1),
    y: clamp(Math.floor(prey.y + (pushDy / pushLen) * 10), 0, WORLD_HEIGHT - 1),
  };
}
