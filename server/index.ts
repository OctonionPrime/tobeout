import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
// 🔽 ADD THIS IMPORT AT THE TOP
import serveIndex from 'serve-index';
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeAllTelegramBots, cleanupTelegramBots } from './services/telegram';

// 📊 SMART LOGGING INTEGRATION: Add logging imports
import { smartLog } from './services/smart-logging.service';
import { aiService } from './services/ai-service';

// 🔧 ES MODULE FIX: Moved to top-level imports
import fs from 'fs';
import path from 'path';

const app = express();

// Set trust proxy to 1 to correctly handle information from our Nginx proxy
// This is important for secure cookies, rate limiting, etc.
app.set('trust proxy', 1);

// Standard middleware for parsing JSON and URL-encoded request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// 📊 ENHANCED: Custom logging middleware with Smart Logging integration
app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    // Intercept res.json to capture the response body for logging
    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
        capturedJsonResponse = bodyJson;
        return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
        const duration = Date.now() - start;
        if (path.startsWith("/api")) {
            let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
            if (capturedJsonResponse) {
                logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
            }

            // Truncate long log lines for readability
            if (logLine.length > 120) {
                logLine = logLine.slice(0, 119) + "…";
            }

            // 📊 ENHANCED: Use both existing and Smart Logging
            log(logLine); // Keep your existing logging

            // Add Smart Logging for API requests
            smartLog.info('API request completed', {
                method: req.method,
                path: path,
                statusCode: res.statusCode,
                durationMs: duration,
                userAgent: req.get('user-agent'),
                ip: req.ip,
                hasResponse: !!capturedJsonResponse
            });

            // Log slow API requests as warnings
            if (duration > 2000) {
                smartLog.warn('Slow API request detected', {
                    method: req.method,
                    path: path,
                    durationMs: duration,
                    threshold: 2000
                });
            }
        }
    });

    next();
});

