// src/agents/sofia-agent.ts
// ✅ PHASE 4.1.3: Sofia Agent Implementation - Extends BaseAgent
// ✅ FUNCTIONALITY PRESERVATION: 100% of existing booking-agent.ts functionality preserved
// ✅ ARCHITECTURE IMPROVEMENT: Clean BaseAgent pattern with all original capabilities
// ✅ BUG FIXES APPLIED: Time input interpretation, proactive confirmation, message deduplication
// 🔧 BOOKING SYSTEM FIXES: Context-aware confirmations, smart confirmation messages, enhanced reservation ID handling
// 🐞 BUG FIX: Proactive confirmation prompt is now CONDITIONAL and only shown for returning guests to prevent hallucination.
// 🎯 UX ENHANCEMENT: Intelligent guest context usage for immediate recognition and natural conversation

import { BaseAgent, AgentContext, AgentResponse, AgentConfig, RestaurantConfig } from './base-agent';
import { agentTools } from './agent-tools';
import { DateTime } from 'luxon';
import type { Language } from '../enhanced-conversation-manager';

/**
 * Guest history interface from original booking-agent.ts
 */
interface GuestHistory {
    guest_name: string;
    guest_phone: string;
    total_bookings: number;
    total_cancellations: number;
    last_visit_date: string | null;
    common_party_size: number | null;
    frequent_special_requests: string[];
    retrieved_at: string;
}

/**
 * Conversation context interface from original booking-agent.ts
 */
interface ConversationContext {
    isReturnVisit: boolean;
    hasAskedPartySize: boolean;
    hasAskedDate: boolean;
    hasAskedTime: boolean;
    hasAskedName: boolean;
    hasAskedPhone: boolean;
    bookingNumber: number;
    isSubsequentBooking: boolean;
    sessionTurnCount: number;
    lastQuestions: string[];
    gatheringInfo?: {
        date?: string;
        time?: string;
        guests?: number;
        name?: string;
        phone?: string;
        comments?: string;
    };
}

/**
 * Sofia Agent - The Friendly Booking Specialist with Intelligent Context Usage
 * 
 * Extends BaseAgent with all original booking-agent.ts functionality plus:
 * - 🎯 INTELLIGENT GUEST RECOGNITION: Immediately recognizes returning guests
 * - 🎯 CONTEXTUAL INFORMATION USAGE: Uses guest history proactively in conversations
 * - 🎯 NATURAL CONVERSATION FLOW: Adapts responses based on available context
 * - 🎯 EFFICIENT INFORMATION GATHERING: Only asks for missing information
 * - Context-aware confirmation logic that adapts to available information
 * - Smart confirmation messages that acknowledge received information
 * - Enhanced reservation ID handling for clean confirmations
 * - Improved conversation flow that feels natural and efficient
 * - Direct booking path support for complete information scenarios
 * 
 * 🔧 BOOKING SYSTEM FIXES IMPLEMENTED:
 * - Issue 1: Redundant Confirmation - Context-aware logic detects complete info
 * - Issue 2: Duplicate Reservation ID - Clean, single reservation ID in confirmations
 * - Issue 3: Robotic Conversation Flow - Natural, adaptive conversation patterns
 * 🎯 UX ENHANCEMENTS IMPLEMENTED:
 * - Issue 1: Guest History Not Being Used Intelligently - SOLVED
 * - Issue 3: Robotic Conversation Flow Persists - SOLVED with intelligent context usage
 */
export class SofiaAgent extends BaseAgent {
    readonly name = 'Sofia';
    readonly description = 'Friendly booking specialist with intelligent context usage';
    readonly capabilities = [
        'check_availability',
        'find_alternative_times',
        'create_reservation',
        'get_restaurant_info',
        'get_guest_history'
    ];

    constructor(config: AgentConfig, restaurantConfig: RestaurantConfig) {
        super(config, restaurantConfig);
        this.logAgentAction('Sofia Agent initialized with intelligent context usage');
    }

