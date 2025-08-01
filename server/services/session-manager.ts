// server/services/session-manager.ts
// ✅ REFACTORED: This file has been streamlined to only contain session management utilities.
// ❌ OBSOLETE: All agent creation logic (createBookingAgent), system prompt generation,
// and other agent-specific functions have been removed.
// ➡️ NEW ARCHITECTURE: Agent logic is now handled by the `BaseAgent` class and its
// implementations (`SofiaAgent`, `MayaAgent`) and managed by the `AgentFactory`.
// This file's purpose is to define the session data structure and provide
// basic session manipulation functions used by `enhanced-conversation-manager.ts`.
// 🔒 SECURITY FIX: Complete tenant isolation and validation added

import type { Language } from '../enhanced-conversation-manager';
import { TenantContext } from './tenant-context';
import { smartLog } from './smart-logging.service';

/**
 * Defines the core structure for a booking session with tenant isolation.
 * This interface is used as a base for the more detailed `BookingSessionWithAgent`
 * in the EnhancedConversationManager.
 */
export interface BookingSession {
    sessionId: string;
    restaurantId: number; // 🔒 Used for tenant validation
    tenantId: number;     // 🔒 NEW: Explicit tenant tracking for security
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
        internalDiagnostics?: string;
    };
    conversationHistory: Array<{
        role: 'user' | 'assistant';
        content: string;
        timestamp: Date;
        toolCalls?: any[];
    }>;
    currentStep: 'greeting' | 'gathering' | 'checking' | 'confirming' | 'completed';
    hasActiveReservation?: number;
    // 🔒 Security metadata
    securityContext: {
        createdBy: 'system' | 'user';
        lastValidation: Date;
        ipAddress?: string;
        userAgent?: string;
    };
}

// 🔒 Session validation result interface
export interface SessionValidationResult {
    isValid: boolean;
    session?: BookingSession;
    error?: string;
    securityViolation?: boolean;
}

/**
 * 🔒 Validates that a session belongs to the requesting tenant
 */
function validateSessionTenantAccess(
    session: BookingSession | null, 
    tenantContext: TenantContext, 
    operation: string
): SessionValidationResult {
    if (!session) {
        return {
            isValid: false,
            error: 'Session not found'
        };
    }

    if (!tenantContext) {
        smartLog.error('Session operation attempted without tenant context', new Error('MISSING_TENANT_CONTEXT'), {
            sessionId: session.sessionId,
            operation,
            securityViolation: true,
            critical: true
        });
        return {
            isValid: false,
            error: 'Tenant context required',
            securityViolation: true
        };
    }

    // Validate tenant access
    if (session.tenantId !== tenantContext.restaurant.id || session.restaurantId !== tenantContext.restaurant.id) {
        smartLog.error('Session tenant access violation detected', new Error('SESSION_TENANT_VIOLATION'), {
            sessionId: session.sessionId,
            sessionTenantId: session.tenantId,
            sessionRestaurantId: session.restaurantId,
            requestingTenantId: tenantContext.restaurant.id,
            operation,
            securityViolation: true,
            critical: true
        });
        return {
            isValid: false,
            error: 'Session access denied',
            securityViolation: true
        };
    }

    // Update last validation timestamp
    session.securityContext.lastValidation = new Date();

    smartLog.info('Session tenant validation successful', {
        sessionId: session.sessionId,
        tenantId: session.tenantId,
        operation,
        lastActivity: session.lastActivity
    });

    return {
        isValid: true,
        session
    };
}

/**
 * 🔒 Creates a new booking session object with tenant isolation.
 * This function is called by the `EnhancedConversationManager` to initialize a new session.
 * @param config - Configuration for the new session.
 * @param tenantContext - Required tenant context for security.
 * @param securityMetadata - Optional security context (IP, user agent, etc.).
 * @returns A new BookingSession object.
 */
