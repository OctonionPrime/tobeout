import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { DateTime } from 'luxon';
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReservationModal } from "@/components/reservations/ReservationModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
    Search, Plus, Calendar as CalendarIcon, Edit, Phone, Mail,
    UserCheck, XCircle, Users, MoreHorizontal, AlertCircle,
    Clock, RefreshCw
} from "lucide-react";
import { RollingCalendar } from "@/components/ui/rolling-calendar";
import { useRestaurantTimezone } from "@/components/layout/DashboardLayout";

// ✅ Helper function to safely parse PostgreSQL timestamps
const parsePostgresTimestamp = (timestamp: string): DateTime | null => {
    if (!timestamp) return null;
    
    try {
        // Handle PostgreSQL format: "2025-06-23 10:00:00+00"
        if (timestamp.includes(' ') && !timestamp.includes('T')) {
            const isoFormat = timestamp.replace(' ', 'T').replace('+00', 'Z');
            const parsed = DateTime.fromISO(isoFormat, { zone: 'utc' });
            if (parsed.isValid) return parsed;
        }
        
        // Handle standard ISO format: "2025-06-23T10:00:00.000Z"
        const parsed = DateTime.fromISO(timestamp, { zone: 'utc' });
        if (parsed.isValid) return parsed;
        
        console.warn('[Timestamp Parser] Could not parse timestamp:', timestamp);
        return null;
    } catch (error) {
        console.warn('[Timestamp Parser] Error parsing timestamp:', timestamp, error);
        return null;
    }
};

// ✅ Safe data extraction helper
const extractReservationData = (reservationData: any) => {
    // Handle both nested {reservation: {...}, guest: {...}} and flat structures
    const reservation = reservationData.reservation || reservationData;
    const guest = reservationData.guest || reservation.guest || {};
    const table = reservationData.table || reservation.table || {};
    
    return {
        reservation: {
            ...reservation,
            // Normalize status field
            status: reservation.status || 'unknown',
            // Ensure we have a reservation_utc field
            reservation_utc: reservation.reservation_utc || reservation.dateTime || reservation.timestamp
        },
        guest: {
            ...guest,
            // Normalize guest name from multiple possible sources
            name: guest.name || reservation.booking_guest_name || reservationData.guestName || 'Guest'
        },
        table
    };
};

