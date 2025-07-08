// server/services/agents/core/agent.types.ts
// ✅ PHASE 1: Core type definitions extracted from existing files
// SOURCE: enhanced-conversation-manager.ts, booking-agent.ts, agent-tools.ts

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

export interface AgentResponse {
    content: string;
    toolCalls?: Array<{
        function: {
            name: string;
            arguments: string;
        };
        id: string;
    }>;
    requiresConfirmation?: boolean;
    agentHandoff?: {
        to: AgentType;
        reason: string;
    };
    sessionUpdates?: Partial<BookingSessionWithAgent>;
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
}

export interface ModificationRequest {
    reservationId?: number;
    newDate?: string;
    newTime?: string;
    newGuests?: number;
    newSpecialRequests?: string;
    reason?: string;
}

// ===== ERROR TYPES =====
export type ToolErrorType = 'BUSINESS_RULE' | 'SYSTEM_ERROR' | 'VALIDATION_ERROR';
export type ConfirmationStatus = 'positive' | 'negative' | 'unclear';
export type LanguageConfidence = 'high' | 'medium' | 'low';

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