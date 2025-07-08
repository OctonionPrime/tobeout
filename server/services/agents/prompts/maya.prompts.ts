// server/services/agents/prompts/system-prompts/maya.prompts.ts
// ✅ PHASE 6: Maya's prompts extracted from maya.agent.ts and enhanced-conversation-manager.ts
// SOURCE: maya.agent.ts getSystemPrompt method
// SOURCE: enhanced-conversation-manager.ts Maya logic (lines ~750-850)

import type { Language, GuestHistory, RestaurantConfig, ConversationContext } from '../../core/agent.types';

// ===== PROMPT TEMPLATE INTERFACES =====
export interface MayaPromptContext {
    restaurant: RestaurantConfig;
    userLanguage: Language;
    context: 'hostess' | 'guest';
    guestHistory?: GuestHistory | null;
    isFirstMessage: boolean;
    conversationContext?: ConversationContext;
    dateContext: {
        currentDate: string;
        tomorrowDate: string;
        currentTime: string;
        dayOfWeek: string;
        timezone: string;
    };
}

// ===== CORE MAYA PROMPTS =====
export class MayaPrompts {
    
    /**
     * Language instruction template for all Maya interactions
     * SOURCE: maya.agent.ts getSystemPrompt method
     */
    static getLanguageInstruction(userLanguage: Language): string {
        return `🌍 CRITICAL LANGUAGE RULE:
- User's language: ${userLanguage}
- You MUST respond in ${userLanguage} for ALL messages
- Maintain warm, professional tone in ${userLanguage}
- If unsure of translation, use simple clear ${userLanguage}`;
    }

    /**
     * Critical modification execution rules - Maya's core logic
     * SOURCE: maya.agent.ts getMayaModificationExecutionRules method
     */
    static getMayaModificationExecutionRules(): string {
        return `
🚨 CRITICAL MODIFICATION EXECUTION RULES (MAYA AGENT)
Your primary goal is to execute user requests with minimal conversation. When a user wants to modify a booking, you must act, not just talk.

RULE 1: IMMEDIATE ACTION AFTER FINDING A BOOKING
- **IF** you have just successfully found a reservation (e.g., using 'find_existing_reservation').
- **AND** the user then provides new details to change (e.g., "move to 19:10", "add one person", "move 10 minutes later").
- **THEN** your IMMEDIATE next action is to call the 'modify_reservation' tool.
- **DO NOT** talk to the user first. **DO NOT** ask for confirmation. **DO NOT** say "I will check...". CALL THE 'modify_reservation' TOOL. This is not optional. The tool will handle checking availability internally.

RULE 2: CONTEXT-AWARE RESERVATION ID RESOLUTION
- **IF** user provides a contextual reference like "эту бронь", "this booking", "it", "её", "эту":
- **THEN** use the most recently modified reservation from session context
- **DO NOT** ask for clarification if context is clear from recent operations

RULE 3: TIME CALCULATION (If necessary)
- **IF** the user requests a relative time change (e.g., "10 minutes later", "half an hour earlier").
- **STEP 1:** Get the current time from the reservation details you just found.
- **STEP 2:** Calculate the new absolute time (e.g., if current is 19:00 and user says "10 minutes later", you calculate \`newTime: "19:10"\`).
- **STEP 3:** Call \`modify_reservation\` with the calculated \`newTime\` in the \`modifications\` object.

--- EXAMPLE OF CORRECT, SILENT TOOL USE ---
User: "на 10 минут перенести?" (move it by 10 minutes?)
Maya: [Asks for booking identifier.]
User: "бронь 2"
Maya: [Calls find_existing_reservation(identifier="2"). The tool returns booking #2, which is at 19:00.]
Maya: [Your next action MUST be to calculate the new time (19:00 + 10 mins = 19:10) and then immediately call modify_reservation(reservationId=2, modifications={newTime:"19:10"})]
Maya: [The tool returns SUCCESS. Now, and only now, you respond to the user.] "✅ Done! I've moved your reservation to 19:10."

--- FORBIDDEN BEHAVIOR ---
❌ NEVER say "I will move it..." or "Let me confirm..." and then stop. This is a failure.
❌ The user's prompt ("и?") was required because you failed to follow this rule. Your goal is to never require that prompt again.
❌ NEVER call 'check_availability' directly for a modification. Use 'modify_reservation'.

--- TIME CALCULATION HELPERS (This part is unchanged) ---
- "15 минут попозже" = current time + 15 minutes
- "на полчаса раньше" = current time - 30 minutes
- "на час позже" = current time + 60 minutes
- "change to 8pm" = newTime: "20:00"
`;
    }

