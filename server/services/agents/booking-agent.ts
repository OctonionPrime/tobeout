// server/services/agents/booking-agent.ts
// ✅ PHASE 1 INTEGRATION COMPLETE:
// 1. Added Claude primary + OpenAI fallback system (matching other files)
// 2. Unified translation service pattern
// 3. Enhanced Maya integration with context preservation
// 4. Improved system prompts with immediate action rules

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { Language } from '../enhanced-conversation-manager';
import { agentTools } from './agent-tools';
import { DateTime } from 'luxon';

// ✅ PHASE 1 FIX: Initialize both AI clients for fallback system
const openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const claude = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!
});

/**
 * ✅ PHASE 1 FIX: Unified Translation Service (matching other files)
 */
class UnifiedTranslationService {
    private static cache = new Map<string, { translation: string, timestamp: number }>();
    private static CACHE_TTL = 60 * 60 * 1000; // 1 hour
    
    static async translate(
        text: string,
        targetLanguage: Language,
        context: 'greeting' | 'error' | 'info' | 'question' = 'info'
    ): Promise<string> {
        if (targetLanguage === 'en' || targetLanguage === 'auto') return text;
        
        // Check cache first
        const cacheKey = `${text}:${targetLanguage}:${context}`;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.translation;
        }
        
        try {
            const translation = await this.translateWithFallback(text, targetLanguage, context);
            
            // Cache the result
            this.cache.set(cacheKey, { translation, timestamp: Date.now() });
            
            return translation;
        } catch (error) {
            console.error('[UnifiedTranslation] Error:', error);
            return text; // Fallback to original
        }
    }
    
    /**
     * ✅ PHASE 1 FIX: AI abstraction layer with Claude primary + OpenAI fallback
     */
    private static async translateWithFallback(
        text: string,
        targetLanguage: Language,
        context: string
    ): Promise<string> {
        const languageNames: Record<Language, string> = {
            'en': 'English', 'ru': 'Russian', 'sr': 'Serbian', 'hu': 'Hungarian',
            'de': 'German', 'fr': 'French', 'es': 'Spanish', 'it': 'Italian',
            'pt': 'Portuguese', 'nl': 'Dutch', 'auto': 'English'
        };
        
        const prompt = `Translate this restaurant ${context} message to ${languageNames[targetLanguage]}:

"${text}"

Keep the same tone and professional style.
Return only the translation, no explanations.`;

        // ✅ PRIMARY: Claude Haiku for fast translation
        try {
            const result = await claude.messages.create({
                model: "claude-3-haiku-20240307",
                max_tokens: 300,
                temperature: 0.2,
                messages: [{ role: 'user', content: prompt }]
            });

            const response = result.content[0];
            if (response.type === 'text') {
                return response.text;
            }
            throw new Error("Non-text response from Claude");

        } catch (claudeError: any) {
            console.warn(`[Translation] Claude failed, using OpenAI fallback: ${claudeError.message}`);

            // ✅ FALLBACK: OpenAI
            try {
                const completion = await openaiClient.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 300,
                    temperature: 0.2
                });
                
                return completion.choices[0]?.message?.content?.trim() || text;
                
            } catch (openaiError: any) {
                console.error(`[Translation] Both Claude and OpenAI failed: ${openaiError.message}`);
                return text; // Final fallback to original
            }
        }
    }
    
    // Clean expired cache entries periodically
    static cleanCache(): void {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.CACHE_TTL) {
                this.cache.delete(key);
            }
        }
    }
}

/**
 * ✅ NEW: Guest history interface for personalized interactions
 */
interface GuestHistory {
    guest_name: string;
    guest_phone: string; // ✅ PHASE 1 FIX: Include phone
    total_bookings: number;
    total_cancellations: number;
    last_visit_date: string | null;
    common_party_size: number | null;
    frequent_special_requests: string[];
    retrieved_at: string;
}

/**
 * ✅ CRITICAL FIX: Enhanced conversation context interface
 */
interface ConversationContext {
    isReturnVisit: boolean;
    hasAskedPartySize: boolean;
    bookingNumber: number; // 1st, 2nd booking in session
    isSubsequentBooking: boolean;
    sessionTurnCount: number;
    lastQuestions: string[]; // Track last few questions to avoid repetition
}

