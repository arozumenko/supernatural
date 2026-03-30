/**
 * Comprehensive instinct coverage tests.
 * Verifies that EVERY survival instinct triggers under the right conditions,
 * even with mutated genomes.
 */
import { describe, it, expect } from 'vitest';
import { decideAction } from '../NeedsSystem.ts';
import { createAgent } from '../../Agent.ts';
import { TileType, AgentState } from '../../../shared/src/index.ts';
import { createDefaultGenome } from '../BehaviorGenome.ts';

function createMockWorld(options: { waterAt?: { x: number; y: number }[]; animals?: any[] } = {}) {
  const tiles: number[][] = Array.from({ length: 90 }, () => Array(120).fill(TileType.GRASS));
  for (const w of options.waterAt ?? []) { if (tiles[w.y]) tiles[w.y][w.x] = TileType.WATER; }
  return {
    tiles, trees: [], rocks: [], plants: [], animals: options.animals ?? [],
    corpses: [], structures: [],
    getTile: (x: number, y: number) => tiles[y]?.[x] ?? TileType.GRASS,
    isWalkable: (x: number, y: number) => tiles[y]?.[x] !== TileType.WATER,
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
    findNearestTree: () => null, findNearestRock: () => null,
    findNearestPlant: () => null, findNearestCorpse: () => null,
    findNearestWalkable: (fx: number, fy: number, tx: number, ty: number) => ({ x: tx, y: ty }),
    resourceHealth: Array.from({ length: 90 }, () => Array(120).fill(100)),
    getTreeAt: () => null, getRockAt: () => null, getPlantAt: () => null, getStructureAt: () => null,
  } as any;
}

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  const agent = createAgent('Test', ['obedient'], undefined, undefined, 'warrior');
  Object.assign(agent, overrides);
  return agent;
}

// === CRITICAL THIRST ===
describe('Instinct: Critical Thirst', () => {
  it('triggers at thirst=0 with default genome', () => {
    const world = createMockWorld({ waterAt: [{ x: 55, y: 50 }] });
    const agent = makeAgent({ x: 50, y: 50, needs: { proteinHunger: 80, plantHunger: 80, thirst: 0, stamina: 80, health: 100, social: 50, shelter: 50 } });
    const d = decideAction(agent, world, [agent], 100, 0);
    expect(d.action).toBe('drinking');
    expect(d.priority).toBeGreaterThanOrEqual(90);
  });

  it('triggers at thirst=10 with default genome', () => {
    const world = createMockWorld({ waterAt: [{ x: 55, y: 50 }] });
    const agent = makeAgent({ x: 50, y: 50, needs: { proteinHunger: 80, plantHunger: 80, thirst: 10, stamina: 80, health: 100, social: 50, shelter: 50 } });
    const d = decideAction(agent, world, [agent], 100, 0);
    expect(d.action).toBe('drinking');
    expect(d.priority).toBeGreaterThanOrEqual(90);
  });

  it('triggers even with mutated genome (threshold lowered to minimum)', () => {
    const world = createMockWorld({ waterAt: [{ x: 55, y: 50 }] });
    const agent = makeAgent({ x: 50, y: 50, needs: { proteinHunger: 80, plantHunger: 80, thirst: 5, stamina: 80, health: 100, social: 50, shelter: 50 } });
    // Mutate genome to minimum threshold
    const genome = createDefaultGenome();
    genome.thresholds.criticalThirst = 15; // minimum bound
    (agent as any).currentGenome = genome;
    const d = decideAction(agent, world, [agent], 100, 0);
    expect(d.action).toBe('drinking');
    expect(d.priority).toBeGreaterThanOrEqual(90);
  });

  it('desperate search when no water at thirst=0', () => {
    const world = createMockWorld();
    const agent = makeAgent({ x: 50, y: 50, needs: { proteinHunger: 80, plantHunger: 80, thirst: 0, stamina: 80, health: 100, social: 50, shelter: 50 } });
    const d = decideAction(agent, world, [agent], 100, 0);
    expect(d.reason).toContain('search');
    expect(d.priority).toBeGreaterThanOrEqual(85);
  });
});

