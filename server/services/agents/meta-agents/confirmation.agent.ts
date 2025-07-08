// server/services/agents/meta-agents/confirmation.agent.ts
// ✅ PHASE 3: Confirmation agent extracted from enhanced-conversation-manager.ts
// SOURCE: enhanced-conversation-manager.ts runConfirmationAgent (lines ~300-350)
// SOURCE: enhanced-conversation-manager.ts extractNameChoice (lines ~950-1000)

import type { Language } from '../core/agent.types';
import { AIFallbackService } from '../../ai/ai-fallback.service';

// ===== CONFIRMATION INTERFACES =====
export interface ConfirmationResult {
    confirmationStatus: 'positive' | 'negative' | 'unclear';
    reasoning: string;
    confidence?: number;
}

export interface NameChoiceResult {
    chosenName: string | null;
    confidence: number;
    reasoning: string;
}

export interface ConfirmationContext {
    pendingActionSummary: string;
    language: Language;
    actionType: 'booking' | 'cancellation' | 'modification' | 'general';
    userMessage: string;
}

// ===== CONFIRMATION PATTERNS BY LANGUAGE =====
// SOURCE: enhanced-conversation-manager.ts confirmation patterns
const CONFIRMATION_PATTERNS: Record<Language, {
    positive: string[];
    negative: string[];
    unclear: string[];
}> = {
    'en': {
        positive: ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'correct', 'right', 'confirm', 'agree', 'sounds good'],
        negative: ['no', 'nope', 'cancel', 'stop', 'wrong', 'incorrect', 'abort', 'nevermind'],
        unclear: ['maybe', 'not sure', 'hmm', 'uh', 'um', 'what', 'huh', 'can you', 'could you']
    },
    'ru': {
        positive: ['да', 'ага', 'конечно', 'хорошо', 'правильно', 'верно', 'подтверждаю', 'согласен', 'все верно'],
        negative: ['нет', 'не', 'отменить', 'стоп', 'неправильно', 'неверно', 'отмена', 'не надо'],
        unclear: ['может', 'не знаю', 'хм', 'эм', 'что', 'а', 'можно', 'а можно']
    },
    'sr': {
        positive: ['da', 'dobro', 'u redu', 'tačno', 'potvrđujem', 'slažem se', 'sve je tačno'],
        negative: ['ne', 'otkaži', 'stop', 'pogrešno', 'netačno', 'prekini', 'ne treba'],
        unclear: ['možda', 'ne znam', 'hmm', 'šta', 'da li', 'možete li', 'da li možete']
    },
    'hu': {
        positive: ['igen', 'jó', 'rendben', 'helyes', 'megerősítem', 'egyetértek', 'minden rendben'],
        negative: ['nem', 'mégse', 'leállít', 'rossz', 'helytelen', 'megszakít', 'nem kell'],
        unclear: ['talán', 'nem tudom', 'hmm', 'mi', 'tudna', 'lehetne', 'tudnád']
    },
    'de': {
        positive: ['ja', 'gut', 'okay', 'richtig', 'bestätige', 'einverstanden', 'alles richtig'],
        negative: ['nein', 'abbrechen', 'stopp', 'falsch', 'incorrect', 'aufhören', 'nicht nötig'],
        unclear: ['vielleicht', 'weiß nicht', 'hmm', 'was', 'können sie', 'könnten sie', 'würden sie']
    },
    'fr': {
        positive: ['oui', 'bien', 'd\'accord', 'correct', 'je confirme', 'tout est bon'],
        negative: ['non', 'annuler', 'arrêt', 'faux', 'incorrect', 'pas besoin'],
        unclear: ['peut-être', 'je ne sais pas', 'hmm', 'quoi', 'pouvez-vous', 'pourriez-vous']
    },
    'es': {
        positive: ['sí', 'bueno', 'está bien', 'correcto', 'confirmo', 'de acuerdo', 'todo bien'],
        negative: ['no', 'cancelar', 'parar', 'incorrecto', 'mal', 'no hace falta'],
        unclear: ['quizás', 'no sé', 'hmm', 'qué', 'puede', 'podría', 'podrías']
    },
    'it': {
        positive: ['sì', 'bene', 'va bene', 'corretto', 'confermo', 'd\'accordo', 'tutto bene'],
        negative: ['no', 'annulla', 'stop', 'sbagliato', 'incorrecto', 'non serve'],
        unclear: ['forse', 'non so', 'hmm', 'cosa', 'può', 'potrebbe', 'potresti']
    },
    'pt': {
        positive: ['sim', 'bom', 'está bem', 'correto', 'confirmo', 'de acordo', 'tudo bem'],
        negative: ['não', 'cancelar', 'parar', 'errado', 'incorreto', 'não precisa'],
        unclear: ['talvez', 'não sei', 'hmm', 'o que', 'pode', 'poderia', 'poderias']
    },
    'nl': {
        positive: ['ja', 'goed', 'oké', 'juist', 'bevestig', 'akkoord', 'alles goed'],
        negative: ['nee', 'annuleren', 'stop', 'verkeerd', 'fout', 'niet nodig'],
        unclear: ['misschien', 'weet niet', 'hmm', 'wat', 'kunt u', 'zou u', 'kun je']
    },
    'auto': {
        positive: ['yes', 'okay', 'good', 'correct', 'confirm'],
        negative: ['no', 'cancel', 'stop', 'wrong'],
        unclear: ['maybe', 'not sure', 'what', 'can you']
    }
};