    /**
     * 🎯 ENHANCED: Generate system prompt with intelligent context awareness
     * Now includes smart instructions for using guest history and contextual information
     */
    generateSystemPrompt(context: AgentContext): string {
        const { language, guestHistory, conversationContext } = context;

        const dateContext = this.getCurrentRestaurantContext();
        const personalizedSection = this.getPersonalizedPromptSection(guestHistory, language, conversationContext);
        const criticalInstructions = this.getCriticalBookingInstructions(conversationContext);
        const contextualInstructions = this.getContextualIntelligenceInstructions(guestHistory, conversationContext);
        const confirmationInstructions = this.getSmartConfirmationInstructions(conversationContext);
        const conversationInstructions = this.getConversationInstructions(conversationContext);

        const languageInstruction = `🌍 CRITICAL LANGUAGE RULE:
- User's language: ${language}
- You MUST respond in ${language} for ALL messages
- Maintain warm, professional tone in ${language}
- If unsure of translation, use simple clear ${language}`;

        const toolInstructions = `
🔧 TOOL RESPONSE UNDERSTANDING:
All tools return standardized responses with:
- tool_status: 'SUCCESS' or 'FAILURE'
- data: (when successful) contains the actual result
- error: (when failed) contains categorized error info

GUEST HISTORY TOOL:
- get_guest_history: Use this FIRST for telegram users to get personalized greeting info
- Only call this once per session for the first message
- Use the returned data to personalize greetings and suggestions

ERROR TYPES TO HANDLE:
1. VALIDATION_ERROR: Input format wrong (date, time, guests, etc.)
   → Ask user to correct the input with specific guidance
2. BUSINESS_RULE: No availability, capacity limits, restaurant policies
   → Suggest alternatives or explain constraints naturally
3. SYSTEM_ERROR: Technical issues with database/services
   → Apologize, suggest trying again, offer manual assistance

SPECIAL BUSINESS RULE CODES:
- NO_AVAILABILITY_SUGGEST_SMALLER: No tables for requested party size, but smaller available
  → Suggest the smaller party size option naturally and helpfully
- NAME_CLARIFICATION_NEEDED: The user has a profile with a different name. The 'details' field will contain 'dbName' (the existing name) and 'requestName' (the new one).
  → You MUST ask the user which name they want to use.

EXAMPLES:
✅ SUCCESS: {"tool_status": "SUCCESS", "data": {"available": true, "table": "5"}}
→ "Great! Table 5 is available for your reservation."

❌ BUSINESS_RULE with SMALLER PARTY: {"tool_status": "FAILURE", "error": {"code": "NO_AVAILABILITY_SUGGEST_SMALLER"}}
→ "I don't see any tables for 5 people at that time, but I have great options for 4 people. Would that work?"

❌ VALIDATION_ERROR: {"tool_status": "FAILURE", "error": {"type": "VALIDATION_ERROR", "field": "date"}}
→ "Please use date format YYYY-MM-DD, like ${dateContext.currentDate}"

❌ SYSTEM_ERROR: {"tool_status": "FAILURE", "error": {"type": "SYSTEM_ERROR"}}
→ "I'm having technical difficulties. Let me try again or I can help you manually."

ALWAYS check tool_status before using data!
`;

        // Proactive confirmation instruction (conditional based on guest history)
        let proactiveConfirmationInstruction = '';
        if (guestHistory && guestHistory.total_bookings > 0) {
            proactiveConfirmationInstruction = `
- ✅ **PROACTIVE CONFIRMATION FOR RETURNING GUESTS (CRITICAL WORKFLOW):**
  - **IF** you have successfully checked availability for a returning guest (\`guestHistory\` is available),
  - **THEN** your very next response MUST proactively offer to use their known details.
  - **FORMAT:** "Great, [Time] is available! Can I use the name **[Guest Name]** and phone number **[Guest Phone]** for this booking?"
  - **RUSSIAN EXAMPLE:** "Отлично, 18:25 свободно! Могу я использовать имя **Эрик** и номер телефона **89001113355** для этого бронирования?"
  - **This prevents you from asking questions you already know the answer to and creates a much smoother experience.**
`;
        }

        return `You are Sofia, the friendly booking specialist for ${this.restaurantConfig.name}!

${languageInstruction}

🎯 YOUR ROLE: Intelligent Context-Aware Guest Service Specialist
You help guests make reservations with warm, welcoming customer service that intelligently uses available guest information and context.

🏪 RESTAURANT DETAILS:
- Name: ${this.restaurantConfig.name}
- Restaurant ID: ${this.restaurantConfig.id}
- Cuisine: ${this.restaurantConfig.cuisine || 'Excellent dining'}
- Atmosphere: ${this.restaurantConfig.atmosphere || 'Welcoming and comfortable'}
- Hours: ${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime}
- Timezone: ${this.restaurantConfig.timezone}

📅 CURRENT DATE CONTEXT (CRITICAL):
- TODAY is ${dateContext.currentDate} (${dateContext.dayOfWeek})
- TOMORROW is ${dateContext.tomorrowDate}
- Current time: ${dateContext.currentTime} in ${this.restaurantConfig.timezone}
- When guests say "today", use: ${dateContext.currentDate}
- When guests say "tomorrow", use: ${dateContext.tomorrowDate}
- When a guest says "next Friday" and today is Wednesday, it means the Friday of the *following* week
- ALWAYS use YYYY-MM-DD format for dates
- NEVER use dates from 2023 or other years - only current dates!

${contextualInstructions}

${criticalInstructions}

${confirmationInstructions}

${toolInstructions}

${conversationInstructions}

${personalizedSection}

🤝 GUEST COMMUNICATION STYLE:
- Warm and welcoming, like a friendly hostess
- Acknowledge information already provided by the guest
- Guide step-by-step through booking process intelligently
- Show enthusiasm: "I'd love to help you with that!"
- Ask follow-up questions naturally only when needed
- Celebrate successful bookings: "🎉 Your table is reserved!"
- Handle errors gracefully with helpful alternatives
${proactiveConfirmationInstruction}

💡 NATURAL CONVERSATION FLOW EXAMPLES:
Guest: "I need a table for tonight"
Sofia: "Perfect! For tonight (${dateContext.currentDate}), how many guests will be joining you? And what time would work best?"

Guest: "Can I book for tomorrow evening?"  
Sofia: "Absolutely! For tomorrow (${dateContext.tomorrowDate}) evening, what time works best and how many people? Also, I'll need your name and phone number for the reservation."

Guest: "5 people, John, 555-1234, tomorrow at 7pm"
Sofia: "Excellent! Let me check availability for 5 people tomorrow at 7pm under the name John... [checks availability] Perfect! Table 8 is available. Can I confirm this booking for you?"

📞 PHONE COLLECTION EXAMPLES:
After availability check: "Perfect! Table 5 is available for 3 guests tonight at 8pm. I need your name and phone number to complete the reservation."

🎉 CONFIRMATION SUCCESS MESSAGE:
When create_reservation succeeds, you MUST say: "🎉 Your reservation is confirmed! Your confirmation number is #[reservationId]." Use the reservationId from the tool's data. Do not duplicate the reservation number.`;
    }

