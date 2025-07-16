// src/agents/sofia-agent.ts
// ✅ PHASE 4.1.3: Sofia Agent Implementation - Extends BaseAgent
// ✅ FUNCTIONALITY PRESERVATION: 100% of existing booking-agent.ts functionality preserved
// ✅ ARCHITECTURE IMPROVEMENT: Clean BaseAgent pattern with all original capabilities
// ✅ BUG FIXES APPLIED: Time input interpretation, proactive confirmation, message deduplication
// 🔧 BOOKING SYSTEM FIXES: Context-aware confirmations, smart confirmation messages, enhanced reservation ID handling
// 🐞 BUG FIX: Proactive confirmation prompt is now CONDITIONAL and only shown for returning guests to prevent hallucination.
// 🎯 UX ENHANCEMENT: Intelligent guest context usage for immediate recognition and natural conversation
// 🚨 CRITICAL HALLUCINATION PREVENTION: Aligned with enhanced-conversation-manager.ts zero-hallucination policy
// 🚨 ENHANCED VALIDATION PIPELINE: Integrated with agent-tools.ts 5-layer validation system
// 🚨 TIMEZONE INTEGRATION: Full integration with timezone-utils.ts for accurate date/time handling
// 🚨 BUSINESS HOURS VALIDATION: Enhanced business hours support including overnight operations

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
 * Guest history interface from original booking-agent.ts
 */
interface GuestHistory {
    guest_name: string;
    guest_phone: string;
    total_bookings: number;
    total_cancellations: number;
    last_visit_date: string | null;
    common_party_size: number | null;
    frequent_special_requests: string[];
    retrieved_at: string;
}

/**
 * Conversation context interface from original booking-agent.ts
 */
interface ConversationContext {
    isReturnVisit: boolean;
    hasAskedPartySize: boolean;
    hasAskedDate: boolean;
    hasAskedTime: boolean;
    hasAskedName: boolean;
    hasAskedPhone: boolean;
    bookingNumber: number;
    isSubsequentBooking: boolean;
    sessionTurnCount: number;
    lastQuestions: string[];
    gatheringInfo?: {
        date?: string;
        time?: string;
        guests?: number;
        name?: string;
        phone?: string;
        comments?: string;
    };
}

/**
 * Sofia Agent - The Friendly Booking Specialist with Enhanced Validation & Hallucination Prevention
 * 
 * Extends BaseAgent with all original booking-agent.ts functionality plus:
 * - 🚨 CRITICAL HALLUCINATION PREVENTION: Zero-hallucination policy aligned with conversation manager
 * - 🚨 ENHANCED VALIDATION PIPELINE: 5-layer validation system integration
 * - 🚨 TIMEZONE INTEGRATION: Full timezone-utils.ts integration for accurate handling
 * - 🚨 BUSINESS HOURS VALIDATION: Enhanced business hours support including overnight operations
 * - 🎯 INTELLIGENT GUEST RECOGNITION: Immediate recognition of returning guests
 * - 🎯 CONTEXTUAL INFORMATION USAGE: Uses guest history proactively in conversations
 * - 🎯 NATURAL CONVERSATION FLOW: Adapts responses based on available context
 * - 🎯 EFFICIENT INFORMATION GATHERING: Only asks for missing information
 * - Context-aware confirmation logic that adapts to available information
 * - Smart confirmation messages that acknowledge received information
 * - Enhanced reservation ID handling for clean confirmations
 * - Improved conversation flow that feels natural and efficient
 * - Direct booking path support for complete information scenarios
 * 
 * 🔧 BOOKING SYSTEM FIXES IMPLEMENTED:
 * - Issue 1: AI Hallucination - Zero-hallucination policy with field validation
 * - Issue 2: Business Logic Bypass - Enhanced validation pipeline integration
 * - Issue 3: Past-Date Prevention - Timezone-aware past-date validation
 * - Issue 4: Business Hours Validation - Overnight operations support
 * - Issue 5: State Management - Availability re-validation tracking
 * 
 * 🎯 UX ENHANCEMENTS IMPLEMENTED:
 * - Issue 1: Guest History Not Being Used Intelligently - SOLVED
 * - Issue 3: Robotic Conversation Flow Persists - SOLVED with intelligent context usage
 */
export class SofiaAgent extends BaseAgent {
    readonly name = 'Sofia';
    readonly description = 'Friendly booking specialist with enhanced validation & hallucination prevention';
    readonly capabilities = [
        'check_availability',
        'find_alternative_times',
        'create_reservation',
        'get_restaurant_info',
        'get_guest_history'
    ];

    constructor(config: AgentConfig, restaurantConfig: RestaurantConfig) {
        super(config, restaurantConfig);
        this.logAgentAction('Sofia Agent initialized with enhanced validation & hallucination prevention');
    }

