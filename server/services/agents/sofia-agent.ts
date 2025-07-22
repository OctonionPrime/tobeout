// src/agents/sofia-agent.ts
// ✅ OPTIMIZED VERSION: Aligned with enhanced-conversation-manager.ts core fixes
// 🚨 CRITICAL FIXES INTEGRATION: Works seamlessly with BUG-00181, BUG-00182, BUG-00183 solutions
// ✅ STREAMLINED: Removes redundancy, focuses on agent-specific conversation flow
// 🎯 ENHANCED: Includes name clarification infinite loop fix
// 🔧 FOCUSED: Agent personality and natural conversation patterns

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
 * Guest history interface
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
 * 🚨 NEW: Pending Name Clarification State for infinite loop fix
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
}

/**
 * Conversation context interface
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
 * Sofia Agent - Optimized Booking Specialist
 * 
 * ✅ INTEGRATION: Works seamlessly with enhanced-conversation-manager.ts core fixes:
 * - BUG-00181: Context-aware extraction (handled by conversation manager)
 * - BUG-00182: Safe guest history (handled by conversation manager) 
 * - BUG-00183: Detailed confirmations (handled by conversation manager)
 * 
 * 🎯 FOCUS AREAS:
 * - Natural conversation flow and agent personality
 * - Name clarification infinite loop prevention
 * - Intelligent context usage for smooth interactions
 * - Business hours and timezone guidance
 * - Efficient information gathering patterns
 */
export class SofiaAgent extends BaseAgent {
    readonly name = 'Sofia';
    readonly description = 'Friendly booking specialist - optimized and integrated with core system fixes';
    readonly capabilities = [
        'check_availability',
        'find_alternative_times', 
        'create_reservation',
        'get_restaurant_info',
        'get_guest_history'
    ];

    constructor(config: AgentConfig, restaurantConfig: RestaurantConfig) {
        super(config, restaurantConfig);
        this.logAgentAction('Sofia Agent initialized - optimized version with core system integration');
    }

    /**
     * Generate system prompt - streamlined and focused on conversation flow
     */
    generateSystemPrompt(context: AgentContext): string {
        const { language, guestHistory, conversationContext } = context;

        const dateContext = this.getRestaurantContext();
        const personalizedSection = this.getPersonalizedSection(guestHistory, language);
        const conversationInstructions = this.getConversationInstructions(conversationContext);
        const nameClariticationInstructions = this.getNameClarificationInstructions(conversationContext);
        const businessHoursInstructions = this.getBusinessHoursInstructions();

        const languageInstruction = `🌍 LANGUAGE: Respond in ${language} with warm, professional tone.`;

        return `You are Sofia, the friendly booking specialist for ${this.restaurantConfig.name}.

${languageInstruction}

🎯 YOUR ROLE: Natural Conversation Expert
You create smooth, efficient booking experiences by using available context intelligently and maintaining natural conversation flow.

🏪 RESTAURANT DETAILS:
- Name: ${this.restaurantConfig.name}
- Cuisine: ${this.restaurantConfig.cuisine || 'Excellent dining'}
- Hours: ${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime}
- Timezone: ${this.restaurantConfig.timezone}
${isOvernightOperation(this.restaurantConfig.openingTime || '09:00', this.restaurantConfig.closingTime || '23:00') ? 
  '- ⚠️ OVERNIGHT OPERATION: Open past midnight' : ''}

📅 DATE CONTEXT:
- TODAY: ${dateContext.currentDate} (${dateContext.dayOfWeek})
- TOMORROW: ${dateContext.tomorrowDate}
- Current time: ${dateContext.currentTime}
- Restaurant status: ${dateContext.isOpen ? 'OPEN' : 'CLOSED'}

🔧 SYSTEM INTEGRATION:
✅ The conversation manager handles:
- Context-aware information extraction (BUG-00181 FIXED)
- Safe guest history usage (BUG-00182 FIXED)  
- Detailed confirmation messages (BUG-00183 FIXED)
- Validation and hallucination prevention

🎯 YOUR FOCUS:
- Natural, flowing conversations
- Intelligent use of available context
- Efficient information gathering
- Warm, welcoming customer service
- Name clarification handling

${businessHoursInstructions}

${nameClariticationInstructions}

${conversationInstructions}

${personalizedSection}

🔧 ENHANCED TOOL UNDERSTANDING:
All tools return standardized responses:
- tool_status: 'SUCCESS' or 'FAILURE'
- data: (success) actual result
- error: (failure) categorized error info
- metadata: validation details

KEY ERROR TYPES:
- VALIDATION_ERROR: Input format issues → Guide user with examples
- BUSINESS_RULE: No availability, policies → Suggest alternatives
- NAME_CLARIFICATION_NEEDED: User has different name in profile → Ask for choice
- PAST_DATE_BOOKING: Booking in past → Ask for future date
- BUSINESS_HOURS_VIOLATION: Outside operating hours → Suggest valid times

🤝 CONVERSATION STYLE:
- Warm and welcoming like a friendly hostess
- Acknowledge information already provided
- Guide efficiently through booking process
- Show enthusiasm: "I'd love to help you with that!"
- Celebrate successful bookings: "🎉 Your table is reserved!"
- Handle errors gracefully with helpful alternatives

💡 CONVERSATION FLOW EXAMPLES:
Guest: "I need a table for tonight"
Sofia: "Perfect! For tonight (${dateContext.currentDate}), how many guests and what time works best?"

Guest: "Can I book for tomorrow evening?"
Sofia: "Absolutely! For tomorrow (${dateContext.tomorrowDate}) evening, what time and how many people?"

🎉 SUCCESS CONFIRMATION:
When create_reservation succeeds: "🎉 Your reservation is confirmed! Confirmation #[reservationId]."`;
    }

