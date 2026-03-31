import Phaser from 'phaser';
import { AgentState, TreeState, RockState, PlantState, PlantType, AnimalState, CorpseState, StructureState, TileType, DropTable, WORLD_WIDTH, WORLD_HEIGHT, Season, OrchestratorRole, AGENT_ARCHETYPES } from '@supernatural/shared';
import type { AgentArchetype } from '@supernatural/shared';

const PIXEL_FONT = '"Press Start 2P", monospace';
const PANEL_W = 380;
const SIDEBAR_W = 300;

const ROLE_BADGE_COLORS: Record<string, number> = {
  advisor: 0x4ecdc4, puppeteer: 0xff6b6b, god: 0xffd93d,
  darwinist: 0x6c5ce7, parent: 0xa8e6cf, chaos_demon: 0xff4757, none: 0x888888,
};
const ROLE_BADGE_LABELS: Record<string, string> = {
  advisor: 'ADV', puppeteer: 'PUP', god: 'GOD',
  darwinist: 'DAR', parent: 'PAR', chaos_demon: 'CHO', none: '---',
};
const ACTION_LABELS: Record<string, string> = {
  idle: 'idle', wandering: 'walk', moving_to: 'walk', drinking: 'drink',
  eating: 'eat', harvesting: 'chop', building: 'build', crafting: 'craft',
  fighting: 'fight', fleeing: 'flee', resting: 'rest', socializing: 'talk',
  planting: 'plant', trading: 'trade', following_message: 'msg', dying: 'dead',
};

/**
 * Separate overlay scene for all HUD/UI elements.
 * Runs with its own camera that never zooms or scrolls,
 * so UI stays fixed regardless of game camera state.
 */
export class UIScene extends Phaser.Scene {
  private eventLog: string[] = [];
  private selectedAgent: AgentState | null = null;
  private selectedTree: TreeState | null = null;
  private selectedRock: RockState | null = null;
  private selectedPlant: PlantState | null = null;
  private selectedAnimal: AnimalState | null = null;
  private selectedCorpse: CorpseState | null = null;
  private selectedStructure: StructureState | null = null;
  private selectedWater: { x: number; y: number } | null = null;
  private selectedIronOre: { x: number; y: number } | null = null;
  private aliveCount = 0;
  private currentSeason: Season = 'summer';

  // UI elements
  private statsText!: Phaser.GameObjects.Text;
  private controlsText!: Phaser.GameObjects.Text;
  private rightPanelBg!: Phaser.GameObjects.Graphics;
  private panelTitle!: Phaser.GameObjects.Text;
  private logLabel!: Phaser.GameObjects.Text;
  private eventLogText!: Phaser.GameObjects.Text;
  private infoPanelContainer!: Phaser.GameObjects.Container;
  private infoPanelMaskGraphics!: Phaser.GameObjects.Graphics;
  private stopBg!: Phaser.GameObjects.Graphics;
  private stopText!: Phaser.GameObjects.Text;
  private stopZone!: Phaser.GameObjects.Zone;

  // Left sidebar
  private sidebarBg!: Phaser.GameObjects.Graphics;
  private sidebarContainer!: Phaser.GameObjects.Container;
  private sidebarMaskGraphics!: Phaser.GameObjects.Graphics;
  private sidebarScrollY = 0;
  private sidebarContentHeight = 0;
  private llmProviderLabels = new Map<string, string>();
  private lastAgentStructureHash = '';
  private lastPanelRebuildTime = 0;
  private panelRebuildQueued = false;
  private lastPanelDataHash = '';
  // Persistent sidebar rows — created once, text updated in place
  private sidebarAgentRows: {
    agentId: string;
    archText: Phaser.GameObjects.Text;
    nameText: Phaser.GameObjects.Text;
    lvText: Phaser.GameObjects.Text;
    livesText: Phaser.GameObjects.Text;
    deathText: Phaser.GameObjects.Text;
    dot: Phaser.GameObjects.Graphics;
  }[] = [];
  private sidebarAnimalTexts: Phaser.GameObjects.Text[] = [];
  private speciesCountText: Phaser.GameObjects.Text | null = null;
  private speciesLabelText: Phaser.GameObjects.Text | null = null;
  private sidebarBuilt = false;
  private sidebarAgentCount = 0;

  constructor() {
    super({ key: 'UIScene' });
  }

