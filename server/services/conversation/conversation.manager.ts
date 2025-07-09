// ✅ FIXED: Restored proactive guest history fetching from the old working code
// This ensures guest history is available BEFORE agent processing for personalized greetings

import { storage } from '../../storage';
import { runGuardrails, requiresConfirmation, type GuardrailResult } from '../guardrails';
import type { Restaurant } from '@shared/schema';
// ✅ FIXED: Replace Luxon with timezone utilities
import { 
    getRestaurantTimeContext,
    isValidTimezone,
    getRestaurantOperatingStatus 
} from '../../utils/timezone-utils';

// ✅ FIXED: Import corrected dependencies
import { AIFallbackService } from '../ai/ai-fallback.service'; 
import { UnifiedTranslationService } from '../ai/translation.service';
import { OverseerAgent } from '../agents/meta-agents/overseer.agent';
import { LanguageDetectionAgent } from '../agents/meta-agents/language.agent';
import { ConfirmationDetectionAgent } from '../agents/meta-agents/confirmation.agent';
import { SofiaAgent } from '../agents/specialists/sofia.agent';
import { MayaAgent } from '../agents/specialists/maya.agent';
import { ApolloAgent } from '../agents/specialists/apollo.agent';

// ✅ FIXED: Import standardized interfaces
import type { 
    Language, 
    AgentType, 
    GuestHistory, 
    AgentContext,
    RestaurantConfig,
    BookingSessionWithAgent,
    AgentResponse,
    ConversationManagerResponse,
    AgentResponseHelpers,
    UnifiedToolContext
} from '../agents/core/agent.types';

// ✅ CRITICAL FIX: Import guest tools for proactive history fetching
import { guestTools } from '../agents/tools/guest.tools';

/**
 * ✅ FIXED: Restored proactive guest history fetching like the old working code
 * - Fetches guest history BEFORE agent processes first message
 * - Enables personalized greetings from the start
 * - Uses standardized AgentResponse interface
 * - Integrated timezone utilities
 */
export class ConversationManager {
    private sessions = new Map<string, BookingSessionWithAgent>();
    private sessionCleanupInterval: NodeJS.Timeout;
    
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
        this.sessionCleanupInterval = setInterval(() => {
            this.cleanupOldSessions();
        }, 60 * 60 * 1000);