    /**
     * Handle messages with focus on conversation flow and name clarification
     */
    async handleMessage(message: string, context: AgentContext): Promise<AgentResponse> {
        const startTime = Date.now();

        try {
            this.logAgentAction('Processing message with optimized Sofia agent', {
                messageLength: message.length,
                language: context.language,
                hasGuestHistory: !!context.guestHistory,
                hasPendingConfirmation: !!context.conversationContext?.pendingConfirmation
            });

            // 🚨 CRITICAL: Handle pending name clarification
            if (context.conversationContext?.pendingConfirmation?.type === 'name_clarification') {
                return await this.handleNameClarificationResponse(message, context);
            }

            // 🎯 First message - intelligent greeting
            if (context.conversationContext?.sessionTurnCount === 1) {
                const greeting = this.generateIntelligentGreeting(context);
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

            // Regular message processing
            const systemPrompt = this.generateSystemPrompt(context);
            const response = await this.generateResponse(
                `${systemPrompt}\n\nUser: ${message}`,
                {
                    model: 'sonnet',
                    context: 'sofia-optimized-conversation',
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
                    optimizedVersion: true
                }
            };

        } catch (error) {
            return this.handleAgentError(error as Error, 'handleMessage', message);
        }
    }

    /**
     * 🚨 CRITICAL: Handle name clarification to prevent infinite loops
     */
    private async handleNameClarificationResponse(message: string, context: AgentContext): Promise<AgentResponse> {
        const startTime = Date.now();
        const pendingConfirmation = context.conversationContext?.pendingConfirmation;
        
        if (!pendingConfirmation || pendingConfirmation.type !== 'name_clarification') {
            throw new Error('Invalid pending confirmation state');
        }

        try {
            this.logAgentAction('Handling name clarification - preventing infinite loop', {
                userMessage: message,
                dbName: pendingConfirmation.dbName,
                requestName: pendingConfirmation.requestName
            });

            // Extract user's name choice
            const chosenName = this.extractNameChoice(
                message, 
                pendingConfirmation.dbName, 
                pendingConfirmation.requestName
            );

            if (!chosenName) {
                // Last resort - ultra-clear options
                const clarificationMessage = this.generateNameClarificationFallback(
                    context.language,
                    pendingConfirmation.dbName,
                    pendingConfirmation.requestName
                );
                
                return {
                    content: clarificationMessage,
                    metadata: {
                        processedAt: new Date().toISOString(),
                        agentType: this.name,
                        confidence: 0.7,
                        processingTimeMs: Date.now() - startTime,
                        action: 'clarification_fallback'
                    }
                };
            }

            // SUCCESS: Proceed with chosen name
            this.logAgentAction('Name choice extracted - breaking infinite loop', {
                extractedName: chosenName
            });

            const proceedMessage = this.generateBookingProceedMessage(
                context.language,
                chosenName,
                pendingConfirmation.originalBookingData
            );

            return {
                content: proceedMessage,
                metadata: {
                    processedAt: new Date().toISOString(),
                    agentType: this.name,
                    confidence: 0.95,
                    processingTimeMs: Date.now() - startTime,
                    action: 'name_choice_extracted',
                    chosenName: chosenName,
                    infiniteLoopFixed: true
                }
            };

        } catch (error) {
            return this.handleAgentError(error as Error, 'handleNameClarificationResponse', message);
        }
    }

    /**
     * Extract name choice from user response using robust pattern matching
     */
    private extractNameChoice(userMessage: string, dbName: string, requestName: string): string | null {
        const message = userMessage.toLowerCase().trim();
        
        // Pattern 1: Direct exact name match
        if (message === dbName.toLowerCase()) return dbName;
        if (message === requestName.toLowerCase()) return requestName;

        // Pattern 2: Name appears in message
        if (message.includes(dbName.toLowerCase())) return dbName;
        if (message.includes(requestName.toLowerCase())) return requestName;

        // Pattern 3: Common patterns with names
        const usePatterns = [
            /use\s+(.+)/i,
            /go\s+with\s+(.+)/i,
            /choose\s+(.+)/i,
            /использ.+\s+(.+)/i,
            /хочу\s+(.+)/i,
            /korist.+\s+(.+)/i,
            /želim\s+(.+)/i,
            /(.+)\s+(пожалуйста|please|molim)/i,
        ];

        for (const pattern of usePatterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                const extractedName = match[1].trim();
                if (extractedName.toLowerCase() === dbName.toLowerCase()) return dbName;
                if (extractedName.toLowerCase() === requestName.toLowerCase()) return requestName;
            }
        }

        // Pattern 4: Yes/No responses
        if (/^(да|yes|ok|good|отлично)/i.test(message)) return requestName;
        if (/^(нет|no|not|неправильно)/i.test(message)) return dbName;

        // Pattern 5: Fuzzy matching for typos
        const names = [dbName, requestName];
        for (const name of names) {
            if (name.length > 3) {
                const distance = this.calculateLevenshteinDistance(message, name.toLowerCase());
                if (distance <= 2) return name;
            }
        }

        return null;
    }

