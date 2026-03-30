import Phaser from 'phaser';
import { AGENT_ARCHETYPES } from '@supernatural/shared';
import type { GameResults, AgentResult, AnimalResult, AgentArchetype } from '@supernatural/shared';

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
    this.results = data?.results ?? {
      ticksPlayed: 0, season: 'unknown', agents: [], bestGenome: null,
      topAnimals: { apex: null, midPredator: null, largeHerb: null, mediumHerb: null, smallPrey: null },
      comparison: { llmAvgEffectiveness: 0, dtAvgEffectiveness: 0, llmAvgSurvival: 0, dtAvgSurvival: 0, bestApproach: 'tie', perRole: {} },
    };
    console.log('[ResultsScene] Received results:', JSON.stringify(this.results).slice(0, 200));
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
      this.scene.start('MainMenuScene', { fromResults: true });
    });
    this.createButton(width / 2, btnY, 'Best Genome', () => {
      this.scene.start('MainMenuScene', { fromResults: true, preloadGenome: this.results.bestGenome });
    });
    this.createButton(width / 2 + 250, btnY, 'New Game', () => {
      this.scene.start('MainMenuScene', { fromResults: true });
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
      const archEmoji = AGENT_ARCHETYPES[(agent.archetype ?? 'random') as AgentArchetype]?.label ?? '';
      this.addText(70, y, prefix + archEmoji + ' ' + agent.name, color, '12px');
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

  private renderGenomeTab(startY: number, width: number): void {
    let y = startY;
    const genome = this.results.bestGenome;
    const agents = this.results.agents;

    const col0 = 40;
    const colStart = 140;
    const colW = Math.min(90, (width - colStart - 40) / agents.length);

    // Agent name header
    this.addText(col0, y, '', '#556655', '9px');
    agents.forEach((a, i) => {
      const c = a.rank === 1 ? '#ffd700' : '#aaaaaa';
      this.addText(colStart + i * colW, y, a.name, c, '9px');
    });
    y += 16;

    // ─── Genome Table ───
    this.addText(col0, y, 'GENOME', '#80c080', '10px'); y += 16;

    const defaultG = { version: 1, interruptWeights: { fleeBase: 75, fightBack: 93 }, thresholds: { criticalThirst: 30, criticalHunger: 30, criticalHealth: 40, criticalStamina: 20, fleeHealthPanic: 0.4, fightBackMinRatio: 0.6 }, fallbackWeights: { huntAnimal: 40, gatherWood: 35, mineStone: 30, harvestCorpse: 50, socialize: 30, wander: 10 }, mediumPriorityWeights: { drinkMedium: 63, eatMedium: 58 }, goalWeights: { survive_thirst: 1.3, survive_protein: 1.2, survive_plant: 1.2, rest: 1.1 }, strategyRules: [] };

    const genomeFields: [string, (g: any) => string][] = [
      ['Mutations', g => `${(g?.version ?? 1) - 1}`],
      ['Rules', g => `${g?.strategyRules?.length ?? 0}`],
      ['Flee', g => `${g?.interruptWeights?.fleeBase ?? '?'}`],
      ['Fight', g => `${g?.interruptWeights?.fightBack ?? '?'}`],
      ['Thirst thr', g => `${g?.thresholds?.criticalThirst ?? '?'}`],
      ['Hunger thr', g => `${g?.thresholds?.criticalHunger ?? '?'}`],
      ['Health thr', g => `${g?.thresholds?.criticalHealth ?? '?'}`],
      ['Stamina thr', g => `${g?.thresholds?.criticalStamina ?? '?'}`],
      ['Flee panic', g => `${g?.thresholds?.fleeHealthPanic ?? '?'}`],
      ['Fight ratio', g => `${g?.thresholds?.fightBackMinRatio ?? '?'}`],
      ['Hunt', g => `${g?.fallbackWeights?.huntAnimal ?? '?'}`],
      ['Wood', g => `${g?.fallbackWeights?.gatherWood ?? '?'}`],
      ['Stone', g => `${g?.fallbackWeights?.mineStone ?? '?'}`],
      ['Corpse', g => `${g?.fallbackWeights?.harvestCorpse ?? '?'}`],
      ['Social', g => `${g?.fallbackWeights?.socialize ?? '?'}`],
      ['Wander', g => `${g?.fallbackWeights?.wander ?? '?'}`],
      ['Drink prio', g => `${g?.mediumPriorityWeights?.drinkMedium ?? '?'}`],
      ['Eat prio', g => `${g?.mediumPriorityWeights?.eatMedium ?? '?'}`],
      ['Thirst goal', g => `${g?.goalWeights?.survive_thirst?.toFixed?.(1) ?? '?'}`],
      ['Protein goal', g => `${g?.goalWeights?.survive_protein?.toFixed?.(1) ?? '?'}`],
      ['Plant goal', g => `${g?.goalWeights?.survive_plant?.toFixed?.(1) ?? '?'}`],
      ['Rest goal', g => `${g?.goalWeights?.rest?.toFixed?.(1) ?? '?'}`],
    ];

    for (const [label, getter] of genomeFields) {
      this.addText(col0, y, label, '#556655', '9px');
      agents.forEach((a, i) => {
        const g = (a as any).genome;
        const val = getter(g);
        const defVal = getter(defaultG);
        let color = '#909890'; // unchanged
        if (val !== defVal) {
          const numVal = parseFloat(val);
          const numDef = parseFloat(defVal);
          if (!isNaN(numVal) && !isNaN(numDef)) {
            color = numVal > numDef ? '#44cc44' : '#cc8844'; // green up, orange down
          } else {
            color = '#ccaa44'; // changed but non-numeric
          }
        }
        this.addText(colStart + i * colW, y, val, color, '9px');
      });
      y += 13;
    }

    // ─── End-Game Stats ───
    y += 12;
    this.addText(col0, y, 'FINAL STATS', '#80c080', '10px'); y += 16;

    const statFields: [string, (a: AgentResult) => string, (a: AgentResult) => string][] = [
      ['Score', a => `${a.effectiveness}`, a => a.rank === 1 ? '#ffd700' : '#c8d0c8'],
      ['Level', a => `${a.totalSkillLevels}`, _ => '#909890'],
      ['Deaths', a => `${a.totalDeaths}`, a => a.totalDeaths > 5 ? '#cc6644' : '#909890'],
      ['Lives', a => `${a.livesRemaining}`, a => a.livesRemaining > 50 ? '#44cc44' : '#cccc44'],
      ['Best life', a => { const s = Math.floor(a.bestLifeTicks / 10); return `${Math.floor(s/60)}m${s%60}s`; }, _ => '#909890'],
      ['AI', a => a.aiRole === 'none' ? 'DT' : a.aiRole, a => a.aiProvider ? '#80c080' : '#888888'],
    ];

    for (const [label, getter, colorFn] of statFields) {
      this.addText(col0, y, label, '#556655', '9px');
      agents.forEach((a, i) => {
        this.addText(colStart + i * colW, y, getter(a), colorFn(a), '9px');
      });
      y += 13;
    }

    // ─── Best Genome Detail ───
    y += 16;
    if (!genome) {
      this.addText(40, y, 'No genome data.', '#888888', '12px');
      return;
    }

    const winner = agents[0];
    this.addText(40, y, `WINNER: ${winner?.name ?? '?'}`, '#ffd700', '12px'); y += 22;

    // Strategy rules (full detail)
    if (genome.strategyRules?.length > 0) {
      this.addText(40, y, `LEARNED RULES (${genome.strategyRules.length})`, '#80c080', '11px'); y += 18;
      for (const rule of genome.strategyRules) {
        const icon = rule.enabled ? '\u2705' : '\u274C';
        this.addText(50, y, `${icon} ${rule.name}`, '#ccaa44', '10px');
        this.addText(400, y, `pri:${rule.priority}`, '#888888', '9px');
        y += 14;
        this.addText(70, y, `Source: ${rule.source ?? 'unknown'}`, '#777766', '9px'); y += 14;
        // Show condition type
        if (rule.condition) {
          const condStr = rule.condition.type + (rule.condition.field ? ` ${rule.condition.field}` : '') + (rule.condition.value !== undefined ? ` ${rule.condition.value}` : '');
          this.addText(70, y, `If: ${condStr}`, '#667766', '9px'); y += 14;
        }
        if (rule.effect) {
          const effStr = rule.effect.type + (rule.effect.action ? ` ${rule.effect.action}` : '') + (rule.effect.amount !== undefined ? ` ${rule.effect.amount}` : '');
          this.addText(70, y, `Then: ${effStr}`, '#667766', '9px'); y += 14;
        }
        y += 4;
      }
    } else {
      this.addText(40, y, 'No learned strategy rules.', '#888888', '11px'); y += 18;
    }

    // Mutation history (lineage)
    if (genome.lineage?.length > 0) {
      y += 8;
      this.addText(40, y, `MUTATION HISTORY (${genome.lineage.length} total)`, '#80c080', '11px'); y += 18;
      for (const entry of genome.lineage.slice(-12)) {
        this.addText(50, y, entry, '#888888', '9px'); y += 13;
      }
      if (genome.lineage.length > 12) {
        this.addText(50, y, `... +${genome.lineage.length - 12} earlier mutations`, '#666666', '9px'); y += 13;
      }
    }

    // Export
    y += 16;
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