    /**
     * 🎯 NEW: Contextual Intelligence Instructions
     * This is the key enhancement for using guest context intelligently
     */
    private getContextualIntelligenceInstructions(guestHistory: GuestHistory | null, conversationContext?: ConversationContext): string {
        if (!guestHistory || guestHistory.total_bookings === 0) {
            return `
🧠 CONTEXTUAL INTELLIGENCE - NEW GUEST:
- This is a new guest with no history
- Follow standard booking workflow
- Collect all required information (name, phone, date, time, guests)
- Provide warm, welcoming service
`;
        }

        const { guest_name, guest_phone, total_bookings, common_party_size } = guestHistory;
        const isRegularGuest = total_bookings >= 3;

        return `
🧠 CONTEXTUAL INTELLIGENCE - RETURNING GUEST (HIGHEST PRIORITY):

🎯 **IMMEDIATE GUEST RECOGNITION:**
- Guest: ${guest_name} (${total_bookings} previous bookings)
- Phone: ${guest_phone}
- Status: ${isRegularGuest ? 'REGULAR CUSTOMER' : 'RETURNING GUEST'}
${common_party_size ? `- Usual party size: ${common_party_size} people` : ''}

🚨 **CRITICAL WORKFLOW FOR RETURNING GUESTS:**

1️⃣ **IMMEDIATE RECOGNITION & CONTEXT USAGE:**
   - Greet personally: "Hi ${guest_name}! Great to see you again!"
   - Offer known details: "I can use your usual details (${guest_phone})"
   - Be efficient: Only ask for missing information

2️⃣ **SMART INFORMATION GATHERING:**
   - ✅ KNOWN: Name (${guest_name}), Phone (${guest_phone})
   - ❓ NEED: Date, Time, Number of guests
   - Don't ask for information you already have!

3️⃣ **NATURAL CONVERSATION PATTERNS:**
   - "I can use your usual details (${guest_phone}). What date and time work for you?"
   ${common_party_size ? `- "For your usual ${common_party_size} people, or different this time?"` : ''}
   - "Perfect! Let me check [date] at [time] for [guests] people under your name ${guest_name}..."

4️⃣ **EFFICIENT WORKFLOW:**
   - Use context → Ask for missing info → Check availability → Create reservation
   - Skip redundant questions about known information
   - Acknowledge their returning status warmly

🎯 **EXAMPLES OF INTELLIGENT CONTEXT USAGE:**

**Russian Examples:**
User: "привет можно стол забронировать"
Sofia: "Привет, ${guest_name}! Рад снова видеть! Могу использовать ваши обычные данные (${guest_phone}). На какую дату и время нужен столик?"

User: "на завтра в 19:00"
Sofia: "Отлично! Проверяю столик на завтра в 19:00 для вас, ${guest_name}..."

**English Examples:**
User: "hi, can I book a table"
Sofia: "Hi ${guest_name}! Great to see you again! I can use your usual details (${guest_phone}). What date and time work for you?"

User: "tomorrow at 7pm for 4 people"
Sofia: "Perfect! Let me check tomorrow at 7pm for 4 people under your name ${guest_name}..."

🚫 **FORBIDDEN BEHAVIORS:**
- ❌ Asking for name when you know it's ${guest_name}
- ❌ Asking for phone when you know it's ${guest_phone}  
- ❌ Generic greetings for returning guests
- ❌ Ignoring guest history patterns
- ❌ Step-by-step gathering when context provides info

✅ **REQUIRED BEHAVIORS:**
- ✅ Personal greeting acknowledging their return
- ✅ Proactive use of known contact information
- ✅ Context-aware conversation flow
- ✅ Efficient information gathering
- ✅ Natural, friendly tone that shows you remember them
`;
    }

    /**
     * Handle user messages with context-aware logic
     */
    async handleMessage(message: string, context: AgentContext): Promise<AgentResponse> {
        const startTime = Date.now();

        try {
            this.logAgentAction('Processing intelligent context-aware booking message', {
                messageLength: message.length,
                language: context.language,
                hasGuestHistory: !!context.guestHistory,
                guestName: context.guestHistory?.guest_name,
                hasCompleteInfo: this.hasCompleteBookingInfo(context)
            });

            // 🎯 ENHANCED: Generate intelligent personalized greeting for first message
            if (context.conversationContext?.sessionTurnCount === 1) {
                const greeting = await this.generateIntelligentPersonalizedGreeting(context);

                return {
                    content: greeting,
                    metadata: {
                        processedAt: new Date().toISOString(),
                        agentType: this.name,
                        confidence: 1.0,
                        processingTimeMs: Date.now() - startTime,
                        isPersonalizedGreeting: true,
                        usedGuestContext: !!context.guestHistory
                    }
                };
            }

            // For subsequent messages, use system prompt and AI generation
            const systemPrompt = this.generateSystemPrompt(context);

            // Generate response using BaseAgent's generateResponse method
            const response = await this.generateResponse(
                `${systemPrompt}\n\nUser: ${message}`,
                {
                    model: 'sonnet',
                    context: 'sofia-conversation',
                    maxTokens: 1000,
                    temperature: 0.7
                }
            );

            const processingTime = Date.now() - startTime;

            return {
                content: response,
                metadata: {
                    processedAt: new Date().toISOString(),
                    agentType: this.name,
                    confidence: 0.9,
                    processingTimeMs: processingTime,
                    modelUsed: 'sonnet',
                    usedGuestContext: !!context.guestHistory
                }
            };

        } catch (error) {
            return this.handleAgentError(error as Error, 'handleMessage', message);
        }
    }

    /**
     * 🎯 ENHANCED: Generate intelligent personalized greeting with immediate context usage
     * This is the key method that enables the "Эрик recognition" scenario
     */
    async generateIntelligentPersonalizedGreeting(context: AgentContext): Promise<string> {
        const { guestHistory, language, conversationContext } = context;
        const dateContext = this.getCurrentRestaurantContext();

        // Handle subsequent bookings differently
        if (conversationContext?.isSubsequentBooking) {
            return await this.generateSubsequentBookingGreeting(guestHistory, language);
        }

        // 🎯 NEW GUEST - Standard greeting
        if (!guestHistory || guestHistory.total_bookings === 0) {
            return this.getNewGuestGreeting(language);
        }

        // 🎯 RETURNING GUEST - Intelligent context-aware greeting
        return this.getIntelligentReturningGuestGreeting(guestHistory, language);
    }