    /**
     * Calculate Levenshtein distance for fuzzy matching
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
     * Generate fallback clarification with ultra-clear options
     */
    private generateNameClarificationFallback(language: Language, dbName: string, requestName: string): string {
        const messages = {
            en: `Please choose which name to use. Type either:
1. "${dbName}" (existing profile)
2. "${requestName}" (new name)

Just type the name you prefer.`,
            ru: `Пожалуйста, выберите имя. Напишите:
1. "${dbName}" (из профиля)
2. "${requestName}" (новое имя)

Просто напишите предпочитаемое имя.`,
            sr: `Molim vas izaberite ime. Napišite:
1. "${dbName}" (iz profila)
2. "${requestName}" (novo ime)

Samo napišite ime koje preferirate.`,
            auto: `Please choose which name to use. Type either:
1. "${dbName}" (existing profile)
2. "${requestName}" (new name)

Just type the name you prefer.`
        };

        return messages[language] || messages.auto;
    }

    /**
     * Generate booking proceed message after name choice
     */
    private generateBookingProceedMessage(language: Language, chosenName: string, bookingData: any): string {
        const { date, time, guests } = bookingData;
        
        const messages = {
            en: `Perfect! Creating your reservation for "${chosenName}" - ${guests} guests on ${date} at ${time}. Processing now...`,
            ru: `Отлично! Создаю бронь для "${chosenName}" - ${guests} человек на ${date} в ${time}. Обрабатываю...`,
            sr: `Odlično! Napravim rezervaciju za "${chosenName}" - ${guests} osoba za ${date} u ${time}. Obrađujem...`,
            auto: `Perfect! Creating your reservation for "${chosenName}" - ${guests} guests on ${date} at ${time}. Processing now...`
        };

        return messages[language] || messages.auto;
    }

