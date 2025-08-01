import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { getMenuItems, getMenuCategories, MenuFilters, MenuItem, MenuCategory } from "@/lib/api/menuApi";
import { MenuToolbar } from "@/components/menu/MenuToolbar";
import { MenuDataTable } from "@/components/menu/MenuDataTable";
import { MenuItemDialog } from "@/components/menu/MenuItemDialog";
import { CategoryManagerDialog } from "@/components/menu/CategoryManagerDialog";
import { Loader2, ServerCrash, PlusCircle, ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Main component for the Menu Management page
export default function MenuPage() {
    // State for managing filters (search query, category, etc.)
    const [filters, setFilters] = useState<MenuFilters>({});
    // State for controlling the create/edit item dialog
    const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
    // State for controlling the manage categories dialog
    const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
    // State for holding the menu item currently being edited
    const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);

    // Fetch menu items using TanStack Query.
    // The query key includes the filters object, so it automatically refetches when filters change.
    const { data: menuData, isLoading: isLoadingItems, error: itemsError, refetch: refetchItems } = useQuery({
        queryKey: ["menuItems", filters],
        queryFn: () => getMenuItems(filters),
        staleTime: 1000 * 60, // Cache data for 1 minute
    });

    // Fetch menu categories separately.
    // This is done so the category manager can have its own data without being tied to item filters.
    const { data: categoriesData, isLoading: isLoadingCategories } = useQuery({
        queryKey: ["menuCategories"],
        queryFn: getMenuCategories,
        staleTime: 1000 * 60 * 5, // Categories change less often, so cache for longer
    });

    // Handler to open the dialog for editing an existing item
    const handleEdit = (item: MenuItem) => {
        setSelectedItem(item);
        setIsItemDialogOpen(true);
    };

    // Handler to open the dialog for creating a new item
    const handleCreate = () => {
        setSelectedItem(null); // No item is selected for creation
        setIsItemDialogOpen(true);
    };

    // Handler to close the item dialog and reset the selected item
    const handleItemDialogClose = () => {
        setIsItemDialogOpen(false);
        setSelectedItem(null);
    };

    // Helper function to render the main content based on the query state
    const renderContent = () => {
        // Show a single loading spinner if either items or categories are loading
        if (isLoadingItems || isLoadingCategories) {
            return (
                <div className="flex flex-col items-center justify-center h-96 text-muted-foreground">
                    <Loader2 className="h-12 w-12 animate-spin mb-4" />
                    <p className="text-lg">Loading Menu...</p>
                </div>
            );
        }

        // Show an error message if fetching items failed
        if (itemsError) {
            return (
                <div className="flex flex-col items-center justify-center h-96 bg-destructive/10 border border-destructive/20 rounded-lg">
                    <ServerCrash className="h-12 w-12 text-destructive mb-4" />
                    <p className="text-lg font-semibold text-destructive">Failed to load menu</p>
                    <p className="text-muted-foreground mb-4">{itemsError.message}</p>
                    <Button onClick={() => refetchItems()}>
                        Try Again
                    </Button>
                </div>
            );
        }

        // If there are no categories, prompt the user to create one first. This is a critical first step.
        if (!categoriesData || categoriesData.length === 0) {
            return (
                <div className="text-center py-16">
                    <Card className="max-w-lg mx-auto">
                        <CardHeader>
                            <CardTitle>Create a Category to Begin</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-muted-foreground mb-6">
                                Your menu needs categories like "Appetizers" or "Drinks" before you can add items.
                            </p>
                            <Button onClick={() => setIsCategoryDialogOpen(true)}>
                                <ListTree className="mr-2 h-4 w-4" />
                                Manage Categories
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            )
        }

        // If there are categories but no items (and no filters are active), prompt to add the first item.
        if (menuData && menuData.items.length === 0 && Object.values(filters).every(v => !v)) {
            return (
                <div className="text-center py-16">
                    <Card className="max-w-lg mx-auto">
                        <CardHeader>
                            <CardTitle>Your Menu is Empty</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-muted-foreground mb-6">
                                Get started by adding your first dish or drink to the menu.
                            </p>
                            <Button onClick={handleCreate}>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Add First Item
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            )
        }

        // If data is available, render the data table.
        if (menuData) {
            return <MenuDataTable menuItems={menuData.items} onEdit={handleEdit} />;
        }

        // Fallback case, should not be reached
        return null;
    };

    const categoryNames = categoriesData?.map(c => c?.name).filter(Boolean) as string[] ?? [];

    return (
        <DashboardLayout>
            <div className="p-4 sm:p-6 lg:p-8">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                    <h1 className="text-3xl font-bold tracking-tight">Menu Management</h1>
                    {/* "Manage Categories" button is always visible if the initial category check passes */}
                    {categoriesData && categoriesData.length > 0 && (
                        <Button variant="outline" onClick={() => setIsCategoryDialogOpen(true)}>
                            <ListTree className="mr-2 h-4 w-4" />
                            Manage Categories
                        </Button>
                    )}
                </div>

                <MenuToolbar
                    filters={filters}
                    setFilters={setFilters}
                    categories={categoryNames}
                    onCreate={handleCreate}
                />

                {renderContent()}

                {/* The dialog for creating/editing items */}
                <MenuItemDialog
                    isOpen={isItemDialogOpen}
                    onClose={handleItemDialogClose}
                    item={selectedItem}
                    categories={categoryNames}
                />

                {/* The dialog for managing categories */}
                <CategoryManagerDialog
                    isOpen={isCategoryDialogOpen}
                    onClose={() => setIsCategoryDialogOpen(false)}
                />
            </div>
        </DashboardLayout>
    );
}
