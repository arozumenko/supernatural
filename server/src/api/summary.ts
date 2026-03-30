import type {
  AgentState, AgentSummary, WorldSummary,
  NearbyEntity, NearbyResource, NearbyAgent, NearbyCorpse,
  BehaviorGenome, LifeJournal,
} from '../../shared/src/index.ts';
import { distance, TileType, getCurrentSeason } from '../../shared/src/index.ts';
import type { World } from '../World.ts';
import { getSpecies } from '../AnimalSpeciesConfig.ts';
import { getEffectiveStrength, getEffectiveToughness } from '../Progression.ts';

// ─── Agent Summary ───

export function buildAgentSummary(
  agent: AgentState,
  world: World,
  tickCount: number,
  allAgents: AgentState[]
): AgentSummary {
  const ax = Math.floor(agent.x);
  const ay = Math.floor(agent.y);
  const detectRange = 6 + (agent.skills.survival.level * 0.1);

  const genome: BehaviorGenome | undefined = (agent as any).currentGenome;
  const journal: LifeJournal | null = (agent as any).currentJournal;

  return {
    id: agent.id,
    name: agent.name,
    alive: agent.alive,
    age: agent.age,
    totalDeaths: agent.totalDeaths,
    livesRemaining: agent.livesRemaining ?? 100,

    position: { x: ax, y: ay },
    currentAction: agent.action,
    actionReason: agent.lastDecisionReason ?? agent.action,
    biome: describeBiome(world, ax, ay),

    needs: { ...agent.needs },
    urgentNeeds: findUrgentNeeds(agent.needs, 30),

    resources: filterNonZero(agent.resources as any),
    equipment: {
      mainHand: agent.inventory.equipped.mainHand?.itemId ?? null,
      body: agent.inventory.equipped.body?.itemId ?? null,
      accessory: agent.inventory.equipped.accessory?.itemId ?? null,
    },
    carryWeight: agent.carryWeight ?? 0,
    carryCapacity: agent.carryCapacity ?? 100,

    skills: extractSkillLevels(agent),
    personality: agent.personality,
    obedience: agent.obedience,
    socialScore: agent.socialScore,

    currentPlan: agent.currentPlanGoal ? {
      goal: agent.currentPlanGoal,
      steps: (agent.currentPlanSteps ?? []).map(s => s.actionName),
      currentStep: agent.planStepIndex ?? 0,
    } : null,

    nearby: scanNearby(agent, world, allAgents, detectRange),

    genome: genome ? {
      version: genome.version,
      generation: genome.generation,
      activeStrategyRules: genome.strategyRules.filter(r => r.enabled).map(r => r.name),
      fitnessScore: genome.fitnessScore,
    } : { version: 1, generation: 0, activeStrategyRules: [], fitnessScore: 50 },

    currentLifeTicks: agent.currentLifeTicks ?? 0,
    lifetimeBestSurvival: agent.lifetimeBestSurvival ?? 0,
    isHighlander: agent.isHighlander ?? false,

    recentEvents: (journal?.events ?? []).slice(-10).map(e => ({
      tick: e.tick,
      type: e.type,
      details: e.details,
    })),

    pendingMessages: agent.messageQueue.length,
    lastMessageFollowed: agent.lastMessage?.followed ?? null,

    serverTick: tickCount,
    serverTime: new Date().toISOString(),
  };
}

// ─── World Summary ───

export function buildWorldSummary(
  agents: AgentState[],
  world: World,
  tickCount: number
): WorldSummary {
  const aliveAgents = agents.filter(a => a.alive);
  const deadAgents = agents.filter(a => !a.alive);

  // Animal population by species
  const animalCounts: Record<string, number> = {};
  for (const animal of world.animals) {
    if (animal.alive) {
      animalCounts[animal.species] = (animalCounts[animal.species] ?? 0) + 1;
    }
  }

  // Tree density (trees per 100 tiles)
  const totalTiles = world.tiles.length * (world.tiles[0]?.length ?? 0);
  const treeCount = world.trees.filter(t => !t.isStump).length;
  const treeDensity = totalTiles > 0 ? (treeCount / totalTiles) * 100 : 0;

  // Iron deposits
  const ironCount = world.countIronTiles();

  // Highlander
  const highlander = agents.find(a => a.isHighlander && a.alive);

  return {
    tick: tickCount,
    season: getCurrentSeason(tickCount),
    population: {
      agents: {
        alive: aliveAgents.length,
        dead: deadAgents.length,
        total: agents.length,
      },
      animals: animalCounts,
    },
    resources: {
      ironDepositsRemaining: ironCount,
      averageTreeDensity: Math.round(treeDensity * 100) / 100,
    },
    recentEvents: [], // Could be populated from a world event log if maintained
    highlander: highlander ? { id: highlander.id, name: highlander.name } : null,
  };
}

// ─── Nearby Scan ───

