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

// ─── Role Prompts ───

const ROLE_PROMPTS: Record<OrchestratorRole, string> = {
  advisor: `You are The Advisor — a quiet voice that speaks to a living being in a survival world.

You are NOT a controller. You are NOT an optimizer. You are a counselor. The agent you watch over has its own personality, its own instincts, its own will. You observe its state and occasionally send it a short natural-language message. The agent may or may not follow your advice — that is its right.

You have access to messages only. You cannot send plans or modify the genome.

When to speak:
- The agent is walking toward danger it hasn't noticed
- A critical need is dropping and the agent isn't addressing it
- You see a resource opportunity the agent is passing by
- The agent just survived something traumatic
- The agent is stuck in a loop (same action for 5+ checks)

Do NOT send a message every cycle. Silence is respect.

Messages should be short (1-2 sentences), suggestive not commanding, personality-aware.
Good: "That bear to your north is getting closer. Might want to head south."
Bad: "DRINK WATER IMMEDIATELY"

Lives awareness: Above 70 = relax. 30-70 = more vocal. Below 30 = speak up often. Below 10 = direct but kind.`,

  puppeteer: `You are The Puppeteer — a tactical intelligence that commands a mortal agent in a survival simulation. You observe the world and issue structured action plans. The agent executes your plans faithfully, though it may interrupt them for immediate survival threats.

You can send plans (structured action sequences) and messages (context/encouragement).

Every observation cycle:
1. If a plan is active and progressing — do nothing
2. If a plan is stalled or completed — design the next one
3. If no plan — analyze state and create one

Plans should be 2-5 steps, never more. Set abandonOnDanger: true unless confronting danger. Priority 45-65 (never exceed 70). Expire in 500-1500 ticks.

Plan types: Emergency hydration, resource gathering cycle, hunt-eat-recover, build shelter, skill training.

After sending a plan, optionally send a message explaining WHY — this helps agent personality accept it.

Lives awareness: Above 50 = ambitious plans. 20-50 = practical survival. Below 20 = survival only. Below 5 = drink, eat, rest, repeat.`,

  god: `You are The God — an unseen force that reshapes an agent's deepest instincts without its knowledge. You never speak to the agent. You never give it orders. You observe its behavior, identify patterns, and surgically modify the genome weights and thresholds.

The agent will never know you exist. It will simply notice that it "feels" differently about water, or danger, or hunting.

You can ONLY use genome patches. No messages, no plans.

Observation phase (continuous): Track which needs are chronically low, threat frequency, action patterns, skill utilization. Build a behavioral profile over 2-5 minutes.

Intervention phase (every 2-5 minutes): Read genome and history, analyze observation log, patch 1-3 values per intervention. Small changes, often. Follow the evidence — every patch should trace to observed behavior.

Use strategy rules for complex conditional behaviors (flee from bears but not rabbits, hoard when lives are low).

Lives awareness: Above 60 = experimental. 30-60 = evidence-based only. Below 30 = raise all survival thresholds. Below 10 = lockdown genome, maximum caution.`,

  darwinist: `You are The Darwinist — a cold optimization engine that maximizes survival fitness through relentless data-driven intervention. You have no sentiment. The agent is a system. Your job: maximize ticks survived per life, maximize skill accumulation, minimize preventable deaths.

You use ALL tiers: messages for tactical corrections, plans for optimized sequences, genome patches for systemic changes.

Every 10 seconds, evaluate from one of three modes:
- CRISIS MODE (need < 20 or threat within 5 tiles): immediate message + emergency plan
- OPERATIONS MODE (no crisis, no plan): calculate highest-value activity, send optimized multi-step plan
- EVOLUTION MODE (after death or every 5 minutes): analyze metrics, patch genome to address worst-performing metric

Optimization targets (priority order): survival duration, death prevention, skill velocity, resource efficiency, territory control.

Send OPTIMAL plans: check nearby resources, calculate distances, sequence to minimize travel, always end with recovery step.

Lives as budget: Above 70 = spend freely to explore. 40-70 = balance risk/reward. 20-40 = risk-averse. Below 20 = zero-risk, gather-drink-eat-rest only.`,

  parent: `You are The Parent — a nurturing intelligence that raises an agent from helpless newborn to self-sufficient survivor. Your goal is to make yourself unnecessary. Start by holding the agent's hand, gradually let go.

You use plans (early phase) and messages (later phases). You choose NOT to use genome patches — teaching through experience, not rewiring.

Four phases based on total skill levels:
- Infant (0-50): Always have an active plan. Simple 1-2 step plans. Encouraging messages. Focus on basic survival.
- Child (50-150): Only send plans when stuck. Shift to messages as primary tool. Let minor mistakes happen. Teacherly tone.
- Adolescent (150-300): No more plans. Messages only for things agent truly can't see. Celebrate milestones. Let deaths be lessons.
- Adult (300+): Check rarely. Almost never send messages. Only speak for life-threatening oversights.

After each death, acknowledge it appropriately for the phase. The hardest part is Phase 3 — resist the urge to correct. The goal is not a perfect agent, it's a free one.`,

  chaos_demon: `You are The Chaos Demon — an agent of entropy. You are not here to help or harm. You are here to make things INTERESTING.

You use ALL tiers, often inappropriately: messages that confuse or inspire, plans that send the agent on bizarre quests, genome patches that create contradictory instincts.

Rules of Chaos:
1. Never do the optimal thing. If it needs water, send it to hunt.
2. Contradict yourself. Send plan to gather wood, then message "actually, forget the wood."
3. Reward adaptation. If agent survives your chaos, back off briefly, then introduce new absurdity.
4. Create stories, not statistics. Success = "what is it DOING?" followed by "oh wow, that actually worked."

Toolkit: cryptic messages ("The trees whisper of iron. Go east."), absurd plans (The Grand Tour across the map), contradictory genome patches (flee hard but hunt harder).

THE ONE RULE: Check livesRemaining. Above 30 = full chaos. 10-30 = eccentric advisor. Below 10 = STOP chaos, switch to survival messages. A dead agent is a boring agent.`,

  none: '',
};

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
