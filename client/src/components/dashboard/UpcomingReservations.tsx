import { useQuery } from "@tanstack/react-query";
import { Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

interface UpcomingReservationsProps {
  restaurantId: number;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
}

interface Reservation {
  reservation: {
    id: number;
    date: string;
    time: string;
    guests: number;
    status: string;
  };
  guest: {
    id: number;
    name: string;
    phone: string;
  };
  table: {
    id: number;
    name: string;
    comments: string;
  };
}

export function UpcomingReservations({ restaurantId, onEdit, onDelete }: UpcomingReservationsProps) {
  const { data: upcomingReservations, isLoading } = useQuery<Reservation[]>({
    queryKey: [`/api/dashboard/upcoming?restaurantId=${restaurantId}`],
  });

  if (isLoading) {
    return (
      <Card className="border border-gray-200">
        <CardHeader>
          <CardTitle>Upcoming Reservations</CardTitle>
          <CardDescription>Next 3 hours</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-md"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Confirmed</Badge>;
      case 'created':
        return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Pending</Badge>;
      case 'canceled':
        return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Canceled</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <Card className="border border-gray-200">
      <CardHeader className="border-b border-gray-200">
        <CardTitle>Upcoming Reservations</CardTitle>
        <CardDescription>Next 3 hours</CardDescription>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Guest</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Table</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Guests</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {upcomingReservations && upcomingReservations.length > 0 ? (
              upcomingReservations.map((item) => (
                <tr key={item.reservation.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-700">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{item.guest.name}</div>
                        <div className="text-sm text-gray-500">{item.guest.phone}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {format(new Date(`${item.reservation.date}T${item.reservation.time}`), 'HH:mm')}
                    </div>
                    <div className="text-xs text-gray-500">
                      {format(new Date(item.reservation.date), 'MMM d')}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{item.table?.name || 'Not assigned'}</div>
                    <div className="text-xs text-gray-500">{item.table?.comments || ''}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {item.reservation.guests}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(item.reservation.status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => onEdit(item.reservation.id)}
                      className="text-blue-600 hover:text-blue-900 mr-3"
                    >
                      <Edit size={16} />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => onDelete(item.reservation.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      <Trash2 size={16} />
                    </Button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-6 py-4 text-center text-sm text-gray-500">
                  No upcoming reservations in the next 3 hours
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <CardFooter className="px-6 py-4 border-t border-gray-200">
        <Button variant="link" className="text-sm font-medium text-blue-600 hover:text-blue-500 p-0">
          View all reservations →
        </Button>
      </CardFooter>
    </Card>
  );
}
