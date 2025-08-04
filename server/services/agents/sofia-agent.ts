// src/agents/sofia-agent.ts


import { BaseAgent, AgentContext, AgentResponse, AgentConfig, RestaurantConfig } from './base-agent';
import { agentTools } from './agent-tools';
import { DateTime } from 'luxon';
import { 
    getRestaurantDateTime, 
    getRestaurantTimeContext,
    isRestaurantOpen,
    getRestaurantOperatingStatus,
    formatRestaurantTime24Hour,
    isValidTimezone,
    isOvernightOperation
} from '../../utils/timezone-utils';
import type { Language } from '../enhanced-conversation-manager';

/**
 * 🔧 ENHANCED: Guest history interface with comprehensive tracking
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
 * 🚨 CRITICAL BUG #4 FIX: Enhanced pending confirmation state with circular reference prevention
 */
interface PendingConfirmation {
    type: 'name_clarification';
    dbName: string;
    requestName: string;
    originalBookingData: {
        guestName: string;
        guestPhone: string;
        date: string;
        time: string;
        guests: number;
        specialRequests?: string;
    };
    // 🚨 CRITICAL BUG #4 FIX: Store only essential context, not full session object
    originalContext: {
        restaurantId: number;
        timezone: string;
        sessionId: string;
        language: string;
        // 🚨 CRITICAL: DO NOT include session, restaurantConfig, or other complex objects
        // that could create circular references during Redis serialization
    };
    // 🆕 CRITICAL: Add attempt tracking to prevent infinite loops
    attempts: number;
    maxAttempts: number;
    createdAt: Date;
    lastAttemptAt?: Date;
}

/**
 * 🔧 ENHANCED: Conversation context with comprehensive state tracking
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
    pendingConfirmation?: PendingConfirmation;
}

/**
 * 🆕 CRITICAL FIX: Name choice extraction patterns for different languages
 */
interface NameExtractionPattern {
    language: string;
    patterns: {
        directChoice: RegExp[];
        usePatterns: RegExp[];
        yesNoPatterns: {
            yes: RegExp[];
            no: RegExp[];
        };
        contextualPatterns: RegExp[];
    };
}

export class SofiaAgent extends BaseAgent {
    readonly name = 'Sofia';
    readonly description = 'Production-ready booking specialist with critical bug fixes applied';
    readonly capabilities = [
        'check_availability',
        'find_alternative_times', 
        'create_reservation',
        'get_restaurant_info',
        'get_guest_history'
    ];

    // 🆕 CRITICAL FIX: Maximum clarification attempts to prevent infinite loops
    private readonly MAX_CLARIFICATION_ATTEMPTS = 3;
    private readonly CLARIFICATION_TIMEOUT_MINUTES = 5;

