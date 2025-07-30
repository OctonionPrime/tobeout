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
import { EnhancedAIAssistant } from '@/components/dashboard/EnhancedAIAssistant';

// 🔌 WEBSOCKET INTEGRATION: Import WebSocket status component
import { WebSocketStatus } from '@/components/websocket/WebSocketStatus';

export default function Dashboard() {
    const [isReservationModalOpen, setIsReservationModalOpen] = useState(false);
    const [selectedReservationId, setSelectedReservationId] = useState<number | undefined>(undefined);
    const [selectedDateRange, setSelectedDateRange] = useState<string>("last7days");
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [reservationToDelete, setReservationToDelete] = useState<number | undefined>(undefined);

    const { toast } = useToast();
    const queryClient = useQueryClient();

    // ✅ FIX: Fetch restaurant profile to get the dynamic restaurantId
    const { data: restaurant, isLoading: isRestaurantLoading, error: restaurantError } = useQuery({
        queryKey: ['/api/restaurants/profile'],
        queryFn: async () => {
            console.log('🏪 [Dashboard] Fetching restaurant profile...');
            const response = await apiRequest("GET", "/api/restaurants/profile");
            const data = await response.json();
            console.log('✅ [Dashboard] Restaurant profile loaded:', { id: data.id, timezone: data.timezone });
            return data;
        },
        staleTime: 5 * 60 * 1000, // Stale after 5 minutes
        gcTime: 10 * 60 * 1000,
    });

    // ✅ FIX: Use the dynamic restaurantId from the fetched data
    const restaurantId = restaurant?.id;
    const effectiveTimezone = restaurant?.timezone || 'Europe/Moscow';

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            console.log(`🗑️ [Dashboard] Deleting reservation ${id}...`);
            const response = await apiRequest("DELETE", `/api/reservations/${id}`);
            const text = await response.text();
            console.log(`✅ [Dashboard] Reservation ${id} deleted successfully`);
            return text ? JSON.parse(text) : {};
        },
        onSuccess: () => {
            toast({
                title: "Success",
                description: "Reservation deleted successfully",
            });
            queryClient.invalidateQueries({ queryKey: ['/api/reservations'] });
            queryClient.invalidateQueries({ queryKey: ['/api/dashboard/upcoming'] });
            queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
            queryClient.invalidateQueries({ queryKey: ['tables_availability_status'] });
            setDeleteConfirmOpen(false);
        },
        onError: (error) => {
            console.error('❌ [Dashboard] Delete reservation error:', error);
            toast({
                title: "Error",
                description: `Failed to delete reservation: ${error.message}`,
                variant: "destructive",
            });
        }
    });

    const handleCreateReservation = () => {
        console.log('➕ [Dashboard] Opening reservation modal for new reservation');
        setSelectedReservationId(undefined);
        setIsReservationModalOpen(true);
    };

    const handleEditReservation = (id: number) => {
        console.log(`✏️ [Dashboard] Opening reservation modal for editing reservation ${id}`);
        setSelectedReservationId(id);
        setIsReservationModalOpen(true);
    };

    const handleDeleteReservation = (id: number) => {
        console.log(`🗑️ [Dashboard] Confirming deletion of reservation ${id}`);
        setReservationToDelete(id);
        setDeleteConfirmOpen(true);
    };

    const confirmDelete = () => {
        if (reservationToDelete) {
            deleteMutation.mutate(reservationToDelete);
        }
    };

    if (isRestaurantLoading) {
        return (
            <DashboardLayout>
                <div className="px-4 py-6 lg:px-8">
                    <div className="animate-pulse">
                        <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
                        <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className="h-24 bg-gray-200 rounded"></div>
                            ))}
                        </div>
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    if (restaurantError) {
        return (
            <DashboardLayout>
                <div className="px-4 py-6 lg:px-8">
                    <div className="text-center py-12">
                        <h2 className="text-xl font-semibold text-gray-900 mb-2">Unable to load restaurant data</h2>
                        <p className="text-gray-600 mb-4">Please try refreshing the page or contact support if the issue persists.</p>
                        <Button onClick={() => window.location.reload()}>Refresh Page</Button>
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <div className="px-4 py-6 lg:px-8">
                <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">Restaurant Dashboard</h2>
                        <p className="text-gray-500 mt-1">
                            Overview of your restaurant's performance and reservations
                            {effectiveTimezone !== 'Europe/Moscow' && (
                                <span className="text-xs text-blue-600 ml-2">
                                    📍 {effectiveTimezone}
                                </span>
                            )}
                        </p>
                    </div>
                    <div className="mt-4 md:mt-0 flex flex-wrap gap-2 items-center">
                        {/* 🔌 WEBSOCKET INTEGRATION: Add WebSocket status badge */}
                        <WebSocketStatus />
                        
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
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-2 h-4 w-4"><path d="m6 9 6 6 6-6" /></svg>
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

                {/* ✅ FIX: Conditionally render child components only when restaurantId is available */}
                {restaurantId && (
                    <>
                        <StatisticsCards
                            restaurantId={restaurantId}
                            restaurantTimezone={effectiveTimezone}
                        />

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                            <div className="lg:col-span-2">
                                <UpcomingReservations
                                    restaurantId={restaurantId}
                                    restaurantTimezone={effectiveTimezone}
                                    onEdit={handleEditReservation}
                                    onDelete={handleDeleteReservation}
                                />
                            </div>
                            <div className="lg:col-span-1">
                                <TableStatus
                                    restaurantId={restaurantId}
                                    restaurantTimezone={effectiveTimezone}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                            <div className="lg:col-span-1">
                                <EnhancedAIAssistant />
                            </div>
                            <div className="lg:col-span-1">
                                <AIAssistant
                                    restaurantId={restaurantId}
                                    restaurantTimezone={effectiveTimezone}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-8">
                            <ReservationTimeline
                                restaurantId={restaurantId}
                                restaurantTimezone={effectiveTimezone}
                            />
                        </div>
                    </>
                )}
            </div>

            {isReservationModalOpen && restaurantId && (
                <ReservationModal
                    isOpen={isReservationModalOpen}
                    onClose={() => setIsReservationModalOpen(false)}
                    reservationId={selectedReservationId}
                    restaurantId={restaurantId}
                    restaurantTimezone={effectiveTimezone}
                />
            )}

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