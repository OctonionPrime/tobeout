// src/services/context-manager.ts
// ✅ STEP 1: SAFE CONTEXT MANAGER - NO BREAKING CHANGES
// This only WRAPS existing functions, doesn't change them

import type { BookingSession } from './agents/booking-agent';
import type { Language } from './enhanced-conversation-manager';

/**
 * ✅ SAFE: Re-export existing interfaces without changes
 */
export interface BookingSessionWithAgent extends BookingSession {
    currentAgent: 'booking' | 'reservations' | 'conductor' | 'availability';
    agentHistory?: Array<{
        from: any;
        to: any;
        at: string;
        trigger: string;
        overseerReasoning?: string;
    }>;
    pendingConfirmation?: any;
    confirmedName?: string;
    guestHistory?: any;
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
    languageDetectionLog?: any;
    hasAskedPartySize?: boolean;
    hasAskedDate?: boolean;
    hasAskedTime?: boolean;
    hasAskedName?: boolean;
    hasAskedPhone?: boolean;
    availabilityFailureContext?: any;
    recentlyModifiedReservations?: Array<{
        reservationId: number;
        lastModifiedAt: Date;
        contextExpiresAt: Date;
        operationType: 'modification' | 'cancellation' | 'creation';
        userReference?: string;
    }>;
    currentOperationContext?: any;
}

/**
 * ✅ SAFE: Resolution result interface (matches existing)
 */
export interface ReservationResolution {
    resolvedId: number | null;
    confidence: 'high' | 'medium' | 'low';
    method: string;
    shouldAskForClarification: boolean;
    suggestion?: string;
}

/**
 * ✅ STEP 1: SAFE Context Manager - Only wraps existing functions
 * DOES NOT change any existing behavior - just provides a clean interface
 */
export class ContextManager {
    private static instance: ContextManager | null = null;

    static getInstance(): ContextManager {
        if (!ContextManager.instance) {
            ContextManager.instance = new ContextManager();
        }
        return ContextManager.instance;
    }

    /**
     * ✅ SAFE WRAPPER: Wraps existing resolveReservationFromContext function
     * TODO: In Step 2, we'll move the actual logic here
     */
    resolveReservationFromContext(
        userMessage: string,
        session: BookingSessionWithAgent,
        providedId?: number
    ): ReservationResolution {
        // ✅ STEP 1: Just delegate to existing function
        // This will be replaced in Step 2 with the actual implementation
        return this.existingResolveReservationFromContext(userMessage, session, providedId);
    }

    /**
     * ✅ SAFE WRAPPER: Wraps existing preserveReservationContext function  
     * TODO: In Step 2, we'll move the actual logic here
     */
    preserveReservationContext(
        session: BookingSessionWithAgent,
        reservationId: number,
        operationType: 'modification' | 'cancellation' | 'creation'
    ): void {
        // ✅ STEP 1: Just delegate to existing function
        this.existingPreserveReservationContext(session, reservationId, operationType);
    }

    /**
     * ✅ SAFE WRAPPER: Wraps existing cleanExpiredContext function
     * TODO: In Step 2, we'll move the actual logic here  
     */
    cleanExpiredContext(session: BookingSessionWithAgent): void {
        // ✅ STEP 1: Just delegate to existing function
        this.existingCleanExpiredContext(session);
    }

    /**
     * ✅ NEW: Simple conversation flag updater (safe to add)
     */
    updateConversationFlags(session: BookingSessionWithAgent, flags: {
        hasAskedPartySize?: boolean;
        hasAskedDate?: boolean;
        hasAskedTime?: boolean;
        hasAskedName?: boolean;
        hasAskedPhone?: boolean;
    }): void {
        // This is new and safe to add without breaking anything
        if (flags.hasAskedPartySize !== undefined) {
            session.hasAskedPartySize = flags.hasAskedPartySize;
        }
        if (flags.hasAskedDate !== undefined) {
            session.hasAskedDate = flags.hasAskedDate;
        }
        if (flags.hasAskedTime !== undefined) {
            session.hasAskedTime = flags.hasAskedTime;
        }
        if (flags.hasAskedName !== undefined) {
            session.hasAskedName = flags.hasAskedName;
        }
        if (flags.hasAskedPhone !== undefined) {
            session.hasAskedPhone = flags.hasAskedPhone;
        }
        
        console.log(`[ContextManager] Updated conversation flags safely`);
    }

    // ===== ✅ STEP 1: COPY EXISTING FUNCTIONS (UNCHANGED) =====
    // These are exact copies from enhanced-conversation-manager.ts
    // In Step 2, we'll move the logic into the wrapper functions above

    private existingCleanExpiredContext(session: BookingSessionWithAgent): void {
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

    private existingPreserveReservationContext(
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
            userReference: undefined // Will be set by resolution logic
        });
        
        // Keep only last 3 reservations
        session.recentlyModifiedReservations = session.recentlyModifiedReservations.slice(0, 3);
        
        console.log(`[ContextManager] Preserved context for reservation ${reservationId} until ${expiryTime.toISOString()}`);
    }

    private existingResolveReservationFromContext(
        userMessage: string,
        session: BookingSessionWithAgent,
        providedId?: number
    ): ReservationResolution {
        
        // Clean expired context first
        this.existingCleanExpiredContext(session);
        
        // 1. If explicit ID provided and valid, use it
        if (providedId) {
            if (session.foundReservations?.some(r => r.id === providedId)) {
                return {
                    resolvedId: providedId,
                    confidence: 'high',
                    method: 'explicit_id_validated',
                    shouldAskForClarification: false
                };
            }
        }
        
        // 2. Check for recent modifications (high confidence)
        if (session.recentlyModifiedReservations?.length > 0) {
            const recentReservation = session.recentlyModifiedReservations[0];
            if (recentReservation.contextExpiresAt > new Date()) {
                // Check for contextual references
                const contextualPhrases = ['эту бронь', 'this booking', 'it', 'её', 'эту', 'this one', 'that one'];
                const userMessageLower = userMessage.toLowerCase();
                
                if (contextualPhrases.some(phrase => userMessageLower.includes(phrase))) {
                    return {
                        resolvedId: recentReservation.reservationId,
                        confidence: 'high',
                        method: 'recent_modification_context',
                        shouldAskForClarification: false
                    };
                }
            }
        }
        
        // 3. Check active reservation (medium confidence)
        if (session.activeReservationId) {
            return {
                resolvedId: session.activeReservationId,
                confidence: 'medium',
                method: 'active_session_reservation',
                shouldAskForClarification: false
            };
        }
        
        // 4. Single found reservation (medium confidence)
        if (session.foundReservations?.length === 1) {
            return {
                resolvedId: session.foundReservations[0].id,
                confidence: 'medium',
                method: 'single_found_reservation',
                shouldAskForClarification: false
            };
        }
        
        // 5. Multiple reservations - need clarification
        return {
            resolvedId: null,
            confidence: 'low',
            method: 'ambiguous_context',
            shouldAskForClarification: true
        };
    }
}

// ✅ SAFE: Export singleton instance
export const contextManager = ContextManager.getInstance();