/**
 * ✅ Enhanced Timezone Utilities using Luxon
 * 
 * FEATURES:
 * ✅ COMPREHENSIVE: All supported IANA timezones (600+)
 * ✅ POPULAR: Quick-select list for common restaurant locations
 * ✅ RELIABLE: Industry standard Luxon library
 * ✅ BACKWARD COMPATIBLE: Drop-in replacements for Moscow functions
 * ✅ PERFORMANCE: Cached timezone data for speed
 * ✅ UI-FRIENDLY: Searchable labels with offsets and city names
 * ✅ OVERNIGHT OPERATIONS: Support for restaurants that close after midnight
 */

import { DateTime } from 'luxon';
import type { Language } from '../services/enhanced-conversation-manager';

// ================================
// CORE TIMEZONE INTERFACES
// ================================

export interface TimezoneOption {
    value: string;        // e.g., "Europe/Belgrade" 
    label: string;        // e.g., "(UTC+01:00) Belgrade"
    offset: string;       // e.g., "UTC+01:00"
    city: string;         // e.g., "Belgrade"
    region: string;       // e.g., "Europe"
    offsetMinutes: number; // e.g., 60
}

export interface TimezoneGroup {
    region: string;
    timezones: TimezoneOption[];
}

// ================================
// OVERNIGHT OPERATIONS UTILITIES
// ================================

/**
 * Helper function to parse time string to minutes
 */
function parseTimeToMinutes(timeStr: string | null | undefined): number | null {
    if (!timeStr) return null;
    const parts = timeStr.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10) || 0;

    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }
    return hours * 60 + minutes;
}

/**
 * ✅ NEW: Check if restaurant operates overnight (closing time < opening time)
 * This detects when a restaurant closes after midnight (e.g., 10:00 AM to 3:00 AM)
 */
export function isOvernightOperation(openingTime: string, closingTime: string): boolean {
    const openingMinutes = parseTimeToMinutes(openingTime);
    const closingMinutes = parseTimeToMinutes(closingTime);
    
    if (openingMinutes === null || closingMinutes === null) {
        return false;
    }
    
    return closingMinutes < openingMinutes;
}

/**
 * ✅ NEW: Check if current time is within overnight operating hours
 * Handles restaurants that stay open past midnight
 */
export function isRestaurantOpenOvernight(
    restaurantTimezone: string,
    openingTime: string, // "22:00"
    closingTime: string  // "03:00" (next day)
): boolean {
    const now = getRestaurantDateTime(restaurantTimezone);
    const currentMinutes = now.hour * 60 + now.minute;
    const openingMinutes = parseTimeToMinutes(openingTime);
    const closingMinutes = parseTimeToMinutes(closingTime);
    
    if (openingMinutes === null || closingMinutes === null) {
        return false;
    }
    
    if (closingMinutes < openingMinutes) {
        // Overnight operation: open if after opening time OR before closing time
        return currentMinutes >= openingMinutes || currentMinutes < closingMinutes;
    } else {
        // Standard operation: open if between opening and closing
        return currentMinutes >= openingMinutes && currentMinutes < closingMinutes;
    }
}

/**
 * ✅ NEW: Get operating status with overnight support
 */
export function getRestaurantOperatingStatus(
    restaurantTimezone: string,
    openingTime: string,
    closingTime: string
): {
    isOpen: boolean;
    isOvernightOperation: boolean;
    nextOpeningTime?: Date;
    minutesUntilClose?: number;
    minutesUntilOpen?: number;
} {
    const isOvernight = isOvernightOperation(openingTime, closingTime);
    const isOpen = isRestaurantOpenOvernight(restaurantTimezone, openingTime, closingTime);
    
    const now = getRestaurantDateTime(restaurantTimezone);
    const currentMinutes = now.hour * 60 + now.minute;
    const openingMinutes = parseTimeToMinutes(openingTime);
    const closingMinutes = parseTimeToMinutes(closingTime);
    
    let minutesUntilClose: number | undefined;
    let minutesUntilOpen: number | undefined;
    let nextOpeningTime: Date | undefined;
    
    if (openingMinutes !== null && closingMinutes !== null) {
        if (isOpen) {
            if (isOvernight) {
                // Calculate minutes until closing (may be next day)
                if (currentMinutes >= openingMinutes) {
                    // Currently in evening hours, closes next day
                    minutesUntilClose = (24 * 60) + closingMinutes - currentMinutes;
                } else {
                    // Currently in early morning hours
                    minutesUntilClose = closingMinutes - currentMinutes;
                }
            } else {
                // Standard operation
                minutesUntilClose = closingMinutes - currentMinutes;
            }
        } else {
            // Restaurant is closed, calculate when it opens next
            if (isOvernight) {
                if (currentMinutes >= closingMinutes && currentMinutes < openingMinutes) {
                    // Closed period during the day
                    minutesUntilOpen = openingMinutes - currentMinutes;
                } else {
                    // Should not happen if logic is correct
                    minutesUntilOpen = openingMinutes - currentMinutes;
                }
            } else {
                // Standard operation
                if (currentMinutes < openingMinutes) {
                    minutesUntilOpen = openingMinutes - currentMinutes;
                } else {
                    // Opens tomorrow
                    minutesUntilOpen = (24 * 60) + openingMinutes - currentMinutes;
                }
            }
            
            if (minutesUntilOpen !== undefined) {
                nextOpeningTime = now.plus({ minutes: minutesUntilOpen }).toJSDate();
            }
        }
    }
    
    return {
        isOpen,
        isOvernightOperation: isOvernight,
        nextOpeningTime,
        minutesUntilClose,
        minutesUntilOpen
    };
}

