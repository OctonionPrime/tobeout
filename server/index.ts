import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeAllTelegramBots, cleanupTelegramBots } from './services/telegram';

const app = express();

// Set trust proxy to 1 to correctly handle information from our Nginx proxy
// This is important for secure cookies, rate limiting, etc.
app.set('trust proxy', 1);

// Standard middleware for parsing JSON and URL-encoded request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Custom logging middleware to monitor API requests
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

            log(logLine);
        }
    });

    next();
});

// Self-executing async function to initialize the server
(async () => {
    // Register all API routes and create the HTTP server
    const server = await registerRoutes(app);

    // [FIX] Corrected global error handling middleware.
    // This should be placed AFTER all routes have been registered.
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        console.error("🔥 Global Error Handler Caught:", err);
        const status = err.status || err.statusCode || 500;
        const message = err.message || "Internal Server Error";

        // Send a JSON response with the error details.
        res.status(status).json({ message });

        // The problematic `throw err;` line has been removed. 
        // Re-throwing the error here after sending a response is incorrect 
        // and can crash the server process. The error is now logged and handled.
    });


    // In development mode, set up Vite for hot module replacement.
    // In production, serve the pre-built static client files.
    if (app.get("env") === "development") {
        await setupVite(app, server);
    } else {
        serveStatic(app);
    }

    // Initialize all enabled Telegram bots on startup
    await initializeAllTelegramBots();

    const port = process.env.PORT || 5000;
    server.listen({
        port,
        host: "0.0.0.0",
    }, () => {
        log(`🚀 Server listening on port ${port}`);
    });

    // Graceful shutdown logic
    const shutdown = (signal: string) => {
        console.log(`\nReceived ${signal}. Shutting down gracefully...`);

        // Stop all active Telegram bots
        cleanupTelegramBots();

        // Close the HTTP server
        server.close(() => {
            console.log("✅ HTTP server closed.");
            process.exit(0);
        });

        // Force shutdown after a timeout
        setTimeout(() => {
            console.error("Could not close connections in time, forcing shutdown.");
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

})();
