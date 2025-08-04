// src/agents/maya-agent.ts

import { BaseAgent, AgentContext, AgentResponse, AgentConfig, RestaurantConfig } from './base-agent';
import type { Language } from '../enhanced-conversation-manager';

export class MayaAgent extends BaseAgent {
    readonly name = 'Maya';
    readonly description = 'Intelligent reservation management specialist with enhanced question vs command detection';
    readonly capabilities = [
        'find_existing_reservation',
        'modify_reservation', 
        'cancel_reservation',
        'get_restaurant_info',
        'get_guest_history'
    ];

    /**
     * 🚨 CRITICAL FIX: Language enforcement rules for Maya Agent
     */
    private getLanguageEnforcementRules(language: Language): string {
        const languageNames: Record<Language, string> = {
            'en': 'English', 'ru': 'Russian', 'sr': 'Serbian', 'hu': 'Hungarian',
            'de': 'German', 'fr': 'French', 'es': 'Spanish', 'it': 'Italian',
            'pt': 'Portuguese', 'nl': 'Dutch', 'auto': 'English'
        };

        const currentLanguageName = languageNames[language] || 'English';
        
        return `🚨 CRITICAL MAYA LANGUAGE ENFORCEMENT RULES:

**MANDATORY LANGUAGE**: You MUST respond ONLY in ${currentLanguageName}.

**FORBIDDEN ACTIONS**:
❌ NEVER switch languages mid-response
❌ NEVER mix languages in a single response  
❌ NEVER respond in English if conversation language is ${currentLanguageName}
❌ NEVER change language without explicit user request

**REQUIRED BEHAVIOR**:
✅ ALL responses must be in ${currentLanguageName}
✅ Maintain warm, professional tone in ${currentLanguageName}
✅ Use natural, fluent ${currentLanguageName} expressions
✅ If unsure about translation, stay in ${currentLanguageName}

**LANGUAGE CONSISTENCY CHECK**:
Before sending any response, verify it's entirely in ${currentLanguageName}.
If you detect any English words or other languages, rewrite completely in ${currentLanguageName}.

**RESERVATION MANAGEMENT EXAMPLES IN ${currentLanguageName}**:
${this.getReservationExamples(language)}

Current conversation language: **${currentLanguageName}** (LOCKED)`;
    }

    /**
     * 🚨 CRITICAL FIX: Language-specific reservation management conversation examples
     */
    private getReservationExamples(language: Language): string {
        const examples: Record<Language, string> = {
            'en': `- "I found your reservation for July 15th at 7:30 PM for 4 people. What would you like to change?"
- "I can move your booking to 8:00 PM. Would that work better for you?"
- "Your reservation has been successfully modified to July 20th at 8:00 PM for 6 people."`,
            'ru': `- "Нашла вашу бронь на 15 июля в 19:30 на 4 человека. Что хотите изменить?"
- "Могу перенести на 20:00. Подойдёт ли это время?"
- "Ваша бронь успешно изменена на 20 июля в 20:00 на 6 человек."`,
            'sr': `- "Našla sam vašu rezervaciju za 15. jul u 19:30 za 4 osobe. Šta želite da promenite?"
- "Mogu da pomerim na 20:00. Da li bi vam to odgovaralo?"
- "Vaša rezervacija je uspešno promenjena na 20. jul u 20:00 za 6 osoba."`,
            'hu': `- "Megtaláltam a foglalását július 15-re 19:30-ra 4 főre. Mit szeretne módosítani?"
- "Át tudom tenni 20:00-ra. Ez megfelelne Önnek?"
- "A foglalása sikeresen módosítva július 20-ra 20:00-ra 6 főre."`,
            'de': `- "Ich habe Ihre Reservierung für den 15. Juli um 19:30 für 4 Personen gefunden. Was möchten Sie ändern?"
- "Ich kann sie auf 20:00 Uhr verschieben. Würde das besser passen?"
- "Ihre Reservierung wurde erfolgreich auf den 20. Juli um 20:00 für 6 Personen geändert."`,
            'fr': `- "J'ai trouvé votre réservation pour le 15 juillet à 19h30 pour 4 personnes. Que souhaitez-vous modifier?"
- "Je peux la déplacer à 20h00. Cela vous conviendrait-il mieux?"
- "Votre réservation a été modifiée avec succès au 20 juillet à 20h00 pour 6 personnes."`,
            'es': `- "Encontré su reserva para el 15 de julio a las 19:30 para 4 personas. ¿Qué le gustaría cambiar?"
- "Puedo moverla a las 20:00. ¿Le funcionaría mejor?"
- "Su reserva se ha modificado exitosamente al 20 de julio a las 20:00 para 6 personas."`,
            'it': `- "Ho trovato la sua prenotazione per il 15 luglio alle 19:30 per 4 persone. Cosa vorrebbe modificare?"
- "Posso spostarla alle 20:00. Le andrebbe meglio?"
- "La sua prenotazione è stata modificata con successo al 20 luglio alle 20:00 per 6 persone."`,
            'pt': `- "Encontrei sua reserva para 15 de julho às 19:30 para 4 pessoas. O que gostaria de alterar?"
- "Posso mover para as 20:00. Funcionaria melhor para você?"
- "Sua reserva foi modificada com sucesso para 20 de julho às 20:00 para 6 pessoas."`,
            'nl': `- "Ik heb uw reservering gevonden voor 15 juli om 19:30 voor 4 personen. Wat wilt u veranderen?"
- "Ik kan het naar 20:00 verplaatsen. Zou dat beter uitkomen?"
- "Uw reservering is succesvol gewijzigd naar 20 juli om 20:00 voor 6 personen."`,
            'auto': `- "I found your reservation for July 15th at 7:30 PM for 4 people. What would you like to change?"
- "I can move your booking to 8:00 PM. Would that work better for you?"
- "Your reservation has been successfully modified to July 20th at 8:00 PM for 6 people."`
        };

        return examples[language] || examples['en'];
    }

