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
import { useWebSocketContext } from "@/components/websocket/WebSocketContext";

// ✅ ROBUST FILTERING SYSTEM - Normalized data structure
interface NormalizedReservation {
    // Core data
    id: number;
    guestId: number;
    guestName: string;
    guestPhone: string;
    guestEmail?: string;
    status: string;
    reservationDateTime: DateTime;
    guests: number;
    tableId: number;
    tableName: string;
    comments?: string;
    
    // Computed properties (calculated once)
    isToday: boolean;
    isUpcoming: boolean;
    isPast: boolean;
    isActive: boolean;
    isLate: boolean;
    needsAttention: boolean;
    minutesUntilReservation: number;
    minutesSinceReservation: number;
    
    // Guest intelligence
    visitCount: number;
    vipLevel: number;
    reputationScore: number;
    totalSpent: string;
    lastVisit?: DateTime;
    
    // Original raw data for debugging
    _raw: any;
}

// ✅ Business Rules Configuration
interface ReservationPolicyConfig {
    allowSameDayCancellation: boolean;
    minHoursBeforeCancellation: number;
    allowPastReservationEditing: boolean;
    allowLateArrivalCancellation: boolean;
}

const getDefaultPolicy = (): ReservationPolicyConfig => ({
    allowSameDayCancellation: true,
    minHoursBeforeCancellation: 2,
    allowPastReservationEditing: false, 
    allowLateArrivalCancellation: true
});

const canCancelReservation = (
    reservation: NormalizedReservation, 
    policy: ReservationPolicyConfig
): boolean => {
    if (reservation.status !== 'confirmed') return false;
    if (reservation.isActive) return false;
    
    if (reservation.isToday) {
        if (!policy.allowSameDayCancellation) return false;
        if (reservation.isLate && policy.allowLateArrivalCancellation) return true;
        return reservation.minutesUntilReservation >= (policy.minHoursBeforeCancellation * 60);
    }
    
    return reservation.isUpcoming;
};

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
            // ✅ CONSISTENT: Use the same priority as storage.ts
            // reservations.tsx -> extractReservationData function
            name: reservation.booking_guest_name || guest.name || 'Guest'
        },
        table
    };
};