    // 🆕 CRITICAL FIX: Comprehensive multi-language name extraction patterns
    private readonly nameExtractionPatterns: NameExtractionPattern[] = [
        {
            language: 'en',
            patterns: {
                directChoice: [
                    /^(.+)$/i, // Any direct name input
                ],
                usePatterns: [
                    /(?:use|go\s+with|choose|select|pick)\s+(.+)/gi,
                    /(?:i\s+want|i'd\s+like|prefer)\s+(.+)/gi,
                    /(.+)\s+(?:please|thanks)/gi,
                ],
                yesNoPatterns: {
                    yes: [/^(?:yes|yeah|yep|ok|okay|sure|correct|right|good)$/gi],
                    no: [/^(?:no|nope|wrong|incorrect|not\s+right)$/gi]
                },
                contextualPatterns: [
                    /(?:the\s+)?(?:first|second|1st|2nd)\s+(?:one|name|option)/gi,
                    /(?:name\s+)?(?:number|option)\s+(\d+)/gi,
                ]
            }
        },
        {
            language: 'ru',
            patterns: {
                directChoice: [
                    /^(.+)$/i,
                ],
                usePatterns: [
                    /(?:использ\w+|выбер\w+|хочу|предпочит\w+)\s+(.+)/gi,
                    /(.+)\s+(?:пожалуйста|спасибо)/gi,
                ],
                yesNoPatterns: {
                    yes: [/^(?:да|ага|хорошо|отлично|правильно|верно)$/gi],
                    no: [/^(?:нет|неправильно|неверно|не\s+то)$/gi]
                },
                contextualPatterns: [
                    /(?:перв\w+|втор\w+|1-?\w*|2-?\w*)\s*(?:вариант|имя|опци\w+)/gi,
                    /(?:имя\s+)?(?:номер|вариант)\s+(\d+)/gi,
                ]
            }
        },
        {
            language: 'sr',
            patterns: {
                directChoice: [
                    /^(.+)$/i,
                ],
                usePatterns: [
                    /(?:korist\w+|izaber\w+|želim|preferiram)\s+(.+)/gi,
                    /(.+)\s+(?:molim|hvala)/gi,
                ],
                yesNoPatterns: {
                    yes: [/^(?:da|dobro|odlično|tačno|ispravno)$/gi],
                    no: [/^(?:ne|netačno|pogrešno|nije\s+to)$/gi]
                },
                contextualPatterns: [
                    /(?:prv\w+|drug\w+|1\.?|2\.?)\s*(?:opcij\w+|ime|varijant\w+)/gi,
                    /(?:ime\s+)?(?:broj|opcija)\s+(\d+)/gi,
                ]
            }
        }
    ];

    constructor(config: AgentConfig, restaurantConfig: RestaurantConfig) {
        super(config, restaurantConfig);
        this.logAgentAction('Sofia Agent initialized - production-ready with critical bug fixes applied');
    }

    /**
     * 🚨 CRITICAL FIX: Language enforcement rules for Sofia Agent
     */
    private getLanguageEnforcementRules(language: Language): string {
        const languageNames: Record<Language, string> = {
            'en': 'English', 'ru': 'Russian', 'sr': 'Serbian', 'hu': 'Hungarian',
            'de': 'German', 'fr': 'French', 'es': 'Spanish', 'it': 'Italian',
            'pt': 'Portuguese', 'nl': 'Dutch', 'auto': 'English'
        };

        const currentLanguageName = languageNames[language] || 'English';
        
        return `🚨 CRITICAL SOFIA LANGUAGE ENFORCEMENT RULES:

**MANDATORY LANGUAGE**: You MUST respond ONLY in ${currentLanguageName}.

**FORBIDDEN ACTIONS**:
❌ NEVER switch languages mid-response
❌ NEVER mix languages in a single response  
❌ NEVER respond in English if conversation language is ${currentLanguageName}
❌ NEVER change language without explicit user request

**REQUIRED BEHAVIOR**:
✅ ALL responses must be in ${currentLanguageName}
✅ Maintain warm, professional tone in ${currentLanguageName}
✅ Use natural, fluent ${currentLanguageName} expressions
✅ If unsure about translation, stay in ${currentLanguageName}

**LANGUAGE CONSISTENCY CHECK**:
Before sending any response, verify it's entirely in ${currentLanguageName}.
If you detect any English words or other languages, rewrite completely in ${currentLanguageName}.

**BOOKING CONVERSATION EXAMPLES IN ${currentLanguageName}**:
${this.getBookingExamples(language)}

Current conversation language: **${currentLanguageName}** (LOCKED)`;
    }

    /**
     * 🚨 CRITICAL FIX: Language-specific booking conversation examples
     */
    private getBookingExamples(language: Language): string {
        const examples: Record<Language, string> = {
            'en': `- "I'd love to help you with a reservation! What date and time work for you?"
- "Perfect! I have availability at 7:30 PM. How many guests will be joining you?"
- "🎉 Wonderful! Your table is reserved for tonight at 8:00 PM for 4 guests."`,
            'ru': `- "Буду рада помочь с бронированием! Какие дата и время вам подходят?"
- "Отлично! Есть место в 19:30. Сколько гостей будет?"
- "🎉 Замечательно! Ваш столик забронирован на сегодня в 20:00 на 4 человека."`,
            'sr': `- "Rado ću pomoći sa rezervacijom! Koji datum i vreme vam odgovaraju?"
- "Odlično! Imamo slobodno u 19:30. Koliko gostiju će biti?"
- "🎉 Sjajno! Vaš sto je rezervisan za večeras u 20:00 za 4 osobe."`,
            'hu': `- "Szívesen segítek az asztalfoglalásban! Milyen dátum és időpont lenne megfelelő?"
- "Tökéletes! Van szabad hely 19:30-kor. Hány vendég lesz?"
- "🎉 Remek! Az asztal le van foglalva ma estére 20:00-ra 4 főre."`,
            'de': `- "Ich helfe gerne bei der Reservierung! Welches Datum und welche Uhrzeit passen Ihnen?"
- "Perfekt! Wir haben um 19:30 Uhr frei. Wie viele Gäste werden es sein?"
- "🎉 Wunderbar! Ihr Tisch ist für heute Abend um 20:00 Uhr für 4 Personen reserviert."`,
            'fr': `- "Je serais ravie de vous aider avec une réservation! Quels date et heure vous conviennent?"
- "Parfait! Nous avons de la place à 19h30. Combien de convives serez-vous?"
- "🎉 Magnifique! Votre table est réservée ce soir à 20h00 pour 4 personnes."`,
            'es': `- "¡Estaré encantada de ayudarle con una reserva! ¿Qué fecha y hora le convienen?"
- "¡Perfecto! Tenemos disponibilidad a las 19:30. ¿Cuántos comensales serán?"
- "🎉 ¡Maravilloso! Su mesa está reservada para esta noche a las 20:00 para 4 personas."`,
            'it': `- "Sarei felice di aiutarla con una prenotazione! Che data e orario le vanno bene?"
- "Perfetto! Abbiamo disponibilità alle 19:30. Quanti ospiti sarete?"
- "🎉 Meraviglioso! Il suo tavolo è prenotato per stasera alle 20:00 per 4 persone."`,
            'pt': `- "Ficaria feliz em ajudá-lo com uma reserva! Que data e horário funcionam para você?"
- "Perfeito! Temos disponibilidade às 19h30. Quantos convidados serão?"
- "🎉 Maravilhoso! Sua mesa está reservada para hoje à noite às 20h00 para 4 pessoas."`,
            'nl': `- "Ik help u graag met een reservering! Welke datum en tijd passen u?"
- "Perfect! We hebben plaats om 19:30. Met hoeveel gasten komt u?"
- "🎉 Geweldig! Uw tafel is gereserveerd voor vanavond om 20:00 voor 4 personen."`,
            'auto': `- "I'd love to help you with a reservation! What date and time work for you?"
- "Perfect! I have availability at 7:30 PM. How many guests will be joining you?"
- "🎉 Wonderful! Your table is reserved for tonight at 8:00 PM for 4 guests."`
        };

        return examples[language] || examples['en'];
    }

    /**
     * 🔧 STREAMLINED: System prompt optimized for conversation flow
     * 🚨 ENHANCED: Added explicit date parsing rules to prevent 2023 assumptions (BUG-00184 FIX)
     * 🔧 CRITICAL FIX: Final booking command moved to the very end to prevent date hallucination
     * 🚨 BUG #3 FIX: Added strict availability check validation rules
     */
    generateSystemPrompt(context: AgentContext): string {
        const { language, guestHistory, conversationContext } = context;

        // 🔒 CRITICAL: Add language enforcement at the very beginning
        const languageEnforcement = this.getLanguageEnforcementRules(language);

        const dateContext = this.getRestaurantContext();
        const personalizedSection = this.getPersonalizedSection(guestHistory, language);
        const conversationInstructions = this.getConversationInstructions(conversationContext);
        const nameInstructions = this.getNameClarificationInstructions(conversationContext);
        const businessHoursInstructions = this.getBusinessHoursInstructions();
        
        // 🚨 BUG #3 FIX: Add strict availability check validation rules
        const availabilityValidationRules = this.getAvailabilityValidationRules();

        // 🚨 CRITICAL HALLUCINATION FIX LOGIC (MOVED TO THE END)
        let finalBookingCommand = '';
        if (context.conversationContext?.gatheringInfo) {
            const { name, phone, date, time, guests } = context.conversationContext.gatheringInfo;
            if (name && phone && date && time && guests) {
                finalBookingCommand = `
🚨 FINAL BOOKING INSTRUCTIONS - EXECUTE NOW 🚨

**ALL necessary information has been gathered and validated. Your ONLY task is to finalize the booking.**

**CONFIRMED DETAILS:**
- Guest Name: ${name}
- Guest Phone: ${phone}
- Date: ${date}
- Time: ${time}
- Guests: ${guests}

**MANDATORY ACTION:**
- You MUST call the 'create_reservation' tool using EXACTLY the details listed above.
- 🚷 FORBIDDEN: DO NOT change any details.
- 🚷 FORBIDDEN: DO NOT ask for more information.
- 🚷 FORBIDDEN: DO NOT respond with text. Call the tool immediately.
`;
            }
        }
        let preProcessedDataInstructions = '';
        const { date, time } = context.conversationContext?.gatheringInfo || {};

        // 1. Check if our normalization step has already run and provided clean data.
        if (date || time) {
            let instructions = `
    🚨 CRITICAL PRE-PROCESSED DATA:
    Your task is to accept the following pre-validated information as correct. DO NOT change or re-interpret it.
    `;

            if (date) {
                instructions += `\n    - The date for this booking is confirmed as: ${date}`;
            }
            if (time) {
                instructions += `\n    - The time for this booking is confirmed as: ${time}`;
            }

            instructions += `
    - Your ONLY job now is to gather the REMAINING information.
    `;
            preProcessedDataInstructions = instructions;
        }
        return `${languageEnforcement}

You are Sofia, the friendly booking specialist for ${this.restaurantConfig.name}.

${preProcessedDataInstructions}

🎯 YOUR ROLE: Expert Conversation Specialist
Create smooth, efficient booking experiences by using context intelligently and maintaining natural flow.

⚡️ IMMEDIATE ACTION PROTOCOL (MANDATORY):
- Your primary goal is to use tools. A text response when a tool call is possible is a FAILURE.
- If you have enough information for a tool (e.g., date, time, guests for check_availability), you MUST call that tool IMMEDIATELY.
- FORBIDDEN: Do not say "Okay, I will check...". This is a failure. Call the tool directly.
- ONLY ask questions if information is missing. Responding with a question when you could have used a tool is a FAILURE.

🏪 RESTAURANT DETAILS:
- Name: ${this.restaurantConfig.name}
- Cuisine: ${this.restaurantConfig.cuisine || 'Excellent dining'}
- Hours: ${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime}
- Timezone: ${this.restaurantConfig.timezone}
${isOvernightOperation(this.restaurantConfig.openingTime || '09:00', this.restaurantConfig.closingTime || '23:00') ?
                '- ⚠️ OVERNIGHT OPERATION: Open past midnight' : ''}

📅 CURRENT CONTEXT (CRITICAL FOR DATE PARSING):
- TODAY: ${dateContext.currentDate} (${dateContext.dayOfWeek})
- TOMORROW: ${dateContext.tomorrowDate}
- Current time: ${dateContext.currentTime}
- Restaurant status: ${dateContext.isOpen ? 'OPEN 🟢' : 'CLOSED 🔴'}

🕐 CURRENT TIME BOOKING RULES:
- If user requests "now" or current time (${dateContext.currentTime}), validate against operating hours
- If restaurant closes soon, inform guest of closing time
- If restaurant is closed, suggest next available time
- Always be transparent about current time constraints

🚨 CRITICAL DATE PARSING RULES (PREVENTS 2023 BUG):
- CURRENT YEAR: ${dateContext.currentYear}
- NEXT YEAR: ${dateContext.nextYear}

**MANDATORY YEAR ASSUMPTIONS:**
1. "3 августа" → ALWAYS assume ${dateContext.currentYear}-08-03
2. "January 15" → Use ${dateContext.currentYear}-01-15 (or ${dateContext.nextYear} if passed)
3. "tomorrow" → Use exact date ${dateContext.tomorrowDate}
4. NEVER EVER assume year 2023 or any year before ${dateContext.currentYear}
5. If user says explicit year (e.g., "3 августа 2024"), respect it but validate if reasonable

**DATE VALIDATION:**
- All dates must be ${dateContext.currentYear} or later
- If a date seems to be in the past, use next occurrence (next year)
- Current restaurant timezone: ${dateContext.timezone}

${availabilityValidationRules}

🔧 SYSTEM INTEGRATION:
✅ Context Manager handles reservation resolution (RACE CONDITION FIXED)
✅ Enhanced conversation manager handles extraction and validation
✅ Smart logging provides comprehensive debugging capabilities
✅ Date context provides explicit year information (BUG-00184 FIXED)
✅ Availability validation prevents premature tool calls (BUG #3 FIXED)
✅ Circular reference prevention in confirmations (BUG #4 FIXED)

${nameInstructions}

${conversationInstructions}

${personalizedSection}

${businessHoursInstructions}

🔧 TOOL RESPONSE UNDERSTANDING:
All tools return standardized responses with:
- tool_status: 'SUCCESS' | 'FAILURE'
- data: (success) actual result with reservation details
- error: (failure) categorized error with recovery suggestions
- metadata: validation details and performance metrics

🚨 CRITICAL ERROR TYPES:
- **NAME_CLARIFICATION_NEEDED**: Guest has different name in profile
  → Ask clear choice question ONCE, extract response, proceed
- **VALIDATION_ERROR**: Input format issues
  → Guide user with specific examples
- **BUSINESS_RULE**: No availability or policy violations
  → Suggest concrete alternatives with specific times
- **PAST_DATE_BOOKING**: Booking in past
  → Ask for future date with helpful suggestions

🛡️ SMART RECOVERY PROTOCOL:
When ANY booking validation fails and user provides new information:
- **TIME VALIDATION FAILURE** → Re-confirm date + party size
- **DATE VALIDATION FAILURE** → Re-confirm time + party size  
- **PARTY SIZE VALIDATION FAILURE** → Re-confirm date + time
- **MULTIPLE FAILURES** → Fresh start, gather all info again

**RECOVERY FORMAT:** "Perfect! Just to be sure - that's [NEW_TIME] on [DATE] for [GUESTS] people?"
**RATIONALE:** Validation failures often indicate broader context changes.
**EXCEPTION:** Skip re-confirmation if date/party size were explicitly confirmed in the last 2 exchanges.

🚨 CRITICAL SUMMARY RULE:
When summarizing booking details, you MUST ONLY mention details present in the 'gatheringInfo' context.
- If 'gatheringInfo.guests' is missing, DO NOT mention party size
- Instead, ask for it again: "How many guests will be joining you?"
- This prevents misleading confirmations that create user confusion

🚨 CRITICAL GUEST COUNT VALIDATION (BUG FIX):
When users say collective numerals like:
- Russian: "вчетвером" (we four), "втроем" (we three), "вдвоем" (we two)  
- Serbian: "nas četvoro" (four of us), "u troje" (three of us)
- Hungarian: "négyen leszünk" (we will be four), "hárman" (three of us)
- German: "zu viert" (as four), "wir sind drei" (we are three)
- French: "à quatre" (as four), "nous sommes trois" (we are three)

These are VALID guest counts that must be extracted correctly.
NEVER reject these natural language expressions.
The system will validate them using multilingual patterns.
🤝 CONVERSATION STYLE:
- **Warm & Welcoming**: "I'd love to help you with that!"
- **Efficient**: Acknowledge information already provided
- **Celebratory**: "🎉 Your table is reserved!" for successful bookings
- **Helpful**: Provide specific alternatives when needed
- **Professional**: Handle all situations with grace and clarity

💡 CONVERSATION FLOW MASTERY:
**New Guest**: "Hello! I'd love to help with a reservation. What date, time, and party size?"
**Returning Guest**: "Hi [Name]! Great to see you again! What date and time work for you?"
**Success**: "🎉 Perfect! Your reservation is confirmed - #[ID] for [details]"

🎯 EFFICIENCY PRINCIPLES:
- Only ask for missing information
- Use available context naturally
- Avoid repetitive questions
- Guide users efficiently to completion
- Celebrate successful outcomes enthusiastically${finalBookingCommand}`;
    }

    /**
     * 🚨 BUG #3 FIX: Strict availability check validation rules
     * Prevents premature availability checks with assumed guest counts
     */
    private getAvailabilityValidationRules(): string {
        return `
🚨 CRITICAL AVAILABILITY CHECK RULES - BUG #3 FIX:

**MANDATORY PREREQUISITES FOR check_availability:**
- ✅ Date MUST be provided and explicitly validated by user
- ✅ Time MUST be provided and explicitly validated by user  
- ✅ Guests MUST be provided and explicitly validated by user
- ❌ NEVER call check_availability with default/assumed values
- ❌ NEVER assume guests = 1 if not explicitly provided by user
- ❌ NEVER use "typical" or "usual" guest counts without explicit confirmation

**FORBIDDEN ACTIONS - WILL CAUSE SYSTEM ERRORS:**
- ❌ check_availability(date="2025-07-29", time="19:00", guests=1) when user didn't specify guests
- ❌ Any tool call with assumed/default parameter values
- ❌ Premature availability checking before all parameters confirmed
- ❌ Using historical guest data without explicit user confirmation

**REQUIRED BEHAVIOR:**
- If missing guests → Ask: "How many guests will be joining you?"
- If missing date → Ask: "What date would you prefer?"
- If missing time → Ask: "What time works for you?"
- Only call tools when ALL required parameters are explicitly provided by user

**VALIDATION SEQUENCE:**
1. Validate ALL parameters are user-provided (not assumed)
2. If any missing → Ask for missing info (DO NOT assume defaults)
3. If all present → Proceed with tool call
4. NEVER proceed with partial information

🚨 AMBIGUITY RESOLUTION PROTOCOL:
- IF the user's message is ambiguous (e.g., "in the evening", "around 7 or 8")
- AND the structured context extraction returns a 'comment' about an ambiguous time
- THEN your ONLY task is to ask for clarification.
- DO NOT try to guess the time.
- DO NOT check availability.
- REQUIRED ACTION: Ask a clear question like "I can certainly check that for you. What specific time would you like? (e.g., 19:30)".

**CRITICAL RULE:** Even if you know the user's "usual party size" from history, you MUST ask for confirmation for each new booking. Historical data is for reference only, not for making assumptions.`;
    }

    /**
     * 🚀 CRITICAL FIX: Enhanced message handling with comprehensive name clarification
     */
    async handleMessage(message: string, context: AgentContext): Promise<AgentResponse> {
        const startTime = Date.now();

        try {
            this.logAgentAction('Processing message with Sofia agent', {
                messageLength: message.length,
                language: context.language,
                hasGuestHistory: !!context.guestHistory,
                hasPendingConfirmation: !!context.conversationContext?.pendingConfirmation,
                sessionTurn: context.conversationContext?.sessionTurnCount || 1,
                conversationLanguage: context.language || 'auto',
                bugFixesApplied: ['PREMATURE_AVAILABILITY', 'CIRCULAR_REFERENCE', 'LANGUAGE_ENFORCEMENT']
            });

            // 🚨 DIAGNOSTIC: This should NEVER be reached if ECM routing works
            const pendingConfirmation = context.conversationContext?.pendingConfirmation;
            if (pendingConfirmation && pendingConfirmation.type === 'name_clarification') {
                smartLog.error('CONFIRMATION ROUTING FAILURE: Sofia Agent received pending confirmation', new Error('ROUTING_BYPASS'), {
                    sessionId: context.sessionId,
                    confirmationType: pendingConfirmation.type,
                    shouldBeHandledByECM: true,
                    conversationLanguage: context.language || 'auto'
                });
                // Continue with existing logic as fallback
                return await this.handleNameClarificationResponse(message, context);
            }

            // 🎯 INTELLIGENT: First message with personalized greeting
            if (context.conversationContext?.sessionTurnCount === 1) {
                const greeting = this.generateIntelligentGreeting(context);
                return {
                    content: greeting,
                    metadata: {
                        processedAt: new Date().toISOString(),
                        agentType: this.name,
                        confidence: 1.0,
                        processingTimeMs: Date.now() - startTime,
                        action: 'personalized_greeting',
                        usedGuestContext: !!context.guestHistory,
                        conversationLanguage: context.language || 'auto',
                        isProductionReady: true,
                        dateContextFixed: true, // 🚨 NEW: Mark date fix applied
                        bugFixesApplied: ['PREMATURE_AVAILABILITY', 'CIRCULAR_REFERENCE', 'LANGUAGE_ENFORCEMENT']
                    }
                };
            }

            // 🔧 STANDARD: Regular conversation processing with bug fixes
            const systemPrompt = this.generateSystemPrompt(context);
            const response = await this.generateResponse(
                `${systemPrompt}\n\nUser: ${message}`,
                {
                    model: 'sonnet',
                    context: 'sofia-production-conversation-fixed',
                    maxTokens: 1000,
                    temperature: 0.7
                }
            );

            return {
                content: response,
                metadata: {
                    processedAt: new Date().toISOString(),
                    agentType: this.name,
                    confidence: 0.9,
                    processingTimeMs: Date.now() - startTime,
                    modelUsed: 'sonnet',
                    usedGuestContext: !!context.guestHistory,
                    conversationLanguage: context.language || 'auto',
                    isProductionReady: true,
                    dateContextFixed: true, // 🚨 NEW: Mark date fix applied
                    bugFixesApplied: ['PREMATURE_AVAILABILITY', 'CIRCULAR_REFERENCE', 'LANGUAGE_ENFORCEMENT']
                }
            };

        } catch (error) {
            return this.handleAgentError(error as Error, 'handleMessage', message);
        }
    }

    /**
     * 🚨 CRITICAL FIX: Comprehensive name clarification response handler
     * 
     * This method completely prevents infinite loops through:
     * 1. Robust multi-language pattern matching
     * 2. Intelligent attempt limiting with graceful fallbacks
     * 3. Fuzzy matching for typos and variations
     * 4. Clear escalation paths for edge cases
     * 5. 🚨 BUG #4 FIX: Ensures no circular references in pending confirmation creation
     */
    private async handleNameClarificationResponse(
        message: string, 
        context: AgentContext
    ): Promise<AgentResponse> {
        const startTime = Date.now();
        const pendingConfirmation = context.conversationContext?.pendingConfirmation;
        
        if (!pendingConfirmation || pendingConfirmation.type !== 'name_clarification') {
            return this.createErrorResponse('Invalid pending confirmation state', startTime);
        }

        try {
            this.logAgentAction('🚨 CRITICAL: Handling name clarification response (BUG #4 SAFE)', {
                userMessage: message.substring(0, 100),
                dbName: pendingConfirmation.dbName,
                requestName: pendingConfirmation.requestName,
                currentAttempt: pendingConfirmation.attempts + 1,
                maxAttempts: pendingConfirmation.maxAttempts,
                conversationLanguage: context.language || 'auto',
                hasCleanOriginalContext: this.validateCleanContext(pendingConfirmation.originalContext)
            });

            // 🚨 CRITICAL: Check attempt limit to prevent infinite loops
            if (pendingConfirmation.attempts >= pendingConfirmation.maxAttempts) {
                return this.handleMaxAttemptsReached(pendingConfirmation, context, startTime);
            }

            // 🔍 ENHANCED: Multi-stage name extraction with comprehensive patterns
            const chosenName = await this.extractNameChoiceComprehensive(
                message,
                pendingConfirmation.dbName,
                pendingConfirmation.requestName,
                context.language || 'en'
            );

            if (chosenName) {
                // ✅ SUCCESS: Name extracted - proceed with booking
                return this.proceedWithNameChoice(chosenName, pendingConfirmation, context, startTime);
            } else {
                // ❌ EXTRACTION FAILED: Increment attempt and provide clearer guidance
                return this.handleExtractionFailure(pendingConfirmation, context, startTime);
            }

        } catch (error) {
            this.logAgentAction('❌ ERROR in name clarification handling', {
                error: (error as Error).message,
                pendingState: pendingConfirmation,
                conversationLanguage: context.language || 'auto'
            });
            return this.createErrorResponse('Name clarification processing failed', startTime);
        }
    }

    /**
     * 🚨 BUG #4 FIX: Validate that original context is clean (no circular references)
     */
    private validateCleanContext(originalContext: any): boolean {
        try {
            // Test serialization to detect circular references
            const serialized = JSON.stringify(originalContext);
            const parsed = JSON.parse(serialized);
            
            // Ensure only allowed properties exist
            const allowedProperties = ['restaurantId', 'timezone', 'sessionId', 'language'];
            const actualProperties = Object.keys(originalContext);
            
            const hasOnlyAllowedProperties = actualProperties.every(prop => allowedProperties.includes(prop));
            const hasNoCircularRefs = serialized.length > 0;
            
            this.logAgentAction('🔍 Clean context validation', {
                hasOnlyAllowedProperties,
                hasNoCircularRefs,
                actualProperties,
                serializedLength: serialized.length
            });
            
            return hasOnlyAllowedProperties && hasNoCircularRefs;
        } catch (error) {
            this.logAgentAction('❌ Clean context validation failed', {
                error: (error as Error).message,
                context: originalContext
            });
            return false;
        }
    }

    /**
     * 🚨 BUG #4 FIX: Create clean pending confirmation with safe serialization
     */
    private createCleanPendingConfirmation(
        dbName: string,
        requestName: string,
        originalBookingData: any,
        context: AgentContext
    ): PendingConfirmation {
        // 🚨 CRITICAL BUG #4 FIX: Create clean context object without circular references
        const cleanOriginalContext = {
            restaurantId: this.restaurantConfig.id,
            timezone: this.restaurantConfig.timezone,
            sessionId: context.sessionId || 'unknown',
            language: context.language || 'en'
            // 🚨 CRITICAL: DO NOT include session, restaurantConfig, or other complex objects
        };

        const pendingConfirmation: PendingConfirmation = {
            type: 'name_clarification',
            dbName,
            requestName,
            originalBookingData,
            originalContext: cleanOriginalContext,
            attempts: 0,
            maxAttempts: this.MAX_CLARIFICATION_ATTEMPTS,
            createdAt: new Date(),
            lastAttemptAt: undefined
        };

        // 🚨 BUG #4 FIX: Validate serialization before returning
        try {
            const testSerialization = JSON.stringify(pendingConfirmation);
            if (testSerialization.length === 0) {
                throw new Error('Serialization produced empty result');
            }
            
            this.logAgentAction('✅ Clean pending confirmation created', {
                dbName,
                requestName,
                contextProperties: Object.keys(cleanOriginalContext),
                serializationLength: testSerialization.length,
                bugFixApplied: 'BUG_4_CIRCULAR_REFERENCE_PREVENTION'
            });
            
        } catch (serializationError) {
            this.logAgentAction('❌ CRITICAL: Pending confirmation failed serialization test', {
                error: (serializationError as Error).message,
                pendingConfirmation
            });
            throw new Error('Failed to create serializable pending confirmation');
        }

        return pendingConfirmation;
    }

    /**
     * 🚀 CRITICAL FIX: Comprehensive name choice extraction with multi-language support
     */
    private async extractNameChoiceComprehensive(
        userMessage: string,
        dbName: string,
        requestName: string,
        language: string
    ): Promise<string | null> {
        const message = this.sanitizeInput(userMessage.toLowerCase().trim());
        
        this.logAgentAction('🔍 Extracting name choice with comprehensive patterns', {
            message: message.substring(0, 50),
            dbName,
            requestName,
            language
        });

        // Stage 1: Direct exact name matching (highest confidence)
        if (message === dbName.toLowerCase() || message === requestName.toLowerCase()) {
            const choice = message === dbName.toLowerCase() ? dbName : requestName;
            this.logAgentAction('✅ STAGE 1 SUCCESS: Direct exact match', { choice });
            return choice;
        }

        // Stage 2: Name substring matching (high confidence)
        if (message.includes(dbName.toLowerCase())) {
            this.logAgentAction('✅ STAGE 2 SUCCESS: DB name substring match', { choice: dbName });
            return dbName;
        }
        if (message.includes(requestName.toLowerCase())) {
            this.logAgentAction('✅ STAGE 2 SUCCESS: Request name substring match', { choice: requestName });
            return requestName;
        }

        // Stage 3: Pattern-based extraction (medium confidence)
        const patternResult = this.extractWithPatterns(message, dbName, requestName, language);
        if (patternResult) {
            this.logAgentAction('✅ STAGE 3 SUCCESS: Pattern-based extraction', { choice: patternResult });
            return patternResult;
        }

        // Stage 4: Yes/No response handling (medium confidence)
        const yesNoResult = this.extractFromYesNoResponse(message, dbName, requestName, language);
        if (yesNoResult) {
            this.logAgentAction('✅ STAGE 4 SUCCESS: Yes/No response', { choice: yesNoResult });
            return yesNoResult;
        }

        // Stage 5: Fuzzy matching for typos (low confidence)
        const fuzzyResult = this.extractWithFuzzyMatching(message, dbName, requestName);
        if (fuzzyResult) {
            this.logAgentAction('✅ STAGE 5 SUCCESS: Fuzzy matching', { choice: fuzzyResult });
            return fuzzyResult;
        }

        // Stage 6: Contextual number/position extraction (low confidence)
        const contextualResult = this.extractFromContextualPatterns(message, dbName, requestName, language);
        if (contextualResult) {
            this.logAgentAction('✅ STAGE 6 SUCCESS: Contextual extraction', { choice: contextualResult });
            return contextualResult;
        }

        this.logAgentAction('❌ ALL STAGES FAILED: No name choice extracted');
        return null;
    }

    /**
     * 🔍 ENHANCED: Pattern-based name extraction
     */
    private extractWithPatterns(
        message: string,
        dbName: string,
        requestName: string,
        language: string
    ): string | null {
        const patterns = this.nameExtractionPatterns.find(p => p.language === language) ||
                        this.nameExtractionPatterns.find(p => p.language === 'en')!;

        // Try use patterns
        for (const pattern of patterns.patterns.usePatterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                const extractedName = match[1].trim();
                if (this.isNameMatch(extractedName, dbName)) return dbName;
                if (this.isNameMatch(extractedName, requestName)) return requestName;
            }
        }

        return null;
    }

