// server/db.ts -  Production Configuration

import 'dotenv/config';
import { Pool, PoolConfig } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

// environment validation
const requiredEnvVars = ['DATABASE_URL'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    console.error(`[Database] FATAL: Missing required environment variables: ${missingVars.join(', ')}`);
    process.exit(1);
}

const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';

//  connection pool configuration
const poolConfig: PoolConfig = {
    connectionString: process.env.DATABASE_URL,

    // Production-optimized pool settings
    max: parseInt(process.env.DB_POOL_MAX || '12'), // Conservative for reliability
    min: parseInt(process.env.DB_POOL_MIN || '4'),  // Warm connections for performance
    
    // timeout settings
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '5000'),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '180000'), // 3 minutes
    
    // PostgreSQL optimization settings
    statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || '30000'),
    query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT || '30000'),
    
    //  connection settings
    keepAlive: true,
    keepAliveInitialDelayMillis: parseInt(process.env.DB_KEEPALIVE_DELAY || '10000'),
    application_name: 'tobeout-restaurant-mgmt',
    
    // Connection quality settings
    types: {
        getTypeParser: (oid: number, format: string) => {
            // Custom type parsing for better data integrity
            return (val: string) => val;
        }
    }
};

// SSL configuration for production
if (isProduction && process.env.DATABASE_URL.includes('ssl=require')) {
    poolConfig.ssl = {
        rejectUnauthorized: false
    };
}

// Create the connection pool
export const pool = new Pool(poolConfig);

// error handling with categorization
pool.on('error', (err: any, client) => {
    const timestamp = new Date().toISOString();
    
    // Categorize errors for better monitoring
    switch (err.code) {
        case '57P01': // Admin shutdown
            console.warn(`[Database] ${timestamp} Connection terminated by administrator - auto-recovering`);
            break;
        case 'ECONNRESET':
            console.warn(`[Database] ${timestamp} Network connection reset - auto-recovering`);
            break;
        case 'ENOTFOUND':
            console.error(`[Database] ${timestamp} CRITICAL: Database host unreachable`);
            break;
        case '28P01': // Auth failed
            console.error(`[Database] ${timestamp} CRITICAL: Authentication failed`);
            break;
        case '53300': // Too many connections
            console.error(`[Database] ${timestamp} WARNING: Database connection limit reached`);
            break;
        default:
            console.error(`[Database] ${timestamp} Unexpected error [${err.code}]:`, err.message);
    }
    
    // In production, send critical errors to monitoring service
    if (isProduction && ['ENOTFOUND', '28P01', '53300'].includes(err.code)) {
        // TODO: Integrate with monitoring service (Sentry, DataDog, etc.)
        // reportCriticalError(err);
    }
});

// connection logging
pool.on('connect', (client) => {
    const shouldLog = isDevelopment || process.env.DB_CONNECTION_LOGGING === 'all';
    if (shouldLog) {
        console.log(`[Database] Connection established (Pool: ${pool.totalCount}/${poolConfig.max})`);
    }
    
    // Set optimal session parameters for each connection
    client.query(`
        SET statement_timeout = '${poolConfig.statement_timeout}';
        SET lock_timeout = '5000';
        SET idle_in_transaction_session_timeout = '60000';
        SET search_path = public;
        SET timezone = 'Europe/Moscow';
    `).catch(err => {
        console.error('[Database] Failed to set session parameters:', err.message);
    });
    
    // Client-specific error handling
    client.on('error', (err: any) => {
        if (process.env.DB_CONNECTION_LOGGING !== 'none') {
            console.error(`[Database] Client error:`, err.message);
        }
    });
});

pool.on('acquire', (client) => {
    // Only log in debug mode
    if (process.env.DB_DEBUG === 'true') {
        console.log(`[Database] Client acquired (Available: ${pool.idleCount})`);
    }
});

pool.on('remove', (client) => {
    // Only log connection removal in debug or development
    if (isDevelopment || process.env.DB_DEBUG === 'true') {
        console.log(`[Database] Connection removed (Pool: ${pool.totalCount}/${poolConfig.max})`);
    }
});

// Create Drizzle instance
export const db = drizzle(pool, { schema });

// health monitoring
let healthCheckCount = 0;
let lastHealthCheckTime = Date.now();
let consecutiveFailures = 0;

