"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeReceiptImage = analyzeReceiptImage;
const node_buffer_1 = require("node:buffer");
const env_1 = require("../../config/env");
const GEMINI_API_VERSION = env_1.ENV.GEMINI_API_VERSION?.trim() || 'v1beta';
const GEMINI_MODEL = env_1.ENV.GEMINI_MODEL?.trim() || 'gemini-1.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/models/${GEMINI_MODEL}:generateContent`;
const DEFAULT_PROMPT = `
너는 다국어 택시 영수증 인식기야. 이미지를 분석해서 아래 JSON 형식으로만 답해.
{
  "totalAmount": number | null,
  "currency": "KRW" | "JPY" | "USD" | string | null,
  "summary": string,
  "items": [{ "label": string, "amount": number | null }],
  "rawText": string
}
totalAmount에는 숫자만 넣고, currency에는 ISO 통화코드(KRW/JPY/USD 등)를 넣어.
한국어 설명으로 summary를 작성해.
`;
async function analyzeReceiptImage(input) {
    if (!env_1.ENV.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY_NOT_CONFIGURED');
    }
    const normalizedImage = normalizeImagePayload(input.imageBase64, input.mimeType);
    const payload = {
        contents: [
            {
                role: 'user',
                parts: [
                    { text: input.prompt?.trim() || DEFAULT_PROMPT.trim() },
                    {
                        inline_data: {
                            mime_type: normalizedImage.mimeType,
                            data: normalizedImage.data,
                        },
                    },
                ],
            },
        ],
    };
    const startedAt = Date.now();
    let response;
    try {
        response = await fetch(`${GEMINI_ENDPOINT}?key=${env_1.ENV.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown';
        throw new Error(`GEMINI_FETCH_FAILED: ${detail}`);
    }
    if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown Gemini error');
        let parsedError;
        try {
            parsedError = JSON.parse(errorText);
        }
        catch {
            parsedError = null;
        }
        const geminiMessage = typeof parsedError?.error?.message === 'string'
            ? parsedError.error.message
            : errorText;
        const err = new Error(`GEMINI_REQUEST_FAILED: ${geminiMessage}`);
        err.status = response.status;
        err.geminiMessage = geminiMessage;
        err.geminiCode = parsedError?.error?.code;
        throw err;
    }
    const body = (await response.json());
    const rawText = body?.candidates?.[0]?.content?.parts?.find(part => part.text)?.text?.trim() ?? '';
    const parsed = parseReceiptJson(rawText);
    return {
        ...parsed,
        modelLatencyMs: Date.now() - startedAt,
    };
}
function normalizeImagePayload(imageBase64, mimeType) {
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
        node_buffer_1.Buffer.from(data, 'base64');
    }
    catch {
        throw new Error('INVALID_IMAGE_BASE64');
    }
    return { data, mimeType: resolvedMime };
}
function parseReceiptJson(rawText) {
    if (!rawText) {
        return {
            totalAmount: null,
            currency: null,
            summary: '',
            rawText,
        };
    }
    const candidate = extractJsonCandidate(rawText);
    if (!candidate) {
        return {
            totalAmount: null,
            currency: null,
            summary: '',
            rawText,
        };
    }
    try {
        const parsed = JSON.parse(candidate);
        return normalizeReceipt(parsed, rawText);
    }
    catch {
        return {
            totalAmount: null,
            currency: null,
            summary: '',
            rawText,
        };
    }
}
// Gemini가 ```json ... ``` 또는 여분 텍스트를 섞어서 돌려주는 경우를 보정
function extractJsonCandidate(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return null;
    // 이미 순수 JSON이면 그대로 시도
    try {
        JSON.parse(trimmed);
        return trimmed;
    }
    catch {
        // 계속 진행
    }
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch?.[1]) {
        return fenceMatch[1].trim();
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return trimmed.slice(firstBrace, lastBrace + 1);
    }
    return null;
}
function normalizeReceipt(parsed, rawText) {
    let totalAmount = coerceNumber(parsed.totalAmount);
    let currency = typeof parsed.currency === 'string' && parsed.currency.trim()
        ? parsed.currency.trim().toUpperCase()
        : null;
    const normalizedItems = Array.isArray(parsed.items)
        ? parsed.items.map(item => ({
            label: typeof item.label === 'string' ? item.label : '',
            amount: coerceNumber(item.amount),
        }))
        : undefined;
    if (totalAmount == null || !currency) {
        const inferred = inferAmountFromRawText(rawText);
        if (totalAmount == null && inferred?.amount != null) {
            totalAmount = inferred.amount;
        }
        if (!currency && inferred?.currency) {
            currency = inferred.currency;
        }
    }
    return {
        totalAmount,
        currency,
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        items: normalizedItems?.length ? normalizedItems : undefined,
        rawText,
    };
}
function coerceNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const cleaned = value.replace(/[^\d.-]/g, '');
        if (!cleaned)
            return null;
        const asNumber = Number(cleaned);
        return Number.isFinite(asNumber) ? asNumber : null;
    }
    return null;
}
const CURRENCY_PATTERNS = [
    { currency: 'JPY', regex: /(?:JP¥|JPY|￥|¥)\s*([\d,.]+)/i },
    { currency: 'KRW', regex: /(?:KRW|₩)\s*([\d,.]+)/i },
    { currency: 'USD', regex: /(?:USD|\$)\s*([\d,.]+)/i },
];
function inferAmountFromRawText(rawText) {
    if (!rawText)
        return null;
    for (const pattern of CURRENCY_PATTERNS) {
        const match = rawText.match(pattern.regex);
        if (match?.[1]) {
            const amount = coerceNumber(match[1]);
            if (amount != null) {
                return { amount, currency: pattern.currency };
            }
        }
    }
    const generalMatch = rawText.match(/(합계|총액|合計|total)\D*([\d,.]+)/i);
    if (generalMatch?.[2]) {
        const amount = coerceNumber(generalMatch[2]);
        if (amount != null) {
            return { amount, currency: null };
        }
    }
    return null;
}