// ================================
// COMPREHENSIVE TIMEZONE LISTS
// ================================

/**
 * 🌍 Get ALL supported timezones (600+ zones)
 * Perfect for international restaurants - covers every location worldwide
 */
export function getAllSupportedTimezones(): TimezoneOption[] {
    try {
        // Get every IANA timezone supported by the system
        const allTimezones = Intl.supportedValuesOf('timeZone');

        return allTimezones.map(tz => {
            try {
                const dt = DateTime.now().setZone(tz);
                const parts = tz.split('/');
                const region = parts[0] || 'Other';
                const city = parts[parts.length - 1]?.replace(/_/g, ' ') || tz;
                const offset = dt.toFormat('ZZZZ'); // e.g., "UTC+02:00"

                return {
                    value: tz,
                    label: `(${offset}) ${city}`,
                    offset: offset,
                    city: city,
                    region: region,
                    offsetMinutes: dt.offset
                };
            } catch {
                // Fallback for any problematic timezone names
                return {
                    value: tz,
                    label: tz,
                    offset: 'Unknown',
                    city: tz,
                    region: 'Other',
                    offsetMinutes: 0
                };
            }
        }).sort((a, b) => {
            // Sort by offset first, then alphabetically
            if (a.offsetMinutes !== b.offsetMinutes) {
                return a.offsetMinutes - b.offsetMinutes;
            }
            return a.label.localeCompare(b.label);
        });
    } catch (error) {
        console.error('[TimezoneUtils] Failed to get all timezones:', error);
        return getPopularRestaurantTimezones(); // Fallback to popular list
    }
}

/**
 * 🏆 Get popular restaurant timezones (quick-select for better UX)
 * These cover 90% of restaurant locations worldwide
 */
export function getPopularRestaurantTimezones(): TimezoneOption[] {
    const popularZones = [
        // Europe (Restaurant hotspots)
        'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome',
        'Europe/Madrid', 'Europe/Amsterdam', 'Europe/Vienna', 'Europe/Prague',
        'Europe/Warsaw', 'Europe/Stockholm', 'Europe/Copenhagen', 'Europe/Oslo',
        'Europe/Belgrade', 'Europe/Athens', 'Europe/Budapest', 'Europe/Zurich',
        'Europe/Brussels', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Moscow',

        // North America (Major restaurant markets)
        'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
        'America/Toronto', 'America/Vancouver', 'America/Montreal', 'America/Mexico_City',
        'America/Phoenix', 'America/Detroit', 'America/Boston', 'America/Miami',

        // Asia Pacific (Growing restaurant markets)
        'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore',
        'Asia/Seoul', 'Asia/Bangkok', 'Asia/Manila', 'Asia/Jakarta',
        'Asia/Mumbai', 'Asia/Delhi', 'Asia/Kolkata', 'Asia/Dubai',
        'Asia/Riyadh', 'Asia/Tel_Aviv', 'Asia/Istanbul',
        'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth',
        'Pacific/Auckland',

        // South America & Africa
        'America/Sao_Paulo', 'America/Buenos_Aires', 'America/Lima',
        'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos'
    ];

    return popularZones.map(tz => {
        try {
            const dt = DateTime.now().setZone(tz);
            const parts = tz.split('/');
            const region = parts[0] || 'Other';
            const city = parts[parts.length - 1]?.replace(/_/g, ' ') || tz;
            const offset = dt.toFormat('ZZZZ');

            return {
                value: tz,
                label: `(${offset}) ${city}`,
                offset: offset,
                city: city,
                region: region,
                offsetMinutes: dt.offset
            };
        } catch {
            return {
                value: tz,
                label: tz,
                offset: 'Unknown',
                city: tz,
                region: 'Other',
                offsetMinutes: 0
            };
        }
    }).sort((a, b) => {
        if (a.offsetMinutes !== b.offsetMinutes) {
            return a.offsetMinutes - b.offsetMinutes;
        }
        return a.label.localeCompare(b.label);
    });
}

