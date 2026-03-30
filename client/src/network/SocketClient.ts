import { io, Socket } from 'socket.io-client';
import type {
  AgentState, TileType, TreeState, RockState, PlantState, AnimalState, CorpseState, StructureState, SocialInteraction, PersonalityTrait, Season, GameConfig
} from '@supernatural/shared';

const SERVER_URL = 'http://localhost:3001';

export type WorldInitData = {
  tiles: number[][];
  agents: AgentState[];
  trees: TreeState[];
  rocks: RockState[];
  plants: PlantState[];
  animals: AnimalState[];
  corpses: CorpseState[];
  structures: StructureState[];
};

export type WorldUpdateData = {
  agents: AgentState[];
  changedTiles: { x: number; y: number; type: TileType }[];
  trees: TreeState[];
  rocks: RockState[];
  plants: PlantState[];
  animals: AnimalState[];
  corpses: CorpseState[];
  structures: StructureState[];
  season?: Season;
};

export class SocketClient {
  private socket: Socket;
  private listeners: Map<string, Set<Function>> = new Map();

  constructor() {
    this.socket = io(SERVER_URL, {
      transports: ['websocket'],
      autoConnect: true,
    });

    this.socket.on('connect', () => {
      console.log('Connected to server');
      this.emit('connected', {});
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
      this.emit('disconnected', {});
    });

    this.socket.on('world:init', (data: WorldInitData) => {
      this.emit('world:init', data);
    });

    this.socket.on('world:update', (data: WorldUpdateData) => {
      this.emit('world:update', data);
    });

    this.socket.on('agent:died', (data: { agentId: string; name: string; cause: string }) => {
      this.emit('agent:died', data);
    });

    this.socket.on('agent:born', (data: { agent: AgentState }) => {
      this.emit('agent:born', data);
    });

    this.socket.on('social:interaction', (data: SocialInteraction) => {
      this.emit('social:interaction', data);
    });

    this.socket.on('message:result', (data: { messageId: string; followed: boolean; reason: string }) => {
      this.emit('message:result', data);
    });

    this.socket.on('world:event', (data: { type: string; message: string; x?: number; y?: number }) => {
      this.emit('world:event', data);
    });

    this.socket.on('agent:permadeath', (data: { agentId: string; name: string; achievements: string[] }) => {
      this.emit('agent:permadeath', data);
    });

    this.socket.on('agent:llm_action', (data: any) => {
      this.emit('agent:llm_action', data);
    });

    this.socket.on('agent:plan_update', (data: any) => {
      this.emit('agent:plan_update', data);
    });
  }

  // Event system
  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: Function): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, data: any): void {
    this.listeners.get(event)?.forEach(cb => cb(data));
  }

  // Actions
  configure(config: GameConfig): void {
    this.socket.emit('game:configure', config);
  }

  createAgent(name: string, personality: PersonalityTrait[]): void {
    this.socket.emit('player:create_agent', { name, personality });
  }

  sendMessage(agentId: string, content: string): void {
    this.socket.emit('player:message', { agentId, content });
  }

  get id(): string | undefined {
    return this.socket.id ?? undefined;
  }

  get connected(): boolean {
    return this.socket.connected;
  }
}
