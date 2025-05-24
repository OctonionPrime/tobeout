import OpenAI from "openai";
// storage is not directly used by OpenAIServiceImpl but might be if helper functions were kept.
// For now, it's not strictly needed by the core AIService implementation.
// import { storage } from "../storage"; 

// Import interfaces from the definitive conversation manager file
import type {
  ConversationFlow,
  AIAnalysisResult,
  AIService // This is the interface OpenAIServiceImpl will implement
} from './conversation-manager.refactored'; // Adjust path as necessary

// Initialize OpenAI client
// Ensure OPENAI_API_KEY is set in your environment variables
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "sk-dummy-key-for-development-openai-service" // Using a distinct dummy key
});

/**
 * Helper function to get current and tomorrow's date in YYYY-MM-DD format for Moscow.
 * This is used to provide accurate date context to the AI.
 */
function getMoscowDatesForPromptContext() {
  const now = new Date();
  // Get current time in Moscow
  const moscowTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));

  const year = moscowTime.getFullYear();
  const month = (moscowTime.getMonth() + 1).toString().padStart(2, '0');
  const day = moscowTime.getDate().toString().padStart(2, '0');
  const todayString = `${year}-${month}-${day}`;

  // Calculate tomorrow in Moscow
  const tomorrowMoscow = new Date(moscowTime);
  tomorrowMoscow.setDate(moscowTime.getDate() + 1);
  const tomorrowYear = tomorrowMoscow.getFullYear();
  const tomorrowMonth = (tomorrowMoscow.getMonth() + 1).toString().padStart(2, '0');
  const tomorrowDay = tomorrowMoscow.getDate().toString().padStart(2, '0');
  const tomorrowString = `${tomorrowYear}-${tomorrowMonth}-${tomorrowDay}`;

  console.log(`[AIService/MoscowDatesCtx] Server UTC: ${now.toISOString()}, Moscow Time: ${moscowTime.toISOString()}, Today: ${todayString}, Tomorrow: ${tomorrowString}`);
  return { todayString, tomorrowString, currentMoscowDateTime: moscowTime };
}

