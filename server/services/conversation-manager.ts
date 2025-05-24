/**
 * conversation-manager.ts
 *
 * Manages individual restaurant AI assistant conversations.
 * Each conversation is an instance of ActiveConversation.
 */

// Assuming AvailabilitySlot is defined in availability.service.ts and imported where needed
// For this file, if DefaultResponseFormatter needs it, it should be imported.
// Let's assume it's available or we define a local version for clarity if not directly imported.
import type { AvailabilitySlot } from './availability.service'; // Adjust path if necessary

// --- Interface Definitions ---

export interface ConversationFlow {
  stage: 'greeting' | 'collecting' | 'confirming' | 'suggesting_alternatives' | 'completed' | 'frustrated_recovery';
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
  // restaurantId?: number; // Consider adding if formatter or AI needs it directly from flow
}

export interface AIAnalysisResult {
  conversation_action: 'collect_info' | 'ready_to_book' | 'show_alternatives' | 'general_inquiry' | 'acknowledge_frustration' | 'unknown_intent' | string;
  guest_sentiment: 'positive' | 'neutral' | 'frustrated' | string;
  next_response_tone?: 'friendly' | 'empathetic' | 'direct' | string;
  entities?: {
    date?: string;
    time?: string;
    guests?: number;
    name?: string;
    phone?: string;
    special_requests?: string;
  };
  confidence?: number;
}

export interface AIService {
  analyzeMessage(message: string, currentFlow: ConversationFlow): Promise<AIAnalysisResult>;
  // Potentially other methods if AI is used for more than just analysis,
  // e.g., generateComplexNarrative(prompt: string): Promise<string>;
}

export interface ResponseFormatter {
  generateApology(flow: ConversationFlow, summary: string, missingFieldsText: string): string;
  generateSmartInfoRequest(flow: ConversationFlow, summary: string, missingFieldsText: string, specificRequest: string, urgentRequest: string): string;
  generateBookingConfirmation(flow: ConversationFlow, summary: string): string;
  generateAlternativeRequest(flow: ConversationFlow, summary: string): string; // Initial prompt to look for alternatives
  generateFriendlyResponse(flow: ConversationFlow, message: string, aiResult: AIAnalysisResult): string;
  generateContextualResponse(flow: ConversationFlow, summary: string, missingFieldsText: string): string;
  generateResetResponse(flow: ConversationFlow, summary: string): string;
  generateSmartAlternativeMessageText( // Added this method
    guestName: string | undefined,
    requestedTime: string, // Original requested time
    guests: number,
    availableSlots: AvailabilitySlot[] // Data from availability.service
  ): string;

  createBookingSummary(collectedInfo: ConversationFlow['collectedInfo']): string;
  getMissingFields(collectedInfo: ConversationFlow['collectedInfo']): string[];
  formatMissingFieldsText(missingFields: string[]): string;
  createSpecificRequestText(missingFields: string[]): string;
  createUrgentRequestText(missingFields: string[]): string;
}

// --- Main Conversation Management Class ---

export class ActiveConversation {
  private flow: ConversationFlow;
  private aiService: AIService;
  private responseFormatter: ResponseFormatter;

  constructor(
    aiService: AIService,
    responseFormatter: ResponseFormatter,
    initialHistory: string[] = [],
    existingFlow?: Partial<ConversationFlow>
  ) {
    this.aiService = aiService;
    this.responseFormatter = responseFormatter;

    this.flow = {
      stage: 'greeting',
      collectedInfo: {},
      conversationHistory: [...initialHistory],
      lastResponse: '',
      guestFrustrationLevel: 0,
      responsesSent: 0,
      ...existingFlow,
    };
  }

  public getConversationFlow(): Readonly<ConversationFlow> {
    return { ...this.flow };
  }