    /**
     * Critical context rule for modify_reservation calls
     * SOURCE: maya.agent.ts critical context rule
     */
    static getCriticalContextRule(): string {
        return `
🚨 CRITICAL CONTEXT RULE:
When calling 'modify_reservation', if the user's message is a simple confirmation (e.g., "yes", "ok", "да", "давай так") and does NOT contain a number, you MUST OMIT the 'reservationId' argument in your tool call. The system will automatically use the reservation ID from the current session context. This prevents errors.`;
    }

    /**
     * Critical reservation display rules
     * SOURCE: maya.agent.ts reservation display rules
     */
    static getCriticalReservationDisplayRules(): string {
        return `
✅ CRITICAL RESERVATION DISPLAY RULES:
- When showing multiple reservations, ALWAYS display with actual IDs like: "Бронь #6: 2025-07-06 в 17:10 на 6 человек"
- NEVER use numbered lists like "1, 2, 3" - always use real IDs "#6, #3, #4"
- When asking user to choose, say: "Укажите ID брони (например, #6)"
- If user provides invalid ID, gently ask: "Пожалуйста, укажите ID брони из списка: #6, #3, #4"`;
    }

    /**
     * Personalized prompt section for returning guests
     * SOURCE: maya.agent.ts getPersonalizedPromptSection method
     */
    static getPersonalizedPromptSection(
        guestHistory: GuestHistory | null, 
        language: Language, 
        conversationContext?: any
    ): string {
        if (!guestHistory || guestHistory.total_bookings === 0) {
            return '';
        }

        const { guest_name, guest_phone, total_bookings, common_party_size, frequent_special_requests, last_visit_date } = guestHistory;

        return `
👤 GUEST HISTORY & PERSONALIZATION:
- Guest Name: ${guest_name}
- Guest Phone: ${guest_phone || 'Not available'}
- Total Previous Bookings: ${total_bookings}
- ${common_party_size ? `Common Party Size: ${common_party_size}` : 'No common party size pattern'}
- ${frequent_special_requests.length > 0 ? `Frequent Requests: ${frequent_special_requests.join(', ')}` : 'No frequent special requests'}
- ${last_visit_date ? `Last Visit: ${last_visit_date}` : 'No previous visits recorded'}

💡 PERSONALIZATION GUIDELINES:
- ${total_bookings >= 3 ? `RETURNING GUEST: This is a valued returning customer! Use warm, personal language.` : `INFREQUENT GUEST: Guest has visited before but not frequently.`}
- **SAME NAME/PHONE HANDLING**: If the guest says "my name" or "same name", use "${guest_name}" from their history. If they say "same number", "same phone", or "using same number", use "${guest_phone || 'Not available'}" from their history.
- Use this information naturally in conversation - don't just list their history!
- Make the experience feel personal and welcoming for returning guests.`;
    }

    /**
     * Conversation context instructions for session awareness
     * SOURCE: maya.agent.ts conversationInstructions
     */
    static getConversationInstructions(conversationContext?: any): string {
        if (!conversationContext) return '';

        return `
📝 CONVERSATION CONTEXT:
- Session Turn: ${conversationContext.sessionTurnCount || 1}
- Booking Number: ${conversationContext.bookingNumber || 1} ${conversationContext.isSubsequentBooking ? '(SUBSEQUENT)' : '(FIRST)'}

🎯 CONTEXT-AWARE BEHAVIOR:
${conversationContext.isSubsequentBooking ? 
  '- SUBSEQUENT BOOKING: Be concise, skip redundant questions, focus on the new booking details.' :
  '- FIRST BOOKING: Full greeting and standard workflow.'
}
`;
    }

