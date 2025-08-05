// server/services/confirmation.service.ts

import { aiService } from './ai-service';
import { agentFunctions } from './agents/agent-tools';
import { smartLog } from './smart-logging.service';
import type { TenantContext } from './tenant-context';
import { sanitizeInternalComments } from '../utils/sanitization-utils'; 

// Import types from ECM (these should eventually be moved to a shared types file)
export type Language = 'en' | 'ru' | 'sr' | 'hu' | 'de' | 'fr' | 'es' | 'it' | 'pt' | 'nl' | 'auto';
export type AgentType = 'booking' | 'reservations' | 'conductor' | 'availability';

// Temporary interface - should match BookingSessionWithAgent from ECM
interface BookingSessionWithAgent {
    sessionId: string;
    platform: 'web' | 'telegram';
    language: Language;
    timezone: string;
    tenantContext?: TenantContext;
    conversationHistory: Array<{
        role: 'user' | 'assistant';
        content: string;
        timestamp: Date;
        toolCalls?: any[];
    }>;
    currentAgent: AgentType;
    lastActivity: Date;
    
    // Confirmation-related state
    pendingConfirmation?: {
        toolCall: any;
        functionContext: any;
        summary?: string;
        summaryData?: any;
    };
    pendingNameClarification?: {
        dbName: string;
        requestName: string;
        originalToolCall: any;
        originalContext: any;
        attempts: number;
        timestamp: number;
    };
    confirmedName?: string;
    
    // Other session state
    hasActiveReservation?: number;
    currentStep?: string;
    guestHistory?: any;
    gatheringInfo: any;
}

/**
 * Result interfaces for confirmation operations
 */
export interface ConfirmationResult {
    response: string;
    hasBooking: boolean;
    reservationId?: number;
    session: BookingSessionWithAgent;
    currentAgent?: string;
}

export interface ConfirmationAnalysis {
    confirmationStatus: 'positive' | 'negative' | 'unclear';
    reasoning: string;
}

export interface NameClarificationResult {
    chosenName?: string;
    needsRetry: boolean;
    response: string;
    maxAttemptsReached: boolean;
}

/**
 * ✅ EXTRACTED: Translation Service class (temporary - should be moved to separate file)
 */
class TranslationService {
    static async translateMessage(
        message: string,
        targetLanguage: Language,
        context: 'confirmation' | 'error' | 'success' | 'question' = 'confirmation',
        tenantContext: TenantContext
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
            const translation = await aiService.generateContent(prompt, {
                maxTokens: 300,
                context: `translation-${context}`
            }, tenantContext);

            return translation;
        } catch (error) {
            smartLog.error('Translation service failed', error as Error, {
                targetLanguage,
                context,
                originalMessage: message.substring(0, 100),
                tenantId: tenantContext.restaurant.id
            });
            return message; // Fallback to original
        }
    }
}

export class ConfirmationService {
    