// ✅ SAFE DATA NORMALIZATION - Handles all edge cases
const normalizeReservation = (
    rawData: any, 
    restaurantTimezone: string, 
    restaurantNow: DateTime
): NormalizedReservation | null => {
    try {
        // Extract data safely
        const { reservation, guest, table } = extractReservationData(rawData);
        
        // Safe timestamp parsing with multiple fallbacks
        let reservationDateTime: DateTime;
        
        if (reservation.reservation_utc) {
            // Try PostgreSQL format first
            const pgFormat = reservation.reservation_utc.replace(' ', 'T').replace('+00', 'Z');
            reservationDateTime = DateTime.fromISO(pgFormat, { zone: 'utc' });
            
            if (!reservationDateTime.isValid) {
                // Try direct ISO format
                reservationDateTime = DateTime.fromISO(reservation.reservation_utc, { zone: 'utc' });
            }
        } else {
            // Fallback - skip this reservation if no valid timestamp
            console.warn('No valid timestamp for reservation:', reservation.id);
            return null;
        }
        
        if (!reservationDateTime.isValid) {
            console.warn('Invalid timestamp for reservation:', reservation.id, reservation.reservation_utc);
            return null;
        }
        
        // Convert to restaurant timezone
        const localDateTime = reservationDateTime.setZone(restaurantTimezone);
        const duration = reservation.duration || 120;
        const endDateTime = localDateTime.plus({ minutes: duration });
        
        // Calculate time differences
        const minutesUntilReservation = Math.round(localDateTime.diff(restaurantNow, 'minutes').minutes);
        const minutesSinceReservation = Math.round(restaurantNow.diff(localDateTime, 'minutes').minutes);
        
        // Determine states
        const isToday = localDateTime.hasSame(restaurantNow, 'day');
        const isUpcoming = localDateTime > restaurantNow;
        const isPast = endDateTime < restaurantNow;
        const isActive = localDateTime <= restaurantNow && 
                        endDateTime > restaurantNow && 
                        ['confirmed', 'seated', 'in_progress'].includes(reservation.status);
        const isLate = reservation.status === 'confirmed' && 
                       localDateTime < restaurantNow && 
                       minutesSinceReservation > 15 && 
                       !isPast;
        
        const needsAttention = (
            reservation.status === 'created' ||
            isLate ||
            (reservation.status === 'confirmed' && minutesUntilReservation <= 15 && minutesUntilReservation >= 0)
        );
        
        return {
            // Core data
            id: reservation.id,
            guestId: reservation.guestId || guest.id,
            // ✅ CONSISTENT: Use the same priority as storage.ts
            guestName: guest.name || reservation.booking_guest_name || 'Guest',
            guestPhone: guest.phone || reservation.phone || '',
            guestEmail: guest.email,
            status: reservation.status || 'unknown',
            reservationDateTime: localDateTime,
            guests: reservation.guests || 1,
            tableId: reservation.tableId,
            tableName: table.name || `Table ${reservation.tableId}` || 'Unknown Table',
            comments: reservation.comments || reservation.specialRequests,
            
            // Computed properties
            isToday,
            isUpcoming,
            isPast,
            isActive,
            isLate,
            needsAttention,
            minutesUntilReservation,
            minutesSinceReservation,
            
            // Guest intelligence
            visitCount: guest.visit_count || 0,
            vipLevel: guest.vip_level || 0,
            reputationScore: guest.reputation_score || 100,
            totalSpent: guest.total_spent || '0.00',
            lastVisit: guest.last_visit_date ? DateTime.fromISO(guest.last_visit_date) : undefined,
            
            // Debug info
            _raw: rawData
        };
    } catch (error) {
        console.error('Error normalizing reservation:', error, rawData);
        return null;
    }
};

// ✅ CLEAN FILTER FUNCTIONS - Testable and debuggable
const createFilterSystem = () => {
    return {
        // Smart tab filters
        all: () => true,
        
        attention: (r: NormalizedReservation) => r.needsAttention,
        
        active: (r: NormalizedReservation) => r.isActive,
        
        arriving: (r: NormalizedReservation) => 
            r.isUpcoming && 
            r.minutesUntilReservation <= 120 && // Next 2 hours
            r.status === 'confirmed',
        
        completed: (r: NormalizedReservation) => 
            r.status === 'completed' || r.isPast,
        
        upcoming: (r: NormalizedReservation) => 
            r.isUpcoming && 
            !r.isToday && 
            r.status === 'confirmed',
        
        // Status filters
        byStatus: (targetStatus: string) => (r: NormalizedReservation) =>
            targetStatus === 'all' || r.status === targetStatus,
        
        // Date filters
        today: (r: NormalizedReservation) => r.isToday,
        
        byDate: (targetDate: string, timezone: string) => (r: NormalizedReservation) => {
            const target = DateTime.fromISO(targetDate, { zone: timezone });
            return r.reservationDateTime.hasSame(target, 'day');
        },
        
        byDateRange: (startDate: Date, endDate: Date, timezone: string) => 
            (r: NormalizedReservation) => {
                const start = DateTime.fromJSDate(startDate, { zone: timezone }).startOf('day');
                const end = DateTime.fromJSDate(endDate, { zone: timezone }).endOf('day');
                return r.reservationDateTime >= start && r.reservationDateTime <= end;
            },
        
        // Enhanced search
        search: (query: string) => (r: NormalizedReservation) => {
            if (!query.trim()) return true;
            
            const searchTerms = query.toLowerCase().split(' ').filter(Boolean);
            const searchableText = [
                r.guestName,
                r.guestPhone,
                r.tableName,
                r.comments || '',
                r.id.toString(),
                r.status,
                `${r.guests} guests`,
                r.vipLevel > 0 ? 'vip' : '',
                r.visitCount > 5 ? 'regular' : ''
            ].join(' ').toLowerCase();
            
            return searchTerms.every(term => searchableText.includes(term));
        }
    };
};

