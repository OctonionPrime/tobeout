// server/services/agents/meta-agents/language.agent.ts
// ✅ PHASE 3: Language detection agent extracted from enhanced-conversation-manager.ts
// SOURCE: enhanced-conversation-manager.ts runLanguageDetectionAgent (lines ~150-200)

import type { 
    Language, 
    BookingSessionWithAgent 
} from '../core/agent.types';
import { AIFallbackService } from '../../ai/ai-fallback.service';

// ===== LANGUAGE DETECTION INTERFACES =====
export interface LanguageDetectionResult {
    detectedLanguage: Language;
    confidence: number;
    reasoning: string;
    shouldLock: boolean;
}

export interface LanguageDetectionContext {
    conversationHistory: Array<{role: string, content: string}>;
    currentLanguage?: Language;
    isFirstMessage: boolean;
    sessionLocked: boolean;
}

// ===== SUPPORTED LANGUAGES CONFIGURATION =====
// SOURCE: enhanced-conversation-manager.ts language lists
const SUPPORTED_LANGUAGES: Record<Language, {
    name: string;
    nativeName: string;
    commonWords: string[];
    confidenceThreshold: number;
}> = {
    'en': {
        name: 'English',
        nativeName: 'English',
        commonWords: ['the', 'and', 'table', 'reservation', 'book', 'restaurant', 'time', 'date'],
        confidenceThreshold: 0.7
    },
    'ru': {
        name: 'Russian',
        nativeName: 'Русский',
        commonWords: ['и', 'в', 'столик', 'бронирование', 'ресторан', 'время', 'дата', 'забронировать'],
        confidenceThreshold: 0.8
    },
    'sr': {
        name: 'Serbian',
        nativeName: 'Српски',
        commonWords: ['i', 'u', 'sto', 'rezervacija', 'restoran', 'vreme', 'datum', 'rezervisati'],
        confidenceThreshold: 0.8
    },
    'hu': {
        name: 'Hungarian',
        nativeName: 'Magyar',
        commonWords: ['és', 'a', 'asztal', 'foglalás', 'étterem', 'idő', 'dátum', 'foglalni'],
        confidenceThreshold: 0.8
    },
    'de': {
        name: 'German',
        nativeName: 'Deutsch',
        commonWords: ['und', 'der', 'tisch', 'reservierung', 'restaurant', 'zeit', 'datum', 'reservieren'],
        confidenceThreshold: 0.7
    },
    'fr': {
        name: 'French',
        nativeName: 'Français',
        commonWords: ['et', 'le', 'table', 'réservation', 'restaurant', 'temps', 'date', 'réserver'],
        confidenceThreshold: 0.7
    },
    'es': {
        name: 'Spanish',
        nativeName: 'Español',
        commonWords: ['y', 'el', 'mesa', 'reserva', 'restaurante', 'tiempo', 'fecha', 'reservar'],
        confidenceThreshold: 0.7
    },
    'it': {
        name: 'Italian',
        nativeName: 'Italiano',
        commonWords: ['e', 'il', 'tavolo', 'prenotazione', 'ristorante', 'tempo', 'data', 'prenotare'],
        confidenceThreshold: 0.7
    },
    'pt': {
        name: 'Portuguese',
        nativeName: 'Português',
        commonWords: ['e', 'o', 'mesa', 'reserva', 'restaurante', 'tempo', 'data', 'reservar'],
        confidenceThreshold: 0.7
    },
    'nl': {
        name: 'Dutch',
        nativeName: 'Nederlands',
        commonWords: ['en', 'de', 'tafel', 'reservering', 'restaurant', 'tijd', 'datum', 'reserveren'],
        confidenceThreshold: 0.7
    },
    'auto': {
        name: 'Auto-detect',
        nativeName: 'Auto-detect',
        commonWords: [],
        confidenceThreshold: 0.5
    }
};

// ===== LANGUAGE DETECTION AGENT =====
// SOURCE: enhanced-conversation-manager.ts runLanguageDetectionAgent method
export class LanguageDetectionAgent {
    constructor(private aiService: AIFallbackService) {}

