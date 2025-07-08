// server/services/agents/specialists/apollo.agent.ts
// ✅ PHASE 4: Apollo agent with COMPLETE implementation
// SOURCE: enhanced-conversation-manager.ts getAgentPersonality Apollo logic (lines ~550-600)

import type { 
    AgentType, 
    Language,
    AgentContext,
    AgentResponse,
    BookingSessionWithAgent,
    GuestHistory,
    RestaurantConfig
} from '../core/agent.types';
import { AIFallbackService } from '../../ai/ai-fallback.service';
import { UnifiedTranslationService } from '../../ai/translation.service';
import { DateTime } from 'luxon';

// Import tools
import { bookingTools } from '../tools/booking.tools';

// ===== APOLLO AVAILABILITY FAILURE CONTEXT =====
interface AvailabilityFailureContext {
    originalDate: string;
    originalTime: string;
    originalGuests: number;
    failureReason: string;
    detectedAt: string;
}

// ===== APOLLO AGENT CLASS =====
export class ApolloAgent {
    readonly name = 'Apollo';
    readonly capabilities = [
        'alternative_times',
        'availability_recovery',
        'failure_handling',
        'time_suggestions'
    ];
    readonly agentType: AgentType = 'availability';

    constructor(
        private aiService: AIFallbackService,
        private translationService: UnifiedTranslationService,
        private restaurantConfig: RestaurantConfig
    ) {}

    /**
     * Get comprehensive system prompt for Apollo
     * SOURCE: enhanced-conversation-manager.ts getAgentPersonality Apollo logic (lines ~550-600)
     */
    getSystemPrompt(
        context: 'hostess' | 'guest',
        userLanguage: Language = 'en',
        guestHistory?: GuestHistory | null,
        isFirstMessage: boolean = false,
        conversationContext?: any,
        availabilityFailureContext?: AvailabilityFailureContext
    ): string {
        const currentTime = DateTime.now().setZone(this.restaurantConfig.timezone);
        const dateContext = {
            currentDate: currentTime.toFormat('yyyy-MM-dd'),
            currentTime: currentTime.toFormat('HH:mm'),
            dayOfWeek: currentTime.toFormat('cccc'),
            timezone: this.restaurantConfig.timezone
        };

        // ✅ LANGUAGE INSTRUCTION (works for all languages)
        const languageInstruction = `🌍 CRITICAL LANGUAGE RULE:
- User's language: ${userLanguage}
- You MUST respond in ${userLanguage} for ALL messages
- Maintain warm, professional tone in ${userLanguage}
- If unsure of translation, use simple clear ${userLanguage}`;

        // ✅ APOLLO AVAILABILITY FAILURE CONTEXT
        const failureContextSection = availabilityFailureContext ? `

🚨 AVAILABILITY FAILURE CONTEXT:
- Original failed request: ${availabilityFailureContext.originalDate} at ${availabilityFailureContext.originalTime} for ${availabilityFailureContext.originalGuests} guests
- You MUST immediately call find_alternative_times with these exact parameters
- Do not ask the user for clarification - they already provided this information` : '';

        // ✅ CONVERSATION CONTEXT INSTRUCTIONS
        const conversationInstructions = conversationContext ? `
📝 CONVERSATION CONTEXT:
- Session Turn: ${conversationContext.sessionTurnCount || 1}
- This is a handoff from another agent due to availability failure
- User is looking for alternative times after their first choice was unavailable
` : '';

        return `You are Apollo, a specialist Availability Agent. Your only job is to help a user find an alternative time after their first choice was unavailable.

${languageInstruction}

🎯 YOUR MANDATORY WORKFLOW:
1. The user's previous attempt to book or modify a reservation has FAILED due to no availability.
2. Your first action MUST be to call the 'find_alternative_times' tool. Use the details (date, time, guests) from the previously failed attempt.
3. Clearly present the available times that the tool returns. Do not suggest any times not returned by the tool.
4. Once the user chooses a time, your job is complete. End your response with a clear signal like "Great, I'll hand you back to finalize that."

❌ FORBIDDEN ACTIONS:
- Do not ask for the user's name, phone, or any other personal details.
- Do not call any tools other than 'find_alternative_times' and 'check_availability'.
- Do not try to complete the booking yourself.
- NEVER suggest times that weren't returned by the find_alternative_times tool.
- NEVER hallucinate availability - only use tool results.

✅ REQUIRED PATTERN:
1. Immediately call find_alternative_times with the failed booking parameters
2. Present the alternatives clearly: "I found these available times: 18:30, 19:15, 20:00"
3. When user selects one, confirm and hand back: "Perfect! 19:15 works. I'll hand you back to complete the booking."

🏪 RESTAURANT INFO:
- Name: ${this.restaurantConfig.name}
- Current Date: ${dateContext.currentDate}
- Timezone: ${this.restaurantConfig.timezone}

${failureContextSection}

${conversationInstructions}

This focused approach prevents availability hallucination and ensures accurate alternative suggestions.`;
    }

