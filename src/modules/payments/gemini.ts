import axios from 'axios';
import { ENV } from '../../config/env';

const defaultApiVersion = ENV.GEMINI_API_VERSION || 'v1';
const defaultModel = ENV.GEMINI_MODEL || 'gemini-2.0-flash-001';

function buildGeminiUrl(modelOverride?: string, versionOverride?: string) {
  const rawModel = (modelOverride && modelOverride.trim()) || defaultModel;
  const normalizedModel = rawModel.replace(/^models\//, ''); // allow both "gemini-..." and "models/gemini-..."
  const version = (versionOverride && versionOverride.trim()) || defaultApiVersion;
  return `https://generativelanguage.googleapis.com/${version}/models/${normalizedModel}:generateContent`;
}

type GeminiAmountResult =
  | { amount: number; rawText: string; pickup?: string; dropoff?: string; uiKeywords?: string[] }
  | { amount: null; rawText: string; reason: string; pickup?: string; dropoff?: string; uiKeywords?: string[] };

type GeminiParsedPayload = {
  amount?: string | number | null;
  pickup?: string | null;
  dropoff?: string | null;
  uiKeywords?: unknown;
  rawText?: string | null;
};

function parseLocations(text: string): { pickup?: string; dropoff?: string } {
  const trimmed = text.trim();
  if (!trimmed) return {};

  // Prefer structured JSON if the model follows the instruction.
  try {
    const parsed = JSON.parse(trimmed);
    const pickup = typeof parsed.pickup === 'string' ? parsed.pickup.trim() : undefined;
    const dropoff = typeof parsed.dropoff === 'string' ? parsed.dropoff.trim() : undefined;
    return { pickup, dropoff };
  } catch {
    // fallthrough
  }

  // Lightweight heuristic extraction when JSON is not returned.
  const pickupMatch = text.match(/(?:pickup|\uCD9C\uBC1C)\s*[:\-]?\s*([^\n|]+)/i);
  const dropoffMatch = text.match(/(?:dropoff|destination|to|\uB3C4\uCC29)\s*[:\-]?\s*([^\n|]+)/i);
  return {
    pickup: pickupMatch?.[1]?.trim(),
    dropoff: dropoffMatch?.[1]?.trim()
  };
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // continue scanning
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

function parseUiKeywords(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const normalized = value
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
    return normalized.length ? normalized : undefined;
  }
  if (typeof value === 'string') {
    const normalized = value
      .split(/[,\n|]/g)
      .map(item => item.trim())
      .filter(Boolean);
    return normalized.length ? normalized : undefined;
  }
  return undefined;
}

function normalizeLooseText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function unwrapJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenceMatch?.[1] ? fenceMatch[1].trim() : text;
}

function extractRawTextFromJsonLike(text: string): string | null {
  const body = unwrapJsonFence(text);
  const keyIndex = body.indexOf('"rawText"');
  if (keyIndex === -1) return null;

  const afterKey = body.slice(keyIndex + '"rawText"'.length);
  const colonIndex = afterKey.indexOf(':');
  if (colonIndex === -1) return null;

  const afterColon = afterKey.slice(colonIndex + 1).trimStart();
  if (!afterColon.startsWith('"')) return null;

  let result = '';
  let escaped = false;
  for (let i = 1; i < afterColon.length; i += 1) {
    const ch = afterColon[i];
    if (escaped) {
      switch (ch) {
        case 'n':
          result += '\n';
          break;
        case 'r':
          result += '\r';
          break;
        case 't':
          result += '\t';
          break;
        case '"':
          result += '"';
          break;
        case '\\':
          result += '\\';
          break;
        default:
          result += ch;
          break;
      }
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      return result;
    }
    result += ch;
  }

  return null;
}

