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
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus, Calendar as CalendarIcon, Edit, Trash2, UserCheck, XCircle, Phone, Mail } from "lucide-react";

// In a real application, you would get the restaurant ID from context
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
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const dateForQuery = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : undefined;
  
  const statusesForFilter = statusFilter === "all" ? "" : statusFilter;

  const { data: reservations, isLoading } = useQuery({
    queryKey: ["/api/reservations"],
    queryFn: async () => {
      const response = await fetch("/api/reservations", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch reservations");
      return response.json();
    }
  });

  // Client-side filtering with proper Moscow timezone logic
  const moscowTime = new Date().toLocaleString("en-US", {timeZone: "Europe/Moscow"});
  const todayMoscow = new Date(moscowTime);
  
  const filteredReservations = reservations ? reservations.filter((reservation: any) => {
    // First apply time-based filtering (activeTab)
    const reservationDateTime = new Date(`${reservation.date} ${reservation.time}`);
    
    let timeMatch = true;
    if (activeTab === "upcoming") {
      timeMatch = reservationDateTime >= todayMoscow;
    } else if (activeTab === "past") {
      timeMatch = reservationDateTime < todayMoscow;
    }
    // For "all" tab, timeMatch stays true
    
    // Then apply status filtering
    let statusMatch = true;
    if (statusFilter !== "all") {
      statusMatch = reservation.status === statusFilter;
    }
    
    // Apply date filtering if specific date selected
    let dateMatch = true;
    if (dateForQuery) {
      dateMatch = reservation.date === dateForQuery;
    }
    
    // Apply search filtering
    let searchMatch = true;
    if (searchQuery) {
      const searchLower = searchQuery.toLowerCase();
      searchMatch = reservation.guest?.name?.toLowerCase().includes(searchLower) ||
                   reservation.guest?.phone?.toLowerCase().includes(searchLower) ||
                   reservation.comments?.toLowerCase().includes(searchLower);
    }
    
    return timeMatch && statusMatch && dateMatch && searchMatch;
  }) : [];

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
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/upcoming'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
    },
    onError: (error) => {
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
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/upcoming'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to cancel reservation: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const deleteReservationMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("DELETE", `/api/reservations/${id}`, undefined);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Reservation deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/reservations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/upcoming'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      setDeleteConfirmOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to delete reservation: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const handleCreateReservation = () => {
    setSelectedReservationId(undefined);
    setIsReservationModalOpen(true);
  };

  const handleEditReservation = (id: number) => {
    setSelectedReservationId(id);
    setIsReservationModalOpen(true);
  };

  const handleDeleteReservation = (id: number) => {
    setReservationToDelete(id);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (reservationToDelete) {
      deleteReservationMutation.mutate(reservationToDelete);
    }
  };

  const handleConfirmReservation = (id: number) => {
    confirmReservationMutation.mutate(id);
  };

  const handleCancelReservation = (id: number) => {
    cancelReservationMutation.mutate(id);
  };



  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Confirmed</Badge>;
      case 'created':
        return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Pending</Badge>;
      case 'canceled':
        return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Canceled</Badge>;
      case 'completed':
        return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Completed</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="px-4 py-6 lg:px-8">
        <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Reservations</h2>
            <p className="text-gray-500 mt-1">Manage all your restaurant reservations</p>
          </div>
          <div className="mt-4 md:mt-0">
            <Button onClick={handleCreateReservation}>
              <Plus className="mr-2 h-4 w-4" />
              New Reservation
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <div className="md:col-span-3">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between space-y-2 sm:space-y-0">
                  <CardTitle>All Reservations</CardTitle>
                  <div className="flex items-center space-x-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                      <Input
                        type="search"
                        placeholder="Search reservations..."
                        className="pl-8 w-full md:w-[240px]"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder="Filter by status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="created">Pending</SelectItem>
                        <SelectItem value="confirmed">Confirmed</SelectItem>
                        <SelectItem value="canceled">Canceled</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="mb-4">
                    <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                    <TabsTrigger value="past">Past</TabsTrigger>
                    <TabsTrigger value="all">All</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="upcoming" className="space-y-4">
                    <div className="rounded-md border">
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Guest</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date & Time</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Table</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Guests</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {isLoading ? (
                              <tr>
                                <td colSpan={7} className="px-6 py-4 text-center">
                                  <div className="flex justify-center">
                                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-900 border-t-transparent"></div>
                                  </div>
                                </td>
                              </tr>
                            ) : filteredReservations && filteredReservations.length > 0 ? (
                              filteredReservations.map((reservation) => (
                                <tr key={reservation.id}>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center">
                                      <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-700">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                          <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                                        </svg>
                                      </div>
                                      <div className="ml-4">
                                        <div className="text-sm font-medium text-gray-900">{reservation.guest?.name || 'Guest'}</div>
                                        <div className="text-sm text-gray-500">{reservation.guest?.phone || 'No phone'}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm font-medium text-gray-900">
                                      {format(new Date(`${reservation.date}T${reservation.time}`), 'HH:mm')}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {format(new Date(reservation.date), 'MMM d, yyyy')}
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm text-gray-900">{reservation.table?.name || 'Not assigned'}</div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {reservation.guests}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    {renderStatusBadge(reservation.status)}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                                    {reservation.source || 'direct'}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <div className="flex justify-end space-x-2">
                                      {reservation.status === 'created' && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => handleConfirmReservation(reservation.id)}
                                          className="text-green-600 hover:text-green-900"
                                          title="Confirm"
                                        >
                                          <UserCheck size={16} />
                                        </Button>
                                      )}
                                      {(reservation.status === 'created' || reservation.status === 'confirmed') && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => handleCancelReservation(reservation.id)}
                                          className="text-yellow-600 hover:text-yellow-900"
                                          title="Cancel"
                                        >
                                          <XCircle size={16} />
                                        </Button>
                                      )}
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleEditReservation(reservation.id)}
                                        className="text-blue-600 hover:text-blue-900"
                                        title="Edit"
                                      >
                                        <Edit size={16} />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleDeleteReservation(reservation.id)}
                                        className="text-red-600 hover:text-red-900"
                                        title="Delete"
                                      >
                                        <Trash2 size={16} />
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                                  No reservations found
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="past" className="space-y-4">
                    {/* Past reservations - Same table structure as above */}
                    <div className="rounded-md border">
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Guest</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date & Time</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Table</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Guests</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {isLoading ? (
                              <tr>
                                <td colSpan={7} className="px-6 py-4 text-center">
                                  <div className="flex justify-center">
                                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-900 border-t-transparent"></div>
                                  </div>
                                </td>
                              </tr>
                            ) : filteredReservations && filteredReservations.length > 0 ? (
                              filteredReservations.map((reservation) => (
                                <tr key={reservation.id}>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center">
                                      <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-700">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                          <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                                        </svg>
                                      </div>
                                      <div className="ml-4">
                                        <div className="text-sm font-medium text-gray-900">{reservation.guest?.name || 'Guest'}</div>
                                        <div className="text-sm text-gray-500">{reservation.guest?.phone || 'No phone'}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm font-medium text-gray-900">
                                      {format(new Date(`${reservation.date}T${reservation.time}`), 'HH:mm')}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {format(new Date(reservation.date), 'MMM d, yyyy')}
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm text-gray-900">{reservation.table?.name || 'Not assigned'}</div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {reservation.guests}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    {renderStatusBadge(reservation.status)}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                                    {reservation.source || 'direct'}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleDeleteReservation(reservation.id)}
                                      className="text-red-600 hover:text-red-900"
                                    >
                                      <Trash2 size={16} />
                                    </Button>
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                                  No past reservations found
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="all" className="space-y-4">
                    {/* All reservations - Same table structure as above */}
                    <div className="rounded-md border">
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Guest</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date & Time</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Table</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Guests</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {isLoading ? (
                              <tr>
                                <td colSpan={7} className="px-6 py-4 text-center">
                                  <div className="flex justify-center">
                                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-900 border-t-transparent"></div>
                                  </div>
                                </td>
                              </tr>
                            ) : filteredReservations && filteredReservations.length > 0 ? (
                              filteredReservations.map((reservation) => (
                                <tr key={reservation.id}>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center">
                                      <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-700">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                          <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                                        </svg>
                                      </div>
                                      <div className="ml-4">
                                        <div className="text-sm font-medium text-gray-900">{reservation.guest?.name || 'Guest'}</div>
                                        <div className="text-sm text-gray-500">{reservation.guest?.phone || 'No phone'}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm font-medium text-gray-900">
                                      {format(new Date(`${reservation.date}T${reservation.time}`), 'HH:mm')}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {format(new Date(reservation.date), 'MMM d, yyyy')}
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm text-gray-900">{reservation.table?.name || 'Not assigned'}</div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {reservation.guests}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    {renderStatusBadge(reservation.status)}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                                    {reservation.source || 'direct'}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <div className="flex justify-end space-x-2">
                                      {reservation.status === 'created' && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => handleConfirmReservation(reservation.id)}
                                          className="text-green-600 hover:text-green-900"
                                          title="Confirm"
                                        >
                                          <UserCheck size={16} />
                                        </Button>
                                      )}
                                      {(reservation.status === 'created' || reservation.status === 'confirmed') && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => handleCancelReservation(reservation.id)}
                                          className="text-yellow-600 hover:text-yellow-900"
                                          title="Cancel"
                                        >
                                          <XCircle size={16} />
                                        </Button>
                                      )}
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleEditReservation(reservation.id)}
                                        className="text-blue-600 hover:text-blue-900"
                                        title="Edit"
                                      >
                                        <Edit size={16} />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleDeleteReservation(reservation.id)}
                                        className="text-red-600 hover:text-red-900"
                                        title="Delete"
                                      >
                                        <Trash2 size={16} />
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                                  No reservations found
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          <div className="md:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <CalendarIcon className="h-5 w-5 mr-2" />
                  <span>Calendar</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  className="rounded-md border"
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      
      {/* Reservation Modal */}
      <ReservationModal
        isOpen={isReservationModalOpen}
        onClose={() => setIsReservationModalOpen(false)}
        reservationId={selectedReservationId}
        restaurantId={restaurantId}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the reservation. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              {deleteReservationMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