    /**
     * Main language detection method
     * SOURCE: enhanced-conversation-manager.ts runLanguageDetectionAgent (lines ~150-200)
     */
    async detectLanguage(
        message: string,
        context: LanguageDetectionContext
    ): Promise<LanguageDetectionResult> {
        try {
            // Build context from conversation history
            const historyContext = context.conversationHistory.length > 0 
                ? context.conversationHistory.slice(-3).map(msg => `${msg.role}: ${msg.content}`).join('\n')
                : 'First message';

            const prompt = this.buildLanguageDetectionPrompt(
                message,
                historyContext,
                context.currentLanguage
            );

            // ✅ USE CLAUDE HAIKU: Fast language detection with fallback
            const responseText = await this.aiService.generateContent(
                prompt,
                'language-detection', // Uses Haiku for fast decisions
                {
                    temperature: 0.0, // Very low temperature for consistent detection
                    maxTokens: 200
                }
            );
            
            const detection = this.parseLanguageDetectionResponse(responseText);

            console.log(`🌍 [LanguageAgent-Claude] Detection for "${message}":`, {
                detected: detection.detectedLanguage,
                confidence: detection.confidence,
                reasoning: detection.reasoning,
                shouldLock: detection.shouldLock
            });

            return detection;

        } catch (error) {
            console.error('[LanguageAgent] Error:', error);
            
            // Simple fallback detection for critical cases
            const fallbackResult = this.performFallbackDetection(message);
            
            return {
                detectedLanguage: fallbackResult.language,
                confidence: 0.3,
                reasoning: 'Fallback detection due to error',
                shouldLock: true
            };
        }
    }

    /**
     * Build comprehensive language detection prompt
     * SOURCE: enhanced-conversation-manager.ts runLanguageDetectionAgent prompt
     */
    private buildLanguageDetectionPrompt(
        message: string,
        historyContext: string,
        currentLanguage?: Language
    ): string {
        const supportedLanguagesList = Object.entries(SUPPORTED_LANGUAGES)
            .filter(([code]) => code !== 'auto')
            .map(([code, info]) => `- ${code} (${info.name})`)
            .join('\n');

        return `You are a Language Detection Agent for a restaurant booking system. Analyze the user's message and determine the language.

CONVERSATION HISTORY:
${historyContext}

USER'S CURRENT MESSAGE: "${message}"
CURRENT SESSION LANGUAGE: ${currentLanguage || 'none set'}

SUPPORTED LANGUAGES:
${supportedLanguagesList}

ANALYSIS RULES:
1. If this is the first substantive message (not just "hi"), detect primary language
2. Handle typos and variations gracefully (e.g., "helo" = "hello")
3. For mixed languages, choose the dominant one
4. For ambiguous short messages ("ok", "yes"), keep current language if set
5. Consider context from conversation history
6. shouldLock = true for first language detection, false for confirmations/short responses

EXAMPLES:
- "Szia! Szeretnék asztalt foglalni" → Hungarian (high confidence, lock)
- "Helo, I want table" → English (medium confidence, lock) 
- "ok" → keep current (low confidence, don't lock)
- "да, подтверждаю" → Russian (high confidence, lock)

Respond with JSON only:
{
  "detectedLanguage": "language_code",
  "confidence": 0.0-1.0,
  "reasoning": "explanation of decision",
  "shouldLock": true/false
}`;
    }

    /**
     * Parse AI response into structured result
     */
    private parseLanguageDetectionResponse(responseText: string): LanguageDetectionResult {
        try {
            const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const parsed = JSON.parse(cleanJson);

            return {
                detectedLanguage: this.validateLanguage(parsed.detectedLanguage),
                confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
                reasoning: parsed.reasoning || 'Claude Haiku detection',
                shouldLock: parsed.shouldLock || false
            };
        } catch (error) {
            console.error('[LanguageAgent] Failed to parse AI response:', error);
            return {
                detectedLanguage: 'en',
                confidence: 0.1,
                reasoning: 'Failed to parse AI response - defaulting to English',
                shouldLock: false
            };
        }
    }

