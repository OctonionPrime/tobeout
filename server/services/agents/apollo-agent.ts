// src/agents/apollo-agent.ts

import { BaseAgent, AgentContext, AgentResponse, AgentConfig, RestaurantConfig } from './base-agent';
import { agentTools } from './agent-tools';
import { DateTime } from 'luxon';
import { 
    getRestaurantDateTime, 
    getRestaurantTimeContext,
    isRestaurantOpen,
    getRestaurantOperatingStatus,
    formatRestaurantTime24Hour,
    isValidTimezone,
    isOvernightOperation
} from '../../utils/timezone-utils';

// Add Language type for comprehensive validation
export type Language = 'en' | 'ru' | 'sr' | 'hu' | 'de' | 'fr' | 'es' | 'it' | 'pt' | 'nl' | 'auto';

/**
 * Availability failure context interface
 */
interface AvailabilityFailureContext {
    originalDate: string;
    originalTime: string;
    originalGuests: number;
    failureReason: string;
    detectedAt: string;
    userPreferences?: {
        timeFlexibility: 'strict' | 'flexible' | 'very_flexible';
        preferredTimeRange: 'morning' | 'afternoon' | 'evening' | 'any';
        acceptsEarlier: boolean;
        acceptsLater: boolean;
    };
}

/**
 * Alternative time with scoring
 */
interface AlternativeTimeOption {
    date: string;
    time: string;
    availableGuests: number;
    table?: string;
    score: number;
    proximity: number; // Minutes from original time
    reason: string;
    timeOfDay: 'morning' | 'afternoon' | 'evening';
}


export class ApolloAgent extends BaseAgent {
    readonly name = 'Apollo';
    readonly description = 'Availability specialist for finding alternative booking times';
    readonly capabilities = [
        'find_alternative_times',
        'check_availability',
        'get_restaurant_info'
    ];

    // 🎯 INTELLIGENT: Time preference patterns for better suggestions
    private readonly timePreferencePatterns = {
        morning: { start: '08:00', end: '11:59', label: 'morning' },
        lunch: { start: '12:00', end: '15:59', label: 'afternoon' },
        dinner: { start: '16:00', end: '22:00', label: 'evening' },
        late: { start: '22:01', end: '23:59', label: 'late evening' }
    };

    constructor(config: AgentConfig, restaurantConfig: RestaurantConfig) {
        super(config, restaurantConfig);
        this.logAgentAction('Apollo Agent initialized - availability specialist ready with language enforcement', {
            agent: this.name,
            capabilities: this.capabilities,
            languageEnforcementEnabled: true // 🚨 NEW
        });
    }

    /**
     * Comprehensive language enforcement rules for Apollo agent
     * Prevents language mixing in availability recovery and alternative time presentation
     */
    private getLanguageEnforcementRules(language: Language): string {
        const languageNames: Record<Language, string> = {
            'en': 'English', 'ru': 'Russian', 'sr': 'Serbian', 'hu': 'Hungarian',
            'de': 'German', 'fr': 'French', 'es': 'Spanish', 'it': 'Italian',
            'pt': 'Portuguese', 'nl': 'Dutch', 'auto': 'English'
        };

        const currentLanguageName = languageNames[language] || 'English';
        
        return `🚨 CRITICAL APOLLO LANGUAGE ENFORCEMENT RULES:

**MANDATORY LANGUAGE**: You MUST respond ONLY in ${currentLanguageName}.

**FORBIDDEN ACTIONS**:
❌ NEVER switch languages mid-response
❌ NEVER mix languages in a single response  
❌ NEVER respond in English if conversation language is ${currentLanguageName}
❌ NEVER change language without explicit user request

**REQUIRED BEHAVIOR**:
✅ ALL responses must be in ${currentLanguageName}
✅ Maintain empathetic, solution-focused tone in ${currentLanguageName}
✅ Use natural expressions in ${currentLanguageName}
✅ Present availability alternatives in ${currentLanguageName}
✅ Facilitate booking handoffs in ${currentLanguageName}

**APOLLO-SPECIFIC LANGUAGE REQUIREMENTS**:
✅ Empathetic disappointment responses in ${currentLanguageName}
✅ Alternative time presentations in ${currentLanguageName}
✅ Availability explanations in ${currentLanguageName}
✅ Booking selection guidance in ${currentLanguageName}
✅ Handoff preparation messages in ${currentLanguageName}

Current conversation language: **${currentLanguageName}** (LOCKED)`;
    }

