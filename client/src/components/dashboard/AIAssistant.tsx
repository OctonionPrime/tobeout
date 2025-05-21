import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bot } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface AIAssistantProps {
  restaurantId: number;
}

interface AIActivity {
  id: number;
  type: string;
  description: string;
  createdAt: string;
}

export function AIAssistant({ restaurantId }: AIAssistantProps) {
  const { data: activities, isLoading } = useQuery<AIActivity[]>({
    queryKey: [`/api/ai/activities?restaurantId=${restaurantId}`],
  });

  if (isLoading) {
    return (
      <Card className="border border-gray-200">
        <CardHeader>
          <CardTitle>AI Assistant</CardTitle>
          <CardDescription>Recent activities</CardDescription>
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

  return (
    <Card className="border border-gray-200">
      <CardHeader className="border-b border-gray-200">
        <CardTitle>AI Assistant</CardTitle>
        <CardDescription>Recent activities</CardDescription>
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
                      {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Bot className="h-8 w-8 mx-auto mb-2 text-gray-400" />
              <p>No AI assistant activities yet</p>
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
