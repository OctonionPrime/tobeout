import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getMenuCategories, createMenuCategory, deleteMenuCategory } from "@/lib/api/menuApi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trash2, PlusCircle } from "lucide-react";
import { queryClient } from "@/lib/queryClient";

interface CategoryManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CategoryManagerDialog({ isOpen, onClose }: CategoryManagerDialogProps) {
  const { toast } = useToast();
  const [newCategoryName, setNewCategoryName] = useState("");

  // Fetch the list of categories when the dialog is open
  const { data: categories, isLoading } = useQuery({
    queryKey: ["menuCategories"],
    queryFn: getMenuCategories,
    enabled: isOpen, // Only fetch when the dialog is open to save resources
  });

  // Mutation for creating a new category
  const createMutation = useMutation({
    mutationFn: () => createMenuCategory({ name: newCategoryName }),
    onSuccess: () => {
      toast({ title: "Success", description: "Category created." });
      setNewCategoryName("");
      // Invalidate queries to refetch and update the UI
      queryClient.invalidateQueries({ queryKey: ["menuCategories"] });
      queryClient.invalidateQueries({ queryKey: ["menuItems"] });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Mutation for deleting a category
  const deleteMutation = useMutation({
    mutationFn: deleteMenuCategory,
    onSuccess: () => {
      toast({ title: "Success", description: "Category deleted." });
      queryClient.invalidateQueries({ queryKey: ["menuCategories"] });
      queryClient.invalidateQueries({ queryKey: ["menuItems"] });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Handler for the "Add" button click
  const handleAddCategory = () => {
    if (newCategoryName.trim()) {
      createMutation.mutate();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage Menu Categories</DialogTitle>
          <DialogDescription>Add or delete categories for your menu items.</DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="New category name..."
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              disabled={createMutation.isPending}
            />
            <Button onClick={handleAddCategory} disabled={createMutation.isPending || !newCategoryName.trim()}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle size={16} />}
              <span className="ml-2">Add</span>
            </Button>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
            {isLoading && <div className="text-center p-4 text-muted-foreground">Loading categories...</div>}
            {categories?.map((cat) => (
              <div key={cat.id} className="flex items-center justify-between p-2 border rounded-md">
                <span className="text-sm font-medium">{cat.name}</span>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => deleteMutation.mutate(cat.id)} 
                  disabled={deleteMutation.isPending && deleteMutation.variables === cat.id}
                >
                  {deleteMutation.isPending && deleteMutation.variables === cat.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 text-red-500" />
                  )}
                </Button>
              </div>
            ))}
             {!isLoading && categories?.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-4">No categories created yet.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