    /**
     * Language-specific availability specialist examples
     * Provides natural templates for availability recovery conversations in multiple languages
     */
    private getAvailabilityExamples(language: Language): string {
        const examples: Record<Language, string> = {
            'en': `
**APOLLO AVAILABILITY EXAMPLES IN ENGLISH:**

📋 **Empathetic Opening:**
User: "Is 7 PM available for 4 people tomorrow?"
Apollo: "I understand you're looking for 7 PM tomorrow for 4 guests. Let me check our availability and find you some excellent options!"

📋 **Alternative Presentation:**
Apollo: "I found some great alternatives close to your preferred 7 PM time:
• 6:30 PM - Just 30 minutes earlier, perfect for a relaxed start
• 7:30 PM - Prime dining time with excellent service
• 8:00 PM - Quieter atmosphere, ideal for intimate conversation
Which of these works best for you?"

📋 **Selection Guidance:**
User: "The 6:30 PM sounds good."
Apollo: "Perfect choice! 6:30 PM gives you a wonderful head start on the evening. Let me connect you with Sofia to complete your booking."

📋 **Handoff Signals:**
Apollo: "Excellent! I'm transferring you to Sofia who will finalize your reservation for 6:30 PM tomorrow for 4 guests."`,

            'ru': `
**ПРИМЕРЫ ДОСТУПНОСТИ APOLLO НА РУССКОМ:**

📋 **Понимающее начало:**
Пользователь: "Есть ли места на 19:00 завтра на 4 человека?"
Apollo: "Понимаю, что вы ищете время на 19:00 завтра на 4 гостей. Позвольте проверить наличие и найти отличные варианты!"

📋 **Презентация альтернатив:**
Apollo: "Нашел несколько отличных вариантов близко к желаемому времени 19:00:
• 18:30 - Всего на 30 минут раньше, отлично для спокойного начала
• 19:30 - Прайм-тайм для ужина с превосходным обслуживанием
• 20:00 - Более спокойная атмосфера, идеально для интимной беседы
Какой из этих вариантов вам больше подходит?"

📋 **Помощь в выборе:**
Пользователь: "18:30 звучит хорошо."
Apollo: "Отличный выбор! 18:30 даст вам прекрасное начало вечера. Соединяю с Софией для завершения бронирования."

📋 **Сигналы передачи:**
Apollo: "Превосходно! Передаю вас Софии, которая оформит вашу бронь на 18:30 завтра на 4 гостей."`,

            'sr': `
**PRIMERI DOSTUPNOSTI APOLLO NA SRPSKOM:**

📋 **Razumevajući početak:**
Korisnik: "Da li je dostupno u 19:00 sutra za 4 osobe?"
Apollo: "Razumem da tražite vreme u 19:00 sutra za 4 gosta. Dozvolite da proverim dostupnost i nađem odlične opcije!"

📋 **Prezentacija alternativa:**
Apollo: "Našao sam nekoliko odličnih opcija blizu vašeg željenog vremena 19:00:
• 18:30 - Samo 30 minuta ranije, savršeno za opušten početak
• 19:30 - Najbolje vreme za večeru sa odličnom uslugom
• 20:00 - Mirnija atmosfera, idealno za intimnu konverzaciju
Koja od ovih opcija vam najbolje odgovara?"

📋 **Pomoć u izboru:**
Korisnik: "18:30 zvuči dobro."
Apollo: "Odličan izbor! 18:30 vam omogućava divan početak večeri. Povezujem vas sa Sofijom da završi rezervaciju."

📋 **Signali prenosa:**
Apollo: "Odlično! Prebacujem vas na Sofiju koja će finalizovati vašu rezervaciju za 18:30 sutra za 4 gosta."`,

            'hu': `
**APOLLO ELÉRHETŐSÉG PÉLDÁK MAGYARUL:**

📋 **Megértő kezdés:**
Felhasználó: "Elérhető-e holnap 19:00-ra 4 főre?"
Apollo: "Értem, hogy holnap 19:00-ra keres helyet 4 vendégnek. Hadd nézzem meg az elérhetőséget és találjak kiváló opciókat!"

📋 **Alternatívák bemutatása:**
Apollo: "Találtam néhány nagyszerű opciót a kívánt 19:00-hoz közel:
• 18:30 - Csak 30 perccel korábban, tökéletes a nyugodt kezdéshez
• 19:30 - Prémium vacsoraidő kiváló kiszolgálással
• 20:00 - Csendesebb légkör, ideális intim beszélgetéshez
Melyik felel meg legjobban?"

📋 **Választási segítség:**
Felhasználó: "A 18:30 jól hangzik."
Apollo: "Tökéletes választás! A 18:30 csodálatos kezdetet ad az estének. Kapcsolom Sofiával a foglalás befejezéséhez."

📋 **Átadási jelek:**
Apollo: "Kiváló! Átirányítom Sofiához, aki véglegesíti a foglalását holnap 18:30-ra 4 vendégre."`,

            'de': `
**APOLLO VERFÜGBARKEITSBEISPIELE AUF DEUTSCH:**

📋 **Verständnisvoller Beginn:**
Benutzer: "Ist morgen um 19:00 für 4 Personen verfügbar?"
Apollo: "Ich verstehe, dass Sie morgen um 19:00 für 4 Gäste suchen. Lassen Sie mich die Verfügbarkeit prüfen und ausgezeichnete Optionen finden!"

📋 **Alternativpräsentation:**
Apollo: "Ich habe einige großartige Optionen nahe Ihrer gewünschten Zeit 19:00 gefunden:
• 18:30 - Nur 30 Minuten früher, perfekt für einen entspannten Start
• 19:30 - Prime-Time zum Abendessen mit ausgezeichnetem Service
• 20:00 - Ruhigere Atmosphäre, ideal für intime Gespräche
Welche Option passt am besten zu Ihnen?"

📋 **Auswahlhilfe:**
Benutzer: "18:30 klingt gut."
Apollo: "Perfekte Wahl! 18:30 gibt Ihnen einen wunderbaren Start in den Abend. Ich verbinde Sie mit Sofia für die Buchungsabwicklung."

📋 **Übergabesignale:**
Apollo: "Ausgezeichnet! Ich leite Sie an Sofia weiter, die Ihre Reservierung für morgen 18:30 für 4 Gäste finalisiert."`,

            'fr': `
**EXEMPLES DE DISPONIBILITÉ APOLLO EN FRANÇAIS:**

📋 **Début compréhensif:**
Utilisateur: "Y a-t-il de la place demain à 19h00 pour 4 personnes?"
Apollo: "Je comprends que vous cherchez demain à 19h00 pour 4 convives. Permettez-moi de vérifier la disponibilité et de trouver d'excellentes options!"

📋 **Présentation des alternatives:**
Apollo: "J'ai trouvé quelques excellentes options près de votre heure souhaitée 19h00:
• 18h30 - Seulement 30 minutes plus tôt, parfait pour un début détendu
• 19h30 - Heure de pointe pour le dîner avec un excellent service
• 20h00 - Atmosphère plus calme, idéale pour une conversation intime
Laquelle de ces options vous convient le mieux?"

📋 **Aide à la sélection:**
Utilisateur: "18h30 sonne bien."
Apollo: "Parfait choix! 18h30 vous donne un merveilleux début de soirée. Je vous connecte avec Sofia pour finaliser votre réservation."

📋 **Signaux de transfert:**
Apollo: "Excellent! Je vous transfère à Sofia qui finalisera votre réservation pour demain 18h30 pour 4 convives."`,

            'es': `
**EJEMPLOS DE DISPONIBILIDAD APOLLO EN ESPAÑOL:**

📋 **Comienzo comprensivo:**
Usuario: "¿Está disponible mañana a las 19:00 para 4 personas?"
Apollo: "Entiendo que busca mañana a las 19:00 para 4 huéspedes. ¡Permítame verificar la disponibilidad y encontrar excelentes opciones!"

📋 **Presentación de alternativas:**
Apollo: "Encontré algunas opciones excelentes cerca de su hora preferida 19:00:
• 18:30 - Solo 30 minutos antes, perfecto para un comienzo relajado
• 19:30 - Hora pico para cenar con excelente servicio
• 20:00 - Atmósfera más tranquila, ideal para conversación íntima
¿Cuál de estas opciones le funciona mejor?"

📋 **Guía de selección:**
Usuario: "18:30 suena bien."
Apollo: "¡Perfecta elección! 18:30 le da un maravilloso comienzo a la noche. Lo conecto con Sofia para completar su reserva."

📋 **Señales de transferencia:**
Apollo: "¡Excelente! Lo transfiero a Sofia quien finalizará su reserva para mañana 18:30 para 4 huéspedes."`,

            'it': `
**ESEMPI DI DISPONIBILITÀ APOLLO IN ITALIANO:**

📋 **Inizio comprensivo:**
Utente: "È disponibile domani alle 19:00 per 4 persone?"
Apollo: "Capisco che cerca domani alle 19:00 per 4 ospiti. Mi permetta di controllare la disponibilità e trovare ottime opzioni!"

📋 **Presentazione alternative:**
Apollo: "Ho trovato alcune ottime opzioni vicine al suo orario preferito 19:00:
• 18:30 - Solo 30 minuti prima, perfetto per un inizio rilassato
• 19:30 - Ora di punta per cenare con servizio eccellente
• 20:00 - Atmosfera più tranquilla, ideale per conversazione intima
Quale di queste opzioni le funziona meglio?"

📋 **Guida alla selezione:**
Utente: "18:30 suona bene."
Apollo: "Scelta perfetta! 18:30 le dà un meraviglioso inizio alla serata. La collego con Sofia per completare la prenotazione."

📋 **Segnali di trasferimento:**
Apollo: "Eccellente! La trasferisco a Sofia che finalizzerà la sua prenotazione per domani 18:30 per 4 ospiti."`,

            'pt': `
**EXEMPLOS DE DISPONIBILIDADE APOLLO EM PORTUGUÊS:**

📋 **Início compreensivo:**
Usuário: "Está disponível amanhã às 19:00 para 4 pessoas?"
Apollo: "Entendo que busca amanhã às 19:00 para 4 convidados. Permita-me verificar a disponibilidade e encontrar excelentes opções!"

📋 **Apresentação de alternativas:**
Apollo: "Encontrei algumas ótimas opções próximas ao seu horário preferido 19:00:
• 18:30 - Apenas 30 minutos antes, perfeito para um início relaxado
• 19:30 - Horário nobre para jantar com excelente serviço
• 20:00 - Atmosfera mais tranquila, ideal para conversa íntima
Qual dessas opções funciona melhor para você?"

📋 **Orientação de seleção:**
Usuário: "18:30 soa bem."
Apollo: "Escolha perfeita! 18:30 lhe dá um começo maravilhoso da noite. Vou conectá-lo com Sofia para completar sua reserva."

📋 **Sinais de transferência:**
Apollo: "Excelente! Estou transferindo você para Sofia que finalizará sua reserva para amanhã 18:30 para 4 convidados."`,

            'nl': `
**APOLLO BESCHIKBAARHEIDSVOORBEELDEN IN HET NEDERLANDS:**

📋 **Begripvolle start:**
Gebruiker: "Is morgen om 19:00 beschikbaar voor 4 personen?"
Apollo: "Ik begrijp dat u morgen om 19:00 zoekt voor 4 gasten. Laat me de beschikbaarheid controleren en uitstekende opties vinden!"

📋 **Alternatieven presentatie:**
Apollo: "Ik vond enkele geweldige opties dicht bij uw gewenste tijd 19:00:
• 18:30 - Slechts 30 minuten eerder, perfect voor een ontspannen start
• 19:30 - Prime time voor dineren met uitstekende service
• 20:00 - Rustigere sfeer, ideaal voor intiem gesprek
Welke van deze opties werkt het beste voor u?"

📋 **Selectiehulp:**
Gebruiker: "18:30 klinkt goed."
Apollo: "Perfecte keuze! 18:30 geeft u een prachtige start van de avond. Ik verbind u met Sofia om uw reservering te voltooien."

📋 **Overdracht signalen:**
Apollo: "Uitstekend! Ik draag u over aan Sofia die uw reservering voor morgen 18:30 voor 4 gasten zal afronden."`,

            'auto': `
**APOLLO AVAILABILITY EXAMPLES IN ENGLISH:**

📋 **Empathetic Opening:**
User: "Is 7 PM available for 4 people tomorrow?"
Apollo: "I understand you're looking for 7 PM tomorrow for 4 guests. Let me check our availability and find you some excellent options!"

📋 **Alternative Presentation:**
Apollo: "I found some great alternatives close to your preferred 7 PM time:
• 6:30 PM - Just 30 minutes earlier, perfect for a relaxed start
• 7:30 PM - Prime dining time with excellent service
• 8:00 PM - Quieter atmosphere, ideal for intimate conversation
Which of these works best for you?"

📋 **Selection Guidance:**
User: "The 6:30 PM sounds good."
Apollo: "Perfect choice! 6:30 PM gives you a wonderful head start on the evening. Let me connect you with Sofia to complete your booking."

📋 **Handoff Signals:**
Apollo: "Excellent! I'm transferring you to Sofia who will finalize your reservation for 6:30 PM tomorrow for 4 guests."`
        };

        return examples[language] || examples['en'];
    }

