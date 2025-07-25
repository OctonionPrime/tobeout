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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { CalendarIcon, Clock, Users, Phone, Mail, User, Loader2, AlertCircle, Globe, Info, Moon, Sun, Sunrise } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { DateTime } from 'luxon';
import { useRestaurantTimezone } from "@/components/layout/DashboardLayout";

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
    tablesCount?: number;
    isCombined?: boolean;
    message?: string;
    slotType?: 'early_morning' | 'day' | 'late_night' | 'standard';
}

interface Table {
    id: number;
    name: string;
    minGuests: number;
    maxGuests: number;
    status: string;
}

interface DateConfirmDialog {
    isOpen: boolean;
    selectedTime: string;
    originalDate: Date;
    suggestedDate: Date;
    reason: string;
    userFriendlyExplanation: string;
}

// Enhanced time slot type for better UX
interface EnhancedTimeSlot extends TimeSlot {
    category: 'remaining_tonight' | 'today_service' | 'tomorrow_morning' | 'regular';
    actualBookingDate: Date;
    userFriendlyLabel: string;
    icon: string;
}

// FIX: Define the initial state outside the component
const getInitialFormData = (props: ReservationModalProps) => ({
    guestName: "",
    guestPhone: "",
    guestEmail: "",
    date: props.defaultDate || new Date(),
    time: props.defaultTime || "",
    guests: props.defaultGuests || 2 as number | '',
    tableId: props.defaultTableId || null as number | null,
    comments: "",
    source: "manual",
});

