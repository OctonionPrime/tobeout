// server/services/smart-logging.service.ts
// 🚀 Smart Logging Service - ES Module Compatible Version
// ✅ Local file logging with rotation
// ✅ Selective Datadog integration for critical events only
// ✅ Performance monitoring with built-in timers
// ✅ Error tracking with fingerprinting
// ✅ Business event analytics
// ✅ Zero monthly cost with premium capabilities

import winston from 'winston';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Types for structured logging
interface BusinessEventData {
    sessionId?: string;
    reservationId?: number;
    platform?: string;
    language?: string;
    [key: string]: any;
}

interface PerformanceTimer {
    operation: string;
    startTime: number;
    metadata?: any;
}

interface ErrorEntry {
    timestamp: string;
    message: string;
    stack?: string;
    context: any;
    fingerprint: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
}

interface AnalyticsEntry {
    timestamp: string;
    event: string;
    data: any;
}

/**
 * Smart Logging Service - Professional logging with free tier optimization
 * 🔧 ES MODULE COMPATIBLE VERSION
 * 
 * Features:
 * - Local file logging with automatic rotation
 * - Selective Datadog integration (critical events only)
 * - Built-in performance monitoring
 * - Error tracking with deduplication
 * - Business analytics generation
 * - Daily HTML reports
 * - Real-time health monitoring
 */
export class SmartLoggingService {
    private static instance: SmartLoggingService;
    private logger: winston.Logger;
    private datadogLogger?: winston.Logger;
    
    // In-memory storage for analytics and performance
    private businessEvents: AnalyticsEntry[] = [];
    private errors: ErrorEntry[] = [];
    private performanceTimers = new Map<string, PerformanceTimer>();
    private performanceMetrics = new Map<string, number[]>();
    
    // Configuration
    private readonly MAX_EVENTS = 1000;
    private readonly MAX_ERRORS = 500;
    private readonly DATADOG_ENABLED = process.env.ENABLE_DATADOG === 'true' && !!process.env.DATADOG_API_KEY;
    
    constructor() {
        this.setupDirectories();
        this.setupLocalLogger();
        this.setupDatadogLogger();
        this.setupPeriodicTasks();
        
        console.log('🚀 [SmartLogging] Service initialized with:');
        console.log(`   📁 Local logging: ✅ (logs/ directory)`);
        console.log(`   📊 Datadog: ${this.DATADOG_ENABLED ? '✅ (critical events only)' : '❌ (disabled)'}`);
        console.log(`   ⚡ Performance monitoring: ✅`);
        console.log(`   🔍 Error tracking: ✅`);
        console.log(`   📈 Analytics: ✅ (daily reports)`);
    }

