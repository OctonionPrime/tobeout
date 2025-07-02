// server/services/guardrails.ts
// ✅ LANGUAGE ENHANCEMENT: Added Translation Service integration for error messages
// ✅ FIX (This version): Corrected the requiresConfirmation logic for cancellations to prevent redundant prompts.

import OpenAI from 'openai';
import type { BookingSession } from './agents/booking-agent';
import type { Language } from './enhanced-conversation-manager';

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export interface GuardrailResult {
    allowed: boolean;
    reason?: string;
    category?: 'off_topic' | 'safety' | 'inappropriate';
}

/**
 * ✅ NEW: Translation Service for error messages
 */
class GuardrailTranslationService {
    private static client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    static async translateGuardrailMessage(
        message: string, 
        targetLanguage: Language
    ): Promise<string> {
        if (targetLanguage === 'en' || targetLanguage === 'auto') return message;
        
        const languageNames: Record<Language, string> = {
            'en': 'English', 'ru': 'Russian', 'sr': 'Serbian', 'hu': 'Hungarian',
            'de': 'German', 'fr': 'French', 'es': 'Spanish', 'it': 'Italian',
            'pt': 'Portuguese', 'nl': 'Dutch', 'auto': 'English'
        };
        
        const prompt = `Translate this restaurant guardrail/error message to ${languageNames[targetLanguage]}:

"${message}"

Context: This is an error or restriction message for a restaurant booking system
Keep the same tone and professional style.
Return only the translation, no explanations.`;

        try {
            const completion = await this.client.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 200,
                temperature: 0.2
            });
            
            return completion.choices[0]?.message?.content?.trim() || message;
        } catch (error) {
            console.error('[GuardrailTranslation] Error:', error);
            return message; // Fallback to original
        }
    }
}

/**
 * ✅ ENHANCED: Checks if the bot's last message was a direct question for information
 * that the user's current message is likely providing.
 * Now includes phone number detection patterns for better validation.
 *
 * @param session The current booking session.
 * @param message The user's message.
 * @returns boolean True if the message is a direct and relevant answer.
 */
