import { QueryClient, QueryFunction, MutationCache, QueryCache } from "@tanstack/react-query";

// ✅ FIX 1: Enhanced error handling with timezone context
async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// ✅ FIX 2: Enhanced API request with timezone support
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: {
    timezone?: string;
    restaurantId?: number;
  }
): Promise<Response> {
  // ✅ FIX 3: Inject timezone into request headers if provided
  const headers: HeadersInit = {
    ...(data ? { "Content-Type": "application/json" } : {}),
    ...(options?.timezone ? { "X-Restaurant-Timezone": options.timezone } : {}),
    ...(options?.restaurantId ? { "X-Restaurant-Id": options.restaurantId.toString() } : {})
  };

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

// Enhanced error context for better debugging
interface ApiError extends Error {
  status?: number;
  statusText?: string;
  url?: string;
  timezone?: string;
}

function createApiError(res: Response, text: string, timezone?: string): ApiError {
  const error = new Error(`${res.status}: ${text}`) as ApiError;
  error.status = res.status;
  error.statusText = res.statusText;
  error.url = res.url;
  error.timezone = timezone;
  return error;
}

async function throwIfResNotOkEnhanced(res: Response, timezone?: string) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw createApiError(res, text, timezone);
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";

// ✅ SIMPLIFIED: Query function without auto-injection
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal }) => {
    const url = queryKey[0] as string;

    const res = await fetch(url, {
      credentials: "include",
      signal,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOkEnhanced(res);
    return await res.json();
  };

// ✅ FIX 7: Smart retry logic with timezone context
const smartRetry = (failureCount: number, error: unknown) => {
  const apiError = error as ApiError;
  
  // Log timezone-related errors
  if (apiError.timezone) {
    console.warn(`[QueryClient] Request failed with timezone: ${apiError.timezone}`);
  }
  
  // Don't retry authentication errors
  if (apiError.status === 401 || apiError.status === 403) {
    return false;
  }
  
  // Don't retry client errors (400-499) except for specific cases
  if (apiError.status && apiError.status >= 400 && apiError.status < 500) {
    // Retry rate limiting and timeout errors
    if (apiError.status === 429 || apiError.status === 408) {
      return failureCount < 2;
    }
    return false;
  }
  
  // Retry server errors and network issues up to 3 times
  return failureCount < 3;
};

// ✅ FIX 8: Enhanced stale time logic for timezone-sensitive data
const getStaleTime = (queryKey: readonly unknown[]) => {
  const url = queryKey[0] as string;
  
  // Real-time data - very short stale time
  if (url.includes('/api/reservations') || 
      url.includes('/api/tables') || 
      url.includes('/api/booking/available')) {
    return 30 * 1000; // 30 seconds
  }
  
  // AI activities - short stale time
  if (url.includes('/api/ai/activities')) {
    return 60 * 1000; // 1 minute
  }
  
  // Configuration data - longer stale time
  if (url.includes('/api/restaurants') || 
      url.includes('/api/profile') ||
      url.includes('/api/preferences')) {
    return 5 * 60 * 1000; // 5 minutes
  }
  
  // Static data - very long stale time
  if (url.includes('/api/integrations') ||
      url.includes('/api/auth/user')) {
    return 15 * 60 * 1000; // 15 minutes
  }
  
  // Default for unknown endpoints
  return 2 * 60 * 1000; // 2 minutes
};

// Get refetch interval for real-time data
const getRefetchInterval = (queryKey: readonly unknown[]) => {
  const url = queryKey[0] as string;
  
  // Critical real-time data
  if (url.includes('/api/reservations') || 
      url.includes('/api/tables')) {
    return 30 * 1000; // Refetch every 30 seconds
  }
  
  // AI activities for live updates
  if (url.includes('/api/ai/activities')) {
    return 60 * 1000; // Refetch every minute
  }
  
  // No automatic refetch for other data
  return false;
};

// ✅ FIX 9: Enhanced query cache with timezone logging
const queryCache = new QueryCache({
  onError: (error, query) => {
    const apiError = error as ApiError;
    console.error(`Query failed [${query.queryKey[0]}]:`, {
      error: error.message,
      status: apiError.status,
      timezone: apiError.timezone
    });
    
    // Global error handling for server errors
    if (apiError.status && apiError.status >= 500) {
      console.error('[QueryClient] Server error detected, user should be notified');
    }
  },
  onSuccess: (data, query) => {
    // Log successful queries in development
    if (process.env.NODE_ENV === 'development') {
      const queryKey = query.queryKey;
      // Check if timezone is in the query key
      const hasTimezone = queryKey.some(key => 
        typeof key === 'string' && key.includes('timezone')
      );
      if (hasTimezone) {
        console.log(`[QueryClient] Timezone-aware query succeeded:`, queryKey[0]);
      }
    }
  }
});

// Global error handler for mutations
const mutationCache = new MutationCache({
  onError: (error, variables, context, mutation) => {
    const apiError = error as ApiError;
    console.error('[QueryClient] Mutation failed:', {
      error: error.message,
      status: apiError.status,
      timezone: apiError.timezone
    });
    
    if (apiError.status === 401) {
      console.warn('[QueryClient] Authentication error in mutation - user will be redirected');
    }
  },
  onSuccess: (data, variables, context, mutation) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[QueryClient] Mutation succeeded');
    }
  }
});