export default function Reservations() {
    // ✅ Get timezone and restaurant from context
    const { restaurantTimezone, restaurant, refreshRestaurant } = useRestaurantTimezone();
    const restaurantId = restaurant?.id || 1;
    
    // ✅ CRITICAL FIX: Make restaurantNow reactive to timezone changes
    const restaurantNow = useMemo(() => {
        return DateTime.now().setZone(restaurantTimezone);
    }, [restaurantTimezone]); // ✅ Re-calculate when timezone changes
    
    // ✅ Start with "all" tab by default to see everything
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
    const [dateRangeFilter, setDateRangeFilter] = useState<{
        type: 'default' | 'today' | 'thisWeek' | 'nextWeek' | 'custom';
        startDate?: Date;
        endDate?: Date;
        displayText: string;
    }>({ type: 'default', displayText: 'Default View' });
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [isReservationModalOpen, setIsReservationModalOpen] = useState(false);
    const [selectedReservationId, setSelectedReservationId] = useState<number | undefined>(undefined);
    const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);
    const [activeSmartTab, setActiveSmartTab] = useState("all");

    const { toast } = useToast();
    const queryClient = useQueryClient();

    // ✅ Smart tabs configuration
    const smartTabs = [
        {
            id: "all",
            label: "📋 All Reservations",
            description: "Complete list",
            priority: "low" as const
        },
        {
            id: "attention",
            label: "⚠️ Needs Attention",
            description: "AI bookings + Late arrivals",
            priority: "critical" as const
        },
        {
            id: "active",
            label: "🔥 Dining Now", 
            description: "Currently at tables",
            priority: "high" as const
        },
        {
            id: "arriving",
            label: "⏰ Arriving Soon",
            description: "Next 2 hours",
            priority: "medium" as const
        },
        {
            id: "completed",
            label: "✅ Done Today",
            description: "Finished dining",
            priority: "low" as const
        },
        {
            id: "upcoming",
            label: "📅 Tomorrow+",
            description: "Future confirmed",
            priority: "low" as const
        }
    ];

    const getCurrentWeekRange = () => {
        const startOfWeek = restaurantNow.startOf('week');
        const endOfWeek = restaurantNow.endOf('week');
        return {
            start: startOfWeek.toJSDate(),
            end: endOfWeek.toJSDate()
        };
    };

    const getNextWeekRange = () => {
        const nextWeekStart = restaurantNow.plus({ weeks: 1 }).startOf('week');
        const nextWeekEnd = restaurantNow.plus({ weeks: 1 }).endOf('week');
        return {
            start: nextWeekStart.toJSDate(),
            end: nextWeekEnd.toJSDate()
        };
    };

    // ✅ Restaurant reservations query with timezone dependency
    const { data: reservations, isLoading, error } = useQuery({
        queryKey: ["/api/reservations", restaurantId, restaurantTimezone, dateRangeFilter, statusFilter],
        queryFn: async () => {
            try {
                const params = new URLSearchParams({
                    timezone: restaurantTimezone,
                    restaurantId: restaurantId.toString()
                });
                
                if (dateRangeFilter.type === 'today') {
                    params.append('date', restaurantNow.toISODate()!);
                }
                
                const url = `/api/reservations?${params.toString()}`;
                
                const response = await fetch(url, {
                    credentials: "include"
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Failed to fetch reservations: ${response.status} ${errorText}`);
                }
                
                const data = await response.json();
                return data;
            } catch (error) {
                console.error("❌ [API Query] Error fetching reservations:", error);
                throw error;
            }
        },
        refetchInterval: 30000,
        refetchOnWindowFocus: true,
        enabled: !!restaurantId && !!restaurantTimezone,
        staleTime: 0,
        cacheTime: 1000 * 60 * 5,
    });

    // ✅ Refresh reservations when restaurant timezone changes
    useEffect(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
    }, [restaurant?.timezone, queryClient]);

    // ✅ Enhanced smart tab filtering with reactive timezone
    const getSmartTabReservations = (tabId: string, allReservations: any[]) => {
        if (!allReservations || allReservations.length === 0) {
            return [];
        }

        // ✅ For "all" tab, show EVERYTHING except canceled
        if (tabId === "all") {
            const filtered = allReservations.filter((reservationData) => {
                const { reservation } = extractReservationData(reservationData);
                return reservation.status !== 'canceled';
            });
            
            return filtered;
        }

        // ✅ For other tabs, apply smart filtering with reactive timezone
        return allReservations.filter((reservationData) => {
            const { reservation } = extractReservationData(reservationData);

            // ✅ SAFE timestamp parsing with fallback
            const reservationDateTime = parsePostgresTimestamp(reservation.reservation_utc);
            if (!reservationDateTime) {
                return true; // ✅ INCLUDE instead of EXCLUDE invalid timestamps
            }

            const localDateTime = reservationDateTime.setZone(restaurantTimezone);
            const duration = reservation.duration || 120;
            const endDateTime = localDateTime.plus({ minutes: duration });

            switch (tabId) {
                case "attention":
                    const isLate = localDateTime < restaurantNow &&
                        restaurantNow.diff(localDateTime, 'minutes').minutes > 15;
                    const needsAttention = (
                        reservation.status === 'created' ||
                        (reservation.status === 'confirmed' && isLate && endDateTime > restaurantNow)
                    );
                    return needsAttention;

                case "active":
                    const isActive = (
                        reservation.status === 'confirmed' &&
                        localDateTime <= restaurantNow &&
                        endDateTime > restaurantNow
                    );
                    return isActive;

                case "arriving":
                    const isArriving = (
                        reservation.status === 'confirmed' &&
                        localDateTime > restaurantNow &&
                        localDateTime <= restaurantNow.plus({ hours: 2 })
                    );
                    return isArriving;

                case "completed":
                    const isCompleted = (
                        reservation.status === 'completed' ||
                        (reservation.status === 'confirmed' && endDateTime < restaurantNow)
                    );
                    return isCompleted;

                case "upcoming":
                    const isUpcoming = (
                        reservation.status === 'confirmed' &&
                        localDateTime.startOf('day') > restaurantNow.startOf('day')
                    );
                    return isUpcoming;

                default:
                    return true;
            }
        });
    };

    const getSmartActions = (reservation: any, guest: any) => {
        const status = reservation.status;
        
        // ✅ Safe timestamp parsing
        const reservationDateTime = parsePostgresTimestamp(reservation.reservation_utc);
        if (!reservationDateTime) {
            // Return basic actions even if timestamp is invalid
            return [
                {
                    type: "edit",
                    label: "Edit",
                    icon: Edit,
                    action: () => {
                        setSelectedReservationId(reservation.id);
                        setIsReservationModalOpen(true);
                    },
                    variant: "outline" as const,
                    priority: "medium" as const
                }
            ];
        }

        const localDateTime = reservationDateTime.setZone(restaurantTimezone);
        const duration = reservation.duration || 120;
        const endDateTime = localDateTime.plus({ minutes: duration });

        const isToday = localDateTime.hasSame(restaurantNow, 'day');
        const isPast = localDateTime.startOf('day') < restaurantNow.startOf('day');
        const isFuture = localDateTime.startOf('day') > restaurantNow.startOf('day');

        const hasArrived = isToday && localDateTime <= restaurantNow;
        const isLate = isToday && hasArrived && restaurantNow.diff(localDateTime, 'minutes').minutes > 15;
        const isDining = isToday && hasArrived && endDateTime > restaurantNow;
        const hasFinished = isToday && endDateTime < restaurantNow;
        const isArriving = isToday && !hasArrived && localDateTime <= restaurantNow.plus({ hours: 2 });

        const actions = [];

        if (guest.phone) {
            actions.push({
                type: "phone",
                label: "Call",
                icon: Phone,
                action: () => window.open(`tel:${guest.phone}`, '_self'),
                variant: "outline" as const,
                priority: "low" as const
            });
        }

        if (guest.email) {
            actions.push({
                type: "email",
                label: "Email",
                icon: Mail,
                action: () => window.open(`mailto:${guest.email}`, '_self'),
                variant: "outline" as const,
                priority: "low" as const
            });
        }

        actions.push({
            type: "edit",
            label: "Edit",
            icon: Edit,
            action: () => {
                setSelectedReservationId(reservation.id);
                setIsReservationModalOpen(true);
            },
            variant: "outline" as const,
            priority: "medium" as const
        });

        if (status === 'created') {
            actions.unshift({
                type: "confirm",
                label: "✅ Confirm AI Booking",
                icon: UserCheck,
                action: () => handleConfirmReservation(reservation.id),
                variant: "default" as const,
                priority: "critical" as const,
                className: "bg-green-600 hover:bg-green-700 text-white"
            });
        }

        if (status === 'confirmed' && isToday) {
            if (!hasArrived && isArriving) {
                actions.unshift({
                    type: "prepare",
                    label: "🍽️ Prepare Table",
                    icon: Users,
                    action: () => toast({ title: "Table Preparation", description: "Mark table as being prepared" }),
                    variant: "default" as const,
                    priority: "high" as const,
                    className: "bg-blue-600 hover:bg-blue-700 text-white"
                });
            } else if (hasArrived && !isDining) {
                actions.unshift({
                    type: "arrived",
                    label: isLate ? "⚠️ Mark Arrived (Late)" : "👋 Mark Arrived",
                    icon: UserCheck,
                    action: () => toast({ title: "Guest Arrived", description: "Guest marked as arrived" }),
                    variant: isLate ? "destructive" : "default" as const,
                    priority: "critical" as const
                });
            } else if (isDining) {
                actions.unshift({
                    type: "complete",
                    label: "✅ Mark Completed",
                    icon: Users,
                    action: () => {
                        handleStatusUpdate(reservation.id, 'completed');
                    },
                    variant: "default" as const,
                    priority: "medium" as const,
                    className: "bg-green-600 hover:bg-green-700 text-white"
                });
            }

            if (isLate && !isDining) {
                actions.push({
                    type: "noshow",
                    label: "❌ Mark No-Show",
                    icon: XCircle,
                    action: () => {
                        if (confirm("Mark this reservation as no-show? This cannot be undone.")) {
                            handleStatusUpdate(reservation.id, 'canceled');
                        }
                    },
                    variant: "destructive" as const,
                    priority: "medium" as const
                });
            }
        }

        if (status === 'confirmed' && isFuture) {
            actions.push({
                type: "cancel",
                label: "Cancel",
                icon: XCircle,
                action: () => handleCancelReservation(reservation.id),
                variant: "outline" as const,
                priority: "low" as const,
                className: "text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
            });
        }

        if (isPast || hasFinished) {
            return actions.filter(action => ['phone', 'email', 'edit'].includes(action.type));
        }

        return actions;
    };

    const SmartActionButtons = ({ reservation, guest }: { reservation: any, guest: any }) => {
        const actions = getSmartActions(reservation, guest);
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const sortedActions = actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
        const visibleActions = sortedActions.slice(0, 4);
        const hiddenActions = sortedActions.slice(4);

        return (
            <div className="flex items-center space-x-2">
                {visibleActions.map((action) => (
                    <Button
                        key={action.type}
                        variant={action.variant}
                        size="sm"
                        onClick={action.action}
                        className={cn(action.className)}
                        title={action.label}
                    >
                        <action.icon className="h-4 w-4" />
                        <span className="sr-only">{action.label}</span>
                    </Button>
                ))}

                {hiddenActions.length > 0 && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {hiddenActions.map((action) => (
                                <DropdownMenuItem
                                    key={action.type}
                                    onClick={action.action}
                                    className="flex items-center gap-2"
                                >
                                    <action.icon className="h-4 w-4" />
                                    {action.label}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        );
    };

    const SmartStatusBadge = ({ reservation }: { reservation: any }) => {
        const status = reservation.status;
        
        // ✅ Safe timestamp parsing
        const reservationDateTime = parsePostgresTimestamp(reservation.reservation_utc);
        if (!reservationDateTime) {
            return renderStatusBadge(status);
        }

        const localDateTime = reservationDateTime.setZone(restaurantTimezone);
        const duration = reservation.duration || 120;
        const endDateTime = localDateTime.plus({ minutes: duration });
        const isToday = localDateTime.hasSame(restaurantNow, 'day');
        const hasArrived = isToday && localDateTime <= restaurantNow;
        const isLate = isToday && hasArrived && restaurantNow.diff(localDateTime, 'minutes').minutes > 15;
        const isDining = isToday && hasArrived && endDateTime > restaurantNow;

        if (status === 'created') {
            return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">🤖 AI Booking</Badge>;
        }

        if (status === 'confirmed' && isToday) {
            if (isDining) {
                return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">🍽️ Dining Now</Badge>;
            } else if (isLate) {
                return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">⚠️ Late Arrival</Badge>;
            } else if (hasArrived) {
                return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">👋 Arrived</Badge>;
            }
        }

        return renderStatusBadge(status);
    };

    const renderStatusBadge = (status: string) => {
        switch (status) {
            case 'confirmed':
                return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">🟢 Confirmed</Badge>;
            case 'created':
                return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">🟡 Pending</Badge>;
            case 'canceled':
                return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">🔴 Cancelled</Badge>;
            case 'completed':
                return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">✅ Completed</Badge>;
            default:
                return <Badge>{status}</Badge>;
        }
    };

    const SmartTabButton = ({ tab, isActive, count, onClick }: {
        tab: typeof smartTabs[0],
        isActive: boolean,
        count: number,
        onClick: () => void
    }) => (
        <Button
            variant={isActive ? "default" : "outline"}
            onClick={onClick}
            className={cn(
                "relative flex-1 min-w-0 h-auto py-3",
                tab.priority === "critical" && !isActive && "border-orange-200 hover:border-orange-300",
                tab.priority === "critical" && isActive && "bg-orange-600 hover:bg-orange-700",
                tab.priority === "high" && !isActive && "border-blue-200 hover:border-blue-300",
                tab.priority === "high" && isActive && "bg-blue-600 hover:bg-blue-700"
            )}
        >
            <div className="text-center min-w-0 w-full">
                <div className="flex items-center justify-center gap-1 mb-1">
                    <span className="truncate text-sm font-medium">{tab.label}</span>
                    {count > 0 && (
                        <Badge
                            variant={isActive ? "secondary" : "outline"}
                            className="ml-1 text-xs px-1.5 min-w-[1.5rem] h-5"
                        >
                            {count}
                        </Badge>
                    )}
                </div>
                <div className="text-xs opacity-75 truncate">
                    {tab.description}
                </div>
            </div>
        </Button>
    );

    // ✅ Apply smart filtering with reactive timezone
    const smartFilteredReservations = reservations
        ? getSmartTabReservations(activeSmartTab, reservations)
        : [];

    // ✅ Enhanced final filtering with reactive timezone
    const finalFilteredReservations = smartFilteredReservations.filter((reservationData: any) => {
        const { reservation, guest } = extractReservationData(reservationData);

        let statusMatch = true;
        if (statusFilter !== "all") {
            statusMatch = reservation.status === statusFilter;
        }

        let dateMatch = true;
        if (dateRangeFilter.type !== 'default') {
            const reservationDateTime = parsePostgresTimestamp(reservation.reservation_utc);
            
            if (reservationDateTime) {
                const localDateTime = reservationDateTime.setZone(restaurantTimezone);
                
                if (dateRangeFilter.type === 'today') {
                    dateMatch = localDateTime.hasSame(restaurantNow, 'day');
                } else if (dateRangeFilter.type === 'thisWeek' || dateRangeFilter.type === 'nextWeek') {
                    if (dateRangeFilter.startDate && dateRangeFilter.endDate) {
                        const startDate = DateTime.fromJSDate(dateRangeFilter.startDate);
                        const endDate = DateTime.fromJSDate(dateRangeFilter.endDate);
                        dateMatch = localDateTime >= startDate && localDateTime <= endDate;
                    }
                } else if (dateRangeFilter.type === 'custom' && selectedDate) {
                    const selectedDateTime = DateTime.fromJSDate(selectedDate);
                    dateMatch = localDateTime.hasSame(selectedDateTime, 'day');
                }
            } else {
                dateMatch = true;
            }
        } else if (selectedDate) {
            const reservationDateTime = parsePostgresTimestamp(reservation.reservation_utc);
            if (reservationDateTime) {
                const localDateTime = reservationDateTime.setZone(restaurantTimezone);
                const selectedDateTime = DateTime.fromJSDate(selectedDate);
                dateMatch = localDateTime.hasSame(selectedDateTime, 'day');
            } else {
                dateMatch = true;
            }
        }

        let searchMatch = true;
        if (searchQuery) {
            const searchLower = searchQuery.toLowerCase();
            searchMatch =
                (guest.name || '').toLowerCase().includes(searchLower) ||
                (guest.phone || reservation.phone || '').toLowerCase().includes(searchLower) ||
                (reservation.comments || '').toLowerCase().includes(searchLower);
        }

        return statusMatch && dateMatch && searchMatch;
    });

    // ✅ Tab counts calculation with reactive timezone
    const tabCounts = smartTabs.reduce((acc, tab) => {
        const count = getSmartTabReservations(tab.id, reservations || []).length;
        acc[tab.id] = count;
        return acc;
    }, {} as Record<string, number>);

    // ✅ Today reservations calculation with reactive timezone
    const todayReservations = reservations ? reservations.filter((reservationData: any) => {
        const { reservation } = extractReservationData(reservationData);
        const reservationDateTime = parsePostgresTimestamp(reservation.reservation_utc);
        
        if (!reservationDateTime) return false;
        
        const localDateTime = reservationDateTime.setZone(restaurantTimezone);
        return localDateTime.hasSame(restaurantNow, 'day') && reservation.status !== 'canceled';
    }) : [];

    const confirmReservationMutation = useMutation({
        mutationFn: async (id: number) => {
            const response = await apiRequest("PATCH", `/api/reservations/${id}`, {
                status: "confirmed"
            });
            return response.json();
        },
        onSuccess: () => {
            toast({
                title: "Success",
                description: "Reservation confirmed successfully",
            });
            queryClient.invalidateQueries({ queryKey: ['/api/reservations'] });
        },
        onError: (error: any) => {
            toast({
                title: "Error",
                description: `Failed to confirm reservation: ${error.message}`,
                variant: "destructive",
            });
        }
    });

    const cancelReservationMutation = useMutation({
        mutationFn: async (id: number) => {
            const response = await apiRequest("PATCH", `/api/reservations/${id}`, {
                status: "canceled"
            });
            return response.json();
        },
        onSuccess: () => {
            toast({
                title: "Success",
                description: "Reservation canceled successfully",
            });
            queryClient.invalidateQueries({ queryKey: ['/api/reservations'] });
        },
        onError: (error: any) => {
            toast({
                title: "Error",
                description: `Failed to cancel reservation: ${error.message}`,
                variant: "destructive",
            });
        }
    });

    const handleConfirmReservation = (id: number) => {
        confirmReservationMutation.mutate(id);
    };

    const handleCancelReservation = (id: number) => {
        cancelReservationMutation.mutate(id);
    };

    const handleStatusUpdate = async (reservationId: number, newStatus: string) => {
        try {
            const response = await apiRequest("PATCH", `/api/reservations/${reservationId}`, {
                status: newStatus
            });

            if (!response.ok) throw new Error('Failed to update status');

            toast({
                title: "Status Updated",
                description: `Reservation marked as ${newStatus}`,
            });

            queryClient.invalidateQueries({ queryKey: ['/api/reservations'] });
        } catch (error: any) {
            toast({
                title: "Error",
                description: `Failed to update status: ${error.message}`,
                variant: "destructive",
            });
        }
    };

    if (error) {
        return (
            <DashboardLayout>
                <div className="px-4 py-6 lg:px-8">
                    <div className="text-center py-8">
                        <p className="text-red-600">Error loading reservations: {error.message}</p>
                        <Button onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/reservations'] })} className="mt-4">
                            Retry
                        </Button>
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <div className="px-4 py-6 lg:px-8">
                <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Reservations Management</h1>
                        {/* ✅ CRITICAL FIX: Remove duplicate timezone display - let DashboardLayout handle it */}
                        <p className="text-xs text-gray-400">
                            Showing {finalFilteredReservations.length} reservations
                            {reservations && ` (${reservations.length} total in system)`}
                            {statusFilter !== 'all' && ` • Status: ${statusFilter}`}
                            {dateRangeFilter.type !== 'default' && ` • ${dateRangeFilter.displayText}`}
                            {selectedDate && dateRangeFilter.type === 'default' && ` • ${format(selectedDate, 'MMM d, yyyy')}`}
                        </p>
                    </div>
                    <div className="mt-4 flex space-x-3 md:mt-0">
                        <Button onClick={() => setIsReservationModalOpen(true)}>
                            <Plus className="mr-2 h-4 w-4" />
                            New Reservation
                        </Button>
                        <Button 
                            variant="outline" 
                            onClick={() => {
                                refreshRestaurant();
                                queryClient.invalidateQueries({ queryKey: ['/api/reservations'] });
                            }}
                        >
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    </div>
                </header>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
                    <div className="lg:col-span-1">
                        <Card>
                            <CardHeader>
                                <CardTitle>Filters</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div>
                                    <label className="text-sm font-medium text-gray-700 mb-3 block">Restaurant Workflow</label>
                                    <div className="grid grid-cols-1 gap-2">
                                        {smartTabs.map(tab => (
                                            <SmartTabButton
                                                key={tab.id}
                                                tab={tab}
                                                isActive={activeSmartTab === tab.id}
                                                count={tabCounts[tab.id]}
                                                onClick={() => setActiveSmartTab(tab.id)}
                                            />
                                        ))}
                                    </div>

                                    {tabCounts.attention > 0 && activeSmartTab !== "attention" && (
                                        <Alert className="border-orange-200 bg-orange-50 mt-3">
                                            <AlertCircle className="h-4 w-4 text-orange-600" />
                                            <AlertDescription className="text-orange-800">
                                                {tabCounts.attention} reservation{tabCounts.attention > 1 ? 's' : ''} need{tabCounts.attention === 1 ? 's' : ''} your attention
                                            </AlertDescription>
                                        </Alert>
                                    )}
                                </div>

                                <div>
                                    <label className="text-sm font-medium text-gray-700">Status</label>
                                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                                        <SelectTrigger className="mt-2">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Status</SelectItem>
                                            <SelectItem value="created">Pending</SelectItem>
                                            <SelectItem value="confirmed">Confirmed</SelectItem>
                                            <SelectItem value="canceled">Cancelled</SelectItem>
                                            <SelectItem value="completed">Completed</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div>
                                    <label className="text-sm font-medium text-gray-700">Date Selection</label>
                                    <div className="mt-2 space-y-3">
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                variant={dateRangeFilter.type === 'today' ? 'default' : 'outline'}
                                                size="sm"
                                                onClick={() => {
                                                    const todayJs = restaurantNow.toJSDate();
                                                    setDateRangeFilter({
                                                        type: 'today',
                                                        startDate: todayJs,
                                                        endDate: todayJs,
                                                        displayText: 'Today'
                                                    });
                                                    setSelectedDate(todayJs);
                                                }}
                                                className="text-xs"
                                            >
                                                Today
                                            </Button>
                                            <Button
                                                variant={dateRangeFilter.type === 'thisWeek' ? 'default' : 'outline'}
                                                size="sm"
                                                onClick={() => {
                                                    const { start, end } = getCurrentWeekRange();
                                                    setDateRangeFilter({
                                                        type: 'thisWeek',
                                                        startDate: start,
                                                        endDate: end,
                                                        displayText: `This Week (${format(start, 'MMM d')}-${format(end, 'd')})`
                                                    });
                                                    setSelectedDate(undefined);
                                                }}
                                                className="text-xs"
                                            >
                                                This Week
                                            </Button>
                                            <Button
                                                variant={dateRangeFilter.type === 'nextWeek' ? 'default' : 'outline'}
                                                size="sm"
                                                onClick={() => {
                                                    const { start, end } = getNextWeekRange();
                                                    setDateRangeFilter({
                                                        type: 'nextWeek',
                                                        startDate: start,
                                                        endDate: end,
                                                        displayText: `Next Week (${format(start, 'MMM d')}-${format(end, 'd')})`
                                                    });
                                                    setSelectedDate(undefined);
                                                }}
                                                className="text-xs"
                                            >
                                                Next Week
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setIsCalendarModalOpen(true)}
                                                className="text-xs"
                                            >
                                                📅 More
                                            </Button>
                                        </div>

                                        {(dateRangeFilter.type !== 'default' || selectedDate) && (
                                            <div className="flex items-center justify-between p-2 bg-blue-50 rounded-md">
                                                <span className="text-sm text-blue-900">
                                                    Selected: {dateRangeFilter.type !== 'default' ? dateRangeFilter.displayText : selectedDate && format(selectedDate, 'MMM d, yyyy')}
                                                </span>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        setDateRangeFilter({ type: 'default', displayText: 'Default View' });
                                                        setSelectedDate(undefined);
                                                    }}
                                                    className="h-6 w-6 p-0 text-blue-600 hover:text-blue-800"
                                                >
                                                    ×
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <label className="text-sm font-medium text-gray-700">Search</label>
                                    <div className="relative mt-2">
                                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                        <Input
                                            placeholder="Search guests, phone..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="pl-9"
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="mt-4">
                            <CardHeader>
                                <CardTitle>Today's Overview</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span>Total Reservations:</span>
                                        <span className="font-medium">{todayReservations.length}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span>Confirmed:</span>
                                        <span className="font-medium text-green-600">
                                            {todayReservations.filter((r: any) => {
                                                const { reservation } = extractReservationData(r);
                                                return reservation.status === 'confirmed';
                                            }).length}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span>Pending:</span>
                                        <span className="font-medium text-yellow-600">
                                            {todayReservations.filter((r: any) => {
                                                const { reservation } = extractReservationData(r);
                                                return reservation.status === 'created';
                                            }).length}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span>Need Attention:</span>
                                        <span className="font-medium text-orange-600">
                                            {tabCounts.attention}
                                        </span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="lg:col-span-3">
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <CardTitle>
                                        {smartTabs.find(t => t.id === activeSmartTab)?.label || 'Reservations'}
                                        {finalFilteredReservations.length > 0 && (
                                            <Badge variant="outline" className="ml-2">
                                                {finalFilteredReservations.length}
                                            </Badge>
                                        )}
                                    </CardTitle>
                                    {isLoading && (
                                        <RefreshCw className="h-4 w-4 animate-spin text-gray-400" />
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent>
                                {isLoading ? (
                                    <div className="flex justify-center py-8">
                                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-900 border-t-transparent"></div>
                                    </div>
                                ) : finalFilteredReservations.length > 0 ? (
                                    <div className="space-y-4">
                                        {finalFilteredReservations.map((reservationData: any) => {
                                            const { reservation, guest, table } = extractReservationData(reservationData);

                                            // ✅ Safe time display with reactive restaurant timezone
                                            const displayTime = (() => {
                                                const dateTime = parsePostgresTimestamp(reservation.reservation_utc);
                                                if (dateTime) {
                                                    const local = dateTime.setZone(restaurantTimezone);
                                                    return {
                                                        time: local.toFormat('HH:mm'),
                                                        date: local.toFormat('MMM d, yyyy')
                                                    };
                                                }
                                                return {
                                                    time: 'Invalid time',
                                                    date: 'Invalid date'
                                                };
                                            })();

                                            return (
                                                <div key={reservation.id} className="rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center space-x-4">
                                                            <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-700">
                                                                <UserCheck className="h-5 w-5" />
                                                            </div>
                                                            <div>
                                                                <h3 className="font-medium text-gray-900">
                                                                    {guest.name}
                                                                </h3>
                                                                <p className="text-sm text-gray-500">
                                                                    {guest.phone || 'No phone provided'}
                                                                </p>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center space-x-6">
                                                            <div className="text-center">
                                                                <p className="text-sm font-medium text-gray-900 flex items-center gap-1">
                                                                    <Clock className="h-4 w-4" />
                                                                    {displayTime.time}
                                                                </p>
                                                                <p className="text-xs text-gray-500">
                                                                    {displayTime.date}
                                                                </p>
                                                            </div>

                                                            <div className="text-center">
                                                                <p className="text-sm font-medium text-gray-900">
                                                                    {table.name || `Table ${reservation.tableId}` || 'Table not assigned'}
                                                                </p>
                                                                <p className="text-xs text-gray-500 flex items-center gap-1">
                                                                    <Users className="h-3 w-3" />
                                                                    {reservation.guests} guests
                                                                </p>
                                                            </div>

                                                            <div>
                                                                <SmartStatusBadge reservation={reservation} />
                                                            </div>

                                                            <SmartActionButtons reservation={reservation} guest={guest} />
                                                        </div>
                                                    </div>

                                                    {reservation.comments && (
                                                        <div className="mt-3 pt-3 border-t border-gray-100">
                                                            <p className="text-sm text-gray-600">
                                                                <span className="font-medium">Note:</span> {reservation.comments}
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-center py-8">
                                        <CalendarIcon className="mx-auto h-12 w-12 text-gray-400" />
                                        <h3 className="mt-2 text-sm font-medium text-gray-900">No reservations found</h3>
                                        <p className="mt-1 text-sm text-gray-500">
                                            {searchQuery || statusFilter !== 'all' || activeSmartTab !== 'all'
                                                ? 'Try adjusting your filters or tab selection'
                                                : 'Get started by creating a new reservation.'}
                                        </p>
                                        {!isLoading && reservations && reservations.length > 0 && (
                                            <div className="mt-2 text-xs text-gray-400 space-y-1">
                                                <p>({reservations.length} total reservation{reservations.length !== 1 ? 's' : ''} in system)</p>
                                                <p>Smart tab: {activeSmartTab} ({smartFilteredReservations.length} after smart filter)</p>
                                                <p>Current filters: Status={statusFilter}, Date={dateRangeFilter.type}, Search="{searchQuery}"</p>
                                                <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    onClick={() => {
                                                        setActiveSmartTab("all");
                                                        setStatusFilter("all");
                                                        setDateRangeFilter({ type: 'default', displayText: 'Default View' });
                                                        setSearchQuery("");
                                                        setSelectedDate(undefined);
                                                    }}
                                                    className="mt-2"
                                                >
                                                    Clear All Filters
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>

                <Dialog open={isCalendarModalOpen} onOpenChange={setIsCalendarModalOpen}>
                    <DialogContent className="max-w-4xl">
                        <DialogHeader>
                            <DialogTitle>Select Dates</DialogTitle>
                        </DialogHeader>
                        <div className="mt-4">
                            <RollingCalendar
                                selectedDates={selectedDate ? [selectedDate] : []}
                                onDateSelect={(dates) => {
                                    if (dates.length > 0) {
                                        setSelectedDate(dates[0]);
                                        setDateRangeFilter({
                                            type: 'custom',
                                            startDate: dates[0],
                                            endDate: dates[0],
                                            displayText: format(dates[0], 'MMM d, yyyy')
                                        });
                                        setIsCalendarModalOpen(false);
                                    }
                                }}
                                capacityData={{}}
                            />
                            <div className="mt-4 text-center text-sm text-gray-600">
                                💡 Click dates to select, Ctrl+Click for multiple dates
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>

                <ReservationModal
                    isOpen={isReservationModalOpen}
                    onClose={() => {
                        setIsReservationModalOpen(false);
                        setSelectedReservationId(undefined);
                    }}
                    reservationId={selectedReservationId}
                    restaurantId={restaurantId}
                    restaurantTimezone={restaurantTimezone}
                />
            </div>
        </DashboardLayout>
    );
}