    /**
     * Validate that detected language is supported
     */
    private validateLanguage(language: string): Language {
        if (SUPPORTED_LANGUAGES[language as Language]) {
            return language as Language;
        }
        console.warn(`[LanguageAgent] Unsupported language detected: ${language}, defaulting to English`);
        return 'en';
    }

    /**
     * Fallback detection when AI fails
     * SOURCE: enhanced-conversation-manager.ts fallback logic
     */
    private performFallbackDetection(message: string): { language: Language; confidence: number } {
        const text = message.toLowerCase();
        
        // Cyrillic script detection
        if (/[\u0400-\u04FF]/.test(message)) {
            return { language: 'ru', confidence: 0.9 };
        }
        
        // Language-specific word detection
        const languagePatterns: Array<{ language: Language; patterns: string[]; confidence: number }> = [
            {
                language: 'hu',
                patterns: ['szia', 'szeretnék', 'asztal', 'foglalás', 'étterem', 'időpont'],
                confidence: 0.8
            },
            {
                language: 'sr',
                patterns: ['zdravo', 'rezervacija', 'restoran', 'sto', 'vreme', 'datum'],
                confidence: 0.8
            },
            {
                language: 'de',
                patterns: ['hallo', 'reservierung', 'restaurant', 'tisch', 'zeit', 'ich'],
                confidence: 0.7
            },
            {
                language: 'fr',
                patterns: ['bonjour', 'réservation', 'restaurant', 'table', 'je', 'temps'],
                confidence: 0.7
            },
            {
                language: 'es',
                patterns: ['hola', 'reserva', 'restaurante', 'mesa', 'tiempo', 'quiero'],
                confidence: 0.7
            },
            {
                language: 'it',
                patterns: ['ciao', 'prenotazione', 'ristorante', 'tavolo', 'tempo', 'voglio'],
                confidence: 0.7
            },
            {
                language: 'pt',
                patterns: ['olá', 'reserva', 'restaurante', 'mesa', 'tempo', 'quero'],
                confidence: 0.7
            },
            {
                language: 'nl',
                patterns: ['hallo', 'reservering', 'restaurant', 'tafel', 'tijd', 'ik'],
                confidence: 0.7
            }
        ];

        for (const { language, patterns, confidence } of languagePatterns) {
            if (patterns.some(pattern => text.includes(pattern))) {
                return { language, confidence };
            }
        }

        // Default to English
        return { language: 'en', confidence: 0.5 };
    }

    /**
     * Determine if language should be updated based on session state
     */
    shouldUpdateLanguage(
        detection: LanguageDetectionResult,
        currentLanguage?: Language,
        isLocked: boolean = false
    ): {
        shouldUpdate: boolean;
        reason: string;
    } {
        // Always update if no current language set
        if (!currentLanguage) {
            return {
                shouldUpdate: true,
                reason: 'No current language set'
            };
        }

        // If session is locked, require high confidence to change
        if (isLocked) {
            const threshold = 0.8;
            if (detection.confidence > threshold && detection.detectedLanguage !== currentLanguage) {
                return {
                    shouldUpdate: true,
                    reason: `High confidence (${detection.confidence}) override of locked session`
                };
            }
            return {
                shouldUpdate: false,
                reason: `Session locked, confidence ${detection.confidence} below threshold ${threshold}`
            };
        }

        // If not locked, use standard confidence threshold
        const threshold = SUPPORTED_LANGUAGES[detection.detectedLanguage]?.confidenceThreshold || 0.7;
        if (detection.confidence > threshold && detection.detectedLanguage !== currentLanguage) {
            return {
                shouldUpdate: true,
                reason: `Confidence ${detection.confidence} above threshold ${threshold}`
            };
        }

        return {
            shouldUpdate: false,
            reason: `Confidence ${detection.confidence} below threshold ${threshold}`
        };
    }
}

