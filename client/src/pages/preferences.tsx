import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Settings, Moon, Sun, Bell, Languages, Loader2, Save, Clock } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { Separator } from "@/components/ui/separator";

const appearanceFormSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  fontSize: z.enum(["sm", "md", "lg"]),
  animationsEnabled: z.boolean().default(true),
});

const notificationsFormSchema = z.object({
  enableEmailNotifications: z.boolean().default(true),
  enableBrowserNotifications: z.boolean().default(true),
  reservationConfirmations: z.boolean().default(true),
  reservationReminders: z.boolean().default(true),
  newReservationAlerts: z.boolean().default(true),
  cancelledReservationAlerts: z.boolean().default(true),
  dailySummary: z.boolean().default(false),
  weeklySummary: z.boolean().default(true),
});

const regionalizationFormSchema = z.object({
  language: z.string().min(1, "Language is required"),
  dateFormat: z.string().min(1, "Date format is required"),
  timeFormat: z.enum(["12h", "24h"]),
  timezone: z.string().min(1, "Timezone is required"),
  currency: z.string().min(1, "Currency is required"),
});

type AppearanceFormValues = z.infer<typeof appearanceFormSchema>;
type NotificationsFormValues = z.infer<typeof notificationsFormSchema>;
type RegionalizationFormValues = z.infer<typeof regionalizationFormSchema>;