function isDirectAnswer(session: BookingSession, message: string): boolean {
    const lastBotMessage = session.conversationHistory.slice(-2).find(h => h.role === 'assistant')?.content.toLowerCase();
    const userMessage = message.toLowerCase().trim();

    if (!lastBotMessage) return false;

    // ✅ ENHANCED: Better phone number detection
    if (lastBotMessage.includes('phone') || lastBotMessage.includes('телефон') || lastBotMessage.includes('номер') || 
        lastBotMessage.includes('telefon') || lastBotMessage.includes('szám') || lastBotMessage.includes('numero')) {
        // Enhanced phone number patterns: supports various formats
        const phonePatterns = [
            /^\+?[\d\s\-\(\)]{7,15}$/,  // International formats
            /^\d{7,11}$/,                // Simple digit strings  
            /^\+\d{1,3}[\s\-]?\d{3,4}[\s\-]?\d{3,4}[\s\-]?\d{2,4}$/, // International with spaces/dashes
            /^\(\d{3}\)[\s\-]?\d{3}[\s\-]?\d{4}$/  // US format (555) 123-4567
        ];

        if (phonePatterns.some(pattern => pattern.test(userMessage.replace(/[\s\-\(\)]/g, '')))) {
            console.log(`[Guardrails] Pre-approved as a direct answer (phone number): "${userMessage}"`);
            return true;
        }
    }

    // ✅ ENHANCED: Better name detection with multilingual support
    if (lastBotMessage.includes('name') || lastBotMessage.includes('имя') || lastBotMessage.includes('зовут') ||
        lastBotMessage.includes('ime') || lastBotMessage.includes('név') || lastBotMessage.includes('nome') ||
        lastBotMessage.includes('nom') || lastBotMessage.includes('naam')) {
        // A message with letters, possibly some spaces, no numbers, reasonable length
        if (userMessage.length >= 2 && userMessage.length <= 50 &&
            /^[a-zA-Zа-яёА-ЯЁáéíóúýčďĺľňŕšťžàèùâêîôûäëïöüÿçñáéíóúüñçăâîşţ\s\-\.\']+$/.test(userMessage)) {
            console.log(`[Guardrails] Pre-approved as a direct answer (name): "${userMessage}"`);
            return true;
        }
    }

    // If bot asked for number of guests (multilingual)
    if (lastBotMessage.includes('guests') || lastBotMessage.includes('гостей') || lastBotMessage.includes('человек') || 
        lastBotMessage.includes('people') || lastBotMessage.includes('gostiju') || lastBotMessage.includes('fő') ||
        lastBotMessage.includes('persone') || lastBotMessage.includes('personas') || lastBotMessage.includes('personnes')) {
        // A short message that is just a number is likely the party size.
        if (userMessage.match(/^\d{1,2}$/)) {
            console.log(`[Guardrails] Pre-approved as a direct answer (party size): "${userMessage}"`);
            return true;
        }
    }

    // ✅ ENHANCED: Date and time detection with multilingual support
    if (lastBotMessage.includes('date') || lastBotMessage.includes('дата') || lastBotMessage.includes('когда') ||
        lastBotMessage.includes('datum') || lastBotMessage.includes('dátum') || lastBotMessage.includes('data') ||
        lastBotMessage.includes('fecha') || lastBotMessage.includes('date')) {
        // Date patterns: "13 июля", "July 13", "2025-07-13", "tomorrow", etc.
        const datePatterns = [
            /\d{1,2}\s*(янв|фев|мар|апр|май|июн|июл|авг|сен|окт|ноя|дек)/i,
            /\d{4}-\d{2}-\d{2}/,
            /(today|tomorrow|tonight|завтра|сегодня|danas|sutra|ma|holnap|oggi|domani|hoy|mañana|aujourd|demain)/i,
            /(january|february|march|april|may|june|july|august|september|october|november|december)\s*\d{1,2}/i,
            /(január|február|március|április|május|június|július|augusztus|szeptember|október|november|december)\s*\d{1,2}/i
        ];

        if (datePatterns.some(pattern => pattern.test(userMessage))) {
            console.log(`[Guardrails] Pre-approved as a direct answer (date): "${userMessage}"`);
            return true;
        }
    }

    if (lastBotMessage.includes('time') || lastBotMessage.includes('время') || lastBotMessage.includes('часов') ||
        lastBotMessage.includes('vreme') || lastBotMessage.includes('idő') || lastBotMessage.includes('ora') ||
        lastBotMessage.includes('tiempo') || lastBotMessage.includes('heure')) {
        // Time patterns: "20:00", "8 pm", "в 20-00", etc.
        const timePatterns = [
            /\d{1,2}:\d{2}/,
            /\d{1,2}\s*(pm|am)/i,
            /в\s*\d{1,2}[\-:]\d{2}/i,
            /\d{1,2}\s*(вечера|утра|дня)/i,
            /\d{1,2}\s*(uveče|ujutru|popodne)/i,
            /\d{1,2}\s*(este|délután|reggel)/i
        ];

        if (timePatterns.some(pattern => pattern.test(userMessage))) {
            console.log(`[Guardrails] Pre-approved as a direct answer (time): "${userMessage}"`);
            return true;
        }
    }

    // If bot asked for confirmation (yes/no) - multilingual
    if (lastBotMessage.includes('confirm') || lastBotMessage.includes('подтвердить') || lastBotMessage.includes('верно') ||
        lastBotMessage.includes('potvrdi') || lastBotMessage.includes('megerősít') || lastBotMessage.includes('conferma') ||
        lastBotMessage.includes('confirma') || lastBotMessage.includes('confirmer')) {
        const confirmWords = ['yes', 'no', 'да', 'нет', 'yep', 'nope', 'da', 'ne', 'igen', 'nem', 'sì', 'sí', 'oui', 'non', 'ja', 'nein'];
        if (confirmWords.includes(userMessage)) {
            console.log(`[Guardrails] Pre-approved as a direct answer (confirmation): "${userMessage}"`);
            return true;
        }
    }

    return false;
}

/**
 * ✅ ENHANCED: A fast, keyword-based check for obviously relevant messages.
 * Now includes more comprehensive patterns and better multilingual support.
 *
 * @param message The user's message.
 * @returns boolean True if the message contains obvious booking-related keywords.
 */
function containsBookingKeywords(message: string): boolean {
    const normalized = message.toLowerCase().trim();

    // ✅ ENHANCED: More comprehensive booking keywords with all supported languages
    const bookingKeywords = [
        // English - expanded
        'table', 'reservation', 'book', 'reserve', 'restaurant', 'menu', 'dinner', 'lunch',
        'tonight', 'tomorrow', 'today', 'time', 'available', 'availability', 'booking',
        'seat', 'party', 'guests', 'people', 'dine', 'dining', 'eat', 'meal',
        'cancel', 'change', 'modify', 'reschedule', 'move', 'different time',

        // Russian - expanded with variations and common typos
        'столик', 'бронирование', 'забронировать', 'резерв', 'ресторан', 'меню', 'ужин', 'обед',
        'сегодня', 'завтра', 'время', 'доступно', 'свободно', 'бронь', 'столик',
        'гостей', 'человек', 'поесть', 'покушать', 'ужинать', 'обедать',
        'отменить', 'изменить', 'поменять', 'перенести', 'другое время',
        'стол', 'места', 'свободен', 'занят', 'можно', 'нельзя',

        // Serbian - expanded
        'sto', 'rezervacija', 'rezervisati', 'restoran', 'meni', 'večera', 'ručak',
        'danas', 'sutra', 'vreme', 'dostupno', 'slobodno', 'rezervacija',
        'gostiju', 'osoba', 'jesti', 'večerati', 'ručati',
        'otkazati', 'promeniti', 'pomeriti', 'drugo vreme',

        // ✅ NEW: Hungarian
        'asztal', 'foglalás', 'foglalni', 'étterem', 'menü', 'vacsora', 'ebéd',
        'ma', 'holnap', 'idő', 'elérhető', 'szabad', 'foglalás',
        'vendég', 'fő', 'enni', 'vacsorázni', 'ebédelni',
        'lemondani', 'változtatni', 'áttenni', 'másik idő',

        // ✅ NEW: German
        'tisch', 'reservierung', 'reservieren', 'restaurant', 'menü', 'abendessen', 'mittagessen',
        'heute', 'morgen', 'zeit', 'verfügbar', 'frei', 'buchung',
        'gäste', 'personen', 'essen', 'dinieren', 'speisen',
        'stornieren', 'ändern', 'verschieben', 'andere zeit',

        // ✅ NEW: French
        'table', 'réservation', 'réserver', 'restaurant', 'menu', 'dîner', 'déjeuner',
        'aujourd', 'demain', 'temps', 'disponible', 'libre', 'réservation',
        'invités', 'personnes', 'manger', 'dîner', 'déjeuner',
        'annuler', 'changer', 'modifier', 'autre heure',

        // ✅ NEW: Spanish
        'mesa', 'reserva', 'reservar', 'restaurante', 'menú', 'cena', 'almuerzo',
        'hoy', 'mañana', 'tiempo', 'disponible', 'libre', 'reserva',
        'invitados', 'personas', 'comer', 'cenar', 'almorzar',
        'cancelar', 'cambiar', 'modificar', 'otra hora',

        // ✅ NEW: Italian
        'tavolo', 'prenotazione', 'prenotare', 'ristorante', 'menu', 'cena', 'pranzo',
        'oggi', 'domani', 'tempo', 'disponibile', 'libero', 'prenotazione',
        'ospiti', 'persone', 'mangiare', 'cenare', 'pranzare',
        'cancellare', 'cambiare', 'modificare', 'altro orario',

        // ✅ NEW: Portuguese
        'mesa', 'reserva', 'reservar', 'restaurante', 'menu', 'jantar', 'almoço',
        'hoje', 'amanhã', 'tempo', 'disponível', 'livre', 'reserva',
        'convidados', 'pessoas', 'comer', 'jantar', 'almoçar',
        'cancelar', 'mudar', 'modificar', 'outro horário',

        // ✅ NEW: Dutch
        'tafel', 'reservering', 'reserveren', 'restaurant', 'menu', 'diner', 'lunch',
        'vandaag', 'morgen', 'tijd', 'beschikbaar', 'vrij', 'boeking',
        'gasten', 'personen', 'eten', 'dineren', 'lunchen',
        'annuleren', 'wijzigen', 'veranderen', 'andere tijd'
    ];

    if (bookingKeywords.some(keyword => normalized.includes(keyword))) {
        console.log(`[Guardrails] Pre-approved via keyword match: found "${bookingKeywords.find(k => normalized.includes(k))}"`);
        return true;
    }
    return false;
}

/**
 * ✅ ENHANCED: CONTEXT-AWARE Relevance Classifier with Translation Service.
 * For ambiguous cases, it asks an LLM for help, providing conversation context.
 * Now with better prompting and more nuanced understanding.
 *
 * @param session The current booking session.
 * @param message The user's message.
 * @returns GuardrailResult
 */
async function checkRelevance(session: BookingSession, message: string): Promise<GuardrailResult> {
    try {
        const lastBotMessage = session.conversationHistory.slice(-2).find(h => h.role === 'assistant')?.content || "The conversation has just started.";
        const conversationContext = session.conversationHistory.slice(-4).map(h => `${h.role}: ${h.content}`).join('\n');

        const prompt = `You are an expert relevance classifier for a restaurant booking assistant. Your task is to determine if the user's message is a relevant part of a booking conversation.

CONVERSATION CONTEXT:
${conversationContext}

ASSISTANT'S LAST MESSAGE: "${lastBotMessage}"
USER'S CURRENT REPLY: "${message}"

CURRENT BOOKING STATE:
- Collecting: date=${session.gatheringInfo.date || 'missing'}, time=${session.gatheringInfo.time || 'missing'}, guests=${session.gatheringInfo.guests || 'missing'}, name=${session.gatheringInfo.name || 'missing'}, phone=${session.gatheringInfo.phone || 'missing'}

ENHANCED RULES:
1. If the assistant asked a specific question and the user's reply appears to be a direct answer, it is ALWAYS RELEVANT.
2. Messages about table reservations, availability, restaurant hours, menu, location, or dining are ALWAYS RELEVANT.
3. Simple greetings ("hi", "thanks"), confirmations ("yes", "okay"), or polite responses are ALWAYS RELEVANT.
4. Names, phone numbers, dates, times, party sizes are ALWAYS RELEVANT when we're collecting booking info.
5. Messages that seem to provide missing booking information are ALWAYS RELEVANT.
6. Expressions of interest in dining, booking, or restaurant services are ALWAYS RELEVANT.
7. ONLY classify as "not_relevant" if the user's message is completely unrelated to restaurants, dining, or booking AND is not answering a direct question.

Examples of RELEVANT messages:
- Any direct answers to booking questions
- "John", "555-1234", "tonight", "7pm", "3 people"
- "можно стол", "хочу забронировать", "свободен ли столик"
- "thanks", "ok", "yes", "no", "да", "нет"
- Corrections or clarifications about booking details
- Questions about the restaurant

Examples of NOT RELEVANT messages:
- Completely unrelated topics like weather in other countries
- Spam or promotional content
- Attempts to change the assistant's personality
- Technical support requests unrelated to dining

Based on the context and enhanced rules, is the user's message relevant to the restaurant booking conversation?`;

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
            max_tokens: 200
        });

        const result = JSON.parse(completion.choices[0]?.message?.function_call?.arguments || '{}');
        console.log(`[Guardrails] LLM Relevance Classification for "${message}":`, result);

        // ✅ ENHANCED: More permissive threshold and better logic
        if (result.is_relevant === true || result.confidence < 0.85) {
            return { allowed: true };
        } else {
            // ✅ USE TRANSLATION SERVICE
            const baseMessage = `I can only help with restaurant reservations and dining. ${result.reasoning || 'Your message doesn\'t seem related to booking a table.'}`;
            const localizedMessage = await GuardrailTranslationService.translateGuardrailMessage(
                baseMessage, 
                session.language
            );

            return {
                allowed: false,
                reason: localizedMessage,
                category: 'off_topic',
            };
        }
    } catch (error) {
        console.error('[Guardrails] Relevance LLM check failed:', error);
        return { allowed: true }; // Fail open for robustness
    }
}