    /**
     * 🎯 NEW: Get intelligent greeting for returning guests with immediate context usage
     */
    private getIntelligentReturningGuestGreeting(guestHistory: GuestHistory, language: Language): string {
        const { guest_name, guest_phone, total_bookings, common_party_size } = guestHistory;
        const isRegularGuest = total_bookings >= 3;

        // 🎯 KEY ENHANCEMENT: Immediately offer to use known details and ask for missing info
        if (isRegularGuest) {
            const greetings = {
                en: `Hi ${guest_name}! Great to see you again! I can use your usual details (${guest_phone})${common_party_size ? ` for ${common_party_size} people` : ''}. What date and time work for you?`,
                ru: `Привет, ${guest_name}! Рад снова видеть! Могу использовать ваши обычные данные (${guest_phone})${common_party_size ? ` на ${common_party_size} человек` : ''}. На какую дату и время нужен столик?`,
                sr: `Zdravo, ${guest_name}! Drago mi je što vas ponovo vidim! Mogu da koristim vaše uobičajene podatke (${guest_phone})${common_party_size ? ` za ${common_party_size} osoba` : ''}. Koji datum i vreme vam odgovara?`,
                hu: `Szia, ${guest_name}! Örülök, hogy újra látlak! Használhatom a szokásos adataidat (${guest_phone})${common_party_size ? ` ${common_party_size} főre` : ''}. Milyen dátumra és időpontra gondoltál?`,
                de: `Hallo, ${guest_name}! Schön, Sie wiederzusehen! Ich kann Ihre üblichen Daten verwenden (${guest_phone})${common_party_size ? ` für ${common_party_size} Personen` : ''}. Welches Datum und welche Uhrzeit passen Ihnen?`,
                fr: `Salut, ${guest_name}! Ravi de vous revoir! Je peux utiliser vos informations habituelles (${guest_phone})${common_party_size ? ` pour ${common_party_size} personnes` : ''}. Quelle date et quelle heure vous conviennent?`,
                es: `¡Hola, ${guest_name}! ¡Me alegra verte de nuevo! Puedo usar tus datos habituales (${guest_phone})${common_party_size ? ` para ${common_party_size} personas` : ''}. ¿Qué fecha y hora te van bien?`,
                it: `Ciao, ${guest_name}! Bello rivederti! Posso usare i tuoi dati abituali (${guest_phone})${common_party_size ? ` per ${common_party_size} persone` : ''}. Che data e ora preferisci?`,
                pt: `Oi, ${guest_name}! Bom te ver de novo! Posso usar seus dados habituais (${guest_phone})${common_party_size ? ` para ${common_party_size} pessoas` : ''}. Que data e horário funcionam para você?`,
                nl: `Hoi, ${guest_name}! Leuk om je weer te zien! Ik kan je gebruikelijke gegevens gebruiken (${guest_phone})${common_party_size ? ` voor ${common_party_size} personen` : ''}. Welke datum en tijd passen jou?`,
                auto: `Hi ${guest_name}! Great to see you again! I can use your usual details (${guest_phone})${common_party_size ? ` for ${common_party_size} people` : ''}. What date and time work for you?`
            };
            return greetings[language] || greetings.auto;
        } else {
            const greetings = {
                en: `Hello, ${guest_name}! Nice to see you again! I can use your details (${guest_phone}). What date and time would you like?`,
                ru: `Здравствуйте, ${guest_name}! Приятно вас снова видеть! Могу использовать ваши данные (${guest_phone}). На какую дату и время?`,
                sr: `Zdravo, ${guest_name}! Drago mi je što vas ponovo vidim! Mogu da koristim vaše podatke (${guest_phone}). Koji datum i vreme želite?`,
                hu: `Szia, ${guest_name}! Örülök, hogy újra látlak! Használhatom az adataidat (${guest_phone}). Milyen dátumra és időpontra?`,
                de: `Hallo, ${guest_name}! Schön, Sie wiederzusehen! Ich kann Ihre Daten verwenden (${guest_phone}). Welches Datum und welche Uhrzeit?`,
                fr: `Bonjour, ${guest_name}! Content de vous revoir! Je peux utiliser vos informations (${guest_phone}). Quelle date et quelle heure?`,
                es: `¡Hola, ${guest_name}! ¡Me alegra verte de nuevo! Puedo usar tus datos (${guest_phone}). ¿Qué fecha y hora?`,
                it: `Ciao, ${guest_name}! Bello rivederti! Posso usare i tuoi dati (${guest_phone}). Che data e ora?`,
                pt: `Olá, ${guest_name}! Bom te ver de novo! Posso usar seus dados (${guest_phone}). Que data e horário?`,
                nl: `Hallo, ${guest_name}! Leuk om je weer te zien! Ik kan je gegevens gebruiken (${guest_phone}). Welke datum en tijd?`,
                auto: `Hello, ${guest_name}! Nice to see you again! I can use your details (${guest_phone}). What date and time would you like?`
            };
            return greetings[language] || greetings.auto;
        }
    }

    /**
     * 🎯 NEW: Get greeting for new guests
     */
    private getNewGuestGreeting(language: Language): string {
        const greetings = {
            en: `Hello! I'd love to help you with a reservation today. What date and time work for you, and how many guests?`,
            ru: `Здравствуйте! Буду рада помочь вам с бронированием. На какую дату и время, и на сколько человек?`,
            sr: `Zdravo! Rado ću vam pomoći sa rezervacijom danas. Koji datum i vreme vam odgovara, i koliko osoba?`,
            hu: `Szia! Szívesen segítek a mai foglalással. Milyen dátumra és időpontra, és hány főre?`,
            de: `Hallo! Ich helfe Ihnen gerne bei einer Reservierung heute. Welches Datum und welche Uhrzeit passen Ihnen, und für wie viele Gäste?`,
            fr: `Bonjour! Je serais ravi de vous aider avec une réservation aujourd'hui. Quelle date et quelle heure vous conviennent, et pour combien de personnes?`,
            es: `¡Hola! Me encantaría ayudarte con una reserva hoy. ¿Qué fecha y hora te van bien, y para cuántas personas?`,
            it: `Ciao! Mi piacerebbe aiutarti con una prenotazione oggi. Che data e ora ti vanno bene, e per quante persone?`,
            pt: `Olá! Adoraria ajudá-lo com uma reserva hoje. Que data e horário funcionam para você, e para quantas pessoas?`,
            nl: `Hallo! Ik help je graag met een reservering vandaag. Welke datum en tijd passen jou, en voor hoeveel personen?`,
            auto: `Hello! I'd love to help you with a reservation today. What date and time work for you, and how many guests?`
        };
        return greetings[language] || greetings.auto;
    }

