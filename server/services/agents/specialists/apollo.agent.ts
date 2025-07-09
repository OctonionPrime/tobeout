// server/services/agents/specialists/apollo.agent.ts
// ✅ ENHANCED: Apollo agent with comprehensive timezone utilities integration and operating hours validation
// Handles availability recovery, alternative time suggestions, and failure handling

import OpenAI from 'openai';
import type { 
    AgentType, 
    Language,
    AgentContext,
    AgentResponse,
    BookingSessionWithAgent,
    GuestHistory,
    RestaurantConfig,
    UnifiedToolContext
} from '../core/agent.types';
import { AIFallbackService } from '../../ai/ai-fallback.service';
import { UnifiedTranslationService } from '../../ai/translation.service';
import { 
    getRestaurantTimeContext,
    getRestaurantOperatingStatus,
    isOvernightOperation,
    formatTimeForRestaurant,
    validateBookingDateTime,
    isValidTimezone
} from '../../../utils/timezone-utils';

// Import tools
import { bookingTools } from '../tools/booking.tools';

/**
 * Availability failure context interface
 */
interface AvailabilityFailureContext {
    originalDate: string;
    originalTime: string;
    originalGuests: number;
    failureReason: string;
    detectedAt: string;
}

/**
 * Apollo Agent - Specialist for availability recovery and alternative time suggestions
 * Uses OpenAI function calling for reliable tool execution with timezone validation
 */
export class ApolloAgent {
    readonly name = 'Apollo';
    readonly capabilities = [
        'alternative_times',
        'availability_recovery',
        'failure_handling',
        'time_suggestions'
    ];
    readonly agentType: AgentType = 'availability';

    private openaiClient: OpenAI;

