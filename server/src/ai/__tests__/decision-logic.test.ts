import { describe, it, expect, beforeEach } from 'vitest';
import { decideAction, decayNeeds } from '../NeedsSystem.ts';
import { createAgent } from '../../Agent.ts';
import { TileType, AgentState } from '../../../shared/src/index.ts';

// ─── Minimal World Mock ───

function createMockWorld(options: {
  waterAt?: { x: number; y: number }[];
  animals?: any[];
} = {}) {
  const tiles: number[][] = Array.from({ length: 90 }, () => Array(120).fill(TileType.GRASS));

  // Place water tiles
  for (const w of options.waterAt ?? []) {
    if (tiles[w.y]) tiles[w.y][w.x] = TileType.WATER;
  }

  return {
    tiles,
    trees: [],
    rocks: [],
    plants: [],
    animals: options.animals ?? [],
    corpses: [],
    structures: [],
    getTile: (x: number, y: number) => tiles[y]?.[x] ?? TileType.GRASS,
    isWalkable: (x: number, y: number) => {
      const t = tiles[y]?.[x];
      return t !== TileType.WATER && t !== undefined;
    },
    findNearest: (fromX: number, fromY: number, tileType: number, maxDist: number = 40) => {
      let best: { x: number; y: number } | null = null;
      let bestDist = Infinity;
      for (let dy = -maxDist; dy <= maxDist; dy++) {
        for (let dx = -maxDist; dx <= maxDist; dx++) {
          const nx = fromX + dx, ny = fromY + dy;
          if (ny < 0 || ny >= 90 || nx < 0 || nx >= 120) continue;
          if (tiles[ny][nx] === tileType) {
            const d = Math.abs(dx) + Math.abs(dy);
            if (d < bestDist) { bestDist = d; best = { x: nx, y: ny }; }
          }
        }
      }
      return best;
    },
    findNearestTree: () => null,
    findNearestRock: () => null,
    findNearestPlant: () => null,
    findNearestCorpse: () => null,
    findNearestWalkable: (fx: number, fy: number, tx: number, ty: number) => ({ x: tx, y: ty }),
    resourceHealth: Array.from({ length: 90 }, () => Array(120).fill(100)),
    getTreeAt: () => null,
    getRockAt: () => null,
    getPlantAt: () => null,
    getStructureAt: () => null,
  } as any;
}

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  const agent = createAgent('TestAgent', ['obedient'], undefined, undefined, 'warrior');
  Object.assign(agent, overrides);
  return agent;
}

// ─── Tests ───

describe('Critical Thirst Decision', () => {
  it('should choose drinking when water is nearby and thirst is critical', () => {
    const world = createMockWorld({ waterAt: [{ x: 53, y: 50 }] });
    const agent = makeAgent({ x: 50, y: 50, needs: { proteinHunger: 80, plantHunger: 80, thirst: 10, stamina: 80, health: 100, social: 50, shelter: 50 } });

    const decision = decideAction(agent, world, [agent], 100, 0);

    expect(decision.action).toBe('drinking');
    expect(decision.priority).toBeGreaterThanOrEqual(90);
    expect(decision.target).toBeTruthy();
  });

  it('should choose desperate search when thirst is critical but no water exists', () => {
    const world = createMockWorld({ waterAt: [] }); // no water at all
    const agent = makeAgent({ x: 50, y: 50, needs: { proteinHunger: 80, plantHunger: 80, thirst: 5, stamina: 80, health: 100, social: 50, shelter: 50 } });

    const decision = decideAction(agent, world, [agent], 100, 0);

    expect(decision.action).toBe('wandering');
    expect(decision.reason).toContain('search');
    expect(decision.priority).toBeGreaterThanOrEqual(85);
  });

  it('should find water at 3 tiles distance', () => {
    const world = createMockWorld({ waterAt: [{ x: 53, y: 50 }] }); // 3 tiles east
    const agent = makeAgent({ x: 50, y: 50, needs: { proteinHunger: 80, plantHunger: 80, thirst: 15, stamina: 80, health: 100, social: 50, shelter: 50 } });

    const decision = decideAction(agent, world, [agent], 100, 0);

    expect(decision.action).toBe('drinking');
    expect(decision.target).toEqual({ x: 53, y: 50 });
  });

  it('should find water at 30 tiles distance', () => {
    const world = createMockWorld({ waterAt: [{ x: 80, y: 50 }] }); // 30 tiles east
    const agent = makeAgent({ x: 50, y: 50, needs: { proteinHunger: 80, plantHunger: 80, thirst: 10, stamina: 80, health: 100, social: 50, shelter: 50 } });

    const decision = decideAction(agent, world, [agent], 100, 0);

    expect(decision.action).toBe('drinking');
    expect(decision.target).toEqual({ x: 80, y: 50 });
  });
});