export const queryClient = new QueryClient({
  queryCache,
  mutationCache,
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      // ✅ FIXED: Use function-based options for React Query v5
      staleTime: ({ queryKey }) => getStaleTime(queryKey),
      refetchInterval: ({ queryKey }) => getRefetchInterval(queryKey),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: smartRetry,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: (failureCount, error) => {
        const apiError = error as ApiError;
        
        // Don't retry auth errors or client errors
        if (apiError.status && (apiError.status === 401 || apiError.status === 403)) {
          return false;
        }
        
        // Retry network errors and server errors
        return failureCount < 2;
      },
      retryDelay: 1000,
    },
  },
});

// ✅ FIX 10: Enhanced invalidation with timezone context
export const invalidateReservationQueries = (restaurantId?: number, timezone?: string) => {
  console.log('[QueryClient] Invalidating reservation queries', { restaurantId, timezone });
  
  queryClient.invalidateQueries({ 
    predicate: (query) => {
      const url = query.queryKey[0] as string;
      // Invalidate all reservation-related queries
      const isReservationQuery = url.includes('/api/reservations') || 
                                url.includes('/api/tables') || 
                                url.includes('/api/booking/available') ||
                                url.includes('/api/dashboard');
      
      // If timezone specified, also check if query contains that timezone
      if (timezone && isReservationQuery) {
        const hasTimezone = query.queryKey.some(key => 
          typeof key === 'string' && key.includes(timezone)
        );
        return hasTimezone;
      }
      
      return isReservationQuery;
    }
  });
};

// ✅ SIMPLIFIED: Basic prefetching without complex timezone injection
export const prefetchCriticalData = async (restaurantId: number, timezone: string) => {
  const today = new Date().toISOString().split('T')[0];
  
  console.log('[QueryClient] Prefetching critical data', { restaurantId, timezone, today });
  
  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: [`/api/reservations?timezone=${encodeURIComponent(timezone)}&restaurantId=${restaurantId}`],
      staleTime: 30 * 1000,
    }),
    queryClient.prefetchQuery({
      queryKey: [`/api/tables?restaurantId=${restaurantId}`],
      staleTime: 30 * 1000,
    }),
  ]);
};

// ✅ FIX 12: Development helpers with timezone info
if (process.env.NODE_ENV === 'development') {
  (window as any).queryClient = queryClient;
  (window as any).debugQueries = () => {
    console.table(
      queryClient.getQueryCache().getAll().map(query => ({
        key: JSON.stringify(query.queryKey),
        status: query.state.status,
        dataUpdatedAt: new Date(query.state.dataUpdatedAt).toLocaleTimeString(),
        hasTimezone: query.queryKey.some(k => typeof k === 'string' && k.includes('timezone'))
      }))
    );
  };
  
  // Helper to check timezone consistency
  (window as any).checkTimezoneConsistency = () => {
    const queries = queryClient.getQueryCache().getAll();
    const timezones = new Set<string>();
    
    queries.forEach(query => {
      query.queryKey.forEach(key => {
        if (typeof key === 'string' && key.includes('timezone=')) {
          const match = key.match(/timezone=([^&]+)/);
          if (match) {
            timezones.add(decodeURIComponent(match[1]));
          }
        }
      });
    });
    
    if (timezones.size > 1) {
      console.warn('[QueryClient] Multiple timezones detected in cache:', Array.from(timezones));
    } else if (timezones.size === 1) {
      console.log('[QueryClient] Consistent timezone in cache:', Array.from(timezones)[0]);
    } else {
      console.log('[QueryClient] No timezone-specific queries in cache');
    }
  };
}