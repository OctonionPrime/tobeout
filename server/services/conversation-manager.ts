/**
 * Human-Like Conversation Manager for Restaurant AI Assistant
 * 
 * This creates natural, flowing conversations that remember context
 * and respond like a real professional hostess would.
 */

interface ConversationFlow {
  stage: 'greeting' | 'collecting' | 'confirming' | 'suggesting_alternatives' | 'completed';
  collectedInfo: {
    date?: string;
    time?: string;
    guests?: number;
    name?: string;
    phone?: string;
    special_requests?: string;
  };
  conversationHistory: string[];
  lastResponse: string;
  guestFrustrationLevel: number;
  responsesSent: number;
}

export class ConversationManager {
  
  /**
   * Generate human-like responses based on conversation context
   */
  static generateHumanResponse(
    aiResult: any, 
    conversationFlow: ConversationFlow, 
    newMessage: string
  ): string {
    
    const { conversation_action, guest_sentiment, next_response_tone } = aiResult;
    const { collectedInfo, guestFrustrationLevel, responsesSent } = conversationFlow;
    
    // Handle frustration immediately
    if (guest_sentiment === 'frustrated' || conversation_action === 'acknowledge_frustration') {
      return this.generateApologyResponse(collectedInfo, newMessage);
    }
    
    // Natural conversation flow based on what we have
    switch (conversation_action) {
      case 'ready_to_book':
        return this.generateBookingConfirmation(collectedInfo);
        
      case 'collect_info':
        return this.generateNaturalInfoRequest(collectedInfo, responsesSent);
        
      case 'show_alternatives':
        return this.generateAlternativeRequest(collectedInfo);
        
      default:
        return this.generateFriendlyResponse(collectedInfo, newMessage);
    }
  }
  
  /**
   * Apologetic response when guest is frustrated
   */
  private static generateApologyResponse(info: any, message: string): string {
    const responses = [
      "I apologize for the confusion! Let me work with what you've told me.",
      "Sorry about that - I should have been clearer. Let me help you properly.",
      "You're absolutely right, I apologize. Let me get this sorted for you right away."
    ];
    
    const apology = responses[Math.floor(Math.random() * responses.length)];
    
    // Show what we have to build confidence
    const collected = this.formatCollectedInfo(info);
    if (collected) {
      return `${apology}\n\n${collected}\n\nLet me complete your reservation now! 🙏`;
    }
    
    return `${apology} What details can you share with me for your reservation? 😊`;
  }
  
  /**
   * Natural information collection without repetition
   */
  private static generateNaturalInfoRequest(info: any, responseCount: number): string {
    const collected = this.formatCollectedInfo(info);
    const missing = this.getMissingFields(info);
    
    // Different approaches based on conversation length
    if (responseCount === 0) {
      // First response - warm greeting
      if (collected) {
        return `Perfect! ${collected}.\n\nI just need ${this.formatMissingNaturally(missing)} to secure your table. 😊`;
      }
      return "I'd be happy to help you with a reservation! What details can you share with me?";
    }
    
    if (responseCount === 1) {
      // Second response - acknowledge what they shared
      if (collected) {
        return `Great! ${collected}.\n\nJust need ${this.formatMissingNaturally(missing)} and we're all set! ✨`;
      }
      return "Wonderful! What information can you provide for your booking?";
    }
    
    // Third+ response - be more direct but still friendly
    if (collected) {
      return `Perfect! ${collected}.\n\nLast thing I need: ${this.formatMissingNaturally(missing)} 🎯`;
    }
    
    return `Almost there! I need ${this.formatMissingNaturally(missing)} to complete your reservation.`;
  }
  
  /**
   * Booking confirmation message
   */
  private static generateBookingConfirmation(info: any): string {
    const formatted = this.formatCollectedInfo(info);
    return `Excellent! ${formatted}.\n\nLet me check availability and confirm your reservation right away! 🎉`;
  }
  
  /**
   * Alternative suggestions request
   */
  private static generateAlternativeRequest(info: any): string {
    const formatted = this.formatCollectedInfo(info);
    return `I understand you'd like ${formatted}.\n\nLet me check what alternative times I can offer you! 🔍`;
  }
  
  /**
   * General friendly response
   */
  private static generateFriendlyResponse(info: any, message: string): string {
    if (message.toLowerCase().includes('hello') || message.toLowerCase().includes('hi')) {
      return "Hello! Welcome to our restaurant. I'm here to help you with reservations. What would you like to book? 😊";
    }
    
    return "I'd be happy to help you with a reservation! What can I assist you with today?";
  }
  
  /**
   * Format collected information in natural language
   */
  private static formatCollectedInfo(info: any): string {
    const parts = [];
    
    if (info.name) parts.push(`for ${info.name}`);
    if (info.guests) parts.push(`${info.guests} ${info.guests === 1 ? 'person' : 'people'}`);
    if (info.date) {
      const dateObj = new Date(info.date);
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      
      if (info.date === today.toISOString().split('T')[0]) {
        parts.push('today');
      } else if (info.date === tomorrow.toISOString().split('T')[0]) {
        parts.push('tomorrow');
      } else {
        parts.push(`on ${dateObj.toLocaleDateString()}`);
      }
    }
    if (info.time) {
      const timeFormatted = this.formatTime(info.time);
      parts.push(`at ${timeFormatted}`);
    }
    if (info.phone) parts.push(`📞 ${info.phone}`);
    
    return parts.length > 0 ? parts.join(' ') : '';
  }
  
  /**
   * Get missing required fields
   */
  private static getMissingFields(info: any): string[] {
    const missing = [];
    if (!info.date) missing.push('date');
    if (!info.time) missing.push('time');
    if (!info.guests) missing.push('party size');
    if (!info.name) missing.push('name');
    if (!info.phone) missing.push('phone number');
    return missing;
  }
  
  /**
   * Format missing fields naturally
   */
  private static formatMissingNaturally(missing: string[]): string {
    if (missing.length === 0) return '';
    if (missing.length === 1) return `your ${missing[0]}`;
    if (missing.length === 2) return `your ${missing[0]} and ${missing[1]}`;
    
    const last = missing.pop();
    return `your ${missing.join(', ')}, and ${last}`;
  }
  
  /**
   * Format time in human-readable way
   */
  private static formatTime(time: string): string {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const min = minutes || '00';
    
    if (hour === 0) return `12:${min} AM`;
    if (hour < 12) return `${hour}:${min} AM`;
    if (hour === 12) return `12:${min} PM`;
    return `${hour - 12}:${min} PM`;
  }
}