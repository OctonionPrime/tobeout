import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Edit, Trash2, Users, Terminal } from "lucide-react";

// In a real application, you would get the restaurant ID from context
const restaurantId = 1;

const tableFormSchema = z.object({
  name: z.string().min(1, "Table name is required"),
  minGuests: z.number().min(1, "Minimum 1 guest").default(1),
  maxGuests: z.number().min(1, "Minimum 1 guest").max(20, "Maximum 20 guests"),
  features: z.string().optional(),
  comments: z.string().optional(),
});

type TableFormValues = z.infer<typeof tableFormSchema>;

export default function Tables() {
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<number | undefined>(undefined);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [tableToDelete, setTableToDelete] = useState<number | undefined>(undefined);
  const [activeView, setActiveView] = useState<"grid" | "list" | "floorplan">("grid");
  const [draggedTable, setDraggedTable] = useState<any>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<TableFormValues>({
    resolver: zodResolver(tableFormSchema),
    defaultValues: {
      name: "",
      minGuests: 1,
      maxGuests: 4,
      features: "",
      comments: "",
    },
  });

  const { data: tables, isLoading } = useQuery({
    queryKey: [`/api/tables?restaurantId=${restaurantId}`],
  });

  const createTableMutation = useMutation({
    mutationFn: async (values: TableFormValues) => {
      // Convert features from comma-separated string to array if provided
      const featuresArray = values.features ? values.features.split(',').map(f => f.trim()) : undefined;
      
      const response = await apiRequest("POST", "/api/tables", {
        restaurantId,
        name: values.name,
        minGuests: values.minGuests,
        maxGuests: values.maxGuests,
        features: featuresArray,
        comments: values.comments,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Table created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tables'] });
      setIsTableModalOpen(false);
      form.reset();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to create table: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const updateTableMutation = useMutation({
    mutationFn: async ({ id, values }: { id: number; values: TableFormValues }) => {
      // Convert features from comma-separated string to array if provided
      const featuresArray = values.features ? values.features.split(',').map(f => f.trim()) : undefined;
      
      const response = await apiRequest("PATCH", `/api/tables/${id}`, {
        name: values.name,
        minGuests: values.minGuests,
        maxGuests: values.maxGuests,
        features: featuresArray,
        comments: values.comments,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Table updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tables'] });
      setIsTableModalOpen(false);
      form.reset();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update table: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const deleteTableMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("DELETE", `/api/tables/${id}`, undefined);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Table deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tables'] });
      setDeleteConfirmOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to delete table: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const onSubmit = (values: TableFormValues) => {
    if (selectedTableId) {
      updateTableMutation.mutate({ id: selectedTableId, values });
    } else {
      createTableMutation.mutate(values);
    }
  };

  const handleAddTable = () => {
    setSelectedTableId(undefined);
    form.reset({
      name: "",
      minGuests: 1,
      maxGuests: 4,
      features: "",
      comments: "",
    });
    setIsTableModalOpen(true);
  };

  const handleEditTable = (table: any) => {
    setSelectedTableId(table.id);
    form.reset({
      name: table.name,
      minGuests: table.minGuests,
      maxGuests: table.maxGuests,
      features: table.features ? table.features.join(', ') : '',
      comments: table.comments || '',
    });
    setIsTableModalOpen(true);
  };

  const handleDeleteTable = (id: number) => {
    setTableToDelete(id);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (tableToDelete) {
      deleteTableMutation.mutate(tableToDelete);
    }
  };

  const handleDragStart = (e: React.DragEvent, table: any) => {
    setDraggedTable(table);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedTable) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // Update table position (you could save this to database)
      setDragPosition({ x, y });
      
      toast({
        title: "Table Moved",
        description: `${draggedTable.name} repositioned on floor plan`,
      });
      
      setDraggedTable(null);
    }
  };

  const getTableStatusColor = (status: string) => {
    switch (status) {
      case 'free':
        return "bg-green-100 text-green-800 border-green-200";
      case 'occupied':
        return "bg-red-100 text-red-800 border-red-200";
      case 'reserved':
        return "bg-amber-100 text-amber-800 border-amber-200";
      case 'unavailable':
        return "bg-gray-100 text-gray-800 border-gray-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const generateTimeslotsForToday = async () => {
    try {
      const response = await apiRequest("POST", "/api/timeslots/generate?days=1", { restaurantId });
      const data = await response.json();
      
      toast({
        title: "Success",
        description: data.message || "Timeslots generated successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to generate timeslots: ${error.message}`,
        variant: "destructive",
      });
    }
  };

  return (
    <DashboardLayout>
      <div className="px-4 py-6 lg:px-8">
        <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Tables Management</h2>
            <p className="text-gray-500 mt-1">Configure and manage your restaurant tables</p>
          </div>
          <div className="mt-4 md:mt-0 flex flex-wrap gap-2">
            <Button onClick={handleAddTable}>
              <Plus className="mr-2 h-4 w-4" />
              Add Table
            </Button>
            <Button variant="outline" onClick={generateTimeslotsForToday}>
              <Terminal className="mr-2 h-4 w-4" />
              Generate Timeslots
            </Button>
          </div>
        </header>

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>Restaurant Tables</CardTitle>
              <Tabs value={activeView} onValueChange={(v) => setActiveView(v as "grid" | "list" | "floorplan")} className="w-[300px]">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="grid">Grid</TabsTrigger>
                  <TabsTrigger value="list">List</TabsTrigger>
                  <TabsTrigger value="floorplan">Floor Plan</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent>
            {activeView === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="aspect-square animate-pulse bg-gray-100 rounded-lg"></div>
                  ))
                ) : tables && tables.length > 0 ? (
                  tables.map((table: any) => {
                    const statusClass = getTableStatusColor(table.status);
                    return (
                      <div 
                        key={table.id} 
                        className={`aspect-square ${statusClass} rounded-lg flex flex-col items-center justify-center p-2 border relative group`}
                      >
                        <span className="text-sm font-semibold">{table.name}</span>
                        <div className="flex items-center justify-center mt-1">
                          <Users className="h-4 w-4 mr-1" />
                          <span className="text-xs">{table.minGuests}-{table.maxGuests}</span>
                        </div>
                        <span className="text-xs mt-1 capitalize">{table.status || 'free'}</span>
                        
                        {/* Features badges */}
                        {table.features && table.features.length > 0 && (
                          <div className="mt-2 flex flex-wrap justify-center gap-1">
                            {table.features.slice(0, 2).map((feature: string, index: number) => (
                              <Badge key={index} variant="outline" className="text-[10px] py-0 px-1">
                                {feature}
                              </Badge>
                            ))}
                            {table.features.length > 2 && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1">
                                +{table.features.length - 2}
                              </Badge>
                            )}
                          </div>
                        )}
                        
                        {/* Hover actions */}
                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            className="h-8 w-8 bg-white text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            onClick={() => handleEditTable(table)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            className="h-8 w-8 bg-white text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleDeleteTable(table.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="col-span-full py-8 text-center text-gray-500">
                    <p>No tables have been added yet</p>
                    <Button variant="outline" onClick={handleAddTable} className="mt-2">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Your First Table
                    </Button>
                  </div>
                )}
              </div>
            ) : activeView === "floorplan" ? (
              <div className="relative bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg min-h-[500px] overflow-hidden">
                {/* Floor Plan Header */}
                <div className="absolute top-4 left-4 bg-white rounded-lg shadow-sm border p-3">
                  <h3 className="text-sm font-medium text-gray-900 mb-2">Restaurant Floor Plan</h3>
                  <div className="text-xs text-gray-500 space-y-1">
                    <div>• Drag tables to arrange layout</div>
                    <div>• Click tables to edit details</div>
                    <div>• Use grid view for detailed management</div>
                  </div>
                </div>

                {/* Legend */}
                <div className="absolute top-4 right-4 bg-white rounded-lg shadow-sm border p-3">
                  <h4 className="text-xs font-medium text-gray-900 mb-2">Status Legend</h4>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-green-500 rounded"></div>
                      <span className="text-xs text-gray-600">Available</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-red-500 rounded"></div>
                      <span className="text-xs text-gray-600">Occupied</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-amber-500 rounded"></div>
                      <span className="text-xs text-gray-600">Reserved</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-gray-400 rounded"></div>
                      <span className="text-xs text-gray-600">Unavailable</span>
                    </div>
                  </div>
                </div>

                {/* Floor Plan Content */}
                <div 
                  className="pt-32 px-8 pb-8"
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  {isLoading ? (
                    <div className="flex items-center justify-center h-64">
                      <div className="text-center">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-900 border-t-transparent mx-auto mb-4"></div>
                        <p className="text-gray-500">Loading floor plan...</p>
                      </div>
                    </div>
                  ) : tables && tables.length > 0 ? (
                    <div className="relative grid grid-cols-8 gap-4 min-h-[400px]">
                      {tables.map((table: any, index: number) => {
                        const statusColors = {
                          free: 'bg-green-500',
                          occupied: 'bg-red-500',
                          reserved: 'bg-amber-500',
                          unavailable: 'bg-gray-400'
                        };
                        const statusColor = statusColors[table.status as keyof typeof statusColors] || statusColors.free;

                        return (
                          <div
                            key={table.id}
                            draggable
                            className={`relative cursor-move group transform transition-all duration-200 hover:scale-105 ${
                              index % 8 < 4 ? 'col-start-' + (index % 4 + 1) : 'col-start-' + (index % 4 + 5)
                            } ${Math.floor(index / 4) % 2 === 0 ? 'row-start-1' : 'row-start-3'}`}
                            onDragStart={(e) => handleDragStart(e, table)}
                            onClick={() => handleEditTable(table)}
                          >
                            {/* Table Shape */}
                            <div className={`w-16 h-16 ${statusColor} rounded-lg shadow-lg flex items-center justify-center text-white font-bold text-sm border-2 border-white`}>
                              {table.name}
                            </div>
                            
                            {/* Table Info Tooltip */}
                            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                              <div className="bg-gray-900 text-white text-xs rounded-lg py-2 px-3 whitespace-nowrap">
                                <div className="font-medium">{table.name}</div>
                                <div>{table.minGuests}-{table.maxGuests} guests</div>
                                <div className="capitalize">{table.status || 'free'}</div>
                                {table.features && table.features.length > 0 && (
                                  <div className="text-gray-300 mt-1">
                                    {table.features.slice(0, 2).join(', ')}
                                    {table.features.length > 2 && '...'}
                                  </div>
                                )}
                              </div>
                              <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                            </div>

                            {/* Capacity Indicator */}
                            <div className="absolute -top-1 -right-1 bg-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-medium text-gray-700 shadow-sm border">
                              {table.maxGuests}
                            </div>

                            {/* Features Indicator */}
                            {table.features && table.features.length > 0 && (
                              <div className="absolute -bottom-1 -right-1 bg-blue-500 rounded-full w-4 h-4 flex items-center justify-center text-xs font-medium text-white shadow-sm">
                                {table.features.length}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-64">
                      <div className="text-center">
                        <div className="w-16 h-16 bg-gray-200 rounded-lg mx-auto mb-4 flex items-center justify-center">
                          <Plus className="h-8 w-8 text-gray-400" />
                        </div>
                        <p className="text-gray-500 mb-4">No tables in your floor plan yet</p>
                        <Button onClick={handleAddTable}>
                          <Plus className="mr-2 h-4 w-4" />
                          Add Your First Table
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-md border">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Capacity</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Features</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Comments</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {isLoading ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-4 text-center">
                            <div className="flex justify-center">
                              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-900 border-t-transparent"></div>
                            </div>
                          </td>
                        </tr>
                      ) : tables && tables.length > 0 ? (
                        tables.map((table: any) => (
                          <tr key={table.id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {table.name}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {table.minGuests} - {table.maxGuests} guests
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <Badge 
                                className={`capitalize ${
                                  table.status === 'free' ? 'bg-green-100 text-green-800' :
                                  table.status === 'occupied' ? 'bg-red-100 text-red-800' : 
                                  table.status === 'reserved' ? 'bg-amber-100 text-amber-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}
                              >
                                {table.status || 'free'}
                              </Badge>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {table.features && table.features.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {table.features.map((feature: string, index: number) => (
                                    <Badge key={index} variant="outline" className="text-xs">
                                      {feature}
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-gray-400">None</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {table.comments || <span className="text-gray-400">No comments</span>}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <div className="flex justify-end space-x-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEditTable(table)}
                                  className="text-blue-600 hover:text-blue-900"
                                >
                                  <Edit size={16} />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteTable(table.id)}
                                  className="text-red-600 hover:text-red-900"
                                >
                                  <Trash2 size={16} />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                            No tables have been added yet
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Table Status Legend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center">
                  <div className="w-4 h-4 bg-green-100 border border-green-200 rounded-full mr-2"></div>
                  <span className="text-sm text-gray-700">Free: Available for reservations</span>
                </div>
                <div className="flex items-center">
                  <div className="w-4 h-4 bg-amber-100 border border-amber-200 rounded-full mr-2"></div>
                  <span className="text-sm text-gray-700">Reserved: Booked for future use</span>
                </div>
                <div className="flex items-center">
                  <div className="w-4 h-4 bg-red-100 border border-red-200 rounded-full mr-2"></div>
                  <span className="text-sm text-gray-700">Occupied: Currently in use</span>
                </div>
                <div className="flex items-center">
                  <div className="w-4 h-4 bg-gray-100 border border-gray-200 rounded-full mr-2"></div>
                  <span className="text-sm text-gray-700">Unavailable: Not available for booking</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Table Features</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500 mb-4">
                Common table features that can be used for filtering and requests:
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Window</Badge>
                <Badge variant="outline">Quiet</Badge>
                <Badge variant="outline">Bar</Badge>
                <Badge variant="outline">Patio</Badge>
                <Badge variant="outline">Booth</Badge>
                <Badge variant="outline">Corner</Badge>
                <Badge variant="outline">Private</Badge>
                <Badge variant="outline">High Chair</Badge>
                <Badge variant="outline">Accessible</Badge>
                <Badge variant="outline">Near Kitchen</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Table Management Tips</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-gray-500">
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Create tables with accurate capacity ranges</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Add unique features to help match guest preferences</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Generate timeslots regularly to ensure availability</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Use descriptive names for easier identification</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Update table status manually when needed</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Table Form Modal */}
      <Dialog open={isTableModalOpen} onOpenChange={setIsTableModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedTableId ? "Edit Table" : "Add New Table"}</DialogTitle>
          </DialogHeader>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Table Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Table 1, Window Table" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="minGuests"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Min Guests</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          min={1} 
                          {...field} 
                          onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="maxGuests"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Guests</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          min={1} 
                          max={20} 
                          {...field} 
                          onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <FormField
                control={form.control}
                name="features"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Features</FormLabel>
                    <FormControl>
                      <Input placeholder="Window, Bar, Quiet (comma separated)" {...field} />
                    </FormControl>
                    <FormDescription>
                      Enter features separated by commas
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
                    <FormLabel>Comments</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Additional information about this table"
                        className="resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => setIsTableModalOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createTableMutation.isPending || updateTableMutation.isPending}
                >
                  {createTableMutation.isPending || updateTableMutation.isPending ? 
                    "Saving..." : 
                    selectedTableId ? "Update Table" : "Create Table"
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
              This will permanently delete the table and its associated data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              {deleteTableMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
