import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReservationModal } from "@/components/reservations/ReservationModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus, Calendar as CalendarIcon, Edit, Trash2, UserCheck, XCircle, Phone, Mail } from "lucide-react";
import { RollingCalendar } from "@/components/ui/rolling-calendar";

const restaurantId = 1;

export default function Reservations() {
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
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [reservationToDelete, setReservationToDelete] = useState<number | undefined>(undefined);
    const [activeTab, setActiveTab] = useState("upcoming");
    const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);

    const { toast } = useToast();
    const queryClient = useQueryClient();

    // ✅ FIXED: Week range calculations using Moscow timezone
    const getCurrentWeekRange = () => {
        const moscowTime = new Date().toLocaleString("en-US", { timeZone: "Europe/Moscow" });
        const today = new Date(moscowTime);
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay() + 1); // Monday
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6); // Sunday
        return { start: startOfWeek, end: endOfWeek };
    };

    const getNextWeekRange = () => {
        const currentWeek = getCurrentWeekRange();
        const nextWeekStart = new Date(currentWeek.end);
        nextWeekStart.setDate(nextWeekStart.getDate() + 1); // Next Monday
        const nextWeekEnd = new Date(nextWeekStart);
        nextWeekEnd.setDate(nextWeekStart.getDate() + 6); // Next Sunday
        return { start: nextWeekStart, end: nextWeekEnd };
    };

    // ✅ FIX: Improved API call with better error handling
    const { data: reservations, isLoading, error } = useQuery({
        queryKey: ["/api/reservations"],
        queryFn: async () => {
            try {
                const response = await fetch("/api/reservations", { credentials: "include" });
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

    // ✅ FIX: Get restaurant data
    const { data: restaurant } = useQuery({
        queryKey: ["/api/restaurants/profile"],
        queryFn: async () => {
            const response = await fetch("/api/restaurants/profile", { credentials: "include" });
            if (!response.ok) throw new Error("Failed to fetch restaurant");
            return response.json();
        },
        staleTime: 10 * 60 * 1000, // 10 minutes
    });

    // ✅ FIX: Moscow timezone handling
    const moscowTime = new Date().toLocaleString("en-US", { timeZone: "Europe/Moscow" });
    const moscowDate = new Date(moscowTime);
    const todayDateString = format(moscowDate, 'yyyy-MM-dd');

    // ✅ FIXED: Smart datetime-based filtering logic with proper date range support
    const filteredReservations = reservations ? reservations.filter((reservationData: any) => {
        // Extract the nested reservation object
        const reservation = reservationData.reservation || reservationData;
        const guest = reservationData.guest || reservation.guest || {};
        
        // ✅ NEW: Smart datetime-based filtering
        const reservationDate = reservation.date;
        const reservationTime = reservation.time;
        const reservationDateTime = new Date(`${reservationDate}T${reservationTime}`);
        const duration = reservation.duration || 120; // Default 2 hours
        const endDateTime = new Date(reservationDateTime.getTime() + duration * 60 * 1000);
        
        let timeMatch = true;
        if (activeTab === "upcoming") {
            // ✅ FIX: Future reservations (tomorrow and beyond) OR today's future reservations
            if (reservationDate > todayDateString) {
                timeMatch = true; // Future dates = always upcoming
            } else if (reservationDate === todayDateString) {
                timeMatch = reservationDateTime > moscowDate; // Today but not started yet
            } else {
                timeMatch = false; // Past dates = never upcoming
            }
        } else if (activeTab === "past") {
            // ✅ FIX: Past dates OR today's completed reservations
            if (reservationDate < todayDateString) {
                timeMatch = true; // Past dates = always past
            } else if (reservationDate === todayDateString) {
                timeMatch = endDateTime < moscowDate; // Today but already finished
            } else {
                timeMatch = false; // Future dates = never past
            }
        }
        // activeTab === "all" keeps timeMatch = true

        // Status filtering - works independently of time filter
        let statusMatch = true;
        if (statusFilter !== "all") {
            statusMatch = reservation.status === statusFilter;
        }

        // ✅ FIXED: Date filtering that handles both single dates and date ranges
        let dateMatch = true;
        if (dateRangeFilter.type !== 'default') {
            if (dateRangeFilter.type === 'today') {
                // Today only
                dateMatch = reservation.date === todayDateString;
            } else if (dateRangeFilter.type === 'thisWeek' || dateRangeFilter.type === 'nextWeek') {
                // Week range filtering
                if (dateRangeFilter.startDate && dateRangeFilter.endDate) {
                    const startDateString = format(dateRangeFilter.startDate, 'yyyy-MM-dd');
                    const endDateString = format(dateRangeFilter.endDate, 'yyyy-MM-dd');
                    dateMatch = reservation.date >= startDateString && reservation.date <= endDateString;
                }
            } else if (dateRangeFilter.type === 'custom' && selectedDate) {
                // Custom single date selection
                dateMatch = reservation.date === format(selectedDate, 'yyyy-MM-dd');
            }
        } else if (selectedDate) {
            // Fallback: single date selection when no range filter is active
            dateMatch = reservation.date === format(selectedDate, 'yyyy-MM-dd');
        }

        // Search filtering - ✅ FIXED: Access nested guest object
        let searchMatch = true;
        if (searchQuery) {
            const searchLower = searchQuery.toLowerCase();
            searchMatch = 
                (reservationData.guestName || reservation.booking_guest_name || guest.name || '').toLowerCase().includes(searchLower) ||
                (guest.phone || reservation.phone || '').toLowerCase().includes(searchLower) ||
                (reservation.comments || '').toLowerCase().includes(searchLower);
        }

        return timeMatch && statusMatch && dateMatch && searchMatch;
    }) : [];

    // ✅ FIX: Get today's statistics properly
    const todayReservations = reservations ? reservations.filter((reservationData: any) => {
        const reservation = reservationData.reservation || reservationData;
        return reservation.date === todayDateString && reservation.status !== 'canceled';
    }) : [];

    // Mutations for reservation management
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

    // ✅ FIX: Show loading and error states
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
                {/* Header with Moscow Time Display */}
                <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Reservations</h1>
                        <p className="mt-1 text-sm text-gray-500">
                            {restaurant?.name || 'Restaurant'} Moscow Time: {format(moscowDate, 'PPp')}
                        </p>
                        {/* ✅ FIXED: Enhanced status display with all filters */}
                        <p className="text-xs text-gray-400">
                            Showing {filteredReservations.length} reservations 
                            {activeTab !== 'all' && ` • ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}`}
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
                    {/* Sidebar Filters */}
                    <div className="lg:col-span-1">
                        <Card>
                            <CardHeader>
                                <CardTitle>Filters</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* Tab Selection */}
                                <div>
                                    <label className="text-sm font-medium text-gray-700">Time Period</label>
                                    <div className="mt-2 flex space-x-1">
                                        <Button
                                            variant={activeTab === "upcoming" ? "default" : "outline"}
                                            size="sm"
                                            onClick={() => setActiveTab("upcoming")}
                                            className="flex-1 text-xs"
                                        >
                                            Upcoming
                                        </Button>
                                        <Button
                                            variant={activeTab === "past" ? "default" : "outline"}
                                            size="sm"
                                            onClick={() => setActiveTab("past")}
                                            className="flex-1 text-xs"
                                        >
                                            Past
                                        </Button>
                                        <Button
                                            variant={activeTab === "all" ? "default" : "outline"}
                                            size="sm"
                                            onClick={() => setActiveTab("all")}
                                            className="flex-1 text-xs"
                                        >
                                            All
                                        </Button>
                                    </div>
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

                                {/* ✅ FIXED: Date Selection with proper week functionality */}
                                <div>
                                    <label className="text-sm font-medium text-gray-700">Date Selection</label>
                                    <div className="mt-2 space-y-3">
                                        {/* Quick Selection Buttons */}
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                variant={dateRangeFilter.type === 'today' ? 'default' : 'outline'}
                                                size="sm"
                                                onClick={() => {
                                                    setDateRangeFilter({
                                                        type: 'today',
                                                        startDate: moscowDate,
                                                        endDate: moscowDate,
                                                        displayText: 'Today'
                                                    });
                                                    setSelectedDate(moscowDate);
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

                        {/* ✅ FIXED: Today's Statistics using proper filtered data */}
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
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Main Reservation List */}
                    <div className="lg:col-span-3">
                        <Card>
                            <CardHeader>
                                <CardTitle>
                                    {activeTab === 'upcoming' ? 'Upcoming' : activeTab === 'past' ? 'Past' : 'All'} Reservations
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {isLoading ? (
                                    <div className="flex justify-center py-8">
                                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-900 border-t-transparent"></div>
                                    </div>
                                ) : filteredReservations.length > 0 ? (
                                    <div className="space-y-4">
                                        {/* ✅ FIXED: Handle nested reservation structure in JSX */}
                                        {filteredReservations.map((reservationData: any) => {
                                            // Extract the nested objects
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
                                                                <p className="text-sm font-medium text-gray-900">
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
                                                                <p className="text-xs text-gray-500">{reservation.guests} guests</p>
                                                            </div>

                                                            <div>
                                                                {renderStatusBadge(reservation.status)}
                                                            </div>

                                                            {/* Action Buttons - ✅ FIXED: Use correct guest object */}
                                                            <div className="flex space-x-2">
                                                                {guest.phone && (
                                                                    <Button
                                                                        variant="outline"
                                                                        size="sm"
                                                                        onClick={() => window.open(`tel:${guest.phone}`, '_self')}
                                                                        title="Call guest"
                                                                    >
                                                                        <Phone className="h-4 w-4" />
                                                                    </Button>
                                                                )}

                                                                {guest.email && (
                                                                    <Button
                                                                        variant="outline"
                                                                        size="sm"
                                                                        onClick={() => window.open(`mailto:${guest.email}`, '_self')}
                                                                        title="Email guest"
                                                                    >
                                                                        <Mail className="h-4 w-4" />
                                                                    </Button>
                                                                )}

                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => {
                                                                        setSelectedReservationId(reservation.id);
                                                                        setIsReservationModalOpen(true);
                                                                    }}
                                                                    title="Edit reservation"
                                                                >
                                                                    <Edit className="h-4 w-4" />
                                                                </Button>

                                                                {reservation.status === 'created' && (
                                                                    <Button
                                                                        variant="outline"
                                                                        size="sm"
                                                                        onClick={() => handleConfirmReservation(reservation.id)}
                                                                        className="text-green-600 hover:text-green-700"
                                                                        title="Confirm reservation"
                                                                    >
                                                                        <UserCheck className="h-4 w-4" />
                                                                    </Button>
                                                                )}

                                                                {reservation.status !== 'canceled' && (
                                                                    <Button
                                                                        variant="outline"
                                                                        size="sm"
                                                                        onClick={() => handleCancelReservation(reservation.id)}
                                                                        className="text-red-600 hover:text-red-700"
                                                                        title="Cancel reservation"
                                                                    >
                                                                        <XCircle className="h-4 w-4" />
                                                                    </Button>
                                                                )}
                                                            </div>
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
                                            {searchQuery || statusFilter !== 'all' || activeTab !== 'all'
                                                ? 'Try adjusting your filters'
                                                : 'Get started by creating a new reservation.'}
                                        </p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>

                {/* Calendar Selection Modal */}
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
                                capacityData={{}} // ✅ Empty for now to avoid build issues
                            />
                            <div className="mt-4 text-center text-sm text-gray-600">
                                💡 Click dates to select, Ctrl+Click for multiple dates
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>

                {/* Reservation Modal */}
                <ReservationModal
                    isOpen={isReservationModalOpen}
                    onClose={() => {
                        setIsReservationModalOpen(false);
                        setSelectedReservationId(undefined);
                    }}
                    reservationId={selectedReservationId}
                    restaurantId={restaurantId}
                />

                {/* Delete Confirmation Dialog */}
                <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This action cannot be undone. This will permanently cancel the reservation.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => {
                                    if (reservationToDelete) {
                                        handleCancelReservation(reservationToDelete);
                                    }
                                    setDeleteConfirmOpen(false);
                                    setReservationToDelete(undefined);
                                }}
                            >
                                Confirm
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </DashboardLayout>
    );
}
                                