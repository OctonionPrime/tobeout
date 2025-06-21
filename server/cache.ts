interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

class SmartCache {
  private cache = new Map<string, CacheEntry<any>>();
  private maxSize = 1000; // Prevent memory bloat
  
  /**
   * Get data from cache or return null if expired/missing
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }
  
  /**
   * Store data in cache with TTL
   */
  set<T>(key: string, data: T, ttlSeconds: number = 30): void {
    // Prevent memory bloat
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlSeconds * 1000
    });
  }
  
  /**
   * Remove specific key from cache (for invalidation)
   */
  delete(key: string): void {
    this.cache.delete(key);
  }
  
  /**
   * Remove all keys matching a pattern (for bulk invalidation)
   */
  invalidatePattern(pattern: string): void {
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }
  
  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }
  
  /**
   * Get cache statistics for monitoring
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      keys: Array.from(this.cache.keys())
    };
  }
  
  /**
   * Remove oldest entries when approaching memory limit
   */
  private evictOldest(): void {
    let oldest: string | null = null;
    let oldestTime = Date.now();
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldest = key;
      }
    }
    
    if (oldest) {
      this.cache.delete(oldest);
    }
  }
}

// Create global cache instance
export const cache = new SmartCache();

/**
 * Cache key generators for consistent naming
 */
export const CacheKeys = {
  // ✅ EXISTING: Broad date-based cache (keep for compatibility)
  tableAvailability: (restaurantId: number, date: string) => 
    `tables_availability_${restaurantId}_${date}`,
  
  // ✅ NEW: Granular time-range based cache
  tableAvailabilityRange: (restaurantId: number, date: string, timeRange: string) => 
    `tables_availability_${restaurantId}_${date}_${timeRange}`,
  
  reservations: (restaurantId: number, date?: string) => 
    date ? `reservations_${restaurantId}_${date}` : `reservations_${restaurantId}`,
  
  guests: (restaurantId: number) => 
    `guests_${restaurantId}`,
  
  tables: (restaurantId: number) => 
    `tables_${restaurantId}`,
  
  availableTimes: (restaurantId: number, date: string, guests: number) =>
    `available_times_${restaurantId}_${date}_${guests}`,
  
  // ✅ NEW: Granular available times with time range
  availableTimesRange: (restaurantId: number, date: string, guests: number, timeRange: string) =>
    `available_times_${restaurantId}_${date}_${guests}_${timeRange}`,
  
  restaurant: (id: number) => 
    `restaurant_${id}`
};

// ✅ NEW: Helper function to calculate overlapping time ranges
function calculateOverlappingTimeRanges(startTime: string, durationMinutes: number): string[] {
  const ranges: string[] = [];
  
  try {
    const [startHour, startMin] = startTime.split(':').map(Number);
    const startTotalMinutes = startHour * 60 + (startMin || 0);
    const endTotalMinutes = startTotalMinutes + durationMinutes;
    
    // Calculate which hourly slots are affected
    // For a 2-hour reservation starting at 19:30, it affects:
    // - 19:00-20:00 slot (overlaps with 19:30-21:30)
    // - 20:00-21:00 slot (overlaps with 19:30-21:30) 
    // - 21:00-22:00 slot (overlaps with 19:30-21:30)
    
    const firstAffectedHour = Math.floor(startTotalMinutes / 60);
    const lastAffectedHour = Math.floor((endTotalMinutes - 1) / 60); // -1 to handle exact hour boundaries
    
    // Generate affected time ranges (each represents a 1-hour cache slot)
    for (let hour = firstAffectedHour; hour <= lastAffectedHour; hour++) {
      if (hour >= 0 && hour <= 23) { // Valid hours only
        ranges.push(`${hour.toString().padStart(2, '0')}:00`);
      }
    }
    
    // Also add ranges for the hour before and after for overlapping checks
    if (firstAffectedHour > 0) {
      ranges.push(`${(firstAffectedHour - 1).toString().padStart(2, '0')}:00`);
    }
    if (lastAffectedHour < 23) {
      ranges.push(`${(lastAffectedHour + 1).toString().padStart(2, '0')}:00`);
    }
    
    // Remove duplicates and sort
    return [...new Set(ranges)].sort();
    
  } catch (error) {
    console.warn(`[Cache] Error calculating time ranges for ${startTime}:`, error);
    // Fallback: return a broad range around the time
    const hour = parseInt(startTime.split(':')[0]) || 0;
    return [
      `${Math.max(hour - 1, 0).toString().padStart(2, '0')}:00`,
      `${hour.toString().padStart(2, '0')}:00`,
      `${Math.min(hour + 1, 23).toString().padStart(2, '0')}:00`
    ];
  }
}

