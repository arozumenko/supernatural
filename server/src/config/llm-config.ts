import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { LLMProviderConfig } from '../../shared/src/index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '../../llm-providers.json');

let providers: LLMProviderConfig[] = [];

export function loadLLMProviders(): LLMProviderConfig[] {
  if (!existsSync(CONFIG_PATH)) {
    console.log('No llm-providers.json found — LLM evolution disabled');
    providers = [];
    return providers;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as LLMProviderConfig[];

    // Resolve $ENV_VAR references in apiKey
    providers = parsed.map(p => ({
      ...p,
      apiKey: p.apiKey.startsWith('$')
        ? process.env[p.apiKey.slice(1)] ?? ''
        : p.apiKey,
    }));

    const loaded = providers.map(p => `${p.id} (${p.provider}/${p.model})`).join(', ');
    console.log(`Loaded LLM providers: ${loaded}`);
    return providers;
  } catch (err) {
    console.error('Failed to load llm-providers.json:', err);
    providers = [];
    return providers;
  }
}

export function getLLMProviders(): LLMProviderConfig[] {
  return providers;
}

export function getLLMProvider(id: string): LLMProviderConfig | undefined {
  return providers.find(p => p.id === id);
}

/** Returns provider list safe for client (no apiKeys) */
export function getPublicProviderList(): { id: string; label: string }[] {
  return providers.map(p => ({ id: p.id, label: p.label }));
}
