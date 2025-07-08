// ✅ FIXED: Updated to use dependency injection and new agent architecture

import { storage } from '../../storage';
import { runGuardrails, requiresConfirmation, type GuardrailResult } from '../guardrails';
import type { Restaurant } from '@shared/schema';
import { DateTime } from 'luxon';

// ✅ CHANGE 1: Fixed import - was createDefaultAIFallbackService, now AIFallbackService 
import { AIFallbackService } from '../ai/ai-fallback.service'; 
import { UnifiedTranslationService } from '../ai/translation.service';
import { OverseerAgent } from '../agents/meta-agents/overseer.agent';
import { LanguageDetectionAgent } from '../agents/meta-agents/language.agent';
import { ConfirmationDetectionAgent } from '../agents/meta-agents/confirmation.agent';
import { SofiaAgent } from '../agents/specialists/sofia.agent';
import { MayaAgent } from '../agents/specialists/maya.agent';
import { ApolloAgent } from '../agents/specialists/apollo.agent';

import { bookingTools } from '../agents/tools/booking.tools';
import { reservationTools } from '../agents/tools/reservation.tools';
import { guestTools } from '../agents/tools/guest.tools';

import type { 
    Language, 
    AgentType, 
    GuestHistory, 
    AgentContext,
    RestaurantConfig 
} from '../agents/core/agent.types';

// ✅ PRESERVED: Your BookingSession interface (no changes)
interface BookingSession {
    sessionId: string;
    restaurantId: number;
    platform: 'web' | 'telegram';
    telegramUserId?: string;
    webSessionId?: string;
    language: Language;
    createdAt: Date;
    lastActivity: Date;
    conversationHistory: Array<{
        role: 'user' | 'assistant';
        content: string;
        timestamp: Date;
        toolCalls?: any[];
    }>;
    currentStep: string;
    gatheringInfo: {
        date?: string;
        time?: string;
        guests?: number;
        name?: string;
        phone?: string;
        comments?: string;
    };
    hasActiveReservation?: number;
}

/**
 * ✅ FIXED: Clean conversation manager with dependency injection
 */
export class ConversationManager {
    private sessions = new Map<string, BookingSessionWithAgent>();
    private sessionCleanupInterval: NodeJS.Timeout;
    
    // ✅ CHANGE 2: Constructor now accepts injected dependencies (was initializing them manually)
    constructor(
        private aiService: AIFallbackService,
        private translationService: UnifiedTranslationService,
        private overseer: OverseerAgent,
        private languageAgent: LanguageDetectionAgent,
        private confirmationAgent: ConfirmationDetectionAgent,
        private sofiaAgent: SofiaAgent,
        private mayaAgent: MayaAgent,
        private apolloAgent: ApolloAgent
    ) {
        // ✅ CHANGE 3: No longer initializing services here - they're injected
        this.sessionCleanupInterval = setInterval(() => {
            this.cleanupOldSessions();
        }, 60 * 60 * 1000);

        console.log('[ConversationManager] Initialized with injected dependencies');
    }

    // ✅ PRESERVED: All your existing methods remain exactly the same
    createSession(config: {
        restaurantId: number;
        platform: 'web' | 'telegram';
        language?: Language;
        telegramUserId?: string;
        webSessionId?: string;
    }): string {
        const sessionId = config.webSessionId || config.telegramUserId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const session: BookingSessionWithAgent = {
            sessionId,
            restaurantId: config.restaurantId,
            platform: config.platform,
            telegramUserId: config.telegramUserId,
            webSessionId: config.webSessionId,
            language: config.language || 'en',
            createdAt: new Date(),
            lastActivity: new Date(),
            conversationHistory: [],
            currentStep: 'greeting',
            gatheringInfo: {},
            
            // Extended properties
            context: this.detectContext(config.platform),
            currentAgent: 'booking', // Default to Sofia
            agentHistory: [],
            guestHistory: null,
            turnCount: 0,
            agentTurnCount: 0,
            languageLocked: false
        };

        this.sessions.set(sessionId, session);

        console.log(`[ConversationManager] Created ${session.context} session ${sessionId} for restaurant ${config.restaurantId} with Sofia (booking) agent`);

        return sessionId;
    }