    /**
     * 🎯 NEW: Request booking confirmation (always confirm before booking)
     * This method sets up a confirmation request for a complete booking
     */
    static async requestBookingConfirmation(
        bookingData: any,
        session: BookingSessionWithAgent
    ): Promise<ConfirmationResult> {
        const timerId = smartLog.startTimer('booking_confirmation_request');

        try {
            // Set up pending confirmation with the booking data
            session.pendingConfirmation = {
                toolCall: {
                    function: {
                        name: 'create_reservation',
                        arguments: JSON.stringify({
                            guestName: bookingData.name,
                            guestPhone: bookingData.phone,
                            date: bookingData.date,
                            time: bookingData.time,
                            guests: bookingData.guests,
                            specialRequests: bookingData.comments || ''
                        })
                    }
                },
                functionContext: {
                    restaurantId: session.restaurantId,
                    timezone: session.timezone || 'Europe/Belgrade',
                    telegramUserId: session.telegramUserId,
                    source: session.platform,
                    sessionId: session.sessionId,
                    language: session.language,
                    session: {
                        tenantContext: session.tenantContext
                    }
                },
                summary: `a reservation for ${bookingData.guests} people`,
                summaryData: {
                    action: 'booking',
                    guestName: bookingData.name,
                    guests: bookingData.guests,
                    date: bookingData.date,
                    time: bookingData.time
                }
            };

            // Generate confirmation question
            const sanitizedComments = sanitizeInternalComments(bookingData.comments); // Add this line

            const confirmationQuestion = await TranslationService.translateMessage(
                `I have all the details for your reservation:

📋 **Booking Summary:**
• ${bookingData.guests} guests
• ${bookingData.date} at ${bookingData.time}
• Name: ${bookingData.name}
• Phone: ${bookingData.phone}
${sanitizedComments ? `• Special requests: ${sanitizedComments}` : ''}

Shall I go ahead and confirm this booking?`,
                session.language,
                'question',
                session.tenantContext!
            );

            smartLog.info('Booking confirmation requested', {
                sessionId: session.sessionId,
                bookingData,
                confirmationQuestion: confirmationQuestion.substring(0, 100),
                processingTime: smartLog.endTimer(timerId)
            });

            smartLog.businessEvent('booking_confirmation_requested', {
                sessionId: session.sessionId,
                guests: bookingData.guests,
                date: bookingData.date,
                time: bookingData.time,
                platform: session.platform,
                language: session.language,
                antiHallucinationProtection: true
            });

            return {
                response: confirmationQuestion,
                hasBooking: false,
                session,
                currentAgent: session.currentAgent
            };

        } catch (error) {
            smartLog.endTimer(timerId);
            smartLog.error('Booking confirmation request failed', error as Error, {
                sessionId: session.sessionId,
                bookingData
            });

            const errorMessage = await TranslationService.translateMessage(
                "Sorry, I had trouble preparing your booking confirmation. Please try again.",
                session.language,
                'error',
                session.tenantContext!
            );

            return {
                response: errorMessage,
                hasBooking: false,
                session,
                currentAgent: session.currentAgent
            };
        }
    }

    /**
     * 🎯 MAIN ENTRY POINT: Process pending confirmation from user response
     * This is the primary method that ECM calls when session.pendingConfirmation exists
     */
    static async processConfirmation(
        message: string,
        session: BookingSessionWithAgent
    ): Promise<ConfirmationResult> {
        const timerId = smartLog.startTimer('confirmation_processing');
        
        try {
            if (!session.pendingConfirmation && !session.pendingNameClarification) {
                throw new Error('No pending confirmation found');
            }

            smartLog.info('Processing confirmation workflow', {
                sessionId: session.sessionId,
                userMessage: message.substring(0, 100),
                confirmationType: session.pendingNameClarification ? 'name_clarification' : 'regular',
                pendingAction: session.pendingConfirmation?.summary 
            });

            // Handle name clarification separately (has different workflow)
            if (session.pendingNameClarification) {
                return await this.handleNameClarification(message, session);
            }

            // Handle regular confirmations (booking/cancellation)
            return await this.handleRegularConfirmation(message, session);

        } catch (error) {
            smartLog.endTimer(timerId);
            smartLog.error('Confirmation processing failed', error as Error, {
                sessionId: session.sessionId,
                userMessage: message.substring(0, 100)
            });

            const errorMessage = await TranslationService.translateMessage(
                "Sorry, I had trouble processing your confirmation. Please try again.",
                session.language,
                'error',
                session.tenantContext!
            );

            return {
                response: errorMessage,
                hasBooking: false,
                session,
                currentAgent: session.currentAgent
            };
        } finally {
            smartLog.endTimer(timerId);
        }
    }

