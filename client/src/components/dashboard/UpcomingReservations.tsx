import { useQuery } from "@tanstack/react-query";
import { Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { DateTime } from 'luxon';
import { useRestaurantTimezone } from "@/components/layout/DashboardLayout";

interface UpcomingReservationsProps {
    restaurantId: number;
    restaurantTimezone: string; // e.g., "Europe/Belgrade"
    onEdit: (id: number) => void;
    onDelete: (id: number) => void;
}

// ✅ FIXED: Updated interface to match the actual API response with UTC timestamps
interface Reservation {
    reservation: {
        id: number;
        reservation_utc: string; // ✅ NEW: The actual field returned by backend
        // ❌ REMOVED: date and time fields no longer exist
        guests: number;
        status: string;
        booking_guest_name?: string;
        duration?: number;
    };
    guest: {
        id: number;
        name: string;
        phone: string;
    };
    table: {
        id: number;
        name: string;
        comments: string;
    };
    guestName: string; // Flattened property from backend
}

// ✅ CRITICAL FIX: PostgreSQL timestamp parser (same as backend)
function parsePostgresTimestamp(timestamp: string): DateTime {
    if (!timestamp) {
        console.warn('[UpcomingReservations] Empty timestamp provided');
        return DateTime.invalid('empty timestamp');
    }

    try {
        // Try ISO format first: "2025-06-23T09:00:00.000Z"
        let dt = DateTime.fromISO(timestamp, { zone: 'utc' });
        if (dt.isValid) {
            return dt;
        }

        // Try PostgreSQL format: "2025-06-23 09:00:00+00"
        const pgTimestamp = timestamp.replace(' ', 'T').replace('+00', 'Z');
        dt = DateTime.fromISO(pgTimestamp, { zone: 'utc' });
        if (dt.isValid) {
            return dt;
        }

        // Try without timezone indicator: "2025-06-23 09:00:00"
        if (timestamp.includes(' ') && !timestamp.includes('T')) {
            const isoFormat = timestamp.replace(' ', 'T') + 'Z';
            dt = DateTime.fromISO(isoFormat, { zone: 'utc' });
            if (dt.isValid) {
                return dt;
            }
        }

        console.error(`[UpcomingReservations] Failed to parse timestamp: ${timestamp}`);
        return DateTime.invalid(`unparseable timestamp: ${timestamp}`);
    } catch (error) {
        console.error(`[UpcomingReservations] Error parsing timestamp ${timestamp}:`, error);
        return DateTime.invalid(`parse error: ${error}`);
    }
}

export function UpcomingReservations({ restaurantId, restaurantTimezone, onEdit, onDelete }: UpcomingReservationsProps) {
    // ✅ CRITICAL FIX: Get timezone loading state to prevent race condition
    const { isLoading: isTimezoneLoading } = useRestaurantTimezone();
    
    // ✅ CRITICAL FIX: Enhanced query with race condition prevention
    const { data: upcomingReservations, isLoading } = useQuery<Reservation[]>({
        queryKey: ['dashboard_upcoming', restaurantId, restaurantTimezone],
        queryFn: async () => {
            console.log(`[UpcomingReservations] Fetching for restaurant ${restaurantId} in timezone ${restaurantTimezone}`);
            const response = await apiRequest("GET",
                `/api/dashboard/upcoming?restaurantId=${restaurantId}&timezone=${encodeURIComponent(restaurantTimezone)}`
            );
            if (!response.ok) throw new Error('Failed to fetch upcoming reservations');
            const data = await response.json();
            console.log('[UpcomingReservations] Raw API response:', data);
            return data;
        },
        // ✅ CRITICAL FIX: Prevent race condition by waiting for timezone confirmation
        enabled: !!restaurantId && !!restaurantTimezone && !isTimezoneLoading,
    });

    if (isLoading || isTimezoneLoading) {
        return (
            <Card className="border border-gray-200">
                <CardHeader>
                    <CardTitle>Upcoming Reservations</CardTitle>
                    <CardDescription>Next 3 hours</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-md"></div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        );
    }

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'confirmed':
                return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Confirmed</Badge>;
            case 'created':
                return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Pending</Badge>;
            case 'canceled':
                return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Canceled</Badge>;
            default:
                return <Badge>{status}</Badge>;
        }
    };

    return (
        <Card className="border border-gray-200">
            <CardHeader className="border-b border-gray-200">
                <CardTitle>Upcoming Reservations</CardTitle>
                <CardDescription>
                    Next 3 hours
                    {restaurantTimezone !== 'Europe/Moscow' && (
                        <span className="text-xs text-blue-600 block mt-1">
                            📍 {restaurantTimezone} time
                        </span>
                    )}
                </CardDescription>
            </CardHeader>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Guest</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Table</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Guests</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {upcomingReservations && upcomingReservations.length > 0 ? (
                            upcomingReservations.map((item) => {
                                // ✅ CRITICAL FIX: Parse UTC timestamp and convert to restaurant timezone
                                const reservationUtcDateTime = parsePostgresTimestamp(item.reservation.reservation_utc);
                                const reservationLocalDateTime = reservationUtcDateTime.isValid 
                                    ? reservationUtcDateTime.setZone(restaurantTimezone)
                                    : null;

                                console.log('[UpcomingReservations] Parsing reservation:', {
                                    id: item.reservation.id,
                                    utc: item.reservation.reservation_utc,
                                    parsed: reservationUtcDateTime.isValid ? reservationUtcDateTime.toISO() : 'Invalid',
                                    local: reservationLocalDateTime ? reservationLocalDateTime.toISO() : 'Invalid',
                                    timezone: restaurantTimezone
                                });

                                return (
                                    <tr key={item.reservation.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center">
                                                <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-700">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                        <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                                                    </svg>
                                                </div>
                                                <div className="ml-4">
                                                    <div className="text-sm font-medium text-gray-900">{item.guestName}</div>
                                                    <div className="text-sm text-gray-500">{item.guest.phone}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900">
                                                {/* ✅ CRITICAL FIX: Use UTC timestamp converted to restaurant timezone */}
                                                {reservationLocalDateTime?.isValid 
                                                    ? reservationLocalDateTime.toFormat('HH:mm')
                                                    : <span className="text-red-500">Invalid Time</span>
                                                }
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                {/* ✅ FIXED: Date from UTC timestamp */}
                                                {reservationLocalDateTime?.isValid 
                                                    ? reservationLocalDateTime.toFormat('MMM d')
                                                    : <span className="text-red-500">Invalid Date</span>
                                                }
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">{item.table?.name || 'Not assigned'}</div>
                                            <div className="text-xs text-gray-500">{item.table?.comments || ''}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {item.reservation.guests}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {getStatusBadge(item.reservation.status)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => onEdit(item.reservation.id)}
                                                className="text-blue-600 hover:text-blue-900 mr-3"
                                                title="Edit reservation"
                                            >
                                                <Edit size={16} />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => onDelete(item.reservation.id)}
                                                className="text-red-600 hover:text-red-900"
                                                title="Delete reservation"
                                            >
                                                <Trash2 size={16} />
                                            </Button>
                                        </td>
                                    </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                                    <div className="flex flex-col items-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <span>No upcoming reservations in the next 3 hours</span>
                                        <span className="text-xs text-gray-400 mt-1">
                                            Reservations will appear here 3 hours before arrival time
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            <CardFooter className="px-6 py-4 border-t border-gray-200">
                <Button variant="link" className="text-sm font-medium text-blue-600 hover:text-blue-500 p-0">
                    View all reservations →
                </Button>
            </CardFooter>
        </Card>
    );
}