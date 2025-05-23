import TelegramBot from 'node-telegram-bot-api';
import { storage } from '../storage';
import { 
  detectReservationIntent,
  detectReservationIntentWithContext,
  suggestAlternativeSlots, 
  generateReservationConfirmation,
  generateAlternativeSuggestionMessage,
  generateResponseToGeneralInquiry
} from './openai';
import { ConversationManager } from './conversation-manager';
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
  lastRequestedGuests?: number;

  // Enhanced conversation management
  messageHistory: string[]; // Track recent messages
  repetitionCount: number; // Count how many times we asked for same info
  lastAskedFor: string | null; // What we last asked for
  userFrustrationLevel: number; // 0-5 scale
  conversationId: string; // Unique conversation identifier
}

const conversationContexts = new Map<number, ConversationContext>();

// Helper to get or create a conversation context
function getOrCreateContext(chatId: number, restaurantId: number): ConversationContext {
  if (!conversationContexts.has(chatId)) {
    conversationContexts.set(chatId, {
      stage: 'initial',
      lastMessageTimestamp: Date.now(),
      restaurantId,
      partialIntent: {},
      suggestedSlots: [],
      lastRequestedGuests: undefined,
      // Enhanced conversation management
      messageHistory: [],
      repetitionCount: 0,
      lastAskedFor: null,
      userFrustrationLevel: 0,
      conversationId: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
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
    context.partialIntent = {};
    context.messageHistory = [];
    context.userFrustrationLevel = 0;
    context.repetitionCount = 0;
    context.lastAskedFor = null;

    // Get current time for personalized greeting
    const hour = new Date().getHours();
    let greeting = "Hello";
    if (hour < 12) greeting = "Good morning";
    else if (hour < 17) greeting = "Good afternoon";
    else greeting = "Good evening";

    bot.sendMessage(
      chatId,
      `${greeting}! Welcome to ${restaurant.name}'s reservation assistant! 😊\n\nI can help you with:\n• Making a new reservation\n• Modifying an existing reservation\n• Answering questions about the restaurant\n\nHow can I help you today?`
    );
  });

  // Handle help command
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
      chatId,
      `I can help you with:

1. 📅 Making a reservation - just tell me when you'd like to visit and how many people.
2. ✏️ Changing or canceling a reservation - let me know your phone number and what you'd like to change.
3. ℹ️ Information about the restaurant - ask about hours, location, or menu.

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

    // Add typing indicator for more natural feel
    bot.sendChatAction(chatId, 'typing');

    console.log(`📱 Telegram message received: "${message}" from chat ${chatId}`);

    const context = getOrCreateContext(chatId, restaurantId);

    // Update message history and detect loops
    context.messageHistory.push(message);
    if (context.messageHistory.length > 10) {
      context.messageHistory = context.messageHistory.slice(-10);
    }

    // Enhanced frustration detection
    const frustratedPhrases = [
      'told you', 'already said', 'just said', 'just told you', 
      'i said', 'mentioned', 'gave you', 'provided', 'i told',
      'already told', 'already gave', 'i already', 'already provided'
    ];
    const isFrustrated = frustratedPhrases.some(phrase => 
      message.toLowerCase().includes(phrase)
    );

    if (isFrustrated) {
      context.repetitionCount++;
      context.userFrustrationLevel = Math.min(5, context.userFrustrationLevel + 1);
    }

    try {
      // Use ENHANCED intent detection with full context
      console.log('🔍 Detecting reservation intent with context...');
      const intent = await detectReservationIntentWithContext(message, {
        messageHistory: context.messageHistory,
        partialIntent: context.partialIntent || {},
        lastAskedFor: context.lastAskedFor,
        userFrustrationLevel: context.userFrustrationLevel
      });
      console.log('🔍 Enhanced intent detected:', intent);

      // CRITICAL FIX: Handle frustration FIRST and book immediately if we have all data
      if (isFrustrated || intent.conversation_action === 'acknowledge_frustration') {
        console.log('😤 User is frustrated, generating apology...');
        const apologyResponse = ConversationManager.generateHumanResponse(
          { ...intent, conversation_action: 'acknowledge_frustration', guest_sentiment: 'frustrated' },
          {
            stage: context.stage as any,
            collectedInfo: context.partialIntent || {},
            conversationHistory: context.messageHistory,
            lastResponse: '',
            guestFrustrationLevel: context.userFrustrationLevel,
            responsesSent: context.messageHistory.length
          },
          message
        );

        bot.sendMessage(chatId, apologyResponse);

        // Reset frustration after acknowledgment but keep the context
        context.userFrustrationLevel = 0;
        context.repetitionCount = 0;

        // CRITICAL FIX: Check if we have all info after frustration and proceed IMMEDIATELY
        const { date, time, guests, name, phone } = context.partialIntent || {};

        console.log('🔍 After apology, checking data:', { date, time, guests, name, phone });

        if (date && time && guests && name && phone) {
          console.log('✅ Have all info after apology, booking IMMEDIATELY...');

          // Don't use setTimeout - book immediately
          try {
            bot.sendChatAction(chatId, 'typing'); // Show we're working

            const { createTelegramReservation } = await import('./telegram-booking');

            const bookingResult = await createTelegramReservation(
              restaurantId,
              date,
              time,
              guests,
              name,
              phone,
              context.partialIntent?.special_requests || ''
            );

            if (bookingResult.success) {
              const { CacheInvalidation } = await import('../cache');
              CacheInvalidation.onReservationChange(restaurantId, date);

              const tableInfo = bookingResult.reservation?.table 
                ? `Table ${bookingResult.reservation.table.name}` 
                : 'a perfect table';

              const confirmationMessage = `🎉 Perfect! Your reservation is confirmed for ${guests} ${guests === 1 ? 'person' : 'people'} on ${new Date(date).toLocaleDateString()} at ${time}.

We've assigned you ${tableInfo} and everything is ready for your visit.

Thank you for choosing ${restaurant.name}! We look forward to serving you.

Warm regards,
${restaurant.name} Team`;

              // Send confirmation immediately
              bot.sendMessage(chatId, confirmationMessage);

              // Reset context after successful booking
              context.stage = 'initial';
              context.partialIntent = {};
              context.userFrustrationLevel = 0;
              context.messageHistory = [];

              return; // Exit here - booking is complete
            } else {
              // Handle booking failure
              bot.sendMessage(chatId, `I'm sorry ${name}, but that time slot appears to be unavailable. Let me check for alternatives...`);

              // Try to find alternatives
              try {
                const alternatives = await suggestAlternativeSlots(restaurantId, date, guests, 3);
                if (alternatives && alternatives.length > 0) {
                  const alternativesList = alternatives
                    .map((alt: any, index: number) => 
                      `${index + 1}. ${alt.time} - Table ${alt.tableName}`
                    ).join('\n');

                  const alternativesMessage = `However, I have these great alternatives for the same day:\n\n${alternativesList}\n\nWould you like me to book one of these times instead? Just tell me which number you prefer! 🎯`;

                  bot.sendMessage(chatId, alternativesMessage);
                  context.stage = 'suggesting_alternatives';
                  context.suggestedSlots = alternatives;
                }
              } catch (altError) {
                console.error('Error finding alternatives after booking failure:', altError);
              }
            }
          } catch (error) {
            console.error('❌ Error booking after apology:', error);
            bot.sendMessage(chatId, 'Sorry, I encountered an error while trying to complete your reservation. Please try again.');
          }
        }
        return; // Always return after handling frustration
      }

      // If it's likely a reservation request (confidence > 0.5) or we're in collecting info stage
      if (intent.confidence > 0.5 || context.stage === 'collecting_info') {
        // Log AI activity
        await storage.logAiActivity({
          restaurantId,
          type: 'telegram_reservation_intent',
          description: `Processed reservation intent from Telegram user ${msg.from?.first_name || 'Unknown'}`,
          data: { intent, chatId, userId: msg.from?.id, contextStage: context.stage }
        });

        // SMART UPDATE: Only update fields that have NEW information
        if (!context.partialIntent) {
          context.partialIntent = {};
        }

        // Only update if the intent has actual new values (not null/undefined) AND different from existing
        if (intent.date && intent.date !== 'NOT_SPECIFIED' && intent.date !== context.partialIntent.date) {
          console.log(`📅 Updating date: ${context.partialIntent.date} → ${intent.date}`);
          context.partialIntent.date = intent.date;
        }
        if (intent.time && intent.time !== 'NOT_SPECIFIED' && intent.time !== context.partialIntent.time) {
          console.log(`⏰ Updating time: ${context.partialIntent.time} → ${intent.time}`);
          context.partialIntent.time = intent.time;
        }
        if (intent.guests && intent.guests > 0 && intent.guests !== context.partialIntent.guests) {
          console.log(`👥 Updating guests: ${context.partialIntent.guests} → ${intent.guests}`);
          context.partialIntent.guests = intent.guests;
        }
        if (intent.name && intent.name !== 'NOT_SPECIFIED' && intent.name !== context.partialIntent.name) {
          console.log(`👤 Updating name: ${context.partialIntent.name} → ${intent.name}`);
          context.partialIntent.name = intent.name;
        }
        if (intent.phone && intent.phone !== 'NOT_SPECIFIED' && intent.phone !== context.partialIntent.phone) {
          console.log(`📞 Updating phone: ${context.partialIntent.phone} → ${intent.phone}`);
          context.partialIntent.phone = intent.phone;
        }
        if (intent.special_requests && intent.special_requests !== 'NOT_SPECIFIED' && intent.special_requests !== 'NONE') {
          context.partialIntent.special_requests = intent.special_requests;
        }

        // Move to collecting info stage
        context.stage = 'collecting_info';

        // Check if we have all the required fields for a reservation
        const { date, time, guests, name, phone } = context.partialIntent;

        console.log('🔍 Checking reservation data:', { date, time, guests, name, phone });
        console.log('🔍 Full context:', JSON.stringify(context.partialIntent, null, 2));

        if (date && time && guests && name && phone) {
          console.log('✅ All data present, creating reservation...');

          // Show typing indicator while processing
          bot.sendChatAction(chatId, 'typing');

          // We have all the information, try to create the reservation
          try {
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

            // Store guest count for potential alternative suggestions
            context.lastRequestedGuests = guests;

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
              context.partialIntent = {};
              context.userFrustrationLevel = 0;
              context.messageHistory = [];

            } else {
              // Handle conflicts or no availability with smart alternatives
              console.log('❌ Booking failed, finding alternatives...');

              // Always find alternative times when booking fails
              try {
                const alternatives = await suggestAlternativeSlots(
                  restaurantId, 
                  date, 
                  guests,
                  5 // Get 5 alternatives
                );

                if (alternatives && alternatives.length > 0) {
                  const alternativesList = alternatives
                    .slice(0, 3) // Show top 3 alternatives
                    .map((alt: any, index: number) => 
                      `${index + 1}. ${alt.time} - Table ${alt.table?.name || alt.tableId} (${alt.table?.capacity || 'Available'} seats)`
                    ).join('\n');

                  const alternativesMessage = `I'm sorry ${name}, but ${time} on ${new Date(date).toLocaleDateString()} is not available for ${guests} ${guests === 1 ? 'person' : 'people'}. 😔

However, I have these great alternatives for the same day:

${alternativesList}

Would you like me to book one of these times instead? Just tell me which number you prefer! 🎯`;

                  bot.sendMessage(chatId, alternativesMessage);

                  // Update context to handle alternative selection - PRESERVE ALL INFO
                  context.stage = 'suggesting_alternatives';
                  context.suggestedSlots = alternatives;
                  context.lastRequestedGuests = guests;
                  // Keep all the guest info for rebooking
                  context.partialIntent = { date, time, guests, name, phone };

                } else {
                  const noAvailabilityMessage = `I'm sorry ${name}, but we don't have any availability for ${guests} ${guests === 1 ? 'person' : 'people'} on ${new Date(date).toLocaleDateString()}. 😔

Would you like me to check availability for a different date? I'd be happy to help you find the perfect slot! 📅`;

                  bot.sendMessage(chatId, noAvailabilityMessage);

                  // Keep context active for alternative date requests
                  context.stage = 'suggesting_alternatives';
                  context.lastRequestedGuests = guests;
                  context.partialIntent = { date, time, guests, name, phone };
                }
              } catch (error) {
                console.error('❌ Error finding alternatives:', error);
                const noAvailabilityMessage = `I'm sorry ${name}, but we don't have availability for ${guests} ${guests === 1 ? 'person' : 'people'} at ${time} on ${new Date(date).toLocaleDateString()}.

Would you like me to suggest some alternative dates or times? I'd be happy to help you find the perfect slot!`;

                bot.sendMessage(chatId, noAvailabilityMessage);

                // Reset context to allow new booking attempt
                context.stage = 'initial';
                context.partialIntent = {};
              }
            }
          } catch (error) {
            console.error('❌ Error creating reservation:', error);
            bot.sendMessage(chatId, 'Sorry, I encountered an error while trying to make your reservation. Please try again.');
          }
        } else {
          // We still need more information - use ENHANCED conversation management
          const conversationFlow = {
            stage: context.stage as any,
            collectedInfo: context.partialIntent || {},
            conversationHistory: context.messageHistory || [],
            lastResponse: '',
            guestFrustrationLevel: context.userFrustrationLevel || 0,
            responsesSent: context.messageHistory?.length || 0
          };

          // Generate human-like response using the enhanced AI
          const humanResponse = ConversationManager.generateHumanResponse(
            intent,
            conversationFlow,
            message
          );

          bot.sendMessage(chatId, humanResponse);

          // Track what we asked for to avoid repetition
          const missing = [];
          if (!context.partialIntent.date) missing.push('date');
          if (!context.partialIntent.time) missing.push('time');
          if (!context.partialIntent.guests) missing.push('guests');
          if (!context.partialIntent.name) missing.push('name');
          if (!context.partialIntent.phone) missing.push('phone');

          context.lastAskedFor = missing[0] || null;
        }
      } else if (context.stage === 'suggesting_alternatives') {
        // User is responding to our alternative suggestions - KEEP CONTEXT!
        console.log('🔄 User responding to alternatives, context:', context.partialIntent);

        // Check if user wants alternatives (yes, please, check, etc.)
        const wantsAlternatives = message.toLowerCase().includes('yes') || 
                                 message.toLowerCase().includes('please') ||
                                 message.toLowerCase().includes('check') ||
                                 message.toLowerCase().includes('alternative') ||
                                 message.toLowerCase().includes('available');

        // Check for number selection (1, 2, 3, etc.)
        const numberMatch = message.match(/\b([1-5])\b/);

        if (numberMatch && context.suggestedSlots && context.suggestedSlots.length > 0) {
          const selectedIndex = parseInt(numberMatch[1]) - 1;
          const selectedSlot = context.suggestedSlots[selectedIndex];

          if (selectedSlot && context.partialIntent) {
            // Book the selected alternative
            try {
              bot.sendChatAction(chatId, 'typing');

              const { createTelegramReservation } = await import('./telegram-booking');

              const bookingResult = await createTelegramReservation(
                restaurantId,
                selectedSlot.date,
                selectedSlot.time,
                context.partialIntent.guests!,
                context.partialIntent.name!,
                context.partialIntent.phone!,
                context.partialIntent.special_requests || ''
              );

              if (bookingResult.success) {
                const { CacheInvalidation } = await import('../cache');
                CacheInvalidation.onReservationChange(restaurantId, selectedSlot.date);

                const confirmationMessage = `🎉 Excellent! Your reservation is confirmed for ${context.partialIntent.guests} people on ${new Date(selectedSlot.date).toLocaleDateString()} at ${selectedSlot.time}.

Thank you for choosing ${restaurant.name}! We look forward to serving you.`;

                bot.sendMessage(chatId, confirmationMessage);

                // Reset context
                context.stage = 'initial';
                context.partialIntent = {};
                context.suggestedSlots = [];
                context.userFrustrationLevel = 0;
                context.messageHistory = [];
              } else {
                bot.sendMessage(chatId, `I'm sorry, that time slot is no longer available. Let me check for other options.`);
              }
            } catch (error) {
              console.error('❌ Error booking alternative:', error);
              bot.sendMessage(chatId, 'Sorry, I encountered an error. Please try again.');
            }
          }
        } else if (wantsAlternatives && context.lastRequestedGuests && context.partialIntent) {
          // Generate alternatives for the guest's original request
          console.log('🔍 Finding alternatives for:', context.partialIntent);

          try {
            bot.sendChatAction(chatId, 'typing');

            const alternatives = await suggestAlternativeSlots(
              restaurantId, 
              context.partialIntent.date || new Date().toISOString().split('T')[0], 
              context.lastRequestedGuests || 2,
              5
            );

            if (alternatives && alternatives.length > 0) {
              let alternativesMessage = `Perfect! Here are available times for ${context.lastRequestedGuests} people on ${context.partialIntent.date}:\n\n`;

              alternatives.forEach((alt, index) => {
                alternativesMessage += `${index + 1}. **${alt.time}** - ${alt.tableName} (${alt.tableCapacity} seats)\n`;
              });

              alternativesMessage += `\nJust tell me which number you'd like and I'll book it for ${context.partialIntent.name}! 🎯`;

              bot.sendMessage(chatId, alternativesMessage);
              context.suggestedSlots = alternatives;
            } else {
              bot.sendMessage(chatId, `I'm sorry ${context.partialIntent.name}, but we're fully booked on ${context.partialIntent.date}. Would you like to try a different date? 📅`);
            }
          } catch (error) {
            console.error('❌ Error finding alternatives:', error);
            bot.sendMessage(chatId, `Let me check other available dates for ${context.lastRequestedGuests} people. What other dates work for you?`);
          }
        } else {
          // Handle other responses in alternatives mode
          bot.sendMessage(chatId, 'Would you like me to show you available times for your reservation? Just let me know! 😊');
        }
      } else {
        // Check if user is asking for availability after being told no tables available
        const isAvailabilityCheck = message.toLowerCase().includes('availability') || 
                                   message.toLowerCase().includes('available') ||
                                   message.toLowerCase().includes('what time') ||
                                   message.toLowerCase().includes('when') ||
                                   message.toLowerCase().includes('check') ||
                                   message.toLowerCase().includes('tomorrow');

        if (isAvailabilityCheck && context.lastRequestedGuests) {
          // User is asking for alternatives after rejection - provide specific times
          console.log('🔍 User asking for availability, showing alternatives...');
          try {
            bot.sendChatAction(chatId, 'typing');

            const today = new Date().toISOString().split('T')[0];
            const { getAlternativeTimes } = await import('./telegram-booking');
            const alternatives = await getAlternativeTimes(restaurantId, today, context.lastRequestedGuests);

            if (alternatives && alternatives.length > 0) {
              const alternativesList = alternatives.map((alt, index) => 
                `${index + 1}. ${alt.time} - Table ${alt.tableName} (${alt.capacity} seats)`
              ).join('\n');

              const message = `Here are the available times for ${context.lastRequestedGuests} people today:

${alternativesList}

Would you like me to book one of these times? Just tell me which number you prefer!`;

              bot.sendMessage(chatId, message);

              // Update context for alternative selection
              context.stage = 'suggesting_alternatives';
              context.suggestedSlots = alternatives;
              return;
            } else {
              bot.sendMessage(chatId, `I'm sorry, but we don't have any availability for ${context.lastRequestedGuests} people today. Would you like me to check a different date?`);
              return;
            }
          } catch (error) {
            console.error('❌ Error getting alternatives:', error);
          }
        }

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

  // Handle callback queries (for inline keyboards if you add them later)
  bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;

    if (!msg) return;

    const chatId = msg.chat.id;

    // Answer the callback query to remove loading state
    bot.answerCallbackQuery(callbackQuery.id);

    // Handle different callback data
    if (data?.startsWith('date_')) {
      const context = getOrCreateContext(chatId, restaurantId);
      if (data === 'date_today') {
        const today = new Date().toISOString().split('T')[0];
        context.partialIntent = context.partialIntent || {};
        context.partialIntent.date = today;
        bot.sendMessage(chatId, "Great! You've selected today. What time would you prefer?");
      } else if (data === 'date_tomorrow') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowDate = tomorrow.toISOString().split('T')[0];
        context.partialIntent = context.partialIntent || {};
        context.partialIntent.date = tomorrowDate;
        bot.sendMessage(chatId, "Perfect! You've selected tomorrow. What time works for you?");
      }
    }
  });

  return bot;
}