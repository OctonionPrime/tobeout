// server/services/session-manager.ts
// ✅ REFACTORED: This file has been streamlined to only contain session management utilities.
// ❌ OBSOLETE: All agent creation logic (createBookingAgent), system prompt generation,
// and other agent-specific functions have been removed.
// ➡️ NEW ARCHITECTURE: Agent logic is now handled by the `BaseAgent` class and its
// implementations (`SofiaAgent`, `MayaAgent`) and managed by the `AgentFactory`.
// This file's purpose is to define the session data structure and provide
// basic session manipulation functions used by `enhanced-conversation-manager.ts`.

import type { Language } from '../enhanced-conversation-manager';

/**
 * Defines the core structure for a booking session.
 * This interface is used as a base for the more detailed `BookingSessionWithAgent`
 * in the EnhancedConversationManager.
 */
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

/**
 * Creates a new booking session object.
 * This function is called by the `EnhancedConversationManager` to initialize a new session.
 * @param config - Configuration for the new session.
 * @returns A new BookingSession object.
 */
export function createBookingSession(config: {
    restaurantId: number;
    platform: 'web' | 'telegram';
    language?: Language;
    telegramUserId?: string;
    webSessionId?: string;
}): BookingSession {
    // The context is now determined by the manager, but we keep a simple detection here as a fallback.
    const context = config.platform === 'web' ? 'hostess' : 'guest';

    return {
        sessionId: generateSessionId(),
        restaurantId: config.restaurantId,
        platform: config.platform,
        context,
        language: config.language || 'en',
        telegramUserId: config.telegramUserId,
        webSessionId: config.webSessionId,
        createdAt: new Date(),
        lastActivity: new Date(),
        gatheringInfo: {},
        conversationHistory: [],
        currentStep: 'greeting'
    };
}

/**
 * Generates a unique session ID.
 * @returns A unique string for the session ID.
 */
function generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Updates the gatheringInfo within a session.
 * This is a utility function used by the `EnhancedConversationManager`.
 * @param session - The current booking session.
 * @param updates - The partial information to update.
 * @returns The updated session object.
 */
export function updateSessionInfo(
    session: BookingSession,
    updates: Partial<BookingSession['gatheringInfo']>
): BookingSession {
    return {
        ...session,
        gatheringInfo: {
            ...session.gatheringInfo,
            ...updates
        },
        lastActivity: new Date()
    };
}

/**
 * Checks if all required information for creating a reservation has been gathered.
 * @param session - The current booking session.
 * @returns True if all information is complete, otherwise false.
 */
export function hasCompleteBookingInfo(session: BookingSession): boolean {
    const { date, time, guests, name, phone } = session.gatheringInfo;
    const isComplete = !!(date && time && guests && name && phone);

    if (!isComplete) {
        const missing = [];
        if (!date) missing.push('date');
        if (!time) missing.push('time');
        if (!guests) missing.push('guests');
        if (!name) missing.push('name');
        if (!phone) missing.push('phone');

        console.log(`[BookingSession] Missing required info: ${missing.join(', ')}`);
    }

    return isComplete;
}

// Log that the refactored module is loaded
console.log(`
✅ Refactored booking-agent.ts (Session Utilities) Loaded Successfully.
   - This file now only contains session data structures and helper functions.
   - All agent logic has been migrated to the new BaseAgent architecture.
`);
