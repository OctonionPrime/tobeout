// server/services/agents/core/agent.types.ts
// ✅ FIXED: Unified interfaces and standardized agent response structure

// ===== LANGUAGE & AGENT TYPES =====
// SOURCE: enhanced-conversation-manager.ts line ~15-16
export type Language = 'en' | 'ru' | 'sr' | 'hu' | 'de' | 'fr' | 'es' | 'it' | 'pt' | 'nl' | 'auto';
export type AgentType = 'booking' | 'reservations' | 'conductor' | 'availability';

// ===== GUEST HISTORY INTERFACE =====
// SOURCE: enhanced-conversation-manager.ts lines ~45-55
export interface GuestHistory {
    guest_name: string;
    guest_phone: string; // ✅ PHONE FIX: Added phone number field
    total_bookings: number;
    total_cancellations: number;
    last_visit_date: string | null;
    common_party_size: number | null;
    frequent_special_requests: string[];
    retrieved_at: string;
}

// ===== CONVERSATION CONTEXT =====
// SOURCE: booking-agent.ts lines ~45-55
export interface ConversationContext {
    isReturnVisit: boolean;
    hasAskedPartySize: boolean;
    hasAskedDate: boolean;
    hasAskedTime: boolean;
    hasAskedName: boolean;
    hasAskedPhone: boolean;
    bookingNumber: number; // 1st, 2nd booking in session
    isSubsequentBooking: boolean;
    sessionTurnCount: number;
    lastQuestions: string[]; // Track last few questions to avoid repetition
    gatheringInfo: {
        date?: string;
        time?: string;
        guests?: number;
        name?: string;
        phone?: string;
        comments?: string;
    };
}

// ===== CORE SESSION INTERFACE =====
// SOURCE: booking-agent.ts lines ~200-230
export interface BookingSession {
    sessionId: string;
    restaurantId: number;
    platform: 'web' | 'telegram';
    context: 'hostess' | 'guest';
    language: Language;
    telegramUserId?: string;
    webSessionId?: string;
    createdAt: Date;
    lastActivity: Date;
    gatheringInfo: {
        date?: string;
        time?: string;
        guests?: number;
        name?: string;
        phone?: string;
        comments?: string;
    };
    conversationHistory: Array<{
        role: 'user' | 'assistant';
        content: string;
        timestamp: Date;
        toolCalls?: any[];
    }>;
    currentStep: 'greeting' | 'gathering' | 'checking' | 'confirming' | 'completed';
    hasActiveReservation?: number;
}

// ===== EXTENDED SESSION WITH AGENT FEATURES =====
// SOURCE: enhanced-conversation-manager.ts lines ~150-200
export interface BookingSessionWithAgent extends BookingSession {
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
    
    // ✅ Language detection features
    languageLocked?: boolean;
    languageDetectionLog?: {
        detectedAt: string;
        firstMessage: string;
        confidence: number;
        reasoning: string;
    };
    
    // ✅ Conversation state tracking
    hasAskedPartySize?: boolean;
    hasAskedDate?: boolean;
    hasAskedTime?: boolean;
    hasAskedName?: boolean;
    hasAskedPhone?: boolean;
    
    // ✅ Apollo availability failure context
    availabilityFailureContext?: {
        originalDate: string;
        originalTime: string;
        originalGuests: number;
        failureReason: string;
        detectedAt: string;
    };
    
    // ✅ Smart context preservation
    recentlyModifiedReservations?: Array<{
        reservationId: number;
        lastModifiedAt: Date;
        contextExpiresAt: Date;
        operationType: 'modification' | 'cancellation' | 'creation';
        userReference?: string; // Store "эту бронь", "this booking"
    }>;
    
    // ✅ Current operation context with disambiguation
    currentOperationContext?: {
        type: 'modification' | 'cancellation' | 'lookup';
        targetReservationId?: number;
        lastUserReference?: string;
        confidenceLevel: 'high' | 'medium' | 'low';
        contextSource: 'explicit_id' | 'recent_modification' | 'found_reservation';
    };
    
