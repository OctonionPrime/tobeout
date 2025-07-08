// server/services/agents/specialists/sofia.agent.ts
// ✅ PHASE 4: Sofia agent with COMPLETE implementation
// SOURCE: booking-agent.ts createBookingAgent, generatePersonalizedGreeting, generateSmartPartyQuestion
// SOURCE: enhanced-conversation-manager.ts getAgentPersonality Sofia logic (lines ~600-700)

import type { 
    AgentType, 
    Language,
    AgentContext,
    AgentResponse,
    BookingSessionWithAgent,
    GuestHistory,
    RestaurantConfig
} from '../core/agent.types';
import { AIFallbackService } from '../../ai/ai-fallback.service';
import { UnifiedTranslationService } from '../../ai/translation.service';
import { DateTime } from 'luxon';

// Import tools
import { bookingTools } from '../tools/booking.tools';
import { guestTools } from '../tools/guest.tools';

// ===== SOFIA AGENT CLASS =====
// SOURCE: booking-agent.ts createBookingAgent function
export class SofiaAgent {
    readonly name = 'Sofia';
    readonly capabilities = [
        'new_reservations',
        'availability_checking', 
        'guest_greeting',
        'booking_workflow',
        'information_gathering'
    ];
    readonly agentType: AgentType = 'booking';

    constructor(
        private aiService: AIFallbackService,
        private translationService: UnifiedTranslationService,
        private restaurantConfig: RestaurantConfig
    ) {}