    /**
     * 🔍 ENHANCED: Yes/No response extraction
     */
    private extractFromYesNoResponse(
        message: string,
        dbName: string,
        requestName: string,
        language: string
    ): string | null {
        const patterns = this.nameExtractionPatterns.find(p => p.language === language) ||
                        this.nameExtractionPatterns.find(p => p.language === 'en')!;

        // Check yes patterns (usually means keep the requested name)
        for (const pattern of patterns.patterns.yesNoPatterns.yes) {
            if (pattern.test(message)) {
                return requestName;
            }
        }

        // Check no patterns (usually means use the database name)
        for (const pattern of patterns.patterns.yesNoPatterns.no) {
            if (pattern.test(message)) {
                return dbName;
            }
        }

        return null;
    }

    /**
     * 🔍 ENHANCED: Fuzzy matching for typos and variations
     */
    private extractWithFuzzyMatching(
        message: string,
        dbName: string,
        requestName: string
    ): string | null {
        const threshold = 2; // Maximum edit distance

        // Only apply fuzzy matching to names longer than 3 characters
        if (dbName.length > 3) {
            const dbDistance = this.calculateLevenshteinDistance(message, dbName.toLowerCase());
            if (dbDistance <= threshold) {
                return dbName;
            }
        }

        if (requestName.length > 3) {
            const requestDistance = this.calculateLevenshteinDistance(message, requestName.toLowerCase());
            if (requestDistance <= threshold) {
                return requestName;
            }
        }

        return null;
    }