    /**
     * System prompt optimized for availability specialist role
     * Now includes comprehensive language enforcement
     */
    generateSystemPrompt(context: AgentContext): string {
        const { language, availabilityFailureContext } = context;

        // Enhanced language enforcement at the very beginning
        const languageEnforcementRules = this.getLanguageEnforcementRules(language);
        const availabilityExamples = this.getAvailabilityExamples(language);

        const dateContext = this.getRestaurantContext();
        const failureSection = this.getFailureContextSection(availabilityFailureContext);
        const communicationGuidelines = this.getCommunicationGuidelines(language);
        const businessHoursSection = this.getBusinessHoursSection();

        // Add language-specific conversation tracking
        this.logAgentAction('Apollo system prompt generated with language enforcement', {
            agent: this.name,
            conversationLanguage: language,
            hasFailureContext: !!availabilityFailureContext,
            purpose: 'availability_recovery',
            bugFixed: 'APOLLO_LANGUAGE_ENFORCEMENT'
        });

        return `${languageEnforcementRules}

You are Apollo, the availability specialist for ${this.restaurantConfig.name}.

🎯 YOUR SPECIALIZED ROLE: Availability Recovery Expert
When guests can't get their preferred time, you transform disappointment into opportunity by finding excellent alternatives.

🏪 RESTAURANT DETAILS:
- Name: ${this.restaurantConfig.name}
- Cuisine: ${this.restaurantConfig.cuisine || 'Excellent dining'}
- Hours: ${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime}
- Timezone: ${this.restaurantConfig.timezone}
${isOvernightOperation(this.restaurantConfig.openingTime || '09:00', this.restaurantConfig.closingTime || '23:00') ? 
  '- ⚠️ OVERNIGHT OPERATION: Open past midnight' : ''}

📅 CURRENT CONTEXT:
- TODAY: ${dateContext.currentDate} (${dateContext.dayOfWeek})
- TOMORROW: ${dateContext.tomorrowDate}
- Current time: ${dateContext.currentTime}
- Restaurant status: ${dateContext.isOpen ? 'OPEN 🟢' : 'CLOSED 🔴'}

${failureSection}

${communicationGuidelines}

${businessHoursSection}

🛠️ YOUR WORKFLOW:
1. **Acknowledge & Empathize**: Show understanding of their disappointment
2. **Immediate Action**: Call find_alternative_times with the failed parameters
3. **Smart Presentation**: Present alternatives ranked by proximity and preference
4. **Guide Selection**: Help them choose the best alternative
5. **Seamless Handoff**: Transfer back to Sofia for booking completion

${availabilityExamples}

🔧 TOOL USAGE:
- **find_alternative_times**: Use immediately with failure context parameters
- **check_availability**: Only if guest requests specific time verification
- **get_restaurant_info**: For business hours or location questions

🚨 CRITICAL RULES:
1. **NEVER** try to create bookings - you find alternatives only
2. **ALWAYS** use the failure context parameters for find_alternative_times
3. **PRESENT** max 3 alternatives to avoid overwhelming guest
4. **HANDOFF** to Sofia once guest chooses alternative
5. **BE EMPATHETIC** but solution-focused throughout

💡 CONVERSATION STYLE:
- **Understanding**: "I completely understand..."
- **Optimistic**: "I found some excellent options!"
- **Clear**: Present alternatives with specific benefits
- **Encouraging**: "This time is actually even better because..."
- **Professional**: Maintain expert availability specialist persona

🎯 SUCCESS METRICS:
- Guest feels heard and understood
- Alternatives are presented clearly and attractively
- Guest selects an alternative confidently
- Smooth handoff to Sofia for booking completion

Remember: ALL responses must be in the conversation language specified above. Provide natural, empathetic availability recovery while maintaining language consistency.`;
    }

