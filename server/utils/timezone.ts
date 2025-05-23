/**
 * Moscow Timezone Utilities for ToBeOut Restaurant System
 * 
 * Ensures all date operations use Moscow timezone consistently
 * across the entire application (frontend, backend, and AI services)
 */

export const MOSCOW_TIMEZONE = 'Europe/Moscow';

/**
 * Get current date and time in Moscow timezone
 */
export function getMoscowDate(): Date {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", {timeZone: MOSCOW_TIMEZONE}));
}

/**
 * Get current date string in Moscow timezone (YYYY-MM-DD format)
 */
export function getMoscowDateString(): string {
  return getMoscowDate().toISOString().split('T')[0];
}

/**
 * Get tomorrow's date string in Moscow timezone (YYYY-MM-DD format)
 */
export function getMoscowTomorrowString(): string {
  const tomorrow = getMoscowDate();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

/**
 * Get current Moscow time information for AI context
 */
export function getMoscowTimeContext() {
  const now = getMoscowDate();
  const today = getMoscowDateString();
  const tomorrow = getMoscowTomorrowString();
  
  return {
    currentTime: now,
    todayDate: today,
    tomorrowDate: tomorrow,
    timezone: MOSCOW_TIMEZONE,
    hour: now.getHours(),
    minute: now.getMinutes(),
    dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long', timeZone: MOSCOW_TIMEZONE })
  };
}

/**
 * Format time consistently in 24-hour format (HH:mm)
 * Converts any time input to standard format: 10:00, 11:00, 12:00...23:00, 00:00
 */
export function formatTime24Hour(time: string | Date): string {
  if (time instanceof Date) {
    const hours = time.getHours().toString().padStart(2, '0');
    const minutes = time.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  
  // Handle string input
  const timeStr = time.toString();
  
  // If already in HH:mm or HH:mm:ss format, extract hours and minutes
  if (timeStr.includes(':')) {
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours, 10);
    const m = parseInt(minutes || '0', 10);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }
  
  // If just hour number
  const hour = parseInt(timeStr, 10);
  if (!isNaN(hour)) {
    return `${hour.toString().padStart(2, '0')}:00`;
  }
  
  return '00:00'; // fallback
}

/**
 * Generate time slots in 24-hour format for given range
 * Returns array of times like ["10:00", "11:00", "12:00", ...]
 */
export function generateTimeSlots(startTime: string = "10:00", endTime: string = "23:00"): string[] {
  const slots: string[] = [];
  const [startHour] = startTime.split(':').map(Number);
  const [endHour] = endTime.split(':').map(Number);
  
  for (let hour = startHour; hour <= endHour; hour++) {
    slots.push(formatTime24Hour(hour.toString()));
  }
  
  return slots;
}