    /**
     * Get name clarification instructions
     */
    private getNameClarificationInstructions(conversationContext?: ConversationContext): string {
        const pendingConfirmation = conversationContext?.pendingConfirmation;
        
        if (pendingConfirmation && pendingConfirmation.type === 'name_clarification') {
            return `
🚨 CRITICAL: NAME CLARIFICATION MODE ACTIVE - INFINITE LOOP PREVENTION

**PENDING STATE:**
- Database name: "${pendingConfirmation.dbName}"
- Requested name: "${pendingConfirmation.requestName}"
- Original booking: ${JSON.stringify(pendingConfirmation.originalBookingData)}

**YOUR TASK:** Extract user's name choice and proceed with booking.

**VALID RESPONSE PATTERNS:**
✅ "${pendingConfirmation.requestName}" → Use "${pendingConfirmation.requestName}"
✅ "${pendingConfirmation.dbName}" → Use "${pendingConfirmation.dbName}"
✅ "use ${pendingConfirmation.requestName}" → Use "${pendingConfirmation.requestName}"
✅ "да" → Use "${pendingConfirmation.requestName}"
✅ "нет" → Use "${pendingConfirmation.dbName}"

**CRITICAL:** Extract choice immediately and proceed with booking. DO NOT ask clarification again.`;
        }
        
        return `
🚨 NAME CLARIFICATION HANDLING:

**WHEN create_reservation RETURNS NAME_CLARIFICATION_NEEDED:**
1. Ask clear choice question in user's language
2. Extract user's response in next turn
3. Proceed with booking using chosen name
4. NEVER repeat the clarification question

**EXAMPLE FLOW:**
Error → "Which name: '[dbName]' or '[requestName]'?" → User choice → Extract → Book → SUCCESS

This prevents infinite clarification loops.`;
    }

    /**
     * Generate intelligent greeting based on context
     */
    private generateIntelligentGreeting(context: AgentContext): string {
        const { guestHistory, language, conversationContext } = context;

        // Subsequent booking
        if (conversationContext?.isSubsequentBooking) {
            return this.getSubsequentBookingGreeting(guestHistory, language);
        }

        // New guest
        if (!guestHistory || guestHistory.total_bookings === 0) {
            return this.getNewGuestGreeting(language);
        }

        // Returning guest
        return this.getReturningGuestGreeting(guestHistory, language);
    }

    /**
     * Get returning guest greeting - intelligent context usage
     */
    private getReturningGuestGreeting(guestHistory: GuestHistory, language: Language): string {
        const { guest_name, guest_phone, total_bookings, common_party_size } = guestHistory;
        const isRegular = total_bookings >= 3;

        if (isRegular) {
            const greetings = {
                en: `Hi ${guest_name}! Great to see you again! I can use your details (${guest_phone})${common_party_size ? ` for ${common_party_size} people` : ''}. What date and time work?`,
                ru: `Привет, ${guest_name}! Рад снова видеть! Использую ваши данные (${guest_phone})${common_party_size ? ` на ${common_party_size} человек` : ''}. Какие дата и время?`,
                sr: `Zdravo, ${guest_name}! Drago mi je! Koristim vaše podatke (${guest_phone})${common_party_size ? ` za ${common_party_size} osoba` : ''}. Koji datum i vreme?`,
                auto: `Hi ${guest_name}! Great to see you again! I can use your details (${guest_phone})${common_party_size ? ` for ${common_party_size} people` : ''}. What date and time work?`
            };
            return greetings[language] || greetings.auto;
        } else {
            const greetings = {
                en: `Hello, ${guest_name}! Nice to see you again! I can use your details (${guest_phone}). What date and time?`,
                ru: `Здравствуйте, ${guest_name}! Приятно снова видеть! Использую ваши данные (${guest_phone}). Какие дата и время?`,
                sr: `Zdravo, ${guest_name}! Drago mi je! Koristim vaše podatke (${guest_phone}). Koji datum i vreme?`,
                auto: `Hello, ${guest_name}! Nice to see you again! I can use your details (${guest_phone}). What date and time?`
            };
            return greetings[language] || greetings.auto;
        }
    }

    /**
     * Get new guest greeting
     */
    private getNewGuestGreeting(language: Language): string {
        const greetings = {
            en: `Hello! I'd love to help you with a reservation. What date and time work for you, and how many guests?`,
            ru: `Здравствуйте! Помогу с бронированием. Какие дата и время, и на сколько человек?`,
            sr: `Zdravo! Pomoći ću sa rezervacijom. Koji datum i vreme, i koliko osoba?`,
            auto: `Hello! I'd love to help you with a reservation. What date and time work for you, and how many guests?`
        };
        return greetings[language] || greetings.auto;
    }

