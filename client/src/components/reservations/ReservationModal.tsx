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
import { CalendarIcon, Clock, Users, Phone, Mail, User, Loader2, AlertCircle, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { DateTime } from 'luxon';

interface ReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  reservationId?: number;
  restaurantId: number;
  defaultDate?: Date;
  defaultTime?: string;
  defaultGuests?: number;
  defaultTableId?: number;
  restaurantTimezone?: string;
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
  restaurantTimezone = 'Europe/Moscow',
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

  // ✅ FIXED: Proper React Query for restaurant profile
  const { data: restaurant } = useQuery({
    queryKey: ['restaurant_profile', restaurantId],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/restaurants/profile");
      if (!response.ok) throw new Error("Failed to fetch restaurant");
      return response.json();
    },
    enabled: isOpen && !!restaurantId,
  });

  const effectiveTimezone = restaurantTimezone || restaurant?.timezone || 'Europe/Moscow';

  // ✅ FIXED: Proper React Query for tables with restaurantId
  const { data: tables, error: tablesError } = useQuery({
    queryKey: ['tables', restaurantId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/tables?restaurantId=${restaurantId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    },
    retry: 1,
    enabled: isOpen && !!restaurantId,
  });

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

  const maxCapacity = tables?.length > 0 
    ? tables.reduce((max: number, table: Table) => Math.max(max, table.maxGuests), 0)
    : 0;

  const hasNoTables = !tables || tables.length === 0;

  useEffect(() => {
    if (tables && formData.tableId) {
      const table = tables.find((t: Table) => t.id === formData.tableId);
      setSelectedTable(table || null);
    }
  }, [tables, formData.tableId]);

  // ✅ FIXED: Proper React Query for existing reservation
  const { data: existingReservation, error: reservationError } = useQuery({
    queryKey: ['reservation', reservationId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/reservations/${reservationId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!reservationId && isOpen,
    retry: 1,
  });

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

  // ✅ FIXED: Proper Luxon usage for restaurant time
  const getRestaurantTime = () => {
    try {
      return DateTime.now().setZone(effectiveTimezone);
    } catch (error) {
      console.warn(`Invalid timezone ${effectiveTimezone}, falling back to local time`);
      return DateTime.now();
    }
  };

  const getRestaurantDateString = (date: Date) => {
    try {
      return DateTime.fromJSDate(date).setZone(effectiveTimezone).toISODate();
    } catch (error) {
      console.warn(`Invalid timezone ${effectiveTimezone}, using local time`);
      return format(date, "yyyy-MM-dd");
    }
  };

  const isTimeSlotAvailable = (timeSlot: TimeSlot): boolean => {
    if (!timeSlot.available) return false;

    const selectedDate = getRestaurantDateString(formData.date);
    const today = getRestaurantTime().toISODate();
    
    if (selectedDate > today) return true;
    
    if (selectedDate === today) {
      const restaurantNow = getRestaurantTime();
      const currentHour = restaurantNow.hour;
      const currentMinute = restaurantNow.minute;
      
      const [slotHour, slotMinute] = timeSlot.time.split(':').map(Number);
      const slotTime = slotHour * 60 + slotMinute;
      const currentTime = currentHour * 60 + currentMinute;
      
      return slotTime > (currentTime + 30);
    }
    
    return false;
  };

  useEffect(() => {
    if (formData.date && formData.guests && isOpen && !hasNoTables) {
      fetchAvailableTimeSlots();
    }
  }, [formData.date, formData.guests, isOpen, hasNoTables]);

  const fetchAvailableTimeSlots = async () => {
    setIsLoadingAvailability(true);
    try {
      const dateStr = getRestaurantDateString(formData.date);
      const response = await apiRequest(
        "GET",
        `/api/booking/available-times?restaurantId=${restaurantId}&date=${dateStr}&guests=${formData.guests}&timezone=${encodeURIComponent(effectiveTimezone)}`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      const filteredSlots = (data.availableSlots || []).filter(isTimeSlotAvailable);
      
      setAvailableTimeSlots(filteredSlots);
    } catch (error) {
      console.error("Error fetching available times:", error);
      toast({
        title: "Error",
        description: "Failed to fetch available time slots",
        variant: "destructive",
      });
      setAvailableTimeSlots([]);
    } finally {
      setIsLoadingAvailability(false);
    }
  };

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
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard_upcoming'] });
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
        date: getRestaurantDateString(formData.date),
        timezone: effectiveTimezone, // ✅ NEW: Include timezone in submission
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

  // ✅ FIXED: Proper Luxon usage for display
  const getCurrentRestaurantTime = () => {
    try {
      const restaurantTime = getRestaurantTime();
      return restaurantTime.toFormat('ccc, MMM d, HH:mm');
    } catch (error) {
      return new Date().toLocaleString();
    }
  };

  const availableSlots = availableTimeSlots.filter(slot => slot.available);
  const unavailableSlots = availableTimeSlots.filter(slot => !slot.available);
  const displayedAvailableSlots = showAllTimes ? availableSlots : availableSlots.slice(0, 6);

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
          <div className="flex items-center gap-2 text-sm text-gray-500 mt-2">
            <Globe className="h-4 w-4" />
            <span>Restaurant time: {getCurrentRestaurantTime()}</span>
            <span className="text-gray-400">({effectiveTimezone})</span>
          </div>
        </DialogHeader>

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
                      disabled={(date) => {
                        // ✅ FIXED: Use restaurant timezone for date validation
                        const restaurantToday = getRestaurantTime().startOf('day');
                        const checkDate = DateTime.fromJSDate(date).startOf('day');
                        return checkDate < restaurantToday;
                      }}
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
                        {getRestaurantDateString(formData.date) === getRestaurantTime().toISODate()
                          ? " Try selecting a future date or earlier time." 
                          : " Try selecting a different date or reducing the party size."
                        }
                      </AlertDescription>
                    </Alert>
                  )}

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

            {/* Manual Table Selection */}
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