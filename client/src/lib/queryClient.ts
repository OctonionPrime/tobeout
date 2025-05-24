import { QueryClient, QueryFunction, MutationCache, QueryCache } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
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
}

function createApiError(res: Response, text: string): ApiError {
  const error = new Error(`${res.status}: ${text}`) as ApiError;
  error.status = res.status;
  error.statusText = res.statusText;
  error.url = res.url;
  return error;
}

async function throwIfResNotOkEnhanced(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw createApiError(res, text);
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";

export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
      signal, // Support for request cancellation
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOkEnhanced(res);
    return await res.json();
  };

// Smart retry logic for restaurant operations
const smartRetry = (failureCount: number, error: unknown) => {
  const apiError = error as ApiError;
  
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

// Different stale times for different types of data
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

// Global error handler for queries
const queryCache = new QueryCache({
  onError: (error, query) => {
    console.error(`Query failed [${query.queryKey[0]}]:`, error);
    
    // You can add global error handling here
    // For example, show a toast notification for server errors
    const apiError = error as ApiError;
    if (apiError.status && apiError.status >= 500) {
      // Could integrate with your toast system here
      console.error('Server error detected, user should be notified');
    }
  },
  onSuccess: (data, query) => {
    // Log successful queries in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`Query succeeded [${query.queryKey[0]}]`);
    }
  }
});

// Global error handler for mutations
const mutationCache = new MutationCache({
  onError: (error, variables, context, mutation) => {
    console.error('Mutation failed:', error);
    
    // Global mutation error handling
    const apiError = error as ApiError;
    if (apiError.status === 401) {
      // Handle auth errors globally - will be handled by AuthProvider context
      // The useAuth hook will detect the 401 and trigger proper navigation
      console.warn('Authentication error detected in mutation - user will be redirected');
    }
  },
  onSuccess: (data, variables, context, mutation) => {
    // Log successful mutations in development
    if (process.env.NODE_ENV === 'development') {
      console.log('Mutation succeeded');
    }
  }
});

export const queryClient = new QueryClient({
  queryCache,
  mutationCache,
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      staleTime: (query) => getStaleTime(query.queryKey),
      refetchInterval: (query) => getRefetchInterval(query.queryKey),
      refetchOnWindowFocus: true, // Re-enabled for restaurant operations
      refetchOnReconnect: true,   // Important for mobile devices
      retry: smartRetry,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
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
      retryDelay: 1000, // 1 second delay for mutations
    },
  },
});

// Utility function to invalidate related queries after mutations
export const invalidateReservationQueries = (restaurantId?: number) => {
  queryClient.invalidateQueries({ 
    predicate: (query) => {
      const url = query.queryKey[0] as string;
      return url.includes('/api/reservations') || 
             url.includes('/api/tables') || 
             url.includes('/api/booking/available');
    }
  });
};

// Utility to prefetch critical data
export const prefetchCriticalData = async (restaurantId: number) => {
  const today = new Date().toISOString().split('T')[0];
  
  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: [`/api/reservations?restaurantId=${restaurantId}&date=${today}`],
      staleTime: 30 * 1000,
    }),
    queryClient.prefetchQuery({
      queryKey: [`/api/tables?restaurantId=${restaurantId}`],
      staleTime: 30 * 1000,
    }),
  ]);
};

// Development helper to debug query cache
if (process.env.NODE_ENV === 'development') {
  (window as any).queryClient = queryClient;
  (window as any).debugQueries = () => {
    console.table(
      queryClient.getQueryCache().getAll().map(query => ({
        key: JSON.stringify(query.queryKey),
        status: query.state.status,
        dataUpdatedAt: new Date(query.state.dataUpdatedAt).toLocaleTimeString(),
        staleTime: query.options.staleTime,
        refetchInterval: query.options.refetchInterval,
      }))
    );
  };
}