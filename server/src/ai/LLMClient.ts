import type { LLMProviderConfig } from '../../shared/src/index.ts';

/**
 * LLM client for evolution genome calls (single prompt, no system message).
 * Supports: Anthropic, OpenAI, Google Gemini, Ollama, any OpenAI-compatible API.
 */
export class LLMClient {
  private config: LLMProviderConfig;
  private activeRequests = 0;
  private requestTimestamps: number[] = [];

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  async evolveGenome(prompt: string): Promise<string | null> {
    if (this.activeRequests >= this.config.maxConcurrent) return null;

    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 60000);
    if (this.requestTimestamps.length >= this.config.rateLimitPerMinute) return null;

    this.activeRequests++;
    this.requestTimestamps.push(now);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
      try {
        const response = await this.callProvider(prompt, controller.signal);
        return response;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.error('LLM ' + this.config.id + ': request timed out');
      } else {
        console.error('LLM ' + this.config.id + ': ' + err.message);
      }
      return null;
    } finally {
      this.activeRequests--;
    }
  }

  private async callProvider(prompt: string, signal: AbortSignal): Promise<string | null> {
    switch (this.config.provider) {
      case 'anthropic': return this.callAnthropic(prompt, signal);
      case 'google': return this.callGemini(prompt, signal);
      case 'ollama': return this.callOllama(prompt, signal);
      case 'openai':
      case 'openai_compatible': return this.callOpenAI(prompt, signal);
      default: throw new Error('Unknown provider: ' + this.config.provider);
    }
  }

  private async callAnthropic(prompt: string, signal: AbortSignal): Promise<string | null> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.[0]?.text ?? null;
  }

  private async callOpenAI(prompt: string, signal: AbortSignal): Promise<string | null> {
    const baseUrl = this.config.baseUrl ?? (this.config.provider === 'openai' ? 'https://api.openai.com/v1' : this.config.apiKey);
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.config.apiKey,
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? null;
  }

  private async callGemini(prompt: string, signal: AbortSignal): Promise<string | null> {
    const baseUrl = this.config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    const url = baseUrl + '/models/' + this.config.model + ':generateContent?key=' + this.config.apiKey;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: this.config.maxTokens,
          temperature: this.config.temperature,
        },
      }),
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  }

  private async callOllama(prompt: string, signal: AbortSignal): Promise<string | null> {
    const baseUrl = this.config.baseUrl ?? 'http://localhost:11434';
    const res = await fetch(baseUrl + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { num_predict: this.config.maxTokens, temperature: this.config.temperature },
      }),
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.message?.content ?? null;
  }
}
