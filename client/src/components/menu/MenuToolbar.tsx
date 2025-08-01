import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MenuFilters } from "@/lib/api/menuApi";
import { PlusCircle, X } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce"; // Assuming a debounce hook exists
import { useEffect, useState } from "react";

interface MenuToolbarProps {
  filters: MenuFilters;
  setFilters: React.Dispatch<React.SetStateAction<MenuFilters>>;
  categories: string[];
  onCreate: () => void;
}

export function MenuToolbar({ filters, setFilters, categories, onCreate }: MenuToolbarProps) {
  // Use local state for the search input to allow for debouncing
  const [searchTerm, setSearchTerm] = useState(filters.search || '');
  const debouncedSearchTerm = useDebounce(searchTerm, 300); // Debounce input by 300ms

  // Effect to update the parent filter state when the debounced search term changes
  useEffect(() => {
    setFilters(prev => ({ ...prev, search: debouncedSearchTerm }));
  }, [debouncedSearchTerm, setFilters]);

  const handleCategoryChange = (value: string) => {
    setFilters(prev => ({ ...prev, category: value === 'all' ? undefined : value }));
  };
  
  const clearSearch = () => {
    setSearchTerm('');
  };

  return (
    <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6 p-4 bg-card border rounded-lg">
      <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
        <div className="relative w-full sm:w-auto">
          <Input
            placeholder="Search menu items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-xs pl-4 pr-8"
          />
          {searchTerm && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground"
              onClick={clearSearch}
            >
              <X size={16} />
            </Button>
          )}
        </div>
        <Select
          value={filters.category || 'all'}
          onValueChange={handleCategoryChange}
        >
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(cat => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="w-full md:w-auto">
        <Button onClick={onCreate} className="w-full">
          <PlusCircle className="mr-2 h-4 w-4" />
          Add New Item
        </Button>
      </div>
    </div>
  );
}
