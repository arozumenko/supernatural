import Phaser from 'phaser';
import { GameConfig, DEFAULT_GAME_CONFIG, ROLE_PERMISSIONS, AGENT_ARCHETYPES } from '@supernatural/shared';
import type { OrchestratorRole, AgentArchetype } from '@supernatural/shared';

const PIXEL_FONT = '"Press Start 2P", monospace';

const MAP_PRESETS = [
  { label: 'Small', width: 80, height: 60 },
  { label: 'Medium', width: 120, height: 90 },
  { label: 'Large', width: 160, height: 120 },
];

const TREE_PRESETS = [
  { label: 'Sparse', value: 0.25 },
  { label: 'Normal', value: 0.40 },
  { label: 'Dense', value: 0.55 },
];

const ANIMAL_PRESETS = [
  { label: 'Low', value: 100 },
  { label: 'Normal', value: 200 },
  { label: 'High', value: 300 },
];

interface LLMProviderInfo {
  id: string;
  label: string;
}

export class MainMenuScene extends Phaser.Scene {
  private config: GameConfig = { ...DEFAULT_GAME_CONFIG };
  private mapSizeIndex = 1;  // Medium
  private treeDensityIndex = 1;  // Normal
  private animalPopIndex = 1;  // Normal

  // LLM assignment
  private llmProviders: LLMProviderInfo[] = [];
  private agentAssignments: ({ providerId: string; role: OrchestratorRole } | null)[] = [];
  private agentArchetypes: AgentArchetype[] = [];
  private agentAIContainer?: Phaser.GameObjects.Container;
  private agentAIRows: {
    label: Phaser.GameObjects.Text;
    providerBg: Phaser.GameObjects.Graphics;
    providerText: Phaser.GameObjects.Text;
    providerZone: Phaser.GameObjects.Zone;
    roleBg: Phaser.GameObjects.Graphics;
    roleText: Phaser.GameObjects.Text;
    roleZone: Phaser.GameObjects.Zone;
    archBg: Phaser.GameObjects.Graphics;
    archText: Phaser.GameObjects.Text;
    archZone: Phaser.GameObjects.Zone;
    index: number;
  }[] = [];
  private bulkContainer?: Phaser.GameObjects.Container;

  // Layout constants
  private panelX = 0;
  private panelY = 0;
  private panelW = 0;
  private controlX = 0;
  private labelX = 0;

  constructor() {
    super({ key: 'MainMenuScene' });
  }

