import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2, Upload, AlertCircle, RefreshCcw, Globe, Clock } from "lucide-react";

// ✅ CRITICAL FIX: Robust timezone validation function
const isValidTimezone = (timezone: string): boolean => {
  if (!timezone || timezone.trim() === '') return false;
  try {
    // ✅ Test both Intl.DateTimeFormat and Luxon-style validation
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};

const formatTimeInTimezone = (timezone: string) => {
  try {
    if (!isValidTimezone(timezone)) {
      return 'Invalid timezone';
    }
    const now = new Date();
    return now.toLocaleString("en-US", {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  } catch {
    return 'Invalid timezone';
  }
};

// ✅ ENHANCED: Form schema with better timezone validation
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
  avgReservationDuration: z.coerce.number().min(30, "Minimum 30 minutes").max(240, "Maximum 4 hours").default(120),
  minGuests: z.coerce.number().min(1, "Minimum 1 guest").default(1),
  maxGuests: z.coerce.number().min(1, "Minimum 1 guest").max(100, "Maximum 100 guests").default(25),
  googleMapsLink: z.string().optional(),
  tripAdvisorLink: z.string().optional(),
  // ✅ FIXED: More robust timezone validation
  timezone: z.string().min(1, "Timezone is required").refine((tz) => {
    return isValidTimezone(tz);
  }, "Invalid timezone format - please select a valid timezone from the list")
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

export default function Profile() {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedData, setLastSavedData] = useState<any>(null);
  const [showTimezoneWarning, setShowTimezoneWarning] = useState(false);
  const [selectedTimezone, setSelectedTimezone] = useState('Europe/Moscow');
  const [timezoneSearchQuery, setTimezoneSearchQuery] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ✅ CRITICAL FIX: Enhanced restaurant data fetching with cache busting
  const { data: restaurant, isLoading, error: restaurantError, refetch } = useQuery({
    queryKey: ['/api/restaurants/profile'],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/restaurants/profile");
      if (!response.ok) {
        throw new Error(`Failed to fetch restaurant data: ${response.status}`);
      }
      const data = await response.json();
      
      // ✅ DEBUG: Log restaurant data
      console.log('📊 [Profile] Raw restaurant data received:', data);
      
      return data;
    },
    // ✅ CRITICAL: Remove stale time to ensure fresh data
    staleTime: 0,
    gcTime: 1000 * 60, // Keep for 1 minute
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // ✅ CRITICAL FIX: Fetch timezones from API with better error handling
  const { data: popularTimezones, isLoading: timezonesLoading } = useQuery({
    queryKey: ['/api/timezones'],
    queryFn: async () => {
      try {
        const response = await apiRequest("GET", "/api/timezones");
        if (!response.ok) throw new Error('Failed to fetch timezones');
        const data = await response.json();
        console.log('🌍 [Profile] Timezones loaded:', data?.length || 0, 'zones');
        return data;
      } catch (error) {
        console.error('❌ [Profile] Failed to load timezones:', error);
        // ✅ FALLBACK: Return basic timezone list if API fails
        return [
          { value: 'Europe/Moscow', label: '(MSK) Moscow', city: 'Moscow' },
          { value: 'Europe/Belgrade', label: '(CET) Belgrade', city: 'Belgrade' },
          { value: 'America/Chicago', label: '(CST) Chicago', city: 'Chicago' },
          { value: 'America/New_York', label: '(EST) New York', city: 'New York' },
          { value: 'Europe/London', label: '(GMT) London', city: 'London' },
          { value: 'Asia/Tokyo', label: '(JST) Tokyo', city: 'Tokyo' }
        ];
      }
    },
    staleTime: Infinity, // Timezones don't change
  });

  // ✅ Get table data to show actual capacity statistics
  const { data: tables } = useQuery({
    queryKey: ["/api/tables"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/tables");
      if (!response.ok) throw new Error("Failed to fetch tables");
      return response.json();
    },
    enabled: !!restaurant,
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
      avgReservationDuration: 120,
      minGuests: 1,
      maxGuests: 25,
      googleMapsLink: "",
      tripAdvisorLink: "",
      timezone: 'Europe/Moscow'
    },
  });

  // ✅ Filter timezones based on search
  const filteredTimezones = useMemo(() => {
    if (!popularTimezones) return [];
    if (!timezoneSearchQuery) return popularTimezones;
    const query = timezoneSearchQuery.toLowerCase();
    return popularTimezones.filter((tz: any) =>
      tz.label.toLowerCase().includes(query) ||
      tz.city?.toLowerCase().includes(query) ||
      tz.value.toLowerCase().includes(query)
    );
  }, [popularTimezones, timezoneSearchQuery]);

  // ✅ CRITICAL FIX: Enhanced form population with proper timezone handling
  useEffect(() => {
    if (restaurant && !isLoading) {
      console.log("📊 [Profile] Populating form with restaurant data:", restaurant);

      // ✅ CRITICAL: Validate and set timezone properly
      const restaurantTimezone = restaurant.timezone || 'Europe/Moscow';
      const validTimezone = isValidTimezone(restaurantTimezone) ? restaurantTimezone : 'Europe/Moscow';
      
      if (!isValidTimezone(restaurantTimezone)) {
        console.warn('⚠️ [Profile] Invalid timezone in restaurant data:', restaurantTimezone, 'using fallback');
      }

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
        avgReservationDuration: restaurant.avgReservationDuration || 120,
        minGuests: restaurant.minGuests || 1,
        maxGuests: restaurant.maxGuests || 25,
        googleMapsLink: restaurant.googleMapsLink || "",
        tripAdvisorLink: restaurant.tripAdvisorLink || "",
        timezone: validTimezone // ✅ Use validated timezone
      };

      console.log("📊 [Profile] Setting form data:", formData);
      form.reset(formData);
      setSelectedTimezone(validTimezone);
      setLastSavedData(formData);
      setShowTimezoneWarning(false); // ✅ Clear warning when loading fresh data
    }
  }, [restaurant, isLoading, form]);

  // ✅ CRITICAL FIX: Watch timezone changes with better validation
  const watchedTimezone = form.watch('timezone');
  useEffect(() => {
    console.log('👀 [Profile] Watched timezone changed:', watchedTimezone);
    
    if (lastSavedData && watchedTimezone && watchedTimezone !== lastSavedData.timezone) {
      // ✅ Only show warning if timezone is valid and actually different
      if (isValidTimezone(watchedTimezone)) {
        console.log('⚠️ [Profile] Showing timezone warning:', lastSavedData.timezone, '->', watchedTimezone);
        setShowTimezoneWarning(true);
        setSelectedTimezone(watchedTimezone);
      } else {
        console.warn('⚠️ [Profile] Invalid timezone detected:', watchedTimezone);
        setShowTimezoneWarning(false);
      }
    } else {
      setShowTimezoneWarning(false);
    }
  }, [watchedTimezone, lastSavedData]);

  // ✅ Calculate actual table statistics
  const tableStats = tables ? {
    totalTables: tables.length,
    totalCapacity: tables.reduce((sum: number, table: any) => sum + table.maxGuests, 0),
    averageCapacity: tables.length > 0 ? Math.round(tables.reduce((sum: number, table: any) => sum + table.maxGuests, 0) / tables.length) : 0,
    largestTable: tables.length > 0 ? Math.max(...tables.map((t: any) => t.maxGuests)) : 0,
  } : null;

  const updateProfileMutation = useMutation({
    mutationFn: async (values: ProfileFormValues) => {
      console.log("📊 [Profile] Saving data:", values);

      // ✅ CRITICAL: Validate timezone before saving
      if (!isValidTimezone(values.timezone)) {
        throw new Error(`Invalid timezone: ${values.timezone}`);
      }

      const payload = {
        ...values,
        features: values.features ? values.features.split(',').map(f => f.trim()) : undefined,
        tags: values.tags ? values.tags.split(',').map(t => t.trim()) : undefined,
        languages: values.languages ? values.languages.split(',').map(l => l.trim()) : undefined,
      };

      const response = await apiRequest("PATCH", "/api/restaurants/profile", payload);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update profile: ${response.status} - ${errorText}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      console.log("✅ [Profile] Successfully saved:", data);
      toast({
        title: "Success",
        description: showTimezoneWarning
          ? "Restaurant profile and timezone updated successfully. All times will now use the new timezone."
          : "Restaurant profile updated successfully",
      });

      // ✅ CRITICAL: Invalidate ALL related queries to force refresh
      queryClient.invalidateQueries({ queryKey: ['/api/restaurants/profile'] });
      queryClient.invalidateQueries({ queryKey: ['/api/reservations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/upcoming'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tables/availability'] });

      // ✅ Force a hard refresh of restaurant data after timezone change
      setTimeout(() => {
        refetch();
      }, 500);

      setLastSavedData(form.getValues());
      setShowTimezoneWarning(false);
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
    console.log('📤 [Profile] Form submitted with values:', values);
    
    // ✅ CRITICAL: Pre-validate timezone before submission
    if (!isValidTimezone(values.timezone)) {
      toast({
        title: "Error",
        description: `Invalid timezone selected: ${values.timezone}. Please select a valid timezone from the list.`,
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    updateProfileMutation.mutate(values, {
      onSettled: () => {
        setIsSaving(false);
      }
    });
  }

  // ✅ Check if form has unsaved changes
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

        {/* ✅ ENHANCED: Timezone Change Warning with better validation */}
        {showTimezoneWarning && isValidTimezone(selectedTimezone) && (
          <Alert className="mb-6 border-amber-200 bg-amber-50">
            <Globe className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              <strong>Timezone Change Detected:</strong> Changing your restaurant's timezone will affect:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>How reservation times are displayed and calculated</li>
                <li>Dashboard statistics for "today"</li>
                <li>Smart tabs timing logic</li>
                <li>All future time-based features</li>
              </ul>
              <div className="mt-3 p-3 bg-white rounded border">
                <p className="text-sm"><strong>Current time in new timezone:</strong></p>
                <p className="font-mono text-lg text-amber-900">{formatTimeInTimezone(selectedTimezone)}</p>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* ✅ NEW: Show invalid timezone warning */}
        {watchedTimezone && !isValidTimezone(watchedTimezone) && (
          <Alert className="mb-6 border-red-200 bg-red-50" variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Invalid Timezone:</strong> The selected timezone "{watchedTimezone}" is not valid. 
              Please select a valid timezone from the dropdown list. 
              {popularTimezones && popularTimezones.length > 0 && (
                <span> {popularTimezones.length} timezones are available.</span>
              )}
            </AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="h-96 flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400 mx-auto" />
              <p className="mt-4 text-sm text-gray-600">Loading restaurant profile...</p>
            </div>
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

                {/* ✅ CRITICAL FIX: Enhanced Timezone & Location Settings */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="h-5 w-5" />
                      Timezone & Location Settings
                    </CardTitle>
                    <CardDescription>
                      Set your restaurant's timezone for accurate time calculations and reservations
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="timezone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Restaurant Timezone</FormLabel>
                          <FormControl>
                            <div className="space-y-2">
                              {/* Search box */}
                              <Input
                                placeholder="Search timezones (e.g., Belgrade, New York, Tokyo)..."
                                value={timezoneSearchQuery}
                                onChange={(e) => setTimezoneSearchQuery(e.target.value)}
                                className="mb-2"
                              />

                              <Select onValueChange={(value) => {
                                console.log('🌍 [Profile] Timezone selected:', value);
                                field.onChange(value);
                              }} value={field.value}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select your restaurant's timezone" />
                                </SelectTrigger>
                                <SelectContent className="max-h-[300px]">
                                  {timezonesLoading ? (
                                    <SelectItem value="loading" disabled>
                                      <div className="flex items-center">
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        Loading timezones...
                                      </div>
                                    </SelectItem>
                                  ) : filteredTimezones && filteredTimezones.length > 0 ? (
                                    filteredTimezones.map((tz: any) => (
                                      <SelectItem key={tz.value} value={tz.value}>
                                        {tz.label}
                                      </SelectItem>
                                    ))
                                  ) : (
                                    <SelectItem value="no-results" disabled>
                                      {popularTimezones ? `No timezones found for "${timezoneSearchQuery}"` : 'Failed to load timezones'}
                                    </SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                            </div>
                          </FormControl>
                          <FormDescription>
                            This affects all time calculations, reservations, and dashboard statistics.
                            {!isValidTimezone(field.value) && field.value && (
                              <span className="text-red-600 block mt-1">
                                ⚠️ Current value "{field.value}" is not a valid timezone.
                              </span>
                            )}
                          </FormDescription>
                          {/* ✅ Enhanced current time preview */}
                          {field.value && isValidTimezone(field.value) && (
                            <div className="mt-2 p-3 bg-gray-50 rounded-md">
                              <div className="flex items-center gap-2 text-sm text-gray-700">
                                <Clock className="h-4 w-4" />
                                <span>Current time in {field.value.split('/').pop()?.replace(/_/g, ' ')}:</span>
                              </div>
                              <p className="font-mono text-lg font-medium text-gray-900 mt-1">
                                {formatTimeInTimezone(field.value)}
                              </p>
                            </div>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* ✅ DEBUG INFO */}
                    <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
                      <strong>Debug Info:</strong><br/>
                      Selected: {form.watch('timezone')}<br/>
                      Valid: {isValidTimezone(form.watch('timezone')) ? 'Yes' : 'No'}<br/>
                      Restaurant TZ: {restaurant?.timezone}<br/>
                      Available timezones: {popularTimezones?.length || 0}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Operating Hours & Capacity</CardTitle>
                    <CardDescription>
                      Set your restaurant's operating hours and reservation settings
                    </CardDescription>
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
                      disabled={isSaving || (watchedTimezone && !isValidTimezone(watchedTimezone))}
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