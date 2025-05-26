import TelegramBot from 'node-telegram-bot-api';
import { storage } from '../storage';
import { 
    ActiveConversation, 
    DefaultResponseFormatter, 
    Language, 
    ConversationFlow,
    type NameConflictDetails // Импортируем NameConflictDetails
} from './conversation-manager';
import { OpenAIServiceImpl } from './openai';
import { getAvailableTimeSlots, AvailabilitySlot } from './availability.service';
import { 
    createTelegramReservation, 
    generateTelegramConfirmationMessage,
    type CreateTelegramReservationResult 
} from './telegram_booking';
import type { Restaurant } from '@shared/schema';

const activeBots = new Map<number, TelegramBot>();
const activeConversations = new Map<number, ActiveConversation>();

interface TelegramLocalizedStrings {
  welcomeMessage: (restaurantName: string) => string;
  helpMessage: string;
  cancelMessage: string;
  genericError: string;
  bookingFailedOfferAlternatives: string;
  alternativesFound: (alternatives: string) => string;
  noAlternativesTryAgain: string;
  slotUnavailableAnymore: string;
  errorCreatingReservation: string;
  errorCheckingAvailability: string;
  errorHandlingAlternative: string;
  botNotConfigured: string;
  telegramTestSuccess: (botUsername: string) => string;
  telegramTestFailed: (errorMessage: string) => string;
  alternativesNumericalChoicePrompt: string;
  nameClarificationPrompt: (dbName: string, requestName: string) => string;
  useNewNameButton: (requestName: string) => string;
  useDbNameButton: (dbName: string) => string;
  pleaseUseButtons: string;
  nameConfirmationUsed: (name: string) => string;
}

