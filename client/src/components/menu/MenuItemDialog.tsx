import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
    DialogClose
} from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { MenuItem, createMenuItem, updateMenuItem, invalidateMenuQueries } from "@/lib/api/menuApi";

// Imports for the searchable combobox with create functionality
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronsUpDown, Check, PlusCircle } from "lucide-react";
import { cn } from "@/lib/utils";


// Zod schema for form validation
const formSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters long."),
    description: z.string().optional(),
    price: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid price (e.g., 12.99)."),
    category: z.string().min(1, "Category is required."),
    isAvailable: z.boolean().default(true),
    isPopular: z.boolean().default(false),
});

type FormValues = z.infer<typeof formSchema>;

interface MenuItemDialogProps {
    isOpen: boolean;
    onClose: () => void;
    item: MenuItem | null;
    categories: string[];
}

export function MenuItemDialog({ isOpen, onClose, item, categories }: MenuItemDialogProps) {
    const { toast } = useToast();
    const isEditMode = !!item;

    // State for managing the combobox popover and search query
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            description: "",
            price: "",
            category: "",
            isAvailable: true,
            isPopular: false,
        },
    });

    // Effect to populate or reset the form when the dialog opens/closes or the item changes
    useEffect(() => {
        if (isOpen && item) {
            form.reset({
                name: item.name,
                description: item.description || "",
                price: item.price,
                category: item.categoryName,
                isAvailable: item.isAvailable,
                isPopular: item.isPopular,
            });
        } else if (isOpen && !item) {
            form.reset({
                name: "",
                description: "",
                price: "",
                category: "",
                isAvailable: true,
                isPopular: false,
            });
        }
    }, [isOpen, item, form]);

    // Mutation for creating or updating a menu item
    const mutation = useMutation({
        mutationFn: (data: FormValues) => {
            const payload = { ...data, price: data.price };
            return isEditMode ? updateMenuItem(item!.id, payload) : createMenuItem(payload);
        },
        onSuccess: () => {
            toast({ title: "Success", description: `Menu item has been ${isEditMode ? 'updated' : 'created'}.` });
            invalidateMenuQueries(); // This refetches both items and categories
            onClose();
        },
        onError: (error) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        },
    });

    // Form submission handler
    const onSubmit = (values: FormValues) => {
        mutation.mutate(values);
    };

    // Handler for when the user clicks the "Create new category" option in the combobox
    const handleCreateCategory = () => {
        if (searchQuery) {
            form.setValue("category", searchQuery);
            setPopoverOpen(false);
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>{isEditMode ? "Edit Menu Item" : "Create New Menu Item"}</DialogTitle>
                    <DialogDescription>
                        {isEditMode ? "Update the details for this menu item." : "Add a new dish or drink to your menu."}
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                        <FormField name="name" control={form.control} render={({ field }) => (
                            <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} placeholder="e.g., Classic Burger" /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField name="description" control={form.control} render={({ field }) => (
                            <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea {...field} placeholder="A short description of the item..." /></FormControl><FormMessage /></FormItem>
                        )} />
                        <div className="grid grid-cols-2 gap-4">
                            <FormField name="price" control={form.control} render={({ field }) => (
                                <FormItem><FormLabel>Price</FormLabel><FormControl><Input type="text" {...field} placeholder="12.99" /></FormControl><FormMessage /></FormItem>
                            )} />

                            <FormField
                                control={form.control}
                                name="category"
                                render={({ field }) => (
                                    <FormItem className="flex flex-col">
                                        <FormLabel>Category</FormLabel>
                                        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                                            <PopoverTrigger asChild>
                                                <FormControl>
                                                    <Button
                                                        variant="outline"
                                                        role="combobox"
                                                        className={cn(
                                                            "w-full justify-between",
                                                            !field.value && "text-muted-foreground"
                                                        )}
                                                    >
                                                        {field.value || "Select or create..."}
                                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                    </Button>
                                                </FormControl>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-[200px] p-0">
                                                <Command>
                                                    <CommandInput
                                                        placeholder="Search or type new..."
                                                        value={searchQuery}
                                                        onValueChange={setSearchQuery}
                                                    />
                                                    <CommandList>
                                                        <CommandEmpty>
                                                            <CommandItem onSelect={handleCreateCategory}>
                                                                <PlusCircle className="mr-2 h-4 w-4" />
                                                                Create "{searchQuery}"
                                                            </CommandItem>
                                                        </CommandEmpty>
                                                        <CommandGroup>
                                                            {categories.map((category) => (
                                                                <CommandItem
                                                                    value={category}
                                                                    key={category}
                                                                    onSelect={() => {
                                                                        form.setValue("category", category)
                                                                        setPopoverOpen(false);
                                                                        setSearchQuery("");
                                                                    }}
                                                                >
                                                                    <Check
                                                                        className={cn(
                                                                            "mr-2 h-4 w-4",
                                                                            category === field.value
                                                                                ? "opacity-100"
                                                                                : "opacity-0"
                                                                        )}
                                                                    />
                                                                    {category}
                                                                </CommandItem>
                                                            ))}
                                                        </CommandGroup>
                                                    </CommandList>
                                                </Command>
                                            </PopoverContent>
                                        </Popover>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                        <div className="flex items-center space-x-8 pt-2">
                            <FormField name="isAvailable" control={form.control} render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm flex-1">
                                    <div className="space-y-0.5"><FormLabel>Available</FormLabel><FormDescription>Is this item available for ordering?</FormDescription></div>
                                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                </FormItem>
                            )} />
                            <FormField name="isPopular" control={form.control} render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm flex-1">
                                    <div className="space-y-0.5"><FormLabel>Popular</FormLabel><FormDescription>Highlight as a popular item.</FormDescription></div>
                                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                </FormItem>
                            )} />
                        </div>
                        <DialogFooter className="pt-4">
                            <DialogClose asChild>
                                <Button type="button" variant="ghost">Cancel</Button>
                            </DialogClose>
                            <Button type="submit" disabled={mutation.isPending}>
                                {mutation.isPending ? "Saving..." : "Save Changes"}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