    /**
     * 🔍 ENHANCED: Contextual pattern extraction (first/second, 1/2, etc.)
     */
    private extractFromContextualPatterns(
        message: string,
        dbName: string,
        requestName: string,
        language: string
    ): string | null {
        const patterns = this.nameExtractionPatterns.find(p => p.language === language) ||
                        this.nameExtractionPatterns.find(p => p.language === 'en')!;

        for (const pattern of patterns.patterns.contextualPatterns) {
            const match = message.match(pattern);
            if (match) {
                // Extract number or position indicator
                const indicator = match[1] || match[0];
                
                // Map to position (first = db name, second = request name)
                if (/^(?:1|first|перв|prv)/i.test(indicator)) {
                    return dbName;
                }
                if (/^(?:2|second|втор|drug)/i.test(indicator)) {
                    return requestName;
                }
            }
        }

        return null;
    }

    /**
     * 🔧 HELPER: Check if extracted text matches a name
     */
    private isNameMatch(extracted: string, targetName: string): boolean {
        const extractedClean = extracted.toLowerCase().trim();
        const targetClean = targetName.toLowerCase().trim();
        
        // Exact match
        if (extractedClean === targetClean) return true;
        
        // Substring match (bidirectional)
        if (extractedClean.includes(targetClean) || targetClean.includes(extractedClean)) {
            return true;
        }
        
        // Word boundary match for multi-word names
        const words = targetClean.split(/\s+/);
        if (words.some(word => word.length > 2 && extractedClean.includes(word))) {
            return true;
        }
        
        return false;
    }

