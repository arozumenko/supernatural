import { EventEmitter } from 'events';
import {
  AgentState, TileType, TICK_RATE, MAX_AGENTS, PersonalityTrait,
  SocialInteraction, generateId, distance, clamp, randomInt,
  WORLD_WIDTH, WORLD_HEIGHT, getCurrentSeason, SEASON_MODIFIERS,
  GameConfig, DEFAULT_GAME_CONFIG
} from '../shared/src/index.ts';
import { World } from './World.ts';
import { WorldConfig } from './WorldConfig.ts';
import { createAgent } from './Agent.ts';
import { decayNeeds, decideAction, executeAction } from './ai/NeedsSystem.ts';
import { decayAnimalNeeds, decideAnimalAction, executeAnimalAction } from './ai/AnimalAI.ts';
import { getSpecies } from './AnimalSpeciesConfig.ts';
import { createAnimalBaseStats, createSkillSet, applyDeathPenalty, getCarryWeight, getCarryCapacity } from './Progression.ts';
import { initJournal, detectDeathCause, finalizeJournal, recordTimelineEntry, recordHeatmapEntry, tickMetrics, setApiEventEmitter } from './ai/LifeJournal.ts';
import { calculateLivesChange, checkHighlander } from './ai/LivesEconomy.ts';
import { applyFallbackMutation } from './ai/FallbackEvolution.ts';
import { EvolutionQueue } from './ai/EvolutionQueue.ts';

import type { TreeState, RockState, PlantState, AnimalState, CorpseState, StructureState, SkillSet, Season, BehaviorGenome } from '../shared/src/index.ts';

export interface GameEvents {
  onWorldUpdate: (agents: AgentState[], tileChanges: { x: number; y: number; type: TileType }[], trees: TreeState[], rocks: RockState[], plants: PlantState[], animals: AnimalState[], corpses: CorpseState[], structures: StructureState[], season: Season) => void;
  onAgentDied: (agentId: string, name: string, cause: string) => void;
  onAgentBorn: (agent: AgentState) => void;
  onSocialInteraction: (interaction: SocialInteraction) => void;
  onWorldEvent: (event: { type: string; message: string; x?: number; y?: number }) => void;
  onAgentPermadeath: (agentId: string, name: string, achievements: string[]) => void;
}

export class GameLoop {
  world: World;
  agents: AgentState[];
  events: GameEvents;
  tickCount: number = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private respawnQueue: { agent: AgentState; respawnTick: number }[] = [];
  private animalRespawnQueue: { species: string; respawnTick: number; skills: SkillSet }[] = [];
  private queuedDeadAnimalIds: Set<string> = new Set();
  private evolutionQueue: EvolutionQueue = new EvolutionQueue();
  apiEventEmitter: EventEmitter = new EventEmitter();

  gameConfig: GameConfig;

