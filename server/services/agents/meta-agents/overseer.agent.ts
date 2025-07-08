// server/services/agents/meta-agents/overseer.agent.ts
// ✅ PHASE 3: Overseer agent extracted from enhanced-conversation-manager.ts
// SOURCE: enhanced-conversation-manager.ts runOverseer (lines ~400-600)
// SOURCE: enhanced-conversation-manager.ts detectRecentAvailabilityFailure (lines ~350-400)

import type { 
    AgentType, 
    BookingSessionWithAgent,
    AgentContext 
} from '../core/agent.types';
import { AIFallbackService } from '../../ai/ai-fallback.service';
import { UnifiedTranslationService } from '../../ai/translation.service';

// ===== OVERSEER DECISION INTERFACE =====
export interface OverseerDecision {
    agentToUse: AgentType;
    reasoning: string;
    intervention?: string;
    isNewBookingRequest?: boolean;
}

// ===== AVAILABILITY FAILURE CONTEXT =====
interface AvailabilityFailureContext {
    hasFailure: boolean;
    failedDate?: string;
    failedTime?: string;
    failedGuests?: number;
    failureReason?: string;
}

// ===== OVERSEER AGENT CLASS =====
// SOURCE: enhanced-conversation-manager.ts runOverseer method
export class OverseerAgent {
    constructor(
        private aiService: AIFallbackService,
        private translationService: UnifiedTranslationService
    ) {}

    /**
     * Main overseer decision method
     * SOURCE: enhanced-conversation-manager.ts runOverseer (lines ~400-600)
     */
    async makeDecision(
        session: BookingSessionWithAgent,
        userMessage: string
    ): Promise<OverseerDecision> {
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

            // ✅ APOLLO: Check for availability failure first
            const availabilityFailure = this.detectRecentAvailabilityFailure(session);

            const prompt = this.buildOverseerPrompt(
                sessionState,
                recentHistory,
                userMessage,
                availabilityFailure
            );

            // ✅ USE CLAUDE SONNET: Strategic decision-making with fallback
            const responseText = await this.aiService.generateContent(
                prompt,
                'overseer', // Uses Sonnet for complex reasoning
                {
                    temperature: 0.2,
                    maxTokens: 1000
                }
            );
            
            const decision = this.parseOverseerResponse(responseText);

            console.log(`🧠 [Overseer-Claude] Decision for "${userMessage}":`, {
                currentAgent: session.currentAgent,
                decision: decision.agentToUse,
                reasoning: decision.reasoning,
                isNewBookingRequest: decision.isNewBookingRequest,
                availabilityFailureDetected: availabilityFailure.hasFailure
            });

            // ✅ APOLLO: Store availability failure context if Apollo is chosen
            if (decision.agentToUse === 'availability' && availabilityFailure.hasFailure) {
                session.availabilityFailureContext = {
                    originalDate: availabilityFailure.failedDate!,
                    originalTime: availabilityFailure.failedTime!,
                    originalGuests: availabilityFailure.failedGuests!,
                    failureReason: availabilityFailure.failureReason!,
                    detectedAt: new Date().toISOString()
                };
                console.log(`🚀 [Apollo] Stored failure context:`, session.availabilityFailureContext);
            }

            return decision;

        } catch (error) {
            console.error('[Overseer] Error:', error);
            
            // Fallback to safe decision
            if (session.currentAgent && session.currentAgent !== 'conductor') {
                console.log('[Overseer] Fallback: keeping current agent due to error');
                return {
                    agentToUse: session.currentAgent,
                    reasoning: 'Fallback due to Overseer error - keeping current agent',
                    isNewBookingRequest: false
                };
            }
            
            return {
                agentToUse: 'booking',
                reasoning: 'Fallback to Sofia due to Overseer error',
                isNewBookingRequest: false
            };
        }
    }

    /**
     * Build the comprehensive overseer prompt
     * SOURCE: enhanced-conversation-manager.ts runOverseer prompt (lines ~450-550)
     */
    private buildOverseerPrompt(
        sessionState: any,
        recentHistory: string,
        userMessage: string,
        availabilityFailure: AvailabilityFailureContext
    ): string {
        return `You are the master "Overseer" for a restaurant booking system. Analyze the conversation and decide which agent should handle the user's request.

## AGENT ROLES:
- **Sofia (booking):** Handles ONLY NEW reservations. Use for availability checks, creating new bookings.
- **Maya (reservations):** Handles ONLY EXISTING reservations. Use for modifications, cancellations, checking status.
- **Apollo (availability):** SPECIALIST agent that ONLY finds alternative times when a booking fails.
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

## AVAILABILITY FAILURE CONTEXT:
${availabilityFailure.hasFailure ? `
🚨 CRITICAL: Recent availability failure detected:
- Failed Date: ${availabilityFailure.failedDate}
- Failed Time: ${availabilityFailure.failedTime}
- Failed Guests: ${availabilityFailure.failedGuests}
- Reason: ${availabilityFailure.failureReason}
` : 'No recent availability failures detected.'}

## CRITICAL ANALYSIS RULES:

### RULE 0: AVAILABILITY FAILURE HANDOFF (HIGHEST PRIORITY)
- Check for recent tool call that failed with "NO_AVAILABILITY" or "NO_AVAILABILITY_FOR_MODIFICATION"
- IF such a failure exists AND user's current message is asking for alternatives:
  * "what time is free?", "any alternatives?", "а когда можно?", "когда свободно?", "другое время?"
  * "earlier", "later", "different time", "раньше", "позже"
- THEN you MUST hand off to 'availability' agent. This is your most important recovery rule.

### RULE 1: DETECT NEW BOOKING REQUESTS (HIGH PRIORITY)
Look for explicit indicators of NEW booking requests:
- "book again", "new reservation", "make another booking", "another table"
- "забронировать снова", "новое бронирование", "еще одну бронь", "еще забронировать"
- "book another", "second booking", "additional reservation"

If detected, use Sofia (booking) agent and flag as NEW BOOKING REQUEST.

### RULE 1.5: HANDLE SIMPLE CONTINUATIONS (CRITICAL BUGFIX)
**NEVER** flag \`isNewBookingRequest: true\` for simple, short answers like:
- "yes", "no", "ok", "confirm", "yep", "nope", "agree", "good", "fine"
- "да", "нет", "хорошо", "подтверждаю", "согласен", "ок"
- "igen", "nem", "jó", "rendben"
- "ja", "nein", "gut", "okay"
- "oui", "non", "bien", "d'accord"

These are continuations of the current task, NOT new requests. \`isNewBookingRequest\` must be \`false\` for them.

### RULE 2: TASK CONTINUITY (HIGHEST PRIORITY)
If current agent is Sofia/Maya and they're MID-TASK, KEEP the current agent unless user EXPLICITLY starts a completely new task.

**Sofia mid-task indicators:**
- Has some booking info (date/time/guests) but missing others (name/phone)
- User providing clarifications like "earlier time", "different time", "more people"
- User answering Sofia's questions

**Maya mid-task indicators:**
- Found existing reservations and discussing them
- User confirming cancellation/modification
- Active reservation ID exists

### RULE 3: EXPLICIT EXISTING RESERVATION TASKS
Switch to Maya ONLY if user explicitly mentions:
- "change my existing", "cancel my booking", "modify reservation"
- "изменить мое", "отменить бронь", "поменять существующее"

### RULE 4: AMBIGUOUS TIME REQUESTS
If user mentions time changes ("earlier", "later", "different time") consider context:
- If Sofia is gathering NEW booking info → STAY with Sofia (they're clarifying their preferred time)
- If Maya found existing reservations → Use Maya (they want to modify existing)
- If there was a recent availability failure → Use Apollo (they want alternatives)

### RULE 5: CONDUCTOR RESET
Use "conductor" ONLY after successful task completion (booking created, cancellation confirmed).

Respond with ONLY a JSON object:

{
  "reasoning": "Brief explanation of your decision based on the rules and context",
  "agentToUse": "booking" | "reservations" | "conductor" | "availability",
  "intervention": null | "Message if user seems stuck and needs clarification",
  "isNewBookingRequest": true/false
}`;
    }

    /**
     * Parse the AI response into a structured decision
     */
    private parseOverseerResponse(responseText: string): OverseerDecision {
        try {
            const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const parsed = JSON.parse(cleanJson);

            return {
                agentToUse: parsed.agentToUse || 'booking',
                reasoning: parsed.reasoning || 'No reasoning provided',
                intervention: parsed.intervention || undefined,
                isNewBookingRequest: parsed.isNewBookingRequest || false
            };
        } catch (error) {
            console.error('[Overseer] Failed to parse AI response:', error);
            return {
                agentToUse: 'booking',
                reasoning: 'Failed to parse Overseer response - defaulting to Sofia',
                isNewBookingRequest: false
            };
        }
    }

    /**
     * Detect recent availability failure in conversation history
     * SOURCE: enhanced-conversation-manager.ts detectRecentAvailabilityFailure (lines ~350-400)
     */
    private detectRecentAvailabilityFailure(session: BookingSessionWithAgent): AvailabilityFailureContext {
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
     * Generate intervention message for unclear situations
     */
    async generateIntervention(
        message: string,
        language: string,
        context: string
    ): Promise<string> {
        const baseMessage = `I'm not sure how to help with that. Could you please clarify what you'd like to do? For example:
- Make a new reservation
- Check or modify an existing booking
- Get restaurant information`;

        try {
            return await this.translationService.translate(
                baseMessage,
                language as any,
                'question'
            );
        } catch (error) {
            console.warn('[Overseer] Translation failed for intervention:', error);
            return baseMessage;
        }
    }
}