// === CRITICAL HUNGER ===
describe('Instinct: Critical Hunger', () => {
  it('triggers eating from inventory at hunger=0', () => {
    const world = createMockWorld({ waterAt: [{ x: 55, y: 50 }] });
    const agent = makeAgent({
      x: 50, y: 50,
      needs: { proteinHunger: 0, plantHunger: 0, thirst: 80, stamina: 80, health: 100, social: 50, shelter: 50 },
      resources: { wood: 0, stone: 0, food: 5, water: 0, treeSeed: 0, plantSeed: 0, meat: 0, bone: 0, hide: 0, sinew: 0, fat: 0, feathers: 0, teeth_claws: 0, scales: 0, iron_ore: 0, iron_ingot: 0 },
    });
    const d = decideAction(agent, world, [agent], 100, 0);
    expect(d.action).toBe('eating');
    expect(d.priority).toBeGreaterThanOrEqual(85);
  });

  it('desperate search when no food at hunger=0', () => {
    const world = createMockWorld({ waterAt: [{ x: 55, y: 50 }] });
    const agent = makeAgent({
      x: 50, y: 50,
      needs: { proteinHunger: 0, plantHunger: 0, thirst: 80, stamina: 80, health: 100, social: 50, shelter: 50 },
      resources: { wood: 0, stone: 0, food: 0, water: 0, treeSeed: 0, plantSeed: 0, meat: 0, bone: 0, hide: 0, sinew: 0, fat: 0, feathers: 0, teeth_claws: 0, scales: 0, iron_ore: 0, iron_ingot: 0 },
    });
    const d = decideAction(agent, world, [agent], 100, 0);
    expect(d.reason).toContain('search');
    expect(d.priority).toBeGreaterThanOrEqual(80);
  });
});

// === EXHAUSTION REST ===
describe('Instinct: Rest when exhausted', () => {
  it('rests at stamina=0', () => {
    const world = createMockWorld({ waterAt: [{ x: 55, y: 50 }] });
    const agent = makeAgent({ x: 50, y: 50, needs: { proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 0, health: 100, social: 50, shelter: 50 } });
    const d = decideAction(agent, world, [agent], 100, 0);
    expect(d.action).toBe('resting');
    expect(d.priority).toBeGreaterThanOrEqual(80);
  });

  it('rests at stamina=5 even with mutated genome', () => {
    const world = createMockWorld({ waterAt: [{ x: 55, y: 50 }] });
    const agent = makeAgent({ x: 50, y: 50, needs: { proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 5, health: 100, social: 50, shelter: 50 } });
    const genome = createDefaultGenome();
    genome.thresholds.criticalStamina = 15;
    (agent as any).currentGenome = genome;
    const d = decideAction(agent, world, [agent], 100, 0);
    expect(d.action).toBe('resting');
    expect(d.priority).toBeGreaterThanOrEqual(80);
  });
});

// === MEDIUM PRIORITY ===
describe('Instinct: Medium priority needs', () => {
  it('drinks at thirst=35 (medium, not critical)', () => {
    const world = createMockWorld({ waterAt: [{ x: 55, y: 50 }] });
    const agent = makeAgent({ x: 50, y: 50, needs: { proteinHunger: 80, plantHunger: 80, thirst: 35, stamina: 80, health: 100, social: 50, shelter: 50 } });
    const d = decideAction(agent, world, [agent], 100, 0);
    expect(d.action).toBe('drinking');
    expect(d.priority).toBeGreaterThanOrEqual(50);
    expect(d.priority).toBeLessThan(80);
  });
});

