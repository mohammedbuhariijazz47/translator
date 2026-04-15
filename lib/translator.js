import translate from 'google-translate-api-x'
import {
  getLanguageCode,
  getLanguageDisplayName,
  getLanguageLabel,
} from '@/lib/languages'
import { GoogleGenAI } from '@google/genai'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isGeminiOverloadedError(err) {
  const code = err?.code ?? err?.error?.code ?? err?.cause?.code
  const status = err?.status ?? err?.error?.status ?? err?.cause?.status
  const message = String(err?.message ?? err?.error?.message ?? '').toLowerCase()

  return (
    code === 503 ||
    status === 'UNAVAILABLE' ||
    message.includes('high demand') ||
    message.includes('unavailable')
  )
}

async function generateContentWithRetry(ai, request, { retries = 2 } = {}) {
  let lastErr

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await ai.models.generateContent(request)
    } catch (err) {
      lastErr = err
      const canRetry = attempt < retries && isGeminiOverloadedError(err)
      if (!canRetry) throw err

      // Fast exponential backoff with a little jitter.
      const base = 400 * Math.pow(2, attempt) // 400ms, 800ms, 1600ms
      const jitter = Math.floor(Math.random() * 200)
      await sleep(base + jitter)
    }
  }

  throw lastErr
}

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!apiKey) return null
  return new GoogleGenAI({ apiKey })
}

const GEMINI_MODEL = 'gemini-2.5-flash'

function getResponseText(response) {
  const text = response?.text
  if (typeof text === 'string' && text.trim()) return text.trim()

  const candidates = response?.candidates || []
  const parts = candidates.flatMap(candidate => candidate?.content?.parts || [])
  const combined = parts
    .map(part => part?.text)
    .filter(Boolean)
    .join('\n')
    .trim()

  if (combined) return combined
  throw new Error('Gemini returned an empty response.')
}

/**
 * Detect language and translate email body.
 * Uses Gemini if API key is provided for flawless results, else falls back to generic google translate API.
 */
export async function translateEmail(text, targetLang = 'English') {
  if (!text?.trim()) throw new Error('No text provided')
  
  const ai = getGeminiClient()
  if (ai) {
    try {
      const prompt = `You are an expert translator. Translate the following email text into ${targetLang}. Focus on perfect grammar, correct native spellings, and appropriate alphabets. Do not add any conversational text, just return the translated text.\n\nText:\n${text}`
      const response = await generateContentWithRetry(ai, {
        model: GEMINI_MODEL,
        contents: prompt
      })
      const toCode = getLanguageCode(targetLang)
      // Gemini doesn't reliably provide a detected language code; use the lightweight
      // translate library to detect the source language for downstream features (like reply translation).
      let detectedCode = 'auto'
      try {
        const detection = await translate(text, { to: toCode, autoCorrect: true })
        detectedCode = detection.from?.language?.iso || 'auto'
      } catch {
        // ignore detection failures; keep 'auto'
      }

      return {
        detectedLang: getLanguageLabel(detectedCode),
        detectedLangCode: detectedCode,
        targetLang: getLanguageLabel(toCode),
        targetLangCode: toCode,
        confidence: 'high',
        translated: getResponseText(response),
      }
    } catch (e) {
      console.warn("Gemini translation failed, falling back...", e)
    }
  }

  // Fallback to basic translation
  try {
    const toCode = getLanguageCode(targetLang)
    const res = await translate(text, { to: toCode, autoCorrect: true })
    const detectedCode = res.from?.language?.iso || 'auto'
    
    return {
      detectedLang: getLanguageLabel(detectedCode),
      detectedLangCode: detectedCode,
      targetLang: getLanguageLabel(toCode),
      targetLangCode: toCode,
      confidence: 'high',
      translated: res.text,
    }
  } catch (err) {
    console.error('Translation error:', err)
    throw new Error('Translation failed.')
  }
}

/**
 * Translate a reply from the user's language into the recipient's language.
 */
export async function translateReply(replyText, recipientLang) {
  if (!replyText?.trim()) throw new Error('No reply text provided')

  const ai = getGeminiClient()
  if (ai) {
    try {
      const prompt = `You are a professional email translator. Accurately translate this text to ${recipientLang}. Maintain the exact tone, ensure formal/polite addressing natively, use accurate alphabets, and zero spelling mistakes. Provide ONLY the translated output.\n\nText:\n${replyText}`
      const response = await generateContentWithRetry(ai, {
        model: GEMINI_MODEL,
        contents: prompt
      })
      const toCode = getLanguageCode(recipientLang)
      return {
        recipientLang: getLanguageLabel(toCode),
        recipientLangDisplay: getLanguageDisplayName(toCode),
        recipientLangCode: toCode,
        translated: getResponseText(response),
      }
    } catch (e) {
      console.warn("Gemini reply translation failed, falling back...", e)
    }
  }

  try {
    const toCode = getLanguageCode(recipientLang)
    const res = await translate(replyText, { to: toCode, autoCorrect: true })
    
    return {
      recipientLang: getLanguageLabel(toCode),
      recipientLangDisplay: getLanguageDisplayName(toCode),
      recipientLangCode: toCode,
      translated: res.text,
    }
  } catch (err) {
    console.error('Reply translation error:', err)
    throw new Error('Translation failed.')
  }
}

/**
 * Summarize an email in one or two sentences.
 */
export async function summarizeEmail(text, lang = 'English') {
  if (!text?.trim()) throw new Error('No text provided')
  
  const ai = getGeminiClient()
  if (ai) {
    try {
      const prompt = `Summarize the following email in a single, clear sentence in ${lang}.\n\nText:\n${text}`
      const response = await generateContentWithRetry(ai, {
        model: GEMINI_MODEL,
        contents: prompt
      })
      return { summary: getResponseText(response) }
    } catch (e) {
      console.warn('Gemini summarize failed, falling back...', e)
    }
  }

  const firstSentence = text.split(/[.!?\n]/).filter(s => s.trim().length > 0)[0] || text
  const summaryText = firstSentence.substring(0, 150) + (firstSentence.length > 150 ? '...' : '.')
  try {
    const toCode = getLanguageCode(lang)
    const res = await translate(summaryText, { to: toCode, autoCorrect: true })
    return { summary: res.text }
  } catch (err) {
    return { summary: summaryText }
  }
}

/**
 * Generate an AI Draft reply based on the received email
 */
export async function generateDraftReply(emailBody, lang = 'English') {
  if (!emailBody?.trim()) throw new Error('No email content provided')
  const ai = getGeminiClient()
  if (!ai) throw new Error('Gemini API key is required to generate AI drafts.')

  const prompt = `You are a helpful AI assistant. Write a polite, standard reply to the following email. Write the draft in ${lang}. Return ONLY the text of the reply, ready to be inserted into a text box, with no conversational filler.\n\nReceived Email:\n${emailBody}`
  const response = await generateContentWithRetry(ai, {
    model: GEMINI_MODEL,
    contents: prompt
  })
  
  return getResponseText(response)
}

/**
 * Grammar check text
 */
export async function grammarCheckText(text) {
  if (!text?.trim()) throw new Error('No text provided')
  const ai = getGeminiClient()
  if (!ai) throw new Error('Gemini API key is required for Grammar Check.')

  const prompt = `Proofread the following text. Fix any spelling mistakes, punctuation, grammatical errors, and ensure it sounds professional. Ensure the exact language remains the same. Return ONLY the corrected text, no conversational filler.\n\nText:\n${text}`
  const response = await generateContentWithRetry(ai, {
    model: GEMINI_MODEL,
    contents: prompt
  })
  
  return getResponseText(response)
}
