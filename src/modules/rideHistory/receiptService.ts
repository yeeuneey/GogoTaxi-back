import { Buffer } from 'node:buffer'
import { ENV } from '../../config/env'

const GEMINI_API_VERSION = ENV.GEMINI_API_VERSION?.trim() || 'v1beta'
const GEMINI_MODEL = ENV.GEMINI_MODEL?.trim() || 'gemini-1.5-flash'
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/models/${GEMINI_MODEL}:generateContent`

export type ReceiptAnalysis = {
  totalAmount: number | null
  currency: string | null
  summary?: string
  items?: { label: string; amount: number | null }[]
  rawText?: string
  modelLatencyMs?: number
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
  }>
}

const DEFAULT_PROMPT = `
너는 다국어 택시 영수증 인식기야. 이미지를 분석해서 아래 JSON 형식으로만 답해.
이미지에 보이는 텍스트만 사용하고 추정/창작은 금지야. 영수증이 아니거나 영수증 문구가 보이지 않으면
totalAmount/currency/summary/items/rawText를 모두 비우거나 null로 처리해.
{
  "totalAmount": number | null,
  "currency": "KRW" | "JPY" | "USD" | string | null,
  "summary": string,
  "items": [{ "label": string, "amount": number | null }],
  "rawText": string
}
totalAmount에는 숫자만 넣고, currency에는 ISO 통화코드(KRW/JPY/USD 등)를 넣어.
한국어 설명으로 summary를 작성해.
`

export async function analyzeReceiptImage(input: {
  imageBase64: string
  mimeType?: string
  prompt?: string
}): Promise<ReceiptAnalysis> {
  if (!ENV.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY_NOT_CONFIGURED')
  }

  const normalizedImage = normalizeImagePayload(input.imageBase64, input.mimeType)

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
  }

  const startedAt = Date.now()
  let response: globalThis.Response
  try {
    response = await fetch(`${GEMINI_ENDPOINT}?key=${ENV.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown'
    throw new Error(`GEMINI_FETCH_FAILED: ${detail}`)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown Gemini error')
    let parsedError: any
    try {
      parsedError = JSON.parse(errorText)
    } catch {
      parsedError = null
    }

    const geminiMessage: string =
      typeof parsedError?.error?.message === 'string'
        ? parsedError.error.message
        : errorText

    const err: any = new Error(`GEMINI_REQUEST_FAILED: ${geminiMessage}`)
    err.status = response.status
    err.geminiMessage = geminiMessage
    err.geminiCode = parsedError?.error?.code
    throw err
  }

  const body = (await response.json()) as GeminiResponse
  const rawText =
    body?.candidates?.[0]?.content?.parts?.find(part => part.text)?.text?.trim() ?? ''

  const parsed = parseReceiptJson(rawText)
  if (!looksLikeReceipt(parsed, rawText)) {
    throw new Error('RECEIPT_NOT_RECOGNIZED')
  }

  return {
    ...parsed,
    modelLatencyMs: Date.now() - startedAt,
  }
}

function normalizeImagePayload(
  imageBase64: string,
  mimeType?: string,
): { data: string; mimeType: string } {
  let data = imageBase64?.trim()
  if (!data) {
    throw new Error('IMAGE_BASE64_REQUIRED')
  }

  let resolvedMime = mimeType?.trim() || 'image/png'
  const dataUrlMatch = data.match(/^data:(.+?);base64,(.+)$/i)
  if (dataUrlMatch) {
    const [, detectedMime, payload] = dataUrlMatch
    if (!mimeType && detectedMime?.trim()) {
      resolvedMime = detectedMime.trim()
    }
    data = payload.trim()
  }

  try {
    Buffer.from(data, 'base64')
  } catch {
    throw new Error('INVALID_IMAGE_BASE64')
  }

  return { data, mimeType: resolvedMime }
}

function parseReceiptJson(rawText: string): ReceiptAnalysis {
  if (!rawText) {
    return {
      totalAmount: null,
      currency: null,
      summary: '',
      rawText,
    }
  }

  const candidate = extractJsonCandidate(rawText)
  if (!candidate) {
    return {
      totalAmount: null,
      currency: null,
      summary: '',
      rawText,
    }
  }

  try {
    const parsed = JSON.parse(candidate) as ReceiptAnalysis
    return normalizeReceipt(parsed, rawText)
  } catch {
    return {
      totalAmount: null,
      currency: null,
      summary: '',
      rawText,
    }
  }
}

