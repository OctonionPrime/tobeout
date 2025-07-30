import React from 'react';
import { useWebSocketContext } from './WebSocketContext';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, Loader2, AlertCircle } from 'lucide-react';

export function WebSocketStatus() {
  const { isConnected, connectionStatus } = useWebSocketContext();

  const getStatusConfig = () => {
    switch (connectionStatus) {
      case 'connected':
        return {
          icon: <Wifi className="h-3 w-3" />,
          text: 'Live Updates',
          variant: 'default' as const,
          className: 'bg-green-100 text-green-800 border-green-200 hover:bg-green-100'
        };
      case 'connecting':
        return {
          icon: <Loader2 className="h-3 w-3 animate-spin" />,
          text: 'Connecting...',
          variant: 'secondary' as const,
          className: 'bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100'
        };
      case 'disabled':
        return {
          icon: <WifiOff className="h-3 w-3" />,
          text: 'Updates Disabled',
          variant: 'outline' as const,
          className: 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100'
        };
      case 'disconnected':
        return {
          icon: <WifiOff className="h-3 w-3" />,
          text: 'Reconnecting...',
          variant: 'destructive' as const,
          className: 'bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100'
        };
      case 'error':
        return {
          icon: <AlertCircle className="h-3 w-3" />,
          text: 'Connection Error',
          variant: 'destructive' as const,
          className: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100'
        };
      default:
        return {
          icon: <WifiOff className="h-3 w-3" />,
          text: 'Unknown',
          variant: 'secondary' as const,
          className: ''
        };
    }
  };

  const config = getStatusConfig();

  return (
    <Badge 
      variant={config.variant} 
      className={`${config.className} flex items-center gap-1.5 px-2 py-1 font-medium`}
      title={`WebSocket status: ${connectionStatus}`}
    >
      {config.icon}
      <span className="text-xs">{config.text}</span>
    </Badge>
  );
}

// Compact version for use in navigation bars
export function WebSocketStatusCompact() {
  const { isConnected, connectionStatus } = useWebSocketContext();

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected':
        return {
          icon: <Wifi className="h-4 w-4 text-green-600" />,
          title: 'Live updates active'
        };
      case 'connecting':
        return {
          icon: <Loader2 className="h-4 w-4 text-yellow-600 animate-spin" />,
          title: 'Connecting to live updates...'
        };
      case 'disabled':
        return {
          icon: <WifiOff className="h-4 w-4 text-gray-400" />,
          title: 'Live updates disabled (admin user)'
        };
      case 'disconnected':
        return {
          icon: <WifiOff className="h-4 w-4 text-orange-600" />,
          title: 'Reconnecting to live updates...'
        };
      case 'error':
        return {
          icon: <AlertCircle className="h-4 w-4 text-red-600" />,
          title: 'Live updates connection error'
        };
      default:
        return {
          icon: <WifiOff className="h-4 w-4 text-gray-400" />,
          title: 'Live updates status unknown'
        };
    }
  };

  const { icon, title } = getStatusIcon();

  return (
    <div className="flex items-center" title={title}>
      {icon}
    </div>
  );
}

// Optional: Interactive status component with reconnect button
export function WebSocketStatusWithActions() {
  const { isConnected, connectionStatus, reconnect, disconnect } = useWebSocketContext();

  const getStatusConfig = () => {
    switch (connectionStatus) {
      case 'connected':
        return {
          icon: <Wifi className="h-4 w-4" />,
          text: 'Live Updates Active',
          color: 'text-green-700',
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200',
          showDisconnect: true,
          showReconnect: false
        };
      case 'connecting':
        return {
          icon: <Loader2 className="h-4 w-4 animate-spin" />,
          text: 'Connecting to live updates...',
          color: 'text-yellow-700',
          bgColor: 'bg-yellow-50',
          borderColor: 'border-yellow-200',
          showDisconnect: false,
          showReconnect: false
        };
      case 'disabled':
        return {
          icon: <WifiOff className="h-4 w-4" />,
          text: 'Live updates disabled',
          color: 'text-gray-600',
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-200',
          showDisconnect: false,
          showReconnect: false
        };
      case 'disconnected':
      case 'error':
        return {
          icon: <AlertCircle className="h-4 w-4" />,
          text: connectionStatus === 'error' ? 'Connection error' : 'Disconnected',
          color: 'text-red-700',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          showDisconnect: false,
          showReconnect: true
        };
      default:
        return {
          icon: <WifiOff className="h-4 w-4" />,
          text: 'Status unknown',
          color: 'text-gray-600',
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-200',
          showDisconnect: false,
          showReconnect: true
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border ${config.bgColor} ${config.borderColor}`}>
      <div className="flex items-center gap-2">
        <div className={config.color}>
          {config.icon}
        </div>
        <span className={`text-sm font-medium ${config.color}`}>
          {config.text}
        </span>
      </div>
      
      <div className="flex gap-2">
        {config.showReconnect && (
          <button
            onClick={reconnect}
            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            title="Reconnect to live updates"
          >
            Reconnect
          </button>
        )}
        
        {config.showDisconnect && (
          <button
            onClick={disconnect}
            className="px-3 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
            title="Disconnect from live updates"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}