export class OpenAIServiceImpl implements AIService {
  /**
   * Analyzes the user's message in the context of the current conversation flow
   * to extract intent, entities, sentiment, and suggest a course of action.
   * This is the primary method used by ActiveConversation.
   */
  async analyzeMessage(message: string, context: ConversationFlow): Promise<AIAnalysisResult> {
    try {
      const { todayString, tomorrowString, currentMoscowDateTime } = getMoscowDatesForPromptContext();

      const existingInfoSummary = Object.entries(context.collectedInfo || {})
        .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ') || 'none';

      // Attempt to infer what the bot last asked for, to help AI avoid re-asking.
      let lastAskedHint = 'nothing specific';
      if (context.lastResponse) {
        const lowerLastResponse = context.lastResponse.toLowerCase();
        if (lowerLastResponse.includes("just need your")) {
            const parts = context.lastResponse.substring(lowerLastResponse.indexOf("just need your") + "just need your".length).trim().split(" ");
            if (parts.length > 1 && (parts[1] === "number" || parts[1] === "name" || parts[1] === "size" || parts[1] === "date" || parts[1] === "time")) {
                 lastAskedHint = parts.slice(0,2).join(" "); // e.g., "phone number", "party size"
            } else if (parts.length > 0) {
                lastAskedHint = parts[0].replace(/[!?.,:]$/, ''); // "date", "time"
            }
        } else if (lowerLastResponse.includes("what date")) {
            lastAskedHint = "date";
        } else if (lowerLastResponse.includes("what time")) {
            lastAskedHint = "time";
        } else if (lowerLastResponse.includes("how many people") || lowerLastResponse.includes("party size")) {
            lastAskedHint = "party size";
        } else if (lowerLastResponse.includes("name should i put")) {
            lastAskedHint = "name";
        } else if (lowerLastResponse.includes("phone number")) {
            lastAskedHint = "phone number";
        }
      }

      const systemPrompt = `You are "Sofia", an expert AI assistant for a restaurant, tasked with understanding guest messages to facilitate bookings.
Your goal is to extract key information (entities), determine guest sentiment, and decide the next logical conversation action.
The restaurant operates in MOSCOW TIMEZONE. All date interpretations MUST be based on this.

CURRENT MOSCOW DATE/TIME CONTEXT:
- Today in Moscow is: ${todayString} (Day of week: ${currentMoscowDateTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Europe/Moscow' })})
- Tomorrow in Moscow is: ${tomorrowString}
- Current Moscow hour (24h format): ${currentMoscowDateTime.getHours()}

CONVERSATION HISTORY & STATE:
- Recent messages (last 3, newest first): ${JSON.stringify(context.conversationHistory?.slice(-3).reverse() || [])}
- Information already collected by you: ${existingInfoSummary}
- Guest frustration level (0-5, higher is more frustrated): ${context.guestFrustrationLevel || 0}
- What you (the bot) last asked the guest for: ${lastAskedHint}

YOUR TASK: Analyze the "CURRENT MESSAGE TO ANALYZE" from the user.

CRITICAL ANALYSIS & EXTRACTION RULES:
1.  **Entities Extraction**:
    * **date**: If a date is mentioned (e.g., "today", "tomorrow", "August 15th", "next Friday"):
        * "today", "tonight", "this evening" → ALWAYS resolve to: ${todayString}.
        * "tomorrow" → ALWAYS resolve to: ${tomorrowString}.
        * For specific dates (e.g., "August 15th"), provide as YYYY-MM-DD. Assume current year if not specified.
        * For relative days (e.g., "Friday"), resolve to the upcoming YYYY-MM-DD based on Moscow's current date.
    * **time**: If a time is mentioned (e.g., "7pm", "19:00", "noon", "in an hour"):
        * Parse to HH:MM (24-hour format). Examples: "7pm" → "19:00", "noon" → "12:00", "8 AM" -> "08:00".
        * "evening" (general) → default to "19:00". "afternoon" → "15:00". "lunch" → "13:00".
    * **guests**: Number of people (e.g., "for 2", "3 of us"). Extract the number.
    * **name**: Guest's name if provided (e.g., "My name is John", "reservation for Maria").
    * **phone**: Phone number (normalize to digits only, e.g., "+7 (123) 456-7890" -> "71234567890").
    * **special_requests**: Any specific requests (e.g., "window table", "birthday celebration").
    * If information is ALREADY in "Information already collected", set the entity to null or do not include it, UNLESS the user is EXPLICITLY changing it, correcting it, or reconfirming it after being asked. Prioritize NEW or CORRECTED information.
2.  **Confidence Score (confidence)**: 0.0 to 1.0. How certain are you that this message is related to making or modifying a booking? High for booking details, low for unrelated chat.
3.  **Conversation Action (conversation_action)**: Choose ONE:
    * `collect_info`: If more information is needed for a booking.
    * `ready_to_book`: If ALL necessary information (date, time, guests, name, phone) seems to be collected or confirmed.
    * `acknowledge_frustration`: If guest expresses frustration (e.g., "I already told you", "this is annoying", "you're not understanding", or if they are repeating information they just gave and you asked for something else).
    * `show_alternatives`: If the user is asking for alternatives, or if a booking attempt failed and alternatives should be offered, or if the current request is likely unavailable.
    * `general_inquiry`: For general questions about the restaurant (hours, menu, location) not directly part of booking flow.
    * `reset_and_restart`: If the conversation is hopelessly stuck or the user requests to start over.
    * `unknown_intent`: If the message intent is unclear or unrelated to restaurant services.
4.  **Guest Sentiment (guest_sentiment)**: Choose ONE: `positive`, `neutral`, `frustrated`, `confused`, `impatient`, `appreciative`.
5.  **Next Response Tone (next_response_tone)**: Suggest a tone for the bot's reply: `friendly`, `empathetic`, `professional`, `direct`, `enthusiastic`, `concise`, `apologetic`.

CURRENT MESSAGE TO ANALYZE: "${message}"

OUTPUT FORMAT (Strictly JSON, no extra text):
{
  "entities": {
    "date": "YYYY-MM-DD or null",
    "time": "HH:MM or null",
    "guests": "number or null",
    "name": "string or null",
    "phone": "string (digits only) or null",
    "special_requests": "string or null"
  },
  "confidence": 0.8,
  "conversation_action": "collect_info",
  "guest_sentiment": "neutral",
  "next_response_tone": "friendly"
}`;

      const completion = await openaiClient.chat.completions.create({
        model: "gpt-4o", // Ensure this is the desired model
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        temperature: 0.2, // Lower temperature for more deterministic, less creative responses for analysis
        response_format: { type: "json_object" },
        max_tokens: 750 // Increased slightly to ensure full JSON for complex cases
      });

      const rawResult = completion.choices[0].message.content;
      const parsedResult = JSON.parse(rawResult || '{}') as Partial<AIAnalysisResult & {entities: AIAnalysisResult['entities']}>;

      // Sanitize and structure the result
      const aiResult: AIAnalysisResult = {
        entities: parsedResult.entities || {},
        confidence: parsedResult.confidence !== undefined ? Math.max(0, Math.min(1, parsedResult.confidence)) : 0,
        conversation_action: parsedResult.conversation_action || (parsedResult.confidence && parsedResult.confidence > 0.5 ? 'collect_info' : 'unknown_intent'),
        guest_sentiment: parsedResult.guest_sentiment || 'neutral',
        next_response_tone: parsedResult.next_response_tone || 'friendly'
      };

      // Clean up entities
      if (aiResult.entities) {
        for (const key in aiResult.entities) {
          const entityKey = key as keyof NonNullable<AIAnalysisResult['entities']>;
          const value = aiResult.entities[entityKey];
          if (value === 'null' || String(value).toUpperCase() === 'NOT_SPECIFIED' || String(value).toUpperCase() === 'NONE' || String(value).trim() === '') {
            // Use delete operator to remove the key if value is effectively null/undefined
            delete aiResult.entities[entityKey];
          }
        }
        // Validate and normalize guests
        if (aiResult.entities.guests !== undefined) {
            const numGuests = parseInt(String(aiResult.entities.guests), 10);
            aiResult.entities.guests = (!isNaN(numGuests) && numGuests > 0 && numGuests < 50) ? numGuests : undefined;
            if (aiResult.entities.guests === undefined) delete aiResult.entities.guests;
        }
        // Validate and normalize phone
        if (aiResult.entities.phone !== undefined) {
            aiResult.entities.phone = String(aiResult.entities.phone).replace(/\D/g, '');
            if (!aiResult.entities.phone || aiResult.entities.phone.length < 7 || aiResult.entities.phone.length > 15) { // Basic length check
                 delete aiResult.entities.phone;
            }
        }
        // Validate date format (YYYY-MM-DD)
        if (aiResult.entities.date && !/^\d{4}-\d{2}-\d{2}$/.test(aiResult.entities.date)) {
            console.warn(`[AIService] AI returned invalid date format: ${aiResult.entities.date}. Clearing.`);
            delete aiResult.entities.date;
        }
        // Validate and normalize time format (HH:MM)
        if (aiResult.entities.time) {
            const timeParts = String(aiResult.entities.time).split(':');
            if (timeParts.length === 2 && /^\d{1,2}$/.test(timeParts[0]) && /^\d{1,2}$/.test(timeParts[1])) {
                const h = parseInt(timeParts[0], 10);
                const m = parseInt(timeParts[1], 10);
                if (h >=0 && h <=23 && m >=0 && m <=59) {
                    aiResult.entities.time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                } else {
                    console.warn(`[AIService] AI returned out-of-range time: ${aiResult.entities.time}. Clearing.`);
                    delete aiResult.entities.time;
                }
            } else {
                 console.warn(`[AIService] AI returned invalid time format: ${aiResult.entities.time}. Clearing.`);
                 delete aiResult.entities.time;
            }
        }
      }

      console.log(`[AIService] analyzeMessage raw AI output: ${rawResult}`);
      console.log(`[AIService] analyzeMessage processed AI result:`, aiResult);
      return aiResult;

    } catch (error) {
      console.error("[AIService] Error in analyzeMessage:", error);
      // Return a default safe response in case of error
      return {
        entities: {},
        confidence: 0,
        conversation_action: 'unknown_intent', // Or a specific error action
        guest_sentiment: 'neutral',
        next_response_tone: 'friendly'
      };
    }
  }

