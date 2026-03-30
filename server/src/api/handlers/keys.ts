import type { Request, Response } from 'express';
import type { ApiPermission } from '../../../shared/src/index.ts';
import { keyStore } from '../key-store.ts';

export function createApiKey(req: Request, res: Response): void {
  const { playerId, name, permissions } = req.body;
  if (!playerId || !name) {
    res.status(400).json({ error: 'invalid_request', message: 'Missing playerId or name' });
    return;
  }

  const perms: ApiPermission[] = permissions ?? ['observe', 'message', 'plan', 'genome'];
  const { rawKey, apiKey } = keyStore.create(playerId, name, perms);

  res.status(201).json({
    id: apiKey.id,
    key: rawKey, // Shown once
    name: apiKey.name,
    playerId: apiKey.playerId,
    permissions: apiKey.permissions,
    createdAt: apiKey.createdAt,
  });
}

export function listApiKeys(req: Request, res: Response): void {
  const playerId = req.apiKey?.playerId;
  if (!playerId) {
    res.status(401).json({ error: 'unauthorized', message: 'No API key' });
    return;
  }

  const keys = keyStore.list(playerId);
  res.json(keys);
}

export function revokeApiKey(req: Request, res: Response): void {
  const keyId = req.params.keyId;
  const success = keyStore.revoke(keyId);
  if (!success) {
    res.status(404).json({ error: 'not_found', message: 'Key not found' });
    return;
  }
  res.json({ revoked: true, keyId });
}
