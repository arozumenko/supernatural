import { Router } from 'express';
import type { GameLoop } from '../GameLoop.ts';
import { authenticateApiKey, rateLimit, requirePermission } from './middleware.ts';
import { getAgentState, listAgents, getWorldSummary, getAgentHistory, getAgentGenome } from './handlers/observation.ts';
import { sendMessage, sendPlan, getPlanStatus, cancelPlan, patchGenome } from './handlers/instruction.ts';
import { createApiKey, listApiKeys, revokeApiKey } from './handlers/keys.ts';
import { streamAgentEvents, registerWebhook, listWebhooks, deleteWebhook } from './handlers/streaming.ts';
import { getPublicProviderList } from '../config/llm-config.ts';

/**
 * Create the API router. Uses a getter for GameLoop because the game
 * instance is reassigned on game:configure.
 */
export function createApiRouter(getGame: () => GameLoop): Router {
  const router = Router();

  // ─── Public endpoints (no auth) ───
  router.get('/llm-providers', (_req, res) => {
    res.json(getPublicProviderList());
  });

  router.get('/status', (_req, res) => {
    const game = getGame();
    const state = game.getState();
    res.json({
      alive: state.agents.filter(a => a.alive).length,
      total: state.agents.length,
      ticks: state.tickCount,
    });
  });

  // ─── Authenticated endpoints ───
  router.use(authenticateApiKey);

  // Observation
  router.get('/agents/:agentId/state', rateLimit('observe'), getAgentState(getGame));
  router.get('/agents', rateLimit('observe'), listAgents(getGame));
  router.get('/agents/:agentId/history', rateLimit('observe'), getAgentHistory(getGame));
  router.get('/agents/:agentId/genome', rateLimit('observe'), getAgentGenome(getGame));
  router.get('/world/summary', rateLimit('observe'), getWorldSummary(getGame));

  // Instructions — Messages
  router.post('/agents/:agentId/message', rateLimit('message'), requirePermission('message'), sendMessage(getGame));

  // Instructions — Plans
  router.post('/agents/:agentId/plan', rateLimit('plan'), requirePermission('plan'), sendPlan(getGame));
  router.get('/agents/:agentId/plan', rateLimit('observe'), getPlanStatus(getGame));
  router.delete('/agents/:agentId/plan', rateLimit('plan'), requirePermission('plan'), cancelPlan(getGame));

  // Instructions — Genome Patch
  router.patch('/agents/:agentId/genome', rateLimit('genome'), requirePermission('genome'), patchGenome(getGame));

  // Key management
  router.post('/keys', createApiKey);
  router.get('/keys', listApiKeys);
  router.delete('/keys/:keyId', revokeApiKey);

  // Streaming
  router.get('/agents/:agentId/stream', rateLimit('observe'), streamAgentEvents(getGame));

  // Webhooks
  router.post('/webhooks', rateLimit('plan'), requirePermission('plan'), registerWebhook(getGame));
  router.get('/webhooks', listWebhooks(getGame));
  router.delete('/webhooks/:hookId', deleteWebhook(getGame));

  return router;
}
