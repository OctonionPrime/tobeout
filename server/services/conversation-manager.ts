/**
 * conversation-manager.ts
 *
 * Manages individual restaurant AI assistant conversations.
 * Each conversation is an instance of ActiveConversation.
 */

import type { AvailabilitySlot } from './availability.service'; 

// --- Interface Definitions ---

export type Language = 'en' | 'ru';

// Детали конфликта имен, которые будут храниться в flow
export interface NameConflictDetails {
  guestId: number;
  dbName: string;    // Имя, которое сейчас в БД
  requestName: string; // Имя из текущего запроса на бронирование
  // Детали, необходимые для повторного вызова с подтвержденным именем
  phone: string;
  telegramUserId: string;
  date: string;
  time: string;
  guests: number;
  comments?: string;
  lang?: Language;
}

export interface ConversationFlow {
  stage: 'greeting' | 'collecting' | 'confirming' | 'suggesting_alternatives' | 'completed' | 'frustrated_recovery' | 'awaiting_name_choice'; 
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
  currentLanguage: Language;
  nameConflictDetails?: NameConflictDetails; 
}

export interface AIAnalysisResult {
  conversation_action: 'collect_info' | 'ready_to_book' | 'show_alternatives' | 'general_inquiry' | 'acknowledge_frustration' | 'unknown_intent' | 'reset_and_restart' | string;
  guest_sentiment: 'positive' | 'neutral' | 'frustrated' | 'confused' | 'impatient' | 'appreciative' | string;
  next_response_tone?: 'friendly' | 'empathetic' | 'direct' | 'enthusiastic' | 'concise' | 'apologetic' | string;
  entities?: {
    date?: string;
    time?: string;
    guests?: number;
    name?: string;
    phone?: string;
    special_requests?: string;
  };
  confidence?: number;
  detectedLanguage?: Language;
}

export interface AIService {
  analyzeMessage(message: string, currentFlow: ConversationFlow): Promise<AIAnalysisResult>;
}


export interface ResponseFormatter {
  setLanguage(language: Language): void;
  generateApology(flow: ConversationFlow, summary: string, missingFieldsText: string): string;
  generateSmartInfoRequest(flow: ConversationFlow, summary: string, missingFieldsText: string, specificRequest: string, urgentRequest: string): string;
  generateBookingConfirmation(flow: ConversationFlow, summary: string): string;
  generateAlternativeRequest(flow: ConversationFlow, summary: string): string;
  generateFriendlyResponse(flow: ConversationFlow, message: string, aiResult: AIAnalysisResult): string;
  generateContextualResponse(flow: ConversationFlow, summary: string, missingFieldsText: string): string;
  generateResetResponse(flow: ConversationFlow, summary: string): string;
  generateSmartAlternativeMessageText(
    guestName: string | undefined,
    requestedTime: string,
    guests: number,
    availableSlots: AvailabilitySlot[]
  ): string;
  generateNoAvailabilityMessage(date: string): string;
  generateAvailabilityConfirmationMessage(flow: ConversationFlow, summary: string, missingFieldsText: string): string;
  generateGreetingMessage(restaurantName: string): string;

  createBookingSummary(collectedInfo: ConversationFlow['collectedInfo'], forConfirmation?: boolean): string; 
  getMissingFields(collectedInfo: ConversationFlow['collectedInfo']): string[];
  formatMissingFieldsText(missingFields: string[]): string;
  createSpecificRequestText(missingFields: string[]): string;
  createUrgentRequestText(missingFields: string[]): string;

  formatTimeForDisplay(time24?: string): string;
  formatDateForDisplay(dateInput?: string): string;
}

// --- Main Conversation Management Class ---

export class ActiveConversation {
  public flow: ConversationFlow;
  private aiService: AIService;
  public responseFormatter: ResponseFormatter;

