import { ReactNode, createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "./Sidebar";
import { DateTime } from "luxon";

interface DashboardLayoutProps {
  children: ReactNode;
}

// ✅ CRITICAL FIX: Create restaurant timezone context
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
}

const RestaurantTimezoneContext = createContext<RestaurantTimezoneContextType>({
  restaurant: null,
  restaurantTimezone: 'Europe/Moscow',
  isLoading: true,
  error: null,
  restaurantTimeInfo: {
    currentTime: '',
    currentDate: '',
    displayName: 'Europe/Moscow',
    offset: '+03:00'
  }
});

// ✅ CRITICAL FIX: Custom hook to use restaurant timezone context
export const useRestaurantTimezone = () => {
  const context = useContext(RestaurantTimezoneContext);
  if (!context) {
    console.warn('[useRestaurantTimezone] Used outside of DashboardLayout, falling back to Moscow timezone');
    return {
      restaurant: null,
      restaurantTimezone: 'Europe/Moscow',
      isLoading: false,
      error: null,
      restaurantTimeInfo: {
        currentTime: DateTime.now().toFormat('HH:mm'),
        currentDate: DateTime.now().toISODate() || '',
        displayName: 'Europe/Moscow',
        offset: '+03:00'
      }
    };
  }
  return context;
};

export function DashboardLayout({ children }: DashboardLayoutProps) {
  // ✅ CRITICAL FIX: Fetch restaurant data with timezone information
  const { data: restaurant, isLoading, error } = useQuery({
    queryKey: ["/api/restaurants/profile"],
    queryFn: async () => {
      const response = await fetch("/api/restaurants/profile", {
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch restaurant profile: ${response.status}`);
      }
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - restaurant timezone doesn't change often
    retry: 3,
  });

  // ✅ CRITICAL FIX: Get effective timezone with fallback
  const restaurantTimezone = restaurant?.timezone || 'Europe/Moscow';

  // ✅ CRITICAL FIX: Generate real-time restaurant time information
  const getRestaurantTimeInfo = () => {
    try {
      const now = DateTime.now().setZone(restaurantTimezone);
      return {
        currentTime: now.toFormat('HH:mm'),
        currentDate: now.toISODate() || '',
        displayName: restaurantTimezone,
        offset: now.toFormat('ZZ')
      };
    } catch (error) {
      console.warn(`[DashboardLayout] Invalid timezone ${restaurantTimezone}, using UTC`);
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

  // ✅ CRITICAL FIX: Create timezone context value
  const timezoneContextValue: RestaurantTimezoneContextType = {
    restaurant,
    restaurantTimezone,
    isLoading,
    error: error as Error | null,
    restaurantTimeInfo
  };

  // ✅ ENHANCEMENT: Log timezone context for debugging
  if (restaurant && restaurant.timezone !== 'Europe/Moscow') {
    console.log(`[DashboardLayout] Restaurant timezone: ${restaurantTimezone} | Current time: ${restaurantTimeInfo.currentTime}`);
  }

  return (
    <RestaurantTimezoneContext.Provider value={timezoneContextValue}>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        
        <main className="flex-1 overflow-y-auto pt-16 lg:pt-0">
          {/* ✅ ENHANCEMENT: Timezone status indicator for non-Moscow restaurants */}
          {restaurant && restaurantTimezone !== 'Europe/Moscow' && (
            <div className="bg-blue-50 border-b border-blue-200 px-4 py-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-blue-800">
                  Restaurant Time: <strong>{restaurantTimeInfo.currentTime}</strong> ({restaurantTimezone})
                </span>
                <span className="text-blue-600 text-xs">
                  {restaurantTimeInfo.offset} • {restaurantTimeInfo.currentDate}
                </span>
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