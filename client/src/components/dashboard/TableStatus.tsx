import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface TableStatusProps {
  restaurantId: number;
}

interface Table {
  id: number;
  name: string;
  status: 'free' | 'occupied' | 'reserved' | 'unavailable';
}

export function TableStatus({ restaurantId }: TableStatusProps) {
  const { data: tables, isLoading } = useQuery<Table[]>({
    queryKey: [`/api/tables?restaurantId=${restaurantId}`],
  });

  if (isLoading) {
    return (
      <Card className="border border-gray-200">
        <CardHeader>
          <CardTitle>Table Status</CardTitle>
          <CardDescription>Current floor situation</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            {[...Array(9)].map((_, i) => (
              <div key={i} className="aspect-square bg-gray-100 animate-pulse rounded-lg"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const getTableColor = (status: string) => {
    switch (status) {
      case 'free':
        return {
          bg: 'bg-green-100',
          border: 'border-green-200',
          text: 'text-green-700',
          statusText: 'text-green-600',
        };
      case 'occupied':
        return {
          bg: 'bg-red-100',
          border: 'border-red-200',
          text: 'text-red-700',
          statusText: 'text-red-600',
        };
      case 'reserved':
        return {
          bg: 'bg-amber-100',
          border: 'border-amber-200',
          text: 'text-amber-700',
          statusText: 'text-amber-600',
        };
      default:
        return {
          bg: 'bg-gray-100',
          border: 'border-gray-200',
          text: 'text-gray-700',
          statusText: 'text-gray-600',
        };
    }
  };

  // Calculate stats
  const stats = {
    free: tables?.filter(t => t.status === 'free').length || 0,
    reserved: tables?.filter(t => t.status === 'reserved').length || 0,
    occupied: tables?.filter(t => t.status === 'occupied').length || 0,
  };

  return (
    <Card className="border border-gray-200">
      <CardHeader>
        <CardTitle>Table Status</CardTitle>
        <CardDescription>Current floor situation</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          {tables && tables.length > 0 ? (
            tables.map((table) => {
              const colors = getTableColor(table.status);
              return (
                <div 
                  key={table.id} 
                  className={`aspect-square ${colors.bg} rounded-lg flex flex-col items-center justify-center p-2 border ${colors.border}`}
                >
                  <span className={`text-xs font-semibold ${colors.text}`}>{table.name}</span>
                  <span className={`text-xs ${colors.statusText} mt-1 capitalize`}>{table.status}</span>
                </div>
              );
            })
          ) : (
            <div className="col-span-3 py-4 text-center text-sm text-gray-500">
              No tables have been added yet
            </div>
          )}
        </div>
        
        {tables && tables.length > 0 && (
          <div className="mt-4 flex justify-between text-sm">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-100 border border-green-200 rounded-full mr-2"></div>
              <span className="text-gray-700">Free: {stats.free}</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-amber-100 border border-amber-200 rounded-full mr-2"></div>
              <span className="text-gray-700">Reserved: {stats.reserved}</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-red-100 border border-red-200 rounded-full mr-2"></div>
              <span className="text-gray-700">Occupied: {stats.occupied}</span>
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="px-6 py-4 border-t border-gray-200">
        <Button variant="link" className="text-sm font-medium text-blue-600 hover:text-blue-500 p-0">
          Manage tables →
        </Button>
      </CardFooter>
    </Card>
  );
}