    /**
     * Generate Sofia's personalized greeting
     * SOURCE: booking-agent.ts generatePersonalizedGreeting function
     */
    generatePersonalizedGreeting(
        guestHistory: GuestHistory | null,
        language: Language,
        context: 'hostess' | 'guest',
        conversationContext?: any
    ): string {
        // Get current date context
        const getCurrentRestaurantContext = () => {
            try {
                const now = DateTime.now().setZone(this.restaurantConfig.timezone);
                const today = now.toISODate();
                const currentTime = now.toFormat('HH:mm');
                const dayOfWeek = now.toFormat('cccc');

                return {
                    currentDate: today,
                    currentTime: currentTime,
                    dayOfWeek: dayOfWeek
                };
            } catch (error) {
                console.error(`[SofiaAgent] Error getting time context:`, error);
                const now = DateTime.now();
                return {
                    currentDate: now.toISODate(),
                    currentTime: now.toFormat('HH:mm'),
                    dayOfWeek: now.toFormat('cccc')
                };
            }
        };

        const dateContext = getCurrentRestaurantContext();

        // ✅ CRITICAL FIX: Handle subsequent bookings differently
        if (conversationContext?.isSubsequentBooking) {
            if (!guestHistory || guestHistory.total_bookings === 0) {
                // Simple greeting for subsequent booking by new guest
                const subsequentGreetings = {
                    en: `Perfect! I can help you with another reservation. What date and time would you like?`,
                    ru: `Отлично! Помогу вам с ещё одной бронью. На какую дату и время?`,
                    sr: `Odlično! Mogu da vam pomognem sa još jednom rezervacijom. Koji datum i vreme želite?`,
                    hu: `Tökéletes! Segíthetek egy másik foglalással. Milyen dátumra és időpontra?`,
                    de: `Perfekt! Ich kann Ihnen bei einer weiteren Reservierung helfen. Welches Datum und welche Uhrzeit hätten Sie gern?`,
                    fr: `Parfait! Je peux vous aider avec une autre réservation. Quelle date et quelle heure souhaitez-vous?`,
                    es: `¡Perfecto! Puedo ayudarte con otra reserva. ¿Qué fecha y hora te gustaría?`,
                    it: `Perfetto! Posso aiutarti con un'altra prenotazione. Che data e ora vorresti?`,
                    pt: `Perfeito! Posso ajudá-lo com outra reserva. Que data e hora gostaria?`,
                    nl: `Perfect! Ik kan je helpen met nog een reservering. Welke datum en tijd zou je willen?`,
                    auto: `Perfect! I can help you with another reservation. What date and time would you like?`
                };
                return subsequentGreetings[language] || subsequentGreetings.en;
            } else {
                // Subsequent booking for returning guest - be more conversational
                const subsequentGreetings = {
                    en: `Of course! I'd be happy to help with another reservation. When would you like to dine again?`,
                    ru: `Конечно! Буду рада помочь с ещё одной бронью. Когда хотели бы снова поужинать?`,
                    sr: `Naravno! Rado ću vam pomoći sa još jednom rezervacijom. Kada biste želeli da večerate ponovo?`,
                    hu: `Természetesen! Szívesen segítek egy másik foglalással. Mikor szeretnél újra vacsorázni?`,
                    de: `Natürlich! Gerne helfe ich Ihnen bei einer weiteren Reservierung. Wann möchten Sie wieder speisen?`,
                    fr: `Bien sûr! Je serais ravie de vous aider avec une autre réservation. Quand aimeriez-vous dîner à nouveau?`,
                    es: `¡Por supuesto! Estaré encantada de ayudarte con otra reserva. ¿Cuándo te gustaría cenar de nuevo?`,
                    it: `Certo! Sarò felice di aiutarti con un'altra prenotazione. Quando vorresti cenare di nuovo?`,
                    pt: `Claro! Ficaria feliz em ajudar com outra reserva. Quando gostaria de jantar novamente?`,
                    nl: `Natuurlijk! Ik help je graag met nog een reservering. Wanneer zou je weer willen dineren?`,
                    auto: `Of course! I'd be happy to help with another reservation. When would you like to dine again?`
                };
                return subsequentGreetings[language] || subsequentGreetings.en;
            }
        }

        if (!guestHistory || guestHistory.total_bookings === 0) {
            // Regular greeting for new guests
            if (context === 'hostess') {
                const greetings = {
                    en: `🌟 Hi! I'm Sofia, your booking assistant. Today is ${dateContext.currentDate}. I help with reservations step-by-step: check availability first, then collect all details, then create the booking.`,
                    ru: `🌟 Привет! Я София, ваша помощница по бронированию. Сегодня ${dateContext.currentDate}. Помогаю пошагово: сначала проверяю доступность, потом собираю все данные, затем создаю бронь.`,
                    sr: `🌟 Zdravo! Ja sam Sofija, asistent za rezervacije. Danas je ${dateContext.currentDate}. Pomažem korak po korak: prvo proverim dostupnost, zatim sakupim sve podatke, pa napravim rezervaciju.`,
                    hu: `🌟 Szia! Én Szófia vagyok, a foglalási asszisztensed. Ma ${dateContext.currentDate} van. Lépésről lépésre segítek: először ellenőrzöm az elérhetőséget, aztán összegyűjtöm az adatokat, majd létrehozom a foglalást.`,
                    de: `🌟 Hallo! Ich bin Sofia, Ihre Buchungsassistentin. Heute ist der ${dateContext.currentDate}. Ich helfe Schritt für Schritt: erst Verfügbarkeit prüfen, dann Details sammeln, dann Buchung erstellen.`,
                    fr: `🌟 Bonjour! Je suis Sofia, votre assistante de réservation. Nous sommes le ${dateContext.currentDate}. J'aide étape par étape: d'abord vérifier la disponibilité, puis collecter les détails, puis créer la réservation.`,
                    es: `🌟 ¡Hola! Soy Sofia, tu asistente de reservas. Hoy es ${dateContext.currentDate}. Ayudo paso a paso: primero verifico disponibilidad, luego recopilo detalles, luego creo la reserva.`,
                    it: `🌟 Ciao! Sono Sofia, la tua assistente per le prenotazioni. Oggi è ${dateContext.currentDate}. Aiuto passo dopo passo: prima controllo la disponibilità, poi raccolgo i dettagli, poi creo la prenotazione.`,
                    pt: `🌟 Olá! Eu sou Sofia, sua assistente de reservas. Hoje é ${dateContext.currentDate}. Ajudo passo a passo: primeiro verifico disponibilidade, depois coletamos detalhes, depois criamos a reserva.`,
                    nl: `🌟 Hallo! Ik ben Sofia, je boekingsassistent. Vandaag is ${dateContext.currentDate}. Ik help stap voor stap: eerst beschikbaarheid controleren, dan details verzamelen, dan boeking maken.`,
                    auto: `🌟 Hi! I'm Sofia, your booking assistant. Today is ${dateContext.currentDate}. I help with reservations step-by-step: check availability first, then collect all details, then create the booking.`
                };
                return greetings[language] || greetings.en;
            } else {
                // ✅ FIX: More general and welcoming initial greeting.
                const greetings = {
                    en: `🌟 Hello! I'm Sofia. How can I help you today?`,
                    ru: `🌟 Здравствуйте! Я София. Чем могу вам помочь?`,
                    sr: `🌟 Zdravo! Ja sam Sofija. Kako Vam mogu pomoći danas?`,
                    hu: `🌟 Szia! Én Szófia vagyok. Hogyan segíthetek ma?`,
                    de: `🌟 Hallo! Ich bin Sofia. Wie kann ich Ihnen heute helfen?`,
                    fr: `🌟 Bonjour! Je suis Sofia. Comment puis-je vous aider aujourd'hui?`,
                    es: `🌟 ¡Hola! Soy Sofia. ¿Cómo puedo ayudarte hoy?`,
                    it: `🌟 Ciao! Sono Sofia. Come posso aiutarti oggi?`,
                    pt: `🌟 Olá! Eu sou Sofia. Como posso ajudá-lo hoje?`,
                    nl: `🌟 Hallo! Ik ben Sofia. Hoe kan ik je vandaag helpen?`,
                    auto: `🌟 Hello! I'm Sofia. How can I help you today?`
                };
                return greetings[language] || greetings.en;
            }
        }

        // ✅ NEW: Personalized greeting for returning guests
        const { guest_name, total_bookings, common_party_size, frequent_special_requests, last_visit_date } = guestHistory;
        const isReturningRegular = total_bookings >= 3;

        if (context === 'hostess') {
            // Staff context - efficient and informative
            const greetings = {
                en: `🌟 Hi! Sofia here. Today is ${dateContext.currentDate}. ${isReturningRegular ? `This is ${guest_name} - returning guest with ${total_bookings} previous bookings.` : `This is ${guest_name} - they've visited ${total_bookings} time${total_bookings > 1 ? 's' : ''} before.`}${common_party_size ? ` Usual party: ${common_party_size}` : ''}${frequent_special_requests.length > 0 ? `. Usual requests: ${frequent_special_requests.join(', ')}` : ''}`,
                ru: `🌟 Привет! София здесь. Сегодня ${dateContext.currentDate}. ${isReturningRegular ? `Это ${guest_name} - постоянный гость с ${total_bookings} предыдущими бронированиями.` : `Это ${guest_name} - они посещали нас ${total_bookings} раз${total_bookings > 1 ? 'а' : ''}.`}${common_party_size ? ` Обычно: ${common_party_size} чел.` : ''}${frequent_special_requests.length > 0 ? `. Обычные просьбы: ${frequent_special_requests.join(', ')}` : ''}`,
                sr: `🌟 Zdravo! Sofija ovde. Danas je ${dateContext.currentDate}. ${isReturningRegular ? `Ovo je ${guest_name} - stalni gost sa ${total_bookings} prethodnih rezervacija.` : `Ovo je ${guest_name} - posetili su nas ${total_bookings} put${total_bookings > 1 ? 'a' : ''}.`}${common_party_size ? ` Obično: ${common_party_size} os.` : ''}${frequent_special_requests.length > 0 ? `. Uobičajeni zahtevi: ${frequent_special_requests.join(', ')}` : ''}`,
                hu: `🌟 Szia! Szófia itt. Ma ${dateContext.currentDate} van. ${isReturningRegular ? `Ez ${guest_name} - visszatérő vendég ${total_bookings} korábbi foglalással.` : `Ez ${guest_name} - ${total_bookings} alkalommal járt${total_bookings > 1 ? 'ak' : ''} nálunk.`}${common_party_size ? ` Szokásos létszám: ${common_party_size} fő` : ''}${frequent_special_requests.length > 0 ? `. Szokásos kérések: ${frequent_special_requests.join(', ')}` : ''}`,
                de: `🌟 Hallo! Sofia hier. Heute ist ${dateContext.currentDate}. ${isReturningRegular ? `Das ist ${guest_name} - Stammgast mit ${total_bookings} vorherigen Buchungen.` : `Das ist ${guest_name} - war schon ${total_bookings} Mal${total_bookings > 1 ? 'e' : ''} hier.`}${common_party_size ? ` Üblich: ${common_party_size} Pers.` : ''}${frequent_special_requests.length > 0 ? `. Übliche Wünsche: ${frequent_special_requests.join(', ')}` : ''}`,
                fr: `🌟 Bonjour! Sofia ici. Nous sommes le ${dateContext.currentDate}. ${isReturningRegular ? `C'est ${guest_name} - client régulier avec ${total_bookings} réservations précédentes.` : `C'est ${guest_name} - a visité ${total_bookings} fois${total_bookings > 1 ? '' : ''}.`}${common_party_size ? ` Habituel: ${common_party_size} pers.` : ''}${frequent_special_requests.length > 0 ? `. Demandes habituelles: ${frequent_special_requests.join(', ')}` : ''}`,
                es: `🌟 ¡Hola! Sofia aquí. Hoy es ${dateContext.currentDate}. ${isReturningRegular ? `Este es ${guest_name} - cliente habitual con ${total_bookings} reservas previas.` : `Este es ${guest_name} - ha visitado ${total_bookings} vez${total_bookings > 1 ? 'es' : ''}.`}${common_party_size ? ` Usual: ${common_party_size} pers.` : ''}${frequent_special_requests.length > 0 ? `. Solicitudes habituales: ${frequent_special_requests.join(', ')}` : ''}`,
                it: `🌟 Ciao! Sofia qui. Oggi è ${dateContext.currentDate}. ${isReturningRegular ? `Questo è ${guest_name} - ospite abituale con ${total_bookings} prenotazioni precedenti.` : `Questo è ${guest_name} - ha visitato ${total_bookings} volta${total_bookings > 1 ? 'e' : ''}.`}${common_party_size ? ` Solito: ${common_party_size} pers.` : ''}${frequent_special_requests.length > 0 ? `. Richieste abituali: ${frequent_special_requests.join(', ')}` : ''}`,
                pt: `🌟 Olá! Sofia aqui. Hoje é ${dateContext.currentDate}. ${isReturningRegular ? `Este é ${guest_name} - hóspede regular com ${total_bookings} reservas anteriores.` : `Este é ${guest_name} - visitou ${total_bookings} vez${total_bookings > 1 ? 'es' : ''}.`}${common_party_size ? ` Usual: ${common_party_size} pess.` : ''}${frequent_special_requests.length > 0 ? `. Pedidos habituais: ${frequent_special_requests.join(', ')}` : ''}`,
                nl: `🌟 Hallo! Sofia hier. Vandaag is ${dateContext.currentDate}. ${isReturningRegular ? `Dit is ${guest_name} - vaste gast met ${total_bookings} eerdere boekingen.` : `Dit is ${guest_name} - heeft ${total_bookings} keer${total_bookings > 1 ? '' : ''} bezocht.`}${common_party_size ? ` Gebruikelijk: ${common_party_size} pers.` : ''}${frequent_special_requests.length > 0 ? `. Gebruikelijke verzoeken: ${frequent_special_requests.join(', ')}` : ''}`,
                auto: `🌟 Hi! Sofia here. Today is ${dateContext.currentDate}. ${isReturningRegular ? `This is ${guest_name} - returning guest with ${total_bookings} previous bookings.` : `This is ${guest_name} - they've visited ${total_bookings} time${total_bookings > 1 ? 's' : ''} before.`}${common_party_size ? ` Usual party: ${common_party_size}` : ''}${frequent_special_requests.length > 0 ? `. Usual requests: ${frequent_special_requests.join(', ')}` : ''}`
            };
            return greetings[language] || greetings.en;
        } else {
            // Guest context - warm and personal
            if (isReturningRegular) {
                // ✅ CRITICAL FIX: Improved phrasing for regular customers with OPTIONAL common party size suggestion
                const greetings = {
                    en: `🌟 Welcome back, ${guest_name}! 🎉 It's wonderful to see you again! How can I help you today?${common_party_size ? ` Booking for your usual ${common_party_size} people?` : ''}`,
                    ru: `🌟 С возвращением, ${guest_name}! 🎉 Рада вас снова видеть! Чем могу помочь?${common_party_size ? ` Бронируем как обычно, на ${common_party_size} человек?` : ''}`,
                    sr: `🌟 Dobrodošli nazad, ${guest_name}! 🎉 Divno je videti vas ponovo! Kako Vam mogu pomoći?${common_party_size ? ` Da li rezervišemo za uobičajenih ${common_party_size} osoba?` : ''}`,
                    hu: `🌟 Üdvözlöm vissza, ${guest_name}! 🎉 Csodálatos újra látni! Hogyan segíthetek?${common_party_size ? ` A szokásos ${common_party_size} főre foglalunk?` : ''}`,
                    de: `🌟 Willkommen zurück, ${guest_name}! 🎉 Schön, Sie wiederzusehen! Wie kann ich helfen?${common_party_size ? ` Buchen wir für die üblichen ${common_party_size} Personen?` : ''}`,
                    fr: `🌟 Bon retour, ${guest_name}! 🎉 C'est merveilleux de vous revoir! Comment puis-je vous aider?${common_party_size ? ` Réservons-nous pour les ${common_party_size} personnes habituelles?` : ''}`,
                    es: `🌟 ¡Bienvenido de vuelta, ${guest_name}! 🎉 ¡Es maravilloso verte de nuevo! ¿Cómo puedo ayudarte?${common_party_size ? ` ¿Reservamos para las ${common_party_size} personas habituales?` : ''}`,
                    it: `🌟 Bentornato, ${guest_name}! 🎉 È meraviglioso rivederti! Come posso aiutarti?${common_party_size ? ` Prenotiamo per le solite ${common_party_size} persone?` : ''}`,
                    pt: `🌟 Bem-vindo de volta, ${guest_name}! 🎉 É maravilhoso vê-lo novamente! Como posso ajudar?${common_party_size ? ` Reservamos para as ${common_party_size} pessoas habituais?` : ''}`,
                    nl: `🌟 Welkom terug, ${guest_name}! 🎉 Het is geweldig om je weer te zien! Hoe kan ik helpen?${common_party_size ? ` Boeken we voor de gebruikelijke ${common_party_size} personen?` : ''}`,
                    auto: `🌟 Welcome back, ${guest_name}! 🎉 It's wonderful to see you again! How can I help you today?${common_party_size ? ` Booking for your usual ${common_party_size} people?` : ''}`
                };
                return greetings[language] || greetings.en;
            } else {
                // Friendly but not overly familiar greeting for infrequent guests
                const greetings = {
                    en: `🌟 Hello, ${guest_name}! Nice to see you again! I'm Sofia. How can I help you today?`,
                    ru: `🌟 Здравствуйте, ${guest_name}! Приятно вас снова видеть! Я София. Чем могу вам сегодня помочь?`,
                    sr: `🌟 Zdravo, ${guest_name}! Drago mi je što vas ponovo vidim! Ja sam Sofija. Kako vam mogu pomoći danas?`,
                    hu: `🌟 Szia, ${guest_name}! Örülök, hogy újra látlak! Én Szófia vagyok. Hogyan segíthetek ma?`,
                    de: `🌟 Hallo, ${guest_name}! Schön, Sie wiederzusehen! Ich bin Sofia. Wie kann ich Ihnen heute helfen?`,
                    fr: `🌟 Bonjour, ${guest_name}! Content de vous revoir! Je suis Sofia. Comment puis-je vous aider aujourd'hui?`,
                    es: `🌟 ¡Hola, ${guest_name}! ¡Me alegra verte de nuevo! Soy Sofia. ¿Cómo puedo ayudarte hoy?`,
                    it: `🌟 Ciao, ${guest_name}! Bello rivederti! Sono Sofia. Come posso aiutarti oggi?`,
                    pt: `🌟 Olá, ${guest_name}! Bom vê-lo novamente! Eu sou Sofia. Como posso ajudá-lo hoje?`,
                    nl: `🌟 Hallo, ${guest_name}! Leuk om je weer te zien! Ik ben Sofia. Hoe kan ik je vandaag helpen?`,
                    auto: `🌟 Hello, ${guest_name}! Nice to see you again! I'm Sofia. How can I help you today?`
                };
                return greetings[language] || greetings.en;
            }
        }
    }