    /**
     * 🔧 EXTRACTED: Handle name clarification workflow with infinite loop prevention
     * Originally from ECM's handlePendingNameClarification method
     */
    private static async handleNameClarification(
        message: string,
        session: BookingSessionWithAgent
    ): Promise<ConfirmationResult> {
        const pending = session.pendingNameClarification!;
        
        // Check timeout and attempt limits (5 minutes timeout, 3 max attempts)
        if (Date.now() - pending.timestamp > 300000 || pending.attempts >= 3) {
            smartLog.warn('Name clarification timed out or max attempts reached', {
                sessionId: session.sessionId,
                attempts: pending.attempts,
                timeElapsed: Date.now() - pending.timestamp
            });
            
            return await this.resolveNameClarificationWithFallback(session, pending);
        }

        // Extract name choice from user message
        const chosenName = await this.extractNameChoice(
            message, 
            pending.dbName, 
            pending.requestName,
            session.language, 
            session.tenantContext!
        );

        if (chosenName) {
            // Name chosen successfully - clear state and retry booking
            delete session.pendingNameClarification;
            session.confirmedName = chosenName;
            
            smartLog.info('Name clarification resolved successfully', {
                sessionId: session.sessionId,
                chosenName,
                attempts: pending.attempts,
                method: 'user_choice'
            });

            return await this.retryBookingWithConfirmedName(session, pending);
        } else {
            // Need to ask again - increment attempt counter
            pending.attempts = (pending.attempts || 0) + 1;
            pending.timestamp = Date.now();

            const clarificationMessage = await TranslationService.translateMessage(
                `I need to clarify which name to use. Please choose:
1. "${pending.dbName}" (from your profile)
2. "${pending.requestName}" (new name)

Just type the name you prefer, or "1" or "2".`,
                session.language, 
                'question', 
                session.tenantContext!
            );

            smartLog.info('Name clarification retry requested', {
                sessionId: session.sessionId,
                attempts: pending.attempts,
                maxAttempts: 3
            });

            return {
                response: clarificationMessage,
                hasBooking: false,
                session,
                currentAgent: session.currentAgent
            };
        }
    }

    /**
     * 🔧 EXTRACTED: Handle regular booking/cancellation confirmations
     * Originally from ECM's confirmation handling logic in handleMessage
     */
    private static async handleRegularConfirmation(
        message: string,
        session: BookingSessionWithAgent
    ): Promise<ConfirmationResult> {
        const pendingAction = session.pendingConfirmation!;
        
        // Determine confirmation summary for AI analysis
        let summary = 'the requested action';
        if (pendingAction.summaryData) {
            const details = pendingAction.summaryData;
            if (details.action === 'cancellation') {
                summary = `cancellation of reservation #${details.reservationId}`;
            } else {
                summary = `a reservation for ${details.guests} people for ${details.guestName} on ${details.date} at ${details.time}`;
            }
        }

        // Analyze user's confirmation response using AI
        const confirmationResult = await this.runConfirmationAgent(
            message, 
            summary, 
            session.language, 
            session.tenantContext!
        );

        smartLog.info('Confirmation analysis completed', {
            sessionId: session.sessionId,
            userMessage: message.substring(0, 50),
            detectedStatus: confirmationResult.confirmationStatus,
            reasoning: confirmationResult.reasoning
        });

        switch (confirmationResult.confirmationStatus) {                      

            case 'positive': { // Use block scope for clarity
                // User confirmed, but may have provided new info. Re-process the message.
                smartLog.info('Positive confirmation received. Re-checking message for modifications...', { sessionId: session.sessionId });

                const pendingArgs = JSON.parse(pendingAction.toolCall.function.arguments);

                const updates = await this.extractDetailsFromConfirmation(message, session.tenantContext!);

                const finalArgs = { ...pendingArgs, ...updates };

                smartLog.info('Merged confirmation data', {
                    sessionId: session.sessionId,
                    originalArgs: pendingArgs,
                    updatesFromUser: updates,
                    finalArgs
                });
                
                // This ensures the entire session object is up-to-date BEFORE the tool is executed.
                // This prevents the tool's response-generation step from using stale data.
                if (Object.keys(updates).length > 0) {
                    if (updates.guestName) session.gatheringInfo.name = updates.guestName;
                    if (updates.specialRequests) session.gatheringInfo.comments = updates.specialRequests;

                    smartLog.info('Session context forcefully updated before final action', {
                        sessionId: session.sessionId,
                        updatedFields: Object.keys(updates)
                    });
                }               

                pendingAction.toolCall.function.arguments = JSON.stringify(finalArgs);

                return await this.executeConfirmedAction(session, pendingAction);
            }
            
            case 'negative':
                // User declined - cancel the pending action
                return await this.cancelPendingAction(session);
            
            case 'unclear':
            default:
                // Unclear response - treat as new input, clear confirmation state
                return await this.handleUnclearConfirmation(session, message);
        }
    }

