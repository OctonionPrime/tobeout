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
}

// Enhanced intent detection with conversation context awareness
export async function detectReservationIntentWithContext(
  message: string, 
  context: any
): Promise<ReservationIntent> {
  try {
    const systemPrompt = `
      You are an intelligent restaurant assistant. Extract booking information while being conversational and context-aware.

      CONVERSATION CONTEXT:
      - Previous messages: ${JSON.stringify(context.messageHistory?.slice(-3) || [])}
      - Current info collected: ${JSON.stringify(context.partialIntent || {})}
      - Last asked for: ${context.lastAskedFor || 'nothing'}
      - User seems frustrated: ${(context.userFrustrationLevel || 0) > 2}

      RULES:
      1. If user already provided information, DON'T extract it again unless it's different
      2. If user seems frustrated (said "told you", "already said"), acknowledge existing info
      3. Look for implicit confirmations and frustration signals
      4. Extract ANY new information available, even if incomplete
      5. Return "NOT_SPECIFIED" for fields that are truly missing

      Current message: "${message}"
      Today's date: ${new Date().toISOString().split('T')[0]}
      
      Extract these fields:
      - date (in YYYY-MM-DD format, convert relative dates like "tomorrow", "next Friday", "today")
      - time (in HH:MM format, 24-hour, convert "4 pm" to "16:00", "7:30" to "19:30")
      - guests (integer, extract from phrases like "table for 4", "4 people", "party of 6")
      - name (string)
      - phone (string)
      - special_requests (string)
      - confidence (number between 0 and 1, be AGGRESSIVE - if someone mentions table/reservation/book/dine, set confidence to 0.8+)
      
      Use "NOT_SPECIFIED" for missing information, not null.
      Return valid JSON only.
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content || '{"confidence": 0}');
    
    // Clean up NOT_SPECIFIED values
    Object.keys(result).forEach(key => {
      if (result[key] === 'NOT_SPECIFIED') {
        result[key] = undefined;
      }
    });
    
    return result as ReservationIntent;
  } catch (error) {
    console.error("Error detecting reservation intent with context:", error);
    return { confidence: 0 };
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
  timeslotId: number;
}

export async function suggestAlternativeSlots(
  restaurantId: number,
  date: string,
  time: string,
  guests: number,
  preferredTableFeatures: string[] = []
): Promise<AvailableSlot[]> {
  try {
    // Get restaurant tables that can accommodate the guests
    const allTables = await storage.getTables(restaurantId);
    const suitableTables = allTables.filter(
      table => table.minGuests <= guests && table.maxGuests >= guests
    );
    
    if (suitableTables.length === 0) {
      return [];
    }
    
    // Get timeslots for the requested date
    const timeslots = await storage.getTimeslots(restaurantId, date);
    
    // Filter free timeslots
    const freeTimeslots = timeslots.filter(
      ts => ts.status === 'free' && 
      suitableTables.some(table => table.id === ts.tableId)
    );
    
    if (freeTimeslots.length === 0) {
      return [];
    }
    
    // Sort timeslots by closeness to requested time
    const requestedTime = new Date(`${date}T${time}`);
    
    const sortedTimeslots = freeTimeslots.sort((a, b) => {
      const aTime = new Date(`${date}T${a.time}`);
      const bTime = new Date(`${date}T${b.time}`);
      
      return Math.abs(aTime.getTime() - requestedTime.getTime()) - 
             Math.abs(bTime.getTime() - requestedTime.getTime());
    });
    
    // Return the top 3 closest times
    return sortedTimeslots.slice(0, 3).map(ts => ({
      date,
      time: ts.time,
      tableId: ts.tableId,
      timeslotId: ts.id
    }));
  } catch (error) {
    console.error("Error suggesting alternative slots:", error);
    return [];
  }
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
      
    const systemPrompt = `
      You are a friendly AI assistant for the restaurant "${restaurantName}".
      Generate a brief, polite confirmation message for a reservation.
      Keep it concise but warm and professional.
    `;

    const userPrompt = `
      Create a reservation confirmation message for ${guestName} who has reserved a table for ${guests} people on ${date} at ${time}.
      ${featuresText}
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 150
    });

    return response.choices[0].message.content || "";
  } catch (error) {
    console.error("Error generating reservation confirmation:", error);
    return `Your reservation for ${guests} people on ${date} at ${time} is confirmed. Thank you for choosing ${restaurantName}!`;
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
      const systemPrompt = `
        You are a friendly AI assistant for the restaurant "${restaurantName}".
        Generate a brief, polite message explaining there's no availability.
        Suggest they try a different date or time and offer to help them further.
      `;

      const userPrompt = `
        Create a polite message explaining that we don't have availability for ${guests} people on ${requestedDate} at ${requestedTime}.
        Suggest they try a different date or time and offer to help them further.
      `;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 150
      });

      return response.choices[0].message.content;
    } else {
      // Format alternative slots
      const alternativeOptions = alternativeSlots.map(slot => {
        // Format the time for better readability
        const timeObj = new Date(`${slot.date}T${slot.time}`);
        const formattedTime = timeObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return `${slot.date} at ${formattedTime}`;
      });

      const systemPrompt = `
        You are a friendly AI assistant for the restaurant "${restaurantName}".
        Generate a brief, polite message suggesting alternative reservation times.
        The message should be conversational and helpful.
      `;

      const userPrompt = `
        Create a polite message explaining that we don't have availability for ${guests} people on ${requestedDate} at ${requestedTime}.
        Suggest these alternative times instead: ${alternativeOptions.join(', ')}.
        Ask which alternative they would prefer, or if they'd like to try a different date.
      `;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 200
      });

      return response.choices[0].message.content;
    }
  } catch (error) {
    console.error("Error generating alternative suggestion message:", error);
    if (alternativeSlots.length === 0) {
      return `I'm sorry, but we don't have availability for ${guests} people on ${requestedDate} at ${requestedTime}. Would you like to try a different date or time?`;
    } else {
      const alternatives = alternativeSlots.map(slot => `${slot.date} at ${slot.time}`).join(', ');
      return `I'm sorry, but we don't have availability for ${guests} people on ${requestedDate} at ${requestedTime}. Would any of these alternatives work for you? ${alternatives}`;
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
    
    const systemPrompt = `
      You are a friendly AI assistant for the restaurant "${restaurantName}".
      Answer customer inquiries about the restaurant in a helpful and concise way.
      Use the restaurant information provided to give accurate answers.
      If you don't have the information requested, politely let the customer know
      and offer to connect them with a staff member who can help.
      
      Restaurant Information:
      - Name: ${restaurantName}
      - Address: ${restaurantInfo.address || 'Not provided'}
      - Opening Hours: ${restaurantInfo.openingHours || 'Not provided'}
      - Cuisine: ${restaurantInfo.cuisine || 'Not provided'}
      - Phone: ${restaurantInfo.phoneNumber || 'Not provided'}
      - Description: ${restaurantInfo.description || 'Not provided'}
    `;

    console.log('🤖 Calling OpenAI API for general inquiry...');
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      max_tokens: 200
    });

    const aiResponse = response.choices[0].message.content || "";
    console.log(`🤖 OpenAI Response: "${aiResponse}"`);
    return aiResponse;
  } catch (error) {
    console.error("❌ Error generating response to general inquiry:", error);
    return `Thanks for your message about ${restaurantName}. For specific information about our restaurant, please call us or visit our website.`;
  }
}
