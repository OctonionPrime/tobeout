// server/services/agents/conductor-agent.ts

/**
 * @file conductor-agent.ts
 * @description This file contains the implementation of the ConductorAgent, which manages
 * the conversation flow after a primary task (like booking or modification) is complete.
 * It handles polite sign-offs and can hand off to other agents for new tasks.
 *
 * @version 1.0.0
 * @date 2025-07-21
 */

import { BaseAgent, AgentContext, AgentResponse, AgentConfig, RestaurantConfig } from './base-agent';
import { agentTools } from './agent-tools';

/**
 * Conductor Agent - The Conversation Orchestrator
 *
 * The Conductor agent acts as a neutral, post-task manager. Its primary roles are:
 * 1.  Gracefully handle post-booking/modification pleasantries (e.g., "thank you").
 * 2.  Provide a final, helpful closing to the conversation.
 * 3.  Remain ready to hand off to another specialist agent (Sofia or Maya) if the user starts a new, distinct task.
 * 4.  Answer general restaurant questions after a task is complete.
 */
export class ConductorAgent extends BaseAgent {
    readonly name = 'Conductor';
    readonly description = 'Orchestrates the conversation after a primary task is completed.';
    readonly capabilities = ['get_restaurant_info']; // Can answer basic questions

    constructor(config: AgentConfig, restaurantConfig: RestaurantConfig) {
        super(config, restaurantConfig);
        this.logAgentAction('Conductor Agent initialized');
    }

    /**
     * Generates the system prompt for the Conductor agent.
     */
    generateSystemPrompt(context: AgentContext): string {
        const { language, guestHistory } = context;

        const languageInstruction = `CRITICAL: You MUST respond in ${language}. Your tone should be polite, helpful, and concise.`;

        const coreDirective = `
        **YOUR ROLE: Conversation Conductor**
        You are the "Conductor" agent. The user has just completed a task (like making or changing a booking). Your job is to handle the end of the conversation gracefully.

        **PRIMARY SCENARIOS:**
        1.  **User says "Thank you" or similar:** Respond politely and end the conversation.
            -   Examples: "You're very welcome! Is there anything else I can help you with?", "My pleasure! Enjoy your visit."
        2.  **User asks a general question:** Answer it using the 'get_restaurant_info' tool if needed.
            -   Example User: "What are your hours again?" -> Use tool to answer.
        3.  **User starts a NEW, unrelated task:** Your response should signal that a handoff is needed. The Overseer will see this and switch agents.
            -   Example User: "Great, thanks. Can I also book another table for next week?" -> Respond: "Of course, I can help with a new booking."
            -   Example User: "Thanks. I also need to change my other reservation." -> Respond: "Certainly, I can help you with another reservation."

        **CRITICAL RULES:**
        -   DO NOT attempt to book, modify, or cancel reservations yourself. You don't have the tools.
        -   Keep your responses short and to the point.
        -   Your main goal is to provide a smooth end to the current interaction or a clean start to a new one.
        `;

        const guestContext = guestHistory ? `The guest's name is ${guestHistory.guest_name}. You can use their name for a personal touch.` : '';

        return `You are the Conductor, a friendly assistant for ${this.restaurantConfig.name}.
        ${languageInstruction}
        ${coreDirective}
        ${guestContext}
        `;
    }

    /**
     * Handles the user's message using the Conductor's logic.
     */
    async handleMessage(message: string, context: AgentContext): Promise<AgentResponse> {
        const startTime = Date.now();
        this.logAgentAction('Processing message with Conductor agent', { message: message.substring(0, 50) });

        try {
            const systemPrompt = this.generateSystemPrompt(context);
            // Use a simple model as the task is not complex
            const responseContent = await this.generateResponse(systemPrompt, message, context);

            const processingTimeMs = Date.now() - startTime;
            this.logAgentAction('Conductor response generated', { processingTimeMs });

            return {
                content: responseContent,
                metadata: {
                    processedAt: new Date().toISOString(),
                    agentType: this.name,
                    confidence: 0.95,
                    processingTimeMs,
                }
            };
        } catch (error) {
            return this.handleAgentError(error as Error, 'Conductor.handleMessage', message);
        }
    }

    /**
     * Defines the tools available to the Conductor agent.
     */
    getTools() {
        // Conductor only has access to general information tools.
        return agentTools.filter(tool =>
            this.capabilities.includes(tool.function.name)
        );
    }
}
