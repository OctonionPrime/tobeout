import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Clock, Users, Settings, MousePointer2, Edit2, RefreshCw, Move, Calendar, Plus, MoreHorizontal, Trash2, ArrowUp, ArrowDown, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

interface TableData {
  id: number;
  name: string;
  minGuests: number;
  maxGuests: number;
  status: string;
  reservation?: {
    id: number; // Added reservation ID for drag & drop
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
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    reservationId?: number;
    tableId?: number;
    timeSlot?: string;
    guestName?: string;
  } | null>(null);

  // Enhanced drag & drop state
  const [draggedReservation, setDraggedReservation] = useState<{
    reservationId: number;
    guestName: string;
    guestCount: number;
    currentTableId: number;
    currentTableName: string; // Enhanced tracking
    currentTime: string;
    phone?: string; // Optional phone for reservation data
  } | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [dragOverSlot, setDragOverSlot] = useState<{tableId: number; time: string} | null>(null);
  const [isValidDropZone, setIsValidDropZone] = useState(false);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch restaurant operating hours
  const { data: restaurant, isLoading: restaurantLoading } = useQuery({
    queryKey: ["/api/restaurants/profile"],
  });

  // Generate time slots based on restaurant hours (showing every hour for compact view)
  const timeSlots: string[] = [];
  if (restaurant && restaurant.openingTime && restaurant.closingTime) {
    const openingTime = restaurant.openingTime || "10:00";
    const closingTime = restaurant.closingTime || "22:00";
    const [openHour] = openingTime.split(':').map(Number);
    const [closeHour] = closingTime.split(':').map(Number);
    
    for (let hour = openHour; hour <= closeHour; hour++) {
      timeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
    }
  } else {
    // Default time slots if restaurant data is not available
    for (let hour = 10; hour <= 22; hour++) {
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
    refetchInterval: 180000, // 3 minutes for background sync, optimistic updates handle immediacy
    refetchOnWindowFocus: true, // Refresh when user returns to tab
    refetchOnMount: true, // Always fresh data on component mount
  });

