import { describe, it, expect } from 'vitest';
import { evaluateSurvivalNeeds, evaluateThreats, evaluateHunting, type SurvivalConfig, type ThreatConfig, type Being } from '../SharedDecisionEngine.ts';
import { TileType } from '../../../shared/src/index.ts';

function createMockWorld(options: { waterAt?: { x: number; y: number }[] } = {}) {
  const tiles: number[][] = Array.from({ length: 90 }, () => Array(120).fill(TileType.GRASS));
  for (const w of options.waterAt ?? []) {
    if (tiles[w.y]) tiles[w.y][w.x] = TileType.WATER;
  }
  return {
    tiles,
    trees: [], rocks: [], plants: [], animals: [], corpses: [], structures: [],
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
    findNearestPlant: () => null,
    findNearestWalkable: (fx: number, fy: number, tx: number, ty: number) => ({ x: tx, y: ty }),
  } as any;
}

function makeBeing(overrides: Partial<Being> = {}): Being {
  return {
    x: 50, y: 50, health: 100,
    proteinHunger: 80, plantHunger: 80, thirst: 80, stamina: 80,
    baseStats: { strength: 10, toughness: 10, agility: 10, endurance: 10, perception: 10, charisma: 10 },
    skills: {
      combat: { xp: 0, level: 0 }, defense: { xp: 0, level: 0 }, athletics: { xp: 0, level: 0 },
      woodcutting: { xp: 0, level: 0 }, mining: { xp: 0, level: 0 }, foraging: { xp: 0, level: 0 },
      building: { xp: 0, level: 0 }, crafting: { xp: 0, level: 0 }, survival: { xp: 0, level: 0 }, social: { xp: 0, level: 0 },
    },
    alive: true, action: 'idle', attackCooldown: 0, age: 100,
    ...overrides,
  };
}

const defaultSurvivalConfig: SurvivalConfig = {
  criticalThirst: 20, criticalHunger: 20, criticalStamina: 15,
  criticalHealth: 30, mediumThirst: 50, mediumHunger: 50,
  drinkPriority: 60, eatPriority: 55, restPriority: 80,
  searchRadius: 15, criticalSearchRadius: 40,
  diet: 'omnivore',
};

describe('SharedDecisionEngine — Survival Needs', () => {
  it('critical thirst: finds water at 30 tiles', () => {
    const world = createMockWorld({ waterAt: [{ x: 80, y: 50 }] });
    const being = makeBeing({ thirst: 5 });
    const decisions = evaluateSurvivalNeeds(being, world, defaultSurvivalConfig);
    const drink = decisions.find(d => d.action === 'drinking');
    expect(drink).toBeTruthy();
    expect(drink!.priority).toBe(95);
    expect(drink!.target).toEqual({ x: 80, y: 50 });
  });

  it('critical thirst: desperate search when no water', () => {
    const world = createMockWorld({ waterAt: [] });
    const being = makeBeing({ thirst: 5 });
    const decisions = evaluateSurvivalNeeds(being, world, defaultSurvivalConfig);
    const search = decisions.find(d => d.reason?.includes('desperate'));
    expect(search).toBeTruthy();
    expect(search!.priority).toBe(90);
  });

  it('medium thirst: drink at medium priority', () => {
    const world = createMockWorld({ waterAt: [{ x: 55, y: 50 }] });
    const being = makeBeing({ thirst: 35 });
    const decisions = evaluateSurvivalNeeds(being, world, defaultSurvivalConfig);
    const drink = decisions.find(d => d.action === 'drinking');
    expect(drink).toBeTruthy();
    expect(drink!.priority).toBe(60);
  });

  it('critical stamina: rest', () => {
    const being = makeBeing({ stamina: 5 });
    const world = createMockWorld();
    const decisions = evaluateSurvivalNeeds(being, world, defaultSurvivalConfig);
    const rest = decisions.find(d => d.action === 'resting');
    expect(rest).toBeTruthy();
    expect(rest!.priority).toBe(80);
  });

  it('all needs OK: no survival decisions', () => {
    const world = createMockWorld();
    const being = makeBeing();
    const decisions = evaluateSurvivalNeeds(being, world, defaultSurvivalConfig);
    expect(decisions.length).toBe(0);
  });

  it('works for animals (same interface)', () => {
    // Simulate a deer: herbivore, thirsty
    const world = createMockWorld({ waterAt: [{ x: 53, y: 50 }] });
    const deer = makeBeing({ thirst: 10, proteinHunger: 80, plantHunger: 30 });
    const animalConfig = { ...defaultSurvivalConfig, diet: 'herbivore' as const, searchRadius: 8, criticalSearchRadius: 40 };
    const decisions = evaluateSurvivalNeeds(deer, world, animalConfig);
    const drink = decisions.find(d => d.action === 'drinking');
    expect(drink).toBeTruthy();
    expect(drink!.priority).toBe(95);
  });
});

describe('SharedDecisionEngine — Threat Evaluation', () => {
  it('flees from hunting predator within range', () => {
    const bear = {
      id: 'bear1', species: 'bear', x: 53, y: 50, alive: true,
      action: 'hunting', health: 200, maxHealth: 200,
    };
    const world = createMockWorld();
    (world as any).animals = [bear];

    const being = makeBeing();
    const config: ThreatConfig = {
      detectBase: 5, fleeBase: 75, confidence: 0.5, desperation: 0, huntsList: [],
    };
    const decisions = evaluateThreats(being, world, config, 'agent');
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions[0].reason).toContain('Bear');
  });

  it('ignores wandering predator far away', () => {
    const bear = {
      id: 'bear1', species: 'bear', x: 60, y: 50, alive: true,
      action: 'wandering', health: 200, maxHealth: 200,
    };
    const world = createMockWorld();
    (world as any).animals = [bear];

    const being = makeBeing();
    const config: ThreatConfig = {
      detectBase: 3, fleeBase: 75, confidence: 0.8, desperation: 0, huntsList: [],
    };
    const decisions = evaluateThreats(being, world, config, 'agent');
    expect(decisions.length).toBe(0); // too far, not hunting
  });
});