    // ✅ PRESERVED: All your utility methods (no changes needed)
    private preserveReservationContext(
        session: BookingSessionWithAgent, 
        reservationId: number, 
        operationType: 'modification' | 'cancellation' | 'creation'
    ): void {
        const expiryTime = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        
        if (!session.recentlyModifiedReservations) {
            session.recentlyModifiedReservations = [];
        }
        
        // Remove old entries for same reservation
        session.recentlyModifiedReservations = session.recentlyModifiedReservations
            .filter(r => r.reservationId !== reservationId);
        
        // Add new context
        session.recentlyModifiedReservations.unshift({
            reservationId,
            lastModifiedAt: new Date(),
            contextExpiresAt: expiryTime,
            operationType,
            userReference: undefined
        });
        
        // Keep only last 3 reservations
        session.recentlyModifiedReservations = session.recentlyModifiedReservations.slice(0, 3);
        
        console.log(`[ContextManager] Preserved context for reservation ${reservationId} until ${expiryTime.toISOString()}`);
    }

    private cleanExpiredContext(session: BookingSessionWithAgent): void {
        if (!session.recentlyModifiedReservations) return;
        
        const now = new Date();
        const beforeCount = session.recentlyModifiedReservations.length;
        
        session.recentlyModifiedReservations = session.recentlyModifiedReservations
            .filter(r => r.contextExpiresAt > now);
        
        const afterCount = session.recentlyModifiedReservations.length;
        
        if (beforeCount > afterCount) {
            console.log(`[ContextManager] Cleaned ${beforeCount - afterCount} expired context entries`);
        }
    }

    // ✅ PRESERVED: All your existing methods - retrieveGuestHistory, validateFunctionCall, etc.
    private async retrieveGuestHistory(
        telegramUserId: string,
        restaurantId: number
    ): Promise<GuestHistory | null> {
        try {
            console.log(`👤 [GuestHistory] Retrieving history for telegram user: ${telegramUserId}`);

            const result = await guestTools.get_guest_history(telegramUserId, { restaurantId });

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
                const baseMessage = `I need the following information to complete your booking: ${missing.join(', ')}. Please provide this information.`;
                
                return {
                    valid: false,
                    errorMessage: baseMessage,
                    missingParams: missing
                };
            }
        }

