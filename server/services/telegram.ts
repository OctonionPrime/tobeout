import TelegramBot from 'node-telegram-bot-api';
import { storage } from '../storage';
import { 
    ActiveConversation, 
    DefaultResponseFormatter, 
    Language, 
    ConversationFlow,
    type NameConflictDetails
} from './conversation-manager';
import { OpenAIServiceImpl } from './openai';
import { getAvailableTimeSlots, type AvailabilitySlot as ServiceAvailabilitySlot } from './availability.service';
import { 
    createTelegramReservation, 
    // generateTelegramConfirmationMessage, // Keep for name conflict, but primary confirmation is from createTelegramReservation result
    type CreateTelegramReservationResult 
} from './telegram_booking';
import type { Restaurant } from '@shared/schema';
import { db } from '../db'; // For initializeAllTelegramBots
import { eq, and } from 'drizzle-orm'; // For initializeAllTelegramBots
import { restaurants as schemaRestaurants, integrationSettings as schemaIntegrationSettings } from '@shared/schema'; // For initializeAllTelegramBots


const activeBots = new Map<number, TelegramBot>();
// Store active conversations with their last known list of presented alternatives
const activeConversations = new Map<number, { conversation: ActiveConversation, lastPresentedAlternatives?: ServiceAvailabilitySlot[] }>();

interface TelegramLocalizedStrings {
  welcomeMessage: (restaurantName: string) => string;
  helpMessage: string;
  cancelMessage: string;
  genericError: string;
  // bookingFailedOfferAlternatives: string; // Now handled by conversationManager's smartAlternative
  // alternativesFound: (alternatives: string) => string; // Now handled by conversationManager's smartAlternative
  // noAlternativesTryAgain: string; // Now handled by conversationManager's smartAlternative
  slotUnavailableAnymore: string;
  errorCreatingReservation: string;
  errorCheckingAvailability: string;
  errorHandlingAlternative: string;
  invalidAlternativeSelection: string;
  botNotConfigured: string;
  telegramTestSuccess: (botUsername: string) => string;
  telegramTestFailed: (errorMessage: string) => string;
  // alternativesNumericalChoicePrompt: string; // Part of smartAlternative message
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
    slotUnavailableAnymore: "I'm sorry, but that time slot just became unavailable. Let me check for other options... 🔄",
    errorCreatingReservation: "I encountered a small issue while confirming your reservation. Let me try again in just a moment!",
    errorCheckingAvailability: "Sorry, I couldn't check availability right now. Please try again in a moment.",
    errorHandlingAlternative: "Let me help you find another option. What time would you prefer?",
    invalidAlternativeSelection: "That's not a valid option number. Please choose one of the numbers I listed, or let me know if you'd like to try a different date or time.",
    botNotConfigured: "Telegram bot is not configured or enabled for this restaurant.",
    telegramTestSuccess: (botUsername) => `Successfully connected to Telegram bot: @${botUsername}`,
    telegramTestFailed: (errorMessage) => `Failed to connect to Telegram bot: ${errorMessage}`,
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
    slotUnavailableAnymore: "К сожалению, этот временной слот только что стал недоступен. Позвольте мне проверить другие варианты... 🔄",
    errorCreatingReservation: "Я столкнулась с небольшой проблемой при подтверждении вашего бронирования. Позвольте мне попробовать еще раз через мгновение!",
    errorCheckingAvailability: "Извините, я не смогла проверить наличие мест прямо сейчас. Пожалуйста, попробуйте еще раз через мгновение.",
    errorHandlingAlternative: "Позвольте мне помочь вам найти другой вариант. Какое время вы бы предпочли?",
    invalidAlternativeSelection: "Это неверный номер варианта. Пожалуйста, выберите один из перечисленных номеров или сообщите, если хотите попробовать другую дату или время.",
    botNotConfigured: "Телеграм-бот не настроен или не включен для этого ресторана.",
    telegramTestSuccess: (botUsername) => `Успешное подключение к Телеграм-боту: @${botUsername}`,
    telegramTestFailed: (errorMessage) => `Не удалось подключиться к Телеграм-боту: ${errorMessage}`,
    nameClarificationPrompt: (dbName, requestName) => `Я вижу, что ранее вы бронировали под именем '${dbName}'. Для этого нового бронирования использовать имя '${requestName}' или оставить '${dbName}'?`,
    useNewNameButton: (requestName) => `Использовать '${requestName}'`,
    useDbNameButton: (dbName) => `Использовать '${dbName}'`,
    pleaseUseButtons: "Пожалуйста, выберите один из вариантов с помощью кнопок выше.",
    nameConfirmationUsed: (name) => `Хорошо, используем имя: ${name}.`,
  },
};

