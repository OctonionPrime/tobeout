// server/services/agents/specialists/sofia.agent.ts
// ✅ CRITICAL FIXES IMPLEMENTED:
// 1. 🧠 CONFIRMATION BLINDNESS FIXED - AI now remembers its previous questions
// 2. 🌍 LOCALIZED CONFIRMATION MESSAGES - No more hardcoded English!
// 3. 🎂 ENHANCED OCCASION DETECTION - Understands "др", "birthday", "anniversary"
// 4. 📋 ENHANCED CONFIRMATION DETAILS - Includes reservation ID and table name
// 5. 🤖 PERSONALITY LAYER - More natural, contextual responses
// 6. 🚨 CRITICAL FIX: [object Object] table display issue RESOLVED
// 7. 🚨 CRITICAL FIX: Double greeting issue RESOLVED

import OpenAI from 'openai';
import type { 
    AgentType, 
    Language,
    AgentContext,
    AgentResponse,
    BookingSessionWithAgent,
    GuestHistory,
    RestaurantConfig,
    UnifiedToolContext
} from '../core/agent.types';
import { AIFallbackService } from '../../ai/ai-fallback.service';
import { UnifiedTranslationService } from '../../ai/translation.service';
import { 
    getRestaurantTimeContext,
    getRestaurantOperatingStatus,
    isOvernightOperation,
    validateBookingDateTime,
    isValidTimezone
} from '../../../utils/timezone-utils';

// Import tools
import { bookingTools } from '../tools/booking.tools';
import { guestTools } from '../tools/guest.tools';

// Import prompt helpers
import { SofiaGreetings } from '../prompts/sofia.prompts';

// ===== 🆕 ENHANCED LOCALIZED CONFIRMATION TEMPLATES =====
/**
 * ✅ CRITICAL FIX: Enhanced localized confirmation messages with reservation details
 * 🚨 FIXED: [object Object] issue - now properly extracts table name from complex objects
 * Replaces the hardcoded English confirmation with proper multilingual support
 */
class SofiaConfirmations {
    /**
     * ✅ ENHANCED: Generate localized booking confirmation message with reservation details
     * 🚨 CRITICAL FIX: Properly handles complex table objects to extract display name
     * @param language - Target language for confirmation
     * @param details - Booking details including reservation ID and table object/name
     * @returns Professional, localized confirmation message with full details
     */
    static generateConfirmationMessage(
        language: Language,
        details: { 
            name: string; 
            guests: number; 
            date: string; 
            time: string;
            occasion?: string;
            reservationId?: number; // ✅ NEW: Reservation ID support
            tableName?: string | any; // ✅ FIXED: Can handle both string and object
        }
    ): string {
        // 🚨 CRITICAL FIX: Extract table name from complex object if needed
        let safeTableName: string | undefined;
        if (details.tableName) {
            if (typeof details.tableName === 'string') {
                safeTableName = details.tableName;
            } else if (typeof details.tableName === 'object') {
                // 🚨 FIX: Handle complex table objects by extracting the display name
                // Based on log "TableID 1, Name 1", try multiple possible properties
                safeTableName = details.tableName.Name || 
                               details.tableName.name || 
                               details.tableName.TableID || 
                               details.tableName.tableName || 
                               details.tableName.id ||
                               String(details.tableName); // Last resort fallback
                console.log(`[SofiaConfirmations] 🔧 FIXED: Extracted table name "${safeTableName}" from object:`, details.tableName);
            }
        }

        // Base confirmation templates for each language
        const baseTemplates = {
            en: `🎉 Your reservation is confirmed! ${details.name} for ${details.guests} guests on ${details.date} at ${details.time}`,
            ru: `🎉 Ваше бронирование подтверждено! ${details.name} на ${details.guests} ${this.getGuestsWord(details.guests, 'ru')} ${details.date} в ${details.time}`,
            sr: `🎉 Vaša rezervacija je potvrđena! ${details.name} za ${details.guests} ${this.getGuestsWord(details.guests, 'sr')} ${details.date} u ${details.time}`,
            hu: `🎉 A foglalása megerősítve! ${details.name} ${details.guests} főre ${details.date}-án ${details.time}-kor`,
            de: `🎉 Ihre Reservierung ist bestätigt! ${details.name} für ${details.guests} Personen am ${details.date} um ${details.time}`,
            fr: `🎉 Votre réservation est confirmée! ${details.name} pour ${details.guests} personnes le ${details.date} à ${details.time}`,
            es: `🎉 ¡Su reserva está confirmada! ${details.name} para ${details.guests} personas el ${details.date} a las ${details.time}`,
            it: `🎉 La sua prenotazione è confermata! ${details.name} per ${details.guests} persone il ${details.date} alle ${details.time}`,
            pt: `🎉 Sua reserva está confirmada! ${details.name} para ${details.guests} pessoas em ${details.date} às ${details.time}`,
            nl: `🎉 Uw reservering is bevestigd! ${details.name} voor ${details.guests} personen op ${details.date} om ${details.time}`,
            auto: `🎉 Your reservation is confirmed! ${details.name} for ${details.guests} guests on ${details.date} at ${details.time}`
        };

        let confirmation = baseTemplates[language] || baseTemplates.en;

        // ✅ FIXED: Add table details to the message (now handles complex objects properly)
        if (safeTableName) {
            const tableDetails = {
                en: ` at table ${safeTableName}`,
                ru: ` за столиком ${safeTableName}`,
                sr: ` za stolom ${safeTableName}`,
                hu: ` a ${safeTableName} asztalnál`,
                de: ` an Tisch ${safeTableName}`,
                fr: ` à la table ${safeTableName}`,
                es: ` en la mesa ${safeTableName}`,
                it: ` al tavolo ${safeTableName}`,
                pt: ` na mesa ${safeTableName}`,
                nl: ` aan tafel ${safeTableName}`,
                auto: ` at table ${safeTableName}`
            };
            confirmation += tableDetails[language] || tableDetails.en;
            console.log(`[SofiaConfirmations] ✅ Added table details: "${safeTableName}" in ${language}`);
        }

        // Add period to end the sentence
        confirmation += '.';

        // ✅ NEW: Add reservation ID details to the message
        if (details.reservationId) {
            const reservationDetails = {
                en: `\n📋 Reservation #${details.reservationId}`,
                ru: `\n📋 Бронь №${details.reservationId}`,
                sr: `\n📋 Rezervacija #${details.reservationId}`,
                hu: `\n📋 Foglalás #${details.reservationId}`,
                de: `\n📋 Reservierung #${details.reservationId}`,
                fr: `\n📋 Réservation #${details.reservationId}`,
                es: `\n📋 Reserva #${details.reservationId}`,
                it: `\n📋 Prenotazione #${details.reservationId}`,
                pt: `\n📋 Reserva #${details.reservationId}`,
                nl: `\n📋 Reservering #${details.reservationId}`,
                auto: `\n📋 Reservation #${details.reservationId}`
            };
            confirmation += reservationDetails[language] || reservationDetails.en;
        }

        // 🆕 ENHANCEMENT: Add special occasion celebration
        if (details.occasion) {
            const occasionMessages = {
                birthday: {
                    en: ` 🎂 Perfect for a birthday celebration!`,
                    ru: ` 🎂 Отлично подходит для празднования дня рождения!`,
                    sr: ` 🎂 Savršeno za proslavu rođendana!`,
                    hu: ` 🎂 Tökéletes születésnapi ünnepléshez!`,
                    de: ` 🎂 Perfekt für eine Geburtstagsfeier!`,
                    fr: ` 🎂 Parfait pour fêter un anniversaire!`,
                    es: ` 🎂 ¡Perfecto para celebrar un cumpleaños!`,
                    it: ` 🎂 Perfetto per festeggiare un compleanno!`,
                    pt: ` 🎂 Perfeito para comemorar um aniversário!`,
                    nl: ` 🎂 Perfect voor een verjaardagsviering!`,
                    auto: ` 🎂 Perfect for a birthday celebration!`
                },
                anniversary: {
                    en: ` 💕 Wonderful choice for your anniversary!`,
                    ru: ` 💕 Прекрасный выбор для вашей годовщины!`,
                    sr: ` 💕 Odličan izbor za vašu godišnjicu!`,
                    hu: ` 💕 Csodálatos választás az évfordulójukra!`,
                    de: ` 💕 Wunderbare Wahl für Ihren Jahrestag!`,
                    fr: ` 💕 Excellent choix pour votre anniversaire!`,
                    es: ` 💕 ¡Excelente elección para su aniversario!`,
                    it: ` 💕 Scelta meravigliosa per il vostro anniversario!`,
                    pt: ` 💕 Excelente escolha para seu aniversário!`,
                    nl: ` 💕 Prachtige keuze voor uw jubileum!`,
                    auto: ` 💕 Wonderful choice for your anniversary!`
                },
                business: {
                    en: ` 💼 Excellent for your business meeting!`,
                    ru: ` 💼 Отлично подходит для деловой встречи!`,
                    sr: ` 💼 Odlično za vaš poslovni sastanak!`,
                    hu: ` 💼 Kiváló az üzleti találkozójukhoz!`,
                    de: ` 💼 Ausgezeichnet für Ihr Geschäftstreffen!`,
                    fr: ` 💼 Parfait pour votre réunion d'affaires!`,
                    es: ` 💼 ¡Excelente para su reunión de negocios!`,
                    it: ` 💼 Eccellente per il vostro incontro di lavoro!`,
                    pt: ` 💼 Excelente para sua reunião de negócios!`,
                    nl: ` 💼 Uitstekend voor uw zakelijke bijeenkomst!`,
                    auto: ` 💼 Excellent for your business meeting!`
                }
            };

            const occasionType = details.occasion.toLowerCase();
            if (occasionMessages[occasionType]) {
                const occasionMessage = occasionMessages[occasionType][language] || 
                                      occasionMessages[occasionType].en;
                confirmation += occasionMessage;
            }
        }

        return confirmation;
    }