        return { valid: true };
    }

    // ✅ CHANGE 4: Now uses injected agents instead of creating new ones
    private async getAgentForType(agentType: AgentType): Promise<any> {
        switch (agentType) {
            case 'booking':
                return this.sofiaAgent;
            case 'reservations':
                return this.mayaAgent;
            case 'availability':
                return this.apolloAgent;
            case 'conductor':
            default:
                return this.sofiaAgent; // Default fallback
        }
    }

    // ✅ PRESERVED: All your tool execution and message handling methods (no changes)
    private async executeToolCall(toolCall: any, context: any): Promise<any> {
        const { name, arguments: args } = toolCall.function;
        
        try {
            let parsedArgs;
            try {
                parsedArgs = JSON.parse(args);
            } catch {
                parsedArgs = this.parseFunctionCallArgs(args);
            }

            switch (name) {
                // Booking tools
                case 'check_availability':
                    return await bookingTools.check_availability(
                        parsedArgs.date,
                        parsedArgs.time,
                        parsedArgs.guests,
                        context
                    );

                case 'find_alternative_times':
                    return await bookingTools.find_alternative_times(
                        parsedArgs.date,
                        parsedArgs.preferredTime,
                        parsedArgs.guests,
                        context
                    );

                case 'create_reservation':
                    return await bookingTools.create_reservation(
                        parsedArgs.guestName,
                        parsedArgs.guestPhone,
                        parsedArgs.date,
                        parsedArgs.time,
                        parsedArgs.guests,
                        parsedArgs.specialRequests || '',
                        context
                    );

                case 'get_restaurant_info':
                    return await bookingTools.get_restaurant_info(
                        parsedArgs.infoType,
                        context
                    );

                // Reservation tools
                case 'find_existing_reservation':
                    return await reservationTools.find_existing_reservation(
                        parsedArgs.identifier,
                        parsedArgs.identifierType || 'auto',
                        parsedArgs.timeRange || 'upcoming',
                        context
                    );

                case 'modify_reservation':
                    return await reservationTools.modify_reservation(
                        parsedArgs.reservationId,
                        parsedArgs.modifications,
                        parsedArgs.reason || 'Guest requested change',
                        context
                    );

                case 'cancel_reservation':
                    return await reservationTools.cancel_reservation(
                        parsedArgs.reservationId,
                        parsedArgs.reason || 'Guest requested cancellation',
                        parsedArgs.confirmCancellation,
                        context
                    );

                // Guest tools
                case 'get_guest_history':
                    return await guestTools.get_guest_history(
                        parsedArgs.telegramUserId,
                        context
                    );

                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        } catch (error) {
            console.error(`[ConversationManager] Error executing ${name}:`, error);
            return {
                tool_status: 'FAILURE',
                error: {
                    type: 'SYSTEM_ERROR',
                    message: error.message || 'Unknown error'
                }
            };
        }
    }

    // ✅ PRESERVED: All remaining utility methods from your implementation
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
            console.log(`[ConversationManager] Updated session info:`, updates);
        }
    }

    private hasCompleteBookingInfo(session: BookingSessionWithAgent): boolean {
        const info = session.gatheringInfo;
        return !!(info.date && info.time && info.guests && info.name && info.phone);
    }

    private detectContext(platform: 'web' | 'telegram'): 'hostess' | 'guest' {
        return platform === 'web' ? 'hostess' : 'guest';
    }

    private resetAgentState(session: BookingSessionWithAgent) {
        console.log(`[Conductor] Task complete. Resetting agent from '${session.currentAgent}' to 'conductor'.`);
        session.currentAgent = 'conductor';
    }

    // ✅ PRESERVED: Your complete handleMessage implementation (no changes)
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

            // STEP 1: Guest history retrieval on first message
            if (session.telegramUserId && isFirstMessage && !session.guestHistory) {
                const guestHistory = await this.retrieveGuestHistory(
                    session.telegramUserId,
                    session.restaurantId
                );
                session.guestHistory = guestHistory;
            }

            // STEP 2: Check for pending confirmation
            if (session.pendingConfirmation) {
                const pendingAction = session.pendingConfirmation;
                let summary = 'the requested action';
                if (pendingAction.summaryData) {
                    const details = pendingAction.summaryData;
                    if (details.action === 'cancellation') {
                        summary = `cancellation of reservation #${details.reservationId}`;
                    } else {
                        summary = `a reservation for ${details.guests} people for ${details.guestName} on ${details.date} at ${details.time}`;
                    }
                }

                const confirmationResult = await this.confirmationAgent.analyzeConfirmation(
                    message, 
                    summary, 
                    session.language
                );

                switch (confirmationResult.confirmationStatus) {
                    case 'positive':
                        session.conversationHistory.push({ role: 'user', content: message, timestamp: new Date() });
                        return await this.handleConfirmation(sessionId, true);
                    
                    case 'negative':
                        session.conversationHistory.push({ role: 'user', content: message, timestamp: new Date() });
                        return await this.handleConfirmation(sessionId, false);
                    
                    case 'unclear':
                    default:
                        delete session.pendingConfirmation;
                        delete session.confirmedName;
                        break;
                }
            }

            // STEP 3: Language detection
            const shouldRunDetection = !session.languageLocked || 
                                     session.conversationHistory.length <= 1 || 
                                     message.length > 10;
            
            if (shouldRunDetection) {
                const languageDetection = await this.languageAgent.detectLanguage(
                    message,
                    {
                        conversationHistory: session.conversationHistory,
                        currentLanguage: session.language,
                        sessionId
                    }
                );
                
                const shouldChangeLanguage = session.languageLocked 
                    ? (languageDetection.confidence > 0.8 && languageDetection.detectedLanguage !== session.language)
                    : (languageDetection.confidence > 0.7 && languageDetection.detectedLanguage !== session.language);
                
                if (languageDetection.shouldLock || shouldChangeLanguage) {
                    session.language = languageDetection.detectedLanguage;
                    
                    if (languageDetection.shouldLock && !session.languageLocked) {
                        session.languageLocked = true;
                    }
                }
            }

            // STEP 4: Overseer decision
            const overseerDecision = await this.overseer.makeDecision(session, message);
            
            if (overseerDecision.intervention) {
                const translatedIntervention = await this.translationService.translate(
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

            // STEP 5: Run guardrails
            const guardrailResult = await runGuardrails(message, session);
            if (!guardrailResult.allowed) {
                const translatedReason = await this.translationService.translate(
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

            // STEP 6: Get agent and process message
            const agent = await this.getAgentForType(session.currentAgent);
            
            const agentContext: AgentContext = {
                sessionId,
                restaurantId: session.restaurantId,
                language: session.language,
                guestHistory: session.guestHistory,
                session: session,
                telegramUserId: session.telegramUserId,
                conversationContext: {
                    sessionTurnCount: session.turnCount || 0,
                    bookingNumber: 1,
                    isSubsequentBooking: false,
                    hasAskedPartySize: session.hasAskedPartySize || false
                }
            };

            // ✅ PRESERVED: Use your agent architecture with complete processing
            const agentResponse = await agent.processMessage(message, agentContext);

            // ✅ PRESERVED: Process function calls if present
            if (agentResponse.toolCalls?.length > 0) {
                console.log(`[ConversationManager] Processing ${agentResponse.toolCalls.length} tool calls`);
                
                for (const toolCall of agentResponse.toolCalls) {
                    const validation = this.validateFunctionCall(toolCall, session);
                    
                    if (!validation.valid) {
                        const errorMessage = await this.translationService.translate(
                            validation.errorMessage || 'Missing required information',
                            session.language,
                            'error'
                        );
                        
                        session.conversationHistory.push({ 
                            role: 'assistant', 
                            content: errorMessage, 
                            timestamp: new Date()
                        });
                        this.sessions.set(sessionId, session);
                        
                        return { 
                            response: errorMessage, 
                            hasBooking: false, 
                            session, 
                            currentAgent: session.currentAgent 
                        };
                    }

                    // Execute the tool call
                    const toolContext = {
                        restaurantId: session.restaurantId,
                        language: session.language,
                        telegramUserId: session.telegramUserId,
                        sessionId
                    };
                    
                    const toolResult = await this.executeToolCall(toolCall, toolContext);
                    
                    // Update session with tool results
                    if (toolCall.function.name === 'create_reservation' && toolResult.tool_status === 'SUCCESS') {
                        session.hasActiveReservation = toolResult.data?.reservationId;
                        this.resetAgentState(session);
                    }
                    
                    // Extract gathering info from successful tool calls
                    if (toolResult.tool_status === 'SUCCESS') {
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            this.extractGatheringInfo(session, args);
                        } catch (error) {
                            console.warn('[ConversationManager] Failed to parse tool arguments for info extraction');
                        }
                    }
                }
            }

            const response = agentResponse.content || await this.translationService.translate(
                "I apologize, I didn't understand that. Could you please try again?",
                session.language,
                'error'
            );

            session.conversationHistory.push({ 
                role: 'assistant', 
                content: response, 
                timestamp: new Date()
            });
            this.sessions.set(sessionId, session);
            
            return { 
                response, 
                hasBooking: agentResponse.hasBooking || false, 
                reservationId: agentResponse.reservationId, 
                session, 
                currentAgent: session.currentAgent, 
                agentHandoff 
            };

        } catch (error) {
            console.error(`[ConversationManager] Error handling message:`, error);
            
            const fallbackMessage = session.context === 'hostess'
                ? "Error occurred. Please try again."
                : 'I apologize, I encountered a technical issue. Please try again.';
                
            const fallbackResponse = await this.translationService.translate(
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

    // ✅ PRESERVED: All your remaining methods (no changes)
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
            }

            const result = await bookingTools.create_reservation(
                args.guestName, 
                args.guestPhone, 
                args.date, 
                args.time, 
                args.guests, 
                args.specialRequests || '', 
                functionContext
            );
            delete session.confirmedName;

            if (result.tool_status === 'SUCCESS' && result.data && result.data.success) {
                session.hasActiveReservation = result.data.reservationId;
                session.currentStep = 'completed';
                this.resetAgentState(session);
                
                const successMessage = await this.translationService.translate(
                    `🎉 Perfect! Your reservation is confirmed. Reservation number: ${result.data.reservationId}`,
                    session.language,
                    'success'
                );

                session.conversationHistory.push({ role: 'assistant', content: successMessage, timestamp: new Date() });
                this.sessions.set(sessionId, session);
                return { response: successMessage, hasBooking: true, reservationId: result.data.reservationId, session, currentAgent: session.currentAgent };
            } else {
                const errorMessage = await this.translationService.translate(
                    `Sorry, I couldn't create the reservation: ${result.error?.message || 'unknown error'}`,
                    session.language,
                    'error'
                );

                session.conversationHistory.push({ role: 'assistant', content: errorMessage, timestamp: new Date() });
                this.sessions.set(sessionId, session);
                return { response: errorMessage, hasBooking: false, session, currentAgent: session.currentAgent };
            }
        } catch (error) {
            console.error(`[ConversationManager] Error executing confirmed booking:`, error);
            
            const errorMessage = await this.translationService.translate(
                "An error occurred while creating the reservation.",
                session.language,
                'error'
            );
            
            return { response: errorMessage, hasBooking: false, session, currentAgent: session.currentAgent };
        }
    }

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

        if (confirmed) {
            return await this.executeConfirmedBooking(sessionId, session.pendingConfirmation);
        } else {
            delete session.pendingConfirmation;
            delete session.confirmedName;
            
            const cancelMessage = await this.translationService.translate(
                "Okay, operation cancelled. How else can I help you?",
                session.language,
                'question'
            );

            session.conversationHistory.push({ role: 'assistant', content: cancelMessage, timestamp: new Date() });
            this.sessions.set(sessionId, session);
            return { response: cancelMessage, hasBooking: false, session, currentAgent: session.currentAgent };
        }
    }

    // ✅ PRESERVED: All session management methods
    getSession(sessionId: string): BookingSessionWithAgent | undefined {
        return this.sessions.get(sessionId);
    }

    updateSession(sessionId: string, updates: Partial<BookingSession['gatheringInfo']>): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) return false;

        Object.assign(session.gatheringInfo, updates);
        this.sessions.set(sessionId, session);
        return true;
    }

    endSession(sessionId: string): boolean {
        return this.sessions.delete(sessionId);
    }

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
            console.log(`[ConversationManager] Cleaned up ${cleanedCount} old sessions`);
        }
    }

    getStats(): {
        totalSessions: number;
        activeSessions: number;
        completedBookings: number;
        sessionsByPlatform: { web: number; telegram: number };
        sessionsByAgent: { booking: number; reservations: number; conductor: number; availability: number };
        agentHandoffs: number;
        returningGuests: number;
    } {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        let activeSessions = 0;
        let completedBookings = 0;
        let webSessions = 0;
        let telegramSessions = 0;
        const sessionsByAgent = { booking: 0, reservations: 0, conductor: 0, availability: 0 };
        let agentHandoffs = 0;
        let returningGuests = 0;

        for (const session of this.sessions.values()) {
            if (session.lastActivity > oneHourAgo) activeSessions++;
            if (session.hasActiveReservation) completedBookings++;
            if (session.platform === 'web') webSessions++;
            else telegramSessions++;

            sessionsByAgent[session.currentAgent] = (sessionsByAgent[session.currentAgent] || 0) + 1;

            if (session.agentHistory && session.agentHistory.length > 0) {
                agentHandoffs += session.agentHistory.length;
            }
            if (session.guestHistory && session.guestHistory.total_bookings >= 2) {
                returningGuests++;
            }
        }

        return {
            totalSessions: this.sessions.size,
            activeSessions,
            completedBookings,
            sessionsByPlatform: { web: webSessions, telegram: telegramSessions },
            sessionsByAgent,
            agentHandoffs,
            returningGuests
        };
    }

    shutdown(): void {
        if (this.sessionCleanupInterval) {
            clearInterval(this.sessionCleanupInterval);
        }
        console.log('[ConversationManager] Shutdown completed with clean agent architecture');
    }
}

