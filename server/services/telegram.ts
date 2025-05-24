import TelegramBot from 'node-telegram-bot-api';
import { storage } from '../storage';

// Store active bots by restaurant ID
const activeBots = new Map<number, TelegramBot>();

// Sofia AI Message Processing
async function handleMessage(bot: TelegramBot, restaurantId: number, chatId: number, text: string) {
  try {
    console.log(`📱 [Telegram] Processing message from ${chatId}: "${text}"`);
    
    // Simple response for now while we fix imports
    const response = "Hello! I'm Sofia, your AI hostess. I'm currently experiencing some technical updates but will be back to help you with reservations very soon!";
    
    // Send Sofia's response back to guest
    await bot.sendMessage(chatId, response);
    
  } catch (error) {
    console.error('❌ [Telegram] Error processing message:', error);
    await bot.sendMessage(chatId, "I apologize, but I'm experiencing technical difficulties. Please try again in a moment.");
  }
}

// Initialize bot for a restaurant
export async function initializeTelegramBot(restaurantId: number): Promise<boolean> {
  try {
    const settings = await storage.getIntegrationSettings(restaurantId, 'telegram');
    
    if (!settings?.settings || typeof settings.settings !== 'object' || !('token' in settings.settings)) {
      console.log(`⚠️ [Telegram] No bot token found for restaurant ${restaurantId}`);
      return false;
    }

    const token = (settings.settings as any).token as string;
    const bot = new TelegramBot(token, { polling: true });

    // Store bot instance
    activeBots.set(restaurantId, bot);

    // Handle incoming messages
    bot.on('message', async (msg) => {
      if (msg.text && msg.chat.id) {
        await handleMessage(bot, restaurantId, msg.chat.id, msg.text);
      }
    });

    // Handle errors
    bot.on('error', (error) => {
      console.error(`❌ [Telegram] Bot error for restaurant ${restaurantId}:`, error);
    });

    console.log(`✅ [Telegram] Bot initialized for restaurant ${restaurantId}`);
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