  constructor(
    aiService: AIService,
    responseFormatter: ResponseFormatter,
    initialHistory: string[] = [],
    existingFlow?: Partial<ConversationFlow>,
    defaultLanguage: Language = 'en'
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
      currentLanguage: defaultLanguage,
      nameConflictDetails: undefined,
      ...existingFlow,
    };
    this.responseFormatter.setLanguage(this.flow.currentLanguage);
  }

  public getConversationFlow(): Readonly<ConversationFlow> {
    return { ...this.flow };
  }

  public setAwaitingNameChoice(details: NameConflictDetails): void {
    this.flow.stage = 'awaiting_name_choice';
    this.flow.nameConflictDetails = details;
    console.log('[ActiveConversation] Stage set to awaiting_name_choice with details:', details);
  }

  public clearNameChoiceState(): void {
    this.flow.stage = 'collecting'; 
    delete this.flow.nameConflictDetails;
    console.log('[ActiveConversation] Name choice state cleared. Stage set to collecting.');
  }


  private updateCollectedInfo(entitiesFromAI: AIAnalysisResult['entities']): void {
    if (!entitiesFromAI) return;

    for (const key in entitiesFromAI) {
      const field = key as keyof ConversationFlow['collectedInfo'];
      const newValue = entitiesFromAI[field as keyof typeof entitiesFromAI];

      if (newValue !== undefined && newValue !== null && 
          String(newValue).toUpperCase() !== 'NOT_SPECIFIED' && 
          String(newValue).toUpperCase() !== 'NONE' && 
          String(newValue).trim() !== '') {

        if (this.flow.collectedInfo[field] !== newValue || this.flow.collectedInfo[field] === undefined) {
          console.log(`[ActiveConversation] Updating ${field}: FROM '${this.flow.collectedInfo[field]}' -> TO '${newValue}'`);
          (this.flow.collectedInfo[field] as any) = newValue;
        }
      } 
      else if (String(newValue).toUpperCase() === 'NOT_SPECIFIED' || String(newValue).toUpperCase() === 'NONE' || (newValue !== null && String(newValue).trim() === '')) {
        if (this.flow.collectedInfo[field] !== undefined) {
          console.log(`[ActiveConversation] Clearing ${field} based on AI explicit instruction: '${newValue}'`);
          delete this.flow.collectedInfo[field];
        }
      }
      else if (newValue === null) {
        if (this.flow.collectedInfo[field] !== undefined) {
          console.log(`[ActiveConversation] AI returned null for field '${field}' (had value '${this.flow.collectedInfo[field]}'). Preserving existing value.`);
        }
      }
    }
  }

  private hasCompleteBookingInfo(): boolean {
    const { date, time, guests, name, phone } = this.flow.collectedInfo;
    return !!(date && time && guests && name && phone);
  }

  public async handleMessage(newMessage: string, restaurantName?: string): Promise<string> {
    if (this.flow.stage === 'awaiting_name_choice') {
        console.log('[ActiveConversation] In awaiting_name_choice stage. Text message ignored by AI processing. Awaiting button press.');
        return this.flow.lastResponse || this.responseFormatter.generateFriendlyResponse(this.flow, "Please use buttons.", {} as AIAnalysisResult);
    }

    if (this.flow.conversationHistory[this.flow.conversationHistory.length -1] !== newMessage) {
        this.flow.conversationHistory.push(newMessage);
    }
    this.flow.responsesSent++;

    const aiResult = await this.aiService.analyzeMessage(newMessage, this.flow);

    if (aiResult.detectedLanguage && aiResult.detectedLanguage !== this.flow.currentLanguage) {
        const isShortOrNumeric = newMessage.length < 5 || /^\d+$/.test(newMessage);
        // Only switch if AI's detected language is different AND (it's not short/numeric OR it's early in conversation)
        if (!isShortOrNumeric || (isShortOrNumeric && this.flow.responsesSent <= 2) ) {
            console.log(`[ActiveConversation] Language changed/detected by AI from ${this.flow.currentLanguage} to: ${aiResult.detectedLanguage}`);
            this.flow.currentLanguage = aiResult.detectedLanguage;
            this.responseFormatter.setLanguage(this.flow.currentLanguage);
        } else {
            console.log(`[ActiveConversation] AI detected ${aiResult.detectedLanguage}, but sticking with ${this.flow.currentLanguage} due to short/numeric input ('${newMessage}') mid-conversation.`);
        }
    } else if (!aiResult.detectedLanguage) { 
        if (/[\u0400-\u04FF]/.test(newMessage) && this.flow.currentLanguage !== 'ru') {
            console.log(`[ActiveConversation] Cyrillic detected in user message, switching to Russian for response.`);
            this.flow.currentLanguage = 'ru';
            this.responseFormatter.setLanguage('ru');
        } else if (!/[\u0400-\u04FF]/.test(newMessage) && this.flow.currentLanguage === 'ru' && !/^\d+$/.test(newMessage)) { 
            console.log(`[ActiveConversation] Non-Cyrillic (and not purely numeric) detected in user message, switching back to English for response.`);
            this.flow.currentLanguage = 'en';
            this.responseFormatter.setLanguage('en');
        }
    }


    this.updateCollectedInfo(aiResult.entities);

    if (aiResult.guest_sentiment === 'frustrated' || aiResult.conversation_action === 'acknowledge_frustration') {
      this.flow.guestFrustrationLevel = Math.min(5, (this.flow.guestFrustrationLevel || 0) + 1);
      this.flow.stage = 'frustrated_recovery';
    } else if (this.flow.guestFrustrationLevel > 0 && aiResult.guest_sentiment !== 'frustrated') {
        this.flow.guestFrustrationLevel = Math.max(0, this.flow.guestFrustrationLevel -1 );
    }

    let responseText = "";
    const summaryForConfirmation = this.responseFormatter.createBookingSummary(this.flow.collectedInfo, true);
    const summaryForCollection = this.responseFormatter.createBookingSummary(this.flow.collectedInfo, false);

    const missingFields = this.responseFormatter.getMissingFields(this.flow.collectedInfo);
    const missingFieldsText = this.responseFormatter.formatMissingFieldsText(missingFields);

    const currentRestaurantName = restaurantName || (this.flow.currentLanguage === 'ru' ? "Ваш Ресторан" : "Your Restaurant");

    if (this.flow.stage === 'frustrated_recovery') {
      responseText = this.responseFormatter.generateApology(this.flow, summaryForCollection, missingFieldsText);
      if (this.hasCompleteBookingInfo()) {
        this.flow.stage = 'confirming';
      } else {
        this.flow.stage = 'collecting';
      }
      if (aiResult.guest_sentiment !== 'frustrated') this.flow.guestFrustrationLevel = 0;
    } else if (this.hasCompleteBookingInfo() && aiResult.conversation_action !== 'show_alternatives') {
      this.flow.stage = 'confirming';
      responseText = this.responseFormatter.generateBookingConfirmation(this.flow, summaryForConfirmation);
    } else {
      if (missingFields.length > 0) {
        this.flow.stage = 'collecting';
      }

      const lowerNewMessage = newMessage.toLowerCase();
      const isGreeting = /^\s*(\/start|hello|hi|hey|привет|здравствуй|добрый день|ку)\s*$/i.test(lowerNewMessage);


      if (this.flow.responsesSent === 1 && isGreeting) {
        this.flow.stage = 'greeting';
        responseText = this.responseFormatter.generateGreetingMessage(currentRestaurantName);
      } else {
        this.flow.stage = 'collecting';
        switch (aiResult.conversation_action) {
          case 'collect_info':
            const specificRequest = this.responseFormatter.createSpecificRequestText(missingFields);
            const urgentRequest = this.responseFormatter.createUrgentRequestText(missingFields);
            responseText = this.responseFormatter.generateSmartInfoRequest(this.flow, summaryForCollection, missingFieldsText, specificRequest, urgentRequest);
            break;
          case 'ready_to_book': 
            if (this.hasCompleteBookingInfo()) {
              this.flow.stage = 'confirming';
              responseText = this.responseFormatter.generateBookingConfirmation(this.flow, summaryForConfirmation);
            } else { 
              this.flow.stage = 'collecting';
              const specificRequest = this.responseFormatter.createSpecificRequestText(missingFields);
              const urgentRequest = this.responseFormatter.createUrgentRequestText(missingFields);
              responseText = this.responseFormatter.generateSmartInfoRequest(this.flow, summaryForCollection, missingFieldsText, specificRequest, urgentRequest);
            }
            break;
          case 'show_alternatives':
            this.flow.stage = 'suggesting_alternatives';
            responseText = this.responseFormatter.generateAlternativeRequest(this.flow, summaryForCollection);
            break;
          case 'general_inquiry':
            responseText = this.responseFormatter.generateFriendlyResponse(this.flow, newMessage, aiResult);
            break;
          case 'reset_and_restart':
            responseText = this.responseFormatter.generateResetResponse(this.flow, summaryForCollection);
            this.flow.collectedInfo = {};
            this.flow.guestFrustrationLevel = 0;
            this.flow.stage = 'greeting';
            delete this.flow.nameConflictDetails;
            break;
          default:
            responseText = this.responseFormatter.generateContextualResponse(this.flow, summaryForCollection, missingFieldsText);
            break;
        }
      }
    }

    this.flow.lastResponse = responseText;
    return responseText;
  }

  public shouldCheckAvailability(): { needsCheck: boolean; date?: string; guests?: number } {
    const { date, time, guests } = this.flow.collectedInfo;
    if (date && !time) {
      return { needsCheck: true, date, guests: guests || 2 }; 
    }
    return { needsCheck: false };
  }

  public handleAvailabilityResult(hasAvailability: boolean): string {
    const summary = this.responseFormatter.createBookingSummary(this.flow.collectedInfo, false);
    const missingFields = this.responseFormatter.getMissingFields(this.flow.collectedInfo);
    const missingFieldsText = this.responseFormatter.formatMissingFieldsText(missingFields);

    if (!hasAvailability) {
      return this.responseFormatter.generateNoAvailabilityMessage(this.flow.collectedInfo.date!);
    } else {
      return this.responseFormatter.generateAvailabilityConfirmationMessage(this.flow, summary, missingFieldsText);
    }
  }
}