  create(data?: { fromResults?: boolean; preloadGenome?: any }): void {
    // Only auto-rejoin on page reload — not when coming from results screen
    if (!data?.fromResults) {
      this.checkExistingGame();
    }

    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;

    // Background
    this.cameras.main.setBackgroundColor('#0a0a0a');

    // Animated background particles
    for (let i = 0; i < 40; i++) {
      const dot = this.add.circle(
        Math.random() * width,
        Math.random() * height,
        Math.random() * 1.5 + 0.5,
        0x334433, 0.4
      );
      this.tweens.add({
        targets: dot,
        y: dot.y - 30 - Math.random() * 20,
        alpha: 0,
        duration: 3000 + Math.random() * 4000,
        repeat: -1,
        yoyo: true,
        delay: Math.random() * 3000,
      });
    }

    // Two-column panel
    this.panelW = 1100;
    const panelH = 620;
    this.panelX = cx - this.panelW / 2;
    this.panelY = cy - panelH / 2;

    const colW = (this.panelW - 30) / 2; // two columns with gap
    const leftColX = this.panelX + 15;
    const rightColX = this.panelX + colW + 20;
    this.labelX = leftColX + 20;
    this.controlX = leftColX + 180;

    const panel = this.add.graphics();
    panel.fillStyle(0x1a1a2e, 0.92);
    panel.fillRoundedRect(this.panelX, this.panelY, this.panelW, panelH, 8);
    panel.lineStyle(2, 0x80c080, 0.6);
    panel.strokeRoundedRect(this.panelX, this.panelY, this.panelW, panelH, 8);

    // Title
    this.add.text(cx, this.panelY + 36, 'SUPERNATURAL', {
      fontFamily: PIXEL_FONT,
      fontSize: '28px',
      color: '#80c080',
    }).setOrigin(0.5);

    this.add.text(cx, this.panelY + 62, '~ civilization simulator ~', {
      fontFamily: PIXEL_FONT,
      fontSize: '14px',
      color: '#666666',
    }).setOrigin(0.5);

    // Divider under title
    const divG = this.add.graphics();
    divG.lineStyle(1, 0x334433, 0.6);
    divG.lineBetween(this.panelX + 30, this.panelY + 80, this.panelX + this.panelW - 30, this.panelY + 80);

    // === LEFT COLUMN: World Settings ===
    const contentTop = this.panelY + 95;

    this.add.text(leftColX + colW / 2, contentTop, 'WORLD SETTINGS', {
      fontFamily: PIXEL_FONT,
      fontSize: '14px',
      color: '#80c080',
    }).setOrigin(0.5);

    let rowY = contentTop + 30;
    const rowH = 46;

    // Map Size
    this.addLabel(this.labelX, rowY, 'Map Size');
    this.addToggleButtons(this.controlX, rowY, MAP_PRESETS.map(p => p.label), this.mapSizeIndex, (i) => {
      this.mapSizeIndex = i;
      this.config.worldWidth = MAP_PRESETS[i].width;
      this.config.worldHeight = MAP_PRESETS[i].height;
    });
    rowY += rowH;

    // Agents
    this.addLabel(this.labelX, rowY, 'Agents');
    this.addStepper(this.controlX, rowY, this.config.agentCount, 3, 20, 1, (v) => {
      this.config.agentCount = v;
      this.rebuildAgentAIList();
    });
    rowY += rowH;

    // Water
    this.addLabel(this.labelX, rowY, 'Water');
    this.addStepper(this.controlX, rowY, Math.round(this.config.waterCoverage * 100), 10, 40, 5, (v) => {
      this.config.waterCoverage = v / 100;
    }, '%');
    rowY += rowH;

    // Trees
    this.addLabel(this.labelX, rowY, 'Trees');
    this.addToggleButtons(this.controlX, rowY, TREE_PRESETS.map(p => p.label), this.treeDensityIndex, (i) => {
      this.treeDensityIndex = i;
      this.config.natureBudget = TREE_PRESETS[i].value;
    });
    rowY += rowH;

    // Animals
    this.addLabel(this.labelX, rowY, 'Animals');
    this.addToggleButtons(this.controlX, rowY, ANIMAL_PRESETS.map(p => p.label), this.animalPopIndex, (i) => {
      this.animalPopIndex = i;
      this.config.maxAnimals = ANIMAL_PRESETS[i].value;
    });

    // === RIGHT COLUMN: Agent AI ===
    this.add.text(rightColX + colW / 2, contentTop, 'AGENT AI', {
      fontFamily: PIXEL_FONT,
      fontSize: '14px',
      color: '#80c080',
    }).setOrigin(0.5);

    // Vertical divider between columns
    const colDiv = this.add.graphics();
    colDiv.lineStyle(1, 0x334433, 0.4);
    colDiv.lineBetween(rightColX - 5, contentTop - 5, rightColX - 5, this.panelY + panelH - 80);

    // Agent AI list (scrollable area in right column)
    const listAreaY = contentTop + 28;
    const listAreaH = panelH - 260;

    const listBg = this.add.graphics();
    listBg.fillStyle(0x111122, 0.6);
    listBg.fillRoundedRect(rightColX, listAreaY, colW - 10, listAreaH, 4);

    // Create container for agent rows
    this.agentAIContainer = this.add.container(0, 0);

    // Mask for scrollable area
    const maskShape = this.add.graphics();
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(rightColX, listAreaY, colW - 10, listAreaH);
    maskShape.setVisible(false);
    const mask = maskShape.createGeometryMask();
    this.agentAIContainer.setMask(mask);

    // Store layout info
    (this as any)._listAreaY = listAreaY;
    (this as any)._listAreaH = listAreaH;
    (this as any)._rightColX = rightColX;
    (this as any)._colW = colW;

    // Initialize assignments
    this.agentAssignments = new Array(this.config.agentCount).fill(null);
    this.agentArchetypes = new Array(this.config.agentCount).fill('random');

    // Fetch LLM providers then build list
    this.fetchLLMProviders().then(() => {
      this.rebuildAgentAIList();
    });

    // Bulk assignment buttons
    this.bulkContainer = this.add.container(0, 0);
    (this as any)._bulkY = listAreaY + listAreaH + 8;

    // === START BUTTON (centered below both columns) ===
    const btnW = 260;
    const btnH = 48;
    const btnX = cx - btnW / 2;
    const btnY = this.panelY + panelH - 65;

    const btnBg = this.add.graphics();
    this.drawButton(btnBg, btnX, btnY, btnW, btnH, 0x80c080, false);

    const btnText = this.add.text(cx, btnY + btnH / 2, 'START GAME', {
      fontFamily: PIXEL_FONT,
      fontSize: '16px',
      color: '#0a0a0a',
    }).setOrigin(0.5);

    const btnZone = this.add.zone(cx, btnY + btnH / 2, btnW, btnH).setInteractive({ useHandCursor: true });

    btnZone.on('pointerover', () => {
      this.drawButton(btnBg, btnX, btnY, btnW, btnH, 0xa0e0a0, false);
    });
    btnZone.on('pointerout', () => {
      this.drawButton(btnBg, btnX, btnY, btnW, btnH, 0x80c080, false);
    });
    btnZone.on('pointerdown', () => {
      this.drawButton(btnBg, btnX, btnY, btnW, btnH, 0x60a060, false);
    });
    btnZone.on('pointerup', () => {
      this.startGame();
    });

    // Pulse animation
    this.tweens.add({
      targets: btnText,
      alpha: 0.7,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Scroll handling for agent list
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: any[], _deltaX: number, deltaY: number) => {
      if (!this.agentAIContainer) return;
      const listAreaY = (this as any)._listAreaY as number;
      const listAreaH = (this as any)._listAreaH as number;
      const maxScroll = Math.max(0, this.agentAIRows.length * 42 - listAreaH + 8);
      const currentY = this.agentAIContainer.y;
      const newY = Phaser.Math.Clamp(currentY - deltaY * 0.5, -maxScroll, 0);
      this.agentAIContainer.y = newY;
    });

    // Version (top-right corner of panel)
    this.add.text(this.panelX + this.panelW - 20, this.panelY + 12, 'v0.2.0', {
      fontFamily: PIXEL_FONT,
      fontSize: '14px',
      color: '#444444',
    }).setOrigin(1, 0);
  }

