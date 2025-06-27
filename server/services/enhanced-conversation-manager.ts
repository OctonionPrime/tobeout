// server/services/enhanced-conversation-manager.ts

import { createBookingAgent, type BookingSession, createBookingSession, updateSessionInfo, hasCompleteBookingInfo } from './agents/booking-agent';
import { agentFunctions } from './agents/agent-tools';
import { storage } from '../storage';
import { runGuardrails, requiresConfirmation, type GuardrailResult } from './guardrails';
import type { Restaurant } from '@shared/schema';

// ✅ MOVED FROM conversation-manager.ts
export type Language = 'en' | 'ru' | 'sr';

/**
 * Enhanced conversation manager with guardrails and proper booking flow
 * ✅ FIXED: Works with the improved booking agent to ensure proper workflow
 */
export class EnhancedConversationManager {
  private sessions = new Map<string, BookingSessionWithConfirmation>();
  private agents = new Map<number, any>();
  private sessionCleanupInterval: NodeJS.Timeout;

  constructor() {
    this.sessionCleanupInterval = setInterval(() => {
      this.cleanupOldSessions();
    }, 60 * 60 * 1000);

    console.log('[EnhancedConversationManager] Initialized with guardrails and session cleanup');
  }

  /**
   * Create session with context detection
   */
  createSession(config: {
    restaurantId: number;
    platform: 'web' | 'telegram';
    language?: Language;
    telegramUserId?: string;
    webSessionId?: string;
  }): string {
    const session = createBookingSession(config) as BookingSessionWithConfirmation;
    
    // Add context detection
    session.context = this.detectContext(config.platform);
    
    this.sessions.set(session.sessionId, session);
    
    console.log(`[EnhancedConversationManager] Created ${session.context} session ${session.sessionId} for restaurant ${config.restaurantId}`);
    
    return session.sessionId;
  }

  /**
   * Context detection logic
   */
  private detectContext(platform: 'web' | 'telegram'): 'hostess' | 'guest' {
    return platform === 'web' ? 'hostess' : 'guest';
  }

  /**
   * Get or create agent for restaurant
   */
  private async getAgent(restaurantId: number) {
    if (this.agents.has(restaurantId)) {
      return this.agents.get(restaurantId);
    }

    const restaurant = await storage.getRestaurant(restaurantId);
    if (!restaurant) {
      throw new Error(`Restaurant ${restaurantId} not found`);
    }

    const agent = createBookingAgent({
      id: restaurant.id,
      name: restaurant.name,
      timezone: restaurant.timezone || 'Europe/Moscow',
      openingTime: restaurant.openingTime || '09:00:00',
      closingTime: restaurant.closingTime || '23:00:00',
      maxGuests: restaurant.maxGuests || 12,
      cuisine: restaurant.cuisine,
      atmosphere: restaurant.atmosphere,
      country: restaurant.country,
      languages: restaurant.languages
    });

    this.agents.set(restaurantId, agent);
    console.log(`[EnhancedConversationManager] Created Sofia agent for ${restaurant.name} with languages: ${restaurant.languages?.join(', ') || 'en'}`);
    
    return agent;
  }

  /**
   * Check if message is a confirmation response
   */
  private isConfirmationResponse(message: string): { isConfirmation: boolean; confirmed?: boolean } {
    const normalized = message.toLowerCase().trim();
    
    // English confirmations
    const englishYes = ['yes', 'y', 'yep', 'yeah', 'confirm', 'ok', 'okay'];
    const englishNo = ['no', 'n', 'nope', 'cancel', 'reject'];
    
    // Russian confirmations
    const russianYes = ['да', 'д', 'ага', 'угу', 'подтверждаю', 'хорошо', 'ок'];
    const russianNo = ['нет', 'н', 'не', 'отмена', 'отменить'];
    
    // Serbian confirmations
    const serbianYes = ['da', 'д', 'da', 'ага', 'потврђујем', 'у реду', 'ок'];
    const serbianNo = ['ne', 'н', 'не', 'otkaži', 'odbaci'];

    const allYes = [...englishYes, ...russianYes, ...serbianYes];
    const allNo = [...englishNo, ...russianNo, ...serbianNo];

    if (allYes.includes(normalized)) {
      return { isConfirmation: true, confirmed: true };
    }
    
    if (allNo.includes(normalized)) {
      return { isConfirmation: true, confirmed: false };
    }

    return { isConfirmation: false };
  }