    /**
     * Generate Maya's system prompt with precise question vs command detection
     * Now includes specific instructions for handling general questions vs specific commands
     */
    generateSystemPrompt(context: AgentContext): string {
        const { language, guestHistory, conversationContext } = context;
        
        // 🔒 CRITICAL: Add language enforcement at the very beginning
        const languageEnforcement = this.getLanguageEnforcementRules(language);
        
        const currentTime = new Date().toISOString();

        const contextAwarenessSection = conversationContext ? `

🧠 CONVERSATION CONTEXT AWARENESS:
- Has asked for party size: ${conversationContext.hasAskedPartySize ? 'YES' : 'NO'}
- Has asked for date: ${conversationContext.hasAskedDate ? 'YES' : 'NO'}  
- Has asked for time: ${conversationContext.hasAskedTime ? 'YES' : 'NO'}
- Has asked for name: ${conversationContext.hasAskedName ? 'YES' : 'NO'}
- Has asked for phone: ${conversationContext.hasAskedPhone ? 'YES' : 'NO'}
- Current gathering info: ${JSON.stringify(conversationContext.gatheringInfo)}
- Session turn count: ${conversationContext.sessionTurnCount}
- Is return visit: ${conversationContext.isReturnVisit ? 'YES' : 'NO'}

⚠️ CRITICAL: DO NOT ask for information you have already requested in this conversation!
✅ Instead, use the information already provided or acknowledge it naturally.` : '';

        // 🎯 Critical action rules with precise question vs command detection
        const ENHANCED_CRITICAL_ACTION_RULES = `
🚨 **MAYA'S ENHANCED EXECUTION RULES - QUESTION vs COMMAND DETECTION (HIGHEST PRIORITY)** 🚨

Your primary purpose is to help with reservation modifications using intelligent question vs command detection.
You must FIRST determine if the user is asking a general question or giving a specific command.

**🔧 STEP 0: QUESTION vs COMMAND DETECTION (CRITICAL UX FIX)**

**GENERAL MODIFICATION QUESTIONS - Ask for Details:**
These are vague requests without specific new information. The user wants to modify something but hasn't said what.

**Detected General Question Patterns:**
- English: "Can I change my booking?", "Can I modify my reservation?", "Change my time?"
- Russian: "можно поменять бронь?", "можно время изменить?", "поменяйте мою бронь"
- Spanish: "¿puedo cambiar mi reserva?", "cambiar mi reservación"
- French: "puis-je changer ma réservation?", "modifier ma réservation"
- German: "kann ich meine Reservierung ändern?", "Buchung ändern"
- Italian: "posso cambiare la mia prenotazione?", "modificare prenotazione"
- Portuguese: "posso alterar minha reserva?", "mudar reserva"
- Dutch: "kan ik mijn reservering veranderen?", "boeking wijzigen"
- Hungarian: "megváltoztathatom a foglalásom?", "foglalás módosítása"
- Serbian: "mogu da promenim rezervaciju?", "promena rezervacije"

**RESPONSE PATTERN for General Questions:**
1. Find their booking first (if multiple, show options)
2. Ask what they want to change: "Что именно хотите изменить?"

**Example Flow for General Questions:**
User: "можно поменять бронь?"
Maya: "Конечно! Вижу вашу бронь на 6 августа в 19:30 на 2 человека. Что именно хотите изменить - время, количество гостей или что-то еще?"

**SPECIFIC MODIFICATION COMMANDS - Execute Immediately:**
These contain specific new details that are different from current booking.

**Detected Specific Command Patterns:**
- Contains specific times: "change to 8pm", "поменяйте на 20:00", "move to tomorrow"
- Contains specific dates: "change to July 20th", "перенесите на завтра"
- Contains specific guest counts: "make it for 5 people", "на 6 человек"
- Contains multiple specifics: "change to 8pm for 4 people"

**RESPONSE PATTERN for Specific Commands:**
1. Validate changes are actually different from current booking
2. Execute modification immediately
3. Confirm what was changed

**Example Flow for Specific Commands:**
User: "change to 8pm"
Maya: "Меняю время с 19:30 на 20:00... Готово! Ваша бронь теперь на 20:00."

**🔧 STEP 1: MANDATORY WORKFLOW FOR GENERAL QUESTIONS**

When you detect a general modification question:

**IF user has guestHistory available (you can see their phone number in the context):**
1. IMMEDIATELY call \`find_existing_reservation\` tool with:
   - \`identifier\`: Use guest's phone from guestHistory
   - \`identifierType\`: "phone"
   - \`timeRange\`: "upcoming"
2. DO NOT ask for modification details yet - find their bookings first
3. After finding booking(s), ask what they want to change

**IF user does NOT have guestHistory available:**
1. Ask for their phone number or name to find their booking
2. Example: "I'd be happy to help! Can you provide your phone number or name so I can find your booking?"

**🔧 STEP 2: RESPONSE PATTERNS AFTER FINDING BOOKINGS (For General Questions)**

**If ONE upcoming booking found:**
- ✅ English: "I found your upcoming reservation for [date] at [time] for [guests] people. What changes would you like to make?"
- ✅ Russian: "Вижу вашу предстоящую бронь на [дату] в [время] на [количество] человек. Что именно хотите изменить - время, количество гостей или что-то еще?"
- ✅ Spanish: "Encontré su reserva para el [fecha] a las [hora] para [huéspedes] personas. ¿Qué cambios le gustaría hacer?"

**If MULTIPLE upcoming bookings found:**
- ✅ **CRITICAL: You MUST list ALL upcoming reservations found. The following format is an example; you must display every single one you find, not just two.**
- ✅ English: "I found several upcoming reservations for you:
  • Reservation #[ID1]: [Date1] at [Time1] for [Guests1] people
  • Reservation #[ID2]: [Date2] at [Time2] for [Guests2] people
  • ... (continue for all other found reservations)
  Which one would you like to modify?"
- ✅ Russian: "У вас несколько предстоящих броней:
  • Бронь #[ID1]: [Дата1] в [Время1] на [Гостей1] человек
  • Бронь #[ID2]: [Дата2] в [Время2] на [Гостей2] человек
  • ... (продолжить для всех остальных найденных броней)
  Какую хотите изменить?"

**If NO upcoming bookings found:**
- ✅ English: "I don't see any upcoming reservations under your name. Would you like to make a new booking instead?"
- ✅ Russian: "Не вижу предстоящих броней на ваше имя. Хотите сделать новую бронь?"

**🔧 STEP 3: SPECIFIC COMMANDS - Direct Execution Path**

For specific commands with clear booking reference and changes:
- "Change reservation #5 to 8 PM" → Execute immediately after validation
- "Move my July 15th booking to 7 PM" → Find July 15th booking, validate, then execute
- "поменяйте на 20:00" (change to 8 PM) → Execute with current booking context

**🔧 STEP 4: NO-OP PREVENTION (CRITICAL UX FIX)**

Before executing ANY modification, you MUST validate:
1. **Requested changes are actually different** from current reservation
2. **If changes are identical** to current booking, ask for clarification:
   - "I see your reservation is already at 19:00. Did you want a different time?"
   - "Ваша бронь уже на 19:00. Хотели другое время?"
3. **If changes are valid and different**, execute immediately

**🚫 FORBIDDEN BEHAVIORS (CRITICAL UX FIXES):**
- ❌ NEVER execute modifications without new details that are different from current booking
- ❌ NEVER execute no-op modifications (same time/date/guests as current)
- ❌ NEVER assume what user wants to change for general questions
- ❌ NEVER skip the "what do you want to change?" step for general questions
- ❌ NEVER call modify_reservation for general questions without specific new details

**✅ REQUIRED BEHAVIORS (UX PATTERNS):**
- ✅ General question → Find booking → Ask what to change
- ✅ Specific command → Validate changes → Execute → Confirm
- ✅ No-op prevention → "Already at that time, did you mean different?"
- ✅ Natural, helpful language appropriate to the situation

**✅ ENHANCED WORKFLOW EXAMPLES (From UX Document):**

**Scenario A: General Question (FIXED UX)**
User: "можно поменять бронь?"
Maya: [Calls find_existing_reservation with guest's phone]
Maya: "Конечно! Вижу вашу бронь на 6 августа в 19:30 на 2 человека. Что именно хотите изменить - время, количество гостей или что-то еще?"

**Scenario B: Specific Command**
User: "change to 8pm"
Maya: [Finds booking, validates 8pm is different, calls modify_reservation]
Maya: "Меняю время с 19:30 на 20:00... Готово! Ваша бронь теперь на 20:00."

**Scenario C: No-Op Prevention**
User: "Change my booking to 7 PM" (but reservation is already at 7 PM)
Maya: "Вижу, что ваша бронь уже на 19:00. Хотели другое время?"

**Scenario D: Multiple Bookings**
User: "Can I change my booking time?"
Maya: [Calls find_existing_reservation]
Maya: "I found two upcoming reservations:
• Reservation #12: July 15th at 7:00 PM for 4 people
• Reservation #15: July 20th at 8:00 PM for 2 people
Which one would you like to modify?"

This enhanced approach ensures users get the most natural, helpful experience while preventing over-eager modifications and no-op changes.
`;

        const personalizedSection = this.getPersonalizedPromptSection(guestHistory, language);

        const restaurantInfo = `
🏪 RESTAURANT INFO:
- Name: ${this.restaurantConfig.name}
- Hours: ${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime}
- Current Time: ${currentTime}
- Timezone: ${this.restaurantConfig.timezone}`;

        const reservationDisplayRules = `
✅ **CRITICAL RESERVATION DISPLAY RULES:**
- When showing multiple reservations, ALWAYS display them with their real IDs: "Reservation #1: July 15th..."
- NEVER use generic lists like "1, 2, 3". Always use "#1, #2".
- Be specific about dates and times when presenting options
- Always include guest count and key details for clarity
`;

        return `${languageEnforcement}

You are Maya, the intelligent reservation management specialist for ${this.restaurantConfig.name}.

🎯 **YOUR ROLE & CORE DIRECTIVE**
- You are an intelligent assistant that helps guests with EXISTING reservations
- Your primary directive is to follow the **ENHANCED EXECUTION RULES** with question vs command detection
- You must distinguish between general questions and specific commands
- You must prevent over-eager modifications and no-op changes
- You must establish booking context before asking for modification details

${ENHANCED_CRITICAL_ACTION_RULES}

${reservationDisplayRules}

💬 COMMUNICATION STYLE:
- Understanding and helpful with natural conversation flow
- Proactive in gathering necessary context
- Ask for clarification when needed
- Efficient execution when details are clear and validated
- Secure and professional
- Context-aware and intelligent

${contextAwarenessSection}

${restaurantInfo}

${personalizedSection}

🎯 **SUMMARY OF YOUR ENHANCED BEHAVIOR:**
1. **First**: Determine if user is asking a general question or giving a specific command
2. **If general modification question**: Call find_existing_reservation to establish context, then ask what to change
3. **After finding bookings**: Present clear options and ask for specific modification details
4. **If specific command**: Validate changes are actually different from current reservation
5. **If valid changes**: Execute modification immediately
6. **If invalid/identical changes**: Ask for clarification (no-op prevention)
7. **Always**: Use natural, helpful language with proactive context gathering

This enhanced approach provides users with intelligent, context-aware assistance while preventing over-eager modifications and ensuring natural conversation flow.`;
    }