    /**
     * 🎯 EXTRACTED: Execute confirmed booking or cancellation
     * Originally from ECM's executeConfirmedBooking and handleConfirmation methods
     */
    static async executeConfirmedAction(
        session: BookingSessionWithAgent,
        pendingAction: any
    ): Promise<ConfirmationResult> {
        const timerId = smartLog.startTimer('confirmed_action_execution');
        
        try {
            const { toolCall, functionContext } = pendingAction;
            const args = JSON.parse(toolCall.function.arguments);

            // Apply confirmed name if available
            if (session.confirmedName) {
                args.guestName = session.confirmedName;
                functionContext.confirmedName = session.confirmedName;
            }

            smartLog.info('Executing confirmed action', {
                sessionId: session.sessionId,
                action: toolCall.function.name,
                confirmedName: session.confirmedName,
                args: { ...args, guestPhone: args.guestPhone ? '[REDACTED]' : undefined }
            });

            // Execute the appropriate tool
            let result;
            switch (toolCall.function.name) {
                case 'create_reservation':
                    result = await agentFunctions.create_reservation(
                        args.guestName,
                        args.guestPhone,
                        args.date,
                        args.time,
                        args.guests,
                        args.specialRequests || '',
                        functionContext
                    );
                    break;
                
                case 'cancel_reservation':
                    result = await agentFunctions.cancel_reservation(
                        args.reservationId,
                        args.reason,
                        true, // confirmed cancellation
                        functionContext
                    );
                    break;
                
                default:
                    throw new Error(`Unsupported confirmation action: ${toolCall.function.name}`);
            }

            // Clear confirmation state
            delete session.pendingConfirmation;
            delete session.confirmedName;

            // Process the tool result
            return await this.processToolResult(result, toolCall, session, args);

        } catch (error) {
            smartLog.endTimer(timerId);
            smartLog.error('Confirmed action execution failed', error as Error, {
                sessionId: session.sessionId
            });

            
            throw error;
        }
    }

    /**
     * 🤖 EXTRACTED: AI-powered confirmation analysis
     * Originally from ECM's runConfirmationAgent method
     */
    private static async runConfirmationAgent(
        message: string,
        pendingActionSummary: string,
        language: Language,
        tenantContext: TenantContext
    ): Promise<ConfirmationAnalysis> {
        const timerId = smartLog.startTimer('confirmation_analysis');
        
        try {
            const prompt = `You are a Confirmation Agent for a restaurant booking system.
The user was asked to confirm an action. Analyze their response and decide if it's a "positive" or "negative" confirmation.

## CONTEXT
- **Language:** ${language}
- **Action Requiring Confirmation:** ${pendingActionSummary}
- **User's Response:** "${message}"

## RULES
1. **Positive:** The user agrees, confirms, or says yes (e.g., "Yes, that's correct", "Sounds good", "Igen, rendben", "Да, все верно").
2. **Negative:** The user disagrees, cancels, or says no (e.g., "No, cancel that", "That's wrong", "Nem", "Нет, отменить").
3. **Unclear:** The user asks a question, tries to change details, or gives an ambiguous reply.

## EXAMPLES BY LANGUAGE:

**Hungarian:**
- "Igen" → positive
- "Igen, rendben" → positive
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

Respond with ONLY a JSON object:
{
  "confirmationStatus": "positive" | "negative" | "unclear",
  "reasoning": "Briefly explain your decision based on the user's message."
}`;

            const response = await aiService.generateJSON(prompt, {
                maxTokens: 200,
                temperature: 0.0,
                context: 'ConfirmationAgent'
            }, tenantContext);

            const result = {
                confirmationStatus: response.confirmationStatus || 'unclear',
                reasoning: response.reasoning || 'AIService confirmation analysis.'
            };

            smartLog.info('Confirmation analysis completed', {
                userMessage: message.substring(0, 50),
                language,
                pendingAction: pendingActionSummary.substring(0, 100),
                status: result.confirmationStatus,
                reasoning: result.reasoning,
                processingTime: smartLog.endTimer(timerId)
            });

            return result;

        } catch (error) {
            smartLog.endTimer(timerId);
            smartLog.error('Confirmation analysis failed', error as Error, {
                userMessage: message.substring(0, 100),
                language,
                pendingAction: pendingActionSummary.substring(0, 100)
            });

            return {
                confirmationStatus: 'unclear',
                reasoning: 'Fallback due to an internal error.'
            };
        }
    }