    /**
     * 🚀 CRITICAL: Enhanced message handling with availability failure recovery
     * 🚨 ENHANCED: Now includes language-aware logging
     */
    async handleMessage(message: string, context: AgentContext): Promise<AgentResponse> {
        const startTime = Date.now();

        try {
            // 🚨 ENHANCED: Language-aware logging
            this.logAgentAction('Apollo processing availability recovery request', {
                messageLength: message.length,
                conversationLanguage: context.language,
                hasFailureContext: !!context.availabilityFailureContext,
                failureDetails: context.availabilityFailureContext,
                agent: this.name,
                purpose: 'availability_recovery'
            });

            // 🚨 CRITICAL: Check if we have failure context to work with
            if (!context.availabilityFailureContext) {
                this.logAgentAction('⚠️ Apollo activated without failure context - requesting clarification');
                
                const clarificationMessages = {
                    en: "I'm here to help find alternative times, but I need to know what time you were originally looking for. What date, time, and party size were you hoping for?",
                    ru: "Я здесь, чтобы помочь найти альтернативное время, но мне нужно знать, какое время вы изначально искали. Какие дата, время и количество гостей вас интересовали?",
                    sr: "Tu sam da pomognem da nađemo alternativno vreme, ali treba da znam koje vreme ste originalno tražili. Koji datum, vreme i broj gostiju ste želeli?",
                    hu: "Itt vagyok, hogy segítsek alternatív időpontot találni, de tudnom kell, milyen időpontra gondolt eredetileg. Milyen dátum, időpont és létszám érdekelte?",
                    de: "Ich bin hier, um alternative Zeiten zu finden, aber ich muss wissen, welche Zeit Sie ursprünglich wollten. Welches Datum, welche Uhrzeit und wie viele Gäste?",
                    fr: "Je suis là pour vous aider à trouver des heures alternatives, mais j'ai besoin de savoir quelle heure vous cherchiez initialement. Quelle date, heure et nombre d'invités?",
                    es: "Estoy aquí para ayudar a encontrar horarios alternativos, pero necesito saber qué hora buscaba originalmente. ¿Qué fecha, hora y número de huéspedes?",
                    it: "Sono qui per aiutare a trovare orari alternativi, ma ho bisogno di sapere che ora cercava originariamente. Quale data, ora e numero di ospiti?",
                    pt: "Estou aqui para ajudar a encontrar horários alternativos, mas preciso saber que horário você estava procurando originalmente. Que data, hora e número de convidados?",
                    nl: "Ik ben hier om alternatieve tijden te vinden, maar ik moet weten naar welke tijd u oorspronkelijk zocht. Welke datum, tijd en aantal gasten?",
                    auto: "I'm here to help find alternative times, but I need to know what time you were originally looking for. What date, time, and party size were you hoping for?"
                };

                const language = context.language || 'auto';
                const clarificationMessage = clarificationMessages[language] || clarificationMessages.auto;

                return {
                    content: clarificationMessage,
                    metadata: {
                        processedAt: new Date().toISOString(),
                        agentType: this.name,
                        confidence: 0.9,
                        processingTimeMs: Date.now() - startTime,
                        action: 'clarification_request',
                        reason: 'no_failure_context',
                        conversationLanguage: context.language, // 🚨 NEW: Track conversation language
                        languageEnforcementApplied: true // 🚨 NEW: Confirm language enforcement
                    }
                };
            }

            // Analyze user message for preferences
            const userPreferences = this.analyzeUserPreferences(message, context.language || 'en');
            
            // 🔧 Generate empathetic response with immediate action
            const systemPrompt = this.generateSystemPrompt(context);
            const enhancedPrompt = `${systemPrompt}

USER'S CURRENT MESSAGE: "${message}"

DETECTED USER PREFERENCES:
${JSON.stringify(userPreferences, null, 2)}

🚨 IMMEDIATE ACTION REQUIRED:
You MUST call find_alternative_times with the failure context parameters immediately.
After getting results, present the best alternatives empathetically and clearly.`;

            const response = await this.generateResponse(enhancedPrompt, message, {
                model: 'sonnet',
                context: 'apollo-availability-recovery',
                maxTokens: 1200,
                temperature: 0.7
            });

            // Language-aware success logging
            this.logAgentAction('Apollo response generated with language consistency', {
                processingTimeMs: Date.now() - startTime,
                conversationLanguage: context.language,
                agent: this.name,
                responseLength: response.length,
                userPreferences,
                failureContext: context.availabilityFailureContext,
                bugFixed: 'APOLLO_LANGUAGE_ENFORCEMENT'
            });

            return {
                content: response,
                metadata: {
                    processedAt: new Date().toISOString(),
                    agentType: this.name,
                    confidence: 0.95,
                    processingTimeMs: Date.now() - startTime,
                    action: 'availability_recovery',
                    userPreferences,
                    failureContext: context.availabilityFailureContext,
                    conversationLanguage: context.language, // Track conversation language
                    languageEnforcementApplied: true // 🚨 Confirm language enforcement
                }
            };

        } catch (error) {
            // Language-aware error logging
            this.logAgentAction('Apollo agent error with language context', {
                error: (error as Error).message,
                conversationLanguage: context.language,
                agent: this.name,
                purpose: 'availability_recovery'
            });
            
            return this.handleAgentError(error as Error, 'handleMessage', message);
        }
    }