// ✅ SMART TAB CONFLICTS - Prevent logical conflicts
const SMART_TAB_OVERRIDES = {
    attention: ['status'], // Attention tab ignores status filter
    active: ['status'],    // Active tab ignores status filter  
    arriving: ['status'],  // Arriving tab ignores status filter
    completed: ['status'], // Completed tab ignores status filter
    upcoming: ['status'],  // Upcoming tab ignores status filter
    all: []                // All tab respects all filters
};

// ✅ MAIN FILTERING HOOK - Drop-in replacement
const useAdvancedFiltering = (
    rawReservations: any[],
    activeTab: string,
    statusFilter: string,
    dateRangeFilter: any,
    selectedDate: Date | undefined,
    searchQuery: string,
    restaurantTimezone: string
) => {
    
    // Memoize restaurant now to prevent constant recalculation
    const restaurantNow = useMemo(() => 
        DateTime.now().setZone(restaurantTimezone), 
        [restaurantTimezone]
    );
    
    // Normalize data once
    const normalizedReservations = useMemo(() => {
        if (!rawReservations || !restaurantTimezone) return [];
        
        return rawReservations
            .map(raw => normalizeReservation(raw, restaurantTimezone, restaurantNow))
            .filter((normalized): normalized is NormalizedReservation => normalized !== null)
            .filter(normalized => normalized.status !== 'canceled'); // Exclude canceled
    }, [rawReservations, restaurantTimezone, restaurantNow]);
    
    // Create filter functions once
    const filters = useMemo(() => createFilterSystem(), []);
    
    // Apply filters in logical order
    const filteredReservations = useMemo(() => {
        let result = normalizedReservations;
        const appliedFilters: string[] = [];
        const overrides = SMART_TAB_OVERRIDES[activeTab as keyof typeof SMART_TAB_OVERRIDES] || [];
        
        // 1. Smart tab filter (most important)
        if (activeTab !== 'all') {
            const tabFilter = filters[activeTab as keyof typeof filters];
            if (typeof tabFilter === 'function') {
                result = result.filter(tabFilter);
                appliedFilters.push(`tab:${activeTab}`);
            }
        }
        
        // 2. Status filter (unless overridden by smart tab)
        if (statusFilter !== 'all' && !overrides.includes('status')) {
            result = result.filter(filters.byStatus(statusFilter));
            appliedFilters.push(`status:${statusFilter}`);
        }
        
        // 3. Date filters
        if (dateRangeFilter.type !== 'default') {
            switch (dateRangeFilter.type) {
                case 'today':
                    result = result.filter(filters.today);
                    appliedFilters.push('date:today');
                    break;
                case 'custom':
                    if (selectedDate) {
                        const targetDate = selectedDate.toISOString().split('T')[0];
                        result = result.filter(filters.byDate(targetDate, restaurantTimezone));
                        appliedFilters.push(`date:${targetDate}`);
                    }
                    break;
                case 'thisWeek':
                case 'nextWeek':
                    if (dateRangeFilter.startDate && dateRangeFilter.endDate) {
                        result = result.filter(filters.byDateRange(
                            dateRangeFilter.startDate,
                            dateRangeFilter.endDate,
                            restaurantTimezone
                        ));
                        appliedFilters.push(`date:${dateRangeFilter.type}`);
                    }
                    break;
            }
        } else if (selectedDate) {
            const targetDate = selectedDate.toISOString().split('T')[0];
            result = result.filter(filters.byDate(targetDate, restaurantTimezone));
            appliedFilters.push(`date:${targetDate}`);
        }
        
        // 4. Search filter (least restrictive)
        if (searchQuery.trim()) {
            result = result.filter(filters.search(searchQuery));
            appliedFilters.push(`search:"${searchQuery}"`);
        }
        
        console.log(`[Filtering] ${normalizedReservations.length} → ${result.length} reservations`, {
            appliedFilters,
            activeTab,
            statusFilter,
            searchQuery: searchQuery || 'none'
        });
        
        return result;
    }, [
        normalizedReservations,
        activeTab,
        statusFilter,
        dateRangeFilter,
        selectedDate,
        searchQuery,
        restaurantTimezone,
        filters
    ]);
    
    // Calculate tab counts for badges
    const tabCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        
        // Only count for tabs that have filter functions
        ['all', 'attention', 'active', 'arriving', 'completed', 'upcoming'].forEach(tabKey => {
            if (tabKey === 'all') {
                counts[tabKey] = normalizedReservations.length;
            } else {
                const tabFilter = filters[tabKey as keyof typeof filters];
                if (typeof tabFilter === 'function') {
                    counts[tabKey] = normalizedReservations.filter(tabFilter).length;
                }
            }
        });
        
        return counts;
    }, [normalizedReservations, filters]);
    
    // Debug information
    const debugInfo = useMemo(() => ({
        rawCount: rawReservations?.length || 0,
        normalizedCount: normalizedReservations.length,
        filteredCount: filteredReservations.length,
        tabCounts,
        activeFilters: [
            activeTab !== 'all' ? `tab:${activeTab}` : null,
            statusFilter !== 'all' ? `status:${statusFilter}` : null,
            dateRangeFilter.type !== 'default' ? `date:${dateRangeFilter.type}` : null,
            searchQuery ? `search:"${searchQuery}"` : null
        ].filter(Boolean)
    }), [rawReservations, normalizedReservations, filteredReservations, tabCounts, activeTab, statusFilter, dateRangeFilter, searchQuery]);
    
    return {
        filteredReservations,
        tabCounts,
        totalReservations: normalizedReservations.length,
        debugInfo
    };
};

