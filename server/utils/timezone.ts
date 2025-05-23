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