    constructor(
        private aiService: AIFallbackService,
        private translationService: UnifiedTranslationService,
        private restaurantConfig: RestaurantConfig
    ) {
        this.openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY!
        });
    }

    /**
     * ✅ NEW: Validate alternative time against operating hours
     */
    private validateAlternativeTime(time: string, date?: string): {
        isValid: boolean;
        isWithinHours: boolean;
        reason?: string;
        operatingInfo?: string;
    } {
        // Validate timezone first
        if (!isValidTimezone(this.restaurantConfig.timezone)) {
            console.warn(`[ApolloAgent] Invalid restaurant timezone: ${this.restaurantConfig.timezone}`);
            return {
                isValid: false,
                isWithinHours: false,
                reason: 'Invalid restaurant timezone configuration'
            };
        }

        // Use current date if not provided
        const validationDate = date || getRestaurantTimeContext(this.restaurantConfig.timezone).currentDate;

        // Validate alternative time against operating hours
        const validation = validateBookingDateTime(
            validationDate,
            time,
            this.restaurantConfig.timezone,
            this.restaurantConfig.openingTime,
            this.restaurantConfig.closingTime
        );

        const operatingStatus = getRestaurantOperatingStatus(
            this.restaurantConfig.timezone,
            this.restaurantConfig.openingTime,
            this.restaurantConfig.closingTime
        );

        return {
            isValid: validation.isValid,
            isWithinHours: validation.isWithinHours,
            reason: validation.reason,
            operatingInfo: `Operating hours: ${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime}${operatingStatus.isOvernightOperation ? ' (overnight)' : ''}`
        };
    }

    /**
     * ✅ NEW: Get enhanced operating status for context
     */
    private getEnhancedOperatingContext(): {
        status: string;
        message: string;
        isOvernightOperation: boolean;
        operatingHours: string;
        timezoneInfo: string;
    } {
        try {
            const operatingStatus = getRestaurantOperatingStatus(
                this.restaurantConfig.timezone,
                this.restaurantConfig.openingTime,
                this.restaurantConfig.closingTime
            );

            const isOvernight = isOvernightOperation(
                this.restaurantConfig.openingTime,
                this.restaurantConfig.closingTime
            );

            return {
                status: operatingStatus.status,
                message: operatingStatus.message,
                isOvernightOperation: isOvernight,
                operatingHours: `${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime}${isOvernight ? ' (overnight)' : ''}`,
                timezoneInfo: `${this.restaurantConfig.timezone} timezone`
            };
        } catch (error) {
            console.warn(`[ApolloAgent] Error getting operating context:`, error);
            return {
                status: 'unknown',
                message: 'Operating status unavailable',
                isOvernightOperation: false,
                operatingHours: `${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime}`,
                timezoneInfo: `${this.restaurantConfig.timezone} timezone`
            };
        }
    }

    /**
     * Generate comprehensive system prompt for Apollo with enhanced timezone context
     */
    private getSystemPrompt(
        context: 'hostess' | 'guest',
        userLanguage: Language = 'en',
        guestHistory?: GuestHistory | null,
        isFirstMessage: boolean = false,
        conversationContext?: any,
        availabilityFailureContext?: AvailabilityFailureContext
    ): string {
        // ✅ ENHANCED: Use timezone utilities with validation
        let dateContext;
        let operatingContext;
        
        try {
            // Validate timezone before using it
            if (!isValidTimezone(this.restaurantConfig.timezone)) {
                console.warn(`[ApolloAgent] Invalid timezone: ${this.restaurantConfig.timezone}, falling back to Belgrade`);
                this.restaurantConfig.timezone = 'Europe/Belgrade';
            }

            dateContext = getRestaurantTimeContext(this.restaurantConfig.timezone);
            operatingContext = this.getEnhancedOperatingContext();
        } catch (error) {
            console.error(`[ApolloAgent] Error getting timezone context:`, error);
            // Fallback to basic context
            const now = new Date();
            dateContext = {
                currentDate: now.toISOString().split('T')[0],
                currentTime: now.toTimeString().slice(0, 5),
                timezone: this.restaurantConfig.timezone
            };
            operatingContext = {
                status: 'unknown',
                message: 'Operating status unavailable',
                isOvernightOperation: false,
                operatingHours: `${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime}`,
                timezoneInfo: `${this.restaurantConfig.timezone} timezone`
            };
        }

        const languageInstruction = `🌍 CRITICAL LANGUAGE RULE:
- User's language: ${userLanguage}
- You MUST respond in ${userLanguage} for ALL messages
- Maintain warm, professional tone in ${userLanguage}
- If unsure of translation, use simple clear ${userLanguage}`;

        const failureContextSection = availabilityFailureContext ? `
🚨 AVAILABILITY FAILURE CONTEXT:
- Original failed request: ${availabilityFailureContext.originalDate} at ${availabilityFailureContext.originalTime} for ${availabilityFailureContext.originalGuests} guests
- You MUST immediately call find_alternative_times with these exact parameters
- Do not ask the user for clarification - they already provided this information
- Validate suggested alternatives against operating hours before presenting them` : '';

        const conversationInstructions = conversationContext ? `
📝 CONVERSATION CONTEXT:
- Session Turn: ${conversationContext.sessionTurnCount || 1}
- This is a handoff from another agent due to availability failure
- User is looking for alternative times after their first choice was unavailable
- Focus on finding times within operating hours when possible` : '';

        const operatingHoursSection = `
🏪 RESTAURANT OPERATING STATUS:
- Status: ${operatingContext.status}
- ${operatingContext.message}
- Operating Hours: ${operatingContext.operatingHours}
- Timezone: ${operatingContext.timezoneInfo}
${operatingContext.isOvernightOperation ? `- OVERNIGHT OPERATION: Restaurant operates across days` : ''}
- Always prioritize alternatives within operating hours
- If suggesting times outside hours, clearly indicate this to the guest`;

        const timezoneValidationSection = `
🕐 TIMEZONE & ALTERNATIVE TIME VALIDATION:
- Restaurant Timezone: ${this.restaurantConfig.timezone} (validated)
- Validate ALL suggested alternatives against operating hours
- For overnight operations, handle cross-day suggestions properly
- Use timezone-aware formatting for all time displays
- Prioritize times within operating hours in suggestions`;

        return `You are Apollo, a specialist Availability Agent. Your only job is to help a user find an alternative time after their first choice was unavailable.

${languageInstruction}

🎯 YOUR MANDATORY WORKFLOW:
1. The user's previous attempt to book or modify a reservation has FAILED due to no availability.
2. Your first action MUST be to call the 'find_alternative_times' tool. Use the details (date, time, guests) from the previously failed attempt.
3. Validate suggested alternatives against operating hours and prioritize times within operating hours.
4. Clearly present the available times that the tool returns, with operating hours context. Do not suggest any times not returned by the tool.
5. Once the user chooses a time, your job is complete. End your response with a clear signal like "Great, I'll hand you back to finalize that."

❌ FORBIDDEN ACTIONS:
- Do not ask for the user's name, phone, or any other personal details.
- Do not call any tools other than 'find_alternative_times' and 'check_availability'.
- Do not try to complete the booking yourself.
- NEVER suggest times that weren't returned by the find_alternative_times tool.
- NEVER hallucinate availability - only use tool results.
- Do not suggest times outside operating hours without clear warning.

✅ REQUIRED PATTERN:
1. Immediately call find_alternative_times with the failed booking parameters
2. Validate alternatives against operating hours
3. Present the alternatives clearly with operating hours context: "I found these available times within our operating hours: 18:30, 19:15, 20:00"
4. If alternatives are outside hours, note this: "I also found 22:30 (after normal hours) - would that work?"
5. When user selects one, confirm and hand back: "Perfect! 19:15 works. I'll hand you back to complete the booking."

📅 CURRENT DATE CONTEXT:
- TODAY is ${dateContext.currentDate}
- Current time: ${dateContext.currentTime} in ${dateContext.timezone}

${operatingHoursSection}

${timezoneValidationSection}

🏪 RESTAURANT INFO:
- Name: ${this.restaurantConfig.name}
- Timezone: ${this.restaurantConfig.timezone}

${failureContextSection}

${conversationInstructions}

This focused approach prevents availability hallucination and ensures accurate alternative suggestions with proper operating hours validation.`;
    }

    /**
     * Get OpenAI tools for Apollo's capabilities
     */
    private getOpenAITools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
        return [
            {
                type: "function",
                function: {
                    name: "find_alternative_times",
                    description: "Finds alternative available time slots around a user's preferred time with timezone validation and operating hours awareness. This is the primary tool for this agent.",
                    parameters: {
                        type: "object",
                        properties: {
                            date: {
                                type: "string",
                                pattern: "^\\d{4}-\\d{2}-\\d{2}$",
                                description: "Date in yyyy-MM-dd format"
                            },
                            preferredTime: {
                                type: "string",
                                pattern: "^\\d{1,2}:\\d{2}$",
                                description: "Preferred time in HH:MM format from the failed booking attempt"
                            },
                            guests: {
                                type: "integer",
                                minimum: 1,
                                maximum: 50,
                                description: "Number of guests"
                            }
                        },
                        required: ["date", "preferredTime", "guests"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "check_availability",
                    description: "Quickly confirms if a single time chosen by the user from the suggested alternatives is still available with timezone validation.",
                    parameters: {
                        type: "object",
                        properties: {
                            date: {
                                type: "string",
                                pattern: "^\\d{4}-\\d{2}-\\d{2}$",
                                description: "Date in yyyy-MM-dd format"
                            },
                            time: {
                                type: "string",
                                pattern: "^\\d{1,2}:\\d{2}$",
                                description: "Time in HH:MM format"
                            },
                            guests: {
                                type: "integer",
                                minimum: 1,
                                maximum: 50,
                                description: "Number of guests"
                            }
                        },
                        required: ["date", "time", "guests"]
                    }
                }
            }
        ];
    }

    /**
     * ✅ ENHANCED: Format alternative times with comprehensive timezone-aware display and operating hours validation
     */
    private formatAlternativeTimes(alternatives: any[], language: Language, timezone: string): string {
        if (!alternatives || alternatives.length === 0) {
            const noAlternativesMessages = {
                en: "I'm sorry, but I couldn't find any alternative times for your request.",
                ru: "К сожалению, я не смог найти альтернативное время для вашего запроса.",
                sr: "Žao mi je, ali nisam mogao da pronađem alternativno vreme za vaš zahtev.",
                hu: "Sajnálom, de nem tudtam alternatív időpontot találni a kérésére.",
                de: "Es tut mir leid, aber ich konnte keine alternativen Zeiten für Ihre Anfrage finden.",
                fr: "Je suis désolé, mais je n'ai pas pu trouver d'heures alternatives pour votre demande.",
                es: "Lo siento, pero no pude encontrar horarios alternativos para su solicitud.",
                it: "Mi dispiace, ma non sono riuscito a trovare orari alternativi per la sua richiesta.",
                pt: "Desculpe, mas não consegui encontrar horários alternativos para sua solicitação.",
                nl: "Het spijt me, maar ik kon geen alternatieve tijden vinden voor uw verzoek.",
                auto: "I'm sorry, but I couldn't find any alternative times for your request."
            };
            return noAlternativesMessages[language] || noAlternativesMessages.en;
        }

        // ✅ ENHANCED: Separate alternatives by operating hours status
        const withinHours: any[] = [];
        const outsideHours: any[] = [];

        alternatives.slice(0, 8).forEach(alt => { // Show max 8 alternatives
            const timeToValidate = alt.timeDisplay || alt.time;
            const validation = this.validateAlternativeTime(timeToValidate);
            
            if (validation.isWithinHours) {
                withinHours.push({
                    ...alt,
                    displayTime: this.formatTimeWithTimezone(timeToValidate, timezone, language)
                });
            } else {
                outsideHours.push({
                    ...alt,
                    displayTime: this.formatTimeWithTimezone(timeToValidate, timezone, language),
                    outsideHoursReason: validation.reason
                });
            }
        });

        // Build response message
        let response = '';
        
        if (withinHours.length > 0) {
            const timesListWithinHours = withinHours
                .map(alt => alt.displayTime)
                .join(', ');

            const withinHoursMessages = {
                en: `I found these available times within our operating hours: ${timesListWithinHours}.`,
                ru: `Я нашел эти доступные времена в рабочие часы: ${timesListWithinHours}.`,
                sr: `Pronašao sam ova dostupna vremena tokom radnog vremena: ${timesListWithinHours}.`,
                hu: `Ezeket a szabad időpontokat találtam a nyitvatartási időben: ${timesListWithinHours}.`,
                de: `Ich habe diese verfügbaren Zeiten während unserer Öffnungszeiten gefunden: ${timesListWithinHours}.`,
                fr: `J'ai trouvé ces heures disponibles pendant nos heures d'ouverture: ${timesListWithinHours}.`,
                es: `Encontré estos horarios disponibles durante nuestro horario de atención: ${timesListWithinHours}.`,
                it: `Ho trovato questi orari disponibili durante i nostri orari di apertura: ${timesListWithinHours}.`,
                pt: `Encontrei estes horários disponíveis durante nosso horário de funcionamento: ${timesListWithinHours}.`,
                nl: `Ik heb deze beschikbare tijden gevonden tijdens onze openingstijden: ${timesListWithinHours}.`,
                auto: `I found these available times within our operating hours: ${timesListWithinHours}.`
            };

            response = withinHoursMessages[language] || withinHoursMessages.en;
        }

        if (outsideHours.length > 0) {
            const timesListOutsideHours = outsideHours
                .map(alt => alt.displayTime)
                .join(', ');

            const outsideHoursMessages = {
                en: ` I also found ${timesListOutsideHours} outside normal hours - would any of these work?`,
                ru: ` Также я нашел ${timesListOutsideHours} вне обычных часов работы - подойдет ли что-то из этого?`,
                sr: ` Takođe sam pronašao ${timesListOutsideHours} van normalnog radnog vremena - da li bi nešto od ovoga odgovaralo?`,
                hu: ` ${timesListOutsideHours} időpontokat is találtam a normál nyitvatartáson kívül - megfelelne ezek közül valamelyik?`,
                de: ` Ich fand auch ${timesListOutsideHours} außerhalb der normalen Öffnungszeiten - würde einer davon passen?`,
                fr: ` J'ai aussi trouvé ${timesListOutsideHours} en dehors des heures normales - est-ce que l'un d'eux conviendrait?`,
                es: ` También encontré ${timesListOutsideHours} fuera del horario normal - ¿alguno de estos funcionaría?`,
                it: ` Ho anche trovato ${timesListOutsideHours} fuori dagli orari normali - andrebbe bene uno di questi?`,
                pt: ` Também encontrei ${timesListOutsideHours} fora do horário normal - algum destes funcionaria?`,
                nl: ` Ik vond ook ${timesListOutsideHours} buiten de normale openingstijden - zou een van deze werken?`,
                auto: ` I also found ${timesListOutsideHours} outside normal hours - would any of these work?`
            };

            response += outsideHoursMessages[language] || outsideHoursMessages.en;
        }

        if (withinHours.length === 0 && outsideHours.length === 0) {
            return alternatives.length > 0 
                ? "I found some alternatives but couldn't validate them against operating hours. Please let me know which time works for you."
                : "I couldn't find any alternative times for your request.";
        }

        // Add closing question
        const closingQuestions = {
            en: " Which one works best for you?",
            ru: " Какое вам больше подходит?",
            sr: " Koje vam najbolje odgovara?",
            hu: " Melyik felel meg legjobban?",
            de: " Welche passt Ihnen am besten?",
            fr: " Laquelle vous convient le mieux?",
            es: " ¿Cuál te conviene más?",
            it: " Quale ti va meglio?",
            pt: " Qual funciona melhor para você?",
            nl: " Welke past het beste voor u?",
            auto: " Which one works best for you?"
        };

        response += closingQuestions[language] || closingQuestions.en;

        return response;
    }

    /**
     * ✅ NEW: Format time with timezone awareness
     */
    private formatTimeWithTimezone(time: string, timezone: string, language: Language): string {
        try {
            return formatTimeForRestaurant(time, timezone, language, false);
        } catch (error) {
            console.warn(`[ApolloAgent] Time formatting error for ${time}:`, error);
            return time; // Fallback to original
        }
    }

    /**
     * Generate completion signal for handoff back to primary agent
     */
    private generateCompletionSignal(selectedTime: string, language: Language): string {
        const completionMessages = {
            en: `Perfect! ${selectedTime} works. I'll hand you back to complete the booking.`,
            ru: `Отлично! ${selectedTime} подходит. Передаю вас обратно для завершения бронирования.`,
            sr: `Savršeno! ${selectedTime} odgovara. Vraćam vas da završite rezervaciju.`,
            hu: `Tökéletes! ${selectedTime} megfelelő. Visszaadom önt a foglalás befejezéséhez.`,
            de: `Perfekt! ${selectedTime} passt. Ich gebe Sie zurück, um die Buchung abzuschließen.`,
            fr: `Parfait! ${selectedTime} convient. Je vous rends pour finaliser la réservation.`,
            es: `¡Perfecto! ${selectedTime} funciona. Te devuelvo para completar la reserva.`,
            it: `Perfetto! ${selectedTime} va bene. Ti rimando per completare la prenotazione.`,
            pt: `Perfeito! ${selectedTime} funciona. Vou devolvê-lo para completar a reserva.`,
            nl: `Perfect! ${selectedTime} werkt. Ik geef je terug om de boeking af te ronden.`,
            auto: `Perfect! ${selectedTime} works. I'll hand you back to complete the booking.`
        };

        return completionMessages[language] || completionMessages.en;
    }

    /**
     * Detect if Apollo has completed his task based on user selection
     */
    private isTaskComplete(message: string, alternatives: any[]): { complete: boolean; selectedTime?: string } {
        if (!alternatives || alternatives.length === 0) {
            return { complete: false };
        }

        const lowerMessage = message.toLowerCase().trim();
        
        // Check if user selected one of the suggested times
        for (const alt of alternatives) {
            const timeDisplay = alt.timeDisplay || alt.time;
            if (lowerMessage.includes(timeDisplay.toLowerCase())) {
                return { complete: true, selectedTime: timeDisplay };
            }
        }

        // Check for confirmation words that might indicate acceptance
        const confirmationWords = [
            'yes', 'ok', 'okay', 'sure', 'good', 'fine', 'perfect',
            'да', 'хорошо', 'подходит', 'согласен', 'отлично',
            'da', 'dobro', 'u redu', 'odlično',
            'igen', 'jó', 'rendben', 'tökéletes',
            'ja', 'gut', 'okay', 'perfekt',
            'oui', 'bien', 'd\'accord', 'parfait',
            'sí', 'bueno', 'está bien', 'perfecto',
            'sì', 'bene', 'va bene', 'perfetto',
            'sim', 'bom', 'está bem', 'perfeito',
            'ja', 'goed', 'oké', 'perfect'
        ];

        if (confirmationWords.some(word => lowerMessage.includes(word))) {
            // If it's a confirmation but no specific time mentioned, use the first alternative within hours
            const firstValidAlternative = alternatives.find(alt => {
                const validation = this.validateAlternativeTime(alt.timeDisplay || alt.time);
                return validation.isWithinHours;
            }) || alternatives[0];
            
            return { complete: true, selectedTime: firstValidAlternative?.timeDisplay || firstValidAlternative?.time };
        }

        return { complete: false };
    }

    /**
     * Main message processing method using OpenAI function calling with timezone validation
     */
    async processMessage(
        message: string, 
        context: AgentContext
    ): Promise<AgentResponse> {
        console.log(`[ApolloAgent] Processing message: "${message}"`);

        try {
            // ✅ ENHANCED: Build unified tool context with timezone validation
            let effectiveTimezone = this.restaurantConfig.timezone;
            if (!isValidTimezone(effectiveTimezone)) {
                console.warn(`[ApolloAgent] Invalid timezone: ${effectiveTimezone}, falling back to Belgrade`);
                effectiveTimezone = 'Europe/Belgrade';
            }

            const toolContext: UnifiedToolContext = {
                restaurantId: context.restaurantId,
                timezone: effectiveTimezone,
                language: context.language,
                telegramUserId: context.telegramUserId,
                sessionId: context.sessionId,
                userMessage: message,
                session: context.session
            };

            // Get system prompt with failure context if available
            const systemPrompt = this.getSystemPrompt(
                context.session.context,
                context.language,
                context.guestHistory,
                context.session.conversationHistory.length === 0,
                context.conversationContext,
                context.session.availabilityFailureContext
            );

            // Build conversation history for AI
            const conversationHistory = context.session.conversationHistory
                .slice(-5)
                .map(msg => `${msg.role}: ${msg.content}`)
                .join('\n');

            const fullPrompt = `${systemPrompt}

Recent conversation:
${conversationHistory}

Current user message: "${message}"

Remember: Your only job is to find alternative times with operating hours validation and hand back to the booking agent once user selects one.`;

            // ✅ ENHANCED: Use OpenAI function calling with timezone validation
            const completion = await this.openaiClient.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: fullPrompt }],
                tools: this.getOpenAITools(),
                tool_choice: "auto",
                temperature: 0.2, // Lower temperature for more focused responses
                max_tokens: 1500
            });

            const assistantMessage = completion.choices[0]?.message;
            let responseContent = assistantMessage?.content || "I'll help you find alternative times.";
            const toolCalls = assistantMessage?.tool_calls || [];

            console.log(`[ApolloAgent] Generated response with ${toolCalls.length} tool calls`);

            // Execute tool calls if present with timezone validation
            const executedToolCalls = [];
            let alternatives = [];

            for (const toolCall of toolCalls) {
                try {
                    const toolResult = await this.executeToolCall(toolCall, toolContext);
                    executedToolCalls.push({
                        function: {
                            name: toolCall.function.name,
                            arguments: toolCall.function.arguments
                        },
                        id: toolCall.id,
                        result: toolResult
                    });

                    // Extract alternatives from tool results with validation
                    if (toolCall.function.name === 'find_alternative_times' && 
                        toolResult.tool_status === 'SUCCESS' && 
                        toolResult.data?.alternatives) {
                        alternatives = toolResult.data.alternatives;
                        // ✅ ENHANCED: Use timezone-aware formatting with operating hours validation
                        responseContent = this.formatAlternativeTimes(
                            alternatives, 
                            context.language,
                            effectiveTimezone
                        );
                    }

                } catch (error) {
                    console.error(`[ApolloAgent] Tool execution error:`, error);
                    executedToolCalls.push({
                        function: {
                            name: toolCall.function.name,
                            arguments: toolCall.function.arguments
                        },
                        id: toolCall.id,
                        result: {
                            tool_status: 'FAILURE',
                            error: {
                                type: 'SYSTEM_ERROR',
                                message: error.message || 'Unknown error'
                            }
                        }
                    });

                    const errorMessage = await this.translationService.translate(
                        `I encountered an error while finding alternative times. Please try again.`,
                        context.language,
                        'error'
                    );
                    responseContent = errorMessage;
                }
            }

            // Check if Apollo's task is complete (user selected a time)
            const taskStatus = this.isTaskComplete(message, alternatives);
            let agentHandoff;

            if (taskStatus.complete && taskStatus.selectedTime) {
                const completionSignal = this.generateCompletionSignal(taskStatus.selectedTime, context.language);
                responseContent = completionSignal;
                
                agentHandoff = {
                    to: 'booking' as AgentType,
                    reason: `User selected time: ${taskStatus.selectedTime}`,
                    selectedTime: taskStatus.selectedTime
                };
            }

            return {
                content: responseContent,
                toolCalls: executedToolCalls,
                requiresConfirmation: false,
                hasBooking: false,
                agentHandoff
            };

        } catch (error) {
            console.error(`[ApolloAgent] Error processing message:`, error);
            
            // Fallback to AI service if OpenAI fails
            try {
                const fallbackResponse = await this.aiService.generateContent(
                    `As an availability agent, help find alternative times for: "${message}"`,
                    'availability'
                );
                
                return {
                    content: fallbackResponse,
                    toolCalls: []
                };
            } catch (fallbackError) {
                console.error(`[ApolloAgent] Fallback error:`, fallbackError);
                
                const errorMessage = await this.translationService.translate(
                    "I apologize, I encountered a technical issue finding alternative times. Please try again.",
                    context.language,
                    'error'
                );

                return {
                    content: errorMessage,
                    toolCalls: [],
                    requiresConfirmation: false
                };
            }
        }
    }

    /**
     * Execute a tool call using the existing tool functions with timezone validation
     */
    private async executeToolCall(toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall, toolContext: UnifiedToolContext): Promise<any> {
        const { name, arguments: args } = toolCall.function;
        
        console.log(`[ApolloAgent] Executing tool: ${name} with args: ${args}`);

        try {
            const parsedArgs = JSON.parse(args);

            switch (name) {
                case 'find_alternative_times':
                    return await bookingTools.find_alternative_times(
                        parsedArgs.date,
                        parsedArgs.preferredTime,
                        parsedArgs.guests,
                        toolContext
                    );

                case 'check_availability':
                    return await bookingTools.check_availability(
                        parsedArgs.date,
                        parsedArgs.time,
                        parsedArgs.guests,
                        toolContext
                    );

                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        } catch (error) {
            console.error(`[ApolloAgent] Error executing ${name}:`, error);
            return {
                tool_status: 'FAILURE',
                error: {
                    type: 'SYSTEM_ERROR',
                    message: error.message || 'Unknown error'
                }
            };
        }
    }
}