// ✅ PRESERVED: Extended session interface (no changes)
interface BookingSessionWithAgent extends BookingSession {
    context: 'hostess' | 'guest';
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
    foundReservations?: Array<{
        id: number;
        date: string;
        time: string;
        guests: number;
        guestName: string;
        tableName: string;
        status: string;
        canModify: boolean;
        canCancel: boolean;
    }>;
    turnCount?: number;
    agentTurnCount?: number;
    languageLocked?: boolean;
    languageDetectionLog?: {
        detectedAt: string;
        firstMessage: string;
        confidence: number;
        reasoning: string;
    };
    hasAskedPartySize?: boolean;
    hasAskedDate?: boolean;
    hasAskedTime?: boolean;
    hasAskedName?: boolean;
    hasAskedPhone?: boolean;
    availabilityFailureContext?: {
        originalDate: string;
        originalTime: string;
        originalGuests: number;
        failureReason: string;
        detectedAt: string;
    };
    recentlyModifiedReservations?: Array<{
        reservationId: number;
        lastModifiedAt: Date;
        contextExpiresAt: Date;
        operationType: 'modification' | 'cancellation' | 'creation';
        userReference?: string;
    }>;
}

// ✅ CHANGE 5: No longer create global instance here - use service container
export default ConversationManager;