import type { Request, Response } from 'express';
import type { GameLoop } from '../../GameLoop.ts';
import { buildAgentSummary, buildWorldSummary } from '../summary.ts';

export function getAgentState(getGame: () => GameLoop) {
  return (req: Request, res: Response) => {
    const game = getGame();
    const agent = game.agents.find(a => a.id === req.params.agentId);
    if (!agent) {
      return res.status(404).json({ error: 'agent_not_found', message: 'Agent not found' });
    }
    const summary = buildAgentSummary(agent, game.world, game.tickCount, game.agents);
    res.json(summary);
  };
}

export function listAgents(getGame: () => GameLoop) {
  return (req: Request, res: Response) => {
    const game = getGame();
    const alive = req.query.alive;
    const fields = req.query.fields ? String(req.query.fields).split(',') : null;

    let agents = game.agents;
    if (alive === 'true') agents = agents.filter(a => a.alive);
    if (alive === 'false') agents = agents.filter(a => !a.alive);

    if (fields) {
      const filtered = agents.map(a => {
        const obj: Record<string, any> = {};
        for (const f of fields) {
          if (f in a) obj[f] = (a as any)[f];
        }
        return obj;
      });
      return res.json(filtered);
    }

    // Return lightweight list
    res.json(agents.map(a => ({
      id: a.id,
      name: a.name,
      alive: a.alive,
      position: { x: Math.floor(a.x), y: Math.floor(a.y) },
      action: a.action,
      livesRemaining: a.livesRemaining ?? 100,
    })));
  };
}

export function getWorldSummary(getGame: () => GameLoop) {
  return (_req: Request, res: Response) => {
    const game = getGame();
    const summary = buildWorldSummary(game.agents, game.world, game.tickCount);
    res.json(summary);
  };
}

export function getAgentHistory(getGame: () => GameLoop) {
  return (req: Request, res: Response) => {
    const game = getGame();
    const agent = game.agents.find(a => a.id === req.params.agentId);
    if (!agent) {
      return res.status(404).json({ error: 'agent_not_found', message: 'Agent not found' });
    }

    const archive: any[] = (agent as any).journalArchive ?? [];
    res.json({
      agentId: agent.id,
      name: agent.name,
      livesRemaining: agent.livesRemaining ?? 100,
      achievements: agent.achievements ?? [],
      lives: archive.map((j: any) => ({
        lifeNumber: j.lifeNumber,
        survivalTicks: j.survivalTicks,
        deathCause: j.deathCause?.type ?? 'unknown',
        killerSpecies: j.deathCause?.killerSpecies,
        topSkillGained: findTopSkillGained(j),
        genomeVersion: j.genomeVersion,
      })),
    });
  };
}

export function getAgentGenome(getGame: () => GameLoop) {
  return (req: Request, res: Response) => {
    const game = getGame();
    const agent = game.agents.find(a => a.id === req.params.agentId);
    if (!agent) {
      return res.status(404).json({ error: 'agent_not_found', message: 'Agent not found' });
    }

    const genome = (agent as any).currentGenome;
    if (!genome) {
      return res.status(404).json({ error: 'agent_not_found', message: 'Agent has no genome' });
    }
    res.json(genome);
  };
}

function findTopSkillGained(journal: any): string {
  if (!journal.birthSkills || !journal.finalSkillLevels) return 'none';
  let topSkill = 'none';
  let topGain = 0;
  for (const [skill, finalLevel] of Object.entries(journal.finalSkillLevels)) {
    const gain = (finalLevel as number) - (journal.birthSkills[skill] ?? 0);
    if (gain > topGain) {
      topGain = gain;
      topSkill = skill;
    }
  }
  return topSkill;
}