const telegramLocaleStrings: Record<Language, TelegramLocalizedStrings> = {
  en: {
    welcomeMessage: (restaurantName) => `🌟 Hello! Welcome to ${restaurantName}! I'm Sofia, and I'm absolutely delighted to help you secure the perfect table! ✨\n\nI can assist you with making a reservation right now. Just let me know:\n• When you'd like to dine 📅\n• How many guests will be joining you 👥\n• Your preferred time ⏰\n\nI'll take care of everything else! 🥂\n\nWhat sounds good to you?`,
    helpMessage: `🆘 **How I can help you:**\n\nI'm Sofia, your restaurant assistant! I can help you:\n\n✅ Make reservations\n✅ Check table availability\n✅ Find alternative times\n✅ Answer questions about dining\n\n**Just tell me:**\n• What date you'd like to visit\n• Your preferred time\n• How many people\n• Your name\n\nI'll handle the rest!\n\n**Commands:**\n/start - Start fresh conversation\n/help - Show this help\n/cancel - Cancel current booking process\n\nReady to make a reservation? Just tell me what you need! 😊`,
    cancelMessage: "No worries! I've cleared our conversation. Feel free to start fresh whenever you're ready to make a reservation! 😊",
    genericError: "I apologize for the technical hiccup! I'm Sofia. How can I help you with a reservation today? 😊",
    bookingFailedOfferAlternatives: "I'm sorry, but that time slot isn't available anymore. ",
    alternativesFound: (alternatives) => `Here are some great alternatives:\n\n${alternatives}`,
    noAlternativesTryAgain: "Would you like to try a different date or time? I'm here to help find the perfect spot for you! 📅",
    slotUnavailableAnymore: "I'm sorry, but that time slot just became unavailable. Let me check for other options... 🔄",
    errorCreatingReservation: "I encountered a small issue while confirming your reservation. Let me try again in just a moment!",
    errorCheckingAvailability: "Sorry, I couldn't check availability right now. Please try again in a moment.",
    errorHandlingAlternative: "Let me help you find another option. What time would you prefer?",
    botNotConfigured: "Telegram bot is not configured or enabled for this restaurant.",
    telegramTestSuccess: (botUsername) => `Successfully connected to Telegram bot: @${botUsername}`,
    telegramTestFailed: (errorMessage) => `Failed to connect to Telegram bot: ${errorMessage}`,
    alternativesNumericalChoicePrompt: `\n\nWhich option works for you? Just reply with the number! 🎯`,
    nameClarificationPrompt: (dbName, requestName) => `I see you've previously booked as '${dbName}'. For this new reservation, would you like to use the name '${requestName}' or keep '${dbName}'?`,
    useNewNameButton: (requestName) => `Use name: '${requestName}'`,
    useDbNameButton: (dbName) => `Use name: '${dbName}'`,
    pleaseUseButtons: "Please use the buttons above to make your choice.",
    nameConfirmationUsed: (name) => `Okay, using name: ${name}.`,
  },
  ru: {
    welcomeMessage: (restaurantName) => `🌟 Здравствуйте! Добро пожаловать в ${restaurantName}! Я София, и я очень рада помочь вам забронировать идеальный столик! ✨\n\nЯ могу помочь вам сделать бронирование прямо сейчас. Просто сообщите мне:\n• Когда вы хотели бы поужинать 📅\n• Сколько гостей будет с вами 👥\n• Предпочтительное время ⏰\n\nЯ позабочусь обо всем остальном! 🥂\n\nЧто вам подходит?`,
    helpMessage: `🆘 **Чем я могу помочь:**\n\nЯ София, ваш помощник по ресторану! Я могу помочь вам:\n\n✅ Сделать бронирование\n✅ Проверить наличие столиков\n✅ Найти альтернативное время\n✅ Ответить на вопросы о ресторане\n\n**Просто скажите мне:**\n• На какую дату вы хотели бы прийти\n• Предпочтительное время\n• Количество человек\n• Ваше имя\n\nЯ сделаю все остальное!\n\n**Команды:**\n/start - Начать новый разговор\n/help - Показать эту справку\n/cancel - Отменить текущий процесс бронирования\n\nГотовы сделать бронирование? Просто скажите, что вам нужно! 😊`,
    cancelMessage: "Без проблем! Я очистила наш разговор. Не стесняйтесь начать заново, когда будете готовы сделать бронирование! 😊",
    genericError: "Приношу извинения за техническую неполадку! Я София. Чем могу помочь вам с бронированием сегодня? 😊",
    bookingFailedOfferAlternatives: "К сожалению, этот временной слот больше не доступен. ",
    alternativesFound: (alternatives) => `Вот несколько отличных альтернатив:\n\n${alternatives}`,
    noAlternativesTryAgain: "Хотите попробовать другую дату или время? Я здесь, чтобы помочь найти идеальное место для вас! 📅",
    slotUnavailableAnymore: "К сожалению, этот временной слот только что стал недоступен. Позвольте мне проверить другие варианты... 🔄",
    errorCreatingReservation: "Я столкнулась с небольшой проблемой при подтверждении вашего бронирования. Позвольте мне попробовать еще раз через мгновение!",
    errorCheckingAvailability: "Извините, я не смогла проверить наличие мест прямо сейчас. Пожалуйста, попробуйте еще раз через мгновение.",
    errorHandlingAlternative: "Позвольте мне помочь вам найти другой вариант. Какое время вы бы предпочли?",
    botNotConfigured: "Телеграм-бот не настроен или не включен для этого ресторана.",
    telegramTestSuccess: (botUsername) => `Успешное подключение к Телеграм-боту: @${botUsername}`,
    telegramTestFailed: (errorMessage) => `Не удалось подключиться к Телеграм-боту: ${errorMessage}`,
    alternativesNumericalChoicePrompt: `\n\nКакой вариант вам подходит? Просто ответьте номером! 🎯`,
    nameClarificationPrompt: (dbName, requestName) => `Я вижу, что ранее вы бронировали под именем '${dbName}'. Для этого нового бронирования использовать имя '${requestName}' или оставить '${dbName}'?`,
    useNewNameButton: (requestName) => `Использовать '${requestName}'`,
    useDbNameButton: (dbName) => `Использовать '${dbName}'`,
    pleaseUseButtons: "Пожалуйста, выберите один из вариантов с помощью кнопок выше.",
    nameConfirmationUsed: (name) => `Хорошо, используем имя: ${name}.`,
  },
};

