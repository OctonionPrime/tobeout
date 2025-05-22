import TelegramBot from 'node-telegram-bot-api';
import { storage } from '../storage';
import { 
  detectReservationIntent, 
  suggestAlternativeSlots, 
  generateReservationConfirmation,
  generateAlternativeSuggestionMessage,
  generateResponseToGeneralInquiry
} from './openai';
import { format } from 'date-fns';

// Store active bots by restaurant ID
const activeBots = new Map<number, TelegramBot>();

// Store conversation contexts by chat ID
interface ConversationContext {
  stage: 'initial' | 'collecting_info' | 'confirming_reservation' | 'suggesting_alternatives';
  partialIntent?: {
    date?: string;
    time?: string;
    guests?: number;
    name?: string;
    phone?: string;
    special_requests?: string;
  };
  lastMessageTimestamp: number;
  restaurantId: number;
  suggestedSlots?: any[];
}

const conversationContexts = new Map<number, ConversationContext>();

// Helper to get or create a conversation context
function getOrCreateContext(chatId: number, restaurantId: number): ConversationContext {
  if (!conversationContexts.has(chatId)) {
    conversationContexts.set(chatId, {
      stage: 'initial',
      lastMessageTimestamp: Date.now(),
      restaurantId
    });
  }
  
  const context = conversationContexts.get(chatId)!;
  // Update timestamp
  context.lastMessageTimestamp = Date.now();
  return context;
}