  /**
   * Generates text for a reservation confirmation.
   */
  async generateReservationConfirmationText(
    guestName: string, date: string, time: string, guests: number,
    restaurantName: string, tableFeatures?: string[]
  ): Promise<string> {
    const featuresText = tableFeatures && tableFeatures.length > 0
      ? `Your table includes the following features: ${tableFeatures.join(', ')}.`
      : '';
    const systemPrompt = `You are "Sofia", a warm and highly professional restaurant hostess for "${restaurantName}".
Your task is to generate a brief, enthusiastic, and welcoming confirmation message for a successful reservation.
Use emojis tastefully. Ensure the guest feels valued and excited.`;
    const userPrompt = `Please craft a reservation confirmation for ${guestName}.
Details: ${guests} people on ${date} at ${time}.
${featuresText}
The message should be friendly, confirm all details clearly, and express anticipation for their visit.`;

    try {
      const completion = await openaiClient.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_tokens: 220, temperature: 0.65 // Slightly creative for a warm message
      });
      return completion.choices[0].message.content || `🎉 Excellent, ${guestName}! Your reservation for ${guests} people on ${date} at ${time} is confirmed. We look forward to welcoming you to ${restaurantName}!`;
    } catch (error) {
      console.error("[AIService] Error generating reservation confirmation text:", error);
      // Fallback message
      return `🎉 Excellent, ${guestName}! Your reservation for ${guests} people on ${date} at ${time} is confirmed. We look forward to welcoming you to ${restaurantName}!`;
    }
  }

  /**
   * Generates text for suggesting alternative slots or indicating no availability.
   * @param alternativesListString - A pre-formatted string listing the alternatives, or empty if none.
   * @param noAlternativesFound - Boolean indicating if no alternatives were found by the availability service.
   */
  async generateAlternativeSuggestionText(
    restaurantName: string, requestedDate: string, requestedTime: string, guests: number,
    alternativesListString: string, // This string is prepared by ResponseFormatter
    noAlternativesFound: boolean
  ): Promise<string> {
    try {
      if (noAlternativesFound) {
        const systemPrompt = `You are "Sofia", a helpful and empathetic restaurant hostess for "${restaurantName}".
The guest's requested time is unavailable, and no immediate alternatives were found for that specific request.
Politely inform them and suggest trying a different date or time, or perhaps modifying the number of guests.
Maintain a positive and helpful tone, encouraging them to continue interacting.`;
        const userPrompt = `Inform the guest that their request for ${guests} people on ${requestedDate} at ${requestedTime} is unfortunately unavailable, and no other slots were found for this exact request.
Encourage them to try another date/time or adjust their party size, and offer your assistance in finding a suitable slot.`;
        const completion = await openaiClient.chat.completions.create({ model: "gpt-4o", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: 180, temperature: 0.7 });
        return completion.choices[0].message.content || `I'm so sorry, but we don't seem to have availability for ${guests} people on ${requestedDate} at ${requestedTime}, and I couldn't find immediate alternatives for that specific request. Would you like me to check for other dates or times, or perhaps for a different number of guests? I'd be happy to help find the perfect spot for you! 📅`;
      } else {
        const systemPrompt = `You are "Sofia", an engaging and helpful restaurant hostess for "${restaurantName}".
The guest's original request was unavailable. You need to present a list of alternative times that have been found.
Make these alternatives sound appealing and clear. Ask them to choose one by number, or request other options.`;
        const userPrompt = `The guest's request for ${guests} people on ${requestedDate} at ${requestedTime} was not available.
Please present the following alternatives in a friendly and inviting way:
${alternativesListString}
Ask them to select one by providing the number, or if they'd like to explore other dates/times.`;
        const completion = await openaiClient.chat.completions.create({ model: "gpt-4o", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: 280, temperature: 0.65 });
        return completion.choices[0].message.content || `While ${requestedTime} on ${requestedDate} isn't available for ${guests} people, I found these other great options for you:\n\n${alternativesListString}\n\nWould any of these work? Let me know the number, or we can look at different dates! 🎯`;
      }
    } catch (error) {
      console.error("[AIService] Error generating alternative suggestion text:", error);
      // Fallback messages
      if (noAlternativesFound) {
        return `I'm so sorry, but we don't seem to have availability for ${guests} people on ${requestedDate} at ${requestedTime}. Would you like me to check for other dates or times? I'd be happy to help! 📅`;
      } else {
        return `While ${requestedTime} isn't available, I found these other great options for you:\n\n${alternativesListString}\n\nWould any of these work? Let me know the number, or we can look at different dates! 🎯`;
      }
    }
  }

  /**
   * Generates a response to a general inquiry based on provided restaurant information.
   */
  async generateGeneralInquiryResponse(
    message: string, // The user's inquiry
    restaurantName: string,
    // Restaurant info should be fetched by the calling service (e.g., Telegram bot handler)
    // and passed here to keep AIService focused on AI interaction.
    restaurantInfo: {
      address?: string;
      openingHours?: string; // e.g., "10 AM - 11 PM daily"
      cuisine?: string;
      phoneNumber?: string;
      description?: string;
    }
  ): Promise<string> {
    try {
      const systemPrompt = `You are "Sofia", a friendly, knowledgeable, and professional AI assistant for the restaurant "${restaurantName}".
Your primary goal is to answer guest inquiries accurately using the provided restaurant information.
If specific information isn't available in the provided context, politely state that and smoothly transition to offering help with a reservation or suggesting they contact staff directly for details you don't have.
Maintain a warm, welcoming, and enthusiastic tone. Use emojis appropriately to enhance friendliness.

Restaurant Information (use ONLY this information for your answer):
- Name: ${restaurantName}
- Address: ${restaurantInfo.address || 'For our exact location, please feel free to ask our staff or check our website!'}
- Opening Hours: ${restaurantInfo.openingHours || 'Our current opening hours can be confirmed by contacting us directly or checking online.'}
- Cuisine Type: ${restaurantInfo.cuisine || `We offer a delightful menu. I can help you make a reservation to experience it!`}
- Phone Number: ${restaurantInfo.phoneNumber || 'For direct calls, please check our official contact details. I can assist with bookings here!'}
- Description: ${restaurantInfo.description || `Experience wonderful dining at ${restaurantName}!`}

Guidelines:
- Be conversational and positive.
- If asked about reservations, seamlessly guide them towards making one.
- For menu details beyond cuisine type, suggest they ask staff upon arrival or check an online menu if available from other sources.
- If you lack specific information from the "Restaurant Information" above, never invent it. Politely redirect or offer booking assistance.`;

      const completion = await openaiClient.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: message }],
        max_tokens: 350, // Sufficient for a detailed general response
        temperature: 0.7 // Slightly more creative for general conversation
      });
      return completion.choices[0].message.content || `Thanks for asking about ${restaurantName}! I'm here to help with reservations or general questions. What's on your mind? 😊`;
    } catch (error) {
      console.error("[AIService] Error generating general inquiry response:", error);
      // Fallback message
      return `Thanks for asking about ${restaurantName}! I'm here to help with reservations or general questions. What's on your mind? 😊`;
    }
  }
}

// --- Debugging Utility ---
// This is not part of the AIService interface but can be useful for development.
export function debugMoscowTimezone(): void {
  const now = new Date();
  const moscowTime = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Moscow"}));
  console.log('[MOSCOW TIMEZONE DEBUGGER]');
  console.log('  Server System Time (UTC or local):', now.toISOString(), `(${now.toString()})`);
  console.log('  Moscow Equivalent Time:', moscowTime.toISOString(), `(${moscowTime.toString()})`);
  console.log('  Moscow Date (YYYY-MM-DD):', moscowTime.toISOString().split('T')[0]);
  console.log('  Moscow Day of the Week:', moscowTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Europe/Moscow' }));
  console.log('  Moscow Hour (24h):', moscowTime.getHours());
  console.log('  NodeJS Timezone Offset (minutes from UTC for server):', now.getTimezoneOffset());
}
