import OpenAI from "openai";
import type {
  ConversationFlow,
  AIAnalysisResult,
  AIService,
  Language
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

      // --- System Prompt for analyzeMessage ---
      const systemPrompt = `You are Sofia, an expert AI assistant for a restaurant, tasked with understanding guest messages to facilitate bookings.
Your goal is to extract key information (entities), determine guest sentiment, decide the next logical conversation action, and identify the language of the user's message.
The restaurant operates in MOSCOW TIMEZONE. All date interpretations MUST be based on this.

**LANGUAGE HANDLING & DETECTION (CRITICAL):**
- Analyze the "CURRENT MESSAGE TO ANALYZE" to determine if it is primarily in Russian ('ru') or English ('en').
- **CONSERVATIVE LANGUAGE SWITCHING:**
  - If "Current conversation language context" is already set (e.g., 'ru' or 'en'), and the "CURRENT MESSAGE TO ANALYZE" is very short (e.g., < 5 characters), primarily numeric (like a phone number or quantity), or highly ambiguous in its language, you should **PREFER the "Current conversation language context"** for the "detectedLanguage" field in your output.
  - Only switch "detectedLanguage" if the "CURRENT MESSAGE TO ANALYZE" provides a clear and substantial indication of a different language than the "Current conversation language context".
- Set the "detectedLanguage" field in your JSON output to either "ru" or "en" based on this rule.
- If the "detectedLanguage" is Russian, your entire JSON output, especially any string values (entities, etc.), MUST be in RUSSIAN.
- If "detectedLanguage" is English, ensure your JSON output values are in ENGLISH.

CURRENT MOSCOW DATE/TIME CONTEXT:
- Today in Moscow is: ${todayString} (Day of week: ${currentMoscowDateTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Europe/Moscow' })})
- Tomorrow in Moscow is: ${tomorrowString}
- Current Moscow hour (24h format): ${currentMoscowDateTime.getHours()}

CONVERSATION HISTORY & STATE:
- Recent messages (last 3, newest first): ${JSON.stringify(context.conversationHistory?.slice(-3).reverse() || [])}
- Information already collected by you: ${existingInfoSummary}
- Guest frustration level (0-5, higher is more frustrated): ${context.guestFrustrationLevel || 0}
- What you (the bot) last asked the guest for: ${lastAskedHint}
- Current conversation language context (used by bot for its previous response): ${context.currentLanguage || 'not yet established'}

YOUR TASK: Analyze the CURRENT MESSAGE TO ANALYZE from the user.

CRITICAL ANALYSIS & EXTRACTION RULES:
1. Detected Language (detectedLanguage): Determine 'ru' or 'en' based on the **LANGUAGE HANDLING & DETECTION** rules above.
2. Entities Extraction:
   - date: If a date is mentioned, resolve to YYYY-MM-DD format.
     - **CONTEXTUAL DATE HANDLING (VERY IMPORTANT):**
       - If 'Information already collected by you' shows a 'date' (e.g., '${context.collectedInfo?.date || 'not set'}'), and the 'CURRENT MESSAGE TO ANALYZE' primarily adds or clarifies a time (e.g., 'at 7 PM', '15-00', 'в три часа дня', 'в 7 вечера') WITHOUT explicitly stating a *new, different* calendar date (e.g., 'tomorrow at 7', 'on the 27th at 3 PM', '28 мая в пять'), then you MUST:
         1. PRESERVE the existing 'date' from 'Information already collected by you'.
         2. Extract the 'time' from the 'CURRENT MESSAGE TO ANALYZE'.
         3. In your JSON output, set the 'date' field to this PRESERVED date.
         4. Set the 'time' field to the newly extracted time.
       - Phrases like "сегодня" (today), "завтра" (tomorrow), "послезавтра" (day after tomorrow) are explicit date changes if they introduce a new date relative to '${todayString}'.
       - For Russian: If a date like "сегодня" or a specific calendar date is already established in the context, interpret phrases like "X часа дня", "X дня", "в X часов" (e.g., "3 часа дня", "3 дня") as a TIME reference for the *established date*. Do NOT change the established date unless a new, clear date specifier (like "завтра", "28го", "в следующий вторник") is provided. For example, if date is '2025-05-26' (сегодня) and user says "в 3 дня", output date should remain '2025-05-26' and time should be '15:00'.
   - time: If a time is mentioned, parse to HH:MM 24-hour format.
   - guests: Number of people.
   - name: Guest name if provided.
   - phone: Phone number (normalize to digits only).
   - special_requests: Any specific requests.
   (Ensure these entity values are in the detectedLanguage if they are strings).

3. Confidence Score (confidence): 0.0 to 1.0 - How certain are you that this message is related to making or modifying a booking?

4. Conversation Action (conversation_action): Choose ONE:
   - collect_info: If more information is needed for a booking.
   - ready_to_book: If ALL necessary information seems to be collected.
   - acknowledge_frustration: If guest expresses frustration.
   - show_alternatives: If user is asking for alternatives.
   - general_inquiry: For general questions about the restaurant.
   - reset_and_restart: If conversation is stuck.
   - unknown_intent: If message intent is unclear.

5. Guest Sentiment: Choose ONE: positive, neutral, frustrated, confused, impatient, appreciative.
6. Next Response Tone: Choose ONE: friendly, empathetic, professional, direct, enthusiastic, concise, apologetic.

CURRENT MESSAGE TO ANALYZE: ${message}

OUTPUT FORMAT (Strictly JSON, no extra text. All string values must be in the language specified by "detectedLanguage"):
{
  "detectedLanguage": "en_or_ru",
  "entities": {
    "date": "YYYY-MM-DD or null",
    "time": "HH:MM or null",
    "guests": "number or null",
    "name": "string or null (in detectedLanguage)",
    "phone": "string (digits only) or null",
    "special_requests": "string or null (in detectedLanguage)"
  },
  "confidence": 0.8,
  "conversation_action": "collect_info",
  "guest_sentiment": "neutral",
  "next_response_tone": "friendly"
}`;
      // --- End of System Prompt for analyzeMessage ---

      const completion = await openaiClient.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
        max_tokens: 850 // Increased slightly for potentially more verbose language instructions
      });

      const rawResult = completion.choices[0].message.content;
      const parsedResult = JSON.parse(rawResult || '{}') as Partial<AIAnalysisResult & {entities: AIAnalysisResult['entities'], detectedLanguage: Language}>;

      let detectedLang: Language = context.currentLanguage || 'en'; // Default to current context or 'en'

      if (parsedResult.detectedLanguage === 'ru' || parsedResult.detectedLanguage === 'en') {
          // AI provided a language, respect it if it's a clear switch or initial detection
          if (!context.currentLanguage || // If no prior language context
              (parsedResult.detectedLanguage !== context.currentLanguage && message.length > 5 && !/^\d+$/.test(message)) || // Clear switch on substantial text
              (parsedResult.detectedLanguage === context.currentLanguage) // Consistent with context
          ) {
            detectedLang = parsedResult.detectedLanguage;
          }
          // Otherwise, stick with context.currentLanguage (already set as default for detectedLang)
      }


      const aiResult: AIAnalysisResult = {
        detectedLanguage: detectedLang,
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
            if (entityKey === 'date' && context.collectedInfo?.date && !message.match(/завтра|сегодня|вчера|понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресенье|\d{1,2}[-\s/.]\d{1,2}(?:[-\s/.]\d{2,4})?|\d{4}[-\s/.]\d{1,2}[-\s/.]\d{1,2}|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|янв|фев|мар|апр|мая|июн|июл|авг|сен|окт|ноя|дек)/i)) {
              // This condition is to double-check if AI tries to nullify a date when it shouldn't.
              // However, the primary logic for date preservation is now in the system prompt.
              // If the prompt is followed, the AI should return the existing date if applicable.
            } else {
                 delete aiResult.entities[entityKey];
            }
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

      console.log(`[AIService] analyzeMessage processed AI result (FINAL detectedLanguage: ${aiResult.detectedLanguage}):`, aiResult);
      return aiResult;

    } catch (error) {
      console.error("[AIService] Error in analyzeMessage:", error);
      return {
        detectedLanguage: context.currentLanguage || 'en',
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
    restaurantName: string, tableFeatures?: string[],
    targetLanguage: Language = 'en'
  ): Promise<string> {
    const featuresText = tableFeatures && tableFeatures.length > 0
      ? (targetLanguage === 'ru' ? `Столик с особенностями: ${tableFeatures.join(', ')}.` :`Table features: ${tableFeatures.join(', ')}.`)
      : '';

    const languageInstruction = targetLanguage === 'ru'
        ? "The guest's name might be in Russian. Generate the confirmation message in RUSSIAN. Be warm and celebratory."
        : "Generate the confirmation message in ENGLISH. Be warm and celebratory.";

    // --- Enhanced System Prompt for Confirmation ---
    const systemPrompt = `You are Sofia, the exceptionally warm, welcoming, and efficient hostess for "${restaurantName}".
Your task is to craft a delightful and personal confirmation message for a successful reservation.
Imagine you are speaking directly to the guest with a smile. Use natural, human-like language, not robotic phrases.
Emphasize how much you look forward to their visit. Use emojis tastefully to convey warmth (✨, 🎉, 😊, 🥂).

${languageInstruction}`;

    const userPrompt = `Please craft a reservation confirmation for ${guestName}.
Details: ${guests} people on ${date} at ${time}.
${featuresText}
The message should:
- Sound genuinely excited for them.
- Clearly confirm all key details (name, date, time, guests).
- Mention the restaurant name naturally.
- End with a warm closing, expressing anticipation.
Example tone (English): "Wonderful, ${guestName}! Everything is set for your visit to ${restaurantName}..."
Example tone (Russian): "Замечательно, ${guestName}! Всё готово для вашего визита в ${restaurantName}..."`;
    // --- End of Enhanced System Prompt for Confirmation ---

    try {
      const completion = await openaiClient.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_tokens: 250, temperature: 0.7 
      });
      return completion.choices[0].message.content || (
        targetLanguage === 'ru'
        ? `🎉 Замечательно, ${guestName}! Ваше бронирование в "${restaurantName}" на ${guests} ${guests === 1 ? 'гостя' : (guests < 5 ? 'гостей' : 'гостей')} ${date} в ${time} подтверждено! Мы с нетерпением ждем встречи с Вами! 🥂`
        : `🎉 Wonderful, ${guestName}! Your reservation at "${restaurantName}" for ${guests} ${guests === 1 ? 'person' : 'people'} on ${date} at ${time} is all set! We're so looking forward to welcoming you! 🥂`
      );
    } catch (error) {
      console.error("[AIService] Error generating reservation confirmation text:", error);
      return targetLanguage === 'ru'
        ? `🎉 Замечательно, ${guestName}! Ваше бронирование в "${restaurantName}" на ${guests} ${guests === 1 ? 'гостя' : (guests < 5 ? 'гостей' : 'гостей')} ${date} в ${time} подтверждено! Мы с нетерпением ждем встречи с Вами! 🥂`
        : `🎉 Wonderful, ${guestName}! Your reservation at "${restaurantName}" for ${guests} ${guests === 1 ? 'person' : 'people'} on ${date} at ${time} is all set! We're so looking forward to welcoming you! 🥂`;
    }
  }

  async generateAlternativeSuggestionText(
    restaurantName: string, requestedDate: string, requestedTime: string, guests: number,
    alternativesListString: string,
    noAlternativesFound: boolean,
    targetLanguage: Language = 'en'
  ): Promise<string> {
    try {
      const languageInstruction = targetLanguage === 'ru'
        ? "The response MUST be in RUSSIAN. Be empathetic and helpful."
        : "The response MUST be in ENGLISH. Be empathetic and helpful.";

      // --- Enhanced System Prompt for Alternatives ---
      if (noAlternativesFound) {
        const systemPrompt = `You are Sofia, a very understanding and resourceful hostess for "${restaurantName}".
The guest's requested time is unfortunately fully booked, and no immediate alternatives were found for their specific request.
Your goal is to:
1. Gently inform them that their specific time isn't available.
2. Express sincere regret (e.g., "Oh, it looks like we're fully committed then...").
3. Proactively suggest trying a different date, time, or even a slight change in party size, and offer to help them search again.
4. Maintain a warm, positive, and very helpful tone, as if you're personally trying to find a solution for them.
Avoid sounding robotic. Use natural, empathetic language.
${languageInstruction}`;
        const userPrompt = `The guest requested ${guests} people on ${requestedDate} at ${requestedTime}, but it's unavailable, and no other slots were found for this exact request.
Craft a response that:
- Sounds like a real hostess: "Oh, it looks like [requestedTime] on [requestedDate] is quite popular and we're fully booked then..."
- Suggests options: "...Perhaps we could try a little earlier or later, or maybe another day would work for you? I'd be happy to check!"
- Is empathetic and helpful.`;
        // --- End of Enhanced System Prompt for No Alternatives ---
        const completion = await openaiClient.chat.completions.create({ model: "gpt-4o", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: 200, temperature: 0.75 });
        return completion.choices[0].message.content || (
          targetLanguage === 'ru'
          ? `Ах, ${requestedTime} ${requestedDate} у нас, похоже, очень популярное время и все столики для ${guests} гостей уже заняты. 😔 Может быть, попробуем немного раньше или позже? Или, возможно, другой день вам подойдет? Я с удовольствием посмотрю для вас! 📅`
          : `Oh, it looks like ${requestedTime} on ${requestedDate} is quite popular and we're fully booked for ${guests} guests then. 😔 Perhaps we could try a little earlier or later? Or maybe another day would work for you? I'd be happy to check for you! 📅`
        );
      } else {
        // --- Enhanced System Prompt for Presenting Alternatives ---
        const systemPrompt = `You are Sofia, an exceptionally helpful and friendly hostess for "${restaurantName}".
The guest's original request was unavailable, but you've found some other possibilities!
Your task is to:
1. Gently inform them their original choice isn't free.
2. Enthusiastically present the list of alternatives (which will be provided in the user prompt, already formatted and localized).
3. Make the alternatives sound appealing and easy to choose from.
4. Clearly ask them to pick an option by number, or to let you know if they'd like to try different criteria (e.g., another day).
Use natural, conversational language. Imagine you're genuinely trying to help them find the perfect time.
${languageInstruction}
The alternatives list ("alternativesListString" which is: ${alternativesListString}) will be provided in the user prompt. Your surrounding text should match the target language and be engaging.`;
        const userPrompt = `The guest's request for ${guests} people on ${requestedDate} at ${requestedTime} was not available.
Please present the following alternatives in a warm and inviting way:
${alternativesListString}
Encourage them to select one by number, or suggest they can ask for other dates/times.
Example tone (English): "It seems ${requestedTime} is booked up, but the good news is I have a few other spots that might work perfectly for you..."
Example tone (Russian): "Кажется, ${requestedTime} уже занято, но есть и хорошие новости! Я нашла несколько других вариантов, которые могут вам подойти..."`;
        // --- End of Enhanced System Prompt for Presenting Alternatives ---
        const completion = await openaiClient.chat.completions.create({ model: "gpt-4o", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: 300, temperature: 0.7 });
        return completion.choices[0].message.content || (
          targetLanguage === 'ru'
          ? `Кажется, ${requestedTime} ${requestedDate} для ${guests} гостей уже занято. Но не волнуйтесь, я посмотрела и нашла несколько других вариантов для вас в "${restaurantName}":\n\n${alternativesListString}\n\nКакой-нибудь из этих подойдет? Просто скажите номер! Или, если хотите, можем посмотреть другие даты. 😊`
          : `It seems ${requestedTime} on ${requestedDate} for ${guests} guests is booked up. But don't worry, I had a look and found a few other options at "${restaurantName}" for you:\n\n${alternativesListString}\n\nWould any of these work? Just let me know the number! Or, we can always look at different dates if you'd like. 😊`
        );
      }
    } catch (error) {
      console.error("[AIService] Error generating alternative suggestion text:", error);
      if (noAlternativesFound) {
        return targetLanguage === 'ru'
          ? `Ах, ${requestedTime} ${requestedDate} у нас, похоже, очень популярное время и все столики для ${guests} гостей уже заняты. 😔 Может быть, попробуем немного раньше или позже? Или, возможно, другой день вам подойдет? Я с удовольствием посмотрю для вас! 📅`
          : `Oh, it looks like ${requestedTime} on ${requestedDate} is quite popular and we're fully booked for ${guests} guests then. 😔 Perhaps we could try a little earlier or later? Or maybe another day would work for you? I'd be happy to check for you! 📅`;
      } else {
        return targetLanguage === 'ru'
          ? `Кажется, ${requestedTime} ${requestedDate} для ${guests} гостей уже занято. Но не волнуйтесь, я посмотрела и нашла несколько других вариантов для вас в "${restaurantName}":\n\n${alternativesListString}\n\nКакой-нибудь из этих подойдет? Просто скажите номер! Или, если хотите, можем посмотреть другие даты. 😊`
          : `It seems ${requestedTime} on ${requestedDate} for ${guests} guests is booked up. But don't worry, I had a look and found a few other options at "${restaurantName}" for you:\n\n${alternativesListString}\n\nWould any of these work? Just let me know the number! Or, we can always look at different dates if you'd like. 😊`;
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
    },
    targetLanguage: Language = 'en'
  ): Promise<string> {
    try {
      const languageInstruction = targetLanguage === 'ru'
        ? "The user's message might be in Russian. Your response MUST be in RUSSIAN. Sound like a helpful, informed hostess."
        : "The user's message might be in English. Your response MUST be in ENGLISH. Sound like a helpful, informed hostess.";

      // --- Enhanced System Prompt for General Inquiry ---
      const systemPrompt = `You are Sofia, the exceptionally friendly, knowledgeable, and articulate hostess for "${restaurantName}".
Your primary goal is to answer guest inquiries warmly and accurately using ONLY the provided restaurant information.
If specific information isn't available in the "Restaurant Information" below, politely and naturally state that you'd need to double-check that detail or suggest they ask when they visit, then smoothly transition to offering help with a reservation.
Maintain a warm, welcoming, and enthusiastic tone. Use natural conversational language, not a list of facts.
${languageInstruction}

Restaurant Information (use ONLY this information for your answer; if a detail is missing, state it naturally and offer to help with a booking instead):
- Name: ${restaurantName}
- Address: ${restaurantInfo.address || "For our exact spot, it's best to check our website or I can tell you when you're booking!"}
- Opening Hours: ${restaurantInfo.openingHours || "Our current hours can vary a bit, but I can help you find a great time for a reservation!"}
- Cuisine Type: ${restaurantInfo.cuisine || "We have a wonderful selection of dishes! The best way to explore is to come visit."}
- Phone Number: ${restaurantInfo.phoneNumber || "The best way to reach us for immediate queries is often through our direct line, which you can find online. For bookings, I'm right here to help!"}
- Description: ${restaurantInfo.description || `"${restaurantName}" is a wonderful place to dine!`}

Guidelines:
- Be very conversational and positive. Avoid sounding like you're reading from a script.
- If asked about reservations, enthusiastically guide them towards making one with you.
- For menu specifics beyond cuisine type, you can say something like, "Our chefs are always creating wonderful dishes! For the very latest menu, it's best to see it when you arrive, or I can help you book a table and you can discover it then!"
- If you lack specific information from the "Restaurant Information" above, never invent it. Politely redirect or offer booking assistance. For example, "That's a great question! For the most up-to-date details on [specifics], I'd recommend checking our website or asking our team when you visit. In the meantime, can I help you find a table?"
- Use emojis sparingly and naturally (😊, 🍽️, ✨).`;
      // --- End of Enhanced System Prompt for General Inquiry ---

      const completion = await openaiClient.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: message }],
        max_tokens: 350,
        temperature: 0.75 // Higher temperature for more natural, varied responses
      });
      return completion.choices[0].message.content || (
        targetLanguage === 'ru'
        ? `Рада ответить на ваши вопросы о "${restaurantName}"! Чем могу помочь? Может быть, забронировать для вас столик? 😊`
        : `Happy to answer your questions about "${restaurantName}"! What can I help you with? Perhaps book a table for you? 😊`
      );
    } catch (error) {
      console.error("[AIService] Error generating general inquiry response:", error);
      return targetLanguage === 'ru'
        ? `Рада ответить на ваши вопросы о "${restaurantName}"! Чем могу помочь? Может быть, забронировать для вас столик? 😊`
        : `Happy to answer your questions about "${restaurantName}"! What can I help you with? Perhaps book a table for you? 😊`;
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
