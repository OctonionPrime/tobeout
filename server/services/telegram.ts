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
  console.log(`🚀 Setting up Telegram bot for restaurant ${restaurantId}`);
  
  // Check if a bot is already running for this restaurant
  if (activeBots.has(restaurantId)) {
    console.log(`🛑 Stopping existing bot for restaurant ${restaurantId}`);
    // Stop the existing bot
    const existingBot = activeBots.get(restaurantId);
    existingBot?.stopPolling();
    activeBots.delete(restaurantId);
  }

  // Create a new bot
  console.log(`🤖 Creating new Telegram bot with token: ${token.substring(0, 10)}...`);
  const bot = new TelegramBot(token, { polling: true });
  activeBots.set(restaurantId, bot);
  console.log(`✅ Bot created and added to active bots for restaurant ${restaurantId}`);

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
    console.log(`📱 Telegram message received: "${message}" from chat ${chatId}`);
    
    const context = getOrCreateContext(chatId, restaurantId);
    
    try {
      // Try to detect reservation intent
      console.log('🔍 Detecting reservation intent...');
      const intent = await detectReservationIntent(message);
      console.log('🔍 Intent detected:', intent);
    
      // If it's likely a reservation request (confidence > 0.5) or we're in collecting info stage
      if (intent.confidence > 0.5 || context.stage === 'collecting_info') {
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
      
        // Merge the new intent with existing context (only update if new value is provided)
        if (intent.date && intent.date !== 'NOT_SPECIFIED') context.partialIntent.date = intent.date;
        if (intent.time && intent.time !== 'NOT_SPECIFIED') context.partialIntent.time = intent.time;
        if (intent.guests && intent.guests > 0) context.partialIntent.guests = intent.guests;
        if (intent.name && intent.name !== 'NOT_SPECIFIED') context.partialIntent.name = intent.name;
        if (intent.phone && intent.phone !== 'NOT_SPECIFIED') context.partialIntent.phone = intent.phone;
        if (intent.special_requests && intent.special_requests !== 'NOT_SPECIFIED' && intent.special_requests !== 'NONE') {
          context.partialIntent.special_requests = intent.special_requests;
        }
        
        // Move to collecting info stage
        context.stage = 'collecting_info';

        // Check if we have all the required fields for a reservation
        const { date, time, guests, name, phone } = context.partialIntent;
        
        console.log('🔍 Telegram bot checking reservation data:', { date, time, guests, name, phone });
        
        if (date && time && guests && name && phone) {
          console.log('✅ All data present, creating reservation...');
          // We have all the information, try to create the reservation using internal storage
          try {
            // Use the dedicated Telegram booking service that bypasses authentication  
            const { createTelegramReservation } = await import('./telegram-booking');
            
            const bookingResult = await createTelegramReservation(
              restaurantId,
              date,
              time,
              guests,
              name,
              phone,
              context.partialIntent.special_requests || ''
            );
            
            if (bookingResult.success) {
              console.log('✅ Booking successful with smart table assignment:', bookingResult);

              // Invalidate cache so dashboard shows new booking immediately
              const { CacheInvalidation } = await import('../cache');
              CacheInvalidation.onReservationChange(restaurantId, date);

              // Generate intelligent confirmation with table details
              const tableInfo = bookingResult.reservation?.table 
                ? `Table ${bookingResult.reservation.table.name}` 
                : 'a perfect table';
                
              const confirmationMessage = `🎉 Perfect! Your reservation is confirmed for ${guests} ${guests === 1 ? 'person' : 'people'} on ${new Date(date).toLocaleDateString()} at ${time}.

We've assigned you ${tableInfo} and everything is ready for your visit.

Thank you for choosing ${restaurant.name}! We look forward to serving you.

Warm regards,
${restaurant.name} Team`;

              bot.sendMessage(chatId, confirmationMessage);
              
              // Reset context after successful booking
              context.stage = 'initial';
              context.partialIntent = undefined;
              
            } else {
              // Handle conflicts or no availability with smart alternatives
              console.log('❌ Booking failed, checking for alternatives:', bookingResult);
              
              if (bookingResult.alternatives && bookingResult.alternatives.length > 0) {
                const alternativesList = bookingResult.alternatives
                  .slice(0, 3) // Show top 3 alternatives
                  .map((alt: any, index: number) => 
                    `${index + 1}. ${alt.time} - Table ${alt.table?.name || alt.tableId} (${alt.table?.capacity || 'Available'} seats)`
                  ).join('\n');

                const alternativesMessage = `I'm sorry ${name}, but ${time} on ${new Date(date).toLocaleDateString()} is not available for ${guests} ${guests === 1 ? 'person' : 'people'}.

However, I have these great alternatives for the same day:

${alternativesList}

Would you like me to book one of these times instead? Just tell me which number you prefer, or ask for different options!`;
                
                bot.sendMessage(chatId, alternativesMessage);
                
                // Update context to handle alternative selection
                context.stage = 'suggesting_alternatives';
                context.suggestedSlots = bookingResult.alternatives;
                
              } else {
                const noAvailabilityMessage = `I'm sorry ${name}, but we don't have availability for ${guests} ${guests === 1 ? 'person' : 'people'} at ${time} on ${new Date(date).toLocaleDateString()}.

Would you like me to suggest some alternative dates or times? I'd be happy to help you find the perfect slot!`;
                
                bot.sendMessage(chatId, noAvailabilityMessage);
                
                // Reset context to allow new booking attempt
                context.stage = 'initial';
                context.partialIntent = undefined;
              }
            }
          } catch (error) {
            console.error('❌ Error creating reservation:', error);
            bot.sendMessage(chatId, 'Sorry, I encountered an error while trying to make your reservation. Please try again.');
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
          openingHours: "Please contact us for our opening hours",
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
        console.log('💬 Handling general conversation with AI...');
        const restaurantInfo = {
          address: restaurant.address || undefined,
          openingHours: "Please contact us for our opening hours",
          cuisine: restaurant.cuisine || undefined,
          phoneNumber: restaurant.phone || undefined,
          description: restaurant.description || undefined
        };
        
        console.log('🤖 Calling generateResponseToGeneralInquiry...');
        const response = await generateResponseToGeneralInquiry(
          message,
          restaurant.name,
          restaurantInfo
        );
        console.log('🤖 AI Response received:', response);
        
        bot.sendMessage(
          chatId,
          response || `Would you like to make a reservation at ${restaurant.name}? Just let me know the date, time, and number of guests, and I'll check availability for you.`
        );
      }
    } catch (error) {
      console.error('❌ Error in Telegram message handler:', error);
      bot.sendMessage(chatId, 'Sorry, I encountered an error. Please try again.');
    }
  });

  return bot;
}
