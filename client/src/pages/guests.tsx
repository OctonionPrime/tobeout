import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout, useRestaurantTimezone } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TableHead, TableRow, TableHeader, TableCell, TableBody, Table } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { DateTime } from "luxon";
import { Search, Plus, Edit, Trash2, Download, CalendarDays, User, Phone, Tag, Users, Eye } from "lucide-react";

// ✅ NEW: Import the GuestAnalyticsDrawer component created
import { GuestAnalyticsDrawer } from "@/components/guests/GuestAnalyticsDrawer";

const guestFormSchema = z.object({
    name: z.string().min(1, "Guest name is required"),
    phone: z.string().min(1, "Phone number is required"),
    email: z.string().email("Invalid email").optional().or(z.literal("")),
    language: z.string().default("en"),
    birthday: z.string().optional().or(z.literal("")),
    tags: z.string().optional(),
    comments: z.string().optional(),
});

type GuestFormValues = z.infer<typeof guestFormSchema>;

export default function Guests() {
    const [searchQuery, setSearchQuery] = useState("");
    const [isGuestModalOpen, setIsGuestModalOpen] = useState(false);
    const [selectedGuestId, setSelectedGuestId] = useState<number | undefined>(undefined);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [guestToDelete, setGuestToDelete] = useState<number | undefined>(undefined);

    // ✅ NEW: State to manage the selected guest for the analytics drawer
    const [selectedGuestForAnalytics, setSelectedGuestForAnalytics] = useState<any | null>(null);

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { restaurant, restaurantTimezone } = useRestaurantTimezone();

    console.log(`👥 [Guests] Context - restaurant: ${!!restaurant}, timezone: ${restaurantTimezone}`);

    const form = useForm<GuestFormValues>({
        resolver: zodResolver(guestFormSchema),
        defaultValues: {
            name: "",
            phone: "",
            email: "",
            language: "en",
            birthday: "",
            tags: "",
            comments: "",
        },
    });

    const { data: guests, isLoading: guestsLoading, error: guestsError } = useQuery({
        queryKey: ["/api/guests"],
        queryFn: async () => {
            console.log(`👥 [Guests] Fetching guests for restaurant`);

            const response = await fetch('/api/guests', {
                credentials: "include"
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch guests: ${response.status}`);
            }

            const data = await response.json();
            console.log(`👥 [Guests] Received ${data?.length || 0} guests`);
            return data || [];
        },
        staleTime: 60000,
        retry: 2
    });

    const { data: reservations } = useQuery({
        queryKey: ["/api/reservations"],
        queryFn: async () => {
            console.log(`👥 [Guests] Fetching reservations for guest statistics`);

            const response = await fetch('/api/reservations', {
                credentials: "include"
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch reservations: ${response.status}`);
            }

            const data = await response.json();
            console.log(`👥 [Guests] Received ${data?.length || 0} reservations for statistics`);
            return data || [];
        },
        staleTime: 30000,
        retry: 2
    });

    const createGuestMutation = useMutation({
        mutationFn: async (values: GuestFormValues) => {
            console.log(`👥 [Guests] Creating guest`);

            const tagsArray = values.tags ? values.tags.split(',').map(t => t.trim()) : undefined;

            const response = await apiRequest("POST", "/api/guests", {
                name: values.name,
                phone: values.phone,
                email: values.email || undefined,
                language: values.language,
                birthday: values.birthday || undefined,
                tags: tagsArray,
                comments: values.comments,
            });
            return response.json();
        },
        onSuccess: (data) => {
            console.log(`✅ [Guests] Successfully created guest:`, data);

            toast({
                title: "Success",
                description: "Guest created successfully",
            });

            queryClient.invalidateQueries({ queryKey: ['/api/guests'] });
            queryClient.invalidateQueries({ queryKey: ['/api/reservations'] });

            setIsGuestModalOpen(false);
            form.reset();
        },
        onError: (error: any) => {
            console.error(`❌ [Guests] Error creating guest:`, error);

            toast({
                title: "Error",
                description: `Failed to create guest: ${error.message}`,
                variant: "destructive",
            });
        }
    });

    const updateGuestMutation = useMutation({
        mutationFn: async ({ id, values }: { id: number; values: GuestFormValues }) => {
            console.log(`👥 [Guests] Updating guest ${id}`);

            const tagsArray = values.tags ? values.tags.split(',').map(t => t.trim()) : undefined;

            const response = await apiRequest("PATCH", `/api/guests/${id}`, {
                name: values.name,
                phone: values.phone,
                email: values.email || undefined,
                language: values.language,
                birthday: values.birthday || undefined,
                tags: tagsArray,
                comments: values.comments,
            });
            return response.json();
        },
        onSuccess: (data) => {
            console.log(`✅ [Guests] Successfully updated guest:`, data);

            toast({
                title: "Success",
                description: "Guest updated successfully",
            });

            queryClient.invalidateQueries({ queryKey: ['/api/guests'] });
            queryClient.invalidateQueries({ queryKey: ['/api/reservations'] });

            setIsGuestModalOpen(false);
            form.reset();
        },
        onError: (error: any) => {
            console.error(`❌ [Guests] Error updating guest:`, error);

            toast({
                title: "Error",
                description: `Failed to update guest: ${error.message}`,
                variant: "destructive",
            });
        }
    });

    const deleteGuestMutation = useMutation({
        mutationFn: async (id: number) => {
            console.log(`👥 [Guests] Deleting guest ${id}`);

            const response = await apiRequest("DELETE", `/api/guests/${id}`, undefined);
            return response.json();
        },
        onSuccess: (data) => {
            console.log(`✅ [Guests] Successfully deleted guest:`, data);

            toast({
                title: "Success",
                description: "Guest deleted successfully",
            });

            queryClient.invalidateQueries({ queryKey: ['/api/guests'] });
            queryClient.invalidateQueries({ queryKey: ['/api/reservations'] });

            setDeleteConfirmOpen(false);
        },
        onError: (error: any) => {
            console.error(`❌ [Guests] Error deleting guest:`, error);

            toast({
                title: "Error",
                description: `Failed to delete guest: ${error.message}`,
                variant: "destructive",
            });
        }
    });

    const onSubmit = (values: GuestFormValues) => {
        if (selectedGuestId) {
            updateGuestMutation.mutate({ id: selectedGuestId, values });
        } else {
            createGuestMutation.mutate(values);
        }
    };

    const handleAddGuest = () => {
        setSelectedGuestId(undefined);
        form.reset({
            name: "",
            phone: "",
            email: "",
            language: "en",
            birthday: "",
            tags: "",
            comments: "",
        });
        setIsGuestModalOpen(true);
    };

    const handleEditGuest = (guest: any) => {
        setSelectedGuestId(guest.id);
        form.reset({
            name: guest.name,
            phone: guest.phone,
            email: guest.email || '',
            language: guest.language || 'en',
            birthday: guest.birthday || '',
            tags: guest.tags ? guest.tags.join(', ') : '',
            comments: guest.comments || '',
        });
        setIsGuestModalOpen(true);
    };

    const handleDeleteGuest = (id: number) => {
        setGuestToDelete(id);
        setDeleteConfirmOpen(true);
    };

    const confirmDelete = () => {
        if (guestToDelete) {
            deleteGuestMutation.mutate(guestToDelete);
        }
    };

    const exportGuests = () => {
        if (!guests || guests.length === 0) {
            toast({
                title: "Error",
                description: "No guests to export",
                variant: "destructive",
            });
            return;
        }

        const headers = ["Name", "Phone", "Email", "Language", "Birthday", "Tags", "Comments", "Booking Count"];
        const rows = guests.map((guest: any) => [
            guest.name,
            guest.phone,
            guest.email || '',
            guest.language || 'en',
            guest.birthday || '',
            guest.tags ? guest.tags.join(', ') : '',
            guest.comments || '',
            guest.reservationCount || 0
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        const exportDate = DateTime.now().setZone(restaurantTimezone || 'UTC').toFormat('yyyy-MM-dd');
        link.setAttribute('href', url);
        link.setAttribute('download', `guests_${exportDate}_${restaurantTimezone?.replace('/', '_') || 'UTC'}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast({
            title: "Success",
            description: `Exported ${guests.length} guests to CSV`,
        });
    };

    const getGuestStatistics = () => {
        if (!guests || !reservations) {
            return { total: 0, withBirthday: 0, withEmail: 0, withBookings: 0, avgBookings: 0 };
        }

        const safeGuests = Array.isArray(guests) ? guests : [];
        const safeReservations = Array.isArray(reservations) ? reservations : [];

        const guestBookingCounts = safeGuests.map(guest => {
            const guestReservations = safeReservations.filter((r: any) => {
                const reservation = r.reservation || r;
                return reservation.guestId === guest.id || r.guestId === guest.id;
            });
            return guestReservations.length;
        });

        const avgBookings = guestBookingCounts.length > 0
            ? (guestBookingCounts.reduce((sum, count) => sum + count, 0) / guestBookingCounts.length).toFixed(1)
            : '0';

        return {
            total: safeGuests.length,
            withBirthday: safeGuests.filter((g: any) => g.birthday).length,
            withEmail: safeGuests.filter((g: any) => g.email).length,
            withBookings: guestBookingCounts.filter(count => count > 0).length,
            avgBookings
        };
    };

    const filteredGuests = guests ? guests.filter((guest: any) => {
        if (searchQuery) {
            const searchLower = searchQuery.toLowerCase();
            return (
                guest.name.toLowerCase().includes(searchLower) ||
                (guest.phone && guest.phone.toLowerCase().includes(searchLower)) ||
                (guest.email && guest.email.toLowerCase().includes(searchLower))
            );
        }
        return true;
    }) : [];

    const enhancedGuests = filteredGuests.map((guest: any) => {
        const guestReservations = reservations ? reservations.filter((r: any) => {
            const reservation = r.reservation || r;
            return reservation.guestId === guest.id || r.guestId === guest.id;
        }) : [];

        return {
            ...guest,
            reservationCount: guestReservations.length
        };
    });

    const stats = getGuestStatistics();

    if (guestsLoading) {
        return (
            <DashboardLayout>
                <div className="px-4 py-6 lg:px-8">
                    <header className="mb-6">
                        <h2 className="text-2xl font-bold text-gray-800">Guest Database</h2>
                        <p className="text-gray-500 mt-1">Loading guest data...</p>
                    </header>
                    <div className="flex items-center justify-center h-64">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    if (guestsError) {
        console.error('❌ [Guests] Error loading guests:', guestsError);

        return (
            <DashboardLayout>
                <div className="px-4 py-6 lg:px-8">
                    <header className="mb-6">
                        <h2 className="text-2xl font-bold text-gray-800">Guest Database</h2>
                        <p className="text-red-500 mt-1">Error loading guest data. Please try refreshing the page.</p>
                    </header>
                    <div className="text-center py-12 text-gray-500">
                        <Users className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                        <p>Unable to load guest data</p>
                        <p className="text-sm mt-2">Check your connection and try again</p>
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
                        <h2 className="text-2xl font-bold text-gray-800">Guest Database</h2>
                        <p className="text-gray-500 mt-1">
                            Manage your restaurant guests and their preferences
                            {restaurantTimezone && (
                                <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                    {restaurantTimezone}
                                </span>
                            )}
                        </p>
                    </div>
                    <div className="mt-4 md:mt-0 flex flex-wrap gap-2">
                        <Button onClick={handleAddGuest}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add Guest
                        </Button>
                        <Button variant="outline" onClick={exportGuests} disabled={!guests || guests.length === 0}>
                            <Download className="mr-2 h-4 w-4" />
                            Export
                        </Button>
                    </div>
                </header>

                <Card className="mb-6">
                    <CardHeader className="pb-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between space-y-2 sm:space-y-0">
                            <CardTitle>All Guests ({filteredGuests.length})</CardTitle>
                            <div className="relative w-full sm:w-[300px]">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                                <Input
                                    type="search"
                                    placeholder="Search by name, phone or email..."
                                    className="pl-8 w-full"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Guest</TableHead>
                                        <TableHead>Contact</TableHead>
                                        <TableHead>Language</TableHead>
                                        <TableHead>Birthday</TableHead>
                                        <TableHead>Tags</TableHead>
                                        <TableHead>Bookings</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {enhancedGuests.length > 0 ? (
                                        enhancedGuests.map((guest: any) => (
                                            // ✅ REFACTOR: Make the entire row clickable to open the analytics drawer
                                            <TableRow
                                                key={guest.id}
                                                onClick={() => setSelectedGuestForAnalytics(guest)}
                                                className="cursor-pointer hover:bg-muted/50"
                                            >
                                                <TableCell>
                                                    <div className="flex items-center">
                                                        <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-700">
                                                            <User className="h-5 w-5" />
                                                        </div>
                                                        <div className="ml-4">
                                                            <div className="font-medium">{guest.name}</div>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col">
                                                        <div className="flex items-center text-sm">
                                                            <Phone className="h-4 w-4 mr-1" />
                                                            {guest.phone || 'No phone'}
                                                        </div>
                                                        {guest.email && (
                                                            <div className="text-sm text-muted-foreground mt-1">
                                                                {guest.email}
                                                            </div>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className="uppercase">
                                                        {guest.language || 'EN'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    {guest.birthday ? (
                                                        <div className="flex items-center text-sm">
                                                            <CalendarDays className="h-4 w-4 mr-1" />
                                                            {(() => {
                                                                try {
                                                                    return DateTime.fromISO(guest.birthday).toFormat('MMM d');
                                                                } catch (error) {
                                                                    return guest.birthday;
                                                                }
                                                            })()}
                                                        </div>
                                                    ) : (
                                                        <span className="text-gray-400 text-sm">Not set</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    {guest.tags && guest.tags.length > 0 ? (
                                                        <div className="flex flex-wrap gap-1">
                                                            {guest.tags.map((tag: string, i: number) => (
                                                                <Badge key={i} variant="secondary" className="text-xs">
                                                                    {tag}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <span className="text-gray-400 text-sm">No tags</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={guest.reservationCount > 0 ? "default" : "outline"}>
                                                        {guest.reservationCount || 0}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {/* ✅ REFACTOR: Add a dedicated "View" button for clarity */}
                                                    <div className="flex justify-end space-x-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={(e) => { e.stopPropagation(); setSelectedGuestForAnalytics(guest); }}
                                                            className="text-gray-600 hover:text-gray-900"
                                                        >
                                                            <Eye size={16} />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={(e) => { e.stopPropagation(); handleEditGuest(guest); }}
                                                            className="text-blue-600 hover:text-blue-900"
                                                        >
                                                            <Edit size={16} />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={(e) => { e.stopPropagation(); handleDeleteGuest(guest.id); }}
                                                            className="text-red-600 hover:text-red-900"
                                                        >
                                                            <Trash2 size={16} />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center py-6 text-gray-500">
                                                {searchQuery ? "No guests match your search" : "No guests have been added yet"}
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center">
                                <Tag className="h-5 w-5 mr-2" />
                                <span>Guest Tags</span>
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-gray-500 mb-4">
                                Common guest tags for preferences and special occasions:
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <Badge variant="secondary">VIP</Badge>
                                <Badge variant="secondary">Regular</Badge>
                                <Badge variant="secondary">Vegetarian</Badge>
                                <Badge variant="secondary">Vegan</Badge>
                                <Badge variant="secondary">Gluten-Free</Badge>
                                <Badge variant="secondary">Allergies</Badge>
                                <Badge variant="secondary">Wine Lover</Badge>
                                <Badge variant="secondary">Birthday</Badge>
                                <Badge variant="secondary">Anniversary</Badge>
                                <Badge variant="secondary">Business</Badge>
                                <Badge variant="secondary">Family</Badge>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Guest Statistics</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                <div>
                                    <div className="text-sm font-medium text-gray-500 mb-1">Total Guests</div>
                                    <div className="text-2xl font-bold">{stats.total}</div>
                                </div>

                                <div>
                                    <div className="text-sm font-medium text-gray-500 mb-1">With Bookings</div>
                                    <div className="text-2xl font-bold">{stats.withBookings}</div>
                                </div>

                                <div>
                                    <div className="text-sm font-medium text-gray-500 mb-1">With Birthday Info</div>
                                    <div className="text-2xl font-bold">{stats.withBirthday}</div>
                                </div>

                                <div>
                                    <div className="text-sm font-medium text-gray-500 mb-1">With Email</div>
                                    <div className="text-2xl font-bold">{stats.withEmail}</div>
                                </div>

                                <div>
                                    <div className="text-sm font-medium text-gray-500 mb-1">Avg Bookings</div>
                                    <div className="text-2xl font-bold">{stats.avgBookings}</div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Guest Management Tips</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ul className="space-y-2 text-sm text-gray-500">
                                <li className="flex items-start">
                                    <span className="mr-2">•</span>
                                    <span>Collect birthdays for special offers</span>
                                </li>
                                <li className="flex items-start">
                                    <span className="mr-2">•</span>
                                    <span>Add tags to track preferences and allergies</span>
                                </li>
                                <li className="flex items-start">
                                    <span className="mr-2">•</span>
                                    <span>Use language preferences for international guests</span>
                                </li>
                                <li className="flex items-start">
                                    <span className="mr-2">•</span>
                                    <span>Export guest lists for marketing campaigns</span>
                                </li>
                                <li className="flex items-start">
                                    <span className="mr-2">•</span>
                                    <span>Add detailed notes about preferences</span>
                                </li>
                            </ul>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <Dialog open={isGuestModalOpen} onOpenChange={setIsGuestModalOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{selectedGuestId ? "Edit Guest" : "Add New Guest"}</DialogTitle>
                    </DialogHeader>

                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Guest Name</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Full Name" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="phone"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Phone Number</FormLabel>
                                        <FormControl>
                                            <Input placeholder="+1 (555) 123-4567" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Email (Optional)</FormLabel>
                                        <FormControl>
                                            <Input placeholder="guest@example.com" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="language"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Language</FormLabel>
                                            <Select
                                                onValueChange={field.onChange}
                                                defaultValue={field.value}
                                                value={field.value}
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select language" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="en">English</SelectItem>
                                                    <SelectItem value="es">Spanish</SelectItem>
                                                    <SelectItem value="fr">French</SelectItem>
                                                    <SelectItem value="de">German</SelectItem>
                                                    <SelectItem value="it">Italian</SelectItem>
                                                    <SelectItem value="ru">Russian</SelectItem>
                                                    <SelectItem value="zh">Chinese</SelectItem>
                                                    <SelectItem value="ja">Japanese</SelectItem>
                                                    <SelectItem value="sr">Serbian</SelectItem>
                                                    <SelectItem value="hu">Hungarian</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="birthday"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Birthday (Optional)</FormLabel>
                                            <FormControl>
                                                <Input type="date" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <FormField
                                control={form.control}
                                name="tags"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Tags (Optional)</FormLabel>
                                        <FormControl>
                                            <Input placeholder="VIP, Vegetarian, Regular (comma separated)" {...field} />
                                        </FormControl>
                                        <FormDescription>
                                            Enter tags separated by commas
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="comments"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Comments (Optional)</FormLabel>
                                        <FormControl>
                                            <Textarea
                                                placeholder="Special notes or preferences"
                                                className="resize-none"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <DialogFooter className="mt-6">
                                <Button type="button" variant="outline" onClick={() => setIsGuestModalOpen(false)}>
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={createGuestMutation.isPending || updateGuestMutation.isPending}
                                >
                                    {createGuestMutation.isPending || updateGuestMutation.isPending ?
                                        "Saving..." :
                                        selectedGuestId ? "Update Guest" : "Add Guest"
                                    }
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete the guest and their data. Reservations associated with this guest will be affected. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
                            {deleteGuestMutation.isPending ? "Deleting..." : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* ✅ NEW: Render the analytics drawer component */}
            <GuestAnalyticsDrawer
                guest={selectedGuestForAnalytics}
                isOpen={!!selectedGuestForAnalytics}
                onClose={() => setSelectedGuestForAnalytics(null)}
            />
        </DashboardLayout>
    );
}