    /**
     * 🎯 Handle Maya's message processing with precise question vs command detection
     * Now includes enhanced logic to prevent over-eagerness and no-op modifications
     */
    async handleMessage(message: string, context: AgentContext): Promise<AgentResponse> {
        try {
            // 🎯 More precise detection logic
            const messageAnalysis = this.analyzeUserMessage(message, context.language);
            const hasGuestHistory = !!(context.guestHistory && context.guestHistory.guest_phone);
            
            console.log(`🔄 [Maya-Enhanced] Message analysis:`, {
                messageType: messageAnalysis.type,
                hasSpecificDetails: messageAnalysis.hasSpecificDetails,
                hasGuestHistory,
                conversationLanguage: context.language || 'auto',
                detectedPatterns: messageAnalysis.detectedPatterns
            });

            if (messageAnalysis.type === 'general_question' && hasGuestHistory) {
                console.log(`🔄 [Maya-Enhanced] General modification question detected with guest history`);
                console.log(`🔄 [Maya-Enhanced] Will find bookings first, then ask "what exactly do you want to change?"`);
            } else if (messageAnalysis.type === 'general_question' && !hasGuestHistory) {
                console.log(`🔄 [Maya-Enhanced] General modification question detected without guest history`);
                console.log(`🔄 [Maya-Enhanced] Will ask for identifier first`);
            } else if (messageAnalysis.type === 'specific_command') {
                console.log(`🔄 [Maya-Enhanced] Specific command detected with details:`, messageAnalysis.specificDetails);
                console.log(`🔄 [Maya-Enhanced] Will validate changes and execute if different`);
            }

            // Generate enhanced system prompt with question vs command detection rules
            const systemPrompt = this.generateSystemPrompt(context);
            
            // Use BaseAgent's AI generation with enhanced Maya prompt
            const response = await this.generateAIResponse(systemPrompt, message, context);
            
            console.log(`🎯 [Maya-Enhanced] Processed with question vs command detection: "${message.substring(0, 50)}..."`);
            console.log(`🎯 [Maya-Enhanced] Message type: ${messageAnalysis.type}`);
            console.log(`🎯 [Maya-Enhanced] Has specific details: ${messageAnalysis.hasSpecificDetails}`);
            console.log(`🎯 [Maya-Enhanced] Conversation language: ${context.language || 'auto'}`);
            
            return {
                content: response,
                metadata: {
                    processedAt: new Date().toISOString(),
                    agentType: this.name,
                    confidence: 0.9,
                    decisionModel: 'enhanced-question-vs-command-detection',
                    contextResolutionUsed: context.enableContextResolution || false,
                    conversationLanguage: context.language || 'auto',
                    messageType: messageAnalysis.type,
                    hasSpecificDetails: messageAnalysis.hasSpecificDetails,
                    guestHistoryAvailable: hasGuestHistory,
                    overEagernessPrevention: true,
                    noOpPrevention: true,
                    bugFixesApplied: ['LANGUAGE_ENFORCEMENT', 'QUESTION_VS_COMMAND_DETECTION']
                }
            };
        } catch (error) {
            console.error('[Maya-Enhanced] Error processing message:', error);
            return this.handleError(error, `Maya enhanced processing: ${message.substring(0, 30)}`);
        }
    }

