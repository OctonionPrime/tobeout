import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db, pool, getDatabaseHealth } from "./db";
import {
    insertUserSchema, insertRestaurantSchema,
    insertTableSchema, insertGuestSchema,
    insertReservationSchema, insertIntegrationSettingSchema,
    timeslots,
    reservations,
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

    // ✅ UPDATED: Restaurant profile route with timezone cache invalidation
    app.patch("/api/restaurants/profile", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }

            const validatedData = insertRestaurantSchema.partial().parse(req.body);

            // ✅ NEW: Check if timezone is being changed
            const oldTimezone = restaurant.timezone;
            const newTimezone = validatedData.timezone;
            const isTimezoneChanging = newTimezone && oldTimezone !== newTimezone;

            if (isTimezoneChanging) {
                console.log(`🌍 [Profile] Restaurant ${restaurant.id} changing timezone: ${oldTimezone} → ${newTimezone}`);
            }

            const updatedRestaurant = await storage.updateRestaurant(restaurant.id, validatedData);

            // ✅ NEW: Invalidate all cache if timezone changed
            if (isTimezoneChanging) {
                CacheInvalidation.onTimezoneChange(restaurant.id, oldTimezone, newTimezone);

                console.log(`✅ [Profile] Timezone change complete for restaurant ${restaurant.id}`);
            }

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

    // ✅ TIMEZONE FIX 1: Table Availability with Restaurant Timezone
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

            console.log(`🔍 [Table Availability] Checking for date=${date}, time=${time} in timezone ${restaurant.timezone}`);

            const cacheKey = CacheKeys.tableAvailability(restaurant.id, `${date}_${time}`);
            const tableAvailabilityData = await withCache(cacheKey, async () => {
                const tablesData = await storage.getTables(restaurant.id);
                
                // ✅ FIXED: Pass restaurant timezone for proper date filtering
                const reservationsData = await storage.getReservations(restaurant.id, { 
                    date: date as string,
                    timezone: restaurant.timezone  // ← CRITICAL FIX
                });

                console.log(`📊 [Table Availability] Found ${tablesData.length} tables and ${reservationsData.length} reservations for ${date} (${restaurant.timezone})`);

                const isTimeSlotOccupied = (reservation: any, checkTime: string) => {
                    const actualReservation = reservation.reservation || reservation;
                    const startTime = actualReservation.time;
                    const duration = actualReservation.duration || 120;

                    const [checkHour, checkMin] = checkTime.split(':').map(Number);
                    const checkMinutes = checkHour * 60 + checkMin;

                    const [startHour, startMin] = startTime.split(':').map(Number);
                    const startMinutes = startHour * 60 + startMin;
                    const endMinutes = startMinutes + duration;

                    const slotEndMinutes = checkMinutes + 60;

                    return startMinutes < slotEndMinutes && endMinutes > checkMinutes;
                };

                const availabilityResult = tablesData.map(table => {
                    const tableReservations = reservationsData.filter(r => {
                        const actualReservation = r.reservation || r;
                        return actualReservation.tableId === table.id;
                    });

                    if (tableReservations.length > 0) {
                        console.log(`🔍 Table ${table.id} (${table.name}) has ${tableReservations.length} reservations`);
                    }

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
                        const duration = actualReservation.duration || 120;
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

                console.log(`✅ [Table Availability] Processed ${availabilityResult.length} tables with timezone ${restaurant.timezone}`);
                return availabilityResult;
            }, 30);

            res.json(tableAvailabilityData);
        } catch (error) {
            console.error('❌ [Table Availability] Error:', error);
            next(error);
        }
    });

    // ✅ TIMEZONE FIX 2: Available Times with Restaurant Timezone
    app.get("/api/booking/available-times", isAuthenticated, async (req: Request, res: Response, next) => {
        try {
            const { restaurantId, date, guests } = req.query;
            const user = req.user as any;
            
            // ✅ FIXED: Get restaurant data to access timezone
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            
            // ✅ FIXED: Validate restaurantId matches user's restaurant for security
            if (parseInt(restaurantId as string) !== restaurant.id) {
                return res.status(403).json({ message: "Access denied to this restaurant" });
            }
            
            if (!restaurantId || !date || !guests) {
                return res.status(400).json({ message: "Missing required parameters" });
            }
            
            console.log(`[Routes] Getting available times for restaurant ${restaurantId}, date ${date}, guests ${guests} in timezone ${restaurant.timezone}`);
            
            // ✅ FIXED: Pass restaurant timezone to getAvailableTimeSlots
            const availableSlots = await getAvailableTimeSlots(
                parseInt(restaurantId as string),
                date as string,
                parseInt(guests as string),
                { 
                    maxResults: 20,
                    timezone: restaurant.timezone  // ← CRITICAL FIX
                }
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
            
            console.log(`[Routes] Found ${timeSlots.length} available time slots for ${restaurant.timezone}`);
            res.json({ availableSlots: timeSlots });
        } catch (error) {
            console.error('❌ [Available Times] Error:', error);
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
            // ✅ FIXED: Pass the restaurant's timezone when filtering for upcoming reservations
            const filters = {
                date: req.query.date as string,
                status: req.query.status ? (req.query.status as string).split(',') : undefined,
                upcoming: req.query.upcoming === 'true',
                timezone: restaurant.timezone, // Always include the timezone
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
            if (!reservation || reservation.reservation.restaurantId !== restaurant.id) { // Corrected check
                return res.status(404).json({ message: "Reservation not found" });
            }
            res.json(reservation);
        } catch (error) {
            next(error);
        }
    });

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

            try {
                const bookingResult = await createReservation({
                    restaurantId: restaurant.id,
                    guestId: guest.id,
                    date: date,
                    time: time,
                    guests: parseInt(numGuests as string),
                    comments: req.body.comments || '',
                    source: req.body.source || 'manual',
                    booking_guest_name: guestName,
                    lang: req.body.lang || restaurant.languages?.[0] || 'en',
                    tableId: req.body.tableId || undefined,
                });

                if (!bookingResult.success || !bookingResult.reservation) {
                    let statusCode = 400;
                    let errorType = 'VALIDATION_ERROR';

                    if (bookingResult.conflictType) {
                        switch (bookingResult.conflictType) {
                            case 'AVAILABILITY':
                                statusCode = 409;
                                errorType = 'TABLE_UNAVAILABLE';
                                break;
                            case 'DEADLOCK':
                                statusCode = 503;
                                errorType = 'SYSTEM_BUSY';
                                break;
                            case 'TRANSACTION':
                                statusCode = 409;
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
                        retryable: statusCode === 503 || statusCode === 409,
                        timestamp: new Date().toISOString()
                    });
                }

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
                console.error('❌ [Reservation Creation] Unexpected booking service error:', bookingError);

                if (bookingError.code === '40P01') {
                    return res.status(503).json({
                        message: "System busy - please try your booking again in a moment",
                        errorType: 'SYSTEM_BUSY',
                        conflictType: 'DEADLOCK',
                        retryable: true,
                        timestamp: new Date().toISOString()
                    });
                } else if (bookingError.code?.startsWith('40')) {
                    return res.status(409).json({
                        message: "Booking conflict detected - please try again",
                        errorType: 'BOOKING_CONFLICT',
                        conflictType: 'TRANSACTION',
                        retryable: true,
                        timestamp: new Date().toISOString()
                    });
                } else if (bookingError.message?.includes('no longer available')) {
                    return res.status(409).json({
                        message: bookingError.message,
                        errorType: 'TABLE_UNAVAILABLE',
                        conflictType: 'AVAILABILITY',
                        retryable: true,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    return res.status(500).json({
                        message: "An unexpected error occurred while processing your reservation",
                        errorType: 'INTERNAL_ERROR',
                        retryable: false,
                        timestamp: new Date().toISOString()
                    });
                }
            }

        } catch (error: any) {
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

            return res.status(500).json({
                message: "An unexpected error occurred",
                errorType: 'INTERNAL_ERROR',
                retryable: false,
                timestamp: new Date().toISOString()
            });
        }
    });

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

            CacheInvalidation.onReservationTimeRangeChange(
                restaurant.id,
                existingReservation.date,
                existingReservation.time,
                existingReservation.duration || 120
            );

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

    app.delete("/api/reservations/:id", isAuthenticated, async (req, res, next) => {
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

            await cancelReservation(reservationId, restaurant.languages?.[0] || 'en');

            CacheInvalidation.onReservationTimeRangeChange(
                restaurant.id,
                existingReservation.date,
                existingReservation.time,
                existingReservation.duration || 120
            );

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
            // ✅ FIXED: Pass the restaurant's timezone to get correct daily stats
            const stats = await storage.getReservationStatistics(restaurant.id, restaurant.timezone);
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
            // ✅ FIXED: Pass the restaurant's timezone to get correct upcoming reservations
            const upcoming = await storage.getUpcomingReservations(restaurant.id, restaurant.timezone, hours);
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

    // Monitoring Endpoints
    app.get("/api/health", async (req, res) => {
        try {
            const startTime = Date.now();
            const dbHealth = getDatabaseHealth();
            const uptime = process.uptime();
            const memoryUsage = process.memoryUsage();
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
            const isHealthy = dbHealth.healthy && dbTestResult.connected;
            const statusCode = isHealthy ? 200 : 503;
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
                    memory: memoryUsage.heapUsed < (512 * 1024 * 1024) ? "pass" : "warn",
                    uptime: uptime > 60 ? "pass" : "starting"
                }
            };
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

    app.get("/api/ping", (req, res) => {
        res.json({
            status: "ok",
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    });

    app.get("/api/health/database", async (req, res) => {
        try {
            const startTime = Date.now();
            const dbHealth = getDatabaseHealth();
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

    // Debug Routes
    app.get("/api/debug/data-consistency", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }

            console.log(`🔍 [DEBUG] Starting data consistency check for restaurant ${restaurant.id}`);

            // ✅ FIXED: Pass restaurant timezone to debug routes
            const dashboardReservations = await storage.getReservationStatistics(restaurant.id, restaurant.timezone);
            const allReservations = await storage.getReservations(restaurant.id, { timezone: restaurant.timezone });
            const todayReservations = await storage.getReservations(restaurant.id, { date: new Date().toISOString().split('T')[0], timezone: restaurant.timezone });
            const upcomingReservations = await storage.getUpcomingReservations(restaurant.id, restaurant.timezone, 3);

            const directSqlResult = await db.select().from(reservations).where(eq(reservations.restaurantId, restaurant.id)).orderBy(desc(reservations.createdAt));
            const cacheStats = cache.getStats();

            return res.json({
                restaurantId: restaurant.id,
                todayDate: new Date().toISOString().split('T')[0],
                dashboardStats: dashboardReservations,
                allReservationsCount: allReservations.length,
                todayReservationsCount: todayReservations.length,
                upcomingReservationsCount: upcomingReservations.length,
                directSqlCount: directSqlResult.length,
                directSqlReservations: directSqlResult,
                allReservationsSample: allReservations.slice(0, 3),
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

    app.post("/api/debug/clear-cache", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
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

    const httpServer = createServer(app);
    return httpServer;
}