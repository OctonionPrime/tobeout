// server/services/logging.service.ts

import pino from 'pino';

// Base configuration for the logger
const loggerConfig = {
  level: process.env.LOG_LEVEL || 'info', // Sets the default logging level to 'info'
  timestamp: pino.stdTimeFunctions.isoTime, // Use standard ISO time format for timestamps
  formatters: {
    // This ensures the log level ('info', 'error', etc.) is displayed in uppercase
    level: (label: string) => {
      return { level: label.toUpperCase() };
    },
  },
  // This is a crucial part for development vs. production logging
  // If you are NOT in production, it will use 'pino-pretty' to make logs colorful and readable.
  // In production, it will output standard JSON, which is what logging systems use.
  transport: process.env.NODE_ENV !== 'production'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname', // Hides unnecessary details
        },
      }
    : undefined,
};

// Create the main "root" logger instance with our configuration
const rootLogger = pino(loggerConfig);

/**
 * Creates a specialized "child" logger with bound context.
 * This is the MOST IMPORTANT function. When we give it a `conversationId`,
 * every log message created with this child logger will automatically include that ID.
 * This is how we will track a single conversation through the entire system.
 *
 * @param context - An object with details to attach to every log message, e.g., { conversationId: 'xyz' }
 * @returns A pino logger instance with the context attached.
 */
export function createLogger(context: Record<string, any>): pino.Logger {
  return rootLogger.child(context);
}

// We also export the root logger for general application-level logs (e.g., "Server started")
export const log = rootLogger;

// A log message to confirm this file has been loaded by your application
log.info('Logging service initialized successfully.');