import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRestaurantTimezone } from "@/components/layout/DashboardLayout";
import { DateTime } from "luxon";
import { Clock, Users, Calendar } from "lucide-react";

interface TableStatusProps {
  restaurantId: number;
  restaurantTimezone?: string; // ✅ ADDED: Accept timezone prop from parent
}

interface Table {
  id: number;
  name: string;
  status: 'free' | 'occupied' | 'reserved' | 'unavailable' | 'available';
  minGuests?: number;
  maxGuests?: number;
  // ✅ ENHANCED: Additional fields for timezone-aware availability
  currentReservation?: {
    guestName: string;
    time: string;
    guests: number;
  };
  nextReservation?: {
    guestName: string;
    time: string;
    guests: number;
  };
  reservation?: {
    id: number;
    guestName: string;
    guestCount: number;
    timeSlot: string;
    phone: string;
    status: string;
  };
}

interface Restaurant {
  openingTime: string;
  closingTime: string;
  timezone: string;
}

export function TableStatus({ restaurantId, restaurantTimezone }: TableStatusProps) {
  // ✅ FALLBACK: Use context if prop not provided (defensive programming)
  const { restaurantTimezone: contextTimezone, isLoading: isTimezoneLoading, restaurant } = useRestaurantTimezone();
  const effectiveTimezone = restaurantTimezone || contextTimezone || 'Europe/Moscow';

  // ✅ ENHANCED: Detect overnight operation
  const isOvernightOperation = restaurant?.openingTime && restaurant?.closingTime && 
    (parseInt(restaurant.closingTime.split(':')[0]) < parseInt(restaurant.openingTime.split(':')[0]));

  // ✅ CRITICAL FIX: Generate current date and time in restaurant timezone
  const getCurrentDateTime = () => {
    const now = DateTime.now().setZone(effectiveTimezone);
    return {
      date: now.toISODate(), // Format: "2025-06-24"
      time: now.toFormat('HH:mm'), // Format: "10:30"
      hour: now.hour,
      displayTime: now.toFormat('HH:mm'),
      fullDateTime: now
    };
  };

  // ✅ CRITICAL FIX: Timezone-aware table availability query with required date/time parameters
  const { data: tables, isLoading, error } = useQuery<Table[]>({
    queryKey: ['tables_availability_status', restaurantId, effectiveTimezone],
    queryFn: async () => {
      const { date, time } = getCurrentDateTime();
      
      console.log(`🔍 [TableStatus] Fetching availability for ${date} ${time} (${effectiveTimezone})`);
      
      // ✅ CRITICAL FIX: Include required date and time parameters
      const response = await fetch(
        `/api/tables/availability?restaurantId=${restaurantId}&timezone=${encodeURIComponent(effectiveTimezone)}&date=${date}&time=${time}`,
        { 
          credentials: "include",
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (!response.ok) {
        console.error(`❌ [TableStatus] API Error: ${response.status} ${response.statusText}`);
        
        // ✅ ENHANCED: For overnight operations, provide more context
        if (isOvernightOperation) {
          console.error(`❌ [TableStatus] Overnight operation error - this might be due to timezone boundary issues`);
        }
        
        // ✅ FALLBACK: If availability endpoint fails, fall back to static tables
        const fallbackResponse = await fetch(
          `/api/tables?restaurantId=${restaurantId}`,
          { credentials: "include" }
        );
        if (!fallbackResponse.ok) throw new Error('Failed to fetch table data');
        
        const staticTables = await fallbackResponse.json();
        console.log(`🔄 [TableStatus] Using fallback: ${staticTables.length} static tables`);
        
        // Transform static tables to include basic status
        return staticTables.map((table: any) => ({
          ...table,
          status: 'free' // Default to free when we can't check availability
        }));
      }
      
      const availabilityData = await response.json();
      console.log(`✅ [TableStatus] Received ${availabilityData.length} tables with availability status`);
      
      // ✅ ENHANCED: For overnight operations, log additional debug info
      if (isOvernightOperation && availabilityData.length > 0) {
        const reservedCount = availabilityData.filter((t: Table) => t.status === 'reserved').length;
        const availableCount = availabilityData.filter((t: Table) => t.status === 'available' || t.status === 'free').length;
        console.log(`🌙 [TableStatus] Overnight status: ${reservedCount} reserved, ${availableCount} available`);
      }
      
      return availabilityData;
    },
    // ✅ CRITICAL FIX: Wait for timezone confirmation before fetching
    enabled: !!restaurantId && !!effectiveTimezone && !isTimezoneLoading,
    refetchInterval: 30000, // ✅ ENHANCED: Real-time updates every 30 seconds
    retry: (failureCount, error) => {
      // ✅ ENHANCED: More lenient retry for overnight operations
      if (isOvernightOperation) {
        return failureCount < 1; // Only retry once for overnight
      }
      return failureCount < 2; // Standard retry
    }
  });

  if (isLoading || isTimezoneLoading) {
    return (
      <Card className="border border-gray-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Table Status
          </CardTitle>
          <CardDescription>Current floor situation</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            {[...Array(9)].map((_, i) => (
              <div key={i} className="aspect-square bg-gray-100 animate-pulse rounded-lg"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ✅ ENHANCED: Better error handling with overnight context
  if (error) {
    return (
      <Card className="border border-red-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600">
            <Users className="h-5 w-5" />
            Table Status
          </CardTitle>
          <CardDescription className="text-red-500">
            Failed to load table status
            {isOvernightOperation && (
              <span className="block mt-1 text-sm">
                🌙 24-hour operation detected - this may require additional setup
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => window.location.reload()}
            className="w-full"
          >
            Reload Status
          </Button>
        </CardContent>
      </Card>
    );
  }

  const getTableColor = (status: string) => {
    switch (status) {
      case 'free':
      case 'available': // ✅ ADDED: Handle 'available' status from API
        return {
          bg: 'bg-green-100',
          border: 'border-green-200',
          text: 'text-green-700',
          statusText: 'text-green-600',
        };
      case 'occupied':
        return {
          bg: 'bg-red-100',
          border: 'border-red-200',
          text: 'text-red-700',
          statusText: 'text-red-600',
        };
      case 'reserved':
        return {
          bg: 'bg-amber-100',
          border: 'border-amber-200',
          text: 'text-amber-700',
          statusText: 'text-amber-600',
        };
      case 'unavailable':
        return {
          bg: 'bg-gray-100',
          border: 'border-gray-200',
          text: 'text-gray-500',
          statusText: 'text-gray-400',
        };
      default:
        return {
          bg: 'bg-gray-100',
          border: 'border-gray-200',
          text: 'text-gray-700',
          statusText: 'text-gray-600',
        };
    }
  };

  // ✅ ENHANCED: Calculate timezone-aware stats
  const stats = {
    free: tables?.filter(t => t.status === 'free' || t.status === 'available').length || 0,
    reserved: tables?.filter(t => t.status === 'reserved').length || 0,
    occupied: tables?.filter(t => t.status === 'occupied').length || 0,
    total: tables?.length || 0,
  };

  const { date, time, hour, displayTime } = getCurrentDateTime();

  // ✅ ENHANCED: Determine time period for overnight operations
  const getTimePeriod = () => {
    if (!isOvernightOperation) return 'Standard Hours';
    
    const openingHour = parseInt(restaurant?.openingTime?.split(':')[0] || '22');
    const closingHour = parseInt(restaurant?.closingTime?.split(':')[0] || '3');
    
    if (hour >= openingHour || hour < closingHour) {
      if (hour >= openingHour) {
        return `Late Night (${restaurant?.openingTime}-24:00)`;
      } else {
        return `Early Morning (00:00-${restaurant?.closingTime})`;
      }
    } else {
      return `Closed Hours (${restaurant?.closingTime}-${restaurant?.openingTime})`;
    }
  };

  return (
    <Card className="border border-gray-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Table Status
          {isOvernightOperation && (
            <Badge variant="outline" className="text-xs bg-blue-50">
              <Clock className="h-3 w-3 mr-1" />
              24-Hour
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Current floor situation ({date} {displayTime})
          </div>
          {effectiveTimezone !== 'Europe/Moscow' && (
            <span className="text-xs text-blue-600 block mt-1">
              📍 {effectiveTimezone} time
            </span>
          )}
          {isOvernightOperation && (
            <span className="text-xs text-purple-600 block mt-1">
              🌙 {getTimePeriod()}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          {tables && tables.length > 0 ? (
            tables.map((table) => {
              const colors = getTableColor(table.status);
              const hasReservation = table.reservation || table.currentReservation;
              
              return (
                <div 
                  key={table.id} 
                  className={`aspect-square ${colors.bg} rounded-lg flex flex-col items-center justify-center p-2 border ${colors.border} relative cursor-pointer hover:shadow-md transition-shadow`}
                  title={
                    hasReservation
                      ? `Currently occupied: ${hasReservation.guestName || table.currentReservation?.guestName} (${hasReservation.timeSlot || table.currentReservation?.time})`
                      : table.nextReservation
                      ? `Next reservation: ${table.nextReservation.guestName} (${table.nextReservation.time})`
                      : `Table ${table.name} - ${table.status}`
                  }
                >
                  <span className={`text-xs font-semibold ${colors.text}`}>{table.name}</span>
                  <span className={`text-xs ${colors.statusText} mt-1 capitalize`}>
                    {table.status === 'available' ? 'free' : table.status}
                  </span>
                  
                  {/* ✅ ENHANCED: Show current/next reservation info for better UX */}
                  {table.currentReservation && (
                    <span className="text-xs text-gray-600 mt-1 text-center leading-tight">
                      {table.currentReservation.guestName.split(' ')[0]}
                      <br />
                      <span className="text-gray-500">{table.currentReservation.time}</span>
                    </span>
                  )}
                  {table.nextReservation && !table.currentReservation && (
                    <span className="text-xs text-gray-500 mt-1 text-center leading-tight">
                      Next: {table.nextReservation.time}
                      <br />
                      <span className="text-gray-400">{table.nextReservation.guestName.split(' ')[0]}</span>
                    </span>
                  )}
                  
                  {/* ✅ ENHANCED: Show reservation info from API response */}
                  {table.reservation && table.status === 'reserved' && (
                    <span className="text-xs text-gray-600 mt-1 text-center leading-tight">
                      {table.reservation.guestName?.split(' ')[0] || 'Guest'}
                      <br />
                      <span className="text-gray-500">{table.reservation.timeSlot}</span>
                    </span>
                  )}
                  
                  {/* ✅ ENHANCED: Show capacity info for free tables */}
                  {!hasReservation && table.minGuests && table.maxGuests && (
                    <span className="text-xs text-gray-500 mt-1 text-center">
                      {table.minGuests}-{table.maxGuests} guests
                    </span>
                  )}
                </div>
              );
            })
          ) : (
            <div className="col-span-3 py-4 text-center text-sm text-gray-500">
              {isOvernightOperation ? (
                <div>
                  <Clock className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                  <p>No tables have been added yet</p>
                  <p className="text-xs text-blue-600 mt-1">24-hour operation ready</p>
                </div>
              ) : (
                <div>
                  <Users className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                  <p>No tables have been added yet</p>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* ✅ ENHANCED: Statistics summary with better visual hierarchy */}
        {tables && tables.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-100 border border-green-200 rounded-full mr-2"></div>
                <span className="text-gray-700">Free: {stats.free}</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-amber-100 border border-amber-200 rounded-full mr-2"></div>
                <span className="text-gray-700">Reserved: {stats.reserved}</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-red-100 border border-red-200 rounded-full mr-2"></div>
                <span className="text-gray-700">Occupied: {stats.occupied}</span>
              </div>
            </div>
            
            {/* ✅ ENHANCED: Utilization percentage with overnight context */}
            {stats.total > 0 && (
              <div className="text-center text-xs text-gray-500">
                Utilization: {Math.round(((stats.reserved + stats.occupied) / stats.total) * 100)}%
                {isOvernightOperation && (
                  <span className="text-blue-600 ml-2">
                    • 24-hour operation
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="px-6 py-4 border-t border-gray-200">
        <Button variant="link" className="text-sm font-medium text-blue-600 hover:text-blue-500 p-0">
          Manage tables →
        </Button>
        {isOvernightOperation && (
          <span className="ml-auto text-xs text-purple-600">
            🌙 {restaurant?.openingTime}-{restaurant?.closingTime}
          </span>
        )}
      </CardFooter>
    </Card>
  );
}