import TelegramBot from 'node-telegram-bot-api';
import { storage } from '../storage';
import { enhancedConversationManager, type Language } from './enhanced-conversation-manager';
import {
    createTelegramReservation,
    type CreateTelegramReservationResult
} from './telegram_booking';
import type { Restaurant } from '@shared/schema';
import { db } from '../db';
import { eq, and } from 'drizzle-orm';
import { restaurants as schemaRestaurants, integrationSettings as schemaIntegrationSettings } from '@shared/schema';

const activeBots = new Map<number, TelegramBot>();
// Store active Telegram sessions
const telegramSessions = new Map<number, string>(); // chatId -> sessionId

interface TelegramLocalizedStrings {
    welcomeMessage: (restaurantName: string) => string;
    helpMessage: string;
    cancelMessage: string;
    genericError: string;
    slotUnavailableAnymore: string;
    errorCreatingReservation: string;
    errorCheckingAvailability: string;
    errorHandlingAlternative: string;
    invalidAlternativeSelection: string;
    botNotConfigured: string;
    telegramTestSuccess: (botUsername: string) => string;
    telegramTestFailed: (errorMessage: string) => string;
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
    sr: {
        welcomeMessage: (restaurantName) => `🌟 Zdravo! Dobrodošli u ${restaurantName}! Ja sam Sofija, i izuzetno sam zadovoljna što mogu da vam pomognem da obezbedite savršen sto! ✨\n\nMogu da vam pomognem da napravite rezervaciju odmah sada. Samo mi recite:\n• Kada biste voleli da dođete 📅\n• Koliko gostiju će vam se pridružiti 👥\n• Vaše željeno vreme ⏰\n\nJa ću se pobrinuti za sve ostalo! 🥂\n\nŠta vam odgovara?`,
        helpMessage: `🆘 **Kako mogu da pomognem:**\n\nJa sam Sofija, vaš asistent za restoran! Mogu da pomognem sa:\n\n✅ Pravljenjem rezervacija\n✅ Proverom dostupnosti stolova\n✅ Pronalaženjem alternativnih termina\n✅ Odgovaranjem na pitanja o restoranu\n\n**Samo mi recite:**\n• Koji datum želite za posetu\n• Vaše željeno vreme\n• Koliko osoba\n• Vaše ime\n\nJa ću obaviti ostatak!\n\n**Komande:**\n/start - Počni nov razgovor\n/help - Prikaži ovu pomoć\n/cancel - Otkaži trenutni proces rezervacije\n\nSpremni za rezervaciju? Samo recite šta vam treba! 😊`,
        cancelMessage: "Ne brinite! Obrisala sam naš razgovor. Slobodno počnite iznova kad god budete spremni za rezervaciju! 😊",
        genericError: "Izvinjavam se zbog tehničke greške! Ja sam Sofija. Kako mogu da pomognem sa rezervacijom danas? 😊",
        slotUnavailableAnymore: "Žao mi je, ali taj termin je upravo postao nedostupan. Dozvolite mi da proverim druge opcije... 🔄",
        errorCreatingReservation: "Naišla sam na mali problem prilikom potvrđivanja vaše rezervacije. Dozvolite mi da pokušam ponovo za trenutak!",
        errorCheckingAvailability: "Izvini, trenutno ne mogu da proverim dostupnost. Molim pokušajte ponovo za trenutak.",
        errorHandlingAlternative: "Dozvolite mi da vam pomognem da pronađem drugu opciju. Koje vreme biste preferirali?",
        invalidAlternativeSelection: "To nije važeći broj opcije. Molim odaberite jedan od brojeva koje sam navela, ili mi recite ako želite da probamo drugi datum ili vreme.",
        botNotConfigured: "Telegram bot nije konfigurisan ili omogućen za ovaj restoran.",
        telegramTestSuccess: (botUsername) => `Uspešno povezano sa Telegram botom: @${botUsername}`,
        telegramTestFailed: (errorMessage) => `Neuspešno povezivanje sa Telegram botom: ${errorMessage}`,
        nameClarificationPrompt: (dbName, requestName) => `Vidim da ste ranije rezervisali pod imenom '${dbName}'. Za ovu novu rezervaciju, želite li da koristite ime '${requestName}' ili da zadržite '${dbName}'?`,
        useNewNameButton: (requestName) => `Koristi ime: '${requestName}'`,
        useDbNameButton: (dbName) => `Koristi ime: '${dbName}'`,
        pleaseUseButtons: "Molim koristite dugmad iznad da napravite izbor.",
        nameConfirmationUsed: (name) => `U redu, koristimo ime: ${name}.`,
    },
};

