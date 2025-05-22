import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, isSameMonth } from 'date-fns';

interface RollingCalendarProps {
  selectedDates?: Date[];
  onDateSelect?: (dates: Date[]) => void;
  capacityData?: Record<string, { reservations: number; capacity: number; peakTime?: string }>;
  className?: string;
}

interface DateCellProps {
  date: Date;
  isSelected: boolean;
  isToday: boolean;
  isCurrentMonth: boolean;
  capacity?: { reservations: number; capacity: number; peakTime?: string };
  onClick: () => void;
  onHover?: () => void;
  onLeave?: () => void;
}

function getCapacityLevel(reservations: number, capacity: number): 'light' | 'medium' | 'busy' | 'full' | 'none' {
  if (capacity === 0) return 'none';
  const percentage = (reservations / capacity) * 100;
  if (percentage <= 40) return 'light';
  if (percentage <= 70) return 'medium';
  if (percentage <= 90) return 'busy';
  return 'full';
}

function getCapacityColor(level: string): string {
  switch (level) {
    case 'light': return 'bg-green-100 hover:bg-green-200';
    case 'medium': return 'bg-amber-100 hover:bg-amber-200';
    case 'busy': return 'bg-orange-100 hover:bg-orange-200';
    case 'full': return 'bg-red-100 hover:bg-red-200';
    default: return 'bg-gray-50 hover:bg-gray-100';
  }
}

const DateCell: React.FC<DateCellProps> = ({
  date,
  isSelected,
  isToday,
  isCurrentMonth,
  capacity,
  onClick,
  onHover,
  onLeave
}) => {
  const level = capacity ? getCapacityLevel(capacity.reservations, capacity.capacity) : 'none';
  const capacityPercentage = capacity && capacity.capacity > 0 
    ? Math.round((capacity.reservations / capacity.capacity) * 100) 
    : 0;

  return (
    <div
      className={cn(
        "relative w-8 h-8 flex items-center justify-center text-sm cursor-pointer transition-all duration-200 rounded",
        getCapacityColor(level),
        {
          'bg-blue-500 text-white hover:bg-blue-600': isSelected,
          'ring-2 ring-blue-400 ring-offset-1': isToday,
          'text-gray-400': !isCurrentMonth,
          'font-semibold': isToday,
        }
      )}
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      title={capacity ? `${capacity.reservations} reservations (${capacityPercentage}% capacity)` : undefined}
    >
      <span className="relative z-10">{format(date, 'd')}</span>
      {capacity && capacity.reservations > 0 && (
        <div
          className="absolute inset-0 rounded opacity-30"
          style={{
            backgroundImage: `linear-gradient(to top, currentColor ${capacityPercentage}%, transparent ${capacityPercentage}%)`
          }}
        />
      )}
    </div>
  );
};