// 📊 SMART LOGGING ENDPOINTS: Add dashboard and health check routes
app.get('/health', async (req: Request, res: Response) => {
    try {
        const aiHealth = await aiService.healthCheck();
        const loggingHealth = smartLog.healthCheck();
        const errorSummary = smartLog.getErrorSummary(1); // Last hour

        const overallHealth = (aiHealth.overall === 'healthy' && loggingHealth.status === 'healthy')
            ? 'healthy'
            : 'degraded';

        const health = {
            status: overallHealth,
            timestamp: new Date().toISOString(),
            services: {
                aiService: aiHealth,
                logging: loggingHealth
            },
            system: {
                memory: process.memoryUsage(),
                uptime: process.uptime(),
                nodeVersion: process.version
            },
            errors: errorSummary
        };

        const statusCode = overallHealth === 'healthy' ? 200 : 503;
        res.status(statusCode).json(health);

    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: 'Health check failed',
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/ping', (req: Request, res: Response) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// 📊 FREE DASHBOARD: Add dashboard routes if enabled
if (process.env.ENABLE_FREE_DASHBOARD === 'true') {
    app.get('/dashboard', (req: Request, res: Response) => {
        try {
            const today = new Date().toISOString().split('T')[0];
            const reportPath = path.join('reports', `daily_report_${today}.html`);

            if (fs.existsSync(reportPath)) {
                const html = fs.readFileSync(reportPath, 'utf8');
                res.send(html);
            } else {
                res.send(`
                    <html>
                        <head>
                            <title>📊 Restaurant Booking Dashboard</title>
                            <style>
                                body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
                                .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                                .metric { display: inline-block; margin: 10px; padding: 15px; border: 1px solid #ddd; border-radius: 5px; background: #f9f9f9; }
                                .link { color: #007bff; text-decoration: none; margin: 0 10px; }
                                .link:hover { text-decoration: underline; }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                <h1>📊 Restaurant Booking System Dashboard</h1>
                                <p>Welcome to your Smart Logging dashboard! Daily reports are generated automatically.</p>
                                
                                <div class="metric">
                                    <strong>System Status:</strong> Active ✅
                                </div>
                                <div class="metric">
                                    <strong>Uptime:</strong> ${Math.floor(process.uptime() / 60)} minutes
                                </div>
                                <div class="metric">
                                    <strong>Memory:</strong> ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
                                </div>
                                
                                <h3>📊 Available Endpoints:</h3>
                                <p>
                                    <a href="/api/dashboard/stats" class="link">📈 Real-time Statistics (JSON)</a>
                                    <a href="/health" class="link">🏥 Health Check</a>
                                    <a href="/ping" class="link">📡 Ping</a>
                                </p>
                                
                                <h3>📁 Log Files:</h3>
                                <p>Check the following directories for detailed logs:</p>
                                <ul>
                                    <li><code>logs/app.log</code> - Application logs</li>
                                    <li><code>logs/business-events.log</code> - Business events</li>
                                    <li><code>reports/</code> - Daily HTML reports</li>
                                    <li><code>analytics/</code> - JSON analytics data</li>
                                </ul>
                                
                                <p><em>Dashboard updates automatically as new data comes in.</em></p>
                            </div>
                        </body>
                    </html>
                `);
            }
        } catch (error) {
            res.status(500).send('Error loading dashboard');
        }
    });

    app.get('/api/dashboard/stats', (req: Request, res: Response) => {
        try {
            const analytics = smartLog.getAnalyticsSummary();
            const aiStats = aiService.getStats();

            res.json({
                timestamp: new Date().toISOString(),
                analytics,
                aiService: aiStats,
                system: {
                    memory: process.memoryUsage(),
                    uptime: process.uptime(),
                    nodeVersion: process.version
                }
            });
        } catch (error) {
            res.status(500).json({ error: 'Failed to get statistics' });
        }
    });
}

// ====================================================================
// 📁 NEW: EXPOSE LOG AND REPORT DIRECTORIES
// WARNING: This makes log files publicly accessible. Use with caution.
// ====================================================================

// This allows you to view individual log files directly by URL
// Example: http://localhost:5000/logs/app.log
app.use('/logs', express.static('logs'));

// These two lines work together to create a browseable directory for reports
// Example: http://localhost:5000/reports/
app.use('/reports', express.static('reports'));
app.use('/reports', serveIndex('reports', { 'icons': true }));

// These two lines work together to create a browseable directory for analytics
// Example: http://localhost:5000/analytics/
app.use('/analytics', express.static('analytics'));
app.use('/analytics', serveIndex('analytics', { 'icons': true }));


// Self-executing async function to initialize the server
(async () => {
    try {
        // 📊 SMART LOGGING INITIALIZATION: Initialize logging first
        smartLog.info('Application startup initiated', {
            environment: process.env.NODE_ENV || 'development',
            nodeVersion: process.version,
            startupTime: new Date().toISOString()
        });

        // 🏥 Perform initial health checks
        const aiHealth = await aiService.healthCheck();
        const loggingHealth = smartLog.healthCheck();

        smartLog.info('Startup health check completed', {
            aiService: aiHealth,
            logging: loggingHealth
        });

        // 📊 Log application startup as business event
        smartLog.businessEvent('application_started', {
            aiServiceHealth: aiHealth.overall,
            loggingHealth: loggingHealth.status,
            claudeAvailable: aiHealth.claude,
            openaiAvailable: aiHealth.openai,
            datadogEnabled: process.env.ENABLE_DATADOG === 'true',
            environment: process.env.NODE_ENV || 'development',
            dashboardEnabled: process.env.ENABLE_FREE_DASHBOARD === 'true'
        });

        // Register all API routes and create the HTTP server
        const server = await registerRoutes(app);

        // [FIX] Corrected global error handling middleware with Smart Logging.
        // This should be placed AFTER all routes have been registered.
        app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
            // 📊 ENHANCED: Log errors with Smart Logging
            smartLog.error('Global error handler caught error', err, {
                url: _req.url,
                method: _req.method,
                userAgent: _req.get('user-agent'),
                ip: _req.ip,
                stack: err.stack
            });

            console.error("🔥 Global Error Handler Caught:", err);
            const status = err.status || err.statusCode || 500;
            const message = err.message || "Internal Server Error";

            // Send a JSON response with the error details.
            res.status(status).json({ message });
        });

        // In development mode, set up Vite for hot module replacement.
        // In production, serve the pre-built static client files.
        if (app.get("env") === "development") {
            await setupVite(app, server);
        } else {
            serveStatic(app);
        }

        // Initialize all enabled Telegram bots on startup
        smartLog.info('Initializing Telegram bots');
        await initializeAllTelegramBots();
        smartLog.info('Telegram bots initialized successfully');

        const port = process.env.PORT || 5000;
        server.listen({
            port,
            host: "0.0.0.0",
        }, () => {
            const logMessage = `🚀 Server listening on port ${port}`;
            log(logMessage);

            // 📊 ENHANCED: Smart Logging for server startup
            smartLog.info('Server started successfully', {
                port: Number(port),
                host: '0.0.0.0',
                environment: process.env.NODE_ENV || 'development',
                dashboardUrl: process.env.ENABLE_FREE_DASHBOARD === 'true' ? `http://localhost:${port}/dashboard` : null,
                healthUrl: `http://localhost:${port}/health`
            });

            // 📊 Display useful URLs
            console.log(`📊 Smart Logging Active:`);
            if (process.env.ENABLE_FREE_DASHBOARD === 'true') {
                console.log(`   📱 Dashboard: http://localhost:${port}/dashboard`);
            }
            console.log(`   🏥 Health Check: http://localhost:${port}/health`);
            console.log(`   📁 Log Files: http://localhost:${port}/logs/app.log`);
            console.log(`   📁 Reports Dir: http://localhost:${port}/reports/`);
            console.log(`   📁 Analytics Dir: http://localhost:${port}/analytics/`);
        });

        // 📊 ENHANCED: Graceful shutdown logic with Smart Logging
        const shutdown = (signal: string) => {
            smartLog.info('Graceful shutdown initiated', {
                signal,
                uptime: process.uptime()
            });

            smartLog.businessEvent('application_shutdown', {
                reason: signal,
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
            });

            console.log(`\nReceived ${signal}. Shutting down gracefully...`);

            // Stop all active Telegram bots
            cleanupTelegramBots();

            // Close the HTTP server
            server.close(() => {
                smartLog.info('HTTP server closed successfully');
                console.log("✅ HTTP server closed.");

                // Give Smart Logging time to flush final logs
                setTimeout(() => {
                    console.log("✅ Graceful shutdown completed");
                    process.exit(0);
                }, 500);
            });

            // Force shutdown after a timeout
            setTimeout(() => {
                smartLog.error('Forced shutdown due to timeout', new Error('SHUTDOWN_TIMEOUT'), {
                    signal,
                    timeoutMs: 10000
                });
                console.error("Could not close connections in time, forcing shutdown.");
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        // 📊 ENHANCED: Handle uncaught exceptions with Smart Logging
        process.on('uncaughtException', (error: Error) => {
            smartLog.error('Uncaught exception', error, {
                critical: true,
                shutdownRequired: true
            });

            smartLog.businessEvent('system_error', {
                type: 'uncaught_exception',
                error: error.message,
                stack: error.stack
            });

            console.error('💥 Uncaught Exception:', error);

            // Give logging service time to flush, then exit
            setTimeout(() => {
                process.exit(1);
            }, 1000);
        });

        // 📊 ENHANCED: Handle unhandled promise rejections with Smart Logging
        process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
            smartLog.error('Unhandled promise rejection', reason instanceof Error ? reason : new Error(String(reason)), {
                critical: true,
                promise: promise.toString()
            });

            smartLog.businessEvent('system_error', {
                type: 'unhandled_promise_rejection',
                reason: String(reason)
            });

            console.error('💥 Unhandled Promise Rejection:', reason);
        });

    } catch (startupError) {
        // 📊 ENHANCED: Log startup errors
        if (smartLog) {
            smartLog.error('Application startup failed', startupError as Error, {
                critical: true,
                phase: 'startup'
            });
        }
        console.error('❌ Application startup failed:', startupError);
        process.exit(1);
    }
})();