async function handleMessage(bot: TelegramBot, restaurantId: number, chatId: number, text: string, restaurant: Restaurant) {
    const restaurantTimezone = restaurant.timezone || 'Europe/Moscow';
    let currentLang: Language = 'en';
    const defaultRestaurantName = restaurant.name || (currentLang === 'ru' ? "Наш Ресторан" : currentLang === 'sr' ? "Naš Restoran" : "Our Restaurant");

    // Get or create session
    let sessionId = telegramSessions.get(chatId);
    if (!sessionId) {
        // Detect language from message
        if (/[\u0400-\u04FF]/.test(text)) {
            // Cyrillic - check if Serbian or Russian
            const serbianCyrillicWords = ['здраво', 'хвала', 'молим', 'добро', 'како'];
            const lowerText = text.toLowerCase();
            if (serbianCyrillicWords.some(word => lowerText.includes(word))) {
                currentLang = 'sr';
            } else {
                currentLang = 'ru';
            }
        } else {
            // Latin script - check for Serbian
            const serbianLatin = ['zdravo', 'hvala', 'molim', 'rezervacija'];
            if (serbianLatin.some(word => text.toLowerCase().includes(word))) {
                currentLang = 'sr';
            } else {
                currentLang = 'en';
            }
        }

        sessionId = enhancedConversationManager.createSession({
            restaurantId,
            platform: 'telegram',
            language: currentLang,
            telegramUserId: chatId.toString()
        });
        
        telegramSessions.set(chatId, sessionId);
        console.log(`🎯 [Sofia AI] Created new Telegram session ${sessionId} for chat ${chatId} with language: ${currentLang}, timezone: ${restaurantTimezone}`);
    }

    // Get current session to check language
    const session = enhancedConversationManager.getSession(sessionId);
    if (session) {
        currentLang = session.language;
    }

    const restaurantName = restaurant.name || defaultRestaurantName;
    const locale = telegramLocaleStrings[currentLang];

    try {
        console.log(`📱 [Sofia AI] Processing Telegram message from ${chatId} (lang: ${currentLang}, timezone: ${restaurantTimezone}): "${text}"`);

        // Handle message with enhanced conversation manager
        const result = await enhancedConversationManager.handleMessage(sessionId, text);
        
        // Update language from session (may have changed during processing)
        const updatedSession = enhancedConversationManager.getSession(sessionId);
        if (updatedSession) {
            currentLang = updatedSession.language;
        }

        console.log(`🔍 [Sofia AI] Enhanced conversation result (lang: ${currentLang}, timezone: ${restaurantTimezone}):`, {
            hasBooking: result.hasBooking,
            reservationId: result.reservationId,
            blocked: result.blocked,
            blockReason: result.blockReason,
            currentStep: result.session.currentStep,
            gatheringInfo: result.session.gatheringInfo
        });

        // Check for successful booking
        if (result.hasBooking && result.reservationId) {
            await bot.sendMessage(chatId, result.response);
            // Clear session after successful booking
            telegramSessions.delete(chatId);
            enhancedConversationManager.endSession(sessionId);
            console.log(`✅ [Sofia AI] Telegram reservation confirmed and session cleared for chat ${chatId}, reservation #${result.reservationId}`);
            return;
        }

        // Check if blocked
        if (result.blocked) {
            await bot.sendMessage(chatId, result.response);
            console.log(`⚠️ [Sofia AI] Message blocked for chat ${chatId}: ${result.blockReason}`);
            return;
        }

        // Send response
        await bot.sendMessage(chatId, result.response);
        console.log(`✅ [Sofia AI] Sent enhanced response to ${chatId} (lang: ${currentLang}, timezone: ${restaurantTimezone})`);

    } catch (error) {
        console.error('❌ [Sofia AI] Error processing Telegram conversation:', error);
        await bot.sendMessage(chatId, locale.genericError);
    }
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

        const restaurantTimezone = restaurant.timezone || 'Europe/Moscow';
        const initialBotLang = (settings.settings as any)?.language === 'ru' ? 'ru' : 
                             (settings.settings as any)?.language === 'sr' ? 'sr' : 'en';
        const actualRestaurantName = restaurant.name || (initialBotLang === 'ru' ? "Наш Ресторан" : initialBotLang === 'sr' ? "Naš Restoran" : "Our Restaurant");

        console.log(`🚀 [Sofia AI] Initializing enhanced bot for restaurant ${restaurantId} (${actualRestaurantName}) with timezone: ${restaurantTimezone}`);
        const token = settings.token;
        const bot = new TelegramBot(token, { polling: { interval: 300, params: { timeout: 10 } } });
        activeBots.set(restaurantId, bot);

        bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            // Clear any existing session
            const existingSessionId = telegramSessions.get(chatId);
            if (existingSessionId) {
                enhancedConversationManager.endSession(existingSessionId);
                telegramSessions.delete(chatId);
            }
            
            const userLang = msg.from?.language_code?.startsWith('ru') ? 'ru' : 
                           msg.from?.language_code?.startsWith('sr') ? 'sr' : initialBotLang;
            await sendWelcomeMessage(bot, chatId, actualRestaurantName, userLang);
        });

        bot.onText(/\/help/, async (msg) => {
            const chatId = msg.chat.id;
            const sessionId = telegramSessions.get(chatId);
            let lang = initialBotLang;
            
            if (sessionId) {
                const session = enhancedConversationManager.getSession(sessionId);
                lang = session?.language || initialBotLang;
            } else {
                lang = msg.from?.language_code?.startsWith('ru') ? 'ru' : 
                      msg.from?.language_code?.startsWith('sr') ? 'sr' : initialBotLang;
            }
            
            await bot.sendMessage(chatId, telegramLocaleStrings[lang].helpMessage, { parse_mode: 'Markdown' });
        });

        bot.onText(/\/cancel/, async (msg) => {
            const chatId = msg.chat.id;
            const sessionId = telegramSessions.get(chatId);
            let lang = initialBotLang;
            
            if (sessionId) {
                const session = enhancedConversationManager.getSession(sessionId);
                lang = session?.language || initialBotLang;
                enhancedConversationManager.endSession(sessionId);
                telegramSessions.delete(chatId);
            } else {
                lang = msg.from?.language_code?.startsWith('ru') ? 'ru' : 
                      msg.from?.language_code?.startsWith('sr') ? 'sr' : initialBotLang;
            }
            
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
            
            if (!chatId || !messageId || !data) {
                console.warn('[Telegram] Invalid callback_query');
                if (callbackQuery.id) await bot.answerCallbackQuery(callbackQuery.id);
                return;
            }

            const sessionId = telegramSessions.get(chatId);
            if (!sessionId) {
                console.warn('[Telegram] No active session for callback');
                await bot.answerCallbackQuery(callbackQuery.id, { text: "Session expired. Please start a new conversation." });
                return;
            }

            const session = enhancedConversationManager.getSession(sessionId);
            if (!session) {
                console.warn('[Telegram] Session not found for callback');
                await bot.answerCallbackQuery(callbackQuery.id, { text: "Session not found. Please start a new conversation." });
                return;
            }

            const currentLang = session.language;
            const locale = telegramLocaleStrings[currentLang];

            console.log(`[Telegram] Callback query received: ${data} from chat ${chatId} (timezone: ${restaurantTimezone})`);

            if (data.startsWith('confirm_name:')) {
                const parts = data.split(':');
                const choiceType = parts[1];
                
                // For name confirmation, we need to handle this with telegram_booking.ts
                // This is a complex case that involves the old name conflict resolution system
                console.log(`[Telegram] Name confirmation callback: ${choiceType}`);
                
                try {
                    await bot.answerCallbackQuery(callbackQuery.id, { text: locale.nameConfirmationUsed(choiceType === 'new' ? 'new name' : 'existing name') });
                    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
                    
                    // Send message to continue with booking
                    await bot.sendMessage(chatId, "Thank you for the confirmation. Let me process your booking...");
                    
                } catch (editError: any) {
                    console.warn(`[Telegram] Could not edit message or answer callback query: ${editError.message || editError}`);
                }
            } else {
                await bot.answerCallbackQuery(callbackQuery.id);
            }
        });

        bot.on('polling_error', (error) => {
            console.error(`❌ [Sofia AI] Polling error for restaurant ${restaurantId} (${actualRestaurantName}, ${restaurantTimezone}):`, error.message);
            if ((error as any).code === 'ETELEGRAM' && (error as any).response?.body?.error_code === 401) {
                console.error(`[Sofia AI] BOT TOKEN INVALID for restaurant ${restaurantId}. Stopping bot.`);
                stopTelegramBot(restaurantId);
            }
        });
        
        bot.on('error', (error) => console.error(`❌ [Sofia AI] General Bot error for restaurant ${restaurantId} (${actualRestaurantName}, ${restaurantTimezone}):`, error.message));

        console.log(`✅ [Sofia AI] Enhanced conversation bot initialized and listening for restaurant ${restaurantId} (${actualRestaurantName}) with timezone: ${restaurantTimezone}`);
        return true;
        
    } catch (error) {
        console.error(`❌ [Telegram] Failed to initialize enhanced bot for restaurant ${restaurantId}:`, error);
        if (activeBots.has(restaurantId)) {
            activeBots.delete(restaurantId);
        }
        return false;
    }
}