/**
 * 🗂️ Get timezones grouped by region (for better UI organization)
 */
export function getTimezonesByRegion(includeAll: boolean = false): TimezoneGroup[] {
    const timezones = includeAll ? getAllSupportedTimezones() : getPopularRestaurantTimezones();

    const grouped = timezones.reduce((acc, tz) => {
        if (!acc[tz.region]) {
            acc[tz.region] = [];
        }
        acc[tz.region].push(tz);
        return acc;
    }, {} as Record<string, TimezoneOption[]>);

    return Object.entries(grouped)
        .map(([region, timezones]) => ({ region, timezones }))
        .sort((a, b) => a.region.localeCompare(b.region));
}

// ================================
// CORE RESTAURANT FUNCTIONS
// ================================

/**
 * Core function: Get current time in restaurant's timezone
 * This is the reliable foundation for all other functions
 */
export function getRestaurantDateTime(restaurantTimezone: string): DateTime {
    return DateTime.now().setZone(restaurantTimezone);
}

/**
 * Get current date and time as a JavaScript Date in restaurant timezone
 * (Kept for backward compatibility with existing code)
 */
export function getRestaurantDate(restaurantTimezone: string): Date {
    return getRestaurantDateTime(restaurantTimezone).toJSDate();
}

/**
 * Get current date string in restaurant timezone (YYYY-MM-DD format)
 */
export function getRestaurantDateString(restaurantTimezone: string): string {
    return getRestaurantDateTime(restaurantTimezone).toISODate() || '';
}

/**
 * Get tomorrow's date string in restaurant timezone (YYYY-MM-DD format)
 */
export function getRestaurantTomorrowString(restaurantTimezone: string): string {
    return getRestaurantDateTime(restaurantTimezone).plus({ days: 1 }).toISODate() || '';
}

/**
 * Get current restaurant time information for AI context
 */
export function getRestaurantTimeContext(restaurantTimezone: string) {
    const now = getRestaurantDateTime(restaurantTimezone);

    return {
        currentTime: now.toJSDate(),
        todayDate: now.toISODate() || '',
        tomorrowDate: now.plus({ days: 1 }).toISODate() || '',
        timezone: restaurantTimezone,
        hour: now.hour,
        minute: now.minute,
        dayOfWeek: now.weekdayLong || '',
        offset: now.offset,
        displayName: getTimezoneDisplayName(restaurantTimezone)
    };
}

// ================================
// TIME FORMATTING FUNCTIONS
// ================================

/**
 * Format time consistently in 24-hour format (HH:mm)
 */
export function formatRestaurantTime24Hour(time: string | Date, restaurantTimezone?: string): string {
    if (time instanceof Date) {
        if (restaurantTimezone) {
            const dt = DateTime.fromJSDate(time).setZone(restaurantTimezone);
            return dt.toFormat('HH:mm');
        } else {
            return DateTime.fromJSDate(time).toFormat('HH:mm');
        }
    }

    // Handle string input (same logic as original)
    const timeStr = time.toString();

    if (timeStr.includes(':')) {
        const [hours, minutes] = timeStr.split(':');
        const h = parseInt(hours, 10);
        const m = parseInt(minutes || '0', 10);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }

    const hour = parseInt(timeStr, 10);
    if (!isNaN(hour)) {
        return `${hour.toString().padStart(2, '0')}:00`;
    }

    return '00:00';
}

/**
 * Format time for display in restaurant's preferred format and language
 */
export function formatTimeForRestaurant(
    time24: string,
    restaurantTimezone: string,
    lang: Language = 'en',
    use12Hour: boolean = false
): string {
    const parts = time24.split(':');
    const hour24 = parseInt(parts[0], 10);
    const minutes = parts[1]?.padStart(2, '0') || '00';

    if (isNaN(hour24) || hour24 < 0 || hour24 > 23) {
        console.warn(`[TimezoneUtils] Invalid hour in time string for display: ${time24}`);
        return time24;
    }

    // For Russian or 24-hour format preference
    if (lang === 'ru' || !use12Hour) {
        return `${hour24.toString().padStart(2, '0')}:${minutes}`;
    }

    // 12-hour format for English and other languages
    const dt = DateTime.fromObject({ hour: hour24, minute: parseInt(minutes) });
    return dt.toFormat('h:mm a');
}