/**
 * Cache invalidation helpers
 */
export const CacheInvalidation = {
  /**
   * ✅ EXISTING: Broad invalidation (keep for compatibility and fallback)
   */
  onReservationChange: (restaurantId: number, date: string) => {
    console.log(`🗑️ [Cache] Broad invalidation: entire date ${date} for restaurant ${restaurantId}`);
    cache.invalidatePattern(`reservations_${restaurantId}`);
    cache.invalidatePattern(`tables_availability_${restaurantId}`);
    cache.invalidatePattern(`available_times_${restaurantId}_${date}`);
  },
  
  /**
   * ✅ NEW: Granular time-range based invalidation  
   */
  onReservationTimeRangeChange: (restaurantId: number, date: string, time: string, duration: number = 120) => {
    const affectedRanges = calculateOverlappingTimeRanges(time, duration);
    
    console.log(`🎯 [Cache] Granular invalidation: ${affectedRanges.length} time ranges for ${time} (${duration}min) on ${date}`);
    console.log(`🎯 [Cache] Affected ranges: ${affectedRanges.join(', ')}`);
    
    // Invalidate table availability cache for affected time ranges
    for (const range of affectedRanges) {
      cache.delete(CacheKeys.tableAvailabilityRange(restaurantId, date, range));
      cache.delete(CacheKeys.availableTimesRange(restaurantId, date, 1, range)); // 1 guest
      cache.delete(CacheKeys.availableTimesRange(restaurantId, date, 2, range)); // 2 guests
      cache.delete(CacheKeys.availableTimesRange(restaurantId, date, 4, range)); // 4 guests
      cache.delete(CacheKeys.availableTimesRange(restaurantId, date, 6, range)); // 6 guests
      cache.delete(CacheKeys.availableTimesRange(restaurantId, date, 8, range)); // 8 guests
    }
    
    // Also invalidate some broad caches that might be affected
    cache.invalidatePattern(`reservations_${restaurantId}_${date}`);
    
    // Keep the old broad cache keys as fallback for any code still using them
    cache.delete(CacheKeys.tableAvailability(restaurantId, date));
  },
  
  /**
   * ✅ NEW: Smart invalidation that tries granular first, falls back to broad
   */
  onReservationChangeWithTimeInfo: (
    restaurantId: number, 
    date: string, 
    time?: string, 
    duration?: number
  ) => {
    if (time && duration) {
      // Use granular invalidation when we have time info
      CacheInvalidation.onReservationTimeRangeChange(restaurantId, date, time, duration);
    } else {
      // Fall back to broad invalidation when we don't have time info
      console.log(`⚠️ [Cache] No time info provided, falling back to broad invalidation for ${date}`);
      CacheInvalidation.onReservationChange(restaurantId, date);
    }
  },
  
  /**
   * ✅ EXISTING: Table cache invalidation (unchanged)
   */
  onTableChange: (restaurantId: number) => {
    console.log(`🔄 [Cache] Table configuration changed for restaurant ${restaurantId}`);
    cache.invalidatePattern(`tables_${restaurantId}`);
    cache.invalidatePattern(`tables_availability_${restaurantId}`);
  },
  
  /**
   * ✅ EXISTING: Guest cache invalidation (unchanged)
   */
  onGuestChange: (restaurantId: number) => {
    console.log(`👤 [Cache] Guest data changed for restaurant ${restaurantId}`);
    cache.delete(CacheKeys.guests(restaurantId));
  }
};

/**
 * ✅ EXISTING: Wrapper function for caching database queries (unchanged)
 */
export async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = 30
): Promise<T> {
  // Try cache first
  const cached = cache.get<T>(key);
  if (cached !== null) {
    return cached;
  }
  
  // Cache miss - fetch from database
  const data = await fetcher();
  
  // Store in cache for next time
  cache.set(key, data, ttlSeconds);
  
  return data;
}

/**
 * ✅ NEW: Enhanced wrapper with granular cache key support
 */
export async function withGranularCache<T>(
  restaurantId: number,
  date: string,
  timeRange: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = 30
): Promise<T> {
  const key = CacheKeys.tableAvailabilityRange(restaurantId, date, timeRange);
  return withCache(key, fetcher, ttlSeconds);
}

// ✅ NEW: Export helper function for external use
export { calculateOverlappingTimeRanges };