// ===== LANGUAGE DETECTION UTILITIES =====

/**
 * Check if message is too short for reliable detection
 */
export function isMessageTooShort(message: string): boolean {
    const cleanMessage = message.trim();
    return cleanMessage.length < 3 || /^(hi|hey|ok|yes|no|да|нет)$/i.test(cleanMessage);
}

/**
 * Check if message is likely a continuation rather than new language
 */
export function isLikelyContinuation(message: string): boolean {
    const continuationPatterns = [
        /^(yes|no|ok|okay|thanks|sure|fine)$/i,
        /^(да|нет|ок|хорошо|спасибо|конечно)$/i,
        /^(igen|nem|jó|rendben|köszönöm)$/i,
        /^(ja|nein|gut|okay|danke)$/i,
        /^(oui|non|merci|d'accord)$/i,
        /^\d+$/, // Numbers only
        /^[0-9:/-]+$/ // Dates/times
    ];

    return continuationPatterns.some(pattern => pattern.test(message.trim()));
}

/**
 * Extract language confidence from various signals
 */
export function calculateLanguageConfidence(
    message: string,
    detectedLanguage: Language,
    conversationHistory: Array<{role: string, content: string}>
): number {
    let confidence = 0.5; // Base confidence

    // Script-based confidence (very high for non-Latin scripts)
    if (/[\u0400-\u04FF]/.test(message)) { // Cyrillic
        confidence = 0.95;
    } else if (/[\u0100-\u017F]/.test(message)) { // Extended Latin
        confidence += 0.2;
    }

    // Word-based confidence
    const languageInfo = SUPPORTED_LANGUAGES[detectedLanguage];
    if (languageInfo) {
        const wordsFound = languageInfo.commonWords.filter(word => 
            message.toLowerCase().includes(word)
        ).length;
        confidence += Math.min(0.3, wordsFound * 0.1);
    }

    // Length-based confidence
    if (message.length > 20) {
        confidence += 0.1;
    } else if (message.length < 5) {
        confidence -= 0.2;
    }

    // History consistency
    if (conversationHistory.length > 0) {
        const recentLanguages = conversationHistory
            .slice(-3)
            .map(msg => this.performFallbackDetection?.(msg.content)?.language)
            .filter(Boolean);
        
        const consistentLanguages = recentLanguages.filter(lang => lang === detectedLanguage);
        if (consistentLanguages.length > 1) {
            confidence += 0.1;
        }
    }

    return Math.max(0, Math.min(1, confidence));
}

/**
 * Create language detection context from session
 */
export function createLanguageDetectionContext(
    session: BookingSessionWithAgent,
    isFirstMessage: boolean = false
): LanguageDetectionContext {
    return {
        conversationHistory: session.conversationHistory || [],
        currentLanguage: session.language,
        isFirstMessage,
        sessionLocked: session.languageLocked || false
    };
}

/**
 * Update session with language detection results
 */
export function updateSessionWithLanguageDetection(
    session: BookingSessionWithAgent,
    detection: LanguageDetectionResult
): {
    languageChanged: boolean;
    lockChanged: boolean;
    previousLanguage?: Language;
} {
    const previousLanguage = session.language;
    const wasLocked = session.languageLocked || false;
    
    let languageChanged = false;
    let lockChanged = false;

    // Update language if different
    if (detection.detectedLanguage !== previousLanguage) {
        session.language = detection.detectedLanguage;
        languageChanged = true;
    }

    // Update lock status if should lock and not already locked
    if (detection.shouldLock && !wasLocked) {
        session.languageLocked = true;
        session.languageDetectionLog = {
            detectedAt: new Date().toISOString(),
            firstMessage: '', // Will be set by caller
            confidence: detection.confidence,
            reasoning: detection.reasoning
        };
        lockChanged = true;
    }

    return {
        languageChanged,
        lockChanged,
        previousLanguage
    };
}

// ===== EXPORT DEFAULT =====
export default LanguageDetectionAgent;