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
import {
    getRestaurantDateTime,
    getRestaurantDateString
} from "@/lib/utils";

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

// ✅ NEW: Add Table Form Interface
interface AddTableForm {
  name: string;
  minGuests: number;
  maxGuests: number;
  features: string;
  comments: string;
}

// ✅ FIXED: Add timezone prop with Moscow default for backward compatibility
interface ModernTablesProps {
  restaurantTimezone?: string;
}

export default function ModernTables({ 
  restaurantTimezone = 'Europe/Moscow' 
}: ModernTablesProps) {
  // ✅ FIXED: Use restaurant timezone instead of hardcoded Moscow
  const getRestaurantDate = () => {
    return getRestaurantDateTime(restaurantTimezone).toJSDate();
  };

  const getRestaurantDateStr = () => {
    return getRestaurantDateString(restaurantTimezone);
  };

  const getTomorrowDateStr = () => {
    return getRestaurantDateTime(restaurantTimezone).plus({ days: 1 }).toISODate() || '';
  };

  // ✅ FIXED: Initialize with restaurant timezone date
  const [selectedDate, setSelectedDate] = useState(getRestaurantDateStr());
  const [selectedTime, setSelectedTime] = useState("19:00");
  const [activeView, setActiveView] = useState<"schedule" | "floorplan" | "grid" | "list">("schedule");
  
  // ✅ NEW: Add Table Modal State
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

  // Enhanced drag & drop state
  const [draggedReservation, setDraggedReservation] = useState<{
    reservationId: number;
    guestName: string;
    guestCount: number;
    currentTableId: number;
    currentTableName: string;
    currentTime: string;
    phone?: string;
  } | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [dragOverSlot, setDragOverSlot] = useState<{tableId: number; time: string} | null>(null);
  const [isValidDropZone, setIsValidDropZone] = useState(false);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ✅ FIXED: Add timezone to query key for proper cache invalidation
  const { data: restaurant, isLoading: restaurantLoading } = useQuery<{
    openingTime: string;
    closingTime: string;
    avgReservationDuration: number;
    timezone: string;
    [key: string]: any;
  }>({
    queryKey: ["/api/restaurants/profile", restaurantTimezone],
  });

  // Generate time slots based on restaurant hours
  const timeSlots: string[] = [];
  if (restaurant && restaurant.openingTime && restaurant.closingTime) {
    const openingTime = restaurant.openingTime;
    const closingTime = restaurant.closingTime;
    const avgDuration = restaurant.avgReservationDuration || 120; // ✅ FIX: Default to 120 minutes
    
    const [openHour] = openingTime.split(':').map(Number);
    const [closeHour] = closingTime.split(':').map(Number);
    
    const lastBookingHour = closeHour - 1;
    
    for (let hour = openHour; hour <= lastBookingHour; hour++) {
      timeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
    }
  }

  // ✅ FIXED: Add timezone to query key
  const { data: tables, isLoading: tablesLoading } = useQuery({
    queryKey: ["/api/tables", restaurantTimezone],
  });

  // ✅ FIXED: Include timezone parameter in API calls and query key
  const { data: scheduleData, isLoading } = useQuery({
    queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone],
    queryFn: async () => {
      const promises = timeSlots.map(async (time) => {
        const response = await fetch(
          `/api/tables/availability?date=${selectedDate}&time=${time}&timezone=${encodeURIComponent(restaurantTimezone)}`, 
          {
            credentials: 'include'
          }
        );
        
        if (!response.ok) {
          console.error(`❌ Failed to fetch availability for ${time}:`, response.status, response.statusText);
          throw new Error(`Failed to fetch availability: ${response.status}`);
        }
        
        const data = await response.json();
        const sortedTables = data.sort((a: any, b: any) => a.id - b.id);
        return { time, tables: sortedTables };
      });
      
      const results = await Promise.all(promises);
      return results;
    },
    enabled: !!restaurant && timeSlots.length > 0,
    refetchInterval: 180000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // ✅ FIXED: Update query invalidation to include timezone
  const addTableMutation = useMutation({
    mutationFn: async (tableData: AddTableForm) => {
      const payload = {
        name: tableData.name,
        minGuests: tableData.minGuests,
        maxGuests: tableData.maxGuests,
        features: tableData.features ? tableData.features.split(',').map(f => f.trim()) : [],
        comments: tableData.comments,
        status: 'free'
      };
      
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
        title: "Table Added",
        description: `Table ${newTable.name} (${newTable.minGuests}-${newTable.maxGuests} guests) added successfully`,
      });
      
      // ✅ FIXED: Invalidate queries with timezone context
      queryClient.invalidateQueries({ queryKey: ["/api/tables", restaurantTimezone] });
      queryClient.invalidateQueries({ queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone] });
      queryClient.invalidateQueries({ queryKey: ["/api/restaurants/profile", restaurantTimezone] });
      
      // Reset form and close modal
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
      toast({
        title: "Failed to Add Table",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    }
  });

  // ✅ FIXED: Update query invalidation to include timezone
  const deleteTableMutation = useMutation({
    mutationFn: async (tableId: number) => {
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
      
      // ✅ FIXED: Invalidate queries with timezone context
      queryClient.invalidateQueries({ queryKey: ["/api/tables", restaurantTimezone] });
      queryClient.invalidateQueries({ queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Delete Table",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    }
  });

  // ✅ FIXED: Include timezone parameter and update query invalidation
  const moveReservationMutation = useMutation({
    mutationFn: async ({ reservationId, newTableId, newTime }: {
      reservationId: number;
      newTableId: number;
      newTime: string;
    }) => {
      const response = await fetch(`/api/reservations/${reservationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          tableId: newTableId,
          time: newTime,
          date: selectedDate,
          timezone: restaurantTimezone // ✅ FIXED: Include timezone
        })
      });
      
      if (!response.ok) throw new Error('Failed to move reservation');
      return response.json();
    },
    
    // ✅ FIXED: Update optimistic cache with timezone context
    onMutate: async ({ reservationId, newTableId, newTime }) => {
      await queryClient.cancelQueries({ 
        queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone] 
      });

      const previousData = queryClient.getQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone]);
      const duration = 2; // hours

      queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone], (old: any) => {
        if (!old || !draggedReservation) return old;
        
        const sourceHour = parseInt(draggedReservation.currentTime.split(':')[0]);
        const targetHour = parseInt(newTime.split(':')[0]);
        
        const sourceSlots = [];
        const targetSlots = [];
        
        for (let i = 0; i < duration; i++) {
          sourceSlots.push(`${(sourceHour + i).toString().padStart(2, '0')}:00`);
          targetSlots.push(`${(targetHour + i).toString().padStart(2, '0')}:00`);
        }
        
        return old.map((slot: any) => ({
          ...slot,
          tables: slot.tables.map((table: any) => {
            if (table.id === draggedReservation.currentTableId && 
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
                  id: reservationId,
                  guestName: draggedReservation.guestName,
                  guestCount: draggedReservation.guestCount,
                  timeSlot: `${slot.time}-${targetSlots[targetSlots.length - 1].replace(':00', ':00')}`,
                  phone: draggedReservation.phone || '',
                  status: 'confirmed'
                }
              };
            }
            
            return table;
          })
        }));
      });

      return { previousData };
    },

    onSuccess: (data: any, { newTableId, newTime }: { newTableId: number; newTime: string }) => {
      const oldTableName = draggedReservation?.currentTableName || `Table ${draggedReservation?.currentTableId}`;
      const newTableName = scheduleData?.find(slot => slot.time === newTime)
        ?.tables?.find(t => t.id === newTableId)?.name || `Table ${newTableId}`;

      toast({
        title: "Reservation Updated",
        description: `${draggedReservation?.guestName}'s reservation moved from ${draggedReservation?.currentTime} (${oldTableName}) to ${newTime} (${newTableName})`,
      });
      
      setDraggedReservation(null);
      setDragOverSlot(null);
      
      // ✅ FIXED: Invalidate with timezone context
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
      
      setDraggedReservation(null);
      setDragOverSlot(null);
    }
  });

  // ✅ FIXED: Include timezone and update cache invalidation
  const cancelReservationMutation = useMutation({
    mutationFn: async (reservationId: number) => {
      const response = await fetch(`/api/reservations/${reservationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          status: 'canceled',
          timezone: restaurantTimezone // ✅ FIXED: Include timezone
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

  // ✅ FIXED: Include timezone parameter and update cache operations
  const quickMoveMutation = useMutation({
    mutationFn: async ({ reservationId, direction }: { reservationId: number; direction: 'up' | 'down' }) => {
      const currentSlot = scheduleData?.find(slot => 
        slot.tables.some(t => t.reservation?.id === reservationId)
      );
      const currentTable = currentSlot?.tables.find(t => t.reservation?.id === reservationId);
      
      if (!currentSlot || !currentTable) throw new Error('Reservation not found');
      
      const currentHour = parseInt(currentSlot.time.split(':')[0]);
      const newHour = direction === 'up' ? currentHour - 1 : currentHour + 1;
      const newTime = `${newHour.toString().padStart(2, '0')}:00`;
      
      const targetSlots = [
        newTime,
        `${(newHour + 1).toString().padStart(2, '0')}:00`
      ];
      
      for (const targetTime of targetSlots) {
        const targetSlot = scheduleData?.find(s => s.time === targetTime);
        const targetTable = targetSlot?.tables?.find(t => t.id === currentTable.id);
        
        if (targetTable?.reservation && targetTable.reservation.id !== reservationId) {
          throw new Error(`Cannot move: ${targetTable.reservation.guestName} already has ${targetTime} reserved`);
        }
      }
      
      if (newHour < 10 || newHour > 22) {
        throw new Error('Cannot move outside business hours (10:00 - 22:00)');
      }
      
      const response = await fetch(`/api/reservations/${reservationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          tableId: currentTable.id,
          time: newTime,
          date: selectedDate,
          timezone: restaurantTimezone // ✅ FIXED: Include timezone
        }),
      });
      if (!response.ok) throw new Error('Failed to move reservation');
      return { response: response.json(), newTime, currentTable };
    },
    
    onMutate: async ({ reservationId, direction }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone] });
      
      const previousData = queryClient.getQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone]);
      
      const currentSlot = scheduleData?.find(slot => 
        slot.tables.some(t => t.reservation?.id === reservationId)
      );
      const currentTable = currentSlot?.tables.find(t => t.reservation?.id === reservationId);
      
      if (!currentSlot || !currentTable || !currentTable.reservation) return { previousData };
      
      const currentHour = parseInt(currentSlot.time.split(':')[0]);
      const targetHour = direction === 'up' ? currentHour - 1 : currentHour + 1;
      const targetTime = `${targetHour.toString().padStart(2, '0')}:00`;
      
      const duration = 2;
      
      queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone], (old: any) => {
        if (!old) return old;
        
        const sourceSlots = [];
        const targetSlots = [];
        
        for (let i = 0; i < duration; i++) {
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
                  timeSlot: `${targetSlots[0]}-${targetSlots[targetSlots.length - 1].replace(':00', ':00')}`
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
        description: "Could not move reservation. Check for conflicts.",
        variant: "destructive",
      });
    },
  });

  // Enhanced Drag & Drop Event Handlers (unchanged - already working)
  const handleDragStart = (
    e: React.DragEvent,
    reservation: {
      id: number;
      guestName: string;
      guestCount: number;
    },
    table: TableData,
    time: string
  ) => {
    setDraggedReservation({
      reservationId: reservation.id,
      guestName: reservation.guestName,
      guestCount: reservation.guestCount,
      currentTableId: table.id,
      currentTableName: table.name,
      currentTime: time
    });
    
    e.dataTransfer.effectAllowed = 'move';
  };

  const checkReservationConflict = (targetTableId: number, targetTime: string, duration: number = 2): boolean => {
    if (!scheduleData || !draggedReservation) return false;
    
    const targetHour = parseInt(targetTime.split(':')[0]);
    
    for (let i = 0; i < duration; i++) {
      const hour = (targetHour + i).toString().padStart(2, '0');
      const timeSlot = `${hour}:00`;
      
      const slot = scheduleData.find(s => s.time === timeSlot);
      const table = slot?.tables?.find(t => t.id === targetTableId);
      
      if (table?.reservation && table.reservation.id !== draggedReservation.reservationId) {
        return true;
      }
    }
    
    return false;
  };

  const isMovingWithinSameReservation = (targetTableId: number, targetTime: string): boolean => {
    if (!scheduleData || !draggedReservation) return false;
    
    return draggedReservation.currentTableId === targetTableId && 
           draggedReservation.currentTime === targetTime;
  };

  const handleDragOver = (e: React.DragEvent, tableId: number, time: string) => {
    e.preventDefault();
    
    setDragOverSlot({ tableId, time });
    
    if (isMovingWithinSameReservation(tableId, time)) {
      setIsValidDropZone(false);
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    
    const hasConflict = checkReservationConflict(tableId, time, 2);
    const targetSlot = scheduleData?.find(slot => slot.time === time)?.tables?.find(t => t.id === tableId);
    const hasExistingReservation = targetSlot?.reservation && 
      targetSlot.reservation.id !== draggedReservation?.reservationId;
    
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

    if (draggedReservation.currentTableId === tableId && draggedReservation.currentTime === time) {
      setDraggedReservation(null);
      setDragOverSlot(null);
      return;
    }

    if (!isValidDropZone) {
      setDraggedReservation(null);
      setDragOverSlot(null);
      return;
    }

    moveReservationMutation.mutate({
      reservationId: draggedReservation.reservationId,
      newTableId: tableId,
      newTime: time
    });
  };

  // Status colors for modern design (unchanged)
  const getStatusStyle = (status: string, hasReservation: boolean, isDragTarget = false) => {
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

  // ✅ NEW: Handle Add Table Form Submission
  const handleAddTable = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!addTableForm.name || addTableForm.minGuests < 1 || addTableForm.maxGuests < addTableForm.minGuests) {
      toast({
        title: "Invalid Table Data",
        description: "Please check all fields and ensure max guests >= min guests",
        variant: "destructive",
      });
      return;
    }
    
    addTableMutation.mutate(addTableForm);
  };

  // ✅ FIXED: Format current date display using restaurant timezone
  const formatCurrentDate = () => {
    try {
      const restaurantDateTime = getRestaurantDateTime(restaurantTimezone);
      return restaurantDateTime.toFormat('EEEE, MMMM d, yyyy');
    } catch (error) {
      // Fallback to basic formatting if timezone parsing fails
      return new Date(selectedDate).toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
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
                {/* ✅ NEW: Add Table Button */}
                <Button 
                  onClick={() => setShowAddTableModal(true)}
                  className="bg-green-600 hover:bg-green-700 text-white"
                  size="sm"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Table
                </Button>
                {/* ✅ FIXED: Use restaurant timezone for Today/Tomorrow buttons */}
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setSelectedDate(getRestaurantDateStr())}
                  className="text-xs"
                >
                  Today
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setSelectedDate(getTomorrowDateStr())}
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

        {/* ✅ NEW: Table Statistics */}
        {tables && tables.length > 0 && (
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
        )}

        {/* Beautiful Schedule Grid */}
        <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 rounded-3xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
          <div className="p-6 border-b border-gray-200/50 dark:border-gray-700/50">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  {/* ✅ FIXED: Use restaurant timezone for date display */}
                  Restaurant Management - {formatCurrentDate()}
                </h3>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                  Real-time availability across all tables • Auto-refreshes every 30 seconds
                  {/* ✅ NEW: Show current timezone info */}
                  {restaurantTimezone !== 'Europe/Moscow' && (
                    <span className="ml-2 text-blue-600">
                      • {restaurantTimezone}
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
                    Hourly slots
                  </Badge>
                )}
              </div>
            </div>
          </div>

        {/* Schedule View Content */}
        <div className="p-6">
          {activeView === 'schedule' && (
            <>
              {scheduleData && scheduleData.length > 0 ? (
                <div className="overflow-x-auto">
                  <div className="min-w-[800px]">
                    {/* Sticky Header */}
                    <div className="sticky top-0 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-750 border-b border-gray-200/50 dark:border-gray-700/50 px-4 py-2 z-10 rounded-lg mb-4">
                      <div className="flex">
                        <div className="w-20 flex-shrink-0 font-semibold text-gray-700 dark:text-gray-300 text-xs py-2">TIME</div>
                        <div className="flex overflow-x-auto gap-1 flex-1">
                          {scheduleData[0]?.tables?.map((table: TableData) => (
                            <div key={table.id} className="w-24 flex-shrink-0 text-center bg-white/50 dark:bg-gray-700/50 rounded-lg p-1.5 border border-gray-200/50 dark:border-gray-600/50 relative group">
                              <div className="font-medium text-xs text-gray-900 dark:text-gray-100">{table.name}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1">
                                <Users className="h-3 w-3" />
                                {table.minGuests}-{table.maxGuests}
                              </div>
                              {/* ✅ NEW: Delete button on hover */}
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
                                  draggable={hasReservation}
                                  onDragStart={(e) => hasReservation && table.reservation && handleDragStart(
                                    e,
                                    {
                                      id: table.reservation.id || 0,
                                      guestName: table.reservation.guestName,
                                      guestCount: table.reservation.guestCount
                                    },
                                    table,
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
              ) : (
                <div className="text-center py-12">
                  <p className="text-gray-500 dark:text-gray-400 mb-4">
                    No tables found. Add tables to start managing reservations.
                  </p>
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

      {/* ✅ NEW: Add Table Modal */}
      <Dialog open={showAddTableModal} onOpenChange={setShowAddTableModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Table</DialogTitle>
            <DialogDescription>
              Create a new table for your restaurant. You can edit these details later.
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleAddTable} className="space-y-4">
            <div>
              <Label htmlFor="tableName">Table Name</Label>
              <Input
                id="tableName"
                value={addTableForm.name}
                onChange={(e) => setAddTableForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Table 1, Corner Table, Patio A"
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="minGuests">Min Guests</Label>
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
                <Label htmlFor="maxGuests">Max Guests</Label>
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
              />
            </div>
            
            <div className="flex justify-end space-x-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowAddTableModal(false)}>
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