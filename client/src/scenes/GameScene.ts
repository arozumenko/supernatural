import Phaser from 'phaser';
import {
  TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT, TileType, AgentState, TreeState, RockState, PlantState, PlantType, AnimalState, CorpseState, StructureState, SkillSet,
  GameConfig, DEFAULT_GAME_CONFIG, applyGameConfig
} from '@supernatural/shared';
import { generateTileTextures, generateAgentTextures, getBlendedTextureKey } from '../sprites/TileGenerator.js';
import { SocketClient, WorldInitData, WorldUpdateData } from '../network/SocketClient.js';
import { UIScene } from './UIScene.js';

const PIXEL_FONT = '"Press Start 2P", monospace';
const PANEL_W = 380;
const SIDEBAR_W = 300;

interface AgentSprite {
  sprite: Phaser.GameObjects.Sprite;
  nameText: Phaser.GameObjects.Text;
  actionText: Phaser.GameObjects.Text;
  needsBar: Phaser.GameObjects.Graphics;
  crownText?: Phaser.GameObjects.Text;
  lastHealth?: number;
  hitFlashUntil?: number;
}

interface TreeSprite {
  sprite: Phaser.GameObjects.Sprite;
}

interface RockSprite {
  sprite: Phaser.GameObjects.Sprite;
}

export class GameScene extends Phaser.Scene {
  private client!: SocketClient;
  private tilemap!: Phaser.GameObjects.Group;
  private tileSprites: Phaser.GameObjects.Sprite[][] = [];
  private agentSprites: Map<string, AgentSprite> = new Map();
  private treeSprites: Map<string, TreeSprite> = new Map();
  private rockSprites: Map<string, RockSprite> = new Map();
  private plantSprites: Map<string, { sprite: Phaser.GameObjects.Sprite }> = new Map();
  private animalSprites: Map<string, { sprite: Phaser.GameObjects.Sprite; labelText: Phaser.GameObjects.Text; lastHealth?: number; hitFlashUntil?: number }> = new Map();
  private corpseSprites: Map<string, { sprite: Phaser.GameObjects.Sprite }> = new Map();
  private agents: AgentState[] = [];
  private trees: TreeState[] = [];
  private rocks: RockState[] = [];
  private plants: PlantState[] = [];
  private animalsList: AnimalState[] = [];
  private corpses: CorpseState[] = [];
  private structuresList: StructureState[] = [];
  private selectedAgent: AgentState | null = null;
  private selectedTree: TreeState | null = null;
  private selectedRock: RockState | null = null;
  private selectedPlant: PlantState | null = null;
  private selectedAnimal: AnimalState | null = null;
  private selectedCorpse: CorpseState | null = null;
  private selectedStructure: StructureState | null = null;
  private selectedWaterTile: { x: number; y: number } | null = null;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: Record<string, Phaser.Input.Keyboard.Key>;
  private showingMessagePrompt = false;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private tombstones: { sprite: Phaser.GameObjects.Sprite; nameText: Phaser.GameObjects.Text; expireTime: number }[] = [];
  private cameraFollow = false;
  private followIndicator!: Phaser.GameObjects.Text;

  private get ui(): UIScene {
    return this.scene.get('UIScene') as UIScene;
  }

  constructor() {
    super({ key: 'GameScene' });
  }

  preload(): void {
    // Base tiles
    this.load.image('ts_grass', 'assets/tileset/tile_grass.png');
    this.load.image('ts_sand', 'assets/tileset/tile_sand.png');
    this.load.image('ts_floor', 'assets/tileset/tile_floor.png');
    this.load.image('ts_base_ground', 'assets/tileset/tile_base_ground.png');

    // Autotile spritesheets (8 cols × 6 rows = 48 frames each)
    this.load.spritesheet('at_grass', 'assets/tileset/autotile_grass.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('at_water', 'assets/tileset/autotile_water.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('at_dirt', 'assets/tileset/autotile_dirt.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('at_sand', 'assets/tileset/autotile_sand.png', { frameWidth: 32, frameHeight: 32 });

    // Tree sprites (64x64 = 2x2 tiles) and stump (32x32)
    this.load.image('tree_type0', 'assets/tileset/tree_type0.png');
    this.load.image('tree_type1', 'assets/tileset/tree_type1.png');
    this.load.image('tree_stump', 'assets/tileset/tree_stump.png');

    // Rock sprites (32x32)
    this.load.image('rock_small', 'assets/tileset/rock_small.png');
    this.load.image('rock_big', 'assets/tileset/rock_big.png');
    this.load.image('rock_rubble', 'assets/tileset/rock_rubble.png');

    // Tombstone and corpse sprites (32x32)
    this.load.image('tombstone', 'assets/tileset/tombstone.png');
    this.load.image('corpse_marker', 'assets/tileset/corpse_marker.png');

    // Plant sprites (32x32)
    this.load.image('plant_mushroom', 'assets/tileset/plant_mushroom.png');
    this.load.image('plant_poison', 'assets/tileset/plant_poison.png');
    this.load.image('plant_flower', 'assets/tileset/plant_flower.png');
    this.load.image('plant_stamina', 'assets/tileset/plant_stamina.png');
    this.load.image('plant_hunger', 'assets/tileset/plant_hunger.png');
    this.load.image('plant_bush', 'assets/tileset/plant_bush.png');
    this.load.image('plant_edible_flower', 'assets/tileset/plant_edible_flower.png');

    // Animal sprites (32x32, 2 frames each)
    const animalSpecies = ['alligator','bear','capybara','cat','chicken','cow-0','deer','dog-0','donkey','duck','fox','goat','hedgehog','horse','pig','rabbit','rat','sheep','squirrel','tiger'];
    for (const sp of animalSpecies) {
      this.load.image(`animal_${sp}_0`, `assets/animals/${sp}/0.png`);
      this.load.image(`animal_${sp}_1`, `assets/animals/${sp}/1.png`);
    }
  }

  create(data?: { gameConfig?: GameConfig; rejoin?: boolean }): void {
    // Apply game config if passed from menu
    const gameConfig = data?.gameConfig ?? DEFAULT_GAME_CONFIG;
    const isRejoin = data?.rejoin === true;
    applyGameConfig(gameConfig);

    // Launch the UI scene on top of this one
    this.scene.launch('UIScene');

    // Generate textures (uses loaded tileset images as bases)
    generateTileTextures(this);
    generateAgentTextures(this);

    // Generate corpse marker texture
    // Network
    this.client = new SocketClient();
    // Only send config when starting a new game from menu (not on page reload rejoin)
    if (!isRejoin) {
      this.client.configure(gameConfig);
    }
    this.client.on('world:init', (data: WorldInitData) => this.onWorldInit(data));
    this.client.on('world:update', (data: WorldUpdateData) => this.onWorldUpdate(data));
    this.client.on('agent:died', (data: { agentId: string; name: string; cause: string }) => {
      this.ui.addEvent(`\uD83D\uDC80 ${data.name} \u2190 ${data.cause}`);
      // Place tombstone at agent's last position
      const agent = this.agents.find(a => a.id === data.agentId);
      if (agent) {
        this.spawnTombstone(agent.x, agent.y, data.name);
      }
    });
    this.client.on('agent:born', (data: { agent: AgentState }) => {
      this.ui.addEvent(`\u2728 ${data.agent.name} appeared`);
    });
    this.client.on('world:event', (data: { type: string; message: string }) => {
      this.ui.addEvent(`\uD83C\uDF0D ${data.message}`);
    });
    this.client.on('game:results', (data: any) => {
      this.scene.stop('UIScene');
      this.scene.start('ResultsScene', { results: data });
    });
    this.client.on('social:interaction', (data: any) => {
      const a = this.agents.find(ag => ag.id === data.agentA);
      const b = this.agents.find(ag => ag.id === data.agentB);
      if (a && b) {
        const tag = data.outcome > 0 ? '\uD83D\uDCAC' : '\u2694\uFE0F';
        this.ui.addEvent(`${tag} ${a.name} & ${b.name}`);
      }
    });

    // Camera — viewport shifted right by sidebar, reduced by right panel
    const { width, height } = this.scale;
    this.cameras.main.setViewport(SIDEBAR_W, 0, width - SIDEBAR_W - PANEL_W, height);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH * TILE_SIZE, WORLD_HEIGHT * TILE_SIZE);
    // Start at a comfortable zoom that shows a good chunk of the map
    const initialZoom = Math.max(this.getMinZoom(), Math.min(0.6, (width - SIDEBAR_W - PANEL_W) / (WORLD_WIDTH * TILE_SIZE) * 1.5));
    this.cameras.main.setZoom(initialZoom);
    this.cameras.main.centerOn(WORLD_WIDTH * TILE_SIZE / 2, WORLD_HEIGHT * TILE_SIZE / 2);

    // Controls
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = {
      W: this.input.keyboard!.addKey('W'),
      A: this.input.keyboard!.addKey('A'),
      S: this.input.keyboard!.addKey('S'),
      D: this.input.keyboard!.addKey('D'),
    };

    // Zoom — clamp so the world always fills the visible area
    this.input.on('wheel', (_pointer: any, _go: any, _dx: number, dy: number) => {
      const zoom = this.cameras.main.zoom;
      const minZoom = this.getMinZoom();
      const newZoom = Phaser.Math.Clamp(zoom - dy * 0.001, minZoom, 3);
      this.cameras.main.setZoom(newZoom);
    });

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      const w = gameSize.width;
      const h = gameSize.height;
      this.cameras.main.setViewport(SIDEBAR_W, 0, w - SIDEBAR_W - PANEL_W, h);
      const minZoom = this.getMinZoom();
      if (this.cameras.main.zoom < minZoom) {
        this.cameras.main.setZoom(minZoom);
      }
    });