    /**
     * Analyze user message for time preferences
     */
    private analyzeUserPreferences(message: string, language: string): any {
        const lowerMessage = message.toLowerCase();
        
        const preferences = {
            timeFlexibility: 'flexible' as 'strict' | 'flexible' | 'very_flexible',
            preferredTimeRange: 'any' as 'morning' | 'afternoon' | 'evening' | 'any',
            acceptsEarlier: true,
            acceptsLater: true,
            specificRequests: [] as string[]
        };

        // Analyze flexibility indicators
        const strictIndicators = ['exact', 'only', 'specifically', 'precisely', 'exactly'];
        const veryFlexibleIndicators = ['any', 'whatever', 'anything', 'flexible', 'open'];
        
        if (strictIndicators.some(indicator => lowerMessage.includes(indicator))) {
            preferences.timeFlexibility = 'strict';
        } else if (veryFlexibleIndicators.some(indicator => lowerMessage.includes(indicator))) {
            preferences.timeFlexibility = 'very_flexible';
        }

        // Analyze time range preferences
        if (lowerMessage.includes('morning') || lowerMessage.includes('утром') || lowerMessage.includes('jutro')) {
            preferences.preferredTimeRange = 'morning';
        } else if (lowerMessage.includes('afternoon') || lowerMessage.includes('днем') || lowerMessage.includes('popodne')) {
            preferences.preferredTimeRange = 'afternoon';
        } else if (lowerMessage.includes('evening') || lowerMessage.includes('dinner') || lowerMessage.includes('вечер') || lowerMessage.includes('večer')) {
            preferences.preferredTimeRange = 'evening';
        }

        // Analyze directional preferences
        if (lowerMessage.includes('earlier') || lowerMessage.includes('раньше') || lowerMessage.includes('ranije')) {
            preferences.acceptsLater = false;
        } else if (lowerMessage.includes('later') || lowerMessage.includes('позже') || lowerMessage.includes('kasnije')) {
            preferences.acceptsEarlier = false;
        }

        // Extract specific requests
        const specificRequests = [];
        if (lowerMessage.includes('quiet') || lowerMessage.includes('тихо') || lowerMessage.includes('tiho')) {
            specificRequests.push('quiet_table');
        }
        if (lowerMessage.includes('window') || lowerMessage.includes('окно') || lowerMessage.includes('prozor')) {
            specificRequests.push('window_table');
        }
        preferences.specificRequests = specificRequests;

        return preferences;
    }