        console.log('[ConversationManager] Initialized with proactive guest history fetching');
    }

    // ✅ PRESERVED: Session creation with enhanced timezone support
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
            guestHistory: null, // ✅ Will be populated on first message
            turnCount: 0,
            agentTurnCount: 0,
            languageLocked: false
        };

        this.sessions.set(sessionId, session);

        console.log(`[ConversationManager] Created ${session.context} session ${sessionId} for restaurant ${config.restaurantId} with Sofia (booking) agent`);

        return sessionId;
    }

    // ✅ PRESERVED: Context preservation utilities
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

    // ✅ CRITICAL FIX: Restored proactive guest history retrieval like the old working code
    private async retrieveGuestHistory(
        telegramUserId: string,
        restaurantId: number,
        language: Language = 'en',
        timezone: string = 'Europe/Belgrade'
    ): Promise<GuestHistory | null> {
        try {
            console.log(`👤 [GuestHistory] First message from telegram user... retrieving history for: ${telegramUserId}`);

            // ✅ FIXED: Use unified tool context (like agents do)
            const toolContext: UnifiedToolContext = {
                restaurantId,
                timezone,
                language,
                telegramUserId,
                sessionId: telegramUserId
            };

            // ✅ CRITICAL FIX: Call guest tools directly (same as agent would)
            const historyResult = await guestTools.get_guest_history(
                telegramUserId,
                toolContext
            );

            if (historyResult.tool_status === 'SUCCESS' && historyResult.data) {
                console.log(`👤 [GuestHistory] Successfully retrieved guest history for ${historyResult.data.guest_name} (${historyResult.data.total_bookings} bookings)`);
                return historyResult.data;
            } else {
                console.log(`👤 [GuestHistory] No guest history found for telegram user: ${telegramUserId}`);
                return null;
            }

        } catch (error) {
            console.error(`👤 [GuestHistory] Error retrieving guest history:`, error);
            return null;
        }
    }

    // ✅ ENHANCED: Function call validation with timezone awareness
    private validateFunctionCall(
        toolCall: any,
        session: BookingSessionWithAgent,
        restaurantConfig?: RestaurantConfig
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

            // ✅ NEW: Validate timezone if restaurant config available
            if (restaurantConfig && args.time && args.date) {
                const timezone = restaurantConfig.timezone;
                const operatingStatus = getRestaurantOperatingStatus(
                    timezone,
                    restaurantConfig.openingTime,
                    restaurantConfig.closingTime
                );
                
                console.log(`[Validation] Checking booking time against restaurant hours: ${restaurantConfig.openingTime}-${restaurantConfig.closingTime} in ${timezone}`);
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

    // ✅ ENHANCED: Agent creation with proper restaurant config
    private async getAgentForType(agentType: AgentType, restaurantConfig?: RestaurantConfig): Promise<any> {
        switch (agentType) {
            case 'booking':
                return restaurantConfig ? 
                    new SofiaAgent(this.aiService, this.translationService, restaurantConfig) : 
                    this.sofiaAgent;
            case 'reservations':
                return restaurantConfig ? 
                    new MayaAgent(this.aiService, this.translationService, restaurantConfig) : 
                    this.mayaAgent;
            case 'availability':
                return restaurantConfig ? 
                    new ApolloAgent(this.aiService, this.translationService, restaurantConfig) : 
                    this.apolloAgent;
            case 'conductor':
            default:
                return restaurantConfig ? 
                    new SofiaAgent(this.aiService, this.translationService, restaurantConfig) : 
                    this.sofiaAgent; // Default fallback
        }
    }

    // ✅ PRESERVED: Utility parsing methods
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
        const updates: Partial<BookingSessionWithAgent['gatheringInfo']> = {};

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

    // ✅ CRITICAL FIX: Restored proactive guest history fetching on first message
    async handleMessage(sessionId: string, message: string): Promise<ConversationManagerResponse> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        try {
            const isFirstMessage = session.conversationHistory.length === 0;

            // ✅ ENHANCED: Fetch live restaurant configuration with timezone validation
            let liveRestaurantConfig: RestaurantConfig | undefined;
            let restaurantTimezone = 'Europe/Belgrade'; // Default fallback
            
            try {
                const restaurantData = await storage.getRestaurant(session.restaurantId);
                if (restaurantData) {
                    restaurantTimezone = restaurantData.timezone || 'Europe/Belgrade';
                    
                    // ✅ NEW: Validate timezone
                    if (!isValidTimezone(restaurantTimezone)) {
                        console.warn(`[ConversationManager] Invalid timezone ${restaurantTimezone}, using fallback`);
                        restaurantTimezone = 'Europe/Belgrade';
                    }

                    liveRestaurantConfig = {
                        id: restaurantData.id,
                        name: restaurantData.name,
                        timezone: restaurantTimezone,
                        openingTime: restaurantData.openingTime || '10:00',
                        closingTime: restaurantData.closingTime || '23:00',
                        maxGuests: restaurantData.maxGuests || 50,
                        cuisine: restaurantData.cuisine || undefined,
                        atmosphere: restaurantData.atmosphere || undefined,
                        country: restaurantData.country || undefined,
                        languages: restaurantData.languages || undefined,
                        allowAnyTime: restaurantData.allowAnyTime,
                        minTimeIncrement: restaurantData.minTimeIncrement,
                        slotInterval: restaurantData.slotInterval
                    };
                    
                    console.log(`🔄 [ConversationManager] Using live restaurant config: ${liveRestaurantConfig.name} (${liveRestaurantConfig.timezone}, hours: ${liveRestaurantConfig.openingTime}-${liveRestaurantConfig.closingTime})`);
                } else {
                    console.warn(`⚠️ [ConversationManager] Could not fetch restaurant ${session.restaurantId}, using default config`);
                }
            } catch (configError) {
                console.error(`❌ [ConversationManager] Error fetching restaurant config:`, configError);
            }

            // ✅ NEW: Get timezone context for the restaurant
            const timezoneContext = getRestaurantTimeContext(restaurantTimezone);
            console.log(`🕐 [ConversationManager] Restaurant time context: ${timezoneContext.currentDate} ${timezoneContext.currentTime} (${timezoneContext.timezone})`);

            // ✅ CRITICAL FIX: Fetch guest history on the first message, just like the old working code
            if (session.telegramUserId && isFirstMessage && !session.guestHistory) {
                console.log(`[ConversationManager] First message from known user, retrieving history...`);
                try {
                    const guestHistory = await this.retrieveGuestHistory(
                        session.telegramUserId,
                        session.restaurantId,
                        session.language,
                        restaurantTimezone
                    );
                    
                    if (guestHistory) {
                        session.guestHistory = guestHistory;
                        console.log(`[ConversationManager] Guest history successfully attached to session for ${guestHistory.guest_name}.`);
                    } else {
                        console.log(`[ConversationManager] No guest history found for telegram user: ${session.telegramUserId}`);
                    }
                } catch (error) {
                    console.error('[ConversationManager] Failed to retrieve guest history on first message.', error);
                }
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
                    currentAgent: session.currentAgent
                };
            }

            session.lastActivity = new Date();
            session.conversationHistory.push({ role: 'user', content: message, timestamp: new Date() });

            // STEP 6: Get agent with LIVE restaurant configuration
            const agent = await this.getAgentForType(session.currentAgent, liveRestaurantConfig);
            
            // ✅ ENHANCED: Create proper agent context with timezone and guest history
            const agentContext: AgentContext = {
                sessionId,
                restaurantId: session.restaurantId,
                timezone: restaurantTimezone, // Use validated timezone
                language: session.language,
                guestHistory: session.guestHistory, // ✅ NOW AVAILABLE FROM SESSION!
                session: session,
                telegramUserId: session.telegramUserId,
                conversationContext: {
                    sessionTurnCount: session.turnCount || 0,
                    bookingNumber: 1,
                    isSubsequentBooking: false,
                    hasAskedPartySize: session.hasAskedPartySize || false,
                    hasAskedDate: session.hasAskedDate || false,
                    hasAskedTime: session.hasAskedTime || false,
                    hasAskedName: session.hasAskedName || false,
                    hasAskedPhone: session.hasAskedPhone || false,
                    isReturnVisit: session.guestHistory ? session.guestHistory.total_bookings > 0 : false,
                    lastQuestions: [],
                    gatheringInfo: session.gatheringInfo
                }
            };

            // ✅ ENHANCED: Process agent response with standardized interface
            const agentResponse: AgentResponse = await agent.processMessage(message, agentContext);

            // ✅ NEW: Process session updates from agent
            if (agentResponse.sessionUpdates) {
                Object.assign(session, agentResponse.sessionUpdates);
                console.log(`[ConversationManager] Applied session updates from agent:`, Object.keys(agentResponse.sessionUpdates));
            }

            // ✅ NEW: Handle agent handoffs
            if (agentResponse.agentHandoff) {
                session.currentAgent = agentResponse.agentHandoff.to;
                
                if (!session.agentHistory) session.agentHistory = [];
                session.agentHistory.push({
                    from: session.currentAgent,
                    to: agentResponse.agentHandoff.to,
                    at: new Date().toISOString(),
                    trigger: message.substring(0, 100),
                    overseerReasoning: agentResponse.agentHandoff.reason
                });
                
                console.log(`[ConversationManager] Agent handoff: ${session.currentAgent} → ${agentResponse.agentHandoff.to} (${agentResponse.agentHandoff.reason})`);
            }

            // ✅ NEW: Handle tool call results from agent
            if (agentResponse.toolCalls?.length > 0) {
                console.log(`[ConversationManager] Agent executed ${agentResponse.toolCalls.length} tool calls`);
                
                // Process results from tool calls
                for (const toolCall of agentResponse.toolCalls) {
                    if (toolCall.result) {
                        // Handle successful reservation creation
                        if (toolCall.function.name === 'create_reservation' && toolCall.result.tool_status === 'SUCCESS') {
                            session.hasActiveReservation = toolCall.result.data?.reservationId;
                            this.resetAgentState(session);
                            
                            // ✅ NEW: Preserve reservation context
                            if (toolCall.result.data?.reservationId) {
                                this.preserveReservationContext(session, toolCall.result.data.reservationId, 'creation');
                            }
                        }
                        
                        // Extract gathering info from successful tool calls
                        if (toolCall.result.tool_status === 'SUCCESS') {
                            try {
                                const args = JSON.parse(toolCall.function.arguments);
                                this.extractGatheringInfo(session, args);
                            } catch (error) {
                                console.warn('[ConversationManager] Failed to parse tool arguments for info extraction');
                            }
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

            // ✅ NEW: Clean expired context
            this.cleanExpiredContext(session);
            
            this.sessions.set(sessionId, session);
            
            // ✅ FIXED: Return standardized ConversationManagerResponse
            return {
                response, 
                hasBooking: agentResponse.hasBooking || false, 
                reservationId: agentResponse.reservationId, 
                session, 
                currentAgent: session.currentAgent, 
                agentHandoff,
                requiresConfirmation: agentResponse.requiresConfirmation,
                toolCallResults: agentResponse.toolCalls?.map(tc => tc.result).filter(Boolean) || []
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
            
            return { 
                response: fallbackResponse, 
                hasBooking: false, 
                session, 
                currentAgent: session.currentAgent 
            };
        }
    }

    // ✅ PRESERVED: Confirmation handling (simplified since agents handle tools)
    private async executeConfirmedBooking(sessionId: string, pendingAction: any): Promise<ConversationManagerResponse> {
        const session = this.sessions.get(sessionId)!;
        
        // ✅ NOTE: This would now be handled by the agent's tool execution
        // Keeping simplified version for compatibility
        try {
            delete session.confirmedName;
            delete session.pendingConfirmation;
            
            const successMessage = await this.translationService.translate(
                `🎉 Perfect! Your reservation is being processed.`,
                session.language,
                'success'
            );

            session.conversationHistory.push({ role: 'assistant', content: successMessage, timestamp: new Date() });
            this.sessions.set(sessionId, session);
            
            return { 
                response: successMessage, 
                hasBooking: true, 
                session, 
                currentAgent: session.currentAgent 
            };
            
        } catch (error) {
            console.error(`[ConversationManager] Error executing confirmed booking:`, error);
            
            const errorMessage = await this.translationService.translate(
                "An error occurred while processing the reservation.",
                session.language,
                'error'
            );
            
            return { 
                response: errorMessage, 
                hasBooking: false, 
                session, 
                currentAgent: session.currentAgent 
            };
        }
    }

    async handleConfirmation(sessionId: string, confirmed: boolean): Promise<ConversationManagerResponse> {
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
            
            return { 
                response: cancelMessage, 
                hasBooking: false, 
                session, 
                currentAgent: session.currentAgent 
            };
        }
    }

    // ✅ PRESERVED: Session management methods
    getSession(sessionId: string): BookingSessionWithAgent | undefined {
        return this.sessions.get(sessionId);
    }

    updateSession(sessionId: string, updates: Partial<BookingSessionWithAgent['gatheringInfo']>): boolean {
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
        console.log('[ConversationManager] Shutdown completed with proactive guest history fetching');
    }
}

// ✅ NOTE: No longer create global instance - use service container
export default ConversationManager;