// === MULTIPLE CRITICAL NEEDS ===
describe('Instinct: Priority ordering with multiple crises', () => {
  it('thirst beats hunger when both critical (95 > 90)', () => {
    const world = createMockWorld({ waterAt: [{ x: 55, y: 50 }] });
    const agent = makeAgent({
      x: 50, y: 50,
      needs: { proteinHunger: 0, plantHunger: 0, thirst: 0, stamina: 80, health: 100, social: 50, shelter: 50 },
      resources: { wood: 0, stone: 0, food: 5, water: 0, treeSeed: 0, plantSeed: 0, meat: 5, bone: 0, hide: 0, sinew: 0, fat: 0, feathers: 0, teeth_claws: 0, scales: 0, iron_ore: 0, iron_ingot: 0 },
    });
    const d = decideAction(agent, world, [agent], 100, 0);
    expect(d.action).toBe('drinking');
  });

  it('hunger beats rest when both critical (90 > 83)', () => {
    const world = createMockWorld({ waterAt: [{ x: 55, y: 50 }] });
    const agent = makeAgent({
      x: 50, y: 50,
      needs: { proteinHunger: 0, plantHunger: 0, thirst: 80, stamina: 0, health: 100, social: 50, shelter: 50 },
      resources: { wood: 0, stone: 0, food: 5, water: 0, treeSeed: 0, plantSeed: 0, meat: 5, bone: 0, hide: 0, sinew: 0, fat: 0, feathers: 0, teeth_claws: 0, scales: 0, iron_ore: 0, iron_ingot: 0 },
    });
    const d = decideAction(agent, world, [agent], 100, 0);
    expect(d.action).toBe('eating');
  });
});

// === GENOME MUTATION RESISTANCE ===
describe('Instinct: Survives genome mutations', () => {
  it('critical thirst fires even with worst-case mutated genome', () => {
    const world = createMockWorld({ waterAt: [{ x: 55, y: 50 }] });
    const agent = makeAgent({ x: 50, y: 50, needs: { proteinHunger: 80, plantHunger: 80, thirst: 10, stamina: 80, health: 100, social: 50, shelter: 50 } });
    const genome = createDefaultGenome();
    // Mutate everything to minimum bounds
    genome.thresholds.criticalThirst = 15;
    genome.thresholds.criticalHunger = 15;
    genome.thresholds.criticalStamina = 15;
    genome.goalThresholds.thirstRelevant = 20;
    genome.goalThresholds.proteinRelevant = 20;
    genome.mediumPriorityWeights.drinkMedium = 40;
    genome.interruptWeights.criticalThirst = 60;
    (agent as any).currentGenome = genome;
    const d = decideAction(agent, world, [agent], 100, 0);
    // Must still drink — thirst 10 < criticalThirst 15
    expect(d.action).toBe('drinking');
    expect(d.priority).toBeGreaterThanOrEqual(60);
  });

  it('rest fires even with worst-case mutated genome', () => {
    const world = createMockWorld({ waterAt: [{ x: 55, y: 50 }] });
    const agent = makeAgent({ x: 50, y: 50, needs: { proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 10, health: 100, social: 50, shelter: 50 } });
    const genome = createDefaultGenome();
    genome.thresholds.criticalStamina = 15;
    genome.interruptWeights.exhaustionRest = 60;
    (agent as any).currentGenome = genome;
    const d = decideAction(agent, world, [agent], 100, 0);
    expect(d.action).toBe('resting');
    expect(d.priority).toBeGreaterThanOrEqual(60);
  });
});

// === DEFAULT WANDER ===
describe('Instinct: Default behavior', () => {
  it('wanders when all needs are met', () => {
    const world = createMockWorld({ waterAt: [{ x: 55, y: 50 }] });
    const agent = makeAgent({ x: 50, y: 50, needs: { proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 80, health: 100, social: 50, shelter: 50 } });
    const d = decideAction(agent, world, [agent], 100, 0);
    // Should be low-priority exploring/wandering
    expect(d.priority).toBeLessThan(60);
  });
});
