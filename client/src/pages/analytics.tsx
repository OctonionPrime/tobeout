import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardLayout, useRestaurantTimezone } from "@/components/layout/DashboardLayout";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Users, TrendingUp, DollarSign, Calendar, Phone, MessageSquare, Star, Table, Clock, UserCheck,
    Repeat, Target, BarChart3, AlertTriangle, ArrowDown, ArrowUp, Minus, Info
} from "lucide-react";
import { DateTime } from "luxon";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';

// Define the shape of the analytics data from our new backend endpoint.
// This matches the AnalyticsOverview interface in storage.ts
interface AnalyticsOverview {
    timeframe: {
        start: string;
        end: string;
        timezone: string;
    };
    revenue: {
        totalRevenue: string;
        avgRevenuePerBooking: string;
        sources: { source: string; revenue: string; count: number }[];
    };
    reservations: {
        total: number;
        byStatus: Record<string, number>;
        funnel: {
            created: number;
            confirmed: number;
            seated: number;
            completed: number;
            noShowRate: number;
            cancellationRate: number;
        };
        avgGuests: number;
        bySource: { source: string; count: number }[];
    };
    guests: {
        total: number;
        new: number;
        returning: number;
        segmentation: {
            vip: number;
            regulars: number;
            atRisk: number;
        };
    };
    tables: {
        performance: {
            id: number;
            name: string;
            bookingCount: number;
            revenue: string;
            avgGuests: number;
        }[];
        turnaroundTime: number;
    };
    operations: {
        seatingEfficiency: number;
        popularTimes: { hour: number; count: number }[];
    };
}

// A single, efficient API call to fetch all pre-calculated analytics.
const fetchAnalyticsOverview = async (days: number): Promise<AnalyticsOverview> => {
    const response = await apiRequest("GET", `/api/analytics/overview?days=${days}`);
    if (!response.ok) {
        throw new Error("Failed to fetch analytics overview.");
    }
    return response.json();
};

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