export function createBookingSession(
    config: {
        platform: 'web' | 'telegram';
        language?: Language;
        telegramUserId?: string;
        webSessionId?: string;
    },
    tenantContext: TenantContext,
    securityMetadata?: {
        ipAddress?: string;
        userAgent?: string;
    }
): BookingSession {
    if (!tenantContext) {
        smartLog.error('Attempted to create session without tenant context', new Error('MISSING_TENANT_CONTEXT'), {
            platform: config.platform,
            securityViolation: true,
            critical: true
        });
        throw new Error('Tenant context required for session creation');
    }

    // The context is now determined by the manager, but we keep a simple detection here as a fallback.
    const context = config.platform === 'web' ? 'hostess' : 'guest';

    const session: BookingSession = {
        sessionId: generateTenantScopedSessionId(tenantContext.restaurant.id),
        restaurantId: tenantContext.restaurant.id,
        tenantId: tenantContext.restaurant.id, // 🔒 Explicit tenant tracking
        platform: config.platform,
        context,
        language: config.language || 'en',
        telegramUserId: config.telegramUserId,
        webSessionId: config.webSessionId,
        createdAt: new Date(),
        lastActivity: new Date(),
        gatheringInfo: {},
        conversationHistory: [],
        currentStep: 'greeting',
        // 🔒 Security context
        securityContext: {
            createdBy: 'system',
            lastValidation: new Date(),
            ipAddress: securityMetadata?.ipAddress,
            userAgent: securityMetadata?.userAgent
        }
    };

    smartLog.info('Secure booking session created', {
        sessionId: session.sessionId,
        tenantId: tenantContext.restaurant.id,
        platform: config.platform,
        context,
        language: session.language,
        hasSecurityMetadata: !!(securityMetadata?.ipAddress || securityMetadata?.userAgent)
    });

    smartLog.businessEvent('session_created', {
        tenantId: tenantContext.restaurant.id,
        platform: config.platform,
        context,
        sessionId: session.sessionId
    });

    return session;
}

/**
 * 🔒 Generates a tenant-scoped session ID to prevent cross-tenant access.
 * @param tenantId - The tenant ID for scoping.
 * @returns A unique, tenant-scoped string for the session ID.
 */
function generateTenantScopedSessionId(tenantId: number): string {
    const timestamp = Date.now();
    const randomPart = Math.random().toString(36).substr(2, 9);
    const tenantPrefix = `t${tenantId}`;
    
    // Format: t123_session_1690123456789_abc123def
    const sessionId = `${tenantPrefix}_session_${timestamp}_${randomPart}`;
    
    smartLog.info('Tenant-scoped session ID generated', {
        tenantId,
        sessionId,
        securityLevel: 'HIGH'
    });

    return sessionId;
}

/**
 * 🔒 Extracts tenant ID from a session ID for validation
 */
