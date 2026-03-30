import { createHmac, createHash } from 'crypto';
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
      case 'bedrock':
        return this.callBedrock(p, system, user);
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

  // ─── AWS Bedrock Converse API (SigV4 signed) ───

  private async callBedrock(p: LLMProviderConfig, system: string, user: string): Promise<string> {
    // apiKey format: "ACCESS_KEY_ID:SECRET_ACCESS_KEY" or env vars AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
    // baseUrl: region, e.g. "us-east-1"
    const region = p.baseUrl ?? 'us-east-1';
    let accessKey: string;
    let secretKey: string;

    if (p.apiKey.includes(':')) {
      [accessKey, secretKey] = p.apiKey.split(':');
    } else {
      accessKey = process.env.AWS_ACCESS_KEY_ID ?? '';
      secretKey = process.env.AWS_SECRET_ACCESS_KEY ?? '';
    }

    const host = 'bedrock-runtime.' + region + '.amazonaws.com';
    const url = 'https://' + host + '/model/' + encodeURIComponent(p.model) + '/converse';
    const body = JSON.stringify({
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: user }] }],
      inferenceConfig: {
        maxTokens: p.maxTokens,
        temperature: p.temperature,
      },
    });

    const headers = signAWSRequest('POST', url, host, region, 'bedrock', body, accessKey, secretKey);
    headers['Content-Type'] = 'application/json';

    const res = await this.fetchWithTimeout(p, url, {
      method: 'POST',
      headers,
      body,
    });
    const json = await res.json();
    return json.output?.message?.content?.[0]?.text ?? '';
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

// ─── AWS SigV4 Signing (zero dependencies) ───

function signAWSRequest(
  method: string, url: string, host: string, region: string,
  service: string, body: string, accessKey: string, secretKey: string,
): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const parsedUrl = new URL(url);
  const canonicalUri = parsedUrl.pathname;
  const canonicalQuerystring = parsedUrl.search.slice(1);

  const payloadHash = sha256(body);
  const canonicalHeaders = 'host:' + host + '\n' + 'x-amz-date:' + amzDate + '\n';
  const signedHeaders = 'host;x-amz-date';
  const canonicalRequest = [method, canonicalUri, canonicalQuerystring, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = dateStamp + '/' + region + '/' + service + '/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join('\n');

  const signingKey = getSignatureKey(secretKey, dateStamp, region, service);
  const signature = hmacHex(signingKey, stringToSign);

  return {
    'Host': host,
    'X-Amz-Date': amzDate,
    'Authorization': 'AWS4-HMAC-SHA256 Credential=' + accessKey + '/' + credentialScope
      + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature,
    'X-Amz-Content-Sha256': payloadHash,
  };
}

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function hmacHex(key: Buffer | string, data: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

function getSignatureKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac('AWS4' + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}
