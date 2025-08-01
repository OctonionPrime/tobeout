import { useQuery } from "@tanstack/react-query";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from "@/components/ui/drawer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { format, parseISO } from "date-fns";
import { User, Star, TrendingUp, BarChart, ShoppingBag, MessageSquare, AlertTriangle, Calendar, Clock, Tag } from "lucide-react";

// Define the type for the analytics data based on backend's response
// This ensures type safety when accessing the data
interface GuestAnalytics {
    guest: {
        id: number;
        name: string;
        loyaltyStatus: string;
    };
    visitCount: number;
    noShowCount: number;
    reputationScore: number;
    completionRate: number;
    averageSpending: string;
    totalSpent: string;
    lastVisit: string | null;
    preferredTimes: string[];
    recommendations: {
        approach: string;
        notes: string;
    };
    recentReservations: {
        id: number;
        date: string;
        status: string;
        guests: number;
        table: string | null;
    }[];
}

interface GuestAnalyticsDrawerProps {
    guest: { id: number; name: string; phone: string; } | null;
    isOpen: boolean;
    onClose: () => void;
}

// API fetcher function to get analytics for a specific guest
const fetchGuestAnalytics = async (guestId: number): Promise<GuestAnalytics> => {
    // This API call leverages powerful backend endpoint that is currently unused
    const res = await apiRequest("GET", `/api/guests/${guestId}/analytics`);
    if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to fetch guest analytics');
    }
    return res.json();
};

