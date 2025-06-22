// client/src/hooks/useCapacityData.ts
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";

interface CapacityData {
  [date: string]: {
    reservations: number;
    capacity: number;
    peakTime: string;
  };
}

// ✅ CRITICAL FIX: Add restaurantTimezone parameter to hook
export function useCapacityData(restaurantId: number, restaurantTimezone: string = 'Europe/Moscow') {
  return useQuery({
    // ✅ CRITICAL FIX: Include timezone in query key for proper cache invalidation
    queryKey: ["/api/calendar/capacity", restaurantId, restaurantTimezone],
    queryFn: async (): Promise<CapacityData> => {
      // ✅ CRITICAL FIX: Pass timezone parameter to API
      const response = await fetch(
        `/api/calendar/capacity?restaurantId=${restaurantId}&timezone=${encodeURIComponent(restaurantTimezone)}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch capacity data");
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 10 * 60 * 1000, // 10 minutes
    // ✅ ENHANCEMENT: Only run when both restaurantId and timezone are available
    enabled: !!restaurantId && !!restaurantTimezone,
  });
}

// ✅ CRITICAL FIX: Enhanced with timezone support for generated capacity data
export function useGeneratedCapacityData(restaurantId: number, restaurantTimezone: string = 'Europe/Moscow') {
  return useQuery({
    // ✅ CRITICAL FIX: Include timezone in query key for cache invalidation
    queryKey: ["/api/reservations/capacity-summary", restaurantId, restaurantTimezone],
    queryFn: async (): Promise<CapacityData> => {
      try {
        // ✅ CRITICAL FIX: Calculate restaurant's "today" for date range
        const restaurantToday = DateTime.now().setZone(restaurantTimezone).toISODate();
        const futureDate = DateTime.now().setZone(restaurantTimezone).plus({ days: 30 }).toISODate();
        
        console.log(`[useGeneratedCapacityData] Fetching data for ${restaurantTimezone}, today: ${restaurantToday}`);

        // ✅ CRITICAL FIX: Pass timezone parameter to reservations API
        const response = await fetch(
          `/api/reservations?upcoming=true&timezone=${encodeURIComponent(restaurantTimezone)}`,
          { credentials: "include" }
        );
        if (!response.ok) throw new Error("Failed to fetch reservations");
        
        const reservations = await response.json();
        
        // Get restaurant capacity info
        const restaurantResponse = await fetch(`/api/restaurants/profile`, {
          credentials: "include"
        });
        const restaurant = await restaurantResponse.json();
        
        // Process reservations into capacity data
        const capacityData: CapacityData = {};
        const reservationsByDate: { [date: string]: any[] } = {};
        
        // Group reservations by date
        reservations.forEach((reservationData: any) => {
          const reservation = reservationData.reservation || reservationData;
          const date = reservation.date;
          
          // ✅ CRITICAL FIX: Only include future dates based on restaurant timezone
          if (date >= restaurantToday) {
            if (!reservationsByDate[date]) {
              reservationsByDate[date] = [];
            }
            reservationsByDate[date].push(reservation);
          }
        });
        
        // Calculate capacity data for each date
        Object.entries(reservationsByDate).forEach(([date, dateReservations]) => {
          const totalReservations = dateReservations.length;
          const totalCapacity = restaurant.totalSeats || 40; // fallback to 40
          
          // Find peak time (hour with most reservations)
          const hourCounts: { [hour: string]: number } = {};
          dateReservations.forEach(res => {
            const hour = res.time.split(':')[0];
            hourCounts[hour] = (hourCounts[hour] || 0) + 1;
          });
          
          const peakHour = Object.entries(hourCounts)
            .sort(([,a], [,b]) => b - a)[0]?.[0] || '19';
          
          const peakEndHour = String(Number(peakHour) + 2).padStart(2, '0');
          
          capacityData[date] = {
            reservations: totalReservations,
            capacity: totalCapacity,
            peakTime: `${peakHour}:00-${peakEndHour}:00`
          };
        });
        
        console.log(`[useGeneratedCapacityData] Generated capacity data for ${Object.keys(capacityData).length} dates`);
        return capacityData;
      } catch (error) {
        console.error(`[useGeneratedCapacityData] Error generating capacity data for timezone ${restaurantTimezone}:`, error);
        return {}; // Return empty object on error
      }
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: 5 * 60 * 1000, // 5 minutes
    retry: 1, // Only retry once on failure
    // ✅ ENHANCEMENT: Only run when both restaurantId and timezone are available
    enabled: !!restaurantId && !!restaurantTimezone,
  });
}

// ✅ NEW: Hook to use restaurant timezone-aware capacity data with automatic timezone detection
export function useRestaurantCapacityData(restaurantId: number) {
  // Get restaurant data to determine timezone
  const { data: restaurant } = useQuery({
    queryKey: ["/api/restaurants/profile"],
    queryFn: async () => {
      const response = await fetch(`/api/restaurants/profile`, {
        credentials: "include"
      });
      if (!response.ok) throw new Error("Failed to fetch restaurant profile");
      return response.json();
    },
  });

  const restaurantTimezone = restaurant?.timezone || 'Europe/Moscow';

  // Use the timezone-aware capacity data hook
  return useGeneratedCapacityData(restaurantId, restaurantTimezone);
}

// ✅ NEW: Utility function to get restaurant's current date range for capacity planning
export function getRestaurantDateRange(restaurantTimezone: string, days: number = 30) {
  try {
    const now = DateTime.now().setZone(restaurantTimezone);
    const startDate = now.toISODate();
    const endDate = now.plus({ days }).toISODate();
    
    return {
      startDate,
      endDate,
      timezone: restaurantTimezone,
      currentTime: now.toFormat('HH:mm'),
      currentDay: now.weekdayLong
    };
  } catch (error) {
    console.warn(`[getRestaurantDateRange] Invalid timezone ${restaurantTimezone}, using UTC`);
    const now = DateTime.now();
    return {
      startDate: now.toISODate(),
      endDate: now.plus({ days }).toISODate(),
      timezone: 'UTC',
      currentTime: now.toFormat('HH:mm'),
      currentDay: now.weekdayLong
    };
  }
}