  create(): void {
    // Stats (top-left)
    this.statsText = this.add.text(12, 12, '', {
      fontFamily: PIXEL_FONT,
      fontSize: '14px',
      color: '#e0e0e0',
      backgroundColor: '#1a1a2e',
      padding: { x: 10, y: 8 },
    }).setDepth(1000);

    // Right panel background
    this.rightPanelBg = this.add.graphics().setDepth(999);

    // Panel title
    this.panelTitle = this.add.text(0, 10, 'SUPERNATURAL', {
      fontFamily: PIXEL_FONT,
      fontSize: '14px',
      color: '#80c080',
    }).setDepth(1000);

    // Info panel container for selected agent (masked to avoid event log overlap)
    this.infoPanelContainer = this.add.container(0, 0).setDepth(1000);
    this.infoPanelMaskGraphics = this.add.graphics();
    this.infoPanelMaskGraphics.setVisible(false);
    this.infoPanelContainer.setMask(this.infoPanelMaskGraphics.createGeometryMask());

    // Events label
    this.logLabel = this.add.text(0, 0, 'EVENTS', {
      fontFamily: PIXEL_FONT,
      fontSize: '11px',
      color: '#556655',
    }).setDepth(1000);

    // Event log text
    this.eventLogText = this.add.text(0, 0, '', {
      fontFamily: PIXEL_FONT,
      fontSize: '10px',
      color: '#8a9a8a',
      lineSpacing: 6,
      wordWrap: { width: SIDEBAR_W - 24 },
    }).setDepth(1000);

    // Controls hint (bottom-left)
    this.controlsText = this.add.text(12, 0, 'WASD:move  Scroll:zoom  Click:select  M:msg  N:new agent', {
      fontFamily: PIXEL_FONT,
      fontSize: '14px',
      color: '#667766',
      backgroundColor: '#0a0a14',
      padding: { x: 8, y: 6 },
    }).setDepth(1000);

    // Left sidebar
    this.sidebarBg = this.add.graphics().setDepth(999);
    this.sidebarContainer = this.add.container(0, 0).setDepth(1000);
    this.sidebarMaskGraphics = this.add.graphics();
    this.sidebarMaskGraphics.setVisible(false);
    const sidebarMask = this.sidebarMaskGraphics.createGeometryMask();
    this.sidebarContainer.setMask(sidebarMask);

    // Sidebar scroll
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: any[], _deltaX: number, deltaY: number) => {
      const pointer = this.input.activePointer;
      if (pointer.x < SIDEBAR_W) {
        const maxScroll = Math.max(0, this.sidebarContentHeight - this.scale.height + 20);
        this.sidebarScrollY = Phaser.Math.Clamp(this.sidebarScrollY + deltaY * 0.5, 0, maxScroll);
        this.sidebarContainer.y = -this.sidebarScrollY;
      }
    });

    // STOP GAME button — repositioned in layoutUI
    this.stopBg = this.add.graphics().setDepth(1001);
    this.stopText = this.add.text(0, 0, 'STOP GAME', {
      fontFamily: PIXEL_FONT, fontSize: '12px', color: '#ff6666',
    }).setOrigin(0.5).setDepth(1001);
    this.stopZone = this.add.zone(0, 0, PANEL_W - 40, 32)
      .setInteractive({ useHandCursor: true }).setDepth(1001);
    const stopZone = this.stopZone;
    stopZone.on('pointerup', () => {
      const gameScene = this.scene.get('GameScene') as any;
      if (gameScene?.client?.stopGame) {
        gameScene.client.stopGame();
      }
    });

    // Fetch LLM provider labels
    this.fetchProviderLabels();

    this.layoutUI();
    this.scale.on('resize', () => this.layoutUI());
  }

  private async fetchProviderLabels(): Promise<void> {
    try {
      const res = await fetch('http://localhost:3001/api/llm-providers');
      if (res.ok) {
        const providers = await res.json();
        for (const p of providers) {
          this.llmProviderLabels.set(p.id, p.label);
        }
      }
    } catch { /* server not ready */ }
  }

  private layoutUI(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const panelX = w - PANEL_W;

    // Left sidebar background
    this.sidebarBg.clear();
    this.sidebarBg.fillStyle(0x1a1a2e, 0.92);
    this.sidebarBg.fillRect(0, 0, SIDEBAR_W, h);
    this.sidebarBg.lineStyle(2, 0x2a3a2a);
    this.sidebarBg.lineBetween(SIDEBAR_W, 0, SIDEBAR_W, h);

    // Sidebar scroll mask
    this.sidebarMaskGraphics.clear();
    this.sidebarMaskGraphics.fillStyle(0xffffff);
    this.sidebarMaskGraphics.fillRect(0, 0, SIDEBAR_W, Math.floor(h / 2) - 10);

    // Stats text shift right to avoid sidebar
    this.statsText.setPosition(SIDEBAR_W + 12, 12);

    // Controls hint shift right
    this.controlsText.setPosition(SIDEBAR_W + 12, h - 28);

    // Right panel background
    this.rightPanelBg.clear();
    this.rightPanelBg.fillStyle(0x0e0e1c, 0.92);
    this.rightPanelBg.fillRect(panelX, 0, PANEL_W, h);
    // Left border accent
    this.rightPanelBg.lineStyle(2, 0x2a3a2a);
    this.rightPanelBg.lineBetween(panelX, 0, panelX, h);
    // Title area
    this.rightPanelBg.fillStyle(0x141428, 1);
    this.rightPanelBg.fillRect(panelX, 0, PANEL_W, 36);

    // Title
    this.panelTitle.setPosition(panelX + 14, 10);

    // Info panel position — full right panel height (no event log competing)
    this.infoPanelContainer.setPosition(panelX, 0);

    this.infoPanelMaskGraphics.clear();
    this.infoPanelMaskGraphics.fillStyle(0xffffff);
    this.infoPanelMaskGraphics.fillRect(panelX, 0, PANEL_W, h - 10);

    // Event log — positioned in left sidebar, bottom half
    const eventLogY = Math.floor(h / 2);
    // Divider
    this.sidebarBg.lineStyle(1, 0x334433, 0.6);
    this.sidebarBg.lineBetween(10, eventLogY - 6, SIDEBAR_W - 10, eventLogY - 6);

    this.logLabel.setPosition(12, eventLogY - 2);
    this.eventLogText.setPosition(12, eventLogY + 16);
    this.eventLogText.setWordWrapWidth(SIDEBAR_W - 24);

    // Controls hint
    this.controlsText.setPosition(SIDEBAR_W + 12, h - 28);

    // STOP GAME button — anchored to bottom of right panel
    const stopBtnW = PANEL_W - 40;
    const stopBtnH = 32;
    const stopBtnX = panelX + 20;
    const stopBtnY = h - 42;
    this.stopBg.clear();
    this.stopBg.fillStyle(0x882222, 0.9); this.stopBg.fillRoundedRect(stopBtnX, stopBtnY, stopBtnW, stopBtnH, 4);
    this.stopBg.lineStyle(1, 0xcc4444, 0.6); this.stopBg.strokeRoundedRect(stopBtnX, stopBtnY, stopBtnW, stopBtnH, 4);
    this.stopText.setPosition(panelX + PANEL_W / 2, stopBtnY + stopBtnH / 2);
    this.stopZone.setPosition(panelX + PANEL_W / 2, stopBtnY + stopBtnH / 2);
    this.stopZone.setSize(stopBtnW, stopBtnH);
  }

  // ─── Public API called from GameScene ───

  setAliveCount(count: number): void {
    this.aliveCount = count;
    const seasonIcon = { spring: 'SPR', summer: 'SUM', autumn: 'AUT', winter: 'WIN' }[this.currentSeason];
    this.statsText.setText(`Agents: ${count}  ${seasonIcon}  World: ${WORLD_WIDTH}x${WORLD_HEIGHT}`);
  }

  setSeason(season: Season): void {
    this.currentSeason = season;
  }

  addEvent(message: string): void {
    this.eventLog.unshift(message);
    if (this.eventLog.length > 16) this.eventLog.pop();
    this.eventLogText.setText(this.eventLog.join('\n'));
  }

  setSelectedAgent(agent: AgentState | null, immediate = false): void {
    const changed = this.selectedAgent?.id !== agent?.id;
    this.selectedAgent = agent;
    if (changed || immediate) this.rebuildPanel(); else this.throttledRebuildPanel();
  }

  setSelectedTree(tree: TreeState | null): void {
    this.selectedTree = tree;
    this.rebuildPanel();
  }

  setSelectedRock(rock: RockState | null): void {
    this.selectedRock = rock;
    this.rebuildPanel();
  }

  setSelectedPlant(plant: PlantState | null): void {
    this.selectedPlant = plant;
    this.rebuildPanel();
  }

  setSelectedAnimal(animal: AnimalState | null, immediate = false): void {
    const changed = this.selectedAnimal?.id !== animal?.id;
    this.selectedAnimal = animal;
    if (changed || immediate) this.rebuildPanel(); else this.throttledRebuildPanel();
  }

  setSelectedCorpse(corpse: CorpseState | null): void {
    this.selectedCorpse = corpse;
    this.rebuildPanel();
  }

  setSelectedStructure(structure: StructureState | null): void {
    this.selectedStructure = structure;
    this.rebuildPanel();
  }

  setSelectedWater(pos: { x: number; y: number } | null): void {
    this.selectedWater = pos;
    this.rebuildPanel();
  }

  setSelectedIronOre(pos: { x: number; y: number } | null): void {
    this.selectedIronOre = pos;
    this.rebuildPanel();
  }

  private rebuildPanel(): void {
    // Skip rebuild if data hasn't changed
    const agent = this.selectedAgent;
    if (agent) {
      const hash = agent.id + '|' + agent.action + '|' + Math.floor(agent.needs.health) + '|' +
        Math.floor(agent.needs.thirst) + '|' + Math.floor(agent.needs.proteinHunger) + '|' +
        Math.floor(agent.needs.stamina) + '|' + agent.totalDeaths + '|' +
        (agent.livesRemaining ?? 100) + '|' + (agent.currentPlanGoal ?? '') + '|' +
        agent.resources.wood + '|' + agent.resources.stone + '|' + agent.resources.food;
      if (hash === this.lastPanelDataHash) {
        this.panelRebuildQueued = false;
        return; // nothing changed, skip rebuild
      }
      this.lastPanelDataHash = hash;
    } else {
      this.lastPanelDataHash = '';
    }
    this.lastPanelRebuildTime = Date.now();
    this.panelRebuildQueued = false;
    this.updateInfoPanel();
  }

  private throttledRebuildPanel(): void {
    const now = Date.now();
    const PANEL_THROTTLE_MS = 2000; // rebuild max every 2s for same-entity data refresh
    if (now - this.lastPanelRebuildTime >= PANEL_THROTTLE_MS) {
      this.rebuildPanel();
    } else if (!this.panelRebuildQueued) {
      this.panelRebuildQueued = true;
      setTimeout(() => {
        if (this.panelRebuildQueued) this.rebuildPanel();
      }, PANEL_THROTTLE_MS - (now - this.lastPanelRebuildTime));
    }
  }

  // ─── Left Sidebar ───

  updateSidebar(agents: AgentState[], animals?: AnimalState[]): void {
    // If agent count changed, we need a full rebuild
    const needsRebuild = !this.sidebarBuilt || agents.length !== this.sidebarAgentCount;

    if (needsRebuild) {
      this.sidebarBuilt = false;
      this.sidebarAgentRows = [];
      this.sidebarAnimalTexts = [];
      this.speciesCountText = null;
      this.speciesLabelText = null;
      this.sidebarContainer.removeAll(true);
      this.sidebarAgentCount = agents.length;
      this.buildSidebarStructure(agents, animals);
      this.sidebarBuilt = true;
    }

    // Update text values in place (fast — no object creation)
    this.updateSidebarValues(agents, animals);
  }

  private buildSidebarStructure(agents: AgentState[], animals?: AnimalState[]): void {
    // Check if structural reorder needed (agents die/respawn/assignment change)
    const structureHash = agents.map(a => a.id + ':' + (a.alive ? '1' : '0') + ':' + (a.llmProviderId ?? 'x')).join(',');
    const needsReorder = structureHash !== this.lastAgentStructureHash;
    if (needsReorder) this.lastAgentStructureHash = structureHash;

    // Clear and rebuild content
    this.sidebarContainer.removeAll(true);

    // Group agents by LLM provider
    const groups = new Map<string | null, AgentState[]>();
    for (const agent of agents) {
      const key = agent.llmProviderId ?? null;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(agent);
    }

    // Sort groups: LLM-assigned groups sorted by power desc, null group last
    const sortedGroups: [string | null, AgentState[]][] = [];
    const nullGroup = groups.get(null);
    groups.delete(null);

    const groupsWithPower = Array.from(groups.entries()).map(([key, agts]) => ({
      key, agents: agts, power: computeGodPower(agts),
    }));
    groupsWithPower.sort((a, b) => b.power - a.power);
    for (const g of groupsWithPower) sortedGroups.push([g.key, g.agents]);
    if (nullGroup) sortedGroups.push([null, nullGroup]);

    let y = 10;

    for (const [providerId, groupAgents] of sortedGroups) {
      const isUnassigned = providerId === null;

      // Sort agents: alive first, then by level desc
      groupAgents.sort((a, b) => {
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
        return agentLevel(b) - agentLevel(a);
      });

      if (isUnassigned) {
        // Unassigned header
        const headerBg = this.add.graphics();
        headerBg.fillStyle(0x222233, 0.6);
        headerBg.fillRect(6, y, SIDEBAR_W - 12, 20);
        this.sidebarContainer.add(headerBg);

        const headerText = this.add.text(12, y + 4, 'NO GOD', {
          fontFamily: PIXEL_FONT, fontSize: '14px', color: '#666666',
        });
        this.sidebarContainer.add(headerText);
        y += 24;
      } else {
        // God card
        const power = computeGodPower(groupAgents);
        const role = groupAgents[0]?.llmRole ?? 'none';
        const providerLabel = this.llmProviderLabels.get(providerId!) ?? providerId!;
        const roleColor = ROLE_BADGE_COLORS[role] ?? 0x888888;
        const roleBadge = ROLE_BADGE_LABELS[role] ?? '---';
        const aliveCount = groupAgents.filter(a => a.alive).length;

        // Card background
        const cardBg = this.add.graphics();
        cardBg.fillStyle(0x1e1e36, 0.9);
        cardBg.fillRoundedRect(6, y, SIDEBAR_W - 12, 44, 4);
        // Role accent stripe
        cardBg.fillStyle(roleColor, 0.8);
        cardBg.fillRect(6, y, 4, 44);
        this.sidebarContainer.add(cardBg);

        // Power score
        const powerText = this.add.text(16, y + 4, `${power}`, {
          fontFamily: PIXEL_FONT, fontSize: '14px', color: '#ffd700',
        });
        this.sidebarContainer.add(powerText);

        // Role badge
        const badgeBg = this.add.graphics();
        badgeBg.fillStyle(roleColor, 1);
        badgeBg.fillRoundedRect(SIDEBAR_W - 52, y + 4, 38, 14, 3);
        this.sidebarContainer.add(badgeBg);

        const badgeText = this.add.text(SIDEBAR_W - 33, y + 7, roleBadge, {
          fontFamily: PIXEL_FONT, fontSize: '14px', color: '#0a0a0a',
        }).setOrigin(0.5, 0);
        this.sidebarContainer.add(badgeText);

        // Provider label
        const provText = this.add.text(16, y + 20, providerLabel, {
          fontFamily: PIXEL_FONT, fontSize: '14px', color: '#aaaaaa',
        });
        this.sidebarContainer.add(provText);

        // Agent count
        const countText = this.add.text(16, y + 32, `${aliveCount} agent${aliveCount !== 1 ? 's' : ''}`, {
          fontFamily: PIXEL_FONT, fontSize: '14px', color: '#666666',
        });
        this.sidebarContainer.add(countText);

        y += 48;
      }

      // Agent rows
      for (const agent of groupAgents) {
        this.renderAgentRow(agent, y, this.sidebarAgentRows.length);
        y += 18;
      }

      y += 8; // Gap between groups
    }

    // Top animals by tier (compact)
    if (animals && animals.length > 0) {
      y += 2;
      const divA = this.add.graphics();
      divA.lineStyle(1, 0x334433, 0.3);
      divA.lineBetween(10, y, SIDEBAR_W - 10, y);
      this.sidebarContainer.add(divA);
      y += 4;

      const tiers: [string, string, string[]][] = [
        ['Apex', '\uD83D\uDC3B', ['bear', 'tiger', 'alligator']],
        ['Pred', '\uD83E\uDD8A', ['fox', 'cat', 'dog-0']],
        ['LgHb', '\uD83E\uDD8C', ['deer', 'cow-0', 'horse']],
        ['MdHb', '\uD83D\uDC11', ['pig', 'goat', 'sheep', 'donkey']],
        ['Prey', '\uD83D\uDC07', ['rabbit', 'chicken', 'duck', 'squirrel', 'hedgehog', 'capybara', 'rat']],
      ];

      for (const [tierLabel, emoji, species] of tiers) {
        // Always create the text object — updateSidebarValues will fill it
        const t = this.add.text(12, y, `${emoji} ---`, {
          fontFamily: PIXEL_FONT, fontSize: '10px', color: '#909890',
        });
        this.sidebarContainer.add(t);
        this.sidebarAnimalTexts.push(t);
        y += 14;
      }

      // Species count table
      y += 2;
      const divS = this.add.graphics();
      divS.lineStyle(1, 0x334433, 0.3);
      divS.lineBetween(10, y, SIDEBAR_W - 10, y);
      this.sidebarContainer.add(divS);
      y += 4;
      this.speciesLabelText = this.add.text(12, y, 'SPECIES', {
        fontFamily: PIXEL_FONT, fontSize: '9px', color: '#667766',
      });
      this.sidebarContainer.add(this.speciesLabelText);
      y += 12;
      // Create text for species counts (filled by updateSidebarValues)
      this.speciesCountText = this.add.text(12, y, '', {
        fontFamily: PIXEL_FONT, fontSize: '9px', color: '#909890', lineSpacing: 2,
      });
      this.sidebarContainer.add(this.speciesCountText);
      y += 120; // reserve space for ~10 rows of species
    }

    this.sidebarContentHeight = y;
  }

  private renderAgentRow(agent: AgentState, y: number, index: number): void {
    const rowH = 18;

    // Hover background (behind everything)
    const hoverBg = this.add.graphics();
    hoverBg.setAlpha(0);
    this.sidebarContainer.add(hoverBg);

    // Alive dot
    const dot = this.add.graphics();
    this.sidebarContainer.add(dot);

    // Archetype emoji
    const archText = this.add.text(22, y - 1, '', { fontSize: '12px' });
    this.sidebarContainer.add(archText);

    // Name (shifted right for archetype)
    const nameText = this.add.text(40, y + 1, '', {
      fontFamily: PIXEL_FONT, fontSize: '12px', color: '#cccccc',
    });
    this.sidebarContainer.add(nameText);

    // Level
    const lvText = this.add.text(110, y + 1, '', {
      fontFamily: PIXEL_FONT, fontSize: '12px', color: '#aaaaaa',
    });
    this.sidebarContainer.add(lvText);

    // Lives
    const livesText = this.add.text(162, y - 1, '', { fontSize: '12px', color: '#44cc44' });
    this.sidebarContainer.add(livesText);

    // Deaths
    const deathText = this.add.text(224, y - 1, '', { fontSize: '11px', color: '#886666' });
    this.sidebarContainer.add(deathText);

    // Store references for in-place updates
    this.sidebarAgentRows.push({ agentId: agent.id, archText, nameText, lvText, livesText, deathText, dot });

    // Click zone — PERMANENT, never destroyed between updates
    const zone = this.add.zone(SIDEBAR_W / 2, y + rowH / 2, SIDEBAR_W, rowH).setInteractive({ useHandCursor: true });
    this.sidebarContainer.add(zone);
    zone.on('pointerup', () => {
      // Use stored index to find current agent id
      const row = this.sidebarAgentRows[index];
      if (row) {
        const gameScene = this.scene.get('GameScene') as any;
        if (gameScene?.selectAgentById) {
          gameScene.selectAgentById(row.agentId);
        }
      }
    });
    zone.on('pointerover', () => {
      hoverBg.clear();
      hoverBg.fillStyle(0xffffff, 0.08);
      hoverBg.fillRect(0, y - 1, SIDEBAR_W, rowH + 2);
      hoverBg.setAlpha(1);
    });
    zone.on('pointerout', () => {
      hoverBg.setAlpha(0);
    });
  }

  /** Update sidebar text values without destroying/recreating objects */
  private updateSidebarValues(agents: AgentState[], animals?: AnimalState[]): void {
    // Sort agents: alive first, then by level desc
    const sorted = [...agents].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return agentLevel(b) - agentLevel(a);
    });

    for (let i = 0; i < this.sidebarAgentRows.length && i < sorted.length; i++) {
      const row = this.sidebarAgentRows[i];
      const agent = sorted[i];
      const alive = agent.alive;
      const lives = agent.livesRemaining ?? 100;
      const level = agentLevel(agent);
      const name = agent.name.length > 6 ? agent.name.slice(0, 5) + '.' : agent.name;

      row.agentId = agent.id;
      const archEmoji = (agent as any).archetypeEmoji
        ?? AGENT_ARCHETYPES[(agent.archetype ?? 'random') as AgentArchetype]?.label ?? '\uD83C\uDFB2';
      row.archText.setText(archEmoji);
      row.nameText.setText(name);
      row.nameText.setColor(alive ? '#cccccc' : '#666666');
      row.lvText.setText(`Lv${level}`);
      row.lvText.setColor(alive ? '#aaaaaa' : '#555555');

      const livesColor = !alive ? '#cc4444' : lives > 50 ? '#44cc44' : lives > 20 ? '#cccc44' : '#cc4444';
      row.livesText.setText(`\u2764${lives}`);
      row.livesText.setColor(livesColor);

      row.deathText.setText(agent.totalDeaths > 0 ? `\uD83D\uDC80${agent.totalDeaths}` : '');

      row.dot.clear();
      row.dot.fillStyle(alive ? 0x44cc44 : 0x666666, 1);
      row.dot.fillCircle(14, row.nameText.y + 7, 3);
    }

    // Update animal texts
    if (animals && this.sidebarAnimalTexts.length > 0) {
      const tiers: [string, string[]][] = [
        ['\uD83D\uDC3B', ['bear', 'tiger', 'alligator']],
        ['\uD83E\uDD8A', ['fox', 'cat', 'dog-0']],
        ['\uD83E\uDD8C', ['deer', 'cow-0', 'horse']],
        ['\uD83D\uDC11', ['pig', 'goat', 'sheep', 'donkey']],
        ['\uD83D\uDC07', ['rabbit', 'chicken', 'duck', 'squirrel', 'hedgehog', 'capybara', 'rat']],
      ];
      for (let ti = 0; ti < tiers.length && ti < this.sidebarAnimalTexts.length; ti++) {
        const [emoji, species] = tiers[ti];
        const tierAnimals = animals.filter((a: any) => species.includes(a.species) && a.alive);
        tierAnimals.sort((a: any, b: any) => {
          const aLvl = Object.values(a.skills).reduce((sum: number, s: any) => sum + (s.level || 0), 0);
          const bLvl = Object.values(b.skills).reduce((sum: number, s: any) => sum + (s.level || 0), 0);
          if (bLvl !== aLvl) return bLvl - aLvl;
          return b.age - a.age;
        });
        const best = tierAnimals[0];
        if (best) {
          const totalSecs = Math.floor(best.age / 10);
          const mins = Math.floor(totalSecs / 60);
          const secs = totalSecs % 60;
          const timeStr = mins > 0 ? `${mins}m${secs}s` : `${totalSecs}s`;
          const lvl = Object.values(best.skills).reduce((sum: number, s: any) => sum + (s.level || 0), 0);
          this.sidebarAnimalTexts[ti].setText(`${emoji} ${best.species} Lv${lvl} ${timeStr}`);
        }
      }

      // Update species count table
      if (this.speciesCountText) {
        const counts: Record<string, number> = {};
        let total = 0;
        for (const a of animals) {
          if (!(a as any).alive) continue;
          counts[(a as any).species] = (counts[(a as any).species] || 0) + 1;
          total++;
        }
        const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const rows: string[] = [];
        for (let i = 0; i < entries.length; i += 2) {
          const chunk = entries.slice(i, i + 2);
          rows.push(chunk.map(([s, c]) => `${s}:${c}`).join('  '));
        }
        this.speciesCountText.setText(rows.join('\n'));
        // Update header with total
        if (this.speciesLabelText) {
          this.speciesLabelText.setText(`SPECIES (${total})`);
        }
      }
    }
  }

  private updateInfoPanel(): void {
    this.infoPanelContainer.removeAll(true);

    // Show animal panel
    if (this.selectedAnimal && !this.selectedAgent) {
      this.updateAnimalPanel();
      return;
    }

    // Show tree panel if a tree is selected and no agent is selected
    if (this.selectedTree && !this.selectedAgent) {
      this.updateTreePanel();
      return;
    }

    // Show rock panel if a rock is selected and no agent/tree is selected
    if (this.selectedRock && !this.selectedAgent && !this.selectedTree) {
      this.updateRockPanel();
      return;
    }

    // Show plant panel
    if (this.selectedPlant && !this.selectedAgent && !this.selectedTree && !this.selectedRock) {
      this.updatePlantPanel();
      return;
    }

    // Show corpse panel
    if (this.selectedCorpse && !this.selectedAgent && !this.selectedAnimal && !this.selectedTree && !this.selectedRock && !this.selectedPlant) {
      this.updateCorpsePanel();
      return;
    }

    // Show structure panel
    if (this.selectedStructure && !this.selectedAgent && !this.selectedAnimal && !this.selectedTree && !this.selectedRock && !this.selectedPlant && !this.selectedCorpse) {
      this.updateStructurePanel();
      return;
    }

    // Show water panel
    if (this.selectedWater && !this.selectedAgent && !this.selectedTree && !this.selectedRock && !this.selectedPlant) {
      this.updateWaterPanel();
      return;
    }

    // Show iron ore panel
    if (this.selectedIronOre) {
      this.updateIronOrePanel();
      return;
    }

    const agent = this.selectedAgent;
    if (!agent) {
      const hint = this.add.text(14, 50, 'Click an agent or\ntree to inspect', {
        fontFamily: PIXEL_FONT,
        fontSize: '14px',
        color: '#445544',
        lineSpacing: 8,
      });
      this.infoPanelContainer.add(hint);
      return;
    }

    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '13px', yGap = 0) => {
      y += yGap;
      const t = this.add.text(14, y, text, {
        fontFamily: PIXEL_FONT,
        fontSize: size,
        color,
        wordWrap: { width: contentW },
        lineSpacing: 4,
      });
      this.infoPanelContainer.add(t);
      y += parseInt(size) + 10;
      return t;
    };

    const addBar = (value: number, maxVal: number, color: number, width = 220) => {
      const bar = this.add.graphics();
      const pct = Math.max(0, Math.min(1, value / maxVal));
      bar.fillStyle(0x1a1a2e);
      bar.fillRect(14, y, width, 8);
      bar.fillStyle(color);
      bar.fillRect(14, y, width * pct, 8);
      bar.lineStyle(1, 0x2a3a2a);
      bar.strokeRect(14, y, width, 8);
      this.infoPanelContainer.add(bar);
      y += 12;
    };

    const addDivider = () => {
      y += 4;
      const div = this.add.graphics();
      div.lineStyle(1, 0x2a3a2a);
      div.lineBetween(14, y, contentW, y);
      this.infoPanelContainer.add(div);
      y += 8;
    };

    // Agent name + archetype + lives + deaths on one line
    {
      const lives = agent.livesRemaining ?? 100;
      const livesColor = lives > 50 ? '#44cc44' : lives > 20 ? '#cccc44' : '#cc4444';
      const archEmoji = (agent as any).archetypeEmoji
        ?? AGENT_ARCHETYPES[(agent.archetype ?? 'random') as AgentArchetype]?.label ?? '';
      const nameT = this.add.text(14, y, `${archEmoji} ${agent.name}`, {
        fontFamily: PIXEL_FONT, fontSize: '14px', color: '#80d880',
      });
      this.infoPanelContainer.add(nameT);
      let xOff = 14 + nameT.width + 10;
      const livesT = this.add.text(xOff, y, `\u2764${lives}`, {
        fontSize: '13px', color: livesColor,
      });
      this.infoPanelContainer.add(livesT);
      if (agent.totalDeaths > 0) {
        xOff += livesT.width + 10;
        const deathT = this.add.text(xOff, y, `\uD83D\uDC80${agent.totalDeaths}`, {
          fontSize: '13px', color: '#aa8888',
        });
        this.infoPanelContainer.add(deathT);
      }
      y += 22;
    }
    addLine(agent.personality.join(' / '), '#607860', '12px');

    // Equipped weapon/tool
    {
      const parts: string[] = [];
      const mh = agent.inventory?.equipped?.mainHand;
      if (mh) {
        const name = mh.itemId.replace(/_/g, ' ');
        parts.push(`\u2694 ${name}`);
        if (mh.durability !== undefined) parts[parts.length - 1] += ` (${mh.durability})`;
      }
      const body = agent.inventory?.equipped?.body;
      if (body) {
        const name = body.itemId.replace(/_/g, ' ');
        parts.push(`\uD83D\uDEE1 ${name}`);
      }
      if (parts.length > 0) {
        addLine(parts.join('  '), '#aa9966', '10px');
      }
    }

    // Status
    if (agent.alive) {
      addLine(formatAction(agent.action), '#88bbdd', '10px', 2);
    } else {
      addLine('DEAD', '#cc4444', '14px', 2);
    }

    addDivider();

    // Needs — emoji + bar, no numbers, 2 columns
    addLine('NEEDS', '#556655', '12px');
    const needsList: [string, number, number][] = [
      ['\u2764\uFE0F',  agent.needs.health,         0xcc4444],   // ❤️
      ['\uD83E\uDD69',  agent.needs.proteinHunger,  0xcc8844],   // 🥩
      ['\uD83C\uDF3F',  agent.needs.plantHunger,    0x88cc44],   // 🌿
      ['\uD83D\uDCA7',  agent.needs.thirst,         0x4488cc],   // 💧
      ['\u26A1',         agent.needs.stamina,        0x44aa44],   // ⚡
      ['\uD83D\uDDE3\uFE0F', agent.needs.social,    0xaa44aa],   // 🗣️
      ['\uD83C\uDFE0',  agent.needs.shelter,        0x888844],   // 🏠
    ];
    const emojiW = 22;
    const colBarW = (contentW / 2) - emojiW - 6;
    const col1x = 14;
    const col2x = 14 + contentW / 2;
    for (let ni = 0; ni < needsList.length; ni += 2) {
      for (let ci = 0; ci < 2; ci++) {
        const idx = ni + ci;
        if (idx >= needsList.length) break;
        const [emoji, val, clr] = needsList[idx];
        const cx = ci === 0 ? col1x : col2x;

        // Emoji icon
        const et = this.add.text(cx, y - 2, emoji, { fontSize: '14px' });
        this.infoPanelContainer.add(et);

        // Bar
        const bar = this.add.graphics();
        const bx = cx + emojiW;
        bar.fillStyle(0x1a1a2e); bar.fillRect(bx, y + 2, colBarW, 10);
        bar.fillStyle(clr); bar.fillRect(bx, y + 2, colBarW * Math.max(0, Math.min(1, val / 100)), 10);
        bar.lineStyle(1, 0x2a3a2a); bar.strokeRect(bx, y + 2, colBarW, 10);
        this.infoPanelContainer.add(bar);
      }
      y += 20;
    }

    // Metabolism
    const totalLevels = Object.values(agent.skills).reduce((sum: number, s: any) => sum + (s.level || 0), 0);
    const metabolism = (1 + totalLevels / 500).toFixed(1);
    addLine(`Metabolism: ${metabolism}x`, '#888880', '12px');

    addDivider();

    // Resources — show all non-zero
    addLine('INVENTORY', '#556655', '12px');
    const resEntries: [string, number, string][] = [
      ['Wood', agent.resources.wood, '#b0a890'],
      ['Stone', agent.resources.stone, '#a0a0a0'],
      ['Food', agent.resources.food, '#88cc44'],
      ['Water', agent.resources.water, '#4488cc'],
      ['TSeed', agent.resources.treeSeed, '#88aa44'],
      ['PSeed', agent.resources.plantSeed, '#88cc44'],
      ['Iron Ore', agent.resources.iron_ore, '#c06030'],
      ['Iron Ingot', agent.resources.iron_ingot, '#a0a8b0'],
      ['Meat', agent.resources.meat, '#cc8866'],
      ['Bone', agent.resources.bone, '#ccccaa'],
      ['Hide', agent.resources.hide, '#aa8855'],
      ['Sinew', agent.resources.sinew, '#bb9977'],
      ['Fat', agent.resources.fat, '#ddcc88'],
      ['Feathers', agent.resources.feathers, '#aabbcc'],
      ['Teeth', agent.resources.teeth_claws, '#ccaaaa'],
      ['Scales', agent.resources.scales, '#88aaaa'],
    ];
    const nonZeroRes = resEntries.filter(([, val]) => val > 0);
    if (nonZeroRes.length > 0) {
      // Show in compact rows of 3
      for (let i = 0; i < nonZeroRes.length; i += 3) {
        const row = nonZeroRes.slice(i, i + 3).map(([n, v]) => `${n}:${Math.floor(v as number)}`).join('  ');
        addLine(row, '#b0a890', '12px');
      }
    } else {
      addLine('(empty)', '#667766', '12px');
    }

    // Inventory - equipped items
    if (agent.inventory?.equipped) {
      const eq = agent.inventory.equipped;
      if (eq.mainHand || eq.body || eq.accessory) {
        addDivider();
        addLine('EQUIPPED', '#556655', '12px');
        if (eq.mainHand) {
          const dur = eq.mainHand.durability !== undefined ? ` (${eq.mainHand.durability})` : '';
          addLine(`Hand: ${eq.mainHand.itemId.replace(/_/g, ' ')}${dur}`, '#b0a890', '12px');
        }
        if (eq.body) {
          const dur = eq.body.durability !== undefined ? ` (${eq.body.durability})` : '';
          addLine(`Body: ${eq.body.itemId.replace(/_/g, ' ')}${dur}`, '#b0a890', '12px');
        }
        if (eq.accessory) {
          addLine(`Acc: ${eq.accessory.itemId.replace(/_/g, ' ')}`, '#b0a890', '12px');
        }
      }
    }

    // Inventory - carried items (non-zero)
    if (agent.inventory?.items?.length > 0) {
      addLine('ITEMS', '#556655', '12px');
      for (const item of agent.inventory.items.slice(0, 6)) { // show max 6
        const dur = item.durability !== undefined ? ` [${item.durability}]` : '';
        const qty = item.quantity > 1 ? `×${item.quantity}` : '';
        addLine(`${item.itemId.replace(/_/g, ' ')} ${qty}${dur}`, '#909890', '12px');
      }
      if (agent.inventory.items.length > 6) {
        addLine(`...+${agent.inventory.items.length - 6} more`, '#667766', '12px');
      }
    }

    // Show carry weight (server-computed exact values)
    if (agent.carryWeight !== undefined && agent.carryCapacity !== undefined) {
      const weightPct = Math.floor((agent.carryWeight / Math.max(1, agent.carryCapacity)) * 100);
      const weightColor = weightPct > 90 ? '#cc4444' : weightPct > 60 ? '#ccaa44' : '#888880';
      addLine(`Weight: ${Math.floor(agent.carryWeight)}/${Math.floor(agent.carryCapacity)}`, weightColor, '12px');
    }

    // Skills
    y += 4;
    addLine('SKILLS', '#556655', '12px');
    addLine(`Combat:${agent.skills.combat.level}  Def:${agent.skills.defense.level}  Ath:${agent.skills.athletics.level}`, '#909890', '12px');
    addLine(`Wood:${agent.skills.woodcutting.level}  Mine:${agent.skills.mining.level}  For:${agent.skills.foraging.level}`, '#909890', '12px');
    addLine(`Build:${agent.skills.building.level}  Craft:${agent.skills.crafting.level}`, '#909890', '12px');
    addLine(`Surv:${agent.skills.survival.level}  Soc:${agent.skills.social.level}`, '#909890', '12px');

    // Obedience
    y += 4;
    addLine(`Obedience: ${agent.obedience}%`, '#888880', '12px');

    // ─── EVOLUTION ───
    addDivider();
    addLine('EVOLUTION', '#556655', '12px');

    // Lives + Deaths summary line
    {
      const lives = agent.livesRemaining ?? 100;
      const livesColor = lives > 50 ? '#44cc44' : lives > 20 ? '#cccc44' : '#cc4444';
      addLine(`\u2764 ${lives} lives   \uD83D\uDC80 ${agent.totalDeaths} deaths`, livesColor, '12px');
    }

    // Current life duration
    if (agent.currentLifeTicks !== undefined) {
      const secs = Math.floor((agent.currentLifeTicks ?? 0) / 10);
      const mins = Math.floor(secs / 60);
      const durStr = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
      addLine(`This life: ${durStr}`, '#909890', '12px');
    }

    // Best life
    if ((agent.lifetimeBestSurvival ?? 0) > 0) {
      const bestSecs = Math.floor((agent.lifetimeBestSurvival ?? 0) / 10);
      const bestMins = Math.floor(bestSecs / 60);
      const bestStr = bestMins > 0 ? `${bestMins}m ${bestSecs % 60}s` : `${bestSecs}s`;
      addLine(`Best life: ${bestStr}`, '#909890', '12px');
    }

    // Genome
    const gv = agent.genomeVersion ?? 1;
    addLine(`Genome v${gv}  (${gv - 1} mutations)`, '#a0a0b0', '12px');

    // AI controller
    if (agent.llmProviderId && agent.llmRole && agent.llmRole !== 'none') {
      addLine(`\uD83E\uDD16 ${agent.llmRole} via ${agent.llmProviderId}`, '#80c080', '12px');
    } else {
      addLine('\uD83E\uDDE0 Decision Tree (no LLM)', '#777777', '12px');
    }

    // Strategy rules
    if (agent.activeStrategyRuleNames && agent.activeStrategyRuleNames.length > 0) {
      addLine('Active rules:', '#888866', '12px');
      for (const rule of agent.activeStrategyRuleNames.slice(0, 4)) {
        addLine(`  \u2022 ${rule}`, '#999977', '11px');
      }
      if (agent.activeStrategyRuleNames.length > 4) {
        addLine(`  +${agent.activeStrategyRuleNames.length - 4} more`, '#666655', '11px');
      }
    }

    // Highlander
    if (agent.isHighlander) {
      y += 4;
      addLine('\u2728 HIGHLANDER \u2728', '#ffd700', '14px');
    }

    // Last message
    if (agent.lastMessage) {
      addDivider();
      addLine('LAST MSG', '#556655', '12px');
      addLine(`"${agent.lastMessage.content}"`, '#d4a860', '12px');
      addLine(
        agent.lastMessage.followed ? 'Followed' : 'Ignored',
        agent.lastMessage.followed ? '#44cc44' : '#cc4444',
        '12px'
      );
    }

    // Plan / Thinking (always visible, at end)
    addDivider();
    addLine('PLAN', '#556655', '12px');
    if (agent.alive && agent.currentPlanGoal && agent.currentPlanSteps && agent.currentPlanSteps.length > 0) {
      addLine(`\uD83C\uDFAF ${agent.currentPlanGoal}`, '#ccaa44', '12px');
      const stepIdx = agent.planStepIndex ?? 0;
      for (let i = 0; i < agent.currentPlanSteps.length; i++) {
        const step = agent.currentPlanSteps[i];
        const prefix = i < stepIdx ? '\u2705' : i === stepIdx ? '\u25B6' : '\u25CB';
        const color = i < stepIdx ? '#668866' : i === stepIdx ? '#cccc88' : '#666655';
        addLine(`${prefix} ${step.actionName}`, color, '12px');
      }
    } else if (agent.alive) {
      const reasonFull = agent.lastDecisionReason ?? agent.action;
      const [reason, topDec] = reasonFull.split('\n');
      addLine(`\uD83D\uDCAD ${reason}`, '#88aacc', '12px');

      const priorities: [string, string, number][] = [];
      if (agent.needs.thirst < 40) priorities.push(['\uD83D\uDCA7', 'thirsty', agent.needs.thirst]);
      if (agent.needs.proteinHunger < 40) priorities.push(['\uD83E\uDD69', 'hungry (protein)', agent.needs.proteinHunger]);
      if (agent.needs.plantHunger < 40) priorities.push(['\uD83C\uDF3F', 'hungry (plant)', agent.needs.plantHunger]);
      if (agent.needs.stamina < 30) priorities.push(['\u26A1', 'tired', agent.needs.stamina]);
      if (agent.needs.health < 50) priorities.push(['\u2764\uFE0F', 'injured', agent.needs.health]);
      if (agent.needs.social < 25) priorities.push(['\uD83D\uDDE3\uFE0F', 'lonely', agent.needs.social]);
      if (agent.needs.shelter < 20) priorities.push(['\uD83C\uDFE0', 'exposed', agent.needs.shelter]);

      if (priorities.length > 0) {
        priorities.sort((a, b) => a[2] - b[2]);
        for (const [emoji, label, val] of priorities.slice(0, 3)) {
          const urgency = val < 20 ? '#cc4444' : '#ccaa44';
          addLine(`${emoji} ${label} (${Math.floor(val)})`, urgency, '12px');
        }
      } else {
        addLine('\u2705 all needs met', '#668866', '12px');
      }

      // Competing decisions (debug) — after needs
      if (topDec) {
        y += 4;
        addLine(topDec, '#555566', '9px');
      }
    } else {
      addLine('\uD83D\uDC80 dead', '#cc4444', '12px');
    }
  }

  private updateTreePanel(): void {
    const tree = this.selectedTree!;
    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '13px', yGap = 0) => {
      y += yGap;
      const t = this.add.text(14, y, text, {
        fontFamily: PIXEL_FONT,
        fontSize: size,
        color,
        wordWrap: { width: contentW },
        lineSpacing: 4,
      });
      this.infoPanelContainer.add(t);
      y += parseInt(size) + 10;
      return t;
    };

    const addBar = (value: number, maxVal: number, color: number, width = 220) => {
      const bar = this.add.graphics();
      const pct = Math.max(0, Math.min(1, value / maxVal));
      bar.fillStyle(0x1a1a2e);
      bar.fillRect(14, y, width, 8);
      bar.fillStyle(color);
      bar.fillRect(14, y, width * pct, 8);
      bar.lineStyle(1, 0x2a3a2a);
      bar.strokeRect(14, y, width, 8);
      this.infoPanelContainer.add(bar);
      y += 12;
    };

    if (tree.isStump) {
      addLine('TREE STUMP', '#8b6914', '12px');
      addLine('Waiting to regrow or decay...', '#607860', '12px');
    } else {
      addLine(`TREE`, '#80d880', '12px');
      addLine(`Type ${tree.type === 0 ? 'A' : 'B'}`, '#607860', '12px');

      y += 4;
      addLine('WOOD RESOURCE', '#556655', '12px');
      addLine(`${Math.floor(tree.health)} / ${tree.maxHealth}`, '#b0a890', '12px');
      addBar(tree.health, tree.maxHealth, 0x8b6914);
    }

    y += 8;
    addLine(`Position: ${tree.x}, ${tree.y}`, '#445544', '12px');
  }

  private updateRockPanel(): void {
    const rock = this.selectedRock!;
    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '13px', yGap = 0) => {
      y += yGap;
      const t = this.add.text(14, y, text, {
        fontFamily: PIXEL_FONT,
        fontSize: size,
        color,
        wordWrap: { width: contentW },
        lineSpacing: 4,
      });
      this.infoPanelContainer.add(t);
      y += parseInt(size) + 10;
      return t;
    };

    const addBar = (value: number, maxVal: number, color: number, width = 220) => {
      const bar = this.add.graphics();
      const pct = Math.max(0, Math.min(1, value / maxVal));
      bar.fillStyle(0x1a1a2e);
      bar.fillRect(14, y, width, 8);
      bar.fillStyle(color);
      bar.fillRect(14, y, width * pct, 8);
      bar.lineStyle(1, 0x2a3a2a);
      bar.strokeRect(14, y, width, 8);
      this.infoPanelContainer.add(bar);
      y += 12;
    };

    if (rock.isRubble) {
      addLine('ROCK RUBBLE', '#8a8a8a', '12px');
      addLine('Crumbled remains...', '#607860', '12px');
    } else {
      addLine(rock.type === 0 ? 'SMALL ROCK' : 'BIG ROCK', '#b0a890', '12px');

      y += 4;
      addLine('STONE RESOURCE', '#556655', '12px');
      addLine(`${Math.floor(rock.health)} / ${rock.maxHealth}`, '#b0a890', '12px');
      addBar(rock.health, rock.maxHealth, 0x8a8a8a);
    }

    y += 8;
    addLine(`Position: ${rock.x}, ${rock.y}`, '#445544', '12px');
  }

  private updatePlantPanel(): void {
    const plant = this.selectedPlant!;
    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '13px', yGap = 0) => {
      y += yGap;
      const t = this.add.text(14, y, text, {
        fontFamily: PIXEL_FONT,
        fontSize: size,
        color,
        wordWrap: { width: contentW },
        lineSpacing: 4,
      });
      this.infoPanelContainer.add(t);
      y += parseInt(size) + 10;
      return t;
    };

    const addBar = (value: number, maxVal: number, color: number, width = 220) => {
      const bar = this.add.graphics();
      const pct = Math.max(0, Math.min(1, value / maxVal));
      bar.fillStyle(0x1a1a2e);
      bar.fillRect(14, y, width, 8);
      bar.fillStyle(color);
      bar.fillRect(14, y, width * pct, 8);
      bar.lineStyle(1, 0x2a3a2a);
      bar.strokeRect(14, y, width, 8);
      this.infoPanelContainer.add(bar);
      y += 12;
    };

    const plantInfo: Record<number, { name: string; color: string; desc: string }> = {
      [PlantType.MUSHROOM]: { name: 'EDIBLE MUSHROOM', color: '#c89050', desc: 'Safe to eat. Restores hunger.' },
      [PlantType.POISON_SHROOM]: { name: 'POISON MUSHROOM', color: '#cc44aa', desc: 'Toxic! Drains health if eaten.' },
      [PlantType.FLOWER]: { name: 'HEALING FLOWER', color: '#ddcc44', desc: 'Restores health when consumed.' },
      [PlantType.STAMINA_HERB]: { name: 'STAMINA HERB', color: '#44ccaa', desc: 'Restores stamina when consumed.' },
      [PlantType.HUNGER_HERB]: { name: 'HUNGER HERB', color: '#88cc44', desc: 'Helps satisfy hunger.' },
      [PlantType.BERRY_BUSH]: { name: 'BERRY BUSH', color: '#80d880', desc: 'Rich food source. 90% seed drop.' },
      [PlantType.EDIBLE_FLOWER]: { name: 'EDIBLE FLOWER', color: '#cccc44', desc: 'Mild food. Slightly satisfies hunger.' },
    };

    const info = plantInfo[plant.type] ?? { name: 'PLANT', color: '#80d880', desc: '' };

    addLine(info.name, info.color, '12px');
    addLine(info.desc, '#607860', '12px');

    if (plant.type === PlantType.BERRY_BUSH) {
      y += 4;
      addLine('FOOD RESOURCE', '#556655', '12px');
      addLine(`${Math.floor(plant.health)} / ${plant.maxHealth}`, '#b0a890', '12px');
      addBar(plant.health, plant.maxHealth, 0x44aa44);
    }

    y += 8;
    addLine(`Position: ${plant.x}, ${plant.y}`, '#445544', '12px');
  }

  private updateAnimalPanel(): void {
    const animal = this.selectedAnimal!;
    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '13px', yGap = 0) => {
      y += yGap;
      const t = this.add.text(14, y, text, {
        fontFamily: PIXEL_FONT,
        fontSize: size,
        color,
        wordWrap: { width: contentW },
        lineSpacing: 4,
      });
      this.infoPanelContainer.add(t);
      y += parseInt(size) + 10;
      return t;
    };

    const addBar = (value: number, maxVal: number, color: number, width = 220) => {
      const bar = this.add.graphics();
      const pct = Math.max(0, Math.min(1, value / maxVal));
      bar.fillStyle(0x1a1a2e);
      bar.fillRect(14, y, width, 8);
      bar.fillStyle(color);
      bar.fillRect(14, y, width * pct, 8);
      bar.lineStyle(1, 0x2a3a2a);
      bar.strokeRect(14, y, width, 8);
      this.infoPanelContainer.add(bar);
      y += 12;
    };

    const addDivider = () => {
      y += 4;
      const div = this.add.graphics();
      div.lineStyle(1, 0x2a3a2a);
      div.lineBetween(14, y, contentW, y);
      this.infoPanelContainer.add(div);
      y += 8;
    };

    // Tier color mapping based on species
    const apexSpecies = ['bear', 'tiger', 'alligator'];
    const midPredSpecies = ['fox', 'cat', 'dog-0'];
    const smallPreySpecies = ['rabbit', 'rat', 'squirrel', 'hedgehog', 'chicken', 'duck'];
    let titleColor = '#80d880'; // default herb
    if (apexSpecies.includes(animal.species)) {
      titleColor = '#cc4444';
    } else if (midPredSpecies.includes(animal.species)) {
      titleColor = '#cc8844';
    } else if (smallPreySpecies.includes(animal.species)) {
      titleColor = '#88bbdd';
    }

    const displayName = animal.species.replace(/-\d+$/, '').toUpperCase();
    addLine(displayName, titleColor, '12px');

    // Current action
    addLine(formatAction(animal.action), '#88bbdd', '10px', 2);

    if (!animal.alive) {
      addLine('DEAD', '#cc4444', '14px', 2);
    }

    y += 4;

    // Needs — emoji + bar, 2 columns (same style as agent panel)
    const animalNeeds: [string, number, number, number][] = [
      ['\u2764\uFE0F',  animal.health,        animal.maxHealth, 0xcc4444],  // ❤️
      ['\uD83E\uDD69',  animal.proteinHunger,  100, 0xcc8844],              // 🥩
      ['\uD83C\uDF3F',  animal.plantHunger,    100, 0x88cc44],              // 🌿
      ['\uD83D\uDCA7',  animal.thirst,         100, 0x4488cc],              // 💧
      ['\u26A1',         animal.stamina,        100, 0x44aa44],              // ⚡
    ];
    const emojiW = 22;
    const colBarW = (contentW / 2) - emojiW - 6;
    const col1x = 14;
    const col2x = 14 + contentW / 2;
    for (let ni = 0; ni < animalNeeds.length; ni += 2) {
      for (let ci = 0; ci < 2; ci++) {
        const idx = ni + ci;
        if (idx >= animalNeeds.length) break;
        const [emoji, val, maxVal, clr] = animalNeeds[idx];
        const cx = ci === 0 ? col1x : col2x;
        const et = this.add.text(cx, y - 2, emoji, { fontSize: '14px' });
        this.infoPanelContainer.add(et);
        const bar = this.add.graphics();
        const bx = cx + emojiW;
        const pct = Math.max(0, Math.min(1, val / maxVal));
        bar.fillStyle(0x1a1a2e); bar.fillRect(bx, y + 2, colBarW, 10);
        bar.fillStyle(clr); bar.fillRect(bx, y + 2, colBarW * pct, 10);
        bar.lineStyle(1, 0x2a3a2a); bar.strokeRect(bx, y + 2, colBarW, 10);
        this.infoPanelContainer.add(bar);
      }
      y += 20;
    }

    // Drops on death
    y += 4;
    addLine('DROPS ON DEATH', '#556655', '12px');
    if (animal.drops) {
      const dropLabels: [keyof DropTable, string, string][] = [
        ['meat', 'Meat', '#cc8866'],
        ['bone', 'Bone', '#ccccaa'],
        ['hide', 'Hide', '#aa8855'],
        ['sinew', 'Sinew', '#bb9977'],
        ['fat', 'Fat', '#ddcc88'],
        ['feathers', 'Feathers', '#aabbcc'],
        ['teeth_claws', 'Teeth/Claws', '#ccaaaa'],
        ['scales', 'Scales', '#88aaaa'],
      ];
      for (const [key, label, color] of dropLabels) {
        const val = animal.drops[key];
        if (val && val > 0) {
          addLine(`${label}: ${val}`, color, '12px');
        }
      }
    } else {
      addLine(`Meat: ${animal.foodDrop}`, '#cc8866', '12px');
    }

    // Taming status
    if (animal.tamed) {
      y += 4;
      addLine('TAMED', '#44cc44', '12px');
    }
    if (!animal.tamed && animal.tamingProgress > 0) {
      y += 4;
      addLine(`Taming: ${animal.tamingProgress}`, '#88aa44', '12px');
    }

    // Breeding cooldown
    if (animal.breedCooldown > 0) {
      addLine(`Breed cooldown: ${Math.ceil(animal.breedCooldown / 10)}s`, '#666660', '12px');
    }

    // Skills (only show non-zero)
    const skillEntries: [string, number][] = [
      ['Combat', animal.skills.combat.level],
      ['Def', animal.skills.defense.level],
      ['Ath', animal.skills.athletics.level],
      ['Surv', animal.skills.survival.level],
    ];
    const nonZero = skillEntries.filter(([, lvl]) => lvl > 0);
    if (nonZero.length > 0) {
      y += 4;
      addLine(nonZero.map(([n, l]) => `${n}:${l}`).join('  '), '#909890', '12px');
    }

    y += 8;
    addLine(`Position: ${Math.floor(animal.x)}, ${Math.floor(animal.y)}`, '#445544', '12px');

    // PLAN section (same as agents)
    addDivider();
    addLine('PLAN', '#556655', '12px');
    if (animal.alive) {
      const reasonRaw = animal.lastDecisionReason ?? animal.action;
      const [reason, topDec] = reasonRaw.split('\n');
      addLine(`\uD83D\uDCAD ${reason}`, '#88aacc', '12px');

      // Show urgent needs
      const priorities: [string, string, number][] = [];
      if (animal.thirst < 40) priorities.push(['\uD83D\uDCA7', 'thirsty', animal.thirst]);
      if (animal.proteinHunger < 40) priorities.push(['\uD83E\uDD69', 'hungry (protein)', animal.proteinHunger]);
      if (animal.plantHunger < 40) priorities.push(['\uD83C\uDF3F', 'hungry (plant)', animal.plantHunger]);
      if (animal.stamina < 30) priorities.push(['\u26A1', 'tired', animal.stamina]);
      if (animal.health < animal.maxHealth * 0.5) priorities.push(['\u2764\uFE0F', 'injured', Math.floor(animal.health / animal.maxHealth * 100)]);

      if (priorities.length > 0) {
        priorities.sort((a, b) => a[2] - b[2]);
        for (const [emoji, label, val] of priorities.slice(0, 3)) {
          const urgency = val < 20 ? '#cc4444' : '#ccaa44';
          addLine(`${emoji} ${label} (${Math.floor(val)})`, urgency, '12px');
        }
      } else {
        addLine('\u2705 all needs met', '#668866', '12px');
      }

      if (topDec) {
        y += 4;
        addLine(topDec, '#555566', '9px');
      }
    } else if (!animal.alive) {
      addLine('\uD83D\uDC80 dead', '#cc4444', '12px');
    }
  }

  private updateCorpsePanel(): void {
    const corpse = this.selectedCorpse!;
    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '13px', yGap = 0) => {
      y += yGap;
      const t = this.add.text(14, y, text, {
        fontFamily: PIXEL_FONT,
        fontSize: size,
        color,
        wordWrap: { width: contentW },
        lineSpacing: 4,
      });
      this.infoPanelContainer.add(t);
      y += parseInt(size) + 10;
      return t;
    };

    // Title
    const sourceName = corpse.sourceName || (corpse.sourceSpecies ? corpse.sourceSpecies.toUpperCase() : 'UNKNOWN');
    addLine(`CORPSE: ${sourceName}`, '#aa7755', '12px');
    addLine(corpse.sourceType === 'agent' ? 'Fallen agent' : `${corpse.sourceSpecies || 'Animal'} remains`, '#607860', '12px');

    y += 4;

    // Materials
    addLine('MATERIALS', '#556655', '12px');
    const materialNames: Record<string, string> = {
      meat: 'Meat', bone: 'Bone', hide: 'Hide', sinew: 'Sinew',
      fat: 'Fat', feathers: 'Feathers', teeth_claws: 'Teeth/Claws', scales: 'Scales',
    };
    const matEntries = Object.entries(corpse.materials).filter(([, v]) => v != null && v > 0);
    if (matEntries.length > 0) {
      for (const [mat, amount] of matEntries) {
        addLine(`${materialNames[mat] || mat}: ${amount}`, '#cc8866', '12px');
      }
    } else {
      addLine('Empty', '#666660', '12px');
    }

    // Carried resources (agent corpses)
    if (corpse.carriedResources) {
      const carriedEntries = Object.entries(corpse.carriedResources).filter(([, v]) => v != null && v > 0);
      if (carriedEntries.length > 0) {
        y += 4;
        addLine('CARRIED ITEMS', '#556655', '12px');
        for (const [res, amount] of carriedEntries) {
          addLine(`${res}: ${amount}`, '#b0a890', '12px');
        }
      }
    }

    // Decay info
    y += 4;
    const totalMats = matEntries.reduce((s, [, v]) => s + (v || 0), 0);
    const carriedTotal = corpse.carriedResources
      ? Object.values(corpse.carriedResources).reduce((s, v) => s + (v || 0), 0)
      : 0;
    addLine(`Total items: ${totalMats + carriedTotal}`, '#888880', '12px');
    addLine('Decaying over time...', '#666660', '12px');

    y += 8;
    addLine(`Position: ${Math.floor(corpse.x)}, ${Math.floor(corpse.y)}`, '#445544', '12px');
  }

  private updateStructurePanel(): void {
    const structure = this.selectedStructure!;
    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '13px', yGap = 0) => {
      y += yGap;
      const t = this.add.text(14, y, text, {
        fontFamily: PIXEL_FONT,
        fontSize: size,
        color,
        wordWrap: { width: contentW },
        lineSpacing: 4,
      });
      this.infoPanelContainer.add(t);
      y += parseInt(size) + 10;
      return t;
    };

    const addBar = (value: number, maxVal: number, color: number, width = 220) => {
      const bar = this.add.graphics();
      const pct = Math.max(0, Math.min(1, value / maxVal));
      bar.fillStyle(0x1a1a2e);
      bar.fillRect(14, y, width, 8);
      bar.fillStyle(color);
      bar.fillRect(14, y, width * pct, 8);
      bar.lineStyle(1, 0x2a3a2a);
      bar.strokeRect(14, y, width, 8);
      this.infoPanelContainer.add(bar);
      y += 12;
    };

    const structureNames: Record<number, { name: string; color: string; desc: string }> = {
      [TileType.CAMPFIRE]: { name: 'CAMPFIRE', color: '#cc8844', desc: 'Provides shelter. Enables campfire crafting.' },
      [TileType.WORKBENCH]: { name: 'WORKBENCH', color: '#c8a060', desc: 'Enables tool and item crafting.' },
      [TileType.FORGE]: { name: 'FORGE', color: '#cc6644', desc: 'Enables iron smelting and forging.' },
      [TileType.BUILT_WALL]: { name: 'WOODEN WALL', color: '#c8a060', desc: 'Blocks movement. Decays over time.' },
      [TileType.STONE_WALL]: { name: 'STONE WALL', color: '#b0b0b0', desc: 'Strong wall. Does not decay.' },
      [TileType.IRON_WALL]: { name: 'IRON WALL', color: '#8888cc', desc: 'Very strong wall. Does not decay.' },
      [TileType.WOOD_DOOR]: { name: 'WOODEN DOOR', color: '#c89050', desc: 'Agents pass through. Animals blocked. Decays.' },
      [TileType.BONE_FENCE]: { name: 'BONE FENCE', color: '#ccccaa', desc: 'Blocks movement. Does not decay.' },
      [TileType.STORAGE]: { name: 'STORAGE', color: '#aa8855', desc: 'Stores items. Decays over time.' },
      [TileType.TENT]: { name: 'TENT', color: '#88aa88', desc: 'Provides shelter.' },
      [TileType.BEDROLL]: { name: 'BEDROLL', color: '#88aa88', desc: 'Provides shelter and rest.' },
      [TileType.ANIMAL_PEN]: { name: 'ANIMAL PEN', color: '#aa8855', desc: 'Keeps tamed animals.' },
    };

    const info = structureNames[structure.tileType] ?? { name: 'STRUCTURE', color: '#c8d0c8', desc: '' };

    addLine(info.name, info.color, '12px');
    addLine(info.desc, '#607860', '12px');

    y += 4;
    addLine('DURABILITY', '#556655', '12px');
    addLine(`${Math.floor(structure.hp)} / ${structure.maxHp}`, '#b0a890', '12px');

    // Color based on HP percentage
    const hpPct = structure.hp / structure.maxHp;
    const hpColor = hpPct > 0.6 ? 0x44aa44 : hpPct > 0.3 ? 0xcc8844 : 0xcc4444;
    addBar(structure.hp, structure.maxHp, hpColor);

    if (structure.ownerId) {
      y += 4;
      const builder = this.agents?.find((a: any) => a.id === structure.ownerId);
      const builderName = builder ? (builder as any).name : structure.ownerId;
      addLine(`Builder: ${builderName}`, '#888880', '12px');
    }

    // Storage contents
    if (structure.storedItems && structure.storedItems.length > 0) {
      y += 4;
      addLine('STORED ITEMS', '#556655', '12px');
      for (const item of structure.storedItems) {
        addLine(`${item.itemId} x${item.quantity}`, '#b0a890', '12px');
      }
    } else if (structure.tileType === TileType.STORAGE) {
      y += 4;
      addLine('STORED ITEMS', '#556655', '12px');
      addLine('Empty', '#666660', '12px');
    }

    y += 8;
    addLine(`Position: ${structure.x}, ${structure.y}`, '#445544', '12px');
  }

  private updateWaterPanel(): void {
    const pos = this.selectedWater!;
    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '13px', yGap = 0) => {
      y += yGap;
      const t = this.add.text(14, y, text, {
        fontFamily: PIXEL_FONT,
        fontSize: size,
        color,
        wordWrap: { width: contentW },
        lineSpacing: 4,
      });
      this.infoPanelContainer.add(t);
      y += parseInt(size) + 10;
      return t;
    };

    addLine('WATER', '#4488cc', '12px');
    addLine('Infinite fresh water source', '#607860', '12px');

    y += 4;
    addLine('SUPPLIES', '#556655', '12px');
    addLine('Drinking water for agents', '#88bbdd', '12px');
    addLine('Quenches thirst on contact', '#88bbdd', '12px');

    y += 8;
    addLine(`Position: ${pos.x}, ${pos.y}`, '#445544', '12px');
  }

  private updateIronOrePanel(): void {
    const pos = this.selectedIronOre!;
    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '13px', yGap = 0) => {
      y += yGap;
      const t = this.add.text(14, y, text, {
        fontFamily: PIXEL_FONT,
        fontSize: size,
        color,
        wordWrap: { width: contentW },
        lineSpacing: 4,
      });
      this.infoPanelContainer.add(t);
      y += parseInt(size) + 10;
      return t;
    };

    addLine('IRON ORE DEPOSIT', '#c06030', '12px');
    addLine('Finite resource — never regrows', '#607860', '12px');

    y += 4;
    addLine('YIELDS', '#556655', '12px');
    addLine('Iron ore (requires pickaxe)', '#c0a060', '12px');
    addLine('Smelt at forge → iron ingots', '#c0a060', '12px');

    y += 4;
    addLine('TIER 4 MATERIAL', '#556655', '12px');
    addLine('Best tools and weapons', '#909890', '12px');

    y += 8;
    addLine(`Position: ${pos.x}, ${pos.y}`, '#445544', '12px');
  }
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
    grazing: 'grazing',
    hunting: 'hunting',
    fleeing: 'fleeing',
    fighting: 'fighting',
    sleeping: 'sleeping',
    traveling: 'traveling',
    breeding: 'breeding',
    stalking: 'stalking',
    following: 'following owner',
    guarding: 'guarding',
    curled: 'curled up',
  };
  return map[action] || action;
}