  /**
   * Main message handling with enhanced logic
   */
  async handleMessage(sessionId: string, message: string): Promise<{
    response: string;
    hasBooking: boolean;
    reservationId?: number;
    session: BookingSessionWithConfirmation;
    blocked?: boolean;
    blockReason?: string;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      // STEP 1: Check for pending confirmation FIRST
      if (session.pendingConfirmation) {
        console.log(`[EnhancedConversationManager] Checking for confirmation response: "${message}"`);
        
        const confirmationCheck = this.isConfirmationResponse(message);
        if (confirmationCheck.isConfirmation) {
          console.log(`[EnhancedConversationManager] Detected confirmation response: ${confirmationCheck.confirmed}`);
          
          // Add user message to history
          session.conversationHistory.push({
            role: 'user',
            content: message,
            timestamp: new Date()
          });

          // Handle the confirmation
          return await this.handleConfirmation(sessionId, confirmationCheck.confirmed!);
        } else {
          console.log(`[EnhancedConversationManager] Message not recognized as confirmation, treating as new input`);
          // Clear pending confirmation if user says something else
          delete session.pendingConfirmation;
        }
      }

      // STEP 2: Run guardrails for non-confirmation messages
      console.log(`[EnhancedConversationManager] Running guardrails for session ${sessionId}`);
      
      const guardrailResult = await runGuardrails(message, session);
      if (!guardrailResult.allowed) {
        console.log(`[EnhancedConversationManager] Message blocked: ${guardrailResult.category} - ${guardrailResult.reason}`);
        
        // Add blocked message to history for context
        session.conversationHistory.push({
          role: 'user',
          content: message,
          timestamp: new Date()
        });

        session.conversationHistory.push({
          role: 'assistant',
          content: guardrailResult.reason || 'I can only help with restaurant reservations.',
          timestamp: new Date()
        });

        session.lastActivity = new Date();
        this.sessions.set(sessionId, session);

        return {
          response: guardrailResult.reason || 'I can only help with restaurant reservations.',
          hasBooking: false,
          session,
          blocked: true,
          blockReason: guardrailResult.category
        };
      }

      // STEP 3: Continue with normal processing
      const detectedLanguage = this.detectLanguage(message);
      if (detectedLanguage !== session.language) {
        session.language = detectedLanguage;
        console.log(`[EnhancedConversationManager] Language detected: ${detectedLanguage}`);
      }

      session.lastActivity = new Date();
      session.conversationHistory.push({
        role: 'user',
        content: message,
        timestamp: new Date()
      });

      // Get agent and prepare messages
      const agent = await this.getAgent(session.restaurantId);
      let systemPrompt = agent.systemPrompt;
      if (agent.updateInstructions) {
        systemPrompt = agent.updateInstructions(session.context, session.language);
      }

      const messages = [
        {
          role: 'system' as const,
          content: systemPrompt
        },
        ...session.conversationHistory.slice(-8).map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        }))
      ];

      // STEP 4: Initial completion with function calling
      let completion = await agent.client.chat.completions.create({
        model: "gpt-4o",
        messages: messages,
        tools: agent.tools,
        tool_choice: "auto",
        temperature: 0.7,
        max_tokens: 1000
      });

      let hasBooking = false;
      let reservationId: number | undefined;

      // STEP 5: Handle function calls
      if (completion.choices[0]?.message?.tool_calls) {
        console.log(`[EnhancedConversationManager] Processing ${completion.choices[0].message.tool_calls.length} function calls`);

        // Add assistant message with tool calls
        messages.push({
          role: 'assistant' as const,
          content: completion.choices[0].message.content || null,
          tool_calls: completion.choices[0].message.tool_calls
        });

        const functionContext = {
          restaurantId: session.restaurantId,
          timezone: agent.restaurantConfig?.timezone || 'Europe/Moscow',
          telegramUserId: session.telegramUserId,
          source: session.platform,
          sessionId: sessionId,
          language: session.language
        };

        // Process each function call
        for (const toolCall of completion.choices[0].message.tool_calls) {
          if (toolCall.function.name in agentFunctions) {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              
              // Check if high-risk action requires confirmation
              const confirmationCheck = requiresConfirmation(toolCall.function.name, args);
              if (confirmationCheck.required && !session.pendingConfirmation) {
                // Store pending action and ask for confirmation
                session.pendingConfirmation = {
                  toolCall,
                  functionContext,
                  summary: confirmationCheck.summary!
                };
                
                this.sessions.set(sessionId, session);
                
                const confirmationMessage = session.language === 'ru'
                  ? `Подтверждаете создание бронирования?\n\n${confirmationCheck.summary}\n\nОтветьте "да" для подтверждения или "нет" для отмены.`
                  : session.language === 'sr'
                  ? `Potvrđujete kreiranje rezervacije?\n\n${confirmationCheck.summary}\n\nOdgovorite "da" za potvrdu ili "ne" za otkazivanje.`
                  : `Please confirm this reservation:\n\n${confirmationCheck.summary}\n\nReply "yes" to confirm or "no" to cancel.`;
                
                // Add confirmation request to history
                session.conversationHistory.push({
                  role: 'assistant',
                  content: confirmationMessage,
                  timestamp: new Date()
                });

                return {
                  response: confirmationMessage,
                  hasBooking: false,
                  session
                };
              }

              // Execute function
              console.log(`[EnhancedConversationManager] Calling function: ${toolCall.function.name}`);
              
              let result;
              switch (toolCall.function.name) {
                case 'check_availability':
                  result = await agentFunctions.check_availability(
                    args.date, args.time, args.guests, functionContext
                  );
                  break;
                case 'find_alternative_times':
                  result = await agentFunctions.find_alternative_times(
                    args.date, args.preferredTime, args.guests, functionContext
                  );
                  break;
                case 'create_reservation':
                  result = await agentFunctions.create_reservation(
                    args.guestName, args.guestPhone, args.date, args.time, 
                    args.guests, args.specialRequests || '', functionContext
                  );
                  break;
                case 'get_restaurant_info':
                  result = await agentFunctions.get_restaurant_info(
                    args.infoType, functionContext
                  );
                  break;
                default:
                  console.warn(`[EnhancedConversationManager] Unknown function: ${toolCall.function.name}`);
                  result = { error: "Unknown function" };
              }
              
              console.log(`[EnhancedConversationManager] Function result:`, result);

              // Add function result to messages
              messages.push({
                role: 'tool' as const,
                content: JSON.stringify(result),
                tool_call_id: toolCall.id
              });

              // Check if booking was successfully created
              if (toolCall.function.name === 'create_reservation') {
                // Check correct response format with tool_status
                if (result.tool_status === 'SUCCESS' && result.data && result.data.success) {
                  hasBooking = true;
                  reservationId = result.data.reservationId;
                  session.hasActiveReservation = reservationId;
                  session.currentStep = 'completed';
                  
                  console.log(`[EnhancedConversationManager] Booking completed successfully! Reservation ID: ${reservationId}`);
                } else {
                  console.log(`[EnhancedConversationManager] Booking failed:`, {
                    tool_status: result.tool_status,
                    error: result.error,
                    data: result.data
                  });
                }
              }

              // Extract and store gathering info from function arguments  
              this.extractGatheringInfo(session, args);

            } catch (funcError) {
              console.error(`[EnhancedConversationManager] Function call error:`, funcError);
              
              messages.push({
                role: 'tool' as const,
                content: JSON.stringify({ 
                  tool_status: 'FAILURE',
                  error: {
                    type: 'SYSTEM_ERROR',
                    message: funcError instanceof Error ? funcError.message : 'Unknown error'
                  }
                }),
                tool_call_id: toolCall.id
              });
            }
          }
        }

        // STEP 6: Get final response incorporating function results
        console.log(`[EnhancedConversationManager] Getting final response with function results`);
        
        completion = await agent.client.chat.completions.create({
          model: "gpt-4o",
          messages: messages,
          temperature: 0.7,
          max_tokens: 1000
        });
      }

      // Extract final response
      const response = completion.choices[0]?.message?.content || 
        (session.language === 'ru' 
          ? "Извините, я не смогла понять. Попробуйте еще раз."
          : session.language === 'sr'
          ? "Izvините, nisam razumela. Molim pokušajte ponovo."
          : "I apologize, I didn't understand that. Could you please try again?");

      // Add response to conversation history
      session.conversationHistory.push({
        role: 'assistant',
        content: response,
        timestamp: new Date(),
        toolCalls: completion.choices[0]?.message?.tool_calls
      });

      // Update session
      this.sessions.set(sessionId, session);

      console.log(`[EnhancedConversationManager] Message handled. Booking: ${hasBooking}, Reservation: ${reservationId}`);

      return {
        response,
        hasBooking,
        reservationId,
        session
      };

    } catch (error) {
      console.error(`[EnhancedConversationManager] Error handling message:`, error);
      
      const fallbackResponse = session.context === 'hostess'
        ? (session.language === 'ru' ? "Произошла ошибка. Попробуйте еще раз." : 
           session.language === 'sr' ? "Dogodila se greška. Molim pokušajte ponovo." :
           "Error occurred. Please try again.")
        : (session.language === 'ru' ? 'Извините, возникла техническая проблема. Попробуйте еще раз.' : 
           session.language === 'sr' ? 'Izvините, nastao je tehnički problem. Molim pokušajte ponovo.' :
           'I apologize, I encountered a technical issue. Please try again.');

      session.conversationHistory.push({
        role: 'assistant',
        content: fallbackResponse,
        timestamp: new Date()
      });

      session.lastActivity = new Date();
      this.sessions.set(sessionId, session);

      return {
        response: fallbackResponse,
        hasBooking: false,
        session
      };
    }
  }

  /**
   * Handle confirmation responses for pending high-risk actions
   */
  async handleConfirmation(sessionId: string, confirmed: boolean): Promise<{
    response: string;
    hasBooking: boolean;
    reservationId?: number;
    session: BookingSessionWithConfirmation;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session?.pendingConfirmation) {
      throw new Error('No pending confirmation found');
    }

    try {
      if (confirmed) {
        // Execute the pending function call
        const { toolCall, functionContext } = session.pendingConfirmation;
        const args = JSON.parse(toolCall.function.arguments);
        
        console.log(`[EnhancedConversationManager] Executing confirmed action: ${toolCall.function.name}`);
        
        const result = await agentFunctions.create_reservation(
          args.guestName, args.guestPhone, args.date, args.time,
          args.guests, args.specialRequests || '', functionContext
        );

        // Clear pending confirmation
        delete session.pendingConfirmation;
        
        // Check success with new format
        if (result.tool_status === 'SUCCESS' && result.data && result.data.success) {
          session.hasActiveReservation = result.data.reservationId;
          session.currentStep = 'completed';
          
          const successMessage = session.language === 'ru'
            ? `🎉 Отлично! Ваше бронирование подтверждено. Номер брони: ${result.data.reservationId}`
            : session.language === 'sr'
            ? `🎉 Odlično! Vaša rezervacija je potvrđena. Broj rezervacije: ${result.data.reservationId}`
            : `🎉 Perfect! Your reservation is confirmed. Reservation number: ${result.data.reservationId}`;
          
          session.conversationHistory.push({
            role: 'assistant',
            content: successMessage,
            timestamp: new Date()
          });

          this.sessions.set(sessionId, session);

          return {
            response: successMessage,
            hasBooking: true,
            reservationId: result.data.reservationId,
            session
          };
        } else {
          const errorMessage = session.language === 'ru'
            ? `Извините, не удалось создать бронирование: ${result.error?.message || 'неизвестная ошибка'}`
            : session.language === 'sr'
            ? `Izvините, nije moguće kreirati rezervaciju: ${result.error?.message || 'nepoznata greška'}`
            : `Sorry, I couldn't create the reservation: ${result.error?.message || 'unknown error'}`;
          
          session.conversationHistory.push({
            role: 'assistant',
            content: errorMessage,
            timestamp: new Date()
          });

          this.sessions.set(sessionId, session);

          return {
            response: errorMessage,
            hasBooking: false,
            session
          };
        }
      } else {
        // User declined - clear pending confirmation
        delete session.pendingConfirmation;
        
        const cancelMessage = session.language === 'ru'
          ? "Хорошо, бронирование отменено. Чем еще могу помочь?"
          : session.language === 'sr'
          ? "U redu, rezervacija je otkazana. Čime još mogu da pomognem?"
          : "Okay, reservation cancelled. How else can I help you?";
        
        session.conversationHistory.push({
          role: 'assistant',
          content: cancelMessage,
          timestamp: new Date()
        });

        this.sessions.set(sessionId, session);

        return {
          response: cancelMessage,
          hasBooking: false,
          session
        };
      }
    } catch (error) {
      console.error(`[EnhancedConversationManager] Confirmation error:`, error);
      
      delete session.pendingConfirmation;
      const errorMessage = session.language === 'ru'
        ? "Произошла ошибка при обработке подтверждения."
        : session.language === 'sr'
        ? "Dogodila se greška prilikom obrade potvrde."
        : "An error occurred while processing the confirmation.";

      return {
        response: errorMessage,
        hasBooking: false,
        session
      };
    }
  }

  /**
   * Extract gathering info from function arguments
   */
  private extractGatheringInfo(session: BookingSessionWithConfirmation, args: any) {
    const updates: Partial<BookingSession['gatheringInfo']> = {};
    
    if (args.date) updates.date = args.date;
    if (args.time) updates.time = args.time;
    if (args.guests) updates.guests = args.guests;
    if (args.guestName) updates.name = args.guestName;
    if (args.guestPhone) updates.phone = args.guestPhone;
    if (args.specialRequests) updates.comments = args.specialRequests;
    
    if (Object.keys(updates).length > 0) {
      Object.assign(session.gatheringInfo, updates);
      console.log(`[EnhancedConversationManager] Updated session info:`, updates);
      
      // Log completeness status
      const isComplete = hasCompleteBookingInfo(session);
      console.log(`[EnhancedConversationManager] Booking info complete: ${isComplete}`, {
        hasDate: !!session.gatheringInfo.date,
        hasTime: !!session.gatheringInfo.time,
        hasGuests: !!session.gatheringInfo.guests,
        hasName: !!session.gatheringInfo.name,
        hasPhone: !!session.gatheringInfo.phone
      });
    }
  }

  /**
   * Enhanced language detection with Serbian support
   */
  private detectLanguage(message: string): Language {
    // Cyrillic = Russian or Serbian
    if (/[\u0400-\u04FF]/.test(message)) {
      // Check for Serbian-specific words in Cyrillic
      const serbianCyrillicWords = ['здраво', 'хвала', 'молим', 'добро', 'како'];
      const lowerText = message.toLowerCase();
      if (serbianCyrillicWords.some(word => lowerText.includes(word))) {
        return 'sr';
      }
      return 'ru'; // Default to Russian for Cyrillic
    }
    
    // Latin script - check for Serbian
    const serbianLatin = ['zdravo', 'hvala', 'molim', 'rezervacija'];
    if (serbianLatin.some(word => message.toLowerCase().includes(word))) {
      return 'sr';
    }
    
    return 'en'; // Default to English
  }

  /**
   * Get session information
   */
  getSession(sessionId: string): BookingSessionWithConfirmation | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Update session with new information
   */
  updateSession(sessionId: string, updates: Partial<BookingSession['gatheringInfo']>): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const updatedSession = updateSessionInfo(session, updates) as BookingSessionWithConfirmation;
    this.sessions.set(sessionId, updatedSession);
    return true;
  }

  /**
   * End session
   */
  endSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Clean up old sessions
   */
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
      console.log(`[EnhancedConversationManager] Cleaned up ${cleanedCount} old sessions`);
    }
  }

  /**
   * Enhanced session statistics
   */
  getStats(): {
    totalSessions: number;
    activeSessions: number;
    completedBookings: number;
    sessionsByPlatform: { web: number; telegram: number };
    sessionsByContext: { hostess: number; guest: number };
    languageDistribution: { en: number; ru: number; sr: number };
  } {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    let activeSessions = 0;
    let completedBookings = 0;
    let webSessions = 0;
    let telegramSessions = 0;
    let hostessSessions = 0;
    let guestSessions = 0;
    let enSessions = 0;
    let ruSessions = 0;
    let srSessions = 0;

    for (const session of this.sessions.values()) {
      if (session.lastActivity > oneHourAgo) activeSessions++;
      if (session.hasActiveReservation) completedBookings++;
      if (session.platform === 'web') webSessions++;
      else telegramSessions++;
      if (session.context === 'hostess') hostessSessions++;
      else guestSessions++;
      if (session.language === 'en') enSessions++;
      else if (session.language === 'ru') ruSessions++;
      else if (session.language === 'sr') srSessions++;
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions,
      completedBookings,
      sessionsByPlatform: { web: webSessions, telegram: telegramSessions },
      sessionsByContext: { hostess: hostessSessions, guest: guestSessions },
      languageDistribution: { en: enSessions, ru: ruSessions, sr: srSessions }
    };
  }

  /**
   * Graceful shutdown
   */
  shutdown(): void {
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
    }
    console.log('[EnhancedConversationManager] Shutdown completed');
  }
}

// Extended session interface with confirmation support
interface BookingSessionWithConfirmation extends BookingSession {
  pendingConfirmation?: {
    toolCall: any;
    functionContext: any;
    summary: string;
  };
}

// Global instance
export const enhancedConversationManager = new EnhancedConversationManager();

// Graceful shutdown handling
process.on('SIGINT', () => {
  enhancedConversationManager.shutdown();
});

process.on('SIGTERM', () => {
  enhancedConversationManager.shutdown();
});

export default enhancedConversationManager;