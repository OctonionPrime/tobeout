// server/db.ts

import 'dotenv/config';
import { Pool, PoolConfig } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

// Validate required environment variables
if (!process.env.DATABASE_URL) {
    throw new Error(
        "DATABASE_URL must be set. Did you forget to provision a database?",
    );
}

// Parse database URL for better error messages
const isProduction = process.env.NODE_ENV === 'production';

// Configure connection pool with production-ready settings
const poolConfig: PoolConfig = {
    connectionString: process.env.DATABASE_URL,

    // Connection pool settings
    max: parseInt(process.env.DB_POOL_MAX || '20'), // Maximum number of clients in the pool
    min: parseInt(process.env.DB_POOL_MIN || '2'),  // Minimum number of clients in the pool

    // Connection timeout settings
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '3000'), // 3 seconds to connect
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'), // 30 seconds before idle connections are closed

    // Statement timeout to prevent long-running queries
    statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || '30000'), // 30 seconds

    // Keep alive to prevent connection drops
    keepAlive: true,
    keepAliveInitialDelayMillis: parseInt(process.env.DB_KEEPALIVE_DELAY || '10000'), // 10 seconds
};

// SSL configuration for production
if (isProduction && process.env.DATABASE_URL.includes('ssl=require')) {
    poolConfig.ssl = {
        rejectUnauthorized: false // Required for some hosted databases
    };
}

// Create the connection pool
export const pool = new Pool(poolConfig);

// Pool event handlers for monitoring
pool.on('error', (err, client) => {
    console.error('[Database] Unexpected error on idle client:', err);
    // In production, you might want to send this to your error tracking service
    // Sentry.captureException(err);
});

pool.on('connect', (client) => {
    console.log('[Database] New client connected to pool');

    // Set session-level settings for each new connection
    client.query(`
        SET statement_timeout = '${poolConfig.statement_timeout || 30000}';
        SET lock_timeout = '5000';
        SET idle_in_transaction_session_timeout = '60000';
    `).catch(err => {
        console.error('[Database] Failed to set session settings:', err);
    });
});

pool.on('acquire', (client) => {
    // Log when a client is checked out from the pool (useful for debugging)
    if (process.env.DB_DEBUG === 'true') {
        console.log('[Database] Client acquired from pool');
    }
});

pool.on('remove', (client) => {
    console.log('[Database] Client removed from pool');
});

// Create Drizzle instance with the pool
export const db = drizzle(pool, { schema });

// Health check function
export async function checkDatabaseConnection(): Promise<boolean> {
    try {
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT NOW()');
            console.log('[Database] Health check passed:', result.rows[0].now);
            return true;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('[Database] Health check failed:', error);
        return false;
    }
}

// Graceful shutdown function
export async function closeDatabaseConnection(): Promise<void> {
    try {
        console.log('[Database] Closing connection pool...');
        await pool.end();
        console.log('[Database] Connection pool closed successfully');
    } catch (error) {
        console.error('[Database] Error closing connection pool:', error);
        throw error;
    }
}

// Pool statistics for monitoring
export function getPoolStats() {
    return {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
    };
}

// Transaction helper for complex operations
export async function withTransaction<T>(
    callback: (client: any) => Promise<T>
): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Initialize database connection on startup
if (isProduction) {
    checkDatabaseConnection()
        .then(isConnected => {
            if (!isConnected) {
                console.error('[Database] Failed to connect on startup');
                process.exit(1);
            }
        })
        .catch(err => {
            console.error('[Database] Startup connection check failed:', err);
            process.exit(1);
        });
}

// Handle process termination gracefully
process.on('SIGINT', async () => {
    console.log('[Database] Received SIGINT, closing connections...');
    await closeDatabaseConnection();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('[Database] Received SIGTERM, closing connections...');
    await closeDatabaseConnection();
    process.exit(0);
});

// Export types for use in other files
export type DatabasePool = typeof pool;
export type DatabaseClient = typeof db;