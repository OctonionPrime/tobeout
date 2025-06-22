// ✅ FIXED: TimeslotGenerator.tsx with timezone-aware date display

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarIcon, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTime } from 'luxon'; // ✅ ADD: For timezone-aware date formatting

interface TimeslotGeneratorProps {
  restaurantId: number;
  restaurantTimezone: string; // ✅ ADD: Require timezone prop
}

export function TimeslotGenerator({ restaurantId, restaurantTimezone }: TimeslotGeneratorProps) {
  const [daysAhead, setDaysAhead] = useState("14");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Query for latest timeslot date
  const { data: timeslotStats, isLoading } = useQuery({
    queryKey: ['/api/timeslots/stats'],
    enabled: !!restaurantId,
  });

  // Mutation to generate timeslots
  const generateMutation = useMutation({
    mutationFn: async (days: string) => {
      const response = await apiRequest(
        "POST", 
        `/api/timeslots/generate?days=${days}`, 
        undefined
      );
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: data.message || "Timeslots generated successfully",
      });
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['/api/timeslots'] });
      queryClient.invalidateQueries({ queryKey: ['/api/timeslots/stats'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: `Failed to generate timeslots: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const handleGenerateTimeslots = () => {
    generateMutation.mutate(daysAhead);
  };

  // ✅ FIXED: Format dates using restaurant timezone
  const formatDateInRestaurantTime = (dateString: string) => {
    try {
      // Parse the date and display it in restaurant timezone context
      const date = DateTime.fromISO(dateString);
      return date.toFormat('MMMM d, yyyy');
    } catch (error) {
      // Fallback to original formatting if parsing fails
      return dateString;
    }
  };

  // ✅ NEW: Show current restaurant date
  const restaurantToday = DateTime.now().setZone(restaurantTimezone);
  const restaurantTodayDisplay = restaurantToday.toFormat('MMMM d, yyyy');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <CalendarIcon className="mr-2 h-5 w-5" />
          Timeslot Management
        </CardTitle>
        <CardDescription>
          Generate and manage available timeslots for reservations
          {/* ✅ NEW: Show timezone context */}
          <div className="text-xs text-gray-500 mt-1">
            Restaurant timezone: {restaurantTimezone}
          </div>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : (
          <div>
            {/* ✅ NEW: Show current restaurant date */}
            <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="text-sm text-blue-800">
                <strong>Today in restaurant:</strong> {restaurantTodayDisplay}
              </div>
              <div className="text-xs text-blue-600">
                Current time: {restaurantToday.toFormat('HH:mm:ss')}
              </div>
            </div>

            {/* ✅ FIXED: Display timeslot status with timezone context */}
            <p className="text-sm text-gray-500 mb-4">
              {timeslotStats?.lastDate ? (
                <>
                  Timeslots are currently generated until{" "}
                  <span className="font-medium">
                    {formatDateInRestaurantTime(timeslotStats.lastDate)}
                  </span>
                  {/* ✅ NEW: Show how many days ahead this is */}
                  {(() => {
                    const lastDate = DateTime.fromISO(timeslotStats.lastDate);
                    const daysDiff = Math.ceil(lastDate.diff(restaurantToday, 'days').days);
                    return daysDiff > 0 ? (
                      <span className="text-xs text-gray-400 ml-2">
                        ({daysDiff} days from today)
                      </span>
                    ) : (
                      <span className="text-xs text-orange-600 ml-2">
                        (⚠️ Past due - generate new timeslots)
                      </span>
                    );
                  })()}
                </>
              ) : (
                "No timeslots have been generated yet"
              )}
            </p>

            {/* ✅ ENHANCED: Better statistics display */}
            {timeslotStats && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <div className="text-sm font-medium text-gray-700 mb-1">Current Statistics</div>
                <div className="grid grid-cols-2 gap-4 text-xs text-gray-600">
                  <div>
                    <span className="font-medium">Total Slots:</span> {timeslotStats.totalCount || 0}
                  </div>
                  <div>
                    <span className="font-medium">Available:</span> {timeslotStats.freeCount || 0}
                  </div>
                </div>
              </div>
            )}

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

              {/* ✅ NEW: Preview of end date */}
              <div className="text-xs text-gray-500">
                <div>Will generate until:</div>
                <div className="font-medium">
                  {restaurantToday.plus({ days: parseInt(daysAhead) }).toFormat('MMM d, yyyy')}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button 
          onClick={handleGenerateTimeslots} 
          disabled={generateMutation.isPending || isLoading}
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