// --- Localized Strings Store ---
interface LocalizedStrings {
  today: string;
  tomorrow: string;
  onDate: (formattedDate: string) => string;
  atTime: (formattedTime: string) => string;
  person: string; 
  people_2_4: string; 
  people_many: string; 
  guestsCount: (count: number) => string;
  phonePrefix: string;
  specialRequestsPrefix: string;
  your: string; 
  your_one: string;
  your_many: string;
  and: string;
  missing: {
    date: string;
    time: string;
    party_size: string;
    name: string;
    phone_number: string;
  };
  specificRequest: {
    phoneNumber: string[]; // Array for variety
    name: string[];
    date: string[];
    time: string[];
    partySize: string[];
    default: (field: string) => string;
  };
  urgentRequest: {
    phoneNumber: string[];
    name: string[];
    date: string[];
    time: string[];
    partySize: string[];
    default: (field: string) => string;
  };
  apologies: string[];
  confirmAllDetails: (summary: string) => string;
  confirmNotedDetails: (summary: string, missingText: string) => string[]; // Array for variety
  askAgainForAllDetails: string;
  smartInfoRequest: {
    initialWithSummary: (summary: string, missingText: string) => string[]; // Array for variety
    initialWithoutSummary: string[]; // Array for variety
    secondWithSummary: (summary: string, specificReq: string) => string[];
    secondWithoutSummary: string[];
    urgentWithSummary: (summary: string, urgentReq: string) => string[];
    urgentWithoutSummary: (missingText: string) => string[];
  };
  bookingConfirmation: (summary: string) => string[]; // Array for variety
  alternativeRequest: (summary: string) => string;
  friendlyResponse: {
    greeting: string[]; // Array for variety
    thankYou: string[];
    default: string[];
  };
  contextualResponse: {
    withSummaryAndMissing: (summary: string, missingText: string) => string[];
    withSummaryComplete: (summary: string) => string[];
    withoutSummary: string[];
  };
  resetResponse: {
    withSummary: (summary: string) => string;
    withoutSummary: string;
  };
  noAvailabilityMessage: (displayDate: string) => string;
  availabilityConfirmationMessage: (summary: string, missingText: string) => string[]; // Array for variety
  greetingMessage: (restaurantName: string) => string[]; // Array for variety
  smartAlternative: {
        notFound: (name: string, time: string, guests: number, guestSuffix: string) => string;
        found: (name: string, time: string, guests: number, guestSuffix: string, alternatives: string) => string;
        tableCapacityFormat: (min: number, max: number) => string;
  };
  needToCompleteBooking_plural: (missingFieldsText: string) => string;
  needToCompleteBooking_singular: (missingFieldText: string) => string;
  summaryConnectors: { 
    forName: string;
    forGuests: string; // Simplified for direct use
    onDate: string;
    atTime: string;
    withPhoneShort: string; // Shorter phone connector
    withRequests: string;
    detailsSoFar: string[]; // Array for variety
    isThatCorrect: string[]; // Array for variety
    leadInToMissing: string[]; // Array for variety
  }
}

// Helper function to pick a random string from an array
function pickRandom(arr: string[]): string {
    if (!arr || arr.length === 0) return "";
    return arr[Math.floor(Math.random() * arr.length)];
}