    /**
     * 🔧 EXTRACTED: Extract name choice from user message
     * Originally from ECM's extractNameChoice method
     */
    private static async extractNameChoice(
        userMessage: string,
        dbName: string,
        requestName: string,
        language: string,
        tenantContext: TenantContext
    ): Promise<string | null> {
        const timerId = smartLog.startTimer('name_choice_extraction');
        
        try {
            // Quick pattern matching first for common responses
            const lowerMessage = userMessage.toLowerCase().trim();
            
            // Direct name mentions
            if (lowerMessage.includes(dbName.toLowerCase())) {
                smartLog.info('Name choice: Direct DB name match', { chosenName: dbName });
                return dbName;
            }
            
            if (lowerMessage.includes(requestName.toLowerCase())) {
                smartLog.info('Name choice: Direct request name match', { chosenName: requestName });
                return requestName;
            }
            
            // Common patterns by language
            const patterns = {
                // English
                'yes': requestName, 'no': dbName, 'new': requestName, 'old': dbName, 
                'keep': dbName, 'first': requestName, 'second': dbName,
                '1': requestName, '2': dbName,
                
                // Russian
                'да': requestName, 'нет': dbName, 'новое': requestName, 'старое': dbName,
                'первое': requestName, 'второе': dbName,
                
                // Hungarian
                'igen': requestName, 'nem': dbName, 'új': requestName, 'régi': dbName,
                'első': requestName, 'második': dbName,
                
                // Serbian
                'da': requestName, 'ne': dbName, 'novo': requestName, 'staro': dbName,
                'prvo': requestName, 'drugo': dbName
            };
            
            for (const [pattern, chosenName] of Object.entries(patterns)) {
                if (lowerMessage === pattern || lowerMessage.includes(pattern)) {
                    smartLog.info('Name choice: Pattern match', { pattern, chosenName });
                    return chosenName;
                }
            }

            // AI-powered extraction as fallback for complex cases
            const prompt = `Determine which name the user wants to use for their restaurant reservation:

CONTEXT:
- Database has existing profile: "${dbName}"
- User wants to book under name: "${requestName}"
- User's response: "${userMessage}"
- Language: ${language}

EXAMPLES:
"Мяурина я" → wants "Мяурина" (user identifies as Мяурина)
"I am John" → wants "John"
"use John" → wants "John"
"go with Лола" → wants "Лола"
"keep the old one" → wants "${dbName}"
"the new name" → wants "${requestName}"
"да" → wants "${requestName}" (yes = use new name)
"нет" → wants "${dbName}" (no = keep old name)

Return the EXACT name that the user wants to use, including non-Latin characters.

Respond with JSON only:
{
  "chosen_name": "exact_name_to_use",
  "confidence": 0.0-1.0,
  "reasoning": "explanation of decision"
}`;

            const response = await aiService.generateJSON(prompt, {
                maxTokens: 150,
                temperature: 0.0,
                context: 'name-choice-extraction'
            }, tenantContext);

            const result = response.chosen_name?.trim() || null;
            
            smartLog.info('Name choice extraction completed', {
                userMessage: userMessage.substring(0, 50),
                chosenName: result,
                confidence: response.confidence,
                processingTime: smartLog.endTimer(timerId)
            });

            // Only return if confidence is high and result matches one of the expected names
            if (response.confidence >= 0.8 && result) {
                if (result.toLowerCase() === dbName.toLowerCase() || 
                    result.toLowerCase() === requestName.toLowerCase()) {
                    return result;
                }
            }

            return null;

        } catch (error) {
            smartLog.endTimer(timerId);
            smartLog.error('Name choice extraction failed', error as Error, {
                userMessage: userMessage.substring(0, 100)
            });
            return null;
        }
    }

