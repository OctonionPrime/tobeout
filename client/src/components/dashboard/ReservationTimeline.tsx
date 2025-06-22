import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Globe, Clock } from "lucide-react";
import { DateTime } from 'luxon';
import { apiRequest } from "@/lib/queryClient";

interface ReservationTimelineProps {
  restaurantId: number;
  restaurantTimezone?: string;
  date?: string;
}

interface Reservation {
  id: number;
  tableId: number;
  date: string;
  time: string;
  duration: number;
  guests: number;
}

interface Table {
  id: number;
  name: string;
}

export function ReservationTimeline({ 
  restaurantId, 
  restaurantTimezone = 'Europe/Moscow',
  date 
}: ReservationTimelineProps) {
  
  // ✅ FIXED: Proper Luxon usage for restaurant date
  const getRestaurantDate = () => {
    try {
      return DateTime.now().setZone(restaurantTimezone).toISODate();
    } catch (error) {
      console.warn(`Invalid timezone ${restaurantTimezone}, falling back to local time`);
      return DateTime.now().toISODate();
    }
  };

  const effectiveDate = date || getRestaurantDate();

  // ✅ FIXED: Proper Luxon usage for restaurant time
  const getRestaurantTime = () => {
    try {
      return DateTime.now().setZone(restaurantTimezone);
    } catch (error) {
      console.warn(`Invalid timezone ${restaurantTimezone}, falling back to local time`);
      return DateTime.now();
    }
  };

  const formatRestaurantTime = () => {
    try {
      return getRestaurantTime().toFormat('HH:mm');
    } catch (error) {
      return DateTime.now().toFormat('HH:mm');
    }
  };

  const isToday = effectiveDate === getRestaurantDate();

  // ✅ FIXED: Proper React Query with timezone-aware API call
  const { data: reservations, isLoading: isLoadingReservations } = useQuery<Reservation[]>({
    queryKey: ['reservations', restaurantId, effectiveDate, restaurantTimezone],
    queryFn: async () => {
      const response = await apiRequest(
        "GET",
        `/api/reservations?restaurantId=${restaurantId}&date=${effectiveDate}&timezone=${encodeURIComponent(restaurantTimezone)}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch reservations');
      }
      return response.json();
    },
    enabled: !!restaurantId && !!effectiveDate && !!restaurantTimezone,
  });

  // ✅ FIXED: Proper React Query for tables
  const { data: tables, isLoading: isLoadingTables } = useQuery<Table[]>({
    queryKey: ['tables', restaurantId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/tables?restaurantId=${restaurantId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch tables');
      }
      return response.json();
    },
    enabled: !!restaurantId,
  });

  const isLoading = isLoadingReservations || isLoadingTables;

  if (isLoading) {
    return (
      <Card className="border border-gray-200">
        <CardHeader>
          <CardTitle>Reservation Timeline</CardTitle>
          <CardDescription>Hourly distribution</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-28 bg-gray-100 animate-pulse rounded-lg"></div>
        </CardContent>
      </Card>
    );
  }

  // Generate time labels from 12:00 to 22:00
  const timeLabels = [];
  for (let hour = 12; hour <= 22; hour += 2) {
    timeLabels.push(`${hour.toString().padStart(2, '0')}:00`);
  }

  // ✅ FIXED: Calculate current time indicator position using Luxon
  const restaurantTime = getRestaurantTime();
  const currentHour = restaurantTime.hour;
  const currentMinute = restaurantTime.minute;
  
  // Timeline is from 12:00 to 22:00 (10 hours, 600 minutes)
  const currentTimePosition = 
    (currentHour >= 12 && currentHour <= 22) 
      ? ((currentHour - 12) * 60 + currentMinute) / 600 * 100
      : (currentHour < 12 ? 0 : 100);

  const showCurrentTimeIndicator = isToday && currentTimePosition >= 0 && currentTimePosition <= 100;

  return (
    <Card className="border border-gray-200">
      <CardHeader className="border-b border-gray-200">
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          {isToday ? "Today's" : format(new Date(effectiveDate), "MMM d")} Reservation Timeline
        </CardTitle>
        <CardDescription>
          Hourly distribution of reservations
        </CardDescription>
        <div className="flex items-center justify-between text-sm text-gray-500 mt-2">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            <span>Restaurant time: {formatRestaurantTime()}</span>
            <span className="text-gray-400">({restaurantTimezone})</span>
          </div>
          {isToday && (
            <div className="flex items-center gap-1 text-red-600">
              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
              <span className="text-xs">Live timeline</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <div className="relative">
          {/* Time labels */}
          <div className="flex justify-between mb-2 text-xs text-gray-500">
            {timeLabels.map((label, index) => (
              <div key={index}>{label}</div>
            ))}
          </div>
          
          {/* Timeline grid */}
          <div className="h-16 bg-gray-50 rounded-lg border border-gray-200 mb-4 relative">
            {/* Current time indicator */}
            {showCurrentTimeIndicator && (
              <div 
                className="absolute h-full w-0.5 bg-red-500 z-10"
                style={{ left: `${currentTimePosition}%` }}
                title={`Current time: ${formatRestaurantTime()}`}
              >
                <div className="absolute -top-6 -left-8 text-xs text-red-600 font-medium bg-white px-1 rounded border">
                  {formatRestaurantTime()}
                </div>
              </div>
            )}
            
            {/* Reservation markers */}
            {reservations && tables && reservations.map((reservation) => {
              const table = tables.find(t => t.id === reservation.tableId);
              if (!table) return null;
              
              const startHour = parseInt(reservation.time.split(':')[0]);
              const startMinute = parseInt(reservation.time.split(':')[1]);
              
              const startPosition = ((startHour - 12) * 60 + startMinute) / 600 * 100;
              const width = (reservation.duration / 600) * 100;
              
              if (startPosition < 0 || startPosition > 100) return null;
              
              // Different colors based on timing relative to current time
              let bgColor = "bg-blue-200 border-blue-300 text-blue-800";
              if (isToday && showCurrentTimeIndicator) {
                const reservationEnd = startPosition + width;
                if (currentTimePosition > reservationEnd) {
                  bgColor = "bg-gray-200 border-gray-300 text-gray-600"; // Past
                } else if (currentTimePosition >= startPosition && currentTimePosition <= reservationEnd) {
                  bgColor = "bg-green-200 border-green-300 text-green-800"; // Active
                } else {
                  bgColor = "bg-blue-200 border-blue-300 text-blue-800"; // Future
                }
              }
              
              return (
                <div 
                  key={reservation.id}
                  className={`absolute h-8 top-1 rounded-lg border flex items-center justify-center text-xs font-medium ${bgColor}`}
                  style={{
                    left: `${startPosition}%`,
                    width: `${Math.max(width, 8)}%`
                  }}
                  title={`${table.name} - ${reservation.guests} guests - ${reservation.time} (${reservation.duration}min)`}
                >
                  <span className="truncate px-1">
                    {table.name} ({reservation.guests})
                  </span>
                </div>
              );
            })}

            {(!reservations || reservations.length === 0) && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
                No reservations scheduled {isToday ? "for today" : `for ${format(new Date(effectiveDate), "MMM d")}`}
              </div>
            )}
          </div>
          
          {/* Rush hour indicators */}
          <div className="flex justify-between h-2 mb-2">
            <div className="w-[16.6%] bg-green-100" title="12:00-14:00 - Low demand"></div>
            <div className="w-[16.6%] bg-green-100" title="14:00-16:00 - Low demand"></div>
            <div className="w-[16.6%] bg-yellow-100" title="16:00-18:00 - Medium demand"></div>
            <div className="w-[16.6%] bg-red-100" title="18:00-20:00 - Peak hours"></div>
            <div className="w-[16.6%] bg-red-100" title="20:00-22:00 - Peak hours"></div>
            <div className="w-[16.6%] bg-yellow-100" title="22:00+ - Medium demand"></div>
          </div>
          
          {/* Rush hour legend */}
          <div className="flex text-xs text-gray-500 justify-between items-center">
            <div className="flex gap-4">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-100 rounded-full mr-1"></div>
                <span>Low demand</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-yellow-100 rounded-full mr-1"></div>
                <span>Medium</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-red-100 rounded-full mr-1"></div>
                <span>Peak hours</span>
              </div>
            </div>
            {reservations && reservations.length > 0 && (
              <span className="text-gray-400">
                {reservations.length} reservation{reservations.length !== 1 ? 's' : ''} scheduled
              </span>
            )}
          </div>
        </div>
      </CardContent>
      <CardFooter className="px-6 py-4 border-t border-gray-200">
        <Button variant="link" className="text-sm font-medium text-blue-600 hover:text-blue-500 p-0">
          Open reservation calendar →
        </Button>
      </CardFooter>
    </Card>
  );
}