    /**
     * 🚨 CRITICAL: Handle maximum attempts reached (prevents infinite loops)
     */
    private handleMaxAttemptsReached(
        pendingConfirmation: PendingConfirmation,
        context: AgentContext,
        startTime: number
    ): AgentResponse {
        this.logAgentAction('🚨 CRITICAL: Max clarification attempts reached - preventing infinite loop', {
            attempts: pendingConfirmation.attempts,
            maxAttempts: pendingConfirmation.maxAttempts,
            dbName: pendingConfirmation.dbName,
            requestName: pendingConfirmation.requestName,
            conversationLanguage: context.language || 'auto',
            bugFixApplied: 'BUG_4_INFINITE_LOOP_PREVENTION'
        });

        // 🎯 GRACEFUL FALLBACK: Auto-select requested name and proceed
        const fallbackName = pendingConfirmation.requestName;
        
        const messages = {
            en: `I understand this is confusing. I'll use "${fallbackName}" for your reservation and proceed with booking. Processing your reservation now...`,
            ru: `Понимаю, что это запутанно. Использую "${fallbackName}" для вашей брони и продолжу бронирование. Обрабатываю...`,
            sr: `Razumem da je ovo konfuzno. Koristiću "${fallbackName}" za rezervaciju i nastaviti. Obrađujem rezervaciju...`,
            auto: `I understand this is confusing. I'll use "${fallbackName}" for your reservation and proceed with booking. Processing your reservation now...`
        };

        const language = context.language || 'auto';
        const fallbackMessage = messages[language] || messages.auto;

        return {
            content: fallbackMessage,
            // 🎯 CRITICAL: Include tool call to proceed with booking using fallback name
            toolCalls: [{
                function: {
                    name: 'create_reservation',
                    arguments: JSON.stringify({
                        ...pendingConfirmation.originalBookingData,
                        guestName: fallbackName,
                        _bypassNameCheck: true, // Skip name validation since this is fallback
                        _fallbackResolution: true // Mark as fallback for logging
                    })
                }
            }],
            metadata: {
                processedAt: new Date().toISOString(),
                agentType: this.name,
                confidence: 0.8,
                processingTimeMs: Date.now() - startTime,
                action: 'max_attempts_fallback',
                fallbackName,
                conversationLanguage: context.language || 'auto',
                infiniteLoopPrevented: true,
                attemptCount: pendingConfirmation.attempts,
                bugFixesApplied: ['BUG_4_INFINITE_LOOP_PREVENTION']
            }
        };
    }