    /**
     * Helper to get correct word form for number of guests in Slavic languages
     */
    private static getGuestsWord(count: number, language: string): string {
        if (language === 'ru') {
            if (count === 1) return 'человека';
            if (count >= 2 && count <= 4) return 'человека';
            return 'человек';
        }
        if (language === 'sr') {
            if (count === 1) return 'osobu';
            if (count >= 2 && count <= 4) return 'osobe';
            return 'osoba';
        }
        return 'guests'; // Fallback
    }
}

// ===== ENHANCED: PARAMETER EXTRACTION INTERFACES =====
interface ExtractedBookingParameters {
    date?: string;
    time?: string;
    guests?: number;
    name?: string;
    phone?: string;
    specialRequests?: string;
    occasion?: 'birthday' | 'anniversary' | 'business' | 'other'; // 🆕 Enhanced occasion detection
    hasDateMention: boolean;
    hasTimeMention: boolean;
    hasGuestsMention: boolean;
    hasNameMention: boolean;
    hasPhoneMention: boolean;
    userIntent: 'booking_request' | 'availability_check' | 'general_inquiry' | 'unclear';
    extractionConfidence: number;
}

interface ParameterValidation {
    isComplete: boolean;
    missing: string[];
    readyForBooking: boolean;
    readyForAvailabilityCheck: boolean;
    nextAction: 'ask_for_missing' | 'check_availability' | 'create_booking' | 'general_response';
}

/**
 * Sofia Agent - Specialist for new reservations and booking workflow
 * ✅ FIXED: Localized confirmations, enhanced occasion detection, confirmation blindness resolved
 * 🚨 FIXED: [object Object] table display issue and double greeting issue
 */
export class SofiaAgent {
    readonly name = 'Sofia';
    readonly capabilities = [
        'new_reservations',
        'availability_checking', 
        'guest_greeting',
        'booking_workflow',
        'information_gathering',
        'occasion_detection', // 🆕 Enhanced capability
        'multilingual_confirmations', // 🆕 Enhanced capability
        'conversational_memory' // 🆕 NEW: Confirmation blindness fix
    ];
    readonly agentType: AgentType = 'booking';

    private openaiClient: OpenAI;

