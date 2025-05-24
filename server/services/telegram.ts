import TelegramBot from 'node-telegram-bot-api';
import { storage } from '../storage';
import { ActiveConversation, DefaultResponseFormatter } from './conversation-manager';
import { OpenAIServiceImpl } from './openai';
import { getAvailableTimeSlots } from './availability.service';
import { createTelegramReservation } from './telegram_booking';

// Store active bots by restaurant ID
const activeBots = new Map<number, TelegramBot>();

// Store active conversations by chat ID
const activeConversations = new Map<number, ActiveConversation>();

// Sofia AI Message Processing with full conversation intelligence
async function handleMessage(bot: TelegramBot, restaurantId: number, chatId: number, text: string) {
  try {
    console.log(`📱 [Sofia AI] Processing message from ${chatId}: "${text}"`);
    
    // Get or create conversation for this chat
    let conversation = activeConversations.get(chatId);
    if (!conversation) {
      const aiService = new OpenAIServiceImpl();
      const formatter = new DefaultResponseFormatter();
      conversation = new ActiveConversation(aiService, formatter);
      activeConversations.set(chatId, conversation);
      console.log(`🎯 [Sofia AI] Started new conversation for chat ${chatId}`);
    }

    // Process message through Sofia's conversation intelligence
    const response = await conversation.handleMessage(text);
    
    // Check if Sofia is ready to make a reservation
    const flow = conversation.getConversationFlow();
    
    // For Telegram, if we have name, date, time, guests but no phone, use chat ID as contact
    if (flow.stage === 'confirming' && flow.collectedInfo.name && flow.collectedInfo.date && 
        flow.collectedInfo.time && flow.collectedInfo.guests && !flow.collectedInfo.phone) {
      flow.collectedInfo.phone = `telegram_${chatId}`;
    }
    
    if (flow.stage === 'confirming' && hasCompleteBookingInfo(flow.collectedInfo)) {
      // Sofia has all the info - attempt to create reservation
      try {
        const result = await createTelegramReservation(
          restaurantId,
          flow.collectedInfo.date!,
          flow.collectedInfo.time!,
          flow.collectedInfo.guests!,
          flow.collectedInfo.name!,
          flow.collectedInfo.phone!,
          flow.collectedInfo.special_requests
        );

        if (result.success) {
          const confirmationMessage = `🎉 Perfect! Your reservation is confirmed!\n\n✨ ${result.message}\n\nWe're excited to welcome you! 🥂`;
          await bot.sendMessage(chatId, confirmationMessage);
          
          // Clear conversation after successful booking
          activeConversations.delete(chatId);
          return;
        } else {
          // Booking failed - offer alternatives
          const alternatives = await getAvailableTimeSlots(
            restaurantId,
            flow.collectedInfo.date!,
            flow.collectedInfo.guests!,
            { maxResults: 3 }
          );

          let alternativeMessage = `I'm sorry, but that time slot isn't available anymore. `;
          if (alternatives.length > 0) {
            alternativeMessage += `Here are some great alternatives:\n\n`;
            alternatives.forEach((slot, index) => {
              alternativeMessage += `${index + 1}. ${slot.timeDisplay} at Table ${slot.tableName}\n`;
            });
            alternativeMessage += `\nWhich option works for you? Just reply with the number! 🎯`;
          } else {
            alternativeMessage += `Would you like to try a different date or time? I'm here to help find the perfect spot for you! 📅`;
          }
          
          await bot.sendMessage(chatId, alternativeMessage);
          return;
        }
      } catch (error) {
        console.error('❌ [Sofia AI] Error creating reservation:', error);
        await bot.sendMessage(chatId, "I encountered a small issue while confirming your reservation. Let me try again in just a moment!");
      }
    }

    // Send Sofia's intelligent response
    await bot.sendMessage(chatId, response);
    console.log(`✅ [Sofia AI] Sent response to ${chatId}`);
    
    // Debug: Log what info we have
    console.log(`🔍 [Sofia AI] Current booking info:`, flow.collectedInfo);
    
  } catch (error) {
    console.error('❌ [Sofia AI] Error processing conversation:', error);
    await bot.sendMessage(chatId, "I apologize for the technical hiccup! I'm Sofia, your AI hostess. How can I help you with a reservation today? 😊");
  }
}

// Helper function to check if booking info is complete
function hasCompleteBookingInfo(info: any): boolean {
  return !!(info.date && info.time && info.guests && info.name && info.phone);
}

// Initialize bot for a restaurant
export async function initializeTelegramBot(restaurantId: number): Promise<boolean> {
  try {
    // Stop existing bot if running
    const existingBot = activeBots.get(restaurantId);
    if (existingBot) {
      console.log(`🔄 [Sofia AI] Stopping existing bot for restaurant ${restaurantId}`);
      await existingBot.stopPolling();
      activeBots.delete(restaurantId);
    }

    const settings = await storage.getIntegrationSettings(restaurantId, 'telegram');
    
    if (!settings?.enabled || !settings?.token) {
      console.log(`⚠️ [Sofia AI] No bot token found for restaurant ${restaurantId}`);
      return false;
    }

    console.log(`🚀 [Sofia AI] Initializing conversation bot for restaurant ${restaurantId}`);
    const token = settings.token;
    const bot = new TelegramBot(token, { polling: true });

    // Store bot instance
    activeBots.set(restaurantId, bot);

    // Handle incoming messages with Sofia's AI
    bot.on('message', async (msg) => {
      if (msg.text && msg.chat.id && !msg.text.startsWith('/processed_')) {
        console.log(`📱 [Sofia AI] Received message: "${msg.text}" from chat ${msg.chat.id}`);
        await handleMessage(bot, restaurantId, msg.chat.id, msg.text);
      }
    });

    // Handle polling errors
    bot.on('polling_error', (error) => {
      console.error(`❌ [Sofia AI] Polling error for restaurant ${restaurantId}:`, error);
    });

    // Handle general errors
    bot.on('error', (error) => {
      console.error(`❌ [Sofia AI] Bot error for restaurant ${restaurantId}:`, error);
    });

    console.log(`✅ [Sofia AI] Conversation bot initialized and listening for restaurant ${restaurantId}`);
    return true;

  } catch (error) {
    console.error(`❌ [Telegram] Failed to initialize bot for restaurant ${restaurantId}:`, error);
    return false;
  }
}

// Stop bot for a restaurant
export function stopTelegramBot(restaurantId: number): void {
  const bot = activeBots.get(restaurantId);
  if (bot) {
    bot.stopPolling();
    activeBots.delete(restaurantId);
    console.log(`🛑 [Telegram] Bot stopped for restaurant ${restaurantId}`);
  }
}

// Get bot instance for a restaurant
export function getTelegramBot(restaurantId: number): TelegramBot | undefined {
  return activeBots.get(restaurantId);
}

// Send message to specific chat
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

// Setup telegram bot (legacy function name)
export async function setupTelegramBot(token?: string, restaurantId?: number): Promise<boolean> {
  if (token && restaurantId) {
    console.log(`✅ [Telegram] Setting up bot for restaurant ${restaurantId}`);
    return true;
  }
  return false;
}

// Initialize all restaurant bots
export async function initializeAllTelegramBots(): Promise<void> {
  try {
    // For now, initialize for demo restaurant (ID: 1)
    // In production, this would load all restaurants with Telegram integration
    await initializeTelegramBot(1);
  } catch (error) {
    console.error('❌ [Telegram] Failed to initialize bots:', error);
  }
}