    /**
     * ✅ SUCCESS: Proceed with extracted name choice
     */
    private proceedWithNameChoice(
        chosenName: string,
        pendingConfirmation: PendingConfirmation,
        context: AgentContext,
        startTime: number
    ): AgentResponse {
        this.logAgentAction('✅ SUCCESS: Name choice extracted - proceeding with booking', {
            chosenName,
            attempts: pendingConfirmation.attempts + 1,
            originalBooking: pendingConfirmation.originalBookingData,
            conversationLanguage: context.language || 'auto',
            bugFixApplied: 'BUG_4_CLEAN_PROGRESSION'
        });

        const messages = {
            en: `Perfect! I'll use "${chosenName}" for your reservation. Creating your booking now...`,
            ru: `Отлично! Использую "${chosenName}" для вашей брони. Создаю бронирование...`,
            sr: `Odlično! Koristiću "${chosenName}" za rezervaciju. Kreiram rezervaciju...`,
            auto: `Perfect! I'll use "${chosenName}" for your reservation. Creating your booking now...`
        };

        const language = context.language || 'auto';
        const proceedMessage = messages[language] || messages.auto;

        return {
            content: proceedMessage,
            // 🎯 INCLUDE: Tool call to complete the booking with chosen name
            toolCalls: [{
                function: {
                    name: 'create_reservation',
                    arguments: JSON.stringify({
                        ...pendingConfirmation.originalBookingData,
                        guestName: chosenName,
                        _bypassNameCheck: true, // Skip validation since user explicitly chose
                        _resolvedFromClarification: true // Mark for logging
                    })
                }
            }],
            metadata: {
                processedAt: new Date().toISOString(),
                agentType: this.name,
                confidence: 0.95,
                processingTimeMs: Date.now() - startTime,
                action: 'name_choice_success',
                chosenName,
                conversationLanguage: context.language || 'auto',
                attemptCount: pendingConfirmation.attempts + 1,
                clarificationResolved: true,
                bugFixesApplied: ['BUG_4_CLEAN_PROGRESSION']
            }
        };
    }

    /**
     * ❌ EXTRACTION FAILED: Provide clearer guidance and increment attempts
     */
    private handleExtractionFailure(
        pendingConfirmation: PendingConfirmation,
        context: AgentContext,
        startTime: number
    ): AgentResponse {
        // Increment attempt counter
        pendingConfirmation.attempts++;
        pendingConfirmation.lastAttemptAt = new Date();

        this.logAgentAction('❌ Name extraction failed - providing clearer guidance', {
            attempts: pendingConfirmation.attempts,
            remainingAttempts: pendingConfirmation.maxAttempts - pendingConfirmation.attempts,
            conversationLanguage: context.language || 'auto'
        });

        // Generate increasingly clear guidance based on attempt number
        const language = context.language || 'auto';
        const clarificationMessage = this.generateProgressiveClarification(
            pendingConfirmation,
            language
        );

        return {
            content: clarificationMessage,
            metadata: {
                processedAt: new Date().toISOString(),
                agentType: this.name,
                confidence: 0.7,
                processingTimeMs: Date.now() - startTime,
                action: 'extraction_failure_guidance',
                conversationLanguage: context.language || 'auto',
                attemptCount: pendingConfirmation.attempts,
                remainingAttempts: pendingConfirmation.maxAttempts - pendingConfirmation.attempts
            }
        };
    }

    /**
     * 🔧 PROGRESSIVE: Generate increasingly clear clarification messages
     */
    private generateProgressiveClarification(
        pendingConfirmation: PendingConfirmation,
        language: string
    ): string {
        const { dbName, requestName, attempts, maxAttempts } = pendingConfirmation;
        const remaining = maxAttempts - attempts;

        // Attempt 1: Polite clarification
        if (attempts === 1) {
            const messages = {
                en: `I need to clarify which name to use. Please choose:
1. "${dbName}" (from your profile)
2. "${requestName}" (new name)

Just type the name you prefer.`,
                ru: `Нужно уточнить имя. Пожалуйста, выберите:
1. "${dbName}" (из вашего профиля)
2. "${requestName}" (новое имя)

Просто напишите предпочитаемое имя.`,
                sr: `Treba mi da pojasnim ime. Molim vas izaberite:
1. "${dbName}" (iz vašeg profila)
2. "${requestName}" (novo ime)

Samo napišite ime koje preferirate.`,
                auto: `I need to clarify which name to use. Please choose one:
1. "${dbName}" (from your profile)
2. "${requestName}" (new name)

Just type the name you prefer.`
            };
            return messages[language] || messages.auto;
        }

        // Attempt 2: More explicit with examples
        if (attempts === 2) {
            const messages = {
                en: `Please help me understand which name to use for your reservation.

OPTION 1: Type "${dbName}"
OPTION 2: Type "${requestName}"

You can also just type "1" for the first option or "2" for the second option.`,
                ru: `Помогите понять, какое имя использовать для брони.

ВАРИАНТ 1: Напишите "${dbName}"
ВАРИАНТ 2: Напишите "${requestName}"

Можете просто написать "1" для первого или "2" для второго варианта.`,
                sr: `Molim vas pomozite mi da razumem koje ime da koristim.

OPCIJA 1: Napišite "${dbName}"
OPCIJA 2: Napišite "${requestName}"

Možete samo da napišete "1" za prvu ili "2" za drugu opciju.`,
                auto: `Please help me understand which name to use for your reservation.

OPTION 1: Type "${dbName}"
OPTION 2: Type "${requestName}"

You can also just type "1" for the first option or "2" for the second option.`
            };
            return messages[language] || messages.auto;
        }

        // Final attempt: Ultra-clear with warning
        const messages = {
            en: `⚠️ Final attempt - I need a clear choice to proceed with your booking:

🔹 To use "${dbName}" → Type: ${dbName}
🔹 To use "${requestName}" → Type: ${requestName}

Or simply type "1" or "2" to choose. After this, I'll automatically use "${requestName}" if unclear.`,
            ru: `⚠️ Последняя попытка - нужен чёткий выбор для продолжения:

🔹 Использовать "${dbName}" → Напишите: ${dbName}
🔹 Использовать "${requestName}" → Напишите: ${requestName}

Или просто "1" или "2". После этого автоматически использую "${requestName}".`,
            sr: `⚠️ Poslednji pokušaj - potreban mi je jasan izbor:

🔹 Za "${dbName}" → Napišite: ${dbName}
🔹 Za "${requestName}" → Napišite: ${requestName}

Ili samo "1" ili "2". Nakon ovoga, automatski ću koristiti "${requestName}".`,
            auto: `⚠️ Final attempt - I need a clear choice to proceed with your booking:

🔹 To use "${dbName}" → Type: ${dbName}
🔹 To use "${requestName}" → Type: ${requestName}

Or simply type "1" or "2" to choose. After this, I'll automatically use "${requestName}" if unclear.`
        };

        return messages[language] || messages.auto;
    }

    /**
     * 🔧 HELPER: Calculate Levenshtein distance for fuzzy matching
     */
    private calculateLevenshteinDistance(str1: string, str2: string): number {
        const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

        for (let i = 0; i <= str1.length; i += 1) {
            matrix[0][i] = i;
        }

        for (let j = 0; j <= str2.length; j += 1) {
            matrix[j][0] = j;
        }

        for (let j = 1; j <= str2.length; j += 1) {
            for (let i = 1; i <= str1.length; i += 1) {
                const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,
                    matrix[j - 1][i] + 1,
                    matrix[j - 1][i - 1] + indicator
                );
            }
        }