    constructor(
        private aiService: AIFallbackService,
        private translationService: UnifiedTranslationService,
        private restaurantConfig: RestaurantConfig
    ) {
        this.openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY!
        });
    }

    /**
     * ✅ PRESERVED: Guest history handling from ConversationManager
     */
    private async fetchGuestHistoryIfNeeded(
        context: AgentContext
    ): Promise<GuestHistory | null> {
        if (context.guestHistory) {
            console.log(`[SofiaAgent] Using guest history from ConversationManager for ${context.guestHistory.guest_name}`);
            return context.guestHistory;
        }

        console.log(`[SofiaAgent] No guest history available from ConversationManager`);
        return null;
    }

    /**
     * ✅ CRITICAL FIX: Extract parameters with conversational memory and occasion detection
     * 🧠 CONFIRMATION BLINDNESS FIXED: AI now remembers its previous questions
     * 🆕 NOW DETECTS: "др" → birthday, anniversaries, business meetings
     */
    private async extractBookingParameters(
        message: string,
        context: AgentContext,
        guestHistory: GuestHistory | null,
        lastAssistantMessage?: string // ✅ NEW: Add conversational memory parameter
    ): Promise<ExtractedBookingParameters> {
        console.log(`[SofiaAgent] ✅ ENHANCED: Extracting parameters with conversational memory and occasion detection from: "${message}"`);
        console.log(`[SofiaAgent] 🧠 Previous assistant message: "${lastAssistantMessage || 'None'}"`);

        // Get current date context for relative date parsing
        const dateContext = getRestaurantTimeContext(this.restaurantConfig.timezone);
        
        // ✅ ENHANCED: Create dynamic personalization prompt with guest history
        let personalizationInstructions = '';
        if (guestHistory?.guest_name) {
            const { guest_name, guest_phone } = guestHistory;
            personalizationInstructions = `
GUEST HISTORY CONTEXT:
- The user's name is: "${guest_name}"
- The user's phone is: "${guest_phone || 'not available'}"

INFERENCE RULES:
- If the user says "my name", "on my name", "same name" ("на моё имя", "то же имя"), extract the name as "${guest_name}".
- If the user says "my phone", "same number", "my number" ("мой номер", "тот же номер"), extract the phone as "${guest_phone}".
- If the user says "use my details", "same as before", extract both name and phone from history.
`;
        }

        // ✅ CRITICAL ENHANCEMENT: Conversational memory for confirmation blindness fix
        let conversationalMemoryInstructions = '';
        if (lastAssistantMessage) {
            conversationalMemoryInstructions = `
🧠 CONVERSATIONAL CONTEXT (CRITICAL):
- The user's message is: "${message}"
- The PREVIOUS assistant message was: "${lastAssistantMessage}"

💡 INTELLIGENT INFERENCE RULES (CONFIRMATION BLINDNESS FIX):
- If the PREVIOUS assistant message asked to confirm details (e.g., "Should I use the name...", "Использовать имя...", "да использовать", "можно использовать"), AND the user's message is affirmative (e.g., "yes", "ok", "use them", "да", "можно", "давай", "хорошо"), you MUST extract the 'name' and 'phone' from the GUEST HISTORY CONTEXT.
- Look for confirmation patterns: "да можно", "yes ok", "use it", "давай так", "хорошо", "согласен"
- If user gives affirmation + new info (e.g. "да можно. на 20-14"), extract BOTH the confirmed details AND the new information.
`;
        }

        // ✅ CRITICAL ENHANCEMENT: Occasion detection prompt
        const extractionPrompt = `You are a parameter extraction system. Your ONLY job is to extract booking information that the user EXPLICITLY mentioned or implied using their known history and conversational context. 

🆕 ENHANCED OCCASION DETECTION:
You must now detect special occasions mentioned by the user. This is CRITICAL for personalized service.

🧠 CONFIRMATION BLINDNESS FIX:
You must understand confirmations in conversational context to avoid asking for the same information repeatedly.

CRITICAL RULES:
- ONLY extract information that is EXPLICITLY stated by the user or clearly implied from their history/previous conversation.
- NEVER assume or invent missing information.
- Return null for any information not explicitly provided.
- 🆕 DETECT OCCASIONS: Look for birthday, anniversary, business, celebration indicators
- 🧠 UNDERSTAND CONFIRMATIONS: Use conversational context to infer confirmed details

Current date context:
- TODAY: ${dateContext.currentDate} (${dateContext.dayOfWeek})
- TOMORROW: ${dateContext.tomorrowDate}

${personalizationInstructions}

${conversationalMemoryInstructions}

User message: "${message}"

🆕 ENHANCED OCCASION DETECTION EXAMPLES:
- "хотел у вас отметить др с компанией" → occasion: "birthday"
- "день рождения", "birthday", "rođendan", "születésnap" → occasion: "birthday"
- "годовщина", "anniversary", "obljetnica", "évforduló" → occasion: "anniversary"  
- "деловая встреча", "business meeting", "poslovni sastanak" → occasion: "business"
- "celebration", "celebration", "proslava", "ünneplés" → occasion: "other"

🧠 CONFIRMATION UNDERSTANDING EXAMPLES:
- Previous: "Использовать имя Эрик и номер телефона 89001113355?" + User: "да можно. на 20-14" → extract name: "Эрик", phone: "89001113355", time: "20:14"
- Previous: "Should I use name John and phone 555-1234?" + User: "yes, for tomorrow 8pm" → extract name: "John", phone: "555-1234", date: "${dateContext.tomorrowDate}", time: "20:00"

Extract ONLY what the user explicitly mentioned or confirmed into this JSON format:
{
    "date": null or "YYYY-MM-DD" if explicitly mentioned,
    "time": null or "HH:MM" if explicitly mentioned,
    "guests": null or number if explicitly mentioned,
    "name": null or string if explicitly mentioned or confirmed from history,
    "phone": null or string if explicitly mentioned or confirmed from history,
    "specialRequests": null or string if mentioned,
    "occasion": null or "birthday" | "anniversary" | "business" | "other", // 🆕 NEW FIELD
    "hasDateMention": true/false,
    "hasTimeMention": true/false,
    "hasGuestsMention": true/false,
    "hasNameMention": true/false,
    "hasPhoneMention": true/false,
    "userIntent": "booking_request" | "availability_check" | "general_inquiry" | "unclear",
    "extractionConfidence": 0.0-1.0
}

🧠 ENHANCED CONFIRMATION EXAMPLES:
User: "да можно. на 20-14" (GIVEN PREVIOUS MESSAGE ASKED TO CONFIRM NAME "Эрик" AND PHONE)
→ {"date": null, "time": "20:14", "guests": null, "name": "Эрик", "phone": "89001113355", "occasion": null, "hasDateMention": false, "hasTimeMention": true, "hasGuestsMention": false, "hasNameMention": true, "hasPhoneMention": true, "userIntent": "booking_request", "extractionConfidence": 0.95}

User: "yes ok, for 6 people" (GIVEN PREVIOUS MESSAGE ASKED TO CONFIRM DETAILS)
→ {"date": null, "time": null, "guests": 6, "name": "John", "phone": "555-1234", "occasion": null, "hasDateMention": false, "hasTimeMention": false, "hasGuestsMention": true, "hasNameMention": true, "hasPhoneMention": true, "userIntent": "booking_request", "extractionConfidence": 0.9}

User: "хотел у вас отметить др с компанией на 13 июля в 17-15"
→ {"date": "2025-07-13", "time": "17:15", "guests": null, "occasion": "birthday", "specialRequests": "отметить с компанией", "hasDateMention": true, "hasTimeMention": true, "hasGuestsMention": false, "userIntent": "booking_request", "extractionConfidence": 0.95}

Return ONLY the JSON, no explanations.`;

        try {
            const completion = await this.openaiClient.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: extractionPrompt }],
                temperature: 0.1, // Low temperature for consistent extraction
                max_tokens: 500
            });

            const response = completion.choices[0]?.message?.content?.trim();
            if (!response) {
                throw new Error('Empty response from parameter extraction');
            }

            // Parse JSON response
            const extracted: ExtractedBookingParameters = JSON.parse(response);
            
            console.log(`[SofiaAgent] 🧠 ENHANCED extraction with conversational memory:`, {
                date: extracted.date,
                time: extracted.time,
                guests: extracted.guests,
                name: extracted.name,
                phone: extracted.phone,
                occasion: extracted.occasion, // 🆕 New field
                userIntent: extracted.userIntent,
                confidence: extracted.extractionConfidence,
                conversationalMemoryUsed: !!lastAssistantMessage,
                mentions: {
                    date: extracted.hasDateMention,
                    time: extracted.hasTimeMention,
                    guests: extracted.hasGuestsMention,
                    name: extracted.hasNameMention,
                    phone: extracted.hasPhoneMention
                }
            });

            return extracted;

        } catch (error) {
            console.error(`[SofiaAgent] Parameter extraction error:`, error);
            
            // Fallback: conservative extraction
            return {
                date: undefined,
                time: undefined,
                guests: undefined,
                name: undefined,
                phone: undefined,
                specialRequests: undefined,
                occasion: undefined, // 🆕 New field
                hasDateMention: false,
                hasTimeMention: false,
                hasGuestsMention: false,
                hasNameMention: false,
                hasPhoneMention: false,
                userIntent: 'unclear',
                extractionConfidence: 0.0
            };
        }
    }

    /**
     * ✅ ENHANCED: Validate parameters using merged data with occasion context
     */
    private validateRequiredParameters(
        mergedParams: any,
        context: AgentContext
    ): ParameterValidation {
        const missing: string[] = [];
        
        // Check what's missing for different actions
        const hasDate = mergedParams.date !== null && mergedParams.date !== undefined;
        const hasTime = mergedParams.time !== null && mergedParams.time !== undefined;
        const hasGuests = mergedParams.guests !== null && mergedParams.guests !== undefined;
        const hasName = mergedParams.name !== null && mergedParams.name !== undefined;
        const hasPhone = mergedParams.phone !== null && mergedParams.phone !== undefined;

        // For availability checking, we need: date, time, guests
        const readyForAvailabilityCheck = hasDate && hasTime && hasGuests;
        
        // For booking creation, we need: date, time, guests, name, phone
        const readyForBooking = hasDate && hasTime && hasGuests && hasName && hasPhone;

        // Determine what's missing based on user intent
        if (mergedParams.userIntent === 'booking_request' || mergedParams.userIntent === 'availability_check') {
            if (!hasDate) missing.push('date');
            if (!hasTime) missing.push('time');
            if (!hasGuests) missing.push('guests');
            
            // If they want to book (not just check), also need personal info
            if (mergedParams.userIntent === 'booking_request') {
                if (!hasName) missing.push('name');
                if (!hasPhone) missing.push('phone');
            }
        }

        let nextAction: ParameterValidation['nextAction'];
        if (mergedParams.userIntent === 'general_inquiry') {
            nextAction = 'general_response';
        } else if (readyForBooking) {
            nextAction = 'create_booking';
        } else if (readyForAvailabilityCheck) {
            nextAction = 'check_availability';
        } else {
            nextAction = 'ask_for_missing';
        }

        const validation: ParameterValidation = {
            isComplete: missing.length === 0,
            missing,
            readyForBooking,
            readyForAvailabilityCheck,
            nextAction
        };

        console.log(`[SofiaAgent] Parameter validation with occasion context:`, {
            isComplete: validation.isComplete,
            missing: missing,
            readyForAvailabilityCheck,
            readyForBooking,
            nextAction,
            userIntent: mergedParams.userIntent,
            occasion: mergedParams.occasion // 🆕 Log occasion
        });

        return validation;
    }

    /**
     * ✅ ENHANCED: Ask for missing information with conversation intelligence and personality layer
     * 🧠 NEW: Context-aware questions that use guest history intelligently
     * 🆕 PERSONALITY LAYER: More natural, contextual responses
     * 🚨 CRITICAL FIX: Double greeting issue RESOLVED - prevents re-greetings
     */
    private async promptForMissingInfo(
        missing: string[],
        mergedParams: any,
        context: AgentContext
    ): Promise<AgentResponse> {
        console.log(`[SofiaAgent] Prompting for missing info with conversation intelligence:`, missing);

        const language = context.language;
        const guestHistory = context.guestHistory;
        
        // 🧠 NEW: INTELLIGENT QUESTION LOGIC - Check what we can confirm from history
        let useDetailsConfirmation = '';
        const missingButInHistory = { name: false, phone: false };

        if (guestHistory?.guest_name && missing.includes('name')) {
            missingButInHistory.name = true;
        }
        if (guestHistory?.guest_phone && missing.includes('phone')) {
            missingButInHistory.phone = true;
        }

        // 🧠 CONVERSATION INTELLIGENCE: Ask for confirmation instead of asking for known information
        if (missingButInHistory.name || missingButInHistory.phone) {
            const confirmations = {
                en: `Should I use the name ${guestHistory?.guest_name} and phone number we have on file for you?`,
                ru: `Использовать имя ${guestHistory?.guest_name} и номер телефона, которые у нас сохранены?`,
                sr: `Da koristim ime ${guestHistory?.guest_name} i broj telefona koji imamo za vas?`,
                hu: `Használjam a ${guestHistory?.guest_name} nevet és a telefonszámot, amelyet tárolunk?`,
                de: `Soll ich den Namen ${guestHistory?.guest_name} und die Telefonnummer verwenden, die wir gespeichert haben?`,
                fr: `Dois-je utiliser le nom ${guestHistory?.guest_name} et le numéro de téléphone que nous avons en dossier?`,
                es: `¿Debo usar el nombre ${guestHistory?.guest_name} y el número de teléfono que tenemos registrado?`,
                it: `Devo usare il nome ${guestHistory?.guest_name} e il numero di telefono che abbiamo in archivio?`,
                pt: `Devo usar o nome ${guestHistory?.guest_name} e o número de telefone que temos em arquivo?`,
                nl: `Zal ik de naam ${guestHistory?.guest_name} en het telefoonnummer gebruiken dat we voor u hebben?`,
                auto: `Should I use the name ${guestHistory?.guest_name} and phone number we have on file for you?`
            };
            useDetailsConfirmation = confirmations[language] || confirmations.en;
        }

        // Filter out the missing items we can confirm from history
        const stillMissing = missing.filter(item => 
            !(missingButInHistory.name && item === 'name') && 
            !(missingButInHistory.phone && item === 'phone')
        );
        
        // 🆕 PERSONALITY ENHANCEMENT: Build context-aware prompt with occasion awareness
        let occasionContext = '';
        if (mergedParams.occasion) {
            const occasionContexts = {
                birthday: {
                    en: "A birthday celebration, how wonderful! ",
                    ru: "День рождения, как замечательно! ",
                    sr: "Rođendan, kako divno! ",
                    hu: "Születésnap, milyen csodálatos! ",
                    de: "Ein Geburtstag, wie wunderbar! ",
                    fr: "Un anniversaire, comme c'est merveilleux! ",
                    es: "¡Un cumpleaños, qué maravilloso! ",
                    it: "Un compleanno, che meraviglioso! ",
                    pt: "Um aniversário, que maravilhoso! ",
                    nl: "Een verjaardag, hoe prachtig! ",
                    auto: "A birthday celebration, how wonderful! "
                },
                anniversary: {
                    en: "An anniversary - such a special occasion! ",
                    ru: "Годовщина - такое особенное событие! ",
                    sr: "Godišnjica - tako posebna prilika! ",
                    hu: "Évforduló - milyen különleges alkalom! ",
                    de: "Ein Jahrestag - so ein besonderer Anlass! ",
                    fr: "Un anniversaire - une occasion si spéciale! ",
                    es: "¡Un aniversario - una ocasión tan especial! ",
                    it: "Un anniversario - un'occasione così speciale! ",
                    pt: "Um aniversário - uma ocasião tão especial! ",
                    nl: "Een jubileum - zo'n bijzondere gelegenheid! ",
                    auto: "An anniversary - such a special occasion! "
                },
                business: {
                    en: "A business meeting - I'll ensure everything is perfect! ",
                    ru: "Деловая встреча - я позабочусь, чтобы всё было идеально! ",
                    sr: "Poslovni sastanak - postaraću se da sve bude savršeno! ",
                    hu: "Üzleti találkozó - gondoskodom róla, hogy minden tökéletes legyen! ",
                    de: "Ein Geschäftstreffen - ich sorge dafür, dass alles perfekt ist! ",
                    fr: "Une réunion d'affaires - je m'assurerai que tout soit parfait! ",
                    es: "¡Una reunión de negocios - me aseguraré de que todo sea perfecto! ",
                    it: "Un incontro di lavoro - mi assicurerò che tutto sia perfetto! ",
                    pt: "Uma reunião de negócios - vou garantir que tudo seja perfeito! ",
                    nl: "Een zakelijke bijeenkomst - ik zorg ervoor dat alles perfect is! ",
                    auto: "A business meeting - I'll ensure everything is perfect! "
                }
            };

            const occasionType = mergedParams.occasion.toLowerCase();
            if (occasionContexts[occasionType]) {
                occasionContext = occasionContexts[occasionType][language] || 
                                occasionContexts[occasionType].en;
            }
        }

        // The remaining missing parameters after filtering
        const missingParams = stillMissing.join(', ');

        // 🧠 ENHANCED: Intelligent missing info prompt with conversation context
        let missingInfoPrompt = `You are Sofia, the booking assistant. The user wants to make a reservation but didn't provide all required information.

🧠 CONVERSATION INTELLIGENCE CONTEXT:
${guestHistory ? `GUEST HISTORY: Name: ${guestHistory.guest_name}, Phone: ${guestHistory.guest_phone}` : 'GUEST HISTORY: No history'}
${occasionContext ? `SPECIAL OCCASION: ${mergedParams.occasion} - Use this context to be more engaging and personal.` : 'PERSONALITY: Be warm and helpful.'}

USER PROVIDED:
${mergedParams.date ? `- Date: ${mergedParams.date}` : ''}
${mergedParams.time ? `- Time: ${mergedParams.time}` : ''}
${mergedParams.guests ? `- Guests: ${mergedParams.guests}` : ''}
${mergedParams.name ? `- Name: ${mergedParams.name}` : ''}
${mergedParams.phone ? `- Phone: ${mergedParams.phone}` : ''}
${mergedParams.occasion ? `- Special occasion: ${mergedParams.occasion}` : ''}

🧠 INTELLIGENT INSTRUCTIONS:
${useDetailsConfirmation ? `FIRST: Ask this confirmation question: "${useDetailsConfirmation}"` : ''}
${stillMissing.length > 0 ? `THEN: Ask for these remaining missing items naturally: ${missingParams}` : 'NO additional items needed.'}

Respond in ${language} and ask for the missing information intelligently. 
${occasionContext ? `Start with the occasion context: "${occasionContext}"` : 'Be warm and helpful.'}
${useDetailsConfirmation ? `Then ask: "${useDetailsConfirmation}"` : ''}
${stillMissing.length > 0 ? `Then ask for: ${missingParams}` : ''}

🚨 CRITICAL FIX: Double greeting prevention rules:
- Do NOT add greetings like "Здравствуйте", "Hello", "Привет", or "Welcome back" as this is a follow-up question
- Get straight to the point - this is NOT the first interaction
- Skip pleasantries and focus on getting the missing information
- Be direct and efficient, not repetitive

🧠 ENHANCED EXAMPLES:
- If need to confirm details + time: "${occasionContext}${useDetailsConfirmation} And what time works best?"
- If just missing time: "${occasionContext}На какое время?"
- If just missing guests: "На сколько человек?"
- If confirming details only: "${useDetailsConfirmation}"

🚨 ANTI-DOUBLE-GREETING EXAMPLES:
❌ BAD: "Здравствуйте, Эрик! Я рада помочь. На сколько человек?" 
✅ GOOD: "На сколько человек вы бы хотели забронировать?"
❌ BAD: "Hello! How can I help you? What time would work?"
✅ GOOD: "What time would work best for your reservation?"

Keep it brief and natural. Don't repeat information they already provided. 
CRITICAL: Do NOT add greetings like "Hello", "Привет", or "Welcome back" as this is a follow-up question. Get straight to the point.
Use intelligent confirmation for known details.`;

        try {
            const completion = await this.openaiClient.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: missingInfoPrompt }],
                temperature: 0.3,
                max_tokens: 250
            });

            let response = completion.choices[0]?.message?.content?.trim() || 
                "I need a bit more information to help you with your reservation.";

            // 🧠 CONVERSATION INTELLIGENCE: Ensure confirmation question is included
            if (useDetailsConfirmation && !response.toLowerCase().includes(guestHistory?.guest_name?.toLowerCase() || '')) {
                response = useDetailsConfirmation + " " + response;
            }

            // 🆕 PERSONALITY LAYER: Add occasion context if available
            if (occasionContext && !response.includes(occasionContext.trim())) {
                response = occasionContext + response;
            }

            console.log(`[SofiaAgent] 🚨 FIXED: Generated follow-up question without double greeting: "${response.substring(0, 100)}..."`);

            return {
                content: response,
                sessionUpdates: {
                    gatheringInfo: {
                        ...context.session.gatheringInfo,
                        ...mergedParams  // ✅ Store all merged parameters including occasion
                    }
                }
            };

        } catch (error) {
            console.error(`[SofiaAgent] Error generating missing info prompt:`, error);
            
            // Intelligent fallback
            let fallbackResponse = '';
            
            if (useDetailsConfirmation) {
                fallbackResponse = useDetailsConfirmation;
                if (stillMissing.length > 0) {
                    const fallbackMessages = {
                        en: " Also, what time would work best?",
                        ru: " Также, на какое время вам удобно?",
                        sr: " Takođe, koje vreme vam odgovara?",
                        auto: " Also, what time would work best?"
                    };
                    fallbackResponse += fallbackMessages[language as keyof typeof fallbackMessages] || fallbackMessages.en;
                }
            } else {
                const fallbackMessages = {
                    en: "I need a bit more information. What time and how many guests?",
                    ru: "Мне нужно уточнить. На какое время и на сколько человек?",
                    sr: "Treba mi još informacija. Za koje vreme i koliko osoba?",
                    auto: "I need a bit more information. What time and how many guests?"
                };
                fallbackResponse = fallbackMessages[language as keyof typeof fallbackMessages] || fallbackMessages.en;
            }
            
            // Add occasion context to fallback
            if (occasionContext) {
                fallbackResponse = occasionContext + fallbackResponse;
            }
            
            console.log(`[SofiaAgent] 🚨 FIXED: Fallback response without double greeting: "${fallbackResponse}"`);
            
            return {
                content: fallbackResponse,
                sessionUpdates: {
                    gatheringInfo: {
                        ...context.session.gatheringInfo,
                        ...mergedParams  // ✅ Store all merged parameters including occasion
                    }
                }
            };
        }
    }

    /**
     * ✅ ENHANCED: Process message with tools using merged parameters and occasion context
     * 🚨 CRITICAL FIX: [object Object] table display issue resolved in confirmation generation
     */
    private async processWithTools(
        mergedParams: any,
        validation: ParameterValidation,
        context: AgentContext
    ): Promise<AgentResponse> {
        console.log(`[SofiaAgent] Processing with tools - action: ${validation.nextAction}, occasion: ${mergedParams.occasion}`);

        // Build unified tool context
        let effectiveTimezone = this.restaurantConfig.timezone;
        if (!isValidTimezone(effectiveTimezone)) {
            console.warn(`[SofiaAgent] Invalid timezone: ${effectiveTimezone}, falling back to Belgrade`);
            effectiveTimezone = 'Europe/Belgrade';
        }

        const toolContext: UnifiedToolContext = {
            restaurantId: context.restaurantId,
            timezone: effectiveTimezone,
            language: context.language,
            telegramUserId: context.telegramUserId,
            sessionId: context.sessionId,
            session: context.session
        };

        if (validation.nextAction === 'check_availability') {
            // Call availability check with validated parameters
            try {
                const availabilityResult = await bookingTools.check_availability(
                    mergedParams.date!,
                    mergedParams.time!,
                    mergedParams.guests!,
                    toolContext
                );

                if (availabilityResult.tool_status === 'SUCCESS') {
                    // ✅ CRITICAL FIX: Instead of asking for name/phone, re-run validation.
                    // All parameters (date, time, guests) are now known. Let's see if we can book.
                    console.log(`[SofiaAgent] 🧠 Availability confirmed. Re-validating to see if booking is possible.`);

                    // Re-validate with the complete set of information
                    const finalValidation = this.validateRequiredParameters(mergedParams, context);

                    if (finalValidation.readyForBooking) {
                        // If we are ready, call this function again to trigger the 'create_booking' path
                        console.log(`[SofiaAgent] 🧠 All info present. Proceeding directly to create_booking.`);
                        return await this.processWithTools(mergedParams, finalValidation, context);

                    } else {
                        // If we are STILL missing info (shouldn't happen in this flow, but safe to handle),
                        // then call the intelligent promptForMissingInfo function.
                        console.log(`[SofiaAgent] 🧠 Still missing info after availability check. Prompting again.`);
                        return await this.promptForMissingInfo(finalValidation.missing, mergedParams, context);
                    }
                } else {
                    // No availability - suggest alternatives
                    const alternativesResult = await bookingTools.find_alternative_times(
                        mergedParams.date!,
                        mergedParams.time!,
                        mergedParams.guests!,
                        toolContext
                    );

                    let responseContent = `Sorry, no tables available at ${mergedParams.time} on ${mergedParams.date}.`;
                    if (alternativesResult.tool_status === 'SUCCESS' && alternativesResult.data?.alternatives) {
                        const alternatives = alternativesResult.data.alternatives.slice(0, 3);
                        const altTimes = alternatives.map(alt => alt.time).join(', ');
                        responseContent = `Sorry, ${mergedParams.time} is not available${mergedParams.occasion ? ` for your ${mergedParams.occasion}` : ''}. How about these times: ${altTimes}?`;
                    }

                    return {
                        content: responseContent,
                        toolCalls: [
                            {
                                function: { name: 'check_availability', arguments: JSON.stringify({
                                    date: mergedParams.date,
                                    time: mergedParams.time,
                                    guests: mergedParams.guests
                                })},
                                id: 'check_availability_validated',
                                result: availabilityResult
                            },
                            {
                                function: { name: 'find_alternative_times', arguments: JSON.stringify({
                                    date: mergedParams.date,
                                    preferredTime: mergedParams.time,
                                    guests: mergedParams.guests
                                })},
                                id: 'find_alternatives_validated',
                                result: alternativesResult
                            }
                        ],
                        sessionUpdates: {
                            gatheringInfo: {
                                ...context.session.gatheringInfo,
                                ...mergedParams  // ✅ Preserve all data including occasion
                            }
                        }
                    };
                }
            } catch (error) {
                console.error(`[SofiaAgent] Tool execution error:`, error);
                return {
                    content: "I'm sorry, I encountered an issue checking availability. Please try again."
                };
            }
        } else if (validation.nextAction === 'create_booking') {
            // 🆕 ENHANCED: Create reservation with occasion context
            try {
                // Enhance special requests with occasion information
                let enhancedSpecialRequests = mergedParams.specialRequests || '';
                if (mergedParams.occasion && !enhancedSpecialRequests.includes(mergedParams.occasion)) {
                    const occasionLabels = {
                        birthday: context.language === 'ru' ? 'День рождения' : 'Birthday celebration',
                        anniversary: context.language === 'ru' ? 'Годовщина' : 'Anniversary celebration',
                        business: context.language === 'ru' ? 'Деловая встреча' : 'Business meeting',
                        other: context.language === 'ru' ? 'Особый случай' : 'Special occasion'
                    };
                    
                    const occasionLabel = occasionLabels[mergedParams.occasion] || occasionLabels.other;
                    enhancedSpecialRequests = enhancedSpecialRequests 
                        ? `${enhancedSpecialRequests}. ${occasionLabel}` 
                        : occasionLabel;
                }

                const bookingResult = await bookingTools.create_reservation(
                    mergedParams.name!,
                    mergedParams.phone!,
                    mergedParams.date!,
                    mergedParams.time!,
                    mergedParams.guests!,
                    enhancedSpecialRequests,
                    toolContext
                );

                if (bookingResult.tool_status === 'SUCCESS') {
                    // ✅ CRITICAL FIX: Use enhanced localized confirmation with reservation details
                    // 🚨 DEPLOYMENT SAFETY: Multiple fallback layers to ensure localization works
                    // 🚨 CRITICAL FIX: [object Object] issue resolved in SofiaConfirmations class
                    let localizedConfirmation;
                    
                    try {
                        // ✅ ENHANCED: Pass reservation details from booking result (handles complex table objects now)
                        const bookingData = bookingResult.data; // Get data from the tool result
                        console.log(`[SofiaAgent] 🔧 FIXING: Booking data received:`, {
                            reservationId: bookingData?.reservationId,
                            table: bookingData?.table,
                            tableType: typeof bookingData?.table
                        });

                        localizedConfirmation = SofiaConfirmations.generateConfirmationMessage(
                            context.language,
                            {
                                name: mergedParams.name!,
                                guests: mergedParams.guests!,
                                date: mergedParams.date!,
                                time: mergedParams.time!,
                                occasion: mergedParams.occasion, // 🆕 Include occasion context
                                reservationId: bookingData?.reservationId, // ✅ NEW: Pass reservation ID
                                tableName: bookingData?.table // ✅ FIXED: Now handles complex objects properly
                            }
                        );
                        console.log(`[SofiaAgent] ✅ Generated enhanced localized confirmation in ${context.language}:`, localizedConfirmation.substring(0, 100));
                        console.log(`[SofiaAgent] 🚨 FIXED: [object Object] issue resolved - table properly extracted`);
                    } catch (confirmationError) {
                        console.error(`[SofiaAgent] 🚨 Enhanced localization error, using fallback:`, confirmationError);
                        
                        // 🚨 DEPLOYMENT SAFETY: Emergency fallback to manual translation
                        const emergencyConfirmations = {
                            en: `🎉 Your reservation is confirmed! ${mergedParams.name} for ${mergedParams.guests} guests on ${mergedParams.date} at ${mergedParams.time}.`,
                            ru: `🎉 Ваше бронирование подтверждено! ${mergedParams.name} на ${mergedParams.guests} человек ${mergedParams.date} в ${mergedParams.time}.`,
                            sr: `🎉 Vaša rezervacija je potvrđena! ${mergedParams.name} za ${mergedParams.guests} osoba ${mergedParams.date} u ${mergedParams.time}.`,
                            hu: `🎉 A foglalása megerősítve! ${mergedParams.name} ${mergedParams.guests} főre ${mergedParams.date}-án ${mergedParams.time}-kor.`,
                            de: `🎉 Ihre Reservierung ist bestätigt! ${mergedParams.name} für ${mergedParams.guests} Personen am ${mergedParams.date} um ${mergedParams.time}.`,
                            fr: `🎉 Votre réservation est confirmée! ${mergedParams.name} pour ${mergedParams.guests} personnes le ${mergedParams.date} à ${mergedParams.time}.`,
                            es: `🎉 ¡Su reserva está confirmada! ${mergedParams.name} para ${mergedParams.guests} personas el ${mergedParams.date} a las ${mergedParams.time}.`,
                            it: `🎉 La sua prenotazione è confermata! ${mergedParams.name} per ${mergedParams.guests} persone il ${mergedParams.date} alle ${mergedParams.time}.`,
                            pt: `🎉 Sua reserva está confirmada! ${mergedParams.name} para ${mergedParams.guests} pessoas em ${mergedParams.date} às ${mergedParams.time}.`,
                            nl: `🎉 Uw reservering is bevestigd! ${mergedParams.name} voor ${mergedParams.guests} personen op ${mergedParams.date} om ${mergedParams.time}.`,
                            auto: `🎉 Your reservation is confirmed! ${mergedParams.name} for ${mergedParams.guests} guests on ${mergedParams.date} at ${mergedParams.time}.`
                        };
                        
                        localizedConfirmation = emergencyConfirmations[context.language] || emergencyConfirmations.en;
                        
                        // Add occasion context manually if available
                        if (mergedParams.occasion) {
                            const occasionSuffixes = {
                                birthday: context.language === 'ru' ? ' 🎂 Отлично подходит для празднования дня рождения!' : ' 🎂 Perfect for a birthday celebration!',
                                anniversary: context.language === 'ru' ? ' 💕 Прекрасный выбор для вашей годовщины!' : ' 💕 Wonderful choice for your anniversary!',
                                business: context.language === 'ru' ? ' 💼 Отлично подходит для деловой встречи!' : ' 💼 Excellent for your business meeting!'
                            };
                            
                            const suffix = occasionSuffixes[mergedParams.occasion] || '';
                            if (suffix) {
                                localizedConfirmation += suffix;
                            }
                        }

                        // Add reservation details manually
                        if (bookingResult.data?.reservationId) {
                            const reservationDetail = context.language === 'ru' ? 
                                `\n📋 Бронь №${bookingResult.data.reservationId}` : 
                                `\n📋 Reservation #${bookingResult.data.reservationId}`;
                            localizedConfirmation += reservationDetail;
                        }

                        // 🚨 CRITICAL FIX: Manual table name extraction for fallback
                        if (bookingResult.data?.table) {
                            let fallbackTableName = '';
                            if (typeof bookingResult.data.table === 'string') {
                                fallbackTableName = bookingResult.data.table;
                            } else if (typeof bookingResult.data.table === 'object') {
                                fallbackTableName = bookingResult.data.table.Name || 
                                                  bookingResult.data.table.name || 
                                                  bookingResult.data.table.TableID || 
                                                  bookingResult.data.table.tableName || 
                                                  bookingResult.data.table.id ||
                                                  'Table';
                            }
                            
                            if (fallbackTableName) {
                                const tableDetail = context.language === 'ru' ? 
                                    ` за столиком ${fallbackTableName}` : 
                                    ` at table ${fallbackTableName}`;
                                // Insert table detail before the period
                                localizedConfirmation = localizedConfirmation.replace('.', `${tableDetail}.`);
                                console.log(`[SofiaAgent] 🚨 FALLBACK FIX: Added table "${fallbackTableName}" manually`);
                            }
                        }
                    }

                    console.log(`[SofiaAgent] 🎉 FINAL ENHANCED LOCALIZED CONFIRMATION (${context.language}):`, localizedConfirmation);

                    return {
                        content: localizedConfirmation, // ✅ ENHANCED LOCALIZED CONFIRMATION WITH DETAILS - [object Object] FIXED!
                        hasBooking: true,
                        reservationId: bookingResult.data?.reservationId,
                        toolCalls: [{
                            function: { name: 'create_reservation', arguments: JSON.stringify({
                                guestName: mergedParams.name,
                                guestPhone: mergedParams.phone,
                                date: mergedParams.date,
                                time: mergedParams.time,
                                guests: mergedParams.guests,
                                specialRequests: enhancedSpecialRequests
                            })},
                            id: 'create_reservation_validated',
                            result: bookingResult
                        }]
                    };
                } else {
                    // Localized failure message
                    const failureMessage = await this.translationService.translate(
                        `I'm sorry, I couldn't complete your reservation. ${bookingResult.error?.message || 'Please try again.'}`,
                        context.language,
                        'error'
                    );

                    return {
                        content: failureMessage,
                        toolCalls: [{
                            function: { name: 'create_reservation', arguments: JSON.stringify({
                                guestName: mergedParams.name,
                                guestPhone: mergedParams.phone,
                                date: mergedParams.date,
                                time: mergedParams.time,
                                guests: mergedParams.guests,
                                specialRequests: enhancedSpecialRequests
                            })},
                            id: 'create_reservation_validated',
                            result: bookingResult
                        }]
                    };
                }
            } catch (error) {
                console.error(`[SofiaAgent] Booking creation error:`, error);
                
                const errorMessage = await this.translationService.translate(
                    "I'm sorry, I encountered an issue creating your reservation. Please try again.",
                    context.language,
                    'error'
                );

                return {
                    content: errorMessage
                };
            }
        }

        // Fallback for general response
        const generalResponse = await this.translationService.translate(
            "I'm here to help you with your reservation. What would you like to know?",
            context.language,
            'question'
        );

        return {
            content: generalResponse
        };
    }

    /**
     * ✅ CRITICAL FIX: Enhanced main message processing with conversational memory
     * 🧠 CONFIRMATION BLINDNESS FIXED: AI now remembers previous questions
     * 🚨 DOUBLE GREETING FIXED: No more redundant greetings in follow-up questions
     */
    async processMessage(
        message: string, 
        context: AgentContext
    ): Promise<AgentResponse> {
        console.log(`[SofiaAgent] 🧠 Processing message with enhanced conversational intelligence: "${message}"`);

        try {
            // ✅ STEP 1: Guest history is now available from ConversationManager context
            const guestHistory = await this.fetchGuestHistoryIfNeeded(context);

            // ✅ CRITICAL FIX: Get the last assistant message for conversational memory
            const lastAssistantMessage = context.session.conversationHistory
                .filter(m => m.role === 'assistant')
                .pop()?.content;

            console.log(`[SofiaAgent] 🧠 Conversational memory: Last assistant message: "${lastAssistantMessage?.substring(0, 100) || 'None'}"`);

            // ✅ STEP 2: Extract with enhanced occasion detection and conversational memory
            const extracted = await this.extractBookingParameters(
                message, 
                context, 
                guestHistory, 
                lastAssistantMessage // ✅ CRITICAL FIX: Pass previous message for confirmation understanding
            );

            // ✅ STEP 3: MERGE EXTRACTED PARAMS WITH SESSION STATE (preserves context including occasion)
            const mergedParams = {
                ...context.session.gatheringInfo, // Start with what's already in the session
                // Overwrite with newly extracted values if they are not null/undefined
                ...(extracted.date && { date: extracted.date }),
                ...(extracted.time && { time: extracted.time }),
                ...(extracted.guests && { guests: extracted.guests }),
                ...(extracted.name && { name: extracted.name }),
                ...(extracted.phone && { phone: extracted.phone }),
                ...(extracted.specialRequests && { specialRequests: extracted.specialRequests }),
                ...(extracted.occasion && { occasion: extracted.occasion }), // 🆕 Include occasion
                // Carry over the user's immediate intent
                userIntent: extracted.userIntent 
            };

            console.log(`[SofiaAgent] 🧠 Merged parameters with conversational memory:`, {
                date: mergedParams.date,
                time: mergedParams.time,
                guests: mergedParams.guests,
                name: mergedParams.name,
                phone: mergedParams.phone,
                occasion: mergedParams.occasion, // 🆕 Enhanced logging
                userIntent: mergedParams.userIntent,
                conversationalMemoryUsed: !!lastAssistantMessage
            });

            // ✅ STEP 4: Validate parameters using the MERGED data
            const validation = this.validateRequiredParameters(mergedParams, context);

            // ✅ PRESERVED: Add specific logic for first-turn general greetings
            const isFirstTurn = context.session.conversationHistory.length <= 1;
            if (validation.nextAction === 'general_response' && isFirstTurn) {
                console.log(`[SofiaAgent] Handling first-turn general inquiry. Generating personalized greeting.`);
                
                // Generate a personalized, non-booking-focused greeting using prompt helper
                const greeting = SofiaGreetings.generatePersonalizedGreeting({
                    guestHistory: guestHistory,
                    language: context.language,
                    context: context.session.context,
                    restaurantConfig: this.restaurantConfig
                });

                return {
                    content: greeting
                };
            }

            // ✅ STEP 5: Route based on validation results
            if (validation.nextAction === 'ask_for_missing') {
                // Missing information - prompt user with personality layer (NO DOUBLE GREETING!)
                return await this.promptForMissingInfo(validation.missing, mergedParams, context);
            } else if (validation.nextAction === 'general_response') {
                // General inquiry on subsequent turns - simple response
                const response = await this.translationService.translate(
                    "I can help with new reservations. What date and time are you interested in?",
                    context.language,
                    'question'
                );
                return { content: response };
            } else {
                // All parameters validated - proceed with tools (includes enhanced localized confirmations - [object Object] FIXED!)
                return await this.processWithTools(mergedParams, validation, context);
            }

        } catch (error) {
            console.error(`[SofiaAgent] Error in processMessage:`, error);
            
            // Fallback to AI service if all else fails
            try {
                const fallbackResponse = await this.aiService.generateContent(
                    `As a booking agent, respond to: "${message}"`,
                    'booking'
                );
                
                return {
                    content: fallbackResponse,
                    toolCalls: []
                };
            } catch (fallbackError) {
                console.error(`[SofiaAgent] Fallback error:`, fallbackError);
                
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
    }

    // ✅ PRESERVED: Existing validation and tool methods
    private validateBookingTime(date: string, time: string): { 
        isValid: boolean; 
        isWithinHours: boolean; 
        reason?: string;
        suggestedTime?: string;
    } {
        if (!isValidTimezone(this.restaurantConfig.timezone)) {
            console.warn(`[SofiaAgent] Invalid restaurant timezone: ${this.restaurantConfig.timezone}`);
            return {
                isValid: false,
                isWithinHours: false,
                reason: 'Invalid restaurant timezone configuration'
            };
        }

        const validation = validateBookingDateTime(
            date,
            time,
            this.restaurantConfig.timezone,
            this.restaurantConfig.openingTime,
            this.restaurantConfig.closingTime
        );

        return {
            isValid: validation.isValid,
            isWithinHours: validation.isWithinHours,
            reason: validation.reason,
            suggestedTime: validation.suggestedTime
        };
    }

    private getOpenAITools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
        return [
            {
                type: "function",
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
                type: "function",
                function: {
                    name: "get_restaurant_info",
                    description: "Get information about the restaurant including timezone-aware operating hours",
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
                type: "function",
                function: {
                    name: "check_availability",
                    description: "Check if tables are available for specific date, time and party size with timezone validation",
                    parameters: {
                        type: "object",
                        properties: {
                            date: {
                                type: "string",
                                pattern: "^\\d{4}-\\d{2}-\\d{2}$",
                                description: "Date in YYYY-MM-DD format"
                            },
                            time: {
                                type: "string",
                                pattern: "^\\d{1,2}:\\d{2}$",
                                description: "Time in HH:MM format (24-hour) - validated against operating hours"
                            },
                            guests: {
                                type: "integer",
                                minimum: 1,
                                maximum: 50,
                                description: "Number of guests"
                            }
                        },
                        required: ["date", "time", "guests"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "find_alternative_times",
                    description: "Find alternative available times when preferred time is not available or outside operating hours",
                    parameters: {
                        type: "object",
                        properties: {
                            date: {
                                type: "string",
                                pattern: "^\\d{4}-\\d{2}-\\d{2}$",
                                description: "Date in YYYY-MM-DD format"
                            },
                            preferredTime: {
                                type: "string",
                                pattern: "^\\d{1,2}:\\d{2}$",
                                description: "Preferred time in HH:MM format"
                            },
                            guests: {
                                type: "integer",
                                minimum: 1,
                                maximum: 50,
                                description: "Number of guests"
                            }
                        },
                        required: ["date", "preferredTime", "guests"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "create_reservation",
                    description: "Create a new reservation with complete guest information and timezone validation. Special requests will include occasion context.",
                    parameters: {
                        type: "object",
                        properties: {
                            guestName: {
                                type: "string",
                                minLength: 2,
                                description: "Guest's full name"
                            },
                            guestPhone: {
                                type: "string",
                                pattern: "^[+]?[0-9\\s\\-\\(\\)]{7,}$",
                                description: "Guest's phone number"
                            },
                            date: {
                                type: "string",
                                pattern: "^\\d{4}-\\d{2}-\\d{2}$",
                                description: "Reservation date in YYYY-MM-DD format"
                            },
                            time: {
                                type: "string",
                                pattern: "^\\d{1,2}:\\d{2}$",
                                description: "Reservation time in HH:MM format - will be validated against operating hours"
                            },
                            guests: {
                                type: "integer",
                                minimum: 1,
                                maximum: 50,
                                description: "Number of guests"
                            },
                            specialRequests: {
                                type: "string",
                                description: "Any special requests or comments (may include occasion context)"
                            }
                        },
                        required: ["guestName", "guestPhone", "date", "time", "guests"]
                    }
                }
            }
        ];
    }

    private shouldRequireConfirmation(toolCalls: any[]): boolean {
        return toolCalls.some(call => 
            call.function.name === 'create_reservation' &&
            call.result?.tool_status === 'SUCCESS'
        );
    }

    private hasSuccessfulBooking(toolCalls: any[]): boolean {
        return toolCalls.some(call => 
            call.function.name === 'create_reservation' &&
            call.result?.tool_status === 'SUCCESS' &&
            call.result?.data?.success
        );
    }

    private extractReservationId(toolCalls: any[]): number | undefined {
        const successfulBooking = toolCalls.find(call => 
            call.function.name === 'create_reservation' &&
            call.result?.tool_status === 'SUCCESS' &&
            call.result?.data?.reservationId
        );
        
        return successfulBooking?.result?.data?.reservationId;
    }
}

export default SofiaAgent;