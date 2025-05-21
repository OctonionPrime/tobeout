import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

interface ReservationTimelineProps {
  restaurantId: number;
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

export function ReservationTimeline({ restaurantId, date = format(new Date(), 'yyyy-MM-dd') }: ReservationTimelineProps) {
  const { data: reservations, isLoading: isLoadingReservations } = useQuery<Reservation[]>({
    queryKey: [`/api/reservations?restaurantId=${restaurantId}&date=${date}`],
  });

  const { data: tables, isLoading: isLoadingTables } = useQuery<Table[]>({
    queryKey: [`/api/tables?restaurantId=${restaurantId}`],
  });

  const isLoading = isLoadingReservations || isLoadingTables;

  if (isLoading) {
    return (
      <Card className="border border-gray-200">
        <CardHeader>
          <CardTitle>Today's Reservation Timeline</CardTitle>
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

  // Calculate the current time indicator position
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  // Timeline is from 12:00 to 22:00 (10 hours, 600 minutes)
  // Calculate position as percentage (0% to 100%)
  const currentTimePosition = 
    (currentHour >= 12 && currentHour <= 22) 
      ? ((currentHour - 12) * 60 + currentMinute) / 600 * 100
      : (currentHour < 12 ? 0 : 100);

  return (
    <Card className="border border-gray-200">
      <CardHeader className="border-b border-gray-200">
        <CardTitle>Today's Reservation Timeline</CardTitle>
        <CardDescription>Hourly distribution</CardDescription>
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
            {currentTimePosition >= 0 && currentTimePosition <= 100 && (
              <div 
                className="absolute h-full w-0.5 bg-red-500 z-10"
                style={{ left: `${currentTimePosition}%` }}
              ></div>
            )}
            
            {/* Reservation markers */}
            {reservations && tables && reservations.map((reservation) => {
              const table = tables.find(t => t.id === reservation.tableId);
              if (!table) return null;
              
              const startHour = parseInt(reservation.time.split(':')[0]);
              const startMinute = parseInt(reservation.time.split(':')[1]);
              
              // Calculate start position and width
              const startPosition = ((startHour - 12) * 60 + startMinute) / 600 * 100;
              const width = (reservation.duration / 600) * 100;
              
              // Skip if outside of timeline
              if (startPosition < 0 || startPosition > 100) return null;
              
              return (
                <div 
                  key={reservation.id}
                  className="absolute h-8 top-1 bg-blue-200 rounded-lg border border-blue-300 flex items-center justify-center text-xs text-blue-800 font-medium"
                  style={{
                    left: `${startPosition}%`,
                    width: `${width}%`
                  }}
                >
                  {table.name} ({reservation.guests})
                </div>
              );
            })}
          </div>
          
          {/* Rush hour indicators */}
          <div className="flex justify-between h-2 mb-2">
            <div className="w-[16.6%] bg-green-100"></div>
            <div className="w-[16.6%] bg-green-100"></div>
            <div className="w-[16.6%] bg-yellow-100"></div>
            <div className="w-[16.6%] bg-red-100"></div>
            <div className="w-[16.6%] bg-red-100"></div>
            <div className="w-[16.6%] bg-yellow-100"></div>
          </div>
          
          {/* Rush hour legend */}
          <div className="flex text-xs text-gray-500 justify-end gap-4">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-100 rounded-full mr-1"></div>
              <span>Low</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-yellow-100 rounded-full mr-1"></div>
              <span>Medium</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-red-100 rounded-full mr-1"></div>
              <span>Peak Hours</span>
            </div>
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