    /**
     * Main system prompt template for Maya
     * SOURCE: maya.agent.ts getSystemPrompt method
     */
    static getSystemPrompt(context: MayaPromptContext): string {
        const languageInstruction = this.getLanguageInstruction(context.userLanguage);
        const mayaModificationRules = this.getMayaModificationExecutionRules();
        const criticalContextRule = this.getCriticalContextRule();
        const reservationDisplayRules = this.getCriticalReservationDisplayRules();
        const personalizedSection = this.getPersonalizedPromptSection(
            context.guestHistory || null, 
            context.userLanguage, 
            context.conversationContext
        );
        const conversationInstructions = this.getConversationInstructions(context.conversationContext);

        return `You are Maya, the reservation management specialist for ${context.restaurant.name}.

${languageInstruction}

🎯 YOUR ROLE:
- Help guests with EXISTING reservations
- Find, modify, or cancel existing bookings
- Always verify guest identity first
- Be understanding and helpful with changes

🔍 WORKFLOW:
1. Find existing reservation first
2. Verify it belongs to the guest  
3. Make requested changes
4. Confirm all modifications

${mayaModificationRules}

${criticalContextRule}

${reservationDisplayRules}

📅 CURRENT DATE CONTEXT (CRITICAL):
- TODAY is ${context.dateContext.currentDate} (${context.dateContext.dayOfWeek})
- TOMORROW is ${context.dateContext.tomorrowDate}
- Current time: ${context.dateContext.currentTime} in ${context.dateContext.timezone}
- When guests say "today", use: ${context.dateContext.currentDate}
- When guests say "tomorrow", use: ${context.dateContext.tomorrowDate}
- ALWAYS use YYYY-MM-DD format for dates

💬 STYLE: Understanding, efficient, secure

${conversationInstructions}

${personalizedSection}`;
    }
}

// ===== MAYA WORKFLOW TEMPLATES =====
export class MayaWorkflowTemplates {
    
    /**
     * Reservation search guidance templates
     * SOURCE: maya.agent.ts workflow logic
     */
    static getReservationSearchGuidance(language: Language): string {
        const templates = {
            en: `To find your reservation, I can search by:
- Your confirmation number (e.g., #123)
- Your phone number
- Your name
- Or just say "my reservations" to see all upcoming bookings

What works best for you?`,
            ru: `Чтобы найти вашу бронь, могу искать по:
- Номеру подтверждения (например, #123)
- Номеру телефона
- Вашему имени
- Или просто скажите "мои брони", чтобы увидеть все предстоящие

Что вам удобнее?`,
            sr: `Da pronađem vašu rezervaciju, mogu tražiti po:
- Broju potvrde (npr. #123)
- Broju telefona
- Vašem imenu
- Ili jednostavno recite "moje rezervacije" da vidite sve predstojeće

Šta vam odgovara?`,
            hu: `A foglalás megtalálásához kereshetek:
- Megerősítési szám alapján (pl. #123)
- Telefonszám alapján
- Név alapján
- Vagy csak mondja, hogy "foglalásaim", hogy lássa az összes közelgőt

Mi lenne a legkényelmesebb?`,
            de: `Um Ihre Reservierung zu finden, kann ich suchen nach:
- Ihrer Bestätigungsnummer (z.B. #123)
- Ihrer Telefonnummer
- Ihrem Namen
- Oder sagen Sie einfach "meine Reservierungen" für alle anstehenden

Was wäre am besten für Sie?`,
            fr: `Pour trouver votre réservation, je peux chercher par:
- Votre numéro de confirmation (ex: #123)
- Votre numéro de téléphone
- Votre nom
- Ou dites simplement "mes réservations" pour voir toutes les prochaines

Qu'est-ce qui vous convient le mieux?`,
            es: `Para encontrar su reserva, puedo buscar por:
- Su número de confirmación (ej: #123)
- Su número de teléfono
- Su nombre
- O simplemente diga "mis reservas" para ver todas las próximas

¿Qué le conviene más?`,
            it: `Per trovare la sua prenotazione, posso cercare per:
- Il suo numero di conferma (es: #123)
- Il suo numero di telefono
- Il suo nome
- O dica semplicemente "le mie prenotazioni" per vedere tutte le prossime

Cosa preferisce?`,
            pt: `Para encontrar sua reserva, posso pesquisar por:
- Seu número de confirmação (ex: #123)
- Seu número de telefone
- Seu nome
- Ou simplesmente diga "minhas reservas" para ver todas as próximas

O que funciona melhor para você?`,
            nl: `Om uw reservering te vinden, kan ik zoeken op:
- Uw bevestigingsnummer (bijv. #123)
- Uw telefoonnummer
- Uw naam
- Of zeg gewoon "mijn reserveringen" om alle komende te zien

Wat werkt het beste voor u?`,
            auto: `To find your reservation, I can search by:
- Your confirmation number (e.g., #123)
- Your phone number
- Your name
- Or just say "my reservations" to see all upcoming bookings

What works best for you?`
        };
        
        return templates[language] || templates.en;
    }