  private updateCollectedInfo(entities: AIAnalysisResult['entities']): void {
    if (!entities) return;
    // More robustly update, only if new data is actually present and different
    const updateField = (field: keyof ConversationFlow['collectedInfo'], value?: string | number) => {
        if (value !== undefined && value !== null && String(value).toUpperCase() !== 'NOT_SPECIFIED' && String(value).toUpperCase() !== 'NONE') {
            if (this.flow.collectedInfo[field] !== value) {
                 console.log(`[ActiveConversation] Updating ${field}: ${this.flow.collectedInfo[field]} -> ${value}`);
                (this.flow.collectedInfo[field] as any) = value;
            }
        }
    };
    updateField('date', entities.date);
    updateField('time', entities.time);
    updateField('guests', entities.guests);
    updateField('name', entities.name);
    updateField('phone', entities.phone);
    updateField('special_requests', entities.special_requests);
  }

  private hasCompleteBookingInfo(): boolean {
    const { date, time, guests, name, phone } = this.flow.collectedInfo;
    return !!(date && time && guests && name && phone);
  }

  public async handleMessage(newMessage: string): Promise<string> {
    if (this.flow.conversationHistory[this.flow.conversationHistory.length -1] !== newMessage) {
        this.flow.conversationHistory.push(newMessage);
    }
    this.flow.responsesSent++;

    const aiResult = await this.aiService.analyzeMessage(newMessage, this.flow);

    this.updateCollectedInfo(aiResult.entities);

    if (aiResult.guest_sentiment === 'frustrated' || aiResult.conversation_action === 'acknowledge_frustration') {
      this.flow.guestFrustrationLevel = Math.min(5, (this.flow.guestFrustrationLevel || 0) + 1);
      this.flow.stage = 'frustrated_recovery';
    } else if (this.flow.guestFrustrationLevel > 0 && aiResult.guest_sentiment !== 'frustrated') {
        this.flow.guestFrustrationLevel = Math.max(0, this.flow.guestFrustrationLevel -1 );
    }

    let responseText = "";
    const summary = this.responseFormatter.createBookingSummary(this.flow.collectedInfo);
    const missingFields = this.responseFormatter.getMissingFields(this.flow.collectedInfo);
    const missingFieldsText = this.responseFormatter.formatMissingFieldsText(missingFields);

    // Primary state determination
    if (this.flow.stage === 'frustrated_recovery') {
      responseText = this.responseFormatter.generateApology(this.flow, summary, missingFieldsText);
      if (this.hasCompleteBookingInfo()) {
        this.flow.stage = 'confirming';
      } else {
        this.flow.stage = 'collecting';
      }
      if (aiResult.guest_sentiment !== 'frustrated') this.flow.guestFrustrationLevel = 0;
    } else if (this.hasCompleteBookingInfo() && aiResult.conversation_action !== 'show_alternatives') {
      this.flow.stage = 'confirming';
      responseText = this.responseFormatter.generateBookingConfirmation(this.flow, summary);
    } else {
      // Check if this is a greeting/start message
      if (this.flow.responsesSent === 1 && (newMessage === '/start' || newMessage.toLowerCase().includes('hello') || newMessage.toLowerCase().includes('hi'))) {
        this.flow.stage = 'greeting';
        responseText = "🌟 Hello! Welcome to Demo Restaurant! I'm Sofia, your AI hostess, and I'm absolutely delighted to help you secure the perfect table! ✨\n\nI can assist you with making a reservation right now. Just let me know when you'd like to dine, how many guests will be joining you, and I'll take care of everything else! 🥂\n\nWhat sounds good to you?";
      } else {
        // Default to collecting if not confirming or in frustration recovery
        this.flow.stage = 'collecting';
        switch (aiResult.conversation_action) {
          case 'collect_info':
            const specificRequest = this.responseFormatter.createSpecificRequestText(missingFields);
            const urgentRequest = this.responseFormatter.createUrgentRequestText(missingFields);
            responseText = this.responseFormatter.generateSmartInfoRequest(this.flow, summary, missingFieldsText, specificRequest, urgentRequest);
            break;
          case 'ready_to_book':
            this.flow.stage = 'confirming'; // Should have been caught by hasCompleteBookingInfo
            responseText = this.responseFormatter.generateBookingConfirmation(this.flow, summary);
            break;
          case 'show_alternatives':
            this.flow.stage = 'suggesting_alternatives'; // Set stage
            // The actual fetching of alternatives happens in telegram.ts,
            // then it calls formatter.generateSmartAlternativeMessageText
            // This response is just to acknowledge the intent to show alternatives.
            responseText = this.responseFormatter.generateAlternativeRequest(this.flow, summary);
            break;
          case 'general_inquiry':
            responseText = this.responseFormatter.generateFriendlyResponse(this.flow, newMessage, aiResult);
            break;
          case 'reset_and_restart':
            responseText = this.responseFormatter.generateResetResponse(this.flow, summary);
            this.flow.collectedInfo = {};
            this.flow.guestFrustrationLevel = 0;
            this.flow.stage = 'greeting';
            break;
          default:
            responseText = this.responseFormatter.generateContextualResponse(this.flow, summary, missingFieldsText);
            break;
        }
      }
    }

    this.flow.lastResponse = responseText;
    return responseText;
  }
}

