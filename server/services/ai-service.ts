// src/services/ai-service.ts
// 📊 SMART LOGGING INTEGRATION: Complete AI operation monitoring and fallback tracking
// 🚨 CRITICAL BUG FIX: Tool-use message transformation for Claude compatibility
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { smartLog } from './smart-logging.service';
import fs from 'fs';
import path from 'path';

export interface AIServiceOptions {
    model: 'haiku' | 'sonnet' | 'gpt-4o-mini' | 'gpt-4o' | 'gpt-3.5-turbo';
    maxTokens?: number;
    temperature?: number;
    context?: string; // For logging purposes
    timeout?: number; // Request timeout in ms
}

export interface AIJSONOptions<T = any> extends AIServiceOptions {
    schema?: any; // Optional JSON schema for validation
    retryOnInvalidJSON?: boolean; // Retry if JSON parsing fails
}

export class AIService {
    private claude: Anthropic;
    private openai: OpenAI;
    private static instance: AIService | null = null;

    private static providerStats = {
        claude: { requests: 0, failures: 0, totalTime: 0, successfulRequests: 0 },
        openai: { requests: 0, failures: 0, totalTime: 0, successfulRequests: 0 }
    };

    constructor() {
        if (!process.env.ANTHROPIC_API_KEY) {
            smartLog.warn('ANTHROPIC_API_KEY not found - Claude will not be available');
        }
        if (!process.env.OPENAI_API_KEY) {
            smartLog.error('OPENAI_API_KEY missing', new Error('MISSING_OPENAI_KEY'));
            throw new Error('[AIService] OPENAI_API_KEY is required');
        }

        this.claude = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY!
        });

        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        smartLog.info('AIService initialized', {
            claudeAvailable: !!process.env.ANTHROPIC_API_KEY,
            openaiAvailable: !!process.env.OPENAI_API_KEY,
            fallbackSystem: 'OpenAI -> Claude'
        });
    }

    static getInstance(): AIService {
        if (!AIService.instance) {
            AIService.instance = new AIService();
        }
        return AIService.instance;
    }

    async generateContent(prompt: string, options: AIServiceOptions): Promise<string> {
        const {
            model,
            maxTokens = 1000,
            temperature = 0.2,
            context = 'unknown',
            timeout = 30000
        } = options;

        const overallTimerId = smartLog.startTimer('ai_content_generation');
        const startTime = Date.now();

        smartLog.info('AI content generation started', {
            model,
            context,
            promptLength: prompt.length,
            maxTokens,
            temperature
        });

        if (model === 'haiku' || model === 'sonnet') {
            const claudeResult = await this.tryClaudeGeneration(prompt, {
                model,
                maxTokens,
                temperature,
                context,
                timeout
            });

            if (claudeResult.success) {
                const executionTime = Date.now() - startTime;
                this.updateProviderStats('claude', executionTime, true);

                smartLog.info('Claude generation successful', {
                    model,
                    context,
                    executionTime,
                    responseLength: claudeResult.content?.length || 0,
                    processingTime: smartLog.endTimer(overallTimerId)
                });

                return claudeResult.content!;
            }

            smartLog.warn('Claude generation failed - attempting OpenAI fallback', {
                model,
                context,
                claudeError: claudeResult.error,
                attemptingFallback: true
            });

            smartLog.businessEvent('ai_fallback', {
                fromProvider: 'Claude',
                toProvider: 'OpenAI',
                context,
                model,
                error: claudeResult.error
            });

            return await this.fallbackToOpenAI(prompt, options, claudeResult.error!);
        }

        return await this.callOpenAI(prompt, options);
    }

    async generateJSON<T = any>(prompt: string, options: AIJSONOptions<T>): Promise<T> {
        const { retryOnInvalidJSON = true, schema, ...baseOptions } = options;
        const overallTimerId = smartLog.startTimer('ai_json_generation');

        const maxRetries = retryOnInvalidJSON ? 2 : 0;
        let lastError: string = '';

        smartLog.info('AI JSON generation started', {
            model: baseOptions.model,
            context: baseOptions.context,
            maxRetries,
            hasSchema: !!schema
        });

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const attemptTimerId = smartLog.startTimer(`json_attempt_${attempt + 1}`);

            try {
                const jsonPrompt = attempt > 0
                    ? `${prompt}\n\nIMPORTANT: Return valid JSON only. Previous attempt failed with: ${lastError}`
                    : `${prompt}\n\nReturn valid JSON only, no additional text or formatting.`;

                const response = await this.generateContent(jsonPrompt, {
                    ...baseOptions,
                    context: `${baseOptions.context || 'unknown'}-json-attempt-${attempt + 1}`
                });

                const cleanJson = this.cleanJSONResponse(response);
                const parsed = JSON.parse(cleanJson);

                if (schema && !this.validateJSONSchema(parsed, schema)) {
                    throw new Error('Response does not match expected schema');
                }

                smartLog.info('JSON generation successful', {
                    context: baseOptions.context,
                    attempt: attempt + 1,
                    responseLength: response.length,
                    cleanedLength: cleanJson.length,
                    hasSchema: !!schema,
                    attemptTime: smartLog.endTimer(attemptTimerId),
                    totalTime: smartLog.endTimer(overallTimerId)
                });

                return parsed;

            } catch (error: any) {
                lastError = error.message;

                smartLog.warn('JSON parsing attempt failed', {
                    context: baseOptions.context,
                    attempt: attempt + 1,
                    error: lastError,
                    attemptTime: smartLog.endTimer(attemptTimerId)
                });

                if (attempt === maxRetries) {
                    smartLog.error('All JSON parsing attempts failed - returning safe default', new Error('JSON_PARSING_FAILED'), {
                        context: baseOptions.context,
                        totalAttempts: maxRetries + 1,
                        finalError: lastError,
                        totalTime: smartLog.endTimer(overallTimerId)
                    });

                    return this.getJSONSafeDefault<T>(baseOptions.context || 'unknown');
                }
            }
        }

        throw new Error('Unexpected error in generateJSON');
    }

    async generateChatCompletion(options: {
        model: 'haiku' | 'sonnet' | 'gpt-4o-mini' | 'gpt-4o';
        messages: any[];
        tools?: any[];
        tool_choice?: any;
        maxTokens?: number;
        temperature?: number;
        context?: string;
        timeout?: number;
    }): Promise<OpenAI.Chat.Completions.ChatCompletion> {
        const {
            model,
            messages,
            tools,
            tool_choice,
            maxTokens = 1000,
            temperature = 0.7,
            context = 'unknown-completion',
            timeout = 30000
        } = options;

        const overallTimerId = smartLog.startTimer('ai_chat_completion');
        const startTime = Date.now();
        smartLog.info('AI chat completion started', {
            model, context, toolCount: tools?.length || 0
        });

        try {
            const openaiModel = this.mapToOpenAIModel(model);
            const completion = await Promise.race([
                this.openai.chat.completions.create({
                    model: openaiModel,
                    messages: messages,
                    tools: tools,
                    tool_choice: tool_choice,
                    max_tokens: maxTokens,
                    temperature: temperature,
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('OpenAI request timeout')), timeout)
                )
            ]) as OpenAI.Chat.Completions.ChatCompletion;

            const executionTime = Date.now() - startTime;
            smartLog.info('OpenAI chat completion successful', {
                model: openaiModel,
                context,
                processingTime: smartLog.endTimer(overallTimerId)
            });
            this.updateProviderStats('openai', executionTime, true);
            return completion;

        } catch (error: any) {
            const executionTime = Date.now() - startTime;
            this.updateProviderStats('openai', executionTime, false);
            const errorMessage = this.extractErrorMessage(error);

            smartLog.error('OpenAI chat completion failed, attempting Claude fallback', error, {
                model, context, error: errorMessage
            });

            smartLog.businessEvent('ai_fallback', {
                fromProvider: 'OpenAI',
                toProvider: 'Claude',
                context,
                model,
                error: errorMessage
            });

            try {
                const claudeModel = "claude-3-5-sonnet-20240620";

                const systemPrompt = messages.find((m: any) => m.role === 'system')?.content || '';
                const userMessages = messages.filter((m: any) => m.role !== 'system');

                // 🚨 CRITICAL FIX: Transform tool result messages for Claude compatibility
                const claudeCompatibleMessages = this.transformMessagesForClaude(userMessages);

                // ✅ Transform tools and tool_choice to Claude's format
                const claudeTools = tools ? this.mapOpenAIToolsToClaude(tools) : undefined;
                const claudeToolChoice = tool_choice ? this.mapOpenAIToolChoiceToClaude(tool_choice) : undefined;

                smartLog.info('Claude fallback with message transformation', {
                    originalMessageCount: userMessages.length,
                    transformedMessageCount: claudeCompatibleMessages.length,
                    hasToolMessages: userMessages.some((m: any) => m.role === 'tool'),
                    toolCount: claudeTools?.length || 0
                });

                const result = await this.claude.messages.create({
                    model: claudeModel,
                    system: systemPrompt,
                    messages: claudeCompatibleMessages, // ✅ Use transformed messages
                    tools: claudeTools,
                    tool_choice: claudeToolChoice,
                    max_tokens: maxTokens,
                    temperature: temperature,
                });

                const openAICompatibleResponse = this.mapClaudeResponseToOpenAI(result);
                const fallbackExecutionTime = Date.now() - startTime;

                smartLog.info('Claude fallback chat completion successful', {
                    model: claudeModel,
                    context,
                    processingTime: smartLog.endTimer(overallTimerId)
                });
                this.updateProviderStats('claude', fallbackExecutionTime, true);
                return openAICompatibleResponse;

            } catch (fallbackError: any) {
                smartLog.error('Claude fallback chat completion also failed', fallbackError, {
                    model: 'claude-3-5-sonnet',
                    context,
                    finalError: this.extractErrorMessage(fallbackError),
                    totalTime: smartLog.endTimer(overallTimerId)
                });
                throw fallbackError;
            }
        }
    }

    // 🚨 CRITICAL NEW METHOD: Transform OpenAI message format to Claude format
    /**
     * Transforms OpenAI message format to Claude-compatible format.
     * Key fix: Converts role: "tool" messages to role: "user" with tool_result content blocks.
     * @param messages The messages in OpenAI format
     * @returns The messages in Claude format
     */
    private transformMessagesForClaude(messages: any[]): any[] {
        return messages.map(msg => {
            if (msg.role === 'tool') {
                // 🚨 CRITICAL TRANSFORMATION: OpenAI tool result → Claude tool_result
                smartLog.info('Transforming tool message for Claude compatibility', {
                    originalRole: msg.role,
                    toolCallId: msg.tool_call_id,
                    contentLength: msg.content?.length || 0
                });

                return {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: msg.tool_call_id,
                            content: msg.content
                        }
                    ]
                };
            }
            
            // Handle assistant messages with tool calls
            if (msg.role === 'assistant' && msg.tool_calls) {
                const content = [];
                
                // Add text content if present
                if (msg.content) {
                    content.push({
                        type: 'text',
                        text: msg.content
                    });
                }
                
                // Transform tool calls to Claude format
                msg.tool_calls.forEach((toolCall: any) => {
                    content.push({
                        type: 'tool_use',
                        id: toolCall.id,
                        name: toolCall.function.name,
                        input: JSON.parse(toolCall.function.arguments)
                    });
                });
                
                return {
                    role: 'assistant',
                    content: content
                };
            }
            
            // For other message types, return as-is (user, system)
            return msg;
        });
    }

    // ✅ Helper function to convert OpenAI tools to Claude's format
    /**
     * Converts an array of tools from OpenAI's format to Claude's format.
     * @param openAITools The tools in OpenAI's format.
     * @returns The tools in Claude's format.
     */
    private mapOpenAIToolsToClaude(openAITools: any[]): Anthropic.Tool[] {
        return openAITools.map(tool => {
            if (tool.type !== 'function' || !tool.function) {
                return null; // Or handle other tool types if necessary
            }
            return {
                name: tool.function.name,
                description: tool.function.description,
                input_schema: tool.function.parameters,
            };
        }).filter(Boolean) as Anthropic.Tool[];
    }

    /**
     * Converts the tool_choice parameter from OpenAI's format to Claude's format.
     * @param openAIToolChoice The tool_choice in OpenAI's format.
     * @returns The tool_choice in Claude's format.
     */
    private mapOpenAIToolChoiceToClaude(openAIToolChoice: any): Anthropic.ToolChoice {
        if (typeof openAIToolChoice === 'string') {
            if (openAIToolChoice === 'auto') {
                return { type: 'auto' };
            }
            if (openAIToolChoice === 'any') {
                return { type: 'any' };
            }
        }
        if (typeof openAIToolChoice === 'object' && openAIToolChoice.type === 'function' && openAIToolChoice.function?.name) {
            return { type: 'tool', name: openAIToolChoice.function.name };
        }
        // Default to 'auto' if the format is unrecognized but tool_choice is present
        return { type: 'auto' };
    }

    private mapClaudeResponseToOpenAI(claudeResponse: Anthropic.Messages.Message): OpenAI.Chat.Completions.ChatCompletion {
        const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
        let content = '';

        claudeResponse.content.forEach(block => {
            if (block.type === 'text') {
                content += block.text;
            } else if (block.type === 'tool_use') {
                toolCalls.push({
                    id: block.id,
                    type: 'function',
                    function: {
                        name: block.name,
                        arguments: JSON.stringify(block.input),
                    },
                });
            }
        });

        return {
            id: claudeResponse.id,
            choices: [{
                finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
                index: 0,
                message: {
                    role: 'assistant',
                    content: content || null,
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                },
                logprobs: null,
            }],
            created: Math.floor(Date.now() / 1000),
            model: claudeResponse.model,
            object: 'chat.completion',
            usage: {
                prompt_tokens: claudeResponse.usage?.input_tokens || 0,
                completion_tokens: claudeResponse.usage?.output_tokens || 0,
                total_tokens: (claudeResponse.usage?.input_tokens || 0) + (claudeResponse.usage?.output_tokens || 0)
            }
        };
    }

    getOpenAIClient(): OpenAI {
        return this.openai;
    }

    private async tryClaudeGeneration(prompt: string, options: AIServiceOptions): Promise<{
        success: boolean;
        content?: string;
        error?: string;
    }> {
        if (!process.env.ANTHROPIC_API_KEY) {
            return {
                success: false,
                error: 'Claude API key not available'
            };
        }

        const claudeTimerId = smartLog.startTimer('claude_generation');
        const startTime = Date.now();

        try {
            const claudeModel = options.model === 'sonnet'
                ? "claude-3-5-sonnet-20240620"
                : "claude-3-haiku-20240307";

            smartLog.info('Claude API call started', {
                model: claudeModel,
                context: options.context,
                promptLength: prompt.length,
                maxTokens: options.maxTokens,
                timeout: options.timeout
            });

            const result = await Promise.race([
                this.claude.messages.create({
                    model: claudeModel,
                    max_tokens: options.maxTokens || 1000,
                    temperature: options.temperature || 0.2,
                    messages: [{ role: 'user', content: prompt }]
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Claude request timeout')), options.timeout || 30000)
                )
            ]) as Anthropic.Messages.Message;

            const response = result.content[0];
            if (response.type === 'text' && response.text.trim()) {
                const executionTime = Date.now() - startTime;
                this.updateProviderStats('claude', executionTime, true);

                smartLog.info('Claude generation completed successfully', {
                    model: claudeModel,
                    context: options.context,
                    responseLength: response.text.length,
                    executionTime,
                    processingTime: smartLog.endTimer(claudeTimerId)
                });

                return {
                    success: true,
                    content: response.text
                };
            }

            const executionTime = Date.now() - startTime;
            this.updateProviderStats('claude', executionTime, false);

            smartLog.warn('Claude returned non-text or empty response', {
                model: claudeModel,
                context: options.context,
                responseType: response.type,
                processingTime: smartLog.endTimer(claudeTimerId)
            });

            return {
                success: false,
                error: 'Non-text or empty response from Claude'
            };

        } catch (error: any) {
            const executionTime = Date.now() - startTime;
            this.updateProviderStats('claude', executionTime, false);

            const errorMessage = this.extractErrorMessage(error);

            smartLog.error('Claude generation failed', error, {
                context: options.context,
                model: options.model,
                executionTime,
                errorType: error.name || 'unknown',
                processingTime: smartLog.endTimer(claudeTimerId)
            });

            return {
                success: false,
                error: errorMessage
            };
        }
    }

    private async fallbackToOpenAI(prompt: string, options: AIServiceOptions, claudeError: string): Promise<string> {
        const fallbackModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'];
        const fallbackTimerId = smartLog.startTimer('openai_fallback');

        smartLog.info('OpenAI fallback started', {
            context: options.context,
            claudeError,
            fallbackModels,
            originalModel: options.model
        });

        for (let i = 0; i < fallbackModels.length; i++) {
            const model = fallbackModels[i];
            const modelTimerId = smartLog.startTimer(`fallback_${model}`);

            try {
                const result = await this.callOpenAI(prompt, {
                    ...options,
                    model: model as any
                });

                smartLog.info('OpenAI fallback successful', {
                    context: options.context,
                    fallbackModel: model,
                    originalModel: options.model,
                    attemptNumber: i + 1,
                    responseLength: result.length,
                    modelTime: smartLog.endTimer(modelTimerId),
                    totalFallbackTime: smartLog.endTimer(fallbackTimerId)
                });

                return result;

            } catch (error: any) {
                smartLog.warn('OpenAI fallback model failed', {
                    context: options.context,
                    model,
                    attemptNumber: i + 1,
                    error: this.extractErrorMessage(error),
                    modelTime: smartLog.endTimer(modelTimerId)
                });

                if (i === fallbackModels.length - 1) {
                    smartLog.error('All AI providers failed - returning safe default', new Error('ALL_PROVIDERS_FAILED'), {
                        context: options.context,
                        claudeError,
                        openaiAttempts: fallbackModels.length,
                        totalFallbackTime: smartLog.endTimer(fallbackTimerId)
                    });

                    smartLog.businessEvent('system_error', {
                        type: 'all_ai_providers_failed',
                        context: options.context,
                        claudeError,
                        openaiError: this.extractErrorMessage(error)
                    });

                    return this.getSafeDefault(options.context || 'unknown');
                }
            }
        }

        return this.getSafeDefault(options.context || 'unknown');
    }

    private async callOpenAI(prompt: string, options: AIServiceOptions): Promise<string> {
        const openaiModel = this.mapToOpenAIModel(options.model);
        const openaiTimerId = smartLog.startTimer('openai_generation');
        const startTime = Date.now();

        smartLog.info('OpenAI API call started', {
            model: openaiModel,
            context: options.context,
            promptLength: prompt.length,
            maxTokens: options.maxTokens,
            timeout: options.timeout
        });

        try {
            const completion = await Promise.race([
                this.openai.chat.completions.create({
                    model: openaiModel,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: options.maxTokens || 1000,
                    temperature: options.temperature || 0.2
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('OpenAI request timeout')), options.timeout || 30000)
                )
            ]) as OpenAI.Chat.Completions.ChatCompletion;

            const response = completion.choices[0]?.message?.content?.trim();
            if (!response) {
                throw new Error('Empty response from OpenAI');
            }

            const executionTime = Date.now() - startTime;
            this.updateProviderStats('openai', executionTime, true);

            smartLog.info('OpenAI generation completed successfully', {
                model: openaiModel,
                context: options.context,
                responseLength: response.length,
                executionTime,
                processingTime: smartLog.endTimer(openaiTimerId)
            });

            return response;

        } catch (error: any) {
            const executionTime = Date.now() - startTime;
            this.updateProviderStats('openai', executionTime, false);

            smartLog.error('OpenAI generation failed', error, {
                model: openaiModel,
                context: options.context,
                executionTime,
                errorType: error.name || 'unknown',
                processingTime: smartLog.endTimer(openaiTimerId)
            });

            throw error;
        }
    }

    private updateProviderStats(provider: 'claude' | 'openai', executionTime: number, success: boolean): void {
        AIService.providerStats[provider].requests++;
        AIService.providerStats[provider].totalTime += executionTime;

        if (success) {
            AIService.providerStats[provider].successfulRequests++;
        } else {
            AIService.providerStats[provider].failures++;
        }
    }

    private mapToOpenAIModel(model: string): string {
        switch (model) {
            case 'haiku':
                return 'gpt-4o-mini';
            case 'sonnet':
                return 'gpt-4o';
            case 'gpt-4o-mini':
            case 'gpt-4o':
            case 'gpt-3.5-turbo':
                return model;
            default:
                return 'gpt-4o-mini';
        }
    }

    private cleanJSONResponse(response: string): string {
        let cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');

        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            cleaned = cleaned.substring(firstBrace, lastBrace + 1);
        }

        return cleaned;
    }

    private validateJSONSchema(data: any, schema: any): boolean {
        if (typeof schema.type !== 'undefined') {
            if (schema.type === 'object' && typeof data !== 'object') return false;
            if (schema.type === 'array' && !Array.isArray(data)) return false;
            if (schema.type === 'string' && typeof data !== 'string') return false;
        }

        if (schema.required && Array.isArray(schema.required)) {
            for (const field of schema.required) {
                if (!(field in data)) return false;
            }
        }

        return true;
    }

    private extractErrorMessage(error: any): string {
        if (typeof error === 'string') return error;
        if (error.message) return error.message;
        if (error.error?.message) return error.error.message;
        if (error.response?.data?.error?.message) return error.response.data.error.message;
        return 'Unknown error occurred';
    }

    private getSafeDefault(context: string): string {
        const defaults: Record<string, string> = {
            'Overseer': JSON.stringify({
                reasoning: "AI system unavailable - maintaining current agent for safety",
                agentToUse: "booking",
                isNewBookingRequest: false
            }),
            'LanguageAgent': JSON.stringify({
                detectedLanguage: "en",
                confidence: 0.1,
                reasoning: "AI system unavailable - defaulting to English",
                shouldLock: false
            }),
            'ConfirmationAgent': JSON.stringify({
                confirmationStatus: "unclear",
                reasoning: "AI system unavailable - unable to determine confirmation status"
            }),
            'SpecialRequestAnalysis': JSON.stringify({
                patterns: [],
                reasoning: "AI analysis temporarily unavailable - no recurring patterns identified"
            }),
            'translation': "I apologize, translation service is temporarily unavailable.",
            'relevance': "I can only help with restaurant reservations and dining.",
            'safety': "I'm here to help with restaurant reservations. How can I assist you with booking a table?"
        };

        return defaults[context] || "I apologize, I'm experiencing technical difficulties. Please try again.";
    }

    private getJSONSafeDefault<T>(context: string): T {
        const defaults: Record<string, any> = {
            'Overseer': {
                reasoning: "AI system unavailable - maintaining current agent for safety",
                agentToUse: "booking",
                isNewBookingRequest: false
            },
            'LanguageAgent': {
                detectedLanguage: "en",
                confidence: 0.1,
                reasoning: "AI system unavailable - defaulting to English",
                shouldLock: false
            },
            'ConfirmationAgent': {
                confirmationStatus: "unclear",
                reasoning: "AI system unavailable - unable to determine confirmation status"
            },
            'SpecialRequestAnalysis': {
                patterns: [],
                reasoning: "AI analysis temporarily unavailable - no recurring patterns identified"
            }
        };

        return (defaults[context] || {
            reasoning: "AI system temporarily unavailable",
            error: true,
            fallback: true
        }) as T;
    }

    static generateAIReport(): any {
        const report = {
            timestamp: new Date().toISOString(),
            claude: {
                ...AIService.providerStats.claude,
                avgResponseTime: AIService.providerStats.claude.requests > 0
                    ? Math.round(AIService.providerStats.claude.totalTime / AIService.providerStats.claude.requests)
                    : 0,
                successRate: AIService.providerStats.claude.requests > 0
                    ? Math.round((AIService.providerStats.claude.successfulRequests / AIService.providerStats.claude.requests) * 100) / 100
                    : 0,
                failureRate: AIService.providerStats.claude.requests > 0
                    ? Math.round((AIService.providerStats.claude.failures / AIService.providerStats.claude.requests) * 100) / 100
                    : 0
            },
            openai: {
                ...AIService.providerStats.openai,
                avgResponseTime: AIService.providerStats.openai.requests > 0
                    ? Math.round(AIService.providerStats.openai.totalTime / AIService.providerStats.openai.requests)
                    : 0,
                successRate: AIService.providerStats.openai.requests > 0
                    ? Math.round((AIService.providerStats.openai.successfulRequests / AIService.providerStats.openai.requests) * 100) / 100
                    : 0,
                failureRate: AIService.providerStats.openai.requests > 0
                    ? Math.round((AIService.providerStats.openai.failures / AIService.providerStats.openai.requests) * 100) / 100
                    : 0
            }
        };

        try {
            const reportsDir = 'analytics';
            if (!fs.existsSync(reportsDir)) {
                fs.mkdirSync(reportsDir, { recursive: true });
            }

            const reportPath = path.join(reportsDir, `ai_report_${new Date().toISOString().split('T')[0]}.json`);
            fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

            smartLog.info('AI performance report generated', {
                claudeRequests: report.claude.requests,
                claudeSuccessRate: report.claude.successRate,
                openaiRequests: report.openai.requests,
                openaiSuccessRate: report.openai.successRate,
                reportPath
            });
        } catch (error) {
            smartLog.error('Failed to save AI performance report', error as Error);
        }

        AIService.providerStats.claude = { requests: 0, failures: 0, totalTime: 0, successfulRequests: 0 };
        AIService.providerStats.openai = { requests: 0, failures: 0, totalTime: 0, successfulRequests: 0 };

        return report;
    }

    async healthCheck(): Promise<{
        claude: boolean;
        openai: boolean;
        overall: 'healthy' | 'degraded' | 'unhealthy';
    }> {
        const healthTimerId = smartLog.startTimer('ai_health_check');

        const results = {
            claude: false,
            openai: false,
            overall: 'unhealthy' as const
        };

        smartLog.info('AI service health check started');

        try {
            const claudeResult = await this.tryClaudeGeneration("Say 'OK'", {
                model: 'haiku',
                maxTokens: 10,
                context: 'health-check-claude',
                timeout: 5000
            });
            results.claude = claudeResult.success;

            if (!claudeResult.success) {
                smartLog.warn('Claude health check failed', {
                    error: claudeResult.error
                });
            }
        } catch (error) {
            smartLog.warn('Claude health check error', {
                error: this.extractErrorMessage(error)
            });
        }

        try {
            await this.callOpenAI("Say 'OK'", {
                model: 'gpt-4o-mini',
                maxTokens: 10,
                context: 'health-check-openai',
                timeout: 5000
            });
            results.openai = true;
        } catch (error) {
            smartLog.warn('OpenAI health check failed', {
                error: this.extractErrorMessage(error)
            });
        }

        if (results.claude && results.openai) {
            results.overall = 'healthy';
        } else if (results.openai) {
            results.overall = 'degraded';
        }

        smartLog.info('AI service health check completed', {
            claude: results.claude,
            openai: results.openai,
            overall: results.overall,
            processingTime: smartLog.endTimer(healthTimerId)
        });

        if (results.overall !== 'healthy') {
            smartLog.businessEvent('system_error', {
                type: 'ai_service_health_degraded',
                claude: results.claude,
                openai: results.openai,
                overall: results.overall
            });
        }

        return results;
    }

    getStats(): {
        claude: any;
        openai: any;
        totalRequests: number;
        overallSuccessRate: number;
    } {
        const claudeStats = AIService.providerStats.claude;
        const openaiStats = AIService.providerStats.openai;

        const totalRequests = claudeStats.requests + openaiStats.requests;
        const totalSuccessful = claudeStats.successfulRequests + openaiStats.successfulRequests;
        const overallSuccessRate = totalRequests > 0 ? Math.round((totalSuccessful / totalRequests) * 100) / 100 : 0;

        return {
            claude: {
                ...claudeStats,
                avgResponseTime: claudeStats.requests > 0 ? Math.round(claudeStats.totalTime / claudeStats.requests) : 0,
                successRate: claudeStats.requests > 0 ? Math.round((claudeStats.successfulRequests / claudeStats.requests) * 100) / 100 : 0
            },
            openai: {
                ...openaiStats,
                avgResponseTime: openaiStats.requests > 0 ? Math.round(openaiStats.totalTime / openaiStats.requests) : 0,
                successRate: openaiStats.requests > 0 ? Math.round((openaiStats.successfulRequests / openaiStats.requests) * 100) / 100 : 0
            },
            totalRequests,
            overallSuccessRate
        };
    }
}

// Export singleton instance
export const aiService = AIService.getInstance();

// 📊 Start periodic AI reporting (every hour)
setInterval(() => {
    AIService.generateAIReport();
}, 60 * 60 * 1000);

smartLog.info('AIService loaded with Smart Logging integration', {
    features: [
        'Claude + OpenAI fallback system',
        'Performance monitoring',
        'Error tracking',
        'Health checks',
        'Periodic reporting',
        'Business event logging',
        '🚨 CRITICAL FIX: Tool call fallback support with message transformation'
    ]
});
