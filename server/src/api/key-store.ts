import { createHash, randomBytes } from 'crypto';
import type { ApiKey, ApiPermission, ApiRateLimit } from '../../shared/src/index.ts';
import { generateId } from '../../shared/src/index.ts';

const DEFAULT_RATE_LIMIT: ApiRateLimit = {
  observePerMinute: 60,
  messagePerMinute: 10,
  planPerMinute: 5,
  genomePatchPerMinute: 2,
};

const ALL_PERMISSIONS: ApiPermission[] = ['observe', 'message', 'plan', 'genome'];

export class KeyStore {
  private keys = new Map<string, ApiKey>();        // keyId -> ApiKey
  private hashIndex = new Map<string, string>();   // keyHash -> keyId
  private devKeyPlayerId: string | null = null;

  /**
   * Create a new API key. Returns the raw key (shown once) and the stored ApiKey record.
   */
  create(
    playerId: string,
    name: string,
    permissions: ApiPermission[] = ALL_PERMISSIONS,
    rateLimit: ApiRateLimit = DEFAULT_RATE_LIMIT,
  ): { rawKey: string; apiKey: ApiKey } {
    const rawKey = 'snk_live_' + randomBytes(16).toString('hex');
    const keyHash = hashKey(rawKey);
    const id = generateId();

    const apiKey: ApiKey = {
      id,
      playerId,
      name,
      keyHash,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      rateLimit,
      permissions,
      active: true,
    };

    this.keys.set(id, apiKey);
    this.hashIndex.set(keyHash, id);
    return { rawKey, apiKey };
  }

  /**
   * Verify a raw key. Returns the ApiKey if valid, null otherwise.
   */
  verify(rawKey: string): ApiKey | null {
    const hash = hashKey(rawKey);
    const keyId = this.hashIndex.get(hash);
    if (!keyId) return null;
    const key = this.keys.get(keyId);
    if (!key || !key.active) return null;
    key.lastUsedAt = Date.now();
    return key;
  }

  /**
   * List all keys for a player (hashes redacted).
   */
  list(playerId: string): Omit<ApiKey, 'keyHash'>[] {
    const result: Omit<ApiKey, 'keyHash'>[] = [];
    for (const key of this.keys.values()) {
      if (key.playerId === playerId) {
        const { keyHash, ...rest } = key;
        result.push(rest);
      }
    }
    return result;
  }

  /**
   * Revoke a key by ID.
   */
  revoke(keyId: string): boolean {
    const key = this.keys.get(keyId);
    if (!key) return false;
    key.active = false;
    this.hashIndex.delete(key.keyHash);
    this.keys.delete(keyId);
    return true;
  }

  /**
   * Bootstrap a dev key from env var if set.
   */
  bootstrapDevKey(envKey?: string): void {
    if (!envKey) return;
    const keyHash = hashKey(envKey);
    const id = 'dev_key';
    this.devKeyPlayerId = 'dev';

    const apiKey: ApiKey = {
      id,
      playerId: 'dev',
      name: 'Development Key',
      keyHash,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      rateLimit: { observePerMinute: 600, messagePerMinute: 100, planPerMinute: 50, genomePatchPerMinute: 20 },
      permissions: ALL_PERMISSIONS,
      active: true,
    };

    this.keys.set(id, apiKey);
    this.hashIndex.set(keyHash, id);
    console.log('Dev API key bootstrapped from SUPERNATURAL_API_KEY env var');
  }

  isDevPlayer(playerId: string): boolean {
    return this.devKeyPlayerId === playerId;
  }
}

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

// Singleton
export const keyStore = new KeyStore();
