import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlusCircle, Filter } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatisticsCards } from "@/components/dashboard/StatisticsCards";
import { UpcomingReservations } from "@/components/dashboard/UpcomingReservations";
import { TableStatus } from "@/components/dashboard/TableStatus";
import { ReservationTimeline } from "@/components/dashboard/ReservationTimeline";
import { AIAssistant } from "@/components/dashboard/AIAssistant";
import { ReservationModal } from "@/components/reservations/ReservationModal";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { apiRequest } from "@/lib/queryClient";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const [isReservationModalOpen, setIsReservationModalOpen] = useState(false);
  const [selectedReservationId, setSelectedReservationId] = useState<number | undefined>(undefined);
  const [selectedDateRange, setSelectedDateRange] = useState<string>("last7days");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [reservationToDelete, setReservationToDelete] = useState<number | undefined>(undefined);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // In a real application, you would get the restaurant ID from user context or auth state
  const restaurantId = 1;

  const { data: restaurant } = useQuery({
    queryKey: ['/api/restaurants/profile'],
  });

  const deleteMutation = useMutation({
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
      deleteMutation.mutate(reservationToDelete);
    }
  };

  return (
    <DashboardLayout>
      <div className="px-4 py-6 lg:px-8">
        {/* Page Header */}
        <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Restaurant Dashboard</h2>
            <p className="text-gray-500 mt-1">Overview of your restaurant's performance and reservations</p>
          </div>
          <div className="mt-4 md:mt-0 flex flex-wrap gap-2">
            <Button
              className="inline-flex items-center"
              onClick={handleCreateReservation}
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              New Reservation
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="inline-flex items-center">
                  <Filter className="mr-2 h-4 w-4" />
                  {selectedDateRange === "today" ? "Today" :
                   selectedDateRange === "last7days" ? "Last 7 days" :
                   selectedDateRange === "last30days" ? "Last 30 days" : "Custom range"}
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-2 h-4 w-4"><path d="m6 9 6 6 6-6"/></svg>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSelectedDateRange("today")}>
                  Today
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedDateRange("last7days")}>
                  Last 7 days
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedDateRange("last30days")}>
                  Last 30 days
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Statistics Cards */}
        <StatisticsCards restaurantId={restaurantId} />

        {/* Upcoming Reservations & Table Status */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          <div className="lg:col-span-2">
            <UpcomingReservations 
              restaurantId={restaurantId} 
              onEdit={handleEditReservation}
              onDelete={handleDeleteReservation}
            />
          </div>
          <div className="lg:col-span-1">
            <TableStatus restaurantId={restaurantId} />
          </div>
        </div>

        {/* Reservation Timeline & AI Assistant */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <ReservationTimeline restaurantId={restaurantId} />
          </div>
          <div className="lg:col-span-1">
            <AIAssistant restaurantId={restaurantId} />
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
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
