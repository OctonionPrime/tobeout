import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarIcon, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

interface TimeslotGeneratorProps {
  restaurantId: number;
}

export function TimeslotGenerator({ restaurantId }: TimeslotGeneratorProps) {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <CalendarIcon className="mr-2 h-5 w-5" />
          Timeslot Management
        </CardTitle>
        <CardDescription>
          Generate and manage available timeslots for reservations
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
            <p className="text-sm text-gray-500 mb-4">
              {timeslotStats?.lastDate ? (
                <>
                  Timeslots are currently generated until{" "}
                  <span className="font-medium">
                    {format(new Date(timeslotStats.lastDate), "MMMM d, yyyy")}
                  </span>
                </>
              ) : (
                "No timeslots have been generated yet"
              )}
            </p>

            <div className="flex items-center gap-4">
              <div className="grid gap-2">
                <label htmlFor="days-ahead" className="text-sm font-medium">
                  Generate for next
                </label>
                <Select value={daysAhead} onValueChange={setDaysAhead}>
                  <SelectTrigger id="days-ahead" className="w-[120px]">
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
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button 
          onClick={handleGenerateTimeslots} 
          disabled={generateMutation.isPending || isLoading}
        >
          {generateMutation.isPending ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Generate Timeslots
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}