// Clear old conversations periodically (every hour)
setInterval(() => {
  const now = Date.now();
  const timeout = 3600000; // 1 hour in milliseconds
  
  conversationContexts.forEach((context, chatId) => {
    if (now - context.lastMessageTimestamp > timeout) {
      conversationContexts.delete(chatId);
    }
  });
}, 3600000);

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
    // Reset context
    const context = getOrCreateContext(chatId, restaurantId);
    context.stage = 'initial';
    context.partialIntent = undefined;
    
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

  // Handle message
  bot.on('message', async (msg) => {
    // Skip commands
    if (msg.text?.startsWith('/')) {
      return;
    }

    const chatId = msg.chat.id;
    const message = msg.text || '';
    const context = getOrCreateContext(chatId, restaurantId);
    
    // Try to detect reservation intent
    const intent = await detectReservationIntent(message);
    
    // If it's likely a reservation request (confidence > 0.7) or we're in collecting info stage
    if (intent.confidence > 0.7 || context.stage === 'collecting_info') {
      // Log AI activity
      await storage.logAiActivity({
        restaurantId,
        type: 'telegram_reservation_intent',
        description: `Processed reservation intent from Telegram user ${msg.from?.first_name || 'Unknown'}`,
        data: { intent, chatId, userId: msg.from?.id, contextStage: context.stage }
      });

      // Update context with new information
      if (!context.partialIntent) {
        context.partialIntent = {};
      }
      
      // Merge the new intent with existing context
      if (intent.date) context.partialIntent.date = intent.date;
      if (intent.time) context.partialIntent.time = intent.time;
      if (intent.guests) context.partialIntent.guests = intent.guests;
      if (intent.name) context.partialIntent.name = intent.name;
      if (intent.phone) context.partialIntent.phone = intent.phone;
      if (intent.special_requests) context.partialIntent.special_requests = intent.special_requests;
      
      // Move to collecting info stage
      context.stage = 'collecting_info';

      // Check if we have all the required fields for a reservation
      const { date, time, guests, name, phone } = context.partialIntent;
      
      if (date && time && guests && name && phone) {
        // We have all the information, check if the requested time is available
        const alternatives = await suggestAlternativeSlots(
          restaurantId,
          date,
          time,
          guests
        );

        if (alternatives.length > 0) {
          // Find or create guest
          let guest = await storage.getGuestByPhone(phone);
          
          if (!guest) {
            guest = await storage.createGuest({
              name,
              phone,
              email: '',
              language: 'en'  // Default
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
            guests,
            status: 'created',
            comments: context.partialIntent.special_requests || '',
            source: 'telegram'
          });

          // Generate confirmation message
          const confirmationMessage = await generateReservationConfirmation(
            name,
            slot.date,
            slot.time,
            guests,
            restaurant.name
          );

          // Send confirmation
          bot.sendMessage(chatId, confirmationMessage || `Your reservation is confirmed for ${guests} people on ${slot.date} at ${slot.time}.`);
          
          // Notify restaurant staff
          const staffMessage = `
📅 New Reservation (via Telegram)
            
👤 ${name}
📞 ${phone}
🕒 ${format(new Date(`${slot.date}T${slot.time}`), 'PPpp')}
👥 ${guests} guests
${context.partialIntent.special_requests ? `🔔 Special requests: ${context.partialIntent.special_requests}` : ''}
          `;
          
          // TODO: Send notification to restaurant staff (could be via a separate chat)
          
          // Reset context
          context.stage = 'initial';
          context.partialIntent = undefined;
        } else {
          // No availability for the requested time
          context.stage = 'suggesting_alternatives';
          
          // Check for other possible times
          const otherDateAlternatives = await suggestAlternativeSlots(
            restaurantId,
            // Try the next day
            new Date(new Date(date).getTime() + 86400000).toISOString().split('T')[0],
            time,
            guests
          );
          
          // Generate suggestion message
          const suggestionMessage = await generateAlternativeSuggestionMessage(
            restaurant.name,
            date,
            time,
            guests,
            otherDateAlternatives
          );
          
          bot.sendMessage(
            chatId,
            suggestionMessage || `I'm sorry, but we don't have availability for ${guests} guests on ${date} at ${time}. Would you like to try a different time or date?`
          );
          
          // Save alternatives for later reference
          context.suggestedSlots = otherDateAlternatives;
        }
      } else {
        // Missing information, ask for it
        const missingFields = [];
        if (!date) missingFields.push("date");
        if (!time) missingFields.push("time");
        if (!guests) missingFields.push("number of guests");
        if (!name) missingFields.push("your name");
        if (!phone) missingFields.push("phone number");

        bot.sendMessage(
          chatId,
          `I'd be happy to make a reservation for you! I just need a bit more information: ${missingFields.join(", ")}. Could you please provide these details?`
        );
      }
    } else if (context.stage === 'suggesting_alternatives') {
      // User is responding to our alternative suggestions
      // Try to detect if they want one of the alternatives
      
      // Reset context as we're switching to a new conversation
      context.stage = 'initial';
      context.partialIntent = undefined;
      context.suggestedSlots = undefined;
      
      // Respond with a general message
      const restaurantInfo = {
        address: restaurant.address || undefined,
        openingHours: restaurant.openingTime && restaurant.closingTime 
          ? `${restaurant.openingTime} - ${restaurant.closingTime}`
          : undefined,
        cuisine: restaurant.cuisine || undefined,
        phoneNumber: restaurant.phone || undefined,
        description: restaurant.description || undefined
      };
      
      const response = await generateResponseToGeneralInquiry(
        message,
        restaurant.name,
        restaurantInfo
      );
      
      bot.sendMessage(chatId, response || 'Thank you for your message. Is there anything else I can help you with?');
    } else {
      // General conversation - respond based on restaurant info
      const restaurantInfo = {
        address: restaurant.address || undefined,
        openingHours: restaurant.openingTime && restaurant.closingTime 
          ? `${restaurant.openingTime} - ${restaurant.closingTime}`
          : undefined,
        cuisine: restaurant.cuisine || undefined,
        phoneNumber: restaurant.phone || undefined,
        description: restaurant.description || undefined
      };
      
      const response = await generateResponseToGeneralInquiry(
        message,
        restaurant.name,
        restaurantInfo
      );
      
      bot.sendMessage(
        chatId,
        response || `Would you like to make a reservation at ${restaurant.name}? Just let me know the date, time, and number of guests, and I'll check availability for you.`
      );
    }
  });

  return bot;
}
