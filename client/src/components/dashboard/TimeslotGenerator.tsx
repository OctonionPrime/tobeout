import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarIcon, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTime } from 'luxon';
import { useRestaurantTimezone } from "@/components/layout/DashboardLayout";

interface TimeslotGeneratorProps {
    restaurantId: number;
}

interface TimeslotStats {
    lastDate?: string;
    totalCount?: number;
    freeCount?: number;
    reservedCount?: number;
    firstDate?: string;
}

export function TimeslotGenerator({ restaurantId }: TimeslotGeneratorProps) {
    const [daysAhead, setDaysAhead] = useState("14");
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { restaurantTimezone } = useRestaurantTimezone();

    // Query for latest timeslot date with timezone context
    const { data: timeslotStats, isLoading, error } = useQuery<TimeslotStats>({
        queryKey: ['/api/timeslots/stats', restaurantId, restaurantTimezone],
        queryFn: async () => {
            console.log(`📅 [TimeslotGenerator] Fetching stats for restaurant ${restaurantId} (${restaurantTimezone})`);

            const response = await fetch(`/api/timeslots/stats?restaurantId=${restaurantId}&timezone=${encodeURIComponent(restaurantTimezone || 'UTC')}`);

            if (!response.ok) {
                if (response.status === 404) {
                    console.log(`📅 [TimeslotGenerator] No timeslots found for restaurant ${restaurantId}`);
                    return { totalCount: 0, freeCount: 0 };
                }
                throw new Error(`Failed to fetch timeslot stats: ${response.status}`);
            }

            const data = await response.json();
            console.log(`📅 [TimeslotGenerator] Stats received:`, data);
            return data;
        },
        enabled: !!restaurantId && !!restaurantTimezone,
        staleTime: 60000, // 1 minute - timeslot stats don't change frequently
        retry: (failureCount, error: any) => {
            if (error?.message?.includes('404')) {
                return false;
            }
            return failureCount < 2;
        }
    });

    // Mutation to generate timeslots with timezone context
    const generateMutation = useMutation({
        mutationFn: async (days: string) => {
            console.log(`📅 [TimeslotGenerator] Generating ${days} days of timeslots for restaurant ${restaurantId} (${restaurantTimezone})`);

            const response = await apiRequest(
                "POST",
                `/api/timeslots/generate`,
                {
                    restaurantId,
                    days: parseInt(days),
                    timezone: restaurantTimezone || 'UTC'
                }
            );
            return response.json();
        },
        onSuccess: (data) => {
            console.log(`✅ [TimeslotGenerator] Successfully generated timeslots:`, data);

            toast({
                title: "Success",
                description: data.message || `Generated ${data.count || daysAhead} days of timeslots`,
            });

            // Invalidate relevant queries with timezone context
            queryClient.invalidateQueries({ queryKey: ['/api/timeslots'] });
            queryClient.invalidateQueries({ queryKey: ['/api/timeslots/stats', restaurantId, restaurantTimezone] });
            queryClient.invalidateQueries({ queryKey: ['/api/tables/availability'] }); // May affect availability
        },
        onError: (error: any) => {
            console.error(`❌ [TimeslotGenerator] Error generating timeslots:`, error);

            toast({
                title: "Error",
                description: `Failed to generate timeslots: ${error.message}`,
                variant: "destructive",
            });
        }
    });

    const handleGenerateTimeslots = () => {
        if (!restaurantTimezone) {
            toast({
                title: "Error",
                description: "Restaurant timezone not available. Please refresh the page.",
                variant: "destructive",
            });
            return;
        }

        generateMutation.mutate(daysAhead);
    };

    // Format dates using restaurant timezone
    const formatDateInRestaurantTime = (dateString: string) => {
        try {
            // Handle both UTC timestamps and date strings
            const date = DateTime.fromISO(dateString, { zone: 'utc' });
            const localDate = date.setZone(restaurantTimezone || 'UTC');
            return localDate.toFormat('MMMM d, yyyy');
        } catch (error) {
            console.warn(`[TimeslotGenerator] Error formatting date ${dateString}:`, error);
            return dateString;
        }
    };

    // Calculate current restaurant date and time
    const restaurantToday = DateTime.now().setZone(restaurantTimezone || 'UTC');
    const restaurantTodayDisplay = restaurantToday.toFormat('MMMM d, yyyy');

    // Calculate preview end date
    const previewEndDate = restaurantToday.plus({ days: parseInt(daysAhead) });

    if (error) {
        console.error(`❌ [TimeslotGenerator] Error loading stats:`, error);
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center">
                        <CalendarIcon className="mr-2 h-5 w-5" />
                        Timeslot Management
                    </CardTitle>
                    <CardDescription>Unable to load timeslot information</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="text-center py-4 text-gray-500">
                        <CalendarIcon className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                        <p className="text-sm">Unable to load timeslot data</p>
                        <p className="text-xs text-gray-400 mt-1">Check your connection and try again</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center">
                    <CalendarIcon className="mr-2 h-5 w-5" />
                    Timeslot Management
                </CardTitle>
                <CardDescription>
                    Generate and manage available timeslots for reservations
                    <div className="text-xs text-gray-500 mt-1">
                        Restaurant timezone: {restaurantTimezone || 'UTC'}
                    </div>
                </CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-16 w-full" />
                    </div>
                ) : (
                    <div>
                        {/* Current restaurant date display */}
                        <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                            <div className="text-sm text-blue-800">
                                <strong>Today in restaurant:</strong> {restaurantTodayDisplay}
                            </div>
                            <div className="text-xs text-blue-600">
                                Current time: {restaurantToday.toFormat('HH:mm:ss')} • {restaurantTimezone}
                            </div>
                        </div>

                        {/* Timeslot status with timezone context */}
                        <div className="mb-4">
                            {timeslotStats?.lastDate ? (
                                <div className="p-3 bg-gray-50 rounded-lg">
                                    <p className="text-sm text-gray-700 mb-2">
                                        <span className="font-medium">Coverage until:</span>{" "}
                                        {formatDateInRestaurantTime(timeslotStats.lastDate)}
                                        {(() => {
                                            try {
                                                const lastDate = DateTime.fromISO(timeslotStats.lastDate, { zone: 'utc' })
                                                    .setZone(restaurantTimezone || 'UTC');
                                                const daysDiff = Math.ceil(lastDate.diff(restaurantToday, 'days').days);

                                                if (daysDiff > 0) {
                                                    return (
                                                        <span className="text-xs text-green-600 ml-2">
                                                            ({daysDiff} days ahead ✓)
                                                        </span>
                                                    );
                                                } else {
                                                    return (
                                                        <span className="text-xs text-orange-600 ml-2">
                                                            (⚠️ Past due - generate new timeslots)
                                                        </span>
                                                    );
                                                }
                                            } catch (error) {
                                                return (
                                                    <span className="text-xs text-gray-400 ml-2">
                                                        (status unknown)
                                                    </span>
                                                );
                                            }
                                        })()}
                                    </p>

                                    {/* Statistics display */}
                                    <div className="grid grid-cols-3 gap-4 text-xs text-gray-600">
                                        <div>
                                            <span className="font-medium">Total:</span> {timeslotStats.totalCount || 0}
                                        </div>
                                        <div>
                                            <span className="font-medium">Available:</span> {timeslotStats.freeCount || 0}
                                        </div>
                                        <div>
                                            <span className="font-medium">Reserved:</span> {timeslotStats.reservedCount || 0}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                                    <p className="text-sm text-yellow-800">
                                        <strong>No timeslots generated yet</strong>
                                    </p>
                                    <p className="text-xs text-yellow-600 mt-1">
                                        Generate timeslots to enable reservation booking
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Generation controls */}
                        <div className="flex items-center gap-4">
                            <div className="grid gap-2">
                                <label htmlFor="days-ahead" className="text-sm font-medium">
                                    Generate for next
                                </label>
                                <Select value={daysAhead} onValueChange={setDaysAhead}>
                                    <SelectTrigger id="days-ahead" className="w-[140px]">
                                        <SelectValue placeholder="Select days" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="7">7 days</SelectItem>
                                        <SelectItem value="14">14 days</SelectItem>
                                        <SelectItem value="30">30 days</SelectItem>
                                        <SelectItem value="60">60 days</SelectItem>
                                        <SelectItem value="90">90 days</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Preview of end date */}
                            <div className="text-xs text-gray-500">
                                <div>Will generate until:</div>
                                <div className="font-medium text-gray-700">
                                    {previewEndDate.toFormat('MMM d, yyyy')}
                                </div>
                                <div className="text-gray-400">
                                    ({parseInt(daysAhead)} days from today)
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </CardContent>
            <CardFooter>
                <Button
                    onClick={handleGenerateTimeslots}
                    disabled={generateMutation.isPending || isLoading || !restaurantTimezone}
                    className="w-full"
                >
                    {generateMutation.isPending ? (
                        <>
                            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                            Generating...
                        </>
                    ) : (
                        <>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Generate Timeslots ({daysAhead} days)
                        </>
                    )}
                </Button>
            </CardFooter>
        </Card>
    );
}