async function handleMessage(bot: TelegramBot, restaurantId: number, chatId: number, text: string, restaurant: Restaurant) {
  let conversation = activeConversations.get(chatId);
  let currentLang: Language = 'en';
  const restaurantName = restaurant.name || (currentLang === 'ru' ? "Наш Ресторан" : "Our Restaurant");

  if (!conversation) {
    const aiService = new OpenAIServiceImpl();
    const formatter = new DefaultResponseFormatter();
    if (/[\u0400-\u04FF]/.test(text)) {
        currentLang = 'ru';
    }
    conversation = new ActiveConversation(aiService, formatter, [], {}, currentLang);
    activeConversations.set(chatId, conversation);
    console.log(`🎯 [Sofia AI] Started new conversation for chat ${chatId} with initial language: ${currentLang}`);
  } else {
    currentLang = conversation.getConversationFlow().currentLanguage;
  }
  (conversation.responseFormatter as DefaultResponseFormatter).setLanguage(currentLang);

  try {
    console.log(`📱 [Sofia AI] Processing message from ${chatId} (lang: ${currentLang}): "${text}"`);

    if (conversation.getConversationFlow().stage === 'awaiting_name_choice' && !text.startsWith('/')) {
        await bot.sendMessage(chatId, telegramLocaleStrings[currentLang].pleaseUseButtons);
        return;
    }

    const responseFromConversationManager = await conversation.handleMessage(text, restaurantName);
    currentLang = conversation.getConversationFlow().currentLanguage; // Обновляем язык после AI, он мог измениться
    const locale = telegramLocaleStrings[currentLang];

    const availabilityCheck = conversation.shouldCheckAvailability();

    if (availabilityCheck.needsCheck && availabilityCheck.date) {
      console.log(`🔍 [Sofia AI] Checking availability for ${availabilityCheck.date} with ${availabilityCheck.guests} guests (lang: ${currentLang})`);
      try {
        const availableSlots = await getAvailableTimeSlots(
          restaurantId, availabilityCheck.date, availabilityCheck.guests || 2,
          { maxResults: 1, lang: currentLang }
        );
        const hasAvailability = availableSlots.length > 0;
        console.log(`📊 [Sofia AI] Availability check result: ${hasAvailability ? 'Available' : 'Fully booked'}`);
        const availabilityResponseText = conversation.handleAvailabilityResult(hasAvailability);
        await bot.sendMessage(chatId, availabilityResponseText);
        return;
      } catch (error) {
        console.error('❌ [Sofia AI] Error checking availability:', error);
        await bot.sendMessage(chatId, locale.errorCheckingAvailability);
        return;
      }
    }

    const flow = conversation.getConversationFlow();
    console.log(`🔍 [Sofia AI] Current booking info (lang: ${currentLang}):`, flow.collectedInfo, `Stage: ${flow.stage}`);

    if (hasCompleteBookingInfo(flow.collectedInfo) && 
        (flow.stage === 'confirming' || flow.stage === 'collecting') && // Добавлено 'collecting', т.к. после сбора последнего поля мы можем быть готовы
        flow.stage !== 'awaiting_name_choice' // Не пытаемся бронировать, если ждем выбора имени
    ) {
      console.log(`🎯 [Sofia AI] All booking info collected, attempting reservation (lang: ${currentLang})`);
      try {
        const result: CreateTelegramReservationResult = await createTelegramReservation(
          restaurantId, flow.collectedInfo.date!, flow.collectedInfo.time!,
          flow.collectedInfo.guests!, flow.collectedInfo.name!, flow.collectedInfo.phone!,
          chatId.toString(), flow.collectedInfo.special_requests, currentLang
          // confirmedName здесь не передаем, это первый вызов
        );

        if (result.status === 'created' && result.success && result.reservation) {
          const confirmationMessage = generateTelegramConfirmationMessage(
            result.reservation, flow.collectedInfo.name!, result.table?.name,
            restaurantName, currentLang
          );
          await bot.sendMessage(chatId, confirmationMessage);
          activeConversations.delete(chatId);
          console.log(`✅ [Sofia AI] Reservation confirmed and conversation cleared for chat ${chatId}`);
          return;
        } else if (result.status === 'name_mismatch_clarification_needed' && result.nameConflict) {
          console.log(`[Sofia AI] Name mismatch for guest ${result.nameConflict.guestId}. DB: '${result.nameConflict.dbName}', Request: '${result.nameConflict.requestName}'`);

          conversation.setAwaitingNameChoice(result.nameConflict);

          const messageText = locale.nameClarificationPrompt(result.nameConflict.dbName, result.nameConflict.requestName);
          const inlineKeyboard = {
            inline_keyboard: [
              [
                { text: locale.useNewNameButton(result.nameConflict.requestName), callback_data: `confirm_name:new:${result.nameConflict.telegramUserId}` },
                { text: locale.useDbNameButton(result.nameConflict.dbName), callback_data: `confirm_name:db:${result.nameConflict.telegramUserId}` }
              ]
            ]
          };
          await bot.sendMessage(chatId, messageText, { reply_markup: inlineKeyboard });
          return;
        } else { // Обработка других ошибок от createTelegramReservation
          console.log(`⚠️ [Sofia AI] Booking failed: ${result.message}, offering alternatives (lang: ${currentLang})`);
          const alternatives = await getAvailableTimeSlots(
            restaurantId, flow.collectedInfo.date!, flow.collectedInfo.guests!,
            { maxResults: 3, lang: currentLang }
          );
          let alternativeMessageText = locale.bookingFailedOfferAlternatives;
          if (alternatives.length > 0) {
            const alternativesFormatted = alternatives.map((slot, index) => 
                `${index + 1}. ${slot.timeDisplay} - ${currentLang === 'ru' ? 'Столик' : 'Table'} ${slot.tableName}`
            ).join('\n');
            alternativeMessageText += locale.alternativesFound(alternativesFormatted) + locale.alternativesNumericalChoicePrompt;
          } else {
            alternativeMessageText += locale.noAlternativesTryAgain;
          }
          await bot.sendMessage(chatId, alternativeMessageText);
          // Не очищаем диалог, даем пользователю выбрать альтернативу или изменить запрос
          return;
        }
      } catch (error) {
        console.error('❌ [Sofia AI] Error creating reservation:', error);
        await bot.sendMessage(chatId, locale.errorCreatingReservation);
        return;
      }
    }

    // Обработка выбора альтернативы (если пользователь вводит цифру)
    if (flow.stage === 'suggesting_alternatives' && /^[1-3]$/.test(text.trim())) {
      console.log(`🔢 [Sofia AI] User selected alternative option: ${text} (lang: ${currentLang})`);
      try {
        const alternatives = await getAvailableTimeSlots(
          restaurantId, flow.collectedInfo.date!, flow.collectedInfo.guests!,
          { maxResults: 3, lang: currentLang }
        );
        const selectedIndex = parseInt(text.trim()) - 1;
        if (selectedIndex >= 0 && selectedIndex < alternatives.length) {
          const selectedSlot = alternatives[selectedIndex];
          // Обновляем время в collectedInfo перед попыткой бронирования
          (conversation.flow.collectedInfo as any).time = selectedSlot.time; 

          // Повторная попытка бронирования с выбранным временем
          const bookingResult: CreateTelegramReservationResult = await createTelegramReservation(
            restaurantId, flow.collectedInfo.date!, selectedSlot.time,
            flow.collectedInfo.guests!, flow.collectedInfo.name!,
            flow.collectedInfo.phone || `telegram_${chatId}`, chatId.toString(),
            flow.collectedInfo.special_requests, currentLang
            // confirmedName здесь не передаем, т.к. конфликт имен уже должен был быть разрешен ранее, если был
          );

          if (bookingResult.status === 'created' && bookingResult.success && bookingResult.reservation) {
            const confirmationMessage = generateTelegramConfirmationMessage(
                bookingResult.reservation, flow.collectedInfo.name!, bookingResult.table?.name,
                restaurantName, currentLang
            );
            await bot.sendMessage(chatId, confirmationMessage);
            activeConversations.delete(chatId);
            return;
          } else if (bookingResult.status === 'name_mismatch_clarification_needed' && bookingResult.nameConflict) {
            // Этот сценарий маловероятен здесь, но для полноты
            console.log(`[Sofia AI] Name mismatch during alternative selection for guest ${bookingResult.nameConflict.guestId}.`);
            conversation.setAwaitingNameChoice(bookingResult.nameConflict);
            const messageText = locale.nameClarificationPrompt(bookingResult.nameConflict.dbName, bookingResult.nameConflict.requestName);
            const inlineKeyboard = { inline_keyboard: [[{ text: locale.useNewNameButton(bookingResult.nameConflict.requestName), callback_data: `confirm_name:new:${bookingResult.nameConflict.telegramUserId}` },{ text: locale.useDbNameButton(bookingResult.nameConflict.dbName), callback_data: `confirm_name:db:${bookingResult.nameConflict.telegramUserId}` }]]};
            await bot.sendMessage(chatId, messageText, { reply_markup: inlineKeyboard });
            return;
          } else {
            await bot.sendMessage(chatId, bookingResult.message || locale.slotUnavailableAnymore);
            return;
          }
        }
      } catch (error) {
        console.error('❌ [Sofia AI] Error handling alternative selection:', error);
        await bot.sendMessage(chatId, locale.errorHandlingAlternative);
        return;
      }
    }

    // Если это не специальный случай, отправляем ответ от ConversationManager
    if (responseFromConversationManager) { // Отправляем, только если есть что отправлять
        await bot.sendMessage(chatId, responseFromConversationManager);
        console.log(`✅ [Sofia AI] Sent response from ConversationManager to ${chatId} (lang: ${currentLang})`);
    } else if (flow.stage !== 'awaiting_name_choice') { // Не логируем пустой ответ, если это не ожидание выбора имени
        console.log(`[Sofia AI] No explicit response generated by ConversationManager for chat ${chatId}, stage: ${flow.stage}`);
    }


  } catch (error) {
    console.error('❌ [Sofia AI] Error processing conversation:', error);
    const conv = activeConversations.get(chatId);
    const langForError = conv ? conv.getConversationFlow().currentLanguage : 'en';
    await bot.sendMessage(chatId, telegramLocaleStrings[langForError].genericError);
  }
}