// ===== CONFIRMATION DETECTION AGENT =====
// SOURCE: enhanced-conversation-manager.ts runConfirmationAgent method
export class ConfirmationDetectionAgent {
    constructor(private aiService: AIFallbackService) {}

    /**
     * Main confirmation detection method
     * SOURCE: enhanced-conversation-manager.ts runConfirmationAgent (lines ~300-350)
     */
    async analyzeConfirmation(
        context: ConfirmationContext
    ): Promise<ConfirmationResult> {
        try {
            const prompt = this.buildConfirmationPrompt(context);

            // ✅ USE CLAUDE HAIKU: Fast confirmation analysis with fallback
            const responseText = await this.aiService.generateContent(
                prompt,
                'confirmation', // Uses Haiku for fast decisions
                {
                    temperature: 0.0, // Very low temperature for consistent analysis
                    maxTokens: 150
                }
            );
            
            const decision = this.parseConfirmationResponse(responseText);

            console.log(`🤖 [ConfirmationAgent-Claude] Decision for "${context.userMessage}":`, {
                status: decision.confirmationStatus,
                reasoning: decision.reasoning,
                confidence: decision.confidence
            });

            return decision;

        } catch (error) {
            console.error('[ConfirmationAgent] Error:', error);
            // Fallback to pattern matching
            return this.performFallbackAnalysis(context);
        }
    }

    /**
     * Build comprehensive confirmation analysis prompt
     * SOURCE: enhanced-conversation-manager.ts runConfirmationAgent prompt
     */
    private buildConfirmationPrompt(context: ConfirmationContext): string {
        return `You are a Confirmation Agent for a restaurant booking system.
The user was asked to confirm an action. Analyze their response and decide if it's a "positive" or "negative" confirmation.

## CONTEXT
- **Language:** ${context.language}
- **Action Requiring Confirmation:** ${context.pendingActionSummary}
- **User's Response:** "${context.userMessage}"

## RULES
1. **Positive:** The user agrees, confirms, or says yes (e.g., "Yes, that's correct", "Sounds good", "Igen, rendben", "Igen, rendben van", "Да, все верно").
2. **Negative:** The user disagrees, cancels, or says no (e.g., "No, cancel that", "That's wrong", "Nem", "Нет, отменить").
3. **Unclear:** The user asks a question, tries to change details, or gives an ambiguous reply.

## EXAMPLES BY LANGUAGE:

**Hungarian:**
- "Igen" → positive
- "Igen, rendben" → positive
- "Igen, rendben van" → positive
- "Jó" → positive
- "Nem" → negative
- "Mégse" → negative
- "Változtatni szeretnék" → unclear

**English:**
- "Yes" → positive
- "Yes, that's right" → positive
- "Sounds good" → positive
- "No" → negative
- "Cancel" → negative
- "Can I change the time?" → unclear

**Russian:**
- "Да" → positive
- "Да, все правильно" → positive
- "Нет" → negative
- "Отменить" → negative
- "А можно поменять время?" → unclear

## RESPONSE FORMAT
Respond with ONLY a JSON object.

{
  "confirmationStatus": "positive" | "negative" | "unclear",
  "reasoning": "Briefly explain your decision based on the user's message.",
  "confidence": 0.0-1.0
}`;
    }

