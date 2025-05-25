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

// Sofia AI Message Processing with full conversation intelligence and availability checking
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

    // ✨ NEW: Check if we need to verify availability after processing
    const availabilityCheck = conversation.shouldCheckAvailability();

    if (availabilityCheck.needsCheck && availabilityCheck.date) {
      console.log(`🔍 [Sofia AI] Checking availability for ${availabilityCheck.date} with ${availabilityCheck.guests} guests`);

      try {
        // Quick availability check to see if ANY tables exist for this date
        const availableSlots = await getAvailableTimeSlots(
          restaurantId,
          availabilityCheck.date,
          availabilityCheck.guests || 2, // Default to 2 guests if not specified
          { maxResults: 1 } // Just check if ANY slots exist
        );

        const hasAvailability = availableSlots.length > 0;
        console.log(`📊 [Sofia AI] Availability check result: ${hasAvailability ? 'Available' : 'Fully booked'}`);

        // Get the appropriate response based on availability
        const availabilityResponse = conversation.handleAvailabilityResult(hasAvailability);

        if (!hasAvailability) {
          // No availability - send the "fully booked" message and stop
          await bot.sendMessage(chatId, availabilityResponse);
          return;
        } else {
          // Has availability - send the confirmation message instead of the original response
          await bot.sendMessage(chatId, availabilityResponse);
          return;
        }

      } catch (error) {
        console.error('❌ [Sofia AI] Error checking availability:', error);
        // If availability check fails, continue with original response
        await bot.sendMessage(chatId, response);
        return;
      }
    }

    // Get current conversation flow for booking logic
    const flow = conversation.getConversationFlow();

    // For Telegram, if we have name, date, time, guests but no phone, use chat ID as contact
    if (flow.stage === 'confirming' && flow.collectedInfo.name && flow.collectedInfo.date && 
        flow.collectedInfo.time && flow.collectedInfo.guests && !flow.collectedInfo.phone) {
      flow.collectedInfo.phone = `telegram_${chatId}`;
    }

    // Check if we have all booking info and should proceed to reservation
    if (hasCompleteBookingInfo(flow.collectedInfo) && (flow.stage === 'confirming' || flow.stage === 'collecting')) {
      console.log(`🎯 [Sofia AI] All booking info collected, attempting reservation`);

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
          console.log(`✅ [Sofia AI] Reservation confirmed and conversation cleared for chat ${chatId}`);
          return;
        } else {
          // Booking failed - offer alternatives
          console.log(`⚠️ [Sofia AI] Booking failed: ${result.message}, offering alternatives`);

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
        return;
      }
    }

    // Handle alternative selection (when user picks a number from alternatives)
    if (flow.stage === 'suggesting_alternatives' && /^[1-3]$/.test(text.trim())) {
      console.log(`🔢 [Sofia AI] User selected alternative option: ${text}`);

      try {
        const alternatives = await getAvailableTimeSlots(
          restaurantId,
          flow.collectedInfo.date!,
          flow.collectedInfo.guests!,
          { maxResults: 3 }
        );

        const selectedIndex = parseInt(text.trim()) - 1;
        if (selectedIndex >= 0 && selectedIndex < alternatives.length) {
          const selectedSlot = alternatives[selectedIndex];

          // Update conversation with selected time
          flow.collectedInfo.time = selectedSlot.time;

          // Attempt booking with selected alternative
          const result = await createTelegramReservation(
            restaurantId,
            flow.collectedInfo.date!,
            selectedSlot.time,
            flow.collectedInfo.guests!,
            flow.collectedInfo.name!,
            flow.collectedInfo.phone || `telegram_${chatId}`,
            flow.collectedInfo.special_requests
          );

          if (result.success) {
            const confirmationMessage = `🎉 Excellent choice! Your reservation is confirmed!\n\n✨ ${result.message}\n\nWe're excited to welcome you! 🥂`;
            await bot.sendMessage(chatId, confirmationMessage);
            activeConversations.delete(chatId);
            return;
          } else {
            await bot.sendMessage(chatId, `I'm sorry, but that time slot just became unavailable. Let me check for other options... 🔄`);
            return;
          }
        }
      } catch (error) {
        console.error('❌ [Sofia AI] Error handling alternative selection:', error);
        await bot.sendMessage(chatId, "Let me help you find another option. What time would you prefer?");
        return;
      }
    }

    // Send Sofia's intelligent response
    await bot.sendMessage(chatId, response);
    console.log(`✅ [Sofia AI] Sent response to ${chatId}`);

    // Debug: Log what info we have
    console.log(`🔍 [Sofia AI] Current booking info:`, flow.collectedInfo);
    console.log(`🔍 [Sofia AI] Flow stage:`, flow.stage);
    console.log(`🔍 [Sofia AI] Has complete info:`, hasCompleteBookingInfo(flow.collectedInfo));

  } catch (error) {
    console.error('❌ [Sofia AI] Error processing conversation:', error);
    await bot.sendMessage(chatId, "I apologize for the technical hiccup! I'm Sofia, your AI hostess. How can I help you with a reservation today? 😊");
  }
}

// Helper function to check if booking info is complete
function hasCompleteBookingInfo(info: any): boolean {
  return !!(info.date && info.time && info.guests && info.name && info.phone);
}