    /**
     * 🎯 NEW: Comprehensive message analysis for precise question vs command detection
     * This is the key enhancement that prevents over-eagerness
     */
    private analyzeUserMessage(message: string, language: Language): {
        type: 'general_question' | 'specific_command' | 'unclear';
        hasSpecificDetails: boolean;
        specificDetails: string[];
        detectedPatterns: string[];
    } {
        const lowerMessage = message.toLowerCase().trim();
        
        // 🎯 ENHANCED: Check for specific details first
        const specificDetails = this.extractSpecificDetails(lowerMessage);
        const hasSpecificDetails = specificDetails.length > 0;
        
        // 🎯 ENHANCED: Detect general modification patterns
        const generalPatterns = this.detectGeneralModificationPatterns(lowerMessage, language);
        const isGeneralPattern = generalPatterns.length > 0;
        
        console.log(`🔍 [Maya-Analysis] Message: "${message}"`);
        console.log(`🔍 [Maya-Analysis] Specific details found: ${specificDetails}`);
        console.log(`🔍 [Maya-Analysis] General patterns found: ${generalPatterns}`);
        console.log(`🔍 [Maya-Analysis] Has specific details: ${hasSpecificDetails}`);
        console.log(`🔍 [Maya-Analysis] Is general pattern: ${isGeneralPattern}`);
        
        // 🎯 ENHANCED: Decision logic
        if (isGeneralPattern && !hasSpecificDetails) {
            return {
                type: 'general_question',
                hasSpecificDetails: false,
                specificDetails: [],
                detectedPatterns: generalPatterns
            };
        } else if (hasSpecificDetails) {
            return {
                type: 'specific_command',
                hasSpecificDetails: true,
                specificDetails,
                detectedPatterns: generalPatterns
            };
        } else {
            return {
                type: 'unclear',
                hasSpecificDetails: false,
                specificDetails: [],
                detectedPatterns: []
            };
        }
    }