  constructor(events: GameEvents, config?: GameConfig) {
    this.gameConfig = config ?? DEFAULT_GAME_CONFIG;
    // Apply config overrides to WorldConfig
    if (config) {
      (WorldConfig.water as any).minCoverage = config.waterCoverage;
      (WorldConfig as any).natureBudgetRatio = config.natureBudget;
      (WorldConfig.animals as any).maxTotal = config.maxAnimals;

      // Scale animal spawn counts proportionally to world area and animal slider
      const baseArea = 120 * 90; // default map area
      const newArea = config.worldWidth * config.worldHeight;
      const areaRatio = newArea / baseArea;
      const animalRatio = config.maxAnimals / 200; // 200 = default maxAnimals
      const scale = areaRatio * animalRatio;
      const baseCounts = {
        'bear': 2, 'tiger': 1, 'alligator': 2,
        'fox': 3, 'cat': 2, 'dog-0': 3, 'rat': 5,
        'deer': 4, 'cow-0': 3, 'horse': 2,
        'pig': 4, 'goat': 3, 'sheep': 5, 'donkey': 2,
        'rabbit': 6, 'chicken': 5, 'duck': 4, 'squirrel': 4, 'hedgehog': 2, 'capybara': 3,
      };
      const scaledCounts: Record<string, number> = {};
      for (const [species, count] of Object.entries(baseCounts)) {
        scaledCounts[species] = Math.max(1, Math.round(count * scale));
      }
      (WorldConfig.animals as any).spawnCounts = scaledCounts;
    }
    this.world = new World();
    this.agents = [];
    this.events = events;
    setApiEventEmitter(this.apiEventEmitter);

    // Spawn initial agents
    const agentCount = this.gameConfig.agentCount;
    for (let i = 0; i < agentCount; i++) {
      const agent = createAgent(undefined, undefined, undefined, this.world);
      // Assign LLM provider + role from config
      if (config?.agentLLMAssignments) {
        const assignment = config.agentLLMAssignments[i];
        if (assignment && typeof assignment === 'object') {
          agent.llmProviderId = assignment.providerId;
          agent.llmRole = assignment.role;
        }
      }
      // Initialize life journal
      initJournal(agent, 0);
      this.agents.push(agent);
    }
  }

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.tick(), 1000 / TICK_RATE);
    console.log(`Game loop started at ${TICK_RATE} ticks/sec`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  tick(): void {
    this.tickCount++;
    const allTileChanges: { x: number; y: number; type: TileType }[] = [];
    const allInteractions: SocialInteraction[] = [];

    // World tick (regrowth — now uses fertility, season, carrying capacity)
    const worldChanges = this.world.tick(this.tickCount);
    allTileChanges.push(...worldChanges);

    // Fertility decay toward baseline
    this.world.tickFertilityDecay(this.tickCount);

    // Seed sprouting (dormant seeds → new plants)
    this.world.tickSeedSprouting();

    // Recount region stats every 50 ticks
    if (this.tickCount % 50 === 0) {
      this.world.recountRegionStats();
    }

    // Iron ore slow respawn (1 deposit every 30 real minutes = 18000 ticks)
    if (this.tickCount % 18000 === 0 && this.tickCount > 0) {
      this.world.respawnIron();
    }

    // Corpse decay (with fertility boost on decomposition)
    this.world.tickCorpseDecay(this.tickCount);

    // Agent updates
    for (const agent of this.agents) {
      if (!agent.alive) continue;

      // Decay needs
      decayNeeds(agent);

      // Update carry weight/capacity for client display
      agent.carryWeight = getCarryWeight(agent.inventory);
      agent.carryCapacity = getCarryCapacity(agent.baseStats, agent.skills, agent.inventory);

      // Track life ticks and journal metrics
      agent.currentLifeTicks = (agent.currentLifeTicks ?? 0) + 1;
      tickMetrics(agent);

      // Timeline sampling (every 100 ticks)
      if (this.tickCount % 100 === 0) {
        recordTimelineEntry(agent, this.tickCount);
      }
      // Heatmap sampling (every 300 ticks)
      if (this.tickCount % 300 === 0) {
        recordHeatmapEntry(agent, this.tickCount);
      }

      // Check for late-arriving LLM genome hot-swap
      if (this.evolutionQueue.isProcessing(agent.id)) {
        const hotSwap = this.evolutionQueue.getPendingGenome(agent.id);
        if (hotSwap) {
          (agent as any).currentGenome = hotSwap;
          agent.genomeVersion = hotSwap.version;
          agent.activeStrategyRuleNames = hotSwap.strategyRules
            .filter(r => r.enabled).map(r => r.name);
          console.log(`[Evolution] Hot-swapped genome for ${agent.name} to v${hotSwap.version}`);
        }
      }

      if (!agent.alive) {
        // --- Memory system: rich death handling ---
        const deathCause = detectDeathCause(agent, this.tickCount);
        const cause = deathCause.type;

        // Finalize life journal
        const journal = finalizeJournal(agent, deathCause, this.tickCount);

        // Update best survival time
        if (journal.survivalTicks > (agent.lifetimeBestSurvival ?? 0)) {
          agent.lifetimeBestSurvival = journal.survivalTicks;
        }

        // Calculate lives change
        const livesChange = calculateLivesChange(journal, agent);
        agent.livesRemaining = Math.max(0, (agent.livesRemaining ?? 100) + livesChange);

        // Archive journal (ring buffer: keep last 20)
        const archive: any[] = (agent as any).journalArchive ?? [];
        archive.unshift(journal);
        if (archive.length > 20) {
          // Strip timeline from journals 6+
          for (let j = 5; j < Math.min(archive.length, 20); j++) {
            archive[j].timeline = [];
            archive[j].events = [];
            archive[j].heatmap = [];
          }
          archive.length = 20;
        }
        (agent as any).journalArchive = archive;

        // Apply death penalty: 5% XP rust
        applyDeathPenalty(agent.skills);
        agent.totalDeaths++;

        // Check Highlander status
        agent.isHighlander = checkHighlander(agent);

        // Permadeath check
        if (agent.livesRemaining <= 0) {
          // Permanent death — no respawn
          this.events.onAgentPermadeath(agent.id, agent.name, agent.achievements ?? []);
          this.events.onAgentDied(agent.id, agent.name, cause);
          this.events.onWorldEvent({
            type: 'permadeath',
            message: `${agent.name} has permanently died (0 lives remaining)`,
            x: agent.x,
            y: agent.y,
          });
          // Create corpse but don't queue respawn
          const size = (agent.baseStats.strength + agent.baseStats.toughness + agent.baseStats.endurance) / 3;
          this.world.spawnCorpse(
            agent.x, agent.y, 'agent',
            {
              meat: Math.floor(4 + size / 3),
              bone: Math.floor(2 + size / 5),
              hide: Math.floor(1 + size / 5),
              fat: Math.floor(1 + size / 5),
              sinew: Math.floor(1 + size / 7),
            }, this.tickCount,
            undefined, agent.name,
            { ...agent.resources }
          );
          continue;
        }

        // Queue evolution (async, non-blocking)
        if (agent.llmProviderId) {
          this.evolutionQueue.queueEvolution(agent, journal, archive.slice(0, 5));
        } else {
          // Fallback-only mutation
          const genome: BehaviorGenome = (agent as any).currentGenome;
          if (genome) {
            applyFallbackMutation(genome, deathCause);
            agent.genomeVersion = genome.version;
          }
        }

        // Create corpse at death position with stat-based drops
        const size = (agent.baseStats.strength + agent.baseStats.toughness + agent.baseStats.endurance) / 3;
        this.world.spawnCorpse(
          agent.x, agent.y, 'agent',
          {
            meat: Math.floor(4 + size / 3),
            bone: Math.floor(2 + size / 5),
            hide: Math.floor(1 + size / 5),
            fat: Math.floor(1 + size / 5),
            sinew: Math.floor(1 + size / 7),
          }, this.tickCount,
          undefined, agent.name,
          { ...agent.resources }
        );
        // Reset taming for all animals tamed by this agent
        for (const animal of this.world.animals) {
          if (animal.tamedBy === agent.id) {
            animal.tamed = false;
            animal.tamedBy = undefined;
            animal.tamingProgress = 0;
          }
        }
        // Queue for respawn after 300 ticks (30 seconds)
        this.respawnQueue.push({ agent, respawnTick: this.tickCount + 300 });
        this.events.onAgentDied(agent.id, agent.name, cause);
        this.events.onWorldEvent({
          type: 'death',
          message: `${agent.name} died of ${cause}`,
          x: agent.x,
          y: agent.y,
        });
        continue;
      }

      // Decide and execute (staggered: full re-decision every 3 ticks per agent)
      const aliveAgents = this.agents.filter(a => a.alive);
      const agentIndex = aliveAgents.indexOf(agent);
      const shouldRedecide = (this.tickCount + agentIndex) % 3 === 0;

      let decision: ReturnType<typeof decideAction>;
      if (shouldRedecide || agent.action === 'idle' || agent.action === 'wandering') {
        // Full re-evaluation
        decision = decideAction(agent, this.world, aliveAgents, this.tickCount, agentIndex);
      } else {
        // Continue current action — only interrupt for critical survival
        decision = decideAction(agent, this.world, aliveAgents, this.tickCount, agentIndex, true);
      }
      const result = executeAction(agent, decision, this.world, aliveAgents);
      allTileChanges.push(...result.tileChanges);
      allInteractions.push(...result.interactions);
    }

    // Broadcast interactions
    for (const interaction of allInteractions) {
      this.events.onSocialInteraction(interaction);
    }

    // Process agent respawn queue
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      if (this.tickCount >= this.respawnQueue[i].respawnTick) {
        const agent = this.respawnQueue[i].agent;
        // Find grass tile near world center for respawn
        const cx = Math.floor(WORLD_WIDTH / 2);
        const cy = Math.floor(WORLD_HEIGHT / 2);
        for (let attempt = 0; attempt < 100; attempt++) {
          const rx = cx + randomInt(-5, 5);
          const ry = cy + randomInt(-5, 5);
          if (this.world.getTile(rx, ry) === TileType.GRASS && this.world.isWalkable(rx, ry)) {
            agent.x = rx;
            agent.y = ry;
            break;
          }
        }
        agent.needs = { proteinHunger: 100, plantHunger: 100, thirst: 100, stamina: 100, health: 100, social: 50, shelter: 20 };
        agent.alive = true;
        agent.action = 'idle';
        agent.resources = { wood: 0, stone: 0, food: 0, water: 0, treeSeed: 0, plantSeed: 0, meat: 0, bone: 0, hide: 0, sinew: 0, fat: 0, feathers: 0, teeth_claws: 0, scales: 0, iron_ore: 0, iron_ingot: 0 };
        agent.inventory = { items: [], equipped: {} };

        // Check for pending genome from LLM evolution
        const pendingGenome = this.evolutionQueue.getPendingGenome(agent.id);
        if (pendingGenome) {
          (agent as any).currentGenome = pendingGenome;
          agent.genomeVersion = pendingGenome.version;
          agent.activeStrategyRuleNames = pendingGenome.strategyRules
            .filter(r => r.enabled).map(r => r.name);
        }

        // Start fresh journal for new life
        agent.currentLifeTicks = 0;
        initJournal(agent, this.tickCount);

        this.respawnQueue.splice(i, 1);
        this.events.onAgentBorn(agent);
        this.events.onWorldEvent({
          type: 'respawn',
          message: `${agent.name} has returned (${agent.livesRemaining} lives)`,
          x: agent.x,
          y: agent.y,
        });
      }
    }

    // Season state for this tick
    const season = getCurrentSeason(this.tickCount);
    const seasonMod = SEASON_MODIFIERS[season];

    // Animal updates (staggered: full AI for 1/5 of animals per tick)
    const staggerOffset = this.tickCount % 5;
    const animalOffspring: AnimalState[] = [];
    for (let i = 0; i < this.world.animals.length; i++) {
      const animal = this.world.animals[i];
      if (!animal.alive) continue;

      const species = getSpecies(animal.species);
      // Decay needs every tick (not staggered)
      decayAnimalNeeds(animal, species, seasonMod.staminaDecayMult);

      let offspring;
      if (i % 5 === staggerOffset) {
        // Full AI decision (staggered)
        const decision = decideAnimalAction(animal, species, this.world, this.world.animals, this.tickCount, this.agents);
        offspring = executeAnimalAction(animal, decision, species, this.world, this.world.animals, this.agents);
      } else {
        // Continue current action
        offspring = executeAnimalAction(animal, { action: animal.action, target: animal.target, targetEntityId: animal.targetEntityId, score: 0 }, species, this.world, this.world.animals, this.agents);
      }
      // Collect offspring from breeding/egg-laying
      if (offspring) {
        for (const o of offspring) {
          if (this.world.animals.length + animalOffspring.length >= WorldConfig.animals.maxTotal) break;
          animalOffspring.push({
            id: generateId(),
            species: o.species,
            x: o.x, y: o.y,
            health: o.health, maxHealth: o.maxHealth,
            proteinHunger: o.proteinHunger, plantHunger: o.plantHunger,
            thirst: o.thirst, stamina: o.stamina,
            baseStats: createAnimalBaseStats(getSpecies(o.species)),
            skills: createSkillSet(),
            action: 'idle', actionTimer: 0, attackCooldown: 0,
            homeX: animal.homeX, homeY: animal.homeY,
            alive: true, age: 0, frame: 0,
            breedCooldown: o.breedCooldown,
            tamed: false, tamingProgress: 0,
            spatialMemory: [],
            packId: o.packId,
            foodDrop: getSpecies(o.species).foodDrop,
            drops: getSpecies(o.species).drops,
          });
        }
      }
    }
    if (animalOffspring.length > 0) {
      this.world.animals.push(...animalOffspring);
    }

    // Handle breeding: spawn offspring from animals that just finished breeding
    const newAnimals: AnimalState[] = [];
    for (const animal of this.world.animals) {
      if (!animal.alive) continue;
      if (animal.action === 'breeding' && animal.actionTimer <= 0) {
        const species = getSpecies(animal.species);

        // Herbivore breeding tied to plant availability
        const plantRatio = this.world.initialPlantCount > 0
          ? this.world.plants.length / this.world.initialPlantCount
          : 1;
        if ((species.diet === 'herbivore' || species.diet === 'omnivore') && plantRatio < 0.3) {
          // Plants too scarce — suppress herbivore breeding
          animal.breedCooldown = species.breedCooldown;
          animal.action = 'idle';
          continue;
        }

        // Check population cap
        const speciesCount = this.world.animals.filter(a => a.alive && a.species === animal.species).length;
        if (speciesCount >= species.maxPopulation) {
          animal.action = 'idle';
          continue;
        }
        if (this.world.animals.length >= WorldConfig.animals.maxTotal) {
          animal.action = 'idle';
          continue;
        }

        const litterSize = species.litterSize[0] + Math.floor(Math.random() * (species.litterSize[1] - species.litterSize[0] + 1));
        for (let i = 0; i < litterSize; i++) {
          if (this.world.animals.length + newAnimals.length >= WorldConfig.animals.maxTotal) break;
          const offspring: AnimalState = {
            id: generateId(),
            species: animal.species,
            x: animal.x + (Math.random() - 0.5) * 2,
            y: animal.y + (Math.random() - 0.5) * 2,
            health: species.health * 0.5,
            maxHealth: species.health,
            proteinHunger: 70,
            plantHunger: 70,
            thirst: 70,
            stamina: 70,
            baseStats: createAnimalBaseStats(species),
            skills: createSkillSet(),
            action: 'idle',
            actionTimer: 0,
            attackCooldown: 0,
            homeX: animal.homeX,
            homeY: animal.homeY,
            alive: true,
            age: 0,
            frame: 0,
            breedCooldown: Math.floor(species.breedCooldown * 2 * seasonMod.breedingCooldownMult
              * (plantRatio > 0.8 && (species.diet === 'herbivore' || species.diet === 'omnivore') ? 0.7 : 1.0)),
            tamed: animal.tamed,
            tamedBy: animal.tamedBy,
            tamingProgress: animal.tamed ? species.tamingCost : 0,
            spatialMemory: [],
            packId: animal.packId,
            foodDrop: species.foodDrop,
            drops: species.drops,
          };
          newAnimals.push(offspring);
        }
        animal.action = 'idle';
      }
    }
    this.world.animals.push(...newAnimals);

    // Winter migration: gradually shift animal home positions toward world center
    if (seasonMod.migrationActive && this.tickCount % 100 === 0) {
      const cx = WORLD_WIDTH / 2;
      const cy = WORLD_HEIGHT / 2;
      for (const animal of this.world.animals) {
        if (!animal.alive) continue;
        const dx = cx - animal.homeX;
        const dy = cy - animal.homeY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 10) {
          animal.homeX += dx / dist * 0.5;
          animal.homeY += dy / dist * 0.5;
        }
      }
    }

    // Animal-Agent combat is now handled directly through the AnimalAI hunting/fighting system
    // (findPrey includes agents, executeAnimalAction handles agent targets)

    // Queue dead animals for respawn and create corpses
    for (const animal of this.world.animals) {
      if (!animal.alive && !this.queuedDeadAnimalIds.has(animal.id)) {
        this.queuedDeadAnimalIds.add(animal.id);
        const species = getSpecies(animal.species);
        // Create corpse with randomized drops (0.8-1.2 modifier per material)
        if (species.drops && Object.keys(species.drops).length > 0) {
          const calculatedDrops: Partial<typeof species.drops> = {};
          for (const [mat, amount] of Object.entries(species.drops)) {
            if (amount && amount > 0) {
              const modifier = (0.8 + Math.random() * 0.4) * seasonMod.foodDropMult;
              (calculatedDrops as any)[mat] = Math.max(1, Math.round(amount * modifier));
            }
          }
          this.world.spawnCorpse(
            animal.x, animal.y, 'animal',
            calculatedDrops, this.tickCount,
            animal.species
          );
        }
        const speciesCount = this.world.animals.filter(a => a.alive && a.species === animal.species).length;
        if (speciesCount < species.maxPopulation) {
          applyDeathPenalty(animal.skills);
          const delay = Math.floor(species.breedCooldown * 0.1);
          // Deep copy skills so respawned animal preserves XP-penalized levels
          const skillsCopy: SkillSet = {} as SkillSet;
          for (const key of Object.keys(animal.skills) as (keyof SkillSet)[]) {
            skillsCopy[key] = { ...animal.skills[key] };
          }
          this.animalRespawnQueue.push({
            species: animal.species,
            respawnTick: this.tickCount + delay,
            skills: skillsCopy,
          });
        }
      }
    }
    // Remove dead animals after 50 ticks and clean up tracking set
    const removedAnimals = this.world.animals.filter(a => !a.alive && a.age >= 50);
    for (const removed of removedAnimals) {
      this.queuedDeadAnimalIds.delete(removed.id);
    }
    this.world.animals = this.world.animals.filter(a => a.alive || a.age < 50);

    // Process animal respawn queue
    for (let i = this.animalRespawnQueue.length - 1; i >= 0; i--) {
      if (this.tickCount >= this.animalRespawnQueue[i].respawnTick) {
        const entry = this.animalRespawnQueue[i];
        const species = getSpecies(entry.species);
        const speciesCount = this.world.animals.filter(a => a.alive && a.species === entry.species).length;
        if (speciesCount < species.maxPopulation && this.world.animals.length < WorldConfig.animals.maxTotal) {
          const pos = this.world.findAnimalSpawnPosition(species.habitat);
          if (pos) {
            const newAnimal: AnimalState = {
              id: generateId(),
              species: entry.species,
              x: pos.x,
              y: pos.y,
              health: species.health,
              maxHealth: species.health,
              proteinHunger: randomInt(60, 90),
              plantHunger: randomInt(60, 90),
              thirst: 60 + Math.random() * 30,
              stamina: 60 + Math.random() * 30,
              baseStats: createAnimalBaseStats(species),
              skills: Object.fromEntries(
                Object.entries(entry.skills).map(([k, v]) => [k, { ...v }])
              ) as SkillSet,
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
            this.world.animals.push(newAnimal);
          }
        }
        this.animalRespawnQueue.splice(i, 1);
      }
    }

    // Structure decay
    const structureChanges = this.world.tickStructureDecay(this.tickCount);
    allTileChanges.push(...structureChanges);

    // Decay corpses
    this.world.corpses = this.world.corpses.filter(c => this.tickCount < c.decayAt);

    // Meat spoilage: raw meat becomes rotten_meat every 300 ticks (~30 seconds)
    if (this.tickCount % 300 === 0) {
      for (const agent of this.agents) {
        if (!agent.alive) continue;
        if (agent.resources.meat > 0) {
          agent.resources.meat--;
          // Add rotten_meat to inventory instead of just discarding
          const existing = agent.inventory.items.find(i => i.itemId === 'rotten_meat');
          if (existing) {
            existing.quantity++;
          } else {
            agent.inventory.items.push({ itemId: 'rotten_meat', quantity: 1 });
          }
        }
      }
    }

    // Periodic events
    if (this.tickCount % (TICK_RATE * 30) === 0) {
      // Every 30 seconds: world event
      this.periodicEvents();
    }

    // Broadcast state
    this.events.onWorldUpdate(this.agents, allTileChanges, this.world.getSerializedTrees(), this.world.getSerializedRocks(), this.world.getSerializedPlants(), this.world.getSerializedAnimals(), this.world.getSerializedCorpses(), this.world.getSerializedStructures(), season);
  }

  getAgent(agentId: string): AgentState | undefined {
    return this.agents.find(a => a.id === agentId);
  }

  spawnAgent(name?: string, personality?: PersonalityTrait[], ownerId?: string): AgentState | null {
    if (this.agents.filter(a => a.alive).length >= MAX_AGENTS) return null;

    const agent = createAgent(name, personality, ownerId, this.world);
    this.agents.push(agent);
    this.events.onAgentBorn(agent);
    this.events.onWorldEvent({
      type: 'birth',
      message: `${agent.name} has entered the world`,
      x: agent.x,
      y: agent.y,
    });
    return agent;
  }

  sendMessage(agentId: string, playerId: string, content: string): boolean {
    const agent = this.agents.find(a => a.id === agentId && a.alive);
    if (!agent) return false;

    // Calculate message cost based on social ladder
    const cost = Math.max(1, 10 - Math.floor(agent.socialScore / 10));

    agent.messageQueue.push({
      id: generateId(),
      fromPlayer: playerId,
      toAgent: agentId,
      content,
      timestamp: Date.now(),
      cost,
      followed: null,
    });

    return true;
  }

  private periodicEvents(): void {
    const aliveCount = this.agents.filter(a => a.alive).length;

    // If population is low, spawn new agents
    if (aliveCount < WorldConfig.agents.minPopulation) {
      const agent = createAgent(undefined, undefined, undefined, this.world);
      this.agents.push(agent);
      this.events.onAgentBorn(agent);
      this.events.onWorldEvent({
        type: 'migration',
        message: `${agent.name} has wandered into the area`,
        x: agent.x,
        y: agent.y,
      });
    }

    // Announce population stats
    const avgHunger = this.agents
      .filter(a => a.alive)
      .reduce((sum, a) => sum + Math.min(a.needs.proteinHunger, a.needs.plantHunger), 0) / Math.max(aliveCount, 1);

    if (avgHunger < 30) {
      this.events.onWorldEvent({
        type: 'famine',
        message: 'The settlement is running low on food...',
      });
    }
  }

  getState() {
    return {
      tiles: this.world.getSerializedTiles(),
      agents: this.agents,
      trees: this.world.getSerializedTrees(),
      rocks: this.world.getSerializedRocks(),
      plants: this.world.getSerializedPlants(),
      animals: this.world.getSerializedAnimals(),
      corpses: this.world.getSerializedCorpses(),
      structures: this.world.getSerializedStructures(),
      tickCount: this.tickCount,
    };
  }
}
