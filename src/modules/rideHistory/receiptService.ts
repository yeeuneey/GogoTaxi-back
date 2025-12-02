import { ENV } from '../../config/env'

const GEMINI_API_VERSION = ENV.GEMINI_API_VERSION?.trim() || 'v1'
const GEMINI_MODEL = ENV.GEMINI_MODEL?.trim() || 'gemini-2.0-flash-001'
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
당신은 한국 택시/모빌리티 영수증을 분석하는 보조 도구입니다. 제공된 이미지를 보고 아래 JSON 스키마만 반환하세요.
{
  "totalAmount": number | null,
  "currency": "KRW" | null,
  "summary": string,
  "items": [{ "label": string, "amount": number | null }],
  "rawText": string
}
- 총액/합계/Total 줄에서 통화 기호(₩, KRW, 원)와 붙어 있는 금액만 찾아 totalAmount에 숫자로 입력합니다. 예: "합계 ₩9,200" -> totalAmount: 9200, currency: "KRW".
- 숫자에서 쉼표/통화 기호를 제거하고 정수로 변환하세요.
- 원화 외(JPY, USD 등) 통화 표시는 모두 무시하세요.
- summary는 한국어 한 줄 설명으로 작성하세요.
- items에는 보이는 주요 항목(label, amount)을 넣되 없으면 비워두세요.
`

export async function analyzeReceiptImage(input: {
  imageBase64: string
  mimeType?: string
  prompt?: string
}): Promise<ReceiptAnalysis> {
  if (!ENV.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY_NOT_CONFIGURED')
  }

  const normalizedBase64 = input.imageBase64.replace(/^data:[^;]+;base64,/, '').trim()

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: input.prompt?.trim() || DEFAULT_PROMPT.trim() },
          {
            inline_data: {
              mime_type: input.mimeType || 'image/png',
              data: normalizedBase64,
            },
          },
        ],
      },
    ],
    generationConfig: { temperature: 0 },
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
    const detail = `status ${response.status} ${response.statusText} - ${errorText}`
    throw new Error(`GEMINI_REQUEST_FAILED: ${detail}`)
  }

  const body = (await response.json()) as GeminiResponse
  const rawText =
    body?.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join(' ').trim() ?? ''

  const parsed = parseReceiptJson(rawText)

  return {
    ...parsed,
    modelLatencyMs: Date.now() - startedAt,
  }
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

// Gemini가 ```json ... ``` 또는 여분 텍스트를 섞어서 돌려주는 경우를 보정
function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // 순수 JSON이면 그대로 사용
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
    const cleaned = value.replace(/[^\d.-]/g, '')
    if (!cleaned) return null
    const asNumber = Number(cleaned)
    return Number.isFinite(asNumber) ? asNumber : null
  }
  return null
}

const CURRENCY_PATTERNS: Array<{ currency: string; regex: RegExp }> = [
  { currency: 'KRW', regex: /(?:KRW|₩|￦|원)\s*([\d,.]+)/i },
]

function inferAmountFromRawText(
  rawText: string,
): { amount: number | null; currency: string | null } | null {
  if (!rawText) return null

  const totalFromLines = extractTotalFromLines(rawText)
  if (totalFromLines) return totalFromLines

  for (const pattern of CURRENCY_PATTERNS) {
    const match = rawText.match(pattern.regex)
    if (match?.[1]) {
      const amount = coerceNumber(match[1])
      if (amount != null) {
        return { amount, currency: pattern.currency }
      }
    }
  }

  const generalMatch = rawText.match(/(?:합계|총액|총\s*금액|total)\D*([\d,.]+)/i)
  if (generalMatch?.[1] && /(?:KRW|₩|￦|원)/i.test(rawText)) {
    const amount = coerceNumber(generalMatch[1])
    if (amount != null) {
      return { amount, currency: 'KRW' }
    }
  }

  return null
}

// 합계/총액 줄에서 우선적으로 총 금액을 추출한다.
function extractTotalFromLines(
  rawText: string,
): { amount: number | null; currency: string | null } | null {
  const lines = rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const totalMatch = line.match(
      /(?:합계|총액|총\s*금액|total)\s*[:\-]?\s*([₩￦]?\s*[\d.,]+)/i,
    )
    if (totalMatch?.[1]) {
      if (!/(₩|￦|KRW|원)/i.test(line)) continue
      const amount = coerceNumber(totalMatch[1])
      if (amount != null) {
        const currency = 'KRW'
        return { amount, currency }
      }
    }
  }

  return null
}