export function ReservationModal(props: ReservationModalProps) {
    const {
        isOpen,
        onClose,
        reservationId,
        restaurantId,
    } = props;

    const { restaurantTimezone, restaurant } = useRestaurantTimezone();

    const [formData, setFormData] = useState(getInitialFormData(props));
    const [dateAdjustmentWarning, setDateAdjustmentWarning] = useState<string | null>(null);
    const [dateConfirmDialog, setDateConfirmDialog] = useState<DateConfirmDialog | null>(null);

    const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
    const [selectedTable, setSelectedTable] = useState<Table | null>(null);
    const [availableTimeSlots, setAvailableTimeSlots] = useState<TimeSlot[]>([]);
    const [enhancedTimeSlots, setEnhancedTimeSlots] = useState<EnhancedTimeSlot[]>([]);
    const [showAllTimes, setShowAllTimes] = useState(false);
    const [isOvernightOperation, setIsOvernightOperation] = useState(false);

    const { toast } = useToast();
    const queryClient = useQueryClient();

    // FIX: Reset form whenever it opens for a NEW reservation
    useEffect(() => {
        if (isOpen && !reservationId) {
            setFormData(getInitialFormData(props));
            setDateAdjustmentWarning(null);
        }
    }, [isOpen, reservationId]);

    const effectiveTimezone = restaurantTimezone || 'Europe/Moscow';

    const parseTimeToMinutes = (timeStr: string): number | null => {
        if (!timeStr) return null;
        const parts = timeStr.split(':');
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10) || 0;
        if (isNaN(hours) || isNaN(minutes)) return null;
        return hours * 60 + minutes;
    };

    useEffect(() => {
        if (restaurant?.openingTime && restaurant?.closingTime) {
            const opening = parseTimeToMinutes(restaurant.openingTime);
            const closing = parseTimeToMinutes(restaurant.closingTime);
            const isOvernight = closing !== null && opening !== null && closing < opening;
            setIsOvernightOperation(isOvernight);
        }
    }, [restaurant]);

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

    // 🔧 ENHANCED: Smart date determination with user-friendly logic
    const getSmartReservationDate = (selectedDate: Date, selectedTime: string): { 
        adjustedDate: Date; 
        wasAdjusted: boolean; 
        reason: string;
        userFriendlyExplanation: string;
        category: 'remaining_tonight' | 'today_service' | 'tomorrow_morning' | 'regular';
    } => {
        if (!isOvernightOperation || !selectedTime || !restaurant?.closingTime) {
            return { 
                adjustedDate: selectedDate, 
                wasAdjusted: false, 
                reason: '',
                userFriendlyExplanation: '',
                category: 'regular'
            };
        }

        const restaurantNow = getRestaurantTime();
        const selectedDateInTimezone = DateTime.fromJSDate(selectedDate).setZone(effectiveTimezone);
        const selectedTimeMinutes = parseTimeToMinutes(selectedTime);
        const closingTimeMinutes = parseTimeToMinutes(restaurant.closingTime);
        const openingTimeMinutes = parseTimeToMinutes(restaurant.openingTime);
        
        if (selectedTimeMinutes === null || closingTimeMinutes === null || openingTimeMinutes === null) {
            return { 
                adjustedDate: selectedDate, 
                wasAdjusted: false, 
                reason: '',
                userFriendlyExplanation: '',
                category: 'regular'
            };
        }

        const isSelectedTimeEarlyMorning = selectedTimeMinutes < closingTimeMinutes;
        const isSelectedTimeLateNight = selectedTimeMinutes >= openingTimeMinutes;
        
        const todayInTimezone = restaurantNow.startOf('day');
        const selectedDateStart = selectedDateInTimezone.startOf('day');
        const currentTimeMinutes = restaurantNow.hour * 60 + restaurantNow.minute;
        
        // For early morning times (00:00 - closing time)
        if (isSelectedTimeEarlyMorning) {
            const isToday = selectedDateStart.equals(todayInTimezone);
            const isTomorrow = selectedDateStart.equals(todayInTimezone.plus({ days: 1 }));
            
            if (isToday) {
                // If it's currently after closing time (daytime), early morning means tomorrow's night shift
                if (currentTimeMinutes >= closingTimeMinutes) {
                    const adjustedDate = selectedDateInTimezone.plus({ days: 1 }).toJSDate();
                    return { 
                        adjustedDate, 
                        wasAdjusted: true, 
                        reason: `Early morning time ${selectedTime} moved to next day since it's currently daytime`,
                        userFriendlyExplanation: `Your ${selectedTime} booking is for tomorrow morning (${format(adjustedDate, 'EEE, MMM d')}) as part of tomorrow night's service`,
                        category: 'tomorrow_morning'
                    };
                }
                
                // If it's currently early morning and time has passed
                if (currentTimeMinutes < closingTimeMinutes && selectedTimeMinutes <= currentTimeMinutes) {
                    const adjustedDate = selectedDateInTimezone.plus({ days: 1 }).toJSDate();
                    return { 
                        adjustedDate, 
                        wasAdjusted: true, 
                        reason: `Time ${selectedTime} already passed today`,
                        userFriendlyExplanation: `${selectedTime} has already passed today. Your booking is moved to tomorrow morning (${format(adjustedDate, 'EEE, MMM d')})`,
                        category: 'tomorrow_morning'
                    };
                }
                
                // Currently early morning, time hasn't passed yet - this is remaining tonight
                return { 
                    adjustedDate: selectedDate, 
                    wasAdjusted: false, 
                    reason: '',
                    userFriendlyExplanation: `Your ${selectedTime} booking is for the remaining hours of tonight's service`,
                    category: 'remaining_tonight'
                };
            }
            
            if (isTomorrow) {
                // User selected tomorrow + early morning time
                const adjustedDate = selectedDateInTimezone.plus({ days: 1 }).toJSDate();
                return { 
                    adjustedDate, 
                    wasAdjusted: true, 
                    reason: `Early morning time on selected date moved to correct night shift`,
                    userFriendlyExplanation: `Your ${selectedTime} booking on ${format(selectedDate, 'MMM d')} is moved to ${format(adjustedDate, 'EEE, MMM d')} as it's part of that night's service`,
                    category: 'tomorrow_morning'
                };
            }
            
            // For any other future date, early morning means next day
            const adjustedDate = selectedDateInTimezone.plus({ days: 1 }).toJSDate();
            return { 
                adjustedDate, 
                wasAdjusted: true, 
                reason: `Early morning booking adjusted to correct service date`,
                userFriendlyExplanation: `Your ${selectedTime} booking is for the early morning of ${format(adjustedDate, 'EEE, MMM d')} (night service starting ${format(selectedDate, 'MMM d')})`,
                category: 'tomorrow_morning'
            };
        }
        
        // For regular day/evening times
        if (isSelectedTimeLateNight) {
            return { 
                adjustedDate: selectedDate, 
                wasAdjusted: false, 
                reason: '',
                userFriendlyExplanation: `Your ${selectedTime} booking is for today's service`,
                category: 'today_service'
            };
        }

        return { 
            adjustedDate: selectedDate, 
            wasAdjusted: false, 
            reason: '',
            userFriendlyExplanation: '',
            category: 'regular'
        };
    };

    // 🔧 FIXED: Enhanced time slot categorization with proper separation
    const enhanceTimeSlots = (slots: TimeSlot[]): EnhancedTimeSlot[] => {
        if (!isOvernightOperation) {
            return slots.map(slot => ({
                ...slot,
                category: 'regular' as const,
                actualBookingDate: formData.date,
                userFriendlyLabel: slot.timeDisplay,
                icon: '🕐'
            }));
        }

        const restaurantNow = getRestaurantTime();
        const selectedDateInTimezone = DateTime.fromJSDate(formData.date).setZone(effectiveTimezone);
        const todayInTimezone = restaurantNow.startOf('day');
        const isSelectedDateToday = selectedDateInTimezone.startOf('day').equals(todayInTimezone);

        const currentTimeMinutes = restaurantNow.hour * 60 + restaurantNow.minute;
        const openingTimeMinutes = parseTimeToMinutes(restaurant?.openingTime || '08:00');
        const closingTimeMinutes = parseTimeToMinutes(restaurant?.closingTime || '05:00');

        return slots.map(slot => {
            const slotTimeMinutes = parseTimeToMinutes(slot.time);
            if (slotTimeMinutes === null || openingTimeMinutes === null || closingTimeMinutes === null) {
                return {
                    ...slot,
                    category: 'regular' as const,
                    actualBookingDate: formData.date,
                    userFriendlyLabel: slot.timeDisplay,
                    icon: '🕐'
                };
            }

            const { adjustedDate, category, userFriendlyExplanation } = getSmartReservationDate(formData.date, slot.time);
            
            let icon = '🕐';
            let userFriendlyLabel = slot.timeDisplay;
            
            const isEarlyMorning = slotTimeMinutes < closingTimeMinutes;
            const isAfterOpening = slotTimeMinutes >= openingTimeMinutes;

            if (isSelectedDateToday) {
                if (isEarlyMorning) {
                    // Check if this slot is still available tonight or for tomorrow
                    if (slotTimeMinutes > currentTimeMinutes && currentTimeMinutes < closingTimeMinutes) {
                        // Remaining tonight
                        icon = '🌙';
                        userFriendlyLabel = slot.timeDisplay;
                        return {
                            ...slot,
                            category: 'remaining_tonight' as const,
                            actualBookingDate: adjustedDate,
                            userFriendlyLabel,
                            icon
                        };
                    } else {
                        // Tomorrow morning
                        icon = '🌅';
                        userFriendlyLabel = slot.timeDisplay;
                        return {
                            ...slot,
                            category: 'tomorrow_morning' as const,
                            actualBookingDate: adjustedDate,
                            userFriendlyLabel,
                            icon
                        };
                    }
                } else if (isAfterOpening) {
                    // Today's regular service
                    icon = slotTimeMinutes < 12 * 60 ? '☀️' : slotTimeMinutes < 18 * 60 ? '🌞' : '🌆';
                    userFriendlyLabel = slot.timeDisplay;
                    return {
                        ...slot,
                        category: 'today_service' as const,
                        actualBookingDate: adjustedDate,
                        userFriendlyLabel,
                        icon
                    };
                }
            } else {
                // For future dates
                if (isEarlyMorning) {
                    icon = '🌅';
                    userFriendlyLabel = `${slot.timeDisplay} Early Morning`;
                    return {
                        ...slot,
                        category: 'tomorrow_morning' as const,
                        actualBookingDate: adjustedDate,
                        userFriendlyLabel,
                        icon
                    };
                } else {
                    icon = slotTimeMinutes >= 18 * 60 ? '🌆' : '☀️';
                    userFriendlyLabel = slot.timeDisplay;
                    return {
                        ...slot,
                        category: 'today_service' as const,
                        actualBookingDate: adjustedDate,
                        userFriendlyLabel,
                        icon
                    };
                }
            }
            
            return {
                ...slot,
                category: category,
                actualBookingDate: adjustedDate,
                userFriendlyLabel,
                icon
            };
        });
    };

    // 🔧 Enhanced time slot selection with smart confirmation
    const handleTimeSelection = (selectedTime: string) => {
        const { adjustedDate, wasAdjusted, reason, userFriendlyExplanation } = getSmartReservationDate(formData.date, selectedTime);
        
        if (wasAdjusted && isOvernightOperation) {
            // Show confirmation dialog for overnight adjustments
            setDateConfirmDialog({
                isOpen: true,
                selectedTime,
                originalDate: formData.date,
                suggestedDate: adjustedDate,
                reason,
                userFriendlyExplanation
            });
        } else {
            setFormData({ ...formData, time: selectedTime, date: adjustedDate });
            setDateAdjustmentWarning(null);
            
            if (userFriendlyExplanation) {
                toast({
                    title: "Booking Confirmed",
                    description: userFriendlyExplanation,
                    variant: "default",
                });
            }
        }
    };

    // Dialog handlers
    const handleConfirmDateAdjustment = () => {
        if (dateConfirmDialog) {
            setFormData({ 
                ...formData, 
                time: dateConfirmDialog.selectedTime, 
                date: dateConfirmDialog.suggestedDate 
            });
            setDateAdjustmentWarning(null);
            toast({
                title: "Booking Confirmed",
                description: dateConfirmDialog.userFriendlyExplanation,
                variant: "default",
            });
        }
        setDateConfirmDialog(null);
    };

    const handleKeepOriginalDate = () => {
        if (dateConfirmDialog) {
            setFormData({ 
                ...formData, 
                time: dateConfirmDialog.selectedTime 
            });
            setDateAdjustmentWarning(null);
        }
        setDateConfirmDialog(null);
    };

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

    const isTimeSlotAvailable = (timeSlot: TimeSlot): boolean => {
        if (!timeSlot.available) return false;

        const selectedDateStr = getRestaurantDateString(formData.date);
        const todayStr = getRestaurantTime().toISODate();

        if (selectedDateStr > todayStr) return true;

        if (selectedDateStr === todayStr) {
            const restaurantNow = getRestaurantTime();
            const currentTimeMinutes = restaurantNow.hour * 60 + restaurantNow.minute;

            const [slotHour, slotMinute] = timeSlot.time.split(':').map(Number);
            const slotTimeMinutes = slotHour * 60 + slotMinute;

            if (isOvernightOperation) {
                const opening = parseTimeToMinutes(restaurant?.openingTime || '00:00');
                const closing = parseTimeToMinutes(restaurant?.closingTime || '00:00');
                if (opening === null || closing === null) return false;

                const isSlotInEarlyMorning = slotTimeMinutes < closing;

                if (isSlotInEarlyMorning) {
                    return true;
                }
                return slotTimeMinutes > currentTimeMinutes;

            } else {
                return slotTimeMinutes > currentTimeMinutes;
            }
        }

        return false;
    };

    useEffect(() => {
        if (formData.date && formData.guests && typeof formData.guests === 'number' && isOpen && !hasNoTables) {
            fetchAvailableTimeSlots();
        }
    }, [formData.date, formData.guests, isOpen, hasNoTables, isOvernightOperation]);

    const fetchAvailableTimeSlots = async () => {
        if (typeof formData.guests !== 'number' || formData.guests < 1) return;

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
            setEnhancedTimeSlots(enhanceTimeSlots(filteredSlots));

        } catch (error) {
            console.error("Error fetching available times:", error);
            toast({
                title: "Error",
                description: "Failed to fetch available time slots",
                variant: "destructive",
            });
            setAvailableTimeSlots([]);
            setEnhancedTimeSlots([]);
        } finally {
            setIsLoadingAvailability(false);
        }
    };

    // FIX: Create a function to reset the form and close the modal
    const resetAndClose = () => {
        setFormData(getInitialFormData(props));
        setDateAdjustmentWarning(null);
        setDateConfirmDialog(null);
        onClose();
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
                    const errorData = await response.json().catch(() => ({ message: 'An unknown error occurred' }));
                    throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
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
            resetAndClose();
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

            if (typeof formData.guests !== 'number' || formData.guests < 1 || (maxCapacity > 0 && formData.guests > maxCapacity)) {
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
                timezone: effectiveTimezone,
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

    const getCurrentRestaurantTime = () => {
        try {
            const restaurantTime = getRestaurantTime();
            return restaurantTime.toFormat('ccc, MMM d, HH:mm');
        } catch (error) {
            return new Date().toLocaleString();
        }
    };

    // 🔧 FIXED: Organize time slots with proper separation
    const organizeEnhancedTimeSlots = (slots: EnhancedTimeSlot[]) => {
        if (!isOvernightOperation) {
            return { 
                remainingTonightSlots: [], 
                todayServiceSlots: [], 
                tomorrowMorningSlots: [], 
                regularSlots: slots.filter(slot => slot.available) 
            };
        }

        const available = slots.filter(slot => slot.available);
        
        const remainingTonightSlots = available.filter(slot => slot.category === 'remaining_tonight')
            .sort((a, b) => a.time.localeCompare(b.time));
            
        const todayServiceSlots = available.filter(slot => slot.category === 'today_service')
            .sort((a, b) => a.time.localeCompare(b.time));
            
        const tomorrowMorningSlots = available.filter(slot => slot.category === 'tomorrow_morning')
            .sort((a, b) => a.time.localeCompare(b.time));

        return { remainingTonightSlots, todayServiceSlots, tomorrowMorningSlots, regularSlots: [] };
    };

    const { remainingTonightSlots, todayServiceSlots, tomorrowMorningSlots, regularSlots } = organizeEnhancedTimeSlots(enhancedTimeSlots);
    const allAvailableSlots = [...remainingTonightSlots, ...todayServiceSlots, ...tomorrowMorningSlots, ...regularSlots];
    const displayedSlots = showAllTimes ? allAvailableSlots : allAvailableSlots.slice(0, 12);

    if (!isOpen) {
        return null;
    }

    return (
        <>
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
                            {isOvernightOperation && (
                                <Badge variant="outline" className="ml-2 bg-blue-50">
                                    <Clock className="h-3 w-3 mr-1" />
                                    24-Hour Operation
                                </Badge>
                            )}
                        </div>
                    </DialogHeader>

                    {hasNoTables && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                                No tables found. Please add tables to your restaurant before creating reservations.
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* Enhanced date adjustment warning */}
                    {dateAdjustmentWarning && (
                        <Alert className="border-green-200 bg-green-50">
                            <Info className="h-4 w-4 text-green-600" />
                            <AlertDescription className="text-green-800">
                                <strong>Booking Confirmed:</strong> {dateAdjustmentWarning}
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
                                                onSelect={(date) => {
                                                    if (date) {
                                                        setFormData({ ...formData, date, time: "" }); // Reset time when date changes
                                                        setDateAdjustmentWarning(null);
                                                    }
                                                }}
                                                initialFocus
                                                disabled={(date) => {
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
                                                const value = e.target.value;
                                                if (value === '') {
                                                    setFormData({ ...formData, guests: '', time: "" }); // Reset time when guests change
                                                } else {
                                                    const numValue = parseInt(value, 10);
                                                    if (!isNaN(numValue) && numValue >= 1 && numValue <= (maxCapacity || 50)) {
                                                        setFormData({ ...formData, guests: numValue, time: "" }); // Reset time when guests change
                                                    }
                                                }
                                            }}
                                            required
                                            disabled={hasNoTables}
                                            className="pr-8"
                                        />
                                        <Users className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
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

                            {/* 🔧 FIXED: Enhanced Time Selection with proper separation */}
                            <div>
                                <Label>Available Times</Label>
                                {hasNoTables ? (
                                    <Alert variant="destructive">
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertDescription>
                                            No tables available. Please add tables to your restaurant first.
                                        </AlertDescription>
                                    </Alert>
                                ) : isLoadingAvailability ? (
                                    <div className="flex items-center justify-center py-8">
                                        <Loader2 className="h-6 w-6 animate-spin" />
                                        <span className="ml-2 text-gray-600">
                                            {isOvernightOperation ? 'Loading 24-hour availability...' : 'Loading availability...'}
                                        </span>
                                    </div>
                                ) : allAvailableSlots.length > 0 ? (
                                    <div className="space-y-4">
                                        {/* Enhanced overnight operation info */}
                                        {isOvernightOperation && (
                                            <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-lg border border-blue-200">
                                                <div className="flex items-start gap-3">
                                                    <div className="flex items-center gap-1 text-lg">
                                                        <Moon className="h-5 w-5 text-blue-600" />
                                                        <Sunrise className="h-5 w-5 text-orange-500" />
                                                    </div>
                                                    <div>
                                                        <h4 className="font-semibold text-blue-800 mb-1">24-Hour Service Available</h4>
                                                        <p className="text-sm text-blue-700 mb-2">
                                                            We're open from <strong>{restaurant?.openingTime}</strong> to <strong>{restaurant?.closingTime}</strong> next day
                                                        </p>
                                                        <div className="text-xs text-blue-600 space-y-1">
                                                            <div className="flex items-center gap-2">
                                                                <Moon className="h-3 w-3" />
                                                                <span>Night service: {restaurant?.openingTime} - 23:59</span>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <Sunrise className="h-3 w-3" />
                                                                <span>Early morning: 00:00 - {restaurant?.closingTime}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* 🔧 FIXED: Remaining Tonight slots */}
                                        {remainingTonightSlots.length > 0 && (
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <Moon className="h-4 w-4 text-purple-600" />
                                                    <h4 className="font-medium text-purple-800">Remaining Tonight</h4>
                                                    <Badge variant="secondary" className="bg-purple-100 text-purple-700">
                                                        Until {restaurant?.closingTime}
                                                    </Badge>
                                                </div>
                                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                                                    {remainingTonightSlots.map((slot) => (
                                                        <Button
                                                            key={`remaining-${slot.time}`}
                                                            type="button"
                                                            variant={formData.time === slot.time ? "default" : "outline"}
                                                            size="sm"
                                                            onClick={() => handleTimeSelection(slot.time)}
                                                            className={cn(
                                                                "flex flex-col gap-1 h-auto py-2 text-xs",
                                                                formData.time === slot.time && "ring-2 ring-purple-500",
                                                            )}
                                                        >
                                                            <span className="text-lg">{slot.icon}</span>
                                                            <span>{slot.timeDisplay}</span>
                                                        </Button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* 🔧 FIXED: Today's Service slots (separate from remaining tonight) */}
                                        {todayServiceSlots.length > 0 && (
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <Sun className="h-4 w-4 text-yellow-600" />
                                                    <h4 className="font-medium text-yellow-700">Today's Service</h4>
                                                    <Badge variant="secondary" className="bg-yellow-100 text-yellow-700">
                                                        From {restaurant?.openingTime}
                                                    </Badge>
                                                </div>
                                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                                                    {todayServiceSlots.map((slot) => (
                                                        <Button
                                                            key={`today-${slot.time}`}
                                                            type="button"
                                                            variant={formData.time === slot.time ? "default" : "outline"}
                                                            size="sm"
                                                            onClick={() => handleTimeSelection(slot.time)}
                                                            className={cn(
                                                                "flex flex-col gap-1 h-auto py-2 text-xs",
                                                                formData.time === slot.time && "ring-2 ring-yellow-500",
                                                            )}
                                                        >
                                                            <span className="text-lg">{slot.icon}</span>
                                                            <span>{slot.timeDisplay}</span>
                                                        </Button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Tomorrow morning slots */}
                                        {tomorrowMorningSlots.length > 0 && (
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <Sunrise className="h-4 w-4 text-orange-500" />
                                                    <h4 className="font-medium text-orange-700">Tomorrow's Early Morning</h4>
                                                    <Badge variant="secondary" className="bg-orange-100 text-orange-700">
                                                        Next night's service
                                                    </Badge>
                                                </div>
                                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                                                    {tomorrowMorningSlots.map((slot) => (
                                                        <Button
                                                            key={`morning-${slot.time}`}
                                                            type="button"
                                                            variant={formData.time === slot.time ? "default" : "outline"}
                                                            size="sm"
                                                            onClick={() => handleTimeSelection(slot.time)}
                                                            className={cn(
                                                                "flex flex-col gap-1 h-auto py-2 text-xs",
                                                                formData.time === slot.time && "ring-2 ring-orange-500",
                                                            )}
                                                        >
                                                            <span className="text-lg">{slot.icon}</span>
                                                            <span>{slot.timeDisplay}</span>
                                                        </Button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Regular slots for non-overnight operations */}
                                        {regularSlots.length > 0 && (
                                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                                                {regularSlots.map((slot) => (
                                                    <Button
                                                        key={slot.time}
                                                        type="button"
                                                        variant={formData.time === slot.time ? "default" : "outline"}
                                                        size="sm"
                                                        onClick={() => handleTimeSelection(slot.time)}
                                                        className={cn(
                                                            "text-xs",
                                                            formData.time === slot.time && "ring-2 ring-blue-500",
                                                        )}
                                                    >
                                                        {slot.timeDisplay}
                                                    </Button>
                                                ))}
                                            </div>
                                        )}

                                        {/* Show more/less button */}
                                        {!showAllTimes && allAvailableSlots.length > 12 && (
                                            <div className="flex justify-center">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setShowAllTimes(true)}
                                                    className="text-blue-600 hover:text-blue-800"
                                                >
                                                    <Clock className="h-4 w-4 mr-1" />
                                                    Show all {allAvailableSlots.length} available times
                                                </Button>
                                            </div>
                                        )}

                                        {showAllTimes && allAvailableSlots.length > 12 && (
                                            <div className="flex justify-center">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setShowAllTimes(false)}
                                                    className="text-gray-600 hover:text-gray-800"
                                                >
                                                    Show fewer options
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <Alert>
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertDescription>
                                            No available time slots for {formData.guests || 'the selected'} guests on this date.
                                            {getRestaurantDateString(formData.date) === getRestaurantTime().toISODate()
                                                ? ` Try selecting a future date or different time.`
                                                : " Try selecting a different date or reducing the party size."
                                            }
                                        </AlertDescription>
                                    </Alert>
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
                                                    disabled={typeof formData.guests === 'number' && (formData.guests < table.minGuests || formData.guests > table.maxGuests)}
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
                            <Button type="button" variant="outline" onClick={resetAndClose}>
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={
                                    reservationMutation.isPending ||
                                    !formData.time ||
                                    !formData.guestName ||
                                    !formData.guestPhone ||
                                    !formData.guests ||
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

            {/* Enhanced Confirmation Dialog */}
            {dateConfirmDialog && (
                <AlertDialog open={dateConfirmDialog.isOpen} onOpenChange={() => setDateConfirmDialog(null)}>
                    <AlertDialogContent className="max-w-md">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="flex items-center gap-2">
                                <div className="flex items-center gap-1">
                                    <Moon className="h-5 w-5 text-blue-600" />
                                    <Sunrise className="h-5 w-5 text-orange-500" />
                                </div>
                                Confirm Your Booking Time
                            </AlertDialogTitle>
                            <AlertDialogDescription className="space-y-3">
                                <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                                    <div className="text-blue-800 text-sm">
                                        <strong>You selected:</strong> {dateConfirmDialog.selectedTime} on {format(dateConfirmDialog.originalDate, 'EEE, MMM d')}
                                    </div>
                                </div>
                                
                                <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                                    <div className="text-green-800 text-sm">
                                        <strong>Smart suggestion:</strong> {dateConfirmDialog.userFriendlyExplanation}
                                    </div>
                                </div>
                                
                                <div className="text-sm text-gray-600">
                                    Which option would you prefer for your <strong>{dateConfirmDialog.selectedTime}</strong> reservation?
                                </div>
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                            <AlertDialogCancel onClick={handleKeepOriginalDate} className="flex items-center gap-2">
                                <CalendarIcon className="h-4 w-4" />
                                Keep {format(dateConfirmDialog.originalDate, 'MMM d')}
                            </AlertDialogCancel>
                            <AlertDialogAction onClick={handleConfirmDateAdjustment} className="flex items-center gap-2 bg-green-600 hover:bg-green-700">
                                <Clock className="h-4 w-4" />
                                Use {format(dateConfirmDialog.suggestedDate, 'MMM d')} (Recommended)
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </>
    );
}