    /**
     * 📋 EXTRACTED: Generate detailed confirmation message
     * Originally from ECM's generateDetailedConfirmation method
     */
    static generateDetailedConfirmation(
        reservationId: number,
        bookingData: any,
        language: string,
        validationStatus?: any
    ): string {
        const { name, phone, date, time, guests, comments } = bookingData;
        
        const templates: Record<string, string> = {
            en: `🎉 Reservation Confirmed! 

📋 **Booking Details:**
• Confirmation #: ${reservationId}
• Guest: ${name}
• Phone: ${phone}  
• Date: ${date}
• Time: ${time}
• Guests: ${guests}
${comments ? `• Special requests: ${comments}` : ''}

✅ All details validated and confirmed.
📞 We'll call if any changes are needed.`,

            ru: `🎉 Бронь подтверждена!

📋 **Детали бронирования:**
• Номер: ${reservationId}
• Гость: ${name}
• Телефон: ${phone}
• Дата: ${date}  
• Время: ${time}
• Гостей: ${guests}
${comments ? `• Особые пожелания: ${comments}` : ''}

✅ Все данные проверены и подтверждены.
📞 Перезвоним при необходимости.`,

            sr: `🎉 Rezervacija potvrđena!

📋 **Detalji rezervacije:**
• Broj: ${reservationId}
• Gost: ${name}
• Telefon: ${phone}
• Datum: ${date}
• Vreme: ${time}
• Gostiju: ${guests}
${comments ? `• Posebni zahtevi: ${comments}` : ''}

✅ Svi podaci provereni i potvrđeni.
📞 Pozvaćemo ako su potrebne izmene.`,

            hu: `🎉 Foglalás megerősítve!

📋 **Foglalás részletei:**
• Szám: ${reservationId}
• Vendég: ${name}
• Telefon: ${phone}
• Dátum: ${date}
• Idő: ${time}
• Vendégek: ${guests}
${comments ? `• Különleges kérések: ${comments}` : ''}

✅ Minden adat ellenőrizve és megerősítve.
📞 Felhívjuk, ha változásokra van szükség.`
        };

        return templates[language] || templates.en;
    }

    /*
      NEW HELPER: Extracts details from a confirmation message.
     */
    private static async extractDetailsFromConfirmation(
        message: string,
        tenantContext: TenantContext
    ): Promise<any> {
        // This is a focused AI prompt to find changes within a confirmation.
        const prompt = `Analyze the user's confirmation message to see if they provided any new or changed booking details.

USER MESSAGE: "${message}"

Extract ONLY the details the user is explicitly changing or adding.
- If the user says "yes but for the name Petrov", extract the name.
- If the user says "confirm, and add a note about a window seat", extract the comments.
- If the user just says "yes", return an empty object.

Respond with JSON only.

EXAMPLE 1:
USER MESSAGE: "да нужно на имя Петров"
YOUR JSON: { "guestName": "Петров" }

EXAMPLE 2:
USER MESSAGE: "Yes, and please note it's a birthday."
YOUR JSON: { "specialRequests": "It's a birthday." }

EXAMPLE 3:
USER MESSAGE: "Sounds good"
YOUR JSON: {}
`;
        try {
            const updates = await aiService.generateJSON(prompt, {
                context: 'confirmation-modification-extraction'
            }, tenantContext);
            return updates || {};
        } catch (error) {
            smartLog.error('Failed to extract details from confirmation message', error as Error);
            return {}; // Return empty object on failure
        }
    }