  private async checkExistingGame(): Promise<void> {
    try {
      const res = await fetch('http://localhost:3001/api/status');
      if (res.ok) {
        const status = await res.json();
        if (status.alive > 0 || status.ticks > 10) {
          // Game already running — skip menu, rejoin directly
          this.scene.start('GameScene', { rejoin: true });
          return;
        }
      }
    } catch {
      // Server not available — show menu normally
    }
  }

  private async fetchLLMProviders(): Promise<void> {
    try {
      const res = await fetch('http://localhost:3001/api/llm-providers');
      if (res.ok) {
        this.llmProviders = await res.json();
      }
    } catch {
      // Server not running or no providers configured
      this.llmProviders = [];
    }
    this.rebuildBulkButtons();
  }

  private rebuildAgentAIList(): void {
    if (!this.agentAIContainer) return;

    const listAreaY = (this as any)._listAreaY as number;

    // Clear existing rows
    for (const row of this.agentAIRows) {
      row.label.destroy();
      row.providerBg.destroy();
      row.providerText.destroy();
      row.providerZone.destroy();
      row.roleBg.destroy();
      row.roleText.destroy();
      row.roleZone.destroy();
      row.archBg.destroy();
      row.archText.destroy();
      row.archZone.destroy();
    }
    this.agentAIRows = [];

    // Resize assignments array
    const oldLen = this.agentAssignments.length;
    this.agentAssignments.length = this.config.agentCount;
    this.agentArchetypes.length = this.config.agentCount;
    for (let i = oldLen; i < this.config.agentCount; i++) {
      this.agentAssignments[i] = null;
      this.agentArchetypes[i] = 'random';
    }

    // Reset scroll
    this.agentAIContainer.y = 0;

    const btnH = 32;
    const rowH = btnH + 10;
    const startY = listAreaY + 6;
    const rightColX = (this as any)._rightColX as number;
    const colW = (this as any)._colW as number;
    const labelW = 50;
    const gap = 6;
    const availW = colW - 10 - labelW - gap * 2;
    const btn1W = Math.floor(availW * 0.35); // provider
    const btn2W = Math.floor(availW * 0.30); // role
    const btn3W = availW - btn1W - btn2W;     // archetype
    const btn1X = rightColX + labelW;
    const btn2X = btn1X + btn1W + gap;
    const btn3X = btn2X + btn2W + gap;

    for (let i = 0; i < this.config.agentCount; i++) {
      const y = startY + i * rowH;

      const label = this.add.text(rightColX + 8, y + 8, `${i + 1}.`, {
        fontFamily: PIXEL_FONT, fontSize: '14px', color: '#aaaaaa',
      });
      this.agentAIContainer.add(label);

      const assignment = this.agentAssignments[i];
      const provLabel = this.getProviderLabel(assignment?.providerId ?? null);
      const roleLabel = assignment?.role ?? 'none';
      const archLabel = AGENT_ARCHETYPES[this.agentArchetypes[i] ?? 'random']?.label ?? 'Random';

      // Provider button
      const providerBg = this.add.graphics();
      this.drawSmallButton(providerBg, btn1X, y, btn1W, btnH, false);
      this.agentAIContainer.add(providerBg);
      const providerText = this.add.text(btn1X + btn1W / 2, y + btnH / 2, provLabel, {
        fontFamily: PIXEL_FONT, fontSize: '10px', color: assignment ? '#80c080' : '#888888',
      }).setOrigin(0.5);
      this.agentAIContainer.add(providerText);
      const providerZone = this.add.zone(btn1X + btn1W / 2, y + btnH / 2, btn1W, btnH).setInteractive({ useHandCursor: true });
      this.agentAIContainer.add(providerZone);
      const idx = i;
      providerZone.on('pointerup', () => this.cycleProvider(idx));

      // Role button
      const roleBg = this.add.graphics();
      this.drawSmallButton(roleBg, btn2X, y, btn2W, btnH, false);
      this.agentAIContainer.add(roleBg);
      const roleText = this.add.text(btn2X + btn2W / 2, y + btnH / 2, roleLabel, {
        fontFamily: PIXEL_FONT, fontSize: '10px', color: assignment ? '#c0a060' : '#666666',
      }).setOrigin(0.5);
      this.agentAIContainer.add(roleText);
      const roleZone = this.add.zone(btn2X + btn2W / 2, y + btnH / 2, btn2W, btnH).setInteractive({ useHandCursor: true });
      this.agentAIContainer.add(roleZone);
      roleZone.on('pointerup', () => this.cycleRole(idx));

      // Archetype button
      const archBg = this.add.graphics();
      this.drawSmallButton(archBg, btn3X, y, btn3W, btnH, false);
      this.agentAIContainer.add(archBg);
      const archText = this.add.text(btn3X + btn3W / 2, y + btnH / 2, archLabel, {
        fontFamily: PIXEL_FONT, fontSize: '10px', color: '#88aacc',
      }).setOrigin(0.5);
      this.agentAIContainer.add(archText);
      const archZone = this.add.zone(btn3X + btn3W / 2, y + btnH / 2, btn3W, btnH).setInteractive({ useHandCursor: true });
      this.agentAIContainer.add(archZone);
      archZone.on('pointerup', () => this.cycleArchetype(idx));

      this.agentAIRows.push({ label, providerBg, providerText, providerZone, roleBg, roleText, roleZone, archBg, archText, archZone, index: i });
    }
  }