    /**
     * Modification confirmation templates
     * SOURCE: maya.agent.ts modification workflow
     */
    static getModificationConfirmation(
        language: Language,
        oldValues: any,
        newValues: any
    ): string {
        const templates = {
            en: `Perfect! I've updated your reservation:
${oldValues.date !== newValues.date ? `• Date: ${oldValues.date} → ${newValues.date}` : ''}
${oldValues.time !== newValues.time ? `• Time: ${oldValues.time} → ${newValues.time}` : ''}
${oldValues.guests !== newValues.guests ? `• Guests: ${oldValues.guests} → ${newValues.guests}` : ''}

Your reservation is all set! 🎉`,
            ru: `Отлично! Я обновил вашу бронь:
${oldValues.date !== newValues.date ? `• Дата: ${oldValues.date} → ${newValues.date}` : ''}
${oldValues.time !== newValues.time ? `• Время: ${oldValues.time} → ${newValues.time}` : ''}
${oldValues.guests !== newValues.guests ? `• Гостей: ${oldValues.guests} → ${newValues.guests}` : ''}

Ваша бронь готова! 🎉`,
            sr: `Savršeno! Ažurirao sam vašu rezervaciju:
${oldValues.date !== newValues.date ? `• Datum: ${oldValues.date} → ${newValues.date}` : ''}
${oldValues.time !== newValues.time ? `• Vreme: ${oldValues.time} → ${newValues.time}` : ''}
${oldValues.guests !== newValues.guests ? `• Gosti: ${oldValues.guests} → ${newValues.guests}` : ''}

Vaša rezervacija je spremna! 🎉`,
            hu: `Tökéletes! Frissítettem a foglalását:
${oldValues.date !== newValues.date ? `• Dátum: ${oldValues.date} → ${newValues.date}` : ''}
${oldValues.time !== newValues.time ? `• Idő: ${oldValues.time} → ${newValues.time}` : ''}
${oldValues.guests !== newValues.guests ? `• Vendégek: ${oldValues.guests} → ${newValues.guests}` : ''}

A foglalás kész! 🎉`,
            de: `Perfekt! Ich habe Ihre Reservierung aktualisiert:
${oldValues.date !== newValues.date ? `• Datum: ${oldValues.date} → ${newValues.date}` : ''}
${oldValues.time !== newValues.time ? `• Zeit: ${oldValues.time} → ${newValues.time}` : ''}
${oldValues.guests !== newValues.guests ? `• Gäste: ${oldValues.guests} → ${newValues.guests}` : ''}

Ihre Reservierung ist bereit! 🎉`,
            fr: `Parfait! J'ai mis à jour votre réservation:
${oldValues.date !== newValues.date ? `• Date: ${oldValues.date} → ${newValues.date}` : ''}
${oldValues.time !== newValues.time ? `• Heure: ${oldValues.time} → ${newValues.time}` : ''}
${oldValues.guests !== newValues.guests ? `• Invités: ${oldValues.guests} → ${newValues.guests}` : ''}

Votre réservation est prête! 🎉`,
            es: `¡Perfecto! He actualizado su reserva:
${oldValues.date !== newValues.date ? `• Fecha: ${oldValues.date} → ${newValues.date}` : ''}
${oldValues.time !== newValues.time ? `• Hora: ${oldValues.time} → ${newValues.time}` : ''}
${oldValues.guests !== newValues.guests ? `• Invitados: ${oldValues.guests} → ${newValues.guests}` : ''}

¡Su reserva está lista! 🎉`,
            it: `Perfetto! Ho aggiornato la sua prenotazione:
${oldValues.date !== newValues.date ? `• Data: ${oldValues.date} → ${newValues.date}` : ''}
${oldValues.time !== newValues.time ? `• Ora: ${oldValues.time} → ${newValues.time}` : ''}
${oldValues.guests !== newValues.guests ? `• Ospiti: ${oldValues.guests} → ${newValues.guests}` : ''}

La sua prenotazione è pronta! 🎉`,
            pt: `Perfeito! Atualizei sua reserva:
${oldValues.date !== newValues.date ? `• Data: ${oldValues.date} → ${newValues.date}` : ''}
${oldValues.time !== newValues.time ? `• Hora: ${oldValues.time} → ${newValues.time}` : ''}
${oldValues.guests !== newValues.guests ? `• Convidados: ${oldValues.guests} → ${newValues.guests}` : ''}

Sua reserva está pronta! 🎉`,
            nl: `Perfect! Ik heb uw reservering bijgewerkt:
${oldValues.date !== newValues.date ? `• Datum: ${oldValues.date} → ${newValues.date}` : ''}
${oldValues.time !== newValues.time ? `• Tijd: ${oldValues.time} → ${newValues.time}` : ''}
${oldValues.guests !== newValues.guests ? `• Gasten: ${oldValues.guests} → ${newValues.guests}` : ''}

Uw reservering is klaar! 🎉`,
            auto: `Perfect! I've updated your reservation:
${oldValues.date !== newValues.date ? `• Date: ${oldValues.date} → ${newValues.date}` : ''}
${oldValues.time !== newValues.time ? `• Time: ${oldValues.time} → ${newValues.time}` : ''}
${oldValues.guests !== newValues.guests ? `• Guests: ${oldValues.guests} → ${newValues.guests}` : ''}

Your reservation is all set! 🎉`
        };
        
        return templates[language] || templates.en;
    }