    /**
     * Generate smart party size question that avoids redundancy
     * SOURCE: booking-agent.ts generateSmartPartyQuestion function
     */
    generateSmartPartyQuestion(
        language: Language,
        hasAskedPartySize: boolean,
        isSubsequentBooking: boolean,
        commonPartySize?: number | null,
        conversationContext?: any
    ): string {
        // ✅ CRITICAL FIX: Don't ask if we already asked party size in this conversation
        if (hasAskedPartySize || conversationContext?.hasAskedPartySize) {
            // For subsequent bookings or if already asked, be direct and simple
            const directQuestions = {
                en: `How many guests?`,
                ru: `Сколько человек?`,
                sr: `Koliko osoba?`,
                hu: `Hány fő?`,
                de: `Wie viele Personen?`,
                fr: `Combien de personnes?`,
                es: `¿Cuántas personas?`,
                it: `Quante persone?`,
                pt: `Quantas pessoas?`,
                nl: `Hoeveel personen?`,
                auto: `How many guests?`
            };
            return directQuestions[language] || directQuestions.en;
        }
        
        if (isSubsequentBooking) {
            // For subsequent bookings, be direct and simple
            const directQuestions = {
                en: `How many guests this time?`,
                ru: `Сколько человек на этот раз?`,
                sr: `Koliko osoba ovaj put?`,
                hu: `Hány fő ezúttal?`,
                de: `Wie viele Personen diesmal?`,
                fr: `Combien de personnes cette fois?`,
                es: `¿Cuántas personas esta vez?`,
                it: `Quante persone questa volta?`,
                pt: `Quantas pessoas desta vez?`,
                nl: `Hoeveel personen deze keer?`,
                auto: `How many guests this time?`
            };
            return directQuestions[language] || directQuestions.en;
        } else if (commonPartySize) {
            // First time asking, with history - ONLY suggest if haven't asked yet
            const suggestiveQuestions = {
                en: `How many people will be joining you? (Usually ${commonPartySize} for you)`,
                ru: `Сколько человек будет? (Обычно у вас ${commonPartySize})`,
                sr: `Koliko osoba će biti? (Obično ${commonPartySize} kod vas)`,
                hu: `Hányan lesztek? (Általában ${commonPartySize} fő nálad)`,
                de: `Wie viele Personen werden dabei sein? (Normalerweise ${commonPartySize} bei Ihnen)`,
                fr: `Combien de personnes seront présentes? (Habituellement ${commonPartySize} pour vous)`,
                es: `¿Cuántas personas serán? (Normalmente ${commonPartySize} para ti)`,
                it: `Quante persone saranno? (Di solito ${commonPartySize} per te)`,
                pt: `Quantas pessoas serão? (Normalmente ${commonPartySize} para você)`,
                nl: `Hoeveel personen worden het? (Gewoonlijk ${commonPartySize} voor jou)`,
                auto: `How many people will be joining you? (Usually ${commonPartySize} for you)`
            };
            return suggestiveQuestions[language] || suggestiveQuestions.en;
        } else {
            // First time asking, no history
            const standardQuestions = {
                en: `How many guests will be joining you?`,
                ru: `Сколько гостей будет с вами?`,
                sr: `Koliko gostiju će biti sa vama?`,
                hu: `Hány vendég lesz veled?`,
                de: `Wie viele Gäste werden Sie begleiten?`,
                fr: `Combien d'invités vous accompagneront?`,
                es: `¿Cuántos invitados te acompañarán?`,
                it: `Quanti ospiti ti accompagneranno?`,
                pt: `Quantos convidados o acompanharão?`,
                nl: `Hoeveel gasten gaan met je mee?`,
                auto: `How many guests will be joining you?`
            };
            return standardQuestions[language] || standardQuestions.en;
        }
    }