        return matrix[str2.length][str1.length];
    }

    /**
     * 🚨 NEW: Validate if requested time is current time and handle appropriately
     */
    private validateCurrentTimeBooking(
        requestedTime: string,
        restaurantTimezone: string
    ): {
        isCurrentTime: boolean,
        isWithinOperatingHours: boolean,
        minutesUntilClose?: number,
        recommendation?: string
    } {
        try {
            const currentTime = getRestaurantDateTime(restaurantTimezone);
            const currentTimeString = currentTime.toFormat('HH:mm');

            // Check if requested time is very close to current time (within 5 minutes)
            const requestedDateTime = DateTime.fromFormat(requestedTime, 'HH:mm');
            const diffMinutes = Math.abs(requestedDateTime.diff(currentTime, 'minutes').minutes);

            const isCurrentTime = diffMinutes <= 5;

            if (isCurrentTime) {
                // Check restaurant operating hours
                const operatingStatus = getRestaurantOperatingStatus(
                    restaurantTimezone,
                    this.restaurantConfig.openingTime || '09:00',
                    this.restaurantConfig.closingTime || '23:00'
                );

                return {
                    isCurrentTime: true,
                    isWithinOperatingHours: operatingStatus.isOpen,
                    minutesUntilClose: operatingStatus.minutesUntilClose,
                    recommendation: !operatingStatus.isOpen
                        ? 'Restaurant is currently closed'
                        : operatingStatus.minutesUntilClose && operatingStatus.minutesUntilClose < 60
                            ? `Note: Restaurant closes in ${operatingStatus.minutesUntilClose} minutes`
                            : undefined
                };
            }

            return {
                isCurrentTime: false,
                isWithinOperatingHours: true // We'll let normal validation handle this
            };

        } catch (error) {
            this.logAgentAction('Error validating current time booking', {
                error: (error as Error).message,
                requestedTime,
                restaurantTimezone
            });
            return {
                isCurrentTime: false,
                isWithinOperatingHours: true
            };
        }
    }

    /**
     * 🔒 SECURITY: Input sanitization
     */
    private sanitizeInput(input: string): string {
        return input
            .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
            .normalize('NFC') // Normalize unicode
            .replace(/[<>\"']/g, '') // Remove potential injection chars
            .substring(0, 200) // Limit length
            .trim();
    }

    /**
     * 🔧 HELPER: Create standardized error response
     */
    private createErrorResponse(errorMessage: string, startTime: number): AgentResponse {
        return {
            content: "I'm sorry, there was an issue processing your request. Let me help you start fresh with your booking.",
            error: {
                type: 'AGENT_ERROR',
                message: errorMessage,
                recoverable: true
            },
            metadata: {
                processedAt: new Date().toISOString(),
                agentType: this.name,
                confidence: 0.0,
                processingTimeMs: Date.now() - startTime,
                action: 'error_recovery'
            }
        };
    }

    /**
     * 🎯 INTELLIGENT: Generate personalized greeting based on context
     */
    private generateIntelligentGreeting(context: AgentContext): string {
        const { guestHistory, language, conversationContext } = context;

        // Subsequent booking in same session
        if (conversationContext?.isSubsequentBooking) {
            return this.getSubsequentBookingGreeting(language);
        }

        // New guest
        if (!guestHistory || guestHistory.total_bookings === 0) {
            return this.getNewGuestGreeting(language);
        }

        // Returning guest with intelligent context usage
        return this.getReturningGuestGreeting(guestHistory, language);
    }

    /**
     * 🛠️ BUG FIX 2 APPLIED: Force the AI to Confirm Guest Count for returning guests
     * 
     * This method now changes the logic to formulate a direct question when a common party size is known,
     * preventing the AI from making unverified assumptions about party size.
     */
    private getReturningGuestGreeting(guestHistory: GuestHistory, language: Language): string {
        const { guest_name, guest_phone, total_bookings, common_party_size } = guestHistory;
        const isRegular = total_bookings >= 3;

        // If a common party size exists, formulate a direct question.
        if (common_party_size) {
            const greetings = {
                en: `Hi ${guest_name}! Welcome back. I see you usually book for ${common_party_size}. How many guests will be joining you this time?`,
                ru: `Привет, ${guest_name}! С возвращением! Вижу, вы обычно бронируете на ${common_party_size}. Сколько гостей будет в этот раз?`,
                sr: `Zdravo, ${guest_name}! Dobrodošli nazad. Vidim da obično rezervišete za ${common_party_size}. Koliko gostiju će biti ovog puta?`,
                auto: `Hi ${guest_name}! Welcome back. I see you usually book for ${common_party_size}. How many guests will be joining you this time?`
            };
            return greetings[language] || greetings.auto;
        }

        // Fallback for returning guests without a common party size.
        const fallbackGreetings = {
            en: `Hello, ${guest_name}! Nice to see you again! I have your contact info (${guest_phone}) ready. What date, time, and party size are you looking for?`,
            ru: `Здравствуйте, ${guest_name}! Приятно снова видеть! У меня готовы ваши данные (${guest_phone}). Какие дата, время и количество гостей?`,
            sr: `Zdravo, ${guest_name}! Drago mi je da vas ponovo vidim! Imam spremne vaše podatke (${guest_phone}). Koji datum, vreme i broj gostiju?`,
            auto: `Hello, ${guest_name}! Nice to see you again! I have your contact info (${guest_phone}) ready. What date, time, and party size are you looking for?`
        };
        return fallbackGreetings[language] || fallbackGreetings.auto;
    }

    /**
     * 🆕 NEW: New guest welcoming greeting
     */
    private getNewGuestGreeting(language: Language): string {
        const greetings = {
            en: `Hello and welcome! 🌟 I'd love to help you with a reservation at ${this.restaurantConfig.name}. What date and time work for you, and how many guests?`,
            ru: `Здравствуйте и добро пожаловать! 🌟 Буду рада помочь с бронированием в ${this.restaurantConfig.name}. Какие дата и время, и на сколько человек?`,
            sr: `Zdravo i dobrodošli! 🌟 Rado ću pomoći sa rezervacijom u ${this.restaurantConfig.name}. Koji datum i vreme, i koliko osoba?`,
            auto: `Hello and welcome! 🌟 I'd love to help you with a reservation at ${this.restaurantConfig.name}. What date and time work for you, and how many guests?`
        };
        return greetings[language] || greetings.auto;
    }

    /**
     * 🔄 SUBSEQUENT: Subsequent booking greeting
     */
    private getSubsequentBookingGreeting(language: Language): string {
        const greetings = {
            en: `Perfect! I'd be happy to help with another reservation. What date and time would you like this time?`,
            ru: `Отлично! Буду рада помочь с ещё одной бронью. Какие дата и время на этот раз?`,
            sr: `Odlično! Rado ću pomoći sa još jednom rezervacijom. Koji datum i vreme ovaj put?`,
            auto: `Perfect! I'd be happy to help with another reservation. What date and time would you like this time?`
        };
        return greetings[language] || greetings.auto;
    }

    /**
     * 🔧 ENHANCED: Get name clarification instructions for system prompt
     */
    private getNameClarificationInstructions(conversationContext?: ConversationContext): string {
        const pendingConfirmation = conversationContext?.pendingConfirmation;
        
        if (pendingConfirmation && pendingConfirmation.type === 'name_clarification') {
            return `
🚨 CRITICAL: NAME CLARIFICATION MODE - INFINITE LOOP PREVENTION ACTIVE

**CURRENT STATE:**
- Database name: "${pendingConfirmation.dbName}"
- Requested name: "${pendingConfirmation.requestName}"
- Current attempt: ${pendingConfirmation.attempts + 1}/${pendingConfirmation.maxAttempts}
- Created: ${pendingConfirmation.createdAt.toISOString()}

**CRITICAL MISSION:** Extract user's name choice and proceed with booking immediately.

**DO NOT:**
- Ask clarification questions again
- Repeat the name options
- Get into conversation loops
- Provide general booking advice

**DO:**
- Extract name choice from user response
- Proceed immediately with chosen name
- Use fallback if max attempts reached
- Complete the booking successfully

This prevents infinite clarification loops and ensures smooth user experience.`;
        }
        
        return `
🚨 NAME CLARIFICATION PROTOCOL:

**IF create_reservation RETURNS NAME_CLARIFICATION_NEEDED:**
1. Ask ONE clear choice question with both name options
2. In next turn: Extract user's choice using comprehensive patterns
3. Proceed immediately with chosen name
4. NEVER repeat clarification - always progress forward

**CRITICAL:** This protocol prevents infinite loops by ensuring forward progress.`;
    }

    /**
     * 🔧 STREAMLINED: Get personalized section for system prompt
     */
    private getPersonalizedSection(guestHistory: GuestHistory | null, language: Language): string {
        if (!guestHistory || guestHistory.total_bookings === 0) {
            return `
👤 GUEST STATUS: New Guest
🎯 APPROACH: Warm welcome, gather all needed information`;
        }

        const { guest_name, guest_phone, total_bookings, common_party_size } = guestHistory;
        const isRegular = total_bookings >= 3;

        return `
👤 GUEST PROFILE (USE INTELLIGENTLY):
- Name: ${guest_name} ✅ KNOWN
- Phone: ${guest_phone} ✅ KNOWN
- Visit count: ${total_bookings} (${isRegular ? 'REGULAR CUSTOMER 🌟' : 'RETURNING GUEST'})
${common_party_size ? `- Usual party size: ${common_party_size} ⚠️ MUST CONFIRM. Never assume.` : ''}

🎯 INTELLIGENT USAGE:
- Use known information proactively and naturally.
- 🚨 CRITICAL RULE (GUEST COUNT): Even if you know the 'Usual party size', you MUST ALWAYS explicitly ask the user "How many guests will be joining you?" for every new booking. DO NOT assume the number of guests.
- 🚨 CRITICAL RULE (GUEST NAME): If the guest's name is missing, you MUST ask for it. DO NOT use the phone number as the guest's name when calling the 'create_reservation' tool.
- Be extra welcoming for regular customers.
- Acknowledge their loyalty: "${isRegular ? 'Always wonderful to see you!' : 'Great to see you again!'}"`;
    }

    /**
     * 🔧 ENHANCED: Get conversation instructions
     */
    private getConversationInstructions(conversationContext?: ConversationContext): string {
        if (!conversationContext) return '';

        const flags = [
            conversationContext.hasAskedPartySize && '✅ Party Size Asked',
            conversationContext.hasAskedDate && '✅ Date Asked',
            conversationContext.hasAskedTime && '✅ Time Asked',
            conversationContext.hasAskedName && '✅ Name Asked',
            conversationContext.hasAskedPhone && '✅ Phone Asked'
        ].filter(Boolean);

        return `
📝 CONVERSATION STATE (Turn ${conversationContext.sessionTurnCount || 1}):
${flags.length > 0 ? flags.join('\n') : '🆕 Fresh conversation - no questions asked yet'}

⚡ EFFICIENCY RULES:
- Only ask for information NOT marked with ✅
- Acknowledge information already provided: "Great, I have [info]..."
- Use natural, flowing conversation - avoid robotic questioning
- Combine questions when appropriate: "What date, time, and party size?"
- Celebrate progress: "Perfect! Just need [missing info] and we're all set!"`;
    }

    /**
     * 🛠️ BUG FIX 1 APPLIED: Make the AI Aware of the "Last Seating" Rule
     * 
     * This method now calculates the last possible booking time and inserts it directly 
     * into the agent's system prompt to prevent confusion about closing times.
     */
    private getBusinessHoursInstructions(): string {
        const openingTime = this.restaurantConfig.openingTime || '09:00';
        const closingTime = this.restaurantConfig.closingTime || '23:00';
        const isOvernight = isOvernightOperation(openingTime, closingTime);
        
        // Calculate the last bookable time
        const lastBookingTime = DateTime.fromFormat(closingTime, 'HH:mm').minus({ minutes: this.restaurantConfig.avgReservationDuration || 120 }).toFormat('HH:mm');

        return `
🕐 BUSINESS HOURS EXPERTISE:
- Operating hours: ${openingTime} - ${closingTime}${isOvernight ? ' (next day)' : ''}
- 🚨 CRITICAL BOOKING RULE: The last possible booking time is ${lastBookingTime} to ensure guests have enough time to dine before we close.
- Timezone: ${this.restaurantConfig.timezone}
${isOvernight ? '- ⚠️ OVERNIGHT OPERATION: We\'re open past midnight!' : ''}

💡 HELPFUL GUIDANCE:
- Proactively mention hours when relevant: "We're open until ${closingTime}!"
- Guide users toward valid booking times with specific suggestions
- Be understanding about timing constraints
- Celebrate convenient timing: "Perfect! That's right in our prime dinner hours!"
- 🚨 ENFORCE LAST SEATING: Do not accept bookings after ${lastBookingTime}
${isOvernight ? '- Highlight late availability: "Great news - we\'re open late until ' + closingTime + '!"' : ''}`;
    }

    /**
     * 🔧 ENHANCED: Get restaurant context for date/time awareness
     * 🚨 CRITICAL FIX BUG-00184: Extract current year explicitly for AI prompt
     */
    private getRestaurantContext() {
        try {
            const timezone = this.restaurantConfig.timezone;
            const restaurantContext = getRestaurantTimeContext(timezone); // This now contains the year
            const operatingStatus = getRestaurantOperatingStatus(
                timezone,
                this.restaurantConfig.openingTime || '09:00',
                this.restaurantConfig.closingTime || '23:00'
            );

            return {
                currentDate: restaurantContext.todayDate,
                tomorrowDate: restaurantContext.tomorrowDate,
                currentTime: restaurantContext.displayName,
                dayOfWeek: restaurantContext.dayOfWeek,
                isOpen: operatingStatus.isOpen,
                currentYear: restaurantContext.currentYear, // Use the new property
                nextYear: restaurantContext.nextYear,       // Use the new property
                timezone: timezone,
                isOvernightOperation: operatingStatus.isOvernightOperation || false
            };
        } catch (error) {
            // Enhanced fallback using Luxon
            const now = DateTime.now();
            return {
                currentDate: now.toISODate(),
                tomorrowDate: now.plus({ days: 1 }).toISODate(),
                currentTime: now.toFormat('HH:mm'),
                dayOfWeek: now.toFormat('cccc'),
                isOpen: true,
                currentYear: now.year,
                nextYear: now.year + 1,
                timezone: 'Europe/Belgrade',
                isOvernightOperation: false
            };
        }
    }

    /**
     * 🔧 GET: Available tools for Sofia agent
     */
    getTools() {
        return agentTools.filter(tool =>
            this.capabilities.includes(tool.function.name)
        );
    }

    /**
     * 🔧 COMPATIBILITY: Legacy method support
     */
    updateInstructions(
        context: string, 
        language: Language, 
        guestHistory?: GuestHistory | null, 
        isFirstMessage?: boolean, 
        conversationContext?: ConversationContext
    ): string {
        return this.generateSystemPrompt({
            restaurantId: this.restaurantConfig.id,
            timezone: this.restaurantConfig.timezone,
            language,
            guestHistory,
            conversationContext
        });
    }

    /**
     * 🔧 COMPATIBILITY: Legacy greeting method
     */
    getPersonalizedGreeting(
        guestHistory: GuestHistory | null, 
        language: Language, 
        context: 'hostess' | 'guest', 
        conversationContext?: ConversationContext
    ): string {
        return this.generateIntelligentGreeting({
            restaurantId: this.restaurantConfig.id,
            timezone: this.restaurantConfig.timezone,
            language,
            guestHistory,
            conversationContext
        });
    }
}

export default SofiaAgent;