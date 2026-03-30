import type { LLMProviderConfig } from '../../shared/src/index.ts';

/**
 * LLM HTTP client supporting system + user message pattern.
 * Providers: Anthropic, OpenAI, Google Gemini, Ollama, any OpenAI-compatible API.
 */
export class LLMCaller {
  private semaphores = new Map<string, number>();

  async call(
    provider: LLMProviderConfig,
    systemPrompt: string,
    userMessage: string,
  ): Promise<string> {
    const current = this.semaphores.get(provider.id) ?? 0;
    if (current >= provider.maxConcurrent) {
      throw new Error('Concurrency limit reached for ' + provider.id);
    }
    this.semaphores.set(provider.id, current + 1);

    try {
      return await this.callProvider(provider, systemPrompt, userMessage);
    } finally {
      this.semaphores.set(provider.id, (this.semaphores.get(provider.id) ?? 1) - 1);
    }
  }

  private async callProvider(p: LLMProviderConfig, system: string, user: string): Promise<string> {
    switch (p.provider) {
      case 'anthropic':
        return this.callAnthropic(p, system, user);
      case 'google':
        return this.callGemini(p, system, user);
      case 'ollama':
        return this.callOllama(p, system, user);
      case 'openai':
      case 'openai_compatible':
        return this.callOpenAICompatible(p, system, user);
      default:
        throw new Error('Unknown provider: ' + p.provider);
    }
  }

  // ─── Anthropic Messages API ───

  private async callAnthropic(p: LLMProviderConfig, system: string, user: string): Promise<string> {
    const res = await this.fetchWithTimeout(p, 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': p.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: p.model,
        system,
        messages: [{ role: 'user', content: user }],
        max_tokens: p.maxTokens,
        temperature: p.temperature,
      }),
    });
    const json = await res.json();
    return json.content?.[0]?.text ?? '';
  }

  // ─── OpenAI Chat Completions (also covers any OpenAI-compatible API) ───

  private async callOpenAICompatible(p: LLMProviderConfig, system: string, user: string): Promise<string> {
    const baseUrl = p.baseUrl ?? (p.provider === 'openai' ? 'https://api.openai.com/v1' : p.apiKey);
    const res = await this.fetchWithTimeout(p, baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + p.apiKey,
      },
      body: JSON.stringify({
        model: p.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: p.maxTokens,
        temperature: p.temperature,
      }),
    });
    const json = await res.json();
    return json.choices?.[0]?.message?.content ?? '';
  }

  // ─── Google Gemini API ───

  private async callGemini(p: LLMProviderConfig, system: string, user: string): Promise<string> {
    const baseUrl = p.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    const url = baseUrl + '/models/' + p.model + ':generateContent?key=' + p.apiKey;
    const res = await this.fetchWithTimeout(p, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          maxOutputTokens: p.maxTokens,
          temperature: p.temperature,
        },
      }),
    });
    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  // ─── Ollama (local, OpenAI-compatible but no auth needed) ───

  private async callOllama(p: LLMProviderConfig, system: string, user: string): Promise<string> {
    const baseUrl = p.baseUrl ?? 'http://localhost:11434';
    const res = await this.fetchWithTimeout(p, baseUrl + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: p.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: false,
        options: {
          num_predict: p.maxTokens,
          temperature: p.temperature,
        },
      }),
    });
    const json = await res.json();
    return json.message?.content ?? '';
  }

  // ─── Shared fetch with timeout ───

  private async fetchWithTimeout(p: LLMProviderConfig, url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), p.timeout);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(p.provider + ' API error ' + res.status + ': ' + body.slice(0, 200));
      }
      return res;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
