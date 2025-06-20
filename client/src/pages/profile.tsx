import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2, Upload, AlertCircle, RefreshCcw } from "lucide-react"; // ✅ FIXED: RefreshCcw instead of Refresh

const profileFormSchema = z.object({
  name: z.string().min(1, "Restaurant name is required"),
  description: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().min(1, "Phone number is required"),
  cuisine: z.string().optional(),
  atmosphere: z.string().optional(),
  features: z.string().optional(),
  tags: z.string().optional(),
  languages: z.string().optional(),
  openingTime: z.string().optional(),
  closingTime: z.string().optional(),
  avgReservationDuration: z.coerce.number().min(30, "Minimum 30 minutes").max(240, "Maximum 4 hours").default(120), // ✅ FIX: Default to 120
  minGuests: z.coerce.number().min(1, "Minimum 1 guest").default(1),
  maxGuests: z.coerce.number().min(1, "Minimum 1 guest").max(100, "Maximum 100 guests").default(25), // ✅ FIX: Increase max to 100
  googleMapsLink: z.string().optional(),
  tripAdvisorLink: z.string().optional(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

export default function Profile() {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedData, setLastSavedData] = useState<any>(null); // Track changes
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ✅ FIX: Enhanced restaurant data fetching with better error handling
  const { data: restaurant, isLoading, error: restaurantError, refetch } = useQuery({
    queryKey: ['/api/restaurants/profile'],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/restaurants/profile");
      if (!response.ok) {
        throw new Error(`Failed to fetch restaurant data: ${response.status}`);
      }
      return response.json();
    },
    staleTime: 0, // ✅ FIX: Always fetch fresh data
    cacheTime: 0, // ✅ FIX: Don't cache stale data
    refetchOnMount: true, // ✅ FIX: Always refetch when component mounts
    refetchOnWindowFocus: true, // ✅ FIX: Refetch when window gains focus
  });

  // ✅ FIX: Get table data to show actual capacity statistics
  const { data: tables } = useQuery({
    queryKey: ["/api/tables"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/tables");
      if (!response.ok) throw new Error("Failed to fetch tables");
      return response.json();
    },
    enabled: !!restaurant, // Only fetch when restaurant data is available
  });

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      name: "",
      description: "",
      country: "",
      city: "",
      address: "",
      phone: "",
      cuisine: "",
      atmosphere: "",
      features: "",
      tags: "",
      languages: "",
      openingTime: "",
      closingTime: "",
      avgReservationDuration: 120, // ✅ FIX: Default to 120 minutes
      minGuests: 1,
      maxGuests: 25,
      googleMapsLink: "",
      tripAdvisorLink: "",
    },
  });

  // ✅ FIX: Enhanced form population with real database values
  useEffect(() => {
    if (restaurant && !isLoading) {
      console.log("📊 [Profile] Loading restaurant data:", restaurant);
      
      const formData = {
        name: restaurant.name || "",
        description: restaurant.description || "",
        country: restaurant.country || "",
        city: restaurant.city || "",
        address: restaurant.address || "",
        phone: restaurant.phone || "",
        cuisine: restaurant.cuisine || "",
        atmosphere: restaurant.atmosphere || "",
        features: restaurant.features ? restaurant.features.join(", ") : "",
        tags: restaurant.tags ? restaurant.tags.join(", ") : "",
        languages: restaurant.languages ? restaurant.languages.join(", ") : "",
        openingTime: restaurant.openingTime ? restaurant.openingTime.slice(0, 5) : "",
        closingTime: restaurant.closingTime ? restaurant.closingTime.slice(0, 5) : "",
        avgReservationDuration: restaurant.avgReservationDuration || 120, // ✅ FIX: Use actual DB value or 120 default
        minGuests: restaurant.minGuests || 1,
        maxGuests: restaurant.maxGuests || 25,
        googleMapsLink: restaurant.googleMapsLink || "",
        tripAdvisorLink: restaurant.tripAdvisorLink || "",
      };
      
      console.log("📊 [Profile] Form data being set:", formData);
      form.reset(formData);
      setLastSavedData(formData); // Track for change detection
    }
  }, [restaurant, isLoading, form]);

  // ✅ NEW: Calculate actual table statistics
  const tableStats = tables ? {
    totalTables: tables.length,
    totalCapacity: tables.reduce((sum: number, table: any) => sum + table.maxGuests, 0),
    averageCapacity: tables.length > 0 ? Math.round(tables.reduce((sum: number, table: any) => sum + table.maxGuests, 0) / tables.length) : 0,
    largestTable: tables.length > 0 ? Math.max(...tables.map((t: any) => t.maxGuests)) : 0,
  } : null;

  const updateProfileMutation = useMutation({
    mutationFn: async (values: ProfileFormValues) => {
      console.log("📊 [Profile] Saving data:", values);
      
      const payload = {
        ...values,
        features: values.features ? values.features.split(',').map(f => f.trim()) : undefined,
        tags: values.tags ? values.tags.split(',').map(t => t.trim()) : undefined,
        languages: values.languages ? values.languages.split(',').map(l => l.trim()) : undefined,
      };
      
      const response = await apiRequest("PATCH", "/api/restaurants/profile", payload);
      if (!response.ok) {
        throw new Error(`Failed to update profile: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      console.log("✅ [Profile] Successfully saved:", data);
      toast({
        title: "Success",
        description: "Restaurant profile updated successfully",
      });
      
      // ✅ FIX: Invalidate queries to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ['/api/restaurants/profile'] });
      queryClient.invalidateQueries({ queryKey: ['/api/reservations'] }); // May affect reservation logic
      
      setLastSavedData(form.getValues()); // Update tracking
    },
    onError: (error: any) => {
      console.error("❌ [Profile] Save failed:", error);
      toast({
        title: "Error",
        description: `Failed to update restaurant profile: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  function onSubmit(values: ProfileFormValues) {
    setIsSaving(true);
    updateProfileMutation.mutate(values, {
      onSettled: () => {
        setIsSaving(false);
      }
    });
  }

  // ✅ NEW: Check if form has unsaved changes
  const hasUnsavedChanges = () => {
    if (!lastSavedData) return false;
    const currentValues = form.getValues();
    return JSON.stringify(currentValues) !== JSON.stringify(lastSavedData);
  };

  // Show error state if restaurant data failed to load
  if (restaurantError) {
    return (
      <DashboardLayout>
        <div className="px-4 py-6 lg:px-8">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load restaurant data: {restaurantError.message}
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => refetch()}
                className="ml-2"
              >
                <RefreshCcw className="h-4 w-4 mr-1" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="px-4 py-6 lg:px-8">
        <header className="mb-6">
          <h2 className="text-2xl font-bold text-gray-800">Restaurant Profile</h2>
          <p className="text-gray-500 mt-1">Manage your restaurant information and settings</p>
          {hasUnsavedChanges() && (
            <p className="text-amber-600 text-sm mt-2">⚠️ You have unsaved changes</p>
          )}
        </header>

        {isLoading ? (
          <div className="h-96 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Basic Information</CardTitle>
                    <CardDescription>
                      This information will be displayed to guests when making reservations
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Restaurant Name</FormLabel>
                            <FormControl>
                              <Input placeholder="Restaurant name" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone Number</FormLabel>
                            <FormControl>
                              <Input placeholder="+1 (555) 123-4567" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Brief description of your restaurant" 
                              className="min-h-[100px]"
                              {...field} 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name="country"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Country</FormLabel>
                            <FormControl>
                              <Input placeholder="Country" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                              <Input placeholder="City" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="address"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Address</FormLabel>
                            <FormControl>
                              <Input placeholder="Street address" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="mt-4">
                      <p className="font-medium text-sm mb-2">Restaurant Photo</p>
                      <div className="border rounded-lg p-4 flex flex-col items-center justify-center">
                        <div className="w-full h-32 bg-gray-100 mb-4 rounded-md flex items-center justify-center">
                          {restaurant?.photo ? (
                            <img 
                              src={restaurant.photo} 
                              alt={restaurant.name} 
                              className="w-full h-full object-cover rounded-md"
                            />
                          ) : (
                            <div className="text-gray-400 text-sm">No photo uploaded</div>
                          )}
                        </div>
                        <Button type="button" variant="outline" className="w-full">
                          <Upload className="h-4 w-4 mr-2" />
                          Upload Photo
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Operating Hours & Capacity</CardTitle>
                    <CardDescription>
                      Set your restaurant's operating hours and reservation settings
                    </CardDescription>
                    {/* ✅ NEW: Show current table statistics */}
                    {tableStats && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-2">
                        <h4 className="font-medium text-blue-900 mb-2">Current Table Setup</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-blue-700">Tables:</span>
                            <span className="font-medium ml-1">{tableStats.totalTables}</span>
                          </div>
                          <div>
                            <span className="text-blue-700">Total Capacity:</span>
                            <span className="font-medium ml-1">{tableStats.totalCapacity}</span>
                          </div>
                          <div>
                            <span className="text-blue-700">Average Size:</span>
                            <span className="font-medium ml-1">{tableStats.averageCapacity}</span>
                          </div>
                          <div>
                            <span className="text-blue-700">Largest Table:</span>
                            <span className="font-medium ml-1">{tableStats.largestTable}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {!tableStats && (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          No tables found. Add tables to your restaurant to enable reservations.
                        </AlertDescription>
                      </Alert>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="openingTime"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Opening Time</FormLabel>
                            <FormControl>
                              <Input type="time" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="closingTime"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Closing Time</FormLabel>
                            <FormControl>
                              <Input type="time" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <Separator className="my-4" />

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name="avgReservationDuration"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Average Reservation Duration (minutes)</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                min={30}
                                max={240}
                                step={15}
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              How long a typical reservation lasts (affects availability calculation)
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="minGuests"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Minimum Guests</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                min={1}
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              Minimum party size allowed
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="maxGuests"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Maximum Guests</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                min={1}
                                max={100}
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              Maximum party size allowed
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Restaurant Details</CardTitle>
                    <CardDescription>
                      Add specific details about your restaurant (used by AI assistant)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="cuisine"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Cuisine Type</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Italian, French, Asian Fusion" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="atmosphere"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Atmosphere</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Casual, Fine Dining, Family-friendly" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name="features"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Features</FormLabel>
                            <FormControl>
                              <Input placeholder="Outdoor seating, Private rooms, etc. (comma separated)" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="tags"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tags</FormLabel>
                            <FormControl>
                              <Input placeholder="Family-friendly, Romantic, etc. (comma separated)" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="languages"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Languages Spoken</FormLabel>
                            <FormControl>
                              <Input placeholder="English, Spanish, etc. (comma separated)" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Online Presence</CardTitle>
                    <CardDescription>
                      Connect your restaurant to other platforms
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="googleMapsLink"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Google Maps Link</FormLabel>
                            <FormControl>
                              <Input placeholder="https://goo.gl/maps/..." {...field} />
                            </FormControl>
                            <FormDescription>
                              Your restaurant's Google Maps URL
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="tripAdvisorLink"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>TripAdvisor Link</FormLabel>
                            <FormControl>
                              <Input placeholder="https://www.tripadvisor.com/..." {...field} />
                            </FormControl>
                            <FormDescription>
                              Your restaurant's TripAdvisor URL
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                  <CardFooter className="flex justify-end">
                    <Button 
                      type="submit" 
                      disabled={isSaving}
                      className="flex items-center"
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          Save Changes
                        </>
                      )}
                    </Button>
                  </CardFooter>
                </Card>
              </div>
            </form>
          </Form>
        )}
      </div>
    </DashboardLayout>
  );
}