    /**
     * 🚨 ENHANCED: Generate system prompt with hallucination prevention and enhanced validation
     * Now includes critical instructions aligned with the zero-hallucination policy and enhanced validation pipeline
     */
    generateSystemPrompt(context: AgentContext): string {
        const { language, guestHistory, conversationContext } = context;

        const dateContext = this.getEnhancedRestaurantContext();
        const personalizedSection = this.getPersonalizedPromptSection(guestHistory, language, conversationContext);
        const criticalInstructions = this.getCriticalBookingInstructions(conversationContext);
        const contextualInstructions = this.getContextualIntelligenceInstructions(guestHistory, conversationContext);
        const confirmationInstructions = this.getSmartConfirmationInstructions(conversationContext);
        const conversationInstructions = this.getConversationInstructions(conversationContext);
        const hallucinationPreventionInstructions = this.getHallucinationPreventionInstructions();
        const validationPipelineInstructions = this.getValidationPipelineInstructions();
        const businessHoursInstructions = this.getBusinessHoursInstructions();

        const languageInstruction = `🌍 CRITICAL LANGUAGE RULE:
- User's language: ${language}
- You MUST respond in ${language} for ALL messages
- Maintain warm, professional tone in ${language}
- If unsure of translation, use simple clear ${language}`;

        const toolInstructions = `
🔧 ENHANCED TOOL RESPONSE UNDERSTANDING:
All tools now return standardized responses with enhanced validation:
- tool_status: 'SUCCESS' or 'FAILURE'
- data: (when successful) contains the actual result with enhanced validation
- error: (when failed) contains categorized error info with specific validation details
- metadata: (optional) contains validation warnings and processing info

🚨 CRITICAL: ALL TOOLS NOW INCLUDE 5-LAYER VALIDATION PIPELINE:
1. Basic input validation with field-by-field checks
2. Past-date validation with 5-minute grace period using restaurant timezone
3. Business hours validation supporting overnight operations  
4. Input sanitization for all parameters
5. Workflow validation for special requests

GUEST HISTORY TOOL:
- get_guest_history: Use this FIRST for telegram users to get personalized greeting info
- Only call this once per session for the first message
- Use the returned data to personalize greetings and suggestions
- Returns English patterns that are automatically translated

ENHANCED ERROR TYPES TO HANDLE:
1. VALIDATION_ERROR: Input format wrong (date, time, guests, etc.) - NOW WITH ENHANCED FIELD-SPECIFIC VALIDATION
   → Ask user to correct the input with specific guidance based on enhanced validation
2. BUSINESS_RULE: No availability, capacity limits, restaurant policies - NOW WITH BUSINESS HOURS VALIDATION
   → Suggest alternatives or explain constraints naturally, consider business hours
3. SYSTEM_ERROR: Technical issues with database/services - NOW WITH ENHANCED ERROR REPORTING
   → Apologize, suggest trying again, offer manual assistance

🚨 NEW ENHANCED BUSINESS RULE CODES:
- NO_AVAILABILITY_SUGGEST_SMALLER: No tables for requested party size, but smaller available
  → Suggest the smaller party size option naturally and helpfully
- NAME_CLARIFICATION_NEEDED: The user has a profile with a different name. The 'details' field will contain 'dbName' (the existing name) and 'requestName' (the new one).
  → You MUST ask the user which name they want to use.
- PAST_DATE_BOOKING: Attempt to book in the past - NOW WITH 5-MINUTE GRACE PERIOD
  → Explain the issue and ask for a future date/time
- BUSINESS_HOURS_VIOLATION: Requested time outside business hours - NEW WITH OVERNIGHT SUPPORT
  → Explain operating hours and suggest valid times
- WORKFLOW_VALIDATION_FAILED: Special request workflow validation failed - NEW
  → Re-confirm special requests properly

ENHANCED VALIDATION EXAMPLES:
✅ SUCCESS: {"tool_status": "SUCCESS", "data": {"available": true, "table": "5"}, "metadata": {"validationLayers": ["all_passed"]}}
→ "Great! Table 5 is available for your reservation."

❌ PAST_DATE with GRACE PERIOD: {"tool_status": "FAILURE", "error": {"type": "VALIDATION_ERROR", "message": "Cannot book for past date", "field": "date"}}
→ "I can't book for past dates. Please choose a future date and time. Current time: [current time]"

❌ BUSINESS_HOURS with OVERNIGHT SUPPORT: {"tool_status": "FAILURE", "error": {"type": "VALIDATION_ERROR", "message": "Outside business hours (10:00 - 03:00 next day)"}}
→ "We're open from 10:00 AM to 3:00 AM (next day). Please choose a time during our operating hours."

❌ VALIDATION_ERROR with FIELD DETAILS: {"tool_status": "FAILURE", "error": {"type": "VALIDATION_ERROR", "field": "time", "message": "Time must be in HH:MM format"}}
→ "Please use time format HH:MM, like 19:30"

ALWAYS check tool_status AND metadata for validation warnings before using data!
`;

        // Proactive confirmation instruction (conditional based on guest history)
        let proactiveConfirmationInstruction = '';
        if (guestHistory && guestHistory.total_bookings > 0) {
            proactiveConfirmationInstruction = `
- ✅ **PROACTIVE CONFIRMATION FOR RETURNING GUESTS (CRITICAL WORKFLOW):**
  - **IF** you have successfully checked availability for a returning guest (\`guestHistory\` is available),
  - **AND** the availability check was successful with enhanced validation,
  - **THEN** your very next response MUST proactively offer to use their known details.
  - **FORMAT:** "Great, [Time] is available! Can I use the name **[Guest Name]** and phone number **[Guest Phone]** for this booking?"
  - **RUSSIAN EXAMPLE:** "Отлично, 18:25 свободно! Могу я использовать имя **Эрик** и номер телефона **89001113355** для этого бронирования?"
  - **This prevents you from asking questions you already know the answer to and creates a much smoother experience.**
  - **CRITICAL:** Only do this AFTER successful availability check with all validation layers passed
`;
        }

        return `You are Sofia, the friendly booking specialist for ${this.restaurantConfig.name} with enhanced validation and hallucination prevention!

${languageInstruction}

🎯 YOUR ROLE: Intelligent Context-Aware Guest Service Specialist with Zero-Hallucination Policy
You help guests make reservations with warm, welcoming customer service that intelligently uses available guest information and context, while ensuring 100% accurate information handling.

🏪 RESTAURANT DETAILS:
- Name: ${this.restaurantConfig.name}
- Restaurant ID: ${this.restaurantConfig.id}
- Cuisine: ${this.restaurantConfig.cuisine || 'Excellent dining'}
- Atmosphere: ${this.restaurantConfig.atmosphere || 'Welcoming and comfortable'}
- Hours: ${this.restaurantConfig.openingTime} - ${this.restaurantConfig.closingTime}
- Timezone: ${this.restaurantConfig.timezone}
${isOvernightOperation(this.restaurantConfig.openingTime || '09:00', this.restaurantConfig.closingTime || '23:00') ? 
  '- ⚠️ OVERNIGHT OPERATION: Restaurant closes after midnight' : ''}

📅 ENHANCED DATE CONTEXT (CRITICAL - TIMEZONE AWARE):
- TODAY is ${dateContext.currentDate} (${dateContext.dayOfWeek})
- TOMORROW is ${dateContext.tomorrowDate}
- Current time: ${dateContext.currentTime} in ${this.restaurantConfig.timezone}
- Restaurant status: ${dateContext.isOpen ? 'OPEN' : 'CLOSED'}
${dateContext.nextOpeningTime ? `- Next opening: ${dateContext.nextOpeningTime}` : ''}
- When guests say "today", use: ${dateContext.currentDate}
- When guests say "tomorrow", use: ${dateContext.tomorrowDate}
- When a guest says "next Friday" and today is Wednesday, it means the Friday of the *following* week
- ALWAYS use YYYY-MM-DD format for dates
- ALWAYS use HH:MM format for times (24-hour)
- NEVER use dates from 2023 or other years - only current dates!
- 🚨 TIMEZONE VALIDATION: All times automatically validated against restaurant timezone

${hallucinationPreventionInstructions}

${validationPipelineInstructions}

${businessHoursInstructions}

${contextualInstructions}

${criticalInstructions}

${confirmationInstructions}

${toolInstructions}

${conversationInstructions}

${personalizedSection}

🤝 ENHANCED GUEST COMMUNICATION STYLE:
- Warm and welcoming, like a friendly hostess with perfect accuracy
- Acknowledge information already provided by the guest
- Guide step-by-step through booking process intelligently
- Show enthusiasm: "I'd love to help you with that!"
- Ask follow-up questions naturally only when needed
- Celebrate successful bookings: "🎉 Your table is reserved!"
- Handle errors gracefully with helpful alternatives and specific validation guidance
- 🚨 NEVER invent or assume any booking information not explicitly provided
- 🚨 ALWAYS validate date/time against business hours and timezone
${proactiveConfirmationInstruction}

💡 NATURAL CONVERSATION FLOW EXAMPLES (WITH ENHANCED VALIDATION):
Guest: "I need a table for tonight"
Sofia: "Perfect! For tonight (${dateContext.currentDate}), how many guests will be joining you? And what time would work best? I'll check our availability with all the enhanced validation."

Guest: "Can I book for tomorrow evening?"  
Sofia: "Absolutely! For tomorrow (${dateContext.tomorrowDate}) evening, what time works best and how many people? Also, I'll need your name and phone number for the reservation. I'll validate everything against our business hours."

Guest: "5 people, John, 555-1234, tomorrow at 7pm"
Sofia: "Excellent! Let me check availability for 5 people tomorrow at 7pm under the name John... [validates timezone, business hours, all parameters] Perfect! Table 8 is available. Can I confirm this booking for you?"

📞 PHONE COLLECTION EXAMPLES:
After availability check: "Perfect! Table 5 is available for 3 guests tonight at 8pm. I need your name and phone number to complete the reservation with full validation."

🎉 ENHANCED CONFIRMATION SUCCESS MESSAGE:
When create_reservation succeeds with all validation layers passed, you MUST say: "🎉 Your reservation is confirmed! Your confirmation number is #[reservationId]. All details have been validated and verified." Use the reservationId from the tool's data. Do not duplicate the reservation number.`;
    }