function agentLevel(agent: AgentState): number {
  return Object.values(agent.skills).reduce((sum, s: any) => sum + (s.level || 0), 0);
}

function getDeathEmoji(agent: AgentState): string {
  // Show emoji for how agent last died (based on lastAttackedBy or needs)
  if (!agent.alive) {
    if (agent.needs.thirst <= 0) return '\uD83D\uDCA7'; // 💧 dehydration
    if (agent.needs.proteinHunger <= 0 || agent.needs.plantHunger <= 0) return '\uD83C\uDF56'; // 🍖 starvation
    if (agent.lastAttackedBy?.type === 'animal') return '\uD83D\uDC3B'; // 🐻 killed by animal
    if (agent.lastAttackedBy?.type === 'agent') return '\u2694\uFE0F'; // ⚔️ killed by agent
    return '\uD83D\uDC80'; // 💀 generic
  }
  // Alive but has died before — show most recent cause hint from deaths count
  if (agent.totalDeaths > 0) return `\uD83D\uDC80\u00D7${agent.totalDeaths}`; // 💀×N
  return '';
}

function computeGodPower(agents: AgentState[]): number {
  let power = 0;
  for (const a of agents) {
    if (!a.alive) continue;
    const totalSkillLevels = agentLevel(a);
    const totalStats = a.baseStats.strength + a.baseStats.toughness
      + a.baseStats.agility + a.baseStats.endurance
      + a.baseStats.perception + a.baseStats.charisma;
    const livesBonus = Math.floor((a.livesRemaining ?? 100) / 10);
    const healthFactor = a.needs.health / 100;
    const equipBonus = (a.inventory.equipped.mainHand ? 5 : 0)
      + (a.inventory.equipped.body ? 5 : 0)
      + (a.inventory.equipped.accessory ? 5 : 0);
    power += Math.floor((totalSkillLevels * 2 + totalStats + livesBonus + equipBonus) * healthFactor);
  }
  return power;
}