export default function Preferences() {
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<string>("appearance");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Forms
  const appearanceForm = useForm<AppearanceFormValues>({
    resolver: zodResolver(appearanceFormSchema),
    defaultValues: {
      theme: (theme as "light" | "dark" | "system") || "light",
      fontSize: "md",
      animationsEnabled: true,
    },
  });

  const notificationsForm = useForm<NotificationsFormValues>({
    resolver: zodResolver(notificationsFormSchema),
    defaultValues: {
      enableEmailNotifications: true,
      enableBrowserNotifications: true,
      reservationConfirmations: true,
      reservationReminders: true,
      newReservationAlerts: true,
      cancelledReservationAlerts: true,
      dailySummary: false,
      weeklySummary: true,
    },
  });

  const regionalizationForm = useForm<RegionalizationFormValues>({
    resolver: zodResolver(regionalizationFormSchema),
    defaultValues: {
      language: "en",
      dateFormat: "MM/DD/YYYY",
      timeFormat: "12h",
      timezone: "America/New_York",
      currency: "USD",
    },
  });

  // Mutations
  const saveAppearanceMutation = useMutation({
    mutationFn: async (values: AppearanceFormValues) => {
      // In a real app, you would save these to the server
      // For now, we'll just save the theme locally
      setTheme(values.theme);
      
      // Mock API call for demonstration
      return new Promise((resolve) => {
        setTimeout(() => resolve({ success: true }), 500);
      });
    },
    onSuccess: () => {
      toast({
        title: "Appearance settings saved",
        description: "Your appearance preferences have been updated",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to save appearance settings: ${error}`,
        variant: "destructive",
      });
    }
  });

  const saveNotificationsMutation = useMutation({
    mutationFn: async (values: NotificationsFormValues) => {
      // Mock API call for demonstration
      return new Promise((resolve) => {
        setTimeout(() => resolve({ success: true }), 500);
      });
    },
    onSuccess: () => {
      toast({
        title: "Notification settings saved",
        description: "Your notification preferences have been updated",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to save notification settings: ${error}`,
        variant: "destructive",
      });
    }
  });

  const saveRegionalizationMutation = useMutation({
    mutationFn: async (values: RegionalizationFormValues) => {
      // Mock API call for demonstration
      return new Promise((resolve) => {
        setTimeout(() => resolve({ success: true }), 500);
      });
    },
    onSuccess: () => {
      toast({
        title: "Regionalization settings saved",
        description: "Your language and regional preferences have been updated",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to save regionalization settings: ${error}`,
        variant: "destructive",
      });
    }
  });

  // Submit handlers
  const onAppearanceSubmit = (values: AppearanceFormValues) => {
    saveAppearanceMutation.mutate(values);
  };

  const onNotificationsSubmit = (values: NotificationsFormValues) => {
    saveNotificationsMutation.mutate(values);
  };

  const onRegionalizationSubmit = (values: RegionalizationFormValues) => {
    saveRegionalizationMutation.mutate(values);
  };

  // Language options
  const languages = [
    { value: "en", label: "English" },
    { value: "es", label: "Español" },
    { value: "fr", label: "Français" },
    { value: "de", label: "Deutsch" },
    { value: "it", label: "Italiano" },
    { value: "ru", label: "Русский" },
    { value: "zh", label: "中文" },
    { value: "ja", label: "日本語" },
  ];

  // Date format options
  const dateFormats = [
    { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
    { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
    { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
    { value: "DD.MM.YYYY", label: "DD.MM.YYYY" },
  ];

  // Timezone options (a small subset for demonstration)
  const timezones = [
    { value: "Europe/Moscow", label: "Moscow Time (MSK)" },
    { value: "America/New_York", label: "Eastern Time (US & Canada)" },
    { value: "America/Chicago", label: "Central Time (US & Canada)" },
    { value: "America/Denver", label: "Mountain Time (US & Canada)" },
    { value: "America/Los_Angeles", label: "Pacific Time (US & Canada)" },
    { value: "Europe/London", label: "London" },
    { value: "Europe/Paris", label: "Paris" },
    { value: "Europe/Berlin", label: "Berlin" },
    { value: "Asia/Tokyo", label: "Tokyo" },
    { value: "Asia/Shanghai", label: "Shanghai" },
  ];

  // Currency options
  const currencies = [
    { value: "USD", label: "USD ($)" },
    { value: "EUR", label: "EUR (€)" },
    { value: "GBP", label: "GBP (£)" },
    { value: "JPY", label: "JPY (¥)" },
    { value: "CNY", label: "CNY (¥)" },
    { value: "RUB", label: "RUB (₽)" },
  ];

  return (
    <DashboardLayout>
      <div className="px-4 py-6 lg:px-8">
        <header className="mb-6">
          <div className="flex items-center">
            <Settings className="h-8 w-8 mr-3 text-primary" />
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Preferences</h2>
              <p className="text-gray-500 mt-1">Customize your ToBeOut experience</p>
            </div>
          </div>
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full mb-6">
          <TabsList className="mb-4">
            <TabsTrigger value="appearance" className="flex items-center">
              <Sun className="h-4 w-4 mr-2" />
              Appearance
            </TabsTrigger>
            <TabsTrigger value="notifications" className="flex items-center">
              <Bell className="h-4 w-4 mr-2" />
              Notifications
            </TabsTrigger>
            <TabsTrigger value="regionalization" className="flex items-center">
              <Languages className="h-4 w-4 mr-2" />
              Regionalization
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="appearance">
            <Card>
              <CardHeader>
                <div className="flex items-center">
                  <Sun className="h-5 w-5 mr-2 text-primary" />
                  <CardTitle>Appearance</CardTitle>
                </div>
                <CardDescription>
                  Customize how the application looks and feels
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...appearanceForm}>
                  <form id="appearance-form" onSubmit={appearanceForm.handleSubmit(onAppearanceSubmit)} className="space-y-6">
                    <FormField
                      control={appearanceForm.control}
                      name="theme"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Theme</FormLabel>
                          <div className="relative">
                            <FormControl>
                              <Select
                                value={field.value}
                                onValueChange={(value: "light" | "dark" | "system") => {
                                  field.onChange(value);
                                  setTheme(value);
                                }}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select theme" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="light" className="flex items-center">
                                    <Sun className="h-4 w-4 mr-2" />
                                    Light
                                  </SelectItem>
                                  <SelectItem value="dark" className="flex items-center">
                                    <Moon className="h-4 w-4 mr-2" />
                                    Dark
                                  </SelectItem>
                                  <SelectItem value="system" className="flex items-center">
                                    <Settings className="h-4 w-4 mr-2" />
                                    System
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </FormControl>
                          </div>
                          <FormDescription>
                            Choose between light, dark, or system theme
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={appearanceForm.control}
                      name="fontSize"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Font Size</FormLabel>
                          <FormControl>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select font size" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="sm">Small</SelectItem>
                                <SelectItem value="md">Medium</SelectItem>
                                <SelectItem value="lg">Large</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormDescription>
                            Select your preferred text size
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={appearanceForm.control}
                      name="animationsEnabled"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base">Enable Animations</FormLabel>
                            <FormDescription>
                              Turn interface animations on or off
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </form>
                </Form>
              </CardContent>
              <CardFooter>
                <Button 
                  type="submit"
                  form="appearance-form"
                  className="ml-auto"
                  disabled={saveAppearanceMutation.isPending || !appearanceForm.formState.isDirty}
                >
                  {saveAppearanceMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Settings
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>
          
          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <div className="flex items-center">
                  <Bell className="h-5 w-5 mr-2 text-primary" />
                  <CardTitle>Notifications</CardTitle>
                </div>
                <CardDescription>
                  Manage your notification preferences
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...notificationsForm}>
                  <form id="notifications-form" onSubmit={notificationsForm.handleSubmit(onNotificationsSubmit)} className="space-y-6">
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium">Notification Channels</h3>
                      
                      <FormField
                        control={notificationsForm.control}
                        name="enableEmailNotifications"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Email Notifications</FormLabel>
                              <FormDescription>
                                Receive notifications via email
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={notificationsForm.control}
                        name="enableBrowserNotifications"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Browser Notifications</FormLabel>
                              <FormDescription>
                                Receive notifications in your browser
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <Separator />
                    
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium">Notification Types</h3>
                      
                      <FormField
                        control={notificationsForm.control}
                        name="reservationConfirmations"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Reservation Confirmations</FormLabel>
                              <FormDescription>
                                When a reservation is confirmed
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={notificationsForm.control}
                        name="reservationReminders"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Reservation Reminders</FormLabel>
                              <FormDescription>
                                Reminders about upcoming reservations
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={notificationsForm.control}
                        name="newReservationAlerts"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">New Reservation Alerts</FormLabel>
                              <FormDescription>
                                When a new reservation is made
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={notificationsForm.control}
                        name="cancelledReservationAlerts"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Cancellation Alerts</FormLabel>
                              <FormDescription>
                                When a reservation is cancelled
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <Separator />
                    
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium">Summary Reports</h3>
                      
                      <FormField
                        control={notificationsForm.control}
                        name="dailySummary"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Daily Summary</FormLabel>
                              <FormDescription>
                                Daily summary of all reservations
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={notificationsForm.control}
                        name="weeklySummary"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Weekly Summary</FormLabel>
                              <FormDescription>
                                Weekly summary of all reservations
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                  </form>
                </Form>
              </CardContent>
              <CardFooter>
                <Button 
                  type="submit"
                  form="notifications-form"
                  className="ml-auto"
                  disabled={saveNotificationsMutation.isPending || !notificationsForm.formState.isDirty}
                >
                  {saveNotificationsMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Settings
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>
          
          <TabsContent value="regionalization">
            <Card>
              <CardHeader>
                <div className="flex items-center">
                  <Languages className="h-5 w-5 mr-2 text-primary" />
                  <CardTitle>Regionalization</CardTitle>
                </div>
                <CardDescription>
                  Configure language and regional settings
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...regionalizationForm}>
                  <form id="regionalization-form" onSubmit={regionalizationForm.handleSubmit(onRegionalizationSubmit)} className="space-y-6">
                    <FormField
                      control={regionalizationForm.control}
                      name="language"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Language</FormLabel>
                          <FormControl>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select language" />
                              </SelectTrigger>
                              <SelectContent>
                                {languages.map((language) => (
                                  <SelectItem key={language.value} value={language.value}>
                                    {language.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormDescription>
                            Application interface language
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        control={regionalizationForm.control}
                        name="dateFormat"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Date Format</FormLabel>
                            <FormControl>
                              <Select
                                value={field.value}
                                onValueChange={field.onChange}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select date format" />
                                </SelectTrigger>
                                <SelectContent>
                                  {dateFormats.map((format) => (
                                    <SelectItem key={format.value} value={format.value}>
                                      {format.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormDescription>
                              How dates are displayed
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={regionalizationForm.control}
                        name="timeFormat"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Time Format</FormLabel>
                            <FormControl>
                              <Select
                                value={field.value}
                                onValueChange={field.onChange}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select time format" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="12h" className="flex items-center">
                                    <Clock className="h-4 w-4 mr-2" />
                                    12-hour (AM/PM)
                                  </SelectItem>
                                  <SelectItem value="24h" className="flex items-center">
                                    <Clock className="h-4 w-4 mr-2" />
                                    24-hour
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormDescription>
                              How time is displayed
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        control={regionalizationForm.control}
                        name="timezone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Timezone</FormLabel>
                            <FormControl>
                              <Select
                                value={field.value}
                                onValueChange={field.onChange}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select timezone" />
                                </SelectTrigger>
                                <SelectContent>
                                  {timezones.map((timezone) => (
                                    <SelectItem key={timezone.value} value={timezone.value}>
                                      {timezone.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormDescription>
                              Your local timezone
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={regionalizationForm.control}
                        name="currency"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Currency</FormLabel>
                            <FormControl>
                              <Select
                                value={field.value}
                                onValueChange={field.onChange}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select currency" />
                                </SelectTrigger>
                                <SelectContent>
                                  {currencies.map((currency) => (
                                    <SelectItem key={currency.value} value={currency.value}>
                                      {currency.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormDescription>
                              Currency for prices and payments
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </form>
                </Form>
              </CardContent>
              <CardFooter>
                <Button 
                  type="submit"
                  form="regionalization-form"
                  className="ml-auto"
                  disabled={saveRegionalizationMutation.isPending || !regionalizationForm.formState.isDirty}
                >
                  {saveRegionalizationMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Settings
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
