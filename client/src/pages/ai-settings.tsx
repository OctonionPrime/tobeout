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
import { Separator } from "@/components/ui/separator";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Bot, BrainCircuit, MessageSquare, AlertTriangle, Save, Loader2, ArrowRight, Twitter } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface IntegrationSettings {
  id: number;
  restaurantId: number;
  type: string;
  apiKey?: string;
  token?: string;
  enabled: boolean;
  settings: any;
}

const telegramFormSchema = z.object({
  token: z.string().min(1, "Telegram bot token is required"),
  enabled: z.boolean().default(false),
});

const openaiFormSchema = z.object({
  apiKey: z.string().min(1, "OpenAI API key is required"),
  enabled: z.boolean().default(false),
});

type TelegramFormValues = z.infer<typeof telegramFormSchema>;
type OpenAIFormValues = z.infer<typeof openaiFormSchema>;

export default function AISettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);

  // In a real application, you would get the restaurant ID from context
  const restaurantId = 1;
  
  // Telegram Bot Settings
  const telegramForm = useForm<TelegramFormValues>({
    resolver: zodResolver(telegramFormSchema),
    defaultValues: {
      token: "",
      enabled: false,
    },
  });

  // OpenAI Settings
  const openaiForm = useForm<OpenAIFormValues>({
    resolver: zodResolver(openaiFormSchema),
    defaultValues: {
      apiKey: "",
      enabled: false,
    },
  });

  // Get Telegram Integration Settings
  const { data: telegramSettings, isLoading: isLoadingTelegram } = useQuery<IntegrationSettings>({
    queryKey: [`/api/integrations/telegram`],
    onSuccess: (data) => {
      telegramForm.reset({
        token: data.token || "",
        enabled: data.enabled,
      });
    },
  });

  // Get OpenAI Integration Settings
  const { data: openaiSettings, isLoading: isLoadingOpenAI } = useQuery<IntegrationSettings>({
    queryKey: [`/api/integrations/openai`],
    onSuccess: (data) => {
      openaiForm.reset({
        apiKey: data.apiKey || "",
        enabled: data.enabled,
      });
    },
  });

  // Save Telegram Settings
  const saveTelegramMutation = useMutation({
    mutationFn: async (values: TelegramFormValues) => {
      const response = await apiRequest("POST", "/api/integrations/telegram", {
        ...values,
        restaurantId,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Telegram bot settings saved successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/telegram'] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to save Telegram bot settings: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  // Save OpenAI Settings
  const saveOpenAIMutation = useMutation({
    mutationFn: async (values: OpenAIFormValues) => {
      const response = await apiRequest("POST", "/api/integrations/openai", {
        ...values,
        restaurantId,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "OpenAI settings saved successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/openai'] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to save OpenAI settings: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  // Test Telegram Bot
  const testTelegramBot = async () => {
    try {
      setIsTestingTelegram(true);
      const response = await apiRequest("GET", `/api/integrations/telegram/test?restaurantId=${restaurantId}`, undefined);
      const data = await response.json();
      
      toast({
        title: "Bot Test Result",
        description: data.message || "Telegram bot is connected and working correctly",
      });
    } catch (error: any) {
      toast({
        title: "Bot Test Failed",
        description: error.message || "Could not connect to Telegram bot",
        variant: "destructive",
      });
    } finally {
      setIsTestingTelegram(false);
    }
  };

  const onTelegramSubmit = (values: TelegramFormValues) => {
    saveTelegramMutation.mutate(values);
  };

  const onOpenAISubmit = (values: OpenAIFormValues) => {
    saveOpenAIMutation.mutate(values);
  };

  return (
    <DashboardLayout>
      <div className="px-4 py-6 lg:px-8">
        <header className="mb-6">
          <div className="flex items-center">
            <BrainCircuit className="h-8 w-8 mr-3 text-primary" />
            <div>
              <h2 className="text-2xl font-bold text-gray-800">AI Assistant Settings</h2>
              <p className="text-gray-500 mt-1">Configure your AI assistant and integrations</p>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Telegram Bot Settings */}
          <Card>
            <CardHeader>
              <div className="flex items-center">
                <Twitter className="h-5 w-5 mr-2 text-[#0088cc]" />
                <CardTitle>Telegram Bot Integration</CardTitle>
              </div>
              <CardDescription>
                Configure your Telegram bot for reservation management
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingTelegram ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : (
                <Form {...telegramForm}>
                  <form id="telegram-form" onSubmit={telegramForm.handleSubmit(onTelegramSubmit)} className="space-y-6">
                    <FormField
                      control={telegramForm.control}
                      name="enabled"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base">Telegram Bot Status</FormLabel>
                            <FormDescription>
                              Enable or disable the Telegram bot integration
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
                      control={telegramForm.control}
                      name="token"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Telegram Bot Token</FormLabel>
                          <FormControl>
                            <Input placeholder="1234567890:ABCDefGHIJKlmnOPQRSTuvwxyz" {...field} />
                          </FormControl>
                          <FormDescription>
                            Get a token from @BotFather on Telegram
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {telegramSettings?.enabled && telegramSettings?.token && (
                      <div className="mt-4">
                        <Alert>
                          <AlertTitle className="flex items-center">
                            <MessageSquare className="h-4 w-4 mr-2" />
                            Telegram Bot Information
                          </AlertTitle>
                          <AlertDescription className="mt-2 space-y-2 text-sm text-muted-foreground">
                            <p>Your bot is active and ready to receive reservations.</p>
                            <p>Your guests can find it by searching for <span className="font-mono">@YourBotName</span> on Telegram.</p>
                          </AlertDescription>
                        </Alert>
                      </div>
                    )}
                  </form>
                </Form>
              )}
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button 
                type="button"
                variant="outline" 
                disabled={!telegramSettings?.enabled || !telegramSettings?.token || isTestingTelegram}
                onClick={testTelegramBot}
              >
                {isTestingTelegram ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>Test Connection</>
                )}
              </Button>
              <Button 
                type="submit" 
                form="telegram-form"
                disabled={saveTelegramMutation.isPending || !telegramForm.formState.isDirty}
              >
                {saveTelegramMutation.isPending ? (
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

          {/* OpenAI Settings */}
          <Card>
            <CardHeader>
              <div className="flex items-center">
                <Bot className="h-5 w-5 mr-2 text-primary" />
                <CardTitle>OpenAI Integration</CardTitle>
              </div>
              <CardDescription>
                Configure your OpenAI API settings for the AI assistant
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingOpenAI ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : (
                <Form {...openaiForm}>
                  <form id="openai-form" onSubmit={openaiForm.handleSubmit(onOpenAISubmit)} className="space-y-6">
                    <FormField
                      control={openaiForm.control}
                      name="enabled"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base">OpenAI Integration Status</FormLabel>
                            <FormDescription>
                              Enable or disable the OpenAI integration for AI assistant
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
                      control={openaiForm.control}
                      name="apiKey"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>OpenAI API Key</FormLabel>
                          <FormControl>
                            <Input placeholder="sk-..." type="password" {...field} />
                          </FormControl>
                          <FormDescription>
                            Get your API key from your OpenAI account dashboard
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Alert className="mt-4">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Important</AlertTitle>
                      <AlertDescription>
                        Usage of the OpenAI API may incur costs based on your usage. Make sure to check OpenAI's pricing policies.
                      </AlertDescription>
                    </Alert>
                  </form>
                </Form>
              )}
            </CardContent>
            <CardFooter>
              <Button 
                type="submit"
                form="openai-form"
                className="ml-auto"
                disabled={saveOpenAIMutation.isPending || !openaiForm.formState.isDirty}
              >
                {saveOpenAIMutation.isPending ? (
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
        </div>

        <div className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>AI Assistant Capabilities</CardTitle>
              <CardDescription>
                Understand what your AI assistant can do for you
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col p-4 bg-blue-50 rounded-lg border border-blue-100">
                    <div className="text-blue-600 mb-2">
                      <MessageSquare className="h-5 w-5" />
                    </div>
                    <h3 className="text-sm font-medium">Reservation Management</h3>
                    <p className="text-sm text-gray-600 mt-2">
                      The AI can create, modify, and cancel reservations through various channels.
                    </p>
                  </div>
                  
                  <div className="flex flex-col p-4 bg-green-50 rounded-lg border border-green-100">
                    <div className="text-green-600 mb-2">
                      <Bot className="h-5 w-5" />
                    </div>
                    <h3 className="text-sm font-medium">Natural Language Processing</h3>
                    <p className="text-sm text-gray-600 mt-2">
                      Understands guest requests in natural language to extract reservation details.
                    </p>
                  </div>
                  
                  <div className="flex flex-col p-4 bg-amber-50 rounded-lg border border-amber-100">
                    <div className="text-amber-600 mb-2">
                      <BrainCircuit className="h-5 w-5" />
                    </div>
                    <h3 className="text-sm font-medium">Intelligent Scheduling</h3>
                    <p className="text-sm text-gray-600 mt-2">
                      Suggests alternative times and tables when the requested slot is unavailable.
                    </p>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="text-sm font-medium">Supported Scenarios</h3>
                  <ul className="space-y-3">
                    <li className="flex items-start">
                      <div className="h-5 w-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs mr-2 mt-0.5">1</div>
                      <div>
                        <p className="text-sm font-medium">Creating reservations</p>
                        <p className="text-sm text-gray-600">AI assistant can create new reservations based on guest messages</p>
                      </div>
                    </li>
                    <li className="flex items-start">
                      <div className="h-5 w-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs mr-2 mt-0.5">2</div>
                      <div>
                        <p className="text-sm font-medium">Modifying existing reservations</p>
                        <p className="text-sm text-gray-600">Guests can change their booking details like time, date, or party size</p>
                      </div>
                    </li>
                    <li className="flex items-start">
                      <div className="h-5 w-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs mr-2 mt-0.5">3</div>
                      <div>
                        <p className="text-sm font-medium">Cancelling reservations</p>
                        <p className="text-sm text-gray-600">Guests can cancel their booking through the AI assistant</p>
                      </div>
                    </li>
                    <li className="flex items-start">
                      <div className="h-5 w-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs mr-2 mt-0.5">4</div>
                      <div>
                        <p className="text-sm font-medium">Sending reminders</p>
                        <p className="text-sm text-gray-600">Automated reminders 24h and 2h before the reservation</p>
                      </div>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="ml-auto" onClick={() => window.open('/ai-documentation', '_blank')}>
                View Full Documentation
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
