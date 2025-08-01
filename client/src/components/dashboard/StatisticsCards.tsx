import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, UserCheck, Clock, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DateTime } from 'luxon';
import { apiRequest } from "@/lib/queryClient";

interface StatisticsCardsProps {
  restaurantId: number;
  restaurantTimezone?: string;
}

interface Stats {
  todayReservations: number;
  confirmedReservations: number;
  pendingReservations: number;
  totalGuests: number;
}

export function StatisticsCards({ restaurantId, restaurantTimezone = 'Europe/Moscow' }: StatisticsCardsProps) {
  // ✅ FIXED: Proper React Query with timezone-aware API call
  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ['dashboard_stats', restaurantId, restaurantTimezone],
    queryFn: async () => {
      const response = await apiRequest(
        "GET", 
        `/api/dashboard/stats?restaurantId=${restaurantId}&timezone=${encodeURIComponent(restaurantTimezone)}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch statistics');
      }
      return response.json();
    },
    enabled: !!restaurantId && !!restaurantTimezone,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="border border-gray-200">
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-gray-100"></div>
                <div className="ml-4 w-full">
                  <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                  <div className="h-6 bg-gray-200 rounded w-1/4"></div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // ✅ FIXED: Proper Luxon usage instead of toLocaleString anti-pattern
  const getRestaurantTime = () => {
    try {
      const restaurantTime = DateTime.now().setZone(restaurantTimezone);
      return restaurantTime.toFormat('HH:mm');
    } catch (error) {
      console.warn(`Invalid timezone ${restaurantTimezone}, falling back to local time`);
      return DateTime.now().toFormat('HH:mm');
    }
  };

  const getRestaurantDate = () => {
    try {
      const restaurantTime = DateTime.now().setZone(restaurantTimezone);
      return restaurantTime.toFormat('MMM d');
    } catch (error) {
      console.warn(`Invalid timezone ${restaurantTimezone}, falling back to local time`);
      return DateTime.now().toFormat('MMM d');
    }
  };

  const cards = [
    {
      title: `Today's Reservations (${getRestaurantDate()})`,
      value: stats?.todayReservations || 0,
      change: "+12%",
      isPositive: true,
      icon: <CalendarCheck className="text-xl" />,
      bgColor: "bg-blue-100",
      textColor: "text-blue-500",
      subtitle: `Current time: ${getRestaurantTime()}`
    },
    {
      title: "Confirmed Reservations",
      value: stats?.confirmedReservations || 0,
      change: "+8%",
      isPositive: true,
      icon: <UserCheck className="text-xl" />,
      bgColor: "bg-green-100",
      textColor: "text-green-500",
      subtitle: "Ready to serve"
    },
    {
      title: "Pending Confirmations",
      value: stats?.pendingReservations || 0,
      change: "+3%",
      isPositive: false,
      icon: <Clock className="text-xl" />,
      bgColor: "bg-yellow-100",
      textColor: "text-yellow-500",
      subtitle: stats?.pendingReservations > 0 ? "Need attention" : "All confirmed"
    },
    {
      title: "Total Guests",
      value: stats?.totalGuests || 0,
      change: "+16%",
      isPositive: true,
      icon: <Users className="text-xl" />,
      bgColor: "bg-red-100",
      textColor: "text-red-500",
      subtitle: `Expected today`
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {cards.map((card, index) => (
        <Card key={index} className="border border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center">
              <div className={`p-3 rounded-full ${card.bgColor} ${card.textColor}`}>
                {card.icon}
              </div>
              <div className="ml-4 flex-1">
                <h3 className="text-sm font-medium text-gray-500 leading-tight">{card.title}</h3>
                {card.subtitle && (
                  <p className="text-xs text-gray-400 mb-1">{card.subtitle}</p>
                )}
                <div className="mt-1 flex items-baseline">
                  <p className="text-2xl font-semibold text-gray-900">{card.value}</p>
                  <p className={`ml-2 text-sm flex items-center ${card.isPositive ? 'text-green-500' : 'text-red-500'}`}>
                    {card.isPositive ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                    {card.change}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}