    // ✅ Claude meta-agent tracking (optional for monitoring)
    claudeMetaAgentLog?: Array<{
        timestamp: string;
        agentType: 'overseer' | 'language' | 'confirmation';
        modelUsed: 'claude-sonnet' | 'claude-haiku' | 'gpt-fallback';
        confidence?: number;
        fallbackReason?: string;
    }>;
}

// ===== TOOL RESPONSE INTERFACE =====
// SOURCE: agent-tools.ts lines ~100-120
export interface ToolResponse<T = any> {
    tool_status: 'SUCCESS' | 'FAILURE';
    data?: T;
    error?: {
        type: 'BUSINESS_RULE' | 'SYSTEM_ERROR' | 'VALIDATION_ERROR';
        message: string;
        code?: string;
        details?: any;
    };
    metadata?: {
        execution_time_ms?: number;
        fallback_used?: boolean;
        warnings?: string[];
    };
}

// ===== ✅ NEW: UNIFIED TOOL CONTEXT INTERFACE =====
// Replaces separate BookingToolContext, ReservationToolContext, GuestToolContext
export interface UnifiedToolContext {
    restaurantId: number;
    timezone: string;
    language: Language;
    telegramUserId?: string;
    sessionId?: string;
    userMessage?: string;
    session?: BookingSessionWithAgent;
    excludeReservationId?: number;
    confirmedName?: string;
    
    // ✅ NEW: Timezone-specific context
    restaurantOperatingHours?: {
        opening: string;
        closing: string;
        isOvernight: boolean;
        currentStatus: 'open' | 'closed';
    };
}

// ===== ✅ LEGACY COMPATIBILITY: Individual tool contexts extend unified =====
export interface BookingToolContext extends UnifiedToolContext {
    // Booking-specific fields can be added here if needed
}

export interface ReservationToolContext extends UnifiedToolContext {
    // Reservation-specific fields can be added here if needed
}

export interface GuestToolContext extends UnifiedToolContext {
    // Guest-specific fields can be added here if needed
}

// ===== NEW: AI PROVIDER INTERFACES =====
export interface AIOptions {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    timeout?: number;
}

export interface ModelInfo {
    name: string;
    provider: 'claude' | 'openai';
    contextWindow: number;
    costPer1kTokens: number;
}

export interface AIProvider {
    generateCompletion(prompt: string, options?: AIOptions): Promise<string>;
    generateStructuredResponse<T>(prompt: string, schema: any, options?: AIOptions): Promise<T>;
    getModelInfo(): ModelInfo;
    isAvailable(): Promise<boolean>;
}

// ===== NEW: AGENT INTERFACES =====
export interface AgentContext {
    session: BookingSessionWithAgent;
    restaurantId: number;
    timezone: string;
    language: Language;
    telegramUserId?: string;
    sessionId: string;
    guestHistory?: GuestHistory | null;
    conversationContext?: ConversationContext;
}

// ===== ✅ FIXED: STANDARDIZED AGENT RESPONSE INTERFACE =====
// This interface now matches what ConversationManager expects
export interface AgentResponse {
    content: string; // The agent's message content
    
    // ✅ FIXED: Add fields that ConversationManager expects
    hasBooking?: boolean; // Indicates if a booking was made
    reservationId?: number; // The created reservation ID
    
    // Tool calling support
    toolCalls?: Array<{
        function: {
            name: string;
            arguments: string;
        };
        id: string;
        result?: any; // ✅ NEW: Store tool call results
    }>;
    
    // Confirmation and handoff
    requiresConfirmation?: boolean;
    agentHandoff?: {
        to: AgentType;
        reason: string;
        selectedTime?: string; // ✅ NEW: Context for handoffs
    };
    
    // ✅ NEW: Session updates that agents can make
    sessionUpdates?: Partial<BookingSessionWithAgent>;
    
    // ✅ NEW: Additional response metadata
    responseMetadata?: {
        confidence?: number;
        toolsUsed?: string[];
        executionTimeMs?: number;
        warningsOrErrors?: string[];
    };
}