  private cycleProvider(agentIndex: number): void {
    const options: (string | null)[] = [null, ...this.llmProviders.map(p => p.id)];
    const current = this.agentAssignments[agentIndex];
    const currentProviderId = current?.providerId ?? null;
    const currentIdx = options.indexOf(currentProviderId);
    const nextIdx = (currentIdx + 1) % options.length;
    const nextProvider = options[nextIdx];

    if (nextProvider === null) {
      this.agentAssignments[agentIndex] = null;
    } else {
      this.agentAssignments[agentIndex] = {
        providerId: nextProvider,
        role: current?.role ?? 'advisor',
      };
    }
    this.updateRowDisplay(agentIndex);
  }

  private cycleRole(agentIndex: number): void {
    const roles: OrchestratorRole[] = ['advisor', 'puppeteer', 'god', 'darwinist', 'parent', 'chaos_demon'];
    const current = this.agentAssignments[agentIndex];
    if (!current) return; // No provider assigned, can't set role

    const currentIdx = roles.indexOf(current.role);
    const nextIdx = (currentIdx + 1) % roles.length;
    current.role = roles[nextIdx];
    this.updateRowDisplay(agentIndex);
  }

  private cycleArchetype(agentIndex: number): void {
    const archetypes: AgentArchetype[] = ['random', 'warrior', 'survivor', 'builder', 'scout', 'social'];
    const current = this.agentArchetypes[agentIndex] ?? 'random';
    const currentIdx = archetypes.indexOf(current);
    const nextIdx = (currentIdx + 1) % archetypes.length;
    this.agentArchetypes[agentIndex] = archetypes[nextIdx];
    this.updateRowDisplay(agentIndex);
  }