    // Drag to pan camera, click to select agent
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) return;
      if (pointer.x > this.scale.width - PANEL_W || pointer.x < SIDEBAR_W) return;
      this.isDragging = false;
      this.dragStartX = pointer.x;
      this.dragStartY = pointer.y;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown || pointer.rightButtonDown()) return;
      if ((pointer.x > this.scale.width - PANEL_W || pointer.x < SIDEBAR_W) && !this.isDragging) return;
      const dx = pointer.x - pointer.prevPosition.x;
      const dy = pointer.y - pointer.prevPosition.y;
      const totalDist = Math.abs(pointer.x - this.dragStartX) + Math.abs(pointer.y - this.dragStartY);
      if (totalDist > 5) {
        this.isDragging = true;
      }
      if (this.isDragging) {
        this.cameras.main.scrollX -= dx / this.cameras.main.zoom;
        this.cameras.main.scrollY -= dy / this.cameras.main.zoom;
        if (this.cameraFollow) {
          this.cameraFollow = false;
          this.updateFollowIndicator();
        }
      }
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) return;
      if (pointer.x > this.scale.width - PANEL_W || pointer.x < SIDEBAR_W) return;
      // Only select agent on short click (not drag)
      if (!this.isDragging) {
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.handleClick(worldPoint.x, worldPoint.y);
      }
      this.isDragging = false;
    });

    // Keyboard shortcuts
    this.input.keyboard!.on('keydown-M', () => {
      if (this.selectedAgent && !this.showingMessagePrompt) {
        this.promptMessage();
      }
    });

    this.input.keyboard!.on('keydown-N', () => {
      this.promptNewAgent();
    });

    this.input.keyboard!.on('keydown-F', () => {
      if (this.selectedAgent || this.selectedAnimal) {
        this.cameraFollow = !this.cameraFollow;
      } else {
        this.cameraFollow = false;
      }
      this.updateFollowIndicator();
    });

    // Follow mode indicator (fixed to camera, top-center)
    this.followIndicator = this.add.text(0, 0, '[F] FOLLOWING', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '14px',
      color: '#80c080',
      backgroundColor: '#1a1a2e',
      padding: { x: 6, y: 4 },
    });
    this.followIndicator.setScrollFactor(0);
    this.followIndicator.setDepth(1001);
    this.followIndicator.setVisible(false);

    // Tilemap group
    this.tilemap = this.add.group();
  }

  private getMinZoom(): number {
    const viewW = this.scale.width - SIDEBAR_W - PANEL_W;
    const viewH = this.scale.height;
    const worldPxW = WORLD_WIDTH * TILE_SIZE;
    const worldPxH = WORLD_HEIGHT * TILE_SIZE;
    // Allow zooming out enough to see a good portion of the map
    return Math.max(0.15, Math.min(viewW / worldPxW, viewH / worldPxH));
  }

  private tiles: number[][] = [];

  private onWorldInit(data: WorldInitData): void {
    this.tiles = data.tiles;

    for (let y = 0; y < data.tiles.length; y++) {
      this.tileSprites[y] = [];
      for (let x = 0; x < data.tiles[y].length; x++) {
        const texKey = getBlendedTextureKey(this, data.tiles, x, y);
        const sprite = this.add.sprite(
          x * TILE_SIZE + TILE_SIZE / 2,
          y * TILE_SIZE + TILE_SIZE / 2,
          texKey
        );
        sprite.setOrigin(0.5, 0.5);
        this.tileSprites[y][x] = sprite;
        this.tilemap.add(sprite);
      }
    }

    this.agents = data.agents;
    for (const agent of data.agents) {
      this.createAgentSprite(agent);
    }

    // Create tree sprites
    this.trees = data.trees;
    for (const tree of data.trees) {
      this.createTreeSprite(tree);
    }

    // Create rock sprites
    this.rocks = data.rocks;
    for (const rock of data.rocks) {
      this.createRockSprite(rock);
    }

    // Create plant sprites
    this.plants = data.plants;
    for (const plant of data.plants) {
      this.createPlantSprite(plant);
    }

    // Create animal sprites
    this.animalsList = data.animals;
    for (const animal of data.animals) {
      this.createAnimalSprite(animal);
    }

    // Create corpse sprites
    this.corpses = data.corpses || [];
    for (const corpse of this.corpses) {
      this.createCorpseSprite(corpse);
    }

    // Store structures
    this.structuresList = data.structures || [];

    this.ui.addEvent('\uD83D\uDD0C Connected');
  }

  private onWorldUpdate(data: WorldUpdateData): void {
    this.agents = data.agents;

    // Update changed tiles with re-blending
    for (const change of data.changedTiles) {
      // Update the tile data
      if (this.tiles[change.y]) {
        this.tiles[change.y][change.x] = change.type;
      }
    }
    // Re-render changed tiles and their neighbors
    for (const change of data.changedTiles) {
      const neighbors = [
        { x: change.x, y: change.y },
        { x: change.x, y: change.y - 1 },
        { x: change.x, y: change.y + 1 },
        { x: change.x - 1, y: change.y },
        { x: change.x + 1, y: change.y },
      ];
      for (const pos of neighbors) {
        if (this.tileSprites[pos.y]?.[pos.x]) {
          const texKey = getBlendedTextureKey(this, this.tiles, pos.x, pos.y);
          this.tileSprites[pos.y][pos.x].setTexture(texKey);
        }
      }
    }

    // Update tree sprites
    this.trees = data.trees;
    const existingTreeIds = new Set(data.trees.map(t => t.id));
    // Remove sprites for trees no longer present
    for (const [id, ts] of this.treeSprites) {
      if (!existingTreeIds.has(id)) {
        ts.sprite.destroy();
        this.treeSprites.delete(id);
      }
    }
    // Create/update tree sprites
    for (const tree of data.trees) {
      if (!this.treeSprites.has(tree.id)) {
        this.createTreeSprite(tree);
      } else {
        this.updateTreeSprite(tree);
      }
    }

    // Update rock sprites
    this.rocks = data.rocks;
    const existingRockIds = new Set(data.rocks.map(r => r.id));
    for (const [id, rs] of this.rockSprites) {
      if (!existingRockIds.has(id)) {
        rs.sprite.destroy();
        this.rockSprites.delete(id);
      }
    }
    for (const rock of data.rocks) {
      if (!this.rockSprites.has(rock.id)) {
        this.createRockSprite(rock);
      } else {
        this.updateRockSprite(rock);
      }
    }

    // Update plant sprites
    this.plants = data.plants;
    const existingPlantIds = new Set(data.plants.map(p => p.id));
    for (const [id, ps] of this.plantSprites) {
      if (!existingPlantIds.has(id)) {
        ps.sprite.destroy();
        this.plantSprites.delete(id);
      }
    }
    for (const plant of data.plants) {
      if (!this.plantSprites.has(plant.id)) {
        this.createPlantSprite(plant);
      } else {
        // Update growth stage visuals
        const ps = this.plantSprites.get(plant.id)!;
        this.applyGrowthVisual(ps.sprite, plant.growthStage ?? 2);
      }
    }

    // Update animal sprites
    this.animalsList = data.animals;
    const existingAnimalIds = new Set(data.animals.map(a => a.id));
    for (const [id, as] of this.animalSprites) {
      if (!existingAnimalIds.has(id)) {
        as.sprite.destroy();
        as.labelText.destroy();
        this.animalSprites.delete(id);
      }
    }
    for (const animal of data.animals) {
      if (!this.animalSprites.has(animal.id)) {
        this.createAnimalSprite(animal);
      } else {
        this.updateAnimalSprite(animal);
      }
    }

    // Update corpse sprites
    this.corpses = data.corpses || [];
    const existingCorpseIds = new Set(this.corpses.map(c => c.id));
    for (const [id, cs] of this.corpseSprites) {
      if (!existingCorpseIds.has(id)) {
        cs.sprite.destroy();
        this.corpseSprites.delete(id);
      }
    }
    for (const corpse of this.corpses) {
      if (!this.corpseSprites.has(corpse.id)) {
        this.createCorpseSprite(corpse);
      }
    }

    // Remove sprites for agents no longer present
    const existingIds = new Set(data.agents.map(a => a.id));
    for (const [id, sprites] of this.agentSprites) {
      if (!existingIds.has(id)) {
        sprites.sprite.destroy();
        sprites.nameText.destroy();
        sprites.actionText.destroy();
        sprites.needsBar.destroy();
        if (sprites.crownText) sprites.crownText.destroy();
        this.agentSprites.delete(id);
      }
    }

    // Update/create agent sprites
    for (const agent of data.agents) {
      if (!this.agentSprites.has(agent.id)) {
        this.createAgentSprite(agent);
      }
      this.updateAgentSprite(agent);
    }

    // Crown: find the highest-level alive agent and give them a crown
    const aliveAgents = data.agents.filter(a => a.alive);
    let topAgent: AgentState | null = null;
    let topLevel = -1;
    for (const a of aliveAgents) {
      const lvl = getTotalLevel(a.skills);
      if (lvl > topLevel) { topLevel = lvl; topAgent = a; }
    }
    for (const [id, sprites] of this.agentSprites) {
      if (id === topAgent?.id && topLevel > 0) {
        if (!sprites.crownText) {
          sprites.crownText = this.add.text(0, 0, '\u{1F451}', {
            fontSize: '14px',
          });
          sprites.crownText.setOrigin(0.5, 1);
          sprites.crownText.setDepth(103);
        }
        sprites.crownText.setVisible(true);
        sprites.crownText.x = sprites.sprite.x;
        sprites.crownText.y = sprites.nameText.y - 2;
      } else if (sprites.crownText) {
        sprites.crownText.setVisible(false);
      }
    }

    // Update selected agent info
    if (this.selectedAgent) {
      const updated = data.agents.find(a => a.id === this.selectedAgent!.id);
      if (updated) {
        this.selectedAgent = updated;
      } else {
        this.selectedAgent = null;
      }
    }
    this.ui.setSelectedAgent(this.selectedAgent);

    // Update selected tree info
    if (this.selectedTree) {
      const updated = data.trees.find(t => t.id === this.selectedTree!.id);
      if (updated) {
        this.selectedTree = updated;
      } else {
        this.selectedTree = null;
      }
    }
    this.ui.setSelectedTree(this.selectedTree);

    // Update selected rock info
    if (this.selectedRock) {
      const updated = data.rocks.find(r => r.id === this.selectedRock!.id);
      if (updated) {
        this.selectedRock = updated;
      } else {
        this.selectedRock = null;
      }
    }
    this.ui.setSelectedRock(this.selectedRock);

    // Update selected plant info
    if (this.selectedPlant) {
      const updated = data.plants.find(p => p.id === this.selectedPlant!.id);
      if (updated) {
        this.selectedPlant = updated;
      } else {
        this.selectedPlant = null;
      }
    }
    this.ui.setSelectedPlant(this.selectedPlant);

    // Update selected animal info
    if (this.selectedAnimal) {
      const updated = data.animals.find(a => a.id === this.selectedAnimal!.id);
      if (updated) {
        this.selectedAnimal = updated;
      } else {
        this.selectedAnimal = null;
      }
    }
    this.ui.setSelectedAnimal(this.selectedAnimal);

    // Update selected corpse info
    if (this.selectedCorpse) {
      const updated = this.corpses.find(c => c.id === this.selectedCorpse!.id);
      if (updated) {
        this.selectedCorpse = updated;
      } else {
        this.selectedCorpse = null;
      }
    }
    this.ui.setSelectedCorpse(this.selectedCorpse);

    // Update structures
    this.structuresList = data.structures || [];
    if (this.selectedStructure) {
      const updated = this.structuresList.find(s => s.id === this.selectedStructure!.id);
      if (updated) {
        this.selectedStructure = updated;
      } else {
        this.selectedStructure = null;
      }
    }
    this.ui.setSelectedStructure(this.selectedStructure);

    // Update stats and season
    const alive = data.agents.filter(a => a.alive).length;
    if (data.season) {
      this.ui.setSeason(data.season);
    }
    this.ui.setAliveCount(alive);
    this.ui.updateSidebar(data.agents, data.animals);
  }

  private createAgentSprite(agent: AgentState): void {
    const texIdx = Math.abs(hashCode(agent.id)) % 12;
    const sprite = this.add.sprite(
      agent.x * TILE_SIZE + TILE_SIZE / 2,
      agent.y * TILE_SIZE + TILE_SIZE / 2,
      agent.alive ? `agent_${texIdx}` : 'agent_dead'
    );
    sprite.setOrigin(0.5, 1);
    sprite.setDepth(100);
    sprite.setInteractive();

    const lvl = getTotalLevel(agent.skills);
    // Name + level below the sprite
    const nameText = this.add.text(
      agent.x * TILE_SIZE + TILE_SIZE / 2,
      agent.y * TILE_SIZE + TILE_SIZE + 2,
      `[${lvl}] ${agent.name}`,
      {
        fontFamily: PIXEL_FONT,
        fontSize: '10px',
        color: agent.ownerId ? '#ffdd44' : '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      }
    );
    nameText.setOrigin(0.5, 0);
    nameText.setDepth(101);

    // Action text (hidden, kept for compatibility)
    const actionText = this.add.text(0, 0, '', {
      fontFamily: PIXEL_FONT, fontSize: '10px', color: '#c0c0c0',
      stroke: '#000000', strokeThickness: 2,
    });
    actionText.setVisible(false);
    actionText.setDepth(101);

    const needsBar = this.add.graphics();
    needsBar.setDepth(102);

    this.agentSprites.set(agent.id, { sprite, nameText, actionText, needsBar });
  }

  private updateAgentSprite(agent: AgentState): void {
    const sprites = this.agentSprites.get(agent.id);
    if (!sprites) return;

    // Hide dead agents entirely — tombstone handles the visual
    if (!agent.alive) {
      sprites.sprite.setVisible(false);
      sprites.nameText.setVisible(false);
      sprites.actionText.setVisible(false);
      sprites.needsBar.clear();
      return;
    }

    // Show agent (may have been hidden during death)
    sprites.sprite.setVisible(true);
    sprites.nameText.setVisible(true);
    sprites.sprite.setAlpha(1);

    // Restore correct texture if agent was dead and respawned
    const texIdx = Math.abs(hashCode(agent.id)) % 12;
    const expectedTex = `agent_${texIdx}`;
    if (sprites.sprite.texture.key !== expectedTex) {
      sprites.sprite.setTexture(expectedTex);
    }

    const tx = agent.x * TILE_SIZE + TILE_SIZE / 2;
    const ty = agent.y * TILE_SIZE + TILE_SIZE / 2;

    // Smooth movement
    const lerp = 0.3;
    sprites.sprite.x += (tx - sprites.sprite.x) * lerp;
    sprites.sprite.y += (ty - sprites.sprite.y) * lerp;

    const lvl = getTotalLevel(agent.skills);
    sprites.nameText.setText(`[${lvl}] ${agent.name}`);
    // Name below sprite
    sprites.nameText.x = sprites.sprite.x;
    sprites.nameText.y = sprites.sprite.y + 2;

    // Hide action text (no longer shown on map)
    sprites.actionText.setVisible(false);

    // Hit flash: red tint when taking damage
    const currentHealth = agent.needs.health;
    const prevHealth = sprites.lastHealth ?? currentHealth;
    if (currentHealth < prevHealth - 0.5) {
      sprites.hitFlashUntil = Date.now() + 300; // flash for 300ms
    }
    sprites.lastHealth = currentHealth;

    // Tint: hit flash > selected highlight > normal
    const now = Date.now();
    if (sprites.hitFlashUntil && now < sprites.hitFlashUntil) {
      sprites.sprite.setTint(0xff4444);
    } else if (this.selectedAgent?.id === agent.id) {
      sprites.sprite.setTint(0xffffaa);
    } else {
      sprites.sprite.clearTint();
    }

    // Mini needs bars
    sprites.needsBar.clear();
    const barX = sprites.sprite.x - 12;
    const barY = sprites.nameText.y - 8;
    const barW = 24;
    const barH = 3;

    // Health bar
    sprites.needsBar.fillStyle(0x1a1a2e);
    sprites.needsBar.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
    const healthPct = agent.needs.health / 100;
    const healthColor = agent.needs.health > 50 ? 0x44cc44 : agent.needs.health > 20 ? 0xcccc44 : 0xcc4444;
    sprites.needsBar.fillStyle(healthColor);
    sprites.needsBar.fillRect(barX, barY, barW * healthPct, barH);

    // Hunger bar (shows worst of protein/plant)
    sprites.needsBar.fillStyle(0x1a1a2e);
    sprites.needsBar.fillRect(barX - 1, barY + barH + 1, barW + 2, barH + 1);
    sprites.needsBar.fillStyle(0xcc8844);
    sprites.needsBar.fillRect(barX, barY + barH + 2, barW * (Math.min(agent.needs.proteinHunger, agent.needs.plantHunger) / 100), barH - 1);
  }

  private createTreeSprite(tree: TreeState): void {
    const texKey = tree.isStump ? 'tree_stump' : `tree_type${tree.type}`;
    const sprite = this.add.sprite(0, 0, texKey);
    sprite.setInteractive();

    if (tree.isStump) {
      sprite.setPosition(
        tree.x * TILE_SIZE + TILE_SIZE / 2,
        tree.y * TILE_SIZE + TILE_SIZE / 2
      );
      sprite.setOrigin(0.5, 0.5);
      sprite.setDepth(10 + tree.y);
    } else if (tree.growthStage !== undefined && tree.growthStage < 2) {
      // Sprout/young: 1x1, use stump sprite scaled with green tint
      sprite.setTexture('tree_stump');
      sprite.setPosition(
        tree.x * TILE_SIZE + TILE_SIZE / 2,
        tree.y * TILE_SIZE + TILE_SIZE / 2
      );
      sprite.setOrigin(0.5, 0.5);
      sprite.setDepth(10 + tree.y);
      this.applyGrowthVisual(sprite, tree.growthStage);
    } else {
      // Mature: 64x64 (2x2 tiles). Positioned at center of 2x2 base.
      sprite.setPosition(
        tree.x * TILE_SIZE + TILE_SIZE,
        tree.y * TILE_SIZE + TILE_SIZE
      );
      sprite.setOrigin(0.5, 0.5);
      sprite.setDepth(10 + tree.y + 1);
    }

    this.treeSprites.set(tree.id, { sprite });
  }

  private updateTreeSprite(tree: TreeState): void {
    const ts = this.treeSprites.get(tree.id);
    if (!ts) return;

    const isMature = !tree.isStump && (tree.growthStage === undefined || tree.growthStage >= 2);
    const texKey = tree.isStump ? 'tree_stump'
      : !isMature ? 'tree_stump'  // sprout/young: use stump sprite as sapling
      : `tree_type${tree.type}`;

    if (ts.sprite.texture.key !== texKey) {
      ts.sprite.setTexture(texKey);
    }

    if (tree.isStump || !isMature) {
      ts.sprite.setPosition(
        tree.x * TILE_SIZE + TILE_SIZE / 2,
        tree.y * TILE_SIZE + TILE_SIZE / 2
      );
      ts.sprite.setOrigin(0.5, 0.5);
      ts.sprite.setDepth(10 + tree.y);
      if (!tree.isStump) {
        this.applyGrowthVisual(ts.sprite, tree.growthStage ?? 2);
      } else {
        ts.sprite.setScale(1);
        ts.sprite.clearTint();
        ts.sprite.setAlpha(1);
      }
    } else {
      ts.sprite.setPosition(
        tree.x * TILE_SIZE + TILE_SIZE,
        tree.y * TILE_SIZE + TILE_SIZE
      );
      ts.sprite.setOrigin(0.5, 0.5);
      ts.sprite.setDepth(10 + tree.y + 1);
      ts.sprite.setScale(1);
      ts.sprite.clearTint();
      ts.sprite.setAlpha(1);
    }
  }

  private createRockSprite(rock: RockState): void {
    const texKey = rock.isRubble ? 'rock_rubble' : (rock.type === 0 ? 'rock_small' : 'rock_big');
    const sprite = this.add.sprite(
      rock.x * TILE_SIZE + TILE_SIZE / 2,
      rock.y * TILE_SIZE + TILE_SIZE / 2,
      texKey
    );
    sprite.setInteractive();
    sprite.setOrigin(0.5, 0.5);
    sprite.setDepth(10 + rock.y);
    this.rockSprites.set(rock.id, { sprite });
  }

  private updateRockSprite(rock: RockState): void {
    const rs = this.rockSprites.get(rock.id);
    if (!rs) return;

    const texKey = rock.isRubble ? 'rock_rubble' : (rock.type === 0 ? 'rock_small' : 'rock_big');
    if (rs.sprite.texture.key !== texKey) {
      rs.sprite.setTexture(texKey);
    }
    rs.sprite.setDepth(10 + rock.y);
  }

  private getPlantTexKey(type: PlantType): string {
    switch (type) {
      case PlantType.MUSHROOM: return 'plant_mushroom';
      case PlantType.POISON_SHROOM: return 'plant_poison';
      case PlantType.FLOWER: return 'plant_flower';
      case PlantType.STAMINA_HERB: return 'plant_stamina';
      case PlantType.HUNGER_HERB: return 'plant_hunger';
      case PlantType.BERRY_BUSH: return 'plant_bush';
      case PlantType.EDIBLE_FLOWER: return 'plant_edible_flower';
      default: return 'plant_mushroom';
    }
  }

  private createPlantSprite(plant: PlantState): void {
    const sprite = this.add.sprite(
      plant.x * TILE_SIZE + TILE_SIZE / 2,
      plant.y * TILE_SIZE + TILE_SIZE / 2,
      this.getPlantTexKey(plant.type)
    );
    sprite.setInteractive();
    sprite.setOrigin(0.5, 0.5);
    sprite.setDepth(10 + plant.y);
    this.applyGrowthVisual(sprite, plant.growthStage ?? 2);
    this.plantSprites.set(plant.id, { sprite });
  }

  /** Apply scale/tint to a sprite based on growth stage. */
  private applyGrowthVisual(sprite: Phaser.GameObjects.Sprite, stage: number): void {
    if (stage === 0) {
      // Sprout: tiny, green tint
      sprite.setScale(0.4);
      sprite.setTint(0x88cc88);
      sprite.setAlpha(0.85);
    } else if (stage === 1) {
      // Young: medium, slight tint
      sprite.setScale(0.7);
      sprite.setTint(0xbbddbb);
      sprite.setAlpha(0.9);
    } else {
      // Mature: full size, no tint
      sprite.setScale(1.0);
      sprite.clearTint();
      sprite.setAlpha(1.0);
    }
  }

  private createCorpseSprite(corpse: CorpseState): void {
    const sprite = this.add.sprite(
      corpse.x * TILE_SIZE + TILE_SIZE / 2,
      corpse.y * TILE_SIZE + TILE_SIZE / 2,
      'corpse_marker'
    );
    sprite.setInteractive();
    sprite.setOrigin(0.5, 0.5);
    sprite.setDepth(8 + Math.floor(corpse.y));
    sprite.setAlpha(0.6);
    sprite.setScale(0.8);
    sprite.setTint(0x886655); // brownish tint to distinguish from agent tombstones
    this.corpseSprites.set(corpse.id, { sprite });
  }

  private createAnimalSprite(animal: AnimalState): void {
    const texKey = `animal_${animal.species}_${animal.frame}`;
    const sprite = this.add.sprite(
      animal.x * TILE_SIZE + TILE_SIZE / 2,
      animal.y * TILE_SIZE + TILE_SIZE / 2,
      texKey
    );
    sprite.setInteractive();
    sprite.setOrigin(0.5, 0.5);
    sprite.setDepth(50 + Math.floor(animal.y));

    const lvl = getTotalLevel(animal.skills);
    const labelText = this.add.text(
      sprite.x, sprite.y - TILE_SIZE / 2 - 2,
      `[${lvl}]`,
      {
        fontFamily: PIXEL_FONT,
        fontSize: '14px',
        color: '#cccccc',
        stroke: '#000000',
        strokeThickness: 2,
      }
    );
    labelText.setOrigin(0.5, 1);
    labelText.setDepth(51 + Math.floor(animal.y));

    this.animalSprites.set(animal.id, { sprite, labelText });
  }

  private updateAnimalSprite(animal: AnimalState): void {
    const as = this.animalSprites.get(animal.id);
    if (!as) return;

    const tx = animal.x * TILE_SIZE + TILE_SIZE / 2;
    const ty = animal.y * TILE_SIZE + TILE_SIZE / 2;

    // Smooth movement lerp
    const lerp = 0.3;
    as.sprite.x += (tx - as.sprite.x) * lerp;
    as.sprite.y += (ty - as.sprite.y) * lerp;

    // Update texture frame for walk animation
    const texKey = `animal_${animal.species}_${animal.frame}`;
    if (as.sprite.texture.key !== texKey) {
      as.sprite.setTexture(texKey);
    }

    // Flip sprite based on movement direction
    if (tx < as.sprite.x - 1) {
      as.sprite.setFlipX(true);
    } else if (tx > as.sprite.x + 1) {
      as.sprite.setFlipX(false);
    }

    // Depth based on Y for proper overlap
    as.sprite.setDepth(50 + Math.floor(animal.y));

    // Update level label position
    const lvl = getTotalLevel(animal.skills);
    as.labelText.setText(`[${lvl}]`);
    as.labelText.x = as.sprite.x;
    as.labelText.y = as.sprite.y - TILE_SIZE / 2 - 2;
    as.labelText.setDepth(51 + Math.floor(animal.y));

    // Hit flash: red tint when taking damage
    const currentHealth = animal.health;
    const prevHealth = as.lastHealth ?? currentHealth;
    if (currentHealth < prevHealth - 0.5) {
      as.hitFlashUntil = Date.now() + 300;
    }
    as.lastHealth = currentHealth;

    const now = Date.now();
    if (!animal.alive) {
      as.sprite.setAlpha(0.5);
      as.labelText.setVisible(false);
    } else if (as.hitFlashUntil && now < as.hitFlashUntil) {
      as.sprite.setTint(0xff2222); // bright red flash on hit
    } else if (this.selectedAnimal?.id === animal.id) {
      as.sprite.setTint(0xffffaa); // selected highlight
    } else if (animal.health < animal.maxHealth * 0.3) {
      as.sprite.setTint(0xff8888); // low health tint
    } else {
      as.sprite.clearTint();
      as.sprite.setAlpha(1);
      as.labelText.setVisible(true);
    }

    // Highlight if selected
    if (this.selectedAnimal?.id === animal.id) {
      as.sprite.setTint(0xffffaa);
    }
  }

  /** Called from sidebar to select and pan to an agent */
  selectAgentById(agentId: string): void {
    const agent = this.agents.find(a => a.id === agentId);
    if (!agent) return;
    this.selectedAgent = agent;
    this.selectedAnimal = null;
    this.selectedTree = null;
    this.selectedRock = null;
    this.selectedPlant = null;
    this.selectedCorpse = null;
    this.selectedStructure = null;
    this.selectedWaterTile = null;
    this.ui.setSelectedAgent(agent);
    this.ui.setSelectedAnimal(null);
    this.ui.setSelectedTree(null);
    this.ui.setSelectedRock(null);
    this.ui.setSelectedPlant(null);
    this.ui.setSelectedCorpse(null);
    // Pan camera to agent (one-shot, no follow)
    this.cameras.main.centerOn(agent.x * TILE_SIZE + TILE_SIZE / 2, agent.y * TILE_SIZE + TILE_SIZE / 2);
    this.cameraFollow = false;
    this.updateFollowIndicator();
  }

  private handleClick(worldX: number, worldY: number): void {
    // Check agents first (higher priority)
    let closestAgent: AgentState | null = null;
    let closestAgentDist = Infinity;

    for (const agent of this.agents) {
      const ax = agent.x * TILE_SIZE + TILE_SIZE / 2;
      const ay = agent.y * TILE_SIZE + TILE_SIZE / 2;
      const d = Math.sqrt((worldX - ax) ** 2 + (worldY - ay) ** 2);
      if (d < TILE_SIZE * 1.5 && d < closestAgentDist) {
        closestAgent = agent;
        closestAgentDist = d;
      }
    }

    if (closestAgent) {
      this.selectedAgent = closestAgent;
      this.selectedAnimal = null;
      this.selectedTree = null;
      this.selectedRock = null;
      this.selectedPlant = null;
      this.selectedCorpse = null;
      this.selectedStructure = null;
      this.selectedWaterTile = null;
      this.ui.setSelectedAgent(closestAgent);
      this.ui.setSelectedAnimal(null);
      this.ui.setSelectedTree(null);
      this.ui.setSelectedRock(null);
      this.ui.setSelectedPlant(null);
      this.ui.setSelectedCorpse(null);
      this.ui.setSelectedStructure(null);
      this.ui.setSelectedWater(null);
      return;
    }

    // Check animals
    let closestAnimal: AnimalState | null = null;
    let closestAnimalDist = Infinity;

    for (const animal of this.animalsList) {
      if (!animal.alive) continue;
      const ax = animal.x * TILE_SIZE + TILE_SIZE / 2;
      const ay = animal.y * TILE_SIZE + TILE_SIZE / 2;
      const d = Math.sqrt((worldX - ax) ** 2 + (worldY - ay) ** 2);
      if (d < TILE_SIZE * 1.5 && d < closestAnimalDist) {
        closestAnimal = animal;
        closestAnimalDist = d;
      }
    }

    if (closestAnimal) {
      this.selectedAgent = null;
      this.selectedAnimal = closestAnimal;
      this.selectedTree = null;
      this.selectedRock = null;
      this.selectedPlant = null;
      this.selectedCorpse = null;
      this.selectedStructure = null;
      this.selectedWaterTile = null;
      this.ui.setSelectedAgent(null);
      this.ui.setSelectedAnimal(closestAnimal);
      this.ui.setSelectedTree(null);
      this.ui.setSelectedRock(null);
      this.ui.setSelectedPlant(null);
      this.ui.setSelectedCorpse(null);
      this.ui.setSelectedStructure(null);
      this.ui.setSelectedWater(null);
      return;
    }

    // Check trees
    let closestTree: TreeState | null = null;
    let closestTreeDist = Infinity;

    for (const tree of this.trees) {
      // Center of tree's 2x2 base area
      const tx = tree.isStump
        ? tree.x * TILE_SIZE + TILE_SIZE / 2
        : tree.x * TILE_SIZE + TILE_SIZE;
      const ty = tree.isStump
        ? tree.y * TILE_SIZE + TILE_SIZE / 2
        : (tree.y + 1) * TILE_SIZE;
      const d = Math.sqrt((worldX - tx) ** 2 + (worldY - ty) ** 2);
      const maxDist = tree.isStump ? TILE_SIZE : TILE_SIZE * 2;
      if (d < maxDist && d < closestTreeDist) {
        closestTree = tree;
        closestTreeDist = d;
      }
    }

    if (closestTree) {
      this.selectedAgent = null;
      this.selectedAnimal = null;
      this.selectedTree = closestTree;
      this.selectedRock = null;
      this.selectedPlant = null;
      this.selectedCorpse = null;
      this.selectedStructure = null;
      this.selectedWaterTile = null;
      this.ui.setSelectedAgent(null);
      this.ui.setSelectedAnimal(null);
      this.ui.setSelectedTree(closestTree);
      this.ui.setSelectedRock(null);
      this.ui.setSelectedPlant(null);
      this.ui.setSelectedCorpse(null);
      this.ui.setSelectedStructure(null);
      this.ui.setSelectedWater(null);
      return;
    }

    // Check rocks
    let closestRock: RockState | null = null;
    let closestRockDist = Infinity;

    for (const rock of this.rocks) {
      const rx = rock.x * TILE_SIZE + TILE_SIZE / 2;
      const ry = rock.y * TILE_SIZE + TILE_SIZE / 2;
      const d = Math.sqrt((worldX - rx) ** 2 + (worldY - ry) ** 2);
      if (d < TILE_SIZE && d < closestRockDist) {
        closestRock = rock;
        closestRockDist = d;
      }
    }

    if (closestRock) {
      this.selectedAgent = null;
      this.selectedAnimal = null;
      this.selectedTree = null;
      this.selectedRock = closestRock;
      this.selectedPlant = null;
      this.selectedCorpse = null;
      this.selectedStructure = null;
      this.selectedWaterTile = null;
      this.ui.setSelectedAgent(null);
      this.ui.setSelectedAnimal(null);
      this.ui.setSelectedTree(null);
      this.ui.setSelectedRock(closestRock);
      this.ui.setSelectedPlant(null);
      this.ui.setSelectedCorpse(null);
      this.ui.setSelectedStructure(null);
      this.ui.setSelectedWater(null);
      return;
    }

    // Check plants
    let closestPlant: PlantState | null = null;
    let closestPlantDist = Infinity;

    for (const plant of this.plants) {
      const px = plant.x * TILE_SIZE + TILE_SIZE / 2;
      const py = plant.y * TILE_SIZE + TILE_SIZE / 2;
      const d = Math.sqrt((worldX - px) ** 2 + (worldY - py) ** 2);
      if (d < TILE_SIZE && d < closestPlantDist) {
        closestPlant = plant;
        closestPlantDist = d;
      }
    }

    if (closestPlant) {
      this.selectedAgent = null;
      this.selectedAnimal = null;
      this.selectedTree = null;
      this.selectedRock = null;
      this.selectedPlant = closestPlant;
      this.selectedCorpse = null;
      this.selectedStructure = null;
      this.selectedWaterTile = null;
      this.ui.setSelectedAgent(null);
      this.ui.setSelectedAnimal(null);
      this.ui.setSelectedTree(null);
      this.ui.setSelectedRock(null);
      this.ui.setSelectedPlant(closestPlant);
      this.ui.setSelectedCorpse(null);
      this.ui.setSelectedStructure(null);
      this.ui.setSelectedWater(null);
      return;
    }

    // Check corpses
    let closestCorpse: CorpseState | null = null;
    let closestCorpseDist = Infinity;

    for (const corpse of this.corpses) {
      const cx = corpse.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = corpse.y * TILE_SIZE + TILE_SIZE / 2;
      const d = Math.sqrt((worldX - cx) ** 2 + (worldY - cy) ** 2);
      if (d < TILE_SIZE && d < closestCorpseDist) {
        closestCorpse = corpse;
        closestCorpseDist = d;
      }
    }

    if (closestCorpse) {
      this.selectedAgent = null;
      this.selectedAnimal = null;
      this.selectedTree = null;
      this.selectedRock = null;
      this.selectedPlant = null;
      this.selectedCorpse = closestCorpse;
      this.selectedStructure = null;
      this.selectedWaterTile = null;
      this.ui.setSelectedAgent(null);
      this.ui.setSelectedAnimal(null);
      this.ui.setSelectedTree(null);
      this.ui.setSelectedRock(null);
      this.ui.setSelectedPlant(null);
      this.ui.setSelectedCorpse(closestCorpse);
      this.ui.setSelectedStructure(null);
      this.ui.setSelectedWater(null);
      return;
    }

    // Check if clicked on a structure tile
    const clickTileX = Math.floor(worldX / TILE_SIZE);
    const clickTileY = Math.floor(worldY / TILE_SIZE);
    const clickedStructure = this.structuresList.find(s => s.x === clickTileX && s.y === clickTileY) ?? null;

    if (clickedStructure) {
      this.selectedAgent = null;
      this.selectedAnimal = null;
      this.selectedTree = null;
      this.selectedRock = null;
      this.selectedPlant = null;
      this.selectedCorpse = null;
      this.selectedStructure = clickedStructure;
      this.selectedWaterTile = null;
      this.ui.setSelectedAgent(null);
      this.ui.setSelectedAnimal(null);
      this.ui.setSelectedTree(null);
      this.ui.setSelectedRock(null);
      this.ui.setSelectedPlant(null);
      this.ui.setSelectedCorpse(null);
      this.ui.setSelectedStructure(clickedStructure);
      this.ui.setSelectedWater(null);
      return;
    }

    // Check if clicked on a special tile (water, iron ore)
    const tileX = clickTileX;
    const tileY = clickTileY;
    const clickedTileType = this.tiles[tileY]?.[tileX];
    const clickedWater = clickedTileType === TileType.WATER ? { x: tileX, y: tileY } : null;
    const clickedIronOre = clickedTileType === TileType.IRON_ORE ? { x: tileX, y: tileY } : null;

    this.selectedAgent = null;
    this.selectedAnimal = null;
    this.selectedTree = null;
    this.selectedRock = null;
    this.selectedPlant = null;
    this.selectedCorpse = null;
    this.selectedStructure = null;
    this.selectedWaterTile = clickedWater;
    this.ui.setSelectedAgent(null);
    this.ui.setSelectedAnimal(null);
    this.ui.setSelectedTree(null);
    this.ui.setSelectedRock(null);
    this.ui.setSelectedPlant(null);
    this.ui.setSelectedCorpse(null);
    this.ui.setSelectedStructure(null);
    this.ui.setSelectedWater(clickedWater);
    this.ui.setSelectedIronOre(clickedIronOre);
  }

  private promptMessage(): void {
    if (!this.selectedAgent) return;
    const msg = prompt(`Send message to ${this.selectedAgent.name}:`);
    if (msg && msg.trim()) {
      this.client.sendMessage(this.selectedAgent.id, msg.trim());
      this.ui.addEvent(`[msg] You > ${this.selectedAgent.name}: "${msg.trim()}"`);
    }
  }

  private promptNewAgent(): void {
    const name = prompt('Name your agent (or leave empty for random):');
    if (name === null) return;
    this.client.createAgent(name || '', []);
    this.ui.addEvent(`[new] Creating agent${name ? ` "${name}"` : ''}...`);
  }

  private spawnTombstone(x: number, y: number, name: string): void {
    const px = x * TILE_SIZE + TILE_SIZE / 2;
    const py = y * TILE_SIZE + TILE_SIZE / 2;

    const sprite = this.add.sprite(px, py, 'tombstone');
    sprite.setOrigin(0.5, 0.5);
    sprite.setDepth(9 + Math.floor(y));

    const nameText = this.add.text(px, py - TILE_SIZE / 2 - 2, name, {
      fontFamily: PIXEL_FONT,
      fontSize: '14px',
      color: '#999999',
      stroke: '#000000',
      strokeThickness: 2,
    });
    nameText.setOrigin(0.5, 1);
    nameText.setDepth(9 + Math.floor(y));

    this.tombstones.push({
      sprite,
      nameText,
      expireTime: Date.now() + 15_000, // 15 seconds
    });

    // Cap tombstones to prevent performance issues
    while (this.tombstones.length > 20) {
      const oldest = this.tombstones.shift()!;
      oldest.sprite.destroy();
      oldest.nameText.destroy();
    }
  }

  private updateFollowIndicator(): void {
    this.followIndicator.setVisible(this.cameraFollow);
    if (this.cameraFollow) {
      const name = this.selectedAgent?.name ?? this.selectedAnimal?.species ?? '';
      this.followIndicator.setText(`[F] FOLLOWING ${name.toUpperCase()}`);
      this.followIndicator.setPosition(
        (this.scale.width - this.followIndicator.width) / 2,
        42
      );
    }
  }

  update(): void {
    // Manual camera movement — disables follow
    const speed = 8 / this.cameras.main.zoom;
    const manualMove =
      this.cursors.left.isDown || this.wasdKeys.A.isDown ||
      this.cursors.right.isDown || this.wasdKeys.D.isDown ||
      this.cursors.up.isDown || this.wasdKeys.W.isDown ||
      this.cursors.down.isDown || this.wasdKeys.S.isDown;

    if (manualMove) {
      if (this.cameraFollow) {
        this.cameraFollow = false;
        this.updateFollowIndicator();
      }
    }

    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) {
      this.cameras.main.scrollX -= speed;
    }
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) {
      this.cameras.main.scrollX += speed;
    }
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) {
      this.cameras.main.scrollY -= speed;
    }
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) {
      this.cameras.main.scrollY += speed;
    }

    // Camera follow selected entity
    if (this.cameraFollow) {
      let followX: number | null = null;
      let followY: number | null = null;
      if (this.selectedAgent?.alive) {
        followX = this.selectedAgent.x * TILE_SIZE + TILE_SIZE / 2;
        followY = this.selectedAgent.y * TILE_SIZE + TILE_SIZE / 2;
      } else if (this.selectedAnimal?.alive) {
        followX = this.selectedAnimal.x * TILE_SIZE + TILE_SIZE / 2;
        followY = this.selectedAnimal.y * TILE_SIZE + TILE_SIZE / 2;
      }
      if (followX !== null && followY !== null) {
        // Smooth follow
        const cam = this.cameras.main;
        const targetScrollX = followX - cam.width / 2;
        const targetScrollY = followY - cam.height / 2;
        cam.scrollX += (targetScrollX - cam.scrollX) * 0.1;
        cam.scrollY += (targetScrollY - cam.scrollY) * 0.1;
      } else {
        // Target died or deselected
        this.cameraFollow = false;
        this.updateFollowIndicator();
      }
    }

    // Remove expired tombstones
    const now = Date.now();
    for (let i = this.tombstones.length - 1; i >= 0; i--) {
      if (now >= this.tombstones[i].expireTime) {
        this.tombstones[i].sprite.destroy();
        this.tombstones[i].nameText.destroy();
        this.tombstones.splice(i, 1);
      }
    }
  }
}

function getTotalLevel(skills: SkillSet): number {
  return skills.combat.level + skills.defense.level + skills.athletics.level
    + skills.woodcutting.level + skills.mining.level + skills.foraging.level
    + skills.building.level + skills.crafting.level + skills.survival.level + skills.social.level;
}

function formatAction(action: string): string {
  const map: Record<string, string> = {
    idle: 'idle',
    wandering: 'exploring',
    moving_to: 'moving',
    harvesting: 'gathering',
    eating: 'eating',
    drinking: 'drinking',
    resting: 'resting',
    building: 'building',
    crafting: 'crafting',
    socializing: 'chatting',
    trading: 'trading',
    planting: 'planting',
    following_message: 'following orders',
    dying: 'dying',
  };
  return map[action] || action;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}
