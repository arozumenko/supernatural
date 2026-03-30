import { createHmac, createHash } from 'crypto';
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
      case 'bedrock': return this.callBedrock(prompt, signal);
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

  private async callBedrock(prompt: string, signal: AbortSignal): Promise<string | null> {
    const region = this.config.baseUrl ?? 'us-east-1';
    let accessKey: string;
    let secretKey: string;
    if (this.config.apiKey.includes(':')) {
      [accessKey, secretKey] = this.config.apiKey.split(':');
    } else {
      accessKey = process.env.AWS_ACCESS_KEY_ID ?? '';
      secretKey = process.env.AWS_SECRET_ACCESS_KEY ?? '';
    }

    const host = 'bedrock-runtime.' + region + '.amazonaws.com';
    const url = 'https://' + host + '/model/' + encodeURIComponent(this.config.model) + '/converse';
    const body = JSON.stringify({
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: this.config.maxTokens, temperature: this.config.temperature },
    });

    const headers = signAWSRequest('POST', url, host, region, 'bedrock', body, accessKey, secretKey);
    headers['Content-Type'] = 'application/json';

    const res = await fetch(url, { method: 'POST', headers, body, signal });
    if (!res.ok) return null;
    const data = await res.json();
    return data.output?.message?.content?.[0]?.text ?? null;
  }
}

// ─── AWS SigV4 Signing ───

function signAWSRequest(
  method: string, url: string, host: string, region: string,
  service: string, body: string, accessKey: string, secretKey: string,
): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const parsedUrl = new URL(url);

  const payloadHash = createHash('sha256').update(body, 'utf8').digest('hex');
  const canonicalHeaders = 'host:' + host + '\n' + 'x-amz-date:' + amzDate + '\n';
  const signedHeaders = 'host;x-amz-date';
  const canonicalRequest = [method, parsedUrl.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = dateStamp + '/' + region + '/' + service + '/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')].join('\n');

  const kDate = createHmac('sha256', 'AWS4' + secretKey).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  const signingKey = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    'Host': host,
    'X-Amz-Date': amzDate,
    'Authorization': 'AWS4-HMAC-SHA256 Credential=' + accessKey + '/' + credentialScope
      + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature,
    'X-Amz-Content-Sha256': payloadHash,
  };
}
