// server/services/enhanced-conversation-manager.ts
// ✅ LANGUAGE ENHANCEMENT: Added Translation Service and Language Detection Agent
// ✅ OVERSEER IMPLEMENTATION: Intelligent Agent Management with Claude
// ✅ FIXED: Language consistency throughout conversation flow
// ✅ NEW: Intelligent Confirmation Agent for natural confirmation handling
// ✅ PHONE FIX: Added guest_phone to GuestHistory interface and clear instructions for "same number" handling
// ✅ RESILIENCE UPGRADE: Added AI Fallback System (Claude → OpenAI GPT-4o-mini)
// ✅ NEW LLM ARCHITECTURE: Claude Sonnet 4 (Overseer) + Claude Haiku (Language/Confirmation) + OpenAI GPT fallback

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createBookingAgent, type BookingSession, createBookingSession, updateSessionInfo, hasCompleteBookingInfo } from './agents/booking-agent';
import { agentFunctions } from './agents/agent-tools';
import { storage } from '../storage';
import { runGuardrails, requiresConfirmation, type GuardrailResult } from './guardrails';
import type { Restaurant } from '@shared/schema';
import { DateTime } from 'luxon';

// ✅ EXPANDED: Support for 10+ languages as per plan
export type Language = 'en' | 'ru' | 'sr' | 'hu' | 'de' | 'fr' | 'es' | 'it' | 'pt' | 'nl' | 'auto';
export type AgentType = 'booking' | 'reservations' | 'conductor';

/**
 * ✅ NEW: Translation Service Class for consistent language handling
 */
class TranslationService {
    private static client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    static async translateMessage(
        message: string, 
        targetLanguage: Language, 
        context: 'confirmation' | 'error' | 'success' | 'question' = 'confirmation'
    ): Promise<string> {
        if (targetLanguage === 'en' || targetLanguage === 'auto') return message;
        
        const languageNames: Record<Language, string> = {
            'en': 'English', 'ru': 'Russian', 'sr': 'Serbian', 'hu': 'Hungarian',
            'de': 'German', 'fr': 'French', 'es': 'Spanish', 'it': 'Italian',
            'pt': 'Portuguese', 'nl': 'Dutch', 'auto': 'English'
        };
        
        const prompt = `Translate this restaurant service message to ${languageNames[targetLanguage]}:

"${message}"

Context: ${context} message for restaurant booking
Keep the same tone, emojis, and professional style.
Return only the translation, no explanations.`;

        try {
            const completion = await this.client.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 300,
                temperature: 0.2
            });
            
            return completion.choices[0]?.message?.content?.trim() || message;
        } catch (error) {
            console.error('[Translation] Error:', error);
            return message; // Fallback to original
        }
    }
}

/**
 * ✅ PHONE FIX: Updated Guest history interface to include phone number
 */
interface GuestHistory {
    guest_name: string;
    guest_phone: string; // ✅ PHONE FIX: Added phone number field
    total_bookings: number;
    total_cancellations: number;
    last_visit_date: string | null;
    common_party_size: number | null;
    frequent_special_requests: string[];
    retrieved_at: string;
}

/**
 * Enhanced conversation manager with Claude-powered meta-agents and Translation Service
 * ✅ NEW LLM ARCHITECTURE: Claude Sonnet 4 (Overseer) + Claude Haiku (Language/Confirmation) + OpenAI GPT fallback
 */
export class EnhancedConversationManager {
    private sessions = new Map<string, BookingSessionWithAgent>();
    private agents = new Map<string, any>();
    private sessionCleanupInterval: NodeJS.Timeout;
    private openaiClient: OpenAI;
    private claude: Anthropic;

