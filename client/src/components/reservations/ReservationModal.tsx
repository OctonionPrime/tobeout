import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { CalendarIcon, Clock, Users, Phone, Mail, User, Loader2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  reservationId?: number;
  restaurantId: number;
  defaultDate?: Date;
  defaultTime?: string;
  defaultGuests?: number;
  defaultTableId?: number;
}

interface TimeSlot {
  time: string;
  timeDisplay: string;
  available: boolean;
  tableName: string;
  tableCapacity: number;
  canAccommodate: boolean;
  message?: string;
}

interface Table {
  id: number;
  name: string;
  minGuests: number;
  maxGuests: number;
  status: string;
}

export function ReservationModal({
  isOpen,
  onClose,
  reservationId,
  restaurantId,
  defaultDate,
  defaultTime,
  defaultGuests,
  defaultTableId,
}: ReservationModalProps) {
  const [formData, setFormData] = useState({
    guestName: "",
    guestPhone: "",
    guestEmail: "",
    date: defaultDate || new Date(),
    time: defaultTime || "",
    guests: defaultGuests || 2,
    tableId: defaultTableId || null as number | null,
    comments: "",
    source: "manual",
  });

  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [availableTimeSlots, setAvailableTimeSlots] = useState<TimeSlot[]>([]);
  const [showAllTimes, setShowAllTimes] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ✅ FIX: Get restaurant data for operating hours and timezone
  const { data: restaurant } = useQuery({
    queryKey: ["/api/restaurants/profile"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/restaurants/profile");
      if (!response.ok) throw new Error("Failed to fetch restaurant");
      return response.json();
    },
    enabled: isOpen,
  });

  // Fetch tables for capacity information
  const { data: tables, error: tablesError } = useQuery({
    queryKey: ["/api/tables"],
    queryFn: async () => {
      try {
        const response = await apiRequest("GET", "/api/tables");
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      } catch (error) {
        console.error("Error fetching tables:", error);
        throw error;
      }
    },
    retry: 1,
    enabled: isOpen, // Only fetch when modal is open
  });

  // Handle tables API error
  useEffect(() => {
    if (tablesError) {
      console.error("Tables fetch error:", tablesError);
      toast({
        title: "Error",
        description: "Failed to load table information",
        variant: "destructive",
      });
    }
  }, [tablesError, toast]);

  // ✅ FIX: Dynamic capacity calculation based on actual tables
  const maxCapacity = tables?.length > 0 
    ? tables.reduce((max: number, table: Table) => Math.max(max, table.maxGuests), 0)
    : 0; // Show 0 if no tables exist

  // ✅ FIX: Show warning if no tables exist
  const hasNoTables = !tables || tables.length === 0;

  // Update selected table when tableId changes
  useEffect(() => {
    if (tables && formData.tableId) {
      const table = tables.find((t: Table) => t.id === formData.tableId);
      setSelectedTable(table || null);
    }
  }, [tables, formData.tableId]);

  // Fetch existing reservation data if editing
  const { data: existingReservation, error: reservationError } = useQuery({
    queryKey: [`/api/reservations/${reservationId}`],
    queryFn: async () => {
      try {
        const response = await apiRequest("GET", `/api/reservations/${reservationId}`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      } catch (error) {
        console.error("Error fetching reservation:", error);
        throw error;
      }
    },
    enabled: !!reservationId && isOpen,
    retry: 1,
  });

  // Handle reservation fetch error
  useEffect(() => {
    if (reservationError) {
      console.error("Reservation fetch error:", reservationError);
      toast({
        title: "Error",
        description: "Failed to load reservation data",
        variant: "destructive",
      });
    }
  }, [reservationError, toast]);

  // Populate form with existing reservation data
  useEffect(() => {
    if (existingReservation) {
      try {
        const reservation = existingReservation.reservation || existingReservation;
        const guest = existingReservation.guest || {};
        
        setFormData({
          guestName: reservation.booking_guest_name || guest.name || "",
          guestPhone: guest.phone || "",
          guestEmail: guest.email || "",
          date: new Date(reservation.date),
          time: reservation.time,
          guests: reservation.guests,
          tableId: reservation.tableId,
          comments: reservation.comments || "",
          source: reservation.source || "manual",
        });
      } catch (error) {
        console.error("Error processing reservation data:", error);
        toast({
          title: "Error",
          description: "Failed to process reservation data",
          variant: "destructive",
        });
      }
    }
  }, [existingReservation, toast]);

  // ✅ FIX: Enhanced time filtering logic
  const getCurrentMoscowTime = () => {
    const moscowTime = new Date().toLocaleString("en-US", { timeZone: "Europe/Moscow" });
    return new Date(moscowTime);
  };

  const isTimeSlotAvailable = (timeSlot: TimeSlot): boolean => {
    if (!timeSlot.available) return false;

    const selectedDate = format(formData.date, "yyyy-MM-dd");
    const today = format(getCurrentMoscowTime(), "yyyy-MM-dd");
    
    // If selected date is in the future, all available slots are valid
    if (selectedDate > today) return true;
    
    // If selected date is today, filter out past times
    if (selectedDate === today) {
      const moscowNow = getCurrentMoscowTime();
      const currentHour = moscowNow.getHours();
      const currentMinute = moscowNow.getMinutes();
      
      const [slotHour, slotMinute] = timeSlot.time.split(':').map(Number);
      const slotTime = slotHour * 60 + slotMinute;
      const currentTime = currentHour * 60 + currentMinute;
      
      // Add 30-minute buffer for preparation time
      return slotTime > (currentTime + 30);
    }
    
    // Past dates should not show any available slots
    return false;
  };

  // Fetch available time slots when date or guest count changes
  useEffect(() => {
    if (formData.date && formData.guests && isOpen && !hasNoTables) {
      fetchAvailableTimeSlots();
    }
  }, [formData.date, formData.guests, isOpen, hasNoTables]);

  const fetchAvailableTimeSlots = async () => {
    setIsLoadingAvailability(true);
    try {
      const dateStr = format(formData.date, "yyyy-MM-dd");
      const response = await apiRequest(
        "GET",
        `/api/booking/available-times?restaurantId=${restaurantId}&date=${dateStr}&guests=${formData.guests}`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // ✅ FIX: Filter out past times for today
      const filteredSlots = (data.availableSlots || []).filter(isTimeSlotAvailable);
      
      setAvailableTimeSlots(filteredSlots);
    } catch (error) {
      console.error("Error fetching available times:", error);
      toast({
        title: "Error",
        description: "Failed to fetch available time slots",
        variant: "destructive",
      });
      setAvailableTimeSlots([]); // Reset to empty array on error
    } finally {
      setIsLoadingAvailability(false);
    }
  };

  // Create or update reservation
  const reservationMutation = useMutation({
    mutationFn: async (data: any) => {
      try {
        let response;
        if (reservationId) {
          response = await apiRequest("PATCH", `/api/reservations/${reservationId}`, data);
        } else {
          response = await apiRequest("POST", "/api/reservations", data);
        }
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return response.json();
      } catch (error) {
        console.error("Error saving reservation:", error);
        throw error;
      }
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: reservationId ? "Reservation updated successfully" : "Reservation created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/upcoming"] });
      onClose();
    },
    onError: (error: any) => {
      console.error("Reservation mutation error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save reservation",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      // ✅ FIX: Dynamic validation based on actual table capacity
      if (hasNoTables) {
        toast({
          title: "No tables available",
          description: "Please add tables to the restaurant before creating reservations",
          variant: "destructive",
        });
        return;
      }

      if (formData.guests < 1 || (maxCapacity > 0 && formData.guests > maxCapacity)) {
        toast({
          title: "Invalid guest count",
          description: maxCapacity > 0 
            ? `Please enter a number between 1 and ${maxCapacity}`
            : "No table capacity available",
          variant: "destructive",
        });
        return;
      }

      // Check if selected table can accommodate guests
      if (selectedTable) {
        if (formData.guests < selectedTable.minGuests || formData.guests > selectedTable.maxGuests) {
          toast({
            title: "Table capacity exceeded",
            description: `This table can only accommodate ${selectedTable.minGuests}-${selectedTable.maxGuests} guests`,
            variant: "destructive",
          });
          return;
        }
      }

      const submitData = {
        ...formData,
        restaurantId,
        date: format(formData.date, "yyyy-MM-dd"),
      };

      reservationMutation.mutate(submitData);
    } catch (error) {
      console.error("Error in handleSubmit:", error);
      toast({
        title: "Error",
        description: "Failed to process form submission",
        variant: "destructive",
      });
    }
  };

  // Group time slots by availability
  const availableSlots = availableTimeSlots.filter(slot => slot.available);
  const unavailableSlots = availableTimeSlots.filter(slot => !slot.available);
  const displayedAvailableSlots = showAllTimes ? availableSlots : availableSlots.slice(0, 6);

  // Don't render if not open (prevents unnecessary API calls)
  if (!isOpen) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {reservationId ? "Edit Reservation" : "Create New Reservation"}
          </DialogTitle>
          <DialogDescription>
            Fill in the details to {reservationId ? "update the" : "create a new"} reservation. Smart table assignment will find the best available table.
          </DialogDescription>
        </DialogHeader>

        {/* ✅ NEW: Show warning if no tables exist */}
        {hasNoTables && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No tables found. Please add tables to your restaurant before creating reservations.
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Guest Information */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <User className="h-5 w-5" />
              Guest Information
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="guestName">Guest Name</Label>
                <Input
                  id="guestName"
                  value={formData.guestName}
                  onChange={(e) => setFormData({ ...formData, guestName: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label htmlFor="guestPhone">Phone Number</Label>
                <Input
                  id="guestPhone"
                  type="tel"
                  value={formData.guestPhone}
                  onChange={(e) => setFormData({ ...formData, guestPhone: e.target.value })}
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="guestEmail">Email (Optional)</Label>
              <Input
                id="guestEmail"
                type="email"
                value={formData.guestEmail}
                onChange={(e) => setFormData({ ...formData, guestEmail: e.target.value })}
              />
            </div>
          </div>

          {/* Reservation Details */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Clock className="h-5 w-5" />
              Reservation Details
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !formData.date && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formData.date ? format(formData.date, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formData.date}
                      onSelect={(date) => date && setFormData({ ...formData, date })}
                      initialFocus
                      disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div>
                <Label htmlFor="guests">Number of Guests</Label>
                <div className="relative">
                  <Input
                    id="guests"
                    type="number"
                    min="1"
                    max={maxCapacity || 50}
                    value={formData.guests}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      // Allow empty input during typing
                      if (isNaN(value)) {
                        setFormData({ ...formData, guests: 1 });
                      } else if (value >= 1 && value <= (maxCapacity || 50)) {
                        setFormData({ ...formData, guests: value });
                      }
                    }}
                    required
                    disabled={hasNoTables}
                  />
                  <Users className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                </div>
                {selectedTable && (
                  <p className="text-sm text-gray-500 mt-1">
                    Selected table capacity: {selectedTable.minGuests}-{selectedTable.maxGuests} guests
                  </p>
                )}
                {!selectedTable && (
                  <p className="text-sm text-gray-500 mt-1">
                    {hasNoTables 
                      ? "No tables available - please add tables first" 
                      : `Maximum capacity: ${maxCapacity} guests`
                    }
                  </p>
                )}
              </div>
            </div>

            {/* Time Selection */}
            <div>
              <Label>Time</Label>
              {hasNoTables ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    No tables available. Please add tables to your restaurant first.
                  </AlertDescription>
                </Alert>
              ) : isLoadingAvailability ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <div className="space-y-4">
                  {availableSlots.length > 0 ? (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {displayedAvailableSlots.map((slot) => (
                          <div key={slot.time} className="space-y-1">
                            <Button
                              type="button"
                              variant={formData.time === slot.time ? "default" : "outline"}
                              size="sm"
                              onClick={() => setFormData({ ...formData, time: slot.time })}
                              className="w-full justify-between"
                            >
                              <span>{slot.timeDisplay}</span>
                              <Badge variant="secondary" className="ml-2 text-xs">
                                Available
                              </Badge>
                            </Button>
                            {slot.tableName && (
                              <div className="text-xs text-gray-500 px-1">
                                {slot.tableName} (seats up to {slot.tableCapacity})
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      
                      {!showAllTimes && availableSlots.length > 6 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowAllTimes(true)}
                          className="w-full"
                        >
                          Show {availableSlots.length - 6} more available times
                        </Button>
                      )}
                    </>
                  ) : (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        No available time slots for {formData.guests} guests on this date.
                        {format(formData.date, "yyyy-MM-dd") === format(getCurrentMoscowTime(), "yyyy-MM-dd") 
                          ? " Try selecting a future date or earlier time." 
                          : " Try selecting a different date or reducing the party size."
                        }
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Show unavailable slots for reference */}
                  {unavailableSlots.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm text-gray-500">Unavailable times:</p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 opacity-50">
                        {unavailableSlots.slice(0, 6).map((slot) => (
                          <Button
                            key={slot.time}
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled
                            className="justify-between"
                          >
                            <span>{slot.timeDisplay}</span>
                            <Badge variant="secondary" className="ml-2 text-xs">
                              Full
                            </Badge>
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Optional: Manual Table Selection */}
            {tables && tables.length > 0 && (
              <div>
                <Label htmlFor="tableId">Table (Optional - Auto-assigned if left empty)</Label>
                <Select
                  value={formData.tableId?.toString() || "auto"}
                  onValueChange={(value) => setFormData({ ...formData, tableId: value === "auto" ? null : parseInt(value) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Auto-assign table" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-assign table</SelectItem>
                    {tables.map((table: Table) => (
                      <SelectItem 
                        key={table.id} 
                        value={table.id.toString()}
                        disabled={formData.guests < table.minGuests || formData.guests > table.maxGuests}
                      >
                        {table.name} (Capacity: {table.minGuests}-{table.maxGuests})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Comments */}
            <div>
              <Label htmlFor="comments">Special Requests (Optional)</Label>
              <Textarea
                id="comments"
                value={formData.comments}
                onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
                placeholder="Any special requests or notes..."
                rows={3}
              />
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={
                reservationMutation.isPending || 
                !formData.time || 
                !formData.guestName || 
                !formData.guestPhone ||
                hasNoTables
              }
            >
              {reservationMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {reservationId ? "Update Reservation" : "Create Reservation"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}