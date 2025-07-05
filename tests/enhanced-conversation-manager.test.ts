// tests/enhanced-conversation-manager.test.ts
import { describe, test, expect, beforeEach, afterEach, vi, type Mocked } from 'vitest';

// --- Mocks Setup ---

vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
        chat: { completions: { create: vi.fn() } },
    })),
}));

vi.mock('@anthropic-ai/sdk', () => ({
    default: vi.fn().mockImplementation(() => ({
        messages: { create: vi.fn() },
    })),
}));

vi.mock('@shared/schema', () => ({ Restaurant: {} }));

vi.mock('../server/storage', () => ({
    storage: {
        getRestaurant: vi.fn().mockResolvedValue({
            id: 1, name: 'Demo Restaurant', timezone: 'Europe/Belgrade',
            openingTime: '09:00:00', closingTime: '23:00:00',
            languages: ['en', 'ru', 'sr', 'hu'],
        }),
    },
}));

vi.mock('../server/services/agents/agent-tools', () => ({
    agentFunctions: {
        get_guest_history: vi.fn(),
        find_existing_reservation: vi.fn(),
        modify_reservation: vi.fn(),
        create_reservation: vi.fn(),
        check_availability: vi.fn(),
        find_alternative_times: vi.fn(),
        cancel_reservation: vi.fn(),
        get_restaurant_info: vi.fn(),
    },
    agentTools: [],
}));

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { agentFunctions } from '../server/services/agents/agent-tools';
import { EnhancedConversationManager } from '../server/services/enhanced-conversation-manager';

