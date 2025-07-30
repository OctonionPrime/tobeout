import { ReactNode, createContext, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "./Sidebar";
import { DateTime } from "luxon";

interface DashboardLayoutProps {
  children: ReactNode;
}

// ✅ Restaurant timezone context interface
interface RestaurantTimezoneContextType {
  restaurant: any;
  restaurantTimezone: string;
  isLoading: boolean;
  error: Error | null;
  restaurantTimeInfo: {
    currentTime: string;
    currentDate: string;
    displayName: string;
    offset: string;
  };
  refreshRestaurant: () => void;
}

// ✅ FIXED: More robust default timezone handling
const getDefaultTimezone = () => {
  try {
    const cached = localStorage.getItem('lastRestaurantTimezone');
    if (cached && cached !== 'null' && cached !== 'undefined') {
      // Validate the cached timezone
      Intl.DateTimeFormat(undefined, { timeZone: cached });
      return cached;
    }
  } catch (error) {
    console.warn('[DashboardLayout] Invalid cached timezone, using fallback');
  }
  return 'Europe/Moscow';
};

const RestaurantTimezoneContext = createContext<RestaurantTimezoneContextType>({
  restaurant: null,
  restaurantTimezone: getDefaultTimezone(),
  isLoading: true,
  error: null,
  restaurantTimeInfo: {
    currentTime: '',
    currentDate: '',
    displayName: getDefaultTimezone(),
    offset: '+03:00'
  },
  refreshRestaurant: () => {}
});

export const useRestaurantTimezone = () => {
  const context = useContext(RestaurantTimezoneContext);
  if (!context) {
    console.warn('[useRestaurantTimezone] Used outside of DashboardLayout, using default timezone');
    const fallbackTimezone = getDefaultTimezone();
    const now = DateTime.now().setZone(fallbackTimezone);
    
    return {
      restaurant: null,
      restaurantTimezone: fallbackTimezone,
      isLoading: false,
      error: null,
      restaurantTimeInfo: {
        currentTime: now.toFormat('HH:mm'),
        currentDate: now.toISODate() || '',
        displayName: fallbackTimezone,
        offset: now.toFormat('ZZ')
      },
      refreshRestaurant: () => {}
    };
  }
  return context;
};

export function DashboardLayout({ children }: DashboardLayoutProps) {
  // ✅ NEW: Track timezone changes to force re-renders
  const [lastKnownTimezone, setLastKnownTimezone] = useState<string>(getDefaultTimezone());
  
  // ✅ CRITICAL FIX: Remove stale time and add proper invalidation triggers
  const { data: restaurant, isLoading, error, refetch } = useQuery({
    queryKey: ["/api/restaurants/profile"],
    queryFn: async () => {
      console.log('[DashboardLayout] Fetching restaurant profile...');
      const response = await fetch("/api/restaurants/profile", {
        credentials: "include",
        // ✅ ADD: Cache busting headers
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Not authenticated');
        }
        throw new Error(`Failed to fetch restaurant profile: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('[DashboardLayout] Restaurant profile loaded:', {
        name: data.name, 
        timezone: data.timezone,
        id: data.id
      });
      
      // ✅ CRITICAL: Cache the timezone and trigger updates
      if (data.timezone && data.timezone !== lastKnownTimezone) {
        console.log('🌍 [DashboardLayout] Timezone changed:', lastKnownTimezone, '->', data.timezone);
        localStorage.setItem('lastRestaurantTimezone', data.timezone);
        setLastKnownTimezone(data.timezone);
      }
      
      return data;
      },

    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 30, // Keep for 30 seconds only
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    retry: (failureCount, error: any) => {
      if (error?.message === 'Not authenticated') {
        return false;
      }
      return failureCount < 3;
    },
  });

  // ✅ CRITICAL FIX: Always use fresh timezone from restaurant data
  const restaurantTimezone = restaurant?.timezone || lastKnownTimezone || getDefaultTimezone();

  // ✅ NEW: Watch for timezone changes and log them
  useEffect(() => {
    if (restaurant?.timezone && restaurant.timezone !== lastKnownTimezone) {
      console.log('🔄 [DashboardLayout] Detected timezone change in restaurant data:', {
        old: lastKnownTimezone,
        new: restaurant.timezone,
        restaurant: restaurant.name
      });
      setLastKnownTimezone(restaurant.timezone);
      localStorage.setItem('lastRestaurantTimezone', restaurant.timezone);
    }
  }, [restaurant?.timezone, lastKnownTimezone]);

  // ✅ CRITICAL FIX: Ensure timezone info is always fresh
  const getRestaurantTimeInfo = () => {
    try {
      const now = DateTime.now().setZone(restaurantTimezone);
      const timeInfo = {
        currentTime: now.toFormat('HH:mm'),
        currentDate: now.toISODate() || '',
        displayName: restaurantTimezone,
        offset: now.toFormat('ZZ')
      };
      
      // ✅ DEBUG: Log timezone info generation
      console.log('🕐 [DashboardLayout] Generated time info:', {
        timezone: restaurantTimezone,
        time: timeInfo.currentTime,
        offset: timeInfo.offset
      });
      
      return timeInfo;
    } catch (error) {
      console.error(`[DashboardLayout] Invalid timezone ${restaurantTimezone}, using UTC`, error);
      const now = DateTime.now();
      return {
        currentTime: now.toFormat('HH:mm'),
        currentDate: now.toISODate() || '',
        displayName: 'UTC',
        offset: '+00:00'
      };
    }
  };

  const restaurantTimeInfo = getRestaurantTimeInfo();

  // ✅ ENHANCED: Manual refresh function with better invalidation
  const refreshRestaurant = () => {
    console.log('[DashboardLayout] Manual restaurant refresh triggered');
    // Clear the timezone cache to force fresh fetch
    localStorage.removeItem('lastRestaurantTimezone');
    setLastKnownTimezone(getDefaultTimezone());
    refetch();
  };

  // ✅ Create timezone context value with fresh data
  const timezoneContextValue: RestaurantTimezoneContextType = {
    restaurant,
    restaurantTimezone,
    isLoading,
    error: error as Error | null,
    restaurantTimeInfo,
    refreshRestaurant
  };

  // ✅ DEBUG: Log context value changes
  console.log('🏗️ [DashboardLayout] Context value:', {
    restaurantName: restaurant?.name,
    restaurantTimezone,
    isLoading,
    hasError: !!error
  });

  // Show loading state while fetching restaurant
  if (isLoading && !restaurant) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900 mx-auto"></div>
          <p className="mt-4 text-sm text-gray-600">Loading restaurant settings...</p>
          <p className="mt-2 text-xs text-gray-500">Last known timezone: {lastKnownTimezone}</p>
        </div>
      </div>
    );
  }

  // Show error state if critical error
  if (error && !restaurant) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Failed to load restaurant settings</p>
          <p className="text-sm text-gray-600 mb-4">Error: {error.message}</p>
          <button 
            onClick={() => {
              console.log('🔄 Retry button clicked');
              refreshRestaurant();
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <RestaurantTimezoneContext.Provider value={timezoneContextValue}>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        
        <main className="flex-1 overflow-y-auto pt-16 lg:pt-0">
          {/* ✅ ENHANCED: Show timezone indicator with change detection */}
          {restaurant && (
            <div className={`border-b px-4 py-2 ${
              restaurantTimezone === 'Europe/Moscow' 
                ? 'bg-gray-50 border-gray-200' 
                : 'bg-blue-50 border-blue-200'
            }`}>
              <div className="flex items-center justify-between text-sm">
                <span className={restaurantTimezone === 'Europe/Moscow' ? 'text-gray-700' : 'text-blue-800'}>
                  <strong>{restaurant.name}</strong> • Restaurant Time: <strong>{restaurantTimeInfo.currentTime}</strong> ({restaurantTimezone})
                  {restaurantTimezone !== 'Europe/Moscow' && (
                    <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                      Custom Timezone
                    </span>
                  )}
                </span>
                <span className={`text-xs ${
                  restaurantTimezone === 'Europe/Moscow' ? 'text-gray-600' : 'text-blue-600'
                }`}>
                  {restaurantTimeInfo.offset} • {restaurantTimeInfo.currentDate}
                </span>
              </div>
              {/* ✅ DEBUG: Show timezone debug info */}
              <div className="text-xs text-gray-500 mt-1">
                Debug: TZ={restaurantTimezone}, LastKnown={lastKnownTimezone}, RestaurantID={restaurant.id}
              </div>
            </div>
          )}
          
          {children}
        </main>
      </div>
    </RestaurantTimezoneContext.Provider>
  );
}

// ✅ EXPORT: Make context available for advanced usage
export { RestaurantTimezoneContext };