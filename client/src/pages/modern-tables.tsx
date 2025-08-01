import React, { useState, useRef, Suspense, lazy, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Clock, Users, Settings, MousePointer2, Edit2, RefreshCw, Move, Calendar, Plus, MoreHorizontal, Trash2, ArrowUp, ArrowDown, UserPlus, Save, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { getRestaurantDateTime, getRestaurantDateString, getTomorrowDateString } from "@/lib/utils";

// ✅ FIXED: Direct WebSocket context usage - no dynamic imports
import { useWebSocketContext } from "@/components/websocket/WebSocketContext";

// ✅ FIXED: Stable DnD components loader with better error handling
const useDndComponents = () => {
    const [dndComponents, setDndComponents] = useState<any>({
        DndContext: ({ children, onDragEnd }: any) => <div>{children}</div>,
        DraggableReservation: ({ children }: any) => <div>{children}</div>,
        DroppableSlot: ({ children }: any) => <div>{children}</div>,
    });
    
    const [isLoaded, setIsLoaded] = useState(false);
    
    useEffect(() => {
        let mounted = true;
        let loadTimeout: NodeJS.Timeout;
        
        const loadDndComponents = async () => {
            try {
                // Wait longer to ensure WebSocket is completely stable
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                if (!mounted) return;

                console.log('[ModernTables] Loading DnD components...');
                
                const [dndModule, draggableModule, droppableModule] = await Promise.all([
                    import('@dnd-kit/core').catch(() => {
                        console.log('[ModernTables] @dnd-kit/core not available');
                        return null;
                    }),
                    import('@/components/reservations/DraggableReservation').catch(() => {
                        console.log('[ModernTables] DraggableReservation not available');
                        return null;
                    }),
                    import('@/components/reservations/DroppableSlot').catch(() => {
                        console.log('[ModernTables] DroppableSlot not available');
                        return null;
                    })
                ]);
                
                if (mounted) {
                    console.log('[ModernTables] DnD components loaded successfully');
                    setDndComponents({
                        DndContext: dndModule?.DndContext || (({ children }: any) => <div>{children}</div>),
                        DraggableReservation: draggableModule?.DraggableReservation || (({ children }: any) => <div>{children}</div>),
                        DroppableSlot: droppableModule?.DroppableSlot || (({ children }: any) => <div>{children}</div>),
                    });
                    setIsLoaded(true);
                }
            } catch (error) {
                console.log('[ModernTables] DnD components loading failed, using fallbacks');
                if (mounted) {
                    setIsLoaded(true);
                }
            }
        };
        
        // Delay the loading longer to prevent any interference with WebSocket
        loadTimeout = setTimeout(loadDndComponents, 3000);
        
        return () => {
            mounted = false;
            if (loadTimeout) {
                clearTimeout(loadTimeout);
            }
        };
    }, []);
    
    return { ...dndComponents, isLoaded };
};

// ✅ FIXED: Simplified FloorPlanView fallback that doesn't cause re-renders
const FloorPlanViewFallback = React.memo(({ floors, isLoading, isManageFloorsOpen, setIsManageFloorsOpen }: any) => {
    const [newFloorName, setNewFloorName] = useState("");
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const createFloorMutation = useMutation({
        mutationFn: async (name: string) => {
            const response = await fetch('/api/floors', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ name })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || 'Failed to create floor');
            }
            return response.json();
        },
        onSuccess: (newFloor) => {
            toast({
                title: "Floor Created",
                description: `Successfully created '${newFloor.name}' (Fallback Mode).`
            });
            setNewFloorName("");
            queryClient.invalidateQueries({ queryKey: ["/api/floors"] });
        },
        onError: (error: any) => {
            toast({
                title: "Failed to Create Floor",
                description: error.message || "An unexpected error occurred",
                variant: "destructive"
            });
        }
    });

    const handleCreateFloor = useCallback(() => {
        const trimmedName = newFloorName.trim();
        if (!trimmedName) {
            toast({
                title: "Invalid Floor Name",
                description: "Please enter a valid floor name",
                variant: "destructive"
            });
            return;
        }
        createFloorMutation.mutate(trimmedName);
    }, [newFloorName, createFloorMutation, toast]);

    return (
        <div className="p-6 text-center">
            <h3 className="text-lg font-semibold mb-4">Floor Plan View (Loading...)</h3>
            <p className="text-gray-500 mb-4">FloorPlanView component is loading</p>
            <p className="text-sm text-gray-400 mb-4">Floors available: {floors?.length || 0}</p>

            <Button onClick={() => setIsManageFloorsOpen(true)} className="mt-4">
                <Settings className="h-4 w-4 mr-2" />
                {(!floors || floors.length === 0) ? "Create First Floor" : "Manage Floors"}
            </Button>

            <Dialog open={isManageFloorsOpen} onOpenChange={setIsManageFloorsOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Manage Floors (Loading Mode)</DialogTitle>
                        <DialogDescription>Floor plan is loading. Basic management available.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="p-2 bg-blue-100 rounded text-xs">
                            <strong>Loading:</strong> FloorPlanView component is loading. Basic floor management available.
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="new-floor-input-loading">Create New Floor</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    id="new-floor-input-loading"
                                    placeholder="New floor name (e.g., Main Hall)"
                                    value={newFloorName}
                                    onChange={(e) => setNewFloorName(e.target.value)}
                                    onKeyPress={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleCreateFloor();
                                        }
                                    }}
                                    disabled={createFloorMutation.isPending}
                                />
                                <Button
                                    onClick={handleCreateFloor}
                                    disabled={createFloorMutation.isPending || !newFloorName.trim()}
                                    className="flex-shrink-0"
                                >
                                    {createFloorMutation.isPending ? (
                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Plus className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>
                        </div>

                        {floors && floors.length > 0 && (
                            <div className="space-y-2">
                                <Label>Existing Floors ({floors.length})</Label>
                                <div className="max-h-32 overflow-y-auto space-y-2">
                                    {floors.map((floor: any) => (
                                        <div key={floor.id} className="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-700 rounded-md">
                                            <span>{floor.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsManageFloorsOpen(false)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
});

FloorPlanViewFallback.displayName = 'FloorPlanViewFallback';

// ✅ FIXED: Stable lazy loading that doesn't cause WebSocket issues
const FloorPlanView = lazy(() =>
    import("./FloorPlanView")
        .then(module => ({ default: module.FloorPlanView }))
        .catch(error => {
            console.log('[ModernTables] FloorPlanView not available, using fallback:', error);
            return { default: FloorPlanViewFallback };
        })
);

// Interfaces
interface TableData {
    id: number;
    name: string;
    minGuests: number;
    maxGuests: number;
    status: string;
    features: string[];
    comments?: string;
    floorId: number | null;
    posX: number;
    posY: number;
    shape: 'square' | 'round';
    rotation: number;
    floor?: {
        name: string;
    };
    reservation?: {
        id: number;
        guestName: string;
        guestCount: number;
        timeSlot: string;
        phone: string;
        status: string;
    };
}

interface ScheduleSlot {
    time: string;
    tables: TableData[];
}

interface AddTableForm {
    name: string;
    minGuests: number;
    maxGuests: number;
    features: string;
    isNonCombinable: boolean;
    comments: string;
    floorId: number | null;
    shape: 'square' | 'round';
}

interface Restaurant {
    id: number;
    openingTime: string;
    closingTime: string;
    avgReservationDuration: number;
    timezone: string;
    [key: string]: any;
}

interface Floor {
    id: number;
    name: string;
}

interface MutationContext {
    previousData?: any;
}

// ✅ FIXED: Simple error boundary that doesn't interfere with WebSocket
class ErrorBoundary extends React.Component<
    { children: React.ReactNode; fallback: React.ReactNode },
    { hasError: boolean; error?: Error }
> {
    constructor(props: any) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: any) {
        console.error('[ModernTables] Error boundary caught:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback;
        }

        return this.props.children;
    }
}

export default function ModernTables() {
    console.log('[ModernTables] Component mounting...');
    
    const [selectedDate, setSelectedDate] = useState('');
    const [selectedTime, setSelectedTime] = useState("19:00");
    const [activeView, setActiveView] = useState<"schedule" | "floorplan" | "grid" | "list">("schedule");

    const [showTableModal, setShowTableModal] = useState(false);
    const [editingTable, setEditingTable] = useState<TableData | null>(null);

    const [tableForm, setTableForm] = useState<AddTableForm>({
        name: "",
        minGuests: 1,
        maxGuests: 4,
        features: "",
        isNonCombinable: false,
        comments: "",
        floorId: null,
        shape: "square",
    });

    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        reservationId?: number;
        tableId?: number;
        timeSlot?: string;
        guestName?: string;
    } | null>(null);

    const [isManageFloorsOpen, setIsManageFloorsOpen] = useState(false);

    const queryClient = useQueryClient();
    const { toast } = useToast();

    // ✅ FIXED: Add component lifecycle tracking
    useEffect(() => {
        console.log('[ModernTables] Component mounted');
        
        return () => {
            console.log('[ModernTables] Component unmounting...');
        };
    }, []);

    // ✅ FIXED: Use WebSocket context normally - let React handle it
    const webSocketContext = useWebSocketContext();
    const isConnected = webSocketContext?.isConnected || false;
    
    // ✅ FIXED: Track WebSocket connection changes
    useEffect(() => {
        console.log('[ModernTables] WebSocket connection status:', isConnected);
    }, [isConnected]);

    // ✅ FIXED: Use stable DnD components with loading state
    const { DndContext: StableDndContext, DraggableReservation: StableDraggableReservation, DroppableSlot: StableDroppableSlot, isLoaded: dndLoaded } = useDndComponents();

    // Get restaurant profile first
    const { data: restaurant, isLoading: restaurantLoading, error: restaurantError } = useQuery<Restaurant>({
        queryKey: ["/api/restaurants/profile"],
        retry: 3,
        staleTime: 60000, // Cache for 1 minute
        gcTime: 300000, // Keep in cache for 5 minutes
    });

    const restaurantTimezone = restaurant?.timezone || 'Europe/Belgrade';

    // Set selectedDate after restaurant loads - memoized to prevent excessive updates
    const selectedDateEffect = useCallback(() => {
        if (restaurant && !selectedDate) {
            setSelectedDate(getRestaurantDateString(restaurantTimezone));
        }
    }, [restaurant, selectedDate, restaurantTimezone]);

    useEffect(() => {
        selectedDateEffect();
    }, [selectedDateEffect]);

    // ✅ FIXED: Memoize floors query with longer cache
    const { data: floors, isLoading: floorsLoading, error: floorsError } = useQuery<Floor[]>({
        queryKey: ["/api/floors"],
        queryFn: async () => {
            try {
                const response = await fetch('/api/floors', { credentials: 'include' });
                if (!response.ok) {
                    throw new Error(`Failed to fetch floors: ${response.status}`);
                }
                return response.json();
            } catch (error) {
                console.error('[ModernTables] Error fetching floors:', error);
                throw error;
            }
        },
        enabled: !!restaurant,
        staleTime: 120000, // Cache for 2 minutes
        gcTime: 600000, // Keep in cache for 10 minutes
    });

    // ✅ FIXED: Stable time slots calculation
    const timeSlots: string[] = useMemo(() => {
        if (!restaurant?.openingTime || !restaurant?.closingTime) {
            return [];
        }

        const slots: string[] = [];
        try {
            const [openHour, openMin] = restaurant.openingTime.split(':').map(Number);
            const [closeHour, closeMin] = restaurant.closingTime.split(':').map(Number);

            if (isNaN(openHour) || isNaN(closeHour)) {
                console.error('[ModernTables] Invalid time format:', { openingTime: restaurant.openingTime, closingTime: restaurant.closingTime });
                return [];
            }

            const openingMinutes = openHour * 60 + (openMin || 0);
            const closingMinutes = closeHour * 60 + (closeMin || 0);
            const isOvernightOperation = closingMinutes < openingMinutes;

            if (isOvernightOperation) {
                for (let minutes = openingMinutes; minutes < 24 * 60; minutes += 60) {
                    const hour = Math.floor(minutes / 60);
                    const minute = minutes % 60;
                    slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
                }

                for (let minutes = 0; minutes < closingMinutes; minutes += 60) {
                    const hour = Math.floor(minutes / 60);
                    const minute = minutes % 60;
                    slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
                }
            } else {
                const avgDuration = restaurant.avgReservationDuration || 120;
                const lastBookingTime = closingMinutes - avgDuration;

                for (let minutes = openingMinutes; minutes <= lastBookingTime; minutes += 60) {
                    const hour = Math.floor(minutes / 60);
                    const minute = minutes % 60;
                    slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
                }
            }
        } catch (error) {
            console.error('[ModernTables] Error generating time slots:', error);
            return [];
        }

        return slots;
    }, [restaurant?.openingTime, restaurant?.closingTime, restaurant?.avgReservationDuration]);

    // Get tables with proper timezone context
    const { data: tables, isLoading: tablesLoading, error: tablesError } = useQuery<TableData[]>({
        queryKey: ["/api/tables", restaurantTimezone],
        queryFn: async () => {
            const res = await fetch(`/api/tables?timezone=${encodeURIComponent(restaurantTimezone)}`, { credentials: 'include' });
            if (!res.ok) throw new Error('Failed to fetch tables');
            return res.json();
        },
        enabled: !!restaurant,
        retry: 3,
        staleTime: 60000, // Cache for 1 minute
        gcTime: 300000, // Keep in cache for 5 minutes
    });

    // ✅ FIXED: Optimized schedule data query
    const { data: scheduleData, isLoading, error: scheduleError } = useQuery({
        queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone],
        queryFn: async () => {
            if (!selectedDate || timeSlots.length === 0) {
                throw new Error('Missing date or time slots');
            }

            const isOvernight = restaurant?.openingTime && restaurant?.closingTime &&
                (parseInt(restaurant.closingTime.split(':')[0]) < parseInt(restaurant.openingTime.split(':')[0]));

            const promises = timeSlots.map(async (time) => {
                const url = `/api/tables/availability?date=${selectedDate}&time=${time}&timezone=${encodeURIComponent(restaurantTimezone)}`;

                try {
                    const response = await fetch(url, {
                        credentials: 'include',
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json'
                        }
                    });

                    if (!response.ok) {
                        throw new Error(`Failed to fetch availability for ${time}: ${response.status}`);
                    }

                    const data = await response.json();
                    const sortedTables = Array.isArray(data) ? data.sort((a: any, b: any) => a.id - b.id) : [];
                    return { time, tables: sortedTables };

                } catch (error) {
                    if (isOvernight) {
                        return { time, tables: [] };
                    }
                    throw error;
                }
            });

            const results = await Promise.allSettled(promises);

            const successfulResults = results
                .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
                .map(result => result.value);

            const failedResults = results.filter(result => result.status === 'rejected');

            if (failedResults.length > 0 && failedResults.length === timeSlots.length) {
                throw new Error('All time slots failed to load');
            }

            return successfulResults;
        },
        enabled: !!restaurant && !!selectedDate && timeSlots.length > 0,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        staleTime: 30000, // Cache for 30 seconds
        gcTime: 120000, // Keep in cache for 2 minutes
        retry: (failureCount, error) => {
            const isOvernight = restaurant?.openingTime && restaurant?.closingTime &&
                (parseInt(restaurant.closingTime.split(':')[0]) < parseInt(restaurant.openingTime.split(':')[0]));

            if (isOvernight) {
                return failureCount < 1;
            }
            return failureCount < 2;
        },
    });

    // ✅ FIXED: Memoized drag end handler to prevent re-renders
    const handleDragEnd = useCallback((event: any) => {
        const { active, over } = event;

        if (!over || active.id === over.id) {
            return;
        }

        const reservationId = active.id as number;
        const { tableId: newTableId, time: newTime } = over.data.current as { tableId: number, time: string };

        const draggedGuestCount = active.data.current?.guestCount;
        const targetTable = over.data.current?.table;

        if (draggedGuestCount && targetTable && (draggedGuestCount < targetTable.minGuests || draggedGuestCount > targetTable.maxGuests)) {
            toast({
                title: "Move Failed",
                description: `Table ${targetTable.name} cannot accommodate ${draggedGuestCount} guests.`,
                variant: "destructive",
            });
            return;
        }

        moveReservationMutation.mutate({
            reservationId,
            newTableId,
            newTime,
        });
    }, [toast]);

    // Function to prepare and open the modal for editing
    const handleOpenEditModal = useCallback((table: TableData) => {
        setEditingTable(table);
        setTableForm({
            name: table.name,
            minGuests: table.minGuests,
            maxGuests: table.maxGuests,
            features: table.features.filter(f => f.toLowerCase() !== 'non-combinable').join(', '),
            isNonCombinable: table.features.some(f => f.toLowerCase() === 'non-combinable'),
            comments: table.comments || "",
            floorId: table.floorId,
            shape: table.shape,
        });
        setShowTableModal(true);
    }, []);

    // Function to open the modal for adding a new table
    const handleOpenAddModal = useCallback(() => {
        setEditingTable(null);
        setTableForm({
            name: "",
            minGuests: 1,
            maxGuests: 4,
            features: "",
            isNonCombinable: false,
            comments: "",
            floorId: floors && floors.length > 0 ? floors[0].id : null,
            shape: "square",
        });
        setShowTableModal(true);
    }, [floors]);

    const commonMutationOptions = {
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
            queryClient.invalidateQueries({ queryKey: ["/api/tables/availability/schedule"] });
            queryClient.invalidateQueries({ queryKey: ["/api/floors"] });
            queryClient.invalidateQueries({ queryKey: ["/api/restaurants/profile"] });

            setShowTableModal(false);
            setEditingTable(null);
        },
        onError: (error: any) => {
            toast({
                title: "Operation Failed",
                description: error.message || "An unexpected error occurred. Please try again.",
                variant: "destructive",
            });
        }
    };

    // Add/Edit table mutations
    const addTableMutation = useMutation({
        mutationFn: async (tableData: AddTableForm) => {
            const baseFeatures = tableData.features ? tableData.features.split(',').map(f => f.trim()) : [];
            const cleanedFeatures = baseFeatures.filter(f => f.toLowerCase() !== 'non-combinable' && f);
            if (tableData.isNonCombinable) {
                cleanedFeatures.push('non-combinable');
            }

            const payload = {
                ...tableData,
                features: cleanedFeatures,
                posX: 50,
                posY: 50,
            };

            const response = await fetch('/api/tables', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to create table');
            }
            return response.json();
        },
        ...commonMutationOptions,
        onSuccess: (newTable) => {
            toast({
                title: "Table Added Successfully! 🎉",
                description: `Table ${newTable.name} is now available.`,
            });
            commonMutationOptions.onSuccess();
        }
    });

    const editTableMutation = useMutation({
        mutationFn: async (tableData: AddTableForm) => {
            if (!editingTable) throw new Error("No table selected for editing.");

            const baseFeatures = tableData.features ? tableData.features.split(',').map(f => f.trim()) : [];
            const cleanedFeatures = baseFeatures.filter(f => f.toLowerCase() !== 'non-combinable' && f);
            if (tableData.isNonCombinable) {
                cleanedFeatures.push('non-combinable');
            }

            const payload = { ...tableData, features: cleanedFeatures };

            const response = await fetch(`/api/tables/${editingTable.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to update table');
            }
            return response.json();
        },
        ...commonMutationOptions,
        onSuccess: (updatedTable) => {
            toast({
                title: "Table Updated Successfully!",
                description: `Changes to table ${updatedTable.name} have been saved.`,
            });
            commonMutationOptions.onSuccess();
        }
    });

    // Enhanced table deletion with timezone context
    const deleteTableMutation = useMutation({
        mutationFn: async (tableId: number) => {
            const response = await fetch(`/api/tables/${tableId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to delete table');
            }

            return response.json();
        },
        onSuccess: () => {
            toast({
                title: "Table Deleted",
                description: "Table removed successfully",
            });
            queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
            queryClient.invalidateQueries({ queryKey: ["/api/tables/availability/schedule"] });
        },
        onError: (error: any) => {
            toast({
                title: "Failed to Delete Table",
                description: error.message || "Please try again",
                variant: "destructive",
            });
        }
    });

    // Enhanced reservation movement with proper mutation types
    const moveReservationMutation = useMutation<any, Error, {
        reservationId: number;
        newTableId: number;
        newTime: string;
    }, MutationContext>({
        mutationFn: async (variables) => {
            const { reservationId, newTableId, newTime } = variables;
            const response = await fetch(`/api/reservations/${reservationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    tableId: newTableId,
                    time: newTime,
                    date: selectedDate,
                    timezone: restaurantTimezone
                })
            });

            if (!response.ok) throw new Error('Failed to move reservation');
            return response.json();
        },

        onMutate: async (variables) => {
            const { reservationId, newTableId, newTime } = variables;
            await queryClient.cancelQueries({
                queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone]
            });

            const previousData = queryClient.getQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone]);
            const durationInSlots = Math.ceil((restaurant?.avgReservationDuration || 120) / 60);

            queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone], (old: any) => {
                if (!old) return old;

                let currentReservation: any = null;
                let currentTableId: number = 0;
                let currentTime: string = '';

                for (const slot of old) {
                    for (const table of slot.tables) {
                        if (table.reservation?.id === reservationId) {
                            currentReservation = table.reservation;
                            currentTableId = table.id;
                            currentTime = slot.time;
                            break;
                        }
                    }
                    if (currentReservation) break;
                }

                if (!currentReservation) return old;

                const sourceHour = parseInt(currentTime.split(':')[0]);
                const targetHour = parseInt(newTime.split(':')[0]);

                const sourceSlots: string[] = [];
                const targetSlots: string[] = [];

                for (let i = 0; i < durationInSlots; i++) {
                    sourceSlots.push(`${(sourceHour + i).toString().padStart(2, '0')}:00`);
                    targetSlots.push(`${(targetHour + i).toString().padStart(2, '0')}:00`);
                }

                return old.map((slot: any) => ({
                    ...slot,
                    tables: slot.tables.map((table: any) => {
                        if (table.id === currentTableId &&
                            sourceSlots.includes(slot.time) &&
                            table.reservation?.id === reservationId) {
                            return {
                                ...table,
                                reservation: null,
                                status: 'available'
                            };
                        }

                        if (table.id === newTableId && targetSlots.includes(slot.time)) {
                            return {
                                ...table,
                                status: 'reserved',
                                reservation: {
                                    ...currentReservation,
                                    timeSlot: `${slot.time}-${targetSlots[targetSlots.length - 1]}`
                                }
                            };
                        }

                        return table;
                    })
                }));
            });

            return { previousData };
        },

        onSuccess: (data: any, variables) => {
            const { newTableId, newTime } = variables;

            const newTableName = scheduleData?.find(slot => slot.time === newTime)
                ?.tables?.find((t: any) => t.id === newTableId)?.name || `Table ${newTableId}`;

            toast({
                title: "Reservation Updated",
                description: `Reservation moved to ${newTime} (${newTableName})`,
            });

            queryClient.invalidateQueries({
                queryKey: ["/api/reservations", restaurantTimezone]
            });
        },

        onError: (error: any, variables, context) => {
            if (context?.previousData) {
                queryClient.setQueryData(
                    ["/api/tables/availability/schedule", selectedDate, restaurantTimezone],
                    context.previousData
                );
            }

            toast({
                title: "Failed to move reservation",
                description: error.message || "Please try again",
                variant: "destructive",
            });
        }
    });

    // Enhanced reservation cancellation with proper typing
    const cancelReservationMutation = useMutation<any, Error, number, MutationContext>({
        mutationFn: async (reservationId: number) => {
            const response = await fetch(`/api/reservations/${reservationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    status: 'canceled',
                    timezone: restaurantTimezone
                })
            });
            if (!response.ok) throw new Error('Failed to cancel reservation');
            return response.json();
        },

        onMutate: async (reservationId: number) => {
            await queryClient.cancelQueries({ queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone] });

            const previousData = queryClient.getQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone]);

            queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone], (old: any) => {
                if (!old) return old;

                return old.map((slot: any) => ({
                    ...slot,
                    tables: slot.tables.map((table: any) => {
                        if (table.reservation?.id === reservationId) {
                            return {
                                ...table,
                                reservation: null,
                                status: 'available'
                            };
                        }
                        return table;
                    })
                }));
            });

            return { previousData };
        },

        onSuccess: () => {
            setContextMenu(null);
            toast({
                title: "Reservation Cancelled",
                description: "Successfully cancelled reservation.",
            });
        },

        onError: (error, variables, context) => {
            if (context?.previousData) {
                queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone], context.previousData);
            }
            toast({
                title: "Cancellation Failed",
                description: "Could not cancel reservation. Please try again.",
                variant: "destructive",
            });
        },
    });

    // Enhanced quick move with proper typing
    const quickMoveMutation = useMutation<any, Error, { reservationId: number; direction: 'up' | 'down' }, MutationContext>({
        mutationFn: async ({ reservationId, direction }) => {
            const currentSlot = scheduleData?.find(slot =>
                slot.tables.some((t: any) => t.reservation?.id === reservationId)
            );
            const currentTable = currentSlot?.tables.find((t: any) => t.reservation?.id === reservationId);

            if (!currentSlot || !currentTable) throw new Error('Reservation not found');

            const currentHour = parseInt(currentSlot.time.split(':')[0]);
            const newHour = direction === 'up' ? currentHour - 1 : currentHour + 1;

            const isOvernight = restaurant?.openingTime && restaurant?.closingTime &&
                (parseInt(restaurant.closingTime.split(':')[0]) < parseInt(restaurant.openingTime.split(':')[0]));

            if (isOvernight) {
                const openingHour = parseInt(restaurant.openingTime.split(':')[0]);
                const closingHour = parseInt(restaurant.closingTime.split(':')[0]);

                if (direction === 'up' && newHour < 0) {
                    throw new Error('Cannot move before midnight');
                }
                if (direction === 'down' && newHour >= 24) {
                    throw new Error('Cannot move past 24:00');
                }

                const isValidHour = (newHour >= openingHour || newHour < closingHour);
                if (!isValidHour) {
                    throw new Error(`Cannot move outside operating hours (${restaurant.openingTime} - ${restaurant.closingTime})`);
                }
            } else {
                const openingHour = parseInt(restaurant?.openingTime?.split(':')[0] || '10');
                const closingHour = parseInt(restaurant?.closingTime?.split(':')[0] || '22');

                if (newHour < openingHour || newHour > closingHour - 2) {
                    throw new Error(`Cannot move outside business hours (${openingHour}:00 - ${closingHour - 2}:00)`);
                }
            }

            const newTime = `${newHour.toString().padStart(2, '0')}:00`;

            const targetSlots = [
                newTime,
                `${(newHour + 1).toString().padStart(2, '0')}:00`
            ];

            for (const targetTime of targetSlots) {
                const targetSlot = scheduleData?.find(s => s.time === targetTime);
                const targetTable = targetSlot?.tables?.find((t: any) => t.id === currentTable.id);

                if (targetTable?.reservation && targetTable.reservation.id !== reservationId) {
                    throw new Error(`Cannot move: ${targetTable.reservation.guestName} already has ${targetTime} reserved`);
                }
            }

            const response = await fetch(`/api/reservations/${reservationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    tableId: currentTable.id,
                    time: newTime,
                    date: selectedDate,
                    timezone: restaurantTimezone
                }),
            });
            if (!response.ok) throw new Error('Failed to move reservation');
            return { response: response.json(), newTime, currentTable };
        },

        onMutate: async ({ reservationId, direction }) => {
            await queryClient.cancelQueries({ queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone] });

            const previousData = queryClient.getQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone]);

            const currentSlot = scheduleData?.find(slot =>
                slot.tables.some((t: any) => t.reservation?.id === reservationId)
            );
            const currentTable = currentSlot?.tables.find((t: any) => t.reservation?.id === reservationId);

            if (!currentSlot || !currentTable || !currentTable.reservation) return { previousData };

            const currentHour = parseInt(currentSlot.time.split(':')[0]);
            const targetHour = direction === 'up' ? currentHour - 1 : currentHour + 1;
            const targetTime = `${targetHour.toString().padStart(2, '0')}:00`;

            const durationInSlots = Math.ceil((restaurant?.avgReservationDuration || 120) / 60);

            queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone], (old: any) => {
                if (!old) return old;

                const sourceSlots: string[] = [];
                const targetSlots: string[] = [];

                for (let i = 0; i < durationInSlots; i++) {
                    sourceSlots.push(`${(currentHour + i).toString().padStart(2, '0')}:00`);
                    targetSlots.push(`${(targetHour + i).toString().padStart(2, '0')}:00`);
                }

                return old.map((slot: any) => ({
                    ...slot,
                    tables: slot.tables.map((table: any) => {
                        if (table.id === currentTable.id &&
                            sourceSlots.includes(slot.time) &&
                            table.reservation?.id === reservationId) {
                            return {
                                ...table,
                                reservation: null,
                                status: 'available'
                            };
                        }

                        if (table.id === currentTable.id && targetSlots.includes(slot.time)) {
                            return {
                                ...table,
                                status: 'reserved',
                                reservation: {
                                    ...currentTable.reservation,
                                    timeSlot: `${targetSlots[0]}-${targetSlots[targetSlots.length - 1]}`
                                }
                            };
                        }

                        return table;
                    })
                }));
            });

            return { previousData };
        },

        onSuccess: (data, { direction }) => {
            setContextMenu(null);
            toast({
                title: "Reservation Moved",
                description: `Moved reservation ${direction === 'up' ? 'earlier' : 'later'} by 1 hour.`,
            });
        },

        onError: (error, variables, context) => {
            if (context?.previousData) {
                queryClient.setQueryData(["/api/tables/availability/schedule", selectedDate, restaurantTimezone], context.previousData);
            }
            toast({
                title: "Move Failed",
                description: error.message || "Could not move reservation. Check for conflicts.",
                variant: "destructive",
            });
        },
    });

    // ✅ FIXED: Optimized status style function
    const getStatusStyle = useCallback((status: string, hasReservation: boolean | undefined, isDragTarget = false) => {
        if (isDragTarget) {
            return "bg-gradient-to-br from-green-400 to-green-500 text-white shadow-lg shadow-green-400/50 ring-2 ring-green-300 scale-105";
        }

        if (hasReservation) {
            return "bg-gradient-to-br from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25 cursor-grab active:cursor-grabbing";
        }

        switch (status) {
            case 'available':
                return "bg-gradient-to-br from-green-500 to-green-600 text-white shadow-lg shadow-green-500/25 hover:shadow-green-500/40 transition-all duration-200";
            case 'occupied':
                return "bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/25";
            case 'reserved':
                return "bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/25";
            case 'unavailable':
                return "bg-gradient-to-br from-gray-400 to-gray-500 text-white shadow-lg shadow-gray-500/25";
            default:
                return "bg-gradient-to-br from-gray-300 to-gray-400 text-gray-800 shadow-lg shadow-gray-400/25";
        }
    }, []);

    // Enhanced form submission to handle both Add and Edit
    const handleTableFormSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();

        if (!tableForm.name.trim() || !tableForm.floorId) {
            toast({ title: "Missing Information", description: "Please enter a table name and select a floor.", variant: "destructive" });
            return;
        }

        if (tableForm.minGuests < 1 || tableForm.maxGuests < tableForm.minGuests) {
            toast({
                title: "Invalid Capacity",
                description: "Please ensure max guests is greater than or equal to min guests",
                variant: "destructive",
            });
            return;
        }

        if (tableForm.maxGuests > 50) {
            toast({
                title: "Capacity Too Large",
                description: "Maximum table capacity is 50 guests",
                variant: "destructive",
            });
            return;
        }

        if (editingTable) {
            editTableMutation.mutate(tableForm);
        } else {
            addTableMutation.mutate(tableForm);
        }
    }, [tableForm, editingTable, editTableMutation, addTableMutation, toast]);

    // Enhanced date formatting with timezone
    const formatCurrentDate = useCallback(() => {
        try {
            if (!restaurantTimezone || !selectedDate) {
                return new Date().toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            }

            const restaurantDateTime = DateTime.fromISO(selectedDate, { zone: restaurantTimezone });
            return restaurantDateTime.toFormat('EEEE, MMMM d, yyyy');
        } catch (error) {
            console.error('Error formatting date:', error);
            return new Date(selectedDate).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        }
    }, [restaurantTimezone, selectedDate]);

    const getTodayDateStr = useCallback(() => {
        return getRestaurantDateString(restaurantTimezone);
    }, [restaurantTimezone]);

    const getTomorrowDateStr = useCallback(() => {
        return getTomorrowDateString(restaurantTimezone);
    }, [restaurantTimezone]);

    // ✅ FIXED: Stable header tables calculation
    const headerTables = useMemo(() => {
        if (!scheduleData || !Array.isArray(scheduleData) || scheduleData.length === 0) return [];
        const firstSlotWithTables = scheduleData.find(slot => slot && slot.tables && slot.tables.length > 0);
        return firstSlotWithTables ? firstSlotWithTables.tables : [];
    }, [scheduleData]);

    // Loading states
    if (restaurantLoading) {
        return (
            <DashboardLayout>
                <div className="container mx-auto px-4 py-8">
                    <div className="flex items-center justify-center h-64">
                        <div className="flex items-center gap-3">
                            <RefreshCw className="h-6 w-6 animate-spin text-blue-600" />
                            <span className="text-lg text-gray-600">Loading restaurant profile...</span>
                        </div>
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    if (restaurantError || !restaurant) {
        return (
            <DashboardLayout>
                <div className="container mx-auto px-4 py-8">
                    <div className="text-center py-12">
                        <h2 className="text-xl font-semibold text-red-600 mb-4">Unable to Load Restaurant</h2>
                        <p className="text-gray-600 mb-4">
                            {restaurantError ? (restaurantError as any).message : 'Restaurant profile not found'}
                        </p>
                        <Button onClick={() => window.location.reload()}>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Reload Page
                        </Button>
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    const isOvernightOperation = restaurant?.openingTime && restaurant?.closingTime &&
        (parseInt(restaurant.closingTime.split(':')[0]) < parseInt(restaurant.openingTime.split(':')[0]));

    return (
        <DashboardLayout>
            <div className="container mx-auto px-4 py-8 space-y-8">
                {/* Date Selection Panel */}
                <Card className="border border-gray-200/50 dark:border-gray-700/50">
                    <CardHeader className="pb-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Calendar className="h-5 w-5 text-blue-600" />
                                <CardTitle className="text-lg">Table Management</CardTitle>
                                <Badge variant="outline" className="text-xs">
                                    {restaurantTimezone}
                                </Badge>
                                {isOvernightOperation && (
                                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700">
                                        <Clock className="h-3 w-3 mr-1" />
                                        24-Hour Operation
                                    </Badge>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                {/* ✅ FIXED: Simple connection status display */}
                                <Badge variant={isConnected ? "outline" : "destructive"} className={isConnected ? "border-green-500 text-green-700 bg-green-50" : ""}>
                                    ● {isConnected ? "Connected" : "Disconnected"}
                                </Badge>
                                <Button
                                    onClick={handleOpenAddModal}
                                    className="bg-green-600 hover:bg-green-700 text-white"
                                    size="sm"
                                >
                                    <Plus className="h-4 w-4 mr-1" />
                                    Add Table
                                </Button>

                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSelectedDate(getTodayDateStr())}
                                    className="text-xs"
                                    disabled={!restaurantTimezone}
                                >
                                    Today
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSelectedDate(getTomorrowDateStr())}
                                    className="text-xs"
                                    disabled={!restaurantTimezone}
                                >
                                    Tomorrow
                                </Button>
                                <input
                                    type="date"
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                    className="px-3 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
                                />
                            </div>
                        </div>
                    </CardHeader>
                </Card>

                {/* Table Statistics - memoized */}
                {useMemo(() => {
                    if (tablesLoading) {
                        return (
                            <Card className="bg-blue-50 border-blue-200">
                                <CardContent className="pt-4">
                                    <div className="flex items-center justify-center h-16">
                                        <RefreshCw className="h-5 w-5 animate-spin text-blue-600 mr-2" />
                                        <span className="text-blue-700">Loading tables...</span>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    }
                    
                    if (tables && Array.isArray(tables) && tables.length > 0) {
                        return (
                            <Card className="bg-blue-50 border-blue-200">
                                <CardContent className="pt-4">
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                        <div className="text-center">
                                            <div className="text-2xl font-bold text-blue-600">{tables.length}</div>
                                            <div className="text-blue-700">Total Tables</div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-2xl font-bold text-blue-600">
                                                {tables.reduce((sum: number, table: any) => sum + table.maxGuests, 0)}
                                            </div>
                                            <div className="text-blue-700">Total Capacity</div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-2xl font-bold text-blue-600">
                                                {Math.round(tables.reduce((sum: number, table: any) => sum + table.maxGuests, 0) / tables.length)}
                                            </div>
                                            <div className="text-blue-700">Avg Table Size</div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-2xl font-bold text-blue-600">
                                                {Math.max(...tables.map((t: any) => t.maxGuests))}
                                            </div>
                                            <div className="text-blue-700">Largest Table</div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    }
                    
                    return (
                        <Card className="bg-yellow-50 border-yellow-200">
                            <CardContent className="pt-4">
                                <div className="text-center py-8">
                                    <Users className="h-12 w-12 text-yellow-600 mx-auto mb-4" />
                                    <h3 className="text-lg font-semibold text-yellow-800 mb-2">No Tables Found</h3>
                                    <p className="text-yellow-700 mb-4">
                                        Add tables to start managing reservations and table availability.
                                    </p>
                                    <Button
                                        onClick={handleOpenAddModal}
                                        className="bg-green-600 hover:bg-green-700 text-white"
                                    >
                                        <Plus className="h-4 w-4 mr-2" />
                                        Add Your First Table
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    );
                }, [tablesLoading, tables, handleOpenAddModal])}

                {/* Main content area */}
                <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 rounded-3xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
                    <div className="p-6 border-b border-gray-200/50 dark:border-gray-700/50">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                                    Restaurant Management - {formatCurrentDate()}
                                </h3>
                                <p className="text-gray-500 dark:text-gray-400 mt-1">
                                    Real-time availability across all tables • Live updates via WebSocket
                                    <span className="ml-2 text-blue-600">
                                        • {restaurantTimezone}
                                    </span>
                                    {isOvernightOperation && (
                                        <span className="ml-2 text-purple-600">
                                            • 24-Hour Operation ({restaurant.openingTime}-{restaurant.closingTime})
                                        </span>
                                    )}
                                </p>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center bg-white dark:bg-gray-800 rounded-xl p-1 shadow-lg border border-gray-200/50 dark:border-gray-700/50">
                                    {[
                                        { id: 'schedule', label: 'Schedule', icon: Clock },
                                        { id: 'floorplan', label: 'Floor Plan', icon: Settings },
                                        { id: 'grid', label: 'Grid', icon: MousePointer2 },
                                        { id: 'list', label: 'List', icon: Edit2 }
                                    ].map(({ id, label, icon: Icon }) => (
                                        <button
                                            key={id}
                                            onClick={(e) => {
                                                try {
                                                    e.preventDefault();
                                                    setActiveView(id as any);
                                                } catch (error) {
                                                    console.error(`[ModernTables] Error switching to view ${id}:`, error);
                                                }
                                            }}
                                            className={`
                        flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                        ${activeView === id
                                                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25'
                                                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-700'
                                                }
                      `}
                                        >
                                            <Icon className="h-4 w-4" />
                                            {label}
                                        </button>
                                    ))}
                                </div>

                                {(isLoading || tablesLoading || !dndLoaded) && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                        Loading{!dndLoaded ? ' components' : ''}...
                                    </div>
                                )}

                                {activeView === 'schedule' && (
                                    <Badge variant="outline" className="text-xs">
                                        {isOvernightOperation ? `${timeSlots.length} overnight slots` : 'Hourly slots'}
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="p-6">
                        {activeView === 'schedule' && (
                            <>
                                {scheduleError ? (
                                    <div className="text-center py-12">
                                        <p className="text-red-600 mb-4">
                                            Failed to load schedule: {(scheduleError as any).message}
                                        </p>
                                        {isOvernightOperation && (
                                            <p className="text-orange-600 mb-4 text-sm">
                                                Note: 24-hour operations may require additional setup time
                                            </p>
                                        )}
                                        <Button onClick={() => queryClient.refetchQueries({
                                            queryKey: ["/api/tables/availability/schedule", selectedDate, restaurantTimezone]
                                        })}>
                                            <RefreshCw className="h-4 w-4 mr-2" />
                                            Retry
                                        </Button>
                                    </div>
                                ) : isLoading ? (
                                    <div className="text-center py-12">
                                        <RefreshCw className="h-6 w-6 animate-spin text-blue-600 mx-auto mb-4" />
                                        <p className="text-gray-600">
                                            Loading {isOvernightOperation ? '24-hour' : 'schedule'} data...
                                        </p>
                                        {isOvernightOperation && (
                                            <p className="text-sm text-blue-600 mt-2">
                                                Processing {timeSlots.length} overnight time slots
                                            </p>
                                        )}
                                    </div>
                                ) : scheduleData && scheduleData.length > 0 && headerTables.length > 0 && dndLoaded ? (
                                    <StableDndContext onDragEnd={handleDragEnd}>
                                        <div className="overflow-x-auto">
                                            <div className="min-w-[800px]">
                                                <div className="sticky top-0 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-750 border-b border-gray-200/50 dark:border-gray-700/50 px-4 py-2 z-10 rounded-lg mb-4">
                                                    <div className="flex">
                                                        <div className="w-20 flex-shrink-0 font-semibold text-gray-700 dark:text-gray-300 text-xs py-2">
                                                            TIME
                                                            {isOvernightOperation && (
                                                                <div className="text-xs text-blue-600 mt-1">24h</div>
                                                            )}
                                                        </div>
                                                        <div className="flex overflow-x-auto gap-1 flex-1">
                                                            {headerTables.map((table: TableData) => (
                                                                <div key={table.id} className="w-24 flex-shrink-0 text-center bg-white/50 dark:bg-gray-700/50 rounded-lg p-1.5 border border-gray-200/50 dark:border-gray-600/50 relative group">
                                                                    <div className="font-medium text-xs text-gray-900 dark:text-gray-100">{table.name}</div>
                                                                    {table.floor?.name && (
                                                                        <div className="text-[10px] text-blue-600 dark:text-blue-400 truncate" title={table.floor.name}>
                                                                            {table.floor.name}
                                                                        </div>
                                                                    )}
                                                                    <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1">
                                                                        <Users className="h-3 w-3" />
                                                                        {table.minGuests}-{table.maxGuests}
                                                                    </div>
                                                                    <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                        <DropdownMenu>
                                                                            <DropdownMenuTrigger asChild>
                                                                                <Button variant="secondary" size="sm" className="h-6 w-6 p-0">
                                                                                    <MoreHorizontal className="h-4 w-4" />
                                                                                </Button>
                                                                            </DropdownMenuTrigger>
                                                                            <DropdownMenuContent align="end">
                                                                                <DropdownMenuItem onClick={() => handleOpenEditModal(table)}>
                                                                                    <Edit2 className="mr-2 h-4 w-4" />
                                                                                    <span>Edit</span>
                                                                                </DropdownMenuItem>
                                                                                <DropdownMenuSeparator />
                                                                                <DropdownMenuItem
                                                                                    className="text-red-600 focus:text-red-600 focus:bg-red-50"
                                                                                    onClick={() => {
                                                                                        if (confirm(`Delete table "${table.name}"? This cannot be undone.`)) {
                                                                                            deleteTableMutation.mutate(table.id);
                                                                                        }
                                                                                    }}
                                                                                >
                                                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                                                    <span>Delete</span>
                                                                                </DropdownMenuItem>
                                                                            </DropdownMenuContent>
                                                                        </DropdownMenu>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="space-y-1">
                                                    {scheduleData?.map((slot: ScheduleSlot) => {
                                                        const hour = parseInt(slot.time.split(':')[0]);
                                                        const isEarlyMorning = isOvernightOperation && hour < 6;
                                                        const isLateNight = isOvernightOperation && hour >= 22;

                                                        return (
                                                            <div
                                                                key={slot.time}
                                                                className={cn(
                                                                    "flex hover:bg-gray-50/50 dark:hover:bg-gray-800/50 rounded-lg transition-colors duration-200",
                                                                    isEarlyMorning && "bg-blue-50/30",
                                                                    isLateNight && "bg-purple-50/30"
                                                                )}
                                                            >
                                                                <div className={cn(
                                                                    "w-20 flex-shrink-0 px-4 py-3 text-sm font-medium border-r border-gray-200/50 dark:border-gray-700/50",
                                                                    isEarlyMorning && "text-blue-700 dark:text-blue-300",
                                                                    isLateNight && "text-purple-700 dark:text-purple-300",
                                                                    !isEarlyMorning && !isLateNight && "text-gray-700 dark:text-gray-300"
                                                                )}>
                                                                    {slot.time}
                                                                    {isOvernightOperation && (
                                                                        <div className="text-xs opacity-60">
                                                                            {isEarlyMorning ? "Early" : isLateNight ? "Night" : "Day"}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="flex overflow-x-auto gap-1 flex-1 px-2 py-1">
                                                                    {slot.tables?.map((table: TableData) => {
                                                                        const hasReservation = table.reservation && table.reservation.status === 'confirmed';
                                                                        const uniqueSlotId = `${table.id}-${slot.time}`;

                                                                        return (
                                                                            <div
                                                                                key={table.id}
                                                                                className={cn(
                                                                                    "w-24 flex-shrink-0 rounded-lg p-2 text-center transition-all duration-200",
                                                                                    getStatusStyle(table.status, hasReservation),
                                                                                    !hasReservation && "hover:scale-105"
                                                                                )}
                                                                                onContextMenu={(e) => {
                                                                                    e.preventDefault();
                                                                                    setContextMenu({
                                                                                        x: e.clientX,
                                                                                        y: e.clientY,
                                                                                        reservationId: hasReservation ? table.reservation?.id : undefined,
                                                                                        tableId: table.id,
                                                                                        timeSlot: slot.time,
                                                                                        guestName: hasReservation ? table.reservation?.guestName : undefined,
                                                                                    });
                                                                                }}
                                                                            >
                                                                                {hasReservation && table.reservation ? (
                                                                                    <StableDraggableReservation
                                                                                        id={table.reservation.id}
                                                                                        data={{
                                                                                            guestName: table.reservation.guestName,
                                                                                            guestCount: table.reservation.guestCount,
                                                                                        }}
                                                                                    >
                                                                                        <div className="text-xs font-bold opacity-90 flex items-center justify-center gap-1 cursor-grab active:cursor-grabbing">
                                                                                            <Move className="h-3 w-3" />
                                                                                            {table.name}
                                                                                        </div>
                                                                                        <div className="text-xs opacity-75 mt-1 truncate">
                                                                                            {table.reservation.guestName}
                                                                                        </div>
                                                                                        <div className="text-xs opacity-60 mt-1">
                                                                                            {`${table.reservation.guestCount} guests`}
                                                                                        </div>
                                                                                    </StableDraggableReservation>
                                                                                ) : (
                                                                                    <StableDroppableSlot
                                                                                        id={uniqueSlotId}
                                                                                        data={{ tableId: table.id, time: slot.time, table: table }}
                                                                                    >
                                                                                        <div className="h-full flex flex-col justify-center">
                                                                                            <div className="text-xs font-bold opacity-90">{table.name}</div>
                                                                                            <div className="text-xs opacity-60 mt-1">{table.status}</div>
                                                                                        </div>
                                                                                    </StableDroppableSlot>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    </StableDndContext>
                                ) : (
                                    <div className="text-center py-12">
                                        <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                        <h3 className="text-lg font-semibold text-gray-600 mb-2">
                                            {!dndLoaded ? "Loading Components..." : "No Tables Available"}
                                        </h3>
                                        <p className="text-gray-500 mb-4">
                                            {!dndLoaded 
                                                ? "Please wait while we load the drag & drop functionality..." 
                                                : "Add tables to start managing reservations and viewing table availability."
                                            }
                                        </p>
                                        {dndLoaded && (
                                            <Button
                                                onClick={handleOpenAddModal}
                                                className="bg-green-600 hover:bg-green-700 text-white"
                                            >
                                                <Plus className="h-4 w-4 mr-2" />
                                                Add Your First Table
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </>
                        )}

                        {/* Floor plan view */}
                        {activeView === 'floorplan' && (
                            <ErrorBoundary fallback={<FloorPlanViewFallback floors={floors || []} isLoading={floorsLoading} isManageFloorsOpen={isManageFloorsOpen} setIsManageFloorsOpen={setIsManageFloorsOpen} />}>
                                <Suspense fallback={
                                    <div className="flex items-center justify-center h-64">
                                        <RefreshCw className="h-6 w-6 animate-spin text-blue-600 mr-2" />
                                        <span>Loading Floor Plan...</span>
                                    </div>
                                }>
                                    <FloorPlanView
                                        floors={floors || []}
                                        isLoading={floorsLoading}
                                        isManageFloorsOpen={isManageFloorsOpen}
                                        setIsManageFloorsOpen={setIsManageFloorsOpen}
                                    />
                                </Suspense>
                            </ErrorBoundary>
                        )}

                        {activeView !== 'schedule' && activeView !== 'floorplan' && (
                            <div className="text-center py-12">
                                <p className="text-gray-500 dark:text-gray-400">
                                    {activeView} view coming soon...
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Add/Edit Table Modal */}
            <Dialog open={showTableModal} onOpenChange={setShowTableModal}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingTable ? 'Edit Table' : 'Add New Table'}</DialogTitle>
                        <DialogDescription>
                            {editingTable ? `Update the details for table "${editingTable.name}".` : 'Create a new table for your restaurant.'}
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleTableFormSubmit} className="space-y-4 pt-4">
                        <div>
                            <Label htmlFor="tableName">Table Name *</Label>
                            <Input id="tableName" value={tableForm.name} onChange={(e) => setTableForm(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g. T1, Patio A" required />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="floor">Floor / Зал *</Label>
                                <Select
                                    value={tableForm.floorId ? String(tableForm.floorId) : ""}
                                    onValueChange={(value) => setTableForm(prev => ({ ...prev, floorId: Number(value) }))}
                                    required
                                >
                                    <SelectTrigger id="floor">
                                        <SelectValue placeholder="Select a floor" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {floorsLoading ? (
                                            <SelectItem value="loading" disabled>Loading floors...</SelectItem>
                                        ) : (
                                            floors?.map(floor => (
                                                <SelectItem key={floor.id} value={String(floor.id)}>
                                                    {floor.name}
                                                </SelectItem>
                                            ))
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label htmlFor="shape">Shape</Label>
                                <Select
                                    value={tableForm.shape}
                                    onValueChange={(value: 'square' | 'round') => setTableForm(prev => ({ ...prev, shape: value }))}
                                >
                                    <SelectTrigger id="shape">
                                        <SelectValue placeholder="Select a shape" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="square">Square</SelectItem>
                                        <SelectItem value="round">Round</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="minGuests">Min Guests *</Label>
                                <Input id="minGuests" type="number" min="1" value={tableForm.minGuests} onChange={(e) => setTableForm(prev => ({ ...prev, minGuests: parseInt(e.target.value) || 1 }))} required />
                            </div>
                            <div>
                                <Label htmlFor="maxGuests">Max Guests *</Label>
                                <Input id="maxGuests" type="number" min="1" value={tableForm.maxGuests} onChange={(e) => setTableForm(prev => ({ ...prev, maxGuests: parseInt(e.target.value) || 4 }))} required />
                            </div>
                        </div>

                        <div>
                            <Label htmlFor="features">Features (Optional, comma-separated)</Label>
                            <Input id="features" value={tableForm.features} onChange={(e) => setTableForm(prev => ({ ...prev, features: e.target.value }))} placeholder="e.g. Window view, Outdoor" />
                        </div>
                        <div className="flex items-center space-x-2 pt-2">
                            <Checkbox id="isNonCombinable" checked={tableForm.isNonCombinable} onCheckedChange={(checked) => setTableForm(prev => ({ ...prev, isNonCombinable: !!checked }))} />
                            <Label htmlFor="isNonCombinable">Exclude from automatic combinations</Label>
                        </div>
                        <div>
                            <Label htmlFor="comments">Comments (Optional)</Label>
                            <Textarea id="comments" value={tableForm.comments} onChange={(e) => setTableForm(prev => ({ ...prev, comments: e.target.value }))} placeholder="Any additional notes" rows={2} />
                        </div>

                        <DialogFooter className="pt-4">
                            <Button type="button" variant="outline" onClick={() => setShowTableModal(false)} disabled={addTableMutation.isPending || editTableMutation.isPending}>Cancel</Button>
                            <Button type="submit" disabled={addTableMutation.isPending || editTableMutation.isPending} className="bg-green-600 hover:bg-green-700 text-white">
                                {(addTableMutation.isPending || editTableMutation.isPending) ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                                {editingTable ? 'Save Changes' : 'Add Table'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Context Menu */}
            {contextMenu && (
                <>
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setContextMenu(null)}
                    />
                    <div
                        className="fixed z-50 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[180px]"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                    >
                        {contextMenu.reservationId ? (
                            <>
                                <div className="px-3 py-2 text-sm font-medium text-gray-900 border-b">
                                    {contextMenu.guestName || 'Reservation'}
                                </div>
                                <button
                                    className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2"
                                    onClick={() => quickMoveMutation.mutate({ reservationId: contextMenu.reservationId!, direction: 'up' })}
                                >
                                    <ArrowUp className="w-4 h-4" />
                                    Move 1 Hour Earlier
                                </button>
                                <button
                                    className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2"
                                    onClick={() => quickMoveMutation.mutate({ reservationId: contextMenu.reservationId!, direction: 'down' })}
                                >
                                    <ArrowDown className="w-4 h-4" />
                                    Move 1 Hour Later
                                </button>
                                <button
                                    className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2"
                                    onClick={() => {
                                        setContextMenu(null);
                                        toast({ title: "Edit Feature", description: "Edit reservation feature coming soon!" });
                                    }}
                                >
                                    <Edit2 className="w-4 h-4" />
                                    Edit Details
                                </button>
                                <div className="border-t my-1" />
                                <button
                                    className="w-full px-3 py-2 text-sm text-left hover:bg-red-50 text-red-600 flex items-center gap-2"
                                    onClick={() => cancelReservationMutation.mutate(contextMenu.reservationId!)}
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Cancel Reservation
                                </button>
                            </>
                        ) : (
                            <>
                                <div className="px-3 py-2 text-sm font-medium text-gray-900 border-b">
                                    Available Slot
                                </div>
                                <button
                                    className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2"
                                    onClick={() => {
                                        setContextMenu(null);
                                        toast({ title: "Create Feature", description: "Create new reservation feature coming soon!" });
                                    }}
                                >
                                    <UserPlus className="w-4 h-4" />
                                    Create New Reservation
                                </button>
                            </>
                        )}
                    </div>
                </>
            )}
        </DashboardLayout>
    );
}