  private updateRowDisplay(agentIndex: number): void {
    const row = this.agentAIRows.find(r => r.index === agentIndex);
    if (!row) return;
    const assignment = this.agentAssignments[agentIndex];
    const provLabel = this.getProviderLabel(assignment?.providerId ?? null);
    const roleLabel = assignment?.role ?? 'none';
    row.providerText.setText(provLabel);
    row.providerText.setColor(assignment ? '#80c080' : '#888888');
    row.roleText.setText(roleLabel);
    row.roleText.setColor(assignment ? '#c0a060' : '#666666');
    const archLabel = AGENT_ARCHETYPES[this.agentArchetypes[agentIndex] ?? 'random']?.label ?? 'Random';
    row.archText.setText(archLabel);
  }

  private getProviderLabel(providerId: string | null): string {
    if (!providerId) return 'No LLM';
    const provider = this.llmProviders.find(p => p.id === providerId);
    return provider?.label ?? providerId;
  }

  private rebuildBulkButtons(): void {
    if (!this.bulkContainer) return;
    this.bulkContainer.removeAll(true);

    const bulkY = (this as any)._bulkY as number;
    const rightColX = (this as any)._rightColX as number;
    const colW = (this as any)._colW as number;
    const options: { label: string; value: string | null }[] = [
      { label: 'No LLM', value: null },
      ...this.llmProviders.map(p => ({ label: p.label, value: p.id })),
    ];

    const gap = 10;
    const availBulkW = colW - 20;
    const btnW = Math.floor((availBulkW - gap * (options.length - 1)) / options.length);
    const totalW = options.length * btnW + (options.length - 1) * gap;
    const startX = rightColX + (colW - 10 - totalW) / 2;
    const bulkBtnH = 30;

    options.forEach((opt, i) => {
      const bx = startX + i * (btnW + gap);
      const bg = this.add.graphics();
      this.drawSmallButton(bg, bx, bulkY, btnW, bulkBtnH, false);
      this.bulkContainer!.add(bg);

      const text = this.add.text(bx + btnW / 2, bulkY + bulkBtnH / 2, 'ALL: ' + opt.label, {
        fontFamily: PIXEL_FONT,
        fontSize: '11px',
        color: '#aaaaaa',
      }).setOrigin(0.5);
      this.bulkContainer!.add(text);

      const zone = this.add.zone(bx + btnW / 2, bulkY + bulkBtnH / 2, btnW, bulkBtnH).setInteractive({ useHandCursor: true });
      this.bulkContainer!.add(zone);

      zone.on('pointerup', () => {
        // Assign all agents to this provider with default role
        for (let j = 0; j < this.agentAssignments.length; j++) {
          this.agentAssignments[j] = opt.value ? { providerId: opt.value, role: 'advisor' } : null;
        }
        // Update display
        for (const row of this.agentAIRows) {
          this.updateRowDisplay(row.index);
        }
      });
    });
  }

  private startGame(): void {
    // Build LLM assignments map with provider + role
    const assignments: Record<number, { providerId: string; role: OrchestratorRole } | null> = {};
    this.agentAssignments.forEach((assignment, i) => {
      assignments[i] = assignment;
    });
    this.config.agentLLMAssignments = assignments;

    // Build archetype map
    const archetypes: Record<number, AgentArchetype> = {};
    this.agentArchetypes.forEach((arch, i) => { archetypes[i] = arch; });
    this.config.agentArchetypes = archetypes;

    this.scene.start('GameScene', { gameConfig: this.config });
  }

  // ─── UI Helpers ───

  private addLabel(x: number, y: number, text: string): void {
    this.add.text(x, y + 6, text, {
      fontFamily: PIXEL_FONT,
      fontSize: '14px',
      color: '#cccccc',
    });
  }

