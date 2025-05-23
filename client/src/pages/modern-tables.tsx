import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Calendar, Clock, Plus, Settings, MoreVertical, MousePointer2, Edit2, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertTableSchema, type InsertTable } from "@shared/schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

const restaurantId = 1;

export default function ModernTables() {
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedTime, setSelectedTime] = useState("19:00");
  const [contextMenuSlot, setContextMenuSlot] = useState<{table: any, time: string} | null>(null);
  const [showAddTableModal, setShowAddTableModal] = useState(false);
  const [editingTable, setEditingTable] = useState(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch restaurant operating hours
  const { data: restaurant } = useQuery({
    queryKey: ["/api/restaurants/profile"],
  });

  // Generate time slots based on restaurant hours
  const timeSlots = [];
  if (restaurant) {
    const openingTime = restaurant.openingTime || "10:00";
    const closingTime = restaurant.closingTime || "22:00";
    
    const [openHour, openMin] = openingTime.split(':').map(Number);
    const [closeHour, closeMin] = closingTime.split(':').map(Number);
    
    let currentHour = openHour;
    let currentMin = openMin;
    
    while (currentHour < closeHour || (currentHour === closeHour && currentMin < closeMin)) {
      const timeStr = `${currentHour.toString().padStart(2, '0')}:${currentMin.toString().padStart(2, '0')}`;
      timeSlots.push(timeStr);
      
      currentMin += 30;
      if (currentMin >= 60) {
        currentMin = 0;
        currentHour++;
      }
    }
  }

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
    refetchInterval: 3000, // Auto-refresh every 3 seconds for real-time updates
  });

  // Status colors for modern design
  const getStatusStyle = (status: string, hasReservation: boolean) => {
    if (hasReservation) {
      return "bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25";
    }
    
    switch (status) {
      case 'available':
        return "bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-lg shadow-green-500/25";
      case 'occupied':
        return "bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25";
      case 'reserved':
        return "bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/25";
      default:
        return "bg-gradient-to-r from-gray-400 to-gray-500 text-white shadow-lg shadow-gray-400/25";
    }
  };

  const handleContextAction = async (action: string, table: any, time: string) => {
    try {
      switch (action) {
        case 'block':
          // Block table logic
          toast({ title: "Table Blocked", description: `${table.name} blocked for ${time}` });
          break;
        case 'available':
          // Make available logic
          toast({ title: "Table Available", description: `${table.name} set as available for ${time}` });
          break;
        case 'maintenance':
          // Maintenance mode logic
          toast({ title: "Maintenance Mode", description: `${table.name} set to maintenance for ${time}` });
          break;
        case 'reserve':
          // Quick reservation logic
          toast({ title: "Quick Reservation", description: `Creating reservation for ${table.name} at ${time}` });
          break;
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to update table status", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-8">
        {/* Modern Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
              Tables Management
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">Intelligent table scheduling and availability management</p>
          </div>
          <div className="flex gap-3">
            <Dialog open={showAddTableModal} onOpenChange={setShowAddTableModal}>
              <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-500/25 transition-all duration-200">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Table
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Table</DialogTitle>
                </DialogHeader>
                <TableForm 
                  onSubmit={async (data) => {
                    try {
                      console.log('🚀 Creating table with data:', data);
                      console.log('🏢 Restaurant ID:', restaurantId);
                      
                      const response = await fetch('/api/tables', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ ...data, restaurantId })
                      });
                      
                      const responseText = await response.text();
                      console.log('📥 Response:', response.status, responseText);
                      
                      if (!response.ok) {
                        throw new Error(`Failed to create table: ${response.statusText} - ${responseText}`);
                      }
                      
                      setShowAddTableModal(false);
                      queryClient.invalidateQueries({ queryKey: ['/api/tables/availability'] });
                      queryClient.invalidateQueries({ queryKey: ['/api/tables'] });
                      toast({ title: "Table created successfully!" });
                    } catch (error: any) {
                      console.error('❌ Table creation error:', error);
                      toast({ title: "Error creating table", description: error.message, variant: "destructive" });
                    }
                  }}
                />
              </DialogContent>
            </Dialog>
            <Button variant="outline" className="border-gray-300 hover:bg-gray-50 transition-all duration-200">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
          </div>
        </div>

        {/* Sleek Date/Time Selection */}
        <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 rounded-3xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 p-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl shadow-lg">
              <Calendar className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Schedule Overview</h2>
              <p className="text-gray-500 dark:text-gray-400">Select date and time to view availability</p>
            </div>
          </div>
          
          {/* Quick Date Shortcuts */}
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <div className="flex gap-2">
              {[
                { label: "Today", value: format(new Date(), 'yyyy-MM-dd') },
                { label: "Tomorrow", value: format(addDays(new Date(), 1), 'yyyy-MM-dd') },
                { label: "This Weekend", value: format(addDays(new Date(), 6 - new Date().getDay()), 'yyyy-MM-dd') }
              ].map((option) => (
                <Button
                  key={option.label}
                  variant={selectedDate === option.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedDate(option.value)}
                  className="rounded-full px-6 py-2 text-sm font-medium transition-all duration-300 hover:scale-105 shadow-sm"
                >
                  {option.label}
                </Button>
              ))}
            </div>
            
            {/* Elegant Date Selector */}
            <div className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-2xl px-4 py-3 shadow-lg border border-gray-200/50 dark:border-gray-700/50 hover:shadow-xl transition-all duration-300">
              <Calendar className="h-5 w-5 text-gray-400" />
              <Select value={selectedDate} onValueChange={setSelectedDate}>
                <SelectTrigger className="border-0 shadow-none focus:ring-0 w-48 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-2xl shadow-2xl border-0 bg-white dark:bg-gray-800 p-2">
                  {Array.from({ length: 30 }, (_, i) => {
                    const date = addDays(new Date(), i);
                    const dateValue = format(date, 'yyyy-MM-dd');
                    let label;
                    
                    if (i === 0) {
                      label = `Today, ${format(date, 'MMM dd')}`;
                    } else if (i === 1) {
                      label = `Tomorrow, ${format(date, 'MMM dd')}`;
                    } else {
                      label = format(date, 'EEE, MMM dd');
                    }
                    
                    return (
                      <SelectItem key={dateValue} value={dateValue} className="rounded-xl hover:bg-gradient-to-r hover:from-blue-50 hover:to-purple-50 dark:hover:from-blue-900/20 dark:hover:to-purple-900/20 transition-all duration-200">
                        {label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Beautiful Schedule Grid */}
        <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 rounded-3xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
          <div className="p-6 border-b border-gray-200/50 dark:border-gray-700/50">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">
              Restaurant Schedule - {format(new Date(selectedDate), 'EEEE, MMMM d, yyyy')}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mt-1">Real-time availability across all tables</p>
          </div>
          
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              {/* Sticky Header */}
              <div className="sticky top-0 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-750 border-b border-gray-200/50 dark:border-gray-700/50 px-6 py-4">
                <div className="grid grid-cols-[120px_1fr] gap-6">
                  <div className="font-semibold text-gray-700 dark:text-gray-300 text-sm">TIME</div>
                  <div className="grid grid-cols-3 gap-4">
                    {scheduleData?.[0]?.tables?.map((table: any) => (
                      <div key={table.id} className="text-center">
                        <div className="font-semibold text-gray-900 dark:text-white text-sm">{table.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          ({table.minGuests}-{table.maxGuests} guests)
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Schedule Rows with Zebra Striping - More Compact */}
              <div className="divide-y divide-gray-200/30 dark:divide-gray-700/30">
                {scheduleData?.map((slot: any, rowIndex: number) => (
                  <div key={slot.time} className={`px-6 py-2 transition-all duration-200 hover:bg-gradient-to-r hover:from-blue-50/30 hover:to-purple-50/30 dark:hover:from-blue-900/10 dark:hover:to-purple-900/10 ${rowIndex % 2 === 0 ? 'bg-gray-50/30 dark:bg-gray-800/30' : 'bg-white dark:bg-gray-900'}`}>
                    <div className="grid grid-cols-[120px_1fr] gap-6 items-center">
                      <div className="font-medium text-gray-900 dark:text-white text-sm">
                        {format(new Date(`2000-01-01T${slot.time}`), 'h:mm a')}
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        {slot.tables?.map((table: any) => {
                          const hasReservation = table.reservation;
                          return (
                            <ContextMenu key={table.id}>
                              <ContextMenuTrigger>
                                <div
                                  className={`
                                    relative cursor-pointer rounded-xl p-3 text-center text-sm font-medium transition-all duration-300 hover:scale-105 hover:shadow-xl
                                    ${getStatusStyle(table.status, hasReservation)}
                                  `}
                                >
                                  {hasReservation ? (
                                    <div>
                                      <div className="font-semibold text-sm">Reserved</div>
                                      <div className="text-xs opacity-90 mt-0.5">
                                        {table.reservation.guestName}
                                      </div>
                                      <div className="text-xs opacity-75">
                                        {table.reservation.guestCount} guests
                                      </div>
                                    </div>
                                  ) : (
                                    <div>
                                      <div className="font-semibold text-sm">Available</div>
                                      <div className="text-xs opacity-90 mt-0.5">Ready to book</div>
                                    </div>
                                  )}
                                  
                                  {/* Hover indicator */}
                                  <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <MoreVertical className="h-3 w-3" />
                                  </div>
                                </div>
                              </ContextMenuTrigger>
                              <ContextMenuContent className="rounded-xl shadow-2xl border-0 bg-white dark:bg-gray-800 p-2">
                                <ContextMenuItem 
                                  onClick={() => handleContextAction('reserve', table, slot.time)}
                                  className="rounded-lg hover:bg-gradient-to-r hover:from-green-50 hover:to-emerald-50 dark:hover:from-green-900/20 dark:hover:to-emerald-900/20"
                                >
                                  Create Reservation
                                </ContextMenuItem>
                                <ContextMenuItem 
                                  onClick={() => handleContextAction('block', table, slot.time)}
                                  className="rounded-lg hover:bg-gradient-to-r hover:from-red-50 hover:to-pink-50 dark:hover:from-red-900/20 dark:hover:to-pink-900/20"
                                >
                                  Block Table
                                </ContextMenuItem>
                                <ContextMenuItem 
                                  onClick={() => handleContextAction('available', table, slot.time)}
                                  className="rounded-lg hover:bg-gradient-to-r hover:from-blue-50 hover:to-cyan-50 dark:hover:from-blue-900/20 dark:hover:to-cyan-900/20"
                                >
                                  Make Available
                                </ContextMenuItem>
                                <ContextMenuItem 
                                  onClick={() => handleContextAction('maintenance', table, slot.time)}
                                  className="rounded-lg hover:bg-gradient-to-r hover:from-amber-50 hover:to-yellow-50 dark:hover:from-amber-900/20 dark:hover:to-yellow-900/20"
                                >
                                  Mark as Maintenance
                                </ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Helpful Info Card */}
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-2xl p-6 border border-blue-200/50 dark:border-blue-700/50">
          <div className="flex items-center gap-3">
            <MousePointer2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <div>
              <h4 className="font-semibold text-blue-900 dark:text-blue-100">Quick Actions</h4>
              <p className="text-blue-700 dark:text-blue-300 text-sm">Right-click any time slot to create reservations, block tables, or set maintenance mode</p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

// Table Form Component for Add/Edit  
function TableForm({ table, onSubmit }: { table?: any, onSubmit: (data: any) => Promise<void> }) {
  const form = useForm<InsertTable>({
    resolver: zodResolver(insertTableSchema),
    defaultValues: {
      name: table?.name || "",
      minGuests: table?.minGuests || 2,
      maxGuests: table?.maxGuests || 4,
      comments: table?.comments || "",
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => {
        console.log('🔥 Form submitted with data:', data);
        console.log('📋 Form errors:', form.formState.errors);
        onSubmit(data);
      }, (errors) => {
        console.error('❌ Form validation errors:', errors);
      })} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Table Name</FormLabel>
              <FormControl>
                <Input placeholder="Table 1" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="minGuests"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Min Guests</FormLabel>
                <FormControl>
                  <Input 
                    type="number" 
                    {...field} 
                    onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="maxGuests"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Max Guests</FormLabel>
                <FormControl>
                  <Input 
                    type="number" 
                    {...field} 
                    onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="comments"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Comments</FormLabel>
              <FormControl>
                <Input placeholder="Window section, Patio, etc." {...field} value={field.value || ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-4">
          <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
            {table ? "Update Table" : "Create Table"}
          </Button>
        </div>
      </form>
    </Form>
  );
}