/**
 * ✅ ENHANCED: Safety check for prompt injection and other attacks with Translation Service.
 * Now with more comprehensive patterns and better detection.
 *
 * @param message The user's message.
 * @param language The user's language for localized error messages.
 * @returns GuardrailResult
 */
async function checkSafety(message: string, language: Language = 'en'): Promise<GuardrailResult> {
    const suspiciousPatterns = [
        // Prompt injection attempts
        /ignore.*(previous|above|earlier).*(instruction|prompt|rule)/i,
        /system.*(prompt|message|instruction|role)/i,
        /reveal.*(prompt|instruction|system|role)/i,
        /act\s+as.*(developer|admin|system|gpt|assistant)/i,
        /you\s+are\s+now.*(different|new|updated)/i,
        /forget.*(everything|all|previous|instructions)/i,
        /override.*(instructions|rules|system)/i,

        // Role manipulation
        /pretend.*(you|to\s+be).*(different|human|person)/i,
        /roleplay.*(as|being).*(human|person|customer)/i,
        /imagine.*(you|yourself).*(human|person|different)/i,

        // Direct system access attempts
        /show\s+me.*(prompt|instructions|system)/i,
        /what.*(are\s+your|is\s+your).*(instructions|prompt|system)/i,
        /how.*(were\s+you|are\s+you).*(programmed|trained|instructed)/i
    ];

    if (suspiciousPatterns.some(pattern => pattern.test(message))) {
        console.warn(`[Guardrails] Blocked by enhanced safety regex: "${message.substring(0, 100)}..."`);
        
        // ✅ USE TRANSLATION SERVICE
        const baseMessage = "I'm here to help with restaurant reservations. How can I assist you with booking a table?";
        const localizedMessage = await GuardrailTranslationService.translateGuardrailMessage(
            baseMessage,
            language
        );

        return {
            allowed: false,
            reason: localizedMessage,
            category: 'safety',
        };
    }
    return { allowed: true };
}