export default function Analytics() {
    const { restaurantTimezone } = useRestaurantTimezone();
    const [timeframe, setTimeframe] = useState(30);

    // This single, lightweight query replaces all the previous heavy data fetching.
    const { data: analytics, isLoading, error } = useQuery<AnalyticsOverview>({
        queryKey: ["analyticsOverview", timeframe],
        queryFn: () => fetchAnalyticsOverview(timeframe),
        staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    });

    if (isLoading) {
        return (
            <DashboardLayout>
                <div className="px-4 py-6 lg:px-8">
                    <header className="mb-6">
                        <h2 className="text-2xl font-bold text-gray-800">Analytics Dashboard</h2>
                        <p className="text-gray-500 mt-1">Crunching the latest numbers for you...</p>
                    </header>
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <Skeleton className="h-28 w-full" />
                            <Skeleton className="h-28 w-full" />
                            <Skeleton className="h-28 w-full" />
                            <Skeleton className="h-28 w-full" />
                        </div>
                        <Skeleton className="h-80 w-full" />
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    if (error) {
        return (
            <DashboardLayout>
                <div className="px-4 py-6 lg:px-8">
                    <header className="mb-6">
                        <h2 className="text-2xl font-bold text-gray-800">Analytics Dashboard</h2>
                    </header>
                    <div className="text-center py-12 text-gray-500 bg-red-50 rounded-lg border border-red-200">
                        <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-red-400" />
                        <h3 className="text-lg font-semibold text-red-700">Could not load analytics data</h3>
                        <p className="text-sm mt-2">Please check your connection and try refreshing the page.</p>
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    if (!analytics) {
        return (
            <DashboardLayout>
                <div className="px-4 py-6 lg:px-8">
                    <header className="mb-6">
                        <h2 className="text-2xl font-bold text-gray-800">Analytics Dashboard</h2>
                        <p className="text-gray-500 mt-1">No analytics data available yet. Check back after some reservations have been made.</p>
                    </header>
                </div>
            </DashboardLayout>
        )
    }

    const { revenue, reservations, guests, tables, operations } = analytics;
    const funnelData = [
        { name: 'Confirmed', value: reservations.funnel.confirmed },
        { name: 'Seated', value: reservations.funnel.seated },
        { name: 'Completed', value: reservations.funnel.completed },
    ];

    return (
        <DashboardLayout>
            <div className="px-4 py-6 lg:px-8">
                <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">Analytics Dashboard</h2>
                        <p className="text-gray-500 mt-1">
                            Insights for the last {timeframe} days in <span className="font-semibold">{restaurantTimezone}</span>
                        </p>
                    </div>
                    <Tabs value={String(timeframe)} onValueChange={(val) => setTimeframe(Number(val))} className="mt-4 md:mt-0">
                        <TabsList>
                            <TabsTrigger value="7">7 Days</TabsTrigger>
                            <TabsTrigger value="30">30 Days</TabsTrigger>
                            <TabsTrigger value="90">90 Days</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </header>

                <Tabs defaultValue="overview" className="space-y-6">
                    <TabsList className="grid w-full grid-cols-2 md:grid-cols-4">
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="revenue">Revenue</TabsTrigger>
                        <TabsTrigger value="guests">Guest Insights</TabsTrigger>
                        <TabsTrigger value="operations">Operations</TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total Revenue</CardTitle><DollarSign className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">${revenue.totalRevenue}</div><p className="text-xs text-muted-foreground">from {reservations.funnel.completed} completed bookings</p></CardContent></Card>
                            <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total Reservations</CardTitle><Calendar className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{reservations.total}</div><p className="text-xs text-muted-foreground">{reservations.funnel.confirmed} confirmed</p></CardContent></Card>
                            <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total Guests</CardTitle><Users className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{guests.total}</div><p className="text-xs text-muted-foreground">{guests.new} new guests</p></CardContent></Card>
                            <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">No-Show Rate</CardTitle><AlertTriangle className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{reservations.funnel.noShowRate.toFixed(1)}%</div><p className="text-xs text-muted-foreground">{reservations.byStatus.no_show || 0} no-shows</p></CardContent></Card>
                        </div>

                        <Card>
                            <CardHeader>
                                <CardTitle>Reservation Funnel</CardTitle>
                                <CardDescription>From confirmed booking to completed visit.</CardDescription>
                            </CardHeader>
                            <CardContent className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={funnelData} layout="vertical">
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis type="number" />
                                        <YAxis type="category" dataKey="name" width={80} />
                                        <Tooltip />
                                        <Bar dataKey="value" fill="#8884d8" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="revenue" className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <Card><CardHeader><CardTitle>Total Revenue</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">${revenue.totalRevenue}</p></CardContent></Card>
                            <Card><CardHeader><CardTitle>Avg. Revenue per Booking</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">${revenue.avgRevenuePerBooking}</p></CardContent></Card>
                            <Card><CardHeader><CardTitle>Avg. Party Size</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{reservations.avgGuests.toFixed(1)}</p></CardContent></Card>
                        </div>
                        <Card>
                            <CardHeader><CardTitle>Top Performing Tables by Revenue</CardTitle></CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {tables.performance.sort((a, b) => parseFloat(b.revenue) - parseFloat(a.revenue)).slice(0, 5).map(table => (
                                        <div key={table.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                                            <p className="font-medium">Table {table.name}</p>
                                            <Badge variant="secondary">${parseFloat(table.revenue).toFixed(2)} from {table.bookingCount} bookings</Badge>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="guests" className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <Card><CardHeader><CardTitle>Total Unique Guests</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{guests.total}</p></CardContent></Card>
                            <Card><CardHeader><CardTitle>New Guests</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{guests.new}</p></CardContent></Card>
                            <Card><CardHeader><CardTitle>Returning Guests</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{guests.returning}</p></CardContent></Card>
                        </div>
                        <Card>
                            <CardHeader><CardTitle>Guest Segmentation</CardTitle></CardHeader>
                            <CardContent className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={[
                                            { name: 'VIP', value: guests.segmentation.vip },
                                            { name: 'Regulars', value: guests.segmentation.regulars },
                                            { name: 'At Risk', value: guests.segmentation.atRisk },
                                            { name: 'Standard', value: guests.total - guests.segmentation.vip - guests.segmentation.regulars - guests.segmentation.atRisk }
                                        ]}
                                            dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                                            {[{ name: 'VIP', value: guests.segmentation.vip }].map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="operations" className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <Card><CardHeader><CardTitle>Avg. Table Turnaround</CardTitle><CardDescription>Time from seated to completed</CardDescription></CardHeader><CardContent><p className="text-3xl font-bold">{tables.turnaroundTime} min</p></CardContent></Card>
                            <Card><CardHeader><CardTitle>Avg. Seating Efficiency</CardTitle><CardDescription>Time from confirmed to seated</CardDescription></CardHeader><CardContent><p className="text-3xl font-bold">{operations.seatingEfficiency} min</p></CardContent></Card>
                            <Card><CardHeader><CardTitle>Cancellation Rate</CardTitle><CardDescription>Bookings cancelled by guest or staff</CardDescription></CardHeader><CardContent><p className="text-3xl font-bold">{reservations.funnel.cancellationRate.toFixed(1)}%</p></CardContent></Card>
                        </div>
                        <Card>
                            <CardHeader><CardTitle>Popular Booking Times</CardTitle></CardHeader>
                            <CardContent className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={operations.popularTimes}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="hour" tickFormatter={(hour) => `${hour}:00`} />
                                        <YAxis />
                                        <Tooltip />
                                        <Bar dataKey="count" fill="#82ca9d" name="Bookings" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </DashboardLayout>
    );
}