    /**
     * Apollo's specialized tools for availability operations
     */
    getTools() {
        return [
            {
                type: "function" as const,
                function: {
                    name: "find_alternative_times",
                    description: "Finds alternative available time slots around a user's preferred time. This is the primary tool for this agent.",
                    parameters: {
                        type: "object",
                        properties: {
                            date: {
                                type: "string",
                                description: "Date in yyyy-MM-dd format"
                            },
                            preferredTime: {
                                type: "string", 
                                description: "Preferred time in HH:MM format from the failed booking attempt"
                            },
                            guests: {
                                type: "number",
                                description: "Number of guests"
                            }
                        },
                        required: ["date", "preferredTime", "guests"]
                    }
                }
            },
            {
                type: "function" as const,
                function: {
                    name: "check_availability",
                    description: "Quickly confirms if a single time chosen by the user from the suggested alternatives is still available.",
                    parameters: {
                        type: "object",
                        properties: {
                            date: {
                                type: "string",
                                description: "Date in yyyy-MM-dd format"
                            },
                            time: {
                                type: "string",
                                description: "Time in HH:MM format"
                            },
                            guests: {
                                type: "number",
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
     * Format alternative times for user-friendly display
     */
    formatAlternativeTimes(alternatives: any[], language: Language): string {
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

        const timesList = alternatives
            .slice(0, 5) // Show max 5 alternatives
            .map(alt => `${alt.timeDisplay || alt.time}`)
            .join(', ');

        const foundAlternativesMessages = {
            en: `I found these available times: ${timesList}. Which one works best for you?`,
            ru: `Я нашел эти доступные времена: ${timesList}. Какое вам больше подходит?`,
            sr: `Pronašao sam ova dostupna vremena: ${timesList}. Koje vam najbolje odgovara?`,
            hu: `Ezeket a szabad időpontokat találtam: ${timesList}. Melyik felel meg legjobban?`,
            de: `Ich habe diese verfügbaren Zeiten gefunden: ${timesList}. Welche passt Ihnen am besten?`,
            fr: `J'ai trouvé ces heures disponibles: ${timesList}. Laquelle vous convient le mieux?`,
            es: `Encontré estos horarios disponibles: ${timesList}. ¿Cuál te conviene más?`,
            it: `Ho trovato questi orari disponibili: ${timesList}. Quale ti va meglio?`,
            pt: `Encontrei estes horários disponíveis: ${timesList}. Qual funciona melhor para você?`,
            nl: `Ik heb deze beschikbare tijden gevonden: ${timesList}. Welke past het beste voor u?`,
            auto: `I found these available times: ${timesList}. Which one works best for you?`
        };

        return foundAlternativesMessages[language] || foundAlternativesMessages.en;
    }

    /**
     * Generate completion signal for handoff back to primary agent
     */
    generateCompletionSignal(selectedTime: string, language: Language): string {
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
    isTaskComplete(message: string, alternatives: any[]): { complete: boolean; selectedTime?: string } {
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
            // If it's a confirmation but no specific time mentioned, use the first alternative
            return { complete: true, selectedTime: alternatives[0]?.timeDisplay || alternatives[0]?.time };
        }

        return { complete: false };
    }

    /**
     * ✅ COMPLETE: Main message processing method for Apollo
     */
    async processMessage(
        message: string, 
        context: AgentContext
    ): Promise<AgentResponse> {
        console.log(`[ApolloAgent] Processing message: "${message}"`);

        try {
            // Build tool context for Apollo's tools
            const toolContext = {
                restaurantId: context.restaurantId,
                timezone: context.session.currentStep || this.restaurantConfig.timezone,
                language: context.language,
                telegramUserId: context.telegramUserId,
                sessionId: context.sessionId
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
                .slice(-5) // Last 5 messages for context
                .map(msg => `${msg.role}: ${msg.content}`)
                .join('\n');

            const fullPrompt = `${systemPrompt}

Recent conversation:
${conversationHistory}

Current user message: "${message}"

Remember: Your only job is to find alternative times and hand back to the booking agent once user selects one.`;

            // Generate response using AI service
            const response = await this.aiService.generateContent(
                fullPrompt,
                'availability',
                { 
                    temperature: 0.2, // Lower temperature for more focused responses
                    maxTokens: 600 
                }
            );

            console.log(`[ApolloAgent] AI response: ${response}`);

            // Parse function calls from response if any
            const toolCalls = this.parseToolCalls(response);
            
            // Execute tool calls if present
            const executedToolCalls = [];
            let finalResponse = response;
            let alternatives = [];

            if (toolCalls.length > 0) {
                console.log(`[ApolloAgent] Found ${toolCalls.length} tool calls`);
                
                for (const toolCall of toolCalls) {
                    try {
                        const toolResult = await this.executeToolCall(toolCall, toolContext);
                        executedToolCalls.push({
                            ...toolCall,
                            result: toolResult
                        });
                        
                        // Extract alternatives from tool results
                        if (toolCall.function.name === 'find_alternative_times' && 
                            toolResult.tool_status === 'SUCCESS' && 
                            toolResult.data?.alternatives) {
                            alternatives = toolResult.data.alternatives;
                        }
                        
                        // Update response based on tool results
                        finalResponse = await this.incorporateToolResult(
                            finalResponse, 
                            toolCall, 
                            toolResult, 
                            context.language
                        );
                        
                    } catch (error) {
                        console.error(`[ApolloAgent] Tool execution error:`, error);
                        const errorMessage = await this.translationService.translate(
                            `I encountered an error while finding alternative times. Please try again.`,
                            context.language,
                            'error'
                        );
                        finalResponse = errorMessage;
                    }
                }
            }

            // Check if Apollo's task is complete (user selected a time)
            const taskStatus = this.isTaskComplete(message, alternatives);
            let agentHandoff;

            if (taskStatus.complete && taskStatus.selectedTime) {
                const completionSignal = this.generateCompletionSignal(taskStatus.selectedTime, context.language);
                finalResponse = completionSignal;
                
                agentHandoff = {
                    to: 'booking',
                    reason: `User selected time: ${taskStatus.selectedTime}`,
                    selectedTime: taskStatus.selectedTime
                };
            }

            // Clean response (remove any function call syntax)
            finalResponse = this.cleanResponse(finalResponse);

            return {
                content: finalResponse,
                toolCalls: executedToolCalls,
                requiresConfirmation: false,
                hasBooking: false,
                agentHandoff
            };

        } catch (error) {
            console.error(`[ApolloAgent] Error processing message:`, error);
            
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

    /**
     * Parse tool calls from AI response
     */
    private parseToolCalls(response: string): Array<{function: {name: string, arguments: string}, id: string}> {
        const toolCalls = [];
        
        // Look for function call patterns in the response
        const functionPatterns = [
            /find_alternative_times\s*\(\s*([^)]+)\)/g,
            /check_availability\s*\(\s*([^)]+)\)/g
        ];

        for (const pattern of functionPatterns) {
            let match;
            while ((match = pattern.exec(response)) !== null) {
                const functionName = pattern.source.split('\\s*\\(')[0];
                const args = match[1];
                
                toolCalls.push({
                    function: {
                        name: functionName,
                        arguments: args
                    },
                    id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                });
            }
        }

        return toolCalls;
    }

    /**
     * Execute a tool call
     */
    private async executeToolCall(toolCall: any, toolContext: any): Promise<any> {
        const { name, arguments: args } = toolCall.function;
        
        console.log(`[ApolloAgent] Executing tool: ${name} with args: ${args}`);

        try {
            // Parse arguments
            let parsedArgs;
            try {
                parsedArgs = JSON.parse(args);
            } catch {
                parsedArgs = this.parseFunctionCallArgs(args);
            }

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

    /**
     * Parse function call arguments in string format
     */
    private parseFunctionCallArgs(argsString: string): any {
        const args = {};
        const pairs = argsString.split(',');
        
        for (const pair of pairs) {
            const [key, value] = pair.split('=').map(s => s.trim());
            if (key && value) {
                const cleanValue = value.replace(/['"]/g, '');
                args[key] = isNaN(Number(cleanValue)) ? cleanValue : Number(cleanValue);
            }
        }
        
        return args;
    }

    /**
     * Incorporate tool result into response
     */
    private async incorporateToolResult(
        originalResponse: string,
        toolCall: any,
        toolResult: any,
        language: Language
    ): Promise<string> {
        const { name } = toolCall.function;

        if (toolResult.tool_status === 'SUCCESS') {
            // Success case - format alternatives nicely
            if (name === 'find_alternative_times' && toolResult.data?.alternatives) {
                return this.formatAlternativeTimes(toolResult.data.alternatives, language);
            }
            
            if (name === 'check_availability' && toolResult.data?.available) {
                return await this.translationService.translate(
                    `Yes, ${toolResult.data.exactTime} is still available for ${toolResult.data.guests} guests.`,
                    language,
                    'success'
                );
            }
        } else {
            // Error case - return translated error message
            if (toolResult.error?.message) {
                return toolResult.error.message; // Already translated by tools
            }
            
            return await this.translationService.translate(
                `I'm sorry, I couldn't find alternative times for your request.`,
                language,
                'error'
            );
        }

        return originalResponse;
    }

    /**
     * Clean response by removing function call syntax
     */
    private cleanResponse(response: string): string {
        return response
            .replace(/find_alternative_times\s*\([^)]+\)/g, '')
            .replace(/check_availability\s*\([^)]+\)/g, '')
            .replace(/\n\s*\n/g, '\n')
            .trim();
    }
}

// ===== APOLLO UTILITIES =====

/**
 * Detect availability failure in conversation history
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
 * Check if user is asking for alternatives after failure
 */
export function isAskingForAlternatives(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    
    const alternativeIndicators = [
        'what time is free', 'any alternatives', 'other times',
        'а когда можно', 'когда свободно', 'другое время',
        'earlier', 'later', 'different time',
        'раньше', 'позже', 'что есть',
        'na kada', 'drugo vreme', 'korai', 'később'
    ];

    return alternativeIndicators.some(indicator => lowerMessage.includes(indicator));
}

// ===== EXPORT DEFAULT =====
export default ApolloAgent;