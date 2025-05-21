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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Twitter, Mail, Globe, MessageCircle, Code, Loader2, Save, Puzzle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SkeletonCard } from "@/components/ui/skeleton";

interface IntegrationSettings {
  id: number;
  restaurantId: number;
  type: string;
  apiKey?: string;
  token?: string;
  enabled: boolean;
  settings: any;
}

const webWidgetFormSchema = z.object({
  enabled: z.boolean().default(false),
  widgetTitle: z.string().min(1, "Widget title is required"),
  widgetColor: z.string().default("#3B82F6"),
  autoOpen: z.boolean().default(false),
});

const emailFormSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().min(1, "API key is required"),
  fromEmail: z.string().email("Valid email is required"),
  templateId: z.string().optional(),
});

const googleFormSchema = z.object({
  enabled: z.boolean().default(false),
  placeId: z.string().min(1, "Place ID is required"),
  apiKey: z.string().min(1, "API key is required"),
});

type WebWidgetFormValues = z.infer<typeof webWidgetFormSchema>;
type EmailFormValues = z.infer<typeof emailFormSchema>;
type GoogleFormValues = z.infer<typeof googleFormSchema>;

export default function Integrations() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("web");

  // In a real application, you would get the restaurant ID from context
  const restaurantId = 1;
  
  // Forms
  const webWidgetForm = useForm<WebWidgetFormValues>({
    resolver: zodResolver(webWidgetFormSchema),
    defaultValues: {
      enabled: false,
      widgetTitle: "Book a Table",
      widgetColor: "#3B82F6",
      autoOpen: false,
    },
  });

  const emailForm = useForm<EmailFormValues>({
    resolver: zodResolver(emailFormSchema),
    defaultValues: {
      enabled: false,
      apiKey: "",
      fromEmail: "",
      templateId: "",
    },
  });

  const googleForm = useForm<GoogleFormValues>({
    resolver: zodResolver(googleFormSchema),
    defaultValues: {
      enabled: false,
      placeId: "",
      apiKey: "",
    },
  });

  // Queries
  const { data: webSettings, isLoading: isLoadingWeb } = useQuery<IntegrationSettings>({
    queryKey: [`/api/integrations/web_widget`],
    onSuccess: (data) => {
      if (data && data.settings) {
        webWidgetForm.reset({
          enabled: data.enabled,
          widgetTitle: data.settings.widgetTitle || "Book a Table",
          widgetColor: data.settings.widgetColor || "#3B82F6",
          autoOpen: data.settings.autoOpen || false,
        });
      }
    },
  });

  const { data: emailSettings, isLoading: isLoadingEmail } = useQuery<IntegrationSettings>({
    queryKey: [`/api/integrations/email`],
    onSuccess: (data) => {
      if (data) {
        emailForm.reset({
          enabled: data.enabled,
          apiKey: data.apiKey || "",
          fromEmail: data.settings?.fromEmail || "",
          templateId: data.settings?.templateId || "",
        });
      }
    },
  });

  const { data: googleSettings, isLoading: isLoadingGoogle } = useQuery<IntegrationSettings>({
    queryKey: [`/api/integrations/google`],
    onSuccess: (data) => {
      if (data) {
        googleForm.reset({
          enabled: data.enabled,
          placeId: data.settings?.placeId || "",
          apiKey: data.apiKey || "",
        });
      }
    },
  });

  // Mutations
  const saveWebWidgetMutation = useMutation({
    mutationFn: async (values: WebWidgetFormValues) => {
      const response = await apiRequest("POST", "/api/integrations/web_widget", {
        enabled: values.enabled,
        restaurantId,
        settings: {
          widgetTitle: values.widgetTitle,
          widgetColor: values.widgetColor,
          autoOpen: values.autoOpen,
        },
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Web widget settings saved successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/web_widget'] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to save web widget settings: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const saveEmailMutation = useMutation({
    mutationFn: async (values: EmailFormValues) => {
      const response = await apiRequest("POST", "/api/integrations/email", {
        enabled: values.enabled,
        apiKey: values.apiKey,
        restaurantId,
        settings: {
          fromEmail: values.fromEmail,
          templateId: values.templateId,
        },
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Email integration settings saved successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/email'] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to save email settings: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const saveGoogleMutation = useMutation({
    mutationFn: async (values: GoogleFormValues) => {
      const response = await apiRequest("POST", "/api/integrations/google", {
        enabled: values.enabled,
        apiKey: values.apiKey,
        restaurantId,
        settings: {
          placeId: values.placeId,
        },
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Google integration settings saved successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/google'] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to save Google settings: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  // Submit handlers
  const onWebWidgetSubmit = (values: WebWidgetFormValues) => {
    saveWebWidgetMutation.mutate(values);
  };

  const onEmailSubmit = (values: EmailFormValues) => {
    saveEmailMutation.mutate(values);
  };

  const onGoogleSubmit = (values: GoogleFormValues) => {
    saveGoogleMutation.mutate(values);
  };

  const generateWidgetCode = () => {
    if (!webSettings?.enabled) return null;
    
    const widgetCode = `<script>
  (function(w,d,s,o,f,js,fjs){
    w['ToBeOut-Widget']=o;w[o]=w[o]||function(){(w[o].q=w[o].q||[]).push(arguments)};
    js=d.createElement(s),fjs=d.getElementsByTagName(s)[0];
    js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);
  }(window,document,'script','tbowdgt','https://widget.tobeout.com/loader.js'));
  tbowdgt('init', {
    restaurantId: ${restaurantId},
    title: "${webWidgetForm.getValues().widgetTitle}",
    color: "${webWidgetForm.getValues().widgetColor}",
    autoOpen: ${webWidgetForm.getValues().autoOpen}
  });
</script>`;

    return widgetCode;
  };

  return (
    <DashboardLayout>
      <div className="px-4 py-6 lg:px-8">
        <header className="mb-6">
          <div className="flex items-center">
            <Puzzle className="h-8 w-8 mr-3 text-primary" />
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Integrations</h2>
              <p className="text-gray-500 mt-1">Connect your restaurant to other platforms and services</p>
            </div>
          </div>
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full mb-6">
          <TabsList className="mb-4">
            <TabsTrigger value="web" className="flex items-center">
              <Globe className="h-4 w-4 mr-2" />
              Web Widget
            </TabsTrigger>
            <TabsTrigger value="email" className="flex items-center">
              <Mail className="h-4 w-4 mr-2" />
              Email
            </TabsTrigger>
            <TabsTrigger value="google" className="flex items-center">
              <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.5 12c0-.585-.055-1.17-.145-1.74H12v3.27h5.92c-.245 1.29-1.035 2.415-2.205 3.15v2.595h3.555C21.175 17.4 22.5 15 22.5 12z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.99 7.28-2.665l-3.555-2.595c-.985.66-2.25 1.05-3.725 1.05-2.865 0-5.29-1.875-6.16-4.385H2.145v2.685C3.95 20.725 7.755 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.405c-.225-.675-.345-1.395-.345-2.13s.12-1.455.345-2.13V7.46H2.145C1.23 8.845.75 10.365.75 12s.48 3.155 1.395 4.54l3.695-2.135z" fill="#FBBC05"/>
                <path d="M12 5.49c1.62 0 3.075.555 4.215 1.65l3.15-3.15C17.4 2.19 14.91 1.2 12 1.2 7.755 1.2 3.95 3.475 2.145 7.175L5.84 9.31C6.71 6.8 9.135 5.49 12 5.49z" fill="#EA4335"/>
              </svg>
              Google
            </TabsTrigger>
            <TabsTrigger value="telegram" className="flex items-center">
              <Twitter className="h-4 w-4 mr-2" />
              Telegram
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="web">
            {isLoadingWeb ? (
              <SkeletonCard />
            ) : (
              <Card>
                <CardHeader>
                  <div className="flex items-center">
                    <MessageCircle className="h-5 w-5 mr-2 text-primary" />
                    <CardTitle>Web Widget Integration</CardTitle>
                  </div>
                  <CardDescription>
                    Add a booking widget to your website
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...webWidgetForm}>
                    <form id="web-widget-form" onSubmit={webWidgetForm.handleSubmit(onWebWidgetSubmit)} className="space-y-6">
                      <FormField
                        control={webWidgetForm.control}
                        name="enabled"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Web Widget Status</FormLabel>
                              <FormDescription>
                                Enable or disable the booking widget on your website
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

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                          control={webWidgetForm.control}
                          name="widgetTitle"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Widget Title</FormLabel>
                              <FormControl>
                                <Input placeholder="Book a Table" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={webWidgetForm.control}
                          name="widgetColor"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Widget Color</FormLabel>
                              <div className="flex gap-2">
                                <FormControl>
                                  <Input type="color" {...field} className="w-12 h-9 p-1" />
                                </FormControl>
                                <Input 
                                  value={field.value} 
                                  onChange={(e) => field.onChange(e.target.value)}
                                  className="flex-1"
                                />
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={webWidgetForm.control}
                        name="autoOpen"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Auto-open Widget</FormLabel>
                              <FormDescription>
                                Automatically open the widget when the page loads
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

                      {webSettings?.enabled && (
                        <div className="mt-4">
                          <h4 className="text-sm font-medium mb-2">Widget Code</h4>
                          <div className="bg-gray-50 p-4 rounded-md border">
                            <div className="flex justify-between items-center mb-2">
                              <p className="text-xs text-gray-500">Add this code to your website</p>
                              <Button 
                                type="button" 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => {
                                  navigator.clipboard.writeText(generateWidgetCode() || "");
                                  toast({
                                    title: "Copied!",
                                    description: "Widget code copied to clipboard",
                                  });
                                }}
                              >
                                <Code className="h-4 w-4 mr-1" /> Copy
                              </Button>
                            </div>
                            <pre className="text-xs overflow-x-auto p-2 bg-gray-100 rounded">
                              {generateWidgetCode()}
                            </pre>
                          </div>
                        </div>
                      )}
                    </form>
                  </Form>
                </CardContent>
                <CardFooter>
                  <Button 
                    type="submit"
                    form="web-widget-form"
                    className="ml-auto"
                    disabled={saveWebWidgetMutation.isPending || !webWidgetForm.formState.isDirty}
                  >
                    {saveWebWidgetMutation.isPending ? (
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
            )}
          </TabsContent>
          
          <TabsContent value="email">
            {isLoadingEmail ? (
              <SkeletonCard />
            ) : (
              <Card>
                <CardHeader>
                  <div className="flex items-center">
                    <Mail className="h-5 w-5 mr-2 text-primary" />
                    <CardTitle>Email Integration</CardTitle>
                  </div>
                  <CardDescription>
                    Configure email notifications for reservations
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...emailForm}>
                    <form id="email-form" onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-6">
                      <FormField
                        control={emailForm.control}
                        name="enabled"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Email Integration Status</FormLabel>
                              <FormDescription>
                                Enable or disable email notifications
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
                        control={emailForm.control}
                        name="apiKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email Service API Key</FormLabel>
                            <FormControl>
                              <Input placeholder="Your API key" type="password" {...field} />
                            </FormControl>
                            <FormDescription>
                              API key for your email service provider (Mailchimp, SendGrid, etc.)
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={emailForm.control}
                        name="fromEmail"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>From Email Address</FormLabel>
                            <FormControl>
                              <Input placeholder="reservations@yourrestaurant.com" {...field} />
                            </FormControl>
                            <FormDescription>
                              Email address that will appear as the sender
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={emailForm.control}
                        name="templateId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email Template ID (Optional)</FormLabel>
                            <FormControl>
                              <Input placeholder="template_123456" {...field} />
                            </FormControl>
                            <FormDescription>
                              Template ID for your email service, if applicable
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <Alert>
                        <AlertTitle>Email Templates</AlertTitle>
                        <AlertDescription>
                          <p className="mt-2">The following email notifications will be sent:</p>
                          <ul className="list-disc pl-4 mt-2 space-y-1">
                            <li>Reservation confirmation</li>
                            <li>Reservation reminder (24 hours before)</li>
                            <li>Reservation modification</li>
                            <li>Reservation cancellation</li>
                          </ul>
                        </AlertDescription>
                      </Alert>
                    </form>
                  </Form>
                </CardContent>
                <CardFooter>
                  <Button 
                    type="submit"
                    form="email-form"
                    className="ml-auto"
                    disabled={saveEmailMutation.isPending || !emailForm.formState.isDirty}
                  >
                    {saveEmailMutation.isPending ? (
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
            )}
          </TabsContent>
          
          <TabsContent value="google">
            {isLoadingGoogle ? (
              <SkeletonCard />
            ) : (
              <Card>
                <CardHeader>
                  <div className="flex items-center">
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.5 12c0-.585-.055-1.17-.145-1.74H12v3.27h5.92c-.245 1.29-1.035 2.415-2.205 3.15v2.595h3.555C21.175 17.4 22.5 15 22.5 12z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.99 7.28-2.665l-3.555-2.595c-.985.66-2.25 1.05-3.725 1.05-2.865 0-5.29-1.875-6.16-4.385H2.145v2.685C3.95 20.725 7.755 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.405c-.225-.675-.345-1.395-.345-2.13s.12-1.455.345-2.13V7.46H2.145C1.23 8.845.75 10.365.75 12s.48 3.155 1.395 4.54l3.695-2.135z" fill="#FBBC05"/>
                      <path d="M12 5.49c1.62 0 3.075.555 4.215 1.65l3.15-3.15C17.4 2.19 14.91 1.2 12 1.2 7.755 1.2 3.95 3.475 2.145 7.175L5.84 9.31C6.71 6.8 9.135 5.49 12 5.49z" fill="#EA4335"/>
                    </svg>
                    <CardTitle>Google Integration</CardTitle>
                  </div>
                  <CardDescription>
                    Connect to Google Maps and enable "Reserve with Google"
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...googleForm}>
                    <form id="google-form" onSubmit={googleForm.handleSubmit(onGoogleSubmit)} className="space-y-6">
                      <FormField
                        control={googleForm.control}
                        name="enabled"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Google Integration Status</FormLabel>
                              <FormDescription>
                                Enable or disable Google integration
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
                        control={googleForm.control}
                        name="placeId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Google Maps Place ID</FormLabel>
                            <FormControl>
                              <Input placeholder="ChIJ..." {...field} />
                            </FormControl>
                            <FormDescription>
                              Find your Place ID on the Google Places API
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={googleForm.control}
                        name="apiKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Google Maps API Key</FormLabel>
                            <FormControl>
                              <Input placeholder="Your API key" type="password" {...field} />
                            </FormControl>
                            <FormDescription>
                              API key with Places API and Maps JavaScript API enabled
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <Alert>
                        <AlertTitle>Google Reservation Integration</AlertTitle>
                        <AlertDescription>
                          <p className="mt-2">Connecting to Google allows customers to make reservations directly from:</p>
                          <ul className="list-disc pl-4 mt-2 space-y-1">
                            <li>Google Maps</li>
                            <li>Google Search</li>
                            <li>"Reserve with Google" buttons</li>
                          </ul>
                          <p className="mt-2 text-sm text-muted-foreground">
                            You must have a verified Google Business Profile to use this feature.
                          </p>
                        </AlertDescription>
                      </Alert>
                    </form>
                  </Form>
                </CardContent>
                <CardFooter>
                  <Button 
                    type="submit"
                    form="google-form"
                    className="ml-auto"
                    disabled={saveGoogleMutation.isPending || !googleForm.formState.isDirty}
                  >
                    {saveGoogleMutation.isPending ? (
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
            )}
          </TabsContent>
          
          <TabsContent value="telegram">
            <Card>
              <CardHeader>
                <div className="flex items-center">
                  <Twitter className="h-5 w-5 mr-2 text-[#0088cc]" />
                  <CardTitle>Telegram Integration</CardTitle>
                </div>
                <CardDescription>
                  Configure your Telegram bot for reservations
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Alert className="mb-4">
                  <AlertTitle>Telegram Bot Settings</AlertTitle>
                  <AlertDescription>
                    <p className="mt-2">
                      Telegram bot settings are managed in the AI Assistant section.
                    </p>
                  </AlertDescription>
                </Alert>
                
                <Button 
                  onClick={() => window.location.href = "/ai-settings"}
                  className="w-full"
                >
                  <Twitter className="mr-2 h-4 w-4" />
                  Go to AI Assistant Settings
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