function hasCompleteBookingInfo(info: ConversationFlow['collectedInfo']): boolean {
  return !!(info.date && info.time && info.guests && info.name && info.phone);
}

async function sendWelcomeMessage(bot: TelegramBot, chatId: number, restaurantName: string, lang: Language) {
  await bot.sendMessage(chatId, telegramLocaleStrings[lang].welcomeMessage(restaurantName));
}

export async function initializeTelegramBot(restaurantId: number): Promise<boolean> {
  try {
    const existingBot = activeBots.get(restaurantId);
    if (existingBot) {
      await existingBot.stopPolling({ cancel: true }).catch(e => console.warn(`Error stopping existing bot: ${e.message}`));
      activeBots.delete(restaurantId);
    }

    const settings = await storage.getIntegrationSettings(restaurantId, 'telegram');
    const restaurant = await storage.getRestaurant(restaurantId);

    if (!settings?.enabled || !settings?.token || !restaurant) {
      console.log(`⚠️ [Sofia AI] No bot token or restaurant data for restaurant ${restaurantId}. Bot not initialized.`);
      return false;
    }
    const actualRestaurantName = restaurant.name || (settings.settings?.language === 'ru' ? "Наш Ресторан" : "Our Restaurant");

    console.log(`🚀 [Sofia AI] Initializing bot for restaurant ${restaurantId} (${actualRestaurantName})`);
    const token = settings.token;
    const bot = new TelegramBot(token, { polling: true });
    activeBots.set(restaurantId, bot);

    bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      activeConversations.delete(chatId);
      const userLang = msg.from?.language_code?.startsWith('ru') ? 'ru' : 'en';
      await sendWelcomeMessage(bot, chatId, actualRestaurantName, userLang);
    });

    bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;
      const conv = activeConversations.get(chatId);
      const lang = conv ? conv.getConversationFlow().currentLanguage : (msg.from?.language_code?.startsWith('ru') ? 'ru' : 'en');
      await bot.sendMessage(chatId, telegramLocaleStrings[lang].helpMessage, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/cancel/, async (msg) => {
      const chatId = msg.chat.id;
      const conv = activeConversations.get(chatId);
      const lang = conv ? conv.getConversationFlow().currentLanguage : (msg.from?.language_code?.startsWith('ru') ? 'ru' : 'en');
      activeConversations.delete(chatId);
      await bot.sendMessage(chatId, telegramLocaleStrings[lang].cancelMessage);
    });

    bot.on('message', async (msg) => {
      if (msg.text && msg.text.startsWith('/')) return;
      if (msg.text && msg.chat.id) {
        await handleMessage(bot, restaurantId, msg.chat.id, msg.text, restaurant);
      }
    });

    bot.on('callback_query', async (callbackQuery) => {
      const chatId = callbackQuery.message?.chat.id;
      const messageId = callbackQuery.message?.message_id;
      const data = callbackQuery.data;
      const conversation = chatId ? activeConversations.get(chatId) : undefined;

      if (!chatId || !messageId || !data || !conversation) {
        console.warn('[Telegram] Invalid callback_query or no active conversation for callback.');
        if (callbackQuery.id) await bot.answerCallbackQuery(callbackQuery.id);
        return;
      }

      const currentLang = conversation.getConversationFlow().currentLanguage;
      const locale = telegramLocaleStrings[currentLang];

      console.log(`[Telegram] Callback query received: ${data} from chat ${chatId}`);

      if (data.startsWith('confirm_name:')) {
        const currentFlow = conversation.getConversationFlow();
        if (currentFlow.stage !== 'awaiting_name_choice' || !currentFlow.nameConflictDetails) {
            console.warn(`[Telegram] Received name confirmation callback but not in correct stage or no conflict details. Stage: ${currentFlow.stage}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Сессия истекла или действие неверно."});
            return;
        }

        const parts = data.split(':'); 
        const choiceType = parts[1]; 
        // const telegramUserIdFromCb = parts[2]; // Для возможной доп. проверки

        const conflictDetails = currentFlow.nameConflictDetails;
        if(!conflictDetails) { 
            console.error("[Telegram] Critical: nameConflictDetails is undefined in awaiting_name_choice stage.");
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Внутренняя ошибка. Пожалуйста, попробуйте снова."});
            conversation.clearNameChoiceState();
            return;
        }

        const confirmedName = choiceType === 'new' ? conflictDetails.requestName : conflictDetails.dbName;
        const nameForThisBooking = conflictDetails.requestName; // Имя, которое пользователь изначально ввел для этого бронирования

        console.log(`[Telegram] User chose to use name: ${confirmedName} for profile. Name for this booking attempt: ${nameForThisBooking}`);

        try {
            await bot.answerCallbackQuery(callbackQuery.id, { text: locale.nameConfirmationUsed(confirmedName) });
            await bot.editMessageReplyMarkup({inline_keyboard: []}, { chat_id: chatId, message_id: messageId });
        } catch (editError) {
            console.warn(`[Telegram] Could not edit message or answer callback query: ${editError}`);
        }

        conversation.clearNameChoiceState(); 
        // Устанавливаем имя для текущей операции бронирования в collectedInfo
        (conversation.flow.collectedInfo as any).name = nameForThisBooking;

        try {
          const result = await createTelegramReservation(
            restaurantId, conflictDetails.date, conflictDetails.time,
            conflictDetails.guests, nameForThisBooking, 
            conflictDetails.phone, conflictDetails.telegramUserId, 
            conflictDetails.comments, conflictDetails.lang,
            confirmedName // Подтвержденное имя для обновления профиля гостя в БД
          );

          if (result.success && result.reservation) {
            const confirmationMessage = generateTelegramConfirmationMessage(
              result.reservation, nameForThisBooking, result.table?.name, 
              restaurant.name, currentLang
            );
            await bot.sendMessage(chatId, confirmationMessage);
            activeConversations.delete(chatId);
          } else {
            // Отправляем сообщение об ошибке от booking.ts (оно уже локализовано)
            await bot.sendMessage(chatId, result.message || locale.errorCreatingReservation);
          }
        } catch (error) {
          console.error('❌ [Sofia AI] Error re-creating reservation after name confirmation:', error);
          await bot.sendMessage(chatId, locale.errorCreatingReservation);
        }
      } else {
        await bot.answerCallbackQuery(callbackQuery.id); 
      }
    });


    bot.on('polling_error', (error) => console.error(`❌ [Sofia AI] Polling error for restaurant ${restaurantId}:`, error.message));
    bot.on('error', (error) => console.error(`❌ [Sofia AI] Bot error for restaurant ${restaurantId}:`, error.message));

    console.log(`✅ [Sofia AI] Conversation bot initialized and listening for restaurant ${restaurantId}`);
    return true;
  } catch (error) {
    console.error(`❌ [Telegram] Failed to initialize bot for restaurant ${restaurantId}:`, error);
    return false;
  }
}

export function stopTelegramBot(restaurantId: number): void {
  const bot = activeBots.get(restaurantId);
  if (bot) {
    bot.stopPolling().catch(err => console.error(`Error stopping bot for restaurant ${restaurantId}:`, err));
    activeBots.delete(restaurantId);
    console.log(`🛑 [Telegram] Bot stopped for restaurant ${restaurantId}`);
  }
}

export function getTelegramBot(restaurantId: number): TelegramBot | undefined {
  return activeBots.get(restaurantId);
}

export async function sendTelegramMessage(
  restaurantId: number,
  chatId: number,
  message: string
): Promise<boolean> {
  try {
    const bot = activeBots.get(restaurantId);
    if (!bot) {
      console.error(`❌ [Telegram] No bot found for restaurant ${restaurantId}`);
      return false;
    }
    await bot.sendMessage(chatId, message);
    return true;
  } catch (error) {
    console.error(`❌ [Telegram] Failed to send message:`, error);
    return false;
  }
}

export async function sendAvailabilityNotification(
  restaurantId: number,
  chatId: number,
  date: string,
  availableSlots: AvailabilitySlot[],
  lang: Language,
  formatter: DefaultResponseFormatter
): Promise<boolean> {
  try {
    const bot = activeBots.get(restaurantId);
    if (!bot) {
      console.error(`❌ [Telegram] No bot found for restaurant ${restaurantId}`);
      return false;
    }

    formatter.setLanguage(lang);
    const displayDate = formatter.formatDateForDisplay(date);

    let messageHeader = lang === 'ru'
      ? `🎉 Отличные новости! Я нашла свободные места на ${displayDate}:\n\n`
      : `🎉 Good news! I found availability for ${displayDate}:\n\n`;

    const slotLines = availableSlots.slice(0, 5).map((slot, index) => {
      const timeDisplay = formatter.formatTimeForDisplay(slot.time);
      const tableName = slot.tableName;
      return `${index + 1}. ${timeDisplay} - ${lang === 'ru' ? 'Столик' : 'Table'} ${tableName}`;
    }).join('\n');

    let messageFooter = lang === 'ru'
      ? `\nКакой вариант вас интересует? Просто ответьте номером! 🎯`
      : `\nWhich option interests you? Just reply with the number! �`;

    await bot.sendMessage(chatId, messageHeader + slotLines + messageFooter);
    return true;
  } catch (error) {
    console.error(`❌ [Telegram] Failed to send availability notification:`, error);
    return false;
  }
}

export async function setupTelegramBot(token?: string, restaurantId?: number): Promise<boolean> {
  if (token && restaurantId) {
    console.warn(`[Telegram] setupTelegramBot is deprecated. Use initializeTelegramBot directly or rely on initializeAllTelegramBots.`);
    const settings = await storage.getIntegrationSettings(restaurantId, 'telegram');
    if (!settings || settings.token !== token) {
        await storage.saveIntegrationSettings({
            restaurantId,
            type: 'telegram',
            token: token,
            enabled: true,
        });
    }
    return await initializeTelegramBot(restaurantId);
  }
  return false;
}

export async function initializeAllTelegramBots(): Promise<void> {
  try {
    const restaurantsWithTelegram = await storage.getRestaurantsWithTelegramEnabled();
    console.log(`[Telegram] Found ${restaurantsWithTelegram.length} restaurants with Telegram integration enabled.`);
    for (const restaurant of restaurantsWithTelegram) {
        if (restaurant.id) {
            await initializeTelegramBot(restaurant.id);
        }
    }
    console.log(`🌟 [Sofia AI] All relevant restaurant bots initialized successfully.`);
  } catch (error) {
    console.error('❌ [Telegram] Failed to initialize all bots:', error);
  }
}

export function cleanupTelegramBots(): void {
  console.log(`🧹 [Telegram] Cleaning up ${activeBots.size} active bots...`);
  for (const [restaurantId, bot] of activeBots.entries()) {
    try {
      bot.stopPolling().catch(err => console.error(`Error stopping bot during cleanup for restaurant ${restaurantId}:`, err));
    } catch (error) {
      console.error(`❌ [Telegram] Error stopping bot for restaurant ${restaurantId}:`, error);
    }
  }
  activeBots.clear();
  activeConversations.clear();
  console.log(`✅ [Telegram] Cleanup completed.`);
}

export function getConversationStats(): {
  activeConversations: number;
  activeBots: number;
  conversationsByStage: Record<string, number>;
} {
  const conversationsByStage: Record<string, number> = {};
  for (const conversation of activeConversations.values()) {
    const flow = conversation.getConversationFlow();
    conversationsByStage[flow.stage] = (conversationsByStage[flow.stage] || 0) + 1;
  }
  return {
    activeConversations: activeConversations.size,
    activeBots: activeBots.size,
    conversationsByStage
  };
}