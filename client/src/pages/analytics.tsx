import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardLayout, useRestaurantTimezone } from "@/components/layout/DashboardLayout";
import {
    Users,
    TrendingUp,
    DollarSign,
    Calendar,
    Phone,
    MessageSquare,
    Star,
    Table,
    Clock,
    UserCheck,
    Repeat,
    Target,
    BarChart3
} from "lucide-react";
import { DateTime } from "luxon";

// Helper function to parse PostgreSQL timestamp format to Luxon
const parsePostgresTimestamp = (timestampStr: string): DateTime => {
  // Handle PostgreSQL format: "2025-06-24 10:00:00+00"
  if (timestampStr.includes(' ') && !timestampStr.includes('T')) {
    const isoString = timestampStr.replace(' ', 'T').replace('+00', '.000Z');
    return DateTime.fromISO(isoString, { zone: 'utc' });
  }
  // Handle standard ISO format: "2025-06-24T10:00:00.000Z"
  return DateTime.fromISO(timestampStr, { zone: 'utc' });
};

export default function Analytics() {
    const { restaurant, restaurantTimezone } = useRestaurantTimezone();

    console.log(`📊 [Analytics] Context - restaurant: ${!!restaurant}, timezone: ${restaurantTimezone}`);

    // ✅ FIXED: Simplified reservations query without over-strict conditions
    const { data: reservations, isLoading: reservationsLoading, error: reservationsError } = useQuery({
        queryKey: ["/api/reservations"],
        queryFn: async () => {
            console.log(`📊 [Analytics] Fetching reservations for analytics`);
            
            // ✅ FIXED: Use standard API endpoint without parameters
            const response = await fetch('/api/reservations', {
                credentials: "include"
            });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch reservations: ${response.status}`);
            }
            
            const data = await response.json();
            console.log(`📊 [Analytics] Received ${data?.length || 0} reservations`);
            return data || [];
        },
        // ✅ FIXED: Remove restaurant dependency - backend handles auth context
        staleTime: 30000, // 30 seconds
        retry: 2
    });

    // ✅ FIXED: Simplified guests query
    const { data: guests, isLoading: guestsLoading, error: guestsError } = useQuery({
        queryKey: ["/api/guests"],
        queryFn: async () => {
            console.log(`📊 [Analytics] Fetching guests for analytics`);
            
            // ✅ FIXED: Use standard API endpoint without parameters
            const response = await fetch('/api/guests', {
                credentials: "include"
            });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch guests: ${response.status}`);
            }
            
            const data = await response.json();
            console.log(`📊 [Analytics] Received ${data?.length || 0} guests`);
            return data || [];
        },
        // ✅ FIXED: Remove restaurant dependency - backend handles auth context
        staleTime: 60000, // 1 minute
        retry: 2
    });

    // ✅ FIXED: Simplified tables query
    const { data: tables, isLoading: tablesLoading, error: tablesError } = useQuery({
        queryKey: ["/api/tables"],
        queryFn: async () => {
            console.log(`📊 [Analytics] Fetching tables for analytics`);
            
            // ✅ FIXED: Use standard API endpoint without parameters
            const response = await fetch('/api/tables', { 
                credentials: "include" 
            });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch tables: ${response.status}`);
            }
            
            const data = await response.json();
            console.log(`📊 [Analytics] Received ${data?.length || 0} tables`);
            return data || [];
        },
        // ✅ FIXED: Remove restaurant dependency - backend handles auth context
        staleTime: 300000, // 5 minutes
        retry: 2
    });

    // ✅ FIXED: Get today's date in restaurant timezone
    const getRestaurantToday = () => {
        try {
            return DateTime.now().setZone(restaurantTimezone || 'UTC').toISODate();
        } catch (error) {
            console.warn(`[Analytics] Invalid timezone ${restaurantTimezone}, falling back to UTC`);
            return DateTime.now().toISODate();
        }
    };

    // ✅ FIXED: Check if UTC timestamp is today in restaurant timezone
    const isToday = (reservation_utc: string) => {
        try {
            const restaurantToday = getRestaurantToday();
            const utcDateTime = parsePostgresTimestamp(reservation_utc);
            const localDate = utcDateTime.setZone(restaurantTimezone || 'UTC').toISODate();
            return localDate === restaurantToday;
        } catch (error) {
            console.warn(`[Analytics] Error checking if ${reservation_utc} is today:`, error);
            return false;
        }
    };

    // ✅ FIXED: Extract hour from UTC timestamp in restaurant timezone
    const getHourFromReservation = (reservation_utc: string) => {
        try {
            const utcDateTime = parsePostgresTimestamp(reservation_utc);
            const localDateTime = utcDateTime.setZone(restaurantTimezone || 'UTC');
            return localDateTime.hour.toString();
        } catch (error) {
            console.warn(`[Analytics] Error extracting hour from ${reservation_utc}:`, error);
            return '12'; // Default fallback
        }
    };

    // Loading state
    if (reservationsLoading || guestsLoading || tablesLoading) {
        return (
            <DashboardLayout>
                <div className="px-4 py-6 lg:px-8">
                    <header className="mb-6">
                        <h2 className="text-2xl font-bold text-gray-800">Analytics Dashboard</h2>
                        <p className="text-gray-500 mt-1">Loading analytics data...</p>
                    </header>
                    <div className="flex items-center justify-center h-64">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    // Error state
    if (reservationsError || guestsError || tablesError) {
        console.error('❌ [Analytics] Errors:', { reservationsError, guestsError, tablesError });
        
        return (
            <DashboardLayout>
                <div className="px-4 py-6 lg:px-8">
                    <header className="mb-6">
                        <h2 className="text-2xl font-bold text-gray-800">Analytics Dashboard</h2>
                        <p className="text-red-500 mt-1">Error loading analytics data. Please try refreshing the page.</p>
                    </header>
                    <div className="text-center py-12 text-gray-500">
                        <BarChart3 className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                        <p>Unable to load analytics data</p>
                        <p className="text-sm mt-2">Check your connection and try again</p>
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    // Safe data processing with defaults
    const safeReservations = Array.isArray(reservations) ? reservations : [];
    const safeGuests = Array.isArray(guests) ? guests : [];
    const safeTables = Array.isArray(tables) ? tables : [];

    // ✅ FIXED: Filter today's reservations using UTC timestamps
    const todaysReservations = safeReservations.filter((r: any) => {
        const reservation = r.reservation || r;
        return reservation.reservation_utc && 
               isToday(reservation.reservation_utc) && 
               reservation.status !== 'canceled';
    });

    console.log(`📊 [Analytics] Today's reservations (${restaurantTimezone || 'UTC'}): ${todaysReservations.length}`);

    // Guest Analytics
    const totalGuests = safeGuests.length;
    const telegramGuests = safeGuests.filter((g: any) => g.telegram_user_id).length;
    const regularGuests = safeGuests.filter((g: any) => {
        const guestReservations = safeReservations.filter((r: any) => {
            const reservation = r.reservation || r;
            return reservation.guestId === g.id || r.guestId === g.id;
        });
        return guestReservations.length > 1;
    }).length;

    // Today's stats
    const todayStats = {
        total: todaysReservations.length,
        confirmed: todaysReservations.filter((r: any) => {
            const reservation = r.reservation || r;
            return reservation.status === 'confirmed';
        }).length,
        totalGuests: todaysReservations.reduce((sum: number, r: any) => {
            const reservation = r.reservation || r;
            return sum + (reservation.guests || 0);
        }, 0)
    };

    // Reservation Analytics
    const totalReservations = safeReservations.length;
    const confirmedReservations = safeReservations.filter((r: any) => {
        const reservation = r.reservation || r;
        return reservation.status === 'confirmed';
    }).length;
    const telegramBookings = safeReservations.filter((r: any) => {
        const reservation = r.reservation || r;
        return reservation.source === 'telegram';
    }).length;

    // Connected guests analysis
    const connectedGuests = safeGuests.reduce((acc: any, guest: any) => {
        const guestReservations = safeReservations.filter((r: any) => {
            const reservation = r.reservation || r;
            return reservation.guestId === guest.id || r.guestId === guest.id;
        });

        if (guest.telegram_user_id) {
            const telegramGroup = acc.find((g: any) => g.telegram_user_id === guest.telegram_user_id);
            if (telegramGroup) {
                telegramGroup.guests.push({ ...guest, reservationCount: guestReservations.length });
            } else {
                acc.push({
                    telegram_user_id: guest.telegram_user_id,
                    guests: [{ ...guest, reservationCount: guestReservations.length }],
                    totalBookings: guestReservations.length
                });
            }
        }
        return acc;
    }, []);

    // ✅ FIXED: Table usage analysis with UTC timestamps
    const tableUsage = safeTables.map((table: any) => {
        const tableReservations = safeReservations.filter((r: any) => {
            const reservation = r.reservation || r;
            return reservation.tableId === table.id || r.tableId === table.id;
        });
        
        const uniqueGuests = new Set(tableReservations.map((r: any) => {
            const reservation = r.reservation || r;
            return reservation.guestId || r.guestId;
        })).size;
        
        const popularTimes = tableReservations.reduce((acc: any, r: any) => {
            const reservation = r.reservation || r;
            if (reservation.reservation_utc) {
                const hour = getHourFromReservation(reservation.reservation_utc);
                acc[hour] = (acc[hour] || 0) + 1;
            }
            return acc;
        }, {});
        
        return {
            ...table,
            bookings: tableReservations.length,
            uniqueGuests,
            popularTimes
        };
    });

    // ✅ FIXED: Party size statistics
    const partySizeStats = safeReservations.reduce((acc: any, r: any) => {
        const reservation = r.reservation || r;
        const guests = reservation.guests || r.guests;
        if (guests) {
            acc[guests] = (acc[guests] || 0) + 1;
        }
        return acc;
    }, {});

    // Average party size
    const avgPartySize = totalReservations ? 
        (safeReservations.reduce((sum: number, r: any) => {
            const reservation = r.reservation || r;
            return sum + (reservation.guests || r.guests || 0);
        }, 0) / totalReservations).toFixed(1) : '0';

    return (
        <DashboardLayout>
            <div className="px-4 py-6 lg:px-8">
                <header className="mb-6">
                    <h2 className="text-2xl font-bold text-gray-800">Analytics Dashboard</h2>
                    <p className="text-gray-500 mt-1">
                        Deep insights into your guest behavior and restaurant performance
                        {restaurantTimezone && (
                            <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                {restaurantTimezone} • Today: {getRestaurantToday()}
                            </span>
                        )}
                    </p>
                </header>

                <Tabs defaultValue="overview" className="space-y-6">
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="guests">Guest Insights</TabsTrigger>
                        <TabsTrigger value="connections">Guest Connections</TabsTrigger>
                        <TabsTrigger value="tables">Table Analytics</TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="space-y-6">
                        <div className="mb-6">
                            <h3 className="text-lg font-semibold mb-4 text-gray-800">Today's Performance</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <Card className="bg-blue-50 border-blue-200">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-blue-800">Today's Reservations</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-2xl font-bold text-blue-900">{todayStats.total}</div>
                                        <p className="text-xs text-blue-600">{todayStats.confirmed} confirmed</p>
                                    </CardContent>
                                </Card>
                                <Card className="bg-green-50 border-green-200">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-green-800">Today's Guests</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-2xl font-bold text-green-900">{todayStats.totalGuests}</div>
                                        <p className="text-xs text-green-600">expected to dine</p>
                                    </CardContent>
                                </Card>
                                <Card className="bg-purple-50 border-purple-200">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-purple-800">Avg Party Today</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-2xl font-bold text-purple-900">
                                            {todayStats.total ? (todayStats.totalGuests / todayStats.total).toFixed(1) : '0'}
                                        </div>
                                        <p className="text-xs text-purple-600">guests per reservation</p>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Total Guests</CardTitle>
                                    <Users className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{totalGuests}</div>
                                    <p className="text-xs text-muted-foreground">
                                        {regularGuests} repeat customers
                                    </p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Total Reservations</CardTitle>
                                    <Calendar className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{totalReservations}</div>
                                    <p className="text-xs text-muted-foreground">
                                        {confirmedReservations} confirmed
                                    </p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Telegram Bookings</CardTitle>
                                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{telegramBookings}</div>
                                    <p className="text-xs text-muted-foreground">
                                        {telegramGuests} unique Telegram users
                                    </p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Avg Party Size</CardTitle>
                                    <Users className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{avgPartySize}</div>
                                    <p className="text-xs text-muted-foreground">guests per reservation</p>
                                </CardContent>
                            </Card>
                        </div>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center">
                                    <BarChart3 className="h-5 w-5 mr-2" />
                                    Party Size Distribution
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                                    {Object.entries(partySizeStats).map(([size, count]) => (
                                        <div key={size} className="text-center p-4 bg-gray-50 rounded-lg">
                                            <div className="text-2xl font-bold text-blue-600">{count as number}</div>
                                            <div className="text-sm text-gray-500">{size} {size === '1' ? 'guest' : 'guests'}</div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="guests" className="space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center">
                                        <Star className="h-5 w-5 mr-2" />
                                        Most Loyal Guests
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-3">
                                        {safeGuests.map((guest: any) => {
                                            const guestReservations = safeReservations.filter((r: any) => {
                                                const reservation = r.reservation || r;
                                                return reservation.guestId === guest.id || r.guestId === guest.id;
                                            });
                                            if (guestReservations.length === 0) return null;

                                            return (
                                                <div key={guest.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                                    <div className="flex items-center">
                                                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                                                            <UserCheck className="h-4 w-4 text-blue-600" />
                                                        </div>
                                                        <div>
                                                            <div className="font-medium">{guest.name}</div>
                                                            <div className="text-sm text-gray-500">{guest.phone || 'No phone'}</div>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <Badge variant="secondary">{guestReservations.length} bookings</Badge>
                                                        {guest.telegram_user_id && (
                                                            <div className="text-xs text-blue-600 mt-1">via Telegram</div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        }).filter(Boolean)}
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center">
                                        <Phone className="h-5 w-5 mr-2" />
                                        Booking Channels
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        {['direct', 'telegram', 'web'].map((source) => {
                                            const sourceBookings = safeReservations.filter((r: any) => {
                                                const reservation = r.reservation || r;
                                                return (reservation.source || r.source) === source;
                                            }).length;
                                            const percentage = totalReservations ? ((sourceBookings / totalReservations) * 100).toFixed(1) : 0;

                                            return (
                                                <div key={source} className="flex items-center justify-between">
                                                    <div className="flex items-center">
                                                        <div className="w-3 h-3 bg-blue-600 rounded-full mr-3"></div>
                                                        <span className="capitalize font-medium">{source}</span>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="font-bold">{sourceBookings}</div>
                                                        <div className="text-sm text-gray-500">{percentage}%</div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    <TabsContent value="connections" className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center">
                                    <Repeat className="h-5 w-5 mr-2" />
                                    Connected Guest Groups
                                </CardTitle>
                                <CardContent>
                                    <p className="text-sm text-gray-500 mb-4">
                                        Guests linked through shared Telegram accounts or phone numbers
                                    </p>
                                </CardContent>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    {connectedGuests.length > 0 ? (
                                        connectedGuests.map((group: any, index: number) => (
                                            <div key={index} className="p-4 border rounded-lg bg-gray-50">
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center">
                                                        <MessageSquare className="h-4 w-4 text-blue-600 mr-2" />
                                                        <span className="font-medium">Telegram Group {index + 1}</span>
                                                    </div>
                                                    <Badge variant="outline">{group.totalBookings} total bookings</Badge>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    {group.guests.map((guest: any) => (
                                                        <div key={guest.id} className="flex items-center justify-between p-2 bg-white rounded">
                                                            <div>
                                                                <div className="font-medium">{guest.name}</div>
                                                                <div className="text-sm text-gray-500">{guest.phone || 'No phone'}</div>
                                                            </div>
                                                            <Badge variant="secondary">{guest.reservationCount} bookings</Badge>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-center py-8 text-gray-500">
                                            <Users className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                                            <p>No connected guest groups found yet</p>
                                            <p className="text-sm">Connected groups will appear when multiple guests use the same contact methods</p>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="tables" className="space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center">
                                        <Table className="h-5 w-5 mr-2" />
                                        Table Performance
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-3">
                                        {tableUsage.map((table: any) => (
                                            <div key={table.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                                <div>
                                                    <div className="font-medium">Table {table.name}</div>
                                                    <div className="text-sm text-gray-500">
                                                        {table.minGuests}-{table.maxGuests} guests
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-bold">{table.bookings} bookings</div>
                                                    <div className="text-sm text-gray-500">{table.uniqueGuests} unique guests</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center">
                                        <Clock className="h-5 w-5 mr-2" />
                                        Popular Time Slots
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-3">
                                        {(() => {
                                            // ✅ FIXED: Calculate time slots using UTC timestamps
                                            const timeSlots = safeReservations.reduce((acc: any, r: any) => {
                                                const reservation = r.reservation || r;
                                                if (reservation.reservation_utc) {
                                                    const hour = getHourFromReservation(reservation.reservation_utc);
                                                    acc[hour] = (acc[hour] || 0) + 1;
                                                }
                                                return acc;
                                            }, {});

                                            return Object.entries(timeSlots)
                                                .sort(([, a], [, b]) => (b as number) - (a as number))
                                                .slice(0, 8)
                                                .map(([hour, count]) => (
                                                    <div key={hour} className="flex items-center justify-between">
                                                        <span className="font-medium">{hour}:00</span>
                                                        <div className="flex items-center">
                                                            <div className="w-20 bg-gray-200 rounded-full h-2 mr-3">
                                                                <div
                                                                    className="bg-blue-600 h-2 rounded-full"
                                                                    style={{ width: `${((count as number) / Math.max(...Object.values(timeSlots) as number[])) * 100}%` }}
                                                                ></div>
                                                            </div>
                                                            <Badge variant="outline">{count as number}</Badge>
                                                        </div>
                                                    </div>
                                                ));
                                        })()}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </DashboardLayout>
    );
}