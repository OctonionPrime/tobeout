// server/services/agents/agent-tools-registry.ts
// OpenAI Agents SDK Tool Registry - FINAL CORRECTED VERSION

import { tool } from '@openai/agents';
import { z } from 'zod';
import type { RunContext } from '@openai/agents';

// Import existing function implementations from agent-tools.ts
import { agentFunctions } from './agent-tools';
import type { Language } from '../enhanced-conversation-manager';

// Agent tool context interface - matches existing functionContext structure
interface AgentToolContext {
  restaurantId: number;
  timezone: string;
  language: Language;
  telegramUserId?: string;
  source: string;
  sessionId: string;
  confirmedName?: string;
}

// =====================================================
// CONVERTED TOOLS: Existing functions adapted to OpenAI SDK format
// =====================================================

/**
 * CHECK AVAILABILITY TOOL
 */
export const checkAvailabilityTool = tool({
  name: 'check_availability',
  description: 'Check if tables are available for specific date, time, and party size. Use this BEFORE trying to create a reservation.',
  parameters: z.object({
    date: z.string()
      .describe('Date in YYYY-MM-DD format (e.g., "2025-06-30")')
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    time: z.string()
      .describe('Time in HH:MM format (e.g., "19:30", "08:15")')
      .regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
    guests: z.number()
      .int()
      .min(1, 'Must have at least 1 guest')
      .max(50, 'Cannot exceed 50 guests')
      .describe('Number of guests for the reservation')
  }),
  execute: async ({ date, time, guests }, context?: RunContext<AgentToolContext>) => {
    if (!context?.context) {
      throw new Error('Context required for availability check');
    }

    console.log(`[AgentToolsRegistry] check_availability: ${date} ${time} for ${guests} guests`);

    const result = await agentFunctions.check_availability(
      date, 
      time, 
      guests, 
      context.context
    );

    console.log(`[AgentToolsRegistry] check_availability result:`, result);
    return JSON.stringify(result);
  }
});

/**
 * CREATE RESERVATION TOOL  
 * ✅ FINAL FIX: Zod schema compliant with OpenAI structured outputs
 */
export const createReservationTool = tool({
  name: 'create_reservation',
  description: 'Create a new restaurant reservation. Only call this when you have ALL required information: guest name, phone, date, time, and number of guests.',
  parameters: z.object({
    guestName: z.string()
      .min(1, 'Guest name is required')
      .describe('Full name of the guest making the reservation'),
    guestPhone: z.string()
      .min(7, 'Phone number must be at least 7 digits')
      .describe('Guest phone number (any format accepted)'),
    date: z.string()
      .describe('Date in YYYY-MM-DD format')
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    time: z.string()
      .describe('Time in HH:MM format')
      .regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
    guests: z.number()
      .int()
      .min(1, 'Must have at least 1 guest')
      .max(50, 'Cannot exceed 50 guests')
      .describe('Number of guests'),
    // ✅ CRITICAL FIX: Use required field with default value instead of optional
    specialRequests: z.string()
      .default("")
      .describe('Any special requests or dietary restrictions (can be empty string)')
  }),
  execute: async (args, context?: RunContext<AgentToolContext>) => {
    if (!context?.context) {
      throw new Error('Context required for reservation creation');
    }

    console.log(`[AgentToolsRegistry] create_reservation:`, {
      name: args.guestName,
      phone: args.guestPhone,
      datetime: `${args.date} ${args.time}`,
      guests: args.guests,
      requests: args.specialRequests
    });

    const result = await agentFunctions.create_reservation(
      args.guestName,
      args.guestPhone, 
      args.date,
      args.time,
      args.guests,
      args.specialRequests || '',
      context.context
    );

    console.log(`[AgentToolsRegistry] create_reservation result:`, result);
    return JSON.stringify(result);
  }
});

/**
 * FIND ALTERNATIVE TIMES TOOL
 */
export const findAlternativeTimesTool = tool({
  name: 'find_alternative_times',
  description: 'Find alternative available times when the requested time is not available. Useful for suggesting other options to guests.',
  parameters: z.object({
    date: z.string()
      .describe('Date in YYYY-MM-DD format')
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    preferredTime: z.string()
      .describe('Preferred time in HH:MM format')
      .regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
    guests: z.number()
      .int()
      .min(1)
      .max(50)
      .describe('Number of guests')
  }),
  execute: async ({ date, preferredTime, guests }, context?: RunContext<AgentToolContext>) => {
    if (!context?.context) {
      throw new Error('Context required for alternative times search');
    }

    console.log(`[AgentToolsRegistry] find_alternative_times: ${date} around ${preferredTime} for ${guests} guests`);

    const result = await agentFunctions.find_alternative_times(
      date,
      preferredTime, 
      guests,
      context.context
    );

    console.log(`[AgentToolsRegistry] find_alternative_times result:`, result);
    return JSON.stringify(result);
  }
});

/**
 * GET RESTAURANT INFO TOOL
 */
export const getRestaurantInfoTool = tool({
  name: 'get_restaurant_info',
  description: 'Get information about the restaurant such as hours, location, menu, policies, etc.',
  parameters: z.object({
    infoType: z.enum([
      'hours', 
      'location', 
      'cuisine', 
      'contact', 
      'features',
      'all'
    ]).describe('Type of information requested about the restaurant')
  }),
  execute: async ({ infoType }, context?: RunContext<AgentToolContext>) => {
    if (!context?.context) {
      throw new Error('Context required for restaurant info');
    }

    console.log(`[AgentToolsRegistry] get_restaurant_info: ${infoType}`);

    const result = await agentFunctions.get_restaurant_info(
      infoType,
      context.context
    );

    console.log(`[AgentToolsRegistry] get_restaurant_info result:`, result);
    return JSON.stringify(result);
  }
});

// =====================================================
// TOOL COLLECTIONS: Organized by agent specialization
// =====================================================

/**
 * BOOKING AGENT TOOLS
 */
export const BOOKING_AGENT_TOOLS = [
  checkAvailabilityTool,
  createReservationTool,
  findAlternativeTimesTool,
  getRestaurantInfoTool
];

/**
 * ALL TOOLS REGISTRY
 */
export const ALL_TOOLS = [
  checkAvailabilityTool,
  createReservationTool, 
  findAlternativeTimesTool,
  getRestaurantInfoTool
];

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

/**
 * CREATE TOOL CONTEXT
 */
export function createToolContext(
  restaurantId: number,
  sessionId: string,
  language: Language,
  timezone: string,
  platform: 'web' | 'telegram',
  telegramUserId?: string,
  confirmedName?: string
): AgentToolContext {
  return {
    restaurantId,
    sessionId,
    language,
    timezone,
    source: platform,
    telegramUserId,
    confirmedName
  };
}

// =====================================================
// STARTUP VALIDATION
// =====================================================

console.log(`[AgentToolsRegistry] Successfully loaded ${ALL_TOOLS.length} tools with corrected Zod schemas`);

// =====================================================
// EXPORTS
// =====================================================

export default {
  checkAvailabilityTool,
  createReservationTool,
  findAlternativeTimesTool,
  getRestaurantInfoTool,
  BOOKING_AGENT_TOOLS,
  ALL_TOOLS,
  createToolContext
};