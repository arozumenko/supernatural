import type { AgentState, BehaviorGenome, LifeJournal, LLMProviderConfig } from '../../shared/src/index.ts';
import { LLMClient } from './LLMClient.ts';
import { buildEvolutionPrompt } from './EvolutionPrompt.ts';
import { validateGenome, clampGenome, createDefaultGenome } from './BehaviorGenome.ts';
import { applyFallbackMutation } from './FallbackEvolution.ts';
import { getLLMProvider } from '../config/llm-config.ts';

interface PendingEvolution {
  agentId: string;
  genome: BehaviorGenome | null;
  status: 'pending' | 'processing' | 'done' | 'failed';
}

/**
 * Manages async LLM evolution calls.
 * Non-blocking: queues requests, processes them, stores results for pickup.
 */
export class EvolutionQueue {
  private pending = new Map<string, PendingEvolution>();
  private clients = new Map<string, LLMClient>();

  private getClient(providerId: string): LLMClient | null {
    if (this.clients.has(providerId)) return this.clients.get(providerId)!;
    const config = getLLMProvider(providerId);
    if (!config) return null;
    const client = new LLMClient(config);
    this.clients.set(providerId, client);
    return client;
  }

  /**
   * Queue an LLM evolution call for an agent that just died.
   * Non-blocking — starts async processing immediately.
   */
  queueEvolution(
    agent: AgentState,
    journal: LifeJournal,
    recentJournals: LifeJournal[],
  ): void {
    const providerId = agent.llmProviderId;
    if (!providerId) return;

    const client = this.getClient(providerId);
    if (!client) {
      console.log(`No LLM client for provider "${providerId}" — using fallback`);
      const genome: BehaviorGenome = (agent as any).currentGenome ?? createDefaultGenome();
      const totalLvl = Object.values(agent.skills).reduce((sum, s) => sum + s.level, 0);
      applyFallbackMutation(genome, journal.deathCause, totalLvl);
      this.pending.set(agent.id, { agentId: agent.id, genome, status: 'done' });
      return;
    }

    const currentGenome: BehaviorGenome = (agent as any).currentGenome ?? createDefaultGenome();
    const entry: PendingEvolution = { agentId: agent.id, genome: null, status: 'processing' };
    this.pending.set(agent.id, entry);

    // Fire and forget — result picked up later
    this.processEvolution(client, agent, currentGenome, journal, recentJournals, entry)
      .catch(err => {
        console.error(`Evolution failed for ${agent.name}:`, err);
        entry.status = 'failed';
      });
  }

  private async processEvolution(
    client: LLMClient,
    agent: AgentState,
    currentGenome: BehaviorGenome,
    journal: LifeJournal,
    recentJournals: LifeJournal[],
    entry: PendingEvolution,
  ): Promise<void> {
    const prompt = buildEvolutionPrompt(agent, currentGenome, journal, recentJournals);

    console.log(`[Evolution] Requesting LLM mutation for ${agent.name} (genome v${currentGenome.version})`);
    const responseText = await client.evolveGenome(prompt);

    if (!responseText) {
      console.log(`[Evolution] LLM returned no response for ${agent.name} — using fallback`);
      const fallbackGenome = structuredClone(currentGenome);
      const lvl = Object.values(agent.skills).reduce((sum, s) => sum + s.level, 0);
      applyFallbackMutation(fallbackGenome, journal.deathCause, lvl);
      entry.genome = fallbackGenome;
      entry.status = 'done';
      return;
    }

    // Parse JSON from response (handle markdown code blocks)
    let parsed: BehaviorGenome;
    try {
      let jsonStr = responseText.trim();
      // Strip markdown code fences if present
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      parsed = JSON.parse(jsonStr);
    } catch (err) {
      console.error(`[Evolution] Failed to parse LLM response for ${agent.name}:`, err);
      const fallbackGenome = structuredClone(currentGenome);
      const lvl2 = Object.values(agent.skills).reduce((sum, s) => sum + s.level, 0);
      applyFallbackMutation(fallbackGenome, journal.deathCause, lvl2);
      entry.genome = fallbackGenome;
      entry.status = 'done';
      return;
    }

    // Validate
    const agentLevel = Object.values(agent.skills).reduce((sum, s) => sum + s.level, 0);
    const validation = validateGenome(parsed);
    if (!validation.valid) {
      console.warn(`[Evolution] LLM genome validation failed for ${agent.name}:`, validation.errors);
      // Attempt to clamp rather than reject entirely
      clampGenome(parsed, agentLevel);
      const revalidation = validateGenome(parsed);
      if (!revalidation.valid) {
        console.error(`[Evolution] Genome still invalid after clamping — using fallback`);
        const fallbackGenome = structuredClone(currentGenome);
        applyFallbackMutation(fallbackGenome, journal.deathCause, agentLevel);
        entry.genome = fallbackGenome;
        entry.status = 'done';
        return;
      }
    }

    // Apply version increment
    parsed.version = currentGenome.version + 1;
    parsed.generation = (currentGenome.generation ?? 0) + 1;
    parsed.mutatedAt = Date.now();
    if (!parsed.lineage) parsed.lineage = [...(currentGenome.lineage ?? [])];
    parsed.lineage.push(`llm: ${journal.deathCause.type}${journal.deathCause.killerSpecies ? ' by ' + journal.deathCause.killerSpecies : ''}`);

    console.log(`[Evolution] LLM mutation applied for ${agent.name}: v${currentGenome.version} → v${parsed.version}`);
    entry.genome = parsed;
    entry.status = 'done';
  }

  /**
   * Check if a pending genome is ready for an agent.
   * Returns the genome and removes it from the queue, or null if not ready.
   */
  getPendingGenome(agentId: string): BehaviorGenome | null {
    const entry = this.pending.get(agentId);
    if (!entry) return null;

    if (entry.status === 'done' && entry.genome) {
      this.pending.delete(agentId);
      return entry.genome;
    }

    if (entry.status === 'failed') {
      this.pending.delete(agentId);
      return null;
    }

    // Still processing
    return null;
  }

  /**
   * Check if evolution is still in progress for an agent.
   */
  isProcessing(agentId: string): boolean {
    const entry = this.pending.get(agentId);
    return entry?.status === 'processing';
  }
}
