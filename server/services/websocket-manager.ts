import { WebSocketServer } from 'ws';
import { AuthenticatedWebSocket, ExtendedWebSocketServer, WebSocketMessage, SessionValidationResult } from '../types/websocket.js';
import { storage } from '../storage.js';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';

export class WebSocketManager {
    private wss: ExtendedWebSocketServer;
    private connections = new Map<string, AuthenticatedWebSocket[]>();
    private pingInterval: NodeJS.Timeout;
    private messageRateLimit = new Map<string, { count: number; resetTime: number }>();

    constructor(wss: ExtendedWebSocketServer) {
        this.wss = wss;
        this.setupEventHandlers();
        this.startPingInterval();

        console.log('🔌 [WebSocketManager] Manager initialized');
    }

    private setupEventHandlers() {
        this.wss.on('connection', this.handleConnection.bind(this));
    }

    private async handleConnection(ws: AuthenticatedWebSocket, request: any) {
        console.log('🔌 [WebSocket] Connection attempt from:', request.socket.remoteAddress);

        ws.connectionId = uuidv4();
        ws.lastPing = Date.now();

        try {
            // Extract session from cookies or query params
            const authResult = await this.authenticateConnection(request);

            if (authResult) {
                ws.tenantId = authResult.tenantId;
                ws.userId = authResult.userId;
                ws.isAuthenticated = true;

                this.addToTenantGroup(authResult.tenantId, ws);

                // Send connection confirmation
                this.sendToSocket(ws, {
                    type: 'CONNECTION_ESTABLISHED',
                    payload: {
                        tenantId: authResult.tenantId,
                        userId: authResult.userId,
                        connectionId: ws.connectionId
                    }
                });

                console.log(`✅ [WebSocket] Authenticated connection for tenant ${authResult.tenantId}, user ${authResult.userId}`);
            } else {
                console.log('❌ [WebSocket] Authentication failed');
                ws.close(4001, 'Authentication failed');
                return;
            }
        } catch (error) {
            console.error('🔥 [WebSocket] Authentication error:', error);
            ws.close(4001, 'Authentication error');
            return;
        }

        ws.on('message', (data) => this.handleMessage(ws, data));
        ws.on('close', () => this.handleDisconnection(ws));
        ws.on('error', (error) => this.handleError(ws, error));
        ws.on('pong', () => {
            ws.lastPing = Date.now();
        });
    }

    private async authenticateConnection(request: any): Promise<SessionValidationResult | null> {
        try {
            console.log('🔐 [WebSocket] Starting authentication process');

            // Extract session ID from cookies
            const cookies = this.parseCookies(request.headers.cookie || '');
            const sessionId = cookies['connect.sid'];

            if (!sessionId) {
                console.log('❌ [WebSocket] No session ID found in cookies');
                return null;
            }

            // Clean the session ID (remove s: prefix and extract actual ID)
            const cleanSessionId = this.cleanSessionId(sessionId);
            console.log('🔐 [WebSocket] Cleaned session ID for validation');

            // Validate session using existing PostgreSQL session store
            const sessionData = await this.validateSession(cleanSessionId);
            if (!sessionData || !sessionData.passport?.user) {
                console.log('❌ [WebSocket] Invalid session or no user in session');
                return null;
            }

            const userId = sessionData.passport.user.id;
            console.log(`🔐 [WebSocket] Found user ID ${userId} in session`);

            // Get user details using existing storage method
            const user = await storage.getUser(userId);
            if (!user) {
                console.log('❌ [WebSocket] User not found in database');
                return null;
            }

            // Only allow restaurant users to connect to WebSocket 
            if (!['restaurant', 'staff'].includes(user.role)) {
                console.log(`❌ [WebSocket] User role '${user.role}' not permitted, rejecting WebSocket connection`);
                return null;
            }

            // Get user's restaurant (tenant) using existing storage method
            const restaurant = await storage.getRestaurantByUserId(userId);
            if (!restaurant) {
                console.log('❌ [WebSocket] No restaurant found for user');
                return null;
            }

            // Check if tenant is active
            if (restaurant.tenantStatus !== 'active' && restaurant.tenantStatus !== 'trial') {
                console.log(`❌ [WebSocket] Restaurant tenant status is ${restaurant.tenantStatus}, rejecting connection`);
                return null;
            }

            console.log(`✅ [WebSocket] Authentication successful for user ${userId}, tenant ${restaurant.id}`);
            return {
                tenantId: restaurant.id,
                userId: user.id
            };
        } catch (error) {
            console.error('🔥 [WebSocket] Session validation error:', error);
            return null;
        }
    }