// ✅ DEBUG COMPONENT - Shows what's happening with filters
const FilterDebugPanel = ({ debugInfo }: { debugInfo: any }) => {
    if (process.env.NODE_ENV !== 'development') return null;
    
    return (
        <div className="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded border mt-2">
            <div className="font-mono space-y-1">
                <div>📊 Raw: {debugInfo.rawCount} → Normalized: {debugInfo.normalizedCount} → Filtered: {debugInfo.filteredCount}</div>
                <div>🏷️ Active filters: {debugInfo.activeFilters.join(' + ') || 'none'}</div>
                <div>📈 Tab counts: {Object.entries(debugInfo.tabCounts).map(([k, v]) => `${k}:${v}`).join(', ')}</div>
            </div>
        </div>
    );
};

export default function Reservations() {
    // ✅ Get WebSocket connection status for real-time indicator
    const { isConnected, connectionStatus } = useWebSocketContext();
    
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

    // ✅ Restaurant reservations query with REAL-TIME WEBSOCKET UPDATES (no more polling!)
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
        // ✅ REMOVED: refetchInterval: 30000 - Now using real-time WebSocket updates!
        refetchOnWindowFocus: true,
        enabled: !!restaurantId && !!restaurantTimezone,
        staleTime: 0,
        gcTime: 1000 * 60 * 5,
    });

    // ✅ Refresh reservations when restaurant timezone changes
    useEffect(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
    }, [restaurant?.timezone, queryClient]);

    // ✅ REPLACE COMPLEX FILTERING WITH ROBUST SYSTEM
    const {
        filteredReservations: finalFilteredReservations,
        tabCounts,
        totalReservations,
        debugInfo
    } = useAdvancedFiltering(
        reservations || [],
        activeSmartTab,
        statusFilter,
        dateRangeFilter,
        selectedDate,
        searchQuery,
        restaurantTimezone
    );

    // ✅ MORE FLEXIBLE RESERVATION ACTIONS
    const getSmartActions = (normalizedReservation: NormalizedReservation) => {
        const status = normalizedReservation.status;
        const actions = [];
        const policy = getDefaultPolicy(); // Could be loaded from restaurant settings

        // Always add contact actions if available
        if (normalizedReservation.guestPhone) {
            actions.push({
                type: "phone",
                label: "Call",
                icon: Phone,
                action: () => window.open(`tel:${normalizedReservation.guestPhone}`, '_self'),
                variant: "outline" as const,
                priority: "low" as const
            });
        }

        if (normalizedReservation.guestEmail) {
            actions.push({
                type: "email",
                label: "Email", 
                icon: Mail,
                action: () => window.open(`mailto:${normalizedReservation.guestEmail}`, '_self'),
                variant: "outline" as const,
                priority: "low" as const
            });
        }

        // ✅ ALWAYS allow editing (unless completed/canceled)
        if (!['completed', 'canceled', 'archived'].includes(status)) {
            actions.push({
                type: "edit",
                label: "Edit",
                icon: Edit,
                action: () => {
                    setSelectedReservationId(normalizedReservation.id);
                    setIsReservationModalOpen(true);
                },
                variant: "outline" as const,
                priority: "medium" as const
            });
        }

        // Confirm AI bookings
        if (status === 'created') {
            actions.unshift({
                type: "confirm",
                label: "✅ Confirm AI Booking",
                icon: UserCheck,
                action: () => handleConfirmReservation(normalizedReservation.id),
                variant: "default" as const,
                priority: "critical" as const,
                className: "bg-green-600 hover:bg-green-700 text-white"
            });
        }

        // Today's reservations - context-aware actions
        if (status === 'confirmed' && normalizedReservation.isToday) {
            if (normalizedReservation.isUpcoming && normalizedReservation.minutesUntilReservation <= 120) {
                actions.unshift({
                    type: "prepare",
                    label: "🍽️ Prepare Table",
                    icon: Users,
                    action: () => toast({ title: "Table Preparation", description: "Mark table as being prepared" }),
                    variant: "default" as const,
                    priority: "high" as const,
                    className: "bg-blue-600 hover:bg-blue-700 text-white"
                });
            } else if (!normalizedReservation.isUpcoming && !normalizedReservation.isActive) {
                actions.unshift({
                    type: "arrived",
                    label: normalizedReservation.isLate ? "⚠️ Mark Arrived (Late)" : "👋 Mark Arrived",
                    icon: UserCheck,
                    action: () => toast({ title: "Guest Arrived", description: "Guest marked as arrived" }),
                    variant: normalizedReservation.isLate ? "destructive" : "default" as const,
                    priority: "critical" as const
                });
            } else if (normalizedReservation.isActive) {
                actions.unshift({
                    type: "complete",
                    label: "✅ Mark Completed",
                    icon: Users,
                    action: () => handleStatusUpdate(normalizedReservation.id, 'completed'),
                    variant: "default" as const,
                    priority: "medium" as const,
                    className: "bg-green-600 hover:bg-green-700 text-white"
                });
            }

            // Late arrivals can be marked as no-show
            if (normalizedReservation.isLate && !normalizedReservation.isActive) {
                actions.push({
                    type: "noshow",
                    label: "❌ Mark No-Show",
                    icon: XCircle,
                    action: () => {
                        if (confirm("Mark this reservation as no-show? This cannot be undone.")) {
                            handleStatusUpdate(normalizedReservation.id, 'canceled');
                        }
                    },
                    variant: "destructive" as const,
                    priority: "medium" as const
                });
            }
        }

        // ✅ MORE FLEXIBLE CANCELLATION LOGIC:
        // Allow cancellation for confirmed reservations that aren't currently active
        if (canCancelReservation(normalizedReservation, policy)) {
            const isToday = normalizedReservation.isToday;
            const hoursUntilReservation = normalizedReservation.minutesUntilReservation / 60;
            
            // Different logic for today vs future dates
            if (isToday) {
                // For today: allow cancellation if more than 2 hours away OR if late
                if (hoursUntilReservation > 2 || normalizedReservation.isLate) {
                    actions.push({
                        type: "cancel",
                        label: normalizedReservation.isLate ? "Cancel (Late)" : "Cancel",
                        icon: XCircle,
                        action: () => {
                            const confirmMessage = normalizedReservation.isLate 
                                ? "Cancel this late reservation?"
                                : "Cancel today's reservation? Guest should be notified.";
                            if (confirm(confirmMessage)) {
                                handleCancelReservation(normalizedReservation.id);
                            }
                        },
                        variant: "outline" as const,
                        priority: "low" as const,
                        className: "text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
                    });
                }
            } else if (normalizedReservation.isUpcoming) {
                // For future dates: always allow cancellation
                actions.push({
                    type: "cancel",
                    label: "Cancel",
                    icon: XCircle,
                    action: () => {
                        if (confirm("Cancel this reservation?")) {
                            handleCancelReservation(normalizedReservation.id);
                        }
                    },
                    variant: "outline" as const,
                    priority: "low" as const,
                    className: "text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
                });
            }
        }

        // ✅ EVEN PAST RESERVATIONS: Allow some actions
        if (normalizedReservation.isPast) {
            // Keep contact and view/edit actions for historical records
            return actions.filter(action => 
                ['phone', 'email', 'edit'].includes(action.type)
            );
        }

        return actions;
    };

    const SmartActionButtons = ({ normalizedReservation }: { normalizedReservation: NormalizedReservation }) => {
        const actions = getSmartActions(normalizedReservation);
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

    const SmartStatusBadge = ({ normalizedReservation }: { normalizedReservation: NormalizedReservation }) => {
        const status = normalizedReservation.status;

        if (status === 'created') {
            return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">🤖 AI Booking</Badge>;
        }

        if (status === 'confirmed' && normalizedReservation.isToday) {
            if (normalizedReservation.isActive) {
                return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">🍽️ Dining Now</Badge>;
            } else if (normalizedReservation.isLate) {
                return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">⚠️ Late Arrival</Badge>;
            } else if (!normalizedReservation.isUpcoming) {
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

    // ✅ Today reservations calculation with reactive timezone
    const todayReservations = finalFilteredReservations.filter(r => r.isToday);

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
                        <p className="text-xs text-gray-400">
                            Showing {finalFilteredReservations.length} reservations
                            {reservations && ` (${reservations.length} total in system)`}
                            {statusFilter !== 'all' && ` • Status: ${statusFilter}`}
                            {dateRangeFilter.type !== 'default' && ` • ${dateRangeFilter.displayText}`}
                            {selectedDate && dateRangeFilter.type === 'default' && ` • ${format(selectedDate, 'MMM d, yyyy')}`}
                        </p>
                    </div>
                    <div className="mt-4 flex space-x-3 md:mt-0">
                        {/* ✅ REAL-TIME STATUS INDICATOR */}
                        {isConnected ? (
                            <Badge variant="outline" className="border-green-500 text-green-700 bg-green-50">
                                ● Live Updates
                            </Badge>
                        ) : (
                            <Badge variant="destructive" className="animate-pulse">
                                ● Disconnected
                            </Badge>
                        )}
                        
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
                                                count={tabCounts[tab.id] || 0}
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
                                            placeholder="Search guests, phone, table..."
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
                                            {todayReservations.filter(r => r.status === 'confirmed').length}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span>Pending:</span>
                                        <span className="font-medium text-yellow-600">
                                            {todayReservations.filter(r => r.status === 'created').length}
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
                                {/* ✅ ADD DEBUG PANEL FOR DEVELOPMENT */}
                                <FilterDebugPanel debugInfo={debugInfo} />
                                
                                {isLoading ? (
                                    <div className="flex justify-center py-8">
                                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-900 border-t-transparent"></div>
                                    </div>
                                ) : finalFilteredReservations.length > 0 ? (
                                    <div className="space-y-4">
                                        {finalFilteredReservations.map((normalizedReservation) => {
                                            // ✅ Enhanced reservation card with guest intelligence
                                            return (
                                                <div key={normalizedReservation.id} className="rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center space-x-4">
                                                            <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-700 relative">
                                                                <UserCheck className="h-5 w-5" />
                                                                {/* ✅ VIP indicator */}
                                                                {normalizedReservation.vipLevel > 0 && (
                                                                    <span className="absolute -top-1 -right-1 bg-yellow-400 text-yellow-900 text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                                                                        ★
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div>
                                                                <h3 className="font-medium text-gray-900 flex items-center gap-2">
                                                                    {normalizedReservation.guestName}
                                                                    {/* ✅ Visit count badge */}
                                                                    {normalizedReservation.visitCount > 0 && (
                                                                        <Badge variant="outline" className="text-xs">
                                                                            {normalizedReservation.visitCount} visit{normalizedReservation.visitCount > 1 ? 's' : ''}
                                                                        </Badge>
                                                                    )}
                                                                </h3>
                                                                <p className="text-sm text-gray-500">
                                                                    {normalizedReservation.guestPhone || 'No phone provided'}
                                                                    {/* ✅ Last visit info */}
                                                                    {normalizedReservation.lastVisit && (
                                                                        <span className="ml-2 text-xs text-blue-600">
                                                                            Last: {normalizedReservation.lastVisit.toFormat('MMM d')}
                                                                        </span>
                                                                    )}
                                                                </p>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center space-x-6">
                                                            <div className="text-center">
                                                                <p className="text-sm font-medium text-gray-900 flex items-center gap-1">
                                                                    <Clock className="h-4 w-4" />
                                                                    {normalizedReservation.reservationDateTime.toFormat('HH:mm')}
                                                                </p>
                                                                <p className="text-xs text-gray-500">
                                                                    {normalizedReservation.reservationDateTime.toFormat('MMM d, yyyy')}
                                                                </p>
                                                                {/* ✅ Time indicators */}
                                                                {normalizedReservation.minutesUntilReservation > 0 && normalizedReservation.minutesUntilReservation <= 60 && (
                                                                    <p className="text-xs text-orange-600">
                                                                        in {normalizedReservation.minutesUntilReservation}min
                                                                    </p>
                                                                )}
                                                                {normalizedReservation.isLate && (
                                                                    <p className="text-xs text-red-600">
                                                                        {normalizedReservation.minutesSinceReservation}min late
                                                                    </p>
                                                                )}
                                                            </div>

                                                            <div className="text-center">
                                                                <p className="text-sm font-medium text-gray-900">
                                                                    {normalizedReservation.tableName}
                                                                </p>
                                                                <p className="text-xs text-gray-500 flex items-center gap-1">
                                                                    <Users className="h-3 w-3" />
                                                                    {normalizedReservation.guests} guests
                                                                </p>
                                                            </div>

                                                            <div>
                                                                <SmartStatusBadge normalizedReservation={normalizedReservation} />
                                                            </div>

                                                            <SmartActionButtons normalizedReservation={normalizedReservation} />
                                                        </div>
                                                    </div>

                                                    {normalizedReservation.comments && (
                                                        <div className="mt-3 pt-3 border-t border-gray-100">
                                                            <p className="text-sm text-gray-600">
                                                                <span className="font-medium">Note:</span> {normalizedReservation.comments}
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