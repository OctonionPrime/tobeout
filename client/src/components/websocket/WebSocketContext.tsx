import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
// FIXED: Use static import instead of dynamic import
import { queryClient } from '@/lib/queryClient';

// Types for WebSocket messages matching backend
interface WebSocketMessage {
  type: 'RESERVATION_CREATED' | 'RESERVATION_CANCELED' | 'RESERVATION_UPDATED' | 'TABLE_STATUS_UPDATED' | 'CONNECTION_ESTABLISHED' | 'PING' | 'PONG' | 'ERROR';
  payload: any;
  timestamp?: string;
  tenantId?: number;
}

interface WebSocketContextType {
  isConnected: boolean;
  connectionStatus: string;
  sendMessage: (message: any) => boolean;
  lastMessage: WebSocketMessage | null;
  disconnect: () => void;
  reconnect: () => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

// ✅ Helper function to safely extract reservation data (same as in reservations.tsx)
const extractReservationData = (reservationData: any) => {
  // Handle both nested {reservation: {...}, guest: {...}} and flat structures
  const reservation = reservationData.reservation || reservationData;
  const guest = reservationData.guest || reservation.guest || {};
  const table = reservationData.table || reservation.table || {};
  
  return {
    reservation: {
      ...reservation,
      // Normalize status field
      status: reservation.status || 'unknown',
      // Ensure we have a reservation_utc field
      reservation_utc: reservation.reservation_utc || reservation.dateTime || reservation.timestamp
    },
    guest: {
      ...guest,
      // Normalize guest name from multiple possible sources
      name: guest.name || reservation.booking_guest_name || reservationData.guestName || 'Guest'
    },
    table
  };
};

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const { isAuthenticated, user } = useAuth();
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [shouldConnect, setShouldConnect] = useState(false);

  // Only connect WebSocket for authenticated tenant users (not super admins)
  useEffect(() => {
    const isTenantUser = isAuthenticated && user && !user.isSuperAdmin;
    setShouldConnect(Boolean(isTenantUser));
    
    if (isTenantUser) {
      console.log('🔌 [WebSocket] Enabling connection for tenant user:', user.email);
    } else if (user?.isSuperAdmin) {
      console.log('🔌 [WebSocket] Skipping connection for super admin user:', user.email);
    }
  }, [isAuthenticated, user]);

  // ✅ UPGRADED: handleMessage with OPTIMISTIC UPDATES for instant UI
  const handleMessage = useCallback((message: WebSocketMessage) => {
    console.log('📨 [WebSocket] Message received:', message.type, message.payload);
    setLastMessage(message);

    // Handle different message types
    switch (message.type) {
      case 'RESERVATION_CREATED':
        toast({
          title: "New Reservation! 🎉",
          description: `${message.payload.guestName} booked ${message.payload.tableName} for ${message.payload.formattedTime}`,
        });

        // --- OPTIMISTIC UPDATE: INSTANT UI ---
        // Instantly add the new reservation to the cache before server refetch
        queryClient.setQueriesData({ queryKey: ['/api/reservations'] }, (oldData: any[] | undefined) => {
            if (!oldData) return [message.payload];
            // Add the new reservation to the top of the list
            console.log('⚡ [Optimistic] Adding new reservation to cache instantly');
            return [message.payload, ...oldData];
        });
        // --- END OPTIMISTIC UPDATE ---

        // Invalidate to ensure consistency with the server in the background
        invalidateReservationData();
        
        // Dispatch custom event for other components if needed
        window.dispatchEvent(new CustomEvent('reservation:created', { 
          detail: message.payload 
        }));
        break;
        
      case 'RESERVATION_CANCELED':
        toast({
          title: "Reservation Cancelled",
          description: `${message.payload.guestName}'s reservation has been cancelled`,
          variant: "destructive",
        });

        // --- OPTIMISTIC UPDATE: INSTANT STATUS CHANGE ---
        // Instantly update the status of the cancelled reservation in the cache
        queryClient.setQueriesData({ queryKey: ['/api/reservations'] }, (oldData: any[] | undefined) => {
            if (!oldData) return [];
            return oldData.map(item => {
                const { reservation } = extractReservationData(item);
                if (reservation.id === message.payload.id) {
                    // Return a new object with the updated status
                    console.log('⚡ [Optimistic] Updating reservation status to canceled instantly');
                    return { ...item, reservation: { ...reservation, status: 'canceled' } };
                }
                return item;
            });
        });
        // --- END OPTIMISTIC UPDATE ---
        
        // Invalidate to ensure consistency with the server in the background
        invalidateReservationData();
        
        window.dispatchEvent(new CustomEvent('reservation:cancelled', { 
          detail: message.payload 
        }));
        break;

      case 'RESERVATION_UPDATED':
        const statusMessage = getReservationStatusMessage(message.payload);
        toast({
          title: "Reservation Updated",
          description: statusMessage,
        });

        // --- OPTIMISTIC UPDATE: INSTANT DATA MERGE ---
        // Instantly update the reservation in the cache
        queryClient.setQueriesData({ queryKey: ['/api/reservations'] }, (oldData: any[] | undefined) => {
            if (!oldData) return [];
            return oldData.map(item => {
                const { reservation } = extractReservationData(item);
                if (reservation.id === message.payload.id) {
                    // Merge new data with existing data
                    console.log('⚡ [Optimistic] Merging reservation update instantly');
                    return { ...item, reservation: { ...reservation, ...message.payload } };
                }
                return item;
            });
        });
        // --- END OPTIMISTIC UPDATE ---

        // Invalidate to ensure consistency
        invalidateReservationData();
        
        window.dispatchEvent(new CustomEvent('reservation:updated', { 
          detail: message.payload 
        }));
        break;

      case 'TABLE_STATUS_UPDATED':
        toast({
          title: "Table Status Changed",
          description: `${message.payload.tableName}: ${message.payload.oldStatus} → ${message.payload.newStatus}`,
        });

        // Invalidate table status cache
        invalidateTableData();
        
        window.dispatchEvent(new CustomEvent('table:status_updated', { 
          detail: message.payload 
        }));
        break;
        
      case 'CONNECTION_ESTABLISHED':
        console.log('✅ [WebSocket] Connection established for tenant:', message.payload.tenantId);
        toast({
          title: "Connected! ✅",
          description: "Real-time updates are now active",
        });
        break;

      case 'PONG':
        // Handle pong response silently
        break;
        
      default:
        console.log('❓ [WebSocket] Unknown message type:', message.type);
    }
  }, [toast]);