    /**
     * 🎯 NEW: Extract specific modification details from user message
     * Detects concrete new information like times, dates, guest counts
     */
    private extractSpecificDetails(message: string): string[] {
        const details: string[] = [];
        
        // Time patterns
        const timePatterns = [
            /\b\d{1,2}:\d{2}\b/g, // 19:30, 8:45
            /\b\d{1,2}\s*(pm|am)\b/gi, // 8pm, 7 AM
            /\b\d{1,2}\s*(часов|вечера|утра)\b/gi, // 8 вечера, 7 утра
            /\b(eight|seven|six|nine|ten)\s*(pm|am|o'clock)\b/gi // eight pm
        ];
        
        for (const pattern of timePatterns) {
            const matches = message.match(pattern);
            if (matches) {
                details.push(...matches.map(m => `time:${m}`));
            }
        }
        
        // Date patterns
        const datePatterns = [
            /\b(tomorrow|today|завтра|сегодня)\b/gi,
            /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
            /\b(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)\b/gi,
            /\b\d{1,2}\/\d{1,2}\b/g, // 7/15
            /\b\d{1,2}\s*(july|august|september|october|november|december|января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b/gi
        ];
        
        for (const pattern of datePatterns) {
            const matches = message.match(pattern);
            if (matches) {
                details.push(...matches.map(m => `date:${m}`));
            }
        }
        
        // Guest count patterns
        const guestPatterns = [
            /\b\d+\s*(people|person|guests|человек|людей|гостей)\b/gi,
            /\bfor\s+\d+\b/gi,
            /\bна\s+\d+\b/gi
        ];
        
        for (const pattern of guestPatterns) {
            const matches = message.match(pattern);
            if (matches) {
                details.push(...matches.map(m => `guests:${m}`));
            }
        }
        
        return details;
    }

    /**
     * 🎯 NEW: Detect general modification patterns (questions without specific details)
     * Enhanced pattern matching for better question detection
     */
    private detectGeneralModificationPatterns(message: string, language: Language): string[] {
        const patterns: string[] = [];
        
        // Enhanced patterns for general modification questions
        const generalQuestionPatterns = {
            en: [
                /\b(can|could|may)\s+i\s+(change|modify|update|reschedule|move)\b/i,
                /\b(change|modify|update|reschedule|move)\s+(my|the)\s+(booking|reservation)\b/i,
                /\bhow\s+(can|do)\s+i\s+(change|modify)\b/i,
                /\b(change|modify)\s+(time|date|booking|reservation)\s*\?/i
            ],
            ru: [
                /\b(могу|можно|возможно)\b.*\b(поменять|изменить|перенести)\b/i,
                /\b(поменять|изменить|перенести)\b.*\b(бронь|резерв|столик|время|дату)\b/i,
                /\b(поменяйте|измените|перенесите)\b.*\b(мою|нашу)\s+(бронь|резерв)\b/i,
                /\b(время|дату)\s+(поменять|изменить|перенести)\b.*\?/i
            ],
            es: [
                /\b(puedo|podría|es\s+posible)\b.*\b(cambiar|modificar)\b/i,
                /\b(cambiar|modificar)\b.*\b(mi|la)\s+(reserva|reservación)\b/i
            ],
            fr: [
                /\b(puis-je|pourrais-je|est-ce\s+possible)\b.*\b(changer|modifier)\b/i,
                /\b(changer|modifier)\b.*\b(ma|la)\s+(réservation)\b/i
            ],
            de: [
                /\b(kann|könnte)\s+ich\b.*\b(ändern|wechseln|verschieben)\b/i,
                /\b(ändern|wechseln|verschieben)\b.*\b(meine|die)\s+(reservierung|buchung)\b/i
            ],
            it: [
                /\b(posso|potrei)\b.*\b(cambiare|modificare)\b/i,
                /\b(cambiare|modificare)\b.*\b(la\s+mia|la)\s+(prenotazione)\b/i
            ],
            pt: [
                /\b(posso|poderia)\b.*\b(alterar|mudar|modificar)\b/i,
                /\b(alterar|mudar|modificar)\b.*\b(minha|a)\s+(reserva)\b/i
            ],
            nl: [
                /\b(kan|zou)\s+ik\b.*\b(veranderen|wijzigen)\b/i,
                /\b(veranderen|wijzigen)\b.*\b(mijn|de)\s+(reservering|boeking)\b/i
            ],
            hu: [
                /\b(tudok|tudnék|lehet)\b.*\b(változtatni|módosítani)\b/i,
                /\b(változtatni|módosítani)\b.*\b(foglalásom|foglalás)\b/i
            ],
            sr: [
                /\b(mogu|mogao|moguće)\b.*\b(promeniti|izmeniti|pomeriti)\b/i,
                /\b(promeniti|izmeniti)\b.*\b(moju|rezervaciju)\b/i
            ]
        };

        const languagePatterns = generalQuestionPatterns[language] || generalQuestionPatterns.en;
        
        for (const pattern of languagePatterns) {
            if (pattern.test(message)) {
                patterns.push(pattern.toString());
            }
        }
        
        return patterns;
    }

    /**
     * Enhanced detection for general modification questions (legacy method for compatibility)
     */
    private detectGeneralModificationQuestion(message: string, language: Language): boolean {
        const analysis = this.analyzeUserMessage(message, language);
        return analysis.type === 'general_question';
    }

    /**
     * Get personalized prompt section with natural conversation patterns
     * Provides context about guest history for more personalized service
     */
    // REPLACE with this NEW version
    private getPersonalizedPromptSection(guestHistory: any | null, language: Language): string {
        // If there's no guest history, return an empty string as before.
        if (!guestHistory || guestHistory.total_bookings === 0) {
            return '';
        }

        const { guest_name, total_bookings, last_visit_date } = guestHistory;

        // This creates a language-neutral block of data.
        // It contains only data points and instructions for the AI in English,
        // which the AI will use to generate a response in the target language.
        const guestDataBlock = `
👤 GUEST DATA (for personalization):
- Guest-Name: ${guest_name}
- Total-Previous-Bookings: ${total_bookings}
- Last-Visit: ${last_visit_date || 'N/A'}

💡 PERSONALIZATION GUIDELINES:
- Use the data above to personalize your response in the user's language.
- If Total-Previous-Bookings >= 3, greet them warmly as a valued returning guest (e.g., "Welcome back, [Guest Name]!").
- Do not just list this data to the user. Use it to make your conversation sound more natural and welcoming.`;

        return guestDataBlock;
    }

    /**
     * Get Maya's specialized tools for reservation management
     * Enhanced with comprehensive modification and search capabilities
     */
    getTools() {
        return [
            {
                type: "function" as const,
                function: {
                    name: "get_restaurant_info",
                    description: "Get restaurant information, hours, location, contact details",
                    parameters: {
                        type: "object",
                        properties: {
                            infoType: {
                                type: "string",
                                enum: ["hours", "location", "cuisine", "contact", "features", "all"],
                                description: "Type of information to retrieve"
                            }
                        },
                        required: ["infoType"]
                    }
                }
            },
            {
                type: "function" as const,
                function: {
                    name: "get_guest_history",
                    description: "Get guest's booking history for personalized service",
                    parameters: {
                        type: "object",
                        properties: {
                            telegramUserId: {
                                type: "string",
                                description: "Guest's telegram user ID"
                            }
                        },
                        required: ["telegramUserId"]
                    }
                }
            },
            {
                type: "function" as const,
                function: {
                    name: "find_existing_reservation",
                    description: "Find guest's existing reservations with enhanced search capabilities. Use this to establish booking context before asking for modification details.",
                    parameters: {
                        type: "object",
                        properties: {
                            identifier: {
                                type: "string",
                                description: "Phone number, guest name, or confirmation number to search by"
                            },
                            identifierType: {
                                type: "string",
                                enum: ["phone", "telegram", "name", "confirmation", "auto"],
                                description: "Type of identifier being used. Use 'auto' to let the system decide."
                            },
                            timeRange: {
                                type: "string",
                                enum: ["upcoming", "past", "all"],
                                description: "Time range to search: 'upcoming' for future reservations (default), 'past' for historical reservations, 'all' for complete history"
                            },
                            includeStatus: {
                                type: "array",
                                items: { 
                                    type: "string",
                                    enum: ["created", "confirmed", "completed", "canceled"]
                                },
                                description: "Reservation statuses to include. Defaults: ['created', 'confirmed'] for upcoming, ['completed', 'canceled'] for past"
                            }
                        },
                        required: ["identifier"]
                    }
                }
            },
            {
                type: "function" as const,
                function: {
                    name: "modify_reservation",
                    description: "🚨 CRITICAL: Only call this when you have specific new details that are DIFFERENT from the current reservation. Always establish booking context first for general modification questions. NEVER call this for general questions like 'can I change my booking?'",
                    parameters: {
                        type: "object",
                        properties: {
                            reservationId: {
                                type: "number",
                                description: "ID of the reservation to modify (can be resolved from context)"
                            },
                            modifications: {
                                type: "object",
                                properties: {
                                    newDate: {
                                        type: "string",
                                        description: "New date in yyyy-MM-dd format (only if different from current)"
                                    },
                                    newTime: {
                                        type: "string",
                                        description: "New time in HH:MM format (only if different from current)"
                                    },
                                    newGuests: {
                                        type: "number",
                                        description: "New number of guests (only if different from current)"
                                    },
                                    newSpecialRequests: {
                                        type: "string",
                                        description: "Updated special requests (optional)"
                                    }
                                }
                            },
                            reason: {
                                type: "string",
                                description: "Reason for the modification",
                                default: "Guest requested change"
                            }
                        },
                        required: ["modifications"]
                    }
                }
            },
            {
                type: "function" as const,
                function: {
                    name: "cancel_reservation",
                    description: "Cancel an existing reservation with proper confirmation",
                    parameters: {
                        type: "object",
                        properties: {
                            reservationId: {
                                type: "number",
                                description: "ID of the reservation to cancel"
                            },
                            reason: {
                                type: "string",
                                description: "Reason for cancellation",
                                default: "Guest requested cancellation"
                            },
                            confirmCancellation: {
                                type: "boolean",
                                description: "Explicit confirmation from guest that they want to cancel"
                            }
                        },
                        required: ["reservationId"]
                    }
                }
            }
        ];
    }

    /**
     * Enhanced agent validation with question vs command detection checks
     */
    async validateAgent(): Promise<{ valid: boolean; errors: string[] }> {
        const baseValidation = await super.validateAgent();
        const errors = [...baseValidation.errors];

        // Maya-specific validations
        if (!this.capabilities.includes('find_existing_reservation')) {
            errors.push('Maya must have find_existing_reservation capability');
        }

        if (!this.capabilities.includes('modify_reservation')) {
            errors.push('Maya must have modify_reservation capability');
        }

        if (!this.capabilities.includes('cancel_reservation')) {
            errors.push('Maya must have cancel_reservation capability');
        }

        // Validate tools are available
        const tools = this.getTools();
        const requiredTools = ['find_existing_reservation', 'modify_reservation', 'cancel_reservation'];
        const toolNames = tools.map(tool => tool.function.name);
        
        for (const requiredTool of requiredTools) {
            if (!toolNames.includes(requiredTool)) {
                errors.push(`Maya missing required tool: ${requiredTool}`);
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Enhanced performance metrics with question vs command detection tracking
     */
    getPerformanceMetrics() {
        const baseMetrics = super.getPerformanceMetrics();
        
        return {
            ...baseMetrics,
            specialization: 'reservation-management',
            tieredConfidenceModel: true,
            contextManagerIntegration: true,
            contextFirstApproach: true,
            questionVsCommandDetection: true, // NEW
            generalModificationDetection: true,
            specificDetailsExtraction: true, // NEW
            proactiveContextGathering: true,
            overEagernessPrevention: true,
            noOpPrevention: true, // NEW
            parameterValidation: true,
            reservationTools: ['find_existing_reservation', 'modify_reservation', 'cancel_reservation'],
            securityValidation: true,
            multiLanguageSupport: true,
            languageEnforcement: true, // NEW
            naturalConversationFlow: true,
            enhancedUXPatterns: true // NEW
        };
    }
}

// Helper function to create Maya agent with enhanced configuration
export function createMayaAgent(restaurantConfig: RestaurantConfig): MayaAgent {
    const defaultConfig: AgentConfig = {
        name: 'Maya',
        description: 'Intelligent reservation management specialist with enhanced question vs command detection',
        capabilities: [
            'find_existing_reservation',
            'modify_reservation', 
            'cancel_reservation',
            'get_restaurant_info',
            'get_guest_history'
        ],
        maxTokens: 1200,
        temperature: 0.3,
        primaryModel: 'sonnet',
        fallbackModel: 'haiku',
        enableContextResolution: true,
        enableTranslation: true,
        enablePersonalization: true
    };

    return new MayaAgent(defaultConfig, restaurantConfig);
}