import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { Users } from 'lucide-react';

// This interface should match the one in FloorPlanView.tsx.
// It's a good idea to move this to a shared types file later.
interface TableData {
    id: number;
    name: string;
    minGuests: number;
    maxGuests: number;
    status: string;
    shape: 'square' | 'round';
    reservation?: {
        guestName: string;
        guestCount: number;
    };
}

/**
 * Determines the styling for a table based on its status and whether it has a reservation.
 * @param status - The current status of the table (e.g., 'free', 'occupied').
 * @param hasReservation - Boolean indicating if there's a reservation.
 * @returns A string of Tailwind CSS classes.
 */
const getStatusStyle = (status: string, hasReservation?: boolean) => {
    if (hasReservation) {
        return "bg-gradient-to-br from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25";
    }
    // You can expand this with more statuses from your schema if needed
    switch (status) {
        case 'available':
        case 'free':
            return "bg-gradient-to-br from-green-500 to-green-600 text-white shadow-lg shadow-green-500/25";
        case 'occupied':
            return "bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/25";
        default:
            return "bg-gradient-to-br from-gray-400 to-gray-500 text-white shadow-lg shadow-gray-400/25";
    }
};

/**
 * A component representing a single draggable table on the floor plan.
 */
export function DraggableTable({ table }: { table: TableData }) {
  // useDraggable is a hook from @dnd-kit that provides the necessary props to make an element draggable.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: table.id, // The unique ID for this draggable item.
  });

  // The 'transform' object provides the x/y translation during a drag operation.
  // We use this to create a smooth dragging animation.
  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : {};

  return (
    <div
      ref={setNodeRef} // Assigns the ref to the DOM node for dnd-kit to track.
      style={style}
      // Listeners and attributes are spread onto the element to handle drag events (mousedown, touchstart, etc.).
      {...listeners} 
      {...attributes}
      className={cn(
        // Base styles for all tables
        "w-24 h-24 p-2 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing transition-all duration-200",
        // Dynamic styles based on status and shape
        getStatusStyle(table.status, !!table.reservation),
        table.shape === 'round' ? 'rounded-full' : 'rounded-lg',
        // Styles applied only when the table is being dragged
        isDragging && "z-10 scale-110 shadow-2xl opacity-80 ring-2 ring-white"
      )}
    >
      <div className="font-bold text-sm">{table.name}</div>
      <div className="text-xs opacity-80 flex items-center justify-center gap-1 mt-1">
          <Users className="h-3 w-3" />
          {table.minGuests}-{table.maxGuests}
      </div>
      {table.reservation && (
          <div className="text-xs opacity-70 mt-1 truncate" title={table.reservation.guestName}>
              {table.reservation.guestName}
          </div>
      )}
    </div>
  );
}
