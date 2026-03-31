import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { OrchestratorRole, AgentSummary } from '../../shared/src/index.ts';

interface OrchestratorState {
  agentId: string;
  role: OrchestratorRole;
  providerId: string;
  observationLog: AgentSummary[];
  lastActionTick: number;
  lastPlanId: string | null;
}

export { OrchestratorState };

// ─── Load Prompt Files ───

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPTS_DIR = resolve(__dirname, '../../configs/prompts');

function loadPromptFile(filename: string): string {
  try {
    return readFileSync(resolve(PROMPTS_DIR, filename), 'utf-8');
  } catch {
    return '';
  }
}

const GAME_RULES = loadPromptFile('game-rules.md');

const ROLE_NAMES: OrchestratorRole[] = ['advisor', 'puppeteer', 'god', 'darwinist', 'parent', 'chaos_demon', 'none'];

const ROLE_PROMPTS: Record<OrchestratorRole, string> = {} as Record<OrchestratorRole, string>;

for (const role of ROLE_NAMES) {
  if (role === 'none') {
    ROLE_PROMPTS[role] = '';
    continue;
  }
  const raw = loadPromptFile(`${role}.md`);
  ROLE_PROMPTS[role] = raw.replace('{{GAME_RULES}}', GAME_RULES);
}

export function getRolePrompt(role: OrchestratorRole): string {
  return ROLE_PROMPTS[role] ?? '';
}

// ─── User Message Builder ───

export function buildUserMessage(orchState: OrchestratorState, summary: AgentSummary): string {
  const role = orchState.role;

  let msg = `## Current State of ${summary.name}\n`;
  msg += `Tick: ${summary.serverTick} | Life: ${summary.currentLifeTicks}t | Lives: ${summary.livesRemaining}\n`;
  msg += `Position: (${summary.position.x}, ${summary.position.y}) | Biome: ${summary.biome}\n`;
  msg += `Action: ${summary.currentAction} — ${summary.actionReason}\n\n`;

  // Needs
  msg += `## Needs\n`;
  for (const [k, v] of Object.entries(summary.needs)) {
    const indicator = (v as number) < 20 ? 'CRITICAL' : (v as number) < 50 ? 'LOW' : 'OK';
    msg += `${indicator} ${k}: ${Math.round(v as number)}\n`;
  }
  if (summary.urgentNeeds.length > 0) {
    msg += `\nURGENT: ${summary.urgentNeeds.join(', ')}\n`;
  }

  // Resources
  if (Object.keys(summary.resources).length > 0) {
    msg += `\n## Resources\n`;
    for (const [k, v] of Object.entries(summary.resources)) {
      msg += `${k}: ${v}\n`;
    }
  }

  // Nearby
  msg += `\n## Nearby\n`;
  if (summary.nearby.threats.length > 0) {
    msg += `Threats: ${summary.nearby.threats.map(t => t.type + ' (' + t.distance.toFixed(1) + ' tiles ' + t.direction + ', danger: ' + t.dangerLevel + ')').join(', ')}\n`;
  } else {
    msg += `No immediate threats.\n`;
  }
  if (summary.nearby.resources.length > 0) {
    msg += `Resources: ${summary.nearby.resources.map(r => r.type + ' (' + r.distance.toFixed(1) + ' tiles ' + r.direction + ')').join(', ')}\n`;
  }
  if (summary.nearby.agents.length > 0) {
    msg += `Agents: ${summary.nearby.agents.map(a => a.name + ' (' + a.distance.toFixed(1) + ' tiles ' + a.direction + ')').join(', ')}\n`;
  }

  // Recent events
  if (summary.recentEvents.length > 0) {
    msg += `\n## Recent Events\n`;
    for (const e of summary.recentEvents.slice(-5)) {
      msg += `[tick ${e.tick}] ${e.type}: ${e.details}\n`;
    }
  }

  // Role-specific additions
  switch (role) {
    case 'god':
    case 'darwinist':
    case 'chaos_demon':
      msg += `\n## Active Genome (v${summary.genome.version})\n`;
      msg += `Strategy rules: ${summary.genome.activeStrategyRules.join(', ') || 'none'}\n`;
      msg += `Fitness: ${summary.genome.fitnessScore}\n`;
      break;

    case 'puppeteer':
      if (summary.currentPlan) {
        msg += `\n## Active Plan\n`;
        msg += `Goal: ${summary.currentPlan.goal}\n`;
        msg += `Step ${summary.currentPlan.currentStep + 1}/${summary.currentPlan.steps.length}\n`;
      } else {
        msg += `\nNo active plan.\n`;
      }
      break;

    case 'parent': {
      const totalLevels = Object.values(summary.skills).reduce((a, b) => a + b, 0);
      const phase = totalLevels < 50 ? 'Infant' : totalLevels < 150 ? 'Child' : totalLevels < 300 ? 'Adolescent' : 'Adult';
      msg += `\n## Development\n`;
      msg += `Total skill levels: ${totalLevels} (Phase: ${phase})\n`;
      msg += `Skills: ${Object.entries(summary.skills).map(([k, v]) => k + ':' + v).join(', ')}\n`;
      break;
    }
  }

  // Observation trends
  if (orchState.observationLog.length >= 3) {
    const recent = orchState.observationLog.slice(-5);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const thirstTrend = last.needs.thirst - first.needs.thirst;
    const healthTrend = last.needs.health - first.needs.health;
    msg += `\n## Trends (last ${recent.length} observations)\n`;
    msg += `Thirst: ${thirstTrend > 0 ? 'rising' : 'falling'} ${Math.abs(thirstTrend).toFixed(0)} | Health: ${healthTrend > 0 ? 'rising' : 'falling'} ${Math.abs(healthTrend).toFixed(0)}\n`;
  }

  // Response format
  msg += `\n## Response Format\n`;
  msg += `Respond with ONLY valid JSON:\n`;
  msg += `{"actions": [{"type": "observe_only"} | {"type": "message", "content": "..."} | {"type": "plan", "plan": {"name": "...", "steps": [...], "priority": 50, "expireAfterTicks": 1000, "abandonOnDanger": true}} | {"type": "genome_patch", "patches": [{"op": "replace", "path": "/...", "value": ...}], "reason": "..."}], "reasoning": "..."}\n`;

  return msg;
}
