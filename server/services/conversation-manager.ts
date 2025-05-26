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
  stage: 'greeting' | 'collecting' | 'confirming' | 'suggesting_alternatives' | 'completed' | 'frustrated_recovery' | 'awaiting_name_choice'; // <--- Новый стейт
  collectedInfo: {
    date?: string;
    time?: string;
    guests?: number;
    name?: string; // Это имя используется для текущей попытки бронирования
    phone?: string;
    special_requests?: string;
  };
  conversationHistory: string[];
  lastResponse: string;
  guestFrustrationLevel: number;
  responsesSent: number;
  currentLanguage: Language;
  nameConflictDetails?: NameConflictDetails; // <--- Новое поле для деталей конфликта
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

  createBookingSummary(collectedInfo: ConversationFlow['collectedInfo']): string;
  getMissingFields(collectedInfo: ConversationFlow['collectedInfo']): string[];
  formatMissingFieldsText(missingFields: string[]): string;
  createSpecificRequestText(missingFields: string[]): string;
  createUrgentRequestText(missingFields: string[]): string;

  formatTimeForDisplay(time24?: string): string;
  formatDateForDisplay(dateInput?: string): string;
}

// --- Main Conversation Management Class ---

export class ActiveConversation {
  public flow: ConversationFlow; // Сделали публичным для доступа из telegram.ts, но используйте с осторожностью
  private aiService: AIService;
  public responseFormatter: ResponseFormatter; // Сделали публичным для доступа из telegram.ts

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
      nameConflictDetails: undefined, // Инициализируем новое поле
      ...existingFlow,
    };
    this.responseFormatter.setLanguage(this.flow.currentLanguage);
  }

  public getConversationFlow(): Readonly<ConversationFlow> {
    return { ...this.flow };
  }

  // Методы для управления состоянием nameConflict
  public setAwaitingNameChoice(details: NameConflictDetails): void {
    this.flow.stage = 'awaiting_name_choice';
    this.flow.nameConflictDetails = details;
    console.log('[ActiveConversation] Stage set to awaiting_name_choice with details:', details);
  }

  public clearNameChoiceState(): void {
    // Возвращаемся к сбору информации, так как после выбора имени может потребоваться еще что-то
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
    // Если мы ожидаем выбор имени через кнопки, а пользователь пишет текст,
    // telegram.ts должен перехватить это и отправить напоминание.
    // Здесь мы не будем обрабатывать сообщение через AI, если находимся в этом состоянии.
    if (this.flow.stage === 'awaiting_name_choice') {
        console.log('[ActiveConversation] In awaiting_name_choice stage. Text message ignored by AI processing. Awaiting button press.');
        // Можно вернуть предыдущий ответ или специальное сообщение, но лучше, чтобы telegram.ts сам обработал это.
        // Для безопасности, вернем предыдущий ответ, чтобы не было неожиданного поведения.
        return this.flow.lastResponse || this.responseFormatter.generateFriendlyResponse(this.flow, "Please use buttons.", {} as AIAnalysisResult);
    }

    if (this.flow.conversationHistory[this.flow.conversationHistory.length -1] !== newMessage) {
        this.flow.conversationHistory.push(newMessage);
    }
    this.flow.responsesSent++;

    const aiResult = await this.aiService.analyzeMessage(newMessage, this.flow);

    if (aiResult.detectedLanguage && aiResult.detectedLanguage !== this.flow.currentLanguage) {
        console.log(`[ActiveConversation] Language changed/detected by AI to: ${aiResult.detectedLanguage}`);
        this.flow.currentLanguage = aiResult.detectedLanguage;
        this.responseFormatter.setLanguage(this.flow.currentLanguage);
    }
    else if (!aiResult.detectedLanguage && /[\u0400-\u04FF]/.test(newMessage) && this.flow.currentLanguage !== 'ru') {
        console.log(`[ActiveConversation] Cyrillic detected in user message, switching to Russian for response.`);
        this.flow.currentLanguage = 'ru';
        this.responseFormatter.setLanguage('ru');
    }
    else if (!aiResult.detectedLanguage && !/[\u0400-\u04FF]/.test(newMessage) && this.flow.currentLanguage === 'ru') {
        console.log(`[ActiveConversation] Non-Cyrillic detected in user message, switching back to English for response.`);
        this.flow.currentLanguage = 'en';
        this.responseFormatter.setLanguage('en');
    }

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

    const currentRestaurantName = restaurantName || (this.flow.currentLanguage === 'ru' ? "Ваш Ресторан" : "Your Restaurant");

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
      if (missingFields.length > 0) {
        this.flow.stage = 'collecting';
      }

      const lowerNewMessage = newMessage.toLowerCase();
      const isGreeting = /^\s*(\/start|hello|hi|hey|привет|здравствуй|добрый день)\s*$/i.test(lowerNewMessage);

      if (this.flow.responsesSent === 1 && isGreeting) {
        this.flow.stage = 'greeting';
        responseText = this.responseFormatter.generateGreetingMessage(currentRestaurantName);
      } else {
        this.flow.stage = 'collecting';
        switch (aiResult.conversation_action) {
          case 'collect_info':
            const specificRequest = this.responseFormatter.createSpecificRequestText(missingFields);
            const urgentRequest = this.responseFormatter.createUrgentRequestText(missingFields);
            responseText = this.responseFormatter.generateSmartInfoRequest(this.flow, summary, missingFieldsText, specificRequest, urgentRequest);
            break;
          case 'ready_to_book':
            if (this.hasCompleteBookingInfo()) {
              this.flow.stage = 'confirming';
              responseText = this.responseFormatter.generateBookingConfirmation(this.flow, summary);
            } else {
              this.flow.stage = 'collecting';
              const specificRequest = this.responseFormatter.createSpecificRequestText(missingFields);
              const urgentRequest = this.responseFormatter.createUrgentRequestText(missingFields);
              responseText = this.responseFormatter.generateSmartInfoRequest(this.flow, summary, missingFieldsText, specificRequest, urgentRequest);
            }
            break;
          case 'show_alternatives':
            this.flow.stage = 'suggesting_alternatives';
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
            delete this.flow.nameConflictDetails; // Очищаем детали конфликта при рестарте
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

  public shouldCheckAvailability(): { needsCheck: boolean; date?: string; guests?: number } {
    const { date, time, guests } = this.flow.collectedInfo;
    if (date && !time) {
      return { needsCheck: true, date, guests: guests || 2 };
    }
    return { needsCheck: false };
  }

  public handleAvailabilityResult(hasAvailability: boolean): string {
    const summary = this.responseFormatter.createBookingSummary(this.flow.collectedInfo);
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
  people: string;
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
    phoneNumber: string;
    name: string;
    date: string;
    time: string;
    partySize: string;
    default: (field: string) => string;
  };
  urgentRequest: {
    phoneNumber: string;
    name: string;
    date: string;
    time: string;
    partySize: string;
    default: (field: string) => string;
  };
  apologies: string[];
  confirmAllDetails: (summary: string) => string;
  confirmNotedDetails: (summary: string, missingText: string) => string;
  askAgainForAllDetails: string;
  smartInfoRequest: {
    initialWithSummary: (summary: string, missingText: string) => string;
    initialWithoutSummary: string;
    secondWithSummary: (summary: string, specificReq: string) => string;
    secondWithoutSummary: string;
    urgentWithSummary: (summary: string, urgentReq: string) => string;
    urgentWithoutSummary: (missingText: string) => string;
  };
  bookingConfirmation: (summary: string) => string;
  alternativeRequest: (summary: string) => string;
  friendlyResponse: {
    greeting: string;
    thankYou: string;
    default: string;
  };
  contextualResponse: {
    withSummaryAndMissing: (summary: string, missingText: string) => string;
    withSummaryComplete: (summary: string) => string;
    withoutSummary: string;
  };
  resetResponse: {
    withSummary: (summary: string) => string;
    withoutSummary: string;
  };
  noAvailabilityMessage: (displayDate: string) => string;
  availabilityConfirmationMessage: (summary: string, missingText: string) => string;
  greetingMessage: (restaurantName: string) => string;
  smartAlternative: {
    notFound: (name: string, time: string, guests: number, guestSuffix: string) => string;
    found: (name: string, time: string, guests: number, guestSuffix: string, alternatives: string) => string;
    tableCapacityFormat: (min: number, max: number) => string;
  };
  needToCompleteBooking_plural: (missingFieldsText: string) => string;
  needToCompleteBooking_singular: (missingFieldText: string) => string;
}

const translations: Record<Language, LocalizedStrings> = {
  en: {
    today: "today",
    tomorrow: "tomorrow",
    onDate: (formattedDate) => `on ${formattedDate}`,
    atTime: (formattedTime) => `at ${formattedTime}`,
    person: "person",
    people: "people",
    guestsCount: (count) => `${count} ${count === 1 ? "person" : "people"}`,
    phonePrefix: "📞",
    specialRequestsPrefix: "with special requests:",
    your: "your",
    your_one: "your",
    your_many: "your",
    and: "and",
    missing: {
      date: "date",
      time: "time",
      party_size: "party size",
      name: "name",
      phone_number: "phone number",
    },
    specificRequest: {
      phoneNumber: "What's the best phone number to reach you at?",
      name: "What name should I put the reservation under?",
      date: "What date would you like to visit us?",
      time: "What time works best for you?",
      partySize: "How many people will be joining you?",
      default: (field) => `I just need your ${field}!`,
    },
    urgentRequest: {
      phoneNumber: "Last thing - your phone number and we're all set!",
      name: "Just need a name for the reservation!",
      date: "Which date would you prefer?",
      time: "What time should I book for you?",
      partySize: "How many guests total?",
      default: (field) => `Just need your ${field} and we're done!`,
    },
    apologies: [
      "I sincerely apologize for the confusion! You're absolutely right.",
      "My apologies for that oversight. I should have remembered that.",
      "You're right, and I'm sorry for asking again. Let's proceed with what you've told me.",
      "I'm sorry for the mix-up. I'll use the information you've already provided.",
      "My mistake! I'll make sure to keep track of that. Thanks for your patience."
    ],
    confirmAllDetails: (summary) => `I confirm I have all your details: ${summary}.\n\nLet me check availability and confirm your reservation right away! 🙏✨`,
    confirmNotedDetails: (summary, missingText) => `I have noted: ${summary}.\n\nI just need ${missingText} to complete your reservation! 🙏`,
    askAgainForAllDetails: "Let's get this right. Could you please share your reservation details again: date, time, party size, and your name? I'll pay close attention! �🙏",
    smartInfoRequest: {
      initialWithSummary: (summary, missingText) => `Excellent! I can help you with ${summary}.\n\n${missingText} ✨`,
      initialWithoutSummary: "I'd love to help you with a reservation! What details can you share - date, time, party size, and your name? 😊",
      secondWithSummary: (summary, specificReq) => `Great! I have ${summary}.\n\n${specificReq} 🎯`,
      secondWithoutSummary: "Wonderful! What information can you provide for your booking?",
      urgentWithSummary: (summary, urgentReq) => `Excellent! I have ${summary}.\n\n${urgentReq} 🎯`,
      urgentWithoutSummary: (missingText) => `Almost there! ${missingText}`,
    },
    bookingConfirmation: (summary) => `Perfect! I have everything: ${summary}.\n\nI'll now check availability and confirm your reservation. One moment, please! 🎉`,
    alternativeRequest: (summary) => `Understood. You're looking for ${summary}.\n\nLet me check for some excellent alternative times for you right now! 🔍`,
    friendlyResponse: {
      greeting: "Hello there! I'm here to help you with restaurant reservations. What can I do for you today? ?",
      thankYou: "You're very welcome! Is there anything else I can assist you with today? 😊",
      default: "I'd be happy to help you with a reservation! What date, time, and party size are you considering? 😊",
    },
    contextualResponse: {
      withSummaryAndMissing: (summary, missingText) => `Thank you! I have these details so far: ${summary}. ${missingText} ✨`,
      withSummaryComplete: (summary) => `Perfect! I have everything: ${summary}.\n\nI'll now check availability and confirm your reservation. One moment, please! 🎉`,
      withoutSummary: "I'm ready to help with your reservation! What information can you share with me? 😊",
    },
    resetResponse: {
      withSummary: (summary) => `Okay, let's start fresh. So far, I understand: ${summary}.\n\nWhat other details can you provide for your reservation, or what would you like to change? 🔄`,
      withoutSummary: "Alright, let's begin anew to make sure I get everything perfect for you. Could you please tell me:\n- The date you'd like to visit\n- Your preferred time\n- The number of people in your party\n- And the name for the reservation?\n\nI'll make sure to get it right this time! 🔄😊",
    },
    noAvailabilityMessage: (displayDate) => `I'm sorry, but we're fully booked ${displayDate}. 😔\n\nWould you like me to check availability for a different date? I'd be happy to help you find another time that works perfectly for you! 📅✨`,
    availabilityConfirmationMessage: (summary, missingText) => `Excellent! I have tables available ${summary}! 🎉\n\n${missingText} ✨`,
    greetingMessage: (restaurantName) => `🌟 Hello! Welcome to ${restaurantName}! I'm Sofia, and I'm absolutely delighted to help you secure the perfect table! ✨\n\nI can assist you with making a reservation right now. Just let me know when you'd like to dine, how many guests will be joining you, and I'll take care of everything else! 🥂\n\nWhat sounds good to you?`,
    smartAlternative: {
        notFound: (name, time, guests, guestSuffix) => `I'm sorry ${name}, but we seem to be fully booked around ${time} for ${guests} ${guestSuffix}. Would you like to try a different date, or perhaps I can check for a different number of guests? 📅`,
        found: (name, time, guests, guestSuffix, alternatives) => `I'm sorry ${name}, but ${time} is unfortunately not available for ${guests} ${guestSuffix}. 😔\n\nHowever, I found these other options that might work for you:\n\n${alternatives}\n\nWould you like to book one of these? Please tell me the number. Alternatively, we can explore other dates or times! 🎯`,
        tableCapacityFormat: (min, max) => `(for ${min}-${max} guests)`,
    },
    needToCompleteBooking_plural: (missingFieldsText) => `To complete your booking, please provide: ${missingFieldsText}.`,
    needToCompleteBooking_singular: (missingFieldText) => `To complete your booking, I just need ${missingFieldText}.`,
  },
  ru: {
    today: "сегодня",
    tomorrow: "завтра",
    onDate: (formattedDate) => `на ${formattedDate}`,
    atTime: (formattedTime) => `в ${formattedTime}`,
    person: "человек",
    people: "человек",
    guestsCount: (count) => {
        if (count === 1) return `${count} человек`;
        if (count >= 2 && count <= 4) return `${count} человека`;
        return `${count} человек`;
    },
    phonePrefix: "📞",
    specialRequestsPrefix: "с особыми пожеланиями:",
    your: "ваши",
    your_one: "ваше",
    your_many: "ваши",
    and: "и",
    missing: {
      date: "дату",
      time: "время",
      party_size: "количество гостей",
      name: "имя",
      phone_number: "номер телефона",
    },
    specificRequest: {
      phoneNumber: "Какой номер телефона использовать для связи?",
      name: "На какое имя оформить бронирование?",
      date: "На какую дату вы хотели бы прийти?",
      time: "Какое время вам подходит?",
      partySize: "Сколько вас будет человек?",
      default: (field) => `Уточните, пожалуйста, ${field}.`,
    },
    urgentRequest: {
      phoneNumber: "Осталось только уточнить ваш номер телефона!",
      name: "Пожалуйста, укажите имя для бронирования.",
      date: "Уточните, пожалуйста, желаемую дату.",
      time: "Какое время вам будет удобно?",
      partySize: "Сколько всего будет гостей?",
      default: (field) => `Пожалуйста, укажите ${field}, и мы почти закончили!`,
    },
    apologies: [
      "Приношу искренние извинения за путаницу! Вы совершенно правы.",
      "Мои извинения за это недоразумение. Мне следовало это помнить.",
      "Вы правы, и мне жаль, что спрашиваю снова. Давайте продолжим с тем, что вы уже сообщили.",
      "Извините за путаницу. Я буду использовать уже предоставленную вами информацию.",
      "Моя ошибка! Я обязательно учту это. Спасибо за ваше терпение."
    ],
    confirmAllDetails: (summary) => `Подтверждаю, у меня есть все ваши данные: ${summary}.\n\nСейчас я проверю наличие мест и сразу подтвержу ваше бронирование! 🙏✨`,
    confirmNotedDetails: (summary, missingText) => `Я записала: ${summary}.\n\n${missingText} 🙏`,
    askAgainForAllDetails: "Давайте все уточним. Не могли бы вы еще раз сообщить детали вашего бронирования: дату, время, количество гостей и ваше имя? Я буду очень внимательна! 😊🙏",
    smartInfoRequest: {
      initialWithSummary: (summary, missingText) => `Отлично! У меня есть: ${summary}.\n\n${missingText} ✨`,
      initialWithoutSummary: "Я с удовольствием помогу вам с бронированием! Какие детали вы можете сообщить: дату, время, количество гостей и ваше имя? 😊",
      secondWithSummary: (summary, specificReq) => `Замечательно! У меня есть ${summary}.\n\n${specificReq} 🎯`,
      secondWithoutSummary: "Прекрасно! Какую информацию вы можете предоставить для вашего бронирования?",
      urgentWithSummary: (summary, urgentReq) => `Отлично! У меня есть ${summary}.\n\n${urgentReq} 🎯`,
      urgentWithoutSummary: (missingText) => `Почти готово! ${missingText}`,
    },
    bookingConfirmation: (summary) => `Идеально! У меня есть всё: ${summary}.\n\nСейчас я проверю наличие мест и подтвержу ваше бронирование. Одну минутку, пожалуйста! 🎉`,
    alternativeRequest: (summary) => `Поняла. Вы ищете ${summary}.\n\nСейчас я проверю для вас несколько отличных альтернативных вариантов времени! 🔍`,
    friendlyResponse: {
      greeting: "Здравствуйте! Я здесь, чтобы помочь вам с бронированием столика в ресторане. Чем могу быть полезна сегодня? 😊",
      thankYou: "Пожалуйста! Могу ли я еще чем-нибудь помочь вам сегодня? 😊",
      default: "Я с удовольствием помогу вам с бронированием! Какую дату, время и количество гостей вы рассматриваете? 😊",
    },
    contextualResponse: {
      withSummaryAndMissing: (summary, missingText) => `Спасибо! У меня есть следующие данные: ${summary}. ${missingText} ✨`,
      withSummaryComplete: (summary) => `Идеально! У меня есть всё: ${summary}.\n\nСейчас я проверю наличие мест и подтвержу ваше бронирование. Одну минутку, пожалуйста! 🎉`,
      withoutSummary: "Я готова помочь с вашим бронированием! Какую информацию вы можете мне сообщить? 😊",
    },
    resetResponse: {
      withSummary: (summary) => `Хорошо, давайте начнем сначала. Насколько я понимаю: ${summary}.\n\nКакие еще детали вы можете предоставить для вашего бронирования, или что бы вы хотели изменить? 🔄`,
      withoutSummary: "Хорошо, давайте начнем заново, чтобы я все сделала идеально для вас. Не могли бы вы сказать мне:\n- Дату, когда вы хотели бы прийти\n- Предпочтительное время\n- Количество человек в вашей компании\n- И имя для бронирования?\n\nЯ постараюсь все сделать правильно на этот раз! 🔄😊",
    },
    noAvailabilityMessage: (displayDate) => `К сожалению, ${displayDate} у нас все занято. 😔\n\nХотите, я проверю наличие мест на другую дату? Я с удовольствием помогу вам найти другое время, которое идеально вам подойдет! 📅✨`,
    availabilityConfirmationMessage: (summary, missingText) => `Отлично! У нас есть свободные столики ${summary}! 🎉\n\n${missingText} ✨`,
    greetingMessage: (restaurantName) => `🌟 Здравствуйте! Добро пожаловать в ${restaurantName}! Я София, и я очень рада помочь вам забронировать идеальный столик! ✨\n\nЯ могу помочь вам сделать бронирование прямо сейчас. Просто дайте мне знать, когда вы хотели бы поужинать, сколько гостей будет с вами, и я позабочусь обо всем остальном! 🥂\n\nЧто вам подходит?`,
    smartAlternative: {
        notFound: (name, time, guests, guestSuffix) => `Извините, ${name}, но, похоже, у нас все занято около ${time} для ${guests} ${guestSuffix}. Хотите попробовать другую дату, или, возможно, я могу проверить на другое количество гостей? 📅`,
        found: (name, time, guests, guestSuffix, alternatives) => `Извините, ${name}, но ${time}, к сожалению, недоступно для ${guests} ${guestSuffix}. 😔\n\nОднако, я нашла эти другие варианты, которые могут вам подойти:\n\n${alternatives}\n\nХотите забронировать один из этих вариантов? Пожалуйста, сообщите мне номер. Или мы можем рассмотреть другие даты или время! 🎯`,
        tableCapacityFormat: (min, max) => `(на ${min}-${max} гостей)`,
    },
    needToCompleteBooking_plural: (missingFieldsText) => `Для завершения бронирования, пожалуйста, уточните: ${missingFieldsText}.`,
    needToCompleteBooking_singular: (missingFieldText) => `Для завершения бронирования, пожалуйста, уточните ${missingFieldText}.`,
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
        } else if (cleaned.length === 10) {
          return `8 (${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 8)}-${cleaned.slice(8)}`;
        }
    }
    if (cleaned.length === 11 && (cleaned.startsWith('1') || cleaned.startsWith('7') || cleaned.startsWith('8'))) {
      return `+${cleaned.charAt(0)} (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7, 9)}-${cleaned.slice(9)}`;
    } else if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
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

  createBookingSummary(info: ConversationFlow['collectedInfo']): string {
    const parts = [];
    if (info.name) parts.push(info.name);
    if (info.guests) parts.push(this.strings.guestsCount(info.guests));
    if (info.date) parts.push(this.strings.onDate(this.formatDateForDisplay(info.date)));
    if (info.time) parts.push(this.strings.atTime(this.formatTimeForDisplay(info.time)));
    if (info.phone) parts.push(`(${this.strings.phonePrefix} ${this.formatPhoneNumber(info.phone)})`);
    if (info.special_requests) parts.push(`${this.strings.specialRequestsPrefix} "${info.special_requests}"`);
    return parts.length > 0 ? parts.join(', ') : '';
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
        return this.strings.missing[Object.keys(this.strings.missing).find(k => this.strings.missing[k as keyof LocalizedStrings['missing']] === missing[0]) as keyof LocalizedStrings['missing']];
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
        return typeof entry === 'function' ? entry(missing[0]) : entry;
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
        return typeof entry === 'function' ? entry(missing[0]) : entry;
      }
      return this.strings.urgentRequest.default(missing[0]);
    }
    return this.strings.smartInfoRequest.urgentWithoutSummary(this.formatMissingFieldsText(missing));
  }

  generateApology(flow: ConversationFlow, summary: string, missingFieldsText: string): string {
    const apologyIndex = Math.min(flow.guestFrustrationLevel || 0, this.strings.apologies.length - 1);
    const apology = this.strings.apologies[apologyIndex];
    if (summary) {
      const hasAllInfo = this.getMissingFields(flow.collectedInfo).length === 0;
      if (hasAllInfo) return `${apology}\n\n${this.strings.confirmAllDetails(summary)}`;
      return `${apology}\n\n${this.strings.confirmNotedDetails(summary, missingFieldsText)}`;
    }
    return `${apology}\n\n${this.strings.askAgainForAllDetails}`;
  }

  generateSmartInfoRequest(flow: ConversationFlow, summary: string, missingFieldsText: string, specificRequest: string, urgentRequest: string): string {
    const missingFieldsArray = this.getMissingFields(flow.collectedInfo);
    if (missingFieldsArray.length === 0) {
      return this.generateBookingConfirmation(flow, summary);
    }

    if (missingFieldsArray.length === 1) {
        const singleMissingFieldText = this.formatMissingFieldsText(missingFieldsArray);
        if (flow.responsesSent <= 1) {
            return summary
                ? this.strings.smartInfoRequest.initialWithSummary(summary, this.strings.needToCompleteBooking_singular(singleMissingFieldText))
                : this.strings.smartInfoRequest.initialWithoutSummary;
        }
        if (flow.responsesSent === 2) {
            return summary
                ? this.strings.smartInfoRequest.secondWithSummary(summary, specificRequest)
                : this.strings.smartInfoRequest.secondWithoutSummary;
        }
        return summary
            ? this.strings.smartInfoRequest.urgentWithSummary(summary, urgentRequest)
            : this.strings.smartInfoRequest.urgentWithoutSummary(this.strings.needToCompleteBooking_singular(singleMissingFieldText));
    }

    if (flow.responsesSent <= 1) {
      return summary
        ? this.strings.smartInfoRequest.initialWithSummary(summary, this.strings.needToCompleteBooking_plural(missingFieldsText))
        : this.strings.smartInfoRequest.initialWithoutSummary;
    }
    if (flow.responsesSent === 2) {
      return summary
        ? this.strings.smartInfoRequest.secondWithSummary(summary, specificRequest)
        : this.strings.smartInfoRequest.secondWithoutSummary;
    }
    return summary
        ? this.strings.smartInfoRequest.urgentWithSummary(summary, urgentRequest)
        : this.strings.smartInfoRequest.urgentWithoutSummary(this.strings.needToCompleteBooking_plural(missingFieldsText));
  }

  generateBookingConfirmation(_flow: ConversationFlow, summary: string): string {
    return this.strings.bookingConfirmation(summary);
  }

  generateAlternativeRequest(_flow: ConversationFlow, summary: string): string {
    return this.strings.alternativeRequest(summary);
  }

  generateFriendlyResponse(_flow: ConversationFlow, message: string, _aiResult: AIAnalysisResult): string {
    const lowerMessage = message.toLowerCase();
    if (this.currentLang === 'ru') {
        if (lowerMessage.includes('привет') || lowerMessage.includes('здравствуй')) return this.strings.friendlyResponse.greeting;
        if (lowerMessage.includes('спасибо')) return this.strings.friendlyResponse.thankYou;
    } else {
        if (lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('hey')) return this.strings.friendlyResponse.greeting;
        if (lowerMessage.includes('thank')) return this.strings.friendlyResponse.thankYou;
    }
    return this.strings.friendlyResponse.default;
  }

  generateContextualResponse(flow: ConversationFlow, summary: string, missingFieldsText: string): string {
    if (summary) {
      return this.getMissingFields(flow.collectedInfo).length === 0
        ? this.strings.contextualResponse.withSummaryComplete(summary)
        : this.strings.contextualResponse.withSummaryAndMissing(summary, missingFieldsText);
    }
    return this.strings.contextualResponse.withoutSummary;
  }

  generateResetResponse(_flow: ConversationFlow, summary: string): string {
    return summary ? this.strings.resetResponse.withSummary(summary) : this.strings.resetResponse.withoutSummary;
  }

  generateGreetingMessage(restaurantName: string): string {
      return this.strings.greetingMessage(restaurantName);
  }

  generateNoAvailabilityMessage(date: string): string {
    const displayDate = this.formatDateForDisplay(date);
    return this.strings.noAvailabilityMessage(displayDate);
  }

  generateAvailabilityConfirmationMessage(flow: ConversationFlow, summary: string, missingFieldsText: string): string {
    const missingFieldsArray = this.getMissingFields(flow.collectedInfo);
    if (missingFieldsArray.length === 1) {
        return this.strings.availabilityConfirmationMessage(summary, this.strings.needToCompleteBooking_singular(this.formatMissingFieldsText(missingFieldsArray)));
    }
    return this.strings.availabilityConfirmationMessage(summary, this.strings.needToCompleteBooking_plural(missingFieldsText));
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
        // Убедимся, что slot.tableName и slot.timeDisplay локализованы или не требуют локализации
        // slot.timeDisplay уже должен быть локализован из availability.service
        return `${index + 1}. ${slot.timeDisplay} - ${slot.tableName} ${capacityText}`;
      }
      ).join('\n');

    return this.strings.smartAlternative.found(friendlyGuestName, displayRequestedTime, guests, guestSuffixOnly, alternativesText);
  }
}
