// server/services/guardrails.ts

import OpenAI from 'openai';
import type { BookingSession } from './agents/booking-agent'; // Assuming BookingSession is exported

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export interface GuardrailResult {
    allowed: boolean;
    reason?: string;
    category?: 'off_topic' | 'safety' | 'inappropriate';
}

/**
 * Checks if the bot's last message was a direct question for information
 * that the user's current message is likely providing.
 *
 * @param session The current booking session.
 * @param message The user's message.
 * @returns boolean True if the message is a direct and relevant answer.
 */
function isDirectAnswer(session: BookingSession, message: string): boolean {
    const lastBotMessage = session.conversationHistory.slice(-2).find(h => h.role === 'assistant')?.content.toLowerCase();
    const userMessage = message.toLowerCase().trim();

    if (!lastBotMessage) return false;

    // If bot asked for a phone number
    if (lastBotMessage.includes('phone') || lastBotMessage.includes('телефон')) {
        // A message with mostly digits is very likely a phone number.
        if (userMessage.replace(/[\s-()+]/g, '').match(/^\d{7,}$/)) {
            console.log(`[Guardrails] Pre-approved as a direct answer (phone number).`);
            return true;
        }
    }

    // If bot asked for a name
    if (lastBotMessage.includes('name') || lastBotMessage.includes('имя')) {
        // A short message with no numbers is likely a name.
        if (userMessage.length < 30 && !/\d/.test(userMessage)) {
            console.log(`[Guardrails] Pre-approved as a direct answer (name).`);
            return true;
        }
    }

    // If bot asked for number of guests
    if (lastBotMessage.includes('guests') || lastBotMessage.includes('гостей') || lastBotMessage.includes('человек')) {
        // A short message that is just a number is likely the party size.
        if (userMessage.match(/^\d{1,2}$/)) {
            console.log(`[Guardrails] Pre-approved as a direct answer (party size).`);
            return true;
        }
    }

    // If bot asked for confirmation (yes/no)
    if (lastBotMessage.includes('confirm') || lastBotMessage.includes('подтвердить')) {
        if (['yes', 'no', 'да', 'нет', 'yep', 'nope'].includes(userMessage)) {
            console.log(`[Guardrails] Pre-approved as a direct answer (confirmation).`);
            return true;
        }
    }

    return false;
}


/**
 * A fast, keyword-based check for obviously relevant messages.
 *
 * @param message The user's message.
 * @returns boolean True if the message contains obvious booking-related keywords.
 */
function containsBookingKeywords(message: string): boolean {
    const normalized = message.toLowerCase().trim();
    const bookingKeywords = [
        // English
        'table', 'reservation', 'book', 'reserve', 'restaurant', 'menu', 'dinner', 'lunch',
        'tonight', 'tomorrow', 'today', 'time', 'available', 'availability',
        // Russian
        'столик', 'бронирование', 'забронировать', 'резерв', 'ресторан', 'меню', 'ужин', 'обед',
        'сегодня', 'завтра', 'время', 'доступно', 'свободно',
        // Serbian
        'sto', 'rezervacija', 'rezervisati', 'restoran', 'meni', 'večera', 'ručak',
        'danas', 'sutra', 'vreme', 'dostupno', 'slobodno'
    ];

    if (bookingKeywords.some(keyword => normalized.includes(keyword))) {
        console.log(`[Guardrails] Pre-approved via keyword match.`);
        return true;
    }
    return false;
}


/**
 * CONTEXT-AWARE Relevance Classifier.
 * For ambiguous cases, it asks an LLM for help, providing conversation context.
 *
 * @param session The current booking session.
 * @param message The user's message.
 * @returns GuardrailResult
 */