// --- Default ResponseFormatter Implementation ---
export class DefaultResponseFormatter implements ResponseFormatter {
  // Moscow Timezone utilities
  private getMoscowDateContext() {
    const now = new Date();
    const moscowTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
    const year = moscowTime.getFullYear();
    const month = (moscowTime.getMonth() + 1).toString().padStart(2, '0');
    const day = moscowTime.getDate().toString().padStart(2, '0');
    const todayString = `${year}-${month}-${day}`;
    const tomorrowMoscow = new Date(moscowTime);
    tomorrowMoscow.setDate(moscowTime.getDate() + 1);
    const tomorrowYear = tomorrowMoscow.getFullYear();
    const tomorrowMonth = (tomorrowMoscow.getMonth() + 1).toString().padStart(2, '0');
    const tomorrowDay = tomorrowMoscow.getDate().toString().padStart(2, '0');
    const tomorrowString = `${tomorrowYear}-${tomorrowMonth}-${tomorrowDay}`;
    return { today: todayString, tomorrow: tomorrowString };
  }

  private formatTimeForDisplay(time24?: string): string {
    if (!time24) return '';
    const parts = time24.split(':');
    const hour = parseInt(parts[0], 10);
    const min = parts[1]?.padStart(2, '0') || '00';

    if (isNaN(hour)) return time24; // Return original if hour is not a number

    if (hour === 0) return `12:${min} AM`;
    if (hour < 12) return `${hour}:${min} AM`;
    if (hour === 12) return `12:${min} PM`;
    return `${hour - 12}:${min} PM`;
  }