export async function checkDatabaseConnection(): Promise<boolean> {
    const startTime = Date.now();
    
    try {
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
            const duration = Date.now() - startTime;
            
            healthCheckCount++;
            consecutiveFailures = 0;
            lastHealthCheckTime = Date.now();
            
            // Log health status periodically (every 12th check in production)
            if (isDevelopment || healthCheckCount % 12 === 0) {
                console.log(`[Database] Health check #${healthCheckCount} passed (${duration}ms) - PostgreSQL healthy`);
            }
            
            return true;
        } finally {
            client.release();
        }
    } catch (error: any) {
        consecutiveFailures++;
        const duration = Date.now() - startTime;
        
        console.error(`[Database] Health check #${healthCheckCount + 1} failed (${duration}ms):`, error.message);
        
        // Alert on consecutive failures
        if (consecutiveFailures >= 3) {
            console.error(`[Database] ALERT: ${consecutiveFailures} consecutive health check failures`);
            // TODO: Trigger alerting system
        }
        
        return false;
    }
}

// connection monitoring
export function getConnectionMetrics() {
    return {
        timestamp: new Date().toISOString(),
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
        maxConnections: poolConfig.max,
        minConnections: poolConfig.min,
        healthCheckCount,
        lastHealthCheck: new Date(lastHealthCheckTime).toISOString(),
        consecutiveFailures,
        uptime: process.uptime()
    };
}

// graceful shutdown
export async function closeDatabaseConnection(): Promise<void> {
    console.log('[Database] Initiating graceful shutdown...');
    
    try {
        // Stop health monitoring
        if (healthCheckInterval) {
            clearInterval(healthCheckInterval);
        }
        
        // Close pool gracefully
        await pool.end();
        console.log('[Database] Connection pool closed successfully');
    } catch (error: any) {
        console.error('[Database] Error during shutdown:', error.message);
        throw error;
    }
}

// Transaction helper with retry logic
export async function withTransaction<T>(
    callback: (client: any) => Promise<T>,
    maxRetries = 3
): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error: any) {
            await client.query('ROLLBACK');
            
            // Retry on serialization failures
            if (error.code === '40001' && attempt < maxRetries) {
                console.warn(`[Database] Transaction retry ${attempt}/${maxRetries} due to serialization failure`);
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
                continue;
            }
            
            throw error;
        } finally {
            client.release();
        }
    }
    
    throw new Error('Transaction failed after maximum retries');
}

// Query with automatic retry for connection issues
export async function queryWithRetry(text: string, params?: any[], retries = 2): Promise<any> {
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
        try {
            const result = await pool.query(text, params);
            return result;
        } catch (err: any) {
            const isRetriable = ['57P01', 'ECONNRESET', 'ENOTFOUND', '53300'].includes(err.code);
            
            if (isRetriable && attempt <= retries) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                console.warn(`[Database] Query retry ${attempt}/${retries + 1} in ${delay}ms (${err.code})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            throw err;
        }
    }
}

// monitoring setup
let healthCheckInterval: NodeJS.Timeout;

const startHealthMonitoring = () => {
    if (process.env.DB_HEALTH_MONITORING === 'true' || isProduction) {
        healthCheckInterval = setInterval(async () => {
            await checkDatabaseConnection();
            
            // Log metrics periodically in production
            if (isProduction && healthCheckCount % 20 === 0) {
                const metrics = getConnectionMetrics();
                console.log(`[Database] Metrics: ${metrics.total}/${metrics.maxConnections} connections, ${metrics.consecutiveFailures} failures`);
            }
        }, 5 * 60 * 1000); // Every 5 minutes
        
        console.log('[Database] Professional health monitoring started');
    }
};

// startup validation
if (isProduction) {
    checkDatabaseConnection()
        .then(isHealthy => {
            if (!isHealthy) {
                console.error('[Database] FATAL: Startup health check failed');
                process.exit(1);
            }
            
            console.log('[Database] Production startup validation passed');
            startHealthMonitoring();
        })
        .catch(err => {
            console.error('[Database] FATAL: Startup failed:', err.message);
            process.exit(1);
        });
} else {
    // Development mode
    startHealthMonitoring();
}

// signal handling
const handleShutdown = async (signal: string) => {
    console.log(`[Database] Received ${signal}, shutting down gracefully...`);
    try {
        await closeDatabaseConnection();
        console.log('[Database] Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        console.error('[Database] Shutdown error:', error);
        process.exit(1);
    }
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Handle uncaught exceptions related to database
process.on('uncaughtException', (error) => {
    if (error.message.includes('pool') || error.message.includes('database')) {
        console.error('[Database] FATAL: Uncaught database exception:', error);
        process.exit(1);
    }
});

// Export types
export type DatabasePool = typeof pool;
export type DatabaseClient = typeof db;

// Export connection health status for monitoring endpoints
export const getDatabaseHealth = () => ({
    healthy: consecutiveFailures === 0,
    consecutiveFailures,
    lastHealthCheck: lastHealthCheckTime,
    uptime: process.uptime(),
    connections: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
    }
});