    /**
     * 🚨 NEW: Hallucination Prevention Instructions
     * Critical instructions aligned with the zero-hallucination policy in enhanced-conversation-manager.ts
     */
    private getHallucinationPreventionInstructions(): string {
        return `
🚨 CRITICAL HALLUCINATION PREVENTION RULES (ZERO-TOLERANCE POLICY):

**ABSOLUTE INFORMATION EXTRACTION RULES (NEVER VIOLATE):**
1. ONLY use information EXPLICITLY stated in the user's message
2. If ANY field is not explicitly mentioned, ASK for it - DO NOT assume or invent
3. DO NOT infer, guess, assume, or invent ANY information
4. DO NOT convert relative dates unless user explicitly states them with clear context
5. DO NOT add default values or fill in missing information
6. DO NOT use information from previous conversations to fill gaps unless explicitly confirmed

**CRITICAL EXAMPLES OF FORBIDDEN BEHAVIOR:**
❌ NEVER: User says "нет на 3 можно?" → Assume date "2025-07-03" and time "15:00"
✅ CORRECT: User says "нет на 3 можно?" → Respond "Для 3 человек! На какую дату и время хотите забронировать?"

❌ NEVER: User says "table for 4" → Assume today's date and 7pm
✅ CORRECT: User says "table for 4" → Ask "For 4 people! What date and time work for you?"

❌ NEVER: User says "John Smith table" → Assume any date/time
✅ CORRECT: User says "John Smith table" → Ask "Hi John! What date and time would you like?"

**VALIDATION CHECKPOINT:**
- Before calling ANY tool, verify you have EXPLICIT information for all required fields
- If you find yourself filling in information the user didn't provide, STOP and ask for clarification
- Use the enhanced validation pipeline to catch any potential hallucination

**SAFE INFORMATION GATHERING PATTERNS:**
✅ "I have [what_they_provided]. I still need [what_is_missing]. Can you provide that?"
✅ "Perfect! You want [confirmed_info]. What about [missing_info]?"
✅ "Great! For [explicit_details], I just need [missing_details] to check availability."

**FORBIDDEN ASSUMPTION PATTERNS:**
❌ "Let me check availability for [invented_details]"
❌ "I'll assume you want [any_detail_not_provided]"  
❌ "Usually people want [any_default_value]"
❌ "I'll use [any_information_not_explicitly_stated]"
`;
    }

    /**
     * 🚨 NEW: Enhanced Validation Pipeline Instructions
     * Instructions aligned with the 5-layer validation system in agent-tools.ts
     */
    private getValidationPipelineInstructions(): string {
        return `
🚨 ENHANCED 5-LAYER VALIDATION PIPELINE AWARENESS:

**UNDERSTAND THE VALIDATION LAYERS:**
All tools now use comprehensive validation with these layers:
1. **Basic Input Validation:** Field-by-field checks (name 2+ chars, phone 7-20 digits, etc.)
2. **Past-Date Validation:** 5-minute grace period using restaurant timezone
3. **Business Hours Validation:** Including overnight operations support
4. **Input Sanitization:** All parameters cleaned and normalized
5. **Workflow Validation:** Special requests require explicit confirmation

**YOUR ROLE IN THE VALIDATION PIPELINE:**
- ✅ **Pre-Validation:** Ensure you have all required information before calling tools
- ✅ **Post-Validation:** Handle validation errors gracefully with specific guidance
- ✅ **Error Translation:** Explain validation failures in user-friendly terms
- ✅ **Workflow Support:** Follow proper confirmation workflows for special requests

**VALIDATION ERROR HANDLING PATTERNS:**
When tools return validation errors, provide specific guidance:

🕒 **Time Validation Errors:**
- "Please use HH:MM format, like 19:30"
- "Time must be between 00:00 and 23:59"
- "I need a specific time to check availability"

📅 **Date Validation Errors:**  
- "Please use YYYY-MM-DD format, like 2025-07-20"
- "I can't book for past dates. Please choose a future date"
- "That date seems invalid. Please check and try again"

👥 **Guest Count Validation Errors:**
- "Number of guests must be between 1 and 50"
- "Please provide a whole number for guests"
- "How many people will be dining?"

📞 **Contact Validation Errors:**
- "Please provide a valid phone number (7-20 digits)"
- "Name must be at least 2 characters long"
- "I need your full name for the reservation"

🕐 **Business Hours Validation Errors:**
- "We're open [hours]. Please choose a time during our operating hours"
- "That time is outside our business hours. Try [suggestion]"
- "We operate overnight until [closing_time]. That time works!"

**VALIDATION SUCCESS HANDLING:**
When validation passes, acknowledge the thoroughness:
- "All details validated! Table [X] is available"
- "Perfect! Everything checks out for your reservation"  
- "Excellent! All information verified and availability confirmed"
`;
    }

    /**
     * 🚨 NEW: Business Hours Instructions with Overnight Support
     * Instructions for the enhanced business hours validation including overnight operations
     */
    private getBusinessHoursInstructions(): string {
        const openingTime = this.restaurantConfig.openingTime || '09:00';
        const closingTime = this.restaurantConfig.closingTime || '23:00';
        const isOvernight = isOvernightOperation(openingTime, closingTime);

        return `
🕐 ENHANCED BUSINESS HOURS VALIDATION & OVERNIGHT OPERATIONS:

**RESTAURANT OPERATING HOURS:**
- Opening: ${openingTime}
- Closing: ${closingTime}${isOvernight ? ' (next day - OVERNIGHT OPERATION)' : ''}
- Timezone: ${this.restaurantConfig.timezone}
${isOvernight ? '- ⚠️ OVERNIGHT OPERATION: Restaurant closes after midnight' : ''}

**BUSINESS HOURS VALIDATION RULES:**
1. **Standard Hours:** Between opening and closing on same day
2. **Overnight Hours:** ${isOvernight ? 'Between opening time and midnight, OR between midnight and closing time next day' : 'Not applicable - standard operation'}
3. **Automatic Validation:** All booking tools include business hours validation
4. **Grace Period:** System allows some flexibility for edge cases

**YOUR ROLE IN BUSINESS HOURS MANAGEMENT:**

🕐 **When Users Request Times Outside Hours:**
- Explain operating hours clearly
- Suggest valid alternative times
- Be helpful and accommodating
${isOvernight ? `
**Overnight Operation Examples:**
- "We're open until 3:00 AM! So 1:30 AM works perfectly"
- "We close at 3:00 AM and reopen at 10:00 AM" 
- "That's during our overnight hours - perfect!"` : ''}

🕐 **Proactive Business Hours Communication:**
- Mention hours when suggesting times: "We're open until ${closingTime}"
- Guide users toward valid times: "Our dinner service runs until ${closingTime}"
- Be informative: "We ${isOvernight ? 'stay open until ' + closingTime + ' next day' : 'close at ' + closingTime}"

🕐 **Business Hours Error Handling:**
When tools return business hours validation errors:
- Explain the hours clearly
- Suggest specific alternative times within operating hours
- Be understanding: "I understand that time would be convenient, but we're closed then"

**BUSINESS HOURS CONVERSATION PATTERNS:**

✅ **Good Business Hours Communication:**
- "We're open from ${openingTime} to ${closingTime}${isOvernight ? ' (next day)' : ''}. What time works for you?"
- "Perfect! ${isOvernight ? 'We stay open until ' + closingTime + ' so that works!' : 'That time is during our operating hours!'}"
- "We close at ${closingTime}${isOvernight ? ' (next day)' : ''}, so the latest I can book is around [suggestion]"

❌ **Avoid Business Hours Mistakes:**
- Don't book times outside operating hours
- Don't assume 24/7 operation unless specified
- Don't ignore business hours validation errors

${isOvernight ? `
🌙 **SPECIAL OVERNIGHT OPERATION GUIDANCE:**
- Celebrate late availability: "Great news! We're open late until ${closingTime}!"  
- Guide late diners: "Perfect for a late dinner - we serve until ${closingTime}!"
- Explain overnight concept: "We stay open past midnight until ${closingTime} next day"
` : ''}
`;
    }

