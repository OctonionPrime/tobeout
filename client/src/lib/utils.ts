import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { DateTime } from 'luxon';

/**
 * A utility function to merge Tailwind CSS classes conditionally.
 * @param inputs - A list of class values to merge.
 * @returns A string of merged class names.
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

// --- TIMEZONE-AWARE DATE & TIME UTILITIES (Client-Side) ---

/**
 * Gets a Luxon DateTime object representing the current moment in a specific timezone.
 * This is the foundation for all client-side timezone logic.
 * @param timezone - The IANA timezone string (e.g., "Europe/Belgrade", "America/New_York").
 * @returns A Luxon DateTime object. Falls back to the user's local timezone if the provided one is invalid.
 */
export function getRestaurantDateTime(timezone: string): DateTime {
    try {
        // Return the current time, but set to the restaurant's specific timezone
        return DateTime.now().setZone(timezone);
    } catch (e) {
        console.warn(`[Utils] Invalid timezone "${timezone}" provided. Falling back to browser's local timezone.`);
        return DateTime.now();
    }
}

/**
 * Gets a date string in 'YYYY-MM-DD' format for the current day in a specific timezone.
 * This is useful for API calls that require a date string.
 * @param timezone - The IANA timezone string.
 * @returns A date string, e.g., "2025-06-22".
 */
export function getRestaurantDateString(timezone: string): string {
    // Use the core function and format the output
    const dt = getRestaurantDateTime(timezone);
    
    // ✅ CRITICAL FIX: Handle potential null return from toISODate()
    const isoDate = dt.toISODate();
    if (!isoDate) {
        console.warn(`[Utils] Failed to get ISO date for timezone "${timezone}". Using fallback.`);
        return DateTime.now().toISODate() || new Date().toISOString().split('T')[0];
    }
    
    return isoDate;
}

/**
 * Formats a given ISO-like date string into a human-readable format for display,
 * correctly interpreting the date in the restaurant's timezone.
 * @param dateStr - The date string to format (e.g., "2025-06-22").
 * @param timezone - The restaurant's IANA timezone string.
 * @param format - A Luxon format string (e.g., 'ccc, LLL d, yyyy').
 * @returns A formatted date string, e.g., "Sun, Jun 22, 2025".
 */
export function formatDisplayDate(
    dateStr: string,
    timezone: string,
    format: string = 'ccc, LLL d, yyyy'
): string {
    if (!dateStr || !timezone) return 'Invalid Date';

    try {
        // Create a DateTime object from the date string, specifying it's in the restaurant's timezone
        const dt = DateTime.fromISO(dateStr, { zone: timezone });

        if (!dt.isValid) {
            console.warn(`[Utils] Invalid date string for formatting: ${dateStr}`);
            return 'Invalid Date';
        }

        return dt.toFormat(format);
    } catch (error) {
        console.error(`[Utils] Error formatting date "${dateStr}" with timezone "${timezone}":`, error);
        return 'Invalid Date';
    }
}

/**
 * Formats a given 24-hour time string (like "19:00") into a human-readable format for display.
 * @param timeStr - The time string to format (e.g., "19:00").
 * @param format - A Luxon format string (e.g., 'h:mm a').
 * @returns A formatted time string, e.g., "7:00 PM".
 */
export function formatDisplayTime(
    timeStr: string,
    format: string = 'h:mm a'
): string {
    if (!timeStr) return 'Invalid Time';

    try {
        // Create a DateTime object from a time string. Luxon handles this gracefully.
        // We specify UTC here to prevent the local machine's timezone from affecting the parsing.
        const dt = DateTime.fromISO(`2000-01-01T${timeStr}`, { zone: 'utc' });

        if (!dt.isValid) {
            console.warn(`[Utils] Invalid time string for formatting: ${timeStr}`);
            return 'Invalid Time';
        }

        return dt.toFormat(format);
    } catch (error) {
        console.error(`[Utils] Error formatting time "${timeStr}":`, error);
        return 'Invalid Time';
    }
}

// ✅ NEW: Additional timezone helper for converting UTC timestamps to restaurant local time
/**
 * Converts a UTC timestamp to restaurant local time for display
 * @param utcTimestamp - UTC timestamp string (ISO format)
 * @param timezone - Restaurant timezone
 * @param format - Display format (default: 'MMM d, yyyy h:mm a')
 * @returns Formatted local time string
 */
export function formatUtcToRestaurantTime(
    utcTimestamp: string,
    timezone: string,
    format: string = 'MMM d, yyyy h:mm a'
): string {
    if (!utcTimestamp || !timezone) return 'Invalid Time';

    try {
        const utcDateTime = DateTime.fromISO(utcTimestamp, { zone: 'utc' });
        
        if (!utcDateTime.isValid) {
            console.warn(`[Utils] Invalid UTC timestamp: ${utcTimestamp}`);
            return 'Invalid Time';
        }

        const localDateTime = utcDateTime.setZone(timezone);
        return localDateTime.toFormat(format);
        
    } catch (error) {
        console.error(`[Utils] Error converting UTC timestamp "${utcTimestamp}" to timezone "${timezone}":`, error);
        return 'Invalid Time';
    }
}

// ✅ NEW: Helper to get tomorrow's date in restaurant timezone
/**
 * Gets tomorrow's date string in restaurant timezone
 * @param timezone - Restaurant timezone
 * @returns Date string in YYYY-MM-DD format
 */
export function getTomorrowDateString(timezone: string): string {
    try {
        const tomorrow = getRestaurantDateTime(timezone).plus({ days: 1 });
        const isoDate = tomorrow.toISODate();
        
        if (!isoDate) {
            console.warn(`[Utils] Failed to get tomorrow's date for timezone "${timezone}". Using fallback.`);
            return DateTime.now().plus({ days: 1 }).toISODate() || 
                   new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        }
        
        return isoDate;
    } catch (error) {
        console.error(`[Utils] Error getting tomorrow's date for timezone "${timezone}":`, error);
        return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }
}