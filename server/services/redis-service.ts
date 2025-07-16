// src/services/redis-service.ts
// 🚀 REDIS INTEGRATION: Complete Redis service with fallback cache, performance monitoring, and error handling
// ✅ Based on Comprehensive Redis Integration Plan Phase 1
// ✅ Smart Logging Integration
// ✅ Production-ready with circuit breaker patterns
// 🔧 BUG FIX: Replaced all calls to non-existent `smartLog.debug()` with `smartLog.info()`
// 🔧 BUG FIX 2: Removed duplicate `endTimer` calls to prevent "Timer not found" warnings

import { createClient, RedisClientType } from 'redis';
import { smartLog } from './smart-logging.service';

interface RedisConfig {
    url: string;
    retryDelayOnFailover: number;
    retryDelayOnClusterDown: number;

    maxRetriesPerRequest: number;
    lazyConnect: boolean;
    keepAlive: number;
    connectTimeout: number;
    commandTimeout: number;
}

interface CacheOptions {
    ttl?: number;
    compress?: boolean;
    fallbackToMemory?: boolean;
}

interface CacheStats {
    hits: number;
    misses: number;
    errors: number;
    totalRequests: number;
    avgResponseTime: number;
}

/**
 * 🚀 Redis Service - Production-ready caching with comprehensive error handling
 * * Features:
 * - Automatic connection retry with exponential backoff
 * - Fallback in-memory cache when Redis is unavailable
 * - Performance monitoring and health checks
 * - TTL-based expiration
 * - Pattern-based operations for bulk deletion
 * - Compression support for large objects
 * - Circuit breaker pattern for degraded service
 * - Complete Smart Logging integration
 */
class RedisService {
    private static instance: RedisService;
    private client: RedisClientType;
    private fallbackCache = new Map<string, { data: any; expires: number }>();
    private isConnected = false;
    private stats: CacheStats = {
        hits: 0,
        misses: 0,
        errors: 0,
        totalRequests: 0,
        avgResponseTime: 0
    };
    private connectionAttempts = 0;
    private maxConnectionAttempts = 5;
    private circuitBreakerOpenUntil = 0;
    private readonly CIRCUIT_BREAKER_TIMEOUT = 30000; // 30 seconds

    private constructor() {
        this.initializeRedis();
        this.setupHealthChecks();
        this.setupPerformanceMonitoring();
    }

    public static getInstance(): RedisService {
        if (!RedisService.instance) {
            RedisService.instance = new RedisService();
        }
        return RedisService.instance;
    }

    /**
     * Initialize Redis connection with configuration from environment
     */
    private async initializeRedis(): Promise<void> {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
            smartLog.error('REDIS_URL not found in environment', new Error('MISSING_REDIS_URL'), {
                critical: true,
                configuration: 'missing'
            });
            return;
        }

