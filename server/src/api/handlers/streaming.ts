import type { Request, Response } from 'express';
import type { GameLoop } from '../../GameLoop.ts';

/**
 * SSE endpoint for real-time agent events.
 * Opens a persistent connection and streams LifeEvents as they occur.
 */
export function streamAgentEvents(getGame: () => GameLoop) {
  return (req: Request, res: Response) => {
    const game = getGame();
    const agentId = req.params.agentId;
    const agent = game.agents.find(a => a.id === agentId);
    if (!agent) {
      return res.status(404).json({ error: 'agent_not_found', message: 'Agent not found' });
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    // Event listener
    const listener = (event: { agentId: string; type: string; tick: number; details: string }) => {
      if (event.agentId !== agentId) return;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify({ tick: event.tick, type: event.type, details: event.details })}\n\n`);
    };

    // Subscribe to game events
    const emitter = (game as any).apiEventEmitter;
    if (emitter) {
      emitter.on('agent:event', listener);
    }

    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      if (emitter) {
        emitter.off('agent:event', listener);
      }
    });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ agentId, tick: game.tickCount })}\n\n`);
  };
}

/**
 * Webhook registration (simplified in-memory store).
 */
const webhooks: Map<string, {
  id: string;
  agentId: string;
  url: string;
  events: string[];
  secret: string;
  playerId: string;
}> = new Map();

export function registerWebhook(getGame: () => GameLoop) {
  return (req: Request, res: Response) => {
    const { agentId, url, events, secret } = req.body;
    if (!agentId || !url || !events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'invalid_request', message: 'Missing agentId, url, or events' });
    }

    const id = 'whk_' + Math.random().toString(36).slice(2, 10);
    webhooks.set(id, {
      id,
      agentId,
      url,
      events,
      secret: secret ?? '',
      playerId: req.apiKey?.playerId ?? 'unknown',
    });

    res.status(201).json({ id, agentId, url, events });
  };
}

export function listWebhooks(_getGame: () => GameLoop) {
  return (req: Request, res: Response) => {
    const playerId = req.apiKey?.playerId;
    const result = Array.from(webhooks.values())
      .filter(w => w.playerId === playerId)
      .map(({ secret, ...rest }) => rest);
    res.json(result);
  };
}

export function deleteWebhook(_getGame: () => GameLoop) {
  return (req: Request, res: Response) => {
    const hookId = req.params.hookId;
    if (!webhooks.has(hookId)) {
      return res.status(404).json({ error: 'not_found', message: 'Webhook not found' });
    }
    webhooks.delete(hookId);
    res.json({ deleted: true, hookId });
  };
}

/**
 * Get the webhook store for event delivery.
 */
export function getWebhooks(): Map<string, { id: string; agentId: string; url: string; events: string[]; secret: string }> {
  return webhooks;
}
