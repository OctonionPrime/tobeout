// server/services/agents/specialists/maya.agent.ts
// ✅ PHASE 4: Maya agent with COMPLETE implementation
// SOURCE: enhanced-conversation-manager.ts getAgentPersonality Maya logic (lines ~750-850)

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
import { reservationTools } from '../tools/reservation.tools';
import { guestTools } from '../tools/guest.tools';
import { bookingTools } from '../tools/booking.tools';

// ===== MAYA AGENT CLASS =====
export class MayaAgent {
    readonly name = 'Maya';
    readonly capabilities = [
        'existing_reservations',
        'reservation_modifications',
        'reservation_cancellations', 
        'reservation_lookup',
        'guest_verification'
    ];
    readonly agentType: AgentType = 'reservations';

    constructor(
        private aiService: AIFallbackService,
        private translationService: UnifiedTranslationService,
        private restaurantConfig: RestaurantConfig
    ) {}

    /**
     * Get comprehensive system prompt for Maya
     * SOURCE: enhanced-conversation-manager.ts getAgentPersonality Maya logic (lines ~750-850)
     */
    getSystemPrompt(
        context: 'hostess' | 'guest',
        userLanguage: Language = 'en',
        guestHistory?: GuestHistory | null,
        isFirstMessage: boolean = false,
        conversationContext?: any
    ): string {
        const currentTime = DateTime.now().setZone(this.restaurantConfig.timezone);
        const dateContext = {
            currentDate: currentTime.toFormat('yyyy-MM-dd'),
            tomorrowDate: currentTime.plus({ days: 1 }).toFormat('yyyy-MM-dd'),
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

        // ✅ CRITICAL MODIFICATION EXECUTION RULES
        const getMayaModificationExecutionRules = () => {
            return `
🚨 CRITICAL MODIFICATION EXECUTION RULES (MAYA AGENT)
Your primary goal is to execute user requests with minimal conversation. When a user wants to modify a booking, you must act, not just talk.

RULE 1: IMMEDIATE ACTION AFTER FINDING A BOOKING
- **IF** you have just successfully found a reservation (e.g., using 'find_existing_reservation').
- **AND** the user then provides new details to change (e.g., "move to 19:10", "add one person", "move 10 minutes later").
- **THEN** your IMMEDIATE next action is to call the 'modify_reservation' tool.
- **DO NOT** talk to the user first. **DO NOT** ask for confirmation. **DO NOT** say "I will check...". CALL THE 'modify_reservation' TOOL.

RULE 2: CONTEXT-AWARE RESERVATION ID RESOLUTION
- **IF** user provides a contextual reference like "эту бронь", "this booking", "it", "её", "эту":
- **THEN** use the most recently modified reservation from session context
- **DO NOT** ask for clarification if context is clear from recent operations

RULE 3: TIME CALCULATION (If necessary)
- **IF** the user requests a relative time change (e.g., "10 minutes later", "half an hour earlier").
- **STEP 1:** Get the current time from the reservation details you just found.
- **STEP 2:** Calculate the new absolute time (e.g., if current is 19:00 and user says "10 minutes later", you calculate newTime: "19:10").
- **STEP 3:** Call modify_reservation with the calculated newTime in the modifications object.

✅ CRITICAL RESERVATION DISPLAY RULES:
- When showing multiple reservations, ALWAYS display with actual IDs like: "Бронь #6: 2025-07-06 в 17:10 на 6 человек"
- NEVER use numbered lists like "1, 2, 3" - always use real IDs "#6, #3, #4"
- When asking user to choose, say: "Укажите ID брони (например, #6)"
- If user provides invalid ID, gently ask: "Пожалуйста, укажите ID брони из списка: #6, #3, #4"
`;
        };

        // ✅ PERSONALIZED PROMPT SECTION
        const getPersonalizedPromptSection = (guestHistory: GuestHistory | null): string => {
            if (!guestHistory || guestHistory.total_bookings === 0) {
                return '';
            }

            const { guest_name, guest_phone, total_bookings, frequent_special_requests } = guestHistory;

            return `
👤 GUEST HISTORY & PERSONALIZATION:
- Guest Name: ${guest_name}
- Guest Phone: ${guest_phone || 'Not available'}
- Total Previous Bookings: ${total_bookings}
- ${frequent_special_requests.length > 0 ? `Frequent Requests: ${frequent_special_requests.join(', ')}` : 'No frequent special requests'}

💡 PERSONALIZATION GUIDELINES:
- ${total_bookings >= 3 ? `RETURNING GUEST: This is a valued returning customer! Use warm, personal language.` : `INFREQUENT GUEST: Guest has visited before but not frequently.`}
- **SAME NAME/PHONE HANDLING**: If the guest says "my name" or "same name", use "${guest_name}" from their history. If they say "same number", "same phone", or "using same number", use "${guest_phone || 'Not available'}" from their history.
- Use this information naturally in conversation - don't just list their history!
- Make the experience feel personal and welcoming for returning guests.`;
        };

        const mayaModificationRules = getMayaModificationExecutionRules();
        const personalizedSection = getPersonalizedPromptSection(guestHistory || null);

        return `You are Maya, the reservation management specialist for ${this.restaurantConfig.name}.

${languageInstruction}

🎯 YOUR ROLE:
- Help guests with EXISTING reservations
- Find, modify, or cancel existing bookings
- Always verify guest identity first
- Be understanding and helpful with changes

🔍 WORKFLOW:
1. Find existing reservation first
2. Verify it belongs to the guest  
3. Make requested changes
4. Confirm all modifications

${mayaModificationRules}

🚨 CRITICAL CONTEXT RULE:
When calling 'modify_reservation', if the user's message is a simple confirmation (e.g., "yes", "ok", "да", "давай так") and does NOT contain a number, you MUST OMIT the 'reservationId' argument in your tool call. The system will automatically use the reservation ID from the current session context.

📅 CURRENT DATE CONTEXT (CRITICAL):
- TODAY is ${dateContext.currentDate} (${dateContext.dayOfWeek})
- TOMORROW is ${dateContext.tomorrowDate}
- Current time: ${dateContext.currentTime} in ${dateContext.timezone}
- When guests say "today", use: ${dateContext.currentDate}
- When guests say "tomorrow", use: ${dateContext.tomorrowDate}
- ALWAYS use YYYY-MM-DD format for dates

💬 STYLE: Understanding, efficient, secure

${personalizedSection}`;
    }

    /**
     * Maya's available tools for reservation management
     */
    getTools() {
        return [
            {
                type: "function" as const,
                function: {
                    name: "get_restaurant_info",
                    description: "Get information about the restaurant including hours, location, contact details",
                    parameters: {
                        type: "object",
                        properties: {
                            infoType: {
                                type: "string",
                                enum: ["hours", "location", "cuisine", "contact", "features", "all"],
                                description: "Type of information to retrieve"
                            }
                        },
                        required: ["infoType"]
                    }
                }
            },
            {
                type: "function" as const,
                function: {
                    name: "get_guest_history",
                    description: "Get guest's booking history for personalized service",
                    parameters: {
                        type: "object",
                        properties: {
                            telegramUserId: {
                                type: "string",
                                description: "Guest's telegram user ID"
                            }
                        },
                        required: ["telegramUserId"]
                    }
                }
            },
            {
                type: "function" as const,
                function: {
                    name: "find_existing_reservation",
                    description: "Find guest's reservations across different time periods",
                    parameters: {
                        type: "object",
                        properties: {
                            identifier: {
                                type: "string",
                                description: "Phone number, guest name, or confirmation number to search by"
                            },
                            identifierType: {
                                type: "string",
                                enum: ["phone", "telegram", "name", "confirmation", "auto"],
                                description: "Type of identifier being used. Use 'auto' to let the system decide."
                            },
                            timeRange: {
                                type: "string",
                                enum: ["upcoming", "past", "all"],
                                description: "Time range to search: 'upcoming' for future reservations (default), 'past' for historical reservations, 'all' for complete history"
                            }
                        },
                        required: ["identifier"]
                    }
                }
            },
            {
                type: "function" as const,
                function: {
                    name: "modify_reservation",
                    description: "Modify details of an existing reservation with smart context resolution",
                    parameters: {
                        type: "object",
                        properties: {
                            reservationId: {
                                type: "number",
                                description: "ID of the reservation to modify (optional - can be resolved from context)"
                            },
                            modifications: {
                                type: "object",
                                properties: {
                                    newDate: {
                                        type: "string",
                                        description: "New date in yyyy-MM-dd format (optional)"
                                    },
                                    newTime: {
                                        type: "string",
                                        description: "New time in HH:MM format (optional)"
                                    },
                                    newGuests: {
                                        type: "number",
                                        description: "New number of guests (optional)"
                                    },
                                    newSpecialRequests: {
                                        type: "string",
                                        description: "Updated special requests (optional)"
                                    }
                                }
                            },
                            reason: {
                                type: "string",
                                description: "Reason for the modification",
                                default: "Guest requested change"
                            }
                        },
                        required: ["modifications"]
                    }
                }
            },
            {
                type: "function" as const,
                function: {
                    name: "cancel_reservation",
                    description: "Cancel an existing reservation",
                    parameters: {
                        type: "object",
                        properties: {
                            reservationId: {
                                type: "number",
                                description: "ID of the reservation to cancel"
                            },
                            reason: {
                                type: "string",
                                description: "Reason for cancellation",
                                default: "Guest requested cancellation"
                            },
                            confirmCancellation: {
                                type: "boolean",
                                description: "Explicit confirmation from guest that they want to cancel"
                            }
                        },
                        required: ["reservationId", "confirmCancellation"]
                    }
                }
            }
        ];
    }

    /**
     * Get contextual response based on emotional understanding
     */
    getContextualResponse(userMessage: string, language: string): string {
        const msg = userMessage.toLowerCase();

        if (msg.includes('задержали') || msg.includes('задержка') || msg.includes('late') || msg.includes('delayed')) {
            return language === 'ru'
                ? "Понимаю, на работе задержали! Такое случается. "
                : language === 'sr'
                    ? "Razumem, zadržani ste na poslu! To se dešava. "
                    : "I understand, work delays happen! ";
        }

        if (msg.includes('не смогу') || msg.includes("can't make it") || msg.includes("won't be able")) {
            return language === 'ru'
                ? "Не переживайте, перенесем на удобное время. "
                : language === 'sr'
                    ? "Ne brinite, prebacićemo na pogodno vreme. "
                    : "No worries, let's reschedule for a better time. ";
        }

        if (msg.includes('опоздаю') || msg.includes('running late')) {
            return language === 'ru'
                ? "Хорошо, на сколько минут опоздаете? Посмотрю, что можно сделать. "
                : language === 'sr'
                    ? "U redu, koliko minuta ćete kasniti? Videćemo šta možemo da uradimo. "
                    : "Alright, how many minutes will you be late? Let me see what we can do. ";
        }

        return "";
    }

    /**
     * Calculate relative time changes for modifications
     */
    calculateRelativeTime(currentTime: string, relativeChange: string): string | null {
        try {
            const [hours, minutes] = currentTime.split(':').map(Number);
            const currentMinutes = hours * 60 + minutes;
            
            let changeMinutes = 0;
            const change = relativeChange.toLowerCase();

            if (change.includes('10 минут') || change.includes('10 minutes')) {
                changeMinutes = change.includes('раньше') || change.includes('earlier') ? -10 : 10;
            } else if (change.includes('15 минут') || change.includes('15 minutes')) {
                changeMinutes = change.includes('раньше') || change.includes('earlier') ? -15 : 15;
            } else if (change.includes('30 минут') || change.includes('30 minutes') || change.includes('полчаса')) {
                changeMinutes = change.includes('раньше') || change.includes('earlier') ? -30 : 30;
            } else if (change.includes('час') || change.includes('hour')) {
                changeMinutes = change.includes('раньше') || change.includes('earlier') ? -60 : 60;
            }

            if (changeMinutes === 0) return null;

            const newMinutes = currentMinutes + changeMinutes;
            const newHours = Math.floor(newMinutes / 60);
            const newMins = newMinutes % 60;

            if (newHours < 10 || newHours > 23) return null;

            return `${newHours.toString().padStart(2, '0')}:${newMins.toString().padStart(2, '0')}`;
        } catch (error) {
            console.error('[MayaAgent] Error calculating relative time:', error);
            return null;
        }
    }

    /**
     * ✅ COMPLETE: Main message processing method for Maya
     */
    async processMessage(
        message: string, 
        context: AgentContext
    ): Promise<AgentResponse> {
        console.log(`[MayaAgent] Processing message: "${message}"`);

        try {
            // Build tool context for Maya's tools
            const toolContext = {
                restaurantId: context.restaurantId,
                timezone: context.session.currentStep || this.restaurantConfig.timezone,
                language: context.language,
                telegramUserId: context.telegramUserId,
                sessionId: context.sessionId
            };

            // Get contextual empathy response
            const contextualPrefix = this.getContextualResponse(message, context.language);

            // Get system prompt
            const systemPrompt = this.getSystemPrompt(
                context.session.context,
                context.language,
                context.guestHistory,
                context.session.conversationHistory.length === 0,
                context.conversationContext
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

${contextualPrefix ? `Context: ${contextualPrefix}` : ''}

Respond naturally and use tools when needed. Always follow the critical modification execution rules.`;

            // Generate response using AI service
            const response = await this.aiService.generateContent(
                fullPrompt,
                'reservations',
                { 
                    temperature: 0.3, 
                    maxTokens: 800 
                }
            );

            console.log(`[MayaAgent] AI response: ${response}`);

            // Parse function calls from response if any
            const toolCalls = this.parseToolCalls(response);
            
            // Execute tool calls if present
            const executedToolCalls = [];
            let finalResponse = contextualPrefix + response;

            if (toolCalls.length > 0) {
                console.log(`[MayaAgent] Found ${toolCalls.length} tool calls`);
                
                for (const toolCall of toolCalls) {
                    try {
                        const toolResult = await this.executeToolCall(toolCall, toolContext);
                        executedToolCalls.push({
                            ...toolCall,
                            result: toolResult
                        });
                        
                        // Update response based on tool results
                        finalResponse = await this.incorporateToolResult(
                            finalResponse, 
                            toolCall, 
                            toolResult, 
                            context.language
                        );
                        
                    } catch (error) {
                        console.error(`[MayaAgent] Tool execution error:`, error);
                        const errorMessage = await this.translationService.translate(
                            `I encountered an error while processing your request. Please try again.`,
                            context.language,
                            'error'
                        );
                        finalResponse = errorMessage;
                    }
                }
            }

            // Clean response (remove any function call syntax)
            finalResponse = this.cleanResponse(finalResponse);

            return {
                content: finalResponse,
                toolCalls: executedToolCalls,
                requiresConfirmation: this.shouldRequireConfirmation(executedToolCalls),
                hasBooking: false, // Maya doesn't create new bookings
                reservationId: this.extractReservationId(executedToolCalls)
            };

        } catch (error) {
            console.error(`[MayaAgent] Error processing message:`, error);
            
            const errorMessage = await this.translationService.translate(
                "I apologize, I encountered a technical issue. Please try again.",
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
            /find_existing_reservation\s*\(\s*([^)]+)\)/g,
            /modify_reservation\s*\(\s*([^)]+)\)/g,
            /cancel_reservation\s*\(\s*([^)]+)\)/g,
            /get_guest_history\s*\(\s*([^)]+)\)/g,
            /get_restaurant_info\s*\(\s*([^)]+)\)/g
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
        
        console.log(`[MayaAgent] Executing tool: ${name} with args: ${args}`);

        try {
            // Parse arguments
            let parsedArgs;
            try {
                parsedArgs = JSON.parse(args);
            } catch {
                parsedArgs = this.parseFunctionCallArgs(args);
            }

            switch (name) {
                case 'find_existing_reservation':
                    return await reservationTools.find_existing_reservation(
                        parsedArgs.identifier,
                        parsedArgs.identifierType || 'auto',
                        parsedArgs.timeRange || 'upcoming',
                        toolContext
                    );

                case 'modify_reservation':
                    return await reservationTools.modify_reservation(
                        parsedArgs.reservationId,
                        parsedArgs.modifications,
                        parsedArgs.reason || 'Guest requested change',
                        toolContext
                    );

                case 'cancel_reservation':
                    return await reservationTools.cancel_reservation(
                        parsedArgs.reservationId,
                        parsedArgs.reason || 'Guest requested cancellation',
                        parsedArgs.confirmCancellation,
                        toolContext
                    );

                case 'get_guest_history':
                    return await guestTools.get_guest_history(
                        parsedArgs.telegramUserId,
                        toolContext
                    );

                case 'get_restaurant_info':
                    return await bookingTools.get_restaurant_info(
                        parsedArgs.infoType,
                        toolContext
                    );

                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        } catch (error) {
            console.error(`[MayaAgent] Error executing ${name}:`, error);
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
            // Success case - tool already provides translated message
            if (toolResult.data?.message) {
                return toolResult.data.message;
            }
            
            // Generate success message based on tool type
            switch (name) {
                case 'find_existing_reservation':
                    if (toolResult.data?.reservations?.length > 0) {
                        const reservations = toolResult.data.reservations;
                        const reservationList = reservations
                            .map(r => `#${r.id}: ${r.date} в ${r.time} на ${r.guests} чел.`)
                            .join('\n');
                        
                        return await this.translationService.translate(
                            `Found your reservations:\n${reservationList}`,
                            language,
                            'success'
                        );
                    }
                    break;
                    
                case 'modify_reservation':
                    return await this.translationService.translate(
                        `✅ Done! Your reservation has been successfully modified.`,
                        language,
                        'success'
                    );
                    
                case 'cancel_reservation':
                    return await this.translationService.translate(
                        `✅ Your reservation has been cancelled successfully.`,
                        language,
                        'success'
                    );
                    
                default:
                    return originalResponse;
            }
        } else {
            // Error case - return translated error message
            if (toolResult.error?.message) {
                return toolResult.error.message; // Already translated by tools
            }
            
            return await this.translationService.translate(
                `I'm sorry, I encountered an issue processing your request.`,
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
            .replace(/find_existing_reservation\s*\([^)]+\)/g, '')
            .replace(/modify_reservation\s*\([^)]+\)/g, '')
            .replace(/cancel_reservation\s*\([^)]+\)/g, '')
            .replace(/get_guest_history\s*\([^)]+\)/g, '')
            .replace(/get_restaurant_info\s*\([^)]+\)/g, '')
            .replace(/\n\s*\n/g, '\n')
            .trim();
    }

    /**
     * Check if confirmation is required
     */
    private shouldRequireConfirmation(toolCalls: any[]): boolean {
        return toolCalls.some(call => 
            call.function.name === 'cancel_reservation' &&
            call.result?.tool_status === 'SUCCESS'
        );
    }

    /**
     * Extract reservation ID from tool calls
     */
    private extractReservationId(toolCalls: any[]): number | undefined {
        const relevantCall = toolCalls.find(call => 
            (call.function.name === 'modify_reservation' || call.function.name === 'cancel_reservation') &&
            call.result?.tool_status === 'SUCCESS' &&
            call.result?.data?.reservationId
        );
        
        return relevantCall?.result?.data?.reservationId;
    }
}

// ===== EXPORT DEFAULT =====
export default MayaAgent;