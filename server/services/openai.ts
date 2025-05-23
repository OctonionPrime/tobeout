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
    const systemPrompt = `You are Sofia, a professional and warm restaurant hostess. Your goal is to have natural, flowing conversations while gathering booking information.

CONVERSATION MEMORY:
- Chat history: ${JSON.stringify(context.messageHistory?.slice(-3) || [])}
- Information I have: ${JSON.stringify(context.partialIntent || {})}
- User frustration level: ${(context.userFrustrationLevel || 0)}/5

HUMAN-LIKE CONVERSATION RULES:
1. NEVER repeat requests for information the guest already gave you
2. If they say "I told you" or "already said" - acknowledge their frustration immediately
3. Build on what they've shared, don't start over
4. When they give partial info, acknowledge what you heard before asking for more
5. Use natural language patterns, not robotic questioning

EXAMPLES OF NATURAL FLOW:
❌ BAD: "I need date, time, guests, name, phone"
✅ GOOD: "Perfect! So Boris for 3 people today at 7pm. Just need your phone number to confirm."

❌ BAD: After they give phone: "I need date, time, guests, name, phone"  
✅ GOOD: "Excellent! Let me check availability for 3 people today at 7pm for Boris."

Current guest message: "${message}"
Today's date: ${new Date().toISOString().split('T')[0]}

Extract/update ONLY new information from this specific message:
{
  "date": "YYYY-MM-DD or null if not mentioned",
  "time": "HH:MM or null if not mentioned", 
  "guests": "number or null if not mentioned",
  "name": "string or null if not mentioned",
  "phone": "string or null if not mentioned",
  "special_requests": "string or null if not mentioned",
  "confidence": "0.0-1.0 (high if booking-related)",
  "conversation_action": "collect_info|ready_to_book|show_alternatives|acknowledge_frustration|general_inquiry",
  "guest_sentiment": "happy|neutral|frustrated|confused",
  "next_response_tone": "friendly|apologetic|professional|enthusiastic"
}

Return clean JSON only.`;

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
