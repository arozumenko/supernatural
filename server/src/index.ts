import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { GameLoop } from './GameLoop.ts';
import type { ClientToServerEvents, ServerToClientEvents, GameConfig } from '../shared/src/index.ts';
import { applyGameConfig, DEFAULT_GAME_CONFIG } from '../shared/src/index.ts';
import { loadLLMProviders } from './config/llm-config.ts';
import { createApiRouter } from './api/routes.ts';
import { keyStore } from './api/key-store.ts';
import { OrchestratorLoop } from './orchestrator/OrchestratorLoop.ts';
import { LLMCaller } from './orchestrator/LLMCaller.ts';
import { ROLE_PERMISSIONS } from '../shared/src/index.ts';
import type { OrchestratorRole } from '../shared/src/index.ts';

const PORT = 3001;

// Load LLM providers from config file
loadLLMProviders();

// Bootstrap dev API key from env var
keyStore.bootstrapDevKey(process.env.SUPERNATURAL_API_KEY);

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
  },
});

// Game events handler
const gameEvents = {
  onWorldUpdate(agents: any, tileChanges: any, trees: any, rocks: any, plants: any, animals: any, corpses: any, structures: any, season: any) {
    io.emit('world:update', { agents, changedTiles: tileChanges, trees, rocks, plants, animals, corpses, structures, season });
  },
  onAgentDied(agentId: string, name: string, cause: string) {
    io.emit('agent:died', { agentId, name, cause });
  },
  onAgentBorn(agent: any) {
    io.emit('agent:born', { agent });
  },
  onSocialInteraction(interaction: any) {
    io.emit('social:interaction', interaction);
  },
  onWorldEvent(event: any) {
    io.emit('world:event', event);
  },
  onAgentPermadeath(agentId: string, name: string, achievements: string[]) {
    io.emit('agent:permadeath', { agentId, name, achievements });
  },
};

// Create game (mutable — recreated on game:configure)
let game = new GameLoop(gameEvents);

// Orchestrator for LLM-controlled agents
const llmCaller = new LLMCaller();
let orchestrator = new OrchestratorLoop(
  () => game,
  llmCaller,
  (agentId, role, actionType, details) => {
    io.emit('agent:llm_action', { agentId, role, actionType, details });
  },
);

function registerOrchestrators(): void {
  for (const agent of game.agents) {
    if (agent.llmProviderId && agent.llmRole && agent.llmRole !== 'none') {
      orchestrator.registerAgent(agent, {
        role: agent.llmRole,
        providerId: agent.llmProviderId,
        observeIntervalMs: ROLE_PERMISSIONS[agent.llmRole].observeIntervalMs,
        enabled: true,
      });
    }
  }
}

// Socket connections
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Send current world state
  const state = game.getState();
  socket.emit('world:init', {
    tiles: state.tiles,
    agents: state.agents,
    trees: state.trees,
    rocks: state.rocks,
    plants: state.plants,
    animals: state.animals,
    corpses: state.corpses,
    structures: state.structures,
  });

  socket.on('game:configure', (config: GameConfig) => {
    console.log(`Game configured by ${socket.id}:`, config);
    // Apply config to shared constants
    applyGameConfig(config);
    // Stop orchestrator + game
    orchestrator.stop();
    game.stop();
    game = new GameLoop(gameEvents, config);
    game.start();
    // Rebuild orchestrator with new agents
    orchestrator = new OrchestratorLoop(
      () => game,
      llmCaller,
      (agentId, role, actionType, details) => {
        io.emit('agent:llm_action', { agentId, role, actionType, details });
      },
    );
    registerOrchestrators();
    // Send new world state to all connected clients
    const newState = game.getState();
    io.emit('world:init', {
      tiles: newState.tiles,
      agents: newState.agents,
      trees: newState.trees,
      rocks: newState.rocks,
      plants: newState.plants,
      animals: newState.animals,
      corpses: newState.corpses,
      structures: newState.structures,
    });
  });

  socket.on('player:create_agent', (data) => {
    const agent = game.spawnAgent(data.name, data.personality, socket.id);
    if (agent) {
      console.log(`Agent "${agent.name}" created by ${socket.id}`);
    }
  });

  socket.on('player:message', (data) => {
    const success = game.sendMessage(data.agentId, socket.id, data.content);
    if (success) {
      console.log(`Message sent to agent ${data.agentId}: "${data.content}"`);
    }
  });

  socket.on('agent:assign_llm' as any, (data: { agentId: string; providerId: string; role: OrchestratorRole }) => {
    const agent = game.getAgent(data.agentId);
    if (agent) {
      agent.llmProviderId = data.providerId;
      agent.llmRole = data.role;
      orchestrator.registerAgent(agent, {
        role: data.role,
        providerId: data.providerId,
        observeIntervalMs: ROLE_PERMISSIONS[data.role].observeIntervalMs,
        enabled: true,
      });
      console.log(`LLM assigned to ${agent.name}: ${data.role} via ${data.providerId}`);
    }
  });

  socket.on('game:stop' as any, () => {
    console.log(`Game stopped by ${socket.id}`);
    orchestrator.stop();
    game.stop();
    const results = game.computeResults();
    io.emit('game:results', results);
  });

  socket.on('agent:remove_llm' as any, (data: { agentId: string }) => {
    const agent = game.getAgent(data.agentId);
    if (agent) {
      agent.llmProviderId = null;
      agent.llmRole = 'none';
      orchestrator.unregisterAgent(data.agentId);
      console.log(`LLM removed from ${agent.name}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
  });
});

// Mount API router (uses getter because game is reassigned on game:configure)
app.use('/api', createApiRouter(() => game));

// Start
httpServer.listen(PORT, () => {
  console.log(`Supernatural server running on http://localhost:${PORT}`);
  game.start();
});
