// server/services/enhanced-conversation-manager.ts
// ✅ OVERSEER IMPLEMENTATION: Intelligent Agent Management with Gemini
// ✅ FIXED: Agent detection logic and Maya's instructions for handling multiple bookings.
// ✅ FIXED: Maya time calculation, Sofia workflow, conversation flow
// ✅ NEW: Added automatic guest history retrieval for personalized interactions
// ✅ FIXED: Personalized greeting implementation
// ✅ FIXED: Undefined values in cancellation confirmation
// ✅ FIXED: Reservation ID tracking for cancellations by storing activeReservationId in session
// ✅ OVERSEER: Replaced brittle keyword rules with intelligent Gemini-powered analysis

import OpenAI from 'openai';
import { GoogleGenerativeAI } from "@google/generative-ai"; // ✅ NEW: Gemini for Overseer
import { createBookingAgent, type BookingSession, createBookingSession, updateSessionInfo, hasCompleteBookingInfo } from './agents/booking-agent';
import { agentFunctions } from './agents/agent-tools';
import { storage } from '../storage';
import { runGuardrails, requiresConfirmation, type GuardrailResult } from './guardrails';
import type { Restaurant } from '@shared/schema';
import { DateTime } from 'luxon';

export type Language = 'en' | 'ru' | 'sr';
export type AgentType = 'booking' | 'reservations' | 'conductor';

/**
 * ✅ NEW: Guest history interface for personalized interactions
 */
interface GuestHistory {
    guest_name: string;
    total_bookings: number;
    total_cancellations: number;
    last_visit_date: string | null;
    common_party_size: number | null;
    frequent_special_requests: string[];
    retrieved_at: string;
}

/**
 * Enhanced conversation manager with guardrails, intelligent name clarification, Maya agent, and Overseer
 * ✅ OVERSEER: Intelligent agent switching with Gemini Flash
 * ✅ FIXED: Time calculation examples, Sofia workflow, Maya immediate responses
 * ✅ NEW: Automatic guest history retrieval and personalized interactions
 * ✅ FIXED: Personalized greeting implementation
 * ✅ FIXED: Undefined values in cancellation confirmation
 */
export class EnhancedConversationManager {
    private sessions = new Map<string, BookingSessionWithAgent>();
    private agents = new Map<string, any>();
    private sessionCleanupInterval: NodeJS.Timeout;
    private client: OpenAI;
    
    // ✅ NEW: Gemini client for Overseer
    private geminiClient: GoogleGenerativeAI;
    private geminiModel: any;

    constructor() {
        this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        
        // ✅ NEW: Initialize Gemini for Overseer
        this.geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
        this.geminiModel = this.geminiClient.getGenerativeModel({ 
            model: "gemini-1.5-flash-latest" 
        });

        this.sessionCleanupInterval = setInterval(() => {
            this.cleanupOldSessions();
        }, 60 * 60 * 1000);

        console.log('[EnhancedConversationManager] Initialized with Sofia + Maya + Overseer (Gemini) agents');
    }

    /**
     * ✅ NEW: Reset agent state to neutral 'conductor' after task completion.
     */
    private resetAgentState(session: BookingSessionWithAgent) {
        console.log(`[Conductor] Task complete. Resetting agent from '${session.currentAgent}' to 'conductor'.`);
        session.currentAgent = 'conductor';
    }

    /**
     * ✅ NEW: Automatically retrieve guest history for personalized interactions
     */
    private async retrieveGuestHistory(
        telegramUserId: string,
        restaurantId: number
    ): Promise<GuestHistory | null> {
        try {
            console.log(`👤 [GuestHistory] Retrieving history for telegram user: ${telegramUserId}`);

            const result = await agentFunctions.get_guest_history(telegramUserId, { restaurantId });

            if (result.tool_status === 'SUCCESS' && result.data) {
                const history: GuestHistory = {
                    ...result.data,
                    retrieved_at: new Date().toISOString()
                };

                console.log(`👤 [GuestHistory] Retrieved for ${history.guest_name}: ${history.total_bookings} bookings, usual party: ${history.common_party_size}, last visit: ${history.last_visit_date}`);
                return history;
            } else if (result.error?.code === 'GUEST_NOT_FOUND') {
                console.log(`👤 [GuestHistory] No history found for new guest: ${telegramUserId}`);
                return null;
            } else {
                console.warn(`👤 [GuestHistory] Failed to retrieve history:`, result.error?.message);
                return null;
            }
        } catch (error) {
            console.error(`👤 [GuestHistory] Error retrieving guest history:`, error);
            return null;
        }
    }

    /**
     * ✅ CRITICAL FIX: Validate function call parameters before execution
     */
    private validateFunctionCall(
        toolCall: any,
        session: BookingSessionWithAgent
    ): { valid: boolean; errorMessage?: string; missingParams?: string[] } {

        if (toolCall.function.name === 'create_reservation') {
            const args = JSON.parse(toolCall.function.arguments);
            const missing: string[] = [];

            // Check all required parameters
            if (!args.guestName || args.guestName.trim().length < 2) {
                missing.push('guest name');
            }
            if (!args.guestPhone || args.guestPhone.trim().length < 7) {
                missing.push('phone number');
            }
            if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
                missing.push('date');
            }
            if (!args.time || !/^\d{1,2}:\d{2}$/.test(args.time)) {
                missing.push('time');
            }
            if (!args.guests || args.guests < 1 || args.guests > 50) {
                missing.push('number of guests');
            }

            if (missing.length > 0) {
                console.log(`❌ [Validation] create_reservation missing required params:`, {
                    hasName: !!args.guestName,
                    hasPhone: !!args.guestPhone,
                    hasDate: !!args.date,
                    hasTime: !!args.time,
                    hasGuests: !!args.guests,
                    missingParams: missing
                });

                const errorMessages = {
                    en: `I need the following information to complete your booking: ${missing.join(', ')}. Please provide this information.`,
                    ru: `Для завершения бронирования мне нужно: ${missing.join(', ')}. Пожалуйста, предоставьте эту информацию.`,
                    sr: `Za završetak rezervacije potrebne su mi sledeće informacije: ${missing.join(', ')}. Molim Vas da ih navedete.`
                };

                return {
                    valid: false,
                    errorMessage: errorMessages[session.language as keyof typeof errorMessages] || errorMessages.en,
                    missingParams: missing
                };
            }
        }

