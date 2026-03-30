import {
  AgentState, AgentNeeds, Resources, PersonalityTrait, TileType,
  generateId, randomName, randomInt, clamp, WORLD_WIDTH, WORLD_HEIGHT,
  AgentArchetype, AGENT_ARCHETYPES,
} from '../shared/src/index.ts';
import type { World } from './World.ts';
import { WorldConfig } from './WorldConfig.ts';
import { createSkillSet, createAgentBaseStats } from './Progression.ts';
import { createDefaultGenome } from './ai/BehaviorGenome.ts';

export function createAgent(
  name?: string,
  personality?: PersonalityTrait[],
  ownerId?: string,
  world?: World,
  archetype?: AgentArchetype
): AgentState {
  const traits: PersonalityTrait[] = personality ?? pickRandomTraits();

  // Personality affects obedience
  const isObedient = traits.includes('obedient');

  const needs: AgentNeeds = {
    proteinHunger: randomInt(60, 90),
    plantHunger: randomInt(60, 90),
    thirst: randomInt(60, 90),
    stamina: randomInt(70, 100),
    health: 100,
    social: randomInt(40, 70),
    shelter: randomInt(10, 30),
  };

  const baseStats = createAgentBaseStats();

  // Resolve archetype: 'random' picks one of the real archetypes
  let resolvedArchetype = archetype ?? 'random';
  if (resolvedArchetype === 'random') {
    const realArchetypes: AgentArchetype[] = ['warrior', 'survivor', 'builder', 'scout', 'social'];
    resolvedArchetype = realArchetypes[randomInt(0, realArchetypes.length - 1)];
  }

  // Apply archetype stat overrides
  const arch = AGENT_ARCHETYPES[resolvedArchetype];
  if (arch) {
    for (const [stat, val] of Object.entries(arch.stats)) {
      (baseStats as any)[stat] = val;
    }
  }

  const skills = createSkillSet();

  const resources: Resources = {
    wood: randomInt(0, 3),
    stone: randomInt(0, 2),
    food: randomInt(1, 5),
    water: 0,
    treeSeed: 0,
    plantSeed: 0,
    meat: 0,
    bone: 0,
    hide: 0,
    sinew: 0,
    fat: 0,
    feathers: 0,
    teeth_claws: 0,
    scales: 0,
    iron_ore: 0,
    iron_ingot: 0,
  };

  // Spawn on a random grass tile
  let spawnX = Math.floor(WORLD_WIDTH / 2);
  let spawnY = Math.floor(WORLD_HEIGHT / 2);
  if (world) {
    for (let attempt = 0; attempt < WorldConfig.agents.spawnMaxAttempts; attempt++) {
      const rx = randomInt(0, WORLD_WIDTH - 1);
      const ry = randomInt(0, WORLD_HEIGHT - 1);
      if (world.getTile(rx, ry) === TileType.GRASS && world.isWalkable(rx, ry)) {
        spawnX = rx;
        spawnY = ry;
        break;
      }
    }
  }

  const agent: AgentState = {
    id: generateId(),
    name: name ?? randomName(),
    x: spawnX,
    y: spawnY,
    needs,
    resources,
    inventory: { items: [], equipped: {} },
    action: 'idle',
    personality: traits,
    baseStats,
    skills,
    totalDeaths: 0,
    socialScore: 0,
    relationships: {},
    attackCooldown: 0,
    ownerId,
    alive: true,
    age: 0,
    messageQueue: [],
    obedience: isObedient ? randomInt(70, 95) : randomInt(20, 60),
    // Evolution system
    livesRemaining: 100,
    genomeVersion: 1,
    activeStrategyRuleNames: [],
    currentLifeTicks: 0,
    lifetimeBestSurvival: 0,
    isHighlander: false,
    achievements: [],
    llmProviderId: null,
    llmRole: 'none',
  };

  // Attach non-wire fields (not sent to client via world:update)
  const genome = createDefaultGenome();
  // Apply archetype genome overrides
  if (arch?.genomeOverrides) {
    for (const [path, val] of Object.entries(arch.genomeOverrides)) {
      const parts = path.split('.');
      let obj: any = genome;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = val;
    }
  }
  (agent as any).currentGenome = genome;
  (agent as any).journalArchive = [];
  (agent as any).currentJournal = null;

  return agent;
}

function pickRandomTraits(): PersonalityTrait[] {
  const all: PersonalityTrait[] = ['obedient', 'independent', 'social', 'loner', 'industrious', 'lazy'];
  const count = randomInt(1, 3);
  const shuffled = [...all].sort(() => Math.random() - 0.5);

  // Avoid contradictory traits
  const picked: PersonalityTrait[] = [];
  const conflicts: Record<string, string> = {
    'obedient': 'independent',
    'independent': 'obedient',
    'social': 'loner',
    'loner': 'social',
    'industrious': 'lazy',
    'lazy': 'industrious',
  };

  for (const trait of shuffled) {
    if (picked.length >= count) break;
    if (!picked.some(p => conflicts[p] === trait)) {
      picked.push(trait);
    }
  }
  return picked;
}