    /**
     * Parse AI response into structured result
     */
    private parseConfirmationResponse(responseText: string): ConfirmationResult {
        try {
            const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const parsed = JSON.parse(cleanJson);

            return {
                confirmationStatus: this.validateConfirmationStatus(parsed.confirmationStatus),
                reasoning: parsed.reasoning || 'Claude Haiku confirmation analysis.',
                confidence: Math.max(0, Math.min(1, parsed.confidence || 0.8))
            };
        } catch (error) {
            console.error('[ConfirmationAgent] Failed to parse AI response:', error);
            return {
                confirmationStatus: 'unclear',
                reasoning: 'Failed to parse AI response - treating as unclear for safety',
                confidence: 0.1
            };
        }
    }

    /**
     * Validate confirmation status
     */
    private validateConfirmationStatus(status: string): 'positive' | 'negative' | 'unclear' {
        if (['positive', 'negative', 'unclear'].includes(status)) {
            return status as 'positive' | 'negative' | 'unclear';
        }
        console.warn(`[ConfirmationAgent] Invalid status: ${status}, defaulting to unclear`);
        return 'unclear';
    }

    /**
     * Fallback pattern matching when AI fails
     */
    private performFallbackAnalysis(context: ConfirmationContext): ConfirmationResult {
        const message = context.userMessage.toLowerCase().trim();
        const patterns = CONFIRMATION_PATTERNS[context.language] || CONFIRMATION_PATTERNS['en'];

        // Check positive patterns
        for (const pattern of patterns.positive) {
            if (message.includes(pattern)) {
                return {
                    confirmationStatus: 'positive',
                    reasoning: `Pattern match: "${pattern}" indicates positive confirmation`,
                    confidence: 0.7
                };
            }
        }

        // Check negative patterns
        for (const pattern of patterns.negative) {
            if (message.includes(pattern)) {
                return {
                    confirmationStatus: 'negative',
                    reasoning: `Pattern match: "${pattern}" indicates negative confirmation`,
                    confidence: 0.7
                };
            }
        }

        // Check unclear patterns
        for (const pattern of patterns.unclear) {
            if (message.includes(pattern)) {
                return {
                    confirmationStatus: 'unclear',
                    reasoning: `Pattern match: "${pattern}" indicates unclear response`,
                    confidence: 0.6
                };
            }
        }

        // Default to unclear for safety
        return {
            confirmationStatus: 'unclear',
            reasoning: 'No clear confirmation pattern detected - treating as unclear for safety',
            confidence: 0.3
        };
    }

    /**
     * Extract name choice from user response during name conflicts
     * SOURCE: enhanced-conversation-manager.ts extractNameChoice (lines ~950-1000)
     */
    async extractNameChoice(
        userMessage: string,
        dbName: string,
        requestName: string,
        language: Language
    ): Promise<NameChoiceResult> {
        try {
            const prompt = `You are helping resolve a name conflict in a restaurant booking system.

CONTEXT:
- Database has existing profile: "${dbName}"  
- User wants to book under name: "${requestName}"
- User's response: "${userMessage}"
- Language: ${language}

TASK: Determine which name the user wants to use based on their response.

EXAMPLES:
"Мяурина я" → wants "Мяурина" (user identifies as Мяурина)
"I am John" → wants "John"
"use John" → wants "John" 
"go with Лола" → wants "Лола"
"keep the old one" → wants "${dbName}"
"the new name" → wants "${requestName}"
"да" → wants "${requestName}" (yes = use new name)
"нет" → wants "${dbName}" (no = keep old name)
"new" → wants "${requestName}"
"old" → wants "${dbName}"
"первое" → wants "${requestName}" (first mentioned)
"второе" → wants "${dbName}" (second mentioned)

Important: Return the EXACT name (including non-Latin characters) that the user wants to use.

Respond with JSON only:
{
  "chosen_name": "exact name or null if unclear",
  "confidence": 0.0-1.0,
  "reasoning": "explanation of decision"
}`;

            const responseText = await this.aiService.generateContent(
                prompt,
                'confirmation',
                {
                    temperature: 0.0,
                    maxTokens: 150
                }
            );

            const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const result = JSON.parse(cleanJson);

            console.log(`[NameClarification] LLM extracted choice from "${userMessage}":`, {
                chosenName: result.chosen_name,
                confidence: result.confidence,
                reasoning: result.reasoning
            });

            let chosenName: string | null = null;
            if (result.confidence >= 0.8 && result.chosen_name) {
                const candidateName = result.chosen_name.trim();

                if (candidateName.toLowerCase() === dbName.toLowerCase() ||
                    candidateName.toLowerCase() === requestName.toLowerCase()) {
                    chosenName = candidateName;
                }
            }

            return {
                chosenName,
                confidence: result.confidence || 0.0,
                reasoning: result.reasoning || 'AI name choice analysis'
            };

        } catch (error) {
            console.error('[NameClarification] LLM extraction failed:', error);
            return this.performFallbackNameExtraction(userMessage, dbName, requestName);
        }
    }