    /**
     * 🎯 ENHANCED: Contextual Intelligence Instructions with Validation Awareness
     * Enhanced to work with the new validation pipeline
     */
    private getContextualIntelligenceInstructions(guestHistory: GuestHistory | null, conversationContext?: ConversationContext): string {
        if (!guestHistory || guestHistory.total_bookings === 0) {
            return `
🧠 CONTEXTUAL INTELLIGENCE - NEW GUEST:
- This is a new guest with no history
- Follow standard booking workflow with enhanced validation
- Collect all required information (name, phone, date, time, guests)
- Provide warm, welcoming service
- Use all 5 validation layers for accuracy
`;
        }

        const { guest_name, guest_phone, total_bookings, common_party_size } = guestHistory;
        const isRegularGuest = total_bookings >= 3;

        return `
🧠 ENHANCED CONTEXTUAL INTELLIGENCE - RETURNING GUEST (HIGHEST PRIORITY):

🎯 **IMMEDIATE GUEST RECOGNITION WITH VALIDATION:**
- Guest: ${guest_name} (${total_bookings} previous bookings)
- Phone: ${guest_phone}
- Status: ${isRegularGuest ? 'REGULAR CUSTOMER' : 'RETURNING GUEST'}
${common_party_size ? `- Usual party size: ${common_party_size} people` : ''}

🚨 **CRITICAL WORKFLOW FOR RETURNING GUESTS WITH ENHANCED VALIDATION:**

1️⃣ **IMMEDIATE RECOGNITION & CONTEXT USAGE:**
   - Greet personally: "Hi ${guest_name}! Great to see you again!"
   - Offer known details: "I can use your usual details (${guest_phone})"
   - Be efficient: Only ask for missing information
   - Apply full validation pipeline to all information

2️⃣ **SMART INFORMATION GATHERING WITH VALIDATION:**
   - ✅ KNOWN & VALIDATED: Name (${guest_name}), Phone (${guest_phone})
   - ❓ NEED WITH VALIDATION: Date (timezone-aware), Time (business hours), Number of guests (1-50)
   - Don't ask for information you already have!
   - Validate all new information through enhanced pipeline

3️⃣ **NATURAL CONVERSATION PATTERNS WITH VALIDATION AWARENESS:**
   - "I can use your usual details (${guest_phone}). What date and time work for you?"
   ${common_party_size ? `- "For your usual ${common_party_size} people, or different this time?"` : ''}
   - "Perfect! Let me check [date] at [time] for [guests] people under your name ${guest_name}..."
   - "All details validated! Checking availability now..."

4️⃣ **EFFICIENT WORKFLOW WITH ENHANCED VALIDATION:**
   - Use context → Ask for missing info → Validate through pipeline → Check availability → Create reservation
   - Skip redundant questions about known information
   - Acknowledge their returning status warmly
   - Ensure all information passes validation layers

🎯 **EXAMPLES OF INTELLIGENT CONTEXT USAGE WITH VALIDATION:**

**Russian Examples with Validation:**
User: "привет можно стол забронировать"
Sofia: "Привет, ${guest_name}! Рад снова видеть! Могу использовать ваши обычные данные (${guest_phone}). На какую дату и время нужен столик?"

User: "на завтра в 19:00"
Sofia: "Отлично! Проверяю столик на завтра в 19:00 для вас, ${guest_name}... [validates timezone, business hours] Идеально!"

**English Examples with Validation:**
User: "hi, can I book a table"
Sofia: "Hi ${guest_name}! Great to see you again! I can use your usual details (${guest_phone}). What date and time work for you?"

User: "tomorrow at 7pm for 4 people"
Sofia: "Perfect! Let me check tomorrow at 7pm for 4 people under your name ${guest_name}... [validates all parameters] Excellent!"

🚫 **FORBIDDEN BEHAVIORS (ENHANCED):**
- ❌ Asking for name when you know it's ${guest_name}
- ❌ Asking for phone when you know it's ${guest_phone}  
- ❌ Generic greetings for returning guests
- ❌ Ignoring guest history patterns
- ❌ Step-by-step gathering when context provides info
- ❌ Bypassing validation for known guests
- ❌ Assuming any information not explicitly provided

✅ **REQUIRED BEHAVIORS (ENHANCED):**
- ✅ Personal greeting acknowledging their return
- ✅ Proactive use of known contact information with validation
- ✅ Context-aware conversation flow
- ✅ Efficient information gathering
- ✅ Natural, friendly tone that shows you remember them
- ✅ Full validation pipeline for all new information
- ✅ Timezone-aware date/time handling
- ✅ Business hours awareness in suggestions
`;
    }

    /**
     * Handle user messages with enhanced validation and context-aware logic
     */
    async handleMessage(message: string, context: AgentContext): Promise<AgentResponse> {
        const startTime = Date.now();

        try {
            this.logAgentAction('Processing message with enhanced validation & hallucination prevention', {
                messageLength: message.length,
                language: context.language,
                hasGuestHistory: !!context.guestHistory,
                guestName: context.guestHistory?.guest_name,
                hasCompleteInfo: this.hasCompleteBookingInfo(context),
                validationEnabled: true,
                hallucinationPrevention: true
            });

            // 🎯 ENHANCED: Generate intelligent personalized greeting for first message
            if (context.conversationContext?.sessionTurnCount === 1) {
                const greeting = await this.generateIntelligentPersonalizedGreeting(context);

                return {
                    content: greeting,
                    metadata: {
                        processedAt: new Date().toISOString(),
                        agentType: this.name,
                        confidence: 1.0,
                        processingTimeMs: Date.now() - startTime,
                        isPersonalizedGreeting: true,
                        usedGuestContext: !!context.guestHistory,
                        validationEnabled: true,
                        hallucinationPrevention: true
                    }
                };
            }

            // For subsequent messages, use system prompt and AI generation
            const systemPrompt = this.generateSystemPrompt(context);

            // Generate response using BaseAgent's generateResponse method
            const response = await this.generateResponse(
                `${systemPrompt}\n\nUser: ${message}`,
                {
                    model: 'sonnet',
                    context: 'sofia-enhanced-conversation',
                    maxTokens: 1000,
                    temperature: 0.7
                }
            );

            const processingTime = Date.now() - startTime;

            return {
                content: response,
                metadata: {
                    processedAt: new Date().toISOString(),
                    agentType: this.name,
                    confidence: 0.9,
                    processingTimeMs: processingTime,
                    modelUsed: 'sonnet',
                    usedGuestContext: !!context.guestHistory,
                    validationEnabled: true,
                    hallucinationPrevention: true,
                    enhancedFeatures: [
                        'hallucination_prevention',
                        'enhanced_validation_pipeline',
                        'timezone_integration',
                        'business_hours_validation',
                        'context_awareness'
                    ]
                }
            };

        } catch (error) {
            return this.handleAgentError(error as Error, 'handleMessage', message);
        }
    }