export function extractTenantIdFromSessionId(sessionId: string): number | null {
    try {
        const match = sessionId.match(/^t(\d+)_session_/);
        return match ? parseInt(match[1], 10) : null;
    } catch (error) {
        smartLog.warn('Failed to extract tenant ID from session ID', {
            sessionId,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        return null;
    }
}

/**
 * 🔒 Updates the gatheringInfo within a session with tenant validation.
 * This is a utility function used by the `EnhancedConversationManager`.
 * @param session - The current booking session.
 * @param updates - The partial information to update.
 * @param tenantContext - Required tenant context for security.
 * @returns The updated session object or null if validation fails.
 */
export function updateSessionInfo(
    session: BookingSession,
    updates: Partial<BookingSession['gatheringInfo']>,
    tenantContext: TenantContext
): BookingSession | null {
    // 🔒 Validate tenant access
    const validation = validateSessionTenantAccess(session, tenantContext, 'updateSessionInfo');
    if (!validation.isValid) {
        return null;
    }

    const updatedSession = {
        ...validation.session!,
        gatheringInfo: {
            ...validation.session!.gatheringInfo,
            ...updates
        },
        lastActivity: new Date()
    };

    smartLog.info('Session info updated with tenant validation', {
        sessionId: session.sessionId,
        tenantId: session.tenantId,
        updatedFields: Object.keys(updates),
        previousStep: session.currentStep
    });

    return updatedSession;
}

/**
 * 🔒 Adds a message to conversation history with tenant validation.
 * @param session - The current booking session.
 * @param message - The message to add.
 * @param tenantContext - Required tenant context for security.
 * @returns The updated session object or null if validation fails.
 */
export function addSessionMessage(
    session: BookingSession,
    message: {
        role: 'user' | 'assistant';
        content: string;
        toolCalls?: any[];
    },
    tenantContext: TenantContext
): BookingSession | null {
    // 🔒 Validate tenant access
    const validation = validateSessionTenantAccess(session, tenantContext, 'addSessionMessage');
    if (!validation.isValid) {
        return null;
    }

    const conversationMessage = {
        ...message,
        timestamp: new Date()
    };

    const updatedSession = {
        ...validation.session!,
        conversationHistory: [
            ...validation.session!.conversationHistory,
            conversationMessage
        ],
        lastActivity: new Date()
    };

    smartLog.info('Message added to session with tenant validation', {
        sessionId: session.sessionId,
        tenantId: session.tenantId,
        messageRole: message.role,
        messageLength: message.content.length,
        hasToolCalls: !!(message.toolCalls && message.toolCalls.length > 0),
        conversationLength: updatedSession.conversationHistory.length
    });

    return updatedSession;
}

/**
 * 🔒 Updates session step with tenant validation.
 * @param session - The current booking session.
 * @param newStep - The new step to set.
 * @param tenantContext - Required tenant context for security.
 * @returns The updated session object or null if validation fails.
 */
export function updateSessionStep(
    session: BookingSession,
    newStep: BookingSession['currentStep'],
    tenantContext: TenantContext
): BookingSession | null {
    // 🔒 Validate tenant access
    const validation = validateSessionTenantAccess(session, tenantContext, 'updateSessionStep');
    if (!validation.isValid) {
        return null;
    }

    const updatedSession = {
        ...validation.session!,
        currentStep: newStep,
        lastActivity: new Date()
    };

    smartLog.info('Session step updated with tenant validation', {
        sessionId: session.sessionId,
        tenantId: session.tenantId,
        previousStep: session.currentStep,
        newStep,
        stepProgression: `${session.currentStep} → ${newStep}`
    });

    smartLog.businessEvent('session_step_changed', {
        tenantId: session.tenantId,
        sessionId: session.sessionId,
        fromStep: session.currentStep,
        toStep: newStep,
        platform: session.platform
    });

    return updatedSession;
}

/**
 * 🔒 Checks if all required information for creating a reservation has been gathered (with tenant validation).
 * @param session - The current booking session.
 * @param tenantContext - Required tenant context for security.
 * @returns True if all information is complete and access is valid, otherwise false.
 */
export function hasCompleteBookingInfo(
    session: BookingSession, 
    tenantContext: TenantContext
): boolean {
    // 🔒 Validate tenant access
    const validation = validateSessionTenantAccess(session, tenantContext, 'hasCompleteBookingInfo');
    if (!validation.isValid) {
        smartLog.warn('Complete booking info check failed - tenant validation failed', {
            sessionId: session.sessionId,
            securityViolation: validation.securityViolation
        });
        return false;
    }

    const { date, time, guests, name, phone } = validation.session!.gatheringInfo;
    const isComplete = !!(date && time && guests && name && phone);

    if (!isComplete) {
        const missing = [];
        if (!date) missing.push('date');
        if (!time) missing.push('time');
        if (!guests) missing.push('guests');
        if (!name) missing.push('name');
        if (!phone) missing.push('phone');

        smartLog.info('Booking info incomplete', {
            sessionId: session.sessionId,
            tenantId: session.tenantId,
            missingFields: missing,
            currentStep: session.currentStep
        });
    } else {
        smartLog.info('Booking info complete', {
            sessionId: session.sessionId,
            tenantId: session.tenantId,
            allFieldsPresent: true,
            readyForReservation: true
        });
    }

    return isComplete;
}

/**
 * 🔒 Validates session security and freshness
 * @param session - The booking session to validate.
 * @param tenantContext - Required tenant context for security.
 * @returns Validation result with security status.
 */
export function validateSessionSecurity(
    session: BookingSession,
    tenantContext: TenantContext
): SessionValidationResult {
    const validation = validateSessionTenantAccess(session, tenantContext, 'validateSessionSecurity');
    
    if (!validation.isValid) {
        return validation;
    }

    // Check session age (optional security check)
    const sessionAge = Date.now() - session.createdAt.getTime();
    const maxSessionAge = 24 * 60 * 60 * 1000; // 24 hours
    
    if (sessionAge > maxSessionAge) {
        smartLog.warn('Session expired due to age', {
            sessionId: session.sessionId,
            tenantId: session.tenantId,
            sessionAge: Math.round(sessionAge / (60 * 60 * 1000)) + ' hours',
            maxAge: '24 hours'
        });

        return {
            isValid: false,
            error: 'Session expired',
            securityViolation: false
        };
    }

    // Check last activity (session timeout)
    const inactivityTime = Date.now() - session.lastActivity.getTime();
    const maxInactivity = 2 * 60 * 60 * 1000; // 2 hours
    
    if (inactivityTime > maxInactivity) {
        smartLog.warn('Session expired due to inactivity', {
            sessionId: session.sessionId,
            tenantId: session.tenantId,
            inactivityTime: Math.round(inactivityTime / (60 * 1000)) + ' minutes',
            maxInactivity: '2 hours'
        });

        return {
            isValid: false,
            error: 'Session timed out due to inactivity',
            securityViolation: false
        };
    }

    smartLog.info('Session security validation passed', {
        sessionId: session.sessionId,
        tenantId: session.tenantId,
        sessionAge: Math.round(sessionAge / (60 * 1000)) + ' minutes',
        lastActivity: Math.round(inactivityTime / (60 * 1000)) + ' minutes ago'
    });

    return {
        isValid: true,
        session: validation.session
    };
}

/**
 * 🔒 Cleanup session data for tenant (called during tenant suspension/deletion)
 * @param tenantId - The tenant ID to cleanup sessions for.
 * @returns Number of sessions that would be affected.
 */
export function getTenantSessionCleanupInfo(tenantId: number): {
    sessionPattern: string;
    affectedSessions: number;
} {
    const sessionPattern = `t${tenantId}_session_*`;
    
    smartLog.info('Tenant session cleanup info requested', {
        tenantId,
        sessionPattern,
        operation: 'cleanup_info'
    });

    return {
        sessionPattern,
        affectedSessions: 0 // This would be calculated by the storage layer
    };
}

// 🔒 Log that the secure session manager is loaded
smartLog.info('Secure Session Manager loaded with tenant isolation', {
    features: [
        '🔒 Complete tenant validation on all operations',
        '🔒 Tenant-scoped session IDs',
        '🔒 Security context tracking',
        '🔒 Session age and inactivity validation',
        '🔒 Comprehensive audit logging',
        '🔒 Cross-tenant access prevention'
    ],
    securityLevel: 'HIGH',
    tenantIsolationEnabled: true
});

console.log(`
✅ Secure Session Manager (with Tenant Isolation) Loaded Successfully.
   🔒 All session operations now require tenant context validation
   🔒 Session IDs are tenant-scoped to prevent cross-tenant access
   🔒 Complete security audit logging implemented
   🔒 Session security validation and cleanup ready
   - This file contains session data structures and helper functions with SECURITY.
   - All agent logic remains in the BaseAgent architecture.
`);
