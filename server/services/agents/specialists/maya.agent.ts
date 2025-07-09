// server/services/agents/specialists/maya.agent.ts
// ✅ ENHANCED: Maya agent with comprehensive timezone utilities integration and operating hours validation
// Handles existing reservations, modifications, cancellations, and guest verification

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
import { reservationTools } from '../tools/reservation.tools';
import { guestTools } from '../tools/guest.tools';
import { bookingTools } from '../tools/booking.tools';

/**
 * Maya Agent - Specialist for reservation management and modifications
 * Uses OpenAI function calling for reliable tool execution with timezone validation
 */
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
     * ✅ ENHANCED: Calculate relative time changes with comprehensive timezone and operating hours validation
     */
    private calculateRelativeTime(currentTime: string, relativeChange: string): {
        newTime: string | null;
        isValid: boolean;
        isWithinHours: boolean;
        reason?: string;
        operatingHoursInfo?: string;
    } {
        try {
            const [hours, minutes] = currentTime.split(':').map(Number);
            const currentMinutes = hours * 60 + minutes;
            
            let changeMinutes = 0;
            const change = relativeChange.toLowerCase();

            // Parse various relative time expressions
            if (change.includes('10 минут') || change.includes('10 minutes')) {
                changeMinutes = change.includes('раньше') || change.includes('earlier') ? -10 : 10;
            } else if (change.includes('15 минут') || change.includes('15 minutes')) {
                changeMinutes = change.includes('раньше') || change.includes('earlier') ? -15 : 15;
            } else if (change.includes('30 минут') || change.includes('30 minutes') || change.includes('полчаса')) {
                changeMinutes = change.includes('раньше') || change.includes('earlier') ? -30 : 30;
            } else if (change.includes('час') || change.includes('hour')) {
                changeMinutes = change.includes('раньше') || change.includes('earlier') ? -60 : 60;
            } else if (change.includes('два часа') || change.includes('2 hours')) {
                changeMinutes = change.includes('раньше') || change.includes('earlier') ? -120 : 120;
            }

            if (changeMinutes === 0) {
                return {
                    newTime: null,
                    isValid: false,
                    isWithinHours: false,
                    reason: 'Could not parse relative time change'
                };
            }

            const newMinutes = currentMinutes + changeMinutes;
            const newHours = Math.floor(newMinutes / 60);
            const newMins = newMinutes % 60;

            // Handle day overflow/underflow
            let adjustedHours = newHours;
            if (adjustedHours < 0) {
                adjustedHours += 24;
            } else if (adjustedHours >= 24) {
                adjustedHours -= 24;
            }

            const newTimeString = `${adjustedHours.toString().padStart(2, '0')}:${newMins.toString().padStart(2, '0')}`;

            // ✅ ENHANCED: Validate against operating hours with overnight operation support
            const operatingStatus = getRestaurantOperatingStatus(
                this.restaurantConfig.timezone,
                this.restaurantConfig.openingTime,
                this.restaurantConfig.closingTime
            );

            const isOvernight = isOvernightOperation(
                this.restaurantConfig.openingTime,
                this.restaurantConfig.closingTime
            );

            let isWithinHours = false;
            let operatingHoursInfo = '';

            if (isOvernight) {
                // For overnight operations, validate across day boundaries
                const openingMinutes = this.parseTimeToMinutes(this.restaurantConfig.openingTime);
                const closingMinutes = this.parseTimeToMinutes(this.restaurantConfig.closingTime);
                const newTimeMinutes = adjustedHours * 60 + newMins;

                isWithinHours = openingMinutes !== null && closingMinutes !== null && 
                    (newTimeMinutes >= openingMinutes || newTimeMinutes < closingMinutes);

                operatingHoursInfo = `Overnight operation: ${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime} (next day)`;
            } else {
                // Standard operation
                const openingMinutes = this.parseTimeToMinutes(this.restaurantConfig.openingTime);
                const closingMinutes = this.parseTimeToMinutes(this.restaurantConfig.closingTime);
                const newTimeMinutes = adjustedHours * 60 + newMins;

                isWithinHours = openingMinutes !== null && closingMinutes !== null && 
                    newTimeMinutes >= openingMinutes && newTimeMinutes < closingMinutes;

                operatingHoursInfo = `Standard operation: ${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime}`;
            }

            return {
                newTime: newTimeString,
                isValid: true,
                isWithinHours,
                reason: isWithinHours ? undefined : `Time ${newTimeString} is outside operating hours`,
                operatingHoursInfo
            };

        } catch (error) {
            console.error('[MayaAgent] Error calculating relative time:', error);
            return {
                newTime: null,
                isValid: false,
                isWithinHours: false,
                reason: 'Error calculating relative time change'
            };
        }
    }

    /**
     * ✅ NEW: Helper function to parse time string to minutes
     */
    private parseTimeToMinutes(timeStr: string): number | null {
        if (!timeStr) return null;
        const parts = timeStr.split(':');
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10) || 0;

        if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return null;
        }
        return hours * 60 + minutes;
    }

    /**
     * ✅ NEW: Validate modification time against operating hours
     */
    private validateModificationTime(date: string, newTime: string): {
        isValid: boolean;
        isWithinHours: boolean;
        reason?: string;
        suggestedTime?: string;
        operatingInfo?: string;
    } {
        // Validate timezone first
        if (!isValidTimezone(this.restaurantConfig.timezone)) {
            console.warn(`[MayaAgent] Invalid restaurant timezone: ${this.restaurantConfig.timezone}`);
            return {
                isValid: false,
                isWithinHours: false,
                reason: 'Invalid restaurant timezone configuration'
            };
        }

        // Validate modification time against operating hours
        const validation = validateBookingDateTime(
            date,
            newTime,
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
            suggestedTime: validation.suggestedTime,
            operatingInfo: operatingStatus.detailedInfo || `Operating hours: ${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime}`
        };
    }

    /**
     * Generate comprehensive system prompt for Maya with enhanced timezone context
     */
    private getSystemPrompt(
        context: 'hostess' | 'guest',
        userLanguage: Language = 'en',
        guestHistory?: GuestHistory | null,
        isFirstMessage: boolean = false,
        conversationContext?: any
    ): string {
        // ✅ ENHANCED: Use timezone utilities with validation
        let dateContext;
        let operatingStatus;
        
        try {
            // Validate timezone before using it
            if (!isValidTimezone(this.restaurantConfig.timezone)) {
                console.warn(`[MayaAgent] Invalid timezone: ${this.restaurantConfig.timezone}, falling back to Belgrade`);
                this.restaurantConfig.timezone = 'Europe/Belgrade';
            }

            dateContext = getRestaurantTimeContext(this.restaurantConfig.timezone);
            operatingStatus = getRestaurantOperatingStatus(
                this.restaurantConfig.timezone,
                this.restaurantConfig.openingTime,
                this.restaurantConfig.closingTime
            );
        } catch (error) {
            console.error(`[MayaAgent] Error getting timezone context:`, error);
            // Fallback to basic context
            const now = new Date();
            dateContext = {
                currentDate: now.toISOString().split('T')[0],
                tomorrowDate: new Date(now.getTime() + 24*60*60*1000).toISOString().split('T')[0],
                currentTime: now.toTimeString().slice(0, 5),
                timezone: this.restaurantConfig.timezone,
                dayOfWeek: now.toLocaleDateString('en', { weekday: 'long' })
            };
            operatingStatus = {
                status: 'unknown',
                message: 'Operating status unavailable',
                isOvernightOperation: false
            };
        }

        const isOvernight = isOvernightOperation(
            this.restaurantConfig.openingTime,
            this.restaurantConfig.closingTime
        );

        const languageInstruction = `🌍 CRITICAL LANGUAGE RULE:
- User's language: ${userLanguage}
- You MUST respond in ${userLanguage} for ALL messages
- Maintain warm, professional tone in ${userLanguage}
- If unsure of translation, use simple clear ${userLanguage}`;

        const modificationRules = `🚨 CRITICAL MODIFICATION EXECUTION RULES:
Your primary goal is to execute user requests with minimal conversation. When a user wants to modify a booking, you must act, not just talk.

RULE 1: IMMEDIATE ACTION AFTER FINDING A BOOKING
- IF you have successfully found a reservation using 'find_existing_reservation'
- AND the user then provides new details to change (e.g., "move to 19:10", "add one person", "move 10 minutes later")
- THEN your IMMEDIATE next action is to call the 'modify_reservation' tool
- DO NOT talk to the user first. DO NOT ask for confirmation. CALL THE 'modify_reservation' TOOL.

RULE 2: CONTEXT-AWARE RESERVATION ID RESOLUTION
- IF user provides a contextual reference like "эту бронь", "this booking", "it", "её", "эту"
- THEN use the most recently modified reservation from session context
- DO NOT ask for clarification if context is clear from recent operations

RULE 3: ENHANCED TIME CALCULATION WITH OPERATING HOURS VALIDATION
- IF the user requests a relative time change (e.g., "10 minutes later", "half an hour earlier")
- STEP 1: Get the current time from the reservation details you just found
- STEP 2: Calculate the new absolute time using timezone-aware calculations
- STEP 3: Validate the new time against operating hours (${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime})
- STEP 4: If time is outside operating hours but technically valid, warn but still allow modification
- STEP 5: Call modify_reservation with the calculated newTime in the modifications object

RULE 4: OPERATING HOURS VALIDATION
- ${isOvernight ? 'OVERNIGHT OPERATION: Validate modifications across day boundaries' : 'STANDARD OPERATION: Validate modifications within operating hours'}
- Check against operating hours: ${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime}
- Consider current status: ${operatingStatus.status}
- For overnight operations, handle cross-day time calculations properly`;

        const reservationDisplayRules = `✅ CRITICAL RESERVATION DISPLAY RULES:
- When showing multiple reservations, ALWAYS display with actual IDs like: "Бронь #6: 2025-07-06 в 17:10 на 6 человек"
- NEVER use numbered lists like "1, 2, 3" - always use real IDs "#6, #3, #4"
- When asking user to choose, say: "Укажите ID брони (например, #6)"
- If user provides invalid ID, gently ask: "Пожалуйста, укажите ID брони из списка: #6, #3, #4"`;

        const personalizedSection = guestHistory ? `
👤 GUEST HISTORY & PERSONALIZATION:
- Guest Name: ${guestHistory.guest_name}
- Guest Phone: ${guestHistory.guest_phone || 'Not available'}
- Total Previous Bookings: ${guestHistory.total_bookings}
- ${guestHistory.total_bookings >= 3 ? `RETURNING GUEST: This is a valued returning customer! Use warm, personal language.` : `INFREQUENT GUEST: Guest has visited before but not frequently.`}
- SAME NAME/PHONE HANDLING: If the guest says "my name" or "same name", use "${guestHistory.guest_name}" from their history. If they say "same number", use "${guestHistory.guest_phone || 'Not available'}".
- Use this information naturally in conversation - don't just list their history!` : '';

        const operatingHoursSection = `
🏪 RESTAURANT OPERATING STATUS:
- Status: ${operatingStatus.status}
- ${operatingStatus.message}
${isOvernight ? `- OVERNIGHT OPERATION: Restaurant operates across days (${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime})` : ''}
- Operating Hours: ${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime}
- Use this for modification validation and operating hours checks
- Always validate modification times against operating hours`;

        const timezoneValidationSection = `
🕐 TIMEZONE & MODIFICATION VALIDATION:
- Restaurant Timezone: ${this.restaurantConfig.timezone} (validated)
- Always validate modification times against operating hours
- For relative time changes, use enhanced calculation with operating hours validation
- Handle overnight operations properly for cross-day modifications
- Warn guests if modifications are outside normal hours but still allow if valid`;

        return `You are Maya, the reservation management specialist for ${this.restaurantConfig.name}.

${languageInstruction}

🎯 YOUR ROLE:
- Help guests with EXISTING reservations
- Find, modify, or cancel existing bookings
- Always verify guest identity first
- Be understanding and helpful with changes
- Validate all modifications against operating hours

🔍 WORKFLOW:
1. Find existing reservation first
2. Verify it belongs to the guest  
3. Make requested changes immediately with validation
4. Confirm all modifications

${modificationRules}

🚨 CRITICAL CONTEXT RULE:
When calling 'modify_reservation', if the user's message is a simple confirmation (e.g., "yes", "ok", "да", "давай так") and does NOT contain a number, you MUST OMIT the 'reservationId' argument in your tool call. The system will automatically use the reservation ID from the current session context.

${reservationDisplayRules}

📅 CURRENT DATE CONTEXT:
- TODAY is ${dateContext.currentDate} (${dateContext.dayOfWeek})
- TOMORROW is ${dateContext.tomorrowDate}
- Current time: ${dateContext.currentTime} in ${dateContext.timezone}
- When guests say "today", use: ${dateContext.currentDate}
- When guests say "tomorrow", use: ${dateContext.tomorrowDate}
- ALWAYS use YYYY-MM-DD format for dates

${operatingHoursSection}

${timezoneValidationSection}

🏪 RESTAURANT INFO:
- Name: ${this.restaurantConfig.name}
- Timezone: ${this.restaurantConfig.timezone}

💬 STYLE: Understanding, efficient, secure

${personalizedSection}

Use tools to find, modify, and cancel reservations. Be proactive and execute changes immediately when requested with proper validation.`;
    }

    /**
     * Get OpenAI tools for Maya's capabilities
     */
    private getOpenAITools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
        return [
            {
                type: "function",
                function: {
                    name: "get_restaurant_info",
                    description: "Get information about the restaurant including timezone-aware hours, location, contact details",
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
                type: "function",
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
                type: "function",
                function: {
                    name: "find_existing_reservation",
                    description: "Find guest's reservations across different time periods with timezone awareness",
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
                type: "function",
                function: {
                    name: "modify_reservation",
                    description: "Modify details of an existing reservation with smart context resolution and timezone validation including operating hours checks",
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
                                        description: "New time in HH:MM format (optional) - will be validated against operating hours"
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
                type: "function",
                function: {
                    name: "cancel_reservation",
                    description: "Cancel an existing reservation with timezone-aware refund calculations",
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
    private getContextualResponse(userMessage: string, language: string): string {
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
     * ✅ NEW: Pre-validate modification parameters
     */
    private preValidateModificationParameters(
        modifications: any,
        context: UnifiedToolContext
    ): { isValid: boolean; warnings: string[]; errors: string[] } {
        const warnings: string[] = [];
        const errors: string[] = [];

        // Validate date format if provided
        if (modifications.newDate && !/^\d{4}-\d{2}-\d{2}$/.test(modifications.newDate)) {
            errors.push('Invalid date format. Expected YYYY-MM-DD');
        }

        // Validate time format if provided
        if (modifications.newTime && !/^\d{1,2}:\d{2}$/.test(modifications.newTime)) {
            errors.push('Invalid time format. Expected HH:MM');
        }

        // Validate guest count if provided
        if (modifications.newGuests && (modifications.newGuests <= 0 || modifications.newGuests > 50)) {
            errors.push('Invalid number of guests. Must be between 1 and 50');
        }

        // If time modification, validate against operating hours
        if (modifications.newTime && modifications.newDate && errors.length === 0) {
            const timeValidation = this.validateModificationTime(modifications.newDate, modifications.newTime);
            
            if (!timeValidation.isValid) {
                errors.push(timeValidation.reason || 'Invalid modification time');
            } else if (!timeValidation.isWithinHours) {
                warnings.push(`New time ${modifications.newTime} is outside normal operating hours. ${timeValidation.reason || ''}`);
            }
        }

        return {
            isValid: errors.length === 0,
            warnings,
            errors
        };
    }

    /**
     * Main message processing method using OpenAI function calling with enhanced timezone validation
     */
    async processMessage(
        message: string, 
        context: AgentContext
    ): Promise<AgentResponse> {
        console.log(`[MayaAgent] Processing message: "${message}"`);

        try {
            // ✅ ENHANCED: Build unified tool context with timezone validation
            let effectiveTimezone = this.restaurantConfig.timezone;
            if (!isValidTimezone(effectiveTimezone)) {
                console.warn(`[MayaAgent] Invalid timezone: ${effectiveTimezone}, falling back to Belgrade`);
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
                .slice(-5)
                .map(msg => `${msg.role}: ${msg.content}`)
                .join('\n');

            const fullPrompt = `${systemPrompt}

Recent conversation:
${conversationHistory}

Current user message: "${message}"

${contextualPrefix ? `Context: ${contextualPrefix}` : ''}

Respond naturally and use tools when needed. Always follow the critical modification execution rules and validate times against operating hours.`;

            // ✅ ENHANCED: Use OpenAI function calling with timezone validation
            const completion = await this.openaiClient.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: fullPrompt }],
                tools: this.getOpenAITools(),
                tool_choice: "auto",
                temperature: 0.3,
                max_tokens: 2000
            });

            const assistantMessage = completion.choices[0]?.message;
            let responseContent = assistantMessage?.content || "I'd be happy to help with your reservation!";
            const toolCalls = assistantMessage?.tool_calls || [];

            // Add contextual prefix if present
            if (contextualPrefix) {
                responseContent = contextualPrefix + responseContent;
            }

            console.log(`[MayaAgent] Generated response with ${toolCalls.length} tool calls`);

            // Execute tool calls if present with validation
            const executedToolCalls = [];
            for (const toolCall of toolCalls) {
                try {
                    // ✅ NEW: Pre-validate modification-related tool calls
                    if (toolCall.function.name === 'modify_reservation') {
                        const args = JSON.parse(toolCall.function.arguments);
                        
                        if (args.modifications) {
                            const validation = this.preValidateModificationParameters(args.modifications, toolContext);
                            
                            if (!validation.isValid) {
                                console.warn(`[MayaAgent] Pre-validation failed for modify_reservation:`, validation.errors);
                                
                                executedToolCalls.push({
                                    function: {
                                        name: toolCall.function.name,
                                        arguments: toolCall.function.arguments
                                    },
                                    id: toolCall.id,
                                    result: {
                                        tool_status: 'FAILURE',
                                        error: {
                                            type: 'VALIDATION_ERROR',
                                            message: validation.errors.join(', '),
                                            code: 'PRE_VALIDATION_FAILED'
                                        }
                                    }
                                });
                                continue;
                            }
                            
                            // Log warnings but proceed
                            if (validation.warnings.length > 0) {
                                console.warn(`[MayaAgent] Pre-validation warnings for modify_reservation:`, validation.warnings);
                            }
                        }
                    }

                    const toolResult = await this.executeToolCall(toolCall, toolContext);
                    executedToolCalls.push({
                        function: {
                            name: toolCall.function.name,
                            arguments: toolCall.function.arguments
                        },
                        id: toolCall.id,
                        result: toolResult
                    });
                } catch (error) {
                    console.error(`[MayaAgent] Tool execution error:`, error);
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
                }
            }

            return {
                content: responseContent,
                toolCalls: executedToolCalls,
                requiresConfirmation: this.shouldRequireConfirmation(executedToolCalls),
                hasBooking: false, // Maya doesn't create new bookings
                reservationId: this.extractReservationId(executedToolCalls)
            };

        } catch (error) {
            console.error(`[MayaAgent] Error processing message:`, error);
            
            // Fallback to AI service if OpenAI fails
            try {
                const fallbackResponse = await this.aiService.generateContent(
                    `As a reservation management agent, respond to: "${message}"`,
                    'reservations'
                );
                
                return {
                    content: fallbackResponse,
                    toolCalls: []
                };
            } catch (fallbackError) {
                console.error(`[MayaAgent] Fallback error:`, fallbackError);
                
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
    }

    /**
     * Execute a tool call using the existing tool functions with timezone validation
     */
    private async executeToolCall(toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall, toolContext: UnifiedToolContext): Promise<any> {
        const { name, arguments: args } = toolCall.function;
        
        console.log(`[MayaAgent] Executing tool: ${name} with args: ${args}`);

        try {
            const parsedArgs = JSON.parse(args);

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
     * Check if confirmation is required based on tool calls
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

export default MayaAgent;