    private parseCookies(cookieHeader: string): Record<string, string> {
        const cookies: Record<string, string> = {};
        if (!cookieHeader) return cookies;

        cookieHeader.split(';').forEach(cookie => {
            const [name, ...rest] = cookie.trim().split('=');
            if (name && rest.length > 0) {
                cookies[name] = decodeURIComponent(rest.join('='));
            }
        });
        return cookies;
    }

    private cleanSessionId(rawSessionId: string): string {
        // Remove URL encoding 
        let cleaned = decodeURIComponent(rawSessionId);

        // Remove the 's:' prefix that connect-pg-simple uses
        if (cleaned.startsWith('s:')) {
            cleaned = cleaned.substring(2);
        }

        // Remove signature part (everything after the first dot)
        const dotIndex = cleaned.indexOf('.');
        if (dotIndex > -1) {
            cleaned = cleaned.substring(0, dotIndex);
        }

        return cleaned;
    }

    private async validateSession(sessionId: string): Promise<any> {
        try {
            console.log('🔐 [WebSocket] Validating session with database');

            const sql = `SELECT sess FROM user_sessions WHERE sid = $1 AND expire > NOW()`;
            const params = [sessionId];

            const result = await pool.query(sql, params);

            if (!result.rows || result.rows.length === 0) {
                console.log('❌ [WebSocket] Session not found or expired');
                return null;
            }

            // ✅ **FIX**: Parse the session data (it's stored as JSON)
            const sessionData = JSON.parse(result.rows[0].sess);
            console.log('✅ [WebSocket] Session found and valid');

            return sessionData;
        } catch (error) {
            console.error('🔥 [WebSocket] Session query error:', error);
            return null;
        }
    }