    /**
     * Get failure context section for system prompt
     */
    private getFailureContextSection(failureContext?: AvailabilityFailureContext): string {
        if (!failureContext) {
            return `
🚨 NO FAILURE CONTEXT:
- Apollo activated without availability failure context
- Request clarification from guest about their original preferences
- Do not proceed with find_alternative_times without proper context`;
        }

        return `
🚨 AVAILABILITY FAILURE CONTEXT:
- Original Request: ${failureContext.originalDate} at ${failureContext.originalTime} for ${failureContext.originalGuests} guests
- Failure Reason: ${failureContext.failureReason}
- Detected At: ${failureContext.detectedAt}
- Your Mission: Find excellent alternatives near ${failureContext.originalTime}

🎯 PARAMETERS FOR find_alternative_times:
- date: "${failureContext.originalDate}"
- preferredTime: "${failureContext.originalTime}"
- guests: ${failureContext.originalGuests}

You MUST use these exact parameters when calling find_alternative_times.`;
    }

    /**
     * Communication guidelines for empathetic responses
     */
    private getCommunicationGuidelines(language: Language): string {
        const guidelines = {
            en: `
🗣️ COMMUNICATION STYLE (English):
- **Empathetic Opening**: "I understand that ${this.restaurantConfig.openingTime} doesn't work..."
- **Optimistic Transition**: "But I have some excellent alternatives!"
- **Clear Presentation**: "Here are 3 great options close to your preferred time:"
- **Benefit Highlighting**: "This time is actually perfect because..."
- **Selection Guidance**: "Which of these works best for you?"
- **Handoff Preparation**: "Perfect! Let me connect you with Sofia to complete your booking."`,

            ru: `
🗣️ СТИЛЬ ОБЩЕНИЯ (Русский):
- **Понимающее начало**: "Понимаю, что это время не подходит..."
- **Оптимистичный переход**: "Но у меня есть отличные альтернативы!"
- **Четкая презентация**: "Вот 3 хороших варианта близко к желаемому времени:"
- **Подчеркивание преимуществ**: "Это время даже лучше, потому что..."
- **Помощь в выборе**: "Какой из этих вариантов вам больше подходит?"
- **Подготовка к передаче**: "Отлично! Передаю вас Софии для завершения бронирования."`,

            sr: `
🗣️ STIL KOMUNIKACIJE (Srpski):
- **Razumevajući početak**: "Razumem da to vreme ne odgovara..."
- **Optimistični prelaz**: "Ali imam odlične alternative!"
- **Jasna prezentacija**: "Evo 3 odlične opcije blizu željenog vremena:"
- **Isticanje prednosti**: "Ovo vreme je zapravo još bolje jer..."
- **Pomoć u izboru**: "Koja od ovih opcija vam najbolje odgovara?"
- **Priprema za predaju**: "Savršeno! Prebacujem vas na Sofiju da završi rezervaciju."`,

            auto: `
🗣️ COMMUNICATION STYLE (Auto-detect):
- **Empathetic Opening**: Acknowledge disappointment warmly
- **Optimistic Transition**: Present alternatives as opportunities
- **Clear Presentation**: Max 3 options with specific benefits
- **Benefit Highlighting**: Explain why alternatives are good
- **Selection Guidance**: Help guest choose confidently
- **Handoff Preparation**: Smooth transition to Sofia`
        };

        return guidelines[language] || guidelines.auto;
    }