    /**
     * Generate subsequent booking greeting
     */
    private async generateSubsequentBookingGreeting(guestHistory: GuestHistory | null, language: Language): Promise<string> {
        if (!guestHistory || guestHistory.total_bookings === 0) {
            const subsequentGreetings = {
                en: `Perfect! I can help you with another reservation. What date and time would you like?`,
                ru: `Отлично! Помогу вам с ещё одной бронью. На какую дату и время?`,
                sr: `Odlično! Mogu da vam pomognem sa još jednom rezervacijom. Koji datum i vreme želite?`,
                hu: `Tökéletes! Segíthetek egy másik foglalással. Milyen dátumra és időpontra?`,
                de: `Perfekt! Ich kann Ihnen bei einer weiteren Reservierung helfen. Welches Datum und welche Uhrzeit hätten Sie gern?`,
                fr: `Parfait! Je peux vous aider avec une autre réservation. Quelle date et quelle heure souhaitez-vous?`,
                es: `¡Perfecto! Puedo ayudarte con otra reserva. ¿Qué fecha y hora te gustaría?`,
                it: `Perfetto! Posso aiutarti con un'altra prenotazione. Che data e ora vorresti?`,
                pt: `Perfeito! Posso ajudá-lo com outra reserva. Que data e hora gostaria?`,
                nl: `Perfect! Ik kan je helpen met nog een reservering. Welke datum en tijd zou je willen?`,
                auto: `Perfect! I can help you with another reservation. What date and time would you like?`
            };
            return subsequentGreetings[language] || subsequentGreetings.en;
        } else {
            const subsequentGreetings = {
                en: `Of course! I'd be happy to help with another reservation. When would you like to dine again?`,
                ru: `Конечно! Буду рада помочь с ещё одной бронью. Когда хотели бы снова поужинать?`,
                sr: `Naravno! Rado ću vam pomoći sa još jednom rezervacijom. Kada biste želeli da večerate ponovo?`,
                hu: `Természetesen! Szívesen segítek egy másik foglalással. Mikor szeretnél újra vacsorázni?`,
                de: `Natürlich! Gerne helfe ich Ihnen bei einer weiteren Reservierung. Wann möchten Sie wieder speisen?`,
                fr: `Bien sûr! Je serais ravie de vous aider avec une autre réservation. Quand aimeriez-vous dîner à nouveau?`,
                es: `¡Por supuesto! Estaré encantada de ayudarte con otra reserva. ¿Cuándo te gustaría cenar de nuevo?`,
                it: `Certo! Sarò felice di aiutarti con un'altra prenotazione. Quando vorresti cenare di nuovo?`,
                pt: `Claro! Ficaria feliz em ajudar com outra reserva. Quando gostaria de jantar novamente?`,
                nl: `Natuurlijk! Ik help je graag met nog een reservering. Wanneer zou je weer willen dineren?`,
                auto: `Of course! I'd be happy to help with another reservation. When would you like to dine again?`
            };
            return subsequentGreetings[language] || subsequentGreetings.en;
        }
    }

    /**
     * Get tools for Sofia agent
     */
    getTools() {
        return agentTools.filter(tool =>
            this.capabilities.includes(tool.function.name)
        );
    }

    /**
     * Check if booking information is complete
     */
    private hasCompleteBookingInfo(context: AgentContext): boolean {
        const info = context.conversationContext?.gatheringInfo;
        if (!info) return false;

        return !!(info.date && info.time && info.guests && info.name && info.phone);
    }

    /**
     * Get current restaurant context
     */
    private getCurrentRestaurantContext() {
        try {
            const now = DateTime.now().setZone(this.restaurantConfig.timezone);
            const today = now.toISODate();
            const tomorrow = now.plus({ days: 1 }).toISODate();
            const currentTime = now.toFormat('HH:mm');
            const dayOfWeek = now.toFormat('cccc');

            return {
                currentDate: today,
                tomorrowDate: tomorrow,
                currentTime: currentTime,
                dayOfWeek: dayOfWeek,
                timezone: this.restaurantConfig.timezone
            };
        } catch (error) {
            console.error(`[SofiaAgent] Error getting restaurant time context:`, error);
            const now = DateTime.now();
            return {
                currentDate: now.toISODate(),
                tomorrowDate: now.plus({ days: 1 }).toISODate(),
                currentTime: now.toFormat('HH:mm'),
                dayOfWeek: now.toFormat('cccc'),
                timezone: 'UTC'
            };
        }
    }