// Enhanced message for when someone starts fresh conversation
async function sendWelcomeMessage(bot: TelegramBot, chatId: number) {
  const welcomeMessage = `🌟 Hello! Welcome to Demo Restaurant! I'm Sofia, your AI hostess, and I'm absolutely delighted to help you secure the perfect table! ✨

I can assist you with making a reservation right now. Just let me know:
• When you'd like to dine 📅
• How many guests will be joining you 👥
• Your preferred time ⏰

I'll take care of everything else! 🥂

What sounds good to you?`;

  await bot.sendMessage(chatId, welcomeMessage);
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

    // Handle /start command
    bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      console.log(`🎬 [Sofia AI] /start command from chat ${chatId}`);

      // Clear any existing conversation
      activeConversations.delete(chatId);

      // Send welcome message
      await sendWelcomeMessage(bot, chatId);
    });

    // Handle /help command
    bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;
      const helpMessage = `🆘 **How I can help you:**

I'm Sofia, your AI restaurant assistant! I can help you:

✅ Make reservations
✅ Check table availability  
✅ Find alternative times
✅ Answer questions about dining

**Just tell me:**
• What date you'd like to visit
• Your preferred time
• How many people
• Your name

I'll handle the rest! 

**Commands:**
/start - Start fresh conversation
/help - Show this help
/cancel - Cancel current booking

Ready to make a reservation? Just tell me what you need! 😊`;

      await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
    });

    // Handle /cancel command
    bot.onText(/\/cancel/, async (msg) => {
      const chatId = msg.chat.id;
      console.log(`❌ [Sofia AI] /cancel command from chat ${chatId}`);

      // Clear conversation
      activeConversations.delete(chatId);

      await bot.sendMessage(chatId, "No worries! I've cleared our conversation. Feel free to start fresh whenever you're ready to make a reservation! 😊");
    });

    // Handle incoming messages with Sofia's AI
    bot.on('message', async (msg) => {
      // Skip commands (already handled above)
      if (msg.text && msg.text.startsWith('/')) {
        return;
      }

      if (msg.text && msg.chat.id && !msg.text.startsWith('/processed_')) {
        console.log(`📱 [Sofia AI] Received message: "${msg.text}" from chat ${msg.chat.id}`);
        await handleMessage(bot, restaurantId, msg.chat.id, msg.text);
      }
    });

    // Handle polling errors gracefully
    bot.on('polling_error', (error) => {
      console.error(`❌ [Sofia AI] Polling error for restaurant ${restaurantId}:`, error.message);
      // Don't crash - just log and continue
    });

    // Handle general errors gracefully
    bot.on('error', (error) => {
      console.error(`❌ [Sofia AI] Bot error for restaurant ${restaurantId}:`, error.message);
      // Don't crash - just log and continue
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

// Send availability notification to specific chat (NEW)
export async function sendAvailabilityNotification(
  restaurantId: number,
  chatId: number,
  date: string,
  availableSlots: any[]
): Promise<boolean> {
  try {
    const bot = activeBots.get(restaurantId);
    if (!bot) {
      console.error(`❌ [Telegram] No bot found for restaurant ${restaurantId}`);
      return false;
    }

    let message = `🎉 Good news! I found availability for ${date}:\n\n`;
    availableSlots.slice(0, 5).forEach((slot, index) => {
      message += `${index + 1}. ${slot.timeDisplay} at Table ${slot.tableName}\n`;
    });
    message += `\nWhich option interests you? Just reply with the number! 🎯`;

    await bot.sendMessage(chatId, message);
    return true;
  } catch (error) {
    console.error(`❌ [Telegram] Failed to send availability notification:`, error);
    return false;
  }
}

// Setup telegram bot (keep existing function signature for compatibility)
export async function setupTelegramBot(token?: string, restaurantId?: number): Promise<boolean> {
  if (token && restaurantId) {
    console.log(`✅ [Telegram] Setting up bot for restaurant ${restaurantId}`);
    // Use the main initialization function
    return await initializeTelegramBot(restaurantId);
  }
  return false;
}

// Initialize all restaurant bots (keep existing function signature)
export async function initializeAllTelegramBots(): Promise<void> {
  try {
    // For now, initialize for demo restaurant (ID: 1)
    // In production, this would load all restaurants with Telegram integration
    await initializeTelegramBot(1);
    console.log(`🌟 [Sofia AI] All restaurant bots initialized successfully`);
  } catch (error) {
    console.error('❌ [Telegram] Failed to initialize bots:', error);
  }
}

// Cleanup function for graceful shutdown
export function cleanupTelegramBots(): void {
  console.log(`🧹 [Telegram] Cleaning up ${activeBots.size} active bots...`);

  for (const [restaurantId, bot] of activeBots.entries()) {
    try {
      bot.stopPolling();
      console.log(`✅ [Telegram] Stopped bot for restaurant ${restaurantId}`);
    } catch (error) {
      console.error(`❌ [Telegram] Error stopping bot for restaurant ${restaurantId}:`, error);
    }
  }

  activeBots.clear();
  activeConversations.clear();
  console.log(`✅ [Telegram] Cleanup completed`);
}

// Get conversation statistics (NEW - for monitoring)
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