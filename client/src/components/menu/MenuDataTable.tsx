import { useMutation } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast"; // CORRECTED IMPORT PATH
import { MenuItem, updateMenuItem, deleteMenuItem, invalidateMenuQueries } from "@/lib/api/menuApi";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState } from "react";

interface MenuDataTableProps {
    menuItems: MenuItem[];
    onEdit: (item: MenuItem) => void;
}

export function MenuDataTable({ menuItems, onEdit }: MenuDataTableProps) {
    const { toast } = useToast();
    const [itemToDelete, setItemToDelete] = useState<MenuItem | null>(null);

    // Mutation for updating a menu item (e.g., toggling availability)
    const updateMutation = useMutation({
        mutationFn: (data: { id: number; itemData: Partial<MenuItem> }) => updateMenuItem(data.id, data.itemData),
        onSuccess: () => {
            toast({ title: "Success", description: "Menu item updated." });
            invalidateMenuQueries();
        },
        onError: (error) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        },
    });

    // Mutation for deleting a menu item
    const deleteMutation = useMutation({
        mutationFn: (id: number) => deleteMenuItem(id),
        onSuccess: () => {
            toast({ title: "Success", description: "Menu item has been deleted." });
            invalidateMenuQueries();
            setItemToDelete(null);
        },
        onError: (error) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
            setItemToDelete(null);
        },
    });

    return (
        <>
            <div className="rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[40%]">Name</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead className="text-right">Price</TableHead>
                            <TableHead className="text-center">Available</TableHead>
                            <TableHead className="text-center">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {menuItems.length > 0 ? (
                            menuItems.map((item) => (
                                <TableRow key={item.id} data-state={!item.isAvailable ? "muted" : ""}>
                                    <TableCell className="font-medium">
                                        <span className={!item.isAvailable ? 'text-muted-foreground' : ''}>{item.name}</span>
                                        {item.isPopular && <Badge variant="secondary" className="ml-2">Popular</Badge>}
                                    </TableCell>
                                    <TableCell className={!item.isAvailable ? 'text-muted-foreground' : ''}>{item.categoryName}</TableCell>
                                    <TableCell className={`text-right ${!item.isAvailable ? 'text-muted-foreground' : ''}`}>
                                        ${item.price}
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <Switch
                                            checked={item.isAvailable}
                                            onCheckedChange={(isAvailable) => updateMutation.mutate({ id: item.id, itemData: { isAvailable } })}
                                            disabled={updateMutation.isPending}
                                        />
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" className="h-8 w-8 p-0">
                                                    <span className="sr-only">Open menu</span>
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => onEdit(item)}>Edit</DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    onClick={() => setItemToDelete(item)}
                                                    className="text-red-600 focus:bg-red-50 focus:text-red-600"
                                                >
                                                    Delete
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                    No menu items match your search.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <AlertDialog open={!!itemToDelete} onOpenChange={() => setItemToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the menu item
                            <span className="font-semibold"> "{itemToDelete?.name}"</span>.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (itemToDelete) deleteMutation.mutate(itemToDelete.id)
                            }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={deleteMutation.isPending}
                        >
                            {deleteMutation.isPending ? "Deleting..." : "Yes, delete it"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
