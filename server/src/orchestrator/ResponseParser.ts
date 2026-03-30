import type { LLMResponse, LLMAction, OrchestratorRole } from '../../shared/src/index.ts';
import { ROLE_PERMISSIONS, GENOME_BOUNDS } from '../../shared/src/index.ts';

/**
 * Parse an LLM text response into a validated LLMResponse.
 * Handles markdown fences, validates shape, enforces role permissions.
 */
export function parseResponse(rawText: string, role: OrchestratorRole): LLMResponse {
  // Strip markdown code fences
  let text = rawText.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  // Try JSON.parse
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Fallback: try to extract JSON from mixed text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        console.warn('[ResponseParser] Failed to extract JSON from response');
        return { actions: [{ type: 'observe_only' }] };
      }
    } else {
      console.warn('[ResponseParser] No JSON found in response');
      return { actions: [{ type: 'observe_only' }] };
    }
  }

  // Validate shape
  if (!parsed || !Array.isArray(parsed.actions)) {
    // Maybe the response is a single action
    if (parsed && parsed.type) {
      parsed = { actions: [parsed] };
    } else {
      return { actions: [{ type: 'observe_only' }], reasoning: parsed?.reasoning };
    }
  }

  // Enforce role permissions — filter out disallowed action types
  const perms = ROLE_PERMISSIONS[role];
  const filteredActions: LLMAction[] = [];

  for (const action of parsed.actions) {
    if (!action || !action.type) continue;

    switch (action.type) {
      case 'observe_only':
        filteredActions.push({ type: 'observe_only' });
        break;

      case 'message':
        if (perms.canMessage && typeof action.content === 'string' && action.content.length > 0) {
          filteredActions.push({
            type: 'message',
            content: action.content.slice(0, 500), // Cap message length
            urgent: !!action.urgent,
          });
        }
        break;

      case 'plan':
        if (perms.canPlan && action.plan && Array.isArray(action.plan.steps)) {
          // Clamp plan priority to [1, 70]
          const plan = action.plan;
          plan.priority = Math.max(1, Math.min(70, plan.priority ?? 50));
          plan.expireAfterTicks = Math.max(100, Math.min(5000, plan.expireAfterTicks ?? 1000));
          plan.abandonOnDanger = plan.abandonOnDanger ?? true;
          plan.steps = plan.steps.slice(0, 5); // Max 5 steps
          filteredActions.push({ type: 'plan', plan });
        }
        break;

      case 'genome_patch':
        if (perms.canPatchGenome && Array.isArray(action.patches) && action.patches.length > 0) {
          // Validate patch operations
          const validPatches = action.patches.filter((p: any) =>
            p && typeof p.op === 'string' && typeof p.path === 'string' &&
            ['add', 'replace', 'remove'].includes(p.op)
          ).slice(0, 10); // Max 10 patches at once

          if (validPatches.length > 0) {
            filteredActions.push({
              type: 'genome_patch',
              patches: validPatches,
              reason: typeof action.reason === 'string' ? action.reason.slice(0, 200) : 'llm patch',
            });
          }
        }
        break;
    }
  }

  // If all actions were filtered out, observe only
  if (filteredActions.length === 0) {
    filteredActions.push({ type: 'observe_only' });
  }

  return {
    actions: filteredActions,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
  };
}