async function handleMessage(bot: TelegramBot, restaurantId: number, chatId: number, text: string, restaurant: Restaurant) {
  let conversationState = activeConversations.get(chatId);
  let conversation: ActiveConversation;
  let currentLang: Language = 'en';
  const defaultRestaurantName = restaurant.name || (currentLang === 'ru' ? "Наш Ресторан" : "Our Restaurant");

  if (!conversationState) {
    const aiService = new OpenAIServiceImpl();
    const formatter = new DefaultResponseFormatter();
    if (/[\u0400-\u04FF]/.test(text)) {
        currentLang = 'ru';
    }
    formatter.setLanguage(currentLang);
    conversation = new ActiveConversation(aiService, formatter, [], {}, currentLang);
    conversationState = { conversation }; // Store conversation in the new structure
    activeConversations.set(chatId, conversationState);
    console.log(`🎯 [Sofia AI] Started new conversation for chat ${chatId} with initial language: ${currentLang}`);
  } else {
    conversation = conversationState.conversation; // Retrieve conversation from state
    currentLang = conversation.getConversationFlow().currentLanguage;
    (conversation.responseFormatter as DefaultResponseFormatter).setLanguage(currentLang);
  }
  const restaurantName = restaurant.name || defaultRestaurantName;

  try {
    console.log(`📱 [Sofia AI] Processing message from ${chatId} (lang: ${currentLang}): "${text}"`);

    if (conversation.getConversationFlow().stage === 'awaiting_name_choice' && !text.startsWith('/')) {
        await bot.sendMessage(chatId, telegramLocaleStrings[currentLang].pleaseUseButtons);
        return;
    }

    const responseFromConversationManager = await conversation.handleMessage(text, restaurantName);
    currentLang = conversation.getConversationFlow().currentLanguage; 
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
        (flow.stage === 'confirming' || flow.stage === 'collecting') && 
        flow.stage !== 'awaiting_name_choice' 
    ) {
      console.log(`🎯 [Sofia AI] All booking info collected, attempting reservation (lang: ${currentLang})`);
      try {
        const result: CreateTelegramReservationResult = await createTelegramReservation(
          restaurantId, flow.collectedInfo.date!, flow.collectedInfo.time!,
          flow.collectedInfo.guests!, flow.collectedInfo.name!, flow.collectedInfo.phone!,
          chatId.toString(), flow.collectedInfo.special_requests, currentLang
          // No selected_slot_info here as this is the initial booking attempt
        );

        if (result.success && result.status === 'created') {
          await bot.sendMessage(chatId, result.message); // Use message from booking service
          activeConversations.delete(chatId);
          console.log(`✅ [Sofia AI] Reservation confirmed and conversation cleared for chat ${chatId}`);
          return;
        } else if (result.status === 'name_mismatch_clarification_needed' && result.nameConflict) {
          conversation.setAwaitingNameChoice(result.nameConflict);
          const messageText = locale.nameClarificationPrompt(result.nameConflict.dbName, result.nameConflict.requestName);
          const inlineKeyboard = {
            inline_keyboard: [[
                { text: locale.useNewNameButton(result.nameConflict.requestName), callback_data: `confirm_name:new:${result.nameConflict.telegramUserId}` },
                { text: locale.useDbNameButton(result.nameConflict.dbName), callback_data: `confirm_name:db:${result.nameConflict.telegramUserId}` }
            ]]};
          await bot.sendMessage(chatId, messageText, { reply_markup: inlineKeyboard });
          return;
        } else { // Booking failed for other reasons (e.g., no slots, core booking error)
          console.log(`⚠️ [Sofia AI] Booking failed: ${result.message}, offering alternatives (lang: ${currentLang})`);
          const alternatives = await getAvailableTimeSlots(
            restaurantId, flow.collectedInfo.date!, flow.collectedInfo.guests!,
            { maxResults: 3, lang: currentLang, requestedTime: flow.collectedInfo.time, allowCombinations: true }
          );
          // Store these alternatives in conversationState for later selection
          if (conversationState) conversationState.lastPresentedAlternatives = alternatives;

          const alternativeMessageText = conversation.responseFormatter.generateSmartAlternativeMessageText(
              flow.collectedInfo.name, flow.collectedInfo.time!, flow.collectedInfo.guests!, alternatives
          );
          await bot.sendMessage(chatId, alternativeMessageText);
          // Keep conversation active, stage is likely 'suggesting_alternatives' via conversationManager
          return;
        }
      } catch (error) {
        console.error('❌ [Sofia AI] Error creating reservation:', error);
        await bot.sendMessage(chatId, locale.errorCreatingReservation);
        return;
      }
    }

    // Handling alternative selection by number
    if (flow.stage === 'suggesting_alternatives' && /^[1-3]$/.test(text.trim())) {
      console.log(`🔢 [Sofia AI] User selected alternative option: ${text} (lang: ${currentLang})`);

      // Retrieve the alternatives that were presented to the user
      const presentedAlternatives = conversationState?.lastPresentedAlternatives;
      if (!presentedAlternatives || presentedAlternatives.length === 0) {
          console.warn(`[Sofia AI] No lastPresentedAlternatives found for chat ${chatId} when user selected an option.`);
          // Attempt to re-fetch, though this might present a different list if availability changed rapidly.
          // For robustness, it's better if alternatives are stored.
          const freshAlternatives = await getAvailableTimeSlots(
            restaurantId, flow.collectedInfo.date!, flow.collectedInfo.guests!,
            { maxResults: 3, lang: currentLang, requestedTime: flow.collectedInfo.time, allowCombinations: true }
          );
          if (conversationState) conversationState.lastPresentedAlternatives = freshAlternatives; // Store fresh ones
          if (!freshAlternatives || freshAlternatives.length === 0) {
            await bot.sendMessage(chatId, locale.errorHandlingAlternative); // Or "Sorry, those options are no longer available."
            return;
          }
          // If re-fetched, use freshAlternatives below. For this example, we'll assume presentedAlternatives should exist.
          // This part of the logic might need refinement if alternatives are not stored.
          // For now, if not stored, we'll send an error.
          await bot.sendMessage(chatId, locale.errorHandlingAlternative + " (Could not recall previous options)");
          return;
      }

      try {
        const selectedIndex = parseInt(text.trim()) - 1;

        if (selectedIndex >= 0 && selectedIndex < presentedAlternatives.length) {
          const chosenSlot = presentedAlternatives[selectedIndex];
          console.log(`[Sofia AI] Attempting to book selected alternative: SlotName ${chosenSlot.tableName}, Time ${chosenSlot.time}, IsCombined: ${chosenSlot.isCombined}`);

          const bookingResult: CreateTelegramReservationResult = await createTelegramReservation(
            restaurantId, flow.collectedInfo.date!, chosenSlot.time, // Use chosenSlot.time
            flow.collectedInfo.guests!, flow.collectedInfo.name!,
            flow.collectedInfo.phone || `telegram_${chatId}`, chatId.toString(),
            flow.collectedInfo.special_requests, currentLang,
            undefined, // confirmedName is not relevant here unless a new name conflict arises from this attempt
            chosenSlot // Pass the complete chosen slot object
          );

          if (bookingResult.success && bookingResult.status === 'created') {
            await bot.sendMessage(chatId, bookingResult.message); // Use message from booking service
            activeConversations.delete(chatId);
            return;
          } else if (bookingResult.status === 'name_mismatch_clarification_needed' && bookingResult.nameConflict) {
            conversation.setAwaitingNameChoice(bookingResult.nameConflict);
            const messageText = locale.nameClarificationPrompt(bookingResult.nameConflict.dbName, bookingResult.nameConflict.requestName);
            const inlineKeyboard = { inline_keyboard: [[
                { text: locale.useNewNameButton(bookingResult.nameConflict.requestName), callback_data: `confirm_name:new:${bookingResult.nameConflict.telegramUserId}` },
                { text: locale.useDbNameButton(bookingResult.nameConflict.dbName), callback_data: `confirm_name:db:${bookingResult.nameConflict.telegramUserId}` }
            ]]};
            await bot.sendMessage(chatId, messageText, { reply_markup: inlineKeyboard });
            return;
          } else {
            await bot.sendMessage(chatId, bookingResult.message || locale.slotUnavailableAnymore);
            // Optionally, re-present alternatives or guide the user.
            // For now, just send the message. The conversation stage should still be 'suggesting_alternatives'.
            // Clear lastPresentedAlternatives as they might be outdated now.
            if (conversationState) delete conversationState.lastPresentedAlternatives;
            return;
          }
        } else {
            await bot.sendMessage(chatId, locale.invalidAlternativeSelection);
            return;
        }
      } catch (error) {
        console.error('❌ [Sofia AI] Error handling alternative selection:', error);
        await bot.sendMessage(chatId, locale.errorHandlingAlternative);
        return;
      }
    }

    if (responseFromConversationManager) { 
        await bot.sendMessage(chatId, responseFromConversationManager);
        console.log(`✅ [Sofia AI] Sent response from ConversationManager to ${chatId} (lang: ${currentLang})`);
    } else if (flow.stage !== 'awaiting_name_choice') { 
        console.log(`[Sofia AI] No explicit response generated by ConversationManager for chat ${chatId}, stage: ${flow.stage}`);
    }

  } catch (error) {
    console.error('❌ [Sofia AI] Error processing conversation:', error);
    const convState = activeConversations.get(chatId);
    const langForError = convState ? convState.conversation.getConversationFlow().currentLanguage : 'en';
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
    const existingBotInstance = activeBots.get(restaurantId);
    if (existingBotInstance) {
      console.log(`[Sofia AI] Attempting to stop existing polling for restaurant ${restaurantId}`);
      await existingBotInstance.stopPolling({ cancel: true }).catch(e => console.warn(`[Sofia AI] Error stopping existing bot for restaurant ${restaurantId}: ${e.message}`));
      activeBots.delete(restaurantId);
      console.log(`[Sofia AI] Existing bot polling stopped and removed for restaurant ${restaurantId}`);
    }

    const settings = await storage.getIntegrationSettings(restaurantId, 'telegram');
    const restaurant = await storage.getRestaurant(restaurantId);

    if (!settings?.enabled || !settings?.token || !restaurant) {
      console.log(`⚠️ [Sofia AI] No bot token or restaurant data for restaurant ${restaurantId}. Bot not initialized.`);
      return false;
    }
    const initialBotLang = (settings.settings as any)?.language === 'ru' ? 'ru' : 'en'; 
    const actualRestaurantName = restaurant.name || (initialBotLang === 'ru' ? "Наш Ресторан" : "Our Restaurant");

    console.log(`🚀 [Sofia AI] Initializing bot for restaurant ${restaurantId} (${actualRestaurantName})`);
    const token = settings.token;
    const bot = new TelegramBot(token, { polling: { interval: 300, params: { timeout: 10 } } });
    activeBots.set(restaurantId, bot);

    bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      activeConversations.delete(chatId); 
      const userLang = msg.from?.language_code?.startsWith('ru') ? 'ru' : initialBotLang;
      await sendWelcomeMessage(bot, chatId, actualRestaurantName, userLang);
    });

    bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;
      const convState = activeConversations.get(chatId);
      const lang = convState ? convState.conversation.getConversationFlow().currentLanguage : (msg.from?.language_code?.startsWith('ru') ? 'ru' : initialBotLang);
      await bot.sendMessage(chatId, telegramLocaleStrings[lang].helpMessage, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/cancel/, async (msg) => {
      const chatId = msg.chat.id;
      const convState = activeConversations.get(chatId);
      const lang = convState ? convState.conversation.getConversationFlow().currentLanguage : (msg.from?.language_code?.startsWith('ru') ? 'ru' : initialBotLang);
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
      const conversationState = chatId ? activeConversations.get(chatId) : undefined;
      const conversation = conversationState?.conversation;


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
        const conflictDetails = currentFlow.nameConflictDetails;

        if(!conflictDetails) { 
            console.error("[Telegram] Critical: nameConflictDetails is undefined in awaiting_name_choice stage.");
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Внутренняя ошибка. Пожалуйста, попробуйте снова."});
            conversation.clearNameChoiceState();
            return;
        }

        const confirmedNameForProfile = choiceType === 'new' ? conflictDetails.requestName : conflictDetails.dbName;
        const nameForThisBooking = conflictDetails.requestName; 

        console.log(`[Telegram] User chose to use name: ${confirmedNameForProfile} for profile. Name for this booking attempt: ${nameForThisBooking}`);

        try {
            await bot.answerCallbackQuery(callbackQuery.id, { text: locale.nameConfirmationUsed(confirmedNameForProfile) });
            await bot.editMessageReplyMarkup({inline_keyboard: []}, { chat_id: chatId, message_id: messageId });
        } catch (editError: any) {
            console.warn(`[Telegram] Could not edit message or answer callback query: ${editError.message || editError}`);
        }

        conversation.clearNameChoiceState(); 
        (conversation.flow.collectedInfo as any).name = nameForThisBooking;

        try {
          // When re-attempting reservation after name confirmation, we don't have a `selected_slot_info`
          // unless the name conflict happened *after* an alternative was chosen.
          // For simplicity, let's assume name conflict happens before alternative selection,
          // so `selected_slot_info` would be undefined here. The booking service will find a slot.
          const result = await createTelegramReservation(
            restaurantId, conflictDetails.date, conflictDetails.time,
            conflictDetails.guests, nameForThisBooking, 
            conflictDetails.phone, conflictDetails.telegramUserId, 
            conflictDetails.comments, conflictDetails.lang || currentLang,
            confirmedNameForProfile,
            undefined // selected_slot_info is likely undefined here
          );

          if (result.success && result.status === 'created') {
            // The result.message from createTelegramReservation is already fully formed and localized
            await bot.sendMessage(chatId, result.message);
            activeConversations.delete(chatId);
          } else {
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

    bot.on('polling_error', (error) => {
        console.error(`❌ [Sofia AI] Polling error for restaurant ${restaurantId} (${actualRestaurantName}):`, error.message);
        if ((error as any).code === 'ETELEGRAM' && (error as any).response?.body?.error_code === 401) {
            console.error(`[Sofia AI] BOT TOKEN INVALID for restaurant ${restaurantId}. Stopping bot.`);
            stopTelegramBot(restaurantId); 
        }
    });
    bot.on('error', (error) => console.error(`❌ [Sofia AI] General Bot error for restaurant ${restaurantId} (${actualRestaurantName}):`, error.message));

    console.log(`✅ [Sofia AI] Conversation bot initialized and listening for restaurant ${restaurantId} (${actualRestaurantName})`);
    return true;
  } catch (error) {
    console.error(`❌ [Telegram] Failed to initialize bot for restaurant ${restaurantId}:`, error);
    if (activeBots.has(restaurantId)) {
        activeBots.delete(restaurantId);
    }
    return false;
  }
}

export function stopTelegramBot(restaurantId: number): void {
  const bot = activeBots.get(restaurantId);
  if (bot) {
    console.log(`[Telegram] Stopping bot polling for restaurant ${restaurantId}...`);
    bot.stopPolling({ cancel: true })
      .then(() => { console.log(`🛑 [Telegram] Bot stopped for restaurant ${restaurantId}`); })
      .catch(err => console.error(`Error stopping bot for restaurant ${restaurantId}:`, err.message || err));
    activeBots.delete(restaurantId);
  } else {
    console.log(`[Telegram] No active bot found for restaurant ${restaurantId} to stop.`);
  }
}

export async function initializeAllTelegramBots(): Promise<void> {
  try {
    const restaurantsToInit = await db.select({
        id: schemaRestaurants.id,
        // token: schemaIntegrationSettings.token, // Token is fetched in initializeTelegramBot
    })
    .from(schemaRestaurants)
    .innerJoin(schemaIntegrationSettings, eq(schemaRestaurants.id, schemaIntegrationSettings.restaurantId))
    .where(and(eq(schemaIntegrationSettings.type, 'telegram'), eq(schemaIntegrationSettings.enabled, true)));

    console.log(`[Telegram] Found ${restaurantsToInit.length} restaurants with Telegram integration enabled.`);
    for (const restaurantData of restaurantsToInit) {
        if (restaurantData.id) {
            await initializeTelegramBot(restaurantData.id);
        } else {
            console.warn(`[Telegram] Skipping initialization for a restaurant due to missing ID. Data:`, restaurantData);
        }
    }
    console.log(`🌟 [Sofia AI] All relevant restaurant bots processed for initialization.`);
  } catch (error: any) {
    console.error('❌ [Telegram] Failed to initialize all bots:', error.message || error);
  }
}

export function cleanupTelegramBots(): void {
  console.log(`🧹 [Telegram] Cleaning up ${activeBots.size} active bots...`);
  for (const [restaurantId, bot] of activeBots.entries()) {
    try {
      console.log(`[Telegram] Stopping polling for bot of restaurant ${restaurantId} during cleanup.`);
      bot.stopPolling({ cancel: true })
         .then(() => console.log(`[Telegram] Bot for restaurant ${restaurantId} stopped during cleanup.`))
         .catch(err => console.error(`Error stopping bot during cleanup for restaurant ${restaurantId}:`, err.message || err));
    } catch (error: any) {
      console.error(`❌ [Telegram] Error stopping bot for restaurant ${restaurantId} during cleanup:`, error.message || error);
    }
  }
  activeBots.clear();
  activeConversations.clear();
  console.log(`✅ [Telegram] Cleanup completed. Active bots: ${activeBots.size}, Active conversations: ${activeConversations.size}`);
}

// Other utility functions like getTelegramBot, sendTelegramMessage, getConversationStats remain largely unchanged
// unless they need to interact with the new activeConversations structure.

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
  } catch (error: any) {
    console.error(`❌ [Telegram] Failed to send message to chat ${chatId} for restaurant ${restaurantId}:`, error.message || error);
    return false;
  }
}

export function getConversationStats(): {
  activeConversations: number;
  activeBots: number;
  conversationsByStage: Record<string, number>;
} {
  const conversationsByStage: Record<string, number> = {};
  for (const convState of activeConversations.values()) {
    const flow = convState.conversation.getConversationFlow();
    conversationsByStage[flow.stage] = (conversationsByStage[flow.stage] || 0) + 1;
  }
  return {
    activeConversations: activeConversations.size,
    activeBots: activeBots.size,
    conversationsByStage
  };
}
