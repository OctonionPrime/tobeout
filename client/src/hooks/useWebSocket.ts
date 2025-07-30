import { useEffect, useRef, useState, useCallback } from 'react';

interface WebSocketMessage {
    type: 'RESERVATION_CREATED' | 'RESERVATION_CANCELED' | 'RESERVATION_UPDATED' | 'TABLE_STATUS_UPDATED' | 'CONNECTION_ESTABLISHED' | 'PING' | 'PONG' | 'ERROR';
    payload: any;
    timestamp?: string;
    tenantId?: number;
}

interface UseWebSocketOptions {
    url: string;
    onMessage?: (message: WebSocketMessage) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onError?: (error: Event) => void;
    reconnectAttempts?: number;
    reconnectInterval?: number;
    enabled?: boolean;
}

export function useWebSocket({
    url,
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    reconnectAttempts = 5,
    reconnectInterval = 3000,
    enabled = true
}: UseWebSocketOptions) {
    const ws = useRef<WebSocket | null>(null);
    const reconnectCount = useRef(0);
    const reconnectTimer = useRef<NodeJS.Timeout>();
    const pingInterval = useRef<NodeJS.Timeout>();
    const isManualDisconnect = useRef(false);
    const [isConnected, setIsConnected] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error' | 'disabled'>('disconnected');

    const cleanup = useCallback(() => {
        if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current);
            reconnectTimer.current = undefined;
        }
        if (pingInterval.current) {
            clearInterval(pingInterval.current);
            pingInterval.current = undefined;
        }
    }, []);

    const connect = useCallback(() => {
        // Don't connect if disabled or URL is empty
        if (!enabled || !url) {
            setConnectionStatus('disabled');
            setIsConnected(false);
            cleanup();
            return;
        }

        // Don't create new connection if already connected
        if (ws.current?.readyState === WebSocket.OPEN) {
            return;
        }

        // Clean up any existing connection
        if (ws.current) {
            ws.current.close();
            ws.current = null;
        }

        setConnectionStatus('connecting');
        console.log('🔌 [WebSocket] Attempting to connect to:', url);

        try {
            ws.current = new WebSocket(url);

            ws.current.onopen = () => {
                console.log('✅ [WebSocket] Connected successfully to', url);
                setIsConnected(true);
                setConnectionStatus('connected');
                reconnectCount.current = 0;
                isManualDisconnect.current = false;

                // Start ping interval to keep connection alive
                pingInterval.current = setInterval(() => {
                    if (ws.current?.readyState === WebSocket.OPEN) {
                        ws.current.send(JSON.stringify({ type: 'PING', payload: {} }));
                    }
                }, 30000); // Ping every 30 seconds

                onConnect?.();
            };

            ws.current.onmessage = (event) => {
                try {
                    const message: WebSocketMessage = JSON.parse(event.data);

                    // Handle PONG messages silently
                    if (message.type === 'PONG') {
                        return;
                    }

                    // Handle connection establishment confirmation
                    if (message.type === 'CONNECTION_ESTABLISHED') {
                        console.log('✅ [WebSocket] Connection authenticated for tenant:', message.payload.tenantId);
                        return;
                    }

                    // Handle error messages
                    if (message.type === 'ERROR') {
                        console.error('❌ [WebSocket] Server error:', message.payload);
                        return;
                    }

                    onMessage?.(message);
                } catch (error) {
                    console.error('❌ [WebSocket] Error parsing message:', error, event.data);
                }
            };

            ws.current.onclose = (event) => {
                console.log('🔌 [WebSocket] Connection closed:', event.code, event.reason);
                setIsConnected(false);

                // Clear ping interval
                if (pingInterval.current) {
                    clearInterval(pingInterval.current);
                    pingInterval.current = undefined;
                }

                // Handle different close codes
                if (event.code === 4001) {
                    // Authentication failed - don't reconnect
                    console.log('❌ [WebSocket] Authentication failed - not reconnecting');
                    setConnectionStatus('error');
                    onDisconnect?.();
                    return;
                }

                if (event.wasClean || isManualDisconnect.current) {
                    // Clean disconnect - don't reconnect
                    setConnectionStatus('disconnected');
                    onDisconnect?.();
                    return;
                }

                // Unexpected disconnect - attempt reconnection if enabled
                if (enabled && reconnectCount.current < reconnectAttempts) {
                    setConnectionStatus('connecting');
                    reconnectCount.current++;

                    const delay = reconnectInterval * Math.pow(1.5, reconnectCount.current - 1); // Exponential backoff
                    console.log(`🔄 [WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectCount.current}/${reconnectAttempts})`);

                    reconnectTimer.current = setTimeout(() => {
                        if (enabled) {
                            connect();
                        }
                    }, delay);
                } else {
                    console.log('❌ [WebSocket] Max reconnection attempts reached or disabled');
                    setConnectionStatus('error');
                }

                onDisconnect?.();
            };

            ws.current.onerror = (error) => {
                console.error('❌ [WebSocket] Connection error:', error);
                setConnectionStatus('error');
                onError?.(error);
            };

        } catch (error) {
            console.error('❌ [WebSocket] Error creating connection:', error);
            setConnectionStatus('error');
        }
    }, [url, onMessage, onConnect, onDisconnect, onError, reconnectAttempts, reconnectInterval, enabled, cleanup]);

    const disconnect = useCallback(() => {
        console.log('🔌 [WebSocket] Manual disconnect requested');
        isManualDisconnect.current = true;
        cleanup();

        if (ws.current) {
            ws.current.close(1000, 'Manual disconnect');
            ws.current = null;
        }

        setIsConnected(false);
        setConnectionStatus('disconnected');
    }, [cleanup]);

    const sendMessage = useCallback((message: Partial<WebSocketMessage>) => {
        if (ws.current?.readyState === WebSocket.OPEN) {
            try {
                const fullMessage = {
                    ...message,
                    timestamp: new Date().toISOString()
                };
                ws.current.send(JSON.stringify(fullMessage));
                return true;
            } catch (error) {
                console.error('❌ [WebSocket] Error sending message:', error);
                return false;
            }
        }
        console.warn('⚠️ [WebSocket] Cannot send message - not connected:', message);
        return false;
    }, []);

    const reconnect = useCallback(() => {
        console.log('🔄 [WebSocket] Manual reconnect requested');
        reconnectCount.current = 0;
        isManualDisconnect.current = false;
        disconnect();

        // Small delay before reconnecting
        setTimeout(() => {
            if (enabled) {
                connect();
            }
        }, 1000);
    }, [enabled, connect, disconnect]);

    // Connect/disconnect based on enabled state and URL
    useEffect(() => {
        if (enabled && url) {
            connect();
        } else {
            disconnect();
        }

        return () => {
            isManualDisconnect.current = true;
            cleanup();
            if (ws.current) {
                ws.current.close(1000, 'Component unmounting');
                ws.current = null;
            }
        };
    }, [enabled, url, connect, disconnect, cleanup]);

    // ✅ FIX: Reconnect only if the URL has actually changed to prevent loops.
    useEffect(() => {
        // Note: ws.current.url is not a standard WebSocket property. 
        // This check relies on the fact that we are managing the 'url' prop from outside.
        // A more robust way might be to store the last connected URL in a ref,
        // but this logic prevents the loop identified in the logs.
        if (ws.current && url !== ws.current.url && enabled) {
            console.log('🔄 [WebSocket] URL changed, reconnecting...');
            reconnect();
        }
    }, [url, reconnect, enabled]);

    return {
        isConnected: enabled && isConnected,
        connectionStatus: enabled ? connectionStatus : 'disabled',
        sendMessage,
        disconnect,
        reconnect
    };
}