function scanNearby(
  agent: AgentState,
  world: World,
  allAgents: AgentState[],
  detectRange: number
): { threats: NearbyEntity[]; resources: NearbyResource[]; agents: NearbyAgent[]; corpses: NearbyCorpse[] } {
  const ax = Math.floor(agent.x);
  const ay = Math.floor(agent.y);
  const threats: NearbyEntity[] = [];
  const resources: NearbyResource[] = [];
  const nearbyAgents: NearbyAgent[] = [];
  const corpses: NearbyCorpse[] = [];

  const myDefense = getEffectiveToughness(agent.baseStats, agent.skills);

  // Threats: dangerous animals
  for (const animal of world.animals) {
    if (!animal.alive) continue;
    const d = distance(ax, ay, animal.x, animal.y);
    if (d > detectRange) continue;

    const species = getSpecies(animal.species);
    if (!species) continue;
    const dangerRatio = species.attack / Math.max(1, myDefense);

    if (dangerRatio > 0.3) {
      let dangerLevel: 'low' | 'medium' | 'high' | 'extreme' = 'low';
      if (dangerRatio > 2.0) dangerLevel = 'extreme';
      else if (dangerRatio > 1.0) dangerLevel = 'high';
      else if (dangerRatio > 0.5) dangerLevel = 'medium';

      threats.push({
        type: animal.species,
        distance: Math.round(d * 10) / 10,
        direction: getDirection(animal.x - ax, animal.y - ay),
        dangerLevel,
      });
    }
  }
  threats.sort((a, b) => a.distance - b.distance);
  threats.length = Math.min(threats.length, 5);

  // Resources: trees, rocks, plants, water, iron
  for (const tree of world.trees) {
    if (tree.isStump) continue;
    const d = distance(ax, ay, tree.x, tree.y);
    if (d <= detectRange) {
      resources.push({ type: 'tree', distance: Math.round(d * 10) / 10, direction: getDirection(tree.x - ax, tree.y - ay), quantity: tree.health });
    }
  }
  for (const rock of world.rocks) {
    if (rock.isRubble) continue;
    const d = distance(ax, ay, rock.x, rock.y);
    if (d <= detectRange) {
      resources.push({ type: 'rock', distance: Math.round(d * 10) / 10, direction: getDirection(rock.x - ax, rock.y - ay), quantity: rock.health });
    }
  }
  for (const plant of world.plants) {
    if (plant.health <= 0) continue;
    const d = distance(ax, ay, plant.x, plant.y);
    if (d <= detectRange) {
      resources.push({ type: 'plant', distance: Math.round(d * 10) / 10, direction: getDirection(plant.x - ax, plant.y - ay) });
    }
  }
  // Water tiles (check within range using findNearest)
  const water = world.findNearest(ax, ay, TileType.WATER, detectRange);
  if (water) {
    resources.push({ type: 'water', distance: Math.round(distance(ax, ay, water.x, water.y) * 10) / 10, direction: getDirection(water.x - ax, water.y - ay) });
  }
  resources.sort((a, b) => a.distance - b.distance);
  resources.length = Math.min(resources.length, 8);

  // Nearby agents
  for (const other of allAgents) {
    if (other.id === agent.id || !other.alive) continue;
    const d = distance(ax, ay, other.x, other.y);
    if (d <= detectRange) {
      nearbyAgents.push({
        id: other.id,
        name: other.name,
        distance: Math.round(d * 10) / 10,
        direction: getDirection(other.x - ax, other.y - ay),
        relationship: agent.relationships[other.id] ?? 0,
        alive: other.alive,
      });
    }
  }
  nearbyAgents.sort((a, b) => a.distance - b.distance);
  nearbyAgents.length = Math.min(nearbyAgents.length, 5);

  // Corpses
  for (const corpse of world.corpses) {
    const d = distance(ax, ay, corpse.x, corpse.y);
    if (d <= detectRange) {
      corpses.push({
        species: corpse.sourceSpecies ?? corpse.sourceName ?? 'unknown',
        distance: Math.round(d * 10) / 10,
        direction: getDirection(corpse.x - ax, corpse.y - ay),
        ticksRemaining: Math.max(0, corpse.decayAt - Date.now()),
      });
    }
  }
  corpses.sort((a, b) => a.distance - b.distance);
  corpses.length = Math.min(corpses.length, 3);

  return { threats, resources, agents: nearbyAgents, corpses };
}

// ─── Helpers ───

function describeBiome(world: World, x: number, y: number): string {
  const tile = world.getTile(x, y);
  if (tile === TileType.SAND) return 'beach';
  if (tile === TileType.DIRT) return 'dirt';
  if (tile === TileType.WATER) return 'water';

  // Check for nearby water (within 3 tiles)
  let hasWater = false;
  let treeCount = 0;
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      const t = world.getTile(x + dx, y + dy);
      if (t === TileType.WATER) hasWater = true;
      if (t === TileType.TREE) treeCount++;
    }
  }
  if (treeCount > 5) return 'forest';
  if (hasWater) return 'near_water';
  return 'grassland';
}

function getDirection(dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return 'here';
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle > -22.5 && angle <= 22.5) return 'east';
  if (angle > 22.5 && angle <= 67.5) return 'southeast';
  if (angle > 67.5 && angle <= 112.5) return 'south';
  if (angle > 112.5 && angle <= 157.5) return 'southwest';
  if (angle > 157.5 || angle <= -157.5) return 'west';
  if (angle > -157.5 && angle <= -112.5) return 'northwest';
  if (angle > -112.5 && angle <= -67.5) return 'north';
  return 'northeast';
}

function findUrgentNeeds(needs: any, threshold: number): string[] {
  const urgent: string[] = [];
  for (const [key, val] of Object.entries(needs)) {
    if (typeof val === 'number' && val < threshold) {
      urgent.push(key);
    }
  }
  return urgent;
}

function filterNonZero(resources: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(resources)) {
    if (typeof val === 'number' && val > 0) {
      result[key] = val;
    }
  }
  return result;
}

function extractSkillLevels(agent: AgentState): Record<string, number> {
  const levels: Record<string, number> = {};
  for (const [name, skill] of Object.entries(agent.skills)) {
    levels[name] = (skill as any).level;
  }
  return levels;
}