    /**
     * Create necessary directories for logging
     */
    private setupDirectories(): void {
        const dirs = ['logs', 'analytics', 'performance', 'reports', 'errors'];
        dirs.forEach(dir => {
            const fullPath = path.join(process.cwd(), dir);
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true });
            }
        });
    }

    /**
     * Setup local file logging with rotation
     */
    private setupLocalLogger(): void {
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                winston.format.errors({ stack: true }),
                winston.format.json()
            ),
            transports: [
                // Console for development
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.printf(({ level, message, timestamp, ...meta }) => {
                            const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
                            return `${timestamp} [${level}] ${message} ${metaStr}`;
                        })
                    )
                }),
                // Main application log with rotation
                new winston.transports.File({
                    filename: 'logs/app.log',
                    maxsize: 10 * 1024 * 1024, // 10MB
                    maxFiles: 10,
                    tailable: true
                }),
                // Error-only log
                new winston.transports.File({
                    filename: 'logs/error.log',
                    level: 'error',
                    maxsize: 5 * 1024 * 1024, // 5MB
                    maxFiles: 5
                }),
                // Business events log
                new winston.transports.File({
                    filename: 'logs/business-events.log',
                    level: 'info',
                    maxsize: 5 * 1024 * 1024, // 5MB
                    maxFiles: 5,
                    format: winston.format.combine(
                        winston.format.timestamp(),
                        winston.format.printf(({ timestamp, message, ...meta }) => {
                            if (message.startsWith('BUSINESS_EVENT:')) {
                                return JSON.stringify({ timestamp, ...meta });
                            }
                            return JSON.stringify({ timestamp, message, ...meta });
                        })
                    )
                })
            ]
        });
    }

    /**
     * Setup Datadog logging for critical events only (ES Module compatible)
     */
    private setupDatadogLogger(): void {
        if (!this.DATADOG_ENABLED) {
            console.log('📊 [SmartLogging] Datadog disabled - critical events will be logged locally only');
            return;
        }

        try {
            // 🔧 ES MODULE FIX: Use dynamic import instead of require
            this.initializeDatadogTransport();
        } catch (error) {
            console.warn('📊 [SmartLogging] Datadog setup failed:', error);
            this.datadogLogger = undefined;
        }
    }

    /**
     * 🔧 ES MODULE FIX: Async Datadog initialization
     */
    private async initializeDatadogTransport(): Promise<void> {
        try {
            // Dynamic import for Datadog transport (ES Module compatible)
            const { DatadogTransport } = await import('@shelf/winston-datadog-logs-transport');
            
            this.datadogLogger = winston.createLogger({
                level: 'info',
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.json()
                ),
                transports: [
                    new DatadogTransport({
                        apiKey: process.env.DATADOG_API_KEY!,
                        hostname: process.env.DATADOG_HOSTNAME || 'restaurant-booking',
                        service: process.env.DATADOG_SERVICE || 'booking-system',
                        ddsource: 'nodejs',
                        ddtags: `env:${process.env.NODE_ENV || 'development'},app:restaurant-booking`
                    })
                ]
            });
            
            console.log('📊 [SmartLogging] Datadog configured for critical events');
        } catch (error) {
            console.warn('📊 [SmartLogging] Datadog transport not available:', error);
            this.datadogLogger = undefined;
        }
    }

    /**
     * Setup periodic tasks for analytics and cleanup
     */
    private setupPeriodicTasks(): void {
        // Generate daily analytics every 24 hours
        setInterval(() => {
            this.generateDailyAnalytics();
        }, 24 * 60 * 60 * 1000);

        // Clean up old events every hour
        setInterval(() => {
            this.cleanupOldEvents();
        }, 60 * 60 * 1000);

        // Generate performance reports every hour
        setInterval(() => {
            this.generatePerformanceReport();
        }, 60 * 60 * 1000);

        console.log('⏰ [SmartLogging] Periodic tasks scheduled');
    }

    // ===== PUBLIC LOGGING METHODS =====

    /**
     * Log business events - These may go to Datadog if critical
     */
    businessEvent(event: string, data: BusinessEventData = {}): void {
        const entry: AnalyticsEntry = {
            timestamp: new Date().toISOString(),
            event: `business.${event}`,
            data: { ...data }
        };

        // Store locally always
        this.businessEvents.push(entry);
        this.trimArray(this.businessEvents, this.MAX_EVENTS);

        // Log to file
        this.logger.info(`BUSINESS_EVENT: ${event}`, entry);

        // Send to Datadog only for critical events
        if (this.shouldSendToDatadog(event)) {
            this.datadogLogger?.info(`Critical business event: ${event}`, entry);
            console.log(`📊 [SmartLogging] Critical event sent to Datadog: ${event}`);
        }

        console.log(`📈 [SmartLogging] Business event: ${event}`, data);
    }

    /**
     * Standard info logging
     */
    info(message: string, meta: any = {}): void {
        const logEntry = {
            ...meta,
            timestamp: new Date().toISOString()
        };
        
        this.logger.info(message, logEntry);
    }

    /**
     * Warning logging
     */
    warn(message: string, meta: any = {}): void {
        const logEntry = {
            ...meta,
            timestamp: new Date().toISOString()
        };
        
        this.logger.warn(message, logEntry);
    }

    /**
     * Error logging with automatic fingerprinting and tracking
     */
    error(message: string, error: Error, meta: any = {}): void {
        const errorEntry = {
            message: error.message,
            stack: error.stack,
            ...meta,
            timestamp: new Date().toISOString()
        };

        // Log to file
        this.logger.error(message, errorEntry);

        // Track error for analytics
        this.trackError(error, { message, ...meta });

        // Send critical errors to Datadog
        if (this.isCriticalError(error) && this.datadogLogger) {
            this.datadogLogger.error(`Critical error: ${message}`, errorEntry);
            console.log(`🚨 [SmartLogging] Critical error sent to Datadog: ${message}`);
        }
    }

    // ===== PERFORMANCE MONITORING =====

    /**
     * Start a performance timer
     */
    startTimer(operation: string, metadata: any = {}): string {
        const timerId = `${operation}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        this.performanceTimers.set(timerId, {
            operation,
            startTime: Date.now(),
            metadata
        });

        return timerId;
    }

    /**
     * End a performance timer and log the result
     */
    endTimer(timerId: string): number | null {
        const timer = this.performanceTimers.get(timerId);
        if (!timer) {
            console.warn(`⚡ [SmartLogging] Timer not found: ${timerId}`);
            return null;
        }

        const duration = Date.now() - timer.startTime;
        this.performanceTimers.delete(timerId);

        // Store metrics
        const operation = timer.operation;
        if (!this.performanceMetrics.has(operation)) {
            this.performanceMetrics.set(operation, []);
        }
        this.performanceMetrics.get(operation)!.push(duration);

        // Log performance info
        this.info(`Performance: ${operation}`, {
            operation,
            durationMs: duration,
            ...timer.metadata
        });

        // Log slow operations as warnings
        if (duration > 5000) { // Over 5 seconds
            this.warn(`Slow operation detected: ${operation}`, {
                operation,
                durationMs: duration,
                threshold: 5000,
                ...timer.metadata
            });

            // Send extremely slow operations to Datadog
            if (duration > 10000 && this.datadogLogger) { // Over 10 seconds
                this.datadogLogger.warn(`Extremely slow operation: ${operation}`, {
                    operation,
                    durationMs: duration,
                    ...timer.metadata
                });
            }
        }

        return duration;
    }

    // ===== ERROR TRACKING =====

    /**
     * Track errors with fingerprinting for deduplication
     */
    private trackError(error: Error, context: any = {}): void {
        const fingerprint = this.generateErrorFingerprint(error);
        const timestamp = new Date().toISOString();

        // Find existing error
        const existingError = this.errors.find(e => e.fingerprint === fingerprint);

        if (existingError) {
            existingError.count++;
            existingError.lastSeen = timestamp;
        } else {
            const newError: ErrorEntry = {
                timestamp,
                message: error.message,
                stack: error.stack,
                context,
                fingerprint,
                count: 1,
                firstSeen: timestamp,
                lastSeen: timestamp
            };
            
            this.errors.unshift(newError);
            this.trimArray(this.errors, this.MAX_ERRORS);
        }
    }

    /**
     * Generate error fingerprint for deduplication
     */
    private generateErrorFingerprint(error: Error): string {
        const stackLines = (error.stack || '').split('\n').slice(0, 3).join('');
        const content = error.message + stackLines;
        return crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
    }

    // ===== ANALYTICS AND REPORTING =====

    /**
     * Generate daily analytics report
     */
    private generateDailyAnalytics(): void {
        const today = new Date().toISOString().split('T')[0];
        const todayEvents = this.businessEvents.filter(e => 
            e.timestamp.startsWith(today)
        );

        const analytics = {
            date: today,
            summary: {
                totalEvents: todayEvents.length,
                uniqueEventTypes: [...new Set(todayEvents.map(e => e.event))].length,
                errorCount: this.errors.filter(e => e.firstSeen.startsWith(today)).length
            },
            events: {
                bookings: this.countEvents(todayEvents, 'business.booking_created'),
                cancellations: this.countEvents(todayEvents, 'business.booking_canceled'),
                modifications: this.countEvents(todayEvents, 'business.reservation_modified'),
                conversationStarts: this.countEvents(todayEvents, 'business.conversation_started'),
                aiFailures: this.countEvents(todayEvents, 'business.ai_fallback'),
                systemErrors: this.countEvents(todayEvents, 'business.system_error')
            },
            platforms: this.groupEventsByField(todayEvents, 'data.platform'),
            languages: this.groupEventsByField(todayEvents, 'data.language'),
            performance: this.getPerformanceSummary(),
            topErrors: this.getTopErrors(5),
            generatedAt: new Date().toISOString()
        };

        // Save analytics
        const analyticsPath = path.join('analytics', `${today}.json`);
        fs.writeFileSync(analyticsPath, JSON.stringify(analytics, null, 2));

        // Generate HTML report
        this.generateHTMLReport(analytics);

        console.log(`📊 [SmartLogging] Daily analytics generated: ${analytics.summary.totalEvents} events, ${analytics.events.bookings} bookings`);
    }

    /**
     * Generate performance report
     */
    private generatePerformanceReport(): void {
        const summary = this.getPerformanceSummary();
        const timestamp = new Date().toISOString();
        const hour = timestamp.split('T')[1].split(':')[0];
        
        const report = {
            timestamp,
            hour,
            metrics: summary,
            system: {
                memory: process.memoryUsage(),
                uptime: process.uptime(),
                version: process.version
            }
        };

        // Save hourly performance report
        const perfPath = path.join('performance', `performance_${timestamp.split('T')[0]}_${hour}.json`);
        fs.writeFileSync(perfPath, JSON.stringify(report, null, 2));

        // Clear metrics after reporting
        this.performanceMetrics.clear();

        console.log(`⚡ [SmartLogging] Performance report generated for hour ${hour}`);
    }

    /**
     * Generate HTML dashboard report
     */
    private generateHTMLReport(analytics: any): void {
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Restaurant Booking System - Daily Report</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; margin-bottom: 20px; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .metric-card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .metric-value { font-size: 2em; font-weight: bold; color: #333; }
        .metric-label { color: #666; margin-top: 5px; }
        .success { border-left: 4px solid #4CAF50; }
        .warning { border-left: 4px solid #FF9800; }
        .danger { border-left: 4px solid #f44336; }
        .info { border-left: 4px solid #2196F3; }
        .section { background: white; padding: 25px; margin-bottom: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .section h2 { margin-top: 0; color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f8f9fa; font-weight: 600; }
        .footer { text-align: center; color: #666; margin-top: 30px; padding: 20px; }
        .status-good { color: #4CAF50; font-weight: bold; }
        .status-warning { color: #FF9800; font-weight: bold; }
        .status-danger { color: #f44336; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Restaurant Booking System Daily Report</h1>
            <p>Date: ${analytics.date} | Generated: ${new Date().toLocaleString()}</p>
        </div>

        <div class="metrics-grid">
            <div class="metric-card success">
                <div class="metric-value">${analytics.events.bookings}</div>
                <div class="metric-label">Total Bookings</div>
            </div>
            <div class="metric-card ${analytics.events.cancellations > analytics.events.bookings * 0.2 ? 'warning' : 'success'}">
                <div class="metric-value">${analytics.events.cancellations}</div>
                <div class="metric-label">Cancellations</div>
            </div>
            <div class="metric-card ${analytics.events.systemErrors > 10 ? 'danger' : 'success'}">
                <div class="metric-value">${analytics.events.systemErrors}</div>
                <div class="metric-label">System Errors</div>
            </div>
            <div class="metric-card info">
                <div class="metric-value">${analytics.summary.totalEvents}</div>
                <div class="metric-label">Total Events</div>
            </div>
        </div>

        <div class="section">
            <h2>📈 Business Metrics</h2>
            <table>
                <tr><th>Metric</th><th>Count</th><th>Status</th></tr>
                <tr><td>New Conversations</td><td>${analytics.events.conversationStarts}</td><td><span class="status-good">✅ Active</span></td></tr>
                <tr><td>Successful Bookings</td><td>${analytics.events.bookings}</td><td><span class="status-good">✅ Good</span></td></tr>
                <tr><td>Modifications</td><td>${analytics.events.modifications}</td><td><span class="status-good">✅ Normal</span></td></tr>
                <tr><td>AI Fallbacks</td><td>${analytics.events.aiFailures}</td><td><span class="${analytics.events.aiFailures > 5 ? 'status-warning' : 'status-good'}">${analytics.events.aiFailures > 5 ? '⚠️ High' : '✅ Low'}</span></td></tr>
            </table>
        </div>

        <div class="section">
            <h2>⚡ Performance Metrics</h2>
            <table>
                <tr><th>Operation</th><th>Avg Time (ms)</th><th>Count</th><th>Status</th></tr>
                ${Object.entries(analytics.performance || {}).map(([op, data]: [string, any]) => `
                    <tr>
                        <td>${op}</td>
                        <td class="${data.avg > 2000 ? 'status-danger' : data.avg > 1000 ? 'status-warning' : 'status-good'}">${data.avg}ms</td>
                        <td>${data.count}</td>
                        <td><span class="${data.avg > 2000 ? 'status-danger' : data.avg > 1000 ? 'status-warning' : 'status-good'}">${data.avg > 2000 ? '🐌 Slow' : data.avg > 1000 ? '⚠️ Moderate' : '⚡ Fast'}</span></td>
                    </tr>
                `).join('')}
            </table>
        </div>

        ${analytics.topErrors && analytics.topErrors.length > 0 ? `
        <div class="section">
            <h2>🚨 Top Errors</h2>
            <table>
                <tr><th>Error</th><th>Count</th><th>First Seen</th><th>Last Seen</th></tr>
                ${analytics.topErrors.map((error: any) => `
                    <tr>
                        <td>${error.message.substring(0, 60)}...</td>
                        <td><span class="status-danger">${error.count}</span></td>
                        <td>${new Date(error.firstSeen).toLocaleString()}</td>
                        <td>${new Date(error.lastSeen).toLocaleString()}</td>
                    </tr>
                `).join('')}
            </table>
        </div>
        ` : ''}

        <div class="section">
            <h2>🌍 Platform & Language Distribution</h2>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px;">
                <div>
                    <h3>Platforms</h3>
                    <table>
                        ${Object.entries(analytics.platforms || {}).map(([platform, count]) => `
                            <tr><td>${platform}</td><td>${count}</td></tr>
                        `).join('')}
                    </table>
                </div>
                <div>
                    <h3>Languages</h3>
                    <table>
                        ${Object.entries(analytics.languages || {}).map(([lang, count]) => `
                            <tr><td>${lang}</td><td>${count}</td></tr>
                        `).join('')}
                    </table>
                </div>
            </div>
        </div>

        <div class="footer">
            <p>🚀 Generated by SmartLoggingService | Free Tier Optimized | Professional Analytics</p>
            <p>📊 Dashboard automatically updates daily | Performance metrics updated hourly</p>
        </div>
    </div>
</body>
</html>`;

        const reportPath = path.join('reports', `daily_report_${analytics.date}.html`);
        fs.writeFileSync(reportPath, html);
        
        console.log(`📱 [SmartLogging] HTML report generated: ${reportPath}`);
    }

    // ===== UTILITY METHODS =====

    /**
     * Determine if event should be sent to Datadog
     */
    private shouldSendToDatadog(event: string): boolean {
        if (!this.datadogLogger) return false;
        
        const criticalEvents = [
            'booking_created',
            'booking_canceled',
            'system_error',
            'ai_fallback',
            'performance_degradation',
            'critical_error'
        ];
        
        return criticalEvents.includes(event);
    }

    /**
     * Determine if error is critical
     */
    private isCriticalError(error: Error): boolean {
        const criticalPatterns = [
            /database/i,
            /payment/i,
            /auth/i,
            /security/i,
            /critical/i,
            /fatal/i
        ];
        
        return criticalPatterns.some(pattern => 
            pattern.test(error.message) || pattern.test(error.stack || '')
        );
    }

    /**
     * Count events by type
     */
    private countEvents(events: AnalyticsEntry[], eventType: string): number {
        return events.filter(e => e.event === eventType).length;
    }

    /**
     * Group events by field
     */
    private groupEventsByField(events: AnalyticsEntry[], fieldPath: string): Record<string, number> {
        const groups: Record<string, number> = {};
        
        events.forEach(event => {
            const value = this.getNestedProperty(event, fieldPath) || 'unknown';
            groups[value] = (groups[value] || 0) + 1;
        });
        
        return groups;
    }

    /**
     * Get nested property from object
     */
    private getNestedProperty(obj: any, path: string): any {
        return path.split('.').reduce((current, key) => current?.[key], obj);
    }

    /**
     * Get performance summary
     */
    private getPerformanceSummary(): Record<string, any> {
        const summary: Record<string, any> = {};
        
        for (const [operation, durations] of this.performanceMetrics.entries()) {
            if (durations.length === 0) continue;
            
            const sorted = [...durations].sort((a, b) => a - b);
            summary[operation] = {
                count: durations.length,
                avg: Math.round(durations.reduce((a, b) => a + b) / durations.length),
                min: sorted[0],
                max: sorted[sorted.length - 1],
                p50: sorted[Math.floor(sorted.length * 0.5)],
                p95: sorted[Math.floor(sorted.length * 0.95)]
            };
        }
        
        return summary;
    }

    /**
     * Get top errors by frequency
     */
    private getTopErrors(limit: number): ErrorEntry[] {
        return [...this.errors]
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
    }

    /**
     * Trim array to maximum size
     */
    private trimArray<T>(array: T[], maxSize: number): void {
        if (array.length > maxSize) {
            array.splice(maxSize);
        }
    }

    /**
     * Clean up old events and errors
     */
    private cleanupOldEvents(): void {
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
        const cutoffISO = cutoff.toISOString();
        
        // Clean old business events
        const beforeEvents = this.businessEvents.length;
        this.businessEvents = this.businessEvents.filter(e => e.timestamp > cutoffISO);
        
        // Clean old errors
        const beforeErrors = this.errors.length;
        this.errors = this.errors.filter(e => e.firstSeen > cutoffISO);
        
        if (beforeEvents !== this.businessEvents.length || beforeErrors !== this.errors.length) {
            console.log(`🧹 [SmartLogging] Cleanup: Removed ${beforeEvents - this.businessEvents.length} old events, ${beforeErrors - this.errors.length} old errors`);
        }
    }

    // ===== PUBLIC API METHODS =====

    /**
     * Get current analytics summary
     */
    getAnalyticsSummary(): any {
        const today = new Date().toISOString().split('T')[0];
        const todayEvents = this.businessEvents.filter(e => e.timestamp.startsWith(today));
        
        return {
            today: {
                totalEvents: todayEvents.length,
                bookings: this.countEvents(todayEvents, 'business.booking_created'),
                cancellations: this.countEvents(todayEvents, 'business.booking_canceled'),
                errors: this.errors.filter(e => e.firstSeen.startsWith(today)).length
            },
            performance: this.getPerformanceSummary(),
            topErrors: this.getTopErrors(5),
            system: {
                memory: process.memoryUsage(),
                uptime: process.uptime()
            }
        };
    }

    /**
     * Get error summary for health checks
     */
    getErrorSummary(hours: number = 24): any {
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
        const recentErrors = this.errors.filter(e => new Date(e.lastSeen) > cutoff);
        
        return {
            totalErrors: recentErrors.reduce((sum, error) => sum + error.count, 0),
            uniqueErrors: recentErrors.length,
            criticalErrors: recentErrors.filter(e => 
                this.isCriticalError({ message: e.message, stack: e.stack } as Error)
            ),
            topErrors: recentErrors.sort((a, b) => b.count - a.count).slice(0, 5)
        };
    }

    /**
     * Health check for the logging system
     */
    healthCheck(): {
        status: 'healthy' | 'degraded' | 'unhealthy';
        checks: {
            fileLogging: boolean;
            datadog: boolean;
            performance: boolean;
            analytics: boolean;
        };
        details: string[];
    } {
        const checks = {
            fileLogging: false,
            datadog: false,
            performance: false,
            analytics: false
        };
        const details: string[] = [];

        // Check file logging
        try {
            this.logger.info('Health check test');
            checks.fileLogging = true;
            details.push('File logging operational');
        } catch (error) {
            details.push(`File logging error: ${error}`);
        }

        // Check Datadog
        if (this.DATADOG_ENABLED && this.datadogLogger) {
            checks.datadog = true;
            details.push('Datadog integration active');
        } else {
            details.push('Datadog integration disabled');
        }

        // Check performance monitoring
        if (this.performanceTimers && this.performanceMetrics) {
            checks.performance = true;
            details.push('Performance monitoring active');
        }

        // Check analytics
        try {
            const summary = this.getAnalyticsSummary();
            checks.analytics = true;
            details.push(`Analytics active: ${summary.today.totalEvents} events today`);
        } catch (error) {
            details.push(`Analytics error: ${error}`);
        }

        const healthyChecks = Object.values(checks).filter(Boolean).length;
        const status = healthyChecks === 4 ? 'healthy' : 
                     healthyChecks >= 2 ? 'degraded' : 'unhealthy';

        return { status, checks, details };
    }

    /**
     * Get singleton instance
     */
    static getInstance(): SmartLoggingService {
        if (!SmartLoggingService.instance) {
            SmartLoggingService.instance = new SmartLoggingService();
        }
        return SmartLoggingService.instance;
    }
}