  // Move reservation mutation with optimistic updates
  const moveReservationMutation = useMutation({
    mutationFn: async ({ reservationId, newTableId, newTime }: {
      reservationId: number;
      newTableId: number;
      newTime: string;
    }) => {
      const response = await fetch(`/api/reservations/${reservationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: newTableId,
          time: newTime,
          date: selectedDate
        })
      });
      
      if (!response.ok) throw new Error('Failed to move reservation');
      return response.json();
    },
    
    // Smart optimistic updates with precise slot management
    onMutate: async ({ reservationId, newTableId, newTime }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ 
        queryKey: ["/api/tables/availability/schedule"] 
      });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData(["/api/tables/availability/schedule", selectedDate]);

      // Smart UI update with overlap detection
      queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate], (old: any) => {
        if (!old || !draggedReservation) return old;
        
        // Calculate slots with overlap detection
        const sourceHour = parseInt(draggedReservation.currentTime.split(':')[0]);
        const targetHour = parseInt(newTime.split(':')[0]);
        
        const sourceSlots = [
          draggedReservation.currentTime,
          `${(sourceHour + 1).toString().padStart(2, '0')}:00`
        ];
        
        const targetSlots = [
          newTime,
          `${(targetHour + 1).toString().padStart(2, '0')}:00`
        ];
        
        // Smart overlap detection: only clear slots that won't be immediately refilled
        const overlappingSlots = sourceSlots.filter(slot => targetSlots.includes(slot));
        const slotsToActuallyClear = sourceSlots.filter(slot => !overlappingSlots.includes(slot));
        const slotsToActuallyAdd = targetSlots.filter(slot => !overlappingSlots.includes(slot));
        
        return old.map((slot: any) => ({
          ...slot,
          tables: slot.tables.map((table: any) => {
            // Only clear non-overlapping source slots
            if (table.id === draggedReservation.currentTableId && 
                slotsToActuallyClear.includes(slot.time) &&
                table.reservation?.id === reservationId) {
              return { 
                ...table, 
                reservation: null, 
                status: 'available' 
              };
            }
            
            // Add to non-overlapping target slots
            if (table.id === newTableId && slotsToActuallyAdd.includes(slot.time)) {
              return { 
                ...table, 
                status: 'reserved',
                reservation: {
                  id: reservationId,
                  guestName: draggedReservation.guestName,
                  guestCount: draggedReservation.guestCount,
                  timeSlot: slot.time,
                  phone: '',
                  status: 'confirmed'
                }
              };
            }
            
            // Handle overlapping slots: update reservation details but keep occupied
            if (table.id === newTableId && 
                overlappingSlots.includes(slot.time) && 
                table.reservation?.id === reservationId) {
              return { 
                ...table, 
                status: 'reserved',
                reservation: {
                  ...table.reservation,
                  timeSlot: slot.time  // Update timeSlot reference
                }
              };
            }
            
            return table;
          })
        }));
      });

      return { previousData };
    },

    onSuccess: (data, { newTableId, newTime }) => {
      // Enhanced toast with specific details
      const oldTableName = draggedReservation?.currentTableName || `Table ${draggedReservation?.currentTableId}`;
      const newTableName = scheduleData?.find(slot => slot.time === newTime)
        ?.tables?.find(t => t.id === newTableId)?.name || `Table ${newTableId}`;

      toast({
        title: "Reservation Updated",
        description: `${draggedReservation?.guestName}'s reservation moved from ${draggedReservation?.currentTime} (${oldTableName}) to ${newTime} (${newTableName})`,
      });
      
      // Clean up drag state
      setDraggedReservation(null);
      setDragOverSlot(null);
      
      // Invalidate related queries immediately to stay in sync
      queryClient.invalidateQueries({ 
        queryKey: ["/api/reservations"] 
      });
    },

    onError: (error: any, variables, context) => {
      // Revert optimistic update on error
      if (context?.previousData) {
        queryClient.setQueryData(
          ["/api/tables/availability/schedule", selectedDate], 
          context.previousData
        );
      }

      toast({
        title: "Failed to move reservation",
        description: error.message || "Please try again",
        variant: "destructive",
      });
      
      setDraggedReservation(null);
      setDragOverSlot(null);
    }
  });

  // Cancel reservation mutation with optimistic updates
  const cancelReservationMutation = useMutation({
    mutationFn: async (reservationId: number) => {
      const response = await fetch(`/api/booking/cancel/${reservationId}`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to cancel reservation');
      return response.json();
    },
    
    onMutate: async (reservationId: number) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["/api/tables/availability/schedule"] });
      
      // Snapshot the previous value
      const previousData = queryClient.getQueryData(["/api/tables/availability/schedule", selectedDate]);
      
      // Optimistically remove the reservation
      queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate], (old: any) => {
        if (!old) return old;
        
        return old.map((slot: any) => ({
          ...slot,
          tables: slot.tables.map((table: any) => {
            if (table.reservation?.id === reservationId) {
              return {
                ...table,
                reservation: null,
                status: 'available'
              };
            }
            return table;
          })
        }));
      });
      
      return { previousData };
    },
    
    onSuccess: () => {
      setContextMenu(null);
      toast({
        title: "Reservation Cancelled",
        description: "Successfully cancelled reservation.",
      });
    },
    
    onError: (error, variables, context) => {
      // Rollback optimistic update on error
      if (context?.previousData) {
        queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate], context.previousData);
      }
      toast({
        title: "Cancellation Failed", 
        description: "Could not cancel reservation. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Quick move mutation with optimistic updates
  const quickMoveMutation = useMutation({
    mutationFn: async ({ reservationId, direction }: { reservationId: number; direction: 'up' | 'down' }) => {
      // Find current reservation details
      const currentSlot = scheduleData?.find(slot => 
        slot.tables.some(t => t.reservation?.id === reservationId)
      );
      const currentTable = currentSlot?.tables.find(t => t.reservation?.id === reservationId);
      
      if (!currentSlot || !currentTable) throw new Error('Reservation not found');
      
      const currentHour = parseInt(currentSlot.time.split(':')[0]);
      const newHour = direction === 'up' ? currentHour - 1 : currentHour + 1;
      const newTime = `${newHour.toString().padStart(2, '0')}:00`;
      
      const response = await fetch(`/api/reservations/${reservationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: currentTable.id,
          timeSlot: newTime,
          date: selectedDate
        }),
      });
      if (!response.ok) throw new Error('Failed to move reservation');
      return { response: response.json(), newTime, currentTable };
    },
    
    onMutate: async ({ reservationId, direction }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["/api/tables/availability/schedule"] });
      
      // Snapshot the previous value
      const previousData = queryClient.getQueryData(["/api/tables/availability/schedule", selectedDate]);
      
      // Find current reservation
      const currentSlot = scheduleData?.find(slot => 
        slot.tables.some(t => t.reservation?.id === reservationId)
      );
      const currentTable = currentSlot?.tables.find(t => t.reservation?.id === reservationId);
      
      if (!currentSlot || !currentTable || !currentTable.reservation) return { previousData };
      
      const currentHour = parseInt(currentSlot.time.split(':')[0]);
      const targetHour = direction === 'up' ? currentHour - 1 : currentHour + 1;
      const targetTime = `${targetHour.toString().padStart(2, '0')}:00`;
      
      // Optimistically move the reservation using smart overlap logic
      queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate], (old: any) => {
        if (!old) return old;
        
        const sourceSlots = [
          currentSlot.time,
          `${(currentHour + 1).toString().padStart(2, '0')}:00`
        ];
        
        const targetSlots = [
          targetTime,
          `${(targetHour + 1).toString().padStart(2, '0')}:00`
        ];
        
        // Smart overlap detection
        const overlappingSlots = sourceSlots.filter(slot => targetSlots.includes(slot));
        const slotsToActuallyClear = sourceSlots.filter(slot => !overlappingSlots.includes(slot));
        const slotsToActuallyAdd = targetSlots.filter(slot => !overlappingSlots.includes(slot));
        
        return old.map((slot: any) => ({
          ...slot,
          tables: slot.tables.map((table: any) => {
            // Clear from non-overlapping source slots
            if (table.id === currentTable.id && 
                slotsToActuallyClear.includes(slot.time) &&
                table.reservation?.id === reservationId) {
              return {
                ...table,
                reservation: null,
                status: 'available'
              };
            }
            
            // Add to non-overlapping target slots
            if (table.id === currentTable.id && slotsToActuallyAdd.includes(slot.time)) {
              return {
                ...table,
                status: 'reserved',
                reservation: {
                  ...currentTable.reservation,
                  timeSlot: slot.time
                }
              };
            }
            
            // Handle overlapping slots: update timeSlot but keep reservation
            if (table.id === currentTable.id && 
                overlappingSlots.includes(slot.time) && 
                table.reservation?.id === reservationId) {
              return {
                ...table,
                reservation: {
                  ...table.reservation,
                  timeSlot: slot.time
                }
              };
            }
            
            return table;
          })
        }));
      });
      
      return { previousData };
    },
    
    onSuccess: (data, { direction }) => {
      setContextMenu(null);
      toast({
        title: "Reservation Moved",
        description: `Moved reservation ${direction === 'up' ? 'earlier' : 'later'} by 1 hour.`,
      });
    },
    
    onError: (error, variables, context) => {
      // Rollback optimistic update on error
      if (context?.previousData) {
        queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate], context.previousData);
      }
      toast({
        title: "Move Failed",
        description: "Could not move reservation. Check for conflicts.",
        variant: "destructive",
      });
    },
  });

  // Enhanced Drag & Drop Event Handlers
  const handleDragStart = (
    e: React.DragEvent,
    reservation: {
      id: number;
      guestName: string;
      guestCount: number;
    },
    table: TableData, // Pass full table object instead of just ID
    time: string
  ) => {
    setDraggedReservation({
      reservationId: reservation.id,
      guestName: reservation.guestName,
      guestCount: reservation.guestCount,
      currentTableId: table.id,
      currentTableName: table.name, // Capture table name for enhanced messaging
      currentTime: time
    });
    
    // Set drag effect
    e.dataTransfer.effectAllowed = 'move';
  };

  // Enhanced collision detection for multi-hour reservations
  const checkReservationConflict = (targetTableId: number, targetTime: string, duration: number = 2): boolean => {
    if (!scheduleData || !draggedReservation) return false;
    
    const targetHour = parseInt(targetTime.split(':')[0]);
    
    // Generate all time slots this reservation would occupy
    for (let i = 0; i < duration; i++) {
      const hour = (targetHour + i).toString().padStart(2, '0');
      const timeSlot = `${hour}:00`;
      
      const slot = scheduleData.find(s => s.time === timeSlot);
      const table = slot?.tables?.find(t => t.id === targetTableId);
      
      // Check if this slot already has a different reservation (not the one being moved)
      if (table?.reservation && table.reservation.id !== draggedReservation.reservationId) {
        return true; // Conflict detected
      }
    }
    
    return false; // No conflicts
  };

  // Check if target location is within the same guest's existing reservation block
  const isMovingWithinSameReservation = (targetTableId: number, targetTime: string): boolean => {
    if (!scheduleData || !draggedReservation) return false;
    
    // Only prevent moves to the EXACT same slot (same table + same time)
    // Allow moves that shift the time even if there's some overlap
    return draggedReservation.currentTableId === targetTableId && 
           draggedReservation.currentTime === targetTime;
  };

  const handleDragOver = (e: React.DragEvent, tableId: number, time: string) => {
    e.preventDefault();
    
    setDragOverSlot({ tableId, time });
    
    // Special case: prevent moving within the same reservation (it doesn't make sense)
    if (isMovingWithinSameReservation(tableId, time)) {
      setIsValidDropZone(false);
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    
    // Check for reservation conflicts (2-hour duration, can be made dynamic)
    const hasConflict = checkReservationConflict(tableId, time, 2);
    
    // Validate basic availability
    const targetSlot = scheduleData?.find(slot => slot.time === time)?.tables?.find(t => t.id === tableId);
    const hasExistingReservation = targetSlot?.reservation && 
      targetSlot.reservation.id !== draggedReservation?.reservationId;
    
    // Check capacity match
    const capacityMatch = draggedReservation ? 
      (targetSlot?.minGuests || 0) <= draggedReservation.guestCount && 
      draggedReservation.guestCount <= (targetSlot?.maxGuests || 0) : false;
    
    const isValidDrop = !hasConflict && !hasExistingReservation && capacityMatch;
    
    setIsValidDropZone(isValidDrop);
    e.dataTransfer.dropEffect = isValidDrop ? 'move' : 'none';
  };

  const handleDragLeave = () => {
    setDragOverSlot(null);
    setIsValidDropZone(false);
  };

  const handleDrop = (e: React.DragEvent, tableId: number, time: string) => {
    e.preventDefault();
    
    if (!draggedReservation) {
      setDraggedReservation(null);
      setDragOverSlot(null);
      return;
    }

    // Check if dropping on the same location (no move needed)
    if (draggedReservation.currentTableId === tableId && draggedReservation.currentTime === time) {
      setDraggedReservation(null);
      setDragOverSlot(null);
      return; // No action needed - same location
    }

    if (!isValidDropZone) {
      setDraggedReservation(null);
      setDragOverSlot(null);
      return;
    }

    // Execute the move
    moveReservationMutation.mutate({
      reservationId: draggedReservation.reservationId,
      newTableId: tableId,
      newTime: time
    });
  };

  // Status colors for modern design
  const getStatusStyle = (status: string, hasReservation: boolean, isDragTarget = false) => {
    // Drag target highlighting
    if (isDragTarget) {
      return isValidDropZone
        ? "bg-gradient-to-br from-green-400 to-green-500 text-white shadow-lg shadow-green-400/50 ring-2 ring-green-300 scale-105"
        : "bg-gradient-to-br from-red-400 to-red-500 text-white shadow-lg shadow-red-400/50 ring-2 ring-red-300";
    }
    
    if (hasReservation) {
      return "bg-gradient-to-br from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25 cursor-grab active:cursor-grabbing";
    }
    
    switch (status) {
      case 'available':
        return "bg-gradient-to-br from-green-500 to-green-600 text-white shadow-lg shadow-green-500/25 hover:shadow-green-500/40 transition-all duration-200";
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
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Date Selection Panel */}
        <Card className="border border-gray-200/50 dark:border-gray-700/50">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-blue-600" />
                <CardTitle className="text-lg">Table Management</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setSelectedDate(format(getMoscowDate(), 'yyyy-MM-dd'))}
                  className="text-xs"
                >
                  Today
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setSelectedDate(format(addDays(getMoscowDate(), 1), 'yyyy-MM-dd'))}
                  className="text-xs"
                >
                  Tomorrow
                </Button>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="px-3 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>
          </CardHeader>
        </Card>

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
                          const isDragTarget = dragOverSlot?.tableId === table.id && dragOverSlot?.time === slot.time;
                          
                          return (
                            <div
                              key={table.id}
                              className={cn(
                                "w-24 flex-shrink-0 rounded-lg p-2 text-center transition-all duration-200",
                                getStatusStyle(table.status, hasReservation, isDragTarget),
                                !hasReservation && "hover:scale-105"
                              )}
                              // Drag & Drop Events
                              draggable={hasReservation}
                              onDragStart={(e) => hasReservation && table.reservation && handleDragStart(
                                e,
                                {
                                  id: table.reservation.id || 0,
                                  guestName: table.reservation.guestName,
                                  guestCount: table.reservation.guestCount
                                },
                                table, // Pass full table object for enhanced messaging
                                slot.time
                              )}
                              onDragOver={(e) => handleDragOver(e, table.id, slot.time)}
                              onDragLeave={handleDragLeave}
                              onDrop={(e) => handleDrop(e, table.id, slot.time)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setContextMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  reservationId: hasReservation ? table.reservation?.id : undefined,
                                  tableId: table.id,
                                  timeSlot: slot.time,
                                  guestName: hasReservation ? table.reservation?.guestName : undefined,
                                });
                              }}
                            >
                              <div className="text-xs font-bold opacity-90 flex items-center justify-center gap-1">
                                {hasReservation && <Move className="h-3 w-3" />}
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

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[180px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.reservationId ? (
              // Reservation context menu
              <>
                <div className="px-3 py-2 text-sm font-medium text-gray-900 border-b">
                  {contextMenu.guestName || 'Reservation'}
                </div>
                <button
                  className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2"
                  onClick={() => quickMoveMutation.mutate({ reservationId: contextMenu.reservationId!, direction: 'up' })}
                >
                  <ArrowUp className="w-4 h-4" />
                  Move 1 Hour Earlier
                </button>
                <button
                  className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2"
                  onClick={() => quickMoveMutation.mutate({ reservationId: contextMenu.reservationId!, direction: 'down' })}
                >
                  <ArrowDown className="w-4 h-4" />
                  Move 1 Hour Later
                </button>
                <button
                  className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2"
                  onClick={() => {
                    setContextMenu(null);
                    toast({ title: "Edit Feature", description: "Edit reservation feature coming soon!" });
                  }}
                >
                  <Edit2 className="w-4 h-4" />
                  Edit Details
                </button>
                <div className="border-t my-1" />
                <button
                  className="w-full px-3 py-2 text-sm text-left hover:bg-red-50 text-red-600 flex items-center gap-2"
                  onClick={() => cancelReservationMutation.mutate(contextMenu.reservationId!)}
                >
                  <Trash2 className="w-4 h-4" />
                  Cancel Reservation
                </button>
              </>
            ) : (
              // Empty slot context menu
              <>
                <div className="px-3 py-2 text-sm font-medium text-gray-900 border-b">
                  Available Slot
                </div>
                <button
                  className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2"
                  onClick={() => {
                    setContextMenu(null);
                    toast({ title: "Create Feature", description: "Create new reservation feature coming soon!" });
                  }}
                >
                  <UserPlus className="w-4 h-4" />
                  Create New Reservation
                </button>
              </>
            )}
          </div>
        </>
      )}
    </DashboardLayout>
  );
}