export function stopTelegramBot(restaurantId: number): void {
    const bot = activeBots.get(restaurantId);
    if (bot) {
        console.log(`[Telegram] Stopping enhanced bot polling for restaurant ${restaurantId}...`);
        bot.stopPolling({ cancel: true })
            .then(() => { console.log(`🛑 [Telegram] Enhanced bot stopped for restaurant ${restaurantId}`); })
            .catch(err => console.error(`Error stopping enhanced bot for restaurant ${restaurantId}:`, err.message || err));
        activeBots.delete(restaurantId);
        
        // Clear all sessions for this restaurant
        for (const [chatId, sessionId] of telegramSessions.entries()) {
            const session = enhancedConversationManager.getSession(sessionId);
            if (session && session.restaurantId === restaurantId) {
                enhancedConversationManager.endSession(sessionId);
                telegramSessions.delete(chatId);
            }
        }
    } else {
        console.log(`[Telegram] No active enhanced bot found for restaurant ${restaurantId} to stop.`);
    }
}

export async function initializeAllTelegramBots(): Promise<void> {
    try {
        const restaurantsToInit = await db.select({
            id: schemaRestaurants.id,
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
        console.log(`🌟 [Sofia AI] All relevant restaurant enhanced bots processed for initialization.`);
    } catch (error: any) {
        console.error('❌ [Telegram] Failed to initialize all enhanced bots:', error.message || error);
    }
}

export function cleanupTelegramBots(): void {
    console.log(`🧹 [Telegram] Cleaning up ${activeBots.size} active enhanced bots...`);
    for (const [restaurantId, bot] of activeBots.entries()) {
        try {
            console.log(`[Telegram] Stopping polling for enhanced bot of restaurant ${restaurantId} during cleanup.`);
            bot.stopPolling({ cancel: true })
                .then(() => console.log(`[Telegram] Enhanced bot for restaurant ${restaurantId} stopped during cleanup.`))
                .catch(err => console.error(`Error stopping enhanced bot during cleanup for restaurant ${restaurantId}:`, err.message || err));
        } catch (error: any) {
            console.error(`❌ [Telegram] Error stopping enhanced bot for restaurant ${restaurantId} during cleanup:`, error.message || error);
        }
    }
    activeBots.clear();
    telegramSessions.clear();
    console.log(`✅ [Telegram] Enhanced cleanup completed. Active bots: ${activeBots.size}, Active sessions: ${telegramSessions.size}`);
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
            console.error(`❌ [Telegram] No enhanced bot found for restaurant ${restaurantId}`);
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
    const stats = enhancedConversationManager.getStats();
    const conversationsByStage: Record<string, number> = {};
    
    // Count Telegram sessions by stage
    for (const sessionId of telegramSessions.values()) {
        const session = enhancedConversationManager.getSession(sessionId);
        if (session) {
            conversationsByStage[session.currentStep] = (conversationsByStage[session.currentStep] || 0) + 1;
        }
    }
    
    return {
        activeConversations: telegramSessions.size,
        activeBots: activeBots.size,
        conversationsByStage
    };
}