// ===== CONVENIENCE FUNCTIONS =====

/**
 * Performance monitoring decorator
 */
export function withPerformanceLogging(operation: string) {
    return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
        const method = descriptor.value;
        
        descriptor.value = async function (...args: any[]) {
            const logger = SmartLoggingService.getInstance();
            const timerId = logger.startTimer(operation, { method: propertyName });
            
            try {
                const result = await method.apply(this, args);
                logger.endTimer(timerId);
                return result;
            } catch (error) {
                logger.endTimer(timerId);
                logger.error(`Error in ${operation}`, error as Error, { method: propertyName });
                throw error;
            }
        };
    };
}

// ===== EXPORTS =====

// Export singleton instance
export const smartLog = SmartLoggingService.getInstance();

// Export for TypeScript types
export type { BusinessEventData, PerformanceTimer, ErrorEntry, AnalyticsEntry };

// Log successful initialization
console.log(`
🎉 SmartLoggingService Successfully Loaded! 🎉

✅ Features Active:
📁 Local file logging with rotation
📊 Selective Datadog integration (${process.env.ENABLE_DATADOG === 'true' ? 'ENABLED' : 'DISABLED'})
⚡ Performance monitoring with timers
🔍 Error tracking with fingerprinting
📈 Business analytics generation
📱 HTML dashboard generation
🏥 Health monitoring
🧹 Automatic cleanup

🚀 Usage:
import { smartLog } from './services/smart-logging.service';

// Business events
smartLog.businessEvent('booking_created', { reservationId: 123, platform: 'telegram' });

// Performance monitoring
const timerId = smartLog.startTimer('message_processing');
// ... do work ...
smartLog.endTimer(timerId);

// Standard logging
smartLog.info('User message processed', { sessionId, messageLength });
smartLog.error('Database error', error, { context: 'reservation_lookup' });

📊 Analytics: Check reports/ directory for daily HTML dashboards
⚡ Performance: Check performance/ directory for hourly metrics
🔍 Errors: Automatically tracked and deduplicated

🎯 Cost: $0/month (Free tier optimized!)
`);

export default SmartLoggingService;