/**
 * Utility functions for Apollo agent - enhanced with timezone validation
 */

/**
 * Detect availability failure in conversation history with timezone awareness
 */
export function detectAvailabilityFailure(session: BookingSessionWithAgent): {
    hasFailure: boolean;
    failedDate?: string;
    failedTime?: string;
    failedGuests?: number;
    failureReason?: string;
} {
    console.log(`🔍 [Apollo] Scanning conversation history for recent availability failures...`);
    
    // Look through recent conversation history for failed availability checks
    const recentMessages = session.conversationHistory.slice(-10); // Check last 10 messages
    
    for (let i = recentMessages.length - 1; i >= 0; i--) {
        const msg = recentMessages[i];
        
        if (msg.toolCalls) {
            for (const toolCall of msg.toolCalls) {
                if (toolCall.function?.name === 'check_availability' || 
                    toolCall.function?.name === 'modify_reservation') {
                    
                    try {
                        const args = JSON.parse(toolCall.function.arguments);
                        
                        // Look for the response to this tool call in the next message
                        const nextMessage = recentMessages[i + 1];
                        if (nextMessage && nextMessage.role === 'assistant') {
                            // Check if the response contains failure indicators
                            const response = nextMessage.content.toLowerCase();
                            
                            if (response.includes('no availability') || 
                                response.includes('not available') ||
                                response.includes('fully booked') ||
                                response.includes('outside') && response.includes('hours') ||
                                response.includes('нет мест') ||
                                response.includes('не доступно') ||
                                response.includes('занято')) {
                                
                                console.log(`🔍 [Apollo] Found availability failure:`, {
                                    tool: toolCall.function.name,
                                    date: args.date,
                                    time: args.time || args.newTime,
                                    guests: args.guests || args.newGuests
                                });
                                
                                return {
                                    hasFailure: true,
                                    failedDate: args.date,
                                    failedTime: args.time || args.newTime,
                                    failedGuests: args.guests || args.newGuests,
                                    failureReason: 'No availability for requested time'
                                };
                            }
                        }
                    } catch (parseError) {
                        console.warn(`[Apollo] Failed to parse tool call arguments:`, parseError);
                    }
                }
            }
        }
    }
    
    console.log(`🔍 [Apollo] No recent availability failures found`);
    return { hasFailure: false };
}

/**
 * Check if user is asking for alternatives after failure with timezone context
 */
export function isAskingForAlternatives(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    
    const alternativeIndicators = [
        'what time is free', 'any alternatives', 'other times',
        'а когда можно', 'когда свободно', 'другое время',
        'earlier', 'later', 'different time',
        'раньше', 'позже', 'что есть',
        'na kada', 'drugo vreme', 'korai', 'később',
        'within hours', 'during', 'open'
    ];

    return alternativeIndicators.some(indicator => lowerMessage.includes(indicator));
}

export default ApolloAgent;