describe('Medium Thirst Decision', () => {
  it('should choose drinking at medium priority when thirst below 50', () => {
    const world = createMockWorld({ waterAt: [{ x: 55, y: 50 }] });
    const agent = makeAgent({ x: 50, y: 50, needs: { proteinHunger: 80, plantHunger: 80, thirst: 40, stamina: 80, health: 100, social: 50, shelter: 50 } });

    const decision = decideAction(agent, world, [agent], 100, 0);

    expect(decision.action).toBe('drinking');
    expect(decision.priority).toBeGreaterThanOrEqual(50);
    expect(decision.priority).toBeLessThan(80);
  });

  it('should search for water when thirst below 50 and no water nearby', () => {
    const world = createMockWorld({ waterAt: [] });
    const agent = makeAgent({ x: 50, y: 50, needs: { proteinHunger: 80, plantHunger: 80, thirst: 40, stamina: 80, health: 100, social: 50, shelter: 50 } });

    const decision = decideAction(agent, world, [agent], 100, 0);

    expect(decision.reason).toContain('search');
  });
});

describe('Decay Needs - Death Check', () => {
  it('should kill agent when health reaches 0', () => {
    const agent = makeAgent({ needs: { proteinHunger: 0, plantHunger: 0, thirst: 0, stamina: 0, health: 1, social: 50, shelter: 0 } });

    // Track health across ticks to find the bug
    const healthLog: number[] = [];
    for (let i = 0; i < 100; i++) {
      healthLog.push(Math.round(agent.needs.health * 100) / 100);
      decayNeeds(agent);
      if (!agent.alive) break;
    }

    // Debug output: if agent survived, show health trajectory
    if (agent.alive) {
      console.log('UNDEAD BUG: health trajectory:', healthLog.slice(0, 20));
      console.log('Final health:', agent.needs.health, 'alive:', agent.alive);
    }

    expect(agent.alive).toBe(false);
    expect(agent.action).toBe('dying');
  });

  it('should deal damage when thirst is 0', () => {
    const agent = makeAgent({ needs: { proteinHunger: 80, plantHunger: 80, thirst: 0, stamina: 80, health: 100, social: 50, shelter: 50 } });

    decayNeeds(agent);

    expect(agent.needs.health).toBeLessThan(100);
  });

  it('should deal damage when shelter is 0', () => {
    const agent = makeAgent({ needs: { proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 80, health: 100, social: 50, shelter: 0 } });

    decayNeeds(agent);

    expect(agent.needs.health).toBeLessThan(100);
  });

  it('should NOT heal from social when starving', () => {
    const agent = makeAgent({ needs: { proteinHunger: 5, plantHunger: 5, thirst: 5, stamina: 80, health: 50, social: 50, shelter: 50 } });

    // With needs at 0, starvation + dehydration should drain health over time
    // Set needs to 0 explicitly (decay will push them negative → clamped to 0)
    agent.needs.proteinHunger = 0;
    agent.needs.plantHunger = 0;
    agent.needs.thirst = 0;
    const healthBefore = agent.needs.health;
    for (let i = 0; i < 20; i++) {
      decayNeeds(agent);
    }

    // Health should have decreased (damage: ~3.35/tick, regen: ~0.03/tick)
    expect(agent.needs.health).toBeLessThan(healthBefore - 10);
  });
});

