import OpenAI from "openai";
import { storage } from "../storage";

// The newest OpenAI model is "gpt-4o" which was released May 13, 2024. Do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "sk-dummy-key-for-development" });

// Message types for OpenAI API
type SystemMessage = { role: "system"; content: string };
type UserMessage = { role: "user"; content: string };
type AssistantMessage = { role: "assistant"; content: string };
type Message = SystemMessage | UserMessage | AssistantMessage;

// Types for reservation intents
interface ReservationIntent {
  date?: string;
  time?: string;
  guests?: number;
  name?: string;
  phone?: string;
  special_requests?: string;
  confidence: number;
  conversation_action?: string;
  guest_sentiment?: string;
  next_response_tone?: string;
}

// Enhanced intent detection with conversation context awareness
export async function detectReservationIntentWithContext(
  message: string, 
  context: any
): Promise<ReservationIntent> {
  try {
    // Get current date context
    const today = new Date();
    const todayString = today.toISOString().split('T')[0];
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowString = tomorrow.toISOString().split('T')[0];

    // Format existing context for better AI understanding
    const existingInfo = Object.entries(context.partialIntent || {})
      .filter(([key, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');

    const systemPrompt = `You are Sofia, a professional restaurant hostess analyzing guest messages for booking information.

CURRENT CONVERSATION CONTEXT:
- Recent messages: ${JSON.stringify(context.messageHistory?.slice(-3) || [])}
- Information already collected: ${existingInfo || 'none'}
- Guest frustration level: ${(context.userFrustrationLevel || 0)}/5
- Last thing I asked for: ${context.lastAskedFor || 'nothing specific'}

CRITICAL ANALYSIS RULES:
1. FRUSTRATION DETECTION: If guest says "I told you", "already said", "just said", "I said", "mentioned", "gave you" → conversation_action: "acknowledge_frustration"
2. EXTRACT ONLY NEW INFO: Don't repeat information that's already collected
3. DATE PARSING: 
   - "today" → "${todayString}"
   - "tomorrow" → "${tomorrowString}"
   - "this evening" → "${todayString}"
   - "next [day]" → calculate actual date
4. TIME PARSING:
   - "7", "7pm", "7 pm" → "19:00"
   - "noon", "12pm" → "12:00"
   - "evening" → "19:00"
   - "lunch" → "12:00"
5. GUEST COUNT: "table for 4", "4 people", "party of 4", "4 of us" → guests: 4
6. PHONE DETECTION: Any sequence of 10+ digits
7. NAME DETECTION: "I'm [name]", "My name is [name]", "For [name]", or standalone proper nouns

CURRENT MESSAGE TO ANALYZE: "${message}"

Analyze this message and return information in this exact JSON format:
{
  "date": "YYYY-MM-DD if mentioned, otherwise null",
  "time": "HH:MM format if mentioned, otherwise null", 
  "guests": "number if mentioned, otherwise null",
  "name": "exact name if mentioned, otherwise null",
  "phone": "phone number if mentioned, otherwise null",
  "special_requests": "any special requests mentioned, otherwise null",
  "confidence": "0.0-1.0 based on how booking-related this message is",
  "conversation_action": "collect_info|ready_to_book|acknowledge_frustration|show_alternatives|general_inquiry",
  "guest_sentiment": "happy|neutral|frustrated|confused",
  "next_response_tone": "friendly|apologetic|professional|enthusiastic"
}

EXAMPLES:
- Message: "I told you already, George" → conversation_action: "acknowledge_frustration", name: "George", guest_sentiment: "frustrated"
- Message: "today at 7 for 2 people" → date: "${todayString}", time: "19:00", guests: 2, confidence: 0.9
- Message: "4573895673" → phone: "4573895673", confidence: 0.8
- Message: "table for 4 tomorrow evening" → guests: 4, date: "${tomorrowString}", time: "19:00", confidence: 0.9

Return only valid JSON with no additional text.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      temperature: 0.1, // Lower temperature for more consistent parsing
      response_format: { type: "json_object" },
      max_tokens: 500
    });

    const result = JSON.parse(response.choices[0].message.content || '{"confidence": 0}');

    // Clean up and validate the response
    Object.keys(result).forEach(key => {
      if (result[key] === 'NOT_SPECIFIED' || result[key] === 'null' || result[key] === '' || result[key] === 'NONE') {
        result[key] = null;
      }
    });

    // Validate and fix date format
    if (result.date && !/^\d{4}-\d{2}-\d{2}$/.test(result.date)) {
      console.warn('Invalid date format detected:', result.date);
      result.date = null;
    }

    // Validate and fix time format
    if (result.time && !/^\d{2}:\d{2}$/.test(result.time)) {
      // Try to fix common time formats
      if (result.time.includes(':')) {
        const [hours, minutes] = result.time.split(':');
        const h = parseInt(hours);
        const m = parseInt(minutes) || 0;
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
          result.time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        } else {
          result.time = null;
        }
      } else {
        console.warn('Invalid time format detected:', result.time);
        result.time = null;
      }
    }

    // Ensure guests is a valid number
    if (result.guests && (typeof result.guests !== 'number' || result.guests < 1 || result.guests > 20)) {
      const guestNum = parseInt(result.guests);
      if (guestNum >= 1 && guestNum <= 20) {
        result.guests = guestNum;
      } else {
        result.guests = null;
      }
    }

    // Validate phone number
    if (result.phone && !/^\d{10,15}$/.test(result.phone.replace(/[^\d]/g, ''))) {
      const cleanPhone = result.phone.replace(/[^\d]/g, '');
      if (cleanPhone.length >= 10 && cleanPhone.length <= 15) {
        result.phone = cleanPhone;
      } else {
        result.phone = null;
      }
    }

    // Set default values for conversation management
    if (!result.conversation_action) {
      result.conversation_action = result.confidence > 0.5 ? 'collect_info' : 'general_inquiry';
    }
    if (!result.guest_sentiment) {
      result.guest_sentiment = 'neutral';
    }
    if (!result.next_response_tone) {
      result.next_response_tone = 'friendly';
    }

    console.log('🧠 Enhanced intent analysis result:', result);
    return result as ReservationIntent;
  } catch (error) {
    console.error("Error detecting reservation intent with context:", error);
    return { 
      confidence: 0,
      conversation_action: 'general_inquiry',
      guest_sentiment: 'neutral',
      next_response_tone: 'friendly'
    };
  }
}

// Keep original function for backward compatibility
export async function detectReservationIntent(message: string): Promise<ReservationIntent> {
  return detectReservationIntentWithContext(message, { 
    messageHistory: [], 
    partialIntent: {}, 
    lastAskedFor: null, 
    userFrustrationLevel: 0 
  });
}

interface AvailableSlot {
  date: string;
  time: string;
  tableId: number;
  tableName: string;
  tableCapacity: number;
  table?: any;
}

export async function suggestAlternativeSlots(
  restaurantId: number,
  date: string,
  guests: number,
  maxResults: number = 5
): Promise<AvailableSlot[]> {
  try {
    console.log(`🔍 Finding alternatives for ${guests} guests on ${date}`);

    // Get restaurant tables that can accommodate the guests
    const allTables = await storage.getTables(restaurantId);
    const suitableTables = allTables.filter(
      table => table.minCapacity <= guests && table.maxCapacity >= guests
    );

    if (suitableTables.length === 0) {
      console.log('❌ No suitable tables found');
      return [];
    }

    // Get existing reservations for the date
    const existingReservations = await storage.getReservations(restaurantId, { 
      date: date,
      status: ['confirmed', 'created']
    });

    console.log(`📋 Found ${existingReservations.length} existing reservations for ${date}`);

    // Generate comprehensive time slots
    const timeSlots = [];

    // Lunch slots: 11:00 AM - 3:00 PM
    for (let hour = 11; hour <= 15; hour++) {
      timeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
      if (hour < 15) {
        timeSlots.push(`${hour.toString().padStart(2, '0')}:30`);
      }
    }

    // Dinner slots: 5:00 PM - 10:00 PM
    for (let hour = 17; hour <= 22; hour++) {
      timeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
      if (hour < 22) {
        timeSlots.push(`${hour.toString().padStart(2, '0')}:30`);
      }
    }

    const alternatives = [];

    // Check each time slot for availability
    for (const time of timeSlots) {
      const availableTables = suitableTables.filter(table => {
        // Check if this table is free at this time
        return !existingReservations.some(reservation => {
          if (reservation.tableId !== table.id) return false;

          // Check time overlap (assume 2-hour dining duration)
          const resStart = new Date(`${date} ${reservation.time}`);
          const resEnd = new Date(resStart.getTime() + 2 * 60 * 60 * 1000);
          const reqStart = new Date(`${date} ${time}`);
          const reqEnd = new Date(reqStart.getTime() + 2 * 60 * 60 * 1000);

          // Check if time slots overlap
          return (reqStart < resEnd && reqEnd > resStart);
        });
      });

      if (availableTables.length > 0) {
        // Pick the best available table (optimal capacity for party size)
        const bestTable = availableTables.reduce((best, current) => {
          // Prefer tables closer to the requested party size
          const bestDiff = Math.abs(best.maxCapacity - guests);
          const currentDiff = Math.abs(current.maxCapacity - guests);
          return currentDiff < bestDiff ? current : best;
        });

        alternatives.push({
          date,
          time: formatTimeForDisplay(time),
          tableId: bestTable.id,
          tableName: bestTable.name,
          tableCapacity: bestTable.maxCapacity,
          table: bestTable
        });

        if (alternatives.length >= maxResults) break;
      }
    }

    console.log(`✅ Found ${alternatives.length} alternative time slots`);
    return alternatives;
  } catch (error) {
    console.error("Error suggesting alternative slots:", error);
    return [];
  }
}

/**
 * Format time for display (24-hour to 12-hour with AM/PM)
 */
function formatTimeForDisplay(time24: string): string {
  const [hours, minutes] = time24.split(':');
  const hour = parseInt(hours);
  const min = minutes || '00';

  if (hour === 0) return `12:${min} AM`;
  if (hour < 12) return `${hour}:${min} AM`;
  if (hour === 12) return `12:${min} PM`;
  return `${hour - 12}:${min} PM`;
}

export async function generateReservationConfirmation(
  guestName: string,
  date: string,
  time: string,
  guests: number,
  restaurantName: string,
  tableFeatures?: string[]
): Promise<string> {
  try {
    const featuresText = tableFeatures && tableFeatures.length > 0 
      ? `Your table has the following features: ${tableFeatures.join(', ')}.` 
      : '';

    const systemPrompt = `You are Sofia, a warm and professional restaurant hostess for "${restaurantName}".
Generate a brief, enthusiastic confirmation message for a reservation.
Keep it concise but warm and professional. Use emojis appropriately.
Make the guest feel welcomed and excited about their visit.`;

    const userPrompt = `Create a reservation confirmation message for ${guestName} who has reserved a table for ${guests} people on ${date} at ${time}.
${featuresText}
The confirmation should be friendly, professional, and make them feel welcome.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 200,
      temperature: 0.7
    });

    return response.choices[0].message.content || `🎉 Perfect! Your reservation for ${guests} people on ${date} at ${time} is confirmed, ${guestName}. Thank you for choosing ${restaurantName}!`;
  } catch (error) {
    console.error("Error generating reservation confirmation:", error);
    return `🎉 Perfect! Your reservation for ${guests} people on ${date} at ${time} is confirmed, ${guestName}. Thank you for choosing ${restaurantName}!`;
  }
}

export async function generateAlternativeSuggestionMessage(
  restaurantName: string,
  requestedDate: string,
  requestedTime: string,
  guests: number,
  alternativeSlots: AvailableSlot[]
): Promise<string> {
  try {
    if (alternativeSlots.length === 0) {
      // No alternatives available
      const systemPrompt = `You are Sofia, a friendly restaurant hostess for "${restaurantName}".
Generate a brief, empathetic message explaining there's no availability.
Suggest they try a different date and offer to help them further.
Keep it warm and helpful, not disappointing.`;

      const userPrompt = `Create a polite message explaining that we don't have availability for ${guests} people on ${requestedDate} at ${requestedTime}.
Suggest they try a different date or time and offer to help them find alternatives.
Be empathetic but positive.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 150,
        temperature: 0.7
      });

      return response.choices[0].message.content || `I'm sorry, but we don't have availability for ${guests} people on ${requestedDate} at ${requestedTime}. Would you like to try a different date or time? I'd be happy to help you find the perfect slot! 📅`;
    } else {
      // Format alternative slots for better readability
      const alternativesList = alternativeSlots.map((slot, index) => 
        `${index + 1}. ${slot.time} - Table ${slot.tableName} (${slot.tableCapacity} seats)`
      ).join('\n');

      const systemPrompt = `You are Sofia, a helpful restaurant hostess for "${restaurantName}".
Generate a friendly message suggesting alternative reservation times.
Be enthusiastic about the alternatives and make them sound appealing.
Use emojis and make the guest feel like these are great options.`;

      const userPrompt = `Create a message explaining that we don't have availability for ${guests} people on ${requestedDate} at ${requestedTime}, but we have these great alternatives:

${alternativesList}

Make the alternatives sound appealing and ask which one they'd prefer. Be positive and helpful.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 250,
        temperature: 0.7
      });

      return response.choices[0].message.content || `I'm sorry, but ${requestedTime} on ${requestedDate} isn't available for ${guests} people. However, I have these great alternatives:\n\n${alternativesList}\n\nWhich one would you prefer? 🎯`;
    }
  } catch (error) {
    console.error("Error generating alternative suggestion message:", error);
    if (alternativeSlots.length === 0) {
      return `I'm sorry, but we don't have availability for ${guests} people on ${requestedDate} at ${requestedTime}. Would you like to try a different date or time? I'd be happy to help! 📅`;
    } else {
      const alternatives = alternativeSlots.map((slot, index) => 
        `${index + 1}. ${slot.time} - Table ${slot.tableName}`
      ).join('\n');
      return `I'm sorry, but ${requestedTime} isn't available. Here are some great alternatives:\n\n${alternatives}\n\nWhich would you prefer? 🎯`;
    }
  }
}

export async function generateResponseToGeneralInquiry(
  message: string,
  restaurantName: string,
  restaurantInfo: {
    address?: string;
    openingHours?: string;
    cuisine?: string;
    phoneNumber?: string;
    description?: string;
  }
): Promise<string> {
  try {
    console.log(`🤖 GenerateResponseToGeneralInquiry called with message: "${message}"`);

    const systemPrompt = `You are Sofia, a friendly and knowledgeable AI assistant for the restaurant "${restaurantName}".
Answer customer inquiries about the restaurant in a helpful, warm, and professional way.
Use the restaurant information provided to give accurate answers.
If you don't have specific information requested, politely let the customer know and offer to connect them with staff.
Always be enthusiastic about the restaurant and try to encourage bookings when appropriate.
Use emojis sparingly but effectively.

Restaurant Information:
- Name: ${restaurantName}
- Address: ${restaurantInfo.address || 'Not available - please contact us directly'}
- Opening Hours: ${restaurantInfo.openingHours || 'Please contact us for current hours'}
- Cuisine Type: ${restaurantInfo.cuisine || 'Please ask our staff about our menu'}
- Phone Number: ${restaurantInfo.phoneNumber || 'Not available - please contact us through this chat'}
- Description: ${restaurantInfo.description || 'A wonderful dining experience awaits you'}

Guidelines:
- Be conversational and warm
- If asked about reservations, guide them to make one
- If asked about menu, describe generally based on cuisine type if available
- If asked about location/directions, provide address if available
- If asked about hours, provide opening hours if available
- For anything you're unsure about, offer to help them contact the restaurant directly`;

    console.log('🤖 Calling OpenAI API for general inquiry...');
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      max_tokens: 300,
      temperature: 0.7 // Slightly more creative for general conversation
    });

    const aiResponse = response.choices[0].message.content || "";
    console.log(`🤖 OpenAI Response: "${aiResponse}"`);
    return aiResponse;
  } catch (error) {
    console.error("❌ Error generating response to general inquiry:", error);
    return `Thank you for your question about ${restaurantName}! I'd be happy to help you with information about our restaurant or assist you with making a reservation. What would you like to know? 😊`;
  }
}

/**
 * Enhanced function to analyze conversation context and provide smart responses
 */
export async function analyzeConversationContext(
  message: string,
  conversationHistory: string[],
  partialIntent: any
): Promise<{
  isRepeatingInfo: boolean;
  isFrustrated: boolean;
  suggestedResponse: string;
  confidence: number;
}> {
  try {
    const systemPrompt = `You are an expert conversation analyst for a restaurant booking system.
Analyze the conversation context to detect:
1. If the guest is repeating information they already provided
2. If the guest is frustrated with the conversation
3. What the appropriate response should be

Conversation History: ${JSON.stringify(conversationHistory)}
Already Collected: ${JSON.stringify(partialIntent)}
Current Message: "${message}"

Return analysis in JSON format:
{
  "isRepeatingInfo": true/false,
  "isFrustrated": true/false,
  "suggestedResponse": "recommended response strategy",
  "confidence": 0.0-1.0
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
      max_tokens: 200
    });

    return JSON.parse(response.choices[0].message.content || '{"confidence": 0}');
  } catch (error) {
    console.error("Error analyzing conversation context:", error);
    return {
      isRepeatingInfo: false,
      isFrustrated: false,
      suggestedResponse: "continue_normal_flow",
      confidence: 0
    };
  }
}