/**
 * ✅ ENHANCED & FIXED: High-Risk Action Confirmation with Language Support
 * Now returns structured data and includes better validation for phone numbers.
 * The cancellation logic is now conditional to prevent redundant confirmations.
 */
export function requiresConfirmation(toolName: string, args: any, lang: Language = 'en'): { required: boolean; data?: any; } {
    if (toolName === 'create_reservation') {
        // ✅ ENHANCED: Additional validation before requiring confirmation
        const hasValidPhone = args.guestPhone && args.guestPhone.toString().replace(/[\s\-\(\)]/g, '').length >= 7;
        const hasValidName = args.guestName && args.guestName.toString().trim().length >= 2;

        if (!hasValidPhone || !hasValidName) {
            console.log(`[Guardrails] Skipping confirmation due to invalid data - phone: ${hasValidPhone}, name: ${hasValidName}`);
            return { required: false };
        }

        // ✅ Return the raw data for the LLM to format naturally
        return {
            required: true,
            data: {
                guestName: args.guestName,
                guestPhone: args.guestPhone,
                guests: args.guests,
                date: args.date,
                time: args.time,
                specialRequests: args.specialRequests || ''
            }
        };
    }

    // ✅ CRITICAL FIX: Only require confirmation for cancellations if not already confirmed.
    if (toolName === 'cancel_reservation') {
        // If the 'confirmCancellation' flag from the tool call is already true, it means
        // the user has already confirmed in a previous turn. No further confirmation is needed.
        if (args.confirmCancellation === true) {
            return { required: false };
        }

        // If the flag is not set, we need to ask the user to confirm.
        return {
            required: true,
            data: {
                action: 'cancellation',
                reservationId: args.reservationId,
                reason: args.reason || 'Guest requested cancellation'
            }
        };
    }

    return { required: false };
}