    /**
     * Get comprehensive system prompt for Sofia
     * SOURCE: enhanced-conversation-manager.ts getAgentPersonality Sofia logic (lines ~600-700)
     */
    getSystemPrompt(
        context: 'hostess' | 'guest',
        userLanguage: Language = 'en',
        guestHistory?: GuestHistory | null,
        isFirstMessage: boolean = false,
        conversationContext?: any
    ): string {
        const currentTime = DateTime.now().setZone(this.restaurantConfig.timezone);
        const dateContext = {
            currentDate: currentTime.toFormat('yyyy-MM-dd'),
            tomorrowDate: currentTime.plus({ days: 1 }).toFormat('yyyy-MM-dd'),
            currentTime: currentTime.toFormat('HH:mm'),
            dayOfWeek: currentTime.toFormat('cccc'),
            timezone: this.restaurantConfig.timezone
        };

        // ✅ LANGUAGE INSTRUCTION (works for all languages)
        const languageInstruction = `🌍 CRITICAL LANGUAGE RULE:
- User's language: ${userLanguage}
- You MUST respond in ${userLanguage} for ALL messages
- Maintain warm, professional tone in ${userLanguage}
- If unsure of translation, use simple clear ${userLanguage}`;

        // ✅ CRITICAL BOOKING WORKFLOW INSTRUCTIONS
        const getCriticalBookingInstructions = () => {
            return `
🚨 MANDATORY BOOKING WORKFLOW - FOLLOW EXACTLY:

STEP 1: GATHER ALL REQUIRED INFORMATION FIRST:
   1️⃣ Date (must be explicit: "2025-07-19")
   2️⃣ Time (must be explicit: "20:00" - NEVER assume!)
   3️⃣ Number of guests
   4️⃣ Guest name
   5️⃣ Guest phone number

❌ CRITICAL: NEVER call check_availability without EXPLICIT time!
❌ NEVER assume time from date (e.g., "19 июля" ≠ "19:00")

STEP 2: Only after ALL 5 items → call check_availability
STEP 3: If available → call create_reservation
STEP 4: Only after successful create_reservation, say "confirmed!"

🚫 FORBIDDEN PATTERNS:
❌ NEVER: Check availability → immediately ask "want me to book it?"
❌ NEVER: Ask "Can I confirm the booking in your name?" when you DON'T HAVE the name
❌ NEVER: Call create_reservation without phone number
❌ NEVER: Say "booked" or "confirmed" after just check_availability

✅ REQUIRED PATTERNS:
✅ Check availability → "Table available! I need your name and phone number to complete the booking"
✅ Have all 5 items → Call create_reservation → "Booking confirmed!"

💡 HANDLING FAILED AVAILABILITY (MANDATORY WORKFLOW - FOLLOW EXACTLY):
This is the MOST CRITICAL rule. LLMs often hallucinate availability when tools fail. You MUST follow this exact pattern.

🚨 MANDATORY TRIGGER CONDITIONS:
- 'check_availability' returns tool_status: 'FAILURE'  
- User then asks: "when is it available?", "what about earlier?", "any other times?", "а когда свободно?", "на сколько можно?", "другое время?", "что есть?", "когда можно?"

🚨 MANDATORY ACTION SEQUENCE:
1. Find the TIME from your FAILED 'check_availability' call in conversation history
2. Immediately call 'find_alternative_times' with that exact time as 'preferredTime'
3. NEVER suggest times without calling the tool first
4. NEVER leave 'preferredTime' as undefined/empty

🚨 MANDATORY DIALOG EXAMPLE (COPY THIS PATTERN EXACTLY):
User: "I need a table for 2 tomorrow at 19:00"
Agent: [calls check_availability(date="2025-07-07", time="19:00", guests=2)] → FAILS
Agent: "I'm sorry, but we're fully booked at 19:00 tomorrow."
User: "What about earlier?" 
Agent: [MUST call find_alternative_times(date="2025-07-07", preferredTime="19:00", guests=2)]
Agent: [After tool returns results] "I found these earlier times: 18:30 and 17:45 are available. Would either work?"

🚨 FORBIDDEN ACTIONS:
❌ NEVER say "How about 18:00 or 18:30?" without calling find_alternative_times first
❌ NEVER invent times like "earlier times are usually available"
❌ NEVER call find_alternative_times with preferredTime: undefined
❌ NEVER suggest times that weren't returned by the tool

🚨 VALIDATION CHECK:
Before suggesting ANY time, ask yourself: "Did find_alternative_times return this exact time?" If no, DON'T suggest it.

This prevents availability hallucination where you suggest times without tool confirmation, leading to booking failures and user frustration.

📞 PHONE COLLECTION EXAMPLES:
"Perfect! Table 5 is available for 3 guests on July 13th at 8pm. I need your name and phone number to complete the reservation."

🔒 VALIDATION RULES:
- If ANY required item is missing, ask for it - do NOT proceed
- Phone numbers must have at least 7 digits
- Names must be at least 2 characters
- Always confirm all details before final booking

🚨 CRITICAL: NEVER ask "Can I confirm booking in your name?" when you don't have the name!
Instead say: "I need your name and phone number to complete the booking."
`;
        };

        // ✅ PERSONALIZED PROMPT SECTION
        const getPersonalizedPromptSection = (guestHistory: GuestHistory | null, language: Language, conversationContext?: any): string => {
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
- ✅ CRITICAL FIX: ${common_party_size ? `USUAL PARTY SIZE: Only suggest "${common_party_size} people" if user hasn't specified AND you haven't asked about party size yet in this conversation. If you already asked about party size, DON'T ask again.` : ''}
- ${frequent_special_requests.length > 0 ? `USUAL REQUESTS: Ask "Would you like your usual ${frequent_special_requests[0]}?" when appropriate during booking.` : ''}
- ✅ CONVERSATION RULE: ${conversationContext?.isSubsequentBooking ? 'This is a SUBSEQUENT booking in the same session - be concise and skip repetitive questions.' : 'This is the first booking in the session.'}
- ✅ CRITICAL: Track what you've already asked to avoid repetition. If you asked about party size, don't ask again.
- **SAME NAME/PHONE HANDLING**: If the guest says "my name" or "same name", use "${guest_name}" from their history. If they say "same number", "same phone", or "using same number", use "${guest_phone || 'Not available'}" from their history.
- Use this information naturally in conversation - don't just list their history!
- Make the experience feel personal and welcoming for returning guests.`;
        };

        // ✅ CONVERSATION CONTEXT INSTRUCTIONS
        const conversationInstructions = conversationContext ? `
📝 CONVERSATION CONTEXT:
- Session Turn: ${conversationContext.sessionTurnCount || 1}
- Booking Number: ${conversationContext.bookingNumber || 1} ${conversationContext.isSubsequentBooking ? '(SUBSEQUENT)' : '(FIRST)'}
- ✅ CRITICAL: Asked Party Size: ${conversationContext.hasAskedPartySize ? 'YES - DO NOT ASK AGAIN' : 'NO - CAN ASK IF NEEDED'}

🎯 CONTEXT-AWARE BEHAVIOR:
${conversationContext.isSubsequentBooking ? 
  '- SUBSEQUENT BOOKING: Be concise, skip redundant questions, focus on the new booking details.' :
  '- FIRST BOOKING: Full greeting and standard workflow.'
}
${conversationContext.hasAskedPartySize ? 
  '- ✅ CRITICAL: Already asked about party size - DON\'T ASK AGAIN unless user explicitly changes topic. Use their previous answer.' :
  '- Can suggest usual party size if appropriate and haven\'t asked yet.'
}
` : '';

        const personalizedSection = getPersonalizedPromptSection(guestHistory || null, userLanguage, conversationContext);

        if (context === 'hostess') {
            // 🏢 HOSTESS CONTEXT: Staff assistant, efficiency-focused
            return `You are Sofia, the professional booking assistant for ${this.restaurantConfig.name} staff.

${languageInstruction}

🎯 YOUR ROLE: Staff Assistant
You help hostesses manage reservations quickly and efficiently. You understand staff workflow and speak professionally but efficiently.

🏪 RESTAURANT DETAILS:
- Name: ${this.restaurantConfig.name}
- Restaurant ID: ${this.restaurantConfig.id}
- Timezone: ${this.restaurantConfig.timezone}
- Hours: ${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime}
- Maximum party size: ${this.restaurantConfig.maxGuests}

📅 CURRENT DATE CONTEXT (CRITICAL):
- TODAY is ${dateContext.currentDate} (${dateContext.dayOfWeek})
- TOMORROW is ${dateContext.tomorrowDate}
- Current time: ${dateContext.currentTime} in ${dateContext.timezone}
- When guests say "today", use: ${dateContext.currentDate}
- When guests say "tomorrow", use: ${dateContext.tomorrowDate}
- ✅ When a guest says "next Friday" and today is Wednesday, it means the Friday of the *following* week, not the closest one. Calculate this correctly.
- ALWAYS use YYYY-MM-DD format for dates
- NEVER use dates from 2023 or other years - only current dates!

${getCriticalBookingInstructions()}

${conversationInstructions}

${personalizedSection}

💼 STAFF COMMUNICATION STYLE:
- Professional and efficient, like talking to a colleague
- Use quick commands: "Book Martinez for 4 tonight 8pm"
- Provide immediate results without excessive pleasantries
- Focus on getting things done fast
- Confirm actions clearly
- Handle tool errors gracefully and suggest solutions immediately

🛠️ QUICK COMMANDS YOU UNDERSTAND:
- "Book [name] for [guests] [date] [time]" - Direct booking
- "Check availability [date] [time] [guests]" - Quick availability
- "Find alternatives for [details]" - Alternative time search

💡 EXAMPLES:
Hostess: "Check availability for 6 tonight"
Sofia: "Tonight (${dateContext.currentDate}) for 6 guests: ✅ 7:00 PM Table 15, ✅ 8:30 PM Table 8, ✅ 9:00 PM Combined tables"

Hostess: "Book Martinez for 4 tonight 8pm phone 555-1234"
Sofia: "✅ Booked! Martinez party, 4 guests, tonight (${dateContext.currentDate}) 8pm, Table 12"`;

        } else {
            // 👥 GUEST CONTEXT: Customer service, welcoming
            return `You are Sofia, the friendly booking specialist for ${this.restaurantConfig.name}!

${languageInstruction}

🎯 YOUR ROLE: Guest Service Specialist
You help guests make reservations with warm, welcoming customer service.

🏪 RESTAURANT DETAILS:
- Name: ${this.restaurantConfig.name}
- Restaurant ID: ${this.restaurantConfig.id}
- Cuisine: ${this.restaurantConfig.cuisine || 'Excellent dining'}
- Atmosphere: ${this.restaurantConfig.atmosphere || 'Welcoming and comfortable'}
- Hours: ${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime}
- Timezone: ${this.restaurantConfig.timezone}

📅 CURRENT DATE CONTEXT (CRITICAL):
- TODAY is ${dateContext.currentDate} (${dateContext.dayOfWeek})
- TOMORROW is ${dateContext.tomorrowDate}
- Current time: ${dateContext.currentTime} in ${dateContext.timezone}
- When guests say "today", use: ${dateContext.currentDate}
- When guests say "tomorrow", use: ${dateContext.tomorrowDate}
- ✅ When a guest says "next Friday" and today is Wednesday, it means the Friday of the *following* week, not the closest one. Calculate this correctly.
- ALWAYS use YYYY-MM-DD format for dates
- NEVER use dates from 2023 or other years - only current dates!

${getCriticalBookingInstructions()}

${conversationInstructions}

${personalizedSection}

🤝 GUEST COMMUNICATION STYLE:
- Warm and welcoming, like a friendly hostess
- Guide step-by-step through booking process
- Show enthusiasm: "I'd love to help you with that!"
- Ask follow-up questions naturally
- Celebrate successful bookings: "🎉 Your table is reserved!"
- Handle errors gracefully with helpful alternatives
- When tools fail, offer to help manually or try again

💡 CONVERSATION FLOW EXAMPLES:
Guest: "I need a table for tonight"
Sofia: "Perfect! For tonight (${dateContext.currentDate}), how many guests will be joining you? And what time would work best?"

Guest: "Can I book for tomorrow evening?"  
Sofia: "Absolutely! For tomorrow (${dateContext.tomorrowDate}) evening, what time works best and how many people? Also, I'll need your name and phone number for the reservation."

CRITICAL WORKFLOW EXAMPLES:
❌ WRONG: Guest: "Table for 3 tonight 8pm" → Sofia: "✅ Booked table for 3 tonight 8pm!"
✅ CORRECT: Guest: "Table for 3 tonight 8pm" → Sofia: "Great! Let me check availability for 3 guests tonight at 8pm... Perfect! Table 5 is available. I need your name and phone number to complete the reservation."

📞 PHONE COLLECTION EXAMPLES:
After availability check: "Perfect! Table 5 is available for 3 guests tonight at 8pm. I need your name and phone number to complete the reservation."`;
        }
    }

    /**
     * Sofia's available tools for booking operations
     * SOURCE: enhanced-conversation-manager.ts getToolsForAgent for booking agent
     */
    getTools() {
        return [
            {
                type: "function" as const,
                function: {
                    name: "get_guest_history",
                    description: "Get guest's booking history for personalized service. Use this to welcome returning guests and suggest their usual preferences.",
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
                    name: "get_restaurant_info",
                    description: "Get information about the restaurant including flexible time booking capabilities. Returns standardized response with requested information or error details.",
                    parameters: {
                        type: "object",
                        properties: {
                            infoType: {
                                type: "string",
                                enum: ["hours", "location", "cuisine", "contact", "features", "all"],
                                description: "Type of information to retrieve (hours includes flexible time booking settings)"
                            }
                        },
                        required: ["infoType"]
                    }
                }
            },
            {
                type: "function" as const,
                function: {
                    name: "check_availability",
                    description: "Check if tables are available for ANY specific time (supports exact times like 16:15, 19:43, 8:30). Returns standardized response with tool_status and detailed data or error information.",
                    parameters: {
                        type: "object",
                        properties: {
                            date: {
                                type: "string",
                                description: "Date in yyyy-MM-dd format (e.g., 2025-06-27)"
                            },
                            time: {
                                type: "string",
                                description: "Time in HH:MM format (24-hour) - supports ANY exact time like 16:15, 19:43, 8:30, etc."
                            },
                            guests: {
                                type: "number",
                                description: "Number of guests (1-50)"
                            }
                        },
                        required: ["date", "time", "guests"]
                    }
                }
            },
            {
                type: "function" as const,
                function: {
                    name: "find_alternative_times",
                    description: "Find alternative time slots around ANY preferred time (supports exact times like 16:15, 19:43). Returns standardized response with available alternatives sorted by proximity to preferred time.",
                    parameters: {
                        type: "object",
                        properties: {
                            date: {
                                type: "string",
                                description: "Date in yyyy-MM-dd format (e.g., 2025-06-27)"
                            },
                            preferredTime: {
                                type: "string",
                                description: "Preferred time in HH:MM format (24-hour) - supports ANY exact time like 16:15, 19:43"
                            },
                            guests: {
                                type: "number",
                                description: "Number of guests (1-50)"
                            }
                        },
                        required: ["date", "preferredTime", "guests"]
                    }
                }
            },
            {
                type: "function" as const,
                function: {
                    name: "create_reservation",
                    description: "Create a new reservation at ANY exact time (supports times like 16:15, 19:43, 8:30). Returns standardized response indicating success with reservation details or failure with categorized error.",
                    parameters: {
                        type: "object",
                        properties: {
                            guestName: {
                                type: "string",
                                description: "Guest's full name"
                            },
                            guestPhone: {
                                type: "string",
                                description: "Guest's phone number"
                            },
                            date: {
                                type: "string",
                                description: "Date in yyyy-MM-dd format (e.g., 2025-06-27)"
                            },
                            time: {
                                type: "string",
                                description: "Time in HH:MM format (24-hour) - supports ANY exact time like 16:15, 19:43, 8:30"
                            },
                            guests: {
                                type: "number",
                                description: "Number of guests (1-50)"
                            },
                            specialRequests: {
                                type: "string",
                                description: "Special requests or comments",
                                default: ""
                            }
                        },
                        required: ["guestName", "guestPhone", "date", "time", "guests"]
                    }
                }
            }
        ];
    }

    /**
     * Get current restaurant context for date/time operations
     * SOURCE: booking-agent.ts getCurrentRestaurantContext
     */
    getCurrentRestaurantContext() {
        try {
            const now = DateTime.now().setZone(this.restaurantConfig.timezone);
            const today = now.toISODate();
            const tomorrow = now.plus({ days: 1 }).toISODate();
            const currentTime = now.toFormat('HH:mm');
            const dayOfWeek = now.toFormat('cccc');

            return {
                currentDate: today,
                tomorrowDate: tomorrow,
                currentTime: currentTime,
                dayOfWeek: dayOfWeek,
                timezone: this.restaurantConfig.timezone
            };
        } catch (error) {
            console.error(`[SofiaAgent] Error getting restaurant time context:`, error);
            const now = DateTime.now();
            return {
                currentDate: now.toISODate(),
                tomorrowDate: now.plus({ days: 1 }).toISODate(),
                currentTime: now.toFormat('HH:mm'),
                dayOfWeek: now.toFormat('cccc'),
                timezone: 'UTC'
            };
        }
    }

    /**
     * ✅ COMPLETE: Main message processing method for Sofia
     */
    async processMessage(
        message: string, 
        context: AgentContext
    ): Promise<AgentResponse> {
        console.log(`[SofiaAgent] Processing message: "${message}"`);

        try {
            // Build tool context for Sofia's tools
            const toolContext = {
                restaurantId: context.restaurantId,
                timezone: context.session.currentStep || this.restaurantConfig.timezone,
                language: context.language,
                telegramUserId: context.telegramUserId,
                sessionId: context.sessionId
            };

            // Get system prompt
            const systemPrompt = this.getSystemPrompt(
                context.session.context,
                context.language,
                context.guestHistory,
                context.session.conversationHistory.length === 0,
                context.conversationContext
            );

            // Build conversation history for AI
            const conversationHistory = context.session.conversationHistory
                .slice(-5) // Last 5 messages for context
                .map(msg => `${msg.role}: ${msg.content}`)
                .join('\n');

            const fullPrompt = `${systemPrompt}

Recent conversation:
${conversationHistory}

Current user message: "${message}"

Respond naturally and use tools when needed. Always follow the critical booking workflow rules.`;

            // Generate response using AI service
            const response = await this.aiService.generateContent(
                fullPrompt,
                'booking',
                { 
                    temperature: 0.3, 
                    maxTokens: 800 
                }
            );

            console.log(`[SofiaAgent] AI response: ${response}`);

            // Parse function calls from response if any
            const toolCalls = this.parseToolCalls(response);
            
            // Execute tool calls if present
            const executedToolCalls = [];
            let finalResponse = response;

            if (toolCalls.length > 0) {
                console.log(`[SofiaAgent] Found ${toolCalls.length} tool calls`);
                
                for (const toolCall of toolCalls) {
                    try {
                        const toolResult = await this.executeToolCall(toolCall, toolContext);
                        executedToolCalls.push({
                            ...toolCall,
                            result: toolResult
                        });
                        
                        // Update response based on tool results
                        finalResponse = await this.incorporateToolResult(
                            finalResponse, 
                            toolCall, 
                            toolResult, 
                            context.language
                        );
                        
                    } catch (error) {
                        console.error(`[SofiaAgent] Tool execution error:`, error);
                        const errorMessage = await this.translationService.translate(
                            `I encountered an error while processing your request. Please try again.`,
                            context.language,
                            'error'
                        );
                        finalResponse = errorMessage;
                    }
                }
            }

            // Clean response (remove any function call syntax)
            finalResponse = this.cleanResponse(finalResponse);

            return {
                content: finalResponse,
                toolCalls: executedToolCalls,
                requiresConfirmation: this.shouldRequireConfirmation(executedToolCalls),
                hasBooking: this.hasSuccessfulBooking(executedToolCalls),
                reservationId: this.extractReservationId(executedToolCalls)
            };

        } catch (error) {
            console.error(`[SofiaAgent] Error processing message:`, error);
            
            const errorMessage = await this.translationService.translate(
                "I apologize, I encountered a technical issue. Please try again.",
                context.language,
                'error'
            );

            return {
                content: errorMessage,
                toolCalls: [],
                requiresConfirmation: false
            };
        }
    }

    /**
     * Parse tool calls from AI response
     */
    private parseToolCalls(response: string): Array<{function: {name: string, arguments: string}, id: string}> {
        const toolCalls = [];
        
        // Look for function call patterns in the response
        const functionPatterns = [
            /check_availability\s*\(\s*([^)]+)\)/g,
            /find_alternative_times\s*\(\s*([^)]+)\)/g,
            /create_reservation\s*\(\s*([^)]+)\)/g,
            /get_guest_history\s*\(\s*([^)]+)\)/g,
            /get_restaurant_info\s*\(\s*([^)]+)\)/g
        ];

        for (const pattern of functionPatterns) {
            let match;
            while ((match = pattern.exec(response)) !== null) {
                const functionName = pattern.source.split('\\s*\\(')[0];
                const args = match[1];
                
                toolCalls.push({
                    function: {
                        name: functionName,
                        arguments: args
                    },
                    id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                });
            }
        }

        return toolCalls;
    }

    /**
     * Execute a tool call
     */
    private async executeToolCall(toolCall: any, toolContext: any): Promise<any> {
        const { name, arguments: args } = toolCall.function;
        
        console.log(`[SofiaAgent] Executing tool: ${name} with args: ${args}`);

        try {
            // Parse arguments (handle both JSON and function call format)
            let parsedArgs;
            try {
                parsedArgs = JSON.parse(args);
            } catch {
                // Try to parse function call format: "date='2025-07-07', time='19:00', guests=2"
                parsedArgs = this.parseFunctionCallArgs(args);
            }

            switch (name) {
                case 'check_availability':
                    return await bookingTools.check_availability(
                        parsedArgs.date,
                        parsedArgs.time,
                        parsedArgs.guests,
                        toolContext
                    );

                case 'find_alternative_times':
                    return await bookingTools.find_alternative_times(
                        parsedArgs.date,
                        parsedArgs.preferredTime,
                        parsedArgs.guests,
                        toolContext
                    );

                case 'create_reservation':
                    return await bookingTools.create_reservation(
                        parsedArgs.guestName,
                        parsedArgs.guestPhone,
                        parsedArgs.date,
                        parsedArgs.time,
                        parsedArgs.guests,
                        parsedArgs.specialRequests || '',
                        toolContext
                    );

                case 'get_guest_history':
                    return await guestTools.get_guest_history(
                        parsedArgs.telegramUserId,
                        toolContext
                    );

                case 'get_restaurant_info':
                    return await bookingTools.get_restaurant_info(
                        parsedArgs.infoType,
                        toolContext
                    );

                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        } catch (error) {
            console.error(`[SofiaAgent] Error executing ${name}:`, error);
            return {
                tool_status: 'FAILURE',
                error: {
                    type: 'SYSTEM_ERROR',
                    message: error.message || 'Unknown error'
                }
            };
        }
    }

    /**
     * Parse function call arguments in string format
     */
    private parseFunctionCallArgs(argsString: string): any {
        const args = {};
        const pairs = argsString.split(',');
        
        for (const pair of pairs) {
            const [key, value] = pair.split('=').map(s => s.trim());
            if (key && value) {
                // Remove quotes and parse value
                const cleanValue = value.replace(/['"]/g, '');
                args[key] = isNaN(Number(cleanValue)) ? cleanValue : Number(cleanValue);
            }
        }
        
        return args;
    }

    /**
     * Incorporate tool result into response
     */
    private async incorporateToolResult(
        originalResponse: string,
        toolCall: any,
        toolResult: any,
        language: Language
    ): Promise<string> {
        const { name } = toolCall.function;

        if (toolResult.tool_status === 'SUCCESS') {
            // Success case - tool already provides translated message
            if (toolResult.data?.message) {
                return toolResult.data.message;
            }
            
            // Generate success message based on tool type
            switch (name) {
                case 'check_availability':
                    if (toolResult.data?.available) {
                        return await this.translationService.translate(
                            `Great! ${toolResult.data.table} is available for ${toolResult.data.exactTime}. I need your name and phone number to complete the booking.`,
                            language,
                            'success'
                        );
                    }
                    break;
                    
                case 'create_reservation':
                    return await this.translationService.translate(
                        `🎉 Perfect! Your reservation is confirmed. Reservation number: ${toolResult.data.reservationId}`,
                        language,
                        'success'
                    );
                    
                default:
                    return originalResponse;
            }
        } else {
            // Error case - return translated error message
            if (toolResult.error?.message) {
                return toolResult.error.message; // Already translated by tools
            }
            
            return await this.translationService.translate(
                `I'm sorry, I encountered an issue processing your request.`,
                language,
                'error'
            );
        }

