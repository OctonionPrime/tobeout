// client/src/hooks/useCapacityData.ts
import { useQuery } from "@tanstack/react-query";

interface CapacityData {
  [date: string]: {
    reservations: number;
    capacity: number;
    peakTime: string;
  };
}

export function useCapacityData(restaurantId: number) {
  return useQuery({
    queryKey: ["/api/calendar/capacity", restaurantId],
    queryFn: async (): Promise<CapacityData> => {
      const response = await fetch(`/api/calendar/capacity?restaurantId=${restaurantId}`, {
        credentials: "include"
      });
      if (!response.ok) throw new Error("Failed to fetch capacity data");
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 10 * 60 * 1000, // 10 minutes
  });
}

// Alternative: Generate capacity data from existing reservations
export function useGeneratedCapacityData(restaurantId: number) {
  return useQuery({
    queryKey: ["/api/reservations/capacity-summary", restaurantId],
    queryFn: async (): Promise<CapacityData> => {
      try {
        // Get all reservations for the next 30 days
        const response = await fetch(`/api/reservations?upcoming=true`, {
          credentials: "include"
        });
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
          if (!reservationsByDate[date]) {
            reservationsByDate[date] = [];
          }
          reservationsByDate[date].push(reservation);
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
        
        return capacityData;
      } catch (error) {
        console.error("Error generating capacity data:", error);
        return {}; // Return empty object on error
      }
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: 5 * 60 * 1000, // 5 minutes
    retry: 1, // Only retry once on failure
  });
}