  private addToggleButtons(
    x: number, y: number, labels: string[], activeIndex: number,
    onChange: (index: number) => void
  ): void {
    const btnW = 110;
    const btnH = 34;
    const gap = 8;
    const buttons: { bg: Phaser.GameObjects.Graphics; text: Phaser.GameObjects.Text; zone: Phaser.GameObjects.Zone }[] = [];

    labels.forEach((label, i) => {
      const bx = x + i * (btnW + gap);
      const bg = this.add.graphics();
      const isActive = i === activeIndex;
      this.drawSmallButton(bg, bx, y, btnW, btnH, isActive);

      const text = this.add.text(bx + btnW / 2, y + btnH / 2, label, {
        fontFamily: PIXEL_FONT,
        fontSize: '14px',
        color: isActive ? '#e0ffe0' : '#aaaaaa',
      }).setOrigin(0.5);
      text.setShadow(0, 0, '#000000', isActive ? 2 : 0);

      const zone = this.add.zone(bx + btnW / 2, y + btnH / 2, btnW, btnH).setInteractive({ useHandCursor: true });
      buttons.push({ bg, text, zone });

      zone.on('pointerup', () => {
        onChange(i);
        buttons.forEach((btn, j) => {
          const active = j === i;
          this.drawSmallButton(btn.bg, x + j * (btnW + gap), y, btnW, btnH, active);
          btn.text.setColor(active ? '#e0ffe0' : '#aaaaaa');
          btn.text.setShadow(0, 0, '#000000', active ? 2 : 0);
        });
      });
    });
  }

  private addStepper(
    x: number, y: number, initial: number, min: number, max: number, step: number,
    onChange: (value: number) => void, suffix: string = ''
  ): void {
    let value = initial;
    const arrowW = 42;
    const arrowH = 34;
    const totalW = 240;
    const valueCx = x + totalW / 2;

    const valueText = this.add.text(valueCx, y + arrowH / 2, `${value}${suffix}`, {
      fontFamily: PIXEL_FONT,
      fontSize: '16px',
      color: '#ffffff',
    }).setOrigin(0.5);

    // Left arrow
    const leftBg = this.add.graphics();
    this.drawSmallButton(leftBg, x, y, arrowW, arrowH, false);
    this.add.text(x + arrowW / 2, y + arrowH / 2, '<', {
      fontFamily: PIXEL_FONT, fontSize: '16px', color: '#80c080',
    }).setOrigin(0.5);
    const leftZone = this.add.zone(x + arrowW / 2, y + arrowH / 2, arrowW, arrowH).setInteractive({ useHandCursor: true });
    leftZone.on('pointerup', () => {
      value = Math.max(min, value - step);
      valueText.setText(`${value}${suffix}`);
      onChange(value);
    });

    // Right arrow
    const rightX = x + totalW - arrowW;
    const rightBg = this.add.graphics();
    this.drawSmallButton(rightBg, rightX, y, arrowW, arrowH, false);
    this.add.text(rightX + arrowW / 2, y + arrowH / 2, '>', {
      fontFamily: PIXEL_FONT, fontSize: '16px', color: '#80c080',
    }).setOrigin(0.5);
    const rightZone = this.add.zone(rightX + arrowW / 2, y + arrowH / 2, arrowW, arrowH).setInteractive({ useHandCursor: true });
    rightZone.on('pointerup', () => {
      value = Math.min(max, value + step);
      valueText.setText(`${value}${suffix}`);
      onChange(value);
    });
  }

  private drawButton(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number, _stroke: boolean): void {
    g.clear();
    g.fillStyle(color, 1);
    g.fillRoundedRect(x, y, w, h, 4);
  }

  private drawSmallButton(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, active: boolean): void {
    g.clear();
    if (active) {
      g.fillStyle(0x2a2a4e, 1);
      g.fillRoundedRect(x, y, w, h, 3);
      g.lineStyle(2, 0x80c080, 1);
      g.strokeRoundedRect(x, y, w, h, 3);
    } else {
      g.fillStyle(0x2a2a4e, 1);
      g.fillRoundedRect(x, y, w, h, 3);
      g.lineStyle(1, 0x445544, 0.5);
      g.strokeRoundedRect(x, y, w, h, 3);
    }
  }
}
