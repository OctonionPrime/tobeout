import TelegramBot from 'node-telegram-bot-api';
import { storage } from '../storage';
import { detectReservationIntent, suggestAlternativeSlots, generateReservationConfirmation } from './openai';
import { format } from 'date-fns';

const activeBots = new Map<number, TelegramBot>();

export async function setupTelegramBot(token: string, restaurantId: number) {
  // Check if a bot is already running for this restaurant
  if (activeBots.has(restaurantId)) {
    // Stop the existing bot
    const existingBot = activeBots.get(restaurantId);
    existingBot?.stopPolling();
    activeBots.delete(restaurantId);
  }

  // Create a new bot
  const bot = new TelegramBot(token, { polling: true });
  activeBots.set(restaurantId, bot);

  // Get restaurant info
  const restaurant = await storage.getRestaurant(restaurantId);
  if (!restaurant) {
    throw new Error(`Restaurant with ID ${restaurantId} not found`);
  }

  // Handle start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
      chatId,
      `Welcome to ${restaurant.name}'s reservation assistant! I can help you with making a new reservation, modifying an existing one, or answering questions about the restaurant. How can I help you today?`
    );
  });

  // Handle help command
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
      chatId,
      `I can help you with:
      
1. Making a reservation - just tell me when you'd like to visit and how many people.
2. Changing or canceling a reservation - let me know your phone number and what you'd like to change.
3. Information about the restaurant - ask about hours, location, or menu.

What would you like to do?`
    );
  });

  // Handle reservation intent
  bot.on('message', async (msg) => {
    // Skip commands
    if (msg.text?.startsWith('/')) {
      return;
    }

    const chatId = msg.chat.id;
    const message = msg.text || '';
    
    // Try to detect reservation intent
    const intent = await detectReservationIntent(message);
    
    // If it's likely a reservation request (confidence > 0.7)
    if (intent.confidence > 0.7) {
      // Log AI activity
      await storage.logAiActivity({
        restaurantId,
        type: 'telegram_reservation_intent',
        description: `Detected reservation intent from Telegram user ${msg.from?.first_name || 'Unknown'}`,
        data: { intent, chatId, userId: msg.from?.id }
      });

      // Check if we have all the required fields for a reservation
      if (intent.date && intent.time && intent.guests && intent.name && intent.phone) {
        // We have all the information, check if the requested time is available
        const alternatives = await suggestAlternativeSlots(
          restaurantId,
          intent.date,
          intent.time,
          intent.guests
        );

        if (alternatives.length > 0) {
          // Find or create guest
          let guest = await storage.getGuestByPhone(intent.phone);
          
          if (!guest) {
            guest = await storage.createGuest({
              name: intent.name,
              phone: intent.phone,
              language: 'en',  // Default, could be detected from message
            });
          }

          // Create the reservation with the first alternative
          const slot = alternatives[0];
          const reservation = await storage.createReservation({
            restaurantId,
            guestId: guest.id,
            tableId: slot.tableId,
            timeslotId: slot.timeslotId,
            date: slot.date,
            time: slot.time,
            guests: intent.guests,
            status: 'created',
            comments: intent.special_requests || '',
            source: 'telegram'
          });

          // Generate confirmation message
          const confirmationMessage = await generateReservationConfirmation(
            intent.name,
            slot.date,
            slot.time,
            intent.guests,
            restaurant.name
          );

          // Send confirmation
          bot.sendMessage(chatId, confirmationMessage);
          
          // Notify restaurant staff
          const staffMessage = `
📅 New Reservation (via Telegram)
            
👤 ${intent.name}
📞 ${intent.phone}
🕒 ${format(new Date(`${slot.date}T${slot.time}`), 'PPpp')}
👥 ${intent.guests} guests
          `;
          
          // TODO: Send notification to restaurant staff (could be via a separate chat)
        } else {
          // No availability for the requested time
          bot.sendMessage(
            chatId,
            `I'm sorry, but we don't have availability for ${intent.guests} guests on ${intent.date} at ${intent.time}. Would you like to try a different time or date?`
          );
        }
      } else {
        // Missing information, ask for it
        const missingFields = [];
        if (!intent.date) missingFields.push("date");
        if (!intent.time) missingFields.push("time");
        if (!intent.guests) missingFields.push("number of guests");
        if (!intent.name) missingFields.push("your name");
        if (!intent.phone) missingFields.push("phone number");

        bot.sendMessage(
          chatId,
          `I'd be happy to make a reservation for you! I just need a bit more information: ${missingFields.join(", ")}. Could you please provide these details?`
        );
      }
    } else {
      // General conversation
      bot.sendMessage(
        chatId,
        `Would you like to make a reservation at ${restaurant.name}? Just let me know the date, time, and number of guests, and I'll check availability for you.`
      );
    }
  });

  return bot;
}