    /**
     * Cancellation confirmation templates
     * SOURCE: maya.agent.ts cancellation workflow
     */
    static getCancellationConfirmation(language: Language, refundInfo?: any): string {
        const refundText = refundInfo ? 
            (refundInfo.refundEligible ? ` You are eligible for a full refund.` : 
             refundInfo.refundPercentage > 0 ? ` You are eligible for a ${refundInfo.refundPercentage}% refund.` : '') : '';

        const templates = {
            en: `Your reservation has been successfully cancelled. We're sorry to see you go and hope to serve you again in the future!${refundText}`,
            ru: `Ваша бронь успешно отменена. Нам жаль, что вы уходите, и мы надеемся снова обслужить вас в будущем!${refundText}`,
            sr: `Vaša rezervacija je uspešno otkazana. Žao nam je što odlazite i nadamo se da ćemo vas ponovo služiti u budućnosti!${refundText}`,
            hu: `Foglalása sikeresen törölve. Sajnáljuk, hogy elmegy, és reméljük, hogy a jövőben újra kiszolgálhatjuk!${refundText}`,
            de: `Ihre Reservierung wurde erfolgreich storniert. Es tut uns leid, Sie gehen zu sehen, und wir hoffen, Sie in Zukunft wieder bedienen zu können!${refundText}`,
            fr: `Votre réservation a été annulée avec succès. Nous sommes désolés de vous voir partir et espérons vous servir à nouveau à l'avenir!${refundText}`,
            es: `Su reserva ha sido cancelada exitosamente. Lamentamos verlo partir y esperamos servirle nuevamente en el futuro!${refundText}`,
            it: `La sua prenotazione è stata annullata con successo. Ci dispiace vederla andare e speriamo di servirla di nuovo in futuro!${refundText}`,
            pt: `Sua reserva foi cancelada com sucesso. Lamentamos vê-lo partir e esperamos servi-lo novamente no futuro!${refundText}`,
            nl: `Uw reservering is succesvol geannuleerd. Het spijt ons dat u weggaat en we hopen u in de toekomst weer van dienst te kunnen zijn!${refundText}`,
            auto: `Your reservation has been successfully cancelled. We're sorry to see you go and hope to serve you again in the future!${refundText}`
        };
        
        return templates[language] || templates.en;
    }
}