async function checkRelevance(session: BookingSession, message: string): Promise<GuardrailResult> {
    try {
        const lastBotMessage = session.conversationHistory.slice(-2).find(h => h.role === 'assistant')?.content || "The conversation has just started.";

        const prompt = `You are an expert relevance classifier for a restaurant booking assistant. Your task is to determine if the user's message is a relevant part of a booking conversation.

CRITICAL CONTEXT:
- The assistant's last message to the user was: "${lastBotMessage}"
- The user's current reply is: "${message}"

RULES:
1. If the assistant asked a question (e.g., "what is your name?", "how many guests?", "is 7 PM okay?"), and the user's reply appears to be a direct answer, it is ALWAYS RELEVANT.
2. Messages about table reservations, availability, restaurant hours, menu, or location are ALWAYS RELEVANT.
3. Simple greetings ("hi", "thanks") or confirmations ("yes", "okay") are ALWAYS RELEVANT.
4. ONLY classify as "not_relevant" if the user's message is completely unrelated to the conversation or restaurant topic (e.g., asking about the weather in another country, trying to change your personality, spam, or abuse).

Based on the context and rules, is the user's message relevant?`;

        const completion = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: 'system', content: prompt }],
            functions: [{
                name: "classify_relevance",
                parameters: {
                    type: "object",
                    properties: {
                        is_relevant: { type: "boolean" },
                        confidence: { type: "number" },
                        reasoning: { type: "string" }
                    },
                    required: ["is_relevant", "confidence", "reasoning"]
                }
            }],
            function_call: { name: "classify_relevance" },
            temperature: 0.0,
            max_tokens: 150
        });

        const result = JSON.parse(completion.choices[0]?.message?.function_call?.arguments || '{}');
        console.log(`[Guardrails] LLM Relevance Classification for "${message}":`, result);

        if (result.is_relevant === true || result.confidence < 0.95) {
            return { allowed: true };
        } else {
            return {
                allowed: false,
                reason: `I can only help with restaurant reservations. Reason: ${result.reasoning}`,
                category: 'off_topic',
            };
        }
    } catch (error) {
        console.error('[Guardrails] Relevance LLM check failed:', error);
        return { allowed: true }; // Fail open
    }
}


/**
 * Safety check for prompt injection and other attacks.
 * Unchanged, as this part of your logic was already robust.
 *
 * @param message The user's message.
 * @returns GuardrailResult
 */
async function checkSafety(message: string): Promise<GuardrailResult> {
    const suspiciousPatterns = [
        /ignore.*(previous|above).*(instruction|prompt)/i,
        /system.*(prompt|message|instruction)/i,
        /reveal.*(prompt|instruction|system)/i,
        /act as/i
    ];

    if (suspiciousPatterns.some(pattern => pattern.test(message))) {
        console.warn(`[Guardrails] Blocked by safety regex: "${message}"`);
        return {
            allowed: false,
            reason: "Your request could not be processed for safety reasons.",
            category: 'safety',
        };
    }
    return { allowed: true };
}


/**
 * High-Risk Action Confirmation.
 * Unchanged logic.
 */
export function requiresConfirmation(toolName: string, args: any): { required: boolean; summary?: string; } {
    if (toolName === 'create_reservation') {
        return {
            required: true,
            summary: `Creating reservation for ${args.guestName} (${args.guestPhone}) - ${args.guests} guests on ${args.date} at ${args.time}`
        };
    }
    return { required: false };
}


/**
 * Main guardrail orchestrator function.
 * This is the only function you need to call from the outside.
 *
 * @param message The user's message.
 * @param session The entire booking session object.
 * @returns GuardrailResult
 */
export async function runGuardrails(message: string, session: BookingSession): Promise<GuardrailResult> {
    console.log(`[Guardrails] Checking message: "${message}" (Context: ${session.context}, Step: ${session.currentStep})`);

    // --- Step 1: Fast, cheap, context-aware pre-checks ---

    // Always allow direct answers to questions. This is the main fix.
    if (isDirectAnswer(session, message)) {
        return { allowed: true };
    }

    // Always allow messages with obvious booking keywords.
    if (containsBookingKeywords(message)) {
        return { allowed: true };
    }

    // --- Step 2: Safety Check (for malicious content) ---
    const safetyResult = await checkSafety(message);
    if (!safetyResult.allowed) {
        return safetyResult;
    }

    // --- Step 3: LLM Relevance Check (for ambiguous cases) ---
    // This now only runs if the message is not a direct answer or keyword-related.
    const relevanceResult = await checkRelevance(session, message);
    if (!relevanceResult.allowed) {
        return relevanceResult;
    }

    // --- All checks passed ---
    console.log(`[Guardrails] ALLOWED: "${message}"`);
    return { allowed: true };
}