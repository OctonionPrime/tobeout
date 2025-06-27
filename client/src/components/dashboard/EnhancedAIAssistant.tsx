// client/src/components/dashboard/EnhancedAIAssistant.tsx

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, Bot, User, Send, Sparkles, Check, X, Maximize2, Minimize2, Move, CheckCircle, XCircle } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useRestaurantTimezone } from "@/components/layout/DashboardLayout";
import { cn } from "@/lib/utils";

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    hasBooking?: boolean;
    reservationId?: number;
    requiresConfirmation?: boolean; // ✅ NEW: Flag for confirmation requests
}

interface SessionInfo {
    gatheringInfo: {
        date?: string;
        time?: string;
        guests?: number;
        name?: string;
        phone?: string;
        comments?: string;
    };
    currentStep: string;
    conversationLength: number;
}

export function EnhancedAIAssistant() {
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputMessage, setInputMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isInitializing, setIsInitializing] = useState(true);
    const [awaitingConfirmation, setAwaitingConfirmation] = useState(false); // ✅ NEW: Track confirmation state
    
    // Compact mode and draggable state
    const [isCompact, setIsCompact] = useState(true);
    const [isMinimized, setIsMinimized] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

    const { user } = useAuth();
    const { restaurantTimezone } = useRestaurantTimezone();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);

    // Initialize chat session on component mount
    useEffect(() => {
        initializeSession();
    }, []);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Focus input after session is ready
    useEffect(() => {
        if (sessionId && !isInitializing && !isMinimized && !awaitingConfirmation) {
            inputRef.current?.focus();
        }
    }, [sessionId, isInitializing, isMinimized, awaitingConfirmation]);

    // ✅ NEW: Detect confirmation requests
    const detectConfirmationRequest = (content: string): boolean => {
        const confirmationPatterns = [
            /подтверждаете.*бронирование/i, // Russian: confirm booking
            /ответьте.*да.*для.*подтверждения/i, // Russian: reply yes to confirm
            /please confirm.*reservation/i, // English: confirm reservation
            /reply.*yes.*to confirm/i, // English: reply yes to confirm
            /potvrdi.*rezervaciju/i, // Serbian: confirm reservation
            /да.*для.*подтверждения/i, // Russian: yes to confirm
            /confirm.*this.*reservation/i // English: confirm this reservation
        ];
        
        return confirmationPatterns.some(pattern => pattern.test(content));
    };

    const initializeSession = async () => {
        try {
            setIsInitializing(true);
            setError(null);

            const response = await fetch('/api/chat/session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    platform: 'web',
                    language: 'en'
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to create session: ${response.status}`);
            }

            const data = await response.json();
            setSessionId(data.sessionId);

            const welcomeMessage: ChatMessage = {
                role: 'assistant',
                content: data.restaurantGreeting || `🌟 Hi! I'm Sofia, your AI booking assistant for ${data.restaurantName}! I can help you check availability, make reservations quickly. Try: "Book Martinez for 4 tonight at 8pm, phone 555-1234"`,
                timestamp: new Date()
            };

            setMessages([welcomeMessage]);
            console.log(`[EnhancedAIAssistant] Session created: ${data.sessionId}`);

        } catch (error) {
            console.error('[EnhancedAIAssistant] Failed to initialize session:', error);
            setError('Failed to start chat session. Please try refreshing the page.');
        } finally {
            setIsInitializing(false);
        }
    };

    const sendMessage = async (messageContent?: string) => {
        const content = messageContent || inputMessage.trim();
        if (!content || !sessionId || isLoading) return;

        const userMessage: ChatMessage = {
            role: 'user',
            content: content,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMessage]);
        setInputMessage('');
        setIsLoading(true);
        setError(null);
        setAwaitingConfirmation(false); // Clear confirmation state

        try {
            const response = await fetch('/api/chat/message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    sessionId,
                    message: content
                })
            });

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('Your session has expired. Please refresh the page.');
                }
                throw new Error(`Failed to send message: ${response.status}`);
            }

            const data = await response.json();

            // ✅ NEW: Detect if this response requires confirmation
            const requiresConfirmation = detectConfirmationRequest(data.response);

            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: data.response,
                timestamp: new Date(),
                hasBooking: data.hasBooking,
                reservationId: data.reservationId,
                requiresConfirmation // ✅ NEW: Add confirmation flag
            };

            setMessages(prev => [...prev, assistantMessage]);
            setSessionInfo(data.sessionInfo);
            setAwaitingConfirmation(requiresConfirmation); // ✅ NEW: Set confirmation state

            if (data.hasBooking && data.reservationId) {
                console.log(`[EnhancedAIAssistant] Booking completed! Reservation ID: ${data.reservationId}`);
            }

        } catch (error) {
            console.error('[EnhancedAIAssistant] Error sending message:', error);
            setError(error instanceof Error ? error.message : 'Failed to send message');

            const errorMessage: ChatMessage = {
                role: 'assistant',
                content: 'I encountered an error. Please try again or refresh if the problem persists.',
                timestamp: new Date()
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    // ✅ NEW: Handle confirmation button clicks
    const handleConfirmation = (confirmed: boolean) => {
        const confirmationText = confirmed ? 'да' : 'нет'; // Use Russian since logs show Russian conversation
        sendMessage(confirmationText);
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const formatTime = (date: Date): string => {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const refreshSession = () => {
        setSessionId(null);
        setMessages([]);
        setSessionInfo(null);
        setError(null);
        setAwaitingConfirmation(false);
        initializeSession();
    };

    // Draggable functionality
    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.drag-handle')) {
            setIsDragging(true);
            setDragStart({
                x: e.clientX - position.x,
                y: e.clientY - position.y
            });
        }
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (isDragging) {
            setPosition({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    useEffect(() => {
        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging, dragStart]);

    // Dynamic height calculation
    const getCardHeight = () => {
        if (isMinimized) return 'h-12';
        if (isCompact) return 'h-48';
        return 'h-96';
    };

    if (isInitializing) {
        return (
            <Card className="border border-gray-200 h-48 relative">
                <CardHeader className="border-b border-gray-200">
                    <CardTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-purple-600" />
                        Sofia AI Assistant
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-center flex-1">
                    <div className="text-center">
                        <Loader2 className="h-8 w-8 animate-spin text-purple-600 mx-auto mb-2" />
                        <p className="text-sm text-gray-600">Starting Sofia...</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card 
            ref={cardRef}
            className={cn(
                "border border-gray-200 flex flex-col",
                getCardHeight(),
                "transition-all duration-300 ease-in-out",
                isDragging ? "cursor-grabbing" : "cursor-grab",
                "relative z-50"
            )}
            style={{
                transform: `translate(${position.x}px, ${position.y}px)`,
                maxWidth: isCompact ? '400px' : '500px',
                minWidth: '320px'
            }}
            onMouseDown={handleMouseDown}
        >
            <CardHeader className="border-b border-gray-200 flex-shrink-0 py-2">
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-sm">
                        <div className="drag-handle cursor-grab">
                            <Move className="h-4 w-4 text-gray-400" />
                        </div>
                        <Sparkles className="h-4 w-4 text-purple-600" />
                        Sofia AI
                        {sessionInfo && !isMinimized && (
                            <Badge variant="outline" className="text-xs">
                                {sessionInfo.currentStep}
                            </Badge>
                        )}
                        {awaitingConfirmation && !isMinimized && (
                            <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800">
                                Awaiting Confirmation
                            </Badge>
                        )}
                    </CardTitle>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsCompact(!isCompact)}
                            className="h-6 w-6 p-0 text-gray-500 hover:text-gray-700"
                        >
                            {isCompact ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
                        </Button>
                        
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsMinimized(!isMinimized)}
                            className="h-6 w-6 p-0 text-gray-500 hover:text-gray-700"
                        >
                            {isMinimized ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
                        </Button>
                        
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={refreshSession}
                            className="h-6 w-6 p-0 text-gray-500 hover:text-gray-700"
                        >
                            <X className="h-3 w-3" />
                        </Button>
                    </div>
                </div>
                {error && !isMinimized && (
                    <div className="text-xs text-red-600 bg-red-50 p-2 rounded-md mt-1">
                        {error}
                    </div>
                )}
            </CardHeader>

            {!isMinimized && (
                <CardContent className="flex-1 flex flex-col p-0">
                    {/* Messages Area */}
                    <ScrollArea className={cn(
                        "flex-1 p-3",
                        isCompact ? "max-h-24" : "max-h-64"
                    )}>
                        <div className="space-y-2">
                            {messages.map((message, index) => (
                                <div
                                    key={index}
                                    className={cn(
                                        "flex items-start gap-2",
                                        message.role === 'user' ? "flex-row-reverse" : "flex-row"
                                    )}
                                >
                                    <div className={cn(
                                        "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0",
                                        message.role === 'user'
                                            ? "bg-blue-100 text-blue-600"
                                            : "bg-purple-100 text-purple-600"
                                    )}>
                                        {message.role === 'user' ? (
                                            <User className="w-3 h-3" />
                                        ) : (
                                            <Sparkles className="w-3 h-3" />
                                        )}
                                    </div>

                                    <div className={cn(
                                        "max-w-[75%] rounded-lg px-2 py-1 text-xs",
                                        message.role === 'user'
                                            ? "bg-blue-600 text-white"
                                            : "bg-gray-100 text-gray-800"
                                    )}>
                                        <div className="whitespace-pre-wrap">{message.content}</div>

                                        {message.hasBooking && message.reservationId && (
                                            <div className="mt-1 flex items-center gap-1 text-green-600 bg-green-50 rounded px-1 py-0.5">
                                                <Check className="w-3 h-3" />
                                                <span className="text-xs font-medium">
                                                    Reservation #{message.reservationId}
                                                </span>
                                            </div>
                                        )}

                                        <div className={cn(
                                            "text-xs mt-0.5 opacity-70",
                                            message.role === 'user' ? "text-blue-100" : "text-gray-500"
                                        )}>
                                            {formatTime(message.timestamp)}
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {isLoading && (
                                <div className="flex items-start gap-2">
                                    <div className="w-6 h-6 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center">
                                        <Sparkles className="w-3 h-3" />
                                    </div>
                                    <div className="bg-gray-100 rounded-lg px-2 py-1 text-xs">
                                        <div className="flex items-center gap-1">
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            <span>Sofia...</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>
                    </ScrollArea>

                    {/* Input Area */}
                    <div className="border-t border-gray-200 p-2 flex-shrink-0">
                        {/* Session Info - Only show in expanded mode */}
                        {!isCompact && sessionInfo && sessionInfo.gatheringInfo && Object.keys(sessionInfo.gatheringInfo).length > 0 && (
                            <div className="mb-2 p-1 bg-purple-50 rounded text-xs">
                                <div className="font-medium text-purple-700 mb-0.5">Booking Info:</div>
                                <div className="text-purple-600 space-x-2">
                                    {sessionInfo.gatheringInfo.guests && <span>👥 {sessionInfo.gatheringInfo.guests}</span>}
                                    {sessionInfo.gatheringInfo.date && <span>📅 {sessionInfo.gatheringInfo.date}</span>}
                                    {sessionInfo.gatheringInfo.time && <span>🕐 {sessionInfo.gatheringInfo.time}</span>}
                                    {sessionInfo.gatheringInfo.name && <span>👤 {sessionInfo.gatheringInfo.name}</span>}
                                </div>
                            </div>
                        )}

                        {/* ✅ NEW: Confirmation Buttons */}
                        {awaitingConfirmation && !isLoading && (
                            <div className="mb-2 flex gap-2">
                                <Button
                                    onClick={() => handleConfirmation(true)}
                                    size="sm"
                                    className="flex-1 bg-green-600 hover:bg-green-700 text-white h-8"
                                >
                                    <CheckCircle className="w-3 h-3 mr-1" />
                                    Yes / Да
                                </Button>
                                <Button
                                    onClick={() => handleConfirmation(false)}
                                    variant="outline"
                                    size="sm"
                                    className="flex-1 border-red-300 text-red-600 hover:bg-red-50 h-8"
                                >
                                    <XCircle className="w-3 h-3 mr-1" />
                                    No / Нет
                                </Button>
                            </div>
                        )}

                        {/* Message Input */}
                        <div className="flex gap-1">
                            <Input
                                ref={inputRef}
                                value={inputMessage}
                                onChange={(e) => setInputMessage(e.target.value)}
                                onKeyPress={handleKeyPress}
                                placeholder={
                                    awaitingConfirmation 
                                        ? "Use buttons above or type yes/no..." 
                                        : isCompact 
                                            ? "Ask Sofia..." 
                                            : "Ask Sofia about availability, make reservations..."
                                }
                                disabled={isLoading || !sessionId}
                                className="flex-1 text-xs h-8"
                            />
                            <Button
                                onClick={() => sendMessage()}
                                disabled={!inputMessage.trim() || isLoading || !sessionId}
                                size="sm"
                                className="px-2 h-8"
                            >
                                <Send className="w-3 h-3" />
                            </Button>
                        </div>

                        {!isCompact && (
                            <div className="text-xs text-gray-500 mt-1 text-center">
                                Sofia AI • {restaurantTimezone}
                                {awaitingConfirmation && <span className="text-amber-600"> • Waiting for confirmation</span>}
                            </div>
                        )}
                    </div>
                </CardContent>
            )}
        </Card>
    );
}

export default EnhancedAIAssistant;