function looksLikeReceipt(parsed: ReceiptAnalysis, rawText: string): boolean {
  if (!rawText) return false

  const receiptKeyword = /영수증|RECEIPT/i
  const amountHints = /합계|총액|TOTAL|금액|운임|결제|승차|거리|발행|카카오택시/i
  const nonReceiptHints = /예치금|보증금|계좌|입금|송금|이체|거래내역|충전|잔액|출금/i

  if (!receiptKeyword.test(rawText)) return false
  if (nonReceiptHints.test(rawText)) return false

  if (parsed.totalAmount != null && parsed.currency) return true
  if (Array.isArray(parsed.items) && parsed.items.length > 0) return true
  return amountHints.test(rawText)
}

// Gemini가 ```json ... ``` 또는 여분 텍스트를 섞어서 돌려주는 경우를 보정
function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // 이미 순수 JSON이면 그대로 시도
  try {
    JSON.parse(trimmed)
    return trimmed
  } catch {
    // 계속 진행
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim()
  }

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  return null
}

function normalizeReceipt(parsed: ReceiptAnalysis, rawText: string): ReceiptAnalysis {
  let totalAmount = coerceNumber(parsed.totalAmount)
  let currency =
    typeof parsed.currency === 'string' && parsed.currency.trim()
      ? parsed.currency.trim().toUpperCase()
      : null
  const normalizedItems = Array.isArray(parsed.items)
    ? parsed.items.map(item => ({
        label: typeof item.label === 'string' ? item.label : '',
        amount: coerceNumber(item.amount),
      }))
    : undefined

  if (totalAmount == null || !currency) {
    const inferred = inferAmountFromRawText(rawText)
    if (totalAmount == null && inferred?.amount != null) {
      totalAmount = inferred.amount
    }
    if (!currency && inferred?.currency) {
      currency = inferred.currency
    }
  }

  return {
    totalAmount,
    currency,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    items: normalizedItems?.length ? normalizedItems : undefined,
    rawText,
  }
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const rangeMatch = trimmed.match(/^([\d,\s.]+)\s*[-~]\s*([\d,\s.]+)$/)
    if (rangeMatch) {
      const [, startText, endText] = rangeMatch
      const start = Number(startText.replace(/[^\d.-]/g, ''))
      const end = Number(endText.replace(/[^\d.-]/g, ''))
      const normalized = [start, end].filter(n => Number.isFinite(n)) as number[]
      if (normalized.length) {
        return Math.min(...normalized)
      }
    }

    const cleaned = trimmed.replace(/[^\d.-]/g, '')
    if (!cleaned) return null
    const asNumber = Number(cleaned)
    return Number.isFinite(asNumber) ? asNumber : null
  }
  return null
}

const CURRENCY_PATTERNS: Array<{ currency: string; regex: RegExp }> = [
  { currency: 'JPY', regex: /(?:JP\u00A5|JPY|\u00A5)\s*([\d,\.\-~]+)/i },
  { currency: 'KRW', regex: /(?:KRW|\u20A9)\s*([\d,\.\-~]+)/i },
  { currency: 'USD', regex: /(?:USD|\$)\s*([\d,\.\-~]+)/i }
]

function inferAmountFromRawText(rawText: string): { amount: number | null; currency: string | null } | null {
  if (!rawText) return null

  for (const pattern of CURRENCY_PATTERNS) {
    const match = rawText.match(pattern.regex)
    if (match?.[1]) {
      const amount = coerceNumber(match[1])
      if (amount != null) {
        return { amount, currency: pattern.currency }
      }
    }
  }

  const generalMatch = rawText.match(/(?:\uACC4|\uCD1D\uC561|\uD569\uACC4|total)\D*([\d,\.\-~]+)/i)
  if (generalMatch?.[1]) {
    const amount = coerceNumber(generalMatch[1])
    if (amount != null) {
      return { amount, currency: null }
    }
  }

  return null
}