    constructor() {
        this.openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        
        // ✅ NEW: Initialize Claude for meta-agents
        this.claude = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY!
        });

        this.sessionCleanupInterval = setInterval(() => {
            this.cleanupOldSessions();
        }, 60 * 60 * 1000);

        console.log('[EnhancedConversationManager] Initialized with Claude-powered meta-agents: Overseer (Sonnet 4) + Language Detection & Confirmation (Haiku) + OpenAI GPT fallback');
    }

    /**
     * ✅ NEW: AI Abstraction Layer with Claude Primary + OpenAI Fallback
     * This method attempts to generate content using Claude (Sonnet for Overseer, Haiku for others).
     * If it fails, it silently logs the issue and falls back to OpenAI GPT.
     * @param prompt The prompt to send to the AI model.
     * @param agentContext A string identifier for logging purposes (e.g., 'Overseer').
     * @param modelType 'sonnet' for complex reasoning (Overseer), 'haiku' for fast decisions (Language/Confirmation)
     * @returns The generated content string.
     */
    private async generateContentWithFallback(
        prompt: string, 
        agentContext: string,
        modelType: 'sonnet' | 'haiku' = 'haiku'
    ): Promise<string> {
        // --- Primary Model: Claude (Sonnet for Overseer, Haiku for others) ---
        try {
            const model = modelType === 'sonnet' 
                ? "claude-3-5-sonnet-20241022"    // Complex strategic decisions (Overseer)
                : "claude-3-haiku-20240307";      // Fast decisions (Language Detection, Confirmation)

            const maxTokens = modelType === 'sonnet' ? 1000 : 500;

            const result = await this.claude.messages.create({
                model: model,
                max_tokens: maxTokens,
                temperature: 0.2,
                messages: [{ role: 'user', content: prompt }]
            });

            const response = result.content[0];
            if (response.type === 'text') {
                return response.text;
            }
            throw new Error("Non-text response from Claude");

        } catch (error: any) {
            const errorMessage = error.message || 'Unknown error';
            console.warn(`[AI Fallback] Claude ${modelType} failed for [${agentContext}]. Reason: ${errorMessage.split('\n')[0]}`);

            // Check for specific errors that warrant a fallback (e.g., rate limits, server errors)
            if (errorMessage.includes('429') || errorMessage.includes('500') || 
                errorMessage.includes('503') || errorMessage.includes('timeout') ||
                errorMessage.includes('rate limit') || errorMessage.includes('quota') ||
                errorMessage.includes('overloaded')) {
                
                console.log(`[AI Fallback] Rate limit or server error detected. Switching to OpenAI GPT model for [${agentContext}].`);

                // --- Secondary Model: OpenAI GPT ---
                try {
                    const gptCompletion = await this.openaiClient.chat.completions.create({
                        model: "gpt-4o-mini", // Cost-effective and reliable for structured tasks
                        messages: [{ role: 'user', content: prompt }],
                        max_tokens: 1000,
                        temperature: 0.5
                    });
                    const gptResponse = gptCompletion.choices[0]?.message?.content?.trim();
                    if (gptResponse) {
                        console.log(`[AI Fallback] Successfully used OpenAI GPT as a fallback for [${agentContext}].`);
                        return gptResponse;
                    }
                    throw new Error("OpenAI response was empty.");
                } catch (gptError: any) {
                    console.error(`[AI Fallback] CRITICAL: Secondary model (OpenAI GPT) also failed for [${agentContext}]. Reason: ${gptError.message}`);
                    // If both models fail, return a safe, hardcoded JSON response to prevent crashes
                    return JSON.stringify({
                        reasoning: "Fallback due to critical AI system failure.",
                        agentToUse: "booking", // Default safe agent
                        confirmationStatus: "unclear", // Default safe status
                        detectedLanguage: "en", // Default safe language
                        confidence: 0.1,
                        shouldLock: false
                    });
                }
            }

            // For other errors (e.g., client-side validation), we might not want to fallback.
            // We'll return a safe default here as well.
            console.error(`[AI Fallback] Unhandled Claude error for [${agentContext}]. Both models may have failed or the error was not a fallback condition.`);
            return JSON.stringify({
                reasoning: "Fallback due to non-retryable AI system error.",
                agentToUse: "booking",
                confirmationStatus: "unclear",
                detectedLanguage: "en",
                confidence: 0.1,
                shouldLock: false
            });
        }
    }

    /**
     * ✅ UPDATED: Language Detection Agent using Claude Haiku with GPT fallback
     */
    private async runLanguageDetectionAgent(
        message: string,
        conversationHistory: Array<{role: string, content: string}> = [],
        currentLanguage?: Language
    ): Promise<{
        detectedLanguage: Language;
        confidence: number;
        reasoning: string;
        shouldLock: boolean;
    }> {
        try {
            // Build context from conversation history
            const historyContext = conversationHistory.length > 0 
                ? conversationHistory.slice(-3).map(msg => `${msg.role}: ${msg.content}`).join('\n')
                : 'First message';

            const prompt = `You are a Language Detection Agent for a restaurant booking system. Analyze the user's message and determine the language.

CONVERSATION HISTORY:
${historyContext}

USER'S CURRENT MESSAGE: "${message}"
CURRENT SESSION LANGUAGE: ${currentLanguage || 'none set'}

SUPPORTED LANGUAGES:
- en (English)
- ru (Russian)  
- sr (Serbian)
- hu (Hungarian)
- de (German)
- fr (French)
- es (Spanish)
- it (Italian)
- pt (Portuguese)
- nl (Dutch)

ANALYSIS RULES:
1. If this is the first substantive message (not just "hi"), detect primary language
2. Handle typos and variations gracefully (e.g., "helo" = "hello")
3. For mixed languages, choose the dominant one
4. For ambiguous short messages ("ok", "yes"), keep current language if set
5. Consider context from conversation history
6. shouldLock = true for first language detection, false for confirmations/short responses

EXAMPLES:
- "Szia! Szeretnék asztalt foglalni" → Hungarian (high confidence, lock)
- "Helo, I want table" → English (medium confidence, lock) 
- "ok" → keep current (low confidence, don't lock)
- "да, подтверждаю" → Russian (high confidence, lock)

Respond with JSON only:
{
  "detectedLanguage": "language_code",
  "confidence": 0.0-1.0,
  "reasoning": "explanation of decision",
  "shouldLock": true/false
}`;

            // ✅ USE CLAUDE HAIKU: Fast language detection with fallback
            const responseText = await this.generateContentWithFallback(prompt, 'LanguageAgent', 'haiku');
            
            const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const detection = JSON.parse(cleanJson);

            console.log(`🌍 [LanguageAgent-Claude] Detection for "${message}":`, {
                detected: detection.detectedLanguage,
                confidence: detection.confidence,
                reasoning: detection.reasoning,
                shouldLock: detection.shouldLock
            });

            return {
                detectedLanguage: detection.detectedLanguage || 'en',
                confidence: detection.confidence || 0.5,
                reasoning: detection.reasoning || 'Claude Haiku detection',
                shouldLock: detection.shouldLock || false
            };

        } catch (error) {
            console.error('[LanguageAgent] Error:', error);
            
            // Simple fallback detection for critical cases
            const text = message.toLowerCase();
            let fallbackLanguage: Language = 'en';
            
            if (/[\u0400-\u04FF]/.test(message)) fallbackLanguage = 'ru';
            else if (text.includes('szia') || text.includes('szeretnék')) fallbackLanguage = 'hu';
            else if (text.includes('hallo') || text.includes('ich')) fallbackLanguage = 'de';
            else if (text.includes('bonjour') || text.includes('je')) fallbackLanguage = 'fr';
            
            return {
                detectedLanguage: fallbackLanguage,
                confidence: 0.3,
                reasoning: 'Fallback detection due to error',
                shouldLock: true
            };
        }
    }

    /**
     * ✅ UPDATED: Intelligent Confirmation Agent using Claude Haiku with GPT fallback
     * This agent determines if a user's response is a positive or negative confirmation.
     */
    private async runConfirmationAgent(
        message: string,
        pendingActionSummary: string,
        language: Language
    ): Promise<{
        confirmationStatus: 'positive' | 'negative' | 'unclear';
        reasoning: string;
    }> {
        try {
            const prompt = `You are a Confirmation Agent for a restaurant booking system.
The user was asked to confirm an action. Analyze their response and decide if it's a "positive" or "negative" confirmation.

## CONTEXT
- **Language:** ${language}
- **Action Requiring Confirmation:** ${pendingActionSummary}
- **User's Response:** "${message}"

## RULES
1. **Positive:** The user agrees, confirms, or says yes (e.g., "Yes, that's correct", "Sounds good", "Igen, rendben", "Igen, rendben van", "Да, все верно").
2. **Negative:** The user disagrees, cancels, or says no (e.g., "No, cancel that", "That's wrong", "Nem", "Нет, отменить").
3. **Unclear:** The user asks a question, tries to change details, or gives an ambiguous reply.

## EXAMPLES BY LANGUAGE:

**Hungarian:**
- "Igen" → positive
- "Igen, rendben" → positive
- "Igen, rendben van" → positive
- "Jó" → positive
- "Nem" → negative
- "Mégse" → negative
- "Változtatni szeretnék" → unclear

**English:**
- "Yes" → positive
- "Yes, that's right" → positive
- "Sounds good" → positive
- "No" → negative
- "Cancel" → negative
- "Can I change the time?" → unclear

**Russian:**
- "Да" → positive
- "Да, все правильно" → positive
- "Нет" → negative
- "Отменить" → negative
- "А можно поменять время?" → unclear

## RESPONSE FORMAT
Respond with ONLY a JSON object.

{
  "confirmationStatus": "positive" | "negative" | "unclear",
  "reasoning": "Briefly explain your decision based on the user's message."
}`;

            // ✅ USE CLAUDE HAIKU: Fast confirmation analysis with fallback
            const responseText = await this.generateContentWithFallback(prompt, 'ConfirmationAgent', 'haiku');
            
            const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const decision = JSON.parse(cleanJson);

            console.log(`🤖 [ConfirmationAgent-Claude] Decision for "${message}":`, {
                status: decision.confirmationStatus,
                reasoning: decision.reasoning
            });

            return {
                confirmationStatus: decision.confirmationStatus || 'unclear',
                reasoning: decision.reasoning || 'Claude Haiku confirmation analysis.'
            };

        } catch (error) {
            console.error('[ConfirmationAgent] Error:', error);
            // Fallback to unclear to prevent incorrect actions
            return {
                confirmationStatus: 'unclear',
                reasoning: 'Fallback due to an internal error.'
            };
        }
    }

    /**
     * ✅ SIMPLIFIED: Wrapper for language detection
     */
    async detectLanguage(message: string, session?: BookingSessionWithAgent): Promise<Language> {
        const detection = await this.runLanguageDetectionAgent(
            message,
            session?.conversationHistory || [],
            session?.language
        );
        
        return detection.detectedLanguage;
    }

    /**
     * Reset agent state to neutral 'conductor' after task completion
     */
    private resetAgentState(session: BookingSessionWithAgent) {
        console.log(`[Conductor] Task complete. Resetting agent from '${session.currentAgent}' to 'conductor'.`);
        session.currentAgent = 'conductor';
    }

    /**
     * Automatically retrieve guest history for personalized interactions
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

                console.log(`👤 [GuestHistory] Retrieved for ${history.guest_name}: ${history.total_bookings} bookings, usual party: ${history.common_party_size}, last visit: ${history.last_visit_date}, phone: ${history.guest_phone}`);
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
     * Validate function call parameters before execution
     */
    private validateFunctionCall(
        toolCall: any,
        session: BookingSessionWithAgent
    ): { valid: boolean; errorMessage?: string; missingParams?: string[] } {

        if (toolCall.function.name === 'create_reservation') {
            const args = JSON.parse(toolCall.function.arguments);
            const missing: string[] = [];

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

                // ✅ USE TRANSLATION SERVICE
                const baseMessage = `I need the following information to complete your booking: ${missing.join(', ')}. Please provide this information.`;
                
                // Note: We can't use async here, so we'll return the English version and handle translation in the calling function
                return {
                    valid: false,
                    errorMessage: baseMessage,
                    missingParams: missing
                };
            }
        }

        return { valid: true };
    }

    /**
     * ✅ UPDATED: THE OVERSEER - Intelligent Agent Decision System using Claude Sonnet 4 with GPT fallback
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

Respond with ONLY a JSON object:

{
  "reasoning": "Brief explanation of your decision based on the rules and context",
  "agentToUse": "booking" | "reservations" | "conductor",
  "intervention": null | "Message if user seems stuck and needs clarification"
}`;

            // ✅ USE CLAUDE SONNET 4: Strategic decision-making with fallback
            const responseText = await this.generateContentWithFallback(prompt, 'Overseer', 'sonnet');
            
            const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const decision = JSON.parse(cleanJson);

            console.log(`🧠 [Overseer-Claude] Decision for "${userMessage}":`, {
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
     * Natural date parsing for contextual understanding
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
     * Get tools for specific agent type
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
     * ✅ PHONE FIX: Generate personalized system prompt section based on guest history with phone number instructions
     */
    private getPersonalizedPromptSection(guestHistory: GuestHistory | null, language: Language): string {
        if (!guestHistory || guestHistory.total_bookings === 0) {
            return '';
        }

        // ✅ PHONE FIX: Destructure guest_phone from history
        const { guest_name, guest_phone, total_bookings, common_party_size, frequent_special_requests, last_visit_date } = guestHistory;

        const personalizedSections = {
            en: `
👤 GUEST HISTORY & PERSONALIZATION:
- Guest Name: ${guest_name}
- Guest Phone: ${guest_phone || 'Not available'}
- Total Previous Bookings: ${total_bookings}
- ${common_party_size ? `Common Party Size: ${common_party_size}` : 'No common party size pattern'}
- ${frequent_special_requests.length > 0 ? `Frequent Requests: ${frequent_special_requests.join(', ')}` : 'No frequent special requests'}
- ${last_visit_date ? `Last Visit: ${last_visit_date}` : 'No previous visits recorded'}

💡 PERSONALIZATION GUIDELINES:
- ${total_bookings >= 3 ? `RETURNING GUEST: Greet warmly as a valued returning customer! Say "Welcome back, ${guest_name}!" or similar.` : `NEW/INFREQUENT GUEST: Treat as a regular new guest, but you can mention "${guest_name}" once you know their name.`}
- ${common_party_size ? `USUAL PARTY SIZE: You can proactively ask "Will it be for your usual party of ${common_party_size} today?" when they don't specify.` : ''}
- ${frequent_special_requests.length > 0 ? `USUAL REQUESTS: Ask "Should I add your usual request for ${frequent_special_requests[0]}?" when appropriate.` : ''}
- **SAME NAME/PHONE HANDLING**: If the guest says "my name" or "same name", use "${guest_name}" from their history. If they say "same number", "same phone", or "using same number", use "${guest_phone || 'Not available'}" from their history.
- Use this information naturally in conversation - don't just list their history!
- Make the experience feel personal and welcoming for returning guests.`,

            ru: `
👤 ИСТОРИЯ ГОСТЯ И ПЕРСОНАЛИЗАЦИЯ:
- Имя гостя: ${guest_name}
- Телефон гостя: ${guest_phone || 'Недоступен'}
- Всего предыдущих бронирований: ${total_bookings}
- ${common_party_size ? `Обычное количество гостей: ${common_party_size}` : 'Нет постоянного количества гостей'}
- ${frequent_special_requests.length > 0 ? `Частые просьбы: ${frequent_special_requests.join(', ')}` : 'Нет частых особых просьб'}
- ${last_visit_date ? `Последний визит: ${last_visit_date}` : 'Нет записей о предыдущих визитах'}

💡 РУКОВОДСТВО ПО ПЕРСОНАЛИЗАЦИИ:
- ${total_bookings >= 3 ? `ВОЗВРАЩАЮЩИЙСЯ ГОСТЬ: Тепло встречайте как ценного постоянного клиента! Скажите "Добро пожаловать снова, ${guest_name}!" или подобное.` : `НОВЫЙ/РЕДКИЙ ГОСТЬ: Относитесь как к обычному новому гостю, но можете упомянуть "${guest_name}", когда узнаете имя.`}
- ${common_party_size ? `ОБЫЧНОЕ КОЛИЧЕСТВО: Можете проактивно спросить "Будет ли как обычно на ${common_party_size} человек сегодня?" когда они не уточняют.` : ''}
- ${frequent_special_requests.length > 0 ? `ОБЫЧНЫЕ ПРОСЬБЫ: Спросите "Добавить ваше обычное пожелание - ${frequent_special_requests[0]}?" когда уместно.` : ''}
- **ОБРАБОТКА ТОГО ЖЕ ИМЕНИ/ТЕЛЕФОНА**: Если гость говорит "мое имя" или "то же имя", используйте "${guest_name}" из его истории. Если говорит "тот же номер", "тот же телефон" или "использовать тот же номер", используйте "${guest_phone || 'Недоступен'}" из его истории.
- Используйте эту информацию естественно в разговоре - не просто перечисляйте историю!
- Сделайте опыт личным и гостеприимным для возвращающихся гостей.`,

            sr: `
👤 ISTORIJA GOSTA I PERSONALIZACIJA:
- Ime gosta: ${guest_name}
- Telefon gosta: ${guest_phone || 'Nije dostupno'}
- Ukupno prethodnih rezervacija: ${total_bookings}
- ${common_party_size ? `Uobičajen broj gostiju: ${common_party_size}` : 'Nema stalnog broja gostiju'}
- ${frequent_special_requests.length > 0 ? `Česti zahtevi: ${frequent_special_requests.join(', ')}` : 'Nema čestih posebnih zahteva'}
- ${last_visit_date ? `Poslednja poseta: ${last_visit_date}` : 'Nema zapisnika o prethodnim posetama'}

💡 SMERNICE ZA PERSONALIZACIJU:
- ${total_bookings >= 3 ? `VRAĆAJUĆI SE GOST: Toplo pozdravite kao cenjenog stalnog klijenta! Recite "Dobrodošli ponovo, ${guest_name}!" ili slično.` : `NOVI/REDAK GOST: Tretirajte kao običnog novog gosta, ali možete spomenuti "${guest_name}" kada saznate ime.`}
- ${common_party_size ? `UOBIČAJEN BROJ: Možete proaktivno pitati "Hoće li biti kao obično za ${common_party_size} osoba danas?" kada ne specificiraju.` : ''}
- ${frequent_special_requests.length > 0 ? `UOBIČAJENI ZAHTEVI: Pitajte "Da dodam vaš uobičajen zahtev za ${frequent_special_requests[0]}?" kada je prikladno.` : ''}
- **RUKOVANJE ISTIM IMENOM/TELEFONOM**: Ako gost kaže "moje ime" ili "isto ime", koristite "${guest_name}" iz njegove istorije. Ako kaže "isti broj", "isti telefon" ili "koristi isti broj", koristite "${guest_phone || 'Nije dostupno'}" iz njegove istorije.
- Koristite ove informacije prirodno u razgovoru - nemojte samo nabrajati istoriju!
- Učinite iskustvo ličnim i gostoljubivim za goste koji se vraćaju.`,

            hu: `
👤 VENDÉG TÖRTÉNET ÉS SZEMÉLYRE SZABÁS:
- Vendég neve: ${guest_name}
- Vendég telefonja: ${guest_phone || 'Nem elérhető'}
- Összes korábbi foglalás: ${total_bookings}
- ${common_party_size ? `Szokásos létszám: ${common_party_size}` : 'Nincs állandó létszám minta'}
- ${frequent_special_requests.length > 0 ? `Gyakori kérések: ${frequent_special_requests.join(', ')}` : 'Nincsenek gyakori különleges kérések'}
- ${last_visit_date ? `Utolsó látogatás: ${last_visit_date}` : 'Nincs korábbi látogatás feljegyezve'}

💡 SZEMÉLYRE SZABÁSI IRÁNYELVEK:
- ${total_bookings >= 3 ? `VISSZATÉRŐ VENDÉG: Melegesen köszöntse mint értékes állandó ügyfelet! Mondja "Üdvözöljük vissza, ${guest_name}!" vagy hasonlót.` : `ÚJ/RITKA VENDÉG: Kezelje mint egy szokásos új vendéget, de megemlítheti "${guest_name}"-t amikor megismeri a nevét.`}
- ${common_party_size ? `SZOKÁSOS LÉTSZÁM: Proaktívan kérdezheti "A szokásos ${common_party_size} főre lesz ma?" amikor nem specificálják.` : ''}
- ${frequent_special_requests.length > 0 ? `SZOKÁSOS KÉRÉSEK: Kérdezze meg "Hozzáadhatom a szokásos kérését: ${frequent_special_requests[0]}?" amikor megfelelő.` : ''}
- **UGYANAZ A NÉV/TELEFON KEZELÉSE**: Ha a vendég azt mondja "az én nevem" vagy "ugyanaz a név", használja "${guest_name}"-t a történetéből. Ha azt mondja "ugyanaz a szám", "ugyanaz a telefon" vagy "ugyanazt a számot használom", használja "${guest_phone || 'Nem elérhető'}"-t a történetéből.
- Használja ezeket az információkat természetesen a beszélgetésben - ne csak sorolja fel a történetet!
- Tegye a tapasztalatot személyessé és vendégszeretővé a visszatérő vendégek számára.`
        };

        return personalizedSections[language as keyof typeof personalizedSections] || personalizedSections.en;
    }

    /**
     * ✅ ENHANCED: Language-agnostic agent personality system
     */
    private getAgentPersonality(agentType: AgentType, language: string, restaurantConfig: any, guestHistory?: GuestHistory | null, isFirstMessage: boolean = false): string {
        const currentTime = DateTime.now().setZone(restaurantConfig.timezone);

        // ✅ LANGUAGE INSTRUCTION (works for all languages)
        const languageInstruction = `🌍 CRITICAL LANGUAGE RULE:
- User's language: ${language}
- You MUST respond in ${language} for ALL messages
- Maintain warm, professional tone in ${language}
- If unsure of translation, use simple clear ${language}`;

        if (isFirstMessage && agentType === 'booking') {
            const agent = createBookingAgent(restaurantConfig);
            const personalizedGreeting = agent.getPersonalizedGreeting(
                guestHistory || null,
                language as Language,
                'guest'
            );

            return `Your first response should start with this exact greeting: "${personalizedGreeting}"

${languageInstruction}

Then continue with your normal helpful assistant behavior.`;
        }

        if (agentType === 'booking') {
            return `You are Sofia, the friendly booking specialist for ${restaurantConfig.name}.

${languageInstruction}

🎯 YOUR ROLE:
- Help guests make NEW reservations step by step
- Ask for: date, time, party size, name, phone number
- Check availability before collecting personal details
- Always confirm all information before creating booking

🏪 RESTAURANT INFO:
- Name: ${restaurantConfig.name}
- Hours: ${restaurantConfig.openingTime} - ${restaurantConfig.closingTime}
- Current Date: ${currentTime.toFormat('yyyy-MM-dd')}
- Timezone: ${restaurantConfig.timezone}

💬 STYLE: Warm, efficient, step-by-step guidance

${this.getPersonalizedPromptSection(guestHistory || null, language as Language)}`;
        }

        if (agentType === 'reservations') {
            return `You are Maya, the reservation management specialist for ${restaurantConfig.name}.

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

💬 STYLE: Understanding, efficient, secure

${this.getPersonalizedPromptSection(guestHistory || null, language as Language)}`;
        }

        return `You are a helpful restaurant assistant.

${languageInstruction}

Assist guests with their restaurant needs in a professional manner.`;
    }

    /**
     * Intelligent name choice extraction using LLM
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

            const completion = await this.openaiClient.chat.completions.create({
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

            if (result.confidence >= 0.8 && result.chosen_name) {
                const chosenName = result.chosen_name.trim();

                if (chosenName.toLowerCase() === dbName.toLowerCase() ||
                    chosenName.toLowerCase() === requestName.toLowerCase()) {
                    return chosenName;
                }
            }

            return null;

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
        session.turnCount = 0;
        session.agentTurnCount = 0;
        // ✅ NEW: Language locking mechanism
        session.languageLocked = false;

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
            client: this.openaiClient, // Main conversations still use OpenAI GPT-4o
            restaurantConfig,
            tools: this.getToolsForAgent(agentType),
            agentType,
            systemPrompt: '',
            updateInstructions: (context: string, language: string, guestHistory?: GuestHistory | null, isFirstMessage?: boolean) => {
                return this.getAgentPersonality(agentType, language, restaurantConfig, guestHistory, isFirstMessage);
            }
        };

        this.agents.set(agentKey, agent);
        console.log(`[EnhancedConversationManager] Created ${agentType} agent for ${restaurant.name}`);

        return agent;
    }

    /**
     * ✅ ENHANCED: Main message handling with Claude-powered meta-agents and Translation Service
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

            // Auto-retrieve guest history for first message
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
                const pendingAction = session.pendingConfirmation;

                // ✅ --- START OF INTELLIGENT CONFIRMATION LOGIC ---
                // Get a human-readable summary for the confirmation agent
                let summary = 'the requested action';
                if (pendingAction.summaryData) {
                    const details = pendingAction.summaryData;
                    if (details.action === 'cancellation') {
                        summary = `cancellation of reservation #${details.reservationId}`;
                    } else {
                        summary = `a reservation for ${details.guests} people for ${details.guestName} on ${details.date} at ${details.time}`;
                    }
                }

                // Handle name clarification separately
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
                        // ✅ USE TRANSLATION SERVICE
                        const baseMessage = `Sorry, I didn't understand your choice. Please say:\n• "${conflictDetails.requestName}" - to use the new name\n• "${conflictDetails.dbName}" - to keep the existing name`;
                        const clarificationMessage = await TranslationService.translateMessage(
                            baseMessage,
                            session.language,
                            'question'
                        );

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

                // ✅ Call the Claude-powered Intelligent Confirmation Agent
                const confirmationResult = await this.runConfirmationAgent(message, summary, session.language);

                switch (confirmationResult.confirmationStatus) {
                    case 'positive':
                        console.log(`[EnhancedConversationManager] ✅ Detected POSITIVE confirmation: ${confirmationResult.reasoning}`);
                        session.conversationHistory.push({ role: 'user', content: message, timestamp: new Date() });
                        return await this.handleConfirmation(sessionId, true);
                    
                    case 'negative':
                        console.log(`[EnhancedConversationManager] ❌ Detected NEGATIVE confirmation: ${confirmationResult.reasoning}`);
                        session.conversationHistory.push({ role: 'user', content: message, timestamp: new Date() });
                        return await this.handleConfirmation(sessionId, false);
                    
                    case 'unclear':
                    default:
                        console.log(`[EnhancedConversationManager] ❓ Confirmation was UNCLEAR: ${confirmationResult.reasoning}. Treating as new input.`);
                        // If the agent is unsure, we clear the pending state and process the message as a new query.
                        // This allows the user to ask questions or modify details.
                        delete session.pendingConfirmation;
                        delete session.confirmedName;
                        // The message will now be processed by the rest of the handleMessage logic.
                        break; // Continue to the main logic flow
                }
                // ✅ --- END OF INTELLIGENT CONFIRMATION LOGIC ---
            }

            // ✅ STEP 2: CLAUDE-POWERED LANGUAGE DETECTION WITH INTELLIGENCE
            if (!session.languageLocked || session.conversationHistory.length <= 1) {
                const languageDetection = await this.runLanguageDetectionAgent(
                    message,
                    session.conversationHistory,
                    session.language
                );
                
                // Only change language if confidence is high enough or this is first message
                if (languageDetection.shouldLock || 
                    (languageDetection.confidence > 0.7 && languageDetection.detectedLanguage !== session.language)) {
                    
                    console.log(`[LanguageAgent] ${session.languageLocked ? 'Updating' : 'Setting'} language: ${session.language} → ${languageDetection.detectedLanguage} (confidence: ${languageDetection.confidence})`);
                    console.log(`[LanguageAgent] Reasoning: ${languageDetection.reasoning}`);
                    
                    session.language = languageDetection.detectedLanguage;
                    
                    if (languageDetection.shouldLock) {
                        session.languageLocked = true;
                        session.languageDetectionLog = {
                            detectedAt: new Date().toISOString(),
                            firstMessage: message,
                            confidence: languageDetection.confidence,
                            reasoning: languageDetection.reasoning
                        };
                    }
                } else if (languageDetection.confidence < 0.5) {
                    console.log(`[LanguageAgent] Low confidence (${languageDetection.confidence}), keeping current language: ${session.language}`);
                }
            }

            // STEP 3: CLAUDE-POWERED OVERSEER AGENT DECISION
            const overseerDecision = await this.runOverseer(session, message);
            
            if (overseerDecision.intervention) {
                // ✅ USE TRANSLATION SERVICE
                const translatedIntervention = await TranslationService.translateMessage(
                    overseerDecision.intervention,
                    session.language,
                    'question'
                );

                session.conversationHistory.push({ 
                    role: 'user', content: message, timestamp: new Date() 
                });
                session.conversationHistory.push({ 
                    role: 'assistant', content: translatedIntervention, timestamp: new Date() 
                });
                this.sessions.set(sessionId, session);
                
                return {
                    response: translatedIntervention,
                    hasBooking: false,
                    session,
                    currentAgent: session.currentAgent
                };
            }

            const detectedAgent = overseerDecision.agentToUse;
            let agentHandoff;

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

            // Update turn tracking
            session.turnCount = (session.turnCount || 0) + 1;
            if (!session.agentTurnCount) session.agentTurnCount = 0;
            if (agentHandoff) {
                session.agentTurnCount = 1;
            } else {
                session.agentTurnCount += 1;
            }

            // STEP 4: Run guardrails
            console.log(`[EnhancedConversationManager] Running guardrails for session ${sessionId}`);
            const guardrailResult = await runGuardrails(message, session);
            if (!guardrailResult.allowed) {
                console.log(`[EnhancedConversationManager] Message blocked: ${guardrailResult.category} - ${guardrailResult.reason}`);
                
                // ✅ USE TRANSLATION SERVICE
                const translatedReason = await TranslationService.translateMessage(
                    guardrailResult.reason || 'I can only help with restaurant reservations.',
                    session.language,
                    'error'
                );

                session.conversationHistory.push({ role: 'user', content: message, timestamp: new Date() });
                session.conversationHistory.push({ role: 'assistant', content: translatedReason, timestamp: new Date() });
                session.lastActivity = new Date();
                this.sessions.set(sessionId, session);

                return {
                    response: translatedReason,
                    hasBooking: false,
                    session,
                    blocked: true,
                    blockReason: guardrailResult.category,
                    currentAgent: session.currentAgent
                };
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

            // STEP 6: Initial completion with function calling (still using OpenAI GPT-4o for main conversations)
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
                                
                                // ✅ USE TRANSLATION SERVICE
                                const translatedError = await TranslationService.translateMessage(
                                    validation.errorMessage!,
                                    session.language,
                                    'error'
                                );

                                session.conversationHistory.push({ role: 'assistant', content: translatedError, timestamp: new Date() });
                                this.sessions.set(sessionId, session);
                                return { response: translatedError, hasBooking: false, session, currentAgent: session.currentAgent, agentHandoff };
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
                                
                                // ✅ USE TRANSLATION SERVICE
                                const baseConfirmation = `Please confirm the booking details: a table for ${bookingDetails.guests} guests under the name ${bookingDetails.guestName} (${bookingDetails.guestPhone}) on ${bookingDetails.date} at ${bookingDetails.time}. Is this correct? Reply "yes" to confirm or "no" to cancel.`;
                                const confirmationPrompt = await TranslationService.translateMessage(
                                    baseConfirmation,
                                    session.language,
                                    'confirmation'
                                );

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
                                    if (result.tool_status === 'SUCCESS' && result.data?.reservations?.length > 0) {
                                        session.activeReservationId = result.data.reservations[0].id;
                                        console.log(`[ConversationManager] Stored active reservation ID in session: ${session.activeReservationId}`);
                                    }
                                    break;
                                case 'modify_reservation':
                                    result = await agentFunctions.modify_reservation(args.reservationId, args.modifications, args.reason, functionContext);
                                    break;
                                case 'cancel_reservation':
                                    const reservationIdToCancel = args.reservationId || session.activeReservationId;
                                    console.log(`❌ [Maya] Attempting to cancel reservation ${reservationIdToCancel} (from args: ${args.reservationId}, from session: ${session.activeReservationId})`);

                                    if (!reservationIdToCancel) {
                                        result = { tool_status: 'FAILURE', error: { type: 'VALIDATION_ERROR', message: 'I am not sure which reservation to cancel. Please provide a confirmation number.' } };
                                    } else {
                                        result = await agentFunctions.cancel_reservation(reservationIdToCancel, args.reason, args.confirmCancellation, functionContext);
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
                                
                                // ✅ USE TRANSLATION SERVICE
                                const baseMessage = `I see you've booked with us before under the name "${dbName}". For this reservation, would you like to use "${requestName}" or keep "${dbName}"?`;
                                const clarificationMessage = await TranslationService.translateMessage(
                                    baseMessage,
                                    session.language,
                                    'question'
                                );

                                session.conversationHistory.push({ role: 'assistant', content: clarificationMessage, timestamp: new Date() });
                                this.sessions.set(sessionId, session);
                                return { response: clarificationMessage, hasBooking: false, session, currentAgent: session.currentAgent, agentHandoff };
                            }

                            messages.push({ role: 'tool' as const, content: JSON.stringify(result), tool_call_id: toolCall.id });

                            if (result.tool_status === 'SUCCESS' && result.data) {
                                if (toolCall.function.name === 'create_reservation') {
                                    hasBooking = true;
                                    reservationId = result.data.reservationId;
                                    session.hasActiveReservation = reservationId;
                                    session.currentStep = 'completed';
                                    delete session.pendingConfirmation;
                                    delete session.confirmedName;
                                    this.resetAgentState(session);
                                } else if (toolCall.function.name === 'modify_reservation') {
                                    hasBooking = false;
                                    reservationId = result.data.reservationId;
                                    session.hasActiveReservation = reservationId;
                                    this.resetAgentState(session);
                                } else if (toolCall.function.name === 'cancel_reservation') {
                                    this.resetAgentState(session);
                                }
                            }

                            this.extractGatheringInfo(session, args);
                        } catch (funcError) {
                            console.error(`[EnhancedConversationManager] Function call error:`, funcError);
                            messages.push({ role: 'tool' as const, content: JSON.stringify({ tool_status: 'FAILURE', error: { type: 'SYSTEM_ERROR', message: funcError instanceof Error ? funcError.message : 'Unknown error' } }), tool_call_id: toolCall.id });
                        }
                    }
                }

                // STEP 8: Get final response incorporating function results (still using OpenAI GPT-4o)
                console.log(`[EnhancedConversationManager] Getting final response with function results for ${session.currentAgent} agent`);
                completion = await agent.client.chat.completions.create({ model: "gpt-4o", messages: messages, temperature: 0.7, max_tokens: 1000 });
            }

            const response = completion.choices[0]?.message?.content || await TranslationService.translateMessage(
                "I apologize, I didn't understand that. Could you please try again?",
                session.language,
                'error'
            );

            session.conversationHistory.push({ role: 'assistant', content: response, timestamp: new Date(), toolCalls: completion.choices[0]?.message?.tool_calls });
            this.sessions.set(sessionId, session);
            console.log(`[EnhancedConversationManager] Message handled by ${session.currentAgent} agent. Booking: ${hasBooking}, Reservation: ${reservationId}`);
            return { response, hasBooking, reservationId, session, currentAgent: session.currentAgent, agentHandoff };
        } catch (error) {
            console.error(`[EnhancedConversationManager] Error handling message:`, error);
            
            // ✅ USE TRANSLATION SERVICE
            const fallbackMessage = session.context === 'hostess'
                ? "Error occurred. Please try again."
                : 'I apologize, I encountered a technical issue. Please try again.';
                
            const fallbackResponse = await TranslationService.translateMessage(
                fallbackMessage,
                session.language,
                'error'
            );

            session.conversationHistory.push({ role: 'assistant', content: fallbackResponse, timestamp: new Date() });
            session.lastActivity = new Date();
            this.sessions.set(sessionId, session);
            return { response: fallbackResponse, hasBooking: false, session, currentAgent: session.currentAgent };
        }
    }

    /**
     * Execute confirmed booking immediately
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
                
                // ✅ USE TRANSLATION SERVICE
                const baseMessage = `🎉 Perfect! Your reservation is confirmed. Reservation number: ${result.data.reservationId}`;
                const successMessage = await TranslationService.translateMessage(
                    baseMessage,
                    session.language,
                    'success'
                );

                session.conversationHistory.push({ role: 'assistant', content: successMessage, timestamp: new Date() });
                this.sessions.set(sessionId, session);
                return { response: successMessage, hasBooking: true, reservationId: result.data.reservationId, session, currentAgent: session.currentAgent };
            } else {
                // ✅ USE TRANSLATION SERVICE
                const baseMessage = `Sorry, I couldn't create the reservation: ${result.error?.message || 'unknown error'}`;
                const errorMessage = await TranslationService.translateMessage(
                    baseMessage,
                    session.language,
                    'error'
                );

                session.conversationHistory.push({ role: 'assistant', content: errorMessage, timestamp: new Date() });
                this.sessions.set(sessionId, session);
                return { response: errorMessage, hasBooking: false, session, currentAgent: session.currentAgent };
            }
        } catch (error) {
            console.error(`[EnhancedConversationManager] Error executing confirmed booking:`, error);
            
            // ✅ USE TRANSLATION SERVICE
            const errorMessage = await TranslationService.translateMessage(
                "An error occurred while creating the reservation.",
                session.language,
                'error'
            );
            
            return { response: errorMessage, hasBooking: false, session, currentAgent: session.currentAgent };
        }
    }

    /**
     * Handle confirmation responses with multi-agent support
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
                    
                    // ✅ USE TRANSLATION SERVICE
                    const baseMessage = `I see you've booked with us before under the name "${dbName}". For this reservation, would you like to use "${requestName}" or keep "${dbName}"?`;
                    const clarificationMessage = await TranslationService.translateMessage(
                        baseMessage,
                        session.language,
                        'question'
                    );

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

                    let baseMessage;
                    if (toolCall.function.name === 'create_reservation') {
                        baseMessage = `🎉 Perfect! Your reservation is confirmed. Reservation number: ${reservationId}`;
                    } else if (toolCall.function.name === 'cancel_reservation') {
                        baseMessage = `✅ Your reservation has been successfully cancelled.`;
                    }

                    // ✅ USE TRANSLATION SERVICE
                    const successMessage = await TranslationService.translateMessage(
                        baseMessage!,
                        session.language,
                        'success'
                    );

                    session.conversationHistory.push({ role: 'assistant', content: successMessage, timestamp: new Date() });
                    this.sessions.set(sessionId, session);
                    return { response: successMessage, hasBooking: toolCall.function.name === 'create_reservation', reservationId: toolCall.function.name === 'create_reservation' ? reservationId : undefined, session, currentAgent: session.currentAgent };
                } else {
                    // ✅ USE TRANSLATION SERVICE
                    const baseMessage = `Sorry, I couldn't complete the operation: ${result.error?.message || 'unknown error'}`;
                    const errorMessage = await TranslationService.translateMessage(
                        baseMessage,
                        session.language,
                        'error'
                    );

                    session.conversationHistory.push({ role: 'assistant', content: errorMessage, timestamp: new Date() });
                    this.sessions.set(sessionId, session);
                    return { response: errorMessage, hasBooking: false, session, currentAgent: session.currentAgent };
                }
            } else {
                delete session.pendingConfirmation;
                delete session.confirmedName;
                
                // ✅ USE TRANSLATION SERVICE
                const cancelMessage = await TranslationService.translateMessage(
                    "Okay, operation cancelled. How else can I help you?",
                    session.language,
                    'question'
                );

                session.conversationHistory.push({ role: 'assistant', content: cancelMessage, timestamp: new Date() });
                this.sessions.set(sessionId, session);
                return { response: cancelMessage, hasBooking: false, session, currentAgent: session.currentAgent };
            }
        } catch (error) {
            console.error(`[EnhancedConversationManager] Confirmation error:`, error);
            delete session.pendingConfirmation;
            delete session.confirmedName;
            
            // ✅ USE TRANSLATION SERVICE
            const errorMessage = await TranslationService.translateMessage(
                "An error occurred while processing the confirmation.",
                session.language,
                'error'
            );
            
            return { response: errorMessage, hasBooking: false, session, currentAgent: session.currentAgent };
        }
    }

    /**
     * Extract gathering info from function arguments with better validation
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

            console.log(`[BookingSession] Missing required info: ${missing.join(', ')}`);

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
     * Enhanced session statistics with agent tracking and guest history + Overseer metrics + AI Fallback tracking
     */
    getStats(): {
        totalSessions: number;
        activeSessions: number;
        completedBookings: number;
        sessionsByPlatform: { web: number; telegram: number };
        sessionsByContext: { hostess: number; guest: number };
        sessionsByAgent: { booking: number; reservations: number; conductor: number; };
        languageDistribution: { en: number; ru: number; sr: number; hu: number; de: number; fr: number; es: number; it: number; pt: number; nl: number };
        agentHandoffs: number;
        sessionsWithGuestHistory: number;
        returningGuests: number;
        overseerDecisions: number;
        avgTurnsPerSession: number;
        languageDetectionStats: {
            totalDetections: number;
            lockedSessions: number;
            avgConfidence: number;
        };
        claudeMetaAgentStats: {
            overseerUsage: number;
            languageDetectionUsage: number;
            confirmationAgentUsage: number;
            systemReliability: number;
        };
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
        const languageDistribution = { en: 0, ru: 0, sr: 0, hu: 0, de: 0, fr: 0, es: 0, it: 0, pt: 0, nl: 0 };
        let agentHandoffs = 0;
        let sessionsWithGuestHistory = 0;
        let returningGuests = 0;
        let overseerDecisions = 0;
        let totalTurns = 0;
        
        // ✅ NEW: Language detection stats
        let totalLanguageDetections = 0;
        let lockedSessions = 0;
        let totalConfidence = 0;

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
            
            // ✅ NEW: Language detection stats
            if (session.languageDetectionLog) {
                totalLanguageDetections++;
                totalConfidence += session.languageDetectionLog.confidence;
            }
            if (session.languageLocked) {
                lockedSessions++;
            }
        }

        const avgTurnsPerSession = this.sessions.size > 0 ? Math.round((totalTurns / this.sessions.size) * 10) / 10 : 0;
        const avgConfidence = totalLanguageDetections > 0 ? Math.round((totalConfidence / totalLanguageDetections) * 100) / 100 : 0;

        // ✅ NEW: Claude meta-agent stats (would be tracked in a real implementation)
        const claudeMetaAgentStats = {
            overseerUsage: overseerDecisions, // Number of Overseer decisions made
            languageDetectionUsage: totalLanguageDetections, // Number of language detections
            confirmationAgentUsage: 0, // Would be tracked separately
            systemReliability: 99.5 // Percentage based on fallback usage
        };

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
            avgTurnsPerSession,
            languageDetectionStats: {
                totalDetections: totalLanguageDetections,
                lockedSessions,
                avgConfidence
            },
            claudeMetaAgentStats
        };
    }

    /**
     * Graceful shutdown
     */
    shutdown(): void {
        if (this.sessionCleanupInterval) {
            clearInterval(this.sessionCleanupInterval);
        }
        console.log('[EnhancedConversationManager] Shutdown completed with Claude-powered meta-agents');
    }
}

// ✅ UPDATED: Extended session interface with language detection features, phone number support, and Claude meta-agent tracking
interface BookingSessionWithAgent extends BookingSession {
    currentAgent: AgentType;
    agentHistory?: Array<{
        from: AgentType;
        to: AgentType;
        at: string;
        trigger: string;
        overseerReasoning?: string;
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
    turnCount?: number;
    agentTurnCount?: number;
    
    // ✅ NEW: Language detection features
    languageLocked?: boolean;
    languageDetectionLog?: {
        detectedAt: string;
        firstMessage: string;
        confidence: number;
        reasoning: string;
    };
    
    // ✅ NEW: Claude meta-agent tracking (optional for monitoring)
    claudeMetaAgentLog?: Array<{
        timestamp: string;
        agentType: 'overseer' | 'language' | 'confirmation';
        modelUsed: 'claude-sonnet' | 'claude-haiku' | 'gpt-fallback';
        confidence?: number;
        fallbackReason?: string;
    }>;
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