    /**
     * Get subsequent booking greeting
     */
    private getSubsequentBookingGreeting(guestHistory: GuestHistory | null, language: Language): string {
        const greetings = {
            en: `Perfect! I can help with another reservation. What date and time would you like?`,
            ru: `Отлично! Помогу с ещё одной бронью. Какие дата и время?`,
            sr: `Odlično! Pomoći ću sa još jednom rezervacijom. Koji datum i vreme?`,
            auto: `Perfect! I can help with another reservation. What date and time would you like?`
        };
        return greetings[language] || greetings.auto;
    }

    /**
     * Get personalized section - streamlined
     */
    private getPersonalizedSection(guestHistory: GuestHistory | null, language: Language): string {
        if (!guestHistory || guestHistory.total_bookings === 0) {
            return '';
        }

        const { guest_name, guest_phone, total_bookings, common_party_size } = guestHistory;

        return `
👤 GUEST CONTEXT (MANAGED BY CORE SYSTEM):
- Guest: ${guest_name} ✅ (Known)
- Phone: ${guest_phone} ✅ (Known)  
- Visits: ${total_bookings}
${common_party_size ? `- Usual size: ${common_party_size}` : ''}

🎯 INTELLIGENT USAGE:
- Use known details proactively and naturally
- Only ask for missing information
- Be welcoming for returning guests (${total_bookings >= 3 ? 'REGULAR' : 'RETURNING'})
- 🔒 Guest history safety handled by conversation manager`;
    }

    /**
     * Get conversation instructions
     */
    private getConversationInstructions(conversationContext?: ConversationContext): string {
        if (!conversationContext) return '';

        return `
📝 CONVERSATION CONTEXT:
- Turn: ${conversationContext.sessionTurnCount || 1}
- Asked Party Size: ${conversationContext.hasAskedPartySize ? 'YES - DON\'T ASK AGAIN' : 'NO'}
- Asked Date: ${conversationContext.hasAskedDate ? 'YES - DON\'T ASK AGAIN' : 'NO'}
- Asked Time: ${conversationContext.hasAskedTime ? 'YES - DON\'T ASK AGAIN' : 'NO'}
- Asked Name: ${conversationContext.hasAskedName ? 'YES - DON\'T ASK AGAIN' : 'NO'}
- Asked Phone: ${conversationContext.hasAskedPhone ? 'YES - DON\'T ASK AGAIN' : 'NO'}
${conversationContext.pendingConfirmation ? '- 🚨 PENDING: Name clarification' : ''}

⚡ EFFICIENCY RULES:
- Only ask for missing information
- Acknowledge information already provided
- Use natural, flowing conversation
- Avoid repetitive questions`;
    }

    /**
     * Get business hours instructions
     */
    private getBusinessHoursInstructions(): string {
        const openingTime = this.restaurantConfig.openingTime || '09:00';
        const closingTime = this.restaurantConfig.closingTime || '23:00';
        const isOvernight = isOvernightOperation(openingTime, closingTime);

        return `
🕐 BUSINESS HOURS GUIDANCE:
- Hours: ${openingTime} - ${closingTime}${isOvernight ? ' (next day)' : ''}
- Timezone: ${this.restaurantConfig.timezone}
${isOvernight ? '- ⚠️ OVERNIGHT: Open past midnight' : ''}

💡 HELPFUL GUIDANCE:
- Mention hours when suggesting times
- Guide users toward valid times
- Be understanding about timing constraints
${isOvernight ? '- Celebrate late availability: "Great! We\'re open until ' + closingTime + '!"' : ''}`;
    }

    /**
     * Get restaurant context
     */
    private getRestaurantContext() {
        try {
            const timezone = this.restaurantConfig.timezone;
            const restaurantContext = getRestaurantTimeContext(timezone);
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
                isOpen: operatingStatus.isOpen
            };
        } catch (error) {
            const now = DateTime.now();
            return {
                currentDate: now.toISODate(),
                tomorrowDate: now.plus({ days: 1 }).toISODate(),
                currentTime: now.toFormat('HH:mm'),
                dayOfWeek: now.toFormat('cccc'),
                isOpen: true
            };
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
     * Compatibility methods
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

    getPersonalizedGreeting(guestHistory: GuestHistory | null, language: Language, context: 'hostess' | 'guest', conversationContext?: ConversationContext): string {
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