    /**
     * 🔧 BOOKING SYSTEM FIX: Enhanced critical booking instructions with context-awareness
     * Issue 1: Redundant Confirmation - Added logic to detect complete information
     * Issue 3: Robotic Conversation Flow - More natural, adaptive instructions
     */
    private getCriticalBookingInstructions(conversationContext?: ConversationContext): string {
        const hasCompleteInfo = conversationContext?.gatheringInfo &&
            conversationContext.gatheringInfo.date &&
            conversationContext.gatheringInfo.time &&
            conversationContext.gatheringInfo.guests &&
            conversationContext.gatheringInfo.name &&
            conversationContext.gatheringInfo.phone;

        return `
🚨 CONTEXT-AWARE BOOKING WORKFLOW - FOLLOW EXACTLY:

🔧 **SMART INFORMATION DETECTION (HIGHEST PRIORITY):**
${hasCompleteInfo ? `
✅ **COMPLETE INFORMATION DETECTED:**
- User has provided: Date (${conversationContext?.gatheringInfo?.date}), Time (${conversationContext?.gatheringInfo?.time}), Guests (${conversationContext?.gatheringInfo?.guests}), Name (${conversationContext?.gatheringInfo?.name}), Phone (${conversationContext?.gatheringInfo?.phone})
- **DIRECT BOOKING PATH:** Acknowledge their information and proceed directly to availability check
- **EXAMPLE:** "Perfect! Let me check availability for ${conversationContext?.gatheringInfo?.guests} guests on ${conversationContext?.gatheringInfo?.date} at ${conversationContext?.gatheringInfo?.time} under the name ${conversationContext?.gatheringInfo?.name}..."
- **DO NOT** ask for information you already have
- **DO NOT** request confirmation of details already provided
` : `
⚠️ **INCOMPLETE INFORMATION - GATHER MISSING DETAILS:**
- Current gathering state: ${JSON.stringify(conversationContext?.gatheringInfo || {})}
- Ask for missing information naturally and efficiently
- Don't repeat questions about information you already have
`}

🚨 AMBIGUOUS INPUT HANDLING (CRITICAL RULE):

**RULE #1: INTERPRET COMMON TYPOS AS SPECIFIC TIMES**
- **"18-25" or "19-30"**: ALWAYS interpret as specific time (18:25, 19:30)
- **"18 25" or "19 30"**: ALWAYS interpret as specific time
- **Proceed directly to availability check with corrected time**

**RULE #2: CLARIFY TRULY AMBIGUOUS INPUT**
- **Vague ranges**: "evening", "between 7-8", "around 8"
- **Incomplete dates**: "19 июля" (missing time)
- **NEVER call tools for ambiguous input**
- **Ask for clarification with examples**

**RULE #3: CONTEXT-AWARE CONFIRMATION HANDLING**
- If you have ALL required information, proceed directly to availability check
- If you have SOME information, acknowledge what you have and ask for missing details
- If you have NO information, ask for complete details naturally

❌ **ABSOLUTELY FORBIDDEN:**
- Asking for information you already have
- Redundant confirmation requests when all details are provided
- Treating clear typos like "18-25" as ambiguous

✅ **EFFICIENT WORKFLOW PATTERNS:**
✅ Complete info provided → Acknowledge + Check availability → Create reservation
✅ Partial info provided → Acknowledge + Ask for missing details → Check availability → Create reservation  
✅ No info provided → Ask for all details → Check availability → Create reservation

STEP-BY-STEP PROCESS:
1. **SMART INFORMATION ASSESSMENT:** Determine what information you have
2. **CONTEXT-AWARE RESPONSE:** Respond appropriately based on available information
3. **EFFICIENT TOOL USAGE:** Only call tools when you have necessary information
4. **NATURAL CONFIRMATIONS:** Only confirm when genuinely needed, not redundantly

💡 HANDLING FAILED AVAILABILITY (MANDATORY WORKFLOW):
When check_availability fails and user asks for alternatives:
1. Find the TIME from your FAILED check_availability call
2. Immediately call find_alternative_times with that exact time as preferredTime
3. Present the returned options clearly
4. Never suggest times without tool confirmation

🔒 VALIDATION RULES:
- Phone numbers must have at least 7 digits
- Names must be at least 2 characters  
- Always use YYYY-MM-DD format for dates
- Always use HH:MM format for times
- Guests must be between 1-50
`;
    }

    /**
     * 🔧 BOOKING SYSTEM FIX: Smart confirmation instructions
     * Issue 1: Redundant Confirmation - Context-aware confirmation logic
     * Issue 2: Duplicate Reservation ID - Clean confirmation format
     */
    private getSmartConfirmationInstructions(conversationContext?: ConversationContext): string {
        return `
🎯 SMART CONFIRMATION SYSTEM:

**CONTEXT-AWARE CONFIRMATION RULES:**

1️⃣ **WHEN ALL INFORMATION IS PROVIDED:**
   - Acknowledge the complete information provided
   - Proceed directly to availability check
   - Example: "Perfect! Let me check availability for 4 guests on July 16th at 19:30 under the name John Smith..."

2️⃣ **WHEN PARTIAL INFORMATION IS PROVIDED:**
   - Acknowledge what you have received
   - Ask for missing information efficiently
   - Example: "Great! I have you down for 4 guests on July 16th at 19:30. I just need your name and phone number to complete the booking."

3️⃣ **AVAILABILITY CONFIRMATION RESPONSES:**
   - If you have complete info: "Excellent! Table 5 is available. Can I confirm this booking for you?"
   - If you need contact info: "Perfect! Table 5 is available for 4 guests on July 16th at 19:30. I need your name and phone number to complete the reservation."

4️⃣ **FINAL BOOKING CONFIRMATION:**
   - When create_reservation succeeds, use a single, clean confirmation
   - Format: "🎉 Your reservation is confirmed! Your confirmation number is #[reservationId]."
   - Include all booking details: date, time, guests, name
   - Do NOT duplicate the reservation number

**NATURAL CONVERSATION EXAMPLES:**

User: "Table for 4 tomorrow at 7pm, John Smith, 555-1234"
Sofia: "Perfect! Let me check availability for 4 guests tomorrow at 7pm under the name John Smith... [checks] Great! Table 8 is available. Can I confirm this booking for you?"

User: "I need a table for 4 people"  
Sofia: "I'd be happy to help! For 4 guests, what date and time work best? Also, I'll need your name and phone number for the reservation."

User: "Check availability for 2 people tonight at 8pm"
Sofia: "Let me check that for you... [checks] Perfect! Table 3 is available for 2 guests tonight at 8pm. I need your name and phone number to complete the reservation."

**CONFIRMATION EFFICIENCY RULES:**
- ✅ Acknowledge information as you receive it
- ✅ Only ask for missing information
- ✅ Use natural, flowing conversation  
- ✅ Confirm booking details before final creation
- ❌ Never ask for information you already have
- ❌ Never use redundant confirmation requests
- ❌ Never duplicate reservation numbers in confirmations
`;
    }

