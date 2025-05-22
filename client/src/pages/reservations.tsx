import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReservationModal } from "@/components/reservations/ReservationModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus, Calendar as CalendarIcon, Edit, Trash2, UserCheck, XCircle, Phone, Mail } from "lucide-react";
import { RollingCalendar } from "@/components/ui/rolling-calendar";

const restaurantId = 1;

export default function Reservations() {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isReservationModalOpen, setIsReservationModalOpen] = useState(false);
  const [selectedReservationId, setSelectedReservationId] = useState<number | undefined>(undefined);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [reservationToDelete, setReservationToDelete] = useState<number | undefined>(undefined);
  const [activeTab, setActiveTab] = useState("upcoming");
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const dateForQuery = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : undefined;

  // Fetch all reservations (no server-side filtering)
  const { data: reservations, isLoading } = useQuery({
    queryKey: ["/api/reservations"],
    queryFn: async () => {
      const response = await fetch("/api/reservations", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch reservations");
      return response.json();
    }
  });

  // Moscow timezone filtering with improved logic
  const moscowTime = new Date().toLocaleString("en-US", {timeZone: "Europe/Moscow"});
  const todayMoscow = new Date(moscowTime);
  
  const filteredReservations = reservations ? reservations.filter((reservation: any) => {
    // Time-based filtering (activeTab) 
    const reservationDateTime = new Date(`${reservation.date} ${reservation.time}`);
    
    let timeMatch = true;
    if (activeTab === "upcoming") {
      timeMatch = reservationDateTime >= todayMoscow;
    } else if (activeTab === "past") {
      timeMatch = reservationDateTime < todayMoscow;
    }
    
    // Status filtering - works independently of time filter
    let statusMatch = true;
    if (statusFilter !== "all") {
      statusMatch = reservation.status === statusFilter;
    }
    
    // Date filtering if specific date selected
    let dateMatch = true;
    if (dateForQuery) {
      dateMatch = reservation.date === dateForQuery;
    }
    
    // Search filtering
    let searchMatch = true;
    if (searchQuery) {
      const searchLower = searchQuery.toLowerCase();
      searchMatch = reservation.guest?.name?.toLowerCase().includes(searchLower) ||
                   reservation.guest?.phone?.toLowerCase().includes(searchLower) ||
                   reservation.comments?.toLowerCase().includes(searchLower);
    }
    
    return timeMatch && statusMatch && dateMatch && searchMatch;
  }) : [];

  // Mutations for reservation management
  const confirmReservationMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("PATCH", `/api/reservations/${id}`, {
        status: "confirmed"
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Reservation confirmed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/reservations'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: `Failed to confirm reservation: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const cancelReservationMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("PATCH", `/api/reservations/${id}`, {
        status: "canceled"
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Reservation canceled successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/reservations'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: `Failed to cancel reservation: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const handleConfirmReservation = (id: number) => {
    confirmReservationMutation.mutate(id);
  };

  const handleCancelReservation = (id: number) => {
    cancelReservationMutation.mutate(id);
  };

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">🟢 Confirmed</Badge>;
      case 'created':
        return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">🟡 Pending</Badge>;
      case 'canceled':
        return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">🔴 Cancelled</Badge>;
      case 'completed':
        return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">✅ Completed</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="px-4 py-6 lg:px-8">
        {/* Header with Moscow Time Display */}
        <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Reservations</h1>
            <p className="mt-1 text-sm text-gray-500">
              Moscow Time: {format(new Date(moscowTime), 'PPp')}
            </p>
          </div>
          <div className="mt-4 flex space-x-3 md:mt-0">
            <Button onClick={() => setIsReservationModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Reservation
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          {/* Sidebar Filters */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle>Filters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Time Period Filter */}
                <div>
                  <label className="text-sm font-medium text-gray-700">Time Period</label>
                  <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-2">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="all">All</TabsTrigger>
                      <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                      <TabsTrigger value="past">Past</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                {/* Status Filter */}
                <div>
                  <label className="text-sm font-medium text-gray-700">Status</label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="created">Pending</SelectItem>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="canceled">Cancelled</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Date Selection - Quick Buttons */}
                <div>
                  <label className="text-sm font-medium text-gray-700">Date Selection</label>
                  <div className="mt-2 space-y-3">
                    {/* Quick Selection Buttons */}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant={!selectedDate && activeTab === 'all' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSelectedDate(null)}
                        className="text-xs"
                      >
                        Today
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const today = new Date();
                          setSelectedDate(today);
                        }}
                        className="text-xs"
                      >
                        This Week
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const nextWeek = new Date();
                          nextWeek.setDate(nextWeek.getDate() + 7);
                          setSelectedDate(nextWeek);
                        }}
                        className="text-xs"
                      >
                        Next Week
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsCalendarModalOpen(true)}
                        className="text-xs"
                      >
                        📅 More
                      </Button>
                    </div>

                    {/* Selected Date Display */}
                    {selectedDate && (
                      <div className="flex items-center justify-between p-2 bg-blue-50 rounded-md">
                        <span className="text-sm text-blue-900">
                          Selected: {format(selectedDate, 'MMM d, yyyy')}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedDate(null)}
                          className="h-6 w-6 p-0 text-blue-600 hover:text-blue-800"
                        >
                          ×
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Search Filter */}
                <div>
                  <label className="text-sm font-medium text-gray-700">Search</label>
                  <div className="relative mt-2">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      placeholder="Search guests, phone..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Quick Stats */}
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Today's Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Total Reservations:</span>
                    <span className="font-medium">{filteredReservations.length}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Confirmed:</span>
                    <span className="font-medium text-green-600">
                      {filteredReservations.filter((r: any) => r.status === 'confirmed').length}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Pending:</span>
                    <span className="font-medium text-yellow-600">
                      {filteredReservations.filter((r: any) => r.status === 'created').length}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Reservation List */}
          <div className="lg:col-span-3">
            <Card>
              <CardHeader>
                <CardTitle>
                  {activeTab === 'upcoming' ? 'Upcoming' : activeTab === 'past' ? 'Past' : 'All'} Reservations
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-900 border-t-transparent"></div>
                  </div>
                ) : filteredReservations.length > 0 ? (
                  <div className="space-y-4">
                    {filteredReservations.map((reservation: any) => (
                      <div key={reservation.id} className="rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between">
                          {/* Guest Info */}
                          <div className="flex items-center space-x-4">
                            <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-700">
                              <UserCheck className="h-5 w-5" />
                            </div>
                            <div>
                              <h3 className="font-medium text-gray-900">
                                {reservation.guest?.name || 'Guest'}
                              </h3>
                              <p className="text-sm text-gray-500">
                                {reservation.guest?.phone || 'No phone provided'}
                              </p>
                            </div>
                          </div>

                          {/* Reservation Details */}
                          <div className="flex items-center space-x-6">
                            <div className="text-center">
                              <p className="text-sm font-medium text-gray-900">
                                {format(new Date(`${reservation.date}T${reservation.time}`), 'HH:mm')}
                              </p>
                              <p className="text-xs text-gray-500">
                                {format(new Date(reservation.date), 'MMM d, yyyy')}
                              </p>
                            </div>
                            
                            <div className="text-center">
                              <p className="text-sm font-medium text-gray-900">
                                {reservation.table?.name || 'Table not assigned'}
                              </p>
                              <p className="text-xs text-gray-500">{reservation.guests} guests</p>
                            </div>

                            <div>
                              {renderStatusBadge(reservation.status)}
                            </div>

                            {/* Action Buttons */}
                            <div className="flex space-x-2">
                              {reservation.guest?.phone && (
                                <Button
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => window.open(`tel:${reservation.guest.phone}`, '_self')}
                                >
                                  <Phone className="h-4 w-4" />
                                </Button>
                              )}
                              
                              {reservation.guest?.email && (
                                <Button
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => window.open(`mailto:${reservation.guest.email}`, '_self')}
                                >
                                  <Mail className="h-4 w-4" />
                                </Button>
                              )}

                              <Button
                                variant="outline" 
                                size="sm"
                                onClick={() => {
                                  setSelectedReservationId(reservation.id);
                                  setIsReservationModalOpen(true);
                                }}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>

                              {reservation.status === 'created' && (
                                <Button
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => handleConfirmReservation(reservation.id)}
                                  className="text-green-600 hover:text-green-700"
                                >
                                  <UserCheck className="h-4 w-4" />
                                </Button>
                              )}

                              {reservation.status !== 'canceled' && (
                                <Button
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => handleCancelReservation(reservation.id)}
                                  className="text-red-600 hover:text-red-700"
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Comments */}
                        {reservation.comments && (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <p className="text-sm text-gray-600">
                              <span className="font-medium">Note:</span> {reservation.comments}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <CalendarIcon className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No reservations found</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      {searchQuery || statusFilter !== 'all' || activeTab !== 'all' 
                        ? 'Try adjusting your filters' 
                        : 'Get started by creating a new reservation.'}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Reservation Modal */}
        <ReservationModal
          isOpen={isReservationModalOpen}
          onClose={() => {
            setIsReservationModalOpen(false);
            setSelectedReservationId(undefined);
          }}
          reservationId={selectedReservationId}
          restaurantId={restaurantId}
        />

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently cancel the reservation.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (reservationToDelete) {
                    handleCancelReservation(reservationToDelete);
                  }
                  setDeleteConfirmOpen(false);
                  setReservationToDelete(undefined);
                }}
              >
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}