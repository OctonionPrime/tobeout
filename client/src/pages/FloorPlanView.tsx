import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragEndEvent } from '@dnd-kit/core';
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
import { DraggableTable } from '@/components/floorplan/DraggableTable';
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Plus, Trash2, Settings } from 'lucide-react';

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
    const [selectedFloorId, setSelectedFloorId] = useState<number | null>(null);
    const [newFloorName, setNewFloorName] = useState("");
    const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
    const [floorToDelete, setFloorToDelete] = useState<Floor | null>(null);
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // State to hold a local copy of tables for immediate UI updates
    const [localTables, setLocalTables] = useState<TableData[]>([]);

    useEffect(() => {
        if (floors && floors.length > 0 && !selectedFloorId) {
            setSelectedFloorId(floors[0].id);
        }
    }, [floors, selectedFloorId]);

    // Fetch all tables that belong to the currently selected floor
    const { data: tables, isLoading: tablesLoading } = useQuery<TableData[]>({
        queryKey: ["/api/tables", { floorId: selectedFloorId }],
        queryFn: async () => {
            const res = await fetch(`/api/tables?floorId=${selectedFloorId}`, { credentials: 'include' });
            if (!res.ok) throw new Error('Failed to fetch tables for this floor');
            return res.json();
        },
        enabled: !!selectedFloorId,
    });

    // Sync the local state with the fetched data
    useEffect(() => {
        if (tables) {
            setLocalTables(tables);
        }
    }, [tables]);

    // Floor creation mutation
    const createFloorMutation = useMutation({
        mutationFn: async (name: string) => {
            const response = await fetch('/api/floors', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({ name })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to create floor');
            }
            return response.json();
        },
        onSuccess: (newFloor) => {
            toast({
                title: "Floor Created",
                description: `Successfully created '${newFloor.name}'.`
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

    // Mutation to update a table's position after dragging
    const updatePositionMutation = useMutation({
        mutationFn: async ({ id, posX, posY }: { id: number, posX: number, posY: number }) => {
            const response = await fetch(`/api/tables/${id}/position`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ posX, posY })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to update position');
            }
            return response.json();
        },
        onSuccess: () => {
            // This is handled by the optimistic update, but we invalidate to be safe
            queryClient.invalidateQueries({ queryKey: ["/api/tables", { floorId: selectedFloorId }] });
        },
        onError: (error: any) => {
            toast({ title: "Save Failed", description: error.message, variant: "destructive" });
        }
    });

    // Mutation to delete a floor
    const deleteFloorMutation = useMutation({
        mutationFn: async (floorId: number) => {
            const response = await fetch(`/api/floors/${floorId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (!response.ok) throw new Error('Failed to delete floor');
            return response.json();
        },
        onSuccess: () => {
            toast({ title: "Floor Deleted" });
            queryClient.invalidateQueries({ queryKey: ["/api/floors"] });
            setSelectedFloorId(null);
            setFloorToDelete(null);
            setIsConfirmDeleteOpen(false);
        },
        onError: (error: any) => {
            toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
        }
    });

    const handleCreateFloor = () => {
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
    };

    const handleInputKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleCreateFloor();
        }
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, delta } = event;
        const tableId = active.id as number;

        // Find the table that was just dragged
        const draggedTable = localTables.find(t => t.id === tableId);
        if (!draggedTable) return;

        // Calculate the new position
        const newPosX = Math.max(0, Math.round(draggedTable.posX + delta.x));
        const newPosY = Math.max(0, Math.round(draggedTable.posY + delta.y));

        // Optimistically update the UI
        const oldTables = [...localTables]; // Store old state for potential reversion
        setLocalTables(prevTables =>
            prevTables.map(table =>
                table.id === tableId ? { ...table, posX: newPosX, posY: newPosY } : table
            )
        );

        try {
            await updatePositionMutation.mutateAsync({ id: tableId, posX: newPosX, posY: newPosY });
        } catch (error) {
            // If the mutation fails, revert the state
            setLocalTables(oldTables);
            // The mutation's onError handler will show the toast
        }
    };

    const handleConfirmDeleteFloor = () => {
        if (floorToDelete) {
            deleteFloorMutation.mutate(floorToDelete.id);
        }
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
                <span className="ml-2">Loading floors...</span>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Always show the manage floors button and floor selector if floors exist */}
            <div className="flex items-center justify-between gap-4">
                {floors && floors.length > 0 ? (
                    <Select onValueChange={(value) => setSelectedFloorId(Number(value))} value={selectedFloorId ? String(selectedFloorId) : ""}>
                        <SelectTrigger className="w-[280px]">
                            <SelectValue placeholder="Select a Floor..." />
                        </SelectTrigger>
                        <SelectContent>
                            {floors.map(floor => (
                                <SelectItem key={floor.id} value={String(floor.id)}>{floor.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
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

            {/* Show drag-and-drop area only if floors exist */}
            {floors && floors.length > 0 && (
                <DndContext onDragEnd={handleDragEnd}>
                    <div className="relative w-full h-[70vh] bg-gray-100 dark:bg-gray-800 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 overflow-hidden shadow-inner">
                        {tablesLoading ? (
                            <div className="flex items-center justify-center h-full">
                                <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
                                <span className="ml-2 text-gray-600 dark:text-gray-400">Loading tables...</span>
                            </div>
                        ) : localTables?.map((table) => (
                            <div
                                key={table.id}
                                style={{
                                    position: 'absolute',
                                    top: table.posY,
                                    left: table.posX,
                                    transition: 'transform 0.2s ease-out'
                                }}
                            >
                                <DraggableTable table={table} />
                            </div>
                        ))}
                    </div>
                </DndContext>
            )}

            {/* Show empty state when no floors */}
            {(!floors || floors.length === 0) && (
                <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <div className="max-w-md mx-auto">
                        <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center">
                            <Settings className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">Ready to Design Your Layout</h3>
                        <p className="text-gray-500 mb-6">Start by creating your first floor (e.g., "Main Dining Area", "Terrace", "Private Room")</p>
                        <div className="text-sm text-gray-400">
                            Click "Create First Floor" above to get started
                        </div>
                    </div>
                </div>
            )}

            {/* Clean Manage Floors Dialog */}
            <Dialog open={isManageFloorsOpen} onOpenChange={setIsManageFloorsOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Manage Floors</DialogTitle>
                        <DialogDescription>Add new floors or remove existing ones.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="new-floor-input">Create New Floor</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    id="new-floor-input"
                                    placeholder="Floor name (e.g., Main Hall, Terrace)"
                                    value={newFloorName}
                                    onChange={(e) => setNewFloorName(e.target.value)}
                                    onKeyPress={handleInputKeyPress}
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
                            {newFloorName && !newFloorName.trim() && (
                                <p className="text-sm text-red-500">Floor name cannot be empty or just spaces</p>
                            )}
                            {createFloorMutation.error && (
                                <p className="text-sm text-red-500">Error: {createFloorMutation.error.message}</p>
                            )}
                        </div>

                        {floors && floors.length > 0 && (
                            <div className="space-y-2">
                                <Label>Existing Floors ({floors.length})</Label>
                                <div className="max-h-32 overflow-y-auto space-y-2">
                                    {floors.map(floor => (
                                        <div key={floor.id} className="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-700 rounded-md">
                                            <span>{floor.name}</span>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    setFloorToDelete(floor);
                                                    setIsConfirmDeleteOpen(true);
                                                }}
                                                disabled={deleteFloorMutation.isPending}
                                            >
                                                <Trash2 className="h-4 w-4 text-red-500" />
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

            {/* Custom Confirmation Dialog for Deleting a Floor */}
            <Dialog open={isConfirmDeleteOpen} onOpenChange={setIsConfirmDeleteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Are you absolutely sure?</DialogTitle>
                        <DialogDescription>
                            This action cannot be undone. This will permanently delete the floor "{floorToDelete?.name}" and all its associated tables.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsConfirmDeleteOpen(false)} disabled={deleteFloorMutation.isPending}>
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
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