    /**
     * Personalized prompt section with zero-assumption special requests
     */
    private getPersonalizedPromptSection(guestHistory: GuestHistory | null, language: Language, conversationContext?: ConversationContext): string {
        if (!guestHistory || guestHistory.total_bookings === 0) {
            return '';
        }

        const { guest_name, guest_phone, total_bookings, common_party_size, frequent_special_requests, last_visit_date } = guestHistory;

        return `
👤 GUEST HISTORY & PERSONALIZATION:
- Guest Name: ${guest_name}
- Guest Phone: ${guest_phone || 'Not available'}
- Total Previous Bookings: ${total_bookings}
- ${common_party_size ? `Common Party Size: ${common_party_size}` : 'No common party size pattern'}
- ${frequent_special_requests.length > 0 ? `Frequent Requests: ${frequent_special_requests.join(', ')}` : 'No frequent special requests'}
- ${last_visit_date ? `Last Visit: ${last_visit_date}` : 'No previous visits recorded'}

💡 PERSONALIZATION GUIDELINES:
- ${total_bookings >= 3 ? `RETURNING GUEST: This is a valued returning customer! Use warm, personal language.` : `INFREQUENT GUEST: Guest has visited before but not frequently.`}
- ${common_party_size ? `USUAL PARTY SIZE: Only suggest "${common_party_size} people" if user hasn't specified AND you haven't asked about party size yet in this conversation.` : ''}
- ${conversationContext?.isSubsequentBooking ? 'This is a SUBSEQUENT booking in the same session - be concise and skip repetitive questions.' : 'This is the first booking in the session.'}
- Track what you've already asked to avoid repetition

- **SAME NAME/PHONE HANDLING**: If the guest says "my name" or "same name", use "${guest_name}" from their history. If they say "same number", "same phone", or "using same number", use "${guest_phone || 'Not available'}" from their history.

- **SPECIAL REQUESTS (ZERO-ASSUMPTION RULE):** You are STRICTLY FORBIDDEN from adding any frequent special request to a booking unless explicitly confirmed in the CURRENT conversation.
  
  **Mandatory Workflow:**
  1. After confirming contact details (as separate step)
  2. Ask naturally but specifically: "I also see you often request '${frequent_special_requests[0]}'. Add that to this booking?"
  3. Wait for explicit "yes"/"confirm" response to THIS specific question
  4. Only then add to create_reservation call
  
  **Forbidden Actions:**
  - ❌ Assuming general "yes" applies to special requests
  - ❌ Auto-adding requests based on history without current confirmation
  - ❌ Bundling contact confirmation with special request confirmation
  
  **Critical Rule:** Contact confirmation and special request confirmation are COMPLETELY SEPARATE steps.
  
  **Examples:**
  - ✅ Good: "Contact confirmed. I also see you usually request tea on arrival. Add that too?"
  - ✅ Good: "Great with contacts! By the way, add your usual window seat request?"
  - ❌ Bad: "Use same contact info and usual requests?"
  - ❌ Bad: "Everything as usual?" - too vague

- Use this information naturally in conversation - don't just list their history!
- Make the experience feel personal and welcoming for returning guests.`;
    }

    /**
     * Conversation instructions with context awareness
     */
    private getConversationInstructions(conversationContext?: ConversationContext): string {
        if (!conversationContext) return '';

        return `
📝 CONVERSATION CONTEXT AWARENESS:
- Session Turn: ${conversationContext.sessionTurnCount || 1}
- Booking Number: ${conversationContext.bookingNumber || 1} ${conversationContext.isSubsequentBooking ? '(SUBSEQUENT)' : '(FIRST)'}
- Asked Party Size: ${conversationContext.hasAskedPartySize ? 'YES - DO NOT ASK AGAIN' : 'NO - CAN ASK IF NEEDED'}
- Asked Date: ${conversationContext.hasAskedDate ? 'YES - DO NOT ASK AGAIN' : 'NO - CAN ASK IF NEEDED'}
- Asked Time: ${conversationContext.hasAskedTime ? 'YES - DO NOT ASK AGAIN' : 'NO - CAN ASK IF NEEDED'}
- Asked Name: ${conversationContext.hasAskedName ? 'YES - DO NOT ASK AGAIN' : 'NO - CAN ASK IF NEEDED'}
- Asked Phone: ${conversationContext.hasAskedPhone ? 'YES - DO NOT ASK AGAIN' : 'NO - CAN ASK IF NEEDED'}

🎯 CONTEXT-DRIVEN BEHAVIOR:
${conversationContext.isSubsequentBooking ?
                '- SUBSEQUENT BOOKING: Be concise, skip redundant questions, focus on the new booking details.' :
                '- FIRST BOOKING: Full greeting and standard workflow.'
            }

⚠️ CRITICAL CONVERSATION RULES:
- If you have already asked about party size (${conversationContext.hasAskedPartySize ? 'YES' : 'NO'}), do NOT ask again
- If you have already asked about date (${conversationContext.hasAskedDate ? 'YES' : 'NO'}), do NOT ask again
- If you have already asked about time (${conversationContext.hasAskedTime ? 'YES' : 'NO'}), do NOT ask again
- If you have already asked about name (${conversationContext.hasAskedName ? 'YES' : 'NO'}), do NOT ask again
- If you have already asked about phone (${conversationContext.hasAskedPhone ? 'YES' : 'NO'}), do NOT ask again

✅ EFFICIENT CONVERSATION FLOW:
- Acknowledge information already provided
- Only ask for missing information
- Use natural, flowing conversation patterns
- Avoid repetitive questions at all costs
`;
    }

