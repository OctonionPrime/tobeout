import React, { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, Users, Settings, MousePointer2, Edit2, RefreshCw, Move, Calendar, Plus, MoreHorizontal, Trash2, ArrowUp, ArrowDown, UserPlus, Save, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { getRestaurantDateTime, getRestaurantDateString, getTomorrowDateString } from "@/lib/utils";

// ✅ NEW: Import WebSocket context and dnd-kit
import { useWebSocketContext } from "@/components/websocket/WebSocketContext";
import { DndContext, DragEndEvent } from '@dnd-kit/core';
import { DraggableReservation } from '@/components/reservations/DraggableReservation';
import { DroppableSlot } from '@/components/reservations/DroppableSlot';

interface TableData {
  id: number;
  name: string;
  minGuests: number;
  maxGuests: number;
  status: string;
  reservation?: {
    id: number;
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

interface AddTableForm {
  name: string;
  minGuests: number;
  maxGuests: number;
  features: string;
  comments: string;
}

interface Restaurant {
  id: number;
  openingTime: string;
  closingTime: string;
  avgReservationDuration: number;
  timezone: string;
  [key: string]: any;
}

interface MutationContext {
  previousData?: any;
}

export default function ModernTables() {
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState("19:00");
  const [activeView, setActiveView] = useState<"schedule" | "floorplan" | "grid" | "list">("schedule");
  
  // Add Table Modal State
  const [showAddTableModal, setShowAddTableModal] = useState(false);
  const [editingTable, setEditingTable] = useState<TableData | null>(null);
  const [addTableForm, setAddTableForm] = useState<AddTableForm>({
    name: "",
    minGuests: 1,
    maxGuests: 4,
    features: "",
    comments: ""
  });
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    reservationId?: number;
    tableId?: number;
    timeSlot?: string;
    guestName?: string;
  } | null>(null);

  // ✅ REMOVED: All manual drag-and-drop state variables
  // - draggedReservation
  // - dragPosition
  // - dragOverSlot
  // - isValidDropZone
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ✅ NEW: WebSocket context for real-time updates
  const { isConnected } = useWebSocketContext();

  // Get restaurant profile first
  const { data: restaurant, isLoading: restaurantLoading, error: restaurantError } = useQuery<Restaurant>({
    queryKey: ["/api/restaurants/profile"],
    retry: 3,
    staleTime: 30000,
  });

  const restaurantTimezone = restaurant?.timezone || 'Europe/Belgrade';

  // Set selectedDate after restaurant loads
  React.useEffect(() => {
    if (restaurant && !selectedDate) {
      setSelectedDate(getRestaurantDateString(restaurantTimezone));
    }
  }, [restaurant, restaurantTimezone, selectedDate]);

  // Enhanced overnight-aware time slot generation
  const timeSlots: string[] = React.useMemo(() => {
    if (!restaurant?.openingTime || !restaurant?.closingTime) {
      return [];
    }

    const slots: string[] = [];
    try {
      const [openHour, openMin] = restaurant.openingTime.split(':').map(Number);
      const [closeHour, closeMin] = restaurant.closingTime.split(':').map(Number);
      
      const openingMinutes = openHour * 60 + (openMin || 0);
      const closingMinutes = closeHour * 60 + (closeMin || 0);
      
      const isOvernightOperation = closingMinutes < openingMinutes;
      
      if (isOvernightOperation) {
        console.log(`[ModernTables] 🌙 Overnight operation detected: ${restaurant.openingTime}-${restaurant.closingTime}`);
        
        for (let minutes = openingMinutes; minutes < 24 * 60; minutes += 60) {
          const hour = Math.floor(minutes / 60);
          const minute = minutes % 60;
          slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
        }
        
        for (let minutes = 0; minutes < closingMinutes; minutes += 60) {
          const hour = Math.floor(minutes / 60);
          const minute = minutes % 60;
          slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
        }
        
        console.log(`[ModernTables] 🌙 Generated ${slots.length} overnight slots:`, slots.slice(0, 5), '...', slots.slice(-3));
      } else {
        console.log(`[ModernTables] 📅 Standard operation: ${restaurant.openingTime}-${restaurant.closingTime}`);
        
        const avgDuration = restaurant.avgReservationDuration || 120;
        const lastBookingTime = closingMinutes - avgDuration;
        
        for (let minutes = openingMinutes; minutes <= lastBookingTime; minutes += 60) {
          const hour = Math.floor(minutes / 60);
          const minute = minutes % 60;
          slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
        }
        
        console.log(`[ModernTables] 📅 Generated ${slots.length} standard slots`);
      }
    } catch (error) {
      console.error('Error generating time slots:', error);
    }
    
    return slots;
  }, [restaurant]);

  // Get tables with proper timezone context
  const { data: tables, isLoading: tablesLoading, error: tablesError } = useQuery({
    queryKey: ["/api/tables", restaurantTimezone],
    enabled: !!restaurant,
    retry: 3,
  });

  // ✅ UPDATED: Removed refetchInterval for real-time WebSocket updates
  const { data: scheduleData, isLoading, error: scheduleError } = useQuery({
    queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone],
    queryFn: async () => {
      if (!selectedDate || timeSlots.length === 0) {
        throw new Error('Missing date or time slots');
      }

      console.log(`🔍 [ModernTables] Fetching schedule for ${selectedDate} with timezone ${restaurantTimezone}`);
      console.log(`🔍 [ModernTables] Time slots to check: ${timeSlots.length} slots`);

      const isOvernight = restaurant?.openingTime && restaurant?.closingTime && 
        (parseInt(restaurant.closingTime.split(':')[0]) < parseInt(restaurant.openingTime.split(':')[0]));

      const promises = timeSlots.map(async (time) => {
        const url = `/api/tables/availability?date=${selectedDate}&time=${time}&timezone=${encodeURIComponent(restaurantTimezone)}`;
        
        try {
          const response = await fetch(url, {
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          });
          
          if (!response.ok) {
            console.error(`❌ Failed to fetch availability for ${time}:`, response.status, response.statusText);
            
            if (isOvernight) {
              console.error(`❌ [ModernTables] Overnight operation error at ${time} - this might be due to timezone handling`);
            }
            
            throw new Error(`Failed to fetch availability for ${time}: ${response.status}`);
          }
          
          const data = await response.json();
          const sortedTables = Array.isArray(data) ? data.sort((a: any, b: any) => a.id - b.id) : [];
          
          if (isOvernight && (time === timeSlots[0] || time === timeSlots[Math.floor(timeSlots.length/2)] || time === timeSlots[timeSlots.length-1])) {
            console.log(`✅ [ModernTables] 🌙 Overnight slot ${time}: ${sortedTables.length} tables`);
          } else if (!isOvernight && sortedTables.length > 0) {
            console.log(`✅ [ModernTables] 📅 Standard slot ${time}: ${sortedTables.length} tables`);
          }
          
          return { time, tables: sortedTables };
          
        } catch (error) {
          console.error(`❌ Error fetching ${time}:`, error);
          
          if (isOvernight) {
            console.warn(`⚠️ [ModernTables] 🌙 Overnight slot ${time} failed, providing empty data`);
            return { time, tables: [] };
          }
          
          throw error;
        }
      });
      
      const results = await Promise.allSettled(promises);
      
      const successfulResults = results
        .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
        .map(result => result.value);
      
      const failedResults = results.filter(result => result.status === 'rejected');
      
      if (failedResults.length > 0) {
        console.warn(`⚠️ [ModernTables] ${failedResults.length}/${timeSlots.length} time slots failed to load`);
        
        if (isOvernight && successfulResults.length > 0) {
          console.log(`✅ [ModernTables] 🌙 Overnight operation: Using ${successfulResults.length} successful slots out of ${timeSlots.length} total`);
        } else if (failedResults.length === timeSlots.length) {
          throw new Error('All time slots failed to load');
        }
      }
      
      console.log(`✅ [ModernTables] Schedule loaded: ${successfulResults.length} time slots${isOvernight ? ' (overnight operation)' : ''}`);
      return successfulResults;
    },
    enabled: !!restaurant && !!selectedDate && timeSlots.length > 0,
    // ✅ REMOVED: refetchInterval (now using WebSocket for real-time updates)
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    retry: (failureCount, error) => {
      const isOvernight = restaurant?.openingTime && restaurant?.closingTime && 
        (parseInt(restaurant.closingTime.split(':')[0]) < parseInt(restaurant.openingTime.split(':')[0]));
      
      if (isOvernight) {
        return failureCount < 1;
      }
      return failureCount < 2;
    },
  });

  // ✅ NEW: dnd-kit drag end handler (replaces all manual drag-and-drop handlers)
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    // Exit if the item was dropped in a non-droppable area
    if (!over) {
      return;
    }

    // Exit if the item was dropped back into its original spot
    if (active.id === over.id) {
      return;
    }

    const reservationId = active.id as number;
    const { tableId: newTableId, time: newTime } = over.data.current as { tableId: number, time: string };

    // Check for capacity constraints
    const draggedGuestCount = active.data.current?.guestCount;
    const targetTable = over.data.current?.table;
    
    if (draggedGuestCount && targetTable && (draggedGuestCount < targetTable.minGuests || draggedGuestCount > targetTable.maxGuests)) {
      toast({
        title: "Move Failed",
        description: `Table ${targetTable.name} cannot accommodate ${draggedGuestCount} guests.`,
        variant: "destructive",
      });
      return;
    }
    
    // Call the existing mutation to move the reservation
    moveReservationMutation.mutate({
      reservationId,
      newTableId,
      newTime,
    });
  };

  // Enhanced table creation with timezone context
  const addTableMutation = useMutation({
    mutationFn: async (tableData: AddTableForm) => {
      const payload = {
        name: tableData.name,
        minGuests: tableData.minGuests,
        maxGuests: tableData.maxGuests,
        features: tableData.features ? tableData.features.split(',').map(f => f.trim()) : [],
        comments: tableData.comments,
        status: 'free',
        restaurantTimezone: restaurantTimezone
      };
      
      console.log(`🏗️ [ModernTables] Creating table:`, payload);
      
      const response = await fetch('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create table');
      }
      
      return response.json();
    },
    onSuccess: (newTable) => {
      toast({
        title: "Table Added Successfully! 🎉",
        description: `Table ${newTable.name} (${newTable.minGuests}-${newTable.maxGuests} guests) is now available for reservations`,
      });
      
      console.log(`✅ [ModernTables] Table created:`, newTable);
      
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tables/availability/schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/restaurants/profile"] });
      
      queryClient.refetchQueries({ 
        queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone] 
      });
      
      setAddTableForm({
        name: "",
        minGuests: 1,
        maxGuests: 4,
        features: "",
        comments: ""
      });
      setShowAddTableModal(false);
    },
    onError: (error: any) => {
      console.error('❌ [ModernTables] Table creation failed:', error);
      toast({
        title: "Failed to Add Table",
        description: error.message || "Please check your inputs and try again",
        variant: "destructive",
      });
    }
  });

  // Enhanced table deletion with timezone context
  const deleteTableMutation = useMutation({
    mutationFn: async (tableId: number) => {
      console.log(`🗑️ [ModernTables] Deleting table ${tableId}`);
      
      const response = await fetch(`/api/tables/${tableId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete table');
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Table Deleted",
        description: "Table removed successfully",
      });
      
      console.log(`✅ [ModernTables] Table deleted successfully`);
      
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tables/availability/schedule"] });
      
      queryClient.refetchQueries({ 
        queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone] 
      });
    },
    onError: (error: any) => {
      console.error('❌ [ModernTables] Table deletion failed:', error);
      toast({
        title: "Failed to Delete Table",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    }
  });

  // Enhanced reservation movement with proper mutation types
  const moveReservationMutation = useMutation<any, Error, { 
    reservationId: number; 
    newTableId: number; 
    newTime: string; 
  }, MutationContext>({
    mutationFn: async (variables) => {
      const { reservationId, newTableId, newTime } = variables;
      console.log(`🔄 [ModernTables] Moving reservation ${reservationId} to table ${newTableId} at ${newTime}`);
      
      const response = await fetch(`/api/reservations/${reservationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          tableId: newTableId,
          time: newTime,
          date: selectedDate,
          timezone: restaurantTimezone
        })
      });
      
      if (!response.ok) throw new Error('Failed to move reservation');
      return response.json();
    },
    
    onMutate: async (variables) => {
      const { reservationId, newTableId, newTime } = variables;
      await queryClient.cancelQueries({ 
        queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone] 
      });

      const previousData = queryClient.getQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone]);
      // Calculate duration in hour slots based on restaurant's average reservation duration
      const durationInSlots = Math.ceil((restaurant?.avgReservationDuration || 120) / 60);

      queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone], (old: any) => {
        if (!old) return old;
        
        // Find the current reservation to move
        let currentReservation: any = null;
        let currentTableId: number = 0;
        let currentTime: string = '';
        
        // Find the reservation in the current data
        for (const slot of old) {
          for (const table of slot.tables) {
            if (table.reservation?.id === reservationId) {
              currentReservation = table.reservation;
              currentTableId = table.id;
              currentTime = slot.time;
              break;
            }
          }
          if (currentReservation) break;
        }
        
        if (!currentReservation) return old;
        
        const sourceHour = parseInt(currentTime.split(':')[0]);
        const targetHour = parseInt(newTime.split(':')[0]);
        
        const sourceSlots: string[] = [];
        const targetSlots: string[] = [];
        
        for (let i = 0; i < durationInSlots; i++) {
          sourceSlots.push(`${(sourceHour + i).toString().padStart(2, '0')}:00`);
          targetSlots.push(`${(targetHour + i).toString().padStart(2, '0')}:00`);
        }
        
        return old.map((slot: any) => ({
          ...slot,
          tables: slot.tables.map((table: any) => {
            if (table.id === currentTableId && 
                sourceSlots.includes(slot.time) &&
                table.reservation?.id === reservationId) {
              return { 
                ...table, 
                reservation: null, 
                status: 'available' 
              };
            }
            
            if (table.id === newTableId && targetSlots.includes(slot.time)) {
              return { 
                ...table, 
                status: 'reserved',
                reservation: {
                  ...currentReservation,
                  timeSlot: `${slot.time}-${targetSlots[targetSlots.length - 1]}`
                }
              };
            }
            
            return table;
          })
        }));
      });

      return { previousData };
    },

    onSuccess: (data: any, variables) => {
      const { newTableId, newTime } = variables;
      
      // Find table names for the toast message
      const newTableName = scheduleData?.find(slot => slot.time === newTime)
        ?.tables?.find((t: any) => t.id === newTableId)?.name || `Table ${newTableId}`;

      toast({
        title: "Reservation Updated",
        description: `Reservation moved to ${newTime} (${newTableName})`,
      });
      
      queryClient.invalidateQueries({ 
        queryKey: ["/api/reservations", restaurantTimezone] 
      });
    },

    onError: (error: any, variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(
          ["/api/tables/availability/schedule", selectedDate, restaurantTimezone], 
          context.previousData
        );
      }

      toast({
        title: "Failed to move reservation",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    }
  });

  // Enhanced reservation cancellation with proper typing
  const cancelReservationMutation = useMutation<any, Error, number, MutationContext>({
    mutationFn: async (reservationId: number) => {
      const response = await fetch(`/api/reservations/${reservationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          status: 'canceled',
          timezone: restaurantTimezone
        })
      });
      if (!response.ok) throw new Error('Failed to cancel reservation');
      return response.json();
    },
    
    onMutate: async (reservationId: number) => {
      await queryClient.cancelQueries({ queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone] });
      
      const previousData = queryClient.getQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone]);
      
      queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone], (old: any) => {
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
      if (context?.previousData) {
        queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone], context.previousData);
      }
      toast({
        title: "Cancellation Failed", 
        description: "Could not cancel reservation. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Enhanced quick move with proper typing
  const quickMoveMutation = useMutation<any, Error, { reservationId: number; direction: 'up' | 'down' }, MutationContext>({
    mutationFn: async ({ reservationId, direction }) => {
      const currentSlot = scheduleData?.find(slot => 
        slot.tables.some((t: any) => t.reservation?.id === reservationId)
      );
      const currentTable = currentSlot?.tables.find((t: any) => t.reservation?.id === reservationId);
      
      if (!currentSlot || !currentTable) throw new Error('Reservation not found');
      
      const currentHour = parseInt(currentSlot.time.split(':')[0]);
      const newHour = direction === 'up' ? currentHour - 1 : currentHour + 1;
      
      const isOvernight = restaurant?.openingTime && restaurant?.closingTime && 
        (parseInt(restaurant.closingTime.split(':')[0]) < parseInt(restaurant.openingTime.split(':')[0]));
      
      if (isOvernight) {
        const openingHour = parseInt(restaurant.openingTime.split(':')[0]);
        const closingHour = parseInt(restaurant.closingTime.split(':')[0]);
        
        if (direction === 'up' && newHour < 0) {
          throw new Error('Cannot move before midnight');
        }
        if (direction === 'down' && newHour >= 24) {
          throw new Error('Cannot move past 24:00');
        }
        
        const isValidHour = (newHour >= openingHour || newHour < closingHour);
        if (!isValidHour) {
          throw new Error(`Cannot move outside operating hours (${restaurant.openingTime} - ${restaurant.closingTime})`);
        }
      } else {
        const openingHour = parseInt(restaurant?.openingTime?.split(':')[0] || '10');
        const closingHour = parseInt(restaurant?.closingTime?.split(':')[0] || '22');
        
        if (newHour < openingHour || newHour > closingHour - 2) {
          throw new Error(`Cannot move outside business hours (${openingHour}:00 - ${closingHour - 2}:00)`);
        }
      }
      
      const newTime = `${newHour.toString().padStart(2, '0')}:00`;
      
      const targetSlots = [
        newTime,
        `${(newHour + 1).toString().padStart(2, '0')}:00`
      ];
      
      for (const targetTime of targetSlots) {
        const targetSlot = scheduleData?.find(s => s.time === targetTime);
        const targetTable = targetSlot?.tables?.find((t: any) => t.id === currentTable.id);
        
        if (targetTable?.reservation && targetTable.reservation.id !== reservationId) {
          throw new Error(`Cannot move: ${targetTable.reservation.guestName} already has ${targetTime} reserved`);
        }
      }
      
      const response = await fetch(`/api/reservations/${reservationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          tableId: currentTable.id,
          time: newTime,
          date: selectedDate,
          timezone: restaurantTimezone
        }),
      });
      if (!response.ok) throw new Error('Failed to move reservation');
      return { response: response.json(), newTime, currentTable };
    },
    
    onMutate: async ({ reservationId, direction }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone] });
      
      const previousData = queryClient.getQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone]);
      
      const currentSlot = scheduleData?.find(slot => 
        slot.tables.some((t: any) => t.reservation?.id === reservationId)
      );
      const currentTable = currentSlot?.tables.find((t: any) => t.reservation?.id === reservationId);
      
      if (!currentSlot || !currentTable || !currentTable.reservation) return { previousData };
      
      const currentHour = parseInt(currentSlot.time.split(':')[0]);
      const targetHour = direction === 'up' ? currentHour - 1 : currentHour + 1;
      const targetTime = `${targetHour.toString().padStart(2, '0')}:00`;
      
      // Calculate duration in hour slots based on restaurant's average reservation duration
      const durationInSlots = Math.ceil((restaurant?.avgReservationDuration || 120) / 60);
      
      queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone], (old: any) => {
        if (!old) return old;
        
        const sourceSlots: string[] = [];
        const targetSlots: string[] = [];
        
        for (let i = 0; i < durationInSlots; i++) {
          sourceSlots.push(`${(currentHour + i).toString().padStart(2, '0')}:00`);
          targetSlots.push(`${(targetHour + i).toString().padStart(2, '0')}:00`);
        }
        
        return old.map((slot: any) => ({
          ...slot,
          tables: slot.tables.map((table: any) => {
            if (table.id === currentTable.id && 
                sourceSlots.includes(slot.time) &&
                table.reservation?.id === reservationId) {
              return {
                ...table,
                reservation: null,
                status: 'available'
              };
            }
            
            if (table.id === currentTable.id && targetSlots.includes(slot.time)) {
              return {
                ...table,
                status: 'reserved',
                reservation: {
                  ...currentTable.reservation,
                  timeSlot: `${targetSlots[0]}-${targetSlots[targetSlots.length - 1]}`
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
      if (context?.previousData) {
        queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone], context.previousData);
      }
      toast({
        title: "Move Failed",
        description: error.message || "Could not move reservation. Check for conflicts.",
        variant: "destructive",
      });
    },
  });

  // ✅ REMOVED: All manual drag-and-drop handlers
  // - handleDragStart
  // - handleDragOver
  // - handleDragLeave
  // - handleDrop
  // - checkReservationConflict
  // - isMovingWithinSameReservation

  // Status colors for modern design with proper typing
  const getStatusStyle = (status: string, hasReservation: boolean | undefined, isDragTarget = false) => {
    if (isDragTarget) {
      return "bg-gradient-to-br from-green-400 to-green-500 text-white shadow-lg shadow-green-400/50 ring-2 ring-green-300 scale-105";
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

  // Enhanced form submission with validation
  const handleAddTable = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!addTableForm.name.trim()) {
      toast({
        title: "Table Name Required",
        description: "Please enter a name for the table",
        variant: "destructive",
      });
      return;
    }
    
    if (addTableForm.minGuests < 1 || addTableForm.maxGuests < addTableForm.minGuests) {
      toast({
        title: "Invalid Capacity",
        description: "Please ensure max guests is greater than or equal to min guests",
        variant: "destructive",
      });
      return;
    }
    
    if (addTableForm.maxGuests > 50) {
      toast({
        title: "Capacity Too Large",
        description: "Maximum table capacity is 50 guests",
        variant: "destructive",
      });
      return;
    }
    
    console.log(`🏗️ [ModernTables] Submitting table creation form:`, addTableForm);
    addTableMutation.mutate(addTableForm);
  };

  // Enhanced date formatting with timezone
  const formatCurrentDate = () => {
    try {
      if (!restaurantTimezone || !selectedDate) {
        return new Date().toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      }
      
      const restaurantDateTime = DateTime.fromISO(selectedDate, { zone: restaurantTimezone });
      return restaurantDateTime.toFormat('EEEE, MMMM d, yyyy');
    } catch (error) {
      console.error('Error formatting date:', error);
      return new Date(selectedDate).toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    }
  };

  // Enhanced date navigation with timezone
  const getTodayDateStr = () => {
    return getRestaurantDateString(restaurantTimezone);
  };

  const getTomorrowDateStr = () => {
    return getTomorrowDateString(restaurantTimezone);
  };

  // Show loading state while restaurant loads
  if (restaurantLoading) {
    return (
      <DashboardLayout>
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-6 w-6 animate-spin text-blue-600" />
              <span className="text-lg text-gray-600">Loading restaurant profile...</span>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // Show error state if restaurant fails to load
  if (restaurantError || !restaurant) {
    return (
      <DashboardLayout>
        <div className="container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold text-red-600 mb-4">Unable to Load Restaurant</h2>
            <p className="text-gray-600 mb-4">
              {restaurantError ? (restaurantError as any).message : 'Restaurant profile not found'}
            </p>
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reload Page
            </Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // Check if this is an overnight operation
  const isOvernightOperation = restaurant?.openingTime && restaurant?.closingTime && 
    (parseInt(restaurant.closingTime.split(':')[0]) < parseInt(restaurant.openingTime.split(':')[0]));

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
                <Badge variant="outline" className="text-xs">
                  {restaurantTimezone}
                </Badge>
                {isOvernightOperation && (
                  <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700">
                    <Clock className="h-3 w-3 mr-1" />
                    24-Hour Operation
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* ✅ NEW: Live Status Indicator */}
                {isConnected ? (
                    <Badge variant="outline" className="border-green-500 text-green-700 bg-green-50">
                        ● Live
                    </Badge>
                ) : (
                    <Badge variant="destructive">● Disconnected</Badge>
                )}
                <Button 
                  onClick={() => setShowAddTableModal(true)}
                  className="bg-green-600 hover:bg-green-700 text-white"
                  size="sm"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Table
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setSelectedDate(getTodayDateStr())}
                  className="text-xs"
                  disabled={!restaurantTimezone}
                >
                  Today
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setSelectedDate(getTomorrowDateStr())}
                  className="text-xs"
                  disabled={!restaurantTimezone}
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

        {/* Table Statistics */}
        {tablesLoading ? (
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="pt-4">
              <div className="flex items-center justify-center h-16">
                <RefreshCw className="h-5 w-5 animate-spin text-blue-600 mr-2" />
                <span className="text-blue-700">Loading tables...</span>
              </div>
            </CardContent>
          </Card>
        ) : tables && Array.isArray(tables) && tables.length > 0 ? (
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{tables.length}</div>
                  <div className="text-blue-700">Total Tables</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {tables.reduce((sum: number, table: any) => sum + table.maxGuests, 0)}
                  </div>
                  <div className="text-blue-700">Total Capacity</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {Math.round(tables.reduce((sum: number, table: any) => sum + table.maxGuests, 0) / tables.length)}
                  </div>
                  <div className="text-blue-700">Avg Table Size</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {Math.max(...tables.map((t: any) => t.maxGuests))}
                  </div>
                  <div className="text-blue-700">Largest Table</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-yellow-50 border-yellow-200">
            <CardContent className="pt-4">
              <div className="text-center py-8">
                <Users className="h-12 w-12 text-yellow-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-yellow-800 mb-2">No Tables Found</h3>
                <p className="text-yellow-700 mb-4">
                  Add tables to start managing reservations and table availability.
                </p>
                <Button 
                  onClick={() => setShowAddTableModal(true)}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First Table
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Beautiful Schedule Grid */}
        <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 rounded-3xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
          <div className="p-6 border-b border-gray-200/50 dark:border-gray-700/50">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  Restaurant Management - {formatCurrentDate()}
                </h3>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                  Real-time availability across all tables • Live updates via WebSocket
                  <span className="ml-2 text-blue-600">
                    • {restaurantTimezone}
                  </span>
                  {isOvernightOperation && (
                    <span className="ml-2 text-purple-600">
                      • 24-Hour Operation ({restaurant.openingTime}-{restaurant.closingTime})
                    </span>
                  )}
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
                    {isOvernightOperation ? `${timeSlots.length} overnight slots` : 'Hourly slots'}
                  </Badge>
                )}
              </div>
            </div>
          </div>

        {/* Schedule View Content */}
        <div className="p-6">
          {activeView === 'schedule' && (
            <>
              {scheduleError ? (
                <div className="text-center py-12">
                  <p className="text-red-600 mb-4">
                    Failed to load schedule: {(scheduleError as any).message}
                  </p>
                  {isOvernightOperation && (
                    <p className="text-orange-600 mb-4 text-sm">
                      Note: 24-hour operations may require additional setup time
                    </p>
                  )}
                  <Button onClick={() => queryClient.refetchQueries({ 
                    queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone] 
                  })}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                </div>
              ) : isLoading ? (
                <div className="text-center py-12">
                  <RefreshCw className="h-6 w-6 animate-spin text-blue-600 mx-auto mb-4" />
                  <p className="text-gray-600">
                    Loading {isOvernightOperation ? '24-hour' : 'schedule'} data...
                  </p>
                  {isOvernightOperation && (
                    <p className="text-sm text-blue-600 mt-2">
                      Processing {timeSlots.length} overnight time slots
                    </p>
                  )}
                </div>
              ) : scheduleData && scheduleData.length > 0 && scheduleData[0]?.tables?.length > 0 ? (
                <DndContext onDragEnd={handleDragEnd}>
                  <div className="overflow-x-auto">
                    <div className="min-w-[800px]">
                      {/* Sticky Header */}
                      <div className="sticky top-0 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-750 border-b border-gray-200/50 dark:border-gray-700/50 px-4 py-2 z-10 rounded-lg mb-4">
                        <div className="flex">
                          <div className="w-20 flex-shrink-0 font-semibold text-gray-700 dark:text-gray-300 text-xs py-2">
                            TIME
                            {isOvernightOperation && (
                              <div className="text-xs text-blue-600 mt-1">24h</div>
                            )}
                          </div>
                          <div className="flex overflow-x-auto gap-1 flex-1">
                            {scheduleData[0]?.tables?.map((table: TableData) => (
                              <div key={table.id} className="w-24 flex-shrink-0 text-center bg-white/50 dark:bg-gray-700/50 rounded-lg p-1.5 border border-gray-200/50 dark:border-gray-600/50 relative group">
                                <div className="font-medium text-xs text-gray-900 dark:text-gray-100">{table.name}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1">
                                  <Users className="h-3 w-3" />
                                  {table.minGuests}-{table.maxGuests}
                                </div>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => {
                                    if (confirm(`Delete table ${table.name}? This cannot be undone.`)) {
                                      deleteTableMutation.mutate(table.id);
                                    }
                                  }}
                                  className="absolute -top-2 -right-2 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Time Slots with overnight operation visual cues */}
                      <div className="space-y-1">
                        {scheduleData?.map((slot: ScheduleSlot) => {
                          const hour = parseInt(slot.time.split(':')[0]);
                          const isEarlyMorning = isOvernightOperation && hour < 6;
                          const isLateNight = isOvernightOperation && hour >= 22;
                          
                          return (
                            <div 
                              key={slot.time} 
                              className={cn(
                                "flex hover:bg-gray-50/50 dark:hover:bg-gray-800/50 rounded-lg transition-colors duration-200",
                                isEarlyMorning && "bg-blue-50/30",
                                isLateNight && "bg-purple-50/30"
                              )}
                            >
                              <div className={cn(
                                "w-20 flex-shrink-0 px-4 py-3 text-sm font-medium border-r border-gray-200/50 dark:border-gray-700/50",
                                isEarlyMorning && "text-blue-700 dark:text-blue-300",
                                isLateNight && "text-purple-700 dark:text-purple-300",
                                !isEarlyMorning && !isLateNight && "text-gray-700 dark:text-gray-300"
                              )}>
                                {slot.time}
                                {isOvernightOperation && (
                                  <div className="text-xs opacity-60">
                                    {isEarlyMorning ? "Early" : isLateNight ? "Night" : "Day"}
                                  </div>
                                )}
                              </div>
                              <div className="flex overflow-x-auto gap-1 flex-1 px-2 py-1">
                                {slot.tables?.map((table: TableData) => {
                                  const hasReservation = table.reservation && table.reservation.status === 'confirmed';
                                  const uniqueSlotId = `${table.id}-${slot.time}`; // Unique ID for the droppable area
                                  
                                  return (
                                    <div
                                      key={table.id}
                                      className={cn(
                                        "w-24 flex-shrink-0 rounded-lg p-2 text-center transition-all duration-200",
                                        getStatusStyle(table.status, hasReservation),
                                        !hasReservation && "hover:scale-105"
                                      )}
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
                                      {/* ✅ NEW: Use DraggableReservation and DroppableSlot components */}
                                      {hasReservation && table.reservation ? (
                                        <DraggableReservation 
                                          id={table.reservation.id} 
                                          data={{
                                            guestName: table.reservation.guestName,
                                            guestCount: table.reservation.guestCount,
                                          }}
                                        >
                                          {/* The content of the reservation card */}
                                          <div className="text-xs font-bold opacity-90 flex items-center justify-center gap-1 cursor-grab active:cursor-grabbing">
                                            <Move className="h-3 w-3" />
                                            {table.name}
                                          </div>
                                          <div className="text-xs opacity-75 mt-1 truncate">
                                            {table.reservation.guestName}
                                          </div>
                                          <div className="text-xs opacity-60 mt-1">
                                            {`${table.reservation.guestCount} guests`}
                                          </div>
                                        </DraggableReservation>
                                      ) : (
                                        <DroppableSlot 
                                          id={uniqueSlotId}
                                          data={{ tableId: table.id, time: slot.time, table: table }}
                                        >
                                          {/* The content of an empty, droppable slot */}
                                          <div className="h-full flex flex-col justify-center">
                                            <div className="text-xs font-bold opacity-90">{table.name}</div>
                                            <div className="text-xs opacity-60 mt-1">{table.status}</div>
                                          </div>
                                        </DroppableSlot>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </DndContext>
              ) : (
                <div className="text-center py-12">
                  <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-600 mb-2">No Tables Available</h3>
                  <p className="text-gray-500 mb-4">
                    Add tables to start managing reservations and viewing table availability.
                  </p>
                  {isOvernightOperation && (
                    <p className="text-sm text-blue-600 mb-4">
                      24-hour operation detected ({restaurant.openingTime}-{restaurant.closingTime})
                    </p>
                  )}
                  <Button 
                    onClick={() => setShowAddTableModal(true)}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Your First Table
                  </Button>
                </div>
              )}
            </>
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

      {/* Enhanced Add Table Modal */}
      <Dialog open={showAddTableModal} onOpenChange={setShowAddTableModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Table</DialogTitle>
            <DialogDescription>
              Create a new table for your restaurant. You can edit these details later.
              {isOvernightOperation && (
                <span className="block mt-2 text-blue-600 text-sm">
                  🌙 24-hour operation detected - table will be available around the clock
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleAddTable} className="space-y-4">
            <div>
              <Label htmlFor="tableName">Table Name *</Label>
              <Input
                id="tableName"
                value={addTableForm.name}
                onChange={(e) => setAddTableForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Table 1, Corner Table, Patio A"
                required
                maxLength={50}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="minGuests">Min Guests *</Label>
                <Input
                  id="minGuests"
                  type="number"
                  min="1"
                  max="20"
                  value={addTableForm.minGuests}
                  onChange={(e) => setAddTableForm(prev => ({ ...prev, minGuests: parseInt(e.target.value) || 1 }))}
                  required
                />
              </div>
              
              <div>
                <Label htmlFor="maxGuests">Max Guests *</Label>
                <Input
                  id="maxGuests"
                  type="number"
                  min="1"
                  max="50"
                  value={addTableForm.maxGuests}
                  onChange={(e) => setAddTableForm(prev => ({ ...prev, maxGuests: parseInt(e.target.value) || 4 }))}
                  required
                />
              </div>
            </div>
            
            <div>
              <Label htmlFor="features">Features (Optional)</Label>
              <Input
                id="features"
                value={addTableForm.features}
                onChange={(e) => setAddTableForm(prev => ({ ...prev, features: e.target.value }))}
                placeholder="e.g. Window view, Outdoor, Private"
                maxLength={200}
              />
            </div>
            
            <div>
              <Label htmlFor="comments">Comments (Optional)</Label>
              <Textarea
                id="comments"
                value={addTableForm.comments}
                onChange={(e) => setAddTableForm(prev => ({ ...prev, comments: e.target.value }))}
                placeholder="Any additional notes about this table"
                rows={2}
                maxLength={500}
              />
            </div>
            
            <div className="flex justify-end space-x-2 pt-4">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setShowAddTableModal(false)}
                disabled={addTableMutation.isPending}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={addTableMutation.isPending}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {addTableMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Add Table
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

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