/**
 * ✅ ENHANCED: Main guardrail orchestrator function with Translation Service integration.
 * This is the only function you need to call from the outside.
 * Now with better logging and more intelligent flow.
 *
 * @param message The user's message.
 * @param session The entire booking session object.
 * @returns GuardrailResult
 */
export async function runGuardrails(message: string, session: BookingSession): Promise<GuardrailResult> {
    console.log(`[Guardrails] Checking message: "${message}" (Context: ${session.context}, Step: ${session.currentStep}, Agent: ${(session as any).currentAgent || 'booking'}, Language: ${session.language})`);

    // ✅ ENHANCED: More intelligent pre-checks with better logging

    // Always allow direct answers to questions. This is the main fix.
    if (isDirectAnswer(session, message)) {
        console.log(`[Guardrails] ✅ ALLOWED - Direct answer to assistant's question`);
        return { allowed: true };
    }

    // Always allow messages with obvious booking keywords.
    if (containsBookingKeywords(message)) {
        console.log(`[Guardrails] ✅ ALLOWED - Contains booking keywords`);
        return { allowed: true };
    }

    // ✅ ENHANCED: Allow very short confirmations and common responses (multilingual)
    const shortResponsePatterns = /^(да|нет|yes|no|ok|okay|thanks|спасибо|hvala|ок|k|igen|nem|ja|nein|oui|non|sì|sí|tak|nie)$/i;
    if (shortResponsePatterns.test(message.trim())) {
        console.log(`[Guardrails] ✅ ALLOWED - Short confirmation/response`);
        return { allowed: true };
    }

    // ✅ NEW: Allow messages that seem to provide missing booking information
    const missingInfo = [];
    if (!session.gatheringInfo.date) missingInfo.push('date');
    if (!session.gatheringInfo.time) missingInfo.push('time');
    if (!session.gatheringInfo.guests) missingInfo.push('guests');
    if (!session.gatheringInfo.name) missingInfo.push('name');
    if (!session.gatheringInfo.phone) missingInfo.push('phone');

    if (missingInfo.length > 0) {
        console.log(`[Guardrails] Missing booking info: ${missingInfo.join(', ')} - being more permissive`);
        // Be more permissive when we're clearly in a booking flow and missing info
        const containsDate = /\d{1,2}.*(янв|фев|мар|апр|май|июн|июл|авг|сен|окт|ноя|дек|\d{4}|tomorrow|today|tonight|holnap|ma|sutra|danas)/i.test(message);
        const containsTime = /\d{1,2}[:]\d{2}|\d{1,2}\s*(pm|am|вечера|утра|дня|uveče|ujutru)/i.test(message);
        const containsNumber = /\d+/.test(message);
        const containsName = /^[a-zA-Zа-яёА-ЯЁáéíóúýčďĺľňŕšťžàèùâêîôûäëïöüÿçñáéíóúüñçăâîşţ\s\-\.\']{2,30}$/.test(message.trim());

        if (containsDate || containsTime || (containsNumber && message.length < 20) || containsName) {
            console.log(`[Guardrails] ✅ ALLOWED - Appears to provide missing booking info`);
            return { allowed: true };
        }
    }

    // --- Step 2: Safety Check (for malicious content) ---
    const safetyResult = await checkSafety(message, session.language);
    if (!safetyResult.allowed) {
        console.log(`[Guardrails] ❌ BLOCKED - Safety check failed: ${safetyResult.reason}`);
        return safetyResult;
    }

    // --- Step 3: LLM Relevance Check (for ambiguous cases) ---
    // This now only runs if the message is not a direct answer or keyword-related.
    console.log(`[Guardrails] Running LLM relevance check for ambiguous message...`);
    const relevanceResult = await checkRelevance(session, message);
    if (!relevanceResult.allowed) {
        console.log(`[Guardrails] ❌ BLOCKED - LLM relevance check failed: ${relevanceResult.reason}`);
        return relevanceResult;
    }

    // --- All checks passed ---
    console.log(`[Guardrails] ✅ ALLOWED - Passed all checks: "${message}"`);
    return { allowed: true };
}