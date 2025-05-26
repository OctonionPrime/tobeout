import OpenAI from "openai";
import type {
  ConversationFlow,
  AIAnalysisResult,
  AIService
} from './conversation-manager';

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "sk-dummy-key-for-development-openai-service"
});

function getMoscowDatesForPromptContext() {
  const now = new Date();
  const moscowTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));

  const year = moscowTime.getFullYear();
  const month = (moscowTime.getMonth() + 1).toString().padStart(2, '0');
  const day = moscowTime.getDate().toString().padStart(2, '0');
  const todayString = `${year}-${month}-${day}`;

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
  async analyzeMessage(message: string, context: ConversationFlow): Promise<AIAnalysisResult> {
    try {
      const { todayString, tomorrowString, currentMoscowDateTime } = getMoscowDatesForPromptContext();

      const existingInfoSummary = Object.entries(context.collectedInfo || {})
        .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ') || 'none';

      let lastAskedHint = 'nothing specific';
      if (context.lastResponse) {
        const lowerLastResponse = context.lastResponse.toLowerCase();
        if (lowerLastResponse.includes("just need your")) {
            const parts = context.lastResponse.substring(lowerLastResponse.indexOf("just need your") + "just need your".length).trim().split(" ");
            if (parts.length > 1 && (parts[1] === "number" || parts[1] === "name" || parts[1] === "size" || parts[1] === "date" || parts[1] === "time")) {
                 lastAskedHint = parts.slice(0,2).join(" ");
            } else if (parts.length > 0) {
                lastAskedHint = parts[0].replace(/[!?.,:]$/, '');
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

      const systemPrompt = `You are Sofia, an expert AI assistant for a restaurant, tasked with understanding guest messages to facilitate bookings.
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

YOUR TASK: Analyze the CURRENT MESSAGE TO ANALYZE from the user.

CRITICAL ANALYSIS & EXTRACTION RULES:
1. Entities Extraction:
   - date: If a date is mentioned, resolve to YYYY-MM-DD format
   - time: If a time is mentioned, parse to HH:MM 24-hour format
   - guests: Number of people
   - name: Guest name if provided
   - phone: Phone number (normalize to digits only)
   - special_requests: Any specific requests

2. Confidence Score (confidence): 0.0 to 1.0 - How certain are you that this message is related to making or modifying a booking?

3. Conversation Action (conversation_action): Choose ONE:
   - collect_info: If more information is needed for a booking
   - ready_to_book: If ALL necessary information seems to be collected
   - acknowledge_frustration: If guest expresses frustration
   - show_alternatives: If user is asking for alternatives
   - general_inquiry: For general questions about the restaurant
   - reset_and_restart: If conversation is stuck
   - unknown_intent: If message intent is unclear

4. Guest Sentiment: Choose ONE: positive, neutral, frustrated, confused, impatient, appreciative
5. Next Response Tone: Choose ONE: friendly, empathetic, professional, direct, enthusiastic, concise, apologetic

CURRENT MESSAGE TO ANALYZE: ${message}

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
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
        max_tokens: 750
      });

      const rawResult = completion.choices[0].message.content;
      const parsedResult = JSON.parse(rawResult || '{}') as Partial<AIAnalysisResult & {entities: AIAnalysisResult['entities']}>;

      const aiResult: AIAnalysisResult = {
        entities: parsedResult.entities || {},
        confidence: parsedResult.confidence !== undefined ? Math.max(0, Math.min(1, parsedResult.confidence)) : 0,
        conversation_action: parsedResult.conversation_action || (parsedResult.confidence && parsedResult.confidence > 0.5 ? 'collect_info' : 'unknown_intent'),
        guest_sentiment: parsedResult.guest_sentiment || 'neutral',
        next_response_tone: parsedResult.next_response_tone || 'friendly'
      };

      if (aiResult.entities) {
        for (const key in aiResult.entities) {
          const entityKey = key as keyof NonNullable<AIAnalysisResult['entities']>;
          const value = aiResult.entities[entityKey];
          if (value === 'null' || String(value).toUpperCase() === 'NOT_SPECIFIED' || String(value).toUpperCase() === 'NONE' || String(value).trim() === '') {
            delete aiResult.entities[entityKey];
          }
        }

        if (aiResult.entities.guests !== undefined) {
            const numGuests = parseInt(String(aiResult.entities.guests), 10);
            aiResult.entities.guests = (!isNaN(numGuests) && numGuests > 0 && numGuests < 50) ? numGuests : undefined;
            if (aiResult.entities.guests === undefined) delete aiResult.entities.guests;
        }

        if (aiResult.entities.phone !== undefined) {
            aiResult.entities.phone = String(aiResult.entities.phone).replace(/\D/g, '');
            if (!aiResult.entities.phone || aiResult.entities.phone.length < 7 || aiResult.entities.phone.length > 15) {
                 delete aiResult.entities.phone;
            }
        }

        if (aiResult.entities.date && !/^\d{4}-\d{2}-\d{2}$/.test(aiResult.entities.date)) {
            console.warn(`[AIService] AI returned invalid date format: ${aiResult.entities.date}. Clearing.`);
            delete aiResult.entities.date;
        }

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

      console.log(`[AIService] analyzeMessage processed AI result:`, aiResult);
      return aiResult;

    } catch (error) {
      console.error("[AIService] Error in analyzeMessage:", error);
      return {
        entities: {},
        confidence: 0,
        conversation_action: 'unknown_intent',
        guest_sentiment: 'neutral',
        next_response_tone: 'friendly'
      };
    }
  }

  async generateReservationConfirmationText(
    guestName: string, date: string, time: string, guests: number,
    restaurantName: string, tableFeatures?: string[]
  ): Promise<string> {
    const featuresText = tableFeatures && tableFeatures.length > 0
      ? `Your table includes the following features: ${tableFeatures.join(', ')}.`
      : '';
    const systemPrompt = `You are Sofia, a warm and highly professional restaurant hostess for "${restaurantName}".
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
        max_tokens: 220, temperature: 0.65
      });
      return completion.choices[0].message.content || `🎉 Excellent, ${guestName}! Your reservation for ${guests} people on ${date} at ${time} is confirmed. We look forward to welcoming you to ${restaurantName}!`;
    } catch (error) {
      console.error("[AIService] Error generating reservation confirmation text:", error);
      return `🎉 Excellent, ${guestName}! Your reservation for ${guests} people on ${date} at ${time} is confirmed. We look forward to welcoming you to ${restaurantName}!`;
    }
  }

  async generateAlternativeSuggestionText(
    restaurantName: string, requestedDate: string, requestedTime: string, guests: number,
    alternativesListString: string,
    noAlternativesFound: boolean
  ): Promise<string> {
    try {
      if (noAlternativesFound) {
        const systemPrompt = `You are Sofia, a helpful and empathetic restaurant hostess for "${restaurantName}".
The guest's requested time is unavailable, and no immediate alternatives were found for that specific request.
Politely inform them and suggest trying a different date or time, or perhaps modifying the number of guests.
Maintain a positive and helpful tone, encouraging them to continue interacting.`;
        const userPrompt = `Inform the guest that their request for ${guests} people on ${requestedDate} at ${requestedTime} is unfortunately unavailable, and no other slots were found for this exact request.
Encourage them to try another date/time or adjust their party size, and offer your assistance in finding a suitable slot.`;
        const completion = await openaiClient.chat.completions.create({ model: "gpt-4o", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: 180, temperature: 0.7 });
        return completion.choices[0].message.content || `I'm so sorry, but we don't seem to have availability for ${guests} people on ${requestedDate} at ${requestedTime}, and I couldn't find immediate alternatives for that specific request. Would you like me to check for other dates or times, or perhaps for a different number of guests? I'd be happy to help find the perfect spot for you! 📅`;
      } else {
        const systemPrompt = `You are Sofia, an engaging and helpful restaurant hostess for "${restaurantName}".
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
      if (noAlternativesFound) {
        return `I'm so sorry, but we don't seem to have availability for ${guests} people on ${requestedDate} at ${requestedTime}. Would you like me to check for other dates or times? I'd be happy to help! 📅`;
      } else {
        return `While ${requestedTime} isn't available, I found these other great options for you:\n\n${alternativesListString}\n\nWould any of these work? Let me know the number, or we can look at different dates! 🎯`;
      }
    }
  }

  async generateGeneralInquiryResponse(
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
      const systemPrompt = `You are Sofia, a friendly, knowledgeable, and professional AI assistant for the restaurant "${restaurantName}".
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
        max_tokens: 350,
        temperature: 0.7
      });
      return completion.choices[0].message.content || `Thanks for asking about ${restaurantName}! I'm here to help with reservations or general questions. What's on your mind? 😊`;
    } catch (error) {
      console.error("[AIService] Error generating general inquiry response:", error);
      return `Thanks for asking about ${restaurantName}! I'm here to help with reservations or general questions. What's on your mind? 😊`;
    }
  }
}

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