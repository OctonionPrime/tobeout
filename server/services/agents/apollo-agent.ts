// src/agents/apollo-agent.ts
// 🚀 PRODUCTION-READY: Apollo Availability Agent - Complete Implementation
// ✅ CRITICAL FIX: Missing availability agent that's referenced throughout the system
// ✅ INTEGRATED: Seamless integration with fixed enhanced-conversation-manager.ts
// ✅ OPTIMIZED: Intelligent alternative time finding with user preference analysis
// ✅ MULTILINGUAL: Full support for all system languages with contextual responses
// ✅ PROFESSIONAL: Production-grade error handling and comprehensive logging

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
import type { Language } from '../enhanced-conversation-manager';

/**
 * 🔧 ENHANCED: Availability failure context interface
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
 * 🔧 ENHANCED: Alternative time with scoring
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

/**
 * 🚀 PRODUCTION-READY: Apollo Agent - Availability Specialist
 * 
 * Apollo is the availability specialist agent that handles situations when
 * the preferred booking time is not available. It finds and presents
 * alternative times intelligently based on user preferences and context.
 * 
 * Core Responsibilities:
 * 1. Analyze availability failures and understand user preferences
 * 2. Find alternative times near the requested slot
 * 3. Present alternatives in an intelligent, user-friendly way
 * 4. Handle user selection and prepare for booking handoff
 * 5. Provide empathetic communication during disappointment
 */
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
        this.logAgentAction('Apollo Agent initialized - availability specialist ready');
    }

    /**
     * 🔧 PRODUCTION-READY: System prompt optimized for availability specialist role
     */
    generateSystemPrompt(context: AgentContext): string {
        const { language, availabilityFailureContext } = context;

        const dateContext = this.getRestaurantContext();
        const failureSection = this.getFailureContextSection(availabilityFailureContext);
        const communicationGuidelines = this.getCommunicationGuidelines(language);
        const businessHoursSection = this.getBusinessHoursSection();

        const languageInstruction = `🌍 LANGUAGE: Respond in ${language} with empathetic, solution-focused tone.`;

        return `You are Apollo, the availability specialist for ${this.restaurantConfig.name}.

${languageInstruction}

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

🎯 CRITICAL SUCCESS PATTERNS:

**EMPATHETIC OPENING:**
- English: "I understand that time doesn't work, but I have some great alternatives!"
- Russian: "Понимаю, это время не подходит, но у меня есть отличные варианты!"
- Serbian: "Razumem da to vreme ne odgovara, ali imam odlične alternative!"

**SOLUTION PRESENTATION:**
- Present 2-3 best alternatives maximum
- Explain why each time is good (proximity, popular time, etc.)
- Use clear formatting with times, dates, and benefits

**HANDOFF SIGNALS:**
When guest selects an alternative, use these phrases:
- "Perfect choice! Let me connect you with Sofia to complete your booking."
- "Отличный выбор! Передаю вас Софии для завершения бронирования."
- "Odličan izbor! Prebacujem vas na Sofiju da završi rezervaciju."

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
- Smooth handoff to Sofia for booking completion`;
    }

    /**
     * 🚀 CRITICAL: Enhanced message handling with availability failure recovery
     */
    async handleMessage(message: string, context: AgentContext): Promise<AgentResponse> {
        const startTime = Date.now();

        try {
            this.logAgentAction('Apollo processing availability recovery request', {
                messageLength: message.length,
                language: context.language,
                hasFailureContext: !!context.availabilityFailureContext,
                failureDetails: context.availabilityFailureContext
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
                        reason: 'no_failure_context'
                    }
                };
            }

            // 🎯 INTELLIGENT: Analyze user message for preferences
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

            const response = await this.generateResponse(enhancedPrompt, {
                model: 'sonnet',
                context: 'apollo-availability-recovery',
                maxTokens: 1200,
                temperature: 0.7
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
                    failureContext: context.availabilityFailureContext
                }
            };

        } catch (error) {
            return this.handleAgentError(error as Error, 'handleMessage', message);
        }
    }

    /**
     * 🔍 INTELLIGENT: Analyze user message for time preferences
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
     * 🔧 ENHANCED: Get failure context section for system prompt
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
     * 🗣️ MULTILINGUAL: Communication guidelines for empathetic responses
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
     * 📅 ENHANCED: Business hours section with availability context
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
     * 🔧 ENHANCED: Get restaurant context for date/time awareness
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
     * 🔧 GET: Available tools for Apollo agent
     */
    getTools() {
        return agentTools.filter(tool =>
            this.capabilities.includes(tool.function.name)
        );
    }

    /**
     * 🎯 INTELLIGENT: Score alternative times based on proximity and preferences
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
     * 🕐 HELPER: Determine time of day category
     */
    private getTimeOfDay(time: string): 'morning' | 'afternoon' | 'evening' {
        const hour = parseInt(time.split(':')[0]);
        
        if (hour < 12) return 'morning';
        if (hour < 17) return 'afternoon';
        return 'evening';
    }

    /**
     * 💡 HELPER: Generate reason why an alternative time is good
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
     * 🔧 COMPATIBILITY: Legacy method support for system integration
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
     * 🔧 COMPATIBILITY: Legacy greeting method
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