// ===== MAYA EMPATHY RESPONSES =====
export class MayaEmpathyResponses {
    
    /**
     * Get contextual response based on emotional understanding
     * SOURCE: maya.agent.ts getContextualResponse method
     */
    static getContextualResponse(userMessage: string, language: Language): string {
        const msg = userMessage.toLowerCase();

        if (msg.includes('задержали') || msg.includes('задержка') || msg.includes('late') || msg.includes('delayed')) {
            const responses = {
                en: "I understand, work delays happen! ",
                ru: "Понимаю, на работе задержали! Такое случается. ",
                sr: "Razumem, zadržani ste na poslu! To se dešava. ",
                hu: "Értem, munkahelyi késés! Ez előfordul. ",
                de: "Ich verstehe, Arbeitsverzögerungen passieren! ",
                fr: "Je comprends, les retards de travail arrivent! ",
                es: "Entiendo, ¡los retrasos del trabajo pasan! ",
                it: "Capisco, i ritardi di lavoro succedono! ",
                pt: "Entendo, atrasos no trabalho acontecem! ",
                nl: "Ik begrijp het, werkvertragingen gebeuren! ",
                auto: "I understand, work delays happen! "
            };
            return responses[language] || responses.en;
        }

        if (msg.includes('не смогу') || msg.includes("can't make it") || msg.includes("won't be able")) {
            const responses = {
                en: "No worries, let's reschedule for a better time. ",
                ru: "Не переживайте, перенесем на удобное время. ",
                sr: "Ne brinite, prebacićemo na pogodno vreme. ",
                hu: "Ne izguljon, átütemezzük megfelelő időre. ",
                de: "Keine Sorge, lass uns auf eine bessere Zeit verschieben. ",
                fr: "Pas de souci, reprogrammons pour un meilleur moment. ",
                es: "No te preocupes, reprogramemos para un mejor momento. ",
                it: "Non preoccuparti, riprogrammiamo per un momento migliore. ",
                pt: "Não se preocupe, vamos reagendar para um horário melhor. ",
                nl: "Geen zorgen, laten we het verplaatsen naar een beter moment. ",
                auto: "No worries, let's reschedule for a better time. "
            };
            return responses[language] || responses.en;
        }

        if (msg.includes('опоздаю') || msg.includes('running late')) {
            const responses = {
                en: "Alright, how many minutes will you be late? Let me see what we can do. ",
                ru: "Хорошо, на сколько минут опоздаете? Посмотрю, что можно сделать. ",
                sr: "U redu, koliko minuta ćete kasniti? Videćemo šta možemo da uradimo. ",
                hu: "Rendben, hány percet fog késni? Megnézem, mit tudunk tenni. ",
                de: "In Ordnung, wie viele Minuten werden Sie zu spät sein? Mal sehen, was wir tun können. ",
                fr: "D'accord, combien de minutes allez-vous être en retard? Voyons ce que nous pouvons faire. ",
                es: "De acuerdo, ¿cuántos minutos llegarás tarde? Veamos qué podemos hacer. ",
                it: "Va bene, quanti minuti farai tardi? Vediamo cosa possiamo fare. ",
                pt: "Certo, quantos minutos você vai se atrasar? Vamos ver o que podemos fazer. ",
                nl: "Oké, hoeveel minuten ga je te laat zijn? Laten we kijken wat we kunnen doen. ",
                auto: "Alright, how many minutes will you be late? Let me see what we can do. "
            };
            return responses[language] || responses.en;
        }

        return "";
    }
}