    // ===== PRIVATE HELPER METHODS =====

    /**
     * Handle timeout/max attempts scenario with fallback to existing name
     */
    private static async resolveNameClarificationWithFallback(
        session: BookingSessionWithAgent,
        pending: any
    ): Promise<ConfirmationResult> {
        delete session.pendingNameClarification;
        session.confirmedName = pending.dbName; // Use existing profile name as fallback
        
        smartLog.info('Name clarification resolved with fallback', {
            sessionId: session.sessionId,
            fallbackName: pending.dbName,
            reason: 'timeout_or_max_attempts'
        });

        return await this.retryBookingWithConfirmedName(session, pending);
    }

    /**
     * Retry booking with confirmed name after clarification
     */
    private static async retryBookingWithConfirmedName(
        session: BookingSessionWithAgent,
        pendingClarification: any
    ): Promise<ConfirmationResult> {
        try {
            // Reconstruct the original booking request with confirmed name
            const originalArgs = JSON.parse(pendingClarification.originalToolCall.function.arguments);
            const confirmedName = session.confirmedName!;

            smartLog.info('Retrying booking with confirmed name', {
                sessionId: session.sessionId,
                confirmedName,
                originalAction: pendingClarification.originalToolCall.function.name
            });

            // Prepare function context with confirmed name
            const functionContext = {
                ...pendingClarification.originalContext,
                confirmedName: confirmedName,
                session: session
            };

            // Execute the booking with confirmed name
            const result = await agentFunctions.create_reservation(
                confirmedName,
                originalArgs.guestPhone,
                originalArgs.date,
                originalArgs.time,
                originalArgs.guests,
                originalArgs.specialRequests || '',
                functionContext
            );

            // Process the result using the standard tool result handler
            return await this.processToolResult(
                result, 
                pendingClarification.originalToolCall, 
                session, 
                { ...originalArgs, guestName: confirmedName }
            );

        } catch (error) {
            smartLog.error('Failed to retry booking with confirmed name', error as Error, {
                sessionId: session.sessionId,
                confirmedName: session.confirmedName
            });

            const errorMessage = await TranslationService.translateMessage(
                "An unexpected error occurred while finalizing your booking.",
                session.language, 
                'error', 
                session.tenantContext!
            );

            return {
                response: errorMessage,
                hasBooking: false,
                session,
                currentAgent: session.currentAgent
            };
        }
    }

    /**
     * Cancel pending action when user declines
     */
    private static async cancelPendingAction(session: BookingSessionWithAgent): Promise<ConfirmationResult> {
        delete session.pendingConfirmation;
        delete session.confirmedName;
        
        const cancelMessage = await TranslationService.translateMessage(
            "Okay, operation cancelled. How else can I help you?",
            session.language, 
            'question', 
            session.tenantContext!
        );
        
        smartLog.info('Pending action cancelled by user', {
            sessionId: session.sessionId
        });

        return {
            response: cancelMessage,
            hasBooking: false,
            session,
            currentAgent: session.currentAgent
        };
    }

    /**
     * Handle unclear confirmation responses by treating as new input
     */
    private static async handleUnclearConfirmation(
        session: BookingSessionWithAgent,
        message: string
    ): Promise<ConfirmationResult> {
        // Clear confirmation state - this will cause ECM to process the message normally
        delete session.pendingConfirmation;
        delete session.confirmedName;
        
        smartLog.info('Unclear confirmation - clearing state for normal processing', {
            sessionId: session.sessionId,
            userMessage: message.substring(0, 50)
        });

        // Return the original message to be reprocessed by ECM
        return {
            response: message, // This signals ECM to reprocess the message
            hasBooking: false,
            session,
            currentAgent: session.currentAgent
        };
    }