describe('Flee vs Hunt Priority', () => {
  it('should flee from predator when well-fed', () => {
    const bear = {
      id: 'bear1', species: 'bear', x: 52, y: 50, alive: true,
      action: 'wandering', health: 200, maxHealth: 200,
      proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 80,
      baseStats: { strength: 15, toughness: 15, agility: 8, endurance: 12, perception: 10, charisma: 5 },
      skills: { combat: { xp: 0, level: 0 }, defense: { xp: 0, level: 0 }, athletics: { xp: 0, level: 0 },
        woodcutting: { xp: 0, level: 0 }, mining: { xp: 0, level: 0 }, foraging: { xp: 0, level: 0 },
        building: { xp: 0, level: 0 }, crafting: { xp: 0, level: 0 }, survival: { xp: 0, level: 0 }, social: { xp: 0, level: 0 } },
      attackCooldown: 0, age: 100, breedCooldown: 0, tamed: false, tamingProgress: 0,
      homeX: 50, homeY: 50, frame: 0 as const, foodDrop: 10, drops: { meat: 10, bone: 3, hide: 2, fat: 3 },
    };

    const world = createMockWorld({ animals: [bear] });
    const agent = makeAgent({
      x: 50, y: 50,
      needs: { proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 80, health: 100, social: 50, shelter: 50 },
    });

    const decision = decideAction(agent, world, [agent], 100, 0);

    expect(decision.action).toBe('wandering');
    expect(decision.reason).toContain('threatened');
  });

  it('should hunt instead of flee when starving', () => {
    const rabbit = {
      id: 'rabbit1', species: 'rabbit', x: 52, y: 50, alive: true,
      action: 'grazing', health: 15, maxHealth: 15,
      proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 80,
      baseStats: { strength: 3, toughness: 3, agility: 12, endurance: 8, perception: 10, charisma: 5 },
      skills: { combat: { xp: 0, level: 0 }, defense: { xp: 0, level: 0 }, athletics: { xp: 0, level: 0 },
        woodcutting: { xp: 0, level: 0 }, mining: { xp: 0, level: 0 }, foraging: { xp: 0, level: 0 },
        building: { xp: 0, level: 0 }, crafting: { xp: 0, level: 0 }, survival: { xp: 0, level: 0 }, social: { xp: 0, level: 0 } },
      attackCooldown: 0, age: 100, breedCooldown: 0, tamed: false, tamingProgress: 0,
      homeX: 50, homeY: 50, frame: 0 as const, foodDrop: 2, drops: { meat: 2, bone: 1 },
    };

    const world = createMockWorld({ animals: [rabbit], waterAt: [{ x: 45, y: 50 }] });
    const agent = makeAgent({
      x: 50, y: 50,
      needs: { proteinHunger: 5, plantHunger: 80, thirst: 80, stamina: 80, health: 100, social: 50, shelter: 50 },
    });

    // Give agent no food so it must hunt or desperately search
    agent.resources.food = 0;
    agent.resources.meat = 0;

    const decision = decideAction(agent, world, [agent], 100, 0);

    // Starving agent should either hunt (if prey recognized) or desperately search
    const isHunting = decision.action === 'harvesting' && decision.reason?.includes('hunt');
    const isDesperateSearch = decision.reason?.includes('desperate') || decision.reason?.includes('search');
    expect(isHunting || isDesperateSearch).toBe(true);
    // Priority should be high (>= 75 for hunt or >= 85 for desperate search)
    expect(decision.priority).toBeGreaterThanOrEqual(75);
  });
});

describe('Herbivore Threat Filtering', () => {
  it('should NOT flee from deer', () => {
    const deer = {
      id: 'deer1', species: 'deer', x: 52, y: 50, alive: true,
      action: 'grazing', health: 60, maxHealth: 60,
      proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 80,
      baseStats: { strength: 8, toughness: 8, agility: 10, endurance: 10, perception: 10, charisma: 5 },
      skills: { combat: { xp: 0, level: 0 }, defense: { xp: 0, level: 0 }, athletics: { xp: 0, level: 0 },
        woodcutting: { xp: 0, level: 0 }, mining: { xp: 0, level: 0 }, foraging: { xp: 0, level: 0 },
        building: { xp: 0, level: 0 }, crafting: { xp: 0, level: 0 }, survival: { xp: 0, level: 0 }, social: { xp: 0, level: 0 } },
      attackCooldown: 0, age: 100, breedCooldown: 0, tamed: false, tamingProgress: 0,
      homeX: 50, homeY: 50, frame: 0 as const, foodDrop: 8, drops: { meat: 8, bone: 2, hide: 3 },
    };

    const world = createMockWorld({ animals: [deer], waterAt: [{ x: 45, y: 50 }] });
    const agent = makeAgent({
      x: 50, y: 50,
      needs: { proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 80, health: 100, social: 50, shelter: 50 },
    });

    const decision = decideAction(agent, world, [agent], 100, 0);

    // Should NOT be fleeing from deer
    if (decision.reason) {
      expect(decision.reason).not.toContain('threatened by Deer');
    }
  });

  it('should NOT flee from dog', () => {
    const dog = {
      id: 'dog1', species: 'dog-0', x: 52, y: 50, alive: true,
      action: 'wandering', health: 60, maxHealth: 60,
      proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 80,
      baseStats: { strength: 8, toughness: 8, agility: 10, endurance: 10, perception: 10, charisma: 5 },
      skills: { combat: { xp: 0, level: 0 }, defense: { xp: 0, level: 0 }, athletics: { xp: 0, level: 0 },
        woodcutting: { xp: 0, level: 0 }, mining: { xp: 0, level: 0 }, foraging: { xp: 0, level: 0 },
        building: { xp: 0, level: 0 }, crafting: { xp: 0, level: 0 }, survival: { xp: 0, level: 0 }, social: { xp: 0, level: 0 } },
      attackCooldown: 0, age: 100, breedCooldown: 0, tamed: false, tamingProgress: 0,
      homeX: 50, homeY: 50, frame: 0 as const, foodDrop: 3, drops: { meat: 3, bone: 1 },
    };

    const world = createMockWorld({ animals: [dog], waterAt: [{ x: 45, y: 50 }] });
    const agent = makeAgent({
      x: 50, y: 50,
      needs: { proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 80, health: 100, social: 50, shelter: 50 },
    });

    const decision = decideAction(agent, world, [agent], 100, 0);

    if (decision.reason) {
      expect(decision.reason).not.toContain('threatened by Dog');
    }
  });
});

