import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Users, Settings, MousePointer2, Edit2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface TableData {
  id: number;
  name: string;
  minGuests: number;
  maxGuests: number;
  status: string;
  reservation?: {
    guestName: string;
    guestCount: number;
    timeSlot: string;
    phone: string;
    status: string;
  };
}

interface ScheduleSlot {
  time: string;
  tables: TableData[];
}

export default function ModernTables() {
  // Get current Moscow time
  const getMoscowDate = () => {
    const now = new Date();
    const moscowTime = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Moscow"}));
    return moscowTime;
  };

  const [selectedDate, setSelectedDate] = useState(format(getMoscowDate(), 'yyyy-MM-dd'));
  const [selectedTime, setSelectedTime] = useState("19:00");
  const [activeView, setActiveView] = useState<"schedule" | "floorplan" | "grid" | "list">("schedule");
  const [showAddTableModal, setShowAddTableModal] = useState(false);
  const [editingTable, setEditingTable] = useState<TableData | null>(null);
  const [draggedTable, setDraggedTable] = useState<{tableId: number; time: string; tableName: string} | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch restaurant operating hours
  const { data: restaurant, isLoading: restaurantLoading } = useQuery({
    queryKey: ["/api/restaurants/profile"],
  });

  // Generate time slots based on restaurant hours (showing every hour for compact view)
  const timeSlots: string[] = [];
  if (restaurant) {
    const openingTime = restaurant.openingTime || "10:00";
    const closingTime = restaurant.closingTime || "22:00";
    const [openHour] = openingTime.split(':').map(Number);
    const [closeHour] = closingTime.split(':').map(Number);
    
    for (let hour = openHour; hour <= closeHour; hour++) {
      timeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
    }
  }

  // Fetch table data
  const { data: tables, isLoading: tablesLoading } = useQuery({
    queryKey: ["/api/tables"],
  });

  // Fetch table availability for all time slots
  const { data: scheduleData, isLoading } = useQuery({
    queryKey: ["/api/tables/availability/schedule", selectedDate],
    queryFn: async () => {
      const promises = timeSlots.map(async (time) => {
        const response = await fetch(`/api/tables/availability?date=${selectedDate}&time=${time}`);
        const data = await response.json();
        // Sort tables by ID to maintain consistent positioning
        const sortedTables = data.sort((a: any, b: any) => a.id - b.id);
        return { time, tables: sortedTables };
      });
      return Promise.all(promises);
    },
    enabled: !!restaurant && timeSlots.length > 0,
    refetchInterval: 30000, // Auto-refresh every 30 seconds to reduce server load
  });

  // Status colors for modern design
  const getStatusStyle = (status: string, hasReservation: boolean) => {
    if (hasReservation) {
      return "bg-gradient-to-br from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25";
    }
    
    switch (status) {
      case 'available':
        return "bg-gradient-to-br from-green-500 to-green-600 text-white shadow-lg shadow-green-500/25";
      case 'occupied':
        return "bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/25";
      case 'reserved':
        return "bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/25";
      case 'unavailable':
        return "bg-gradient-to-br from-gray-400 to-gray-500 text-white shadow-lg shadow-gray-500/25";
      default:
        return "bg-gradient-to-br from-gray-300 to-gray-400 text-gray-800 shadow-lg shadow-gray-400/25";
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      {/* Beautiful Schedule Grid */}
      <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 rounded-3xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
        <div className="p-6 border-b border-gray-200/50 dark:border-gray-700/50">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                Restaurant Management - {format(new Date(selectedDate), 'EEEE, MMMM d, yyyy')}
              </h3>
              <p className="text-gray-500 dark:text-gray-400 mt-1">
                {activeView === 'schedule' && 'Real-time availability across all tables • Auto-refreshes every 30 seconds'}
                {activeView === 'floorplan' && 'Drag and drop tables to arrange your restaurant layout'}
                {activeView === 'grid' && 'Grid view of all tables with current status'}
                {activeView === 'list' && 'Detailed list view of all table information'}
              </p>
            </div>
            <div className="flex items-center gap-4">
              {/* View Tabs */}
              <div className="flex items-center bg-white dark:bg-gray-800 rounded-xl p-1 shadow-lg border border-gray-200/50 dark:border-gray-700/50">
                {[
                  { id: 'schedule', label: 'Schedule', icon: Clock },
                  { id: 'floorplan', label: 'Floor Plan', icon: Settings },
                  { id: 'grid', label: 'Grid', icon: MousePointer2 },
                  { id: 'list', label: 'List', icon: Edit2 }
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveView(id as any)}
                    className={`
                      flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                      ${activeView === id 
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25' 
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-700'
                      }
                    `}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>

              {(isLoading || tablesLoading) && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Loading...
                </div>
              )}

              {activeView === 'schedule' && (
                <Badge variant="outline" className="text-xs">
                  Hourly slots
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Schedule View Content */}
        <div className="p-6">
          {activeView === 'schedule' && (
            <div className="overflow-x-auto">
              <div className="min-w-[800px]">
                {/* Compact Sticky Header */}
                <div className="sticky top-0 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-750 border-b border-gray-200/50 dark:border-gray-700/50 px-4 py-2 z-10 rounded-lg mb-4">
                  <div className="flex">
                    <div className="w-20 flex-shrink-0 font-semibold text-gray-700 dark:text-gray-300 text-xs py-2">TIME</div>
                    <div className="flex overflow-x-auto gap-1 flex-1">
                      {scheduleData?.[0]?.tables?.map((table: TableData) => (
                        <div key={table.id} className="w-24 flex-shrink-0 text-center bg-white/50 dark:bg-gray-700/50 rounded-lg p-1.5 border border-gray-200/50 dark:border-gray-600/50">
                          <div className="font-medium text-xs text-gray-900 dark:text-gray-100">{table.name}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1">
                            <Users className="h-3 w-3" />
                            {table.minGuests}-{table.maxGuests}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Time Slots */}
                <div className="space-y-1">
                  {scheduleData?.map((slot: ScheduleSlot) => (
                    <div key={slot.time} className="flex hover:bg-gray-50/50 dark:hover:bg-gray-800/50 rounded-lg transition-colors duration-200">
                      <div className="w-20 flex-shrink-0 px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 border-r border-gray-200/50 dark:border-gray-700/50">
                        {slot.time}
                      </div>
                      <div className="flex overflow-x-auto gap-1 flex-1 px-2 py-1">
                        {slot.tables?.map((table: TableData) => {
                          const hasReservation = table.reservation && table.reservation.status === 'confirmed';
                          
                          return (
                            <div
                              key={table.id}
                              className={cn(
                                "w-24 flex-shrink-0 rounded-lg p-2 text-center transition-all duration-200 hover:scale-105 cursor-pointer",
                                getStatusStyle(table.status, hasReservation)
                              )}
                            >
                              <div className="text-xs font-bold opacity-90">
                                {table.name}
                              </div>
                              {hasReservation && table.reservation && (
                                <div className="text-xs opacity-75 mt-1 truncate">
                                  {table.reservation.guestName}
                                </div>
                              )}
                              <div className="text-xs opacity-60 mt-1">
                                {hasReservation ? `${table.reservation?.guestCount} guests` : table.status}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Other Views Placeholder */}
          {activeView !== 'schedule' && (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400">
                {activeView} view coming soon...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}