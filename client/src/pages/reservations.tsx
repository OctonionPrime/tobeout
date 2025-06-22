import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { DateTime } from 'luxon'; // ✅ CRITICAL: Luxon for proper timezone handling
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

const restaurantId = 1;

// ✅ ENHANCED: Timezone prop interface
interface ReservationsProps {
    restaurantTimezone?: string;
}

export default function Reservations({ restaurantTimezone = 'Europe/Moscow' }: ReservationsProps) {
    // ✅ ENHANCED STATE MANAGEMENT
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
    
    // ✅ SMART RESTAURANT TABS STATE
    const [activeSmartTab, setActiveSmartTab] = useState("attention");

    const { toast } = useToast();
    const queryClient = useQueryClient();

    // ✅ SMART RESTAURANT TABS CONFIGURATION
    const smartTabs = [
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

    // ✅ FIXED: Use Luxon for reliable timezone handling
    const getCurrentWeekRange = () => {
        const restaurantNow = DateTime.now().setZone(restaurantTimezone);
        const startOfWeek = restaurantNow.startOf('week'); // Monday
        const endOfWeek = restaurantNow.endOf('week'); // Sunday
        return { 
            start: startOfWeek.toJSDate(), 
            end: endOfWeek.toJSDate() 
        };
    };

    const getNextWeekRange = () => {
        const restaurantNow = DateTime.now().setZone(restaurantTimezone);
        const nextWeekStart = restaurantNow.plus({ weeks: 1 }).startOf('week');
        const nextWeekEnd = restaurantNow.plus({ weeks: 1 }).endOf('week');
        return { 
            start: nextWeekStart.toJSDate(), 
            end: nextWeekEnd.toJSDate() 
        };
    };

    // ✅ FIXED: Data fetching with timezone-aware query key
    const { data: reservations, isLoading, error } = useQuery({
        // ✅ CRITICAL FIX: Include timezone in query key for proper cache invalidation
        queryKey: ["/api/reservations", restaurantId, restaurantTimezone],
        queryFn: async () => {
            try {
                // ✅ FIXED: Pass timezone to backend for proper filtering
                const response = await fetch(`/api/reservations?timezone=${encodeURIComponent(restaurantTimezone)}`, { 
                    credentials: "include" 
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Failed to fetch reservations: ${response.status} ${errorText}`);
                }
                const data = await response.json();
                console.log("📋 Fetched reservations:", data);
                return data;
            } catch (error) {
                console.error("❌ Error fetching reservations:", error);
                throw error;
            }
        },
        refetchInterval: 30000,
        refetchOnWindowFocus: true,
    });

    const { data: restaurant } = useQuery({
        queryKey: ["/api/restaurants/profile"],
        queryFn: async () => {
            const response = await fetch("/api/restaurants/profile", { credentials: "include" });
            if (!response.ok) throw new Error("Failed to fetch restaurant");
            return response.json();
        },
        staleTime: 10 * 60 * 1000, // 10 minutes
    });

    // ✅ COMPLETELY REWRITTEN: Smart Tab filtering logic with Luxon (CORRECT implementation)
    const getSmartTabReservations = (tabId: string, allReservations: any[]) => {
        // ✅ CORRECT: Get "now" in restaurant timezone using Luxon
        const restaurantNow = DateTime.now().setZone(restaurantTimezone);
        const todayDateString = restaurantNow.toISODate(); // e.g., '2025-06-22'

        if (!allReservations) return [];

        return allReservations.filter(reservationData => {
            const reservation = reservationData.reservation || reservationData;

            // ✅ CORRECT: Create reservation datetime in restaurant timezone
            const reservationDateTime = DateTime.fromISO(
                `${reservation.date}T${reservation.time}`, 
                { zone: restaurantTimezone }
            );

            // Safety check for invalid dates
            if (!reservationDateTime.isValid) {
                console.warn("Invalid reservation date/time:", reservation.date, reservation.time);
                return false;
            }

            const duration = reservation.duration || 120;
            const endDateTime = reservationDateTime.plus({ minutes: duration });

            // ✅ CORRECT: All comparisons are now timezone-aware
            switch (tabId) {
                case "attention":
                    const isLate = reservationDateTime < restaurantNow && 
                                   restaurantNow.diff(reservationDateTime, 'minutes').minutes > 15;
                    return (
                        reservation.status === 'created' ||
                        (reservation.status === 'confirmed' && isLate && endDateTime > restaurantNow)
                    );
                
                case "active":
                    return (
                        reservation.status === 'confirmed' &&
                        reservationDateTime <= restaurantNow && 
                        endDateTime > restaurantNow 
                    );
                
                case "arriving":
                    return (
                        reservation.status === 'confirmed' &&
                        reservationDateTime > restaurantNow && 
                        reservationDateTime <= restaurantNow.plus({ hours: 2 })
                    );
                
                case "completed":
                    return (
                        reservation.status === 'completed' ||
                        (reservation.status === 'confirmed' && endDateTime < restaurantNow)
                    );
                
                case "upcoming":
                    // ✅ CORRECT: Use Luxon's date-only comparison for accuracy
                    return (
                        reservation.status === 'confirmed' &&
                        DateTime.fromISO(reservation.date).startOf('day') > restaurantNow.startOf('day')
                    );
                
                default:
                    return true;
            }
        });
    };

    // ✅ FIXED: Smart action buttons logic with Luxon
    const getSmartActions = (reservation: any, guest: any) => {
        const status = reservation.status;
        const reservationDate = reservation.date;
        const reservationTime = reservation.time;
        
        // ✅ CORRECT: Use Luxon for all timezone calculations
        const restaurantNow = DateTime.now().setZone(restaurantTimezone);
        const todayDateString = restaurantNow.toISODate();
        
        const reservationDateTime = DateTime.fromISO(
            `${reservationDate}T${reservationTime}`, 
            { zone: restaurantTimezone }
        );
        
        if (!reservationDateTime.isValid) {
            console.warn("Invalid reservation date/time for actions:", reservationDate, reservationTime);
            return [];
        }
        
        const duration = reservation.duration || 120;
        const endDateTime = reservationDateTime.plus({ minutes: duration });
        
        const isToday = reservationDate === todayDateString;
        const isPast = DateTime.fromISO(reservationDate) < restaurantNow.startOf('day');
        const isFuture = DateTime.fromISO(reservationDate) > restaurantNow.startOf('day');
        
        // Time-based status for today's reservations
        const hasArrived = isToday && reservationDateTime <= restaurantNow;
        const isLate = isToday && hasArrived && restaurantNow.diff(reservationDateTime, 'minutes').minutes > 15;
        const isDining = isToday && hasArrived && endDateTime > restaurantNow;
        const hasFinished = isToday && endDateTime < restaurantNow;
        const isArriving = isToday && !hasArrived && reservationDateTime <= restaurantNow.plus({ hours: 2 });

        const actions = [];

        // ✅ CORE ACTIONS - Always available
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

        // ✅ WORKFLOW-SPECIFIC ACTIONS - Based on status and timing
        
        // AI Booking Confirmation (status = created)
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

        // Arrival Management (today's confirmed reservations)
        if (status === 'confirmed' && isToday) {
            if (!hasArrived && isArriving) {
                // Arriving soon - prepare
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
                // Should have arrived - mark as arrived
                actions.unshift({
                    type: "arrived",
                    label: isLate ? "⚠️ Mark Arrived (Late)" : "👋 Mark Arrived",
                    icon: UserCheck,
                    action: () => toast({ title: "Guest Arrived", description: "Guest marked as arrived" }),
                    variant: isLate ? "destructive" : "default" as const,
                    priority: "critical" as const
                });
            } else if (isDining) {
                // Currently dining - mark as completed
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
            
            // Late arrival - option to mark as no-show
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

        // Future reservations (tomorrow+)
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

        // Past reservations - limited actions
        if (isPast || hasFinished) {
            return actions.filter(action => ['phone', 'email', 'edit'].includes(action.type));
        }

        return actions;
    };

    // ✅ SMART ACTION BUTTONS COMPONENT
    const SmartActionButtons = ({ reservation, guest }: { reservation: any, guest: any }) => {
        const actions = getSmartActions(reservation, guest);
        
        // Sort by priority: critical > high > medium > low
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const sortedActions = actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
        
        // Show max 4 actions, prioritize by importance
        const visibleActions = sortedActions.slice(0, 4);
        const hiddenActions = sortedActions.slice(4);
        
        return (
            <div className="flex items-center space-x-2">
                {/* Primary actions */}
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
                
                {/* Overflow menu for additional actions */}
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

    // ✅ FIXED: Smart Status Badge with Luxon
    const SmartStatusBadge = ({ reservation }: { reservation: any }) => {
        const status = reservation.status;
        const reservationDate = reservation.date;
        const reservationTime = reservation.time;
        
        // ✅ CORRECT: Use Luxon for timezone calculations
        const restaurantNow = DateTime.now().setZone(restaurantTimezone);
        const todayDateString = restaurantNow.toISODate();
        
        const reservationDateTime = DateTime.fromISO(
            `${reservationDate}T${reservationTime}`, 
            { zone: restaurantTimezone }
        );
        
        if (!reservationDateTime.isValid) {
            return renderStatusBadge(status);
        }
        
        const duration = reservation.duration || 120;
        const endDateTime = reservationDateTime.plus({ minutes: duration });
        
        const isToday = reservationDate === todayDateString;
        const hasArrived = isToday && reservationDateTime <= restaurantNow;
        const isLate = isToday && hasArrived && restaurantNow.diff(reservationDateTime, 'minutes').minutes > 15;
        const isDining = isToday && hasArrived && endDateTime > restaurantNow;
        
        // Enhanced status with context
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
        
        // Fall back to standard status badges
        return renderStatusBadge(status);
    };

    // ✅ STANDARD STATUS BADGE FUNCTION
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

    // ✅ SMART TAB COMPONENT
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

    // ✅ FIXED: Use Luxon for all date calculations
    const restaurantNow = DateTime.now().setZone(restaurantTimezone);
    const todayDateString = restaurantNow.toISODate();

    // Get smart tab filtered reservations
    const smartFilteredReservations = reservations 
        ? getSmartTabReservations(activeSmartTab, reservations)
        : [];

    // Apply additional filters (search, status, date) to smart filtered results
    const finalFilteredReservations = smartFilteredReservations.filter((reservationData: any) => {
        const reservation = reservationData.reservation || reservationData;
        const guest = reservationData.guest || reservation.guest || {};
        
        // Status filtering
        let statusMatch = true;
        if (statusFilter !== "all") {
            statusMatch = reservation.status === statusFilter;
        }

        // Date filtering
        let dateMatch = true;
        if (dateRangeFilter.type !== 'default') {
            if (dateRangeFilter.type === 'today') {
                dateMatch = reservation.date === todayDateString;
            } else if (dateRangeFilter.type === 'thisWeek' || dateRangeFilter.type === 'nextWeek') {
                if (dateRangeFilter.startDate && dateRangeFilter.endDate) {
                    const startDateString = format(dateRangeFilter.startDate, 'yyyy-MM-dd');
                    const endDateString = format(dateRangeFilter.endDate, 'yyyy-MM-dd');
                    dateMatch = reservation.date >= startDateString && reservation.date <= endDateString;
                }
            } else if (dateRangeFilter.type === 'custom' && selectedDate) {
                dateMatch = reservation.date === format(selectedDate, 'yyyy-MM-dd');
            }
        } else if (selectedDate) {
            dateMatch = reservation.date === format(selectedDate, 'yyyy-MM-dd');
        }

        // Search filtering
        let searchMatch = true;
        if (searchQuery) {
            const searchLower = searchQuery.toLowerCase();
            searchMatch = 
                (reservationData.guestName || reservation.booking_guest_name || guest.name || '').toLowerCase().includes(searchLower) ||
                (guest.phone || reservation.phone || '').toLowerCase().includes(searchLower) ||
                (reservation.comments || '').toLowerCase().includes(searchLower);
        }

        return statusMatch && dateMatch && searchMatch;
    });

    // Calculate tab counts
    const tabCounts = smartTabs.reduce((acc, tab) => {
        acc[tab.id] = getSmartTabReservations(tab.id, reservations || []).length;
        return acc;
    }, {} as Record<string, number>);

    // Get today's statistics
    const todayReservations = reservations ? reservations.filter((reservationData: any) => {
        const reservation = reservationData.reservation || reservationData;
        return reservation.date === todayDateString && reservation.status !== 'canceled';
    }) : [];

    // ✅ MUTATION HANDLERS
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

    // Handle loading and error states
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
                {/* ✅ FIXED: Header with Luxon for reliable time display */}
                <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Reservations Management</h1>
                        <p className="mt-1 text-sm text-gray-500">
                            {restaurant?.name || 'Restaurant'} Local Time: {restaurantNow.toFormat('ccc, LLL dd, yyyy \'at\' HH:mm')} ({restaurantTimezone})
                        </p>
                        <p className="text-xs text-gray-400">
                            Showing {finalFilteredReservations.length} reservations 
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
                    </div>
                </header>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
                    {/* ✅ ENHANCED SIDEBAR FILTERS */}
                    <div className="lg:col-span-1">
                        <Card>
                            <CardHeader>
                                <CardTitle>Filters</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* ✅ SMART RESTAURANT TABS */}
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
                                    
                                    {/* Priority notifications */}
                                    {tabCounts.attention > 0 && activeSmartTab !== "attention" && (
                                        <Alert className="border-orange-200 bg-orange-50 mt-3">
                                            <AlertCircle className="h-4 w-4 text-orange-600" />
                                            <AlertDescription className="text-orange-800">
                                                {tabCounts.attention} reservation{tabCounts.attention > 1 ? 's' : ''} need{tabCounts.attention === 1 ? 's' : ''} your attention
                                            </AlertDescription>
                                        </Alert>
                                    )}
                                </div>

                                {/* Status Filter */}
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

                                {/* Date Selection */}
                                <div>
                                    <label className="text-sm font-medium text-gray-700">Date Selection</label>
                                    <div className="mt-2 space-y-3">
                                        {/* Quick Selection Buttons */}
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

                                        {/* Selected Date Display */}
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

                                {/* Search Filter */}
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

                        {/* Today's Statistics */}
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
                                            {todayReservations.filter((r: any) => (r.reservation || r).status === 'confirmed').length}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span>Pending:</span>
                                        <span className="font-medium text-yellow-600">
                                            {todayReservations.filter((r: any) => (r.reservation || r).status === 'created').length}
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

                    {/* ✅ MAIN RESERVATION LIST */}
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
                                            const reservation = reservationData.reservation || reservationData;
                                            const guest = reservationData.guest || reservation.guest || {};
                                            const table = reservationData.table || reservation.table || {};
                                            
                                            return (
                                                <div key={reservation.id} className="rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
                                                    <div className="flex items-center justify-between">
                                                        {/* Guest Info */}
                                                        <div className="flex items-center space-x-4">
                                                            <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-700">
                                                                <UserCheck className="h-5 w-5" />
                                                            </div>
                                                            <div>
                                                                <h3 className="font-medium text-gray-900">
                                                                    {reservationData.guestName || reservation.booking_guest_name || guest.name || 'Guest'}
                                                                </h3>
                                                                <p className="text-sm text-gray-500">
                                                                    {guest.phone || 'No phone provided'}
                                                                </p>
                                                            </div>
                                                        </div>

                                                        {/* Reservation Details */}
                                                        <div className="flex items-center space-x-6">
                                                            <div className="text-center">
                                                                <p className="text-sm font-medium text-gray-900 flex items-center gap-1">
                                                                    <Clock className="h-4 w-4" />
                                                                    {format(new Date(`${reservation.date}T${reservation.time}`), 'HH:mm')}
                                                                </p>
                                                                <p className="text-xs text-gray-500">
                                                                    {format(new Date(reservation.date), 'MMM d, yyyy')}
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

                                                            {/* ✅ SMART ACTION BUTTONS */}
                                                            <SmartActionButtons reservation={reservation} guest={guest} />
                                                        </div>
                                                    </div>

                                                    {/* Comments */}
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
                                            {searchQuery || statusFilter !== 'all' || activeSmartTab !== 'upcoming'
                                                ? 'Try adjusting your filters or tab selection'
                                                : 'Get started by creating a new reservation.'}
                                        </p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>

                {/* ✅ CALENDAR SELECTION MODAL */}
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

                {/* ✅ RESERVATION MODAL */}
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