const translations: Record<Language, LocalizedStrings> = {
  en: {
    today: "today",
    tomorrow: "tomorrow",
    onDate: (formattedDate) => `on ${formattedDate}`,
    atTime: (formattedTime) => `at ${formattedTime}`,
    person: "person",
    people_2_4: "people", 
    people_many: "people",
    guestsCount: (count) => `${count} ${count === 1 ? translations.en.person : translations.en.people_many}`,
    phonePrefix: "📞",
    specialRequestsPrefix: "with special requests:",
    your: "your",
    your_one: "your",
    your_many: "your",
    and: "and",
    missing: {
      date: "the date",
      time: "the time",
      party_size: "the number of guests",
      name: "a name for the booking",
      phone_number: "a contact phone number",
    },
    specificRequest: {
      phoneNumber: ["And what's the best phone number to reach you at?", "Could I get a phone number for the reservation, please?"],
      name: ["Great, and under what name should I make the reservation?", "Perfect! What name shall I use for the booking?"],
      date: ["Which date were you thinking of?", "What date would you like to come in?"],
      time: ["Perfect! What time works best for you?", "And what time were you considering?"],
      partySize: ["Got it. And how many people will be joining?", "Understood. How many guests will that be?"],
      default: (field) => `I just need ${field} to continue!`,
    },
    urgentRequest: {
      phoneNumber: ["Last thing - your phone number, and we'll be all set!", "Just your phone number now, and we're good to go!"],
      name: ["Nearly there! Just a name for the reservation, please.", "Almost done! What name should I use?"],
      date: ["Which date would you prefer?", "Just need the date now."],
      time: ["What time should I book for you?", "And the time?"],
      partySize: ["And how many guests in total?", "How many people for the table?"],
      default: (field) => `Just need ${field}, and we're done!`,
    },
    apologies: [
      "I sincerely apologize for the confusion! You're absolutely right.",
      "My apologies for that oversight. I should have remembered that.",
      "You're right, and I'm sorry for asking again. Let's proceed with what you've told me.",
      "I'm sorry for the mix-up. I'll use the information you've already provided.",
      "My mistake! I'll make sure to keep track of that. Thanks for your patience."
    ],
    confirmAllDetails: (summary) => `Okay, great! So that's: ${summary}. Let me check availability and confirm that for you right away! 🙏✨`,
    confirmNotedDetails: (summary, missingText) => [
        `Alright, I have: ${summary}. I just need ${missingText} to complete your reservation! 🙏`,
        `Okay, so far: ${summary}. Just need ${missingText} and we'll be set! 👍`,
        `Got it: ${summary}. Could you also provide ${missingText}, please? 😊`
    ],
    askAgainForAllDetails: "Let's get this right. Could you please share your reservation details again: date, time, party size, and your name? I'll pay close attention! 😊🙏",
    smartInfoRequest: {
      initialWithSummary: (summary, missingText) => [
          `Excellent! So, ${summary}. ${missingText} ✨`,
          `Great, I have ${summary}. Now, ${missingText} 😊`
      ],
      initialWithoutSummary: [
          "I'd love to help you with a reservation! When were you thinking of visiting, for how many people, and at what time? And what name should I use for the booking? 😊",
          "Happy to assist with your booking! Could you tell me the date, time, number of guests, and a name for the reservation, please? ✨"
      ],
      secondWithSummary: (summary, specificReq) => [
          `Great! So, ${summary}. ${specificReq} 🎯`,
          `Okay, I've got: ${summary}. Next, ${specificReq} 👍`
      ],
      secondWithoutSummary: ["Wonderful! What information can you provide for your booking?", "Perfect! What are the details for your reservation?"],
      urgentWithSummary: (summary, urgentReq) => [
          `Excellent! So, ${summary}. ${urgentReq} 🎯`,
          `Perfect, ${summary}. Lastly, ${urgentReq} ✨`
      ],
      urgentWithoutSummary: (missingText) => [
          `Almost there! ${missingText}`,
          `Just a couple more things! ${missingText}`
      ],
    },
    bookingConfirmation: (summary) => [
        `Perfect! So, to confirm: ${summary}. I'll now check availability and confirm your reservation. One moment, please! 🎉`,
        `Excellent! Just to double-check: ${summary}. Let me see if that's available... ⏳`,
        `All set with the details: ${summary}. I'll just confirm this with our system now. ✨`
    ],
    alternativeRequest: (summary) => `Understood. You're looking for ${summary}. Let me check for some excellent alternative times for you right now! 🔍`,
    friendlyResponse: {
      greeting: ["Hello there! How can I help you with a reservation today? 😊", "Hi! I'm here to help you book a table. What did you have in mind?"],
      thankYou: ["You're very welcome! Is there anything else I can assist you with today? 😊", "Happy to help! Let me know if there's anything else. 👍"],
      default: ["I'd be happy to help you with a reservation! What date, time, and party size are you considering? 😊", "Sure, I can help with that! What are the details for your booking?"],
    },
    contextualResponse: {
      withSummaryAndMissing: (summary, missingText) => [
          `Thank you! So far, we have: ${summary}. ${missingText} ✨`,
          `Okay, got it: ${summary}. Now, ${missingText} 👍`
      ],
      withSummaryComplete: (summary) => [
          `Perfect! So, to confirm: ${summary}. I'll now check availability and confirm your reservation. One moment, please! 🎉`,
          `Great, all details noted: ${summary}. Let me just check that for you. ⏳`
      ],
      withoutSummary: ["I'm ready to help with your reservation! What information can you share with me? 😊", "Sure! What are the details for your booking?"],
    },
    resetResponse: {
      withSummary: (summary) => `Okay, let's start fresh. So far, I understand: ${summary}. What other details can you provide for your reservation, or what would you like to change? 🔄`,
      withoutSummary: "Alright, let's begin anew to make sure I get everything perfect for you. Could you please tell me:\n- The date you'd like to visit\n- Your preferred time\n- The number of people in your party\n- And the name for the reservation?\n\nI'll make sure to get it right this time! 🔄😊",
    },
    noAvailabilityMessage: (displayDate) => `I'm sorry, but we're fully booked ${displayDate}. 😔 Would you like me to check availability for a different date? I'd be happy to help you find another time that works perfectly for you! 📅✨`,
    availabilityConfirmationMessage: (summary, missingText) => [ // summary is for date, missingText is for time
        `Excellent! We have tables available ${summary}! 🎉 ${missingText} ✨`,
        `Good news! ${summary} looks good for availability. ${missingText} 😊`
    ],
    greetingMessage: (restaurantName) => [
        `🌟 Hello! Welcome to ${restaurantName}! I'm Sofia, and I'm delighted to help you find the perfect table! ✨\n\nTo get started, could you let me know when you'd like to visit, for how many guests, and your preferred time? 🥂`,
        `Hi there! Thanks for contacting ${restaurantName}. I'm Sofia, ready to assist with your booking! What date, time, and party size are you thinking of? 😊`
    ],
    smartAlternative: {
        notFound: (name, time, guests, guestSuffix) => `I'm sorry ${name}, but we seem to be fully booked around ${time} for ${guests} ${guestSuffix}. Would you like to try a different date, or perhaps I can check for a different number of guests? 📅`,
        found: (name, time, guests, guestSuffix, alternatives) => `I'm sorry ${name}, but ${time} is unfortunately not available for ${guests} ${guestSuffix}. 😔\n\nHowever, I found these other options that might work for you:\n\n${alternatives}\n\nWould you like to book one of these? Please tell me the number. Alternatively, we can explore other dates or times! 🎯`,
        tableCapacityFormat: (min, max) => `(for ${min}-${max} guests)`,
    },
    needToCompleteBooking_plural: (missingFieldsText) => `To complete your booking, please provide: ${missingFieldsText}.`,
    needToCompleteBooking_singular: (missingFieldText) => `To complete your booking, I just need ${missingFieldText}.`,
    summaryConnectors: { // For constructing natural summaries
        forName: "for ", // e.g. "for Peter"
        forGuests: " for ", // e.g. "for 5 guests"
        onDate: " on ", // e.g. "on May 26th"
        atTime: " at ", // e.g. "at 3:00 PM"
        withPhoneShort: ", 📞 ", // e.g. ", 📞 (123) 456-7890"
        withRequests: ", with special requests: ",
        detailsSoFar: ["Okay, so the details I have are: ", "Alright, so far I've got: ", "Let me confirm what I have: "],
        isThatCorrect: ["Is that all correct?", "Does that look right?", "Is everything correct there?"],
        leadInToMissing: ["Great, I just need ", "Okay, could you also provide ", "Perfect, now I just need "]
    }
  },
  ru: {
    today: "сегодня",
    tomorrow: "завтра",
    onDate: (formattedDate) => `на ${formattedDate}`,
    atTime: (formattedTime) => `в ${formattedTime}`,
    person: "гость",
    people_2_4: "гостя",
    people_many: "гостей",
    guestsCount: (count) => {
        if (count === 1) return `${count} ${translations.ru.person}`;
        if (count % 10 === 1 && count % 100 !== 11) return `${count} ${translations.ru.person}`;
        if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return `${count} ${translations.ru.people_2_4}`;
        return `${count} ${translations.ru.people_many}`;
    },
    phonePrefix: "📞",
    specialRequestsPrefix: "особые пожелания:",
    your: "ваши", 
    your_one: "ваше",
    your_many: "ваши",
    and: "и",
    missing: {
      date: "дату",
      time: "время",
      party_size: "количество гостей",
      name: "имя для бронирования",
      phone_number: "контактный номер телефона",
    },
    specificRequest: {
      phoneNumber: ["Отлично! И какой номер телефона для связи мы можем использовать?", "Хорошо, подскажите ваш контактный номер, пожалуйста."],
      name: ["Хорошо! А на какое имя оформить бронирование?", "Замечательно! На чье имя будет бронь?"],
      date: ["На какую дату вы хотели бы прийти?", "Подскажите, пожалуйста, дату визита."],
      time: ["Прекрасно! Какое время вам подходит?", "И на какое время вас записать?"],
      partySize: ["Поняла. И сколько вас будет человек?", "Хорошо, сколько гостей ожидать?"],
      default: (field) => `Уточните, пожалуйста, ${field}.`,
    },
    urgentRequest: {
      phoneNumber: ["Осталось только уточнить ваш номер телефона, и всё будет готово!", "И ваш номер телефона, пожалуйста, для завершения."],
      name: ["Почти всё! Пожалуйста, укажите имя для бронирования.", "Осталось имя, и всё!"],
      date: ["Уточните, пожалуйста, желаемую дату.", "И дату, пожалуйста."],
      time: ["Какое время вам будет удобно?", "На какое время?"],
      partySize: ["Сколько всего будет гостей?", "И сколько человек?"],
      default: (field) => `Пожалуйста, укажите ${field}, и мы почти закончили!`,
    },
    apologies: [
      "Приношу искренние извинения за путаницу! Вы совершенно правы.",
      "Мои извинения за это недоразумение. Мне следовало это помнить.",
      "Вы правы, и мне жаль, что спрашиваю снова. Давайте продолжим с тем, что вы уже сообщили.",
      "Извините за путаницу. Я буду использовать уже предоставленную вами информацию.",
      "Моя ошибка! Я обязательно учту это. Спасибо за ваше терпение."
    ],
    confirmAllDetails: (summary) => `Отлично! Итак: ${summary}. Позвольте, я проверю наличие мест и сразу всё подтвержу! 🙏✨`,
    confirmNotedDetails: (summary, missingText) => [
        `Хорошо, я записала: ${summary}. Мне нужно только ${missingText}, чтобы завершить бронирование! 🙏`,
        `Так, у меня есть: ${summary}. Осталось ${missingText}, и готово! 👍`,
        `Принято: ${summary}. Не хватает только ${missingText}. 😊`
    ],
    askAgainForAllDetails: "Давайте все уточним. Не могли бы вы еще раз сообщить детали вашего бронирования: дату, время, количество гостей и ваше имя? Я буду очень внимательна! 😊🙏",
    smartInfoRequest: {
      initialWithSummary: (summary, missingText) => [
          `Замечательно! ${pickRandom(translations.ru.summaryConnectors.detailsSoFar)}${summary}. ${pickRandom(translations.ru.summaryConnectors.leadInToMissing)}${missingText}. ✨`,
          `Отлично, ${summary}. ${pickRandom(translations.ru.summaryConnectors.leadInToMissing)}${missingText}. 😊`
      ],
      initialWithoutSummary: [
          "С удовольствием помогу вам с бронированием! Когда бы вы хотели прийти, на сколько человек и на какое время? И на какое имя сделать бронь? 😊",
          "Рада помочь с бронью! Подскажите, пожалуйста, дату, время, количество гостей и имя для заказа. ✨"
      ],
      secondWithSummary: (summary, specificReq) => [
          `Отлично! ${pickRandom(translations.ru.summaryConnectors.detailsSoFar)}${summary}. ${specificReq} 🎯`,
          `Хорошо, записала: ${summary}. Теперь ${specificReq} 👍`
      ],
      secondWithoutSummary: ["Прекрасно! Какую информацию вы можете предоставить для вашего бронирования?", "Замечательно! Какие детали для вашего заказа?"],
      urgentWithSummary: (summary, urgentReq) => [
          `Замечательно! ${pickRandom(translations.ru.summaryConnectors.detailsSoFar)}${summary}. ${urgentReq} 🎯`,
          `Отлично, ${summary}. И последнее: ${urgentReq} ✨`
      ],
      urgentWithoutSummary: (missingText) => [
          `Почти готово! ${missingText}`,
          `Еще немного, и всё! ${missingText}`
      ],
    },
    bookingConfirmation: (summary) => [
        `Идеально! Итак, подтверждаю: ${summary}. Сейчас я проверю наличие мест и подтвержу ваше бронирование. Одну минутку, пожалуйста! �`,
        `Отлично! Давайте сверим: ${summary}. Проверяю доступность... ⏳`,
        `Все детали записаны: ${summary}. Сейчас всё подтвержу с нашей системой. ✨`
    ],
    alternativeRequest: (summary) => `Поняла. Вы ищете ${summary}. Сейчас я проверю для вас несколько отличных альтернативных вариантов времени! 🔍`,
    friendlyResponse: {
      greeting: ["Здравствуйте! Чем могу помочь вам с бронированием сегодня? 😊", "Добрый день! Готова помочь вам забронировать столик. Что бы вы хотели?"],
      thankYou: ["Пожалуйста! Могу ли я еще чем-нибудь помочь вам сегодня? 😊", "Рада помочь! Обращайтесь, если что-то еще понадобится. 👍"],
      default: ["Я с удовольствием помогу вам с бронированием! Какую дату, время и количество гостей вы рассматриваете? 😊", "Конечно, помогу! Какие у вас пожелания по дате, времени и числу гостей?"],
    },
    contextualResponse: {
      withSummaryAndMissing: (summary, missingText) => [
          `Спасибо! ${pickRandom(translations.ru.summaryConnectors.detailsSoFar)}${summary}. ${pickRandom(translations.ru.summaryConnectors.leadInToMissing)}${missingText}. ✨`,
          `Хорошо, поняла: ${summary}. ${pickRandom(translations.ru.summaryConnectors.leadInToMissing)}${missingText}. 👍`
      ],
      withSummaryComplete: (summary) =>[
          `Идеально! ${pickRandom(translations.ru.summaryConnectors.detailsSoFar)}${summary}. ${pickRandom(translations.ru.summaryConnectors.isThatCorrect)} Сейчас я проверю наличие мест и подтвержу ваше бронирование. Одну минутку, пожалуйста! 🎉`,
          `Отлично, все детали есть: ${summary}. ${pickRandom(translations.ru.summaryConnectors.isThatCorrect)} Проверяю... ⏳`
      ],
      withoutSummary: ["Я готова помочь с вашим бронированием! Какую информацию вы можете мне сообщить? 😊", "Конечно! Какие детали для вашего заказа?"],
    },
    resetResponse: {
      withSummary: (summary) => `Хорошо, давайте начнем сначала. Насколько я понимаю: ${summary}. Какие еще детали вы можете предоставить для вашего бронирования, или что бы вы хотели изменить? 🔄`,
      withoutSummary: "Хорошо, давайте начнем заново, чтобы я все сделала идеально для вас. Не могли бы вы сказать мне:\n- Дату, когда вы хотели бы прийти\n- Предпочтительное время\n- Количество человек в вашей компании\n- И имя для бронирования?\n\nЯ постараюсь все сделать правильно на этот раз! 🔄😊",
    },
    noAvailabilityMessage: (displayDate) => `К сожалению, ${displayDate} у нас все занято. 😔 Хотите, я проверю наличие мест на другую дату? Я с удовольствием помогу вам найти другое время, которое идеально вам подойдет! 📅✨`,
    availabilityConfirmationMessage: (summary, missingText) => [ // summary is for date, missingText is for time
        `Отлично! У нас есть свободные столики ${summary}! 🎉 ${missingText} ✨`,
        `Хорошие новости! ${summary} выглядит свободным. ${missingText} 😊`
    ],
    greetingMessage: (restaurantName) => [
        `🌟 Здравствуйте! Добро пожаловать в ${restaurantName}! Я София, и я очень рада помочь вам забронировать идеальный столик! ✨\n\nЧтобы начать, скажите, пожалуйста, когда вы хотели бы нас посетить, сколько будет гостей и какое время предпочитаете? 🥂`,
        `Добрый день! Это ${restaurantName}. Я София, помогу вам с бронированием. На какое число, время и сколько человек вы планируете? 😊`
    ],
    smartAlternative: {
        notFound: (name, time, guests, guestSuffix) => `Извините, ${name}, но, похоже, у нас все занято около ${time} для ${guests} ${guestSuffix}. Хотите попробовать другую дату, или, возможно, я могу проверить на другое количество гостей? 📅`,
        found: (name, time, guests, guestSuffix, alternatives) => `Извините, ${name}, но ${time}, к сожалению, недоступно для ${guests} ${guestSuffix}. 😔\n\nОднако, я нашла эти другие варианты, которые могут вам подойти:\n\n${alternatives}\n\nХотите забронировать один из этих вариантов? Пожалуйста, сообщите мне номер. Или мы можем рассмотреть другие даты или время! 🎯`,
        tableCapacityFormat: (min, max) => `(на ${min}-${max} гостей)`,
    },
    needToCompleteBooking_plural: (missingFieldsText) => `Чтобы завершить бронирование, пожалуйста, уточните: ${missingFieldsText}.`,
    needToCompleteBooking_singular: (missingFieldText) => `Чтобы завершить бронирование, пожалуйста, уточните ${missingFieldText}.`,
    summaryConnectors: { 
        forName: "для ", 
        forGuests: " для ",
        onDate: " на ",
        atTime: " в ",
        withPhoneShort: ", тел. ", 
        withRequests: ", особые пожелания: ",
        detailsSoFar: ["Итак, информация, которую я записала: ", "Хорошо, давайте сверим: ", "Так, у меня есть следующие данные: "],
        isThatCorrect: ["Всё верно?", "Правильно я поняла?", "Это корректно?"],
        leadInToMissing: ["Теперь мне нужно ", "Осталось уточнить ", "Подскажите еще, пожалуйста, "]
    }
  },
};