    private handleMessage(ws: AuthenticatedWebSocket, data: Buffer) {
        try {
            // Rate limiting check
            if (!this.checkRateLimit(ws.connectionId!)) {
                console.log(`⚠️ [WebSocket] Rate limit exceeded for connection ${ws.connectionId}`);
                this.sendToSocket(ws, {
                    type: 'ERROR',
                    payload: { message: 'Rate limit exceeded' }
                });
                return;
            }

            const message: WebSocketMessage = JSON.parse(data.toString());

            switch (message.type) {
                case 'PING':
                    this.sendToSocket(ws, { type: 'PONG', payload: {} });
                    break;
                default:
                    console.log('❓ [WebSocket] Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('🔥 [WebSocket] Error parsing message:', error);
        }
    }

    private checkRateLimit(connectionId: string): boolean {
        const now = Date.now();
        const limit = this.messageRateLimit.get(connectionId);

        if (!limit || now > limit.resetTime) {
            this.messageRateLimit.set(connectionId, { count: 1, resetTime: now + 60000 });
            return true;
        }

        if (limit.count >= 60) { // 60 messages per minute
            return false;
        }

        limit.count++;
        return true;
    }

    private handleDisconnection(ws: AuthenticatedWebSocket) {
        if (ws.tenantId) {
            this.removeFromTenantGroup(ws.tenantId, ws);
            console.log(`🔌 [WebSocket] Disconnected: tenant ${ws.tenantId}, user ${ws.userId}`);
        }

        // Clean up rate limiting
        if (ws.connectionId) {
            this.messageRateLimit.delete(ws.connectionId);
        }
    }

    private handleError(ws: AuthenticatedWebSocket, error: Error) {
        console.error(`🔥 [WebSocket] Error for tenant ${ws.tenantId}:`, error.message);
    }

    private addToTenantGroup(tenantId: number, ws: AuthenticatedWebSocket) {
        const key = `tenant_${tenantId}`;
        if (!this.connections.has(key)) {
            this.connections.set(key, []);
        }
        this.connections.get(key)!.push(ws);

        console.log(`🏢 [WebSocket] Added connection to tenant ${tenantId} group (${this.connections.get(key)!.length} total)`);
    }

    private removeFromTenantGroup(tenantId: number, ws: AuthenticatedWebSocket) {
        const key = `tenant_${tenantId}`;
        const connections = this.connections.get(key);
        if (connections) {
            const index = connections.indexOf(ws);
            if (index > -1) {
                connections.splice(index, 1);
            }
            if (connections.length === 0) {
                this.connections.delete(key);
            }
        }
    }

    public broadcastToTenant(tenantId: number, data: WebSocketMessage) {
        const key = `tenant_${tenantId}`;
        const tenantConnections = this.connections.get(key) || [];

        if (tenantConnections.length === 0) {
            console.log(`📢 [WebSocket] No connections for tenant ${tenantId}, skipping broadcast`);
            return;
        }

        data.timestamp = new Date().toISOString();
        data.tenantId = tenantId;

        const jsonData = JSON.stringify(data);
        let sentCount = 0;
        let removedCount = 0;

        // Use reverse iteration to safely remove closed connections
        for (let i = tenantConnections.length - 1; i >= 0; i--) {
            const ws = tenantConnections[i];

            if (ws.readyState === ws.OPEN && ws.isAuthenticated) {
                try {
                    ws.send(jsonData);
                    sentCount++;
                } catch (error) {
                    console.error('🔥 [WebSocket] Error sending message:', error);
                    tenantConnections.splice(i, 1);
                    removedCount++;
                }
            } else {
                // Remove closed/unauthenticated connections
                tenantConnections.splice(i, 1);
                removedCount++;
            }
        }

        if (removedCount > 0) {
            console.log(`🧹 [WebSocket] Cleaned up ${removedCount} stale connections for tenant ${tenantId}`);
        }

        console.log(`📢 [WebSocket] Broadcasted '${data.type}' to ${sentCount} connections for tenant ${tenantId}`);
    }

    public broadcast(data: WebSocketMessage) {
        // Global broadcast (use with extreme caution in multi-tenant system)
        console.warn('⚠️  [WebSocket] GLOBAL BROADCAST USED - This should be rare in multi-tenant systems!');

        const jsonData = JSON.stringify({
            ...data,
            timestamp: new Date().toISOString()
        });

        let sentCount = 0;
        this.wss.clients.forEach(client => {
            const ws = client as AuthenticatedWebSocket;
            if (ws.readyState === ws.OPEN && ws.isAuthenticated) {
                try {
                    ws.send(jsonData);
                    sentCount++;
                } catch (error) {
                    console.error('🔥 [WebSocket] Error in global broadcast:', error);
                }
            }
        });

        console.log(`📢 [WebSocket] Global broadcast sent to ${sentCount} connections`);
    }

    private sendToSocket(ws: AuthenticatedWebSocket, data: Partial<WebSocketMessage>) {
        if (ws.readyState === ws.OPEN) {
            const message = {
                ...data,
                timestamp: new Date().toISOString()
            };
            ws.send(JSON.stringify(message));
        }
    }

    private startPingInterval() {
        this.pingInterval = setInterval(() => {
            const now = Date.now();
            let terminatedCount = 0;

            this.wss.clients.forEach(client => {
                const ws = client as AuthenticatedWebSocket;

                if (ws.lastPing && now - ws.lastPing > 60000) {
                    // Client hasn't responded to ping in 60 seconds
                    console.log(`🧹 [WebSocket] Terminating inactive connection for tenant ${ws.tenantId}`);
                    ws.terminate();
                    terminatedCount++;
                } else if (ws.readyState === ws.OPEN) {
                    ws.ping();
                }
            });

            if (terminatedCount > 0) {
                console.log(`🧹 [WebSocket] Terminated ${terminatedCount} inactive connections`);
            }
        }, 30000); // Ping every 30 seconds

        console.log('⏰ [WebSocket] Ping interval started (30s)');
    }

    public getStats() {
        const stats = {
            totalConnections: this.wss.clients.size,
            authenticatedConnections: 0,
            tenantGroups: this.connections.size,
            tenantStats: {} as Record<string, number>,
            rateLimitEntries: this.messageRateLimit.size
        };

        this.wss.clients.forEach(client => {
            const ws = client as AuthenticatedWebSocket;
            if (ws.isAuthenticated) {
                stats.authenticatedConnections++;
            }
        });

        this.connections.forEach((connections, key) => {
            const activeConnections = connections.filter(ws =>
                ws.readyState === ws.OPEN && ws.isAuthenticated
            ).length;
            stats.tenantStats[key] = activeConnections;
        });

        return stats;
    }

    public cleanup() {
        console.log('🧹 [WebSocket] Starting cleanup process');

        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            console.log('⏰ [WebSocket] Ping interval cleared');
        }

        this.wss.clients.forEach(client => {
            client.terminate();
        });

        this.connections.clear();
        this.messageRateLimit.clear();

        console.log('✅ [WebSocket] Cleanup completed');
    }
}