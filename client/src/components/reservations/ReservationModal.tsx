import { useState, useEffect } from "react";
import { format } from "date-fns";
import { X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

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

export function ReservationModal({ isOpen, onClose, reservationId, restaurantId }: ReservationModalProps) {
  const [tables, setTables] = useState<any[]>([]);
  const [existingReservation, setExistingReservation] = useState<any>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      guestName: "",
      guestPhone: "",
      guestEmail: "",
      date: format(new Date(), "yyyy-MM-dd"),
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
        tableId: values.tableId && values.tableId !== "auto" ? parseInt(values.tableId) : undefined,
        comments: values.specialRequests,
        source: "manual"
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Reservation created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/reservations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/upcoming'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      onClose();
      form.reset();
    },
    onError: (error) => {
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
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Reservation updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/reservations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/upcoming'] });
      onClose();
      form.reset();
    },
    onError: (error) => {
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{reservationId ? "Edit Reservation" : "Create New Reservation"}</DialogTitle>
          <DialogDescription>
            {reservationId 
              ? "Update the reservation details below" 
              : "Fill in the details to create a new reservation"}
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                name="time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time</FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      defaultValue={field.value}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select time" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {['17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'].map((time) => (
                          <SelectItem key={time} value={time}>{time}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
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
              
              <FormField
                control={form.control}
                name="tableId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Table</FormLabel>
                    <Select 
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Assign automatically" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="auto">Assign automatically</SelectItem>
                        {tables.map((table) => (
                          <SelectItem key={table.id} value={String(table.id)}>
                            {table.name} ({table.minGuests}-{table.maxGuests} guests)
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
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <DialogFooter className="mt-6">
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
                      // Force refresh the reservations list
                      queryClient.invalidateQueries({ queryKey: ['/api/reservations'] });
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
                  "Saving..."
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