        return originalResponse;
    }

    /**
     * Clean response by removing function call syntax
     */
    private cleanResponse(response: string): string {
        // Remove function call patterns
        return response
            .replace(/check_availability\s*\([^)]+\)/g, '')
            .replace(/find_alternative_times\s*\([^)]+\)/g, '')
            .replace(/create_reservation\s*\([^)]+\)/g, '')
            .replace(/get_guest_history\s*\([^)]+\)/g, '')
            .replace(/get_restaurant_info\s*\([^)]+\)/g, '')
            .replace(/\n\s*\n/g, '\n')
            .trim();
    }

    /**
     * Check if confirmation is required
     */
    private shouldRequireConfirmation(toolCalls: any[]): boolean {
        return toolCalls.some(call => 
            call.function.name === 'create_reservation' &&
            call.result?.tool_status === 'SUCCESS'
        );
    }

    /**
     * Check if there's a successful booking
     */
    private hasSuccessfulBooking(toolCalls: any[]): boolean {
        return toolCalls.some(call => 
            call.function.name === 'create_reservation' &&
            call.result?.tool_status === 'SUCCESS' &&
            call.result?.data?.success
        );
    }

    /**
     * Extract reservation ID from successful booking
     */
    private extractReservationId(toolCalls: any[]): number | undefined {
        const successfulBooking = toolCalls.find(call => 
            call.function.name === 'create_reservation' &&
            call.result?.tool_status === 'SUCCESS' &&
            call.result?.data?.reservationId
        );
        
        return successfulBooking?.result?.data?.reservationId;
    }
}

// ===== EXPORT DEFAULT =====
export default SofiaAgent;