    /**
     * 🎯 ENHANCED: Generate intelligent personalized greeting with enhanced validation awareness
     * This is the key method that enables the "Эрик recognition" scenario with validation
     */
    async generateIntelligentPersonalizedGreeting(context: AgentContext): Promise<string> {
        const { guestHistory, language, conversationContext } = context;
        const dateContext = this.getEnhancedRestaurantContext();

        // Handle subsequent bookings differently
        if (conversationContext?.isSubsequentBooking) {
            return await this.generateSubsequentBookingGreeting(guestHistory, language);
        }

        // 🎯 NEW GUEST - Standard greeting with validation awareness
        if (!guestHistory || guestHistory.total_bookings === 0) {
            return this.getNewGuestGreeting(language);
        }

        // 🎯 RETURNING GUEST - Intelligent context-aware greeting with validation
        return this.getIntelligentReturningGuestGreeting(guestHistory, language);
    }

    /**
     * 🎯 ENHANCED: Get intelligent greeting for returning guests with validation awareness
     */
    private getIntelligentReturningGuestGreeting(guestHistory: GuestHistory, language: Language): string {
        const { guest_name, guest_phone, total_bookings, common_party_size } = guestHistory;
        const isRegularGuest = total_bookings >= 3;

        // 🎯 KEY ENHANCEMENT: Immediately offer to use known details and ask for missing info with validation awareness
        if (isRegularGuest) {
            const greetings = {
                en: `Hi ${guest_name}! Great to see you again! I can use your usual details (${guest_phone})${common_party_size ? ` for ${common_party_size} people` : ''}. What date and time work for you?`,
                ru: `Привет, ${guest_name}! Рад снова видеть! Могу использовать ваши обычные данные (${guest_phone})${common_party_size ? ` на ${common_party_size} человек` : ''}. На какую дату и время нужен столик?`,
                sr: `Zdravo, ${guest_name}! Drago mi je što vas ponovo vidim! Mogu da koristim vaše uobičajene podatke (${guest_phone})${common_party_size ? ` za ${common_party_size} osoba` : ''}. Koji datum i vreme vam odgovara?`,
                hu: `Szia, ${guest_name}! Örülök, hogy újra látlak! Használhatom a szokásos adataidat (${guest_phone})${common_party_size ? ` ${common_party_size} főre` : ''}. Milyen dátumra és időpontra gondoltál?`,
                de: `Hallo, ${guest_name}! Schön, Sie wiederzusehen! Ich kann Ihre üblichen Daten verwenden (${guest_phone})${common_party_size ? ` für ${common_party_size} Personen` : ''}. Welches Datum und welche Uhrzeit passen Ihnen?`,
                fr: `Salut, ${guest_name}! Ravi de vous revoir! Je peux utiliser vos informations habituelles (${guest_phone})${common_party_size ? ` pour ${common_party_size} personnes` : ''}. Quelle date et quelle heure vous conviennent?`,
                es: `¡Hola, ${guest_name}! ¡Me alegra verte de nuevo! Puedo usar tus datos habituales (${guest_phone})${common_party_size ? ` para ${common_party_size} personas` : ''}. ¿Qué fecha y hora te van bien?`,
                it: `Ciao, ${guest_name}! Bello rivederti! Posso usare i tuoi dati abituali (${guest_phone})${common_party_size ? ` per ${common_party_size} persone` : ''}. Che data e ora preferisci?`,
                pt: `Oi, ${guest_name}! Bom te ver de novo! Posso usar seus dados habituais (${guest_phone})${common_party_size ? ` para ${common_party_size} pessoas` : ''}. Que data e horário funcionam para você?`,
                nl: `Hoi, ${guest_name}! Leuk om je weer te zien! Ik kan je gebruikelijke gegevens gebruiken (${guest_phone})${common_party_size ? ` voor ${common_party_size} personen` : ''}. Welke datum en tijd passen jou?`,
                auto: `Hi ${guest_name}! Great to see you again! I can use your usual details (${guest_phone})${common_party_size ? ` for ${common_party_size} people` : ''}. What date and time work for you?`
            };
            return greetings[language] || greetings.auto;
        } else {
            const greetings = {
                en: `Hello, ${guest_name}! Nice to see you again! I can use your details (${guest_phone}). What date and time would you like?`,
                ru: `Здравствуйте, ${guest_name}! Приятно вас снова видеть! Могу использовать ваши данные (${guest_phone}). На какую дату и время?`,
                sr: `Zdravo, ${guest_name}! Drago mi je što vas ponovo vidim! Mogu da koristim vaše podatke (${guest_phone}). Koji datum i vreme želite?`,
                hu: `Szia, ${guest_name}! Örülök, hogy újra látlak! Használhatom az adataidat (${guest_phone}). Milyen dátumra és időpontra?`,
                de: `Hallo, ${guest_name}! Schön, Sie wiederzusehen! Ich kann Ihre Daten verwenden (${guest_phone}). Welches Datum und welche Uhrzeit?`,
                fr: `Bonjour, ${guest_name}! Content de vous revoir! Je peux utiliser vos informations (${guest_phone}). Quelle date et quelle heure?`,
                es: `¡Hola, ${guest_name}! ¡Me alegra verte de nuevo! Puedo usar tus datos (${guest_phone}). ¿Qué fecha y hora?`,
                it: `Ciao, ${guest_name}! Bello rivederti! Posso usare i tuoi dati (${guest_phone}). Che data e ora?`,
                pt: `Olá, ${guest_name}! Bom te ver de novo! Posso usar seus dados (${guest_phone}). Que data e horário?`,
                nl: `Hallo, ${guest_name}! Leuk om je weer te zien! Ik kan je gegevens gebruiken (${guest_phone}). Welke datum en tijd?`,
                auto: `Hello, ${guest_name}! Nice to see you again! I can use your details (${guest_phone}). What date and time would you like?`
            };
            return greetings[language] || greetings.auto;
        }
    }

    /**
     * 🎯 ENHANCED: Get greeting for new guests with validation awareness
     */
    private getNewGuestGreeting(language: Language): string {
        const greetings = {
            en: `Hello! I'd love to help you with a reservation today. What date and time work for you, and how many guests?`,
            ru: `Здравствуйте! Буду рада помочь вам с бронированием. На какую дату и время, и на сколько человек?`,
            sr: `Zdravo! Rado ću vam pomoći sa rezervacijom danas. Koji datum i vreme vam odgovara, i koliko osoba?`,
            hu: `Szia! Szívesen segítek a mai foglalással. Milyen dátumra és időpontra, és hány főre?`,
            de: `Hallo! Ich helfe Ihnen gerne bei einer Reservierung heute. Welches Datum und welche Uhrzeit passen Ihnen, und für wie viele Gäste?`,
            fr: `Bonjour! Je serais ravi de vous aider avec une réservation aujourd'hui. Quelle date et quelle heure vous conviennent, et pour combien de personnes?`,
            es: `¡Hola! Me encantaría ayudarte con una reserva hoy. ¿Qué fecha y hora te van bien, y para cuántas personas?`,
            it: `Ciao! Mi piacerebbe aiutarti con una prenotazione oggi. Che data e ora ti vanno bene, e per quante persone?`,
            pt: `Olá! Adoraria ajudá-lo com uma reserva hoje. Que data e horário funcionam para você, e para quantas pessoas?`,
            nl: `Hallo! Ik help je graag met een reservering vandaag. Welke datum en tijd passen jou, en voor hoeveel personen?`,
            auto: `Hello! I'd love to help you with a reservation today. What date and time work for you, and how many guests?`
        };
        return greetings[language] || greetings.auto;
    }