// ===== ✅ NEW: CONVERSATION MANAGER COMPATIBLE RESPONSE =====
// This is what ConversationManager actually expects
export interface ConversationManagerResponse {
    response: string; // Maps to AgentResponse.content
    hasBooking: boolean; // Maps to AgentResponse.hasBooking
    reservationId?: number; // Maps to AgentResponse.reservationId
    session: BookingSessionWithAgent; // Updated session
    currentAgent: AgentType; // Current agent type
    agentHandoff?: {
        to: AgentType;
        reason: string;
        selectedTime?: string;
    };
    requiresConfirmation?: boolean;
    toolCallResults?: any[];
}

export interface BaseAgentConfig {
    name: string;
    capabilities: string[];
    supportedLanguages: Language[];
    maxContextLength: number;
    toolsAvailable: string[];
}

// ===== RESTAURANT CONTEXT =====
export interface RestaurantConfig {
    id: number;
    name: string;
    timezone: string;
    openingTime: string;
    closingTime: string;
    maxGuests: number;
    cuisine?: string;
    atmosphere?: string;
    country?: string;
    languages?: string[];
    allowAnyTime?: boolean;
    minTimeIncrement?: number;
    slotInterval?: number;
    
    // ✅ NEW: Timezone-related fields
    timezoneDisplayName?: string;
    supportsOvernightOperations?: boolean;
}

// ===== ✅ NEW: TIMEZONE-RELATED INTERFACES =====
export interface TimezoneContext {
    timezone: string;
    currentDate: string;
    currentTime: string;
    tomorrowDate: string;
    dayOfWeek: string;
    operatingStatus: {
        isOpen: boolean;
        nextStatusChange?: string;
        timeUntilChange?: string;
    };
    isOvernightOperation: boolean;
}

export interface TimeValidationResult {
    isValid: boolean;
    isWithinOperatingHours: boolean;
    crossesMidnight?: boolean;
    suggestion?: string;
    reason?: string;
}

// ===== PROMPT TEMPLATE INTERFACES =====
export interface PromptTemplate {
    id: string;
    name: string;
    template: string;
    variables: string[];
    language?: Language;
    agentType?: AgentType;
}

export interface PromptContext {
    restaurant: RestaurantConfig;
    session: BookingSessionWithAgent;
    guestHistory?: GuestHistory | null;
    conversationContext?: ConversationContext;
    currentDate: string;
    currentTime: string;
    // ✅ NEW: Enhanced timezone context
    timezoneContext?: TimezoneContext;
}

// ===== GUARDRAIL INTERFACES =====
export interface GuardrailResult {
    allowed: boolean;
    reason?: string;
    category?: 'off_topic' | 'safety' | 'inappropriate';
    confidence?: number;
    details?: any;
}

// ===== AVAILABILITY CONTEXT =====
export interface AvailabilityContext {
    date: string;
    time: string;
    guests: number;
    excludeReservationId?: number;
    requestedTime?: string;
    exactTimeOnly?: boolean;
    timezone?: string;
    allowCombinations?: boolean;
    // ✅ NEW: Enhanced timezone support
    operatingHoursValidation?: boolean;
    crossMidnightSupport?: boolean;
}

// ===== RESERVATION INTERFACES =====
export interface ReservationDetails {
    id: number;
    confirmationNumber: number;
    guestName: string;
    guestPhone: string;
    date: string;
    time: string;
    guests: number;
    tableName: string;
    tableId?: number;
    tableCapacity?: number;
    comments?: string;
    status: string;
    canModify: boolean;
    canCancel: boolean;
    hoursUntil?: number;
    
    // ✅ NEW: Timezone-aware fields
    localDateTime?: string; // Formatted in restaurant timezone
    utcDateTime?: string; // UTC timestamp
}

export interface ModificationRequest {
    reservationId?: number;
    newDate?: string;
    newTime?: string;
    newGuests?: number;
    newSpecialRequests?: string;
    reason?: string;
    