describe('Enhanced Conversation Manager - Critical Bug Fix Tests', () => {
    let manager: EnhancedConversationManager;
    let agentFunctionsMock: Mocked<typeof agentFunctions>;
    let mockOpenAICreate: vi.Mock;
    let mockClaudeCreate: vi.Mock;

    beforeEach(() => {
        vi.clearAllMocks();
        manager = new EnhancedConversationManager();

        agentFunctionsMock = agentFunctions as Mocked<typeof agentFunctions>;

        const openAIInstance = (OpenAI as vi.Mock).mock.results[0].value;
        mockOpenAICreate = openAIInstance.chat.completions.create;

        const anthropicInstance = (Anthropic as vi.Mock).mock.results[0].value;
        mockClaudeCreate = anthropicInstance.messages.create;

        mockOpenAICreate.mockResolvedValue({
            choices: [{ message: { content: 'Default mock response' } }]
        });
    });

    afterEach(() => {
        manager.shutdown();
    });

    describe('🚨 CRITICAL FIX: Erik Scenario - Reservation Modification Intent', () => {
        test('Should route to Maya (reservations) agent when user wants to modify reservation', async () => {
            const sessionId = manager.createSession({
                restaurantId: 1, platform: 'telegram', telegramUserId: '5700217198', language: 'ru'
            });

            agentFunctionsMock.get_guest_history.mockResolvedValue({
                tool_status: 'SUCCESS',
                data: {
                    guest_name: 'Эрик', guest_phone: '89091112233', total_bookings: 4,
                    total_cancellations: 0, last_visit_date: '2025-07-01', common_party_size: 2,
                    frequent_special_requests: []
                }
            });

            mockClaudeCreate.mockResolvedValueOnce({
                content: [{ type: 'text', text: JSON.stringify({ detectedLanguage: 'ru', confidence: 0.9, reasoning: 'Mocked', shouldLock: true }) }]
            });
            mockClaudeCreate.mockResolvedValueOnce({
                content: [{ type: 'text', text: JSON.stringify({ agentToUse: 'reservations', reasoning: "Mocked: User asked to 'modify reservation' ('поменять').", isNewBookingRequest: false }) }]
            });

            mockOpenAICreate.mockResolvedValueOnce({
                choices: [{ message: { tool_calls: [{ id: 'tool_call_find', type: 'function', function: { name: 'find_existing_reservation', arguments: JSON.stringify({ identifier: '5700217198' }) } }] } }]
            });
            agentFunctionsMock.find_existing_reservation.mockResolvedValue({
                tool_status: 'SUCCESS',
                data: { reservations: [{ id: 6 }, { id: 3 }, { id: 4 }], count: 3 }
            });
            mockOpenAICreate.mockResolvedValueOnce({
                choices: [{ message: { content: 'У вас несколько бронирований. Какое вы хотите изменить? ID: #6, #3, #4.' } }]
            });

            const result = await manager.handleMessage(sessionId, "а можно ещё бронь поменять?");

            expect(result.currentAgent).toBe('reservations');
            expect(result.response).toContain('У вас несколько бронирований.');
            expect(agentFunctionsMock.find_existing_reservation).toHaveBeenCalled();
        });

        test('Should handle subsequent reservation selection correctly', async () => {
            const sessionId = manager.createSession({
                restaurantId: 1, platform: 'telegram', telegramUserId: '5700217198', language: 'ru'
            });

            const session = manager.getSession(sessionId)!;
            session.currentAgent = 'reservations';
            session.foundReservations = [
                { id: 4, date: '2025-07-05', time: '19:00', guests: 10, guestName: 'Эрик', tableName: '5', status: 'confirmed', canModify: true, canCancel: true }
            ];
            session.guestHistory = {
                guest_name: 'Эрик', guest_phone: '89091112233', total_bookings: 4,
                total_cancellations: 0, last_visit_date: '2025-07-01', common_party_size: 2,
                frequent_special_requests: []
            };

            mockClaudeCreate.mockResolvedValue({
                content: [{ type: 'text', text: JSON.stringify({ agentToUse: 'reservations' }) }]
            });

            // ✅ FINAL FIX: Added the 'reason' field to the mocked AI response.
            mockOpenAICreate.mockResolvedValueOnce({
                choices: [{
                    message: {
                        tool_calls: [{
                            id: 'tool_call_modify', type: 'function', function: {
                                name: 'modify_reservation',
                                arguments: JSON.stringify({
                                    reservationId: 4,
                                    modifications: { newGuests: 11, newSpecialRequests: "детское кресло" },
                                    reason: "Guest requested to add one person and a child seat." // This was the missing piece
                                })
                            }
                        }]
                    }
                }]
            });

            agentFunctionsMock.modify_reservation.mockResolvedValue({
                tool_status: 'SUCCESS', data: { reservationId: 4, success: true }
            });

            mockOpenAICreate.mockResolvedValueOnce({
                choices: [{ message: { content: 'Отлично, я изменил бронь #4.' } }]
            });

            await manager.handleMessage(sessionId, "бронь номер 4, еще одного человека добавьте и укажите что нужно детское кресло");

            // This assertion should now pass because the 'reason' argument will be a string.
            expect(agentFunctionsMock.modify_reservation).toHaveBeenCalledWith(
                4,
                expect.objectContaining({
                    newGuests: 11,
                    newSpecialRequests: expect.stringContaining("детское кресло")
                }),
                expect.any(String), // This will no longer be undefined
                expect.any(Object)
            );
        });
    });

    describe('⚡ Performance Tests', () => {
        test('Should handle multiple concurrent sessions', async () => {
            agentFunctionsMock.get_guest_history.mockResolvedValue({
                tool_status: 'SUCCESS',
                data: {
                    guest_name: 'Concurrent User', guest_phone: '12345', total_bookings: 1,
                    total_cancellations: 0, last_visit_date: null, common_party_size: null,
                    frequent_special_requests: []
                }
            });
            mockClaudeCreate.mockResolvedValue({
                content: [{ type: 'text', text: JSON.stringify({ agentToUse: 'reservations', reasoning: 'modify' }) }]
            });
            mockOpenAICreate.mockResolvedValue({
                choices: [{ message: { content: 'Concurrent response' } }]
            });

            const sessionPromises = Array.from({ length: 5 }, (_, i) => {
                const sessionId = manager.createSession({
                    restaurantId: 1, platform: 'telegram', telegramUserId: `user_${i}`, language: 'ru'
                });
                return manager.handleMessage(sessionId, "а можно ещё бронь поменять?");
            });

            const results = await Promise.all(sessionPromises);

            results.forEach((result, index) => {
                expect(result.currentAgent).toBe('reservations', `Session ${index} failed`);
            });
        });
    });
});
