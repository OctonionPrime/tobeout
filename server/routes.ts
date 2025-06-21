import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db, pool, getDatabaseHealth } from "./db"; // ✅ ADDED: getDatabaseHealth import
import {
    insertUserSchema, insertRestaurantSchema,
    insertTableSchema, insertGuestSchema,
    insertReservationSchema, insertIntegrationSettingSchema,
    timeslots,
    reservations, // <-- Added this import for the debug route
    type Guest
} from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcryptjs";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import ConnectPgSimple from 'connect-pg-simple';
import { initializeTelegramBot } from "./services/telegram";
import {
    createReservation,
    cancelReservation,
} from "./services/booking";
import { getAvailableTimeSlots } from "./services/availability.service";
import { cache, CacheKeys, CacheInvalidation, withCache } from "./cache";
import { eq, and, desc, sql } from "drizzle-orm";


export async function registerRoutes(app: Express): Promise<Server> {

    const pgSession = ConnectPgSimple(session);

    app.use(
        session({
            store: new pgSession({
                pool: pool,
                tableName: 'user_sessions',
                createTableIfMissing: true,
            }),
            secret: process.env.SESSION_SECRET || "tobeout-secret-key",
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: process.env.NODE_ENV === "production",
                maxAge: 30 * 24 * 60 * 60 * 1000,
                httpOnly: true,
                sameSite: 'lax',
            },
        })
    );

    app.use(passport.initialize());
    app.use(passport.session());

    passport.use(
        new LocalStrategy(
            { usernameField: "email" },
            async (email, password, done) => {
                try {
                    const user = await storage.getUserByEmail(email);
                    if (!user) {
                        return done(null, false, { message: "Incorrect email." });
                    }
                    const isValidPassword = await bcrypt.compare(password, user.password);
                    if (!isValidPassword) {
                        return done(null, false, { message: "Incorrect password." });
                    }
                    return done(null, user);
                } catch (err) {
                    return done(err);
                }
            }
        )
    );

    passport.serializeUser((user: any, done) => {
        done(null, user.id);
    });

    passport.deserializeUser(async (id: number, done) => {
        try {
            const user = await storage.getUser(id);
            done(null, user);
        } catch (err) {
            done(err);
        }
    });

    const isAuthenticated = (req: Request, res: Response, next: Function) => {
        if (req.isAuthenticated()) {
            return next();
        }
        res.status(401).json({ message: "Unauthorized" });
    };

    // Auth routes
    app.post("/api/auth/register", async (req, res, next) => {
        try {
            const userSchema = insertUserSchema.extend({
                confirmPassword: z.string(),
                restaurantName: z.string(),
            });
            const validatedData = userSchema.parse(req.body);
            if (validatedData.password !== validatedData.confirmPassword) {
                return res.status(400).json({ message: "Passwords do not match" });
            }
            const existingUser = await storage.getUserByEmail(validatedData.email);
            if (existingUser) {
                return res.status(400).json({ message: "Email already registered" });
            }
            const hashedPassword = await bcrypt.hash(validatedData.password, 10);
            const user = await storage.createUser({
                email: validatedData.email,
                password: hashedPassword,
                name: validatedData.name,
                role: 'restaurant',
                phone: validatedData.phone,
            });
            const restaurant = await storage.createRestaurant({
                userId: user.id,
                name: validatedData.restaurantName,
                phone: validatedData.phone,
            });
            req.login(user, (err) => {
                if (err) {
                    return next(err);
                }
                return res.status(201).json({
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    restaurant: {
                        id: restaurant.id,
                        name: restaurant.name,
                    },
                });
            });
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation failed", errors: error.errors });
            }
            next(error);
        }
    });

    app.post("/api/auth/login", passport.authenticate("local"), (req, res) => {
        const user = req.user as any;
        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
        });
    });

    app.post("/api/auth/logout", (req, res, next) => {
        req.logout((err) => {
            if (err) {
                return next(err);
            }
            res.json({ success: true });
        });
    });

    app.get("/api/auth/me", (req, res) => {
        if (!req.user) {
            return res.status(401).json({ message: "Not authenticated" });
        }
        const user = req.user as any;
        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
        });
    });

    // Restaurant routes
    app.get("/api/restaurants/profile", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            res.json(restaurant);
        } catch (error) {
            next(error);
        }
    });

    app.patch("/api/restaurants/profile", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const validatedData = insertRestaurantSchema.partial().parse(req.body);
            const updatedRestaurant = await storage.updateRestaurant(restaurant.id, validatedData);
            res.json(updatedRestaurant);
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation failed", errors: error.errors });
            }
            next(error);
        }
    });

    // Table routes
    app.get("/api/tables", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const tables = await storage.getTables(restaurant.id);
            res.json(tables);
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/tables", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const validatedData = insertTableSchema.parse({
                ...req.body,
                restaurantId: restaurant.id,
            });
            const newTable = await storage.createTable(validatedData);
            res.status(201).json(newTable);
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation failed", errors: error.errors });
            }
            next(error);
        }
    });

    app.patch("/api/tables/:id", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const tableId = parseInt(req.params.id);
            const table = await storage.getTable(tableId);
            if (!table || table.restaurantId !== restaurant.id) {
                return res.status(404).json({ message: "Table not found" });
            }
            const validatedData = insertTableSchema.partial().parse(req.body);
            const updatedTable = await storage.updateTable(tableId, validatedData);
            res.json(updatedTable);
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation failed", errors: error.errors });
            }
            next(error);
        }
    });

    app.delete("/api/tables/:id", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const tableId = parseInt(req.params.id);
            const table = await storage.getTable(tableId);
            if (!table || table.restaurantId !== restaurant.id) {
                return res.status(404).json({ message: "Table not found" });
            }
            await storage.deleteTable(tableId);
            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    // Timeslot routes
    app.get("/api/timeslots", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const date = req.query.date as string;
            if (!date) {
                return res.status(400).json({ message: "Date parameter is required" });
            }
            const timeslotsData = await storage.getTimeslots(restaurant.id, date);
            res.json(timeslotsData);
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/timeslots/generate", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const daysAhead = parseInt(req.query.days as string) || 14;
            const count = await storage.generateTimeslots(restaurant.id, daysAhead);
            res.json({ message: `Generated ${count} timeslots` });
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/timeslots/stats", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const lastDateResult = await db.select({
                date: timeslots.date,
            })
                .from(timeslots)
                .where(eq(timeslots.restaurantId, restaurant.id))
                .orderBy(desc(timeslots.date))
                .limit(1);
            const lastDate = lastDateResult[0]?.date;
            const totalCountResult = await db.select({
                count: sql<number>`count(*)`,
            })
                .from(timeslots)
                .where(eq(timeslots.restaurantId, restaurant.id));
            const freeCountResult = await db.select({
                count: sql<number>`count(*)`,
            })
                .from(timeslots)
                .where(and(
                    eq(timeslots.restaurantId, restaurant.id),
                    eq(timeslots.status, 'free')
                ));
            res.json({
                lastDate,
                totalCount: totalCountResult[0]?.count || 0,
                freeCount: freeCountResult[0]?.count || 0,
            });
        } catch (error: any) {
            next(error);
        }
    });

    // Guest routes
    app.get("/api/guests", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const guestsData = await storage.getGuests(restaurant.id);
            res.json(guestsData);
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/guests", isAuthenticated, async (req, res, next) => {
        try {
            const validatedData = insertGuestSchema.parse(req.body);
            let guest: Guest | undefined = await storage.getGuestByPhone(validatedData.phone as string);
            if (guest) {
                guest = await storage.updateGuest(guest.id, validatedData);
            } else {
                guest = await storage.createGuest(validatedData);
            }
            res.status(201).json(guest);
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation failed", errors: error.errors });
            }
            next(error);
        }
    });

    // ✅ FIXED: Table availability for specific date/time (with smart caching and proper duration handling)
    app.get("/api/tables/availability", isAuthenticated, async (req, res, next) => {
        try {
            const { date, time } = req.query;
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            if (!date || !time) {
                return res.status(400).json({ message: "Date and time are required" });
            }
            
            console.log(`🔍 [Table Availability] Checking for date=${date}, time=${time}`);
            
            const cacheKey = CacheKeys.tableAvailability(restaurant.id, `${date}_${time}`);
            const tableAvailabilityData = await withCache(cacheKey, async () => {
                const tablesData = await storage.getTables(restaurant.id);
                const reservationsData = await storage.getReservations(restaurant.id, { date: date as string });
                
                console.log(`📊 [Table Availability] Found ${tablesData.length} tables and ${reservationsData.length} reservations for ${date}`);
                
                // ✅ FIXED: Proper overlap detection for 2-hour reservations
                const isTimeSlotOccupied = (reservation: any, checkTime: string) => {
                    // Extract the actual reservation object from nested structure
                    const actualReservation = reservation.reservation || reservation;
                    const startTime = actualReservation.time;
                    const duration = actualReservation.duration || 120; // ✅ FIX: Default to 120 minutes (2 hours), not 90!
                    
                    const [checkHour, checkMin] = checkTime.split(':').map(Number);
                    const checkMinutes = checkHour * 60 + checkMin;
                    
                    const [startHour, startMin] = startTime.split(':').map(Number);
                    const startMinutes = startHour * 60 + startMin;
                    const endMinutes = startMinutes + duration;
                    
                    // ✅ FIX: Check if the hourly slot overlaps with the reservation
                    // For a 2-hour reservation starting at 15:30:
                    // - It occupies 15:00 slot (because 15:00-16:00 overlaps with 15:30-17:30)
                    // - It occupies 16:00 slot (because 16:00-17:00 overlaps with 15:30-17:30)
                    // - It occupies 17:00 slot (because 17:00-18:00 overlaps with 15:30-17:30)
                    
                    // Each displayed slot represents a 1-hour block
                    const slotEndMinutes = checkMinutes + 60;
                    
                    // Overlap exists if: reservation_start < slot_end AND reservation_end > slot_start
                    return startMinutes < slotEndMinutes && endMinutes > checkMinutes;
                };
                
                const availabilityResult = tablesData.map(table => {
                    // Find reservations for this table
                    const tableReservations = reservationsData.filter(r => {
                        const actualReservation = r.reservation || r;
                        return actualReservation.tableId === table.id;
                    });
                    
                    if (tableReservations.length > 0) {
                        console.log(`🔍 Table ${table.id} (${table.name}) has ${tableReservations.length} reservations`);
                    }
                    
                    // Find conflicting reservation for the requested time
                    const conflictingReservation = reservationsData.find(r => {
                        const actualReservation = r.reservation || r;
                        const guest = r.guest || {};
                        
                        const matches = actualReservation.tableId === table.id &&
                            ['confirmed', 'created'].includes(actualReservation.status || '') &&
                            isTimeSlotOccupied(r, time as string);
                        
                        if (matches) {
                            console.log(`⚠️ Table ${table.id} conflict found:`, {
                                guestName: r.guestName || actualReservation.booking_guest_name || guest.name,
                                time: actualReservation.time,
                                status: actualReservation.status
                            });
                        }
                        
                        return matches;
                    });
                    
                    if (conflictingReservation) {
                        const actualReservation = conflictingReservation.reservation || conflictingReservation;
                        const guest = conflictingReservation.guest || {};
                        
                        const startTime = actualReservation.time;
                        const duration = actualReservation.duration || 120; // ✅ Use 120 minutes default
                        const endHour = Math.floor((parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]) + duration) / 60);
                        const endMin = ((parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]) + duration) % 60);
                        const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
                        
                        return {
                            ...table,
                            status: 'reserved',
                            reservation: {
                                id: actualReservation.id,
                                guestName: conflictingReservation.guestName || actualReservation.booking_guest_name || guest.name || 'Guest',
                                guestCount: actualReservation.guests,
                                timeSlot: `${startTime}-${endTime}`,
                                phone: guest.phone || '',
                                status: actualReservation.status
                            }
                        };
                    }
                    
                    return { ...table, status: 'available', reservation: null };
                });
                
                console.log(`✅ [Table Availability] Processed ${availabilityResult.length} tables`);
                return availabilityResult;
            }, 30);
            
            res.json(tableAvailabilityData);
        } catch (error) {
            console.error('❌ [Table Availability] Error:', error);
            next(error);
        }
    });

    app.get("/api/booking/available-times", isAuthenticated, async (req: Request, res: Response, next) => {
        try {
            const { restaurantId, date, guests } = req.query;
            if (!restaurantId || !date || !guests) {
                return res.status(400).json({ message: "Missing required parameters" });
            }
            console.log(`[Routes] Getting available times for restaurant ${restaurantId}, date ${date}, guests ${guests}`);
            const availableSlots = await getAvailableTimeSlots(
                parseInt(restaurantId as string),
                date as string,
                parseInt(guests as string),
                { maxResults: 20 }
            );
            const timeSlots = availableSlots.map(slot => ({
                time: slot.time,
                timeDisplay: slot.timeDisplay,
                available: true,
                tableName: slot.tableName,
                tableCapacity: slot.tableCapacity.max,
                canAccommodate: true,
                tablesCount: 1,
                message: `Table ${slot.tableName} available (seats up to ${slot.tableCapacity.max})`
            }));
            console.log(`[Routes] Found ${timeSlots.length} available time slots`);
            res.json({ availableSlots: timeSlots });
        } catch (error) {
            next(error);
        }
    });

    // Reservation routes
    app.get("/api/reservations", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const filters = {
                date: req.query.date as string,
                status: req.query.status ? (req.query.status as string).split(',') : undefined,
                upcoming: req.query.upcoming === 'true',
            };
            const reservationsData = await storage.getReservations(restaurant.id, filters);
            res.json(reservationsData);
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/reservations/:id", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const reservationId = parseInt(req.params.id);
            const reservation = await storage.getReservation(reservationId);
            if (!reservation || reservation.restaurant.restaurantId !== restaurant.id) {
                return res.status(404).json({ message: "Reservation not found" });
            }
            res.json(reservation);
        } catch (error) {
            next(error);
        }
    });

    // ✅ ENHANCED: Reservation creation with atomic transactions + granular cache invalidation + manual table selection
    app.post("/api/reservations", isAuthenticated, async (req, res, next) => {
        console.log('🔥 RESERVATION ENDPOINT HIT (POST /api/reservations)!');
        try {
            console.log('Received reservation request body:', req.body);
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const { guestName, guestPhone, date, time, guests: numGuests } = req.body;
            if (!guestName || !guestPhone || !date || !time || !numGuests) {
                return res.status(400).json({ message: "Missing required fields: guestName, guestPhone, date, time, guests" });
            }
            let guest: Guest | undefined = await storage.getGuestByPhone(guestPhone);
            if (!guest) {
                guest = await storage.createGuest({
                    name: guestName,
                    phone: guestPhone,
                    email: req.body.guestEmail || null,
                });
            }
            if (!guest) {
                return res.status(400).json({ message: "Guest information processing failed." });
            }

            // ✅ ENHANCED: Atomic booking with granular cache invalidation + manual table selection
            try {
                const bookingResult = await createReservation({
                    restaurantId: restaurant.id,
                    guestId: guest.id,
                    date: date,
                    time: time,
                    guests: parseInt(numGuests as string),
                    comments: req.body.comments || '',
                    source: req.body.source || 'manual',
                    booking_guest_name: guestName, // Always use the name from the form for this specific booking
                    lang: req.body.lang || restaurant.languages?.[0] || 'en',
                    tableId: req.body.tableId || undefined, // ✅ NEW: Pass tableId for manual table selection
                });

                if (!bookingResult.success || !bookingResult.reservation) {
                    // ✅ ENHANCED: Sophisticated error handling with proper status codes
                    let statusCode = 400;
                    let errorType = 'VALIDATION_ERROR';

                    if (bookingResult.conflictType) {
                        switch (bookingResult.conflictType) {
                            case 'AVAILABILITY':
                                statusCode = 409; // Conflict
                                errorType = 'TABLE_UNAVAILABLE';
                                break;
                            case 'DEADLOCK':
                                statusCode = 503; // Service Temporarily Unavailable
                                errorType = 'SYSTEM_BUSY';
                                break;
                            case 'TRANSACTION':
                                statusCode = 409; // Conflict
                                errorType = 'BOOKING_CONFLICT';
                                break;
                            default:
                                statusCode = 400;
                                errorType = 'VALIDATION_ERROR';
                        }
                    }

                    console.log(`❌ [Reservation Creation] Failed with type ${errorType}:`, bookingResult.message);

                    return res.status(statusCode).json({
                        message: bookingResult.message,
                        details: 'Smart table assignment could not find available slot or booking failed',
                        errorType: errorType,
                        conflictType: bookingResult.conflictType,
                        retryable: statusCode === 503 || statusCode === 409, // Client can retry deadlocks and conflicts
                        timestamp: new Date().toISOString()
                    });
                }

                // ✅ SUCCESS: Granular cache invalidation instead of broad invalidation
                CacheInvalidation.onReservationTimeRangeChange(
                    restaurant.id, 
                    date, 
                    bookingResult.reservation.time,
                    bookingResult.reservation.duration || 120
                );

                console.log(`✅ [Reservation Creation] Success - Reservation ID ${bookingResult.reservation.id} created with granular cache invalidation`);

                return res.status(201).json({
                    ...bookingResult.reservation,
                    guestName: guestName,
                    table: bookingResult.table,
                    smartAssignment: true,
                    allReservationIds: bookingResult.allReservationIds,
                    timestamp: new Date().toISOString()
                });

            } catch (bookingError: any) {
                // ✅ ENHANCED: Handle unexpected booking service errors with atomic transaction support
                console.error('❌ [Reservation Creation] Unexpected booking service error:', bookingError);

                // Check for database-specific errors
                if (bookingError.code === '40P01') {
                    // PostgreSQL deadlock
                    return res.status(503).json({
                        message: "System busy - please try your booking again in a moment",
                        errorType: 'SYSTEM_BUSY',
                        conflictType: 'DEADLOCK',
                        retryable: true,
                        timestamp: new Date().toISOString()
                    });
                } else if (bookingError.code?.startsWith('40')) {
                    // Other PostgreSQL transaction conflicts
                    return res.status(409).json({
                        message: "Booking conflict detected - please try again",
                        errorType: 'BOOKING_CONFLICT',
                        conflictType: 'TRANSACTION',
                        retryable: true,
                        timestamp: new Date().toISOString()
                    });
                } else if (bookingError.message?.includes('no longer available')) {
                    // Atomic availability conflict
                    return res.status(409).json({
                        message: bookingError.message,
                        errorType: 'TABLE_UNAVAILABLE',
                        conflictType: 'AVAILABILITY',
                        retryable: true,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    // Unknown error - don't expose internal details
                    return res.status(500).json({
                        message: "An unexpected error occurred while processing your reservation",
                        errorType: 'INTERNAL_ERROR',
                        retryable: false,
                        timestamp: new Date().toISOString()
                    });
                }
            }

        } catch (error: any) {
            // ✅ ENHANCED: Handle top-level route errors
            console.error('❌ [Reservation Route] Top-level error:', error);

            if (error instanceof z.ZodError) {
                return res.status(400).json({ 
                    message: "Validation failed", 
                    errors: error.errors,
                    errorType: 'VALIDATION_ERROR',
                    retryable: false,
                    timestamp: new Date().toISOString()
                });
            }

            // Log the full error for debugging but don't expose to client
            return res.status(500).json({
                message: "An unexpected error occurred",
                errorType: 'INTERNAL_ERROR',
                retryable: false,
                timestamp: new Date().toISOString()
            });
        }
    });

    // ✅ ENHANCED: Reservation update with granular cache invalidation
    app.patch("/api/reservations/:id", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const reservationId = parseInt(req.params.id);
            const existingResult = await storage.getReservation(reservationId);

            if (!existingResult || existingResult.reservation.restaurantId !== restaurant.id) {
                return res.status(404).json({ message: "Reservation not found" });
            }

            const existingReservation = existingResult.reservation;
            const validatedData = insertReservationSchema.partial().parse(req.body);

            // ✅ ENHANCED: Granular cache invalidation for existing reservation
            CacheInvalidation.onReservationTimeRangeChange(
                restaurant.id, 
                existingReservation.date,
                existingReservation.time,
                existingReservation.duration || 120
            );

            // ✅ ENHANCED: Granular cache invalidation for new date/time if changed
            if (validatedData.date && validatedData.date !== existingReservation.date) {
                CacheInvalidation.onReservationTimeRangeChange(
                    restaurant.id, 
                    validatedData.date,
                    validatedData.time || existingReservation.time,
                    validatedData.duration || existingReservation.duration || 120
                );
            }

            const updatedReservation = await storage.updateReservation(reservationId, validatedData);

            res.json(updatedReservation);
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation failed", errors: error.errors });
            }
            next(error);
        }
    });

    // ✅ ENHANCED: Reservation deletion with granular cache invalidation
    app.delete("/api/reservations/:id", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const reservationId = parseInt(req.params.id);
            const existingResult = await storage.getReservation(reservationId);

            // Verify the reservation exists and belongs to the user's restaurant
            if (!existingResult || existingResult.reservation.restaurantId !== restaurant.id) {
                return res.status(404).json({ message: "Reservation not found" });
            }

            const existingReservation = existingResult.reservation;

            // Use the cancelReservation service which updates status to "canceled"
            // This is a "soft delete" and is generally safer than hard deleting records.
            await cancelReservation(reservationId, restaurant.languages?.[0] || 'en');

            // ✅ ENHANCED: Granular cache invalidation for deleted reservation
            CacheInvalidation.onReservationTimeRangeChange(
                restaurant.id, 
                existingReservation.date,
                existingReservation.time,
                existingReservation.duration || 120
            );

            // Return a valid JSON object on success to prevent frontend parse errors
            res.json({ success: true, message: "Reservation canceled successfully." });

        } catch (error) {
            next(error);
        }
    });

    // Dashboard data
    app.get("/api/dashboard/stats", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const stats = await storage.getReservationStatistics(restaurant.id);
            res.json(stats);
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/dashboard/upcoming", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const hours = parseInt(req.query.hours as string) || 3;
            const upcoming = await storage.getUpcomingReservations(restaurant.id, hours);
            res.json(upcoming);
        } catch (error) {
            next(error);
        }
    });

    // AI Assistant Activity
    app.get("/api/ai/activities", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const limit = parseInt(req.query.limit as string) || 10;
            const activities = await storage.getAiActivities(restaurant.id, limit);
            res.json(activities);
        } catch (error) {
            next(error);
        }
    });

    // Integration settings
    app.get("/api/integrations/:type", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const type = req.params.type;
            const settings = await storage.getIntegrationSettings(restaurant.id, type);
            if (!settings) {
                return res.json({ enabled: false });
            }
            res.json(settings);
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/integrations/telegram/test", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const settings = await storage.getIntegrationSettings(restaurant.id, 'telegram');
            if (!settings || !settings.enabled || !settings.token) {
                return res.status(400).json({ message: "Telegram bot is not configured or enabled" });
            }
            try {
                const TelegramBot = require('node-telegram-bot-api');
                const bot = new TelegramBot(settings.token);
                const botInfo = await bot.getMe();
                const updatedSettingsData = {
                    ...settings,
                    settings: {
                        ...(settings.settings || {}),
                        botUsername: botInfo.username,
                        botName: botInfo.first_name
                    }
                };
                await storage.saveIntegrationSettings(updatedSettingsData);
                await storage.logAiActivity({
                    restaurantId: restaurant.id,
                    type: 'telegram_test',
                    description: `Telegram bot connection test successful`,
                    data: { botInfo }
                });
                return res.json({
                    success: true,
                    message: `Successfully connected to Telegram bot: @${botInfo.username}`,
                    botInfo
                });
            } catch (botError: unknown) {
                return res.status(400).json({
                    success: false,
                    message: `Failed to connect to Telegram bot: ${botError instanceof Error ? botError.message : "Unknown error"}`
                });
            }
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/integrations/:type", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            const type = req.params.type;
            let customSettings = {};
            if (req.body.botUsername) {
                customSettings = { botUsername: req.body.botUsername };
                delete req.body.botUsername;
            }
            const validatedData = insertIntegrationSettingSchema.parse({
                ...req.body,
                restaurantId: restaurant.id,
                type,
                settings: customSettings
            });
            const savedSettings = await storage.saveIntegrationSettings(validatedData);
            if (type === 'telegram' && savedSettings.enabled && savedSettings.token) {
                try {
                    await initializeTelegramBot(restaurant.id);
                    await storage.logAiActivity({
                        restaurantId: restaurant.id,
                        type: 'telegram_setup',
                        description: `Telegram bot successfully configured and activated`,
                        data: { token: savedSettings.token.substring(0, 10) + '...', enabled: savedSettings.enabled }
                    });
                } catch (error: unknown) {
                    console.error("Error setting up Telegram bot after saving settings:", error);
                }
            }
            res.json(savedSettings);
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation failed", errors: error.errors });
            }
            next(error);
        }
    });

    // ===========================================
    // MONITORING ENDPOINTS (No Authentication Required)
    // ===========================================
    
    // Health check endpoint for monitoring tools (Uptime Robot, DataDog, etc.)
    app.get("/api/health", async (req, res) => {
        try {
            const startTime = Date.now();
            
            // Get database health from existing function
            const dbHealth = getDatabaseHealth();
            
            // Get basic application metrics
            const uptime = process.uptime();
            const memoryUsage = process.memoryUsage();
            
            // Test database connectivity with a simple query
            let dbTestResult;
            try {
                const testQuery = await pool.query('SELECT NOW() as current_time, version() as version');
                dbTestResult = {
                    connected: true,
                    responseTime: Date.now() - startTime,
                    version: testQuery.rows[0]?.version || 'unknown'
                };
            } catch (dbError: any) {
                dbTestResult = {
                    connected: false,
                    error: dbError.message,
                    responseTime: Date.now() - startTime
                };
            }
            
            // Determine overall health status
            const isHealthy = dbHealth.healthy && dbTestResult.connected;
            const statusCode = isHealthy ? 200 : 503;
            
            // Create comprehensive health response
            const healthResponse = {
                status: isHealthy ? "healthy" : "unhealthy",
                timestamp: new Date().toISOString(),
                uptime: {
                    seconds: uptime,
                    human: `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
                },
                database: {
                    healthy: dbHealth.healthy,
                    connected: dbTestResult.connected,
                    consecutiveFailures: dbHealth.consecutiveFailures,
                    lastHealthCheck: dbHealth.lastHealthCheck,
                    responseTime: dbTestResult.responseTime,
                    connections: dbHealth.connections,
                    version: dbTestResult.version || null,
                    error: dbTestResult.error || null
                },
                application: {
                    nodeVersion: process.version,
                    environment: process.env.NODE_ENV || 'development',
                    memory: {
                        used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                        total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                        external: Math.round(memoryUsage.external / 1024 / 1024),
                        rss: Math.round(memoryUsage.rss / 1024 / 1024)
                    },
                    pid: process.pid
                },
                checks: {
                    database: dbTestResult.connected ? "pass" : "fail",
                    memory: memoryUsage.heapUsed < (512 * 1024 * 1024) ? "pass" : "warn", // 512MB threshold
                    uptime: uptime > 60 ? "pass" : "starting" // Consider healthy after 1 minute
                }
            };
            
            // Log health check for monitoring
            if (!isHealthy) {
                console.warn(`[Health] Health check failed: DB=${dbHealth.healthy}, Connected=${dbTestResult.connected}`);
            }
            
            res.status(statusCode).json(healthResponse);
            
        } catch (error: any) {
            console.error('[Health] Health check endpoint error:', error);
            res.status(503).json({
                status: "unhealthy",
                timestamp: new Date().toISOString(),
                error: "Health check failed",
                message: error.message
            });
        }
    });
    
    // Simple ping endpoint for basic uptime monitoring
    app.get("/api/ping", (req, res) => {
        res.json({
            status: "ok",
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    });
    
    // Database-specific health endpoint
    app.get("/api/health/database", async (req, res) => {
        try {
            const startTime = Date.now();
            const dbHealth = getDatabaseHealth();
            
            // Test actual database query
            const testResult = await pool.query('SELECT NOW() as time, current_database() as db_name');
            const responseTime = Date.now() - startTime;
            
            const response = {
                healthy: true,
                timestamp: new Date().toISOString(),
                database: {
                    name: testResult.rows[0]?.db_name,
                    serverTime: testResult.rows[0]?.time,
                    responseTime,
                    connections: dbHealth.connections,
                    consecutiveFailures: dbHealth.consecutiveFailures,
                    lastHealthCheck: dbHealth.lastHealthCheck
                }
            };
            
            res.status(200).json(response);
            
        } catch (error: any) {
            console.error('[Health] Database health check failed:', error);
            res.status(503).json({
                healthy: false,
                timestamp: new Date().toISOString(),
                error: error.message,
                database: getDatabaseHealth()
            });
        }
    });

    // ===========================================
    // END MONITORING ENDPOINTS
    // ===========================================

    // START: TEMPORARY DEBUG ROUTES
    app.get("/api/debug/data-consistency", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }

            console.log(`🔍 [DEBUG] Starting data consistency check for restaurant ${restaurant.id}`);

            // 1. Raw database query - exactly what storage returns
            const todayDate = new Date().toISOString().split('T')[0];

            // Get reservations using the same method as dashboard
            const dashboardReservations = await storage.getReservationStatistics(restaurant.id);
            console.log(`📊 [DEBUG] Dashboard stats:`, dashboardReservations);

            // Get reservations using the same method as reservations page  
            const allReservations = await storage.getReservations(restaurant.id);
            console.log(`📋 [DEBUG] All reservations count:`, allReservations.length);

            const todayReservations = await storage.getReservations(restaurant.id, { date: todayDate });
            console.log(`📅 [DEBUG] Today reservations count:`, todayReservations.length);

            const upcomingReservations = await storage.getUpcomingReservations(restaurant.id, 3);
            console.log(`⏰ [DEBUG] Upcoming reservations count:`, upcomingReservations.length);

            // Direct SQL query for debugging
            const directSqlResult = await db.select({
                id: reservations.id,
                restaurantId: reservations.restaurantId,
                date: reservations.date,
                time: reservations.time,
                status: reservations.status,
                guests: reservations.guests,
                guestId: reservations.guestId,
                tableId: reservations.tableId,
                booking_guest_name: reservations.booking_guest_name,
                comments: reservations.comments,
                createdAt: reservations.createdAt
            })
                .from(reservations)
                .where(eq(reservations.restaurantId, restaurant.id))
                .orderBy(desc(reservations.createdAt));

            console.log(`🔍 [DEBUG] Direct SQL reservations:`, directSqlResult);

            // Check cache state
            const cacheStats = cache.getStats();
            console.log(`💾 [DEBUG] Cache stats:`, cacheStats);

            return res.json({
                restaurantId: restaurant.id,
                todayDate,
                dashboardStats: dashboardReservations,
                allReservationsCount: allReservations.length,
                todayReservationsCount: todayReservations.length,
                upcomingReservationsCount: upcomingReservations.length,
                directSqlCount: directSqlResult.length,
                directSqlReservations: directSqlResult,
                allReservationsSample: allReservations.slice(0, 3), // First 3 for inspection
                todayReservationsSample: todayReservations.slice(0, 3),
                upcomingReservationsSample: upcomingReservations.slice(0, 3),
                cacheStats: cacheStats,
                debugTimestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ [DEBUG] Error in debug endpoint:', error);
            next(error);
        }
    });

    // Also add this route to clear cache for testing
    app.post("/api/debug/clear-cache", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }

            // Clear all cache
            cache.clear();

            console.log(`🧹 [DEBUG] Cache cleared for restaurant ${restaurant.id}`);

            return res.json({
                success: true,
                message: "Cache cleared",
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ [DEBUG] Error clearing cache:', error);
            next(error);
        }
    });
    // END: TEMPORARY DEBUG ROUTES


    const httpServer = createServer(app);
    return httpServer;
}