  const handleConnect = useCallback(() => {
    console.log('🔌 [WebSocket] Connected successfully');
  }, []);

  const handleDisconnect = useCallback(() => {
    console.log('🔌 [WebSocket] Disconnected');
    toast({
      title: "Connection Lost 🔌",
      description: "Attempting to reconnect...",
      variant: "destructive",
    });
  }, [toast]);

  const handleError = useCallback((error: Event) => {
    console.error('❌ [WebSocket] Connection error:', error);
    toast({
      title: "Connection Error ⚠️",  
      description: "There was a problem with the real-time connection",
      variant: "destructive",
    });
  }, [toast]);

  // Determine WebSocket URL based on current protocol and host
  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws`;
  }, []);

  const {
    isConnected,
    connectionStatus,
    sendMessage,
    disconnect,
    reconnect
  } = useWebSocket({
    url: shouldConnect ? getWebSocketUrl() : '',
    onMessage: handleMessage,
    onConnect: handleConnect,
    onDisconnect: handleDisconnect,
    onError: handleError,
    reconnectAttempts: 5,
    reconnectInterval: 3000,
    enabled: shouldConnect
  });

  const value: WebSocketContextType = {
    isConnected: shouldConnect && isConnected,
    connectionStatus: shouldConnect ? connectionStatus : 'disabled',
    sendMessage,
    lastMessage,
    disconnect,
    reconnect
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocketContext() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider');
  }
  return context;
}

// ✅ UPDATED: Helper functions now invalidate schedule data for real-time table management
function invalidateReservationData() {
  try {
    // Now using static import - no more async/await needed
    queryClient.invalidateQueries({ queryKey: ['reservations'] });
    queryClient.invalidateQueries({ queryKey: ['/api/reservations'] });
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard/upcoming'] });
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
    queryClient.invalidateQueries({ queryKey: ['reservation'] }); // Individual reservations
    
    // ✅ NEW: Invalidate schedule data for real-time table management updates
    queryClient.invalidateQueries({ queryKey: ['/api/tables/availability/schedule'] });
    
    console.log('🔄 [WebSocket] Invalidated reservation cache queries');
  } catch (error) {
    console.error('❌ [WebSocket] Failed to invalidate reservation cache:', error);
  }
}

function invalidateTableData() {
  try {
    // Now using static import - no more async/await needed
    queryClient.invalidateQueries({ queryKey: ['tables'] });
    queryClient.invalidateQueries({ queryKey: ['/api/tables'] });
    queryClient.invalidateQueries({ queryKey: ['tables_availability_status'] });
    
    // ✅ NEW: Invalidate schedule data for real-time table management updates
    queryClient.invalidateQueries({ queryKey: ['/api/tables/availability/schedule'] });
    
    console.log('🔄 [WebSocket] Invalidated table cache queries');
  } catch (error) {
    console.error('❌ [WebSocket] Failed to invalidate table cache:', error);
  }
}

// Helper function to format reservation status messages
function getReservationStatusMessage(payload: any): string {
  switch (payload.newStatus || payload.status) {
    case 'seated':
      return `${payload.guestName} has been seated at ${payload.tableName}`;
    case 'completed':
      const duration = payload.duration ? ` (${payload.duration} minutes)` : '';
      const amount = payload.totalAmount ? `, $${payload.totalAmount}` : '';
      return `${payload.guestName}'s visit completed${duration}${amount}`;
    case 'no_show':
      return `${payload.guestName} marked as no-show at ${payload.tableName}`;
    case 'confirmed':
      return `${payload.guestName}'s reservation confirmed`;
    case 'canceled':
      return `${payload.guestName}'s reservation cancelled`;
    default:
      return `Reservation #${payload.id} status changed to ${payload.status || payload.newStatus}`;
  }
}