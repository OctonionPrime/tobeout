import { useState, useEffect } from "react";
import { format } from "date-fns";
import { X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, invalidateReservationQueries } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, Clock, Users } from "lucide-react";

interface ReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  reservationId?: number;
  restaurantId: number;
}

const formSchema = z.object({
  guestName: z.string().min(1, "Guest name is required"),
  guestPhone: z.string().min(1, "Phone number is required"),
  guestEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  date: z.string().min(1, "Date is required"),
  time: z.string().min(1, "Time is required"),
  guests: z.number().min(1, "At least 1 guest required").max(20, "Maximum 20 guests"),
  tableId: z.string().optional(),
  specialRequests: z.string().optional()
});

type FormValues = z.infer<typeof formSchema>;

interface AvailableSlot {
  time: string;
  timeDisplay: string;
  available: boolean;
  tableName: string;
  tableCapacity: number;
  canAccommodate: boolean;
  tablesCount: number;
  message: string;
}

export function ReservationModal({ isOpen, onClose, reservationId, restaurantId }: ReservationModalProps) {
  const [tables, setTables] = useState<any[]>([]);
  const [availableTimeSlots, setAvailableTimeSlots] = useState<AvailableSlot[]>([]);
  const [existingReservation, setExistingReservation] = useState<any>(null);
  const [isLoadingTimes, setIsLoadingTimes] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string>("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get current date in Moscow timezone for form default
  const getMoscowDate = () => {
    const now = new Date();
    const moscowTime = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Moscow"}));
    return format(moscowTime, "yyyy-MM-dd");
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      guestName: "",
      guestPhone: "",
      guestEmail: "",
      date: getMoscowDate(), // ✅ Uses Moscow timezone
      time: "18:00",
      guests: 2,
      tableId: "",
      specialRequests: ""
    }
  });

  // Fetch tables when component mounts
  useEffect(() => {
    if (isOpen) {
      fetchTables();
      if (reservationId) {
        fetchReservation();
      }
    }
  }, [isOpen, reservationId]);

  // Watch for date and guest count changes to fetch available times
  const watchedDate = form.watch("date");
  const watchedGuests = form.watch("guests");

  useEffect(() => {
    if (watchedDate && watchedGuests && isOpen) {
      fetchAvailableTimeSlots(watchedDate, watchedGuests);
    }
  }, [watchedDate, watchedGuests, isOpen]);

  const fetchTables = async () => {
    try {
      const response = await fetch(`/api/tables?restaurantId=${restaurantId}`, {
        credentials: "include"
      });
      if (response.ok) {
        const data = await response.json();
        setTables(data);
      }
    } catch (error) {
      console.error("Error fetching tables:", error);
      toast({
        title: "Error",
        description: "Failed to load table information",
        variant: "destructive"
      });
    }
  };

  const fetchAvailableTimeSlots = async (date: string, guests: number) => {
    if (!date || !guests) return;

    setIsLoadingTimes(true);
    setAvailabilityError("");

    try {
      const response = await fetch(
        `/api/booking/available-times?restaurantId=${restaurantId}&date=${date}&guests=${guests}`,
        { credentials: "include" }
      );

      if (response.ok) {
        const data = await response.json();
        const slots = data.availableSlots || [];
        setAvailableTimeSlots(slots);

        if (slots.length === 0) {
          setAvailabilityError(`No available times found for ${guests} ${guests === 1 ? 'guest' : 'guests'} on ${format(new Date(date), 'MMMM d, yyyy')}`);
        }
      } else {
        const errorData = await response.json();
        setAvailabilityError(errorData.message || "Failed to check availability");
        setAvailableTimeSlots([]);
      }
    } catch (error) {
      console.error("Error fetching available times:", error);
      setAvailabilityError("Unable to check availability. Please try again.");
      setAvailableTimeSlots([]);
    } finally {
      setIsLoadingTimes(false);
    }
  };

  const fetchReservation = async () => {
    try {
      const response = await fetch(`/api/reservations/${reservationId}`, {
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reservation = await response.json();
      console.log("✅ Fetched reservation data:", reservation);

      if (!reservation) {
        throw new Error("No reservation data received");
      }

      setExistingReservation(reservation);

      // Format the data for the form
      const formData = {
        guestName: reservation.guestName || "",
        guestPhone: reservation.guestPhone || "",
        guestEmail: reservation.guestEmail || "",
        date: reservation.date || "",
        time: reservation.time ? reservation.time.substring(0, 5) : "",
        guests: reservation.guests || 2,
        tableId: reservation.tableId ? String(reservation.tableId) : "",
        specialRequests: reservation.comments || ""
      };

      console.log("📝 Setting form data:", formData);
      form.reset(formData);

    } catch (error) {
      console.error("❌ Error fetching reservation:", error);
      toast({
        title: "Error",
        description: "Failed to load reservation data",
        variant: "destructive"
      });
    }
  };

  const createMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const response = await apiRequest("POST", "/api/reservations", {
        restaurantId,
        guestName: values.guestName,
        guestPhone: values.guestPhone,
        guestEmail: values.guestEmail,
        date: values.date,
        time: values.time,
        guests: values.guests,
        tableId: values.tableId === "auto" ? null : (values.tableId ? parseInt(values.tableId) : null),
        comments: values.specialRequests,
        source: "manual"
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: data.smartAssignment 
          ? `Reservation created successfully! Table ${data.table?.name} assigned automatically.`
          : "Reservation created successfully",
      });

      // ✅ Use new smart invalidation utility
      invalidateReservationQueries();
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });

      onClose();
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: `Failed to create reservation: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (values: FormValues & { status?: string }) => {
      const response = await apiRequest("PATCH", `/api/reservations/${reservationId}`, {
        date: values.date,
        time: values.time,
        guests: values.guests,
        tableId: values.tableId ? parseInt(values.tableId) : undefined,
        comments: values.specialRequests,
        status: values.status // Include status in the update
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: data.smartAssignment 
          ? `Reservation updated successfully! Table ${data.table?.name} assigned automatically.`
          : "Reservation updated successfully",
      });

      // ✅ Use new smart invalidation utility
      invalidateReservationQueries();

      onClose();
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: `Failed to update reservation: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const onSubmit = (values: FormValues) => {
    if (reservationId) {
      updateMutation.mutate(values);
    } else {
      createMutation.mutate(values);
    }
  };

  // Helper function to get status badge for time slots
  const getTimeSlotBadge = (slot: AvailableSlot) => {
    if (!slot.canAccommodate) {
      return <Badge variant="destructive" className="ml-2 text-xs">Limited Capacity</Badge>;
    }
    if (slot.tablesCount > 1) {
      return <Badge variant="secondary" className="ml-2 text-xs">{slot.tablesCount} tables</Badge>;
    }
    return <Badge variant="default" className="ml-2 text-xs">Available</Badge>;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {reservationId ? "Edit Reservation" : "Create New Reservation"}
            {existingReservation?.status && (
              <Badge 
                variant={existingReservation.status === 'confirmed' ? 'default' : 
                        existingReservation.status === 'canceled' ? 'destructive' : 'secondary'}
                className="ml-2"
              >
                {existingReservation.status}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {reservationId 
              ? "Update the reservation details below" 
              : "Fill in the details to create a new reservation. Smart table assignment will find the best available table."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Guest Information Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Users className="h-4 w-4" />
                Guest Information
              </div>

              <FormField
                control={form.control}
                name="guestName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Guest Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter guest name" {...field} disabled={!!reservationId} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="guestPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input placeholder="+1 (555) 123-4567" {...field} disabled={!!reservationId} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="guestEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="guest@example.com" {...field} disabled={!!reservationId} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Reservation Details Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Clock className="h-4 w-4" />
                Reservation Details
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="guests"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Number of Guests</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          min={1} 
                          max={20} 
                          {...field} 
                          onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Time
                      {isLoadingTimes && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          Checking availability...
                        </span>
                      )}
                    </FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      defaultValue={field.value}
                      value={field.value}
                      disabled={isLoadingTimes}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select time" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-64">
                        {isLoadingTimes ? (
                          <SelectItem value="loading" disabled>
                            <div className="flex items-center gap-2">
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary"></div>
                              Loading available times...
                            </div>
                          </SelectItem>
                        ) : availableTimeSlots.length > 0 ? (
                          availableTimeSlots.map((slot) => (
                            <SelectItem 
                              key={slot.time} 
                              value={slot.time}
                              disabled={!slot.canAccommodate}
                              className="py-3"
                            >
                              <div className="flex items-center justify-between w-full">
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{slot.timeDisplay}</span>
                                    {getTimeSlotBadge(slot)}
                                  </div>
                                  <span className={`text-xs ${slot.canAccommodate ? 'text-green-600' : 'text-orange-600'}`}>
                                    {slot.message}
                                  </span>
                                </div>
                              </div>
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="no-times" disabled>
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <AlertCircle className="h-4 w-4" />
                              {availabilityError || "No available times"}
                            </div>
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {availabilityError && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                        <AlertCircle className="h-4 w-4" />
                        {availabilityError}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tableId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Table Assignment</FormLabel>
                    <Select 
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Smart assignment (recommended)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="auto">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <div>
                              <div className="font-medium">Smart Assignment</div>
                              <div className="text-xs text-muted-foreground">
                                Automatically assigns the best available table
                              </div>
                            </div>
                          </div>
                        </SelectItem>
                        {tables.map((table) => (
                          <SelectItem key={table.id} value={String(table.id)}>
                            <div className="flex items-center gap-2">
                              <div>
                                <div className="font-medium">{table.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  Seats {table.minGuests}-{table.maxGuests} guests
                                </div>
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="specialRequests"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Special Requests</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Enter any special requests or notes"
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="mt-6 gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>

              {/* Show Confirm button for cancelled reservations */}
              {reservationId && existingReservation?.status === "canceled" && (
                <Button 
                  type="button"
                  variant="default"
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={async () => {
                    try {
                      const formValues = form.getValues();
                      await updateMutation.mutateAsync({
                        ...formValues,
                        status: "confirmed"
                      } as any);
                      toast({ title: "Reservation confirmed successfully!" });
                      onClose();
                    } catch (error: any) {
                      toast({ 
                        title: "Error confirming reservation", 
                        description: error.message, 
                        variant: "destructive" 
                      });
                    }
                  }}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? "Confirming..." : "Confirm Reservation"}
                </Button>
              )}

              <Button 
                type="submit" 
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                    Saving...
                  </div>
                ) : reservationId ? (
                  "Update Reservation"
                ) : (
                  "Create Reservation"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}