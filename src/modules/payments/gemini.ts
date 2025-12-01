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
  | { amount: number; rawText: string }
  | { amount: null; rawText: string; reason: string };

export async function extractAmountFromImage(
  imageBase64: string,
  mimeType: string = 'image/png',
  modelOverride?: string,
  apiVersionOverride?: string
): Promise<GeminiAmountResult> {
  if (!ENV.GEMINI_API_KEY) {
    return { amount: null, rawText: '', reason: 'GEMINI_API_KEY not configured' };
  }

  // data URL로 넘어오면 헤더 제거
  const normalizedBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '').trim();

  const prompt =
    [
      'Uber 캡처 화면에서 "일반 택시" 요금 범위의 최대 금액만 숫자로 하나 반환하세요.',
      '예: "₩6,300-7,800"이면 7800만 반환.',
      '스피드호출 등 다른 서비스 가격은 무시.',
      '통화 기호/단위/설명/단어 없이 숫자만.'
    ].join(' ');

  const pickMaxAmount = (text: string): number | null => {
    const cleaned = text
      .replace(/[,\s\u00A0]/g, '') // commas, spaces, non-breaking space
      .replace(/[₩원]|KRW/gi, ''); // currency markers
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
      const amount = pickMaxAmount(text);
      if (amount == null || Number.isNaN(amount)) {
        return { amount: null, rawText: text, reason: 'NO_AMOUNT_FOUND' };
      }
      return { amount, rawText: text };
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