    /**
     * Fallback name extraction using patterns
     */
    private performFallbackNameExtraction(
        userMessage: string,
        dbName: string,
        requestName: string
    ): NameChoiceResult {
        const message = userMessage.toLowerCase().trim();

        // Direct name mentions
        if (message.includes(dbName.toLowerCase())) {
            return {
                chosenName: dbName,
                confidence: 0.8,
                reasoning: `Direct mention of database name "${dbName}"`
            };
        }

        if (message.includes(requestName.toLowerCase())) {
            return {
                chosenName: requestName,
                confidence: 0.8,
                reasoning: `Direct mention of request name "${requestName}"`
            };
        }

        // Common choice patterns
        const choicePatterns: Array<{ patterns: string[]; choice: string; confidence: number }> = [
            {
                patterns: ['да', 'yes', 'new', 'новое', 'pierwszy', 'first', 'новый'],
                choice: requestName,
                confidence: 0.7
            },
            {
                patterns: ['нет', 'no', 'old', 'старое', 'drugi', 'second', 'старый'],
                choice: dbName,
                confidence: 0.7
            },
            {
                patterns: ['keep', 'оставь', 'старое имя', 'existing'],
                choice: dbName,
                confidence: 0.6
            },
            {
                patterns: ['use', 'используй', 'новое имя', 'change to'],
                choice: requestName,
                confidence: 0.6
            }
        ];

        for (const { patterns, choice, confidence } of choicePatterns) {
            if (patterns.some(pattern => message.includes(pattern))) {
                return {
                    chosenName: choice,
                    confidence,
                    reasoning: `Pattern match indicates choice: ${choice}`
                };
            }
        }

        return {
            chosenName: null,
            confidence: 0.1,
            reasoning: 'No clear name choice pattern detected'
        };
    }
}

// ===== CONFIRMATION UTILITIES =====

/**
 * Quick confirmation check using patterns only
 */
export function quickConfirmationCheck(
    message: string,
    language: Language
): 'positive' | 'negative' | 'unclear' {
    const lowerMessage = message.toLowerCase().trim();
    const patterns = CONFIRMATION_PATTERNS[language] || CONFIRMATION_PATTERNS['en'];

    // Check for exact matches first (higher confidence)
    if (patterns.positive.some(pattern => lowerMessage === pattern)) {
        return 'positive';
    }

    if (patterns.negative.some(pattern => lowerMessage === pattern)) {
        return 'negative';
    }

    // Check for partial matches
    if (patterns.positive.some(pattern => lowerMessage.includes(pattern))) {
        return 'positive';
    }

    if (patterns.negative.some(pattern => lowerMessage.includes(pattern))) {
        return 'negative';
    }

    return 'unclear';
}

/**
 * Check if message is likely a confirmation response
 */
export function isConfirmationResponse(message: string, language: Language): boolean {
    const patterns = CONFIRMATION_PATTERNS[language] || CONFIRMATION_PATTERNS['en'];
    const lowerMessage = message.toLowerCase().trim();

    const allPatterns = [
        ...patterns.positive,
        ...patterns.negative,
        ...patterns.unclear
    ];

    return allPatterns.some(pattern => 
        lowerMessage.includes(pattern) || lowerMessage === pattern
    );
}

/**
 * Get confidence level for confirmation detection
 */
export function getConfirmationConfidence(
    message: string,
    language: Language,
    status: 'positive' | 'negative' | 'unclear'
): number {
    const patterns = CONFIRMATION_PATTERNS[language] || CONFIRMATION_PATTERNS['en'];
    const lowerMessage = message.toLowerCase().trim();
    const relevantPatterns = patterns[status];

    // Exact match = high confidence
    if (relevantPatterns.some(pattern => lowerMessage === pattern)) {
        return 0.95;
    }

    // Partial match = medium confidence
    if (relevantPatterns.some(pattern => lowerMessage.includes(pattern))) {
        return 0.7;
    }

    // No pattern match = low confidence
    return 0.3;
}

/**
 * Create confirmation context from booking action
 */
export function createConfirmationContext(
    userMessage: string,
    pendingActionSummary: string,
    language: Language,
    actionType: 'booking' | 'cancellation' | 'modification' | 'general' = 'general'
): ConfirmationContext {
    return {
        userMessage,
        pendingActionSummary,
        language,
        actionType
    };
}

// ===== EXPORT DEFAULT =====
export default ConfirmationDetectionAgent;