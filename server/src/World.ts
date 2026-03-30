import {
  WORLD_WIDTH, WORLD_HEIGHT, TileType, TILE_WALKABLE, TILE_HARVESTABLE,
  ResourceType, Resources, TreeState, RockState, PlantState, PlantType, AnimalState, CorpseState, StructureState, DropTable, randomInt, generateId, distance,
  REGION_SIZE, REGION_COLS, REGION_ROWS, RegionState,
  Season, getCurrentSeason, SEASON_MODIFIERS, SeasonModifiers,
  GrowthStage
} from '../shared/src/index.ts';
import { WorldConfig } from './WorldConfig.ts';
import { getSpecies } from './AnimalSpeciesConfig.ts';
import { createSkillSet, createAnimalBaseStats } from './Progression.ts';

// ─── Noise functions for terrain generation ───

function smoothNoise(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
  return n - Math.floor(n);
}

function interpolatedNoise(x: number, y: number, scale: number, seed: number): number {
  const sx = x / scale;
  const sy = y / scale;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const fx = sx - ix;
  const fy = sy - iy;

  const v00 = smoothNoise(ix, iy, seed);
  const v10 = smoothNoise(ix + 1, iy, seed);
  const v01 = smoothNoise(ix, iy + 1, seed);
  const v11 = smoothNoise(ix + 1, iy + 1, seed);

  const i1 = v00 * (1 - fx) + v10 * fx;
  const i2 = v01 * (1 - fx) + v11 * fx;
  return i1 * (1 - fy) + i2 * fy;
}

// Multi-octave noise for more natural terrain
function fbmNoise(x: number, y: number, seed: number): number {
  let value = 0;
  value += interpolatedNoise(x, y, 20, seed) * 0.5;
  value += interpolatedNoise(x, y, 10, seed + 100) * 0.3;
  value += interpolatedNoise(x, y, 5, seed + 200) * 0.2;
  return value;
}

// Fisher-Yates shuffle
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Shorthand aliases from config
const cfg = WorldConfig;
const dist = cfg.distribution;

export class World {
  tiles: TileType[][];
  resourceHealth: number[][];
  trees: TreeState[] = [];
  // Quick lookup: treeGrid[y][x] = tree ID if a tree occupies that tile
  treeGrid: (string | null)[][] = [];
  rocks: RockState[] = [];
  // Quick lookup: rockGrid[y][x] = rock ID if a rock occupies that tile
  rockGrid: (string | null)[][] = [];
  plants: PlantState[] = [];
  plantGrid: (string | null)[][] = [];
  // Budget caps calculated at generation time
  plantCaps: Record<number, number> = {};
  animals: AnimalState[] = [];
  corpses: CorpseState[] = [];
  structures: StructureState[] = [];

  // Ecosystem: regions, fertility, tracking
  regions: RegionState[][] = [];
  fertility: Float32Array = new Float32Array(0);
  initialPlantCount: number = 0;
  initialIronCount: number = 0;

  constructor() {
    this.tiles = [];
    this.resourceHealth = [];
    this.generate();
  }

  generate(): void {
    const elevSeed = Math.random() * 10000;
    const moistSeed = Math.random() * 10000;
    const treeSeed = Math.random() * 10000;
    const detailSeed = Math.random() * 10000;

    this.tiles = Array.from({ length: WORLD_HEIGHT }, () =>
      Array(WORLD_WIDTH).fill(TileType.GRASS)
    );
    this.resourceHealth = Array.from({ length: WORLD_HEIGHT }, () =>
      Array(WORLD_WIDTH).fill(0)
    );
    this.trees = [];
    this.treeGrid = Array.from({ length: WORLD_HEIGHT }, () =>
      Array(WORLD_WIDTH).fill(null)
    );
    this.rocks = [];
    this.rockGrid = Array.from({ length: WORLD_HEIGHT }, () =>
      Array(WORLD_WIDTH).fill(null)
    );
    this.plants = [];
    this.plantGrid = Array.from({ length: WORLD_HEIGHT }, () =>
      Array(WORLD_WIDTH).fill(null)
    );

    // Initialize regions (9 rows × 12 cols)
    this.regions = Array.from({ length: REGION_ROWS }, () =>
      Array.from({ length: REGION_COLS }, (): RegionState => ({
        seedBank: {},
        plantCount: 0,
        herbivoreCount: 0,
      }))
    );

    // Initialize fertility grid (all 1.0 = normal)
    this.fertility = new Float32Array(WORLD_WIDTH * WORLD_HEIGHT);
    this.fertility.fill(1.0);

    // ─── Pass 1: Base terrain — lakes covering ≥20% of map ───
    const totalTiles = WORLD_WIDTH * WORLD_HEIGHT;
    const minWaterTiles = Math.floor(totalTiles * cfg.water.minCoverage);
    const lakeSeed = Math.random() * 10000;
    const lakeMargin = cfg.water.lakeMargin;

    // Start with all grass
    for (let y = 0; y < WORLD_HEIGHT; y++)
      for (let x = 0; x < WORLD_WIDTH; x++)
        this.tiles[y][x] = TileType.GRASS;

    // Keep generating lakes until we hit water coverage target
    let waterTiles = 0;
    let attempts = 0;
    while (waterTiles < minWaterTiles && attempts < cfg.water.maxAttempts) {
      attempts++;
      const cx = lakeMargin + Math.floor(Math.random() * (WORLD_WIDTH - lakeMargin * 2));
      const cy = lakeMargin + Math.floor(Math.random() * (WORLD_HEIGHT - lakeMargin * 2));
      // Avoid center spawn area
      if (Math.abs(cx - WORLD_WIDTH / 2) < cfg.water.spawnExclusion && Math.abs(cy - WORLD_HEIGHT / 2) < cfg.water.spawnExclusion) continue;
      const rx = cfg.water.lakeRadiusX.min + Math.floor(Math.random() * (cfg.water.lakeRadiusX.max - cfg.water.lakeRadiusX.min + 1));
      const ry = cfg.water.lakeRadiusY.min + Math.floor(Math.random() * (cfg.water.lakeRadiusY.max - cfg.water.lakeRadiusY.min + 1));

      // Carve lake with noise-distorted ellipse
      for (let y = cy - ry - 2; y <= cy + ry + 2; y++) {
        for (let x = cx - rx - 2; x <= cx + rx + 2; x++) {
          if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) continue;
          if (this.tiles[y][x] === TileType.WATER) continue;
          const dx = (x - cx) / rx;
          const dy = (y - cy) / ry;
          const noise = interpolatedNoise(x, y, 4, lakeSeed + attempts * 100) * cfg.water.noiseDistortion;
          if (dx * dx + dy * dy + noise < 1.0) {
            this.tiles[y][x] = TileType.WATER;
            waterTiles++;
          }
        }
      }
    }