  private formatPhoneNumber(phone?: string): string {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11 && (cleaned.startsWith('7') || cleaned.startsWith('8'))) { // Common for Russia
      return `+7 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7, 9)}-${cleaned.slice(9)}`;
    } else if (cleaned.length === 10 && !cleaned.startsWith('7') && !cleaned.startsWith('8')) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return cleaned;
  }

  createBookingSummary(info: ConversationFlow['collectedInfo']): string {
    const parts = [];
    if (info.name) parts.push(info.name);
    if (info.guests) parts.push(`${info.guests} ${info.guests === 1 ? 'person' : 'people'}`);
    if (info.date) {
      const moscowDates = this.getMoscowDateContext();
      if (info.date === moscowDates.today) parts.push('today');
      else if (info.date === moscowDates.tomorrow) parts.push('tomorrow');
      else {
        try {
            const dateObj = new Date(info.date + 'T00:00:00Z'); // Treat as UTC then format for Moscow
            const options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Europe/Moscow' };
            parts.push(`on ${dateObj.toLocaleDateString('en-US', options)}`);
        } catch (e) {
            parts.push(`on ${info.date}`);
        }
      }
    }
    if (info.time) parts.push(`at ${this.formatTimeForDisplay(info.time)}`);
    if (info.phone) parts.push(`(📞 ${this.formatPhoneNumber(info.phone)})`);
    if (info.special_requests) parts.push(`with special requests: "${info.special_requests}"`);
    return parts.length > 0 ? parts.join(', ') : ''; // Use comma for better readability
  }

  getMissingFields(info: ConversationFlow['collectedInfo']): string[] {
    const missing: string[] = [];
    if (!info.date) missing.push('date');
    if (!info.time) missing.push('time');
    if (!info.guests) missing.push('party size');
    if (!info.name) missing.push('name');
    if (!info.phone) missing.push('phone number');
    return missing;
  }

  formatMissingFieldsText(missing: string[]): string {
    if (missing.length === 0) return '';
    if (missing.length === 1) return `your ${missing[0]}`;
    const last = missing.pop()!;
    return `your ${missing.join(', ')}, and ${last}`;
  }

  createSpecificRequestText(missing: string[]): string {
    if (missing.length === 1) {
      switch (missing[0]) {
        case 'phone number': return "What's the best phone number to reach you at?";
        case 'name': return "What name should I put the reservation under?";
        case 'date': return "What date would you like to visit us?";
        case 'time': return "What time works best for you?";
        case 'party size': return "How many people will be joining you?";
        default: return `I just need your ${missing[0]}!`;
      }
    }
    return `I need ${this.formatMissingFieldsText(missing)} to complete your booking.`;
  }

  createUrgentRequestText(missing: string[]): string {
    if (missing.length === 1) {
        switch (missing[0]) {
            case 'phone number': return "Last thing - your phone number and we're all set!";
            case 'name': return "Just need a name for the reservation!";
            case 'date': return "Which date would you prefer?";
            case 'time': return "What time should I book for you?";
            case 'party size': return "How many guests total?";
            default: return `Just need your ${missing[0]} and we're done!`;
        }
    }
    return `Final details needed: ${this.formatMissingFieldsText(missing)} and we're all set!`;
  }

  generateApology(flow: ConversationFlow, summary: string, missingFieldsText: string): string {
    const apologies = [
      "I sincerely apologize for the confusion! You're absolutely right.",
      "My apologies for that oversight. I should have remembered that.",
      "You're right, and I'm sorry for asking again. Let's proceed with what you've told me.",
      "I'm sorry for the mix-up. I'll use the information you've already provided.",
      "My mistake! I'll make sure to keep track of that. Thanks for your patience."
    ];
    const apologyIndex = Math.min(flow.guestFrustrationLevel || 0, apologies.length - 1);
    const apology = apologies[apologyIndex];

    if (summary) {
      const hasAllInfo = this.getMissingFields(flow.collectedInfo).length === 0;
      if (hasAllInfo) {
        return `${apology}\n\nI confirm I have all your details: ${summary}.\n\nLet me check availability and confirm your reservation right away! 🙏✨`;
      } else {
        return `${apology}\n\nI have noted: ${summary}.\n\nI just need ${missingFieldsText} to complete your reservation! 🙏`;
      }
    }
    return `${apology}\n\nLet's get this right. Could you please share your reservation details again: date, time, party size, and your name? I'll pay close attention! 😊🙏`;
  }

  generateSmartInfoRequest(flow: ConversationFlow, summary: string, missingFieldsText: string, specificRequest: string, urgentRequest: string): string {
    if (this.getMissingFields(flow.collectedInfo).length === 0) {
      return this.generateBookingConfirmation(flow, summary);
    }

    if (flow.responsesSent <= 1) {
      return summary ? `Perfect! I have ${summary}.\n\nI just need ${missingFieldsText} to complete your reservation! ✨`
                     : "I'd love to help you with a reservation! What details can you share - date, time, party size, and your name? 😊";
    }
    if (flow.responsesSent === 2) {
      return summary ? `Great! I have ${summary}.\n\n${specificRequest} 🎯`
                     : "Wonderful! What information can you provide for your booking?";
    }
    return summary ? `Excellent! I have ${summary}.\n\n${urgentRequest} 🎯`
                   : `Almost there! I need ${missingFieldsText} to secure your table.`;
  }

  generateBookingConfirmation(flow: ConversationFlow, summary: string): string {
    return `Perfect! I have everything: ${summary}.\n\nI'll now check availability and confirm your reservation. One moment, please! 🎉`;
  }

  generateAlternativeRequest(flow: ConversationFlow, summary: string): string {
    return `Understood. You're looking for ${summary}.\n\nLet me check for some excellent alternative times for you right now! 🔍`;
  }

  generateFriendlyResponse(flow: ConversationFlow, message: string, aiResult: AIAnalysisResult): string {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('hey')) {
      return "Hello there! I'm here to help you with restaurant reservations. What can I do for you today? 😊";
    }
    if (lowerMessage.includes('thank')) {
        return "You're very welcome! Is there anything else I can assist you with today? 😊";
    }
    // Add more nuanced general responses based on aiResult if needed
    return "I'd be happy to help you with a reservation! What date, time, and party size are you considering? 😊";
  }

  generateContextualResponse(flow: ConversationFlow, summary: string, missingFieldsText: string): string {
    if (summary) {
      return this.getMissingFields(flow.collectedInfo).length === 0
        ? this.generateBookingConfirmation(flow, summary)
        : `Thank you! I have these details so far: ${summary}. I just need ${missingFieldsText} to complete your reservation! ✨`;
    }
    return "I'm ready to help with your reservation! What information can you share with me? 😊";
  }

  generateResetResponse(flow: ConversationFlow, summary: string): string {
    if (summary) {
      return `Okay, let's start fresh. So far, I understand: ${summary}.\n\nWhat other details can you provide for your reservation, or what would you like to change? 🔄`;
    }
    return `Alright, let's begin anew to make sure I get everything perfect for you. Could you please tell me:\n- The date you'd like to visit\n- Your preferred time\n- The number of people in your party\n- And the name for the reservation?\n\nI'll make sure to get it right this time! 🔄😊`;
  }

  // Implementation for the new method
  public generateSmartAlternativeMessageText(
    guestName: string | undefined,
    requestedTime: string, // Original requested time (HH:MM or HH:MM:SS)
    guests: number,
    availableSlots: AvailabilitySlot[] // Data from availability.service
  ): string {
    const friendlyGuestName = guestName || "there";
    const displayRequestedTime = this.formatTimeForDisplay(requestedTime);

    if (availableSlots.length === 0) {
      return `I'm sorry ${friendlyGuestName}, but we seem to be fully booked around ${displayRequestedTime} for ${guests} ${guests === 1 ? 'person' : 'people'}. Would you like to try a different date, or perhaps I can check for a different number of guests? 📅`;
    }

    const alternativesText = availableSlots
      .slice(0, 3) // Show top 3 alternatives
      .map((slot, index) =>
        // slot.timeDisplay is already formatted by availability.service
        `${index + 1}. ${slot.timeDisplay} at Table ${slot.tableName} (for ${slot.tableCapacity.min}-${slot.tableCapacity.max} guests)`
      ).join('\n');

    return `I'm sorry ${friendlyGuestName}, but ${displayRequestedTime} is unfortunately not available for ${guests} ${guests === 1 ? 'person' : 'people'}. 😔

However, I found these other options that might work for you:

${alternativesText}

Would you like to book one of these? Please tell me the number. Alternatively, we can explore other dates or times! 🎯`;
  }
}