// --- Default ResponseFormatter Implementation ---
export class DefaultResponseFormatter implements ResponseFormatter {
  private currentLang: Language = 'en';
  private strings: LocalizedStrings = translations.en;

  public setLanguage(language: Language): void {
    this.currentLang = language;
    this.strings = translations[language] || translations.en;
    console.log(`[ResponseFormatter] Language set to: ${this.currentLang}`);
  }

  private getMoscowDateContext() {
    const moscowTime = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Moscow"}));
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

  public formatTimeForDisplay(time24?: string): string {
    if (!time24) return '';
    const parts = time24.split(':');
    const hour = parseInt(parts[0], 10);
    const min = parts[1]?.padStart(2, '0') || '00';
    if (isNaN(hour)) return time24;
    if (this.currentLang === 'ru') {
        return `${String(hour).padStart(2, '0')}:${min}`;
    }
    if (hour === 0) return `12:${min} AM`;
    if (hour < 12) return `${hour}:${min} AM`;
    if (hour === 12) return `12:${min} PM`;
    return `${hour - 12}:${min} PM`;
  }

  private formatPhoneNumber(phone?: string): string {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (this.currentLang === 'ru') {
        if (cleaned.length === 11 && (cleaned.startsWith('7') || cleaned.startsWith('8'))) {
          return `+7 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7, 9)}-${cleaned.slice(9)}`;
        } else if (cleaned.length === 10 && !cleaned.startsWith('7') && !cleaned.startsWith('8')) { 
          return `8 (${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 8)}-${cleaned.slice(8)}`;
        } else if (cleaned.length === 10 && (cleaned.startsWith('7') || cleaned.startsWith('8'))) { 
             return `+${cleaned.charAt(0)} (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7,9)}-${cleaned.slice(9)}`;
        }
    }
    if (cleaned.length === 11 && cleaned.startsWith('1')) { 
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    if (cleaned.length > 7) {
        let formatted = '';
        if (cleaned.startsWith('+')) {
            formatted = '+' + cleaned.substring(1, 4) + ' ' + cleaned.substring(4, 7) + ' ' + cleaned.substring(7);
        } else {
            formatted = cleaned.substring(0, 3) + ' ' + cleaned.substring(3, 6) + ' ' + cleaned.substring(6);
        }
        return formatted.trim();
    }
    return cleaned; 
  }

  public formatDateForDisplay(dateInput?: string): string {
    if (!dateInput) return '';
    const moscowDates = this.getMoscowDateContext();
    if (dateInput === moscowDates.today) return this.strings.today;
    if (dateInput === moscowDates.tomorrow) return this.strings.tomorrow;
    try {
      const [year, month, day] = dateInput.split('-').map(Number);
      const dateObj = new Date(Date.UTC(year, month - 1, day)); 
      const options: Intl.DateTimeFormatOptions = {
        weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Europe/Moscow', 
      };
      return dateObj.toLocaleDateString(this.currentLang === 'ru' ? 'ru-RU' : 'en-US', options);
    } catch (e) {
      console.warn(`[ResponseFormatter] Error formatting date ${dateInput}:`, e);
      return dateInput;
    }
  }

  createBookingSummary(info: ConversationFlow['collectedInfo'], forConfirmation: boolean = false): string {
    const parts: string[] = [];
    const s = this.strings.summaryConnectors;

    let namePart = info.name ? `${s.forName}'${info.name}'` : "";
    let guestsPart = info.guests ? `${s.forGuests}${this.strings.guestsCount(info.guests)}` : "";
    let datePart = info.date ? `${s.onDate}${this.formatDateForDisplay(info.date)}` : "";
    let timePart = info.time ? `${s.atTime}${this.formatTimeForDisplay(info.time)}` : "";
    let phonePart = info.phone ? `${s.withPhoneShort}${this.formatPhoneNumber(info.phone)}` : "";
    let requestsPart = info.special_requests ? `${s.withRequests}"${info.special_requests}"` : "";

    if (forConfirmation) {
        if (namePart) parts.push(namePart);
        if (guestsPart) parts.push(guestsPart.replace(s.forGuests, "")); // Avoid double "for"
        if (datePart) parts.push(datePart.replace(s.onDate, this.strings.onDate("").trim())); // Use "on" from LocalizedStrings
        if (timePart) parts.push(timePart.replace(s.atTime, this.strings.atTime("").trim())); // Use "at" from LocalizedStrings
        if (phonePart) parts.push(phonePart.replace(s.withPhoneShort, `, ${this.strings.phonePrefix} `));
        if (requestsPart) parts.push(requestsPart);

        let finalSummary = parts.join(', ');
        // Polish Russian sentence structure for confirmation
        if (this.currentLang === 'ru' && info.name && info.guests && info.date && info.time) {
            finalSummary = `${s.forName}'${info.name}', ${this.strings.guestsCount(info.guests!)} ${s.onDate.trim()}${this.formatDateForDisplay(info.date!)} ${s.atTime.trim()}${this.formatTimeForDisplay(info.time!)}`;
            if (info.phone) finalSummary += `${s.withPhoneShort.trim()}${this.formatPhoneNumber(info.phone!)}`;
            if (info.special_requests) finalSummary += `${s.withRequests.trim()}"${info.special_requests!}"`;
        }
        return finalSummary;
    } else {
        // Conversational summary for collection phase
        let summary = "";
        if (namePart) summary += namePart;

        if (guestsPart) {
            if (summary) summary += ", ";
            summary += guestsPart.replace(s.forGuests, "").trim(); // "5 guests" instead of "for 5 guests"
        }
        if (datePart) {
            if (summary && !summary.endsWith(s.onDate.trim())) summary += (summary.includes(this.strings.guestsCount(info.guests || 0).split(" ")[1])) ? " " : ", ";
            summary += datePart;
        }
        if (timePart) {
            if (summary && !summary.endsWith(s.atTime.trim())) summary += (summary.includes(this.formatDateForDisplay(info.date || ""))) ? " " : ", ";
            summary += timePart;
        }
        if (phonePart) {
            if (summary) summary += " ";
            summary += phonePart.replace(s.withPhoneShort, `(${this.strings.phonePrefix} `) + ")";
        }
        if (requestsPart) {
            if (summary) summary += ", ";
            summary += requestsPart;
        }
        return summary.trim();
    }
}

  getMissingFields(info: ConversationFlow['collectedInfo']): string[] {
    const missingKeys: (keyof LocalizedStrings['missing'])[] = [];
    if (!info.date) missingKeys.push('date');
    if (!info.time) missingKeys.push('time');
    if (!info.guests) missingKeys.push('party_size');
    if (!info.name) missingKeys.push('name');
    if (!info.phone) missingKeys.push('phone_number');
    return missingKeys.map(key => this.strings.missing[key]);
  }

  formatMissingFieldsText(missing: string[]): string {
    if (missing.length === 0) return '';
    if (missing.length === 1) {
        const keyInMissingStrings = Object.keys(this.strings.missing).find(
            k => this.strings.missing[k as keyof LocalizedStrings['missing']] === missing[0]
        ) as keyof LocalizedStrings['missing'] | undefined;

        if (keyInMissingStrings) return this.strings.missing[keyInMissingStrings];
        return missing[0]; 
    }
    const last = missing.pop()!;
    return `${missing.join(', ')} ${this.strings.and} ${last}`;
  }

  createSpecificRequestText(missing: string[]): string {
    if (missing.length === 1) {
      const key = Object.keys(this.strings.missing).find(
        k => this.strings.missing[k as keyof LocalizedStrings['missing']] === missing[0]
      ) as keyof LocalizedStrings['specificRequest'] | undefined;

      if (key && this.strings.specificRequest[key]) {
        const entry = this.strings.specificRequest[key as keyof typeof this.strings.specificRequest];
        return pickRandom(typeof entry === 'function' ? [entry(missing[0])] : entry);
      }
      return this.strings.specificRequest.default(missing[0]);
    }
    return this.strings.needToCompleteBooking_plural(this.formatMissingFieldsText(missing));
  }

  createUrgentRequestText(missing: string[]): string {
     if (missing.length === 1) {
      const key = Object.keys(this.strings.missing).find(
        k => this.strings.missing[k as keyof LocalizedStrings['missing']] === missing[0]
      ) as keyof LocalizedStrings['urgentRequest'] | undefined;

      if (key && this.strings.urgentRequest[key]) {
        const entry = this.strings.urgentRequest[key as keyof typeof this.strings.urgentRequest];
        return pickRandom(typeof entry === 'function' ? [entry(missing[0])] : entry);
      }
      return this.strings.urgentRequest.default(missing[0]);
    }
    return pickRandom(this.strings.smartInfoRequest.urgentWithoutSummary(this.formatMissingFieldsText(missing)));
  }

  generateApology(flow: ConversationFlow, summary: string, missingFieldsText: string): string {
    const apologyIndex = Math.min(flow.guestFrustrationLevel || 0, this.strings.apologies.length - 1);
    const apology = this.strings.apologies[apologyIndex];
    const detailsCollected = this.createBookingSummary(flow.collectedInfo, false); 

    if (detailsCollected) {
      const hasAllInfo = this.getMissingFields(flow.collectedInfo).length === 0;
      if (hasAllInfo) return `${apology}\n\n${this.strings.confirmAllDetails(this.createBookingSummary(flow.collectedInfo, true))}`; 
      return `${apology}\n\n${pickRandom(this.strings.confirmNotedDetails(detailsCollected, missingFieldsText))}`;
    }
    return `${apology}\n\n${this.strings.askAgainForAllDetails}`;
  }

  generateSmartInfoRequest(flow: ConversationFlow, summary: string, missingFieldsText: string, specificRequest: string, urgentRequest: string): string {
    const missingFieldsArray = this.getMissingFields(flow.collectedInfo);
    if (missingFieldsArray.length === 0) { 
      return pickRandom(this.strings.bookingConfirmation(this.createBookingSummary(flow.collectedInfo, true)));
    }

    const conversationalSummary = summary ? `${pickRandom(this.strings.summaryConnectors.detailsSoFar)}${summary}. ` : "";

    if (missingFieldsArray.length === 1) {
        const singleMissingFieldText = this.formatMissingFieldsText(missingFieldsArray);
        if (flow.responsesSent <= 2) { 
            return `${conversationalSummary}${pickRandom(this.strings.summaryConnectors.leadInToMissing)}${singleMissingFieldText}.`;
        }
        return `${conversationalSummary}${specificRequest}`;
    }

    if (flow.responsesSent <= 1) { 
      return summary
        ? pickRandom(this.strings.smartInfoRequest.initialWithSummary(summary, this.strings.needToCompleteBooking_plural(missingFieldsText)))
        : pickRandom(this.strings.smartInfoRequest.initialWithoutSummary);
    }
    if (flow.responsesSent === 2) { 
      return summary
        ? pickRandom(this.strings.smartInfoRequest.secondWithSummary(summary, specificRequest))
        : pickRandom(this.strings.smartInfoRequest.secondWithoutSummary);
    }
    return summary
        ? pickRandom(this.strings.smartInfoRequest.urgentWithSummary(summary, urgentRequest))
        : pickRandom(this.strings.smartInfoRequest.urgentWithoutSummary(this.strings.needToCompleteBooking_plural(missingFieldsText)));
  }

  generateBookingConfirmation(_flow: ConversationFlow, summaryForConfirmation: string): string {
    return pickRandom(this.strings.bookingConfirmation(summaryForConfirmation));
  }

  generateAlternativeRequest(_flow: ConversationFlow, summary: string): string {
    return this.strings.alternativeRequest(summary);
  }

  generateFriendlyResponse(_flow: ConversationFlow, message: string, _aiResult: AIAnalysisResult): string {
    const lowerMessage = message.toLowerCase();
    if (this.currentLang === 'ru') {
        if (lowerMessage.includes('привет') || lowerMessage.includes('здравствуй') || lowerMessage.includes('ку')) return pickRandom(this.strings.friendlyResponse.greeting);
        if (lowerMessage.includes('спасибо') || lowerMessage.includes('благодарю')) return pickRandom(this.strings.friendlyResponse.thankYou);
    } else {
        if (lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('hey')) return pickRandom(this.strings.friendlyResponse.greeting);
        if (lowerMessage.includes('thank')) return pickRandom(this.strings.friendlyResponse.thankYou);
    }
    return pickRandom(this.strings.friendlyResponse.default);
  }

  generateContextualResponse(flow: ConversationFlow, summary: string, missingFieldsText: string): string {
    const detailsCollected = this.createBookingSummary(flow.collectedInfo, false);
    if (detailsCollected) {
      return this.getMissingFields(flow.collectedInfo).length === 0
        ? pickRandom(this.strings.contextualResponse.withSummaryComplete(this.createBookingSummary(flow.collectedInfo, true))) 
        : pickRandom(this.strings.contextualResponse.withSummaryAndMissing(detailsCollected, missingFieldsText));
    }
    return pickRandom(this.strings.contextualResponse.withoutSummary);
  }

  generateResetResponse(_flow: ConversationFlow, summary: string): string {
    const detailsCollected = this.createBookingSummary(_flow.collectedInfo, false);
    return detailsCollected ? this.strings.resetResponse.withSummary(detailsCollected) : this.strings.resetResponse.withoutSummary;
  }

  generateGreetingMessage(restaurantName: string): string {
      return pickRandom(this.strings.greetingMessage(restaurantName));
  }

  generateNoAvailabilityMessage(date: string): string {
    const displayDate = this.formatDateForDisplay(date);
    return this.strings.noAvailabilityMessage(displayDate);
  }

  generateAvailabilityConfirmationMessage(flow: ConversationFlow, summary: string, missingFieldsText: string): string {
    const missingFieldsArray = this.getMissingFields(flow.collectedInfo);
    let promptForTime = pickRandom(this.strings.specificRequest.time); 
    if (missingFieldsArray.length === 1 && missingFieldsArray[0] === this.strings.missing.time) {
        // Already using specific prompt for time
    } else if (missingFieldsArray.length > 0) {
        promptForTime = missingFieldsText; // Fallback if more than just time is missing
    }
    // Summary here is for the date, missingText (promptForTime) is for the time.
    return pickRandom(this.strings.availabilityConfirmationMessage(summary, promptForTime));
  }

  public generateSmartAlternativeMessageText(
    guestName: string | undefined,
    requestedTime: string,
    guests: number,
    availableSlots: AvailabilitySlot[]
  ): string {
    const friendlyGuestName = guestName || (this.currentLang === 'ru' ? "гость" : "there");
    const displayRequestedTime = this.formatTimeForDisplay(requestedTime);
    const guestCountText = this.strings.guestsCount(guests);
    const guestSuffixOnly = guestCountText.substring(guestCountText.indexOf(' ') + 1);


    if (availableSlots.length === 0) {
      return this.strings.smartAlternative.notFound(friendlyGuestName, displayRequestedTime, guests, guestSuffixOnly);
    }

    const alternativesText = availableSlots
      .slice(0, 3)
      .map((slot, index) => {
        const capacityText = this.strings.smartAlternative.tableCapacityFormat(slot.tableCapacity.min, slot.tableCapacity.max);
        return `${index + 1}. ${slot.timeDisplay} - ${slot.tableName} ${capacityText}`;
      }
      ).join('\n');

    return this.strings.smartAlternative.found(friendlyGuestName, displayRequestedTime, guests, guestSuffixOnly, alternativesText);
  }
}