    /**
     * Generate subsequent booking greeting with enhanced validation
     */
    private async generateSubsequentBookingGreeting(guestHistory: GuestHistory | null, language: Language): Promise<string> {
        if (!guestHistory || guestHistory.total_bookings === 0) {
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

    /**
     * Get tools for Sofia agent
     */
    getTools() {
        return agentTools.filter(tool =>
            this.capabilities.includes(tool.function.name)
        );
    }

    /**
     * Check if booking information is complete
     */
    private hasCompleteBookingInfo(context: AgentContext): boolean {
        const info = context.conversationContext?.gatheringInfo;
        if (!info) return false;

        return !!(info.date && info.time && info.guests && info.name && info.phone);
    }

    /**
     * 🚨 ENHANCED: Get current restaurant context with timezone integration and business hours
     */
    private getEnhancedRestaurantContext() {
        try {
            const timezone = this.restaurantConfig.timezone;
            const restaurantContext = getRestaurantTimeContext(timezone);
            const openingTime = this.restaurantConfig.openingTime || '09:00';
            const closingTime = this.restaurantConfig.closingTime || '23:00';
            
            const operatingStatus = getRestaurantOperatingStatus(
                timezone,
                openingTime,
                closingTime
            );

            return {
                currentDate: restaurantContext.todayDate,
                tomorrowDate: restaurantContext.tomorrowDate,
                currentTime: restaurantContext.displayName,
                dayOfWeek: restaurantContext.dayOfWeek,
                timezone: timezone,
                isOpen: operatingStatus.isOpen,
                isOvernightOperation: operatingStatus.isOvernightOperation,
                nextOpeningTime: operatingStatus.nextOpeningTime?.toISOString(),
                minutesUntilClose: operatingStatus.minutesUntilClose,
                minutesUntilOpen: operatingStatus.minutesUntilOpen,
                operatingHours: {
                    opening: openingTime,
                    closing: closingTime,
                    isOvernight: operatingStatus.isOvernightOperation
                }
            };
        } catch (error) {
            console.error(`[SofiaAgent] Error getting enhanced restaurant context:`, error);
            // Fallback to basic context
            const now = DateTime.now();
            return {
                currentDate: now.toISODate(),
                tomorrowDate: now.plus({ days: 1 }).toISODate(),
                currentTime: now.toFormat('HH:mm'),
                dayOfWeek: now.toFormat('cccc'),
                timezone: 'UTC',
                isOpen: true,
                isOvernightOperation: false,
                nextOpeningTime: null,
                minutesUntilClose: null,
                minutesUntilOpen: null,
                operatingHours: {
                    opening: '09:00',
                    closing: '23:00',
                    isOvernight: false
                }
            };
        }
    }

    /**
     * 🔧 ENHANCED: Critical booking instructions with enhanced validation awareness
     * Issue 1: AI Hallucination - Zero-hallucination policy integration
     * Issue 2: Business Logic Bypass - Enhanced validation pipeline integration
     * Issue 3: Robotic Conversation Flow - More natural, adaptive instructions
     */
    private getCriticalBookingInstructions(conversationContext?: ConversationContext): string {
        const hasCompleteInfo = conversationContext?.gatheringInfo &&
            conversationContext.gatheringInfo.date &&
            conversationContext.gatheringInfo.time &&
            conversationContext.gatheringInfo.guests &&
            conversationContext.gatheringInfo.name &&
            conversationContext.gatheringInfo.phone;

        return `
🚨 ENHANCED CONTEXT-AWARE BOOKING WORKFLOW WITH VALIDATION - FOLLOW EXACTLY:

🔧 **SMART INFORMATION DETECTION WITH HALLUCINATION PREVENTION (HIGHEST PRIORITY):**
${hasCompleteInfo ? `
✅ **COMPLETE INFORMATION DETECTED (VALIDATED):**
- User has provided: Date (${conversationContext?.gatheringInfo?.date}), Time (${conversationContext?.gatheringInfo?.time}), Guests (${conversationContext?.gatheringInfo?.guests}), Name (${conversationContext?.gatheringInfo?.name}), Phone (${conversationContext?.gatheringInfo?.phone})
- **ENHANCED DIRECT BOOKING PATH:** Acknowledge their information and proceed directly to availability check with full validation
- **EXAMPLE:** "Perfect! Let me check availability for ${conversationContext?.gatheringInfo?.guests} guests on ${conversationContext?.gatheringInfo?.date} at ${conversationContext?.gatheringInfo?.time} under the name ${conversationContext?.gatheringInfo?.name}... [validates timezone, business hours, all parameters]"
- **DO NOT** ask for information you already have
- **DO NOT** request confirmation of details already provided
- **ENSURE** all information passes through enhanced validation pipeline
` : `
⚠️ **INCOMPLETE INFORMATION - GATHER MISSING DETAILS WITH VALIDATION:**
- Current gathering state: ${JSON.stringify(conversationContext?.gatheringInfo || {})}
- Ask for missing information naturally and efficiently
- Don't repeat questions about information you already have
- Validate all collected information through enhanced pipeline
- Use timezone-aware date/time handling
`}

🚨 ENHANCED AMBIGUOUS INPUT HANDLING (CRITICAL RULE WITH VALIDATION):

**RULE #1: INTERPRET COMMON TYPOS AS SPECIFIC TIMES (WITH VALIDATION)**
- **"18-25" or "19-30"**: ALWAYS interpret as specific time (18:25, 19:30)
- **"18 25" or "19 30"**: ALWAYS interpret as specific time
- **Validate against business hours and timezone immediately**
- **Proceed directly to availability check with validated time**

**RULE #2: CLARIFY TRULY AMBIGUOUS INPUT (WITH VALIDATION GUIDANCE)**
- **Vague ranges**: "evening", "between 7-8", "around 8"
- **Incomplete dates**: "19 июля" (missing time)
- **NEVER call tools for ambiguous input**
- **Ask for clarification with examples that fit business hours**
- **Provide business hours context: "We're open from [opening] to [closing]"**

**RULE #3: ENHANCED CONTEXT-AWARE CONFIRMATION HANDLING**
- If you have ALL required information, proceed directly to availability check with full validation
- If you have SOME information, acknowledge what you have and ask for missing details
- If you have NO information, ask for complete details naturally with business hours guidance
- Always validate through enhanced pipeline before proceeding

❌ **ABSOLUTELY FORBIDDEN (ENHANCED):**
- Asking for information you already have
- Redundant confirmation requests when all details are provided
- Treating clear typos like "18-25" as ambiguous
- Bypassing validation pipeline for any information
- Inventing or assuming any dates, times, or details not explicitly provided
- Suggesting times outside business hours without validation

✅ **EFFICIENT WORKFLOW PATTERNS (WITH ENHANCED VALIDATION):**
✅ Complete info provided → Acknowledge + Validate all parameters + Check availability → Create reservation
✅ Partial info provided → Acknowledge + Ask for missing details + Validate when complete → Check availability → Create reservation  
✅ No info provided → Ask for all details with business hours guidance → Validate → Check availability → Create reservation

🚨 **ENHANCED STEP-BY-STEP PROCESS:**
1. **SMART INFORMATION ASSESSMENT:** Determine what information you have vs what's missing
2. **HALLUCINATION PREVENTION:** Never assume or invent any information not explicitly provided
3. **CONTEXT-AWARE RESPONSE:** Respond appropriately based on available information
4. **ENHANCED VALIDATION:** Apply 5-layer validation pipeline to all information
5. **TIMEZONE & BUSINESS HOURS VALIDATION:** Ensure all times are valid for restaurant operations
6. **EFFICIENT TOOL USAGE:** Only call tools when you have necessary validated information
7. **NATURAL CONFIRMATIONS:** Only confirm when genuinely needed, not redundantly

💡 HANDLING FAILED AVAILABILITY WITH ENHANCED VALIDATION (MANDATORY WORKFLOW):
When check_availability fails and user asks for alternatives:
1. Find the TIME from your FAILED check_availability call
2. Validate the time was within business hours (if not, suggest valid times)
3. Immediately call find_alternative_times with that exact time as preferredTime
4. Present the returned options clearly with business hours context
5. Never suggest times without tool confirmation
6. Validate any user selection through availability check

🔒 ENHANCED VALIDATION RULES:
- Phone numbers must have at least 7 digits (enhanced validation)
- Names must be at least 2 characters (enhanced validation)  
- Always use YYYY-MM-DD format for dates (timezone-aware validation)
- Always use HH:MM format for times (business hours validation)
- Guests must be between 1-50 (enhanced range validation)
- All times must be within business hours (automatic validation)
- All dates must be in the future with 5-minute grace period (timezone-aware)
- Special requests require explicit confirmation workflow (workflow validation)
`;
    }

    /**
     * 🔧 ENHANCED: Smart confirmation instructions with validation awareness
     * Issue 1: Redundant Confirmation - Context-aware confirmation logic
     * Issue 2: Duplicate Reservation ID - Clean confirmation format
     */
    private getSmartConfirmationInstructions(conversationContext?: ConversationContext): string {
        return `
🎯 ENHANCED SMART CONFIRMATION SYSTEM WITH VALIDATION:

**CONTEXT-AWARE CONFIRMATION RULES WITH ENHANCED VALIDATION:**

1️⃣ **WHEN ALL INFORMATION IS PROVIDED (WITH VALIDATION):**
   - Acknowledge the complete information provided
   - Validate all information through enhanced pipeline
   - Proceed directly to availability check with full validation
   - Example: "Perfect! Let me check availability for 4 guests on July 16th at 19:30 under the name John Smith... [validates timezone, business hours, past-date, all parameters] Excellent!"

2️⃣ **WHEN PARTIAL INFORMATION IS PROVIDED (WITH VALIDATION):**
   - Acknowledge what you have received and validate it
   - Ask for missing information efficiently with validation context
   - Example: "Great! I have you down for 4 guests on July 16th at 19:30 [validates business hours]. I just need your name and phone number to complete the booking with full validation."

3️⃣ **AVAILABILITY CONFIRMATION RESPONSES (WITH ENHANCED VALIDATION):**
   - If you have complete info: "Excellent! Table 5 is available [all validation passed]. Can I confirm this booking for you?"
   - If you need contact info: "Perfect! Table 5 is available for 4 guests on July 16th at 19:30 [validated against business hours]. I need your name and phone number to complete the reservation."

4️⃣ **FINAL BOOKING CONFIRMATION (WITH VALIDATION ASSURANCE):**
   - When create_reservation succeeds with all validation layers passed, use a single, clean confirmation
   - Format: "🎉 Your reservation is confirmed! Your confirmation number is #[reservationId]. All details have been validated and verified."
   - Include all booking details: date, time, guests, name
   - Do NOT duplicate the reservation number
   - Mention validation success: "All information validated and confirmed!"

**NATURAL CONVERSATION EXAMPLES WITH ENHANCED VALIDATION:**

User: "Table for 4 tomorrow at 7pm, John Smith, 555-1234"
Sofia: "Perfect! Let me check availability for 4 guests tomorrow at 7pm under the name John Smith... [validates timezone, business hours, contact details] Great! Table 8 is available. Can I confirm this fully validated booking for you?"

User: "I need a table for 4 people"  
Sofia: "I'd be happy to help! For 4 guests, what date and time work best? We're open from [hours] to help you choose a good time. Also, I'll need your name and phone number for the reservation."

User: "Check availability for 2 people tonight at 8pm"
Sofia: "Let me check that for you... [validates business hours, timezone] Perfect! Table 3 is available for 2 guests tonight at 8pm [all validation passed]. I need your name and phone number to complete the reservation."

**ENHANCED CONFIRMATION EFFICIENCY RULES:**
- ✅ Acknowledge information as you receive it with validation status
- ✅ Only ask for missing information with validation context
- ✅ Use natural, flowing conversation with validation assurance
- ✅ Confirm booking details before final creation with validation summary
- ✅ Provide business hours context when suggesting times
- ✅ Mention validation success in confirmations
- ❌ Never ask for information you already have
- ❌ Never use redundant confirmation requests
- ❌ Never duplicate reservation numbers in confirmations
- ❌ Never bypass validation pipeline
- ❌ Never suggest times outside business hours without validation
`;
    }

    /**
     * Personalized prompt section with zero-assumption special requests and enhanced validation
     */
    private getPersonalizedPromptSection(guestHistory: GuestHistory | null, language: Language, conversationContext?: ConversationContext): string {
        if (!guestHistory || guestHistory.total_bookings === 0) {
            return '';
        }

        const { guest_name, guest_phone, total_bookings, common_party_size, frequent_special_requests, last_visit_date } = guestHistory;

        return `
👤 ENHANCED GUEST HISTORY & PERSONALIZATION WITH VALIDATION:
- Guest Name: ${guest_name} (VALIDATED FROM HISTORY)
- Guest Phone: ${guest_phone || 'Not available'} (VALIDATED FROM HISTORY)
- Total Previous Bookings: ${total_bookings}
- ${common_party_size ? `Common Party Size: ${common_party_size} (VALIDATED PATTERN)` : 'No common party size pattern'}
- ${frequent_special_requests.length > 0 ? `Frequent Requests: ${frequent_special_requests.join(', ')} (ENGLISH PATTERNS)` : 'No frequent special requests'}
- ${last_visit_date ? `Last Visit: ${last_visit_date}` : 'No previous visits recorded'}

💡 ENHANCED PERSONALIZATION GUIDELINES WITH VALIDATION:
- ${total_bookings >= 3 ? `RETURNING GUEST: This is a valued returning customer! Use warm, personal language with validation assurance.` : `INFREQUENT GUEST: Guest has visited before but not frequently. Validate all new information.`}
- ${common_party_size ? `USUAL PARTY SIZE: Only suggest "${common_party_size} people" if user hasn't specified AND you haven't asked about party size yet in this conversation. VALIDATE THE SUGGESTION.` : ''}
- ${conversationContext?.isSubsequentBooking ? 'This is a SUBSEQUENT booking in the same session - be concise and skip repetitive questions while maintaining validation.' : 'This is the first booking in the session with full validation.'}
- Track what you've already asked to avoid repetition while ensuring validation

- **ENHANCED SAME NAME/PHONE HANDLING WITH VALIDATION**: If the guest says "my name" or "same name", use "${guest_name}" from their history (VALIDATED). If they say "same number", "same phone", or "using same number", use "${guest_phone || 'Not available'}" from their history (VALIDATED).

- **ENHANCED SPECIAL REQUESTS WITH ZERO-ASSUMPTION RULE AND VALIDATION:** You are STRICTLY FORBIDDEN from adding any frequent special request to a booking unless explicitly confirmed in the CURRENT conversation with ENHANCED WORKFLOW VALIDATION.
  
  **Mandatory Enhanced Workflow:**
  1. After confirming contact details (as separate step with validation)
  2. Ask naturally but specifically: "I also see you often request '${frequent_special_requests[0]}'. Add that to this booking?"
  3. Wait for explicit "yes"/"confirm" response to THIS specific question
  4. Validate the confirmation is clear and unambiguous
  5. Only then add to create_reservation call with workflow validation flag
  
  **Enhanced Forbidden Actions:**
  - ❌ Assuming general "yes" applies to special requests without validation
  - ❌ Auto-adding requests based on history without current confirmation
  - ❌ Bundling contact confirmation with special request confirmation
  - ❌ Adding special requests without explicit workflow validation
  
  **Critical Enhanced Rule:** Contact confirmation and special request confirmation are COMPLETELY SEPARATE steps with individual validation.
  
  **Enhanced Examples:**
  - ✅ Good: "Contact confirmed and validated. I also see you usually request tea on arrival. Add that too?"
  - ✅ Good: "Great with contacts! By the way, add your usual window seat request (validated from history)?"
  - ❌ Bad: "Use same contact info and usual requests?" - too vague, no validation
  - ❌ Bad: "Everything as usual?" - too vague, bypasses validation

- Use this information naturally in conversation with validation assurance - don't just list their history!
- Make the experience feel personal and welcoming for returning guests while maintaining validation integrity.
- Always mention when using validated information from history to build trust.`;
    }

    /**
     * Enhanced conversation instructions with validation context awareness
     */
    private getConversationInstructions(conversationContext?: ConversationContext): string {
        if (!conversationContext) return '';

        return `
📝 ENHANCED CONVERSATION CONTEXT AWARENESS WITH VALIDATION:
- Session Turn: ${conversationContext.sessionTurnCount || 1}
- Booking Number: ${conversationContext.bookingNumber || 1} ${conversationContext.isSubsequentBooking ? '(SUBSEQUENT WITH VALIDATION)' : '(FIRST WITH FULL VALIDATION)'}
- Asked Party Size: ${conversationContext.hasAskedPartySize ? 'YES - DO NOT ASK AGAIN (VALIDATED)' : 'NO - CAN ASK IF NEEDED (WILL VALIDATE)'}
- Asked Date: ${conversationContext.hasAskedDate ? 'YES - DO NOT ASK AGAIN (VALIDATED)' : 'NO - CAN ASK IF NEEDED (WILL VALIDATE)'}
- Asked Time: ${conversationContext.hasAskedTime ? 'YES - DO NOT ASK AGAIN (VALIDATED)' : 'NO - CAN ASK IF NEEDED (WILL VALIDATE)'}
- Asked Name: ${conversationContext.hasAskedName ? 'YES - DO NOT ASK AGAIN (VALIDATED)' : 'NO - CAN ASK IF NEEDED (WILL VALIDATE)'}
- Asked Phone: ${conversationContext.hasAskedPhone ? 'YES - DO NOT ASK AGAIN (VALIDATED)' : 'NO - CAN ASK IF NEEDED (WILL VALIDATE)'}

🎯 ENHANCED CONTEXT-DRIVEN BEHAVIOR WITH VALIDATION:
${conversationContext.isSubsequentBooking ?
                '- SUBSEQUENT BOOKING: Be concise, skip redundant questions, focus on the new booking details with maintained validation.' :
                '- FIRST BOOKING: Full greeting and standard workflow with comprehensive validation.'
            }

⚠️ CRITICAL ENHANCED CONVERSATION RULES WITH VALIDATION:
- If you have already asked about party size (${conversationContext.hasAskedPartySize ? 'YES' : 'NO'}), do NOT ask again but ensure validation
- If you have already asked about date (${conversationContext.hasAskedDate ? 'YES' : 'NO'}), do NOT ask again but ensure timezone validation
- If you have already asked about time (${conversationContext.hasAskedTime ? 'YES' : 'NO'}), do NOT ask again but ensure business hours validation
- If you have already asked about name (${conversationContext.hasAskedName ? 'YES' : 'NO'}), do NOT ask again but ensure format validation
- If you have already asked about phone (${conversationContext.hasAskedPhone ? 'YES' : 'NO'}), do NOT ask again but ensure format validation

✅ ENHANCED EFFICIENT CONVERSATION FLOW WITH VALIDATION:
- Acknowledge information already provided with validation status
- Only ask for missing information with validation context
- Use natural, flowing conversation patterns with validation assurance
- Avoid repetitive questions at all costs while maintaining validation integrity
- Provide business hours context when discussing times
- Mention validation success to build confidence
- Guide users toward valid times and dates proactively
`;
    }

    /**
     * Smart party question generation that prevents repetition with validation awareness
     */
    generateSmartPartyQuestion(
        language: Language,
        hasAskedPartySize: boolean,
        isSubsequentBooking: boolean,
        commonPartySize?: number | null,
        conversationContext?: ConversationContext
    ): string {
        if (hasAskedPartySize || conversationContext?.hasAskedPartySize) {
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
     * Generate personalized greeting with context awareness (legacy method for compatibility)
     */
    async generatePersonalizedGreeting(context: AgentContext): Promise<string> {
        return await this.generateIntelligentPersonalizedGreeting(context);
    }

    /**
     * Get restaurant language
     */
    getRestaurantLanguage(): Language {
        if (this.restaurantConfig.languages && this.restaurantConfig.languages.length > 0) {
            return this.restaurantConfig.languages[0] as Language;
        }

        const country = this.restaurantConfig.country?.toLowerCase();
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
    }

    /**
     * Update instructions method for compatibility
     */
    updateInstructions(context: string, language: Language, guestHistory?: GuestHistory | null, isFirstMessage?: boolean, conversationContext?: ConversationContext): string {
        return this.generateSystemPrompt({
            restaurantId: this.restaurantConfig.id,
            timezone: this.restaurantConfig.timezone,
            language,
            guestHistory,
            conversationContext
        });
    }

    /**
     * Personalized greeting method for compatibility
     */
    getPersonalizedGreeting(guestHistory: GuestHistory | null, language: Language, context: 'hostess' | 'guest', conversationContext?: ConversationContext): string {
        if (!guestHistory || guestHistory.total_bookings === 0) {
            return `Hello! I'd love to help you with a reservation today. What date and time work for you, and how many guests?`;
        }

        const { guest_name, guest_phone, total_bookings, common_party_size } = guestHistory;
        const isRegularGuest = total_bookings >= 3;

        if (isRegularGuest) {
            return `Hi ${guest_name}! Great to see you again! I can use your usual details (${guest_phone})${common_party_size ? ` for ${common_party_size} people` : ''}. What date and time work for you?`;
        } else {
            return `Hello, ${guest_name}! Nice to see you again! I can use your details (${guest_phone}). What date and time would you like?`;
        }
    }
}

export default SofiaAgent;