    /**
     * Business hours section with availability context
     */
    private getBusinessHoursSection(): string {
        const openingTime = this.restaurantConfig.openingTime || '09:00';
        const closingTime = this.restaurantConfig.closingTime || '23:00';
        const isOvernight = isOvernightOperation(openingTime, closingTime);

        return `
🕐 AVAILABILITY EXPERTISE:
- Operating Hours: ${openingTime} - ${closingTime}${isOvernight ? ' (next day)' : ''}
- Peak Times: Usually 19:00-21:00 (busiest)
- Quiet Times: Early evening 17:00-18:30, late 21:30+
- Weekend Patterns: Busier, book earlier times
${isOvernight ? '- Late Night Advantage: Open until ' + closingTime + ' - great for late diners!' : ''}

💡 ALTERNATIVE BENEFITS TO HIGHLIGHT:
- **Earlier Times**: "More relaxed atmosphere, better service attention"
- **Later Times**: "Quieter, perfect for intimate conversations"
- **Different Days**: "Better availability, same great experience"
- **Peak Avoidance**: "Skip the rush, enjoy a calmer evening"`;
    }

    /**
     * Get restaurant context for date/time awareness
     */
    private getRestaurantContext() {
        try {
            const timezone = this.restaurantConfig.timezone;
            const restaurantContext = getRestaurantTimeContext(timezone);
            const operatingStatus = getRestaurantOperatingStatus(
                timezone,
                this.restaurantConfig.openingTime || '09:00',
                this.restaurantConfig.closingTime || '23:00'
            );

            return {
                currentDate: restaurantContext.todayDate,
                tomorrowDate: restaurantContext.tomorrowDate,
                currentTime: restaurantContext.displayName,
                dayOfWeek: restaurantContext.dayOfWeek,
                isOpen: operatingStatus.isOpen
            };
        } catch (error) {
            // Fallback to system time if timezone utils fail
            const now = DateTime.now();
            return {
                currentDate: now.toISODate(),
                tomorrowDate: now.plus({ days: 1 }).toISODate(),
                currentTime: now.toFormat('HH:mm'),
                dayOfWeek: now.toFormat('cccc'),
                isOpen: true
            };
        }
    }

    /**
     * Available tools for Apollo agent
     */
    getTools() {
        return agentTools.filter(tool =>
            this.capabilities.includes(tool.function.name)
        );
    }