// ===== OVERSEER UTILITIES =====

/**
 * Check if user message indicates a new booking request
 */
export function isNewBookingRequest(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    
    const newBookingIndicators = [
        'book again', 'new reservation', 'make another booking', 'another table',
        'забронировать снова', 'новое бронирование', 'еще одну бронь', 'еще забронировать',
        'book another', 'second booking', 'additional reservation',
        'another dinner', 'second table', 'different date'
    ];

    return newBookingIndicators.some(indicator => lowerMessage.includes(indicator));
}

/**
 * Check if user message is a simple continuation
 */
export function isSimpleContinuation(message: string): boolean {
    const cleanMessage = message.trim().toLowerCase();
    
    const continuationPatterns = [
        /^(да|нет|yes|no|ok|okay|confirm|yep|nope|agree|good|fine)$/,
        /^(спасибо|thanks|thank you|hvala|köszönöm)$/,
        /^(igen|nem|jó|rendben)$/,
        /^(ja|nein|gut|okay)$/,
        /^(oui|non|bien|d'accord)$/
    ];

    return continuationPatterns.some(pattern => pattern.test(cleanMessage));
}

/**
 * Determine if user is asking for alternatives after failure
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

/**
 * Extract agent handoff information
 */
export function createAgentHandoff(
    from: AgentType,
    to: AgentType,
    reason: string,
    userMessage: string
): {
    from: AgentType;
    to: AgentType;
    at: string;
    trigger: string;
    overseerReasoning: string;
} {
    return {
        from,
        to,
        at: new Date().toISOString(),
        trigger: userMessage.substring(0, 100), // Truncate for storage
        overseerReasoning: reason
    };
}

// ===== EXPORT DEFAULT =====
export default OverseerAgent;