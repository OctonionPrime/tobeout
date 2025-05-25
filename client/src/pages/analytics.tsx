import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { 
  Users, 
  TrendingUp, 
  DollarSign, 
  Calendar,
  Phone,
  MessageSquare,
  Star,
  Table,
  Clock,
  UserCheck,
  Repeat,
  Target,
  BarChart3
} from "lucide-react";

export default function Analytics() {
  const { data: reservations, isLoading: reservationsLoading } = useQuery({
    queryKey: ["/api/reservations"],
  });

  const { data: guests, isLoading: guestsLoading } = useQuery({
    queryKey: ["/api/guests"],
  });

  const { data: tables } = useQuery({
    queryKey: ["/api/tables"],
  });

  if (reservationsLoading || guestsLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </DashboardLayout>
    );
  }

  // Guest Analytics
  const totalGuests = Array.isArray(guests) ? guests.length : 0;
  const telegramGuests = Array.isArray(guests) ? guests.filter((g: any) => g.telegram_user_id).length : 0;
  const regularGuests = Array.isArray(guests) ? guests.filter((g: any) => {
    const guestReservations = Array.isArray(reservations) ? reservations.filter((r: any) => r.guestId === g.id) : [];
    return guestReservations.length > 1;
  }).length : 0;

  // Reservation Analytics
  const totalReservations = Array.isArray(reservations) ? reservations.length : 0;
  const confirmedReservations = Array.isArray(reservations) ? reservations.filter((r: any) => r.status === 'confirmed').length : 0;
  const telegramBookings = Array.isArray(reservations) ? reservations.filter((r: any) => r.source === 'telegram').length : 0;
  
  // Guest Connections Analysis
  const connectedGuests = Array.isArray(guests) ? guests.reduce((acc: any, guest: any) => {
    const guestReservations = Array.isArray(reservations) ? reservations.filter((r: any) => r.guestId === guest.id) : [];
    
    if (guest.telegram_user_id) {
      const telegramGroup = acc.find((g: any) => g.telegram_user_id === guest.telegram_user_id);
      if (telegramGroup) {
        telegramGroup.guests.push({...guest, reservationCount: guestReservations.length});
      } else {
        acc.push({
          telegram_user_id: guest.telegram_user_id,
          guests: [{...guest, reservationCount: guestReservations.length}],
          totalBookings: guestReservations.length
        });
      }
    }
    return acc;
  }, []) : [];

  // Table Preferences
  const tableUsage = Array.isArray(tables) ? tables.map((table: any) => {
    const tableReservations = Array.isArray(reservations) ? reservations.filter((r: any) => r.tableId === table.id) : [];
    const uniqueGuests = new Set(tableReservations.map((r: any) => r.guestId)).size;
    return {
      ...table,
      bookings: tableReservations.length,
      uniqueGuests,
      popularTimes: tableReservations.reduce((acc: any, r: any) => {
        const hour = r.time.split(':')[0];
        acc[hour] = (acc[hour] || 0) + 1;
        return acc;
      }, {})
    };
  }) : [];

  // Party Size Analysis
  const partySizeStats = Array.isArray(reservations) ? reservations.reduce((acc: any, r: any) => {
    acc[r.guests] = (acc[r.guests] || 0) + 1;
    return acc;
  }, {}) : {};

  const avgPartySize = Array.isArray(reservations) && reservations.length ? 
    (reservations.reduce((sum: number, r: any) => sum + r.guests, 0) / reservations.length).toFixed(1) : 0;

  return (
    <DashboardLayout>
      <div className="px-4 py-6 lg:px-8">
        <header className="mb-6">
          <h2 className="text-2xl font-bold text-gray-800">Analytics Dashboard</h2>
          <p className="text-gray-500 mt-1">Deep insights into your guest behavior and restaurant performance</p>
        </header>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="guests">Guest Insights</TabsTrigger>
            <TabsTrigger value="connections">Guest Connections</TabsTrigger>
            <TabsTrigger value="tables">Table Analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Guests</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{totalGuests}</div>
                  <p className="text-xs text-muted-foreground">
                    {regularGuests} repeat customers
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Reservations</CardTitle>
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{totalReservations}</div>
                  <p className="text-xs text-muted-foreground">
                    {confirmedReservations} confirmed
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Telegram Bookings</CardTitle>
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{telegramBookings}</div>
                  <p className="text-xs text-muted-foreground">
                    {telegramGuests} unique Telegram users
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Avg Party Size</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{avgPartySize}</div>
                  <p className="text-xs text-muted-foreground">guests per reservation</p>
                </CardContent>
              </Card>
            </div>

            {/* Party Size Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <BarChart3 className="h-5 w-5 mr-2" />
                  Party Size Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {Object.entries(partySizeStats).map(([size, count]) => (
                    <div key={size} className="text-center p-4 bg-gray-50 rounded-lg">
                      <div className="text-2xl font-bold text-blue-600">{count as number}</div>
                      <div className="text-sm text-gray-500">{size} {size === '1' ? 'guest' : 'guests'}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="guests" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top Guests by Bookings */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Star className="h-5 w-5 mr-2" />
                    Most Loyal Guests
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {Array.isArray(guests) ? guests.map((guest: any) => {
                      const guestReservations = Array.isArray(reservations) ? reservations.filter((r: any) => r.guestId === guest.id) : [];
                      if (guestReservations.length === 0) return null;
                      
                      return (
                        <div key={guest.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center">
                            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                              <UserCheck className="h-4 w-4 text-blue-600" />
                            </div>
                            <div>
                              <div className="font-medium">{guest.name}</div>
                              <div className="text-sm text-gray-500">{guest.phone || 'No phone'}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge variant="secondary">{guestReservations.length} bookings</Badge>
                            {guest.telegram_user_id && (
                              <div className="text-xs text-blue-600 mt-1">via Telegram</div>
                            )}
                          </div>
                        </div>
                      );
                    }).filter(Boolean) : []}
                  </div>
                </CardContent>
              </Card>

              {/* Booking Sources */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Phone className="h-5 w-5 mr-2" />
                    Booking Channels
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {['direct', 'telegram', 'web'].map((source) => {
                      const sourceBookings = Array.isArray(reservations) ? reservations.filter((r: any) => r.source === source).length : 0;
                      const percentage = totalReservations ? ((sourceBookings / totalReservations) * 100).toFixed(1) : 0;
                      
                      return (
                        <div key={source} className="flex items-center justify-between">
                          <div className="flex items-center">
                            <div className="w-3 h-3 bg-blue-600 rounded-full mr-3"></div>
                            <span className="capitalize font-medium">{source}</span>
                          </div>
                          <div className="text-right">
                            <div className="font-bold">{sourceBookings}</div>
                            <div className="text-sm text-gray-500">{percentage}%</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="connections" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Repeat className="h-5 w-5 mr-2" />
                  Connected Guest Groups
                </CardTitle>
                <CardContent>
                  <p className="text-sm text-gray-500 mb-4">
                    Guests linked through shared Telegram accounts or phone numbers
                  </p>
                </CardContent>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {connectedGuests.length > 0 ? (
                    connectedGuests.map((group: any, index: number) => (
                      <div key={index} className="p-4 border rounded-lg bg-gray-50">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center">
                            <MessageSquare className="h-4 w-4 text-blue-600 mr-2" />
                            <span className="font-medium">Telegram Group {index + 1}</span>
                          </div>
                          <Badge variant="outline">{group.totalBookings} total bookings</Badge>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {group.guests.map((guest: any) => (
                            <div key={guest.id} className="flex items-center justify-between p-2 bg-white rounded">
                              <div>
                                <div className="font-medium">{guest.name}</div>
                                <div className="text-sm text-gray-500">{guest.phone || 'No phone'}</div>
                              </div>
                              <Badge variant="secondary">{guest.reservationCount} bookings</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <Users className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                      <p>No connected guest groups found yet</p>
                      <p className="text-sm">Connected groups will appear when multiple guests use the same contact methods</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tables" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Table Performance */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Table className="h-5 w-5 mr-2" />
                    Table Performance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {tableUsage.map((table: any) => (
                      <div key={table.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <div className="font-medium">Table {table.name}</div>
                          <div className="text-sm text-gray-500">
                            {table.minGuests}-{table.maxGuests} guests
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold">{table.bookings} bookings</div>
                          <div className="text-sm text-gray-500">{table.uniqueGuests} unique guests</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Popular Time Slots */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Clock className="h-5 w-5 mr-2" />
                    Popular Time Slots
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {(() => {
                      const timeSlots = Array.isArray(reservations) ? reservations.reduce((acc: any, r: any) => {
                        const hour = r.time.split(':')[0];
                        acc[hour] = (acc[hour] || 0) + 1;
                        return acc;
                      }, {}) : {};

                      return Object.entries(timeSlots)
                        .sort(([,a], [,b]) => (b as number) - (a as number))
                        .slice(0, 8)
                        .map(([hour, count]) => (
                          <div key={hour} className="flex items-center justify-between">
                            <span className="font-medium">{hour}:00</span>
                            <div className="flex items-center">
                              <div className="w-20 bg-gray-200 rounded-full h-2 mr-3">
                                <div 
                                  className="bg-blue-600 h-2 rounded-full" 
                                  style={{ width: `${((count as number) / Math.max(...Object.values(timeSlots) as number[])) * 100}%` }}
                                ></div>
                              </div>
                              <Badge variant="outline">{count as number}</Badge>
                            </div>
                          </div>
                        ));
                    })()}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}