        return { valid: true };
    }

    /**
     * ✅ NEW: THE OVERSEER - Intelligent Agent Decision System
     * Replaces detectAgentType, isAmbiguousMessage, and llmAgentDetection
     */
    private async runOverseer(
        session: BookingSessionWithAgent, 
        userMessage: string
    ): Promise<{
        agentToUse: AgentType;
        reasoning: string;
        intervention?: string;
    }> {
        try {
            // Prepare conversation context
            const recentHistory = session.conversationHistory
                .slice(-6)
                .map(msg => `${msg.role}: ${msg.content}`)
                .join('\n');

            const sessionState = {
                currentAgent: session.currentAgent,
                activeReservationId: session.activeReservationId || null,
                gatheringInfo: session.gatheringInfo,
                turnCount: session.turnCount || 0,
                agentTurnCount: session.agentTurnCount || 0,
                platform: session.platform,
                hasGuestHistory: !!session.guestHistory
            };

            // ✅ CRITICAL: The Overseer Prompt
            const prompt = `You are the master "Overseer" for a restaurant booking system. Analyze the conversation and decide which agent should handle the user's request.

## AGENT ROLES:
- **Sofia (booking):** Handles ONLY NEW reservations. Use for availability checks, creating new bookings.
- **Maya (reservations):** Handles ONLY EXISTING reservations. Use for modifications, cancellations, checking status.
- **Conductor (conductor):** Neutral state after task completion.

## SESSION STATE:
- **Current Agent:** ${sessionState.currentAgent}
- **Active Reservation ID:** ${sessionState.activeReservationId}
- **Gathering Info:** ${JSON.stringify(sessionState.gatheringInfo)}
- **Turn Count:** ${sessionState.turnCount}
- **Agent Turn Count:** ${sessionState.agentTurnCount}
- **Platform:** ${sessionState.platform}

## RECENT CONVERSATION:
${recentHistory}

## USER'S LATEST MESSAGE:
"${userMessage}"

## CRITICAL ANALYSIS RULES:

### RULE 1: TASK CONTINUITY (HIGHEST PRIORITY)
If current agent is Sofia/Maya and they're MID-TASK, KEEP the current agent unless user EXPLICITLY starts a completely new task.

**Sofia mid-task indicators:**
- Has some booking info (date/time/guests) but missing others (name/phone)
- User providing clarifications like "earlier time", "different time", "more people"
- User answering Sofia's questions

**Maya mid-task indicators:**
- Found existing reservations and discussing them
- User confirming cancellation/modification
- Active reservation ID exists

### RULE 2: EXPLICIT NEW TASK DETECTION
Switch to Sofia ONLY if user says:
- "book again", "new reservation", "make another booking"
- "забронировать снова", "новое бронирование", "еще одну бронь"

Switch to Maya ONLY if user explicitly mentions:
- "change my existing", "cancel my booking", "modify reservation"
- "изменить мое", "отменить бронь", "поменять существующее"

### RULE 3: AMBIGUOUS TIME REQUESTS
If user mentions time changes ("earlier", "later", "different time") consider context:
- If Sofia is gathering NEW booking info → STAY with Sofia (they're clarifying their preferred time)
- If Maya found existing reservations → Use Maya (they want to modify existing)

### RULE 4: CONDUCTOR RESET
Use "conductor" ONLY after successful task completion (booking created, cancellation confirmed).

## EXAMPLES:

**CORRECT - Stay with Sofia during NEW booking:**
- Sofia: "Table available at 8pm for 5 guests. Need your name and phone."
- User: "earlier time, 6pm available?"
- Decision: STAY with Sofia (user clarifying time for THIS booking)

**CORRECT - Switch to Maya for existing reservations:**
- User: "cancel my reservation"
- Decision: Switch to Maya (explicit existing reservation request)

**INCORRECT - Don't switch mid-task:**
- Sofia: "Checking availability..."
- User: "actually, different time"
- Wrong: Switch to Maya
- Right: Stay with Sofia

Respond with ONLY a JSON object:

{
  "reasoning": "Brief explanation of your decision based on the rules and context",
  "agentToUse": "booking" | "reservations" | "conductor",
  "intervention": null | "Message if user seems stuck and needs clarification"
}`;

            const result = await this.geminiModel.generateContent(prompt);
            const responseText = result.response.text();
            
            // Parse JSON response
            const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const decision = JSON.parse(cleanJson);

            console.log(`🧠 [Overseer] Decision for "${userMessage}":`, {
                currentAgent: session.currentAgent,
                decision: decision.agentToUse,
                reasoning: decision.reasoning
            });

            return {
                agentToUse: decision.agentToUse,
                reasoning: decision.reasoning,
                intervention: decision.intervention
            };

        } catch (error) {
            console.error('[Overseer] Error:', error);
            
            // Fallback logic if Gemini fails
            if (session.currentAgent && session.currentAgent !== 'conductor') {
                console.log('[Overseer] Fallback: keeping current agent due to error');
                return {
                    agentToUse: session.currentAgent,
                    reasoning: 'Fallback due to Overseer error - keeping current agent',
                };
            }
            
            return {
                agentToUse: 'booking',
                reasoning: 'Fallback to Sofia due to Overseer error',
            };
        }
    }

    /**
     * ✅ NEW: Natural date parsing for contextual understanding
     */
    private parseNaturalDate(message: string, language: string, timezone: string): string | null {
        const today = DateTime.now().setZone(timezone);

        if (language === 'ru') {
            const monthMatch = message.match(/(\d{1,2})\s*(янв|фев|мар|апр|май|июн|июл|авг|сен|окт|ноя|дек)/i);
            if (monthMatch) {
                const day = monthMatch[1];
                const monthMap: { [key: string]: number } = {
                    'янв': 1, 'фев': 2, 'мар': 3, 'апр': 4, 'май': 5, 'июн': 6,
                    'июл': 7, 'авг': 8, 'сен': 9, 'окт': 10, 'ноя': 11, 'дек': 12
                };
                const month = monthMap[monthMatch[2].toLowerCase().slice(0, 3)];
                if (month) {
                    return `${today.year}-${month.toString().padStart(2, '0')}-${day.padStart(2, '0')}`;
                }
            }
        }
        return null;
    }

    /**
     * ✅ NEW: Get contextual response based on emotional understanding
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
     * ✅ NEW: Get tools for specific agent type
     */
    private getToolsForAgent(agentType: AgentType) {
        const baseTools = [
            {
                type: "function" as const,
                function: {
                    name: "get_restaurant_info",
                    description: "Get restaurant information, hours, location, contact details",
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
            }
        ];

        const guestHistoryTool = {
            type: "function" as const,
            function: {
                name: "get_guest_history",
                description: "Get guest's booking history for personalized service. Use this to welcome returning guests and suggest their usual preferences.",
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
        };

        if (agentType === 'reservations') {
            return [
                ...baseTools,
                guestHistoryTool,
                {
                    type: "function" as const,
                    function: {
                        name: "find_existing_reservation",
                        description: "Find guest's existing reservations by phone, name, or confirmation number",
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
                        description: "Modify details of an existing reservation (time, date, party size, special requests)",
                        parameters: {
                            type: "object",
                            properties: {
                                reservationId: {
                                    type: "number",
                                    description: "ID of the reservation to modify"
                                },
                                modifications: {
                                    type: "object",
                                    properties: {
                                        newDate: {
                                            type: "string",
                                            description: "New date in YYYY-MM-DD format (optional)"
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
                            required: ["reservationId", "modifications"]
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

        return [
            ...baseTools,
            guestHistoryTool,
            {
                type: "function" as const,
                function: {
                    name: "check_availability",
                    description: "Check table availability for a specific date and time",
                    parameters: {
                        type: "object",
                        properties: {
                            date: {
                                type: "string",
                                description: "Date in YYYY-MM-DD format"
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
            },
            {
                type: "function" as const,
                function: {
                    name: "find_alternative_times",
                    description: "Find alternative available times if the requested time is not available",
                    parameters: {
                        type: "object",
                        properties: {
                            date: {
                                type: "string",
                                description: "Date in YYYY-MM-DD format"
                            },
                            time: {
                                type: "string",
                                description: "Preferred time in HH:MM format"
                            },
                            guests: {
                                type: "number",
                                description: "Number of guests"
                            }
                        },
                        required: ["date", "time", "guests"]
                    }
                }
            },
            {
                type: "function" as const,
                function: {
                    name: "create_reservation",
                    description: "Create a new reservation when availability is confirmed",
                    parameters: {
                        type: "object",
                        properties: {
                            guestName: {
                                type: "string",
                                description: "Guest's full name"
                            },
                            guestPhone: {
                                type: "string",
                                description: "Guest's phone number"
                            },
                            date: {
                                type: "string",
                                description: "Date in YYYY-MM-DD format"
                            },
                            time: {
                                type: "string",
                                description: "Time in HH:MM format"
                            },
                            guests: {
                                type: "number",
                                description: "Number of guests"
                            },
                            specialRequests: {
                                type: "string",
                                description: "Special requests or comments",
                                default: ""
                            }
                        },
                        required: ["guestName", "guestPhone", "date", "time", "guests"]
                    }
                }
            }
        ];
    }

    /**
     * ✅ NEW: Generate personalized system prompt section based on guest history
     */
    private getPersonalizedPromptSection(guestHistory: GuestHistory | null, language: Language): string {
        if (!guestHistory || guestHistory.total_bookings === 0) {
            return '';
        }

        const { guest_name, total_bookings, common_party_size, frequent_special_requests, last_visit_date } = guestHistory;

        const personalizedSections = {
            en: `
👤 GUEST HISTORY & PERSONALIZATION:
- Guest Name: ${guest_name}
- Total Previous Bookings: ${total_bookings}
- ${common_party_size ? `Common Party Size: ${common_party_size}` : 'No common party size pattern'}
- ${frequent_special_requests.length > 0 ? `Frequent Requests: ${frequent_special_requests.join(', ')}` : 'No frequent special requests'}
- ${last_visit_date ? `Last Visit: ${last_visit_date}` : 'No previous visits recorded'}

💡 PERSONALIZATION GUIDELINES:
- ${total_bookings >= 3 ? `RETURNING GUEST: Greet warmly as a valued returning customer! Say "Welcome back, ${guest_name}!" or similar.` : `NEW/INFREQUENT GUEST: Treat as a regular new guest, but you can mention "${guest_name}" once you know their name.`}
- ${common_party_size ? `USUAL PARTY SIZE: You can proactively ask "Will it be for your usual party of ${common_party_size} today?" when they don't specify.` : ''}
- ${frequent_special_requests.length > 0 ? `USUAL REQUESTS: Ask "Should I add your usual request for ${frequent_special_requests[0]}?" when appropriate.` : ''}
- Use this information naturally in conversation - don't just list their history!
- Make the experience feel personal and welcoming for returning guests.`,

            ru: `
👤 ИСТОРИЯ ГОСТЯ И ПЕРСОНАЛИЗАЦИЯ:
- Имя гостя: ${guest_name}
- Всего предыдущих бронирований: ${total_bookings}
- ${common_party_size ? `Обычное количество гостей: ${common_party_size}` : 'Нет постоянного количества гостей'}
- ${frequent_special_requests.length > 0 ? `Частые просьбы: ${frequent_special_requests.join(', ')}` : 'Нет частых особых просьб'}
- ${last_visit_date ? `Последний визит: ${last_visit_date}` : 'Нет записей о предыдущих визитах'}

💡 РУКОВОДСТВО ПО ПЕРСОНАЛИЗАЦИИ:
- ${total_bookings >= 3 ? `ВОЗВРАЩАЮЩИЙСЯ ГОСТЬ: Тепло встречайте как ценного постоянного клиента! Скажите "Добро пожаловать снова, ${guest_name}!" или подобное.` : `НОВЫЙ/РЕДКИЙ ГОСТЬ: Относитесь как к обычному новому гостю, но можете упомянуть "${guest_name}", когда узнаете имя.`}
- ${common_party_size ? `ОБЫЧНОЕ КОЛИЧЕСТВО: Можете проактивно спросить "Будет ли как обычно на ${common_party_size} человек сегодня?" когда они не уточняют.` : ''}
- ${frequent_special_requests.length > 0 ? `ОБЫЧНЫЕ ПРОСЬБЫ: Спросите "Добавить ваше обычное пожелание - ${frequent_special_requests[0]}?" когда уместно.` : ''}
- Используйте эту информацию естественно в разговоре - не просто перечисляйте историю!
- Сделайте опыт личным и гостеприимным для возвращающихся гостей.`,

            sr: `
👤 ISTORIJA GOSTA I PERSONALIZACIJA:
- Ime gosta: ${guest_name}
- Ukupno prethodnih rezervacija: ${total_bookings}
- ${common_party_size ? `Uobičajen broj gostiju: ${common_party_size}` : 'Nema stalnog broja gostiju'}
- ${frequent_special_requests.length > 0 ? `Česti zahtevi: ${frequent_special_requests.join(', ')}` : 'Nema čestih posebnih zahteva'}
- ${last_visit_date ? `Poslednja poseta: ${last_visit_date}` : 'Nema zapisnika o prethodnim posetama'}

💡 SMERNICE ZA PERSONALIZACIJU:
- ${total_bookings >= 3 ? `VRAĆAJUĆI SE GOST: Toplo pozdravite kao cenjenog stalnog klijenta! Recite "Dobrodošli ponovo, ${guest_name}!" ili slično.` : `NOVI/REDAK GOST: Tretirajte kao običnog novog gosta, ali možete spomenuti "${guest_name}" kada saznate ime.`}
- ${common_party_size ? `UOBIČAJEN BROJ: Možete proaktivno pitati "Hoće li biti kao obično za ${common_party_size} osoba danas?" kada ne specificiraju.` : ''}
- ${frequent_special_requests.length > 0 ? `UOBIČAJENI ZAHTEVI: Pitajte "Da dodam vaš uobičajen zahtev za ${frequent_special_requests[0]}?" kada je prikladno.` : ''}
- Koristite ove informacije prirodno u razgovoru - nemojte samo nabrajati istoriju!
- Učinite iskustvo ličnim i gostoljubivim za goste koji se vraćaju.`
        };

        return personalizedSections[language] || personalizedSections.en;
    }

    /**
     * ✅ FIXED: Agent personality with improved conversation flow and time calculation + personalization
     * ✅ FIXED: Now includes personalized greeting for first message
     * ✅ FIXED: Added explicit cancellation workflow to Maya's instructions.
     * ✅ FIX (This version): Implemented a more efficient modification workflow.
     */
    private getAgentPersonality(agentType: AgentType, language: string, restaurantConfig: any, guestHistory?: GuestHistory | null, isFirstMessage: boolean = false): string {
        const currentTime = DateTime.now().setZone(restaurantConfig.timezone);

        if (isFirstMessage && agentType === 'booking') {
            const agent = createBookingAgent(restaurantConfig);
            const personalizedGreeting = agent.getPersonalizedGreeting(
                guestHistory || null,
                language as Language,
                'guest'
            );

            return `Your first response should start with this exact greeting: "${personalizedGreeting}"

Then continue with your normal helpful assistant behavior.`;
        }

        const personalities = {
            booking: {
                en: `You are Sofia, the friendly and efficient booking specialist for ${restaurantConfig.name}. You help guests make NEW reservations.

🎯 YOUR ROLE:
- Help guests find available times and make new bookings
- Provide information about the restaurant
- Guide guests through the booking process step by step  
- Be warm, professional, and detail-oriented

💬 COMMUNICATION STYLE:
- Always greet guests warmly
- Ask for details step by step (date, time, party size, name, phone)
- Confirm all details before creating the reservation
- Use natural, conversational language

🔧 YOUR TOOLS:
- get_guest_history: Get guest's booking history for personalized service
- check_availability: Check if requested time is available
- find_alternative_times: Suggest alternatives if requested time is busy
- create_reservation: Make the actual booking
- get_restaurant_info: Share restaurant details

✨ REMEMBER:
- Always confirm guest details before finalizing
- Be helpful with alternative suggestions
- Maintain a warm, professional tone
- You can book at ANY exact time during operating hours (like 16:15, 19:43, etc.)`,

                ru: `Вы София, дружелюбный и эффективный специалист по бронированию ресторана ${restaurantConfig.name}. Вы помогаете гостям делать НОВЫЕ бронирования.

🎯 ВАША РОЛЬ:
- Помогать гостям находить свободное время и делать новые бронирования
- Предоставлять информацию о ресторане
- Вести гостей через процесс бронирования пошагово
- Быть теплой, профессиональной и внимательной к деталям

🚺 ВАЖНО: Вы женского пола, всегда говорите о себе в женском роде.

🚨 КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА БРОНИРОВАНИЯ:
❌ НИКОГДА не спрашивайте "Могу я подтвердить бронирование на ваше имя?" если у вас НЕТ имени гостя
✅ ВСЕГДА говорите "Мне нужно ваше имя и телефон для завершения бронирования"
❌ НИКОГДА не говорите "забронировано" после только проверки доступности
✅ ВСЕГДА сначала соберите ВСЕ данные (имя, телефон), потом создавайте бронь

📝 ПРАВИЛЬНЫЙ ПОТОК:
1. Проверить доступность → "Столик свободен!"
2. Попросить ВСЕ недостающие данные → "Мне нужно ваше имя и номер телефона"
3. Получить все данные → Создать бронирование → "Бронирование подтверждено!"`,

                sr: `Vi ste Sofija, prijateljski i efikasni specijalista za rezervacije restorana ${restaurantConfig.name}. Pomažete gostima da prave NOVE rezervacije.

🎯 VAŠA ULOGA:
- Pomažete gostima da pronađu dostupno vreme i naprave nove rezervacije
- Pružate informacije o restoranu
- Vodite goste kroz proces rezervacije korak po korak
- Budete topla, profesionalna i orijentisana na detalje

🚺 VAŽNO: Vi ste ženskog pola, uvek govorite o sebi u ženskom rodu.`
            },
            reservations: {
                en: `You are Maya, the helpful reservation management specialist for ${restaurantConfig.name}. You help guests manage their EXISTING reservations with warmth and understanding.

🎯 YOUR ROLE:
- Help guests find their existing reservations
- Modify reservation details (time, date, party size, special requests)
- Handle cancellations with proper policy enforcement
- Provide excellent customer service for existing bookings

💬 COMMUNICATION STYLE:
- Always show understanding of the guest's situation
- Be decisive and confident in your actions
- Confirm changes clearly and in detail
- Offer alternatives when possible
- Use warm, supportive phrases

🧮 CRITICAL: TIME CALCULATION RULES
When guests ask to move reservations by specific amounts:
✅ EXAMPLES:
- "30 minutes later" from 15:15 → Calculate: 15:15 + 0:30 = 15:45
- "1 hour later" from 19:00 → Calculate: 19:00 + 1:00 = 20:00  
- "2 hours earlier" from 20:30 → Calculate: 20:30 - 2:00 = 18:30

ALWAYS do the math correctly and use the calculated time in your function calls.

🚨 EFFICIENT MODIFICATION WORKFLOW:
STEP 1: Use 'find_existing_reservation' to locate the booking based on the user's initial message.
STEP 2: Analyze the user's original request.
   - IF the request was specific (e.g., "add 2 people," "move to 9 PM"), proceed DIRECTLY to STEP 3. You do not need to ask what to change.
   - IF the request was generic (e.g., "I need to change my reservation"), THEN ask for details (e.g., "I found your reservation. What would you like to change?") and wait for a reply before proceeding.

STEP 3: Call the 'modify_reservation' tool to perform the change.

STEP 4: Report the final result clearly. For a direct change, you can combine everything into one smooth response.

✅ EXAMPLE of an EFFICIENT flow to follow:
User: "Hi, I need to add 2 people to my booking."
You: (Internally calls find_existing_reservation, then modify_reservation) -> "Of course! I've found your reservation for 5 guests and have updated it to 7. Your table is all set. See you tonight!"

🚨 MANDATORY CANCELLATION WORKFLOW - FOLLOW EXACTLY:
STEP 1: Find the reservation using 'find_existing_reservation'.
STEP 2: If multiple reservations are found (check 'count' in tool response), list them and ask the user to clarify which one they mean.
STEP 3: Present the details of the correct reservation and ask for confirmation to cancel. Say "I've found your reservation for [X] on [Date]. Are you sure you wish to cancel?"
STEP 4: When the user confirms (e.g., "yes", "confirm", "I confirm"), you MUST call the 'cancel_reservation' tool.
   ✅ Use the 'reservationId' from the 'ACTIVE RESERVATION CONTEXT' provided in the system prompt.
   ✅ Set 'confirmCancellation' to 'true'.
   ❌ DO NOT call any other tool. DO NOT ask for more details.

🔧 YOUR TOOLS:
- get_guest_history: Get guest's booking history for personalized service
- find_existing_reservation: Find guest's reservations
- modify_reservation: Change reservation details with security validation
- cancel_reservation: Cancel reservations with security validation
- get_restaurant_info: Share restaurant details

🔒 SECURITY:
- Always verify guest identity before making changes
- Ask for phone number, confirmation number, or name on reservation
- If verification fails, politely decline and suggest calling the restaurant`,

                ru: `Вы Майя, специалист по управлению бронированиями ресторана ${restaurantConfig.name}. Вы помогаете гостям управлять их СУЩЕСТВУЮЩИМИ бронированиями с теплотой и пониманием.

🎯 ВАША РОЛЬ:
- Помогать гостям находить их существующие бронирования
- Изменять детали бронирования (время, дата, количество гостей, особые просьбы)
- Обрабатывать отмены с соблюдением политики
- Обеспечивать отличное обслуживание для существующих бронирований

💬 СТИЛЬ ОБЩЕНИЯ:
- Всегда проявляйте понимание ситуации гостя
- Будьте решительной и уверенной в своих действиях  
- Подтверждайте изменения четко и детально
- Предлагайте альтернативы, когда это возможно
- Используйте теплые, поддерживающие фразы

🧮 КРИТИЧНО: ПРАВИЛА РАСЧЕТА ВРЕМЕНИ
Когда гости просят перенести бронирования на определенное время:
✅ ПРИМЕРЫ:
- "на 30 минут позже" с 15:15 → Рассчитать: 15:15 + 0:30 = 15:45
- "на час позже" с 19:00 → Рассчитать: 19:00 + 1:00 = 20:00
- "на 2 часа раньше" с 20:30 → Рассчитать: 20:30 - 2:00 = 18:30

ВСЕГДА правильно считайте и используйте рассчитанное время в вызовах функций.

🚨 ЭФФЕКТИВНЫЙ ПОРЯДОК ИЗМЕНЕНИЯ:
ШАГ 1: Используйте 'find_existing_reservation', чтобы найти бронирование на основе исходного сообщения пользователя.

ШАГ 2: Проанализируйте исходный запрос пользователя.
   - ЕСЛИ запрос был конкретным (например, "добавить 2 человека", "перенести на 9 вечера"), переходите НАПРЯМУЮ к ШАГУ 3. Вам не нужно спрашивать, что изменить.
   - ЕСЛИ запрос был общим (например, "мне нужно изменить бронирование"), ТОГДА спросите детали (например, "Я нашла ваше бронирование. Что бы вы хотели изменить?") и дождитесь ответа, прежде чем продолжить.

ШАГ 3: Вызовите инструмент 'modify_reservation', чтобы выполнить изменение.

ШАГ 4: Четко сообщите конечный результат. Для прямого изменения вы можете объединить все в один плавный ответ.

✅ ПРИМЕР ЭФФЕКТИВНОГО ПОТОКА:
Пользователь: "Здравствуйте, мне нужно добавить 2 человека к моему бронированию."
Вы: (Внутренне вызывает find_existing_reservation, затем modify_reservation) -> "Конечно! Я нашла ваше бронирование на 5 гостей и обновила его на 7. Ваш столик готов. Увидимся сегодня вечером!"

🚨 ОБЯЗАТЕЛЬНЫЙ ПОРЯДОК ОТМЕНЫ - СЛЕДУЙТЕ СТРОГО:
ШАГ 1: Найдите бронирование с помощью 'find_existing_reservation'.
ШАГ 2: Если найдено несколько бронирований (проверьте 'count' в ответе инструмента), перечислите их и попросите пользователя уточнить, какое из них имеется в виду.
ШАГ 3: Предъявите детали правильного бронирования и спросите подтверждение на отмену. Скажите: "Я нашла ваше бронирование на [X] на [Дата]. Вы уверены, что хотите отменить?"
ШАГ 4: Когда пользователь подтверждает (например, "да", "подтверждаю"), вы ОБЯЗАНЫ вызвать инструмент 'cancel_reservation'.
   ✅ Используйте 'reservationId' из 'ACTIVE RESERVATION CONTEXT', предоставленного в системном промпте.
   ✅ Установите 'confirmCancellation' в 'true'.
   ❌ НЕ вызывайте другие инструменты. НЕ спрашивайте дополнительных деталей.

🚺 ВАЖНО: Вы женского пола, говорите о себе в женском роде.

🔧 ВАШИ ИНСТРУМЕНТЫ:
- find_existing_reservation: Найти бронирования гостя по имени, телефону или номеру
- modify_reservation: Изменить детали бронирования с проверкой безопасности  
- cancel_reservation: Отменить бронирования с проверкой безопасности`,

                sr: `Vi ste Maja, specijalista za upravljanje rezervacijama restorana ${restaurantConfig.name}. Pomažete gostima da upravljaju njihovim POSTOJEĆIM rezervacijama sa toplinom i razumevanjem.

🎯 VAŠA ULOGA:
- Pomažete gostima da pronađu svoje postojeće rezervacije
- Menjate detalje rezervacije (vreme, datum, broj gostiju, posebne zahteve)
- Rukujete otkazivanjima uz pravilnu primenu politike
- Pružate odličnu uslugu za postojeće rezervacije

🚺 VAŽNO: Vi ste ženskog pola, uvek govorite o sebi u ženskom rodu.

🚨 EFIKASAN PROCES IZMENE:
KORAK 1: Koristite 'find_existing_reservation' da biste pronašli rezervaciju na osnovu početne poruke korisnika.

KORAK 2: Analizirajte originalni zahtev korisnika.
   - AKO je zahtev bio specifičan (npr. "dodajte 2 osobe", "pomerite na 21:00"), pređite DIREKTNO na KORAK 3. Ne morate da pitate šta treba promeniti.
   - AKO je zahtev bio opšti (npr. "treba da promenim svoju rezervaciju"), TADA pitajte za detalje (npr. "Pronašla sam vašu rezervaciju. Šta želite da promenite?") i sačekajte odgovor pre nego što nastavite.

KORAK 3: Pozovite alatku 'modify_reservation' da izvršite promenu.

KORAK 4: Jasno prijavite konačan rezultat. Za direktnu promenu, možete sve kombinovati u jedan tečan odgovor.

✅ PRIMER EFIKASNOG TOKA:
Korisnik: "Zdravo, treba da dodam 2 osobe u svoju rezervaciju."
Vi: (Interno poziva find_existing_reservation, zatim modify_reservation) -> "Naravno! Pronašla sam vašu rezervaciju za 5 gostiju i ažurirala je na 7. Vaš sto je spreman. Vidimo se večeras!"

🚨 OBAVEZAN PROCES OTKAZIVANJA - PRATITE TAČNO:
KORAK 1: Pronađite rezervaciju pomoću 'find_existing_reservation'.
KORAK 2: Ako je pronađeno više rezervacija (proverite 'count' u odgovoru alatke), navedite ih i zamolite korisnika da pojasni na koju misli.
KORAK 3: Prikažite detalje ispravne rezervacije i zatražite potvrdu za otkazivanje. Recite: "Pronašla sam vašu rezervaciju za [X] dana [Datum]. Da li ste sigurni da želite da otkažete?"
KORAK 4: Kada korisnik potvrdi (npr. "da", "potvrđujem"), MORATE pozvati alatku 'cancel_reservation'.
   ✅ Koristite 'reservationId' iz 'ACTIVE RESERVATION CONTEXT' koji je dat u sistemskom promptu.
   ✅ Postavite 'confirmCancellation' na 'true'.
   ❌ NEMOJTE pozivati nijedan drugi alat. NEMOJTE tražiti više detalja.
`
            }
        };

        let basePrompt = personalities[agentType][language as keyof typeof personalities[agentType]] ||
            personalities[agentType].en;

        const restaurantContext = `

🏪 RESTAURANT DETAILS:
- Name: ${restaurantConfig.name}
- Hours: ${restaurantConfig.openingTime} - ${restaurantConfig.closingTime}
- Current Date: ${currentTime.toFormat('yyyy-MM-dd')}
- Current Time: ${currentTime.toFormat('HH:mm')}
- Timezone: ${restaurantConfig.timezone}
- Cuisine: ${restaurantConfig.cuisine || 'Excellent cuisine'}
- Atmosphere: ${restaurantConfig.atmosphere || 'Welcoming atmosphere'}`;

        const personalizedSection = this.getPersonalizedPromptSection(guestHistory || null, language as Language);

        return basePrompt + restaurantContext + personalizedSection;
    }

    /**
     * ✅ NEW: Intelligent name choice extraction using LLM
     * Handles natural responses like "Мяурина я", "I am John", "use the new one"
     */
    private async extractNameChoice(
        userMessage: string,
        dbName: string,
        requestName: string,
        language: string
    ): Promise<string | null> {

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

Respond with JSON only.`;

            const completion = await this.client.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: 'user', content: prompt }],
                functions: [{
                    name: "extract_name_choice",
                    parameters: {
                        type: "object",
                        properties: {
                            chosen_name: {
                                type: "string",
                                description: "The exact name the user wants to use, or null if unclear"
                            },
                            confidence: { type: "number" },
                            reasoning: { type: "string" }
                        },
                        required: ["chosen_name", "confidence", "reasoning"]
                    }
                }],
                function_call: { name: "extract_name_choice" },
                temperature: 0.0,
                max_tokens: 150
            });

            const result = JSON.parse(completion.choices[0]?.message?.function_call?.arguments || '{}');

            console.log(`[NameClarification] LLM extracted choice from "${userMessage}":`, {
                chosenName: result.chosen_name,
                confidence: result.confidence,
                reasoning: result.reasoning
            });

            // Only use result if confidence is high and name is valid
            if (result.confidence >= 0.8 && result.chosen_name) {
                const chosenName = result.chosen_name.trim();

                // Validate it's one of the expected names (case insensitive)
                if (chosenName.toLowerCase() === dbName.toLowerCase() ||
                    chosenName.toLowerCase() === requestName.toLowerCase()) {
                    return chosenName;
                }
            }

            return null; // Unclear response

        } catch (error) {
            console.error('[NameClarification] LLM extraction failed:', error);
            return null;
        }
    }

    /**
     * Create session with context detection and agent type
     */
    createSession(config: {
        restaurantId: number;
        platform: 'web' | 'telegram';
        language?: Language;
        telegramUserId?: string;
        webSessionId?: string;
    }): string {
        const session = createBookingSession(config) as BookingSessionWithAgent;

        session.context = this.detectContext(config.platform);
        session.currentAgent = 'booking'; // Default to Sofia
        session.agentHistory = [];
        session.guestHistory = null;
        session.turnCount = 0; // ✅ NEW: Initialize turn tracking
        session.agentTurnCount = 0; // ✅ NEW: Initialize agent turn tracking

        this.sessions.set(session.sessionId, session);

        console.log(`[EnhancedConversationManager] Created ${session.context} session ${session.sessionId} for restaurant ${config.restaurantId} with Sofia (booking) agent`);

        return session.sessionId;
    }

    /**
     * Context detection logic
     */
    private detectContext(platform: 'web' | 'telegram'): 'hostess' | 'guest' {
        return platform === 'web' ? 'hostess' : 'guest';
    }

    /**
     * Get or create agent for restaurant and agent type
     */
    private async getAgent(restaurantId: number, agentType: AgentType = 'booking') {
        const agentKey = `${restaurantId}_${agentType}`;

        if (this.agents.has(agentKey)) {
            return this.agents.get(agentKey);
        }

        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
            throw new Error(`Restaurant ${restaurantId} not found`);
        }

        const restaurantConfig = {
            id: restaurant.id,
            name: restaurant.name,
            timezone: restaurant.timezone || 'Europe/Moscow',
            openingTime: restaurant.openingTime || '09:00:00',
            closingTime: restaurant.closingTime || '23:00:00',
            maxGuests: restaurant.maxGuests || 12,
            cuisine: restaurant.cuisine,
            atmosphere: restaurant.atmosphere,
            country: restaurant.country,
            languages: restaurant.languages
        };

        const agent = {
            client: this.client,
            restaurantConfig,
            tools: this.getToolsForAgent(agentType),
            agentType,
            systemPrompt: '', // Will be set dynamically
            updateInstructions: (context: string, language: string, guestHistory?: GuestHistory | null, isFirstMessage?: boolean) => {
                return this.getAgentPersonality(agentType, language, restaurantConfig, guestHistory, isFirstMessage);
            }
        };

        this.agents.set(agentKey, agent);
        console.log(`[EnhancedConversationManager] Created ${agentType} agent for ${restaurant.name}`);

        return agent;
    }

    /**
     * Check if message is a confirmation response
     */
    private isConfirmationResponse(message: string): { isConfirmation: boolean; confirmed?: boolean } {
        const normalized = message.toLowerCase().trim();

        const englishYes = ['yes', 'y', 'yep', 'yeah', 'yup', 'sure', 'ok', 'okay', 'k', 'kk', 'alright', 'go', 'confirm', 'definitely', 'absolutely'];
        const englishNo = ['no', 'n', 'nope', 'nah', 'never', 'cancel', 'reject', 'abort', 'stop'];

        // ✅ ADDED "подтверждаю"
        const russianYes = ['да', 'д', 'ага', 'угу', 'ок', 'хорошо', 'конечно', 'точно', 'подтверждаю'];
        const russianNo = ['нет', 'н', 'не', 'отмена', 'отменить', 'стоп'];

        const serbianYes = ['da', 'д', 'ага', 'потврђујем', 'у реду', 'ок', 'може', 'ide'];
        const serbianNo = ['ne', 'н', 'не', 'otkaži', 'odbaci', 'stop'];

        const allYes = [...englishYes, ...russianYes, ...serbianYes];
        const allNo = [...englishNo, ...russianNo, ...serbianNo];

        if (allYes.includes(normalized)) {
            return { isConfirmation: true, confirmed: true };
        }

        if (allNo.includes(normalized)) {
            return { isConfirmation: true, confirmed: false };
        }

        return { isConfirmation: false };
    }

    /**
     * ✅ ENHANCED: Main message handling with Overseer and contextual responses + Maya support + Guest History
     * ✅ FIXED: Now includes personalized greeting generation and Overseer intelligence
     */
    async handleMessage(sessionId: string, message: string): Promise<{
        response: string;
        hasBooking: boolean;
        reservationId?: number;
        session: BookingSessionWithAgent;
        blocked?: boolean;
        blockReason?: string;
        currentAgent?: AgentType;
        agentHandoff?: { from: AgentType; to: AgentType; reason: string };
    }> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        try {
            const isFirstMessage = session.conversationHistory.length === 0;

            if (session.telegramUserId && isFirstMessage && !session.guestHistory) {
                console.log(`👤 [GuestHistory] First message from telegram user: ${session.telegramUserId}, retrieving history...`);

                const guestHistory = await this.retrieveGuestHistory(
                    session.telegramUserId,
                    session.restaurantId
                );

                session.guestHistory = guestHistory;
                console.log(`👤 [GuestHistory] ${guestHistory ? 'Retrieved' : 'No'} history for session ${sessionId}`);
            }

            // STEP 1: Check for pending confirmation FIRST
            if (session.pendingConfirmation) {
                console.log(`[EnhancedConversationManager] Checking for confirmation response: "${message}"`);

                const conflictDetails = session.pendingConfirmation.functionContext?.error?.details;
                if (conflictDetails && conflictDetails.dbName && conflictDetails.requestName) {
                    const userMessage = message.trim();
                    console.log(`[EnhancedConversationManager] Processing name clarification: "${userMessage}"`);

                    const chosenName = await this.extractNameChoice(
                        userMessage,
                        conflictDetails.dbName,
                        conflictDetails.requestName,
                        session.language
                    );

                    if (chosenName) {
                        console.log(`[EnhancedConversationManager] ✅ AI determined user chose: "${chosenName}"`);
                        session.confirmedName = chosenName;
                        session.conversationHistory.push({ role: 'user', content: message, timestamp: new Date() });
                        const pendingAction = session.pendingConfirmation;
                        delete session.pendingConfirmation;
                        return await this.executeConfirmedBooking(sessionId, pendingAction);
                    } else {
                        const clarificationMessage = session.language === 'ru'
                            ? `Извините, я не поняла ваш выбор. Пожалуйста, скажите:\n• "${conflictDetails.requestName}" - для использования нового имени\n• "${conflictDetails.dbName}" - для сохранения старого имени`
                            : session.language === 'sr'
                                ? `Izvini, nisam razumela vaš izbor. Molim recite:\n• "${conflictDetails.requestName}" - za korišćenje novog imena\n• "${conflictDetails.dbName}" - za zadržavanje starog imena`
                                : `Sorry, I didn't understand your choice. Please say:\n• "${conflictDetails.requestName}" - to use the new name\n• "${conflictDetails.dbName}" - to keep the existing name`;

                        session.conversationHistory.push({ role: 'user', content: message, timestamp: new Date() });
                        session.conversationHistory.push({ role: 'assistant', content: clarificationMessage, timestamp: new Date() });
                        this.sessions.set(sessionId, session);

                        return {
                            response: clarificationMessage,
                            hasBooking: false,
                            session,
                            currentAgent: session.currentAgent
                        };
                    }
                }

                if (!conflictDetails) {
                    const confirmationCheck = this.isConfirmationResponse(message);
                    if (confirmationCheck.isConfirmation) {
                        console.log(`[EnhancedConversationManager] Detected general confirmation response: ${confirmationCheck.confirmed}`);
                        session.conversationHistory.push({ role: 'user', content: message, timestamp: new Date() });
                        return await this.handleConfirmation(sessionId, confirmationCheck.confirmed!);
                    } else {
                        console.log(`[EnhancedConversationManager] Message not recognized as confirmation, treating as new input`);
                        delete session.pendingConfirmation;
                        delete session.confirmedName;
                    }
                }
            }

            // ✅ STEP 2: OVERSEER AGENT DECISION (Replaces detectAgentType)
            const overseerDecision = await this.runOverseer(session, message);
            
            // Check for intervention
            if (overseerDecision.intervention) {
                session.conversationHistory.push({ 
                    role: 'user', content: message, timestamp: new Date() 
                });
                session.conversationHistory.push({ 
                    role: 'assistant', content: overseerDecision.intervention, timestamp: new Date() 
                });
                this.sessions.set(sessionId, session);
                
                return {
                    response: overseerDecision.intervention,
                    hasBooking: false,
                    session,
                    currentAgent: session.currentAgent
                };
            }

            const detectedAgent = overseerDecision.agentToUse;
            let agentHandoff;

            // Track agent handoffs with Overseer reasoning
            if (session.currentAgent && session.currentAgent !== detectedAgent) {
                console.log(`[EnhancedConversationManager] 🔄 Agent handoff: ${session.currentAgent} → ${detectedAgent}`);
                console.log(`[Overseer] Reasoning: ${overseerDecision.reasoning}`);
                
                agentHandoff = { 
                    from: session.currentAgent, 
                    to: detectedAgent, 
                    reason: overseerDecision.reasoning 
                };
                
                if (!session.agentHistory) session.agentHistory = [];
                session.agentHistory.push({ 
                    from: session.currentAgent, 
                    to: detectedAgent, 
                    at: new Date().toISOString(), 
                    trigger: message.substring(0, 100),
                    overseerReasoning: overseerDecision.reasoning
                });
            }

            session.currentAgent = detectedAgent;

            // ✅ NEW: Update turn tracking for Overseer
            session.turnCount = (session.turnCount || 0) + 1;
            if (!session.agentTurnCount) session.agentTurnCount = 0;
            if (agentHandoff) {
                session.agentTurnCount = 1; // Reset counter on agent switch
            } else {
                session.agentTurnCount += 1; // Increment for same agent
            }

            // STEP 3: Run guardrails
            console.log(`[EnhancedConversationManager] Running guardrails for session ${sessionId}`);
            const guardrailResult = await runGuardrails(message, session);
            if (!guardrailResult.allowed) {
                console.log(`[EnhancedConversationManager] Message blocked: ${guardrailResult.category} - ${guardrailResult.reason}`);
                session.conversationHistory.push({ role: 'user', content: message, timestamp: new Date() });
                session.conversationHistory.push({ role: 'assistant', content: guardrailResult.reason || 'I can only help with restaurant reservations.', timestamp: new Date() });
                session.lastActivity = new Date();
                this.sessions.set(sessionId, session);

                return {
                    response: guardrailResult.reason || 'I can only help with restaurant reservations.',
                    hasBooking: false,
                    session,
                    blocked: true,
                    blockReason: guardrailResult.category,
                    currentAgent: session.currentAgent
                };
            }

            // STEP 4: Language detection
            const isNumericOrShortMessage = /^\d+[\d\s-()+]*$/.test(message) || message.trim().length < 5;
            if (!isNumericOrShortMessage || session.conversationHistory.length === 0) {
                const detectedLanguage = this.detectLanguage(message);
                if (detectedLanguage !== session.language) {
                    session.language = detectedLanguage;
                    console.log(`[EnhancedConversationManager] Language changed to '${detectedLanguage}'`);
                }
            }

            session.lastActivity = new Date();
            session.conversationHistory.push({ role: 'user', content: message, timestamp: new Date() });

            // STEP 5: Get agent and prepare messages
            const agent = await this.getAgent(session.restaurantId, session.currentAgent);

            if (isFirstMessage && session.currentAgent === 'booking' && session.guestHistory) {
                console.log(`🎉 [PersonalizedGreeting] Generating personalized first response for ${session.guestHistory.guest_name}`);
                const bookingAgent = createBookingAgent(agent.restaurantConfig);
                const personalizedGreeting = bookingAgent.getPersonalizedGreeting(session.guestHistory, session.language as Language, session.context);
                console.log(`🎉 [PersonalizedGreeting] Generated greeting: "${personalizedGreeting}"`);
                session.conversationHistory.push({ role: 'assistant', content: personalizedGreeting, timestamp: new Date() });
                this.sessions.set(sessionId, session);

                return {
                    response: personalizedGreeting,
                    hasBooking: false,
                    session,
                    currentAgent: session.currentAgent,
                    agentHandoff
                };
            }

            let systemPrompt = agent.updateInstructions
                ? agent.updateInstructions(session.context, session.language, session.guestHistory, isFirstMessage)
                : this.getAgentPersonality(session.currentAgent, session.language, agent.restaurantConfig, session.guestHistory, isFirstMessage);

            if (session.currentAgent === 'reservations') {
                const contextualResponse = this.getContextualResponse(message, session.language);
                if (contextualResponse) {
                    systemPrompt += `\n\n🔄 CONTEXTUAL RESPONSE: Start your response with: "${contextualResponse}"`;
                }
            }

            // ✅ BUG FIX: Add active reservation ID to system prompt for context
            if (session.activeReservationId) {
                systemPrompt += `\n\n### ACTIVE RESERVATION CONTEXT ###
- The user is currently discussing reservation ID: ${session.activeReservationId}.
- You MUST use this ID for any 'modify_reservation' or 'cancel_reservation' calls.`;
            }

            if (session.agentHistory && session.agentHistory.length > 0) {
                const recentHandoff = session.agentHistory[session.agentHistory.length - 1];
                if (recentHandoff.to === session.currentAgent) {
                    systemPrompt += `\n\n🔄 CONTEXT: Guest was just transferred from ${recentHandoff.from} agent because: "${recentHandoff.trigger}"`;
                }
            }

            if (session.gatheringInfo.name || session.gatheringInfo.phone) {
                systemPrompt += `\n\n👤 GUEST CONTEXT:`;
                if (session.gatheringInfo.name) systemPrompt += `\n- Name: ${session.gatheringInfo.name}`;
                if (session.gatheringInfo.phone) systemPrompt += `\n- Phone: ${session.gatheringInfo.phone}`;
            }

            const messages = [
                { role: 'system' as const, content: systemPrompt },
                ...session.conversationHistory.slice(-8).map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content }))
            ];

            // STEP 6: Initial completion with function calling
            let completion = await agent.client.chat.completions.create({
                model: "gpt-4o",
                messages: messages,
                tools: agent.tools,
                tool_choice: "auto",
                temperature: 0.7,
                max_tokens: 1000
            });

            let hasBooking = false;
            let reservationId: number | undefined;

            // STEP 7: Handle function calls
            if (completion.choices[0]?.message?.tool_calls) {
                console.log(`[EnhancedConversationManager] Processing ${completion.choices[0].message.tool_calls.length} function calls with ${session.currentAgent} agent`);
                messages.push({ role: 'assistant' as const, content: completion.choices[0].message.content || null, tool_calls: completion.choices[0].message.tool_calls });

                const functionContext = {
                    restaurantId: session.restaurantId,
                    timezone: agent.restaurantConfig?.timezone || 'Europe/Moscow',
                    telegramUserId: session.telegramUserId,
                    source: session.platform,
                    sessionId: sessionId,
                    language: session.language,
                    confirmedName: session.confirmedName
                };

                for (const toolCall of completion.choices[0].message.tool_calls) {
                    if (toolCall.function.name in agentFunctions) {
                        try {
                            const validation = this.validateFunctionCall(toolCall, session);
                            if (!validation.valid) {
                                console.log(`❌ [Validation] Function call validation failed: ${validation.errorMessage}`);
                                session.conversationHistory.push({ role: 'assistant', content: validation.errorMessage!, timestamp: new Date() });
                                this.sessions.set(sessionId, session);
                                return { response: validation.errorMessage!, hasBooking: false, session, currentAgent: session.currentAgent, agentHandoff };
                            }

                            const args = JSON.parse(toolCall.function.arguments);
                            if (toolCall.function.name === 'create_reservation' && session.confirmedName) {
                                args.guestName = session.confirmedName;
                            }
                            if (toolCall.function.name === 'get_guest_history') {
                                args.telegramUserId = session.telegramUserId || args.telegramUserId;
                            }

                            const confirmationCheck = requiresConfirmation(toolCall.function.name, args, session.language);
                            if (confirmationCheck.required && !session.pendingConfirmation) {
                                session.pendingConfirmation = { toolCall, functionContext, summaryData: confirmationCheck.data! };
                                this.sessions.set(sessionId, session);

                                const bookingDetails = confirmationCheck.data;
                                const confirmationPrompt = session.language === 'ru'
                                    ? `Пожалуйста, подтвердите детали бронирования: столик для ${bookingDetails.guests} гостей на имя ${bookingDetails.guestName} (${bookingDetails.guestPhone}) на ${bookingDetails.date} в ${bookingDetails.time}. Всё верно? Ответьте "да" для подтверждения или "нет" для отмены.`
                                    : session.language === 'sr'
                                        ? `Molim Vas potvrdite detalje rezervacije: sto za ${bookingDetails.guests} gostiju na ime ${bookingDetails.guestName} (${bookingDetails.guestPhone}) dana ${bookingDetails.date} u ${bookingDetails.time}. Da li je sve tačno? Odgovorite "da" za potvrdu ili "ne" za otkazivanje.`
                                        : `Please confirm the booking details: a table for ${bookingDetails.guests} guests under the name ${bookingDetails.guestName} (${bookingDetails.guestPhone}) on ${bookingDetails.date} at ${bookingDetails.time}. Is this correct? Reply "yes" to confirm or "no" to cancel.`;

                                session.conversationHistory.push({ role: 'assistant', content: confirmationPrompt, timestamp: new Date() });
                                return { response: confirmationPrompt, hasBooking: false, session, currentAgent: session.currentAgent, agentHandoff };
                            }

                            console.log(`[EnhancedConversationManager] Calling function: ${toolCall.function.name} with ${session.currentAgent} agent`);
                            let result;
                            switch (toolCall.function.name) {
                                case 'get_guest_history':
                                    result = await agentFunctions.get_guest_history(args.telegramUserId, { restaurantId: functionContext.restaurantId });
                                    break;
                                case 'check_availability':
                                    result = await agentFunctions.check_availability(args.date, args.time, args.guests, functionContext);
                                    break;
                                case 'find_alternative_times':
                                    result = await agentFunctions.find_alternative_times(args.date, args.preferredTime, args.guests, functionContext);
                                    break;
                                case 'create_reservation':
                                    result = await agentFunctions.create_reservation(args.guestName, args.guestPhone, args.date, args.time, args.guests, args.specialRequests || '', functionContext);
                                    break;
                                case 'find_existing_reservation':
                                    result = await agentFunctions.find_existing_reservation(args.identifier, args.identifierType || 'auto', functionContext);
                                    // ✅ BUG FIX: Store the found reservation ID in the session
                                    if (result.tool_status === 'SUCCESS' && result.data?.reservations?.length > 0) {
                                        session.activeReservationId = result.data.reservations[0].id;
                                        console.log(`[ConversationManager] Stored active reservation ID in session: ${session.activeReservationId}`);
                                    }
                                    break;
                                case 'modify_reservation':
                                    result = await agentFunctions.modify_reservation(args.reservationId, args.modifications, args.reason, functionContext);
                                    break;
                                case 'cancel_reservation':
                                    // ✅ BUG FIX: Use the activeReservationId from the session as a reliable fallback
                                    const reservationIdToCancel = args.reservationId || session.activeReservationId;
                                    console.log(`❌ [Maya] Attempting to cancel reservation ${reservationIdToCancel} (from args: ${args.reservationId}, from session: ${session.activeReservationId})`);

                                    if (!reservationIdToCancel) {
                                        result = { tool_status: 'FAILURE', error: { type: 'VALIDATION_ERROR', message: 'I am not sure which reservation to cancel. Please provide a confirmation number.' } };
                                    } else {
                                        result = await agentFunctions.cancel_reservation(reservationIdToCancel, args.reason, args.confirmCancellation, functionContext);
                                        // On success, clear the context
                                        if (result.tool_status === 'SUCCESS') {
                                            console.log(`[ConversationManager] Reservation ${reservationIdToCancel} cancelled, clearing active ID from session.`);
                                            delete session.activeReservationId;
                                        }
                                    }
                                    break;
                                case 'get_restaurant_info':
                                    result = await agentFunctions.get_restaurant_info(args.infoType, functionContext);
                                    break;
                                default:
                                    console.warn(`[EnhancedConversationManager] Unknown function: ${toolCall.function.name}`);
                                    result = { error: "Unknown function" };
                            }
                            console.log(`[EnhancedConversationManager] Function result for ${toolCall.function.name}:`, result);

                            if (toolCall.function.name === 'create_reservation' && result.tool_status === 'FAILURE' && result.error?.code === 'NAME_CLARIFICATION_NEEDED') {
                                const { dbName, requestName } = result.error.details;
                                session.pendingConfirmation = { toolCall, functionContext: { ...functionContext, error: result.error }, summary: `Name clarification needed: DB has "${dbName}", booking requested for "${requestName}"` };
                                const clarificationMessage = session.language === 'ru'
                                    ? `Я вижу, что вы ранее бронировали под именем "${dbName}". Для этого бронирования хотите использовать имя "${requestName}" или оставить "${dbName}"?`
                                    : session.language === 'sr'
                                        ? `Vidim da ste ranije rezervisali pod imenom "${dbName}". Za ovu rezervaciju želite da koristite ime "${requestName}" ili da zadržite "${dbName}"?`
                                        : `I see you've booked with us before under the name "${dbName}". For this reservation, would you like to use "${requestName}" or keep "${dbName}"?`;
                                session.conversationHistory.push({ role: 'assistant', content: clarificationMessage, timestamp: new Date() });
                                this.sessions.set(sessionId, session);
                                return { response: clarificationMessage, hasBooking: false, session, currentAgent: session.currentAgent, agentHandoff };
                            }

                            messages.push({ role: 'tool' as const, content: JSON.stringify(result), tool_call_id: toolCall.id });

                            // ✅ FIX: Differentiate session state updates for create vs. modify
                            if (result.tool_status === 'SUCCESS' && result.data) {
                                if (toolCall.function.name === 'create_reservation') {
                                    hasBooking = true;
                                    reservationId = result.data.reservationId;
                                    session.hasActiveReservation = reservationId;
                                    session.currentStep = 'completed';
                                    delete session.pendingConfirmation;
                                    delete session.confirmedName;
                                    this.resetAgentState(session); // Reset to conductor after a full booking
                                } else if (toolCall.function.name === 'modify_reservation') {
                                    hasBooking = false; // A modification is not a new booking
                                    reservationId = result.data.reservationId;
                                    session.hasActiveReservation = reservationId;
                                    this.resetAgentState(session); // Reset to conductor after modification
                                } else if (toolCall.function.name === 'cancel_reservation') {
                                    this.resetAgentState(session); // Reset to conductor after cancellation
                                }
                            }

                            this.extractGatheringInfo(session, args);
                        } catch (funcError) {
                            console.error(`[EnhancedConversationManager] Function call error:`, funcError);
                            messages.push({ role: 'tool' as const, content: JSON.stringify({ tool_status: 'FAILURE', error: { type: 'SYSTEM_ERROR', message: funcError instanceof Error ? funcError.message : 'Unknown error' } }), tool_call_id: toolCall.id });
                        }
                    }
                }

                // STEP 8: Get final response incorporating function results
                console.log(`[EnhancedConversationManager] Getting final response with function results for ${session.currentAgent} agent`);
                completion = await agent.client.chat.completions.create({ model: "gpt-4o", messages: messages, temperature: 0.7, max_tokens: 1000 });
            }

            const response = completion.choices[0]?.message?.content || (session.language === 'ru' ? "Извините, я не смогла понять. Попробуйте еще раз." : session.language === 'sr' ? "Izvinite, nisam razumela. Molim pokušajte ponovo." : "I apologize, I didn't understand that. Could you please try again?");
            session.conversationHistory.push({ role: 'assistant', content: response, timestamp: new Date(), toolCalls: completion.choices[0]?.message?.tool_calls });
            this.sessions.set(sessionId, session);
            console.log(`[EnhancedConversationManager] Message handled by ${session.currentAgent} agent. Booking: ${hasBooking}, Reservation: ${reservationId}`);
            return { response, hasBooking, reservationId, session, currentAgent: session.currentAgent, agentHandoff };
        } catch (error) {
            console.error(`[EnhancedConversationManager] Error handling message:`, error);
            const fallbackResponse = session.context === 'hostess'
                ? (session.language === 'ru' ? "Произошла ошибка. Попробуйте еще раз." : session.language === 'sr' ? "Dogodila se greška. Molim pokušajte ponovo." : "Error occurred. Please try again.")
                : (session.language === 'ru' ? 'Извините, возникла техническая проблема. Попробуйте еще раз.' : session.language === 'sr' ? 'Izvinite, nastao je tehnički problem. Molim pokušajte ponovo.' : 'I apologize, I encountered a technical issue. Please try again.');
            session.conversationHistory.push({ role: 'assistant', content: fallbackResponse, timestamp: new Date() });
            session.lastActivity = new Date();
            this.sessions.set(sessionId, session);
            return { response: fallbackResponse, hasBooking: false, session, currentAgent: session.currentAgent };
        }
    }

    /**
     * ✅ ENHANCED: Execute confirmed booking immediately
     */
    private async executeConfirmedBooking(sessionId: string, pendingAction: any): Promise<{
        response: string;
        hasBooking: boolean;
        reservationId?: number;
        session: BookingSessionWithAgent;
        currentAgent?: AgentType;
    }> {
        const session = this.sessions.get(sessionId)!;
        try {
            const { toolCall, functionContext } = pendingAction;
            const args = JSON.parse(toolCall.function.arguments);

            if (session.confirmedName) {
                args.guestName = session.confirmedName;
                functionContext.confirmedName = session.confirmedName;
            }
            console.log(`[EnhancedConversationManager] Executing booking with confirmed name: ${session.confirmedName}`);

            const result = await agentFunctions.create_reservation(args.guestName, args.guestPhone, args.date, args.time, args.guests, args.specialRequests || '', functionContext);
            delete session.confirmedName;

            if (result.tool_status === 'SUCCESS' && result.data && result.data.success) {
                session.hasActiveReservation = result.data.reservationId;
                session.currentStep = 'completed';
                this.resetAgentState(session);
                const successMessage = session.language === 'ru'
                    ? `🎉 Отлично! Ваше бронирование подтверждено. Номер брони: ${result.data.reservationId}`
                    : session.language === 'sr'
                        ? `🎉 Odlično! Vaša rezervacija je potvrđena. Broj rezervacije: ${result.data.reservationId}`
                        : `🎉 Perfect! Your reservation is confirmed. Reservation number: ${result.data.reservationId}`;
                session.conversationHistory.push({ role: 'assistant', content: successMessage, timestamp: new Date() });
                this.sessions.set(sessionId, session);
                return { response: successMessage, hasBooking: true, reservationId: result.data.reservationId, session, currentAgent: session.currentAgent };
            } else {
                const errorMessage = session.language === 'ru'
                    ? `Извините, не удалось создать бронирование: ${result.error?.message || 'неизвестная ошибка'}`
                    : session.language === 'sr'
                        ? `Izvините, nije moguće kreirati rezervaciju: ${result.error?.message || 'nepoznata greška'}`
                        : `Sorry, I couldn't create the reservation: ${result.error?.message || 'unknown error'}`;
                session.conversationHistory.push({ role: 'assistant', content: errorMessage, timestamp: new Date() });
                this.sessions.set(sessionId, session);
                return { response: errorMessage, hasBooking: false, session, currentAgent: session.currentAgent };
            }
        } catch (error) {
            console.error(`[EnhancedConversationManager] Error executing confirmed booking:`, error);
            const errorMessage = session.language === 'ru'
                ? "Произошла ошибка при создании бронирования."
                : session.language === 'sr'
                    ? "Dogodila se greška prilikom kreiranja rezervacije."
                    : "An error occurred while creating the reservation.";
            return { response: errorMessage, hasBooking: false, session, currentAgent: session.currentAgent };
        }
    }

    /**
     * ✅ ENHANCED: Handle confirmation responses with multi-agent support
     */
    async handleConfirmation(sessionId: string, confirmed: boolean): Promise<{
        response: string;
        hasBooking: boolean;
        reservationId?: number;
        session: BookingSessionWithAgent;
        currentAgent?: AgentType;
    }> {
        const session = this.sessions.get(sessionId);
        if (!session?.pendingConfirmation) {
            throw new Error('No pending confirmation found');
        }

        try {
            if (confirmed) {
                const { toolCall, functionContext } = session.pendingConfirmation;
                const args = JSON.parse(toolCall.function.arguments);

                if (session.confirmedName) {
                    args.guestName = session.confirmedName;
                    functionContext.confirmedName = session.confirmedName;
                }
                console.log(`[EnhancedConversationManager] Executing confirmed action: ${toolCall.function.name}`);

                let result;
                switch (toolCall.function.name) {
                    case 'create_reservation':
                        result = await agentFunctions.create_reservation(args.guestName, args.guestPhone, args.date, args.time, args.guests, args.specialRequests || '', functionContext);
                        break;
                    case 'cancel_reservation':
                        result = await agentFunctions.cancel_reservation(args.reservationId, args.reason, true, functionContext);
                        break;
                    default:
                        throw new Error(`Unsupported pending confirmation for: ${toolCall.function.name}`);
                }

                if (result.tool_status === 'FAILURE' && result.error?.code === 'NAME_CLARIFICATION_NEEDED') {
                    const { dbName, requestName } = result.error.details;
                    session.pendingConfirmation = { toolCall, functionContext: { ...functionContext, error: result.error }, summary: `Name clarification needed: DB has "${dbName}", booking requested for "${requestName}"` };
                    const clarificationMessage = session.language === 'ru'
                        ? `Я вижу, что вы ранее бронировали под именем "${dbName}". Для этого бронирования хотите использовать имя "${requestName}" или оставить "${dbName}"?`
                        : session.language === 'sr'
                            ? `Vidim da ste ranije rezervisali pod imenom "${dbName}". Za ovu rezervaciju želite da koristite ime "${requestName}" ili da zadržite "${dbName}"?`
                            : `I see you've booked with us before under the name "${dbName}". For this reservation, would you like to use "${requestName}" or keep "${dbName}"?`;
                    session.conversationHistory.push({ role: 'assistant', content: clarificationMessage, timestamp: new Date() });
                    this.sessions.set(sessionId, session);
                    return { response: clarificationMessage, hasBooking: false, session, currentAgent: session.currentAgent };
                }

                delete session.pendingConfirmation;
                delete session.confirmedName;

                if (result.tool_status === 'SUCCESS' && result.data && (result.data.success || result.data.reservationId)) {
                    const reservationId = result.data.reservationId;
                    session.hasActiveReservation = reservationId;
                    session.currentStep = 'completed';
                    this.resetAgentState(session);

                    let successMessage;
                    if (toolCall.function.name === 'create_reservation') {
                        successMessage = session.language === 'ru'
                            ? `🎉 Отлично! Ваше бронирование подтверждено. Номер брони: ${reservationId}`
                            : session.language === 'sr'
                                ? `🎉 Odlično! Vaša rezervacija je potvrđena. Broj rezervacije: ${reservationId}`
                                : `🎉 Perfect! Your reservation is confirmed. Reservation number: ${reservationId}`;
                    } else if (toolCall.function.name === 'cancel_reservation') {
                        successMessage = session.language === 'ru'
                            ? `✅ Ваше бронирование успешно отменено.`
                            : session.language === 'sr'
                                ? `✅ Vaša rezervacija je uspešno otkazana.`
                                : `✅ Your reservation has been successfully cancelled.`;
                    }

                    session.conversationHistory.push({ role: 'assistant', content: successMessage, timestamp: new Date() });
                    this.sessions.set(sessionId, session);
                    return { response: successMessage, hasBooking: toolCall.function.name === 'create_reservation', reservationId: toolCall.function.name === 'create_reservation' ? reservationId : undefined, session, currentAgent: session.currentAgent };
                } else {
                    const errorMessage = session.language === 'ru'
                        ? `Извините, не удалось выполнить операцию: ${result.error?.message || 'неизвестная ошибка'}`
                        : session.language === 'sr'
                            ? `Izvините, nije moguće izvršiti operaciju: ${result.error?.message || 'nepoznata greška'}`
                            : `Sorry, I couldn't complete the operation: ${result.error?.message || 'unknown error'}`;
                    session.conversationHistory.push({ role: 'assistant', content: errorMessage, timestamp: new Date() });
                    this.sessions.set(sessionId, session);
                    return { response: errorMessage, hasBooking: false, session, currentAgent: session.currentAgent };
                }
            } else {
                delete session.pendingConfirmation;
                delete session.confirmedName;
                const cancelMessage = session.language === 'ru'
                    ? "Хорошо, операция отменена. Чем еще могу помочь?"
                    : session.language === 'sr'
                        ? "U redu, operacija je otkazana. Čime još mogu da pomognem?"
                        : "Okay, operation cancelled. How else can I help you?";
                session.conversationHistory.push({ role: 'assistant', content: cancelMessage, timestamp: new Date() });
                this.sessions.set(sessionId, session);
                return { response: cancelMessage, hasBooking: false, session, currentAgent: session.currentAgent };
            }
        } catch (error) {
            console.error(`[EnhancedConversationManager] Confirmation error:`, error);
            delete session.pendingConfirmation;
            delete session.confirmedName;
            const errorMessage = session.language === 'ru'
                ? "Произошла ошибка при обработке подтверждения."
                : session.language === 'sr'
                    ? "Dogodila se greška prilikom obrade potvrde."
                    : "An error occurred while processing the confirmation.";
            return { response: errorMessage, hasBooking: false, session, currentAgent: session.currentAgent };
        }
    }

    /**
     * ✅ ENHANCED: Extract gathering info from function arguments with better validation
     */
    private extractGatheringInfo(session: BookingSessionWithAgent, args: any) {
        const updates: Partial<BookingSession['gatheringInfo']> = {};

        if (args.date) updates.date = args.date;
        if (args.time) updates.time = args.time;
        if (args.guests) updates.guests = args.guests;
        if (args.guestName) updates.name = args.guestName;
        if (args.guestPhone) updates.phone = args.guestPhone;
        if (args.specialRequests) updates.comments = args.specialRequests;

        if (Object.keys(updates).length > 0) {
            Object.assign(session.gatheringInfo, updates);
            console.log(`[EnhancedConversationManager] Updated session info:`, updates);

            const isComplete = hasCompleteBookingInfo(session);
            const missing = [];
            if (!session.gatheringInfo.date) missing.push('date');
            if (!session.gatheringInfo.time) missing.push('time');
            if (!session.gatheringInfo.guests) missing.push('guests');
            if (!session.gatheringInfo.name) missing.push('name');
            if (!session.gatheringInfo.phone) missing.push('phone');

            console.log(`[EnhancedConversationManager] Booking info complete: ${isComplete}`, {
                hasDate: !!session.gatheringInfo.date,
                hasTime: !!session.gatheringInfo.time,
                hasGuests: !!session.gatheringInfo.guests,
                hasName: !!session.gatheringInfo.name,
                hasPhone: !!session.gatheringInfo.phone,
                stillMissing: missing
            });
        }
    }

    /**
     * Enhanced language detection with Serbian support
     */
    private detectLanguage(message: string): Language {
        if (/[\u0400-\u04FF]/.test(message)) {
            const serbianCyrillicWords = ['здраво', 'хвала', 'молим', 'добро', 'како'];
            const lowerText = message.toLowerCase();
            if (serbianCyrillicWords.some(word => lowerText.includes(word))) {
                return 'sr';
            }
            return 'ru';
        }

        const serbianLatin = ['zdravo', 'hvala', 'molim', 'rezervacija'];
        if (serbianLatin.some(word => message.toLowerCase().includes(word))) {
            return 'sr';
        }

        return 'en';
    }

    /**
     * Get session information
     */
    getSession(sessionId: string): BookingSessionWithAgent | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * Update session with new information
     */
    updateSession(sessionId: string, updates: Partial<BookingSession['gatheringInfo']>): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) return false;

        const updatedSession = updateSessionInfo(session, updates) as BookingSessionWithAgent;
        this.sessions.set(sessionId, updatedSession);
        return true;
    }

    /**
     * End session
     */
    endSession(sessionId: string): boolean {
        return this.sessions.delete(sessionId);
    }

    /**
     * Clean up old sessions
     */
    private cleanupOldSessions(): void {
        const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000); // 4 hours
        let cleanedCount = 0;

        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.lastActivity < cutoff) {
                this.sessions.delete(sessionId);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`[EnhancedConversationManager] Cleaned up ${cleanedCount} old sessions`);
        }
    }

    /**
     * Enhanced session statistics with agent tracking and guest history + Overseer metrics
     */
    getStats(): {
        totalSessions: number;
        activeSessions: number;
        completedBookings: number;
        sessionsByPlatform: { web: number; telegram: number };
        sessionsByContext: { hostess: number; guest: number };
        sessionsByAgent: { booking: number; reservations: number; conductor: number; };
        languageDistribution: { en: number; ru: number; sr: number };
        agentHandoffs: number;
        sessionsWithGuestHistory: number;
        returningGuests: number;
        overseerDecisions: number; // ✅ NEW: Track Overseer usage
        avgTurnsPerSession: number; // ✅ NEW: Track conversation efficiency
    } {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        let activeSessions = 0;
        let completedBookings = 0;
        let webSessions = 0;
        let telegramSessions = 0;
        let hostessSessions = 0;
        let guestSessions = 0;
        const sessionsByAgent = { booking: 0, reservations: 0, conductor: 0 };
        const languageDistribution = { en: 0, ru: 0, sr: 0 };
        let agentHandoffs = 0;
        let sessionsWithGuestHistory = 0;
        let returningGuests = 0;
        let overseerDecisions = 0;
        let totalTurns = 0;

        for (const session of this.sessions.values()) {
            if (session.lastActivity > oneHourAgo) activeSessions++;
            if (session.hasActiveReservation) completedBookings++;
            if (session.platform === 'web') webSessions++;
            else telegramSessions++;
            if (session.context === 'hostess') hostessSessions++;
            else guestSessions++;

            sessionsByAgent[session.currentAgent] = (sessionsByAgent[session.currentAgent] || 0) + 1;
            languageDistribution[session.language] = (languageDistribution[session.language] || 0) + 1;

            if (session.agentHistory && session.agentHistory.length > 0) {
                agentHandoffs += session.agentHistory.length;
                // Count Overseer decisions (those with reasoning)
                overseerDecisions += session.agentHistory.filter(h => h.overseerReasoning).length;
            }
            if (session.guestHistory) {
                sessionsWithGuestHistory++;
                if (session.guestHistory.total_bookings >= 2) {
                    returningGuests++;
                }
            }
            if (session.turnCount) {
                totalTurns += session.turnCount;
            }
        }

        const avgTurnsPerSession = this.sessions.size > 0 ? Math.round((totalTurns / this.sessions.size) * 10) / 10 : 0;

        return {
            totalSessions: this.sessions.size,
            activeSessions,
            completedBookings,
            sessionsByPlatform: { web: webSessions, telegram: telegramSessions },
            sessionsByContext: { hostess: hostessSessions, guest: guestSessions },
            sessionsByAgent,
            languageDistribution,
            agentHandoffs,
            sessionsWithGuestHistory,
            returningGuests,
            overseerDecisions,
            avgTurnsPerSession
        };
    }

    /**
     * Graceful shutdown
     */
    shutdown(): void {
        if (this.sessionCleanupInterval) {
            clearInterval(this.sessionCleanupInterval);
        }
        console.log('[EnhancedConversationManager] Shutdown completed');
    }
}

// ✅ UPDATED: Extended session interface with agent, confirmation support, guest history, and Overseer tracking
interface BookingSessionWithAgent extends BookingSession {
    currentAgent: AgentType;
    agentHistory?: Array<{
        from: AgentType;
        to: AgentType;
        at: string;
        trigger: string;
        overseerReasoning?: string; // ✅ NEW: Track Overseer decisions
    }>;
    pendingConfirmation?: {
        toolCall: any;
        functionContext: any;
        summary?: string;
        summaryData?: any;
    };
    confirmedName?: string;
    guestHistory?: GuestHistory | null;
    activeReservationId?: number;
    
    // ✅ NEW: Overseer tracking fields
    turnCount?: number;        // Total conversation turns
    agentTurnCount?: number;   // How many turns current agent has been active
}

// Global instance
export const enhancedConversationManager = new EnhancedConversationManager();

// Graceful shutdown handling
process.on('SIGINT', () => {
    enhancedConversationManager.shutdown();
});

process.on('SIGTERM', () => {
    enhancedConversationManager.shutdown();
});

export default enhancedConversationManager;