import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Plus, Trash2, Settings, Move, Users } from 'lucide-react';

// ✅ FIXED: WebSocket-safe DnD component loader with longer delays
const useDndForFloorPlan = () => {
    const [dndState, setDndState] = useState({
        isReady: false,
        isLoading: true,
        components: {
            DndContext: ({ children, onDragEnd }: any) => {
                return <div className="relative">{children}</div>;
            },
            DraggableTable: ({ children, table }: any) => {
                return (
                    <div 
                        className="cursor-move bg-blue-500 text-white p-2 rounded shadow-lg select-none"
                        title={`${table?.name || 'Table'} - ${table?.minGuests}-${table?.maxGuests} guests`}
                    >
                        {children}
                    </div>
                );
            }
        }
    });

    useEffect(() => {
        let mounted = true;
        let timeoutId: NodeJS.Timeout;

        const loadDndComponents = async () => {
            try {
                // ✅ FIXED: Much longer delay to prevent WebSocket conflicts (same as modern-tables)
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                if (!mounted) return;

                console.log('[FloorPlanView] Loading DnD components...');

                const [dndModule, draggableModule] = await Promise.all([
                    import('@dnd-kit/core').catch(() => {
                        console.log('[FloorPlanView] @dnd-kit/core not available, using fallback');
                        return null;
                    }),
                    import('@/components/floorplan/DraggableTable').catch(() => {
                        console.log('[FloorPlanView] DraggableTable component not available, using fallback');
                        return null;
                    })
                ]);
                
                if (!mounted) return;

                console.log('[FloorPlanView] DnD components loaded successfully');

                setDndState({
                    isReady: !!dndModule,
                    isLoading: false,
                    components: {
                        DndContext: dndModule?.DndContext || dndState.components.DndContext,
                        DraggableTable: draggableModule?.DraggableTable || dndState.components.DraggableTable,
                    }
                });
            } catch (error) {
                console.log('[FloorPlanView] Error loading DnD components, using fallbacks:', error);
                if (mounted) {
                    setDndState(prev => ({
                        ...prev,
                        isLoading: false,
                        isReady: false
                    }));
                }
            }
        };

        // ✅ FIXED: Longer delay to match modern-tables timing
        timeoutId = setTimeout(loadDndComponents, 4000); // Even longer for FloorPlan
        
        return () => {
            mounted = false;
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, []);

    return dndState;
};

// ✅ FIXED: Enhanced table component with better fallback drag
const TableComponent = React.memo(({ table, isDndReady, onTableUpdate }: {
    table: TableData;
    isDndReady: boolean;
    onTableUpdate?: (table: TableData) => void;
}) => {
    const [isHovered, setIsHovered] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    // ✅ FIXED: Improved fallback drag handling
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (isDndReady) return; // Let DnD handle it
        
        e.preventDefault();
        setIsDragging(true);
        
        const startX = e.clientX;
        const startY = e.clientY;
        const startPosX = table.posX;
        const startPosY = table.posY;

        const handleMouseMove = (e: MouseEvent) => {
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            const newX = Math.max(0, Math.min(800, startPosX + deltaX));
            const newY = Math.max(0, Math.min(600, startPosY + deltaY));
            
            // Update position immediately for smooth dragging
            if (onTableUpdate) {
                onTableUpdate({ ...table, posX: newX, posY: newY });
            }
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            setIsDragging(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [isDndReady, table, onTableUpdate]);

    const tableContent = (
        <div 
            className={`
                relative bg-white dark:bg-gray-800 border-2 rounded-lg shadow-lg p-3 min-w-[80px] min-h-[80px]
                transition-all duration-200 select-none
                ${table.shape === 'round' ? 'rounded-full' : 'rounded-lg'}
                ${isHovered || isDragging ? 'shadow-xl scale-105 border-blue-400' : 'border-gray-300 dark:border-gray-600'}
                ${!isDndReady ? 'cursor-move' : 'cursor-grab active:cursor-grabbing'}
                ${table.reservation ? 'border-red-400 bg-red-50 dark:bg-red-900/20' : 'border-green-400 bg-green-50 dark:bg-green-900/20'}
                ${isDragging ? 'z-50' : 'z-10'}
            `}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onMouseDown={handleMouseDown}
            title={`${table.name} - ${table.minGuests}-${table.maxGuests} guests${table.reservation ? ` - Reserved by ${table.reservation.guestName}` : ''}`}
        >
            {/* Table Info */}
            <div className="text-center">
                <div className="font-bold text-sm text-gray-900 dark:text-gray-100 mb-1">
                    {table.name}
                </div>
                <div className="flex items-center justify-center gap-1 text-xs text-gray-600 dark:text-gray-400 mb-1">
                    <Users className="h-3 w-3" />
                    <span>{table.minGuests}-{table.maxGuests}</span>
                </div>
                
                {/* Reservation Info */}
                {table.reservation ? (
                    <div className="text-xs text-red-700 dark:text-red-300 font-medium">
                        {table.reservation.guestName}
                        <br />
                        <span className="text-xs">{table.reservation.guestCount} guests</span>
                    </div>
                ) : (
                    <div className="text-xs text-green-700 dark:text-green-300 font-medium">
                        Available
                    </div>
                )}
            </div>

            {/* Drag Handle */}
            {(isHovered || isDragging) && (
                <div className="absolute -top-1 -right-1 bg-blue-500 text-white rounded-full p-1">
                    <Move className="h-3 w-3" />
                </div>
            )}

            {/* Status Indicator */}
            <div className={`
                absolute -top-2 -left-2 w-4 h-4 rounded-full border-2 border-white
                ${table.reservation ? 'bg-red-500' : 'bg-green-500'}
            `} />
        </div>
    );

    return tableContent;
});

TableComponent.displayName = 'TableComponent';

interface Floor {
    id: number;
    name: string;
}

interface TableData {
    id: number;
    name: string;
    minGuests: number;
    maxGuests: number;
    status: string;
    shape: 'square' | 'round';
    posX: number;
    posY: number;
    floorId: number | null;
    reservation?: {
        guestName: string;
        guestCount: number;
    };
}

interface FloorPlanViewProps {
    floors: Floor[];
    isLoading: boolean;
    isManageFloorsOpen: boolean;
    setIsManageFloorsOpen: (isOpen: boolean) => void;
}

export function FloorPlanView({ floors, isLoading, isManageFloorsOpen, setIsManageFloorsOpen }: FloorPlanViewProps) {
    console.log('[FloorPlanView] Component mounting...');
    
    const [selectedFloorId, setSelectedFloorId] = useState<number | null>(null);
    const [newFloorName, setNewFloorName] = useState("");
    const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
    const [floorToDelete, setFloorToDelete] = useState<Floor | null>(null);
    
    // ✅ FIXED: Optimized local table state
    const [localTables, setLocalTables] = useState<TableData[]>([]);
    const [lastUpdateTime, setLastUpdateTime] = useState<number>(0);
    
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // ✅ FIXED: Component lifecycle tracking
    useEffect(() => {
        console.log('[FloorPlanView] Component mounted');
        
        return () => {
            console.log('[FloorPlanView] Component unmounting...');
        };
    }, []);

    // ✅ FIXED: Use stable DnD components with logging
    const { isReady: isDndReady, isLoading: isDndLoading, components: { DndContext: StableDndContext, DraggableTable: StableDraggableTable } } = useDndForFloorPlan();

    // ✅ FIXED: Track DnD loading status
    useEffect(() => {
        console.log('[FloorPlanView] DnD status - Ready:', isDndReady, 'Loading:', isDndLoading);
    }, [isDndReady, isDndLoading]);

    // ✅ FIXED: Memoized floor selection effect
    const handleFloorSelection = useCallback(() => {
        if (floors && floors.length > 0 && !selectedFloorId) {
            setSelectedFloorId(floors[0].id);
            console.log('[FloorPlanView] Auto-selected floor:', floors[0].id);
        }
    }, [floors, selectedFloorId]);

    useEffect(() => {
        handleFloorSelection();
    }, [handleFloorSelection]);

    // ✅ FIXED: Optimized tables query
    const { data: tables, isLoading: tablesLoading, error: tablesError } = useQuery<TableData[]>({
        queryKey: ["/api/tables", { floorId: selectedFloorId }],
        queryFn: async () => {
            if (!selectedFloorId) return [];
            
            console.log('[FloorPlanView] Fetching tables for floor:', selectedFloorId);
            
            const res = await fetch(`/api/tables?floorId=${selectedFloorId}`, { 
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            
            if (!res.ok) {
                throw new Error(`Failed to fetch tables for floor ${selectedFloorId}: ${res.status}`);
            }
            
            const data = await res.json();
            console.log('[FloorPlanView] Loaded tables:', data.length);
            return Array.isArray(data) ? data : [];
        },
        enabled: !!selectedFloorId,
        staleTime: 30000,
        gcTime: 300000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
            console.error('[FloorPlanView] Tables query error:', error);
            return failureCount < 2;
        }
    });

    // ✅ FIXED: Stable table sync with debouncing
    useEffect(() => {
        if (tables && Array.isArray(tables)) {
            const now = Date.now();
            if (now - lastUpdateTime > 1000) {
                setLocalTables(tables);
                setLastUpdateTime(now);
                console.log('[FloorPlanView] Updated local tables:', tables.length);
            }
        }
    }, [tables, lastUpdateTime]);

    // ✅ FIXED: Optimized mutations (same as before but with better logging)
    const updatePositionMutation = useMutation({
        mutationFn: async ({ id, posX, posY }: { id: number, posX: number, posY: number }) => {
            console.log('[FloorPlanView] Updating table position:', { id, posX, posY });
            
            const response = await fetch(`/api/tables/${id}/position`, {
                method: 'PATCH',
                headers: { 
                    'Content-Type': 'application/json', 
                    'Accept': 'application/json' 
                },
                credentials: 'include',
                body: JSON.stringify({ posX: Math.round(posX), posY: Math.round(posY) })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to update position: ${response.status} ${errorText}`);
            }
            
            return response.json();
        },
        onMutate: async ({ id, posX, posY }) => {
            // Optimistic update
            setLocalTables(prev => 
                prev.map(table => 
                    table.id === id ? { ...table, posX: Math.round(posX), posY: Math.round(posY) } : table
                )
            );
        },
        onSuccess: (data, { id }) => {
            console.log('[FloorPlanView] Position updated successfully for table:', id);
            // Gentle invalidation
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ["/api/tables", { floorId: selectedFloorId }] });
            }, 1000);
        },
        onError: (error: any, { id }) => {
            console.error('[FloorPlanView] Position update failed:', error);
            
            // Revert optimistic update on error
            if (tables) {
                setLocalTables(tables);
            }
            
            toast({ 
                title: "Position Update Failed", 
                description: error.message || "Could not save table position. Please try again.",
                variant: "destructive" 
            });
        }
    });

    const createFloorMutation = useMutation({
        mutationFn: async (name: string) => {
            console.log('[FloorPlanView] Creating floor:', name);
            
            const response = await fetch('/api/floors', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({ name: name.trim() })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `Failed to create floor: ${response.status}`);
            }
            
            return response.json();
        },
        onSuccess: (newFloor) => {
            console.log('[FloorPlanView] Floor created successfully:', newFloor);
            toast({
                title: "Floor Created Successfully! 🎉",
                description: `Floor "${newFloor.name}" has been created.`
            });
            setNewFloorName("");
            queryClient.invalidateQueries({ queryKey: ["/api/floors"] });
            setSelectedFloorId(newFloor.id);
        },
        onError: (error: any) => {
            console.error('[FloorPlanView] Floor creation failed:', error);
            toast({
                title: "Failed to Create Floor",
                description: error.message || "An unexpected error occurred while creating the floor.",
                variant: "destructive"
            });
        }
    });

    const deleteFloorMutation = useMutation({
        mutationFn: async (floorId: number) => {
            console.log('[FloorPlanView] Deleting floor:', floorId);
            
            const response = await fetch(`/api/floors/${floorId}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to delete floor: ${response.status} ${errorText}`);
            }
            
            return response.json();
        },
        onSuccess: (_, deletedFloorId) => {
            console.log('[FloorPlanView] Floor deleted successfully:', deletedFloorId);
            toast({ 
                title: "Floor Deleted Successfully",
                description: "The floor and all its tables have been removed."
            });
            
            queryClient.invalidateQueries({ queryKey: ["/api/floors"] });
            queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
            
            if (selectedFloorId === deletedFloorId) {
                setSelectedFloorId(null);
            }
            setFloorToDelete(null);
            setIsConfirmDeleteOpen(false);
        },
        onError: (error: any) => {
            console.error('[FloorPlanView] Floor deletion failed:', error);
            toast({ 
                title: "Delete Failed", 
                description: error.message || "Could not delete floor. Please try again.",
                variant: "destructive" 
            });
        }
    });

    // ✅ FIXED: Memoized event handlers
    const handleCreateFloor = useCallback(() => {
        const trimmedName = newFloorName.trim();
        if (!trimmedName) {
            toast({
                title: "Invalid Floor Name",
                description: "Please enter a valid floor name (at least 1 character).",
                variant: "destructive"
            });
            return;
        }
        
        if (trimmedName.length > 50) {
            toast({
                title: "Floor Name Too Long",
                description: "Floor name must be 50 characters or less.",
                variant: "destructive"
            });
            return;
        }
        
        createFloorMutation.mutate(trimmedName);
    }, [newFloorName, createFloorMutation, toast]);

    const handleInputKeyPress = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleCreateFloor();
        }
    }, [handleCreateFloor]);

    const handleConfirmDeleteFloor = useCallback(() => {
        if (floorToDelete) {
            deleteFloorMutation.mutate(floorToDelete.id);
        }
    }, [floorToDelete, deleteFloorMutation]);

    // ✅ FIXED: Optimized drag end handler
    const dragEndTimeoutRef = useRef<NodeJS.Timeout>();
    
    const handleDragEnd = useCallback(async (event: any) => {
        if (!isDndReady) return;
        
        console.log('[FloorPlanView] Drag ended:', event.active.id);
        
        const { active, delta } = event;
        const tableId = active.id as number;

        if (dragEndTimeoutRef.current) {
            clearTimeout(dragEndTimeoutRef.current);
        }

        const draggedTable = localTables.find(t => t.id === tableId);
        if (!draggedTable) return;

        const newPosX = Math.max(0, Math.min(800, Math.round(draggedTable.posX + delta.x)));
        const newPosY = Math.max(0, Math.min(600, Math.round(draggedTable.posY + delta.y)));

        // Immediate optimistic update
        setLocalTables(prevTables =>
            prevTables.map(table =>
                table.id === tableId ? { ...table, posX: newPosX, posY: newPosY } : table
            )
        );

        // Debounced API call
        dragEndTimeoutRef.current = setTimeout(() => {
            updatePositionMutation.mutate({ id: tableId, posX: newPosX, posY: newPosY });
        }, 300);
    }, [isDndReady, localTables, updatePositionMutation]);

    // Handle table updates for fallback mode
    const handleTableUpdate = useCallback((updatedTable: TableData) => {
        console.log('[FloorPlanView] Fallback table update:', updatedTable.id);
        updatePositionMutation.mutate({ 
            id: updatedTable.id, 
            posX: updatedTable.posX, 
            posY: updatedTable.posY 
        });
    }, [updatePositionMutation]);

    // ✅ FIXED: Memoized table rendering
    const renderTables = useMemo(() => {
        if (!localTables || localTables.length === 0) {
            return (
                <div className="flex items-center justify-center h-full">
                    <div className="text-center text-gray-500 dark:text-gray-400">
                        <Settings className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p className="text-lg font-medium mb-2">No Tables on This Floor</p>
                        <p className="text-sm">Add tables to this floor from the main tables page</p>
                    </div>
                </div>
            );
        }

        if (isDndReady) {
            console.log('[FloorPlanView] Rendering with DnD components');
            return localTables.map((table) => (
                <div
                    key={`dnd-table-${table.id}`}
                    style={{
                        position: 'absolute',
                        top: table.posY,
                        left: table.posX,
                        zIndex: 10,
                    }}
                >
                    <StableDraggableTable table={table} />
                </div>
            ));
        } else {
            console.log('[FloorPlanView] Rendering with fallback components');
            return localTables.map((table) => (
                <div
                    key={`fallback-table-${table.id}`}
                    style={{
                        position: 'absolute',
                        top: table.posY,
                        left: table.posX,
                        zIndex: 10,
                    }}
                >
                    <TableComponent 
                        table={table} 
                        isDndReady={false}
                        onTableUpdate={handleTableUpdate}
                    />
                </div>
            ));
        }
    }, [localTables, isDndReady, StableDraggableTable, handleTableUpdate]);

    // ✅ FIXED: Cleanup effect
    useEffect(() => {
        return () => {
            if (dragEndTimeoutRef.current) {
                clearTimeout(dragEndTimeoutRef.current);
            }
        };
    }, []);

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
                <span className="ml-2 text-gray-600 dark:text-gray-400">Loading floors...</span>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Floor selector and manage button */}
            <div className="flex items-center justify-between gap-4">
                {floors && floors.length > 0 ? (
                    <div className="flex items-center gap-4">
                        <Select 
                            onValueChange={(value) => setSelectedFloorId(Number(value))} 
                            value={selectedFloorId ? String(selectedFloorId) : ""}
                        >
                            <SelectTrigger className="w-[280px]">
                                <SelectValue placeholder="Select a Floor..." />
                            </SelectTrigger>
                            <SelectContent>
                                {floors.map(floor => (
                                    <SelectItem key={floor.id} value={String(floor.id)}>
                                        {floor.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        
                        {selectedFloorId && (
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                                {localTables.length} table{localTables.length !== 1 ? 's' : ''} on this floor
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Floor Plan</h3>
                        <p className="text-gray-500 text-sm">Create your first floor to begin designing your layout.</p>
                    </div>
                )}

                <Button variant="outline" onClick={() => setIsManageFloorsOpen(true)}>
                    <Settings className="h-4 w-4 mr-2" />
                    {floors && floors.length > 0 ? "Manage Floors" : "Create First Floor"}
                </Button>
            </div>

            {/* ✅ FIXED: Enhanced DnD Loading Status */}
            {isDndLoading && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 text-sm">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Loading drag & drop functionality... (WebSocket safe mode)</span>
                    </div>
                </div>
            )}

            {/* Main floor plan canvas */}
            {floors && floors.length > 0 && selectedFloorId && (
                <div className="relative w-full h-[70vh] bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 overflow-hidden shadow-inner">
                    {/* Grid background */}
                    <div 
                        className="absolute inset-0 opacity-20"
                        style={{
                            backgroundImage: `
                                linear-gradient(to right, #e5e7eb 1px, transparent 1px),
                                linear-gradient(to bottom, #e5e7eb 1px, transparent 1px)
                            `,
                            backgroundSize: '40px 40px'
                        }}
                    />
                    
                    {/* Loading state */}
                    {tablesLoading ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <RefreshCw className="h-8 w-8 animate-spin text-blue-500 mx-auto mb-3" />
                                <span className="text-gray-600 dark:text-gray-400">Loading tables...</span>
                            </div>
                        </div>
                    ) : tablesError ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center text-red-600 dark:text-red-400">
                                <p className="font-medium mb-2">Failed to load tables</p>
                                <p className="text-sm">{tablesError.message}</p>
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    className="mt-3"
                                    onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/tables", { floorId: selectedFloorId }] })}
                                >
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Retry
                                </Button>
                            </div>
                        </div>
                    ) : isDndReady ? (
                        /* DnD-enabled canvas */
                        <StableDndContext onDragEnd={handleDragEnd}>
                            {renderTables}
                        </StableDndContext>
                    ) : (
                        /* Fallback canvas */
                        <div className="relative w-full h-full">
                            {!isDndLoading && (
                                <div className="absolute top-4 left-4 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 rounded-lg p-2 text-xs text-yellow-800 dark:text-yellow-200">
                                    <strong>Fallback Mode:</strong> Using basic drag functionality (WebSocket safe)
                                </div>
                            )}
                            {renderTables}
                        </div>
                    )}
                    
                    {/* Enhanced instructions overlay */}
                    {localTables.length > 0 && (
                        <div className="absolute bottom-4 right-4 bg-black/70 text-white text-xs rounded-lg p-2 max-w-xs">
                            <p className="font-medium mb-1">💡 Floor Plan Tips:</p>
                            <ul className="text-xs space-y-1">
                                <li>• Drag tables to reposition them</li>
                                <li>• Red tables are reserved</li>
                                <li>• Green tables are available</li>
                                <li>• Changes save automatically</li>
                                {!isDndReady && <li>• Using fallback drag mode</li>}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            {/* Empty state when no floors */}
            {(!floors || floors.length === 0) && (
                <div className="text-center py-16 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                    <div className="max-w-md mx-auto">
                        <div className="w-20 h-20 mx-auto mb-6 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center">
                            <Settings className="h-10 w-10 text-blue-600 dark:text-blue-400" />
                        </div>
                        <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-3">
                            Ready to Design Your Layout
                        </h3>
                        <p className="text-gray-500 mb-8 leading-relaxed">
                            Create your first floor to start organizing your restaurant layout. 
                            You can add different areas like "Main Dining", "Terrace", or "Private Room".
                        </p>
                        <div className="text-sm text-gray-400">
                            Click "Create First Floor" above to get started
                        </div>
                    </div>
                </div>
            )}

            {/* All dialogs remain the same... */}
            <Dialog open={isManageFloorsOpen} onOpenChange={setIsManageFloorsOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Manage Floors</DialogTitle>
                        <DialogDescription>
                            Add new floors or remove existing ones. Each floor can have its own table layout.
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="space-y-6 py-4">
                        <div className="space-y-3">
                            <Label htmlFor="new-floor-input" className="text-sm font-medium">
                                Create New Floor
                            </Label>
                            <div className="flex items-center gap-3">
                                <Input
                                    id="new-floor-input"
                                    placeholder="e.g., Main Dining, Terrace, Private Room"
                                    value={newFloorName}
                                    onChange={(e) => setNewFloorName(e.target.value)}
                                    onKeyPress={handleInputKeyPress}
                                    disabled={createFloorMutation.isPending}
                                    maxLength={50}
                                    className="flex-1"
                                />
                                <Button
                                    onClick={handleCreateFloor}
                                    disabled={createFloorMutation.isPending || !newFloorName.trim()}
                                    className="flex-shrink-0"
                                    size="sm"
                                >
                                    {createFloorMutation.isPending ? (
                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Plus className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>
                            
                            {newFloorName && !newFloorName.trim() && (
                                <p className="text-sm text-red-500">Floor name cannot be empty or just spaces</p>
                            )}
                            {newFloorName.length > 50 && (
                                <p className="text-sm text-red-500">Floor name is too long (max 50 characters)</p>
                            )}
                            {createFloorMutation.error && (
                                <p className="text-sm text-red-500">
                                    Error: {createFloorMutation.error.message}
                                </p>
                            )}
                        </div>

                        {floors && floors.length > 0 && (
                            <div className="space-y-3">
                                <Label className="text-sm font-medium">
                                    Existing Floors ({floors.length})
                                </Label>
                                <div className="max-h-40 overflow-y-auto space-y-2 border rounded-md p-2">
                                    {floors.map(floor => (
                                        <div 
                                            key={floor.id} 
                                            className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-2 h-2 bg-blue-500 rounded-full" />
                                                <span className="font-medium">{floor.name}</span>
                                                {selectedFloorId === floor.id && (
                                                    <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded">
                                                        Current
                                                    </span>
                                                )}
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    setFloorToDelete(floor);
                                                    setIsConfirmDeleteOpen(true);
                                                }}
                                                disabled={deleteFloorMutation.isPending}
                                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
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

            {/* Delete confirmation dialog */}
            <Dialog open={isConfirmDeleteOpen} onOpenChange={setIsConfirmDeleteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Are you absolutely sure?</DialogTitle>
                        <DialogDescription className="space-y-2">
                            <p>
                                This action cannot be undone. This will permanently delete the floor 
                                <strong> "{floorToDelete?.name}"</strong> and all its associated tables.
                            </p>
                            <p className="text-sm text-amber-600 dark:text-amber-400">
                                ⚠️ All tables on this floor will also be deleted and any reservations will be affected.
                            </p>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button 
                            variant="outline" 
                            onClick={() => setIsConfirmDeleteOpen(false)} 
                            disabled={deleteFloorMutation.isPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleConfirmDeleteFloor}
                            disabled={deleteFloorMutation.isPending}
                        >
                            {deleteFloorMutation.isPending ? (
                                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Trash2 className="mr-2 h-4 w-4" />
                            )}
                            Delete Floor
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}