/**
 * Generate time slots in 24-hour format for given range
 */
export function generateRestaurantTimeSlots(
    restaurantTimezone: string,
    startTime: string = "10:00",
    endTime: string = "23:00"
): string[] {
    const slots: string[] = [];
    const [startHour] = startTime.split(':').map(Number);
    const [endHour] = endTime.split(':').map(Number);

    for (let hour = startHour; hour <= endHour; hour++) {
        slots.push(`${hour.toString().padStart(2, '0')}:00`);
    }

    return slots;
}

// ================================
// UTILITY FUNCTIONS
// ================================

/**
 * Get human-readable timezone display name
 */
export function getTimezoneDisplayName(timezone: string, locale: string = 'en'): string {
    try {
        const dt = DateTime.now().setZone(timezone);
        return dt.offsetNameLong || timezone;
    } catch (error) {
        console.warn(`[TimezoneUtils] Failed to get display name for timezone ${timezone}:`, error);
        return timezone;
    }
}

/**
 * ✅ ENHANCED: Check if a restaurant is currently open with overnight support
 */
export function isRestaurantOpen(
    restaurantTimezone: string,
    openingTime: string, // "10:00"
    closingTime: string  // "23:00" or "03:00" for overnight
): boolean {
    return isRestaurantOpenOvernight(restaurantTimezone, openingTime, closingTime);
}

/**
 * ✅ ENHANCED: Get the next opening time for a restaurant with overnight support
 */
export function getNextOpeningTime(
    restaurantTimezone: string,
    openingTime: string,
    closingTime: string
): Date {
    const operatingStatus = getRestaurantOperatingStatus(restaurantTimezone, openingTime, closingTime);
    
    if (operatingStatus.isOpen) {
        return getRestaurantDateTime(restaurantTimezone).toJSDate(); // Already open
    }

    return operatingStatus.nextOpeningTime || getRestaurantDateTime(restaurantTimezone).plus({ days: 1 }).toJSDate();
}

/**
 * Validate timezone string
 */
export function isValidTimezone(timezone: string): boolean {
    try {
        DateTime.now().setZone(timezone);
        return true;
    } catch {
        return false;
    }
}

/**
 * 🔍 Search timezones by city name or offset
 */
export function searchTimezones(query: string, includeAll: boolean = false): TimezoneOption[] {
    const timezones = includeAll ? getAllSupportedTimezones() : getPopularRestaurantTimezones();
    const searchTerm = query.toLowerCase();

    return timezones.filter(tz =>
        tz.city.toLowerCase().includes(searchTerm) ||
        tz.label.toLowerCase().includes(searchTerm) ||
        tz.region.toLowerCase().includes(searchTerm) ||
        tz.value.toLowerCase().includes(searchTerm)
    );
}

// ================================
// BACKWARD COMPATIBILITY
// ================================

/**
 * Drop-in replacement for getMoscowDate() - detects restaurant timezone automatically
 */
export function getMoscowDateCompatible(restaurant?: { timezone?: string }): Date {
    const timezone = restaurant?.timezone || 'Europe/Moscow';
    return getRestaurantDate(timezone);
}

/**
 * Drop-in replacement for getMoscowDateString() - detects restaurant timezone automatically
 */
export function getMoscowDateStringCompatible(restaurant?: { timezone?: string }): string {
    const timezone = restaurant?.timezone || 'Europe/Moscow';
    return getRestaurantDateString(timezone);
}

/**
 * Drop-in replacement for getMoscowTimeContext() - detects restaurant timezone automatically
 */
export function getMoscowTimeContextCompatible(restaurant?: { timezone?: string }) {
    const timezone = restaurant?.timezone || 'Europe/Moscow';
    return getRestaurantTimeContext(timezone);
}

// ================================
// CACHE FOR PERFORMANCE
// ================================

let _cachedAllTimezones: TimezoneOption[] | null = null;
let _cachedPopularTimezones: TimezoneOption[] | null = null;

/**
 * 🚀 Get cached timezone lists for better performance
 */
export function getCachedTimezones(type: 'popular' | 'all' = 'popular'): TimezoneOption[] {
    if (type === 'all') {
        if (!_cachedAllTimezones) {
            _cachedAllTimezones = getAllSupportedTimezones();
        }
        return _cachedAllTimezones;
    } else {
        if (!_cachedPopularTimezones) {
            _cachedPopularTimezones = getPopularRestaurantTimezones();
        }
        return _cachedPopularTimezones;
    }
}

/**
 * Clear timezone cache (useful for testing or updates)
 */
export function clearTimezoneCache(): void {
    _cachedAllTimezones = null;
    _cachedPopularTimezones = null;
}