import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';

export function DroppableSlot({ 
  id, 
  data, 
  children 
}: { 
  id: string;
  data: object;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: id,
    data: data, // Pass extra data about the table/time here
  });

  return (
    <div 
      ref={setNodeRef} 
      className={cn(
        "h-full w-full", 
        isOver && "outline-2 outline-dashed outline-blue-500 rounded-lg"
      )}
    >
      {children}
    </div>
  );
}