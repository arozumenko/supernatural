import Phaser from 'phaser';
import type { GameResults, AgentResult, AnimalResult } from '@supernatural/shared';

const PIXEL_FONT = '"Press Start 2P", monospace';

type Tab = 'agents' | 'animals' | 'genome' | 'comparison';

export class ResultsScene extends Phaser.Scene {
  private results!: GameResults;
  private activeTab: Tab = 'agents';
  private contentContainer!: Phaser.GameObjects.Container;
  private tabButtons: Phaser.GameObjects.Text[] = [];

  constructor() {
    super({ key: 'ResultsScene' });
  }

  create(data: { results: GameResults }): void {
    this.results = data.results;
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#0a0a14');

    // Header
    this.add.text(width / 2, 30, 'GAME OVER', {
      fontFamily: PIXEL_FONT, fontSize: '24px', color: '#cc4444',
    }).setOrigin(0.5);

    const secs = Math.floor(this.results.ticksPlayed / 10);
    const mins = Math.floor(secs / 60);
    this.add.text(width / 2, 60, `${mins}m ${secs % 60}s played  |  ${this.results.season}`, {
      fontFamily: PIXEL_FONT, fontSize: '12px', color: '#888888',
    }).setOrigin(0.5);

    // Tabs
    const tabs: { label: string; key: Tab }[] = [
      { label: 'AGENTS', key: 'agents' },
      { label: 'ANIMALS', key: 'animals' },
      { label: 'BEST GENOME', key: 'genome' },
      { label: 'LLM vs DT', key: 'comparison' },
    ];
    const tabY = 90;
    const tabW = 180;
    const tabStartX = width / 2 - (tabs.length * tabW) / 2;

    tabs.forEach((tab, i) => {
      const x = tabStartX + i * tabW + tabW / 2;
      const t = this.add.text(x, tabY, tab.label, {
        fontFamily: PIXEL_FONT, fontSize: '11px',
        color: tab.key === this.activeTab ? '#80c080' : '#666666',
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.on('pointerup', () => {
        this.activeTab = tab.key;
        this.tabButtons.forEach((btn, j) => {
          btn.setColor(tabs[j].key === this.activeTab ? '#80c080' : '#666666');
        });
        this.renderContent();
      });
      this.tabButtons.push(t);
    });

    // Tab underline
    const tabLine = this.add.graphics();
    tabLine.lineStyle(1, 0x334433); tabLine.lineBetween(40, tabY + 16, width - 40, tabY + 16);

    // Content area
    this.contentContainer = this.add.container(0, 0);

    // Bottom buttons
    const btnY = height - 50;
    this.createButton(width / 2 - 250, btnY, 'Play Again', () => {
      this.scene.start('MainMenuScene');
    });
    this.createButton(width / 2, btnY, 'Best Genome', () => {
      this.scene.start('MainMenuScene', { preloadGenome: this.results.bestGenome });
    });
    this.createButton(width / 2 + 250, btnY, 'New Game', () => {
      this.scene.start('MainMenuScene');
    });

    this.renderContent();
  }

  private renderContent(): void {
    this.contentContainer.removeAll(true);
    const startY = 120;
    const { width } = this.scale;

    switch (this.activeTab) {
      case 'agents': this.renderAgentsTab(startY, width); break;
      case 'animals': this.renderAnimalsTab(startY, width); break;
      case 'genome': this.renderGenomeTab(startY, width); break;
      case 'comparison': this.renderComparisonTab(startY, width); break;
    }
  }

  private renderAgentsTab(startY: number, width: number): void {
    let y = startY;
    // Header row
    this.addText(40, y, '#', '#556655', '11px');
    this.addText(70, y, 'Name', '#556655', '11px');
    this.addText(200, y, 'Score', '#556655', '11px');
    this.addText(300, y, 'Best', '#556655', '11px');
    this.addText(400, y, 'Lives', '#556655', '11px');
    this.addText(480, y, 'Deaths', '#556655', '11px');
    this.addText(570, y, 'Levels', '#556655', '11px');
    this.addText(660, y, 'AI', '#556655', '11px');
    y += 22;

    for (const agent of this.results.agents) {
      const isTop = agent.rank === 1;
      const color = isTop ? '#ffd700' : '#c8d0c8';
      const prefix = isTop ? '\u2B50 ' : '';
      this.addText(40, y, `${agent.rank}`, color, '12px');
      this.addText(70, y, prefix + agent.name, color, '12px');
      this.addText(200, y, `${agent.effectiveness}`, color, '12px');
      const bestSecs = Math.floor(agent.bestLifeTicks / 10);
      this.addText(300, y, `${Math.floor(bestSecs / 60)}m${bestSecs % 60}s`, '#909890', '12px');
      this.addText(400, y, `\u2764${agent.livesRemaining}`, agent.livesRemaining > 50 ? '#44cc44' : '#cccc44', '12px');
      this.addText(480, y, `\uD83D\uDC80${agent.totalDeaths}`, '#aa8888', '12px');
      this.addText(570, y, `${agent.totalSkillLevels}`, '#909890', '12px');
      this.addText(660, y, agent.aiRole === 'none' ? 'DT' : agent.aiRole, agent.aiProvider ? '#80c080' : '#888888', '11px');
      y += 24;
    }
  }

  private renderAnimalsTab(startY: number, _width: number): void {
    let y = startY;
    const tiers: [string, string, AnimalResult | null][] = [
      ['Apex Predator', '\uD83D\uDC3B', this.results.topAnimals.apex],
      ['Mid Predator', '\uD83E\uDD8A', this.results.topAnimals.midPredator],
      ['Large Herbivore', '\uD83E\uDD8C', this.results.topAnimals.largeHerb],
      ['Medium Herbivore', '\uD83D\uDC11', this.results.topAnimals.mediumHerb],
      ['Small Prey', '\uD83D\uDC07', this.results.topAnimals.smallPrey],
    ];

    this.addText(40, y, 'TOP ANIMAL PER TIER', '#556655', '12px');
    y += 28;

    for (const [tierName, emoji, animal] of tiers) {
      this.addText(40, y, `${emoji} ${tierName}`, '#aaaaaa', '12px');
      y += 22;
      if (animal) {
        const secs = Math.floor(animal.ticksAlive / 10);
        this.addText(60, y, `${animal.species}`, '#c8d0c8', '13px');
        this.addText(240, y, `Alive: ${Math.floor(secs / 60)}m${secs % 60}s`, '#909890', '12px');
        this.addText(440, y, `Score: ${animal.effectiveness}`, '#ccaa44', '12px');
        this.addText(600, y, `Lv${animal.skillLevels}`, '#909890', '12px');
      } else {
        this.addText(60, y, '(none survived)', '#666666', '12px');
      }
      y += 28;
    }
  }

  private renderGenomeTab(startY: number, _width: number): void {
    let y = startY;
    const genome = this.results.bestGenome;
    if (!genome) {
      this.addText(40, y, 'No genome data available.', '#888888', '12px');
      return;
    }

    const winner = this.results.agents[0];
    this.addText(40, y, `Best: ${winner?.name ?? '?'}  (Genome v${genome.version})`, '#ffd700', '13px');
    y += 28;

    // Interrupt weights
    this.addText(40, y, 'INTERRUPT WEIGHTS', '#556655', '11px'); y += 20;
    for (const [k, v] of Object.entries(genome.interruptWeights ?? {})) {
      this.addText(60, y, `${k}: ${v}`, '#909890', '11px'); y += 16;
    }
    y += 8;

    // Thresholds
    this.addText(40, y, 'THRESHOLDS', '#556655', '11px'); y += 20;
    for (const [k, v] of Object.entries(genome.thresholds ?? {})) {
      this.addText(60, y, `${k}: ${typeof v === 'number' ? Math.round(v * 100) / 100 : v}`, '#909890', '11px'); y += 16;
    }
    y += 8;

    // Strategy rules
    if (genome.strategyRules?.length > 0) {
      this.addText(40, y, 'STRATEGY RULES', '#556655', '11px'); y += 20;
      for (const rule of genome.strategyRules) {
        this.addText(60, y, `${rule.enabled ? '\u2705' : '\u274C'} ${rule.name}`, '#ccaa44', '11px'); y += 16;
        this.addText(80, y, `Source: ${rule.source}`, '#888866', '10px'); y += 18;
      }
      y += 8;
    }

    // Lineage
    if (genome.lineage?.length > 0) {
      this.addText(40, y, 'LINEAGE', '#556655', '11px'); y += 20;
      for (const entry of genome.lineage.slice(-10)) {
        this.addText(60, y, entry, '#888888', '10px'); y += 16;
      }
      y += 8;
    }

    // Export buttons
    y += 10;
    this.createButton(120, y, 'Copy JSON', () => {
      navigator.clipboard.writeText(JSON.stringify(genome, null, 2));
    });
    this.createButton(320, y, 'Download', () => {
      const blob = new Blob([JSON.stringify(genome, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'best-genome.json'; a.click();
      URL.revokeObjectURL(url);
    });
  }

  private renderComparisonTab(startY: number, _width: number): void {
    let y = startY;
    const c = this.results.comparison;

    this.addText(40, y, 'LLM vs DECISION TREE', '#556655', '13px'); y += 30;

    const bestColor = c.bestApproach === 'llm' ? '#80c080' : c.bestApproach === 'decision_tree' ? '#ccaa44' : '#aaaaaa';
    const bestLabel = c.bestApproach === 'llm' ? 'LLM wins' : c.bestApproach === 'decision_tree' ? 'Decision Tree wins' : 'Tie';
    this.addText(40, y, `Result: ${bestLabel}`, bestColor, '14px'); y += 30;

    // Table
    this.addText(40, y, '', '#556655', '11px');
    this.addText(200, y, 'LLM', '#80c080', '12px');
    this.addText(360, y, 'Decision Tree', '#ccaa44', '12px');
    y += 24;

    this.addText(40, y, 'Avg Score', '#aaaaaa', '12px');
    this.addText(200, y, `${c.llmAvgEffectiveness}`, '#c8d0c8', '12px');
    this.addText(360, y, `${c.dtAvgEffectiveness}`, '#c8d0c8', '12px');
    y += 22;

    this.addText(40, y, 'Avg Best Life', '#aaaaaa', '12px');
    const llmS = Math.floor(c.llmAvgSurvival / 10);
    const dtS = Math.floor(c.dtAvgSurvival / 10);
    this.addText(200, y, `${Math.floor(llmS / 60)}m${llmS % 60}s`, '#c8d0c8', '12px');
    this.addText(360, y, `${Math.floor(dtS / 60)}m${dtS % 60}s`, '#c8d0c8', '12px');
    y += 30;

    // Per-role breakdown
    this.addText(40, y, 'PER ROLE', '#556655', '11px'); y += 22;
    for (const [role, data] of Object.entries(c.perRole)) {
      this.addText(60, y, `${role}`, '#aaaaaa', '12px');
      this.addText(200, y, `${data.count} agents`, '#909890', '12px');
      this.addText(360, y, `avg ${data.avgEffectiveness}`, '#909890', '12px');
      y += 20;
    }
  }

  private addText(x: number, y: number, text: string, color: string, size: string): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, text, {
      fontFamily: PIXEL_FONT, fontSize: size, color,
    });
    this.contentContainer.add(t);
    return t;
  }

  private createButton(x: number, y: number, label: string, onClick: () => void): void {
    const btnW = 200;
    const btnH = 36;
    const bg = this.add.graphics();
    bg.fillStyle(0x2a2a4e, 1);
    bg.fillRoundedRect(x - btnW / 2, y, btnW, btnH, 4);
    bg.lineStyle(1, 0x445544, 0.5);
    bg.strokeRoundedRect(x - btnW / 2, y, btnW, btnH, 4);

    const t = this.add.text(x, y + btnH / 2, label, {
      fontFamily: PIXEL_FONT, fontSize: '11px', color: '#80c080',
    }).setOrigin(0.5);

    const zone = this.add.zone(x, y + btnH / 2, btnW, btnH).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => { bg.clear(); bg.fillStyle(0x3a3a5e, 1); bg.fillRoundedRect(x - btnW / 2, y, btnW, btnH, 4); bg.lineStyle(2, 0x80c080, 1); bg.strokeRoundedRect(x - btnW / 2, y, btnW, btnH, 4); });
    zone.on('pointerout', () => { bg.clear(); bg.fillStyle(0x2a2a4e, 1); bg.fillRoundedRect(x - btnW / 2, y, btnW, btnH, 4); bg.lineStyle(1, 0x445544, 0.5); bg.strokeRoundedRect(x - btnW / 2, y, btnW, btnH, 4); });
    zone.on('pointerup', onClick);
  }
}
