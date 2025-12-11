import { Buffer } from 'node:buffer';
import { ENV } from '../../config/env';

const GEMINI_API_VERSION = ENV.GEMINI_API_VERSION?.trim() || 'v1beta';
const GEMINI_MODEL = ENV.GEMINI_MODEL?.trim() || 'gemini-1.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/models/${GEMINI_MODEL}:generateContent`;

export type DispatchAnalysis = {
  driverName: string | null;
  carNumber: string | null;
  carModel: string | null;
  summary?: string | null;
  rawText?: string | null;
  modelLatencyMs?: number;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

const DEFAULT_PROMPT = `
너는 한국 택시 배차 화면을 읽는 보조원이야.
이미지를 보고 JSON 형식으로만 아래 데이터를 채워줘.
{
  "driverName": string | null,
  "carNumber": string | null,
  "carModel": string | null,
  "summary": string
}
- driverName: 기사님 성함을 그대로 적어.
- carNumber: 번호판 전체를 공백 포함 그대로 적어.
- carModel: 차량 모델(예: 아이오닉5, 쏘나타).
- summary: 한국어로 간단히 설명.
JSON 이외의 텍스트는 절대 포함하지 마.
`;

export async function analyzeDispatchScreenshot(input: {
  imageBase64: string;
  mimeType?: string;
  prompt?: string;
}): Promise<DispatchAnalysis> {
  if (!ENV.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY_NOT_CONFIGURED');
  }

  const normalizedImage = normalizeImagePayload(input.imageBase64, input.mimeType);

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: (input.prompt ?? DEFAULT_PROMPT).trim() },
          {
            inline_data: {
              mime_type: normalizedImage.mimeType,
              data: normalizedImage.data
            }
          }
        ]
      }
    ]
  };

  const startedAt = Date.now();
  let response: globalThis.Response;
  try {
    response = await fetch(`${GEMINI_ENDPOINT}?key=${ENV.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    throw new Error(`GEMINI_FETCH_FAILED: ${detail}`);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown Gemini error');
    let parsedError: any;
    try {
      parsedError = JSON.parse(errorText);
    } catch {
      parsedError = null;
    }
    const geminiMessage: string =
      typeof parsedError?.error?.message === 'string' ? parsedError.error.message : errorText;
    const err: any = new Error(`GEMINI_REQUEST_FAILED: ${geminiMessage}`);
    err.status = response.status;
    err.geminiMessage = geminiMessage;
    err.geminiCode = parsedError?.error?.code;
    throw err;
  }

  const body = (await response.json()) as GeminiResponse;
  const rawText = body?.candidates?.[0]?.content?.parts?.find(part => part.text)?.text?.trim() ?? '';
  const parsed = parseDispatchJson(rawText);

  return {
    ...parsed,
    modelLatencyMs: Date.now() - startedAt,
    rawText
  };
}

function parseDispatchJson(rawText: string): DispatchAnalysis {
  if (!rawText) {
    return {
      driverName: null,
      carNumber: null,
      carModel: null,
      summary: null,
      rawText
    };
  }

  const candidate = extractJsonCandidate(rawText);
  if (!candidate) {
    return {
      driverName: null,
      carNumber: null,
      carModel: null,
      summary: null,
      rawText
    };
  }

  try {
    const parsed = JSON.parse(candidate) as Partial<DispatchAnalysis>;
    return {
      driverName: normalizeText(parsed.driverName),
      carNumber: normalizeText(parsed.carNumber),
      carModel: normalizeText(parsed.carModel),
      summary: normalizeText(parsed.summary),
      rawText
    };
  } catch {
    return {
      driverName: null,
      carNumber: null,
      carModel: null,
      summary: null,
      rawText
    };
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
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

function normalizeImagePayload(
  imageBase64: string,
  mimeType?: string
): { data: string; mimeType: string } {
  let data = imageBase64?.trim();
  if (!data) {
    throw new Error('IMAGE_BASE64_REQUIRED');
  }

  let resolvedMime = mimeType?.trim() || 'image/png';
  const dataUrlMatch = data.match(/^data:(.+?);base64,(.+)$/i);
  if (dataUrlMatch) {
    const [, detectedMime, payload] = dataUrlMatch;
    if (!mimeType && detectedMime?.trim()) {
      resolvedMime = detectedMime.trim();
    }
    data = payload.trim();
  }

  try {
    Buffer.from(data, 'base64');
  } catch {
    throw new Error('INVALID_IMAGE_BASE64');
  }

  return { data, mimeType: resolvedMime };
}
