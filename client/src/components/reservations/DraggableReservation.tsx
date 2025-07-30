import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';

export function DraggableReservation({ 
  id, 
  data, 
  children 
}: { 
  id: string | number;
  data: object;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: id,
    data: data, // Pass extra data about the reservation here
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    zIndex: 1000, // Ensure it renders above other elements
  } : undefined;

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...listeners} 
      {...attributes} 
      className={cn(isDragging && "opacity-50")}
    >
      {children}
    </div>
  );
}