function pickMaxAmountFromLine(text: string, label: string): number | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const targetIndex = lines.findIndex(line => line.includes(label));
  if (targetIndex === -1) return null;

  const candidateLines = lines.slice(targetIndex, targetIndex + 3);
  let best: number | null = null;
  for (const line of candidateLines) {
    const cleaned = line
      .replace(/[,\s\u00A0]/g, '')
      .replace(/[\uC6D0\u20A9]|KRW/gi, '');
    const range = cleaned.match(/(\d+(?:\.\d+)?)[~-](\d+(?:\.\d+)?)/);
    if (range) {
      const value = Number(range[2]);
      if (Number.isFinite(value)) {
        best = best == null ? value : Math.max(best, value);
        continue;
      }
    }
    const nums = [...cleaned.matchAll(/\d+(?:\.\d+)?/g)]
      .map(m => Number(m[0]))
      .filter(n => !Number.isNaN(n));
    for (const value of nums) {
      best = best == null ? value : Math.max(best, value);
    }
  }
  return best;
}
export async function extractAmountFromImage(
  imageBase64: string,
  mimeType: string = 'image/png',
  modelOverride?: string,
  apiVersionOverride?: string
): Promise<GeminiAmountResult> {
  if (!ENV.GEMINI_API_KEY) {
    return { amount: null, rawText: '', reason: 'GEMINI_API_KEY not configured' };
  }

  // Strip data URL prefix if present.
  const normalizedBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '').trim();

  const prompt = [
    'You read a Korean Uber Taxi deposit/dispatch screen screenshot.',
    'Return ONLY JSON with keys: amount, pickup, dropoff, uiKeywords, rawText.',
    'rawText must contain all visible text from the image (no guessing).',
    'Only include uiKeywords that actually appear in the image.',
    'If you see a receipt screen (words like "영수증", "RECEIPT", "합계", "총액", "TOTAL"), set amount to null and uiKeywords to [].',
    'The deposit screen must include "일반 택시"; if missing, set amount to null.',
    'When "일반 택시" shows a range like "7,100-7,900", return the maximum value.',
    'Ignore promotional/discount text. If amount is a range like "12,300-7,800", return the higher amount.',
    'If no amount, return null.',
    'Example: {"amount":"7800","pickup":"강남","dropoff":"서울","uiKeywords":["차량 서비스 선택","일반 택시"],"rawText":"차량 서비스 선택\n일반 택시\n..."}'
  ].join(' ');

  const pickMaxAmount = (text: string): number | null => {
    const cleaned = text
      .replace(/[,\s\u00A0]/g, '') // commas, spaces, non-breaking space
      .replace(/[\uC6D0\u20A9]|KRW/gi, ''); // currency markers (?? ?? KRW)
    const range = cleaned.match(/(\d+(?:\.\d+)?)[~-](\d+(?:\.\d+)?)/);
    if (range) {
      return Number(range[2]);
    }
    const nums = [...cleaned.matchAll(/\d+(?:\.\d+)?/g)].map(m => Number(m[0])).filter(n => !Number.isNaN(n));
    if (nums.length === 0) return null;
    return Math.max(...nums);
  };

  const attempts: { model: string; version: string }[] = [];
  const primary = { model: modelOverride, version: apiVersionOverride };
  const fallbacks = [
    { model: 'gemini-2.5-flash', version: 'v1' },
    { model: 'gemini-2.0-flash-001', version: 'v1' },
    { model: 'gemini-2.0-flash', version: 'v1' },
    { model: 'gemini-2.5-flash-lite', version: 'v1' },
    { model: 'gemini-2.0-flash-lite-001', version: 'v1' }
  ];

  const candidates = [primary, ...fallbacks].map(c => ({
    model: (c.model && c.model.trim()) || defaultModel,
    version: (c.version && c.version.trim()) || defaultApiVersion
  }));

  const errors: string[] = [];

  for (const c of candidates) {
    const url = `${buildGeminiUrl(c.model, c.version)}?key=${ENV.GEMINI_API_KEY}`;
    attempts.push(c);
    try {
      const { data } = await axios.post(
        url,
        {
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: normalizedBase64 } }
              ]
            }
          ],
          generationConfig: { temperature: 0 }
        },
        { timeout: 10_000 }
      );

      const text =
        data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join(' ')?.trim() ?? '';
      const candidate = extractJsonCandidate(text);
      let parsed: GeminiParsedPayload | null = null;
      if (candidate) {
        try {
          parsed = JSON.parse(candidate) as GeminiParsedPayload;
        } catch {
          parsed = null;
        }
      }

      const rawAmount = parsed?.amount ?? null;
      const amountFromJson =
        typeof rawAmount === 'number'
          ? rawAmount
          : typeof rawAmount === 'string'
            ? Number(rawAmount.replace(/[^\d.]/g, ''))
            : null;
      const rawTextCandidate =
        typeof parsed?.rawText === 'string' && parsed.rawText.trim()
          ? parsed.rawText.trim()
          : extractRawTextFromJsonLike(text) || '';
      const combinedText = rawTextCandidate || text;
      const normalizedText = normalizeLooseText(combinedText);
      const requiresGeneralTaxi = normalizeLooseText('일반 택시');
      if (!normalizedText.includes(requiresGeneralTaxi)) {
        return {
          amount: null,
          rawText: combinedText,
          reason: 'GENERAL_TAXI_MISSING'
        };
      }

      const generalTaxiAmount = pickMaxAmountFromLine(combinedText, '일반 택시');
      const amount =
        generalTaxiAmount ??
        (Number.isFinite(amountFromJson) ? amountFromJson : null);
      const pickup = typeof parsed?.pickup === 'string' ? parsed.pickup.trim() : undefined;
      const dropoff = typeof parsed?.dropoff === 'string' ? parsed.dropoff.trim() : undefined;
      const fallbackLocations = pickup || dropoff ? {} : parseLocations(rawTextCandidate || text);
      const uiKeywords = parseUiKeywords(parsed?.uiKeywords);
      if (amount == null || Number.isNaN(amount)) {
        return {
          amount: null,
          rawText: combinedText,
          reason: 'NO_GENERAL_TAXI_AMOUNT',
          pickup: pickup ?? fallbackLocations.pickup,
          dropoff: dropoff ?? fallbackLocations.dropoff,
          uiKeywords
        };
      }
      return {
        amount,
        rawText: combinedText,
        pickup: pickup ?? fallbackLocations.pickup,
        dropoff: dropoff ?? fallbackLocations.dropoff,
        uiKeywords
      };
    } catch (error: any) {
      const reason = error?.response?.data ?? error?.message ?? 'UNKNOWN_ERROR';
      errors.push(
        `${c.version}/${c.model}: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`
      );
      // try next fallback
      continue;
    }
  }

  return {
    amount: null,
    rawText: '',
    reason: `All models failed: ${errors.join(' | ')}`
  };
}