export const RollingCalendar: React.FC<RollingCalendarProps> = ({
  selectedDates = [],
  onDateSelect,
  capacityData = {},
  className
}) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [hoveredDate, setHoveredDate] = useState<Date | null>(null);

  const currentMonth = startOfMonth(currentDate);
  const nextMonth = startOfMonth(addMonths(currentDate, 1));

  const currentMonthDays = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });

  const nextMonthDays = eachDayOfInterval({
    start: startOfMonth(nextMonth),
    end: endOfMonth(nextMonth)
  });

  const navigatePrevious = () => {
    setCurrentDate(subMonths(currentDate, 1));
  };

  const navigateNext = () => {
    setCurrentDate(addMonths(currentDate, 1));
  };

  const handleDateClick = (date: Date, isCtrlKey = false) => {
    if (!onDateSelect) return;

    if (isCtrlKey) {
      // Multi-select mode
      const isAlreadySelected = selectedDates.some(d => isSameDay(d, date));
      if (isAlreadySelected) {
        onDateSelect(selectedDates.filter(d => !isSameDay(d, date)));
      } else {
        onDateSelect([...selectedDates, date]);
      }
    } else {
      // Single select mode
      const isAlreadySelected = selectedDates.some(d => isSameDay(d, date));
      if (isAlreadySelected && selectedDates.length === 1) {
        onDateSelect([]);
      } else {
        onDateSelect([date]);
      }
    }
  };

  const clearSelection = () => {
    onDateSelect?.([]);
  };

  const quickSelectToday = () => {
    onDateSelect?.([new Date()]);
  };

  const quickSelectThisWeek = () => {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    
    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      return date;
    });
    
    onDateSelect?.(weekDates);
  };

  const quickSelectNextWeek = () => {
    const today = new Date();
    const startOfNextWeek = new Date(today);
    startOfNextWeek.setDate(today.getDate() - today.getDay() + 7);
    
    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(startOfNextWeek);
      date.setDate(startOfNextWeek.getDate() + i);
      return date;
    });
    
    onDateSelect?.(weekDates);
  };

  const renderMonth = (monthDays: Date[], isCurrentMonth: boolean) => {
    const monthStart = monthDays[0];
    const monthName = format(monthStart, 'MMMM yyyy');

    return (
      <div className="flex-1">
        <div className="text-center font-semibold text-gray-900 mb-4">
          {monthName}
        </div>
        
        {/* Weekday headers */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
            <div key={day} className="text-center text-xs font-medium text-gray-500 py-1">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {monthDays.map(date => {
            const dateKey = format(date, 'yyyy-MM-dd');
            const capacity = capacityData[dateKey];
            const isSelected = selectedDates.some(d => isSameDay(d, date));

            return (
              <DateCell
                key={dateKey}
                date={date}
                isSelected={isSelected}
                isToday={isToday(date)}
                isCurrentMonth={isSameMonth(date, monthStart)}
                capacity={capacity}
                onClick={(e: any) => handleDateClick(date, e?.ctrlKey || e?.metaKey)}
                onHover={() => setHoveredDate(date)}
                onLeave={() => setHoveredDate(null)}
              />
            );
          })}
        </div>
      </div>
    );
  };

  const formatSelectionText = () => {
    if (selectedDates.length === 0) return '';
    if (selectedDates.length === 1) {
      return format(selectedDates[0], 'MMM d, yyyy');
    }
    return `${selectedDates.length} selected dates`;
  };

  return (
    <div className={cn("bg-white rounded-lg border p-6", className)}>
      {/* Navigation Header */}
      <div className="flex items-center justify-between mb-6">
        <Button
          variant="outline"
          size="sm"
          onClick={navigatePrevious}
          className="h-8 w-8 p-0"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={quickSelectToday}
            className="text-xs"
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={quickSelectThisWeek}
            className="text-xs"
          >
            This Week
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={quickSelectNextWeek}
            className="text-xs"
          >
            Next Week
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={navigateNext}
          className="h-8 w-8 p-0"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Selection Display */}
      {selectedDates.length > 0 && (
        <div className="flex items-center justify-center gap-2 mb-4 p-2 bg-blue-50 rounded">
          <span className="text-sm text-blue-900">
            Selected: {formatSelectionText()}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearSelection}
            className="h-6 w-6 p-0 text-blue-600 hover:text-blue-800"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Two-Month Calendar Grid */}
      <div className="flex gap-8">
        {renderMonth(currentMonthDays, true)}
        {renderMonth(nextMonthDays, false)}
      </div>

      {/* Capacity Legend */}
      <div className="mt-6 pt-4 border-t">
        <div className="flex items-center justify-center gap-4 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-green-100 rounded"></div>
            <span>Light (0-40%)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-amber-100 rounded"></div>
            <span>Medium (41-70%)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-orange-100 rounded"></div>
            <span>Busy (71-90%)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-red-100 rounded"></div>
            <span>Full (91-100%)</span>
          </div>
        </div>
      </div>

      {/* Hover Tooltip */}
      {hoveredDate && capacityData[format(hoveredDate, 'yyyy-MM-dd')] && (
        <div className="mt-2 p-2 bg-gray-900 text-white text-xs rounded text-center">
          <div>{format(hoveredDate, 'MMMM d, yyyy')}</div>
          <div>
            {capacityData[format(hoveredDate, 'yyyy-MM-dd')]?.reservations} reservations
          </div>
          <div>
            {Math.round((capacityData[format(hoveredDate, 'yyyy-MM-dd')]?.reservations || 0) / 
            (capacityData[format(hoveredDate, 'yyyy-MM-dd')]?.capacity || 1) * 100)}% capacity
          </div>
          {capacityData[format(hoveredDate, 'yyyy-MM-dd')]?.peakTime && (
            <div>Peak: {capacityData[format(hoveredDate, 'yyyy-MM-dd')]?.peakTime}</div>
          )}
        </div>
      )}
    </div>
  );
};