    // Sand beaches: 1-tile ring around water
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        if (this.tiles[y][x] !== TileType.GRASS) continue;
        let nearWater = false;
        for (let dy = -1; dy <= 1 && !nearWater; dy++) {
          for (let dx = -1; dx <= 1 && !nearWater; dx++) {
            if (this.getTile(x + dx, y + dy) === TileType.WATER) nearWater = true;
          }
        }
        if (nearWater && interpolatedNoise(x, y, 3, detailSeed) > cfg.sand.beachNoiseThreshold) {
          this.tiles[y][x] = TileType.SAND;
        }
      }
    }

    // ─── Pass 2: Remove isolated sand (sand should only appear near water) ───
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        if (this.tiles[y][x] === TileType.SAND) {
          let nearWater = false;
          for (let dy = -2; dy <= 2 && !nearWater; dy++) {
            for (let dx = -2; dx <= 2 && !nearWater; dx++) {
              if (this.getTile(x + dx, y + dy) === TileType.WATER) nearWater = true;
            }
          }
          if (!nearWater) this.tiles[y][x] = TileType.GRASS;
        }
      }
    }

    // ─── Pass 3: Dirt patches (dry areas, paths, clearings) ───
    // Dirt appears in elevated dry zones and as scattered patches.

    const dirtSeed = Math.random() * 10000;

    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        if (this.tiles[y][x] !== TileType.GRASS) continue;

        const elev = fbmNoise(x, y, elevSeed);
        const moist = fbmNoise(x, y, moistSeed);
        const dirtNoise = fbmNoise(x, y, dirtSeed);

        // Dry elevated dirt patches
        if (elev > cfg.dirt.elevThreshold && moist < cfg.dirt.moistMax && dirtNoise > cfg.dirt.noiseThreshold) {
          this.tiles[y][x] = TileType.DIRT;
          continue;
        }

        // Scattered dirt clearings
        if (dirtNoise > cfg.dirt.clearingThreshold && moist < cfg.dirt.clearingMoistMax) {
          this.tiles[y][x] = TileType.DIRT;
          continue;
        }
      }
    }

    // ─── Pass 4: Widen sand beaches ───
    // Ensure sand patches are at least 2-3 tiles wide for proper autotile transitions.
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        if (this.tiles[y][x] !== TileType.GRASS && this.tiles[y][x] !== TileType.DIRT) continue;
        // Check if adjacent to sand — expand sand one more tile
        let nearSand = false;
        for (let dy = -1; dy <= 1 && !nearSand; dy++) {
          for (let dx = -1; dx <= 1 && !nearSand; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (this.getTile(x + dx, y + dy) === TileType.SAND) nearSand = true;
          }
        }
        if (nearSand) {
          // Only expand if also near water (keep sand as beach)
          let nearWater = false;
          for (let dy = -3; dy <= 3 && !nearWater; dy++) {
            for (let dx = -3; dx <= 3 && !nearWater; dx++) {
              if (this.getTile(x + dx, y + dy) === TileType.WATER) nearWater = true;
            }
          }
          if (nearWater && interpolatedNoise(x, y, 4, detailSeed) > 0.35) {
            this.tiles[y][x] = TileType.SAND;
          }
        }
      }
    }

    // ─── Pass 5: Water already guaranteed ≥20% in Pass 1 ───

    // ─── Pass 6: Budget-based resource placement (RESOURCE_BALANCE.md) ───
    // Calculate placeable land and nature budget
    let placeableCount = 0;
    let dirtCount = 0;
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const t = this.tiles[y][x];
        if (t === TileType.GRASS || t === TileType.DIRT) {
          placeableCount++;
          if (t === TileType.DIRT) dirtCount++;
        }
      }
    }
    const natureBudget = Math.floor(placeableCount * cfg.natureBudgetRatio);

    // Target counts from distribution config
    const targetTrees = Math.floor(natureBudget * dist.trees / 4); // 2x2 = 4 tiles each
    const targetRocks = Math.floor(natureBudget * dist.rocks);
    const targetBigRocks = Math.floor(targetRocks * cfg.rocks.bigRockRatio);
    const targetSmallRocks = targetRocks - targetBigRocks;
    const targetBushes = Math.floor(natureBudget * dist.berryBush);
    const targetMushrooms = Math.floor(natureBudget * dist.mushroom);
    const targetPoison = Math.floor(natureBudget * dist.poisonShroom);
    const targetEdibleFlower = Math.floor(natureBudget * dist.edibleFlower);
    const targetHealFlower = Math.floor(natureBudget * dist.healFlower);
    const targetStaminaHerb = Math.floor(natureBudget * dist.staminaHerb);
    const targetHungerHerb = Math.floor(natureBudget * dist.hungerHerb);

    // Store caps for regrowth limits
    this.plantCaps = {
      [PlantType.BERRY_BUSH]: targetBushes,
      [PlantType.MUSHROOM]: targetMushrooms,
      [PlantType.POISON_SHROOM]: targetPoison,
      [PlantType.EDIBLE_FLOWER]: targetEdibleFlower,
      [PlantType.FLOWER]: targetHealFlower,
      [PlantType.STAMINA_HERB]: targetStaminaHerb,
      [PlantType.HUNGER_HERB]: targetHungerHerb,
    };

    // --- Trees: use noise for natural clustering, place up to target ---
    let treesPlaced = 0;
    // Build sorted candidate list (by tree noise, descending) for natural forest look
    const treeCandidates: { x: number; y: number; score: number }[] = [];
    for (let y = 0; y < WORLD_HEIGHT - 1; y++) {
      for (let x = 0; x < WORLD_WIDTH - 1; x++) {
        const score = fbmNoise(x, y, treeSeed) + interpolatedNoise(x, y, 3, detailSeed) * 0.3;
        treeCandidates.push({ x, y, score });
      }
    }
    treeCandidates.sort((a, b) => b.score - a.score);
    for (const c of treeCandidates) {
      if (treesPlaced >= targetTrees) break;
      if (this.canPlaceTree(c.x, c.y)) {
        this.placeTree(c.x, c.y);
        treesPlaced++;
      }
    }

    // --- Rocks: place on valid tiles, shuffled for distribution ---
    const rockCandidates: { x: number; y: number; isDirt: boolean }[] = [];
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const t = this.tiles[y][x];
        if ((t === TileType.GRASS || t === TileType.DIRT) && !this.treeGrid[y][x] && !this.rockGrid[y][x]) {
          rockCandidates.push({ x, y, isDirt: t === TileType.DIRT });
        }
      }
    }
    shuffle(rockCandidates);
    let bigRocksPlaced = 0, smallRocksPlaced = 0;
    for (const c of rockCandidates) {
      if (bigRocksPlaced >= targetBigRocks && smallRocksPlaced >= targetSmallRocks) break;
      if (bigRocksPlaced < targetBigRocks && c.isDirt && this.canPlaceRock(c.x, c.y, 1)) {
        this.placeRock(c.x, c.y, 1);
        bigRocksPlaced++;
      } else if (smallRocksPlaced < targetSmallRocks && this.canPlaceRock(c.x, c.y, 0)) {
        this.placeRock(c.x, c.y, 0);
        smallRocksPlaced++;
      }
    }

    // --- Plants: place on grass/built_floor, noise-weighted for natural scatter ---
    const plantCandidates: { x: number; y: number; treeNoise: number }[] = [];
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        if (this.canPlacePlant(x, y)) {
          plantCandidates.push({ x, y, treeNoise: fbmNoise(x, y, treeSeed) });
        }
      }
    }
    shuffle(plantCandidates);

    // Berry bushes prefer forest edges (sort near-tree candidates first)
    const bushCandidates = plantCandidates
      .filter(c => c.treeNoise > 0.35 && c.treeNoise < 0.55)
      .concat(plantCandidates.filter(c => c.treeNoise <= 0.35 || c.treeNoise >= 0.55));

    const plantTargets: { type: PlantType; count: number; candidates: typeof plantCandidates }[] = [
      { type: PlantType.BERRY_BUSH, count: targetBushes, candidates: bushCandidates },
      { type: PlantType.MUSHROOM, count: targetMushrooms, candidates: plantCandidates },
      { type: PlantType.POISON_SHROOM, count: targetPoison, candidates: plantCandidates },
      { type: PlantType.EDIBLE_FLOWER, count: targetEdibleFlower, candidates: plantCandidates },
      { type: PlantType.FLOWER, count: targetHealFlower, candidates: plantCandidates },
      { type: PlantType.STAMINA_HERB, count: targetStaminaHerb, candidates: plantCandidates },
      { type: PlantType.HUNGER_HERB, count: targetHungerHerb, candidates: plantCandidates },
    ];

    for (const pt of plantTargets) {
      let placed = 0;
      for (const c of pt.candidates) {
        if (placed >= pt.count) break;
        if (this.canPlacePlant(c.x, c.y)) {
          this.placePlant(c.x, c.y, pt.type);
          placed++;
        }
      }
    }

    // ─── Pass 7: Iron ore deposits (rare, near stone/rocky areas) ───
    const ironCount = randomInt(cfg.iron.depositCount.min, cfg.iron.depositCount.max);
    let ironPlaced = 0;
    for (let attempt = 0; attempt < 500 && ironPlaced < ironCount; attempt++) {
      const ix = randomInt(2, WORLD_WIDTH - 3);
      const iy = randomInt(2, WORLD_HEIGHT - 3);
      // Must be on dirt (rocky area), not occupied
      if (this.tiles[iy][ix] !== TileType.DIRT) continue;
      if (this.rockGrid[iy][ix] || this.treeGrid[iy][ix] || this.plantGrid[iy][ix]) continue;
      // Prefer being near rocks
      let nearRock = false;
      for (let dy = -2; dy <= 2 && !nearRock; dy++)
        for (let dx = -2; dx <= 2 && !nearRock; dx++)
          if (this.rockGrid[iy + dy]?.[ix + dx]) nearRock = true;
      if (!nearRock && Math.random() > 0.5) continue;

      this.tiles[iy][ix] = TileType.IRON_ORE;
      this.resourceHealth[iy][ix] = cfg.iron.health;
      ironPlaced++;
    }

    // ─── Pass 8: Center clearing for agent spawning ───
    const cx = Math.floor(WORLD_WIDTH / 2);
    const cy = Math.floor(WORLD_HEIGHT / 2);
    const clearR = cfg.centerClearing.radius;
    for (let dy = -clearR; dy <= clearR; dy++) {
      for (let dx = -clearR; dx <= clearR; dx++) {
        // Circular clearing
        if (dx * dx + dy * dy <= clearR * clearR) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && nx < WORLD_WIDTH && ny >= 0 && ny < WORLD_HEIGHT) {
            // Remove any tree occupying this tile
            const treeId = this.treeGrid[ny][nx];
            if (treeId) {
              this.removeTree(treeId);
            }
            // Remove any rock occupying this tile
            const rockId = this.rockGrid[ny][nx];
            if (rockId) {
              this.removeRock(rockId);
            }
            // Remove any plant occupying this tile
            const plantId = this.plantGrid[ny][nx];
            if (plantId) {
              this.removePlant(plantId);
            }
            this.tiles[ny][nx] = TileType.GRASS;
            this.resourceHealth[ny][nx] = 0;
          }
        }
      }
    }

    // (Water check moved to Pass 5, before tree placement)

    // Track initial counts for ecosystem safety nets
    this.initialPlantCount = this.plants.length;
    this.initialIronCount = ironPlaced;

    // Initialize region plant counts
    this.recountRegionStats();

    // ─── Pass 9: Spawn initial animals ───
    this.spawnInitialAnimals();
  }

  private carveLake(seed: number): void {
    // Carve a fallback lake at a random non-center position
    const cx = Math.floor(WORLD_WIDTH * 0.25 + smoothNoise(0, 0, seed) * WORLD_WIDTH * 0.5);
    const cy = Math.floor(WORLD_HEIGHT * 0.25 + smoothNoise(1, 0, seed) * WORLD_HEIGHT * 0.5);
    const rx = 6 + Math.floor(smoothNoise(2, 0, seed) * 4);
    const ry = 5 + Math.floor(smoothNoise(3, 0, seed) * 3);
    for (let y = cy - ry - 1; y <= cy + ry + 1; y++) {
      for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
        if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) continue;
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const noise = interpolatedNoise(x, y, 3, seed) * 0.4;
        if (dx * dx + dy * dy + noise < 1.0) {
          this.tiles[y][x] = TileType.WATER;
          this.resourceHealth[y][x] = 0;
        }
      }
    }
  }

  getTile(x: number, y: number): TileType {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= WORLD_WIDTH || iy < 0 || iy >= WORLD_HEIGHT) return TileType.WATER;
    return this.tiles[iy][ix];
  }

  setTile(x: number, y: number, type: TileType): void {
    if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) return;
    this.tiles[y][x] = type;
  }

  isWalkable(x: number, y: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const tile = this.getTile(ix, iy);
    if (!(TILE_WALKABLE[tile] ?? false)) return false;
    // Rocks block movement (they don't change tile type)
    if (this.rockGrid[iy]?.[ix]) {
      const rock = this.rocks.find(r => r.id === this.rockGrid[iy][ix]);
      if (rock && !rock.isRubble) return false;
    }
    return true;
  }

  harvest(x: number, y: number, amount: number): { resource: ResourceType; amount: number } | null {
    const tile = this.getTile(x, y);
    const resourceType = TILE_HARVESTABLE[tile];
    if (!resourceType) return null;

    const health = this.resourceHealth[y]?.[x] ?? 0;
    if (health <= 0) return null;

    const harvested = Math.min(amount, health);
    this.resourceHealth[y][x] -= harvested;

    if (this.resourceHealth[y][x] <= 0) {
      this.tiles[y][x] = TileType.GRASS;
    }

    return { resource: resourceType, amount: harvested };
  }

  /** Get season modifiers for the current tick. */
  getSeasonModifiers(tickCount: number): SeasonModifiers {
    return SEASON_MODIFIERS[getCurrentSeason(tickCount)];
  }

  tick(tickCount: number = 0): { x: number; y: number; type: TileType }[] {
    const changes: { x: number; y: number; type: TileType }[] = [];

    // ─── Stump lifecycle ───
    for (let i = this.trees.length - 1; i >= 0; i--) {
      const tree = this.trees[i];
      if (!tree.isStump) continue;

      tree.stumpAge++;

      if (tree.stumpAge >= cfg.trees.stumpLifetimeTicks) {
        if (Math.random() < cfg.trees.stumpRegrowChance) {
          // Regrow as a SPROUT (will grow to mature over time)
          tree.isStump = false;
          tree.stumpAge = 0;
          tree.health = 0;
          tree.growthStage = GrowthStage.SPROUT;
          tree.growthTicks = 0;
          // Keep 1x1 tile (sprout is small)
          this.tiles[tree.y][tree.x] = TileType.TREE;
          this.treeGrid[tree.y][tree.x] = tree.id;
          changes.push({ x: tree.x, y: tree.y, type: TileType.TREE });
          if (false) {
            // Can't regrow — remove stump
            this.tiles[tree.y][tree.x] = TileType.GRASS;
            changes.push({ x: tree.x, y: tree.y, type: TileType.GRASS });
            this.trees.splice(i, 1);
          }
        } else {
          // Disappear — remove stump entirely
          this.tiles[tree.y][tree.x] = TileType.GRASS;
          changes.push({ x: tree.x, y: tree.y, type: TileType.GRASS });
          this.trees.splice(i, 1);
        }
      }
    }

    // ─── Rubble lifecycle ───
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const rock = this.rocks[i];
      if (!rock.isRubble) continue;

      rock.rubbleAge++;

      if (rock.rubbleAge >= cfg.rocks.rubbleLifetimeTicks) {
        // Remove rubble — tile was never changed, just clear the entity
        this.rockGrid[rock.y][rock.x] = null;
        this.rocks.splice(i, 1);

        // 60% chance to respawn on a random empty grass or dirt tile
        if (Math.random() < cfg.rocks.rubbleRespawnChance) {
          this.spawnRandomRock(rock.type);
        }
      }
    }

    // ─── Growth stage advancement (trees and plants) ───
    for (const tree of this.trees) {
      if (tree.isStump || tree.growthStage === GrowthStage.MATURE) continue;
      tree.growthTicks++;
      const fert = Math.max(0.5, this.getFertility(tree.x, tree.y));
      const effectiveTicks = tree.growthTicks * fert;

      if (tree.growthStage === GrowthStage.SPROUT && effectiveTicks >= cfg.trees.growthTicks.sprout) {
        tree.growthStage = GrowthStage.YOUNG;
        tree.growthTicks = 0;
        tree.health = Math.floor(tree.maxHealth * 0.3);
      } else if (tree.growthStage === GrowthStage.YOUNG && effectiveTicks >= cfg.trees.growthTicks.young) {
        // Expand to 2x2 mature tree
        tree.growthStage = GrowthStage.MATURE;
        tree.growthTicks = 0;
        tree.health = tree.maxHealth;
        // Check if we can expand to 2x2
        if (this.canPlaceTree(tree.x, tree.y)) {
          // Clear old 1x1
          this.treeGrid[tree.y][tree.x] = null;
          // Set 2x2
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              this.tiles[tree.y + dy][tree.x + dx] = TileType.TREE;
              this.treeGrid[tree.y + dy][tree.x + dx] = tree.id;
              changes.push({ x: tree.x + dx, y: tree.y + dy, type: TileType.TREE });
            }
          }
        }
        // If can't expand, stays as 1x1 mature tree (cramped)
      }
    }

    for (const plant of this.plants) {
      if (plant.growthStage === GrowthStage.MATURE) continue;
      plant.growthTicks++;
      const fert = Math.max(0.5, this.getFertility(plant.x, plant.y));
      const effectiveTicks = plant.growthTicks * fert;

      if (plant.growthStage === GrowthStage.SPROUT && effectiveTicks >= cfg.plants.growthTicks.sprout) {
        plant.growthStage = GrowthStage.YOUNG;
        plant.growthTicks = 0;
        plant.health = Math.floor(plant.maxHealth * 0.3);
      } else if (plant.growthStage === GrowthStage.YOUNG && effectiveTicks >= cfg.plants.growthTicks.young) {
        plant.growthStage = GrowthStage.MATURE;
        plant.growthTicks = 0;
        plant.health = plant.maxHealth;
      }
    }

    // ─── Per-plant adjacent regrowth ───
    // Regrowth chance = base × fertility × emergencyMult × seasonMult × overgrazingMult
    const plantTypeCounts: Record<number, number> = {};
    for (const p of this.plants) {
      plantTypeCounts[p.type] = (plantTypeCounts[p.type] || 0) + 1;
    }

    // Emergency multiplier (min plant floor safety net)
    const plantRatio = this.initialPlantCount > 0 ? this.plants.length / this.initialPlantCount : 1;
    const emergencyMult = plantRatio < 0.05 ? 5.0 : plantRatio < 0.20 ? 2.0 : 1.0;

    // Season multiplier
    const seasonMod = this.getSeasonModifiers(tickCount);
    const seasonRegrowth = seasonMod.regrowthMult;

    const snapshot = [...this.plants]; // snapshot to avoid iterating new plants
    for (const plant of snapshot) {
      // Only mature plants can spread
      if (plant.growthStage !== GrowthStage.MATURE) continue;
      // Fertility at this plant's tile
      const fert = this.getFertility(plant.x, plant.y);

      // Carrying capacity / overgrazing modifier for the plant's region
      const region = this.getRegion(plant.x, plant.y);
      const carryingCap = region.plantCount * 2;
      const overgrazingMult = region.herbivoreCount > carryingCap
        ? 0.25
        : region.herbivoreCount < carryingCap * 0.5
          ? 1.5
          : 1.0;

      const effectiveChance = cfg.plants.regrowChance * fert * emergencyMult * seasonRegrowth * overgrazingMult;
      if (Math.random() >= effectiveChance) continue;

      // Check cap
      const cap = this.plantCaps[plant.type] ?? Infinity;
      if ((plantTypeCounts[plant.type] || 0) >= cap) continue;
      // Pick a random adjacent tile
      const dirs = [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 0, dy: 1 }];
      const dir = dirs[randomInt(0, 3)];
      const nx = plant.x + dir.dx;
      const ny = plant.y + dir.dy;
      if (this.canPlacePlant(nx, ny)) {
        this.placePlant(nx, ny, plant.type);
        plantTypeCounts[plant.type] = (plantTypeCounts[plant.type] || 0) + 1;
      }
    }

    return changes;
  }

  tickCorpseDecay(currentTick: number): void {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      if (currentTick >= this.corpses[i].decayAt) {
        const corpse = this.corpses[i];
        // Corpse decomposition enriches surrounding soil (3×3 area, +0.3 fertility)
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            this.adjustFertility(corpse.x + dx, corpse.y + dy, 0.3);
          }
        }
        // Add seeds to the soil bank from decomposing plant matter
        const region = this.getRegion(corpse.x, corpse.y);
        if (region.seedBank) {
          // Decomposing corpses slightly fertilize seed bank with random plant type
          if (Math.random() < 0.3) {
            const plantTypes = [PlantType.MUSHROOM, PlantType.FLOWER, PlantType.HUNGER_HERB, PlantType.EDIBLE_FLOWER];
            const type = plantTypes[randomInt(0, plantTypes.length - 1)];
            this.addSeedToBank(corpse.x, corpse.y, type);
          }
        }
        this.corpses.splice(i, 1);
      }
    }
  }

  // ─── Tree entity methods ───

  placeTree(x: number, y: number, type?: 0 | 1, stage: number = GrowthStage.MATURE): TreeState | null {
    // Sprout/young trees only need 1x1, mature trees need 2x2
    if (stage === GrowthStage.MATURE) {
      if (!this.canPlaceTree(x, y)) return null;
    } else {
      if (!this.canPlacePlant(x, y)) return null; // 1x1 check
    }

    const isMature = stage === GrowthStage.MATURE;
    const tree: TreeState = {
      id: generateId(),
      x, y,
      type: type ?? (Math.random() < 0.5 ? 0 : 1) as 0 | 1,
      health: isMature ? cfg.trees.maxHealth : stage === GrowthStage.YOUNG ? Math.floor(cfg.trees.maxHealth * 0.3) : 0,
      maxHealth: cfg.trees.maxHealth,
      isStump: false,
      stumpAge: 0,
      growthStage: stage,
      growthTicks: 0,
    };

    this.trees.push(tree);
    if (isMature) {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          this.tiles[y + dy][x + dx] = TileType.TREE;
          this.treeGrid[y + dy][x + dx] = tree.id;
        }
      }
    } else {
      // Sprout/young: 1x1 tile, mark as TREE on just one tile
      this.tiles[y][x] = TileType.TREE;
      this.treeGrid[y][x] = tree.id;
    }
    return tree;
  }

  canPlaceTree(x: number, y: number): boolean {
    if (x < 0 || x + 1 >= WORLD_WIDTH || y < 0 || y + 1 >= WORLD_HEIGHT) return false;
    // Check all 4 tiles of the 2x2 base AND a 1-tile buffer around them
    for (let dy = -1; dy <= 2; dy++) {
      for (let dx = -1; dx <= 2; dx++) {
        const t = this.getTile(x + dx, y + dy);
        // Buffer zone: no water, sand, or dirt adjacent
        if (t === TileType.WATER || t === TileType.SAND || t === TileType.DIRT) return false;
      }
    }
    // The 4 base tiles must be grass or built floor, and unoccupied
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const t = this.tiles[y + dy][x + dx];
        if (t !== TileType.GRASS && t !== TileType.BUILT_FLOOR) return false;
        if (this.treeGrid[y + dy][x + dx]) return false;
        if (this.rockGrid[y + dy][x + dx]) return false;
      }
    }
    return true;
  }

  removeTree(treeId: string): void {
    const idx = this.trees.findIndex(t => t.id === treeId);
    if (idx === -1) return;
    const tree = this.trees[idx];

    if (tree.isStump) {
      // Only stump tile to clear
      this.treeGrid[tree.y][tree.x] = null;
    } else {
      // Clear 2x2 area
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const nx = tree.x + dx, ny = tree.y + dy;
          if (nx >= 0 && nx < WORLD_WIDTH && ny >= 0 && ny < WORLD_HEIGHT) {
            if (this.treeGrid[ny][nx] === treeId) {
              this.tiles[ny][nx] = TileType.GRASS;
              this.treeGrid[ny][nx] = null;
            }
          }
        }
      }
    }
    this.trees.splice(idx, 1);
  }

  /** Harvest wood from a tree. Returns amount harvested + whether tree is now a stump + seed drop. */
  harvestTree(treeId: string, amount: number): { harvested: number; becameStump: boolean; seedDrop: boolean } | null {
    const tree = this.trees.find(t => t.id === treeId);
    if (!tree || tree.isStump) return null;

    const harvested = Math.min(amount, tree.health);
    tree.health -= harvested;

    if (tree.health <= 0) {
      // Tree is depleted → becomes stump
      const seedDrop = Math.random() < cfg.trees.seedDropChance;

      // Clear 2x2 area
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          this.tiles[tree.y + dy][tree.x + dx] = TileType.GRASS;
          this.treeGrid[tree.y + dy][tree.x + dx] = null;
        }
      }

      // Place stump at top-left position
      tree.isStump = true;
      tree.stumpAge = 0;
      this.tiles[tree.y][tree.x] = TileType.TREE_STUMP;
      this.treeGrid[tree.y][tree.x] = tree.id;

      return { harvested, becameStump: true, seedDrop };
    }

    return { harvested, becameStump: false, seedDrop: false };
  }

  /** Find nearest tree entity from a position. */
  findNearestTree(fromX: number, fromY: number, maxDist: number = 20): TreeState | null {
    let best: TreeState | null = null;
    let bestDist = Infinity;

    for (const tree of this.trees) {
      if (tree.isStump) continue;
      // Distance to nearest tile of the 2x2 tree
      const dx = Math.max(0, tree.x - fromX, fromX - (tree.x + 1));
      const dy = Math.max(0, tree.y - fromY, fromY - (tree.y + 1));
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < bestDist && d <= maxDist) {
        bestDist = d;
        best = tree;
      }
    }
    return best;
  }

  /** Plant a tree seed — creates a SPROUT-stage tree (1x1). */
  plantSeed(x: number, y: number): { tree: TreeState; tileChanges: { x: number; y: number; type: TileType }[] } | null {
    const tree = this.placeTree(x, y, undefined, GrowthStage.SPROUT);
    if (!tree) return null;

    const tileChanges: { x: number; y: number; type: TileType }[] = [];
    tileChanges.push({ x, y, type: TileType.TREE });
    return { tree, tileChanges };
  }

  getTreeAt(x: number, y: number): TreeState | null {
    const treeId = this.treeGrid[y]?.[x];
    if (!treeId) return null;
    return this.trees.find(t => t.id === treeId) ?? null;
  }

  findNearest(fromX: number, fromY: number, tileType: TileType, maxDist: number = 40): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;

    for (let dy = -maxDist; dy <= maxDist; dy++) {
      for (let dx = -maxDist; dx <= maxDist; dx++) {
        const nx = fromX + dx;
        const ny = fromY + dy;
        if (nx < 0 || nx >= WORLD_WIDTH || ny < 0 || ny >= WORLD_HEIGHT) continue;
        // For harvestable tiles (stone, berry bush) check resource health
        // For non-harvestable (water, etc.) just check tile type
        if (this.tiles[ny][nx] === tileType) {
          if (TILE_HARVESTABLE[tileType] && this.resourceHealth[ny][nx] <= 0) continue;
          const d = Math.abs(dx) + Math.abs(dy);
          if (d < bestDist) {
            bestDist = d;
            best = { x: nx, y: ny };
          }
        }
      }
    }
    return best;
  }

  findNearestWalkable(fromX: number, fromY: number, targetX: number, targetY: number): { x: number; y: number } {
    const dirs = [
      { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 },
    ];
    let best = { x: fromX, y: fromY };
    let bestDist = Infinity;
    for (const { dx, dy } of dirs) {
      const nx = targetX + dx;
      const ny = targetY + dy;
      if (this.isWalkable(nx, ny)) {
        const d = Math.abs(nx - fromX) + Math.abs(ny - fromY);
        if (d < bestDist) {
          bestDist = d;
          best = { x: nx, y: ny };
        }
      }
    }
    return best;
  }

  // ─── Rock entity methods ───

  placeRock(x: number, y: number, type?: 0 | 1): RockState | null {
    if (!this.canPlaceRock(x, y, type)) return null;

    const rockType = type ?? (Math.random() < 0.7 ? 0 : 1) as 0 | 1;
    const maxHealth = rockType === 0 ? cfg.rocks.smallHealth : cfg.rocks.bigHealth;

    const rock: RockState = {
      id: generateId(),
      x, y,
      type: rockType,
      health: maxHealth,
      maxHealth,
      isRubble: false,
      rubbleAge: 0,
    };

    this.rocks.push(rock);
    // Don't change tile type — rock is a pure entity overlay on existing terrain
    this.rockGrid[y][x] = rock.id;
    return rock;
  }

  canPlaceRock(x: number, y: number, type?: 0 | 1): boolean {
    if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) return false;
    const tile = this.tiles[y][x];
    // Big rocks (type 1) only on dirt; small rocks (type 0) on grass or dirt
    if (type === 1) {
      if (tile !== TileType.DIRT) return false;
    } else {
      if (tile !== TileType.GRASS && tile !== TileType.DIRT) return false;
    }
    // No existing entity at this position
    if (this.rockGrid[y][x]) return false;
    if (this.treeGrid[y][x]) return false;
    return true;
  }

  removeRock(rockId: string): void {
    const idx = this.rocks.findIndex(r => r.id === rockId);
    if (idx === -1) return;
    const rock = this.rocks[idx];
    this.rockGrid[rock.y][rock.x] = null;
    this.rocks.splice(idx, 1);
  }

  /** Harvest stone from a rock. Returns amount harvested + whether rock became rubble. */
  harvestRock(rockId: string, amount: number): { harvested: number; becameRubble: boolean } | null {
    const rock = this.rocks.find(r => r.id === rockId);
    if (!rock || rock.isRubble) return null;

    const harvested = Math.min(amount, rock.health);
    rock.health -= harvested;

    if (rock.health <= 0) {
      // Rock depleted → becomes rubble (tile stays unchanged — rubble is a sprite overlay)
      rock.isRubble = true;
      rock.rubbleAge = 0;
      return { harvested, becameRubble: true };
    }

    return { harvested, becameRubble: false };
  }

  /** Find nearest rock entity from a position. */
  findNearestRock(fromX: number, fromY: number, maxDist: number = 20): RockState | null {
    let best: RockState | null = null;
    let bestDist = Infinity;

    for (const rock of this.rocks) {
      if (rock.isRubble) continue;
      const d = Math.abs(rock.x - fromX) + Math.abs(rock.y - fromY);
      if (d < bestDist && d <= maxDist) {
        bestDist = d;
        best = rock;
      }
    }
    return best;
  }

  getRockAt(x: number, y: number): RockState | null {
    const rockId = this.rockGrid[y]?.[x];
    if (!rockId) return null;
    return this.rocks.find(r => r.id === rockId) ?? null;
  }

  /** Spawn a rock at a random empty grass or dirt tile. */
  private spawnRandomRock(type: 0 | 1): { x: number; y: number } | null {
    // Try up to 50 random positions
    for (let attempt = 0; attempt < 50; attempt++) {
      const x = randomInt(0, WORLD_WIDTH - 1);
      const y = randomInt(0, WORLD_HEIGHT - 1);
      if (this.canPlaceRock(x, y, type)) {
        this.placeRock(x, y, type);
        return { x, y };
      }
    }
    return null;
  }

  // ─── Plant entity methods ───

  placePlant(x: number, y: number, type: PlantType, stage: number = GrowthStage.MATURE): PlantState | null {
    if (!this.canPlacePlant(x, y)) return null;

    const maxHealth = type === PlantType.BERRY_BUSH ? cfg.plants.bushMaxHealth : 1;
    const isMature = stage === GrowthStage.MATURE;
    const plant: PlantState = {
      id: generateId(),
      x, y,
      type,
      health: isMature ? maxHealth : stage === GrowthStage.YOUNG ? Math.floor(maxHealth * 0.3) : 0,
      maxHealth,
      growthStage: stage,
      growthTicks: 0,
    };

    this.plants.push(plant);
    this.plantGrid[y][x] = plant.id;
    return plant;
  }

  /** Plant a food seed (creates SPROUT-stage plant). */
  plantFoodSeed(x: number, y: number, type: PlantType): PlantState | null {
    return this.placePlant(x, y, type, GrowthStage.SPROUT);
  }

  canPlacePlant(x: number, y: number): boolean {
    if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) return false;
    const tile = this.tiles[y][x];
    if (tile !== TileType.GRASS && tile !== TileType.BUILT_FLOOR) return false;
    if (this.plantGrid[y][x]) return false;
    if (this.treeGrid[y][x]) return false;
    if (this.rockGrid[y][x]) return false;
    return true;
  }

  removePlant(plantId: string): void {
    const idx = this.plants.findIndex(p => p.id === plantId);
    if (idx === -1) return;
    const plant = this.plants[idx];
    this.plantGrid[plant.y][plant.x] = null;
    this.plants.splice(idx, 1);
  }

  /** Harvest a plant. Returns amount + whether it was depleted + seed drop (for bush). */
  harvestPlant(plantId: string, amount: number): { harvested: number; depleted: boolean; seedDrop: boolean } | null {
    const plant = this.plants.find(p => p.id === plantId);
    if (!plant) return null;
    // Sprouts are not harvestable
    if (plant.growthStage === GrowthStage.SPROUT) return null;

    const harvested = Math.min(amount, plant.health);
    plant.health -= harvested;

    if (plant.health <= 0) {
      const seedDrop = plant.type === PlantType.BERRY_BUSH && Math.random() < cfg.plants.bushSeedDropChance;
      // Reduce fertility at harvest site
      this.adjustFertility(plant.x, plant.y, -0.1);
      // 50% of seeds go to soil seed bank
      if (seedDrop && Math.random() < 0.5) {
        this.addSeedToBank(plant.x, plant.y, plant.type);
      }
      this.plantGrid[plant.y][plant.x] = null;
      const idx = this.plants.indexOf(plant);
      if (idx !== -1) this.plants.splice(idx, 1);
      return { harvested, depleted: true, seedDrop };
    }

    return { harvested, depleted: false, seedDrop: false };
  }

  /** Consume a single-use plant (mushroom, flower, herb). Removes it. */
  consumePlant(plantId: string): PlantState | null {
    const plant = this.plants.find(p => p.id === plantId);
    if (!plant) return null;
    if (plant.growthStage === GrowthStage.SPROUT) return null;
    // Reduce fertility at consumption site
    this.adjustFertility(plant.x, plant.y, -0.1);
    // 50% chance to add seed to soil bank
    if (Math.random() < 0.5) {
      this.addSeedToBank(plant.x, plant.y, plant.type);
    }
    this.plantGrid[plant.y][plant.x] = null;
    const idx = this.plants.indexOf(plant);
    if (idx !== -1) this.plants.splice(idx, 1);
    return plant;
  }

  /** Find nearest plant of given types. */
  findNearestPlant(fromX: number, fromY: number, types: PlantType[], maxDist: number = 20): PlantState | null {
    let best: PlantState | null = null;
    let bestDist = Infinity;

    for (const plant of this.plants) {
      if (!types.includes(plant.type)) continue;
      const d = Math.abs(plant.x - fromX) + Math.abs(plant.y - fromY);
      if (d < bestDist && d <= maxDist) {
        bestDist = d;
        best = plant;
      }
    }
    return best;
  }

  getPlantAt(x: number, y: number): PlantState | null {
    const plantId = this.plantGrid[y]?.[x];
    if (!plantId) return null;
    return this.plants.find(p => p.id === plantId) ?? null;
  }

  // ─── Region & Fertility methods ───

  getRegion(x: number, y: number): RegionState {
    const rx = Math.min(Math.floor(x / REGION_SIZE), REGION_COLS - 1);
    const ry = Math.min(Math.floor(y / REGION_SIZE), REGION_ROWS - 1);
    return this.regions[Math.max(0, ry)][Math.max(0, rx)];
  }

  getFertility(x: number, y: number): number {
    if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) return 1.0;
    return this.fertility[y * WORLD_WIDTH + x];
  }

  adjustFertility(x: number, y: number, delta: number): void {
    if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) return;
    const idx = y * WORLD_WIDTH + x;
    this.fertility[idx] = Math.max(0, Math.min(3.0, this.fertility[idx] + delta));
  }

  /** Decay fertility toward 1.0 baseline. Staggers by processing 1/10 of rows per tick. */
  tickFertilityDecay(tickCount: number): void {
    const rowOffset = tickCount % 10;
    for (let y = rowOffset; y < WORLD_HEIGHT; y += 10) {
      const base = y * WORLD_WIDTH;
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const idx = base + x;
        const f = this.fertility[idx];
        if (f > 1.001) {
          this.fertility[idx] = f - 0.001;
        } else if (f < 0.999) {
          this.fertility[idx] = f + 0.001;
        }
      }
    }
  }

  /** Recount plant and herbivore populations per region. Call every ~50 ticks. */
  recountRegionStats(): void {
    // Reset counts
    for (let ry = 0; ry < REGION_ROWS; ry++) {
      for (let rx = 0; rx < REGION_COLS; rx++) {
        this.regions[ry][rx].plantCount = 0;
        this.regions[ry][rx].herbivoreCount = 0;
      }
    }
    // Count plants
    for (const plant of this.plants) {
      this.getRegion(plant.x, plant.y).plantCount++;
    }
    // Count herbivores
    for (const animal of this.animals) {
      if (!animal.alive) continue;
      const species = getSpecies(animal.species);
      if (species.diet === 'herbivore' || species.diet === 'omnivore') {
        this.getRegion(Math.floor(animal.x), Math.floor(animal.y)).herbivoreCount++;
      }
    }
  }

  /** Add seeds to region seed bank. Max 20 per plant type per region. */
  addSeedToBank(x: number, y: number, type: PlantType): void {
    const region = this.getRegion(x, y);
    const current = region.seedBank[type] ?? 0;
    if (current < 20) {
      region.seedBank[type] = current + 1;
    }
  }

  /** Tick seed sprouting: dormant seeds have 0.02% chance to sprout per tick. */
  tickSeedSprouting(): void {
    for (let ry = 0; ry < REGION_ROWS; ry++) {
      for (let rx = 0; rx < REGION_COLS; rx++) {
        const region = this.regions[ry][rx];
        const bank = region.seedBank;
        for (const typeStr of Object.keys(bank)) {
          const type = Number(typeStr) as PlantType;
          const count = bank[type] ?? 0;
          if (count <= 0) continue;

          // Each seed has 0.02% chance to sprout
          for (let i = 0; i < count; i++) {
            if (Math.random() >= 0.0002) continue;

            // Pick random tile within this region
            const baseX = rx * REGION_SIZE;
            const baseY = ry * REGION_SIZE;
            const tx = baseX + randomInt(0, REGION_SIZE - 1);
            const ty = baseY + randomInt(0, REGION_SIZE - 1);

            // Check cap
            const cap = this.plantCaps[type] ?? Infinity;
            const currentCount = this.plants.filter(p => p.type === type).length;
            if (currentCount >= cap) break;

            if (this.canPlacePlant(tx, ty)) {
              // Multiply sprout chance by local fertility (already passed probability check, but fertility affects whether we actually place)
              const fert = this.getFertility(tx, ty);
              if (Math.random() < fert / 1.0) { // fert >= 1.0 always succeeds, < 1.0 may fail
                this.placePlant(tx, ty, type, GrowthStage.SPROUT);
                bank[type] = (bank[type] ?? 1) - 1;
                if ((bank[type] ?? 0) <= 0) delete bank[type];
                break; // one sprout per type per region per tick
              }
            }
          }
        }
      }
    }
  }

  /** Count current iron ore tiles on the map. */
  countIronTiles(): number {
    let count = 0;
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        if (this.tiles[y][x] === TileType.IRON_ORE) count++;
      }
    }
    return count;
  }

  /** Respawn one iron ore deposit if below initial count. */
  respawnIron(): boolean {
    if (this.countIronTiles() >= this.initialIronCount) return false;

    for (let attempt = 0; attempt < 200; attempt++) {
      const ix = randomInt(2, WORLD_WIDTH - 3);
      const iy = randomInt(2, WORLD_HEIGHT - 3);
      if (this.tiles[iy][ix] !== TileType.DIRT) continue;
      if (this.rockGrid[iy][ix] || this.treeGrid[iy][ix] || this.plantGrid[iy][ix]) continue;
      // Prefer near rocks
      let nearRock = false;
      for (let dy = -2; dy <= 2 && !nearRock; dy++)
        for (let dx = -2; dx <= 2 && !nearRock; dx++)
          if (this.rockGrid[iy + dy]?.[ix + dx]) nearRock = true;
      if (!nearRock && Math.random() > 0.5) continue;

      this.tiles[iy][ix] = TileType.IRON_ORE;
      this.resourceHealth[iy][ix] = cfg.iron.health;
      return true;
    }
    return false;
  }

  getSerializedPlants(): PlantState[] {
    return this.plants.map(p => ({ ...p }));
  }

  getSerializedTiles(): number[][] {
    return this.tiles.map(row => [...row]);
  }

  getSerializedTrees(): TreeState[] {
    return this.trees.map(t => ({ ...t }));
  }

  getSerializedRocks(): RockState[] {
    return this.rocks.map(r => ({ ...r }));
  }

  // ─── Animal methods ───

  private spawnInitialAnimals(): void {
    const counts = WorldConfig.animals.spawnCounts;
    for (const [speciesId, count] of Object.entries(counts)) {
      const species = getSpecies(speciesId);
      for (let i = 0; i < count; i++) {
        const pos = this.findAnimalSpawnPosition(species.habitat);
        if (!pos) continue;

        const animal: AnimalState = {
          id: generateId(),
          species: speciesId,
          x: pos.x,
          y: pos.y,
          health: species.health,
          maxHealth: species.health,
          proteinHunger: randomInt(60, 90),
          plantHunger: randomInt(60, 90),
          thirst: 60 + Math.random() * 30,
          stamina: 60 + Math.random() * 30,
          baseStats: createAnimalBaseStats(species),
          skills: createSkillSet(),
          action: 'idle',
          actionTimer: 0,
          attackCooldown: 0,
          homeX: pos.x,
          homeY: pos.y,
          alive: true,
          age: 0,
          frame: 0,
          breedCooldown: 0,
          tamed: false,
          tamingProgress: 0,
          spatialMemory: [],
          foodDrop: species.foodDrop,
          drops: species.drops,
        };
        this.animals.push(animal);
      }
    }
  }

  findAnimalSpawnPosition(habitats: string[]): { x: number; y: number } | null {
    for (let attempt = 0; attempt < 50; attempt++) {
      const x = randomInt(0, WORLD_WIDTH - 1);
      const y = randomInt(0, WORLD_HEIGHT - 1);

      for (const habitat of habitats) {
        if (this.isValidHabitat(x, y, habitat)) {
          return { x, y };
        }
      }
    }
    return null;
  }

  private isValidHabitat(x: number, y: number, habitat: string): boolean {
    const tile = this.getTile(x, y);

    switch (habitat) {
      case 'forest': {
        if (tile !== TileType.GRASS) return false;
        // Must have a tree within 3 tiles
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            if (this.getTile(x + dx, y + dy) === TileType.TREE) return true;
          }
        }
        return false;
      }
      case 'grassland': {
        if (tile !== TileType.GRASS) return false;
        // Must NOT have trees within 3 tiles
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            if (this.getTile(x + dx, y + dy) === TileType.TREE) return false;
          }
        }
        return true;
      }
      case 'water_edge': {
        if (tile !== TileType.GRASS && tile !== TileType.SAND) return false;
        // Must have water within 2 tiles
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (this.getTile(x + dx, y + dy) === TileType.WATER) return true;
          }
        }
        return false;
      }
      case 'rocky': {
        return tile === TileType.DIRT;
      }
      case 'settlement': {
        // Settlement = near built structures
        return tile === TileType.GRASS || tile === TileType.BUILT_FLOOR;
      }
      default:
        return false;
    }
  }

  removeAnimal(id: string): void {
    const idx = this.animals.findIndex(a => a.id === id);
    if (idx !== -1) {
      this.animals.splice(idx, 1);
    }
  }

  getSerializedAnimals(): AnimalState[] {
    return this.animals.map(a => ({ ...a }));
  }

  getSerializedCorpses(): CorpseState[] {
    return this.corpses.map(c => ({ ...c, materials: { ...c.materials }, carriedResources: c.carriedResources ? { ...c.carriedResources } : undefined }));
  }

  spawnCorpse(
    x: number, y: number, sourceType: 'agent' | 'animal',
    materials: Partial<DropTable>, tick: number,
    sourceSpecies?: string, sourceName?: string,
    carriedResources?: Partial<Resources>
  ): CorpseState {
    const corpse: CorpseState = {
      id: generateId(),
      x: Math.floor(x), y: Math.floor(y),
      sourceType,
      sourceSpecies,
      sourceName,
      materials,
      carriedResources,
      createdAt: tick,
      decayAt: tick + 600,
    };
    this.corpses.push(corpse);
    return corpse;
  }

  findNearestCorpse(x: number, y: number, maxRange: number): CorpseState | null {
    let nearest: CorpseState | null = null;
    let nearestDist = Infinity;
    for (const corpse of this.corpses) {
      const d = distance(x, y, corpse.x, corpse.y);
      if (d < maxRange && d < nearestDist) {
        nearest = corpse;
        nearestDist = d;
      }
    }
    return nearest;
  }

  // ─── Structure entity methods ───

  placeStructure(x: number, y: number, tileType: TileType, ownerId?: string, tick: number = 0): StructureState | null {
    const maxHp = (cfg.structures.maxHp as Record<number, number>)[tileType];
    if (!maxHp) return null; // not a structure tile type

    const structure: StructureState = {
      id: generateId(),
      tileType,
      x, y,
      hp: maxHp,
      maxHp,
      ownerId,
      storedItems: tileType === TileType.STORAGE ? [] : undefined,
      lastMaintained: tick,
    };
    this.structures.push(structure);
    return structure;
  }

  getStructureAt(x: number, y: number): StructureState | null {
    return this.structures.find(s => s.x === x && s.y === y) ?? null;
  }

  damageStructure(id: string, damage: number): boolean {
    const s = this.structures.find(s => s.id === id);
    if (!s) return false;
    s.hp -= damage;
    if (s.hp <= 0) {
      // Destroy structure
      this.tiles[s.y][s.x] = TileType.GRASS;
      this.structures = this.structures.filter(st => st.id !== id);
      return true; // destroyed
    }
    return false;
  }

  tickStructureDecay(currentTick: number): { x: number; y: number; type: TileType }[] {
    const changes: { x: number; y: number; type: TileType }[] = [];
    const decayRate = cfg.structures.woodDecayRate as number;
    const woodDecayTiles = cfg.structures.woodDecayTiles as readonly number[];

    for (let i = this.structures.length - 1; i >= 0; i--) {
      const s = this.structures[i];
      if (!woodDecayTiles.includes(s.tileType)) continue;

      const ticksSinceMaintained = currentTick - s.lastMaintained;
      if (ticksSinceMaintained > 0 && ticksSinceMaintained % decayRate === 0) {
        s.hp--;
        if (s.hp <= 0) {
          this.tiles[s.y][s.x] = TileType.GRASS;
          changes.push({ x: s.x, y: s.y, type: TileType.GRASS });
          this.structures.splice(i, 1);
        }
      }
    }
    return changes;
  }

  getSerializedStructures(): StructureState[] {
    return this.structures.map(s => ({
      ...s,
      storedItems: s.storedItems ? [...s.storedItems] : undefined,
    }));
  }
}