export function GuestAnalyticsDrawer({ guest, isOpen, onClose }: GuestAnalyticsDrawerProps) {
    // useQuery hook to fetch data when the drawer is opened for a specific guest
    const { data: analytics, isLoading, error } = useQuery<GuestAnalytics, Error>({
        queryKey: ['guestAnalytics', guest?.id],
        queryFn: () => fetchGuestAnalytics(guest!.id),
        enabled: !!guest, // Crucially, this query only runs when a guest is selected
        staleTime: 5 * 60 * 1000, // Cache data for 5 minutes
        retry: 1, // Retry once on failure
    });

    const renderLoadingState = () => (
        <div className="p-4 space-y-6">
            <Skeleton className="h-24 w-full" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
            </div>
            <Skeleton className="h-48 w-full" />
        </div>
    );

    const renderErrorState = () => (
        <div className="p-8 text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-red-400" />
            <h3 className="mt-4 text-lg font-medium text-red-800">Could Not Load Analytics</h3>
            <p className="mt-2 text-sm text-muted-foreground">{error?.message || "An unexpected error occurred."}</p>
            <Button variant="outline" className="mt-4" onClick={onClose}>Close</Button>
        </div>
    );

    const renderContent = () => {
        if (isLoading) return renderLoadingState();
        if (error) return renderErrorState();
        if (!analytics) return <div className="p-4 text-center">No analytics data available for this guest.</div>;

        const reputationColor = analytics.reputationScore > 90 ? 'bg-green-500' : analytics.reputationScore > 75 ? 'bg-yellow-500' : 'bg-red-500';
        const completionColor = analytics.completionRate > 90 ? 'bg-green-500' : analytics.completionRate > 75 ? 'bg-yellow-500' : 'bg-red-500';

        return (
            <div className="p-4 space-y-6">
                {/* Staff Recommendation Card */}
                <Card className="bg-blue-50 border-blue-200 shadow-sm">
                    <CardHeader>
                        <CardTitle className="flex items-center text-blue-800"><MessageSquare className="mr-2 h-5 w-5" />Staff Recommendation</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-lg font-semibold text-blue-900">{analytics.recommendations.approach}</p>
                        <p className="text-sm text-blue-700 mt-1">{analytics.recommendations.notes}</p>
                    </CardContent>
                </Card>

                {/* Key Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card><CardHeader><CardTitle className="text-sm flex items-center"><Star className="mr-2 h-4 w-4" />Loyalty Status</CardTitle></CardHeader><CardContent><Badge className="text-md" variant="secondary">{analytics.guest.loyaltyStatus}</Badge></CardContent></Card>
                    <Card><CardHeader><CardTitle className="text-sm flex items-center"><ShoppingBag className="mr-2 h-4 w-4" />Total Spent</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">${analytics.totalSpent}</p></CardContent></Card>
                    <Card><CardHeader><CardTitle className="text-sm flex items-center"><TrendingUp className="mr-2 h-4 w-4" />Avg. Spend</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">${analytics.averageSpending}</p></CardContent></Card>
                    <Card><CardHeader><CardTitle className="text-sm flex items-center"><BarChart className="mr-2 h-4 w-4" />Total Visits</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{analytics.visitCount}</p></CardContent></Card>
                </div>

                {/* Reputation & History Card */}
                <Card>
                    <CardHeader><CardTitle>Guest Profile & History</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <div className="flex justify-between mb-1 text-sm font-medium"><span>Reputation Score</span><span className="font-bold">{analytics.reputationScore}%</span></div>
                            <Progress value={analytics.reputationScore} className="h-2 [&>div]:bg-green-500" indicatorClassName={reputationColor} />
                        </div>
                        <div>
                            <div className="flex justify-between mb-1 text-sm font-medium"><span>Visit Completion Rate</span><span className="font-bold">{analytics.completionRate}%</span></div>
                            <Progress value={analytics.completionRate} className="h-2" indicatorClassName={completionColor} />
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-2 text-sm">
                            <div className="flex items-center"><Calendar className="mr-2 h-4 w-4 text-muted-foreground" />Last Visit: <span className="font-semibold ml-1">{analytics.lastVisit ? format(parseISO(analytics.lastVisit), 'MMM d, yyyy') : 'N/A'}</span></div>
                            <div className="flex items-center"><Tag className="mr-2 h-4 w-4 text-muted-foreground" />Preferred Times: <span className="font-semibold ml-1">{analytics.preferredTimes.join(', ') || 'N/A'}</span></div>
                            <div className="flex items-center"><AlertTriangle className="mr-2 h-4 w-4 text-muted-foreground" />No-Shows: <span className="font-semibold ml-1">{analytics.noShowCount}</span></div>
                        </div>
                    </CardContent>
                </Card>

                {/* Recent Reservations List */}
                <Card>
                    <CardHeader><CardTitle>Recent Activity</CardTitle></CardHeader>
                    <CardContent>
                        <ul className="space-y-2">
                            {analytics.recentReservations.length > 0 ? analytics.recentReservations.slice(0, 5).map(res => (
                                <li key={res.id} className="text-sm flex justify-between items-center p-2 rounded-md hover:bg-muted/50">
                                    <div className="flex flex-col">
                                        <span className="font-semibold">{format(parseISO(res.date), 'EEEE, MMM d, yyyy')}</span>
                                        <span className="text-muted-foreground">{res.guests} guests at Table {res.table || 'N/A'}</span>
                                    </div>
                                    <Badge variant={res.status === 'completed' ? 'success' : res.status === 'canceled' || res.status === 'no_show' ? 'destructive' : 'outline'}>{res.status.replace('_', ' ').toUpperCase()}</Badge>
                                </li>
                            )) : (
                                <p className="text-sm text-muted-foreground text-center py-4">No recent reservations found.</p>
                            )}
                        </ul>
                    </CardContent>
                </Card>
            </div>
        );
    };

    return (
        <Drawer open={isOpen} onOpenChange={onClose}>
            <DrawerContent className="max-h-[90vh]">
                <div className="overflow-y-auto">
                    <DrawerHeader className="text-left">
                        <DrawerTitle className="text-2xl">{guest?.name || 'Guest Analytics'}</DrawerTitle>
                        <DrawerDescription>{guest?.phone}</DrawerDescription>
                    </DrawerHeader>
                    {renderContent()}
                    <DrawerFooter>
                        <Button onClick={onClose}>Close</Button>
                    </DrawerFooter>
                </div>
            </DrawerContent>
        </Drawer>
    );
}