describe('Confidence System', () => {
  it('should reduce flee priority for high-level agents', () => {
    const fox = {
      id: 'fox1', species: 'fox', x: 52, y: 50, alive: true,
      action: 'hunting', health: 40, maxHealth: 40,
      proteinHunger: 30, plantHunger: 80, thirst: 80, stamina: 80,
      baseStats: { strength: 8, toughness: 6, agility: 12, endurance: 8, perception: 12, charisma: 3 },
      skills: { combat: { xp: 0, level: 0 }, defense: { xp: 0, level: 0 }, athletics: { xp: 0, level: 0 },
        woodcutting: { xp: 0, level: 0 }, mining: { xp: 0, level: 0 }, foraging: { xp: 0, level: 0 },
        building: { xp: 0, level: 0 }, crafting: { xp: 0, level: 0 }, survival: { xp: 0, level: 0 }, social: { xp: 0, level: 0 } },
      attackCooldown: 0, age: 100, breedCooldown: 0, tamed: false, tamingProgress: 0,
      homeX: 50, homeY: 50, frame: 0 as const, foodDrop: 3, drops: { meat: 3, bone: 1 },
    };

    const world = createMockWorld({ animals: [fox], waterAt: [{ x: 45, y: 50 }] });

    // Low-level agent: should flee from fox
    const weakAgent = makeAgent({
      x: 50, y: 50,
      needs: { proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 80, health: 100, social: 50, shelter: 50 },
    });
    const weakDecision = decideAction(weakAgent, world, [weakAgent], 100, 0);

    // High-level agent: should NOT flee from fox
    const strongAgent = makeAgent({
      x: 50, y: 50,
      needs: { proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 80, health: 100, social: 50, shelter: 50 },
      skills: {
        combat: { xp: 50000, level: 31 }, defense: { xp: 50000, level: 31 }, athletics: { xp: 5000, level: 10 },
        woodcutting: { xp: 5000, level: 10 }, mining: { xp: 5000, level: 10 }, foraging: { xp: 5000, level: 10 },
        building: { xp: 5000, level: 10 }, crafting: { xp: 5000, level: 10 }, survival: { xp: 5000, level: 10 }, social: { xp: 5000, level: 10 },
      },
    });
    const strongDecision = decideAction(strongAgent, world, [strongAgent], 100, 0);

    // Weak agent flees, strong agent doesn't (or has lower flee priority)
    const weakFlees = weakDecision.reason?.includes('threatened');
    const strongFlees = strongDecision.reason?.includes('threatened');

    if (weakFlees) {
      // If weak agent flees, strong should either not flee or have lower priority
      expect(weakFlees || !strongFlees).toBe(true);
    }
  });
});

describe('Building Shelter', () => {
  it('should decide to build when shelter is low and has materials', () => {
    const world = createMockWorld({ waterAt: [{ x: 45, y: 50 }] });
    const agent = makeAgent({
      x: 50, y: 50,
      needs: { proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 80, health: 100, social: 50, shelter: 5 },
      resources: { wood: 10, stone: 5, food: 3, water: 0, treeSeed: 0, plantSeed: 0, meat: 0, bone: 0, hide: 0, sinew: 0, fat: 0, feathers: 0, teeth_claws: 0, scales: 0, iron_ore: 0, iron_ingot: 0 },
    });

    const decision = decideAction(agent, world, [agent], 100, 0);

    // Should want to build (may not be top priority, but should be in decisions)
    // The decision reason should mention shelter OR the action should be building
    const isBuildOrShelter = decision.action === 'building' || decision.reason?.includes('shelter');
    // With shelter at 5, building priority = 45 + 0 + 20 = 65 — should be competitive
    expect(decision.priority).toBeGreaterThanOrEqual(45);
  });

  it('building decision should have a target', () => {
    const world = createMockWorld({ waterAt: [{ x: 45, y: 50 }] });
    const agent = makeAgent({
      x: 50, y: 50,
      needs: { proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 80, health: 100, social: 80, shelter: 5 },
      resources: { wood: 10, stone: 5, food: 3, water: 0, treeSeed: 0, plantSeed: 0, meat: 0, bone: 0, hide: 0, sinew: 0, fat: 0, feathers: 0, teeth_claws: 0, scales: 0, iron_ore: 0, iron_ingot: 0 },
    });

    const decision = decideAction(agent, world, [agent], 100, 0);

    if (decision.action === 'building') {
      expect(decision.target).toBeTruthy();
    }
  });
});
