import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
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
import { format, parse } from "date-fns";
import { Search, Plus, Edit, Trash2, Download, CalendarDays, User, Phone, Tag } from "lucide-react";

// In a real application, you would get the restaurant ID from context
const restaurantId = 1;

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
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  const { data: guests, isLoading } = useQuery({
    queryKey: ["/api/guests"],
  });

  const createGuestMutation = useMutation({
    mutationFn: async (values: GuestFormValues) => {
      // Convert tags from comma-separated string to array if provided
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
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Guest created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/guests'] });
      setIsGuestModalOpen(false);
      form.reset();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to create guest: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const updateGuestMutation = useMutation({
    mutationFn: async ({ id, values }: { id: number; values: GuestFormValues }) => {
      // Convert tags from comma-separated string to array if provided
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
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Guest updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/guests'] });
      setIsGuestModalOpen(false);
      form.reset();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update guest: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const deleteGuestMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("DELETE", `/api/guests/${id}`, undefined);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Guest deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/guests'] });
      setDeleteConfirmOpen(false);
    },
    onError: (error) => {
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

    // Create CSV content
    const headers = ["Name", "Phone", "Email", "Language", "Birthday", "Tags", "Comments"];
    const rows = guests.map((guest: any) => [
      guest.name,
      guest.phone,
      guest.email || '',
      guest.language || 'en',
      guest.birthday || '',
      guest.tags ? guest.tags.join(', ') : '',
      guest.comments || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    // Create a blob and download it
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `guests_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredGuests = guests ? guests.filter((guest: any) => {
    if (searchQuery) {
      const searchLower = searchQuery.toLowerCase();
      return (
        guest.name.toLowerCase().includes(searchLower) ||
        guest.phone.toLowerCase().includes(searchLower) ||
        (guest.email && guest.email.toLowerCase().includes(searchLower))
      );
    }
    return true;
  }) : [];

  return (
    <DashboardLayout>
      <div className="px-4 py-6 lg:px-8">
        <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Guest Database</h2>
            <p className="text-gray-500 mt-1">Manage your restaurant guests and their preferences</p>
          </div>
          <div className="mt-4 md:mt-0 flex flex-wrap gap-2">
            <Button onClick={handleAddGuest}>
              <Plus className="mr-2 h-4 w-4" />
              Add Guest
            </Button>
            <Button variant="outline" onClick={exportGuests}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        </header>

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between space-y-2 sm:space-y-0">
              <CardTitle>All Guests</CardTitle>
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
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center">
                        <div className="flex justify-center py-4">
                          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-900 border-t-transparent"></div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : filteredGuests.length > 0 ? (
                    filteredGuests.map((guest: any) => (
                      <TableRow key={guest.id}>
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
                              {guest.phone}
                            </div>
                            {guest.email && (
                              <div className="text-sm text-gray-500 mt-1">
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
                              {format(new Date(guest.birthday), 'MMM d')}
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
                          <Badge>{guest.reservationCount || 0}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end space-x-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEditGuest(guest)}
                              className="text-blue-600 hover:text-blue-900"
                            >
                              <Edit size={16} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteGuest(guest.id)}
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
                  <div className="text-2xl font-bold">{guests ? guests.length : 0}</div>
                </div>
                
                <div>
                  <div className="text-sm font-medium text-gray-500 mb-1">With Birthday Info</div>
                  <div className="text-2xl font-bold">
                    {guests ? guests.filter((g: any) => g.birthday).length : 0}
                  </div>
                </div>
                
                <div>
                  <div className="text-sm font-medium text-gray-500 mb-1">With Email</div>
                  <div className="text-2xl font-bold">
                    {guests ? guests.filter((g: any) => g.email).length : 0}
                  </div>
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

      {/* Guest Form Modal */}
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

      {/* Delete Confirmation Dialog */}
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
    </DashboardLayout>
  );
}
