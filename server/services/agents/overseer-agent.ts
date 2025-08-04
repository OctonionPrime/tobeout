// server/services/agents/overseer-agent.ts
import { aiService } from '../ai-service';
import { smartLog } from '../smart-logging.service';
import type { BookingSessionWithAgent, AgentType } from '../enhanced-conversation-manager';
import type { TenantContext } from '../tenant-context';

export interface OverseerDecision {
    agentToUse: AgentType;
    reasoning: string;
    intervention?: string;
    isNewBookingRequest?: boolean;
}

export interface OverseerConfig {
    maxRetries: number;
    timeout: number;
}

export interface RestaurantConfig {
    name: string;
    timezone: string;
}

export class OverseerAgent {
    readonly name = 'Overseer';
    readonly description = 'Master decision maker for agent routing and conversation flow management';

    private config: OverseerConfig;
    private restaurantConfig: RestaurantConfig;

    constructor(config: OverseerConfig, restaurantConfig: RestaurantConfig) {
        this.config = config;
        this.restaurantConfig = restaurantConfig;
    }

    /**
     * Main entry point for overseer decisions
     */
    async makeDecision(
        session: BookingSessionWithAgent,
        userMessage: string,
        availabilityFailure?: any
    ): Promise<OverseerDecision> {
        const timerId = smartLog.startTimer('overseer_decision');

        try {
            smartLog.info('Overseer decision context', {
                sessionId: session.sessionId,
                userMessage: userMessage.substring(0, 100),
                currentAgent: session.currentAgent,
                activeReservationId: session.activeReservationId || null,
                turnCount: session.turnCount || 0,
                hasAvailabilityFailure: availabilityFailure?.hasFailure || false,
                hasGuestHistory: !!session.guestHistory,
                conversationLanguage: session.language || 'auto'
            });

            const systemPrompt = this.generateSystemPrompt(session, userMessage, availabilityFailure);

            const decision = await aiService.generateJSON(systemPrompt, {
                model: 'gpt-4o', // 🚀 UPGRADE: Using a more powerful HARDCODED ON PURPOSE model for critical decisions
                maxTokens: 1000,
                temperature: 0.2,
                context: 'Overseer'
            }, session.tenantContext!);

            const result: OverseerDecision = {
                agentToUse: decision.agentToUse,
                reasoning: decision.reasoning,
                intervention: decision.intervention,
                isNewBookingRequest: decision.isNewBookingRequest || false
            };

            smartLog.info('Overseer decision completed', {
                sessionId: session.sessionId,
                userMessage: userMessage.substring(0, 100),
                currentAgent: session.currentAgent,
                decision: result.agentToUse,
                reasoning: result.reasoning,
                isNewBookingRequest: result.isNewBookingRequest,
                availabilityFailureDetected: availabilityFailure?.hasFailure || false,
                conversationLanguage: session.language || 'auto',
                interventionGenerated: !!result.intervention,
                processingTime: smartLog.endTimer(timerId)
            });

            if (session.currentAgent && session.currentAgent !== result.agentToUse) {
                smartLog.businessEvent('agent_handoff', {
                    sessionId: session.sessionId,
                    fromAgent: session.currentAgent,
                    toAgent: result.agentToUse,
                    reason: result.reasoning,
                    userTrigger: userMessage.substring(0, 100),
                    isNewBookingRequest: result.isNewBookingRequest,
                    conversationLanguage: session.language || 'auto'
                });
            }

            return result;

        } catch (error) {
            smartLog.endTimer(timerId);
            smartLog.error('Overseer decision failed', error as Error, {
                sessionId: session.sessionId,
                userMessage: userMessage.substring(0, 100),
                currentAgent: session.currentAgent,
                conversationLanguage: session.language || 'auto'
            });

            // Fallback logic (preserve existing behavior)
            if (session.currentAgent && session.currentAgent !== 'conductor') {
                smartLog.info('Overseer fallback: keeping current agent', {
                    sessionId: session.sessionId,
                    currentAgent: session.currentAgent,
                    conversationLanguage: session.language || 'auto'
                });
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
     * 🚨 CRITICAL FIX: Language enforcement rules for Overseer interventions
     */
    private getLanguageEnforcementRules(language: string): string {
        const languageNames: Record<string, string> = {
            'en': 'English', 'ru': 'Russian', 'sr': 'Serbian', 'hu': 'Hungarian',
            'de': 'German', 'fr': 'French', 'es': 'Spanish', 'it': 'Italian',
            'pt': 'Portuguese', 'nl': 'Dutch', 'auto': 'English'
        };

        const currentLanguageName = languageNames[language] || 'English';
        
        return `🚨 CRITICAL OVERSEER LANGUAGE RULES:

**CONVERSATION LANGUAGE**: ${currentLanguageName} (LOCKED)

**IF YOU GENERATE INTERVENTION MESSAGES**:
❌ NEVER respond in English if conversation is in ${currentLanguageName}
❌ NEVER mix languages in intervention messages
✅ ALL intervention messages MUST be in ${currentLanguageName}
✅ Maintain natural ${currentLanguageName} expressions

**JSON RESPONSE LANGUAGE**:
- The "reasoning" field should be in English (for system logs)
- The "intervention" field (if present) MUST be in ${currentLanguageName}

**EXAMPLES OF CORRECT INTERVENTION MESSAGES**:
${this.getInterventionExamples(language)}

This ensures seamless language consistency across all agent handoffs.`;
    }

    /**
     * 🚨 CRITICAL FIX: Language-specific intervention examples
     */
    private getInterventionExamples(language: string): string {
        const examples: Record<string, string> = {
            'en': `- "I'd be happy to help you with your booking. Could you please clarify what you'd like to do?"
- "Let me connect you with the right specialist for your request."`,
            'ru': `- "Буду рад помочь вам с бронированием. Не могли бы вы уточнить, что именно вы хотите сделать?"
- "Позвольте соединить вас с подходящим специалистом для вашего запроса."`,
            'sr': `- "Rado ću vam pomoći sa rezervacijom. Možete li da pojasnite šta želite da uradite?"
- "Dozvolite da vas povežem sa odgovarajućim specijalistom za vaš zahtev."`,
            'hu': `- "Szívesen segítek az asztalfoglalásban. Tudná pontosítani, mit szeretne tenni?"
- "Engedje meg, hogy a megfelelő szakemberrel kapcsoljam össze."`,
            'de': `- "Ich helfe Ihnen gerne bei Ihrer Reservierung. Könnten Sie bitte präzisieren, was Sie tun möchten?"
- "Lassen Sie mich Sie mit dem richtigen Spezialisten für Ihre Anfrage verbinden."`,
            'fr': `- "Je serais ravi de vous aider avec votre réservation. Pourriez-vous préciser ce que vous aimeriez faire?"
- "Permettez-moi de vous connecter avec le bon spécialiste pour votre demande."`,
            'es': `- "Estaré encantado de ayudarle con su reserva. ¿Podría aclarar qué le gustaría hacer?"
- "Permítame conectarle con el especialista adecuado para su solicitud."`,
            'it': `- "Sarei felice di aiutarla con la sua prenotazione. Potrebbe chiarire cosa vorrebbe fare?"
- "Mi permetta di metterla in contatto con lo specialista giusto per la sua richiesta."`,
            'pt': `- "Ficarei feliz em ajudá-lo com sua reserva. Poderia esclarecer o que gostaria de fazer?"
- "Permita-me conectá-lo com o especialista certo para sua solicitação."`,
            'nl': `- "Ik help u graag met uw reservering. Kunt u verduidelijken wat u wilt doen?"
- "Laat me u verbinden met de juiste specialist voor uw verzoek."`,
            'auto': `- "I'd be happy to help you with your booking. Could you please clarify what you'd like to do?"
- "Let me connect you with the right specialist for your request."`
        };

        return examples[language] || examples['en'];
    }

    /**
     * Generate the comprehensive system prompt for agent selection
     */
    private generateSystemPrompt(
        session: BookingSessionWithAgent,
        userMessage: string,
        availabilityFailure?: any
    ): string {
        // 🔒 CRITICAL: Add language enforcement at the very beginning
        const language = session.language || 'en';
        const languageEnforcement = this.getLanguageEnforcementRules(language);

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
            hasGuestHistory: !!session.guestHistory,
            conversationLanguage: language
        };

        const availabilityFailureContext = availabilityFailure?.hasFailure ? `
🚨 CRITICAL: Recent availability failure detected:
- Failed Date: ${availabilityFailure.failedDate}
- Failed Time: ${availabilityFailure.failedTime}
- Failed Guests: ${availabilityFailure.failedGuests}
- Reason: ${availabilityFailure.failureReason}
` : 'No recent availability failures detected.';

        return `${languageEnforcement}

You are the master "Overseer" for a restaurant booking system. Analyze the conversation and decide which agent should handle the user's request.

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
- **Conversation Language:** ${sessionState.conversationLanguage}

## RECENT CONVERSATION:
${recentHistory}

## USER'S LATEST MESSAGE:
"${userMessage}"

## AVAILABILITY FAILURE CONTEXT:
${availabilityFailureContext}

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
- "yes", "no", "ok", "confirm", "yep", "nope", "agree", "good", "everything's?\\s*good", "fine"
- "да", "нет", "хорошо", "подтверждаю", "согласен", "ок"
- "igen", "nem", "jó", "rendben"
- "ja", "nein", "gut", "okay"
- "oui", "non", "bien", "d'accord"

These are continuations of the current task, NOT new requests. \`isNewBookingRequest\` must be \`false\` for them.

### RULE 1.6: COMMON BOOKING REQUEST PATTERNS
Treat these as NEW booking requests WITHOUT intervention:
- "table", "book", "reservation" (English)
- "стол", "столик", "можно стол", "забронировать", "бронь" (Russian)
- "asztal", "foglalás" (Hungarian)
- "sto", "rezervacija" (Serbian)
- "tisch", "reservierung" (German)
- "table", "réservation" (French)
- "mesa", "reserva" (Spanish)
- "tavolo", "prenotazione" (Italian)
- "mesa", "reserva" (Portuguese)
- "tafel", "reservering" (Dutch)
If the message contains ONLY these patterns (with optional "please", "can I", etc.), treat as new booking request. Do NOT generate intervention.

### RULE 2: TASK CONTINUITY (HIGHEST PRIORITY)
This rule is critical to avoid unnatural conversation resets.

If the current agent is \`booking\` (Sofia) and is actively gathering information (e.g., the \`Gathering Info\` state shows some details are still missing), any user message that provides potential booking details (like a date, time, number of guests, name, or phone number) **MUST be treated as a continuation of the current task.**

**In this scenario, you MUST set \`isNewBookingRequest: false\` and keep the \`agentToUse\` as \`booking\`.** This is not a new request.

### RULE 3: TASKS RELATED TO EXISTING RESERVATIONS (HIGH PRIORITY)
Switch to Maya (reservations) if the user's intent is clearly about managing an EXISTING reservation, even if they are vague or do not provide a reservation number. It is Maya's primary job to FIND the reservation if the context is not yet established.

Trigger this rule for phrases like:
- "change my booking", "cancel my booking", "modify reservation", "check my reservation status"
- "изменить мое", "отменить бронь", "поменять существующее", "проверить бронь", "перенести бронь"

### RULE 4: AMBIGUOUS TIME REQUESTS
If user mentions time changes ("earlier", "later", "different time") consider context:
- If Sofia is gathering NEW booking info → STAY with Sofia (they're clarifying their preferred time)
- If Maya found existing reservations → Use Maya (they want to modify existing)
- If there was a recent availability failure → Use Apollo (they want alternatives)

### RULE 5: CONDUCTOR RESET
Use "conductor" ONLY after successful task completion (booking created, cancellation confirmed).

### INTERVENTION RULES:
Generate an intervention ONLY when:
1. User explicitly asks about both new and existing bookings in the same message
2. User message is completely unrelated to restaurant bookings
3. User has been stuck in a loop for 3+ turns
DO NOT generate intervention for:
- Simple booking requests like "table", "можно стол", etc.
- When user provides booking details (date, time, guests)
- Simple continuations of current conversation

🚨 REMEMBER: If you generate an intervention message, it MUST be in ${sessionState.conversationLanguage}.

Respond with ONLY a JSON object:

{
  "reasoning": "Brief explanation of your decision based on the rules and context",
  "agentToUse": "booking" | "reservations" | "conductor" | "availability",
  "intervention": null | "Message if user seems stuck and needs clarification (MUST be in ${sessionState.conversationLanguage})",
  "isNewBookingRequest": true/false
}`;
    }
}