// server/services/enhanced-conversation-manager.ts

import OpenAI from 'openai';
import { createBookingAgent, type BookingSession, createBookingSession, updateSessionInfo, hasCompleteBookingInfo } from './agents/booking-agent';
import { agentFunctions } from './agents/agent-tools';
import { storage } from '../storage';
import { runGuardrails, requiresConfirmation, type GuardrailResult } from './guardrails';
import type { Restaurant } from '@shared/schema';
import { DateTime } from 'luxon';

export type Language = 'en' | 'ru' | 'sr';
export type AgentType = 'booking' | 'reservations';

/**
 * Enhanced conversation manager with guardrails, intelligent name clarification, and Maya agent
 * ✅ ENHANCED: Multi-agent support with Sofia (booking) and Maya (reservations)
 * ✅ NEW: Smart agent detection with fuzzy matching + LLM fallback
 */
export class EnhancedConversationManager {
  private sessions = new Map<string, BookingSessionWithAgent>();
  private agents = new Map<string, any>();
  private sessionCleanupInterval: NodeJS.Timeout;
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    this.sessionCleanupInterval = setInterval(() => {
      this.cleanupOldSessions();
    }, 60 * 60 * 1000);

    console.log('[EnhancedConversationManager] Initialized with Sofia (booking) + Maya (reservations) agents');
  }

  /**
   * ✅ NEW: Enhanced agent detection with fuzzy matching and LLM fallback
   */
  private async detectAgentType(message: string, currentAgent?: AgentType): Promise<AgentType> {
    const normalizedMessage = message.toLowerCase();
    
    // ===== LAYER 1: EXACT KEYWORD MATCHING (FREE, INSTANT) =====
    
    // ✅ EXPANDED: More comprehensive reservation keywords including common typos
    const reservationKeywords = [
        // English
        'change', 'modify', 'update', 'cancel', 'existing reservation',
        'booked already', 'move reservation', 'different time', 'more people',
        'fewer people', 'less people', 'add people', 'reduce', 'increase',
        'special request', 'dietary requirement', 'anniversary', 'birthday',
        'my reservation', 'our reservation', 'confirmation number',
        'i have a reservation', 'we have a reservation', 'my booking', 'our booking',
        'reschedule', 'postpone', 'shift time', 'earlier', 'later',
        
        // Russian - expanded with common variations and typos
        'изменить', 'отменить', 'уже забронировал', 'другое время', 'моё бронирование',
        'наше бронирование', 'изменить бронь', 'отменить бронь',
        'поменять', 'перенести', 'поиенять', 'паменять', 'поенять', // ✅ Common typos
        'сдвинуть', 'перенос', 'изменение', 'отмена', 'измнить', 'отмнить',
        'моя бронь', 'наша бронь', 'бронирование на', 'забронировано',
        'раньше', 'позже', 'другой день', 'другая дата', 'надо изменить',
        'надо поменять', 'надо перенести', 'хочу изменить', 'хочу поменять',
        
        // Serbian
        'promeniti', 'otkazati', 'već rezervisao', 'drugo vreme', 'moja rezervacija',
        'naša rezervacija', 'promeniti rezervaciju', 'otkazati rezervaciju',
        'pomeriti', 'preneti', 'ranije', 'kasnije'
    ];
    
    // ✅ STRONG indicators that override other detection
    const strongReservationIndicators = [
        'i need to change', 'i want to change', 'can i change',
        'i need to cancel', 'i want to cancel', 'can i cancel',
        'i have a reservation', 'we have a reservation',
        'existing booking', 'current booking', 'booked for tonight',
        'booked for tomorrow', 'already booked', 'confirmation',
        // Russian
        'мне нужно изменить', 'хочу изменить', 'могу ли изменить',
        'мне нужно отменить', 'хочу отменить', 'могу ли отменить',
        'у меня есть бронь', 'у нас есть бронь', 'уже забронировано',
        'надо изменить', 'надо поменять', 'надо перенести',
        // Serbian
        'treba da promenim', 'želim da promenim', 'mogu li da promenim',
        'treba da otkazujem', 'želim da otkazujem', 'mogu li da otkazujem',
        'imam rezervaciju', 'imamo rezervaciju', 'već rezervisano'
    ];
    
    // Check strong indicators first (highest priority)
    if (strongReservationIndicators.some(indicator => normalizedMessage.includes(indicator))) {
        console.log(`[ConversationManager] 🎯 Strong reservation indicator detected: switching to Maya`);
        return 'reservations';
    }
    
    // Check exact keyword matches
    if (reservationKeywords.some(keyword => normalizedMessage.includes(keyword))) {
        console.log(`[ConversationManager] 📝 Reservation keyword detected: switching to Maya`);
        return 'reservations';
    }
    
    // ===== LAYER 2: FUZZY PATTERN MATCHING (FREE, INSTANT) =====
    
    const fuzzyReservationPatterns = [
        /по\w*менять/i,  // поменять, поиенять, поенять, etc.
        /изм\w*нить/i,   // изменить, измнить, etc.
        /перен\w*сти/i,  // перенести, перенсти, etc.
        /отм\w*нить/i,   // отменить, отмнить, etc.
        /ch\w*nge/i,     // change, chnge, etc.
        /mod\w*fy/i,     // modify, modfy, etc.
        /canc\w*l/i,     // cancel, cancl, etc.
        /резерв\w*/i,    // резервация, резерв, etc.
        /бронир\w*/i,    // бронирование, бронир, etc.
    ];
    
    if (fuzzyReservationPatterns.some(pattern => pattern.test(normalizedMessage))) {
        console.log(`[ConversationManager] 🔍 Fuzzy reservation pattern detected: switching to Maya`);
        return 'reservations';
    }
    
    // ===== LAYER 3: LLM FALLBACK FOR AMBIGUOUS CASES (CHEAP, SMART) =====
    
    // Only use LLM for ambiguous cases that passed layers 1-2 but need intelligent analysis
    const isAmbiguous = this.isAmbiguousMessage(normalizedMessage, currentAgent);
    
    if (isAmbiguous) {
        console.log(`[ConversationManager] 🤖 Using LLM fallback for ambiguous message: "${message}"`);
        
        try {
            const agentType = await this.llmAgentDetection(message, currentAgent);
            if (agentType) {
                console.log(`[ConversationManager] 🎯 LLM detected agent: ${agentType}`);
                return agentType;
            }
        } catch (error) {
            console.error(`[ConversationManager] LLM agent detection failed:`, error);
            // Fall through to default logic
        }
    }
    
    // ===== FALLBACK: DEFAULT LOGIC =====
    
    // Number + context detection (like "1" after asking for confirmation number)
    if (/^\d{1,6}$/.test(normalizedMessage.trim()) && currentAgent === 'reservations') {
        console.log(`[ConversationManager] 🔢 Number detected in reservations context: staying with Maya`);
        return 'reservations';
    }
    
    // Sofia (Booking) keywords for new reservations
    const bookingKeywords = [
        'book', 'reserve', 'new reservation', 'table', 'available', 'tonight', 
        'tomorrow', 'first time', 'make a reservation', 'book a table',
        // Russian
        'забронировать', 'новое бронирование', 'столик', 'свободно',
        'сегодня вечером', 'завтра', 'впервые', 'забронировать столик',
        // Serbian
        'rezervisati', 'nova rezervacija', 'sto', 'dostupno',
        'večeras', 'sutra', 'prvi put', 'rezervisati sto'
    ];
    
    // Only switch to booking if explicitly mentioned and no current agent
    if (bookingKeywords.some(keyword => normalizedMessage.includes(keyword)) && !currentAgent) {
        console.log(`[ConversationManager] 📅 Booking keyword detected: using Sofia`);
        return 'booking';
    }
    
    // Continue with current agent if exists, otherwise default to Sofia
    if (currentAgent) {
        console.log(`[ConversationManager] ➡️ Continuing with current agent: ${currentAgent}`);
        return currentAgent;
    }
    
    console.log(`[ConversationManager] 🏠 Default to Sofia for new conversations`);
    return 'booking';
  }

  /**
   * ✅ NEW: Detect if message is ambiguous and needs LLM analysis
   */
  private isAmbiguousMessage(normalizedMessage: string, currentAgent?: AgentType): boolean {
    // Messages that are clearly context-dependent and benefit from LLM
    const ambiguousPatterns = [
        // Very short messages that could mean anything
        /^[а-яё]{1,3}$/i,  // Russian 1-3 letter words
        /^[a-z]{1,2}$/i,   // English 1-2 letter words
        /^\d{1,2}$/,       // Just numbers
        
        // Unclear intent
        /время/i,          // "время" could be asking time or changing time
        /когда/i,          // "когда" could be asking when open or when is my booking
        /помочь/i,         // "помочь" is generic help request
        /можно/i,          // "можно" is generic "can I"
        
        // Messages with typos that fuzzy didn't catch
        /[а-яё]{4,}.*[а-яё]{4,}/i, // Longer Russian text that might have complex typos
    ];
    
    const isShort = normalizedMessage.trim().length < 10;
    const hasAmbiguousPattern = ambiguousPatterns.some(pattern => pattern.test(normalizedMessage));
    const hasCurrentAgent = !!currentAgent;
    
    // Use LLM if message is ambiguous AND we have context to work with
    return (isShort || hasAmbiguousPattern) && hasCurrentAgent;
  }

  /**
   * ✅ NEW: LLM-based agent detection for ambiguous cases
   */
  private async llmAgentDetection(message: string, currentAgent?: AgentType): Promise<AgentType | null> {
    try {
        const prompt = `You are an expert classifier for a restaurant booking system. The system has two specialized agents:

1. SOFIA (booking) - Handles NEW reservations, table availability, making new bookings
2. MAYA (reservations) - Handles EXISTING reservations, modifications, cancellations

Current agent: ${currentAgent || 'none'}
User message: "${message}"

Based on the message, which agent should handle this request? Consider:
- Does the user want to make a NEW booking? → Sofia
- Does the user want to modify/cancel/change an EXISTING booking? → Maya
- Is the message unclear or just a greeting? → Continue with current agent

Respond with ONLY: "booking", "reservations", or "continue"`;

        const completion = await this.client.chat.completions.create({
            model: "gpt-4o-mini", // Cheap and fast
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.0,
            max_tokens: 10
        });

        const result = completion.choices[0]?.message?.content?.trim().toLowerCase();
        
        if (result === 'booking') return 'booking';
        if (result === 'reservations') return 'reservations';
        if (result === 'continue' && currentAgent) return currentAgent;
        
        return null; // Fall back to default logic
        
    } catch (error) {
        console.error('[ConversationManager] LLM agent detection error:', error);
        return null;
    }
  }

  /**
   * ✅ NEW: Get tools for specific agent type
   */
  private getToolsForAgent(agentType: AgentType) {
    const baseTools = [
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
        }
    ];

    if (agentType === 'reservations') {
        // Maya's tools for reservation management
        return [
            ...baseTools,
            {
                type: "function" as const,
                function: {
                    name: "find_existing_reservation",
                    description: "Find guest's existing reservations by phone, name, or confirmation number",
                    parameters: {
                        type: "object",
                        properties: {
                            identifier: {
                                type: "string",
                                description: "Phone number, guest name, or confirmation number to search by"
                            },
                            identifierType: {
                                type: "string",
                                enum: ["phone", "telegram", "name", "confirmation"],
                                description: "Type of identifier being used (auto-detected if not specified)"
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
                    description: "Modify details of an existing reservation (time, date, party size, special requests)",
                    parameters: {
                        type: "object",
                        properties: {
                            reservationId: {
                                type: "number",
                                description: "ID of the reservation to modify"
                            },
                            modifications: {
                                type: "object",
                                properties: {
                                    newDate: {
                                        type: "string",
                                        description: "New date in YYYY-MM-DD format (optional)"
                                    },
                                    newTime: {
                                        type: "string",
                                        description: "New time in HH:MM format (optional)"
                                    },
                                    newGuests: {
                                        type: "number",
                                        description: "New number of guests (optional)"
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
                        required: ["reservationId", "modifications"]
                    }
                }
            },
            {
                type: "function" as const,
                function: {
                    name: "cancel_reservation",
                    description: "Cancel an existing reservation",
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
                        required: ["reservationId", "confirmCancellation"]
                    }
                }
            }
        ];
    }

    // Sofia's tools for new bookings (your existing tools)
    return [
        ...baseTools,
        {
            type: "function" as const,
            function: {
                name: "check_availability",
                description: "Check table availability for a specific date and time",
                parameters: {
                    type: "object",
                    properties: {
                        date: {
                            type: "string",
                            description: "Date in YYYY-MM-DD format"
                        },
                        time: {
                            type: "string", 
                            description: "Time in HH:MM format"
                        },
                        guests: {
                            type: "number",
                            description: "Number of guests"
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
                description: "Find alternative available times if the requested time is not available",
                parameters: {
                    type: "object",
                    properties: {
                        date: {
                            type: "string",
                            description: "Date in YYYY-MM-DD format"
                        },
                        time: {
                            type: "string",
                            description: "Preferred time in HH:MM format"
                        },
                        guests: {
                            type: "number", 
                            description: "Number of guests"
                        }
                    },
                    required: ["date", "time", "guests"]
                }
            }
        },
        {
            type: "function" as const,
            function: {
                name: "create_reservation",
                description: "Create a new reservation when availability is confirmed",
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
                            description: "Date in YYYY-MM-DD format"
                        },
                        time: {
                            type: "string",
                            description: "Time in HH:MM format"
                        },
                        guests: {
                            type: "number",
                            description: "Number of guests"
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
   * ✅ NEW: Get agent personality and system prompt for different agent types
   */
  private getAgentPersonality(agentType: AgentType, language: string, restaurantConfig: any): string {
    const currentTime = DateTime.now().setZone(restaurantConfig.timezone);
    
    const personalities = {
        booking: {
            en: `You are Sofia, the friendly and efficient booking specialist for ${restaurantConfig.name}. You help guests make NEW reservations.

🎯 YOUR ROLE:
- Help guests find available times and make new bookings
- Provide information about the restaurant
- Guide guests through the booking process step by step  
- Be warm, professional, and detail-oriented

💬 COMMUNICATION STYLE:
- Always greet guests warmly
- Ask for details step by step (date, time, party size, name, phone)
- Confirm all details before creating the reservation
- Use natural, conversational language

🔧 YOUR TOOLS:
- check_availability: Check if requested time is available
- find_alternative_times: Suggest alternatives if requested time is busy
- create_reservation: Make the actual booking
- get_restaurant_info: Share restaurant details

✨ REMEMBER:
- Always confirm guest details before finalizing
- Be helpful with alternative suggestions
- Maintain a warm, professional tone
- You can book at ANY exact time during operating hours (like 16:15, 19:43, etc.)`,

            ru: `Вы София, дружелюбный и эффективный специалист по бронированию ресторана ${restaurantConfig.name}. Вы помогаете гостям делать НОВЫЕ бронирования.

🎯 ВАША РОЛЬ:
- Помогать гостям находить свободное время и делать новые бронирования
- Предоставлять информацию о ресторане
- Вести гостей через процесс бронирования пошагово
- Быть теплой, профессиональной и внимательной к деталям

🚺 ВАЖНО: Вы женского пола, всегда говорите о себе в женском роде.`,

            sr: `Vi ste Sofija, prijateljski i efikasni specijalista za rezervacije restorana ${restaurantConfig.name}. Pomažete gostima da prave NOVE rezervacije.

🎯 VAŠA ULOGA:
- Pomažete gostima da pronađu dostupno vreme i naprave nove rezervacije
- Pružate informacije o restoranu
- Vodite goste kroz proces rezervacije korak po korak
- Budete topla, profesionalna i orijentisana na detalje

🚺 VAŽNO: Vi ste ženskog pola, uvek govorite o sebi u ženskom rodu.`
        },
        reservations: {
            en: `You are Maya, the helpful reservation management specialist for ${restaurantConfig.name}. You help guests manage their EXISTING reservations.

🎯 YOUR ROLE:
- Help guests find their existing reservations
- Modify reservation details (time, date, party size, special requests)
- Handle cancellations with proper policy enforcement
- Provide excellent customer service for existing bookings

💬 COMMUNICATION STYLE:
- Be solution-focused and empathetic
- Always verify guest identity before making changes
- Explain policies clearly and offer alternatives when possible
- Confirm all changes explicitly

🔧 YOUR TOOLS:
- find_existing_reservation: Search for guest's reservations by phone/name/confirmation
- modify_reservation: Change reservation details
- cancel_reservation: Cancel reservations with policy enforcement
- get_restaurant_info: Share restaurant information

✨ REMEMBER:
- Always verify guest identity first (ask for phone, name, or confirmation number)
- Explain modification and cancellation policies clearly
- Offer alternatives when changes aren't possible
- Confirm all modifications before applying them

🔒 SECURITY:
- Never modify reservations without proper guest verification
- Ask for phone number, confirmation number, or name on reservation
- If verification fails, politely decline and suggest calling the restaurant`,

            ru: `Вы Майя, полезный специалист по управлению бронированиями ресторана ${restaurantConfig.name}. Вы помогаете гостям управлять их СУЩЕСТВУЮЩИМИ бронированиями.

🎯 ВАША РОЛЬ:
- Помогать гостям находить их существующие бронирования
- Изменять детали бронирования (время, дата, количество гостей, особые просьбы)
- Обрабатывать отмены с соблюдением политики
- Обеспечивать отличное обслуживание для существующих бронирований

🚺 ВАЖНО: Вы женского пола, всегда говорите о себе в женском роде.`,

            sr: `Vi ste Maja, korisni specijalista za upravljanje rezervacijama restorana ${restaurantConfig.name}. Pomažete gostima da upravljaju njihovim POSTOJEĆIM rezervacijama.

🎯 VAŠA ULOGA:
- Pomažete gostima da pronađu svoje postojeće rezervacije
- Menjate detalje rezervacije (vreme, datum, broj gostiju, posebne zahteve)
- Rukujete otkazivanjima uz pravilnu primenu politike
- Pružate odličnu uslugu za postojeće rezervacije

🚺 VAŽNO: Vi ste ženskog pola, uvek govorite o sebi u ženskom rodu.`
        }
    };

    let basePrompt = personalities[agentType][language as keyof typeof personalities[agentType]] || 
                     personalities[agentType].en;

    // Add restaurant context
    const restaurantContext = `

🏪 RESTAURANT DETAILS:
- Name: ${restaurantConfig.name}
- Hours: ${restaurantConfig.openingTime} - ${restaurantConfig.closingTime}
- Current Date: ${currentTime.toFormat('yyyy-MM-dd')}
- Current Time: ${currentTime.toFormat('HH:mm')}
- Timezone: ${restaurantConfig.timezone}
- Cuisine: ${restaurantConfig.cuisine || 'Excellent cuisine'}
- Atmosphere: ${restaurantConfig.atmosphere || 'Welcoming atmosphere'}`;

    return basePrompt + restaurantContext;
  }

  /**
   * ✅ NEW: Intelligent name choice extraction using LLM
   * Handles natural responses like "Мяурина я", "I am John", "use the new one"
   */
  private async extractNameChoice(
    userMessage: string, 
    dbName: string,
    requestName: string,
    language: string
  ): Promise<string | null> {
    
    try {
      const prompt = `You are helping resolve a name conflict in a restaurant booking system.

CONTEXT:
- Database has existing profile: "${dbName}"  
- User wants to book under name: "${requestName}"
- User's response: "${userMessage}"
- Language: ${language}

TASK: Determine which name the user wants to use based on their response.

EXAMPLES:
"Мяурина я" → wants "Мяурина" (user identifies as Мяурина)
"I am John" → wants "John"
"use John" → wants "John" 
"go with Лола" → wants "Лола"
"keep the old one" → wants "${dbName}"
"the new name" → wants "${requestName}"
"да" → wants "${requestName}" (yes = use new name)
"нет" → wants "${dbName}" (no = keep old name)
"new" → wants "${requestName}"
"old" → wants "${dbName}"
"первое" → wants "${requestName}" (first mentioned)
"второе" → wants "${dbName}" (second mentioned)

Important: Return the EXACT name (including non-Latin characters) that the user wants to use.

Respond with JSON only.`;

      const completion = await this.client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: 'user', content: prompt }],
        functions: [{
          name: "extract_name_choice",
          parameters: {
            type: "object",
            properties: {
              chosen_name: { 
                type: "string",
                description: "The exact name the user wants to use, or null if unclear"
              },
              confidence: { type: "number" },
              reasoning: { type: "string" }
            },
            required: ["chosen_name", "confidence", "reasoning"]
          }
        }],
        function_call: { name: "extract_name_choice" },
        temperature: 0.0,
        max_tokens: 150
      });

      const result = JSON.parse(completion.choices[0]?.message?.function_call?.arguments || '{}');
      
      console.log(`[NameClarification] LLM extracted choice from "${userMessage}":`, {
        chosenName: result.chosen_name,
        confidence: result.confidence,
        reasoning: result.reasoning
      });

      // Only use result if confidence is high and name is valid
      if (result.confidence >= 0.8 && result.chosen_name) {
        const chosenName = result.chosen_name.trim();
        
        // Validate it's one of the expected names (case insensitive)
        if (chosenName.toLowerCase() === dbName.toLowerCase() || 
            chosenName.toLowerCase() === requestName.toLowerCase()) {
          return chosenName;
        }
      }
      
      return null; // Unclear response
      
    } catch (error) {
      console.error('[NameClarification] LLM extraction failed:', error);
      return null;
    }
  }

  /**
   * Create session with context detection and agent type
   */
  createSession(config: {
    restaurantId: number;
    platform: 'web' | 'telegram';
    language?: Language;
    telegramUserId?: string;
    webSessionId?: string;
  }): string {
    const session = createBookingSession(config) as BookingSessionWithAgent;
    
    // Add context detection and agent type
    session.context = this.detectContext(config.platform);
    session.currentAgent = 'booking'; // Default to Sofia
    session.agentHistory = []; // Track agent switches
    
    this.sessions.set(session.sessionId, session);
    
    console.log(`[EnhancedConversationManager] Created ${session.context} session ${session.sessionId} for restaurant ${config.restaurantId} with Sofia (booking) agent`);
    
    return session.sessionId;
  }

  /**
   * Context detection logic
   */
  private detectContext(platform: 'web' | 'telegram'): 'hostess' | 'guest' {
    return platform === 'web' ? 'hostess' : 'guest';
  }

  /**
   * Get or create agent for restaurant and agent type
   */
  private async getAgent(restaurantId: number, agentType: AgentType = 'booking') {
    const agentKey = `${restaurantId}_${agentType}`;
    
    if (this.agents.has(agentKey)) {
      return this.agents.get(agentKey);
    }

    const restaurant = await storage.getRestaurant(restaurantId);
    if (!restaurant) {
      throw new Error(`Restaurant ${restaurantId} not found`);
    }

    // Create agent configuration
    const restaurantConfig = {
      id: restaurant.id,
      name: restaurant.name,
      timezone: restaurant.timezone || 'Europe/Moscow',
      openingTime: restaurant.openingTime || '09:00:00',
      closingTime: restaurant.closingTime || '23:00:00',
      maxGuests: restaurant.maxGuests || 12,
      cuisine: restaurant.cuisine,
      atmosphere: restaurant.atmosphere,
      country: restaurant.country,
      languages: restaurant.languages
    };

    // For now, both agents use the same client and basic structure
    // In the future, you might want separate agent classes
    const agent = {
      client: this.client,
      restaurantConfig,
      tools: this.getToolsForAgent(agentType),
      agentType,
      systemPrompt: '', // Will be set dynamically
      updateInstructions: (context: string, language: string) => {
        return this.getAgentPersonality(agentType, language, restaurantConfig);
      }
    };

    this.agents.set(agentKey, agent);
    console.log(`[EnhancedConversationManager] Created ${agentType} agent for ${restaurant.name}`);
    
    return agent;
  }

  /**
   * Check if message is a confirmation response
   */
  private isConfirmationResponse(message: string): { isConfirmation: boolean; confirmed?: boolean } {
    const normalized = message.toLowerCase().trim();
    
    // English confirmations
    const englishYes = ['yes', 'y', 'yep', 'yeah', 'yup', 'sure', 'ok', 'okay', 'k', 'kk', 'alright', 'go', 'confirm', 'definitely', 'absolutely'];
    const englishNo = ['no', 'n', 'nope', 'nah', 'never', 'cancel', 'reject', 'abort', 'stop'];
    
    // Russian confirmations
    const russianYes = ['да', 'д', 'ага', 'угу', 'ок', 'хорошо', 'конечно', 'точно', 'подтверждаю'];
    const russianNo = ['нет', 'н', 'не', 'отмена', 'отменить', 'стоп'];
    
    // Serbian confirmations
    const serbianYes = ['da', 'д', 'ага', 'потврђујем', 'у реду', 'ок', 'може', 'ide'];
    const serbianNo = ['ne', 'н', 'не', 'otkaži', 'odbaci', 'stop'];

    const allYes = [...englishYes, ...russianYes, ...serbianYes];
    const allNo = [...englishNo, ...russianNo, ...serbianNo];

    if (allYes.includes(normalized)) {
      return { isConfirmation: true, confirmed: true };
    }
    
    if (allNo.includes(normalized)) {
      return { isConfirmation: true, confirmed: false };
    }

    return { isConfirmation: false };
  }

  /**
   * Main message handling with enhanced logic and Maya support
   */
  async handleMessage(sessionId: string, message: string): Promise<{
    response: string;
    hasBooking: boolean;
    reservationId?: number;
    session: BookingSessionWithAgent;
    blocked?: boolean;
    blockReason?: string;
    currentAgent?: AgentType;
    agentHandoff?: { from: AgentType; to: AgentType; reason: string };
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      // STEP 1: Check for pending confirmation FIRST
      if (session.pendingConfirmation) {
        console.log(`[EnhancedConversationManager] Checking for confirmation response: "${message}"`);
        
        // ✅ INTELLIGENT: Smart name clarification handling
        const conflictDetails = session.pendingConfirmation.functionContext?.error?.details;
        if (conflictDetails && conflictDetails.dbName && conflictDetails.requestName) {
          const userMessage = message.trim();
          
          console.log(`[EnhancedConversationManager] Processing name clarification: "${userMessage}"`);
          
          // ✅ INTELLIGENT: Use LLM to extract name choice
          const chosenName = await this.extractNameChoice(
            userMessage, 
            conflictDetails.dbName, 
            conflictDetails.requestName,
            session.language
          );
          
          if (chosenName) {
            console.log(`[EnhancedConversationManager] ✅ AI determined user chose: "${chosenName}"`);
            
            session.confirmedName = chosenName;
            
            // Add user message to history
            session.conversationHistory.push({
              role: 'user',
              content: message,
              timestamp: new Date()
            });

            // Clear pending confirmation and proceed with booking
            const pendingAction = session.pendingConfirmation;
            delete session.pendingConfirmation;

            // Immediately execute the booking with confirmed name
            return await this.executeConfirmedBooking(sessionId, pendingAction);
            
          } else {
            // ✅ If AI couldn't determine choice, ask for clarification
            const clarificationMessage = session.language === 'ru'
              ? `Извините, я не поняла ваш выбор. Пожалуйста, скажите:\n• "${conflictDetails.requestName}" - для использования нового имени\n• "${conflictDetails.dbName}" - для сохранения старого имени`
              : session.language === 'sr' 
              ? `Izvini, nisam razumela vaš izbor. Molim recite:\n• "${conflictDetails.requestName}" - za korišćenje novog imena\n• "${conflictDetails.dbName}" - za zadržavanje starog imena`
              : `Sorry, I didn't understand your choice. Please say:\n• "${conflictDetails.requestName}" - to use the new name\n• "${conflictDetails.dbName}" - to keep the existing name`;

            session.conversationHistory.push({
              role: 'user',
              content: message,
              timestamp: new Date()
            });

            session.conversationHistory.push({
              role: 'assistant',
              content: clarificationMessage,
              timestamp: new Date()
            });

            this.sessions.set(sessionId, session);

            return {
              response: clarificationMessage,
              hasBooking: false,
              session,
              currentAgent: session.currentAgent
            };
          }
        }

        // ✅ IMPORTANT: Only handle general confirmation if it's NOT a name clarification
        if (!conflictDetails) {
          // Check for yes/no confirmation for non-name-clarification cases
          const confirmationCheck = this.isConfirmationResponse(message);
          if (confirmationCheck.isConfirmation) {
            console.log(`[EnhancedConversationManager] Detected general confirmation response: ${confirmationCheck.confirmed}`);
            
            // Add user message to history
            session.conversationHistory.push({
              role: 'user',
              content: message,
              timestamp: new Date()
            });

            // Handle the confirmation
            return await this.handleConfirmation(sessionId, confirmationCheck.confirmed!);
          } else {
            console.log(`[EnhancedConversationManager] Message not recognized as confirmation, treating as new input`);
            // Clear pending confirmation if user says something else
            delete session.pendingConfirmation;
            delete session.confirmedName; // Also clear any stored confirmed name
          }
        }
      }

      // STEP 2: Agent Detection and Switching (NOW WITH LLM FALLBACK)
      const detectedAgent = await this.detectAgentType(message, session.currentAgent);
      let agentHandoff;
      
      if (session.currentAgent && session.currentAgent !== detectedAgent) {
        console.log(`[EnhancedConversationManager] 🔄 Agent handoff: ${session.currentAgent} → ${detectedAgent}`);
        
        agentHandoff = {
          from: session.currentAgent,
          to: detectedAgent,
          reason: `Message indicates ${detectedAgent === 'reservations' ? 'existing reservation management' : 'new booking request'}`
        };
        
        // Store handoff in session for context
        if (!session.agentHistory) session.agentHistory = [];
        session.agentHistory.push({
          from: session.currentAgent,
          to: detectedAgent,
          at: new Date().toISOString(),
          trigger: message.substring(0, 100) // First 100 chars that triggered handoff
        });
      }

      session.currentAgent = detectedAgent;

      // STEP 3: Run guardrails for non-confirmation messages
      console.log(`[EnhancedConversationManager] Running guardrails for session ${sessionId}`);
      
      const guardrailResult = await runGuardrails(message, session);
      if (!guardrailResult.allowed) {
        console.log(`[EnhancedConversationManager] Message blocked: ${guardrailResult.category} - ${guardrailResult.reason}`);
        
        // Add blocked message to history for context
        session.conversationHistory.push({
          role: 'user',
          content: message,
          timestamp: new Date()
        });

        session.conversationHistory.push({
          role: 'assistant',
          content: guardrailResult.reason || 'I can only help with restaurant reservations.',
          timestamp: new Date()
        });

        session.lastActivity = new Date();
        this.sessions.set(sessionId, session);

        return {
          response: guardrailResult.reason || 'I can only help with restaurant reservations.',
          hasBooking: false,
          session,
          blocked: true,
          blockReason: guardrailResult.category,
          currentAgent: session.currentAgent
        };
      }

      // STEP 4: Language detection (with improved logic)
      const isNumericOrShortMessage = /^\d+[\d\s-()+]*$/.test(message) || message.trim().length < 5;

      if (isNumericOrShortMessage && session.conversationHistory.length > 0) {
        // If the message is just a number (like a phone) or very short (like "yes"), 
        // DO NOT change the already established language.
        console.log(`[EnhancedConversationManager] Sticking with current language '${session.language}' due to simple input.`);
      } else {
        // Otherwise, run the language detection as normal.
        const detectedLanguage = this.detectLanguage(message);
        if (detectedLanguage !== session.language) {
          session.language = detectedLanguage;
          console.log(`[EnhancedConversationManager] Language changed to '${detectedLanguage}'`);
        }
      }

      session.lastActivity = new Date();
      session.conversationHistory.push({
        role: 'user',
        content: message,
        timestamp: new Date()
      });

      // STEP 5: Get agent and prepare messages
      const agent = await this.getAgent(session.restaurantId, session.currentAgent);
      
      let systemPrompt = agent.updateInstructions 
        ? agent.updateInstructions(session.context, session.language)
        : this.getAgentPersonality(session.currentAgent, session.language, agent.restaurantConfig);

      // Add agent history context if there was a handoff
      if (session.agentHistory && session.agentHistory.length > 0) {
        const recentHandoff = session.agentHistory[session.agentHistory.length - 1];
        if (recentHandoff.to === session.currentAgent) {
          systemPrompt += `\n\n🔄 CONTEXT: Guest was just transferred from ${recentHandoff.from} agent because: "${recentHandoff.trigger}"`;
        }
      }

      // Add guest context if available
      if (session.gatheringInfo.name || session.gatheringInfo.phone) {
        systemPrompt += `\n\n👤 GUEST CONTEXT:`;
        if (session.gatheringInfo.name) systemPrompt += `\n- Name: ${session.gatheringInfo.name}`;
        if (session.gatheringInfo.phone) systemPrompt += `\n- Phone: ${session.gatheringInfo.phone}`;
      }

      const messages = [
        {
          role: 'system' as const,
          content: systemPrompt
        },
        ...session.conversationHistory.slice(-8).map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        }))
      ];

      // STEP 6: Initial completion with function calling
      let completion = await agent.client.chat.completions.create({
        model: "gpt-4o",
        messages: messages,
        tools: agent.tools,
        tool_choice: "auto",
        temperature: 0.7,
        max_tokens: 1000
      });

      let hasBooking = false;
      let reservationId: number | undefined;

      // STEP 7: Handle function calls
      if (completion.choices[0]?.message?.tool_calls) {
        console.log(`[EnhancedConversationManager] Processing ${completion.choices[0].message.tool_calls.length} function calls with ${session.currentAgent} agent`);

        // Add assistant message with tool calls
        messages.push({
          role: 'assistant' as const,
          content: completion.choices[0].message.content || null,
          tool_calls: completion.choices[0].message.tool_calls
        });

        const functionContext = {
          restaurantId: session.restaurantId,
          timezone: agent.restaurantConfig?.timezone || 'Europe/Moscow',
          telegramUserId: session.telegramUserId,
          source: session.platform,
          sessionId: sessionId,
          language: session.language,
          confirmedName: session.confirmedName // ✅ CRITICAL: Pass confirmed name
        };

        // Process each function call
        for (const toolCall of completion.choices[0].message.tool_calls) {
          if (toolCall.function.name in agentFunctions) {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              
              // ✅ ENHANCED: Handle name mismatch during booking
              if (toolCall.function.name === 'create_reservation') {
                // Check if we have a confirmed name to use instead
                if (session.confirmedName) {
                  console.log(`[EnhancedConversationManager] Using confirmed name: ${session.confirmedName}`);
                  args.guestName = session.confirmedName;
                }
              }
              
              // ✅ FIXED: Check if high-risk action requires confirmation with language support
              const confirmationCheck = requiresConfirmation(toolCall.function.name, args, session.language);
              if (confirmationCheck.required && !session.pendingConfirmation) {
                // Store pending action and ask for confirmation
                session.pendingConfirmation = {
                  toolCall,
                  functionContext,
                  summary: confirmationCheck.summary!
                };
                
                this.sessions.set(sessionId, session);
                
                const confirmationMessage = session.language === 'ru'
                  ? `Подтверждаете создание бронирования?\n\n${confirmationCheck.summary}\n\nОтветьте "да" для подтверждения или "нет" для отмены.`
                  : session.language === 'sr'
                  ? `Potvrđujete kreiranje rezervacije?\n\n${confirmationCheck.summary}\n\nOdgovorite "da" za potvrdu ili "ne" za otkazivanje.`
                  : `Please confirm this reservation:\n\n${confirmationCheck.summary}\n\nReply "yes" to confirm or "no" to cancel.`;
                
                // Add confirmation request to history
                session.conversationHistory.push({
                  role: 'assistant',
                  content: confirmationMessage,
                  timestamp: new Date()
                });

                return {
                  response: confirmationMessage,
                  hasBooking: false,
                  session,
                  currentAgent: session.currentAgent,
                  agentHandoff
                };
              }

              // Execute function based on agent capabilities
              console.log(`[EnhancedConversationManager] Calling function: ${toolCall.function.name} with ${session.currentAgent} agent`);
              
              let result;
              switch (toolCall.function.name) {
                // Sofia's functions (booking agent)
                case 'check_availability':
                  result = await agentFunctions.check_availability(
                    args.date, args.time, args.guests, functionContext
                  );
                  break;
                case 'find_alternative_times':
                  result = await agentFunctions.find_alternative_times(
                    args.date, args.preferredTime, args.guests, functionContext
                  );
                  break;
                case 'create_reservation':
                  result = await agentFunctions.create_reservation(
                    args.guestName, args.guestPhone, args.date, args.time, 
                    args.guests, args.specialRequests || '', functionContext
                  );
                  break;
                
                // Maya's functions (reservations agent)  
                case 'find_existing_reservation':
                  result = await agentFunctions.find_existing_reservation(
                    args.identifier, args.identifierType, functionContext
                  );
                  break;
                case 'modify_reservation':
                  result = await agentFunctions.modify_reservation(
                    args.reservationId, args.modifications, args.reason, functionContext
                  );
                  break;
                case 'cancel_reservation':
                  result = await agentFunctions.cancel_reservation(
                    args.reservationId, args.reason, args.confirmCancellation, functionContext
                  );
                  break;
                
                // Shared functions
                case 'get_restaurant_info':
                  result = await agentFunctions.get_restaurant_info(
                    args.infoType, functionContext
                  );
                  break;
                  
                default:
                  console.warn(`[EnhancedConversationManager] Unknown function: ${toolCall.function.name}`);
                  result = { error: "Unknown function" };
              }
              
              console.log(`[EnhancedConversationManager] Function result for ${toolCall.function.name}:`, result);

              // ✅ ENHANCED: Handle name clarification errors specifically
              if (toolCall.function.name === 'create_reservation' && 
                  result.tool_status === 'FAILURE' && 
                  result.error?.code === 'NAME_CLARIFICATION_NEEDED') {
                
                console.log(`[ConversationManager] ✅ NAME CLARIFICATION NEEDED - Processing...`);
                
                const { dbName, requestName } = result.error.details;
                
                // Store pending confirmation with name conflict info
                session.pendingConfirmation = {
                  toolCall,
                  functionContext: {
                    ...functionContext,
                    error: result.error
                  },
                  summary: `Name clarification needed: DB has "${dbName}", booking requested for "${requestName}"`
                };

                // ✅ ENHANCED: Natural clarification message that invites flexible responses
                const clarificationMessage = session.language === 'ru'
                  ? `Я вижу, что вы ранее бронировали под именем "${dbName}". Для этого бронирования хотите использовать имя "${requestName}" или оставить "${dbName}"?`
                  : session.language === 'sr'
                  ? `Vidim da ste ranije rezervisali pod imenom "${dbName}". Za ovu rezervaciju želite da koristite ime "${requestName}" ili da zadržite "${dbName}"?`
                  : `I see you've booked with us before under the name "${dbName}". For this reservation, would you like to use "${requestName}" or keep "${dbName}"?`;

                session.conversationHistory.push({
                  role: 'assistant',
                  content: clarificationMessage,
                  timestamp: new Date()
                });

                this.sessions.set(sessionId, session);

                return {
                  response: clarificationMessage,
                  hasBooking: false,
                  session,
                  currentAgent: session.currentAgent,
                  agentHandoff
                };
              }

              // Add function result to messages
              messages.push({
                role: 'tool' as const,
                content: JSON.stringify(result),
                tool_call_id: toolCall.id
              });

              // Check if booking was successfully created (Sofia) or reservation modified (Maya)
              if (toolCall.function.name === 'create_reservation' || 
                  toolCall.function.name === 'modify_reservation') {
                // Check correct response format with tool_status
                if (result.tool_status === 'SUCCESS' && result.data && 
                    (result.data.success || result.data.reservationId)) {
                  hasBooking = true;
                  reservationId = result.data.reservationId;
                  session.hasActiveReservation = reservationId;
                  session.currentStep = 'completed';
                  
                  // ✅ CLEANUP: Clear confirmation state after successful booking
                  delete session.pendingConfirmation;
                  delete session.confirmedName;
                  
                  console.log(`[EnhancedConversationManager] ${toolCall.function.name} completed successfully! Reservation ID: ${reservationId}`);
                }
              }

              // Extract and store gathering info from function arguments  
              this.extractGatheringInfo(session, args);

            } catch (funcError) {
              console.error(`[EnhancedConversationManager] Function call error:`, funcError);
              
              messages.push({
                role: 'tool' as const,
                content: JSON.stringify({ 
                  tool_status: 'FAILURE',
                  error: {
                    type: 'SYSTEM_ERROR',
                    message: funcError instanceof Error ? funcError.message : 'Unknown error'
                  }
                }),
                tool_call_id: toolCall.id
              });
            }
          }
        }

        // STEP 8: Get final response incorporating function results
        console.log(`[EnhancedConversationManager] Getting final response with function results for ${session.currentAgent} agent`);
        
        completion = await agent.client.chat.completions.create({
          model: "gpt-4o",
          messages: messages,
          temperature: 0.7,
          max_tokens: 1000
        });
      }

      // Extract final response
      const response = completion.choices[0]?.message?.content || 
        (session.language === 'ru' 
          ? "Извините, я не смогла понять. Попробуйте еще раз."
          : session.language === 'sr'
          ? "Извините, nisam razumela. Molim pokušajte ponovo."
          : "I apologize, I didn't understand that. Could you please try again?");

      // Add response to conversation history
      session.conversationHistory.push({
        role: 'assistant',
        content: response,
        timestamp: new Date(),
        toolCalls: completion.choices[0]?.message?.tool_calls
      });

      // Update session
      this.sessions.set(sessionId, session);

      console.log(`[EnhancedConversationManager] Message handled by ${session.currentAgent} agent. Booking: ${hasBooking}, Reservation: ${reservationId}`);

      return {
        response,
        hasBooking,
        reservationId,
        session,
        currentAgent: session.currentAgent,
        agentHandoff
      };

    } catch (error) {
      console.error(`[EnhancedConversationManager] Error handling message:`, error);
      
      const fallbackResponse = session.context === 'hostess'
        ? (session.language === 'ru' ? "Произошла ошибка. Попробуйте еще раз." : 
           session.language === 'sr' ? "Dogodila se greška. Molim pokušajte ponovo." :
           "Error occurred. Please try again.")
        : (session.language === 'ru' ? 'Извините, возникла техническая проблема. Попробуйте еще раз.' : 
           session.language === 'sr' ? 'Izvините, nastao je tehnički problem. Molim pokušajte ponovo.' :
           'I apologize, I encountered a technical issue. Please try again.');

      session.conversationHistory.push({
        role: 'assistant',
        content: fallbackResponse,
        timestamp: new Date()
      });

      session.lastActivity = new Date();
      this.sessions.set(sessionId, session);

      return {
        response: fallbackResponse,
        hasBooking: false,
        session,
        currentAgent: session.currentAgent
      };
    }
  }

  /**
   * ✅ ENHANCED: Execute confirmed booking immediately
   */
  private async executeConfirmedBooking(sessionId: string, pendingAction: any): Promise<{
    response: string;
    hasBooking: boolean;
    reservationId?: number;
    session: BookingSessionWithAgent;
    currentAgent?: AgentType;
  }> {
    const session = this.sessions.get(sessionId)!;
    
    try {
      const { toolCall, functionContext } = pendingAction;
      const args = JSON.parse(toolCall.function.arguments);
      
      // Use confirmed name
      if (session.confirmedName) {
        args.guestName = session.confirmedName;
        functionContext.confirmedName = session.confirmedName;
      }
      
      console.log(`[EnhancedConversationManager] Executing booking with confirmed name: ${session.confirmedName}`);
      
      const result = await agentFunctions.create_reservation(
        args.guestName, args.guestPhone, args.date, args.time,
        args.guests, args.specialRequests || '', functionContext
      );

      // Clear confirmed name after use
      delete session.confirmedName;
      
      // Check success
      if (result.tool_status === 'SUCCESS' && result.data && result.data.success) {
        session.hasActiveReservation = result.data.reservationId;
        session.currentStep = 'completed';
        
        const successMessage = session.language === 'ru'
          ? `🎉 Отлично! Ваше бронирование подтверждено. Номер брони: ${result.data.reservationId}`
          : session.language === 'sr'
          ? `🎉 Odlično! Vaša rezervacija je potvrđena. Broj rezervacije: ${result.data.reservationId}`
          : `🎉 Perfect! Your reservation is confirmed. Reservation number: ${result.data.reservationId}`;
        
        session.conversationHistory.push({
          role: 'assistant',
          content: successMessage,
          timestamp: new Date()
        });

        this.sessions.set(sessionId, session);

        return {
          response: successMessage,
          hasBooking: true,
          reservationId: result.data.reservationId,
          session,
          currentAgent: session.currentAgent
        };
      } else {
        const errorMessage = session.language === 'ru'
          ? `Извините, не удалось создать бронирование: ${result.error?.message || 'неизвестная ошибка'}`
          : session.language === 'sr'
          ? `Izvините, nije moguće kreirati rezervaciju: ${result.error?.message || 'nepoznata greška'}`
          : `Sorry, I couldn't create the reservation: ${result.error?.message || 'unknown error'}`;
        
        session.conversationHistory.push({
          role: 'assistant',
          content: errorMessage,
          timestamp: new Date()
        });

        this.sessions.set(sessionId, session);

        return {
          response: errorMessage,
          hasBooking: false,
          session,
          currentAgent: session.currentAgent
        };
      }
    } catch (error) {
      console.error(`[EnhancedConversationManager] Error executing confirmed booking:`, error);
      
      const errorMessage = session.language === 'ru'
        ? "Произошла ошибка при создании бронирования."
        : session.language === 'sr'
        ? "Dogodila se greška prilikom kreiranja rezervacije."
        : "An error occurred while creating the reservation.";

      return {
        response: errorMessage,
        hasBooking: false,
        session,
        currentAgent: session.currentAgent
      };
    }
  }

  /**
   * ✅ ENHANCED: Handle confirmation responses with multi-agent support
   */
  async handleConfirmation(sessionId: string, confirmed: boolean): Promise<{
    response: string;
    hasBooking: boolean;
    reservationId?: number;
    session: BookingSessionWithAgent;
    currentAgent?: AgentType;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session?.pendingConfirmation) {
      throw new Error('No pending confirmation found');
    }

    try {
      if (confirmed) {
        // Execute the pending function call
        const { toolCall, functionContext } = session.pendingConfirmation;
        const args = JSON.parse(toolCall.function.arguments);
        
        // ✅ CRITICAL: Use confirmed name if available
        if (session.confirmedName) {
          console.log(`[EnhancedConversationManager] Using confirmed name for booking: ${session.confirmedName}`);
          args.guestName = session.confirmedName;
          functionContext.confirmedName = session.confirmedName;
        }
        
        console.log(`[EnhancedConversationManager] Executing confirmed action: ${toolCall.function.name}`);
        
        // Route to appropriate function based on the pending tool call
        let result;
        switch (toolCall.function.name) {
          case 'create_reservation':
            result = await agentFunctions.create_reservation(
              args.guestName, args.guestPhone, args.date, args.time,
              args.guests, args.specialRequests || '', functionContext
            );
            break;
          case 'cancel_reservation':
            result = await agentFunctions.cancel_reservation(
              args.reservationId, args.reason, true, functionContext
            );
            break;
          default:
            throw new Error(`Unsupported pending confirmation for: ${toolCall.function.name}`);
        }

        // ✅ CRITICAL FIX: Handle name clarification in confirmation path
        if (result.tool_status === 'FAILURE' && result.error?.code === 'NAME_CLARIFICATION_NEEDED') {
          console.log(`[ConversationManager] ✅ NAME CLARIFICATION NEEDED in handleConfirmation`);
          
          const { dbName, requestName } = result.error.details;
          
          // Store pending confirmation with name conflict info
          session.pendingConfirmation = {
            toolCall,
            functionContext: {
              ...functionContext,
              error: result.error
            },
            summary: `Name clarification needed: DB has "${dbName}", booking requested for "${requestName}"`
          };

          // ✅ ENHANCED: Natural clarification message
          const clarificationMessage = session.language === 'ru'
            ? `Я вижу, что вы ранее бронировали под именем "${dbName}". Для этого бронирования хотите использовать имя "${requestName}" или оставить "${dbName}"?`
            : session.language === 'sr'
            ? `Vidim da ste ranije rezervisali pod imenom "${dbName}". Za ovu rezervaciju želite da koristite ime "${requestName}" ili da zadržite "${dbName}"?`
            : `I see you've booked with us before under the name "${dbName}". For this reservation, would you like to use "${requestName}" or keep "${dbName}"?`;

          session.conversationHistory.push({
            role: 'assistant',
            content: clarificationMessage,
            timestamp: new Date()
          });

          this.sessions.set(sessionId, session);

          return {
            response: clarificationMessage,
            hasBooking: false,
            session,
            currentAgent: session.currentAgent
          };
        }

        // Clear pending confirmation and confirmed name
        delete session.pendingConfirmation;
        delete session.confirmedName;
        
        // Check success with new format
        if (result.tool_status === 'SUCCESS' && result.data && 
            (result.data.success || result.data.reservationId)) {
          
          const reservationId = result.data.reservationId;
          session.hasActiveReservation = reservationId;
          session.currentStep = 'completed';
          
          let successMessage;
          
          if (toolCall.function.name === 'create_reservation') {
            successMessage = session.language === 'ru'
              ? `🎉 Отлично! Ваше бронирование подтверждено. Номер брони: ${reservationId}`
              : session.language === 'sr'
              ? `🎉 Odlično! Vaša rezervacija je potvrđena. Broj rezervacije: ${reservationId}`
              : `🎉 Perfect! Your reservation is confirmed. Reservation number: ${reservationId}`;
          } else if (toolCall.function.name === 'cancel_reservation') {
            successMessage = session.language === 'ru'
              ? `✅ Ваше бронирование успешно отменено.`
              : session.language === 'sr'
              ? `✅ Vaša rezervacija je uspešno otkazana.`
              : `✅ Your reservation has been successfully cancelled.`;
          }
          
          session.conversationHistory.push({
            role: 'assistant',
            content: successMessage,
            timestamp: new Date()
          });

          this.sessions.set(sessionId, session);

          return {
            response: successMessage,
            hasBooking: toolCall.function.name === 'create_reservation',
            reservationId: toolCall.function.name === 'create_reservation' ? reservationId : undefined,
            session,
            currentAgent: session.currentAgent
          };
        } else {
          const errorMessage = session.language === 'ru'
            ? `Извините, не удалось выполнить операцию: ${result.error?.message || 'неизвестная ошибка'}`
            : session.language === 'sr'
            ? `Izvините, nije moguće izvršiti operaciju: ${result.error?.message || 'nepoznata greška'}`
            : `Sorry, I couldn't complete the operation: ${result.error?.message || 'unknown error'}`;
          
          session.conversationHistory.push({
            role: 'assistant',
            content: errorMessage,
            timestamp: new Date()
          });

          this.sessions.set(sessionId, session);

          return {
            response: errorMessage,
            hasBooking: false,
            session,
            currentAgent: session.currentAgent
          };
        }
      } else {
        // User declined - clear pending confirmation
        delete session.pendingConfirmation;
        delete session.confirmedName;
        
        const cancelMessage = session.language === 'ru'
          ? "Хорошо, операция отменена. Чем еще могу помочь?"
          : session.language === 'sr'
          ? "U redu, operacija je otkazana. Čime još mogu da pomognem?"
          : "Okay, operation cancelled. How else can I help you?";
        
        session.conversationHistory.push({
          role: 'assistant',
          content: cancelMessage,
          timestamp: new Date()
        });

        this.sessions.set(sessionId, session);

        return {
          response: cancelMessage,
          hasBooking: false,
          session,
          currentAgent: session.currentAgent
        };
      }
    } catch (error) {
      console.error(`[EnhancedConversationManager] Confirmation error:`, error);
      
      delete session.pendingConfirmation;
      delete session.confirmedName;
      const errorMessage = session.language === 'ru'
        ? "Произошла ошибка при обработке подтверждения."
        : session.language === 'sr'
        ? "Dogodila se greška prilikom obrade potvrde."
        : "An error occurred while processing the confirmation.";

      return {
        response: errorMessage,
        hasBooking: false,
        session,
        currentAgent: session.currentAgent
      };
    }
  }

  /**
   * Extract gathering info from function arguments
   */
  private extractGatheringInfo(session: BookingSessionWithAgent, args: any) {
    const updates: Partial<BookingSession['gatheringInfo']> = {};
    
    if (args.date) updates.date = args.date;
    if (args.time) updates.time = args.time;
    if (args.guests) updates.guests = args.guests;
    if (args.guestName) updates.name = args.guestName;
    if (args.guestPhone) updates.phone = args.guestPhone;
    if (args.specialRequests) updates.comments = args.specialRequests;
    
    if (Object.keys(updates).length > 0) {
      Object.assign(session.gatheringInfo, updates);
      console.log(`[EnhancedConversationManager] Updated session info:`, updates);
      
      // Log completeness status
      const isComplete = hasCompleteBookingInfo(session);
      console.log(`[EnhancedConversationManager] Booking info complete: ${isComplete}`, {
        hasDate: !!session.gatheringInfo.date,
        hasTime: !!session.gatheringInfo.time,
        hasGuests: !!session.gatheringInfo.guests,
        hasName: !!session.gatheringInfo.name,
        hasPhone: !!session.gatheringInfo.phone
      });
    }
  }

  /**
   * Enhanced language detection with Serbian support
   */
  private detectLanguage(message: string): Language {
    // Cyrillic = Russian or Serbian
    if (/[\u0400-\u04FF]/.test(message)) {
      // Check for Serbian-specific words in Cyrillic
      const serbianCyrillicWords = ['здраво', 'хвала', 'молим', 'добро', 'како'];
      const lowerText = message.toLowerCase();
      if (serbianCyrillicWords.some(word => lowerText.includes(word))) {
        return 'sr';
      }
      return 'ru'; // Default to Russian for Cyrillic
    }
    
    // Latin script - check for Serbian
    const serbianLatin = ['zdravo', 'hvala', 'molim', 'rezervacija'];
    if (serbianLatin.some(word => message.toLowerCase().includes(word))) {
      return 'sr';
    }
    
    return 'en'; // Default to English
  }

  /**
   * Get session information
   */
  getSession(sessionId: string): BookingSessionWithAgent | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Update session with new information
   */
  updateSession(sessionId: string, updates: Partial<BookingSession['gatheringInfo']>): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const updatedSession = updateSessionInfo(session, updates) as BookingSessionWithAgent;
    this.sessions.set(sessionId, updatedSession);
    return true;
  }

  /**
   * End session
   */
  endSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Clean up old sessions
   */
  private cleanupOldSessions(): void {
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000); // 4 hours
    let cleanedCount = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lastActivity < cutoff) {
        this.sessions.delete(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[EnhancedConversationManager] Cleaned up ${cleanedCount} old sessions`);
    }
  }

  /**
   * Enhanced session statistics with agent tracking
   */
  getStats(): {
    totalSessions: number;
    activeSessions: number;
    completedBookings: number;
    sessionsByPlatform: { web: number; telegram: number };
    sessionsByContext: { hostess: number; guest: number };
    sessionsByAgent: { booking: number; reservations: number };
    languageDistribution: { en: number; ru: number; sr: number };
    agentHandoffs: number;
  } {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    let activeSessions = 0;
    let completedBookings = 0;
    let webSessions = 0;
    let telegramSessions = 0;
    let hostessSessions = 0;
    let guestSessions = 0;
    let bookingSessions = 0;
    let reservationsSessions = 0;
    let enSessions = 0;
    let ruSessions = 0;
    let srSessions = 0;
    let agentHandoffs = 0;

    for (const session of this.sessions.values()) {
      if (session.lastActivity > oneHourAgo) activeSessions++;
      if (session.hasActiveReservation) completedBookings++;
      if (session.platform === 'web') webSessions++;
      else telegramSessions++;
      if (session.context === 'hostess') hostessSessions++;
      else guestSessions++;
      if (session.currentAgent === 'booking') bookingSessions++;
      else reservationsSessions++;
      if (session.language === 'en') enSessions++;
      else if (session.language === 'ru') ruSessions++;
      else if (session.language === 'sr') srSessions++;
      if (session.agentHistory && session.agentHistory.length > 0) {
        agentHandoffs += session.agentHistory.length;
      }
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions,
      completedBookings,
      sessionsByPlatform: { web: webSessions, telegram: telegramSessions },
      sessionsByContext: { hostess: hostessSessions, guest: guestSessions },
      sessionsByAgent: { booking: bookingSessions, reservations: reservationsSessions },
      languageDistribution: { en: enSessions, ru: ruSessions, sr: srSessions },
      agentHandoffs
    };
  }

  /**
   * Graceful shutdown
   */
  shutdown(): void {
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
    }
    console.log('[EnhancedConversationManager] Shutdown completed');
  }
}

// Extended session interface with agent and confirmation support
interface BookingSessionWithAgent extends BookingSession {
  currentAgent: AgentType;
  agentHistory?: Array<{
    from: AgentType;
    to: AgentType;
    at: string;
    trigger: string;
  }>;
  pendingConfirmation?: {
    toolCall: any;
    functionContext: any;
    summary: string;
  };
  confirmedName?: string;
}

// Global instance
export const enhancedConversationManager = new EnhancedConversationManager();

// Graceful shutdown handling
process.on('SIGINT', () => {
  enhancedConversationManager.shutdown();
});

process.on('SIGTERM', () => {
  enhancedConversationManager.shutdown();
});

export default enhancedConversationManager;