    /**
     * Process tool execution results (booking creation/cancellation)
     */
    private static async processToolResult(
        result: any,
        toolCall: any,
        session: BookingSessionWithAgent,
        args: any
    ): Promise<ConfirmationResult> {
        if (result.tool_status === 'SUCCESS' && result.data) {
            // Success case - generate detailed confirmation
            const reservationId = result.data.reservationId;

            // Use clean data from tool result for confirmation message and state preservation
            const cleanBookingData = {
                name: result.data.guestName || args.guestName,
                phone: result.data.guestPhone || args.guestPhone,
                date: result.data.date || args.date,
                time: result.data.time || args.time,
                guests: result.data.guests || args.guests,
                comments: result.data.comments || args.specialRequests || ''
            };
            
            // Update session state after a successful booking or cancellation
            if (toolCall.function.name === 'create_reservation' || toolCall.function.name === 'cancel_reservation') {
                session.hasActiveReservation = toolCall.function.name === 'create_reservation' ? reservationId : undefined;

                smartLog.info('Task complete. Resetting agent to conductor and clearing task data.', {
                    sessionId: session.sessionId,
                    action: toolCall.function.name,
                    preservedName: cleanBookingData.name
                });

                // Handoff to the neutral conductor agent.
                session.currentAgent = 'conductor';

                // Clear booking details but PRESERVE the guest's identity.
                session.gatheringInfo = {
                    name: cleanBookingData.name,
                    phone: cleanBookingData.phone
                };

                // Reset conversation flags for the next booking
                session.hasAskedDate = false;
                session.hasAskedTime = false;
                session.hasAskedPartySize = false;
            }            

            const detailedConfirmation = this.generateDetailedConfirmation(
                reservationId,
                cleanBookingData,
                session.language,
                result.metadata
            );

            smartLog.businessEvent(
                toolCall.function.name === 'create_reservation' ? 'booking_created' : 'booking_cancelled',
                {
                    sessionId: session.sessionId,
                    reservationId,
                    platform: session.platform,
                    language: session.language,
                    processingMethod: 'confirmation_service',
                    dataSource: 'clean_tool_result'
                }
            );

            return {
                response: detailedConfirmation,
                hasBooking: toolCall.function.name === 'create_reservation',
                reservationId: toolCall.function.name === 'create_reservation' ? reservationId : undefined,
                session,
                currentAgent: session.currentAgent
            };
            
        } else {
            // Add specific handling for name mismatch error
            if (result.error?.code === 'NAME_CLARIFICATION_NEEDED') {
                const { dbName, requestName } = result.error.details;

                // Set the pendingNameClarification state in the session to start the clarification flow
                session.pendingNameClarification = {
                    dbName,
                    requestName,
                    originalToolCall: toolCall,
                    // Create a clean context for safe serialization in Redis
                    originalContext: {
                        restaurantId: session.restaurantId,
                        timezone: session.timezone,
                        telegramUserId: session.telegramUserId,
                        source: session.platform,
                        sessionId: session.sessionId,
                        language: session.language
                    },
                    attempts: 0,
                    timestamp: Date.now()
                };

                const clarificationMessage = await TranslationService.translateMessage(
                    `I see you've booked with us before under the name "${dbName}". For this reservation, would you like to use "${requestName}" or keep "${dbName}"?`,
                    session.language,
                    'question',
                    session.tenantContext!
                );

                // Return the clarification question to the user
                return {
                    response: clarificationMessage,
                    hasBooking: false,
                    session,
                    currentAgent: session.currentAgent
                };
            }

            // Fallback for all other errors
            const errorMessage = await TranslationService.translateMessage(
                `Sorry, I couldn't complete the operation: ${result.error?.message || 'unknown error'}`,
                session.language,
                'error',
                session.tenantContext!
            );

            smartLog.warn('Tool execution failed in confirmation service', {
                sessionId: session.sessionId,
                toolName: toolCall.function.name,
                error: result.error
            });

            return {
                response: errorMessage,
                hasBooking: false,
                session,
                currentAgent: session.currentAgent
            };
        }
    }
}