    // ✅ NEW: Timezone validation
    timezoneValidation?: TimeValidationResult;
}

// ===== ERROR TYPES =====
export type ToolErrorType = 'BUSINESS_RULE' | 'SYSTEM_ERROR' | 'VALIDATION_ERROR' | 'TIMEZONE_ERROR';
export type ConfirmationStatus = 'positive' | 'negative' | 'unclear';
export type LanguageConfidence = 'high' | 'medium' | 'low';

// ===== ✅ NEW: AGENT INTERFACE COMPATIBILITY HELPERS =====
// Helper functions to convert between agent response formats
export namespace AgentResponseHelpers {
    export function toConversationManagerResponse(
        agentResponse: AgentResponse,
        session: BookingSessionWithAgent
    ): ConversationManagerResponse {
        return {
            response: agentResponse.content,
            hasBooking: agentResponse.hasBooking || false,
            reservationId: agentResponse.reservationId,
            session: agentResponse.sessionUpdates ? { ...session, ...agentResponse.sessionUpdates } : session,
            currentAgent: session.currentAgent,
            agentHandoff: agentResponse.agentHandoff,
            requiresConfirmation: agentResponse.requiresConfirmation,
            toolCallResults: agentResponse.toolCalls?.map(tc => tc.result).filter(Boolean) || []
        };
    }
    
    export function fromConversationManagerExpectation(
        response: string,
        hasBooking: boolean,
        session: BookingSessionWithAgent,
        reservationId?: number
    ): AgentResponse {
        return {
            content: response,
            hasBooking,
            reservationId,
            sessionUpdates: {} // Will be populated as needed
        };
    }
}

// ===== EXPORT ALL TYPES =====
export type {
    // Core types already exported above
};

// ===== TYPE GUARDS =====
export function isBookingSessionWithAgent(session: any): session is BookingSessionWithAgent {
    return session && typeof session.currentAgent === 'string';
}

export function isToolSuccess<T>(response: ToolResponse<T>): response is ToolResponse<T> & { tool_status: 'SUCCESS'; data: T } {
    return response.tool_status === 'SUCCESS' && response.data !== undefined;
}

export function isToolFailure(response: ToolResponse): response is ToolResponse & { tool_status: 'FAILURE'; error: NonNullable<ToolResponse['error']> } {
    return response.tool_status === 'FAILURE' && response.error !== undefined;
}

export function hasGuestHistory(session: BookingSessionWithAgent): session is BookingSessionWithAgent & { guestHistory: GuestHistory } {
    return session.guestHistory !== null && session.guestHistory !== undefined;
}

export function isReturningGuest(guestHistory?: GuestHistory | null): boolean {
    return guestHistory ? guestHistory.total_bookings >= 2 : false;
}

export function isFrequentGuest(guestHistory?: GuestHistory | null): boolean {
    return guestHistory ? guestHistory.total_bookings >= 5 : false;
}

// ===== ✅ NEW: INTERFACE VALIDATION TYPE GUARDS =====
export function isValidAgentResponse(response: any): response is AgentResponse {
    return response && 
           typeof response.content === 'string' &&
           (response.hasBooking === undefined || typeof response.hasBooking === 'boolean') &&
           (response.reservationId === undefined || typeof response.reservationId === 'number');
}

export function isValidConversationManagerResponse(response: any): response is ConversationManagerResponse {
    return response &&
           typeof response.response === 'string' &&
           typeof response.hasBooking === 'boolean' &&
           response.session &&
           typeof response.currentAgent === 'string';
}

export function isUnifiedToolContext(context: any): context is UnifiedToolContext {
    return context &&
           typeof context.restaurantId === 'number' &&
           typeof context.timezone === 'string' &&
           typeof context.language === 'string';
}

// ===== ✅ NEW: TIMEZONE VALIDATION HELPERS =====
export function isValidTimezone(timezone: string): boolean {
    try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
        return true;
    } catch {
        return false;
    }
}

export function isValidTimeFormat(time: string): boolean {
    return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
}

export function isValidDateFormat(date: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date));
}