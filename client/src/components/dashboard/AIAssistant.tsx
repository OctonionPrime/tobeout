import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bot } from "lucide-react";
import { DateTime } from "luxon";
import { useRestaurantTimezone } from "@/components/layout/DashboardLayout";

interface AIAssistantProps {
    restaurantId: number;
}

interface AIActivity {
    id: number;
    type: string;
    description: string;
    createdAt: string; // UTC timestamp from backend
}

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

// Helper function to format time for restaurant timezone
const formatTimeForRestaurant = (utcTimestamp: string, restaurantTimezone: string): string => {
    try {
        const utcDateTime = parsePostgresTimestamp(utcTimestamp);
        const localDateTime = utcDateTime.setZone(restaurantTimezone);

        const now = DateTime.now().setZone(restaurantTimezone);
        const diffInMinutes = now.diff(localDateTime, 'minutes').minutes;

        if (diffInMinutes < 1) {
            return 'just now';
        } else if (diffInMinutes < 60) {
            return `${Math.floor(diffInMinutes)} minute${Math.floor(diffInMinutes) !== 1 ? 's' : ''} ago`;
        } else if (diffInMinutes < 1440) { // Less than 24 hours
            const hours = Math.floor(diffInMinutes / 60);
            return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
        } else {
            const days = Math.floor(diffInMinutes / 1440);
            if (days < 7) {
                return `${days} day${days !== 1 ? 's' : ''} ago`;
            } else {
                // For older activities, show the actual date/time
                return localDateTime.toFormat('MMM d, h:mm a');
            }
        }
    } catch (error) {
        console.warn(`[AIAssistant] Error formatting time for ${utcTimestamp}:`, error);
        return 'recently';
    }
};

export function AIAssistant({ restaurantId }: AIAssistantProps) {
    const { restaurantTimezone } = useRestaurantTimezone();

    const { data: activities, isLoading, error } = useQuery<AIActivity[]>({
        queryKey: [`/api/ai/activities`, restaurantId, restaurantTimezone],
        queryFn: async () => {
            console.log(`🤖 [AIAssistant] Fetching activities for restaurant ${restaurantId} (${restaurantTimezone})`);

            const response = await fetch(`/api/ai/activities?restaurantId=${restaurantId}&timezone=${encodeURIComponent(restaurantTimezone || 'UTC')}`);

            if (!response.ok) {
                if (response.status === 404) {
                    console.log(`🤖 [AIAssistant] No AI activities found for restaurant ${restaurantId}`);
                    return [];
                }
                throw new Error(`Failed to fetch AI activities: ${response.status}`);
            }

            const data = await response.json();
            console.log(`🤖 [AIAssistant] Received ${data?.length || 0} activities`);
            return data || [];
        },
        enabled: !!restaurantId && !!restaurantTimezone,
        staleTime: 30000, // 30 seconds - AI activities can be relatively fresh
        retry: (failureCount, error: any) => {
            // Don't retry on 404 (no activities)
            if (error?.message?.includes('404')) {
                return false;
            }
            return failureCount < 2;
        }
    });

    if (isLoading) {
        return (
            <Card className="border border-gray-200">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Bot className="h-5 w-5 text-blue-600" />
                        AI Assistant
                    </CardTitle>
                    <CardDescription>Recent activities in {restaurantTimezone || 'UTC'}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-lg"></div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (error) {
        console.error(`❌ [AIAssistant] Error loading activities:`, error);
        return (
            <Card className="border border-gray-200">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Bot className="h-5 w-5 text-blue-600" />
                        AI Assistant
                    </CardTitle>
                    <CardDescription>Recent activities</CardDescription>
                </CardHeader>
                <CardContent className="p-4">
                    <div className="text-center py-8 text-gray-500">
                        <Bot className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                        <p className="text-sm">Unable to load AI activities</p>
                        <p className="text-xs text-gray-400 mt-1">Check your connection and try again</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border border-gray-200">
            <CardHeader className="border-b border-gray-200">
                <CardTitle className="flex items-center gap-2">
                    <Bot className="h-5 w-5 text-blue-600" />
                    AI Assistant
                </CardTitle>
                <CardDescription>
                    Recent activities • {restaurantTimezone || 'UTC'}
                </CardDescription>
            </CardHeader>
            <CardContent className="p-4 h-64 overflow-y-auto">
                <div className="space-y-4">
                    {activities && activities.length > 0 ? (
                        activities.map((activity) => (
                            <div key={activity.id} className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                                <div className="flex items-start">
                                    <div className="h-8 w-8 rounded-full bg-blue-200 flex items-center justify-center text-blue-700">
                                        <Bot size={16} />
                                    </div>
                                    <div className="ml-3 flex-1">
                                        <div className="text-xs text-blue-600 font-medium">AI Assistant</div>
                                        <div className="text-sm mt-1 text-gray-800">{activity.description}</div>
                                        <div className="text-xs text-gray-500 mt-1">
                                            {formatTimeForRestaurant(activity.createdAt, restaurantTimezone || 'UTC')}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="text-center py-8 text-gray-500">
                            <Bot className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                            <p>No AI assistant activities yet</p>
                            <p className="text-xs text-gray-400 mt-1">
                                AI activities will appear here once configured
                            </p>
                        </div>
                    )}
                </div>
            </CardContent>
            <CardFooter className="px-6 py-4 border-t border-gray-200">
                <Button variant="link" className="text-sm font-medium text-blue-600 hover:text-blue-500 p-0">
                    Configure AI assistant →
                </Button>
            </CardFooter>
        </Card>
    );
}