        const config: RedisConfig = {
            url: redisUrl,
            retryDelayOnFailover: parseInt(process.env.REDIS_RETRY_DELAY_FAILOVER || '100'),
            retryDelayOnClusterDown: parseInt(process.env.REDIS_RETRY_DELAY_CLUSTER || '300'),
            maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES || '3'),
            lazyConnect: true,
            keepAlive: parseInt(process.env.REDIS_KEEP_ALIVE || '30000'),
            connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '10000'),
            commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT || '5000')
        };

        smartLog.info('Initializing Redis client', {
            redisUrl: redisUrl.replace(/\/\/.*@/, '//***:***@'), // Hide credentials in logs
            config: {
                ...config,
                url: undefined // Don't log the URL with credentials
            }
        });

        this.client = createClient({
            url: config.url,
            socket: {
                reconnectStrategy: (retries) => {
                    if (retries > config.maxRetriesPerRequest) {
                        smartLog.error('Redis max retries exceeded', new Error('MAX_RETRIES_EXCEEDED'), {
                            retries,
                            maxRetries: config.maxRetriesPerRequest
                        });
                        return false; // Stop retrying
                    }

                    const delay = Math.min(1000 * Math.pow(2, retries), 30000); // Exponential backoff, max 30s
                    smartLog.info('Redis reconnection scheduled', {
                        retries,
                        delayMs: delay
                    });
                    return delay;
                },
                connectTimeout: config.connectTimeout,
                commandTimeout: config.commandTimeout,
                keepAlive: config.keepAlive
            }
        });

        this.setupEventHandlers();
        await this.connectWithRetry();
    }

    /**
     * Setup Redis event handlers for connection monitoring
     */
    private setupEventHandlers(): void {
        this.client.on('connect', () => {
            smartLog.info('Redis connection established', {
                connectionAttempts: this.connectionAttempts,
                timestamp: new Date().toISOString()
            });
            this.isConnected = true;
            this.connectionAttempts = 0;
            this.circuitBreakerOpenUntil = 0; // Reset circuit breaker
        });

        this.client.on('ready', () => {
            smartLog.info('Redis client ready for commands');
            smartLog.businessEvent('redis_connected', {
                connectionAttempts: this.connectionAttempts,
                fallbackCacheSize: this.fallbackCache.size
            });
        });

        this.client.on('error', (err) => {
            smartLog.error('Redis connection error', err, {
                isConnected: this.isConnected,
                connectionAttempts: this.connectionAttempts
            });
            this.isConnected = false;
            this.handleConnectionError();
        });

        this.client.on('end', () => {
            smartLog.warn('Redis connection closed', {
                isConnected: this.isConnected,
                fallbackCacheSize: this.fallbackCache.size
            });
            this.isConnected = false;
        });

        this.client.on('reconnecting', () => {
            smartLog.info('Redis reconnecting...', {
                connectionAttempts: this.connectionAttempts
            });
        });
    }

    /**
     * Connect to Redis with retry logic and circuit breaker
     */
    private async connectWithRetry(): Promise<void> {
        while (this.connectionAttempts < this.maxConnectionAttempts) {
            try {
                // Check circuit breaker
                if (Date.now() < this.circuitBreakerOpenUntil) {
                    smartLog.info('Circuit breaker open, skipping connection attempt', {
                        remainingTime: this.circuitBreakerOpenUntil - Date.now()
                    });
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }

                await this.client.connect();
                return;
            } catch (error) {
                this.connectionAttempts++;
                smartLog.warn(`Redis connection attempt ${this.connectionAttempts} failed`, {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    attemptsRemaining: this.maxConnectionAttempts - this.connectionAttempts,
                    willRetry: this.connectionAttempts < this.maxConnectionAttempts
                });

                if (this.connectionAttempts < this.maxConnectionAttempts) {
                    const delay = Math.min(2000 * this.connectionAttempts, 10000); // Progressive delay
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    // Open circuit breaker
                    this.circuitBreakerOpenUntil = Date.now() + this.CIRCUIT_BREAKER_TIMEOUT;
                    smartLog.error('Redis connection failed after maximum attempts - circuit breaker opened',
                        new Error('REDIS_CONNECTION_FAILED'), {
                        maxAttempts: this.maxConnectionAttempts,
                        circuitBreakerTimeout: this.CIRCUIT_BREAKER_TIMEOUT
                    });
                }
            }
        }
    }

    /**
     * Handle connection errors with exponential backoff reconnection
     */
    private handleConnectionError(): void {
        if (this.isConnected) return; // Already handling reconnection

        const backoffDelay = Math.min(1000 * Math.pow(2, this.connectionAttempts), 30000);

        setTimeout(() => {
            if (!this.isConnected && this.connectionAttempts < this.maxConnectionAttempts) {
                this.connectWithRetry();
            }
        }, backoffDelay);
    }

    // ===== CORE CACHE METHODS =====

    /**
     * Set a value in Redis with TTL and fallback support
     */
    async set(key: string, value: any, options: CacheOptions = {}): Promise<boolean> {
        const timerId = smartLog.startTimer('redis_set');
        this.stats.totalRequests++;

        try {
            if (!this.isConnected) {
                smartLog.info('Redis unavailable, using fallback cache for SET', { key });
                this.updateStats(timerId, false); // End timer here for this path
                return this.setFallback(key, value, options);
            }

            const serializedValue = this.serialize(value, options.compress);
            const ttl = options.ttl || parseInt(process.env.REDIS_TTL_DEFAULT || '3600');

            await this.client.setEx(key, ttl, serializedValue);

            this.updateStats(timerId, true);
            smartLog.info('Redis SET success', {
                key,
                ttl,
                compressed: options.compress || false,
                size: serializedValue.length
            });
            return true;

        } catch (error) {
            this.stats.errors++;
            this.updateStats(timerId, false); // End timer here for this path
            smartLog.error('Redis SET error', error as Error, {
                key,
                fallbackEnabled: options.fallbackToMemory !== false
            });

            if (options.fallbackToMemory !== false) {
                return this.setFallback(key, value, options);
            }
            return false;
        }
    }

    /**
     * Get a value from Redis with fallback support
     */
    async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
        const timerId = smartLog.startTimer('redis_get');
        this.stats.totalRequests++;

        try {
            if (!this.isConnected) {
                smartLog.info('Redis unavailable, using fallback cache for GET', { key });
                this.updateStats(timerId, false); // End timer here for this path
                return this.getFallback<T>(key);
            }

            const value = await this.client.get(key);

            if (value) {
                this.stats.hits++;
                this.updateStats(timerId, true);

                const deserializedValue = this.deserialize(value, options.compress);
                smartLog.info('Redis GET hit', {
                    key,
                    size: value.length,
                    compressed: options.compress || false
                });
                return deserializedValue as T;
            } else {
                this.stats.misses++;
                this.updateStats(timerId, true);
                smartLog.info('Redis GET miss', { key });

                // Check fallback cache for miss
                if (options.fallbackToMemory !== false) {
                    const fallbackValue = this.getFallback<T>(key);
                    if (fallbackValue) {
                        smartLog.info('Found value in fallback cache after Redis miss', { key });
                        return fallbackValue;
                    }
                }

                return null;
            }

        } catch (error) {
            this.stats.errors++;
            this.updateStats(timerId, false); // End timer here for this path
            smartLog.error('Redis GET error', error as Error, {
                key,
                fallbackEnabled: options.fallbackToMemory !== false
            });

            if (options.fallbackToMemory !== false) {
                return this.getFallback<T>(key);
            }
            return null;
        }
    }

    /**
     * Delete a key from Redis and fallback cache
     */
    async del(key: string): Promise<boolean> {
        const timerId = smartLog.startTimer('redis_del');

        try {
            if (!this.isConnected) {
                this.fallbackCache.delete(key);
                smartLog.info('Redis unavailable, deleted from fallback cache only', { key });
                return true;
            }

            await this.client.del(key);
            this.fallbackCache.delete(key); // Also remove from fallback

            smartLog.info('Redis DEL success', { key });
            return true;

        } catch (error) {
            smartLog.error('Redis DEL error', error as Error, { key });
            this.fallbackCache.delete(key); // Still remove from fallback
            return false;
        } finally {
            smartLog.endTimer(timerId); // This method only has one endTimer call
        }
    }

    /**
     * Delete multiple keys matching a pattern
     */
    async deletePattern(pattern: string): Promise<number> {
        const timerId = smartLog.startTimer('redis_delete_pattern');

        try {
            if (!this.isConnected) {
                let count = 0;
                for (const key of this.fallbackCache.keys()) {
                    if (this.matchPattern(key, pattern)) {
                        this.fallbackCache.delete(key);
                        count++;
                    }
                }
                smartLog.info('Pattern deletion from fallback cache', {
                    pattern,
                    deletedCount: count
                });
                return count;
            }

            const keys = await this.client.keys(pattern);
            if (keys.length > 0) {
                await this.client.del(keys);
                smartLog.info('Redis pattern deletion completed', {
                    pattern,
                    deletedCount: keys.length
                });
            }

            // Also clean from fallback cache
            let fallbackCount = 0;
            for (const key of this.fallbackCache.keys()) {
                if (this.matchPattern(key, pattern)) {
                    this.fallbackCache.delete(key);
                    fallbackCount++;
                }
            }

            if (fallbackCount > 0) {
                smartLog.info('Also cleaned pattern from fallback cache', {
                    pattern,
                    fallbackCount
                });
            }

            return keys.length;

        } catch (error) {
            smartLog.error('Redis delete pattern error', error as Error, { pattern });
            return 0;
        } finally {
            smartLog.endTimer(timerId); // This method only has one endTimer call
        }
    }

    // ===== FALLBACK CACHE METHODS =====

    /**
     * Set value in fallback memory cache
     */
    private setFallback(key: string, value: any, options: CacheOptions): boolean {
        const ttl = options.ttl || parseInt(process.env.CACHE_SESSION_TTL || '3600');
        const expires = Date.now() + (ttl * 1000);

        this.fallbackCache.set(key, { data: value, expires });
        smartLog.info('Fallback cache SET', {
            key,
            ttl,
            cacheSize: this.fallbackCache.size
        });
        return true;
    }

    /**
     * Get value from fallback memory cache
     */
    private getFallback<T>(key: string): T | null {
        const cached = this.fallbackCache.get(key);
        if (!cached) return null;

        if (Date.now() > cached.expires) {
            this.fallbackCache.delete(key);
            smartLog.info('Fallback cache entry expired and removed', { key });
            return null;
        }

        smartLog.info('Fallback cache hit', { key });
        return cached.data as T;
    }

    // ===== SERIALIZATION METHODS =====

    /**
     * Serialize value for storage (with optional compression)
     */
    private serialize(value: any, compress = false): string {
        try {
            const json = JSON.stringify(value);

            // TODO: Add compression implementation if needed
            if (compress && json.length > 1024) {
                smartLog.info('Large object detected, compression recommended', {
                    size: json.length,
                    compressionAvailable: false // Update when implemented
                });
            }

            return json;
        } catch (error) {
            smartLog.error('Serialization error', error as Error, {
                valueType: typeof value,
                hasCircularRef: this.hasCircularReference(value)
            });
            throw error;
        }
    }

    /**
     * Deserialize value from storage (with optional decompression)
     */
    private deserialize(value: string, decompress = false): any {
        try {
            // TODO: Add decompression if needed
            return JSON.parse(value);
        } catch (error) {
            smartLog.error('Deserialization error', error as Error, {
                valueLength: value.length,
                valuePreview: value.substring(0, 100)
            });
            throw error;
        }
    }

    /**
     * Check for circular references in object
     */
    private hasCircularReference(obj: any): boolean {
        try {
            JSON.stringify(obj);
            return false;
        } catch (error) {
            return error instanceof TypeError && error.message.includes('circular');
        }
    }

    // ===== UTILITY METHODS =====

    /**
     * Match key against pattern (supports * and ? wildcards)
     */
    private matchPattern(key: string, pattern: string): boolean {
        const regex = new RegExp(
            pattern
                .replace(/\*/g, '.*')
                .replace(/\?/g, '.')
                .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape other regex chars
        );
        return regex.test(key);
    }

    /**
     * Update performance statistics
     */
    private updateStats(timerId: string, success: boolean): void {
        const responseTime = smartLog.endTimer(timerId);
        if (responseTime !== null) {
            this.stats.avgResponseTime = Math.round(
                (this.stats.avgResponseTime * (this.stats.totalRequests - 1) + responseTime) / this.stats.totalRequests
            );
        }
    }

    // ===== MONITORING AND HEALTH CHECKS =====

    /**
     * Setup periodic health checks
     */
    private setupHealthChecks(): void {
        setInterval(async () => {
            try {
                if (this.isConnected) {
                    await this.client.ping();
                    smartLog.info('Redis health check passed');
                } else {
                    smartLog.info('Redis health check skipped - not connected');
                }
            } catch (error) {
                smartLog.warn('Redis health check failed', {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    wasConnected: this.isConnected
                });
                this.isConnected = false;
            }
        }, 30000); // Every 30 seconds
    }

    /**
     * Setup performance monitoring and reporting
     */
    private setupPerformanceMonitoring(): void {
        setInterval(() => {
            const stats = this.getStats();

            smartLog.info('Redis performance report', {
                stats,
                fallbackCacheSize: this.fallbackCache.size,
                isConnected: this.isConnected,
                circuitBreakerOpen: Date.now() < this.circuitBreakerOpenUntil
            });

            // Log as business event if there are performance issues
            if (stats.avgResponseTime > 1000 || stats.errors > 10) {
                smartLog.businessEvent('redis_performance_degradation', {
                    avgResponseTime: stats.avgResponseTime,
                    errorCount: stats.errors,
                    hitRate: stats.hitRate,
                    isConnected: this.isConnected
                });
            }

            // Clean up expired fallback cache entries
            this.cleanupFallbackCache();

        }, 300000); // Every 5 minutes
    }

    /**
     * Clean up expired entries from fallback cache
     */
    private cleanupFallbackCache(): void {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [key, entry] of this.fallbackCache.entries()) {
            if (now > entry.expires) {
                this.fallbackCache.delete(key);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            smartLog.info('Fallback cache cleanup completed', {
                cleanedEntries: cleanedCount,
                remainingEntries: this.fallbackCache.size
            });
        }
    }

    // ===== PUBLIC STATUS AND HEALTH METHODS =====

    /**
     * Get current cache statistics
     */
    getStats(): CacheStats & {
        hitRate: string;
        isConnected: boolean;
        fallbackSize: number;
        circuitBreakerOpen: boolean;
    } {
        const hitRate = this.stats.totalRequests > 0 ?
            ((this.stats.hits / this.stats.totalRequests) * 100).toFixed(2) + '%' : '0%';

        return {
            ...this.stats,
            hitRate,
            isConnected: this.isConnected,
            fallbackSize: this.fallbackCache.size,
            circuitBreakerOpen: Date.now() < this.circuitBreakerOpenUntil
        };
    }

    /**
     * Perform comprehensive health check
     */
    async healthCheck(): Promise<{
        healthy: boolean;
        latency?: number;
        error?: string;
        stats: ReturnType<typeof this.getStats>;
        fallbackActive: boolean;
        details: string[];
    }> {
        const details: string[] = [];
        let latency: number | undefined;

        if (!this.isConnected) {
            details.push('Redis connection not established');
            details.push(`Fallback cache active with ${this.fallbackCache.size} entries`);
            return {
                healthy: false,
                error: 'Not connected to Redis',
                stats: this.getStats(),
                fallbackActive: true,
                details
            };
        }

        try {
            const start = Date.now();
            await this.client.ping();
            latency = Date.now() - start;

            details.push(`Redis ping successful (${latency}ms)`);
            details.push(`Cache stats: ${this.getStats().hitRate} hit rate`);

            if (this.fallbackCache.size > 0) {
                details.push(`Fallback cache has ${this.fallbackCache.size} entries`);
            }

            const healthy = latency < 1000; // Consider unhealthy if ping > 1s
            if (!healthy) {
                details.push('High latency detected');
            }

            return {
                healthy,
                latency,
                stats: this.getStats(),
                fallbackActive: this.fallbackCache.size > 0,
                details
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            details.push(`Redis ping failed: ${errorMessage}`);

            smartLog.error('Redis health check failed', error as Error);

            return {
                healthy: false,
                error: errorMessage,
                stats: this.getStats(),
                fallbackActive: true,
                details
            };
        }
    }

    /**
     * Graceful shutdown and cleanup
     */
    async disconnect(): Promise<void> {
        smartLog.info('Redis service shutting down', {
            isConnected: this.isConnected,
            fallbackCacheSize: this.fallbackCache.size,
            stats: this.getStats()
        });

        if (this.client && this.isConnected) {
            try {
                await this.client.disconnect();
                smartLog.info('Redis client disconnected successfully');
            } catch (error) {
                smartLog.error('Error during Redis disconnect', error as Error);
            }
            this.isConnected = false;
        }

        // Clear fallback cache
        this.fallbackCache.clear();

        smartLog.businessEvent('redis_service_shutdown', {
            finalStats: this.getStats()
        });
    }
}

// ===== EXPORT SINGLETON INSTANCE =====

export const redisService = RedisService.getInstance();

// ===== GRACEFUL SHUTDOWN HANDLING =====

process.on('SIGINT', async () => {
    smartLog.info('SIGINT received, shutting down Redis service');
    await redisService.disconnect();
});

process.on('SIGTERM', async () => {
    smartLog.info('SIGTERM received, shutting down Redis service');
    await redisService.disconnect();
});

// ===== TYPE EXPORTS =====

export type { CacheOptions, CacheStats };

smartLog.info('Redis service module loaded', {
    fallbackCacheEnabled: true,
    compressionSupported: false, // Update when implemented
    circuitBreakerEnabled: true,
    healthCheckInterval: 30000,
    performanceReportInterval: 300000
});
