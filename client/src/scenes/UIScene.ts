import Phaser from 'phaser';
import { AgentState, TreeState, RockState, PlantState, PlantType, AnimalState, CorpseState, StructureState, TileType, DropTable, WORLD_WIDTH, WORLD_HEIGHT, Season, OrchestratorRole } from '@supernatural/shared';

const PIXEL_FONT = '"Press Start 2P", monospace';
const PANEL_W = 380;
const SIDEBAR_W = 260;

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

  // Left sidebar
  private sidebarBg!: Phaser.GameObjects.Graphics;
  private sidebarContainer!: Phaser.GameObjects.Container;
  private sidebarMaskGraphics!: Phaser.GameObjects.Graphics;
  private sidebarScrollY = 0;
  private sidebarContentHeight = 0;
  private llmProviderLabels = new Map<string, string>();
  private lastAgentStructureHash = '';

  constructor() {
    super({ key: 'UIScene' });
  }

  create(): void {
    // Stats (top-left)
    this.statsText = this.add.text(12, 12, '', {
      fontFamily: PIXEL_FONT,
      fontSize: '12px',
      color: '#e0e0e0',
      backgroundColor: '#1a1a2e',
      padding: { x: 10, y: 8 },
    }).setDepth(1000);

    // Right panel background
    this.rightPanelBg = this.add.graphics().setDepth(999);

    // Panel title
    this.panelTitle = this.add.text(0, 10, 'SUPERNATURAL', {
      fontFamily: PIXEL_FONT,
      fontSize: '11px',
      color: '#80c080',
    }).setDepth(1000);

    // Info panel container for selected agent
    this.infoPanelContainer = this.add.container(0, 0).setDepth(1000);

    // Events label
    this.logLabel = this.add.text(0, 0, 'EVENTS', {
      fontFamily: PIXEL_FONT,
      fontSize: '9px',
      color: '#556655',
    }).setDepth(1000);

    // Event log text
    this.eventLogText = this.add.text(0, 0, '', {
      fontFamily: PIXEL_FONT,
      fontSize: '9px',
      color: '#a0b0a0',
      lineSpacing: 8,
      wordWrap: { width: PANEL_W - 28 },
    }).setDepth(1000);

    // Controls hint (bottom-left)
    this.controlsText = this.add.text(12, 0, 'WASD:move  Scroll:zoom  Click:select  M:msg  N:new agent', {
      fontFamily: PIXEL_FONT,
      fontSize: '9px',
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
    this.sidebarMaskGraphics.fillRect(0, 0, SIDEBAR_W, h);

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

    // Info panel position
    this.infoPanelContainer.setPosition(panelX, 0);

    // Event log area
    const logH = 240;
    // Divider line for events
    this.rightPanelBg.lineStyle(1, 0x2a3a2a);
    this.rightPanelBg.lineBetween(panelX + 12, h - logH - 24, w - 12, h - logH - 24);

    this.logLabel.setPosition(panelX + 14, h - logH - 40);
    this.eventLogText.setPosition(panelX + 14, h - logH - 12);
    this.eventLogText.setWordWrapWidth(PANEL_W - 28);

    // Controls hint
    this.controlsText.setPosition(12, h - 28);
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

  setSelectedAgent(agent: AgentState | null): void {
    this.selectedAgent = agent;
    this.updateInfoPanel();
  }

  setSelectedTree(tree: TreeState | null): void {
    this.selectedTree = tree;
    this.updateInfoPanel();
  }

  setSelectedRock(rock: RockState | null): void {
    this.selectedRock = rock;
    this.updateInfoPanel();
  }

  setSelectedPlant(plant: PlantState | null): void {
    this.selectedPlant = plant;
    this.updateInfoPanel();
  }

  setSelectedAnimal(animal: AnimalState | null): void {
    this.selectedAnimal = animal;
    this.updateInfoPanel();
  }

  setSelectedCorpse(corpse: CorpseState | null): void {
    this.selectedCorpse = corpse;
    this.updateInfoPanel();
  }

  setSelectedStructure(structure: StructureState | null): void {
    this.selectedStructure = structure;
    this.updateInfoPanel();
  }

  setSelectedWater(pos: { x: number; y: number } | null): void {
    this.selectedWater = pos;
    this.updateInfoPanel();
  }

  setSelectedIronOre(pos: { x: number; y: number } | null): void {
    this.selectedIronOre = pos;
    this.updateInfoPanel();
  }

  // ─── Left Sidebar ───

  updateSidebar(agents: AgentState[]): void {
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
          fontFamily: PIXEL_FONT, fontSize: '7px', color: '#666666',
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
          fontFamily: PIXEL_FONT, fontSize: '10px', color: '#ffd700',
        });
        this.sidebarContainer.add(powerText);

        // Role badge
        const badgeBg = this.add.graphics();
        badgeBg.fillStyle(roleColor, 1);
        badgeBg.fillRoundedRect(SIDEBAR_W - 52, y + 4, 38, 14, 3);
        this.sidebarContainer.add(badgeBg);

        const badgeText = this.add.text(SIDEBAR_W - 33, y + 7, roleBadge, {
          fontFamily: PIXEL_FONT, fontSize: '6px', color: '#0a0a0a',
        }).setOrigin(0.5, 0);
        this.sidebarContainer.add(badgeText);

        // Provider label
        const provText = this.add.text(16, y + 20, providerLabel, {
          fontFamily: PIXEL_FONT, fontSize: '6px', color: '#aaaaaa',
        });
        this.sidebarContainer.add(provText);

        // Agent count
        const countText = this.add.text(16, y + 32, `${aliveCount} agent${aliveCount !== 1 ? 's' : ''}`, {
          fontFamily: PIXEL_FONT, fontSize: '6px', color: '#666666',
        });
        this.sidebarContainer.add(countText);

        y += 48;
      }

      // Agent rows
      for (const agent of groupAgents) {
        this.renderAgentRow(agent, y);
        y += 18;
      }

      y += 8; // Gap between groups
    }

    this.sidebarContentHeight = y;
  }

  private renderAgentRow(agent: AgentState, y: number): void {
    const alive = agent.alive;
    const level = agentLevel(agent);
    const actionLabel = alive ? (ACTION_LABELS[agent.action] ?? agent.action) : 'dead';
    const name = agent.name.length > 8 ? agent.name.slice(0, 7) + '.' : agent.name;

    // Alive dot
    const dot = this.add.graphics();
    dot.fillStyle(alive ? 0x44cc44 : 0x666666, 1);
    dot.fillCircle(16, y + 7, 3);
    this.sidebarContainer.add(dot);

    // Name
    const nameText = this.add.text(24, y + 1, name, {
      fontFamily: PIXEL_FONT, fontSize: '6px', color: alive ? '#cccccc' : '#666666',
    });
    this.sidebarContainer.add(nameText);

    // Level
    const lvText = this.add.text(110, y + 1, `Lv${level}`, {
      fontFamily: PIXEL_FONT, fontSize: '6px', color: alive ? '#aaaaaa' : '#555555',
    });
    this.sidebarContainer.add(lvText);

    // Action
    const actColor = agent.action === 'fighting' ? '#ff6666'
      : agent.action === 'fleeing' ? '#ffaa44'
      : alive ? '#888888' : '#444444';
    const actText = this.add.text(160, y + 1, actionLabel, {
      fontFamily: PIXEL_FONT, fontSize: '6px', color: actColor,
    });
    this.sidebarContainer.add(actText);

    // Click zone for selection
    const zone = this.add.zone(SIDEBAR_W / 2, y + 7, SIDEBAR_W - 12, 16).setInteractive({ useHandCursor: true });
    this.sidebarContainer.add(zone);
    zone.on('pointerup', () => {
      const gameScene = this.scene.get('GameScene') as any;
      if (gameScene?.selectAgentById) {
        gameScene.selectAgentById(agent.id);
      }
    });

    // Hover highlight
    const hoverBg = this.add.graphics();
    hoverBg.setAlpha(0);
    this.sidebarContainer.add(hoverBg);
    zone.on('pointerover', () => {
      hoverBg.clear();
      hoverBg.fillStyle(0xffffff, 0.05);
      hoverBg.fillRect(6, y - 1, SIDEBAR_W - 12, 16);
      hoverBg.setAlpha(1);
    });
    zone.on('pointerout', () => {
      hoverBg.setAlpha(0);
    });
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
        fontSize: '10px',
        color: '#445544',
        lineSpacing: 8,
      });
      this.infoPanelContainer.add(hint);
      return;
    }

    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '10px', yGap = 0) => {
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

    // Agent name
    addLine(agent.name, '#80d880', '12px');
    addLine(agent.personality.join(' / '), '#607860', '8px');

    // Status
    if (agent.alive) {
      addLine(formatAction(agent.action), '#88bbdd', '10px', 2);
    } else {
      addLine('DEAD', '#cc4444', '11px', 2);
    }

    // GOAP Plan
    if (agent.alive && agent.currentPlanGoal && agent.currentPlanSteps && agent.currentPlanSteps.length > 0) {
      addDivider();
      addLine(`Goal: ${agent.currentPlanGoal}`, '#ccaa44', '9px');
      const stepIdx = agent.planStepIndex ?? 0;
      addLine(`Plan [${stepIdx + 1}/${agent.currentPlanSteps.length}]`, '#888866', '8px');
      for (let i = 0; i < agent.currentPlanSteps.length; i++) {
        const step = agent.currentPlanSteps[i];
        const prefix = i < stepIdx ? '\u2705' : i === stepIdx ? '\u25B6' : '\u25CB';
        const color = i < stepIdx ? '#668866' : i === stepIdx ? '#cccc88' : '#666655';
        addLine(`${prefix} ${step.actionName}`, color, '8px');
      }
    }

    addDivider();

    // Needs
    addLine('NEEDS', '#556655', '8px');
    const needsList: [string, number, number][] = [
      ['HP',      agent.needs.health,  0xcc4444],
      ['Protein', agent.needs.proteinHunger, 0xcc8844],
      ['Plant',   agent.needs.plantHunger,   0x88cc44],
      ['Thirst',  agent.needs.thirst,  0x4488cc],
      ['Stamina', agent.needs.stamina, 0x44aa44],
      ['Social',  agent.needs.social,  0xaa44aa],
      ['Shelter', agent.needs.shelter, 0x888844],
    ];
    for (const [label, value, color] of needsList) {
      addLine(`${label}  ${Math.floor(value)}`, '#909890', '8px');
      addBar(value, 100, color);
    }

    // Metabolism indicator (sum of all skill levels / 500 + 1)
    const totalLevels = Object.values(agent.skills).reduce((sum: number, s: any) => sum + (s.level || 0), 0);
    const metabolism = (1 + totalLevels / 500).toFixed(1);
    addLine(`Metabolism: ${metabolism}x`, '#888880', '8px');

    addDivider();

    // Resources — show all non-zero
    addLine('INVENTORY', '#556655', '8px');
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
        const row = nonZeroRes.slice(i, i + 3).map(([n, v]) => `${n}:${v}`).join('  ');
        addLine(row, '#b0a890', '8px');
      }
    } else {
      addLine('(empty)', '#667766', '8px');
    }

    // Inventory - equipped items
    if (agent.inventory?.equipped) {
      const eq = agent.inventory.equipped;
      if (eq.mainHand || eq.body || eq.accessory) {
        addDivider();
        addLine('EQUIPPED', '#556655', '8px');
        if (eq.mainHand) {
          const dur = eq.mainHand.durability !== undefined ? ` (${eq.mainHand.durability})` : '';
          addLine(`Hand: ${eq.mainHand.itemId.replace(/_/g, ' ')}${dur}`, '#b0a890', '8px');
        }
        if (eq.body) {
          const dur = eq.body.durability !== undefined ? ` (${eq.body.durability})` : '';
          addLine(`Body: ${eq.body.itemId.replace(/_/g, ' ')}${dur}`, '#b0a890', '8px');
        }
        if (eq.accessory) {
          addLine(`Acc: ${eq.accessory.itemId.replace(/_/g, ' ')}`, '#b0a890', '8px');
        }
      }
    }

    // Inventory - carried items (non-zero)
    if (agent.inventory?.items?.length > 0) {
      addLine('ITEMS', '#556655', '8px');
      for (const item of agent.inventory.items.slice(0, 6)) { // show max 6
        const dur = item.durability !== undefined ? ` [${item.durability}]` : '';
        const qty = item.quantity > 1 ? `×${item.quantity}` : '';
        addLine(`${item.itemId.replace(/_/g, ' ')} ${qty}${dur}`, '#909890', '8px');
      }
      if (agent.inventory.items.length > 6) {
        addLine(`...+${agent.inventory.items.length - 6} more`, '#667766', '8px');
      }
    }

    // Show carry weight (server-computed exact values)
    if (agent.carryWeight !== undefined && agent.carryCapacity !== undefined) {
      const weightPct = Math.floor((agent.carryWeight / Math.max(1, agent.carryCapacity)) * 100);
      const weightColor = weightPct > 90 ? '#cc4444' : weightPct > 60 ? '#ccaa44' : '#888880';
      addLine(`Weight: ${Math.floor(agent.carryWeight)}/${Math.floor(agent.carryCapacity)}`, weightColor, '8px');
    }

    // Skills
    y += 4;
    addLine('SKILLS', '#556655', '8px');
    addLine(`Combat:${agent.skills.combat.level}  Def:${agent.skills.defense.level}  Ath:${agent.skills.athletics.level}`, '#909890', '8px');
    addLine(`Wood:${agent.skills.woodcutting.level}  Mine:${agent.skills.mining.level}  For:${agent.skills.foraging.level}`, '#909890', '8px');
    addLine(`Build:${agent.skills.building.level}  Craft:${agent.skills.crafting.level}`, '#909890', '8px');
    addLine(`Surv:${agent.skills.survival.level}  Soc:${agent.skills.social.level}`, '#909890', '8px');

    // Obedience
    y += 4;
    addLine(`Obedience: ${agent.obedience}%`, '#888880', '8px');

    // Evolution / Lives
    if (agent.livesRemaining !== undefined) {
      addDivider();
      addLine('EVOLUTION', '#556655', '8px');
      const livesColor = (agent.livesRemaining ?? 100) > 50 ? '#44cc44'
        : (agent.livesRemaining ?? 100) > 20 ? '#cccc44' : '#cc4444';
      addLine(`Lives: ${agent.livesRemaining}`, livesColor, '9px');
      if (agent.genomeVersion !== undefined) {
        addLine(`Genome v${agent.genomeVersion}`, '#888880', '8px');
      }
      if (agent.currentLifeTicks !== undefined) {
        const secs = Math.floor((agent.currentLifeTicks ?? 0) / 10);
        addLine(`Life: ${secs}s`, '#888880', '8px');
      }
      if (agent.lifetimeBestSurvival !== undefined && (agent.lifetimeBestSurvival ?? 0) > 0) {
        const bestSecs = Math.floor((agent.lifetimeBestSurvival ?? 0) / 10);
        addLine(`Best: ${bestSecs}s`, '#888880', '8px');
      }
      if (agent.isHighlander) {
        addLine('HIGHLANDER', '#ffd700', '9px');
      }
      if (agent.llmProviderId && agent.llmRole && agent.llmRole !== 'none') {
        addLine(`AI: ${agent.llmRole} via ${agent.llmProviderId}`, '#80c080', '8px');
      } else {
        addLine('AI: Decision Tree', '#666666', '8px');
      }
      if (agent.activeStrategyRuleNames && agent.activeStrategyRuleNames.length > 0) {
        addLine(`Rules: ${agent.activeStrategyRuleNames.join(', ')}`, '#888866', '7px');
      }
    }

    // Last message
    if (agent.lastMessage) {
      addDivider();
      addLine('LAST MSG', '#556655', '8px');
      addLine(`"${agent.lastMessage.content}"`, '#d4a860', '8px');
      addLine(
        agent.lastMessage.followed ? 'Followed' : 'Ignored',
        agent.lastMessage.followed ? '#44cc44' : '#cc4444',
        '8px'
      );
    }

    y += 8;
    addLine('[M] Send message', '#445544', '8px');
  }

  private updateTreePanel(): void {
    const tree = this.selectedTree!;
    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '10px', yGap = 0) => {
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
      addLine('Waiting to regrow or decay...', '#607860', '8px');
    } else {
      addLine(`TREE`, '#80d880', '12px');
      addLine(`Type ${tree.type === 0 ? 'A' : 'B'}`, '#607860', '8px');

      y += 4;
      addLine('WOOD RESOURCE', '#556655', '8px');
      addLine(`${Math.floor(tree.health)} / ${tree.maxHealth}`, '#b0a890', '8px');
      addBar(tree.health, tree.maxHealth, 0x8b6914);
    }

    y += 8;
    addLine(`Position: ${tree.x}, ${tree.y}`, '#445544', '8px');
  }

  private updateRockPanel(): void {
    const rock = this.selectedRock!;
    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '10px', yGap = 0) => {
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
      addLine('Crumbled remains...', '#607860', '8px');
    } else {
      addLine(rock.type === 0 ? 'SMALL ROCK' : 'BIG ROCK', '#b0a890', '12px');

      y += 4;
      addLine('STONE RESOURCE', '#556655', '8px');
      addLine(`${Math.floor(rock.health)} / ${rock.maxHealth}`, '#b0a890', '8px');
      addBar(rock.health, rock.maxHealth, 0x8a8a8a);
    }

    y += 8;
    addLine(`Position: ${rock.x}, ${rock.y}`, '#445544', '8px');
  }

  private updatePlantPanel(): void {
    const plant = this.selectedPlant!;
    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '10px', yGap = 0) => {
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
    addLine(info.desc, '#607860', '8px');

    if (plant.type === PlantType.BERRY_BUSH) {
      y += 4;
      addLine('FOOD RESOURCE', '#556655', '8px');
      addLine(`${Math.floor(plant.health)} / ${plant.maxHealth}`, '#b0a890', '8px');
      addBar(plant.health, plant.maxHealth, 0x44aa44);
    }

    y += 8;
    addLine(`Position: ${plant.x}, ${plant.y}`, '#445544', '8px');
  }

  private updateAnimalPanel(): void {
    const animal = this.selectedAnimal!;
    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '10px', yGap = 0) => {
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
      addLine('DEAD', '#cc4444', '11px', 2);
    }

    y += 4;

    // Health bar
    addLine(`Health  ${Math.floor(animal.health)}/${animal.maxHealth}`, '#909890', '8px');
    addBar(animal.health, animal.maxHealth, 0xcc4444);

    // Hunger bars
    addLine(`Protein  ${Math.floor(animal.proteinHunger)}`, '#909890', '8px');
    addBar(animal.proteinHunger, 100, 0xcc8844);
    addLine(`Plant  ${Math.floor(animal.plantHunger)}`, '#909890', '8px');
    addBar(animal.plantHunger, 100, 0x88cc44);

    // Thirst bar
    addLine(`Thirst  ${Math.floor(animal.thirst)}`, '#909890', '8px');
    addBar(animal.thirst, 100, 0x4488cc);

    // Stamina bar
    addLine(`Stamina  ${Math.floor(animal.stamina)}`, '#909890', '8px');
    addBar(animal.stamina, 100, 0x44aa44);

    // Drops on death
    y += 4;
    addLine('DROPS ON DEATH', '#556655', '8px');
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
          addLine(`${label}: ${val}`, color, '8px');
        }
      }
    } else {
      addLine(`Meat: ${animal.foodDrop}`, '#cc8866', '8px');
    }

    // Taming status
    if (animal.tamed) {
      y += 4;
      addLine('TAMED', '#44cc44', '8px');
    }
    if (!animal.tamed && animal.tamingProgress > 0) {
      y += 4;
      addLine(`Taming: ${animal.tamingProgress}`, '#88aa44', '8px');
    }

    // Breeding cooldown
    if (animal.breedCooldown > 0) {
      addLine(`Breed cooldown: ${Math.ceil(animal.breedCooldown / 10)}s`, '#666660', '8px');
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
      addLine(nonZero.map(([n, l]) => `${n}:${l}`).join('  '), '#909890', '8px');
    }

    y += 8;
    addLine(`Position: ${Math.floor(animal.x)}, ${Math.floor(animal.y)}`, '#445544', '8px');
  }

  private updateCorpsePanel(): void {
    const corpse = this.selectedCorpse!;
    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '10px', yGap = 0) => {
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
    addLine(corpse.sourceType === 'agent' ? 'Fallen agent' : `${corpse.sourceSpecies || 'Animal'} remains`, '#607860', '8px');

    y += 4;

    // Materials
    addLine('MATERIALS', '#556655', '8px');
    const materialNames: Record<string, string> = {
      meat: 'Meat', bone: 'Bone', hide: 'Hide', sinew: 'Sinew',
      fat: 'Fat', feathers: 'Feathers', teeth_claws: 'Teeth/Claws', scales: 'Scales',
    };
    const matEntries = Object.entries(corpse.materials).filter(([, v]) => v != null && v > 0);
    if (matEntries.length > 0) {
      for (const [mat, amount] of matEntries) {
        addLine(`${materialNames[mat] || mat}: ${amount}`, '#cc8866', '8px');
      }
    } else {
      addLine('Empty', '#666660', '8px');
    }

    // Carried resources (agent corpses)
    if (corpse.carriedResources) {
      const carriedEntries = Object.entries(corpse.carriedResources).filter(([, v]) => v != null && v > 0);
      if (carriedEntries.length > 0) {
        y += 4;
        addLine('CARRIED ITEMS', '#556655', '8px');
        for (const [res, amount] of carriedEntries) {
          addLine(`${res}: ${amount}`, '#b0a890', '8px');
        }
      }
    }

    // Decay info
    y += 4;
    const totalMats = matEntries.reduce((s, [, v]) => s + (v || 0), 0);
    const carriedTotal = corpse.carriedResources
      ? Object.values(corpse.carriedResources).reduce((s, v) => s + (v || 0), 0)
      : 0;
    addLine(`Total items: ${totalMats + carriedTotal}`, '#888880', '8px');
    addLine('Decaying over time...', '#666660', '8px');

    y += 8;
    addLine(`Position: ${Math.floor(corpse.x)}, ${Math.floor(corpse.y)}`, '#445544', '8px');
  }

  private updateStructurePanel(): void {
    const structure = this.selectedStructure!;
    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '10px', yGap = 0) => {
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
      [TileType.BUILT_WALL]: { name: 'WOODEN WALL', color: '#c8a060', desc: 'Blocks movement. Decays over time.' },
      [TileType.STONE_WALL]: { name: 'STONE WALL', color: '#b0b0b0', desc: 'Strong wall. Does not decay.' },
      [TileType.IRON_WALL]: { name: 'IRON WALL', color: '#8888cc', desc: 'Very strong wall. Does not decay.' },
      [TileType.WOOD_DOOR]: { name: 'WOODEN DOOR', color: '#c89050', desc: 'Agents pass through. Animals blocked. Decays.' },
      [TileType.BONE_FENCE]: { name: 'BONE FENCE', color: '#ccccaa', desc: 'Blocks movement. Does not decay.' },
      [TileType.STORAGE]: { name: 'STORAGE', color: '#aa8855', desc: 'Stores items. Decays over time.' },
      [TileType.TENT]: { name: 'TENT', color: '#88aa88', desc: 'Provides shelter.' },
    };

    const info = structureNames[structure.tileType] ?? { name: 'STRUCTURE', color: '#c8d0c8', desc: '' };

    addLine(info.name, info.color, '12px');
    addLine(info.desc, '#607860', '8px');

    y += 4;
    addLine('DURABILITY', '#556655', '8px');
    addLine(`${Math.floor(structure.hp)} / ${structure.maxHp}`, '#b0a890', '8px');

    // Color based on HP percentage
    const hpPct = structure.hp / structure.maxHp;
    const hpColor = hpPct > 0.6 ? 0x44aa44 : hpPct > 0.3 ? 0xcc8844 : 0xcc4444;
    addBar(structure.hp, structure.maxHp, hpColor);

    if (structure.ownerId) {
      y += 4;
      addLine(`Builder: ${structure.ownerId}`, '#888880', '8px');
    }

    // Storage contents
    if (structure.storedItems && structure.storedItems.length > 0) {
      y += 4;
      addLine('STORED ITEMS', '#556655', '8px');
      for (const item of structure.storedItems) {
        addLine(`${item.itemId} x${item.quantity}`, '#b0a890', '8px');
      }
    } else if (structure.tileType === TileType.STORAGE) {
      y += 4;
      addLine('STORED ITEMS', '#556655', '8px');
      addLine('Empty', '#666660', '8px');
    }

    y += 8;
    addLine(`Position: ${structure.x}, ${structure.y}`, '#445544', '8px');
  }

  private updateWaterPanel(): void {
    const pos = this.selectedWater!;
    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '10px', yGap = 0) => {
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
    addLine('Infinite fresh water source', '#607860', '8px');

    y += 4;
    addLine('SUPPLIES', '#556655', '8px');
    addLine('Drinking water for agents', '#88bbdd', '8px');
    addLine('Quenches thirst on contact', '#88bbdd', '8px');

    y += 8;
    addLine(`Position: ${pos.x}, ${pos.y}`, '#445544', '8px');
  }

  private updateIronOrePanel(): void {
    const pos = this.selectedIronOre!;
    let y = 46;
    const contentW = PANEL_W - 28;

    const addLine = (text: string, color = '#c8d0c8', size = '10px', yGap = 0) => {
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
    addLine('Finite resource — never regrows', '#607860', '8px');

    y += 4;
    addLine('YIELDS', '#556655', '8px');
    addLine('Iron ore (requires pickaxe)', '#c0a060', '8px');
    addLine('Smelt at forge → iron ingots', '#c0a060', '8px');

    y += 4;
    addLine('TIER 4 MATERIAL', '#556655', '8px');
    addLine('Best tools and weapons', '#909890', '8px');

    y += 8;
    addLine(`Position: ${pos.x}, ${pos.y}`, '#445544', '8px');
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