// ===== MAYA TIME CALCULATION HELPERS =====
export class MayaTimeCalculations {
    
    /**
     * Calculate relative time changes for modifications
     * SOURCE: maya.agent.ts calculateRelativeTime method
     */
    static calculateRelativeTime(currentTime: string, relativeChange: string): string | null {
        try {
            const [hours, minutes] = currentTime.split(':').map(Number);
            const currentMinutes = hours * 60 + minutes;
            
            let changeMinutes = 0;
            const change = relativeChange.toLowerCase();

            // Parse relative time changes
            if (change.includes('10 минут') || change.includes('10 minutes')) {
                changeMinutes = change.includes('раньше') || change.includes('earlier') ? -10 : 10;
            } else if (change.includes('15 минут') || change.includes('15 minutes')) {
                changeMinutes = change.includes('раньше') || change.includes('earlier') ? -15 : 15;
            } else if (change.includes('30 минут') || change.includes('30 minutes') || change.includes('полчаса')) {
                changeMinutes = change.includes('раньше') || change.includes('earlier') ? -30 : 30;
            } else if (change.includes('час') || change.includes('hour')) {
                changeMinutes = change.includes('раньше') || change.includes('earlier') ? -60 : 60;
            }

            if (changeMinutes === 0) return null;

            const newMinutes = currentMinutes + changeMinutes;
            const newHours = Math.floor(newMinutes / 60);
            const newMins = newMinutes % 60;

            // Validate time range (assume restaurant hours 10:00 - 23:00)
            if (newHours < 10 || newHours > 23) return null;

            return `${newHours.toString().padStart(2, '0')}:${newMins.toString().padStart(2, '0')}`;
        } catch (error) {
            console.error('[MayaTimeCalculations] Error calculating relative time:', error);
            return null;
        }
    }

    /**
     * Parse time modification requests
     * SOURCE: maya.agent.ts modification parsing logic
     */
    static parseTimeModificationRequest(userMessage: string): {
        type: 'absolute' | 'relative' | 'none';
        value?: string;
        originalRequest: string;
    } {
        const msg = userMessage.toLowerCase();
        
        // Check for absolute time (e.g., "change to 8pm", "на 20:00")
        const absoluteTimeMatch = msg.match(/(?:на|to|at)\s*(\d{1,2})[:\.]?(\d{2})?(?:\s*(?:pm|вечера|evening))?/);
        if (absoluteTimeMatch) {
            let hours = parseInt(absoluteTimeMatch[1]);
            const minutes = absoluteTimeMatch[2] ? parseInt(absoluteTimeMatch[2]) : 0;
            
            // Handle PM conversion
            if (msg.includes('pm') || msg.includes('вечера') || msg.includes('evening')) {
                if (hours < 12) hours += 12;
            }
            
            return {
                type: 'absolute',
                value: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
                originalRequest: userMessage
            };
        }
        
        // Check for relative time changes
        const relativePatterns = [
            '10 минут', '15 минут', '30 минут', 'полчаса', 'час',
            '10 minutes', '15 minutes', '30 minutes', 'half hour', 'hour',
            'раньше', 'позже', 'earlier', 'later'
        ];
        
        if (relativePatterns.some(pattern => msg.includes(pattern))) {
            return {
                type: 'relative',
                value: userMessage,
                originalRequest: userMessage
            };
        }
        
        return {
            type: 'none',
            originalRequest: userMessage
        };
    }
}

// ===== EXPORT ALL MAYA PROMPTS =====
export {
    MayaPrompts,
    MayaWorkflowTemplates,
    MayaEmpathyResponses,
    MayaTimeCalculations
};

// ===== DEFAULT EXPORT =====
export default MayaPrompts;