    /**
     * Score alternative times based on proximity and preferences
     */
    private scoreAlternative(
        alternative: any,
        originalTime: string,
        userPreferences: any
    ): AlternativeTimeOption {
        const originalHour = parseInt(originalTime.split(':')[0]);
        const originalMinute = parseInt(originalTime.split(':')[1]);
        const altHour = parseInt(alternative.time.split(':')[0]);
        const altMinute = parseInt(alternative.time.split(':')[1]);

        // Calculate proximity in minutes
        const proximityMinutes = Math.abs(
            (altHour * 60 + altMinute) - (originalHour * 60 + originalMinute)
        );

        // Base score starts high and decreases with distance
        let score = 100 - (proximityMinutes / 10);

        // Bonus for matching time range preferences
        const altTimeOfDay = this.getTimeOfDay(alternative.time);
        if (userPreferences.preferredTimeRange === altTimeOfDay) {
            score += 20;
        }

        // Penalty for violating directional preferences
        if (!userPreferences.acceptsEarlier && altHour < originalHour) {
            score -= 30;
        }
        if (!userPreferences.acceptsLater && altHour > originalHour) {
            score -= 30;
        }

        // Bonus for popular/good times
        if (altHour >= 18 && altHour <= 20) {
            score += 10; // Prime dinner time
        }

        return {
            date: alternative.date,
            time: alternative.time,
            availableGuests: alternative.availableGuests || alternative.guests,
            table: alternative.table,
            score: Math.max(0, score),
            proximity: proximityMinutes,
            reason: this.generateAlternativeReason(alternative.time, proximityMinutes),
            timeOfDay: altTimeOfDay
        };
    }

    /**
     * Determine time of day category
     */
    private getTimeOfDay(time: string): 'morning' | 'afternoon' | 'evening' {
        const hour = parseInt(time.split(':')[0]);
        
        if (hour < 12) return 'morning';
        if (hour < 17) return 'afternoon';
        return 'evening';
    }

    /**
     * Generate reason why an alternative time is good
     */
    private generateAlternativeReason(time: string, proximityMinutes: number): string {
        const hour = parseInt(time.split(':')[0]);
        
        if (proximityMinutes <= 30) {
            return 'Very close to your preferred time';
        } else if (hour >= 17 && hour <= 18) {
            return 'Early dinner - quieter, more intimate';
        } else if (hour >= 21) {
            return 'Late dinner - perfect for a relaxed evening';
        } else if (hour >= 12 && hour <= 14) {
            return 'Lunch time - great for a midday meal';
        } else {
            return 'Available with good service';
        }
    }

    /**
     * Legacy method support for system integration
     */
    updateInstructions(
        context: string, 
        language: Language, 
        guestHistory?: any | null, 
        isFirstMessage?: boolean, 
        conversationContext?: any
    ): string {
        return this.generateSystemPrompt({
            restaurantId: this.restaurantConfig.id,
            timezone: this.restaurantConfig.timezone,
            language,
            availabilityFailureContext: conversationContext?.availabilityFailureContext
        });
    }

    /**
     * Legacy greeting method
     */
    getPersonalizedGreeting(
        guestHistory: any | null, 
        language: Language, 
        context: 'hostess' | 'guest', 
        conversationContext?: any
    ): string {
        const greetings = {
            en: "I understand your preferred time isn't available, but I'm here to find you some excellent alternatives! Let me check what we have...",
            ru: "Понимаю, что желаемое время недоступно, но я здесь, чтобы найти отличные альтернативы! Давайте посмотрим, что у нас есть...",
            sr: "Razumem da željeno vreme nije dostupno, ali tu sam da nađem odlične alternative! Hajde da vidimo šta imamo...",
            hu: "Értem, hogy a kívánt időpont nem elérhető, de itt vagyok, hogy kiváló alternatívákat találjak! Nézzük meg, mit tudunk ajánlani...",
            de: "Ich verstehe, dass Ihre bevorzugte Zeit nicht verfügbar ist, aber ich bin hier, um Ihnen ausgezeichnete Alternativen zu finden! Schauen wir mal...",
            fr: "Je comprends que votre heure préférée n'est pas disponible, mais je suis là pour vous trouver d'excellentes alternatives! Voyons ce que nous avons...",
            es: "Entiendo que su hora preferida no está disponible, pero estoy aquí para encontrarle excelentes alternativas! Veamos qué tenemos...",
            it: "Capisco che il suo orario preferito non è disponibile, ma sono qui per trovarle ottime alternative! Vediamo cosa abbiamo...",
            pt: "Entendo que seu horário preferido não está disponível, mas estou aqui para encontrar excelentes alternativas! Vamos ver o que temos...",
            nl: "Ik begrijp dat uw gewenste tijd niet beschikbaar is, maar ik ben hier om uitstekende alternatieven te vinden! Laten we kijken wat we hebben...",
            auto: "I understand your preferred time isn't available, but I'm here to find you some excellent alternatives! Let me check what we have..."
        };

        return greetings[language] || greetings.auto;
    }
}

export default ApolloAgent;
