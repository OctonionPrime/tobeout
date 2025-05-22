import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { BrainCircuit, MessageSquare, Save, Loader2, Twitter, Check, XOctagon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface IntegrationSettings {
  id?: number;
  restaurantId?: number;
  type?: string;
  apiKey?: string;
  token?: string;
  enabled?: boolean;
  settings?: {
    botUsername?: string;
    botName?: string;
  };
}

const telegramFormSchema = z.object({
  token: z.string().min(1, "Telegram bot token is required"),
  enabled: z.boolean().default(false),
  botUsername: z.string().optional(),
  botName: z.string().optional(),
});

type TelegramFormValues = z.infer<typeof telegramFormSchema>;

export default function AISettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // State variables for UI control
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [isValidTokenFormat, setIsValidTokenFormat] = useState(false);
  const [botUsername, setBotUsername] = useState<string>("");
  const [botName, setBotName] = useState<string>("");
  
  // In a real application, you would get the restaurant ID from context
  const restaurantId = 1;
  
  // Telegram Bot Settings Form
  const telegramForm = useForm<TelegramFormValues>({
    resolver: zodResolver(telegramFormSchema),
    defaultValues: {
      token: "",
      enabled: false,
    },
  });

  // Get Telegram Integration Settings
  const { data: telegramSettings, isLoading: isLoadingTelegram } = useQuery<IntegrationSettings>({
    queryKey: [`/api/integrations/telegram`],
  });

  // Load settings into forms and state when data is available
  useEffect(() => {
    if (telegramSettings) {
      // Set form values
      telegramForm.reset({
        token: telegramSettings.token || "",
        enabled: !!telegramSettings.enabled,
        botUsername: telegramSettings.settings?.botUsername || "",
        botName: telegramSettings.settings?.botName || ""
      });
      
      // Set state variables
      setBotUsername(telegramSettings.settings?.botUsername || "");
      setBotName(telegramSettings.settings?.botName || "");
      
      // Validate token format
      if (telegramSettings.token) {
        const tokenPattern = /^\d{8,10}:[a-zA-Z0-9_-]{35}$/;
        setIsValidTokenFormat(tokenPattern.test(telegramSettings.token));
      }
    }
  }, [telegramSettings]);

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
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: `Failed to save Telegram bot settings: ${error.message}`,
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
      
      if (data.botInfo) {
        // Store the bot information
        const username = data.botInfo.username;
        const name = data.botInfo.first_name;
        
        setBotUsername(username);
        setBotName(name);
        
        // Update the form values
        telegramForm.setValue("botUsername", username);
        
        // Also update the settings via API
        saveTelegramMutation.mutate({
          token: telegramForm.getValues().token,
          enabled: telegramForm.getValues().enabled,
          botUsername: username,
          botName: name
        });
      }
      
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
    // Ensure we keep the botUsername and botName when submitting
    saveTelegramMutation.mutate({
      ...values,
      botUsername: values.botUsername || botUsername,
      botName: values.botName || botName
    });
  };

  // Handle token input changes
  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const token = e.target.value;
    telegramForm.setValue("token", token);
    
    // Validate token format
    const tokenPattern = /^\d{8,10}:[a-zA-Z0-9_-]{35}$/;
    const isValid = tokenPattern.test(token);
    setIsValidTokenFormat(isValid);
  };

  return (
    <DashboardLayout>
      <div className="px-4 py-6 lg:px-8">
        <header className="mb-6">
          <div className="flex items-center">
            <BrainCircuit className="h-8 w-8 mr-3 text-primary" />
            <div>
              <h2 className="text-2xl font-bold text-gray-800">AI Assistant Settings</h2>
              <p className="text-gray-500 mt-1">Configure your Telegram bot for reservation management</p>
            </div>
          </div>
        </header>

        <div className="max-w-2xl">
          {/* Telegram Bot Settings */}
          <Card>
            <CardHeader>
              <div className="flex items-center">
                <Twitter className="h-5 w-5 mr-2 text-[#0088cc]" />
                <CardTitle>Telegram Bot Integration</CardTitle>
              </div>
              <CardDescription>
                Configure your Telegram bot for reservation management. Your AI assistant is powered by our platform-wide OpenAI integration.
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
                            <div className="relative">
                              <Input 
                                type={showToken ? "text" : "password"} 
                                placeholder="1234567890:ABCDefGHIJKlmnOPQRSTuvwxyz" 
                                {...field}
                                onChange={(e) => {
                                  handleTokenChange(e);
                                  field.onChange(e);
                                }}
                              />
                              <Button 
                                type="button" 
                                variant="ghost" 
                                size="sm" 
                                className="absolute right-0 top-0 h-full px-3"
                                onClick={() => setShowToken(!showToken)}
                              >
                                {showToken ? "Hide" : "Show"}
                              </Button>
                            </div>
                          </FormControl>
                          <div className="flex justify-between items-center">
                            <FormDescription>
                              Get a token from @BotFather on Telegram
                            </FormDescription>
                            {field.value && (
                              <div className="text-xs">
                                {isValidTokenFormat ? (
                                  <span className="text-green-600 flex items-center">
                                    <Check className="h-3 w-3 mr-1" />
                                    Valid format
                                  </span>
                                ) : (
                                  <span className="text-red-600 flex items-center">
                                    <XOctagon className="h-3 w-3 mr-1" />
                                    Invalid format
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="mt-4">
                      <Alert variant={telegramForm.getValues().enabled && telegramForm.getValues().token ? "default" : "destructive"}>
                        <AlertTitle className="flex items-center">
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Telegram Bot Information
                        </AlertTitle>
                        <AlertDescription className="mt-2 space-y-2 text-sm text-muted-foreground">
                          {telegramForm.getValues().enabled && telegramForm.getValues().token ? (
                            <>
                              <p className="flex items-center">
                                <span className="bg-green-100 text-green-800 text-xs font-medium mr-2 px-2.5 py-0.5 rounded-full">Active</span>
                                Your bot is active and ready to receive reservations.
                              </p>
                              <p>Your guests can find it by searching for <span className="font-mono">@{botUsername || "YourBotName"}</span> on Telegram.</p>
                              {botName && <p>Bot name: <strong>{botName}</strong></p>}
                            </>
                          ) : (
                            <>
                              <p className="flex items-center">
                                <span className="bg-red-100 text-red-800 text-xs font-medium mr-2 px-2.5 py-0.5 rounded-full">Inactive</span>
                                Your bot is currently inactive. Enable it to start receiving reservations.
                              </p>
                              <p>Configure your bot by entering a valid token and enabling the integration.</p>
                              <p className="text-sm mt-2">
                                <a 
                                  href="https://core.telegram.org/bots#6-botfather" 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  How to create a Telegram bot with BotFather
                                </a>
                              </p>
                            </>
                          )}
                        </AlertDescription>
                      </Alert>
                    </div>
                  </form>
                </Form>
              )}
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button 
                type="button"
                variant="outline" 
                disabled={!telegramForm.getValues().token || isTestingTelegram}
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
        </div>
      </div>
    </DashboardLayout>
  );
}