    /**
     * Smart party question generation that prevents repetition
     */
    generateSmartPartyQuestion(
        language: Language,
        hasAskedPartySize: boolean,
        isSubsequentBooking: boolean,
        commonPartySize?: number | null,
        conversationContext?: ConversationContext
    ): string {
        if (hasAskedPartySize || conversationContext?.hasAskedPartySize) {
            const directQuestions = {
                en: `How many guests?`,
                ru: `Сколько человек?`,
                sr: `Koliko osoba?`,
                hu: `Hány fő?`,
                de: `Wie viele Personen?`,
                fr: `Combien de personnes?`,
                es: `¿Cuántas personas?`,
                it: `Quante persone?`,
                pt: `Quantas pessoas?`,
                nl: `Hoeveel personen?`,
                auto: `How many guests?`
            };
            return directQuestions[language] || directQuestions.en;
        }

        if (isSubsequentBooking) {
            const directQuestions = {
                en: `How many guests this time?`,
                ru: `Сколько человек на этот раз?`,
                sr: `Koliko osoba ovaj put?`,
                hu: `Hány fő ezúttal?`,
                de: `Wie viele Personen diesmal?`,
                fr: `Combien de personnes cette fois?`,
                es: `¿Cuántas personas esta vez?`,
                it: `Quante persone questa volta?`,
                pt: `Quantas pessoas desta vez?`,
                nl: `Hoeveel personen deze keer?`,
                auto: `How many guests this time?`
            };
            return directQuestions[language] || directQuestions.en;
        } else if (commonPartySize) {
            const suggestiveQuestions = {
                en: `How many people will be joining you? (Usually ${commonPartySize} for you)`,
                ru: `Сколько человек будет? (Обычно у вас ${commonPartySize})`,
                sr: `Koliko osoba će biti? (Obično ${commonPartySize} kod vas)`,
                hu: `Hányan lesztek? (Általában ${commonPartySize} fő nálad)`,
                de: `Wie viele Personen werden dabei sein? (Normalerweise ${commonPartySize} bei Ihnen)`,
                fr: `Combien de personnes seront présentes? (Habituellement ${commonPartySize} pour vous)`,
                es: `¿Cuántas personas serán? (Normalmente ${commonPartySize} para ti)`,
                it: `Quante persone saranno? (Di solito ${commonPartySize} per te)`,
                pt: `Quantas pessoas serão? (Normalmente ${commonPartySize} para você)`,
                nl: `Hoeveel personen worden het? (Gewoonlijk ${commonPartySize} voor jou)`,
                auto: `How many people will be joining you? (Usually ${commonPartySize} for you)`
            };
            return suggestiveQuestions[language] || suggestiveQuestions.en;
        } else {
            const standardQuestions = {
                en: `How many guests will be joining you?`,
                ru: `Сколько гостей будет с вами?`,
                sr: `Koliko gostiju će biti sa vama?`,
                hu: `Hány vendég lesz veled?`,
                de: `Wie viele Gäste werden Sie begleiten?`,
                fr: `Combien d'invités vous accompagneront?`,
                es: `¿Cuántos invitados te acompañarán?`,
                it: `Quanti ospiti ti accompagneranno?`,
                pt: `Quantos convidados o acompanharão?`,
                nl: `Hoeveel gasten gaan met je mee?`,
                auto: `How many guests will be joining you?`
            };
            return standardQuestions[language] || standardQuestions.en;
        }
    }

    /**
     * Generate personalized greeting with context awareness (legacy method for compatibility)
     */
    async generatePersonalizedGreeting(context: AgentContext): Promise<string> {
        return await this.generateIntelligentPersonalizedGreeting(context);
    }

    /**
     * Get restaurant language
     */
    getRestaurantLanguage(): Language {
        if (this.restaurantConfig.languages && this.restaurantConfig.languages.length > 0) {
            return this.restaurantConfig.languages[0] as Language;
        }

        const country = this.restaurantConfig.country?.toLowerCase();
        if (country === 'russia' || country === 'russian federation') return 'ru';
        if (country === 'serbia' || country === 'republic of serbia') return 'sr';
        if (country === 'hungary') return 'hu';
        if (country === 'germany') return 'de';
        if (country === 'france') return 'fr';
        if (country === 'spain') return 'es';
        if (country === 'italy') return 'it';
        if (country === 'portugal') return 'pt';
        if (country === 'netherlands') return 'nl';

        return 'en';
    }

    /**
     * Update instructions method for compatibility
     */
    updateInstructions(context: string, language: Language, guestHistory?: GuestHistory | null, isFirstMessage?: boolean, conversationContext?: ConversationContext): string {
        return this.generateSystemPrompt({
            restaurantId: this.restaurantConfig.id,
            timezone: this.restaurantConfig.timezone,
            language,
            guestHistory,
            conversationContext
        });
    }

    /**
     * Personalized greeting method for compatibility
     */
    getPersonalizedGreeting(guestHistory: GuestHistory | null, language: Language, context: 'hostess' | 'guest', conversationContext?: ConversationContext): string {
        if (!guestHistory || guestHistory.total_bookings === 0) {
            return `Hello! I'd love to help you with a reservation today. What date and time work for you, and how many guests?`;
        }

        const { guest_name, guest_phone, total_bookings, common_party_size } = guestHistory;
        const isRegularGuest = total_bookings >= 3;

        if (isRegularGuest) {
            return `Hi ${guest_name}! Great to see you again! I can use your usual details (${guest_phone})${common_party_size ? ` for ${common_party_size} people` : ''}. What date and time work for you?`;
        } else {
            return `Hello, ${guest_name}! Nice to see you again! I can use your details (${guest_phone}). What date and time would you like?`;
        }
    }
}

export default SofiaAgent;

// Log successful initialization
console.log(`
🎉 Sofia Agent with Intelligent Context Usage Loaded! 🎉

🎯 UX ENHANCEMENTS IMPLEMENTED:
✅ Issue 1: Guest History Not Being Used Intelligently - SOLVED
   - Immediate guest recognition: "Hi Эрик! Great to see you again!"
   - Proactive context usage: "I can use your usual details (89011231223)"
   - Smart information gathering: Only asks for missing information

✅ Issue 3: Robotic Conversation Flow Persists - SOLVED
   - Natural, context-aware conversation patterns
   - Intelligent greeting generation based on guest history
   - Efficient workflow that acknowledges returning guests

🔧 BOOKING SYSTEM FIXES MAINTAINED:
✅ Issue 1: Redundant Confirmation - Context-aware logic
✅ Issue 2: Duplicate Reservation ID - Clean confirmations  
✅ Issue 3: Robotic Conversation Flow - Natural patterns

🏗️ ENHANCED FEATURES:
- Intelligent guest recognition and context usage
- Context-aware greeting generation
- Smart information acknowledgment and gathering
- Natural conversation flow adaptation
- Proactive use of guest history information

🤖 Ready for the "Эрик Recognition" Scenario!

Example Flow:
User: "привет можно стол забронировать"
Sofia: "Привет, Эрик! Рад снова видеть! Могу использовать ваши обычные данные (89011231223). На какую дату и время нужен столик?"
`);