/**
 * ✅ CRITICAL FIX: Enhanced personalized greeting generation with context awareness
 */
function generatePersonalizedGreeting(
    guestHistory: GuestHistory | null,
    language: Language,
    context: 'hostess' | 'guest',
    conversationContext?: ConversationContext
): string {
    // Get current date context
    const getCurrentRestaurantContext = () => {
        try {
            const now = DateTime.now();
            const today = now.toISODate();
            const currentTime = now.toFormat('HH:mm');
            const dayOfWeek = now.toFormat('cccc');

            return {
                currentDate: today,
                currentTime: currentTime,
                dayOfWeek: dayOfWeek
            };
        } catch (error) {
            console.error(`[BookingAgent] Error getting time context:`, error);
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
 * ✅ CRITICAL FIX: Smart question generation that avoids redundancy
 */
function generateSmartPartyQuestion(
    language: Language,
    hasAskedPartySize: boolean,
    isSubsequentBooking: boolean,
    commonPartySize?: number | null,
    conversationContext?: ConversationContext
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
 * Creates Sofia - the natural language booking specialist agent
 * ✅ PHASE 1 INTEGRATION: Enhanced with context preservation awareness and unified translation
 */
export function createBookingAgent(restaurantConfig: {
    id: number;
    name: string;
    timezone: string;
    openingTime: string;
    closingTime: string;
    maxGuests: number;
    cuisine?: string;
    atmosphere?: string;
    country?: string;
    languages?: string[];
}) {

    // Get current date in restaurant timezone
    const getCurrentRestaurantContext = () => {
        try {
            const now = DateTime.now().setZone(restaurantConfig.timezone);
            const today = now.toISODate();
            const tomorrow = now.plus({ days: 1 }).toISODate();
            const currentTime = now.toFormat('HH:mm');
            const dayOfWeek = now.toFormat('cccc');

            return {
                currentDate: today,
                tomorrowDate: tomorrow,
                currentTime: currentTime,
                dayOfWeek: dayOfWeek,
                timezone: restaurantConfig.timezone
            };
        } catch (error) {
            console.error(`[BookingAgent] Error getting restaurant time context:`, error);
            const now = DateTime.now();
            return {
                currentDate: now.toISODate(),
                tomorrowDate: now.plus({ days: 1 }).toISODate(),
                currentTime: now.toFormat('HH:mm'),
                dayOfWeek: now.toFormat('cccc'),
                timezone: 'UTC'
            };
        }
    };

    const getRestaurantLanguage = () => {
        if (restaurantConfig.languages && restaurantConfig.languages.length > 0) {
            return restaurantConfig.languages[0];
        }

        const country = restaurantConfig.country?.toLowerCase();
        if (country === 'russia' || country === 'russian federation') return 'ru';
        if (country === 'serbia' || country === 'republic of serbia') return 'sr';
        if (country === 'hungary') return 'hu';
        if (country === 'germany') return 'de';
        if (country === 'france') return 'fr';
        if (country === 'spain') return 'es';
        if (country === 'italy') return 'it';
        if (country === 'portugal') return 'pt';
        if (country === 'netherlands') return 'nl';

        return 'en';
    };

    const restaurantLanguage = getRestaurantLanguage();

    // ✅ CRITICAL FIX: Enhanced booking workflow instructions with explicit phone collection and alternative search handling
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

    // ✅ CRITICAL FIX: Generate personalized system prompt section with enhanced special requests handling
    const getPersonalizedPromptSection = (guestHistory: GuestHistory | null, language: Language, conversationContext?: ConversationContext): string => {
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

    // ✅ PHASE 1 FIX: Enhanced Maya modification execution with immediate action for clear requests
    const getMayaModificationExecutionRules = () => {
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
    };

    // ✅ ENHANCED: Language-agnostic system prompts that work for all languages
    const getSystemPrompt = (context: 'hostess' | 'guest', userLanguage: Language = 'en', guestHistory?: GuestHistory | null, conversationContext?: ConversationContext) => {

        const dateContext = getCurrentRestaurantContext();
        const criticalInstructions = getCriticalBookingInstructions();
        const personalizedSection = getPersonalizedPromptSection(guestHistory || null, userLanguage, conversationContext);

        // ✅ LANGUAGE INSTRUCTION (works for all languages)
        const languageInstruction = `🌍 CRITICAL LANGUAGE RULE:
- User's language: ${userLanguage}
- You MUST respond in ${userLanguage} for ALL messages
- Maintain warm, professional tone in ${userLanguage}
- If unsure of translation, use simple clear ${userLanguage}`;

        // Tool response understanding instructions
        const toolInstructions = `
🔧 TOOL RESPONSE UNDERSTANDING:
All tools return standardized responses with:
- tool_status: 'SUCCESS' or 'FAILURE'
- data: (when successful) contains the actual result
- error: (when failed) contains categorized error info

GUEST HISTORY TOOL:
- get_guest_history: Use this FIRST for telegram users to get personalized greeting info
- Only call this once per session for the first message
- Use the returned data to personalize greetings and suggestions

ERROR TYPES TO HANDLE:
1. VALIDATION_ERROR: Input format wrong (date, time, guests, etc.)
   → Ask user to correct the input with specific guidance
2. BUSINESS_RULE: No availability, capacity limits, restaurant policies
   → Suggest alternatives or explain constraints naturally
3. SYSTEM_ERROR: Technical issues with database/services
   → Apologize, suggest trying again, offer manual assistance

SPECIAL BUSINESS RULE CODES:
- NO_AVAILABILITY_SUGGEST_SMALLER: No tables for requested party size, but smaller available
  → Suggest the smaller party size option naturally and helpfully
- NAME_CLARIFICATION_NEEDED: The user has a profile with a different name. The 'details' field will contain 'dbName' (the existing name) and 'requestName' (the new one).
  → You MUST ask the user which name they want to use.

EXAMPLES:
✅ SUCCESS: {"tool_status": "SUCCESS", "data": {"available": true, "table": "5"}}
→ "Great! Table 5 is available for your reservation."

❌ BUSINESS_RULE with SMALLER PARTY: {"tool_status": "FAILURE", "error": {"code": "NO_AVAILABILITY_SUGGEST_SMALLER"}}
→ "I don't see any tables for 5 people at that time, but I have great options for 4 people. Would that work?"

❌ VALIDATION_ERROR: {"tool_status": "FAILURE", "error": {"type": "VALIDATION_ERROR", "field": "date"}}
→ "Please use date format YY-MM-DD, like ${dateContext.currentDate}"

❌ SYSTEM_ERROR: {"tool_status": "FAILURE", "error": {"type": "SYSTEM_ERROR"}}
→ "I'm having technical difficulties. Let me try again or I can help you manually."

ALWAYS check tool_status before using data!
`;

        // ✅ CRITICAL FIX: Enhanced conversation context instructions
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

        if (context === 'hostess') {
            // 🏢 HOSTESS CONTEXT: Staff assistant, efficiency-focused
            return `You are Sofia, the professional booking assistant for ${restaurantConfig.name} staff.

${languageInstruction}

🎯 YOUR ROLE: Staff Assistant
You help hostesses manage reservations quickly and efficiently. You understand staff workflow and speak professionally but efficiently.

🏪 RESTAURANT DETAILS:
- Name: ${restaurantConfig.name}
- Restaurant ID: ${restaurantConfig.id}
- Timezone: ${restaurantConfig.timezone}
- Hours: ${restaurantConfig.openingTime} - ${restaurantConfig.closingTime}
- Maximum party size: ${restaurantConfig.maxGuests}

📅 CURRENT DATE CONTEXT (CRITICAL):
- TODAY is ${dateContext.currentDate} (${dateContext.dayOfWeek})
- TOMORROW is ${dateContext.tomorrowDate}
- Current time: ${dateContext.currentTime} in ${dateContext.timezone}
- When guests say "today", use: ${dateContext.currentDate}
- When guests say "tomorrow", use: ${dateContext.tomorrowDate}
- ✅ When a guest says "next Friday" and today is Wednesday, it means the Friday of the *following* week, not the closest one. Calculate this correctly.
- ALWAYS use YYYY-MM-DD format for dates
- NEVER use dates from 2023 or other years - only current dates!

${criticalInstructions}

${toolInstructions}

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
            return `You are Sofia, the friendly booking specialist for ${restaurantConfig.name}!

${languageInstruction}

🎯 YOUR ROLE: Guest Service Specialist
You help guests make reservations with warm, welcoming customer service.

🏪 RESTAURANT DETAILS:
- Name: ${restaurantConfig.name}
- Restaurant ID: ${restaurantConfig.id}
- Cuisine: ${restaurantConfig.cuisine || 'Excellent dining'}
- Atmosphere: ${restaurantConfig.atmosphere || 'Welcoming and comfortable'}
- Hours: ${restaurantConfig.openingTime} - ${restaurantConfig.closingTime}
- Timezone: ${restaurantConfig.timezone}

📅 CURRENT DATE CONTEXT (CRITICAL):
- TODAY is ${dateContext.currentDate} (${dateContext.dayOfWeek})
- TOMORROW is ${dateContext.tomorrowDate}
- Current time: ${dateContext.currentTime} in ${dateContext.timezone}
- When guests say "today", use: ${dateContext.currentDate}
- When guests say "tomorrow", use: ${dateContext.tomorrowDate}
- ✅ When a guest says "next Friday" and today is Wednesday, it means the Friday of the *following* week, not the closest one. Calculate this correctly.
- ALWAYS use YYYY-MM-DD format for dates
- NEVER use dates from 2023 or other years - only current dates!

${criticalInstructions}

${toolInstructions}

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
    };

    // ✅ PHASE 1 FIX: Enhanced system prompt for Maya agent with modification execution rules
    const getMayaSystemPrompt = (context: 'hostess' | 'guest', userLanguage: Language = 'en', guestHistory?: GuestHistory | null, conversationContext?: ConversationContext) => {
        const dateContext = getCurrentRestaurantContext();
        const personalizedSection = getPersonalizedPromptSection(guestHistory || null, userLanguage, conversationContext);
        const mayaModificationRules = getMayaModificationExecutionRules();

        // ✅ LANGUAGE INSTRUCTION (works for all languages)
        const languageInstruction = `🌍 CRITICAL LANGUAGE RULE:
- User's language: ${userLanguage}
- You MUST respond in ${userLanguage} for ALL messages
- Maintain warm, professional tone in ${userLanguage}
- If unsure of translation, use simple clear ${userLanguage}`;

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

        return `You are Maya, the reservation management specialist for ${restaurantConfig.name}.

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

🚨 CRITICAL CONTEXT RULE:
When calling 'modify_reservation', if the user's message is a simple confirmation (e.g., "yes", "ok", "да", "давай так") and does NOT contain a number, you MUST OMIT the 'reservationId' argument in your tool call. The system will automatically use the reservation ID from the current session context. This prevents errors.

✅ CRITICAL RESERVATION DISPLAY RULES:
- When showing multiple reservations, ALWAYS display with actual IDs like: "Бронь #6: 2025-07-06 в 17:10 на 6 человек"
- NEVER use numbered lists like "1, 2, 3" - always use real IDs "#6, #3, #4"
- When asking user to choose, say: "Укажите ID брони (например, #6)"
- If user provides invalid ID, gently ask: "Пожалуйста, укажите ID брони из списка: #6, #3, #4"

📅 CURRENT DATE CONTEXT (CRITICAL):
- TODAY is ${dateContext.currentDate} (${dateContext.dayOfWeek})
- TOMORROW is ${dateContext.tomorrowDate}
- Current time: ${dateContext.currentTime} in ${dateContext.timezone}
- When guests say "today", use: ${dateContext.currentDate}
- When guests say "tomorrow", use: ${dateContext.tomorrowDate}
- ALWAYS use YYYY-MM-DD format for dates

💬 STYLE: Understanding, efficient, secure

${conversationInstructions}

${personalizedSection}`;
    };

    return {
        client: openaiClient, // Main conversations still use OpenAI for compatibility
        claude, // ✅ PHASE 1 FIX: Add Claude client for fallback system
        restaurantConfig,
        systemPrompt: getSystemPrompt('guest'), // Default to guest context
        tools: agentTools,
        restaurantLanguage,
        // ✅ PHASE 1 FIX: Enhanced methods with unified translation support
        getPersonalizedGreeting: (guestHistory: GuestHistory | null, language: Language, context: 'hostess' | 'guest', conversationContext?: ConversationContext) => {
            return generatePersonalizedGreeting(guestHistory, language, context, conversationContext);
        },
        getCurrentRestaurantContext,
        generateSmartPartyQuestion,
        updateInstructions: (context: 'hostess' | 'guest', language: Language = 'en', guestHistory?: GuestHistory | null, conversationContext?: ConversationContext) => {
            return getSystemPrompt(context, language, guestHistory, conversationContext);
        },
        // ✅ PHASE 1 FIX: Add Maya-specific system prompt method
        updateMayaInstructions: (context: 'hostess' | 'guest', language: Language = 'en', guestHistory?: GuestHistory | null, conversationContext?: ConversationContext) => {
            return getMayaSystemPrompt(context, language, guestHistory, conversationContext);
        },
        // ✅ PHASE 1 FIX: Add unified translation service access
        translate: UnifiedTranslationService.translate
    };
}

// Export interfaces for session management
export interface BookingSession {
    sessionId: string;
    restaurantId: number;
    platform: 'web' | 'telegram';
    context: 'hostess' | 'guest';
    language: Language;
    telegramUserId?: string;
    webSessionId?: string;
    createdAt: Date;
    lastActivity: Date;
    gatheringInfo: {
        date?: string;
        time?: string;
        guests?: number;
        name?: string;
        phone?: string;
        comments?: string;
    };
    conversationHistory: Array<{
        role: 'user' | 'assistant';
        content: string;
        timestamp: Date;
        toolCalls?: any[];
    }>;
    currentStep: 'greeting' | 'gathering' | 'checking' | 'confirming' | 'completed';
    hasActiveReservation?: number;
}

export function detectContext(platform: 'web' | 'telegram', message?: string): 'hostess' | 'guest' {
    if (platform === 'web') return 'hostess';
    if (platform === 'telegram') return 'guest';

    if (message) {
        const hostessKeywords = ['book for', 'check availability', 'find table', 'staff', 'quick'];
        if (hostessKeywords.some(keyword => message.toLowerCase().includes(keyword))) {
            return 'hostess';
        }
    }

    return 'guest';
}

export function createBookingSession(config: {
    restaurantId: number;
    platform: 'web' | 'telegram';
    language?: Language;
    telegramUserId?: string;
    webSessionId?: string;
}): BookingSession {
    const context = detectContext(config.platform);

    return {
        sessionId: generateSessionId(),
        restaurantId: config.restaurantId,
        platform: config.platform,
        context,
        language: config.language || 'en',
        telegramUserId: config.telegramUserId,
        webSessionId: config.webSessionId,
        createdAt: new Date(),
        lastActivity: new Date(),
        gatheringInfo: {},
        conversationHistory: [],
        currentStep: 'greeting'
    };
}

function generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function updateSessionInfo(
    session: BookingSession,
    updates: Partial<BookingSession['gatheringInfo']>
): BookingSession {
    return {
        ...session,
        gatheringInfo: {
            ...session.gatheringInfo,
            ...updates
        },
        lastActivity: new Date()
    };
}

// ✅ ENHANCED: Check if we have all required information for booking
export function hasCompleteBookingInfo(session: BookingSession): boolean {
    const { date, time, guests, name, phone } = session.gatheringInfo;
    const isComplete = !!(date && time && guests && name && phone);

    if (!isComplete) {
        const missing = [];
        if (!date) missing.push('date');
        if (!time) missing.push('time');
        if (!guests) missing.push('guests');
        if (!name) missing.push('name');
        if (!phone) missing.push('phone');

        console.log(`[BookingSession] Missing required info: ${missing.join(', ')}`);
    }

    return isComplete;
}

export default createBookingAgent;