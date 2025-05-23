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

interface ConversationContext {
  messageHistory: string[];
  partialIntent: any;
  lastAskedFor: string | null;
  userFrustrationLevel: number;
  repetitionCount: number;
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

    // Handle frustration IMMEDIATELY - this is the most important fix
    if (guest_sentiment === 'frustrated' || conversation_action === 'acknowledge_frustration') {
      return this.generateApologyResponse(collectedInfo, newMessage, guestFrustrationLevel);
    }

    // Check if we have enough info to proceed with booking
    const hasAllInfo = this.hasCompleteBookingInfo(collectedInfo);

    if (hasAllInfo && conversation_action !== 'show_alternatives') {
      return this.generateBookingConfirmation(collectedInfo);
    }

    // Natural conversation flow based on what we need
    switch (conversation_action) {
      case 'collect_info':
        return this.generateSmartInfoRequest(collectedInfo, responsesSent, newMessage);

      case 'ready_to_book':
        return this.generateBookingConfirmation(collectedInfo);

      case 'show_alternatives':
        return this.generateAlternativeRequest(collectedInfo);

      case 'general_inquiry':
        return this.generateFriendlyResponse(collectedInfo, newMessage);

      default:
        return this.generateContextualResponse(collectedInfo, newMessage, responsesSent);
    }
  }

  /**
   * Check if we have all required booking information
   */
  private static hasCompleteBookingInfo(info: any): boolean {
    const required = ['date', 'time', 'guests', 'name', 'phone'];
    return required.every(field => info[field] !== null && info[field] !== undefined && info[field] !== '');
  }

  /**
   * Apologetic response when guest is frustrated
   */
  private static generateApologyResponse(info: any, message: string, frustrationLevel: number): string {
    const apologies = [
      "I sincerely apologize for the confusion! You're absolutely right.",
      "Sorry about that - I should have been paying better attention to what you said.",
      "You're completely right, and I apologize for asking again.",
      "I'm sorry for the confusion - let me work with the information you've provided.",
      "My apologies! I should have remembered what you told me."
    ];

    // Choose apology based on frustration level
    const apologyIndex = Math.min(frustrationLevel, apologies.length - 1);
    const apology = apologies[apologyIndex] || apologies[0];

    // Create a summary of what we understand
    const summary = this.createBookingSummary(info);

    if (summary) {
      // We have information - acknowledge it and move forward
      const hasAllInfo = this.hasCompleteBookingInfo(info);

      if (hasAllInfo) {
        return `${apology}\n\nI have all your details: ${summary}.\n\nLet me check availability and confirm your reservation right away! 🙏✨`;
      } else {
        const missing = this.getMissingFields(info);
        const missingText = this.formatMissingFields(missing);
        return `${apology}\n\nI have: ${summary}.\n\nI just need ${missingText} to complete your reservation! 🙏`;
      }
    } else {
      // We don't have much info - be gentle and start over
      return `${apology}\n\nLet me help you properly now. Could you please share your reservation details - date, time, party size, and name? I'll pay close attention this time! 😊🙏`;
    }
  }

  /**
   * Smart information collection that doesn't repeat questions
   */
  private static generateSmartInfoRequest(info: any, responseCount: number, lastMessage: string): string {
    const missing = this.getMissingFields(info);
    const collected = this.createBookingSummary(info);

    // If no missing fields, we're ready to book
    if (missing.length === 0) {
      return this.generateBookingConfirmation(info);
    }

    // First interaction - warm and welcoming
    if (responseCount <= 1) {
      if (collected) {
        return `Perfect! I have ${collected}.\n\nI just need ${this.formatMissingFields(missing)} to complete your reservation! ✨`;
      } else {
        return "I'd love to help you with a reservation! What details can you share - date, time, party size, and your name? 😊";
      }
    }

    // Second interaction - acknowledge progress and be specific
    if (responseCount === 2) {
      if (collected) {
        return `Great! I have ${collected}.\n\n${this.createSpecificRequest(missing)} 🎯`;
      } else {
        return "Wonderful! What information can you provide for your booking?";
      }
    }

    // Third+ interaction - be more direct but still friendly
    if (collected) {
      return `Excellent! I have ${collected}.\n\n${this.createUrgentRequest(missing)} 🎯`;
    }

    // Fallback - simple and direct
    return `Almost there! I need ${this.formatMissingFields(missing)} to secure your table.`;
  }

  /**
   * Create a natural booking summary from collected info
   */
  private static createBookingSummary(info: any): string {
    const parts = [];

    // Add name first if available
    if (info.name) parts.push(info.name);

    // Add party size
    if (info.guests) {
      const guestText = info.guests === 1 ? 'person' : 'people';
      parts.push(`${info.guests} ${guestText}`);
    }

    // Add date in natural language using Moscow timezone
    if (info.date) {
      const dateObj = new Date(info.date);
      // Use Moscow timezone for accurate date comparison
      const getMoscowDate = () => {
        const now = new Date();
        return new Date(now.toLocaleString("en-US", {timeZone: "Europe/Moscow"}));
      };
      
      const moscowToday = getMoscowDate();
      const today = moscowToday.toISOString().split('T')[0];
      const tomorrow = new Date(moscowToday);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowDate = tomorrow.toISOString().split('T')[0];

      if (info.date === today) {
        parts.push('today');
      } else if (info.date === tomorrowDate) {
        parts.push('tomorrow');
      } else {
        const options: Intl.DateTimeFormatOptions = { 
          weekday: 'long', 
          month: 'long', 
          day: 'numeric' 
        };
        parts.push(`on ${dateObj.toLocaleDateString('en-US', options)}`);
      }
    }

    // Add time in natural language
    if (info.time) {
      parts.push(`at ${this.formatTimeNaturally(info.time)}`);
    }

    // Add phone if available (usually last)
    if (info.phone) {
      parts.push(`(📞 ${this.formatPhoneNumber(info.phone)})`);
    }

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
   * Format missing fields in natural language
   */
  private static formatMissingFields(missing: string[]): string {
    if (missing.length === 0) return '';
    if (missing.length === 1) return `your ${missing[0]}`;
    if (missing.length === 2) return `your ${missing[0]} and ${missing[1]}`;

    const last = missing.pop();
    return `your ${missing.join(', ')}, and ${last}`;
  }

  /**
   * Create specific request for missing information
   */
  private static createSpecificRequest(missing: string[]): string {
    if (missing.length === 1) {
      switch (missing[0]) {
        case 'phone number':
          return "What's the best phone number to reach you at?";
        case 'name':
          return "What name should I put the reservation under?";
        case 'date':
          return "What date would you like to visit us?";
        case 'time':
          return "What time works best for you?";
        case 'party size':
          return "How many people will be joining you?";
        default:
          return `I just need your ${missing[0]}!`;
      }
    }

    return `I need ${this.formatMissingFields(missing)} to complete your booking.`;
  }

  /**
   * Create urgent but friendly request for missing info
   */
  private static createUrgentRequest(missing: string[]): string {
    if (missing.length === 1) {
      switch (missing[0]) {
        case 'phone number':
          return "Last thing - your phone number and we're all set!";
        case 'name':
          return "Just need a name for the reservation!";
        case 'date':
          return "Which date would you prefer?";
        case 'time':
          return "What time should I book for you?";
        case 'party size':
          return "How many guests total?";
        default:
          return `Just need your ${missing[0]} and we're done!`;
      }
    }

    return `Final details needed: ${this.formatMissingFields(missing)} and we're all set!`;
  }

  /**
   * Booking confirmation message
   */
  private static generateBookingConfirmation(info: any): string {
    const summary = this.createBookingSummary(info);
    return `Perfect! I have everything: ${summary}.\n\nLet me check availability and confirm your reservation right away! 🎉`;
  }

  /**
   * Alternative suggestions request
   */
  private static generateAlternativeRequest(info: any): string {
    const summary = this.createBookingSummary(info);
    return `I understand you'd like ${summary}.\n\nLet me find some excellent alternative times for you! 🔍`;
  }

  /**
   * General friendly response for non-booking inquiries
   */
  private static generateFriendlyResponse(info: any, message: string): string {
    const lowerMessage = message.toLowerCase();

    // Greeting responses
    if (lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('hey')) {
      return "Hello! Welcome! I'm here to help you make a reservation. What would you like to book? 😊";
    }

    // Help requests
    if (lowerMessage.includes('help') || lowerMessage.includes('info')) {
      return "I'd be happy to help you with a reservation! Just let me know your preferred date, time, party size, and name. What can I assist you with?";
    }

    // Menu/food questions
    if (lowerMessage.includes('menu') || lowerMessage.includes('food') || lowerMessage.includes('cuisine')) {
      return "I'd love to tell you about our menu! For detailed information about our dishes, I recommend speaking with our staff. Would you like to make a reservation so you can experience our cuisine? 🍽️";
    }

    // Hours/location questions
    if (lowerMessage.includes('hours') || lowerMessage.includes('open') || lowerMessage.includes('location') || lowerMessage.includes('address')) {
      return "For our current hours and location details, please check with our staff directly. I can help you make a reservation though! What date and time work for you? 📍";
    }

    // Default friendly response
    return "I'd love to help you with a reservation! What details can you share with me - date, time, and party size? 😊";
  }

  /**
   * Generate contextual response based on conversation flow
   */
  private static generateContextualResponse(info: any, message: string, responseCount: number): string {
    // If we have some information, acknowledge it
    const collected = this.createBookingSummary(info);

    if (collected) {
      const missing = this.getMissingFields(info);
      if (missing.length === 0) {
        return this.generateBookingConfirmation(info);
      } else {
        return `Thank you! I have ${collected}. I just need ${this.formatMissingFields(missing)} to complete your reservation! ✨`;
      }
    }

    // No information yet - encourage them to share details
    return "I'd be happy to help you with a reservation! What information can you share with me? 😊";
  }

  /**
   * Format time 24-hour to 12-hour with AM/PM
   */
  private static formatTimeNaturally(time: string): string {
    if (!time) return '';

    // Handle different time formats
    let hours: number, minutes: string;

    if (time.includes(':')) {
      const [h, m] = time.split(':');
      hours = parseInt(h);
      minutes = m || '00';
    } else {
      hours = parseInt(time);
      minutes = '00';
    }

    // Handle invalid hours
    if (isNaN(hours) || hours < 0 || hours > 23) {
      return time; // Return original if invalid
    }

    if (hours === 0) return `12:${minutes} AM`;
    if (hours < 12) return `${hours}:${minutes} AM`;
    if (hours === 12) return `12:${minutes} PM`;
    return `${hours - 12}:${minutes} PM`;
  }

  /**
   * Format phone number for display
   */
  private static formatPhoneNumber(phone: string): string {
    if (!phone) return '';

    // Remove all non-digits
    const cleaned = phone.replace(/\D/g, '');

    // Format US phone numbers
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }

    // Return cleaned version for other formats
    return cleaned;
  }

  /**
   * Detect if user is providing information vs asking questions
   */
  private static isProvidingInfo(message: string): boolean {
    const infoPatterns = [
      /\d{1,2}[:\s]?\d{0,2}\s*(am|pm|AM|PM)?/, // Time patterns
      /\d{3,4}[-.\s]?\d{3}[-.\s]?\d{4}/, // Phone patterns  
      /(today|tomorrow|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})/, // Date patterns
      /\b\d+\s*(people|person|guests?)\b/, // Party size patterns
      /my name is|I'm|call me|for\s+\w+/i // Name patterns
    ];

    return infoPatterns.some(pattern => pattern.test(message));
  }

  /**
   * Generate context-aware response based on conversation history
   */
  static generateContextAwareResponse(
    message: string,
    conversationHistory: string[],
    collectedInfo: any,
    frustrationLevel: number = 0
  ): string {
    const recentMessages = conversationHistory.slice(-3).join(' ').toLowerCase();

    // Check for repetitive patterns or frustration
    const frustratedPhrases = ['told you', 'already said', 'just said', 'mentioned'];
    const isRepeating = frustratedPhrases.some(phrase => message.toLowerCase().includes(phrase));

    if (isRepeating || frustrationLevel > 0) {
      return this.generateApologyResponse(collectedInfo, message, frustrationLevel);
    }

    // Check if they're providing new information
    if (this.isProvidingInfo(message)) {
      const summary = this.createBookingSummary(collectedInfo);
      const missing = this.getMissingFields(collectedInfo);

      if (missing.length === 0) {
        return `Excellent! I have everything: ${summary}. Let me confirm your reservation right away! 🎉`;
      } else {
        return `Great! I have ${summary}. Just need ${this.formatMissingFields(missing)} to complete your booking! ✨`;
      }
    }

    return this.generateFriendlyResponse(collectedInfo, message);
  }

  /**
   * Advanced conversation analysis
   */
  static analyzeConversationPattern(
    conversationHistory: string[],
    collectedInfo: any
  ): {
    isStuck: boolean;
    isRepeating: boolean;
    recommendedAction: string;
    confidence: number;
  } {
    // Analyze if conversation is stuck in a loop
    const recentMessages = conversationHistory.slice(-4);
    const hasRepeatedRequests = recentMessages.some(msg => 
      msg.toLowerCase().includes('need') && 
      (msg.includes('name') || msg.includes('phone') || msg.includes('date'))
    );

    // Check if user is repeating information
    const lastUserMessage = conversationHistory[conversationHistory.length - 1] || '';
    const frustratedPhrases = ['told you', 'already said', 'just said'];
    const isRepeating = frustratedPhrases.some(phrase => 
      lastUserMessage.toLowerCase().includes(phrase)
    );

    // Determine if conversation is stuck
    const isStuck = hasRepeatedRequests && conversationHistory.length > 6;

    let recommendedAction = 'continue_normal_flow';
    if (isRepeating) {
      recommendedAction = 'apologize_and_summarize';
    } else if (isStuck) {
      recommendedAction = 'reset_and_restart';
    }

    return {
      isStuck,
      isRepeating,
      recommendedAction,
      confidence: 0.8
    };
  }

  /**
   * Emergency conversation reset when things go wrong
   */
  static generateResetResponse(collectedInfo: any): string {
    const summary = this.createBookingSummary(collectedInfo);

    if (summary) {
      return `Let me start fresh and work with what I understand: ${summary}.\n\nWhat additional information do you need to provide for your reservation? 🔄`;
    } else {
      return `Let me start over to help you better. Could you please tell me:\n- What date you'd like to visit\n- What time you prefer\n- How many people\n- Your name\n\nI'll make sure to get it right this time! 🔄😊`;
    }
  }
}