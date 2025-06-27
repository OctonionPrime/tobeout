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
import { getPopularRestaurantTimezones } from "./utils/timezone-utils";
import { eq, and, desc, sql, count, or, inArray, gt, ne, notExists } from "drizzle-orm";
import { DateTime } from 'luxon';

// ✅ NEW IMPORT: Sofia AI Enhanced Conversation Manager
import { enhancedConversationManager } from "./services/enhanced-conversation-manager";
// ✅ NEW IMPORT: Booking Agent for Restaurant Greeting
import { createBookingAgent } from "./services/agents/booking-agent";

// ✅ DYNAMIC: PostgreSQL timestamp parser that handles both formats
function parsePostgresTimestamp(timestamp: string): DateTime {
    if (!timestamp) {
        console.warn('[Routes] Empty timestamp provided');
        return DateTime.invalid('empty timestamp');
    }

    try {
        // Try ISO format first: "2025-06-23T10:00:00.000Z"
        let dt = DateTime.fromISO(timestamp, { zone: 'utc' });
        if (dt.isValid) {
            return dt;
        }

        // Try PostgreSQL format: "2025-06-23 10:00:00+00"
        const pgTimestamp = timestamp.replace(' ', 'T').replace('+00', 'Z');
        dt = DateTime.fromISO(pgTimestamp, { zone: 'utc' });
        if (dt.isValid) {
            return dt;
        }

        // Try without timezone indicator: "2025-06-23 10:00:00"
        if (timestamp.includes(' ') && !timestamp.includes('T')) {
            const isoFormat = timestamp.replace(' ', 'T') + 'Z';
            dt = DateTime.fromISO(isoFormat, { zone: 'utc' });
            if (dt.isValid) {
                return dt;
            }
        }

        console.error(`[Routes] Failed to parse timestamp: ${timestamp}`);
        return DateTime.invalid(`unparseable timestamp: ${timestamp}`);
    } catch (error) {
        console.error(`[Routes] Error parsing timestamp ${timestamp}:`, error);
        return DateTime.invalid(`parse error: ${error}`);
    }
}

// ✅ DYNAMIC: Overnight operation detection (works for ANY times)
function isOvernightOperation(openingTime: string, closingTime: string): boolean {
    const parseTime = (timeStr: string): number | null => {
        if (!timeStr) return null;
        const parts = timeStr.split(':');
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10) || 0;
        if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return null;
        }
        return hours * 60 + minutes;
    };
    
    const openingMinutes = parseTime(openingTime);
    const closingMinutes = parseTime(closingTime);
    
    if (openingMinutes === null || closingMinutes === null) {
        return false;
    }
    
    return closingMinutes < openingMinutes;
}

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

            const oldTimezone = restaurant.timezone;
            const newTimezone = validatedData.timezone;
            const isTimezoneChanging = newTimezone && oldTimezone !== newTimezone;

            if (isTimezoneChanging) {
                console.log(`🌍 [Profile] Restaurant ${restaurant.id} changing timezone: ${oldTimezone} → ${newTimezone}`);
            }

            const updatedRestaurant = await storage.updateRestaurant(restaurant.id, validatedData);

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

    app.get("/api/timezones", isAuthenticated, async (req, res, next) => {
        try {
            const timezones = getPopularRestaurantTimezones();
            res.json(timezones);
        } catch (error) {
            console.error('[Timezones] Error fetching timezone list:', error);
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
            console.log(`🔍 [Tables] Found ${tables.length} tables for restaurant ${restaurant.id}`);
            res.json(tables);
        } catch (error) {
            console.error('❌ [Tables] Error fetching tables:', error);
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
            
            CacheInvalidation.onTableChange(restaurant.id);
            
            console.log(`✅ [Tables] Created new table: ${newTable.name} (ID: ${newTable.id})`);
            res.status(201).json(newTable);
        } catch (error: any) {
            console.error('❌ [Tables] Error creating table:', error);
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
            
            CacheInvalidation.onTableChange(restaurant.id);
            
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
            
            CacheInvalidation.onTableChange(restaurant.id);
            
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

    // ✅ DYNAMIC: Table Availability with Complete Overnight Support (works for ANY times)
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

            // ✅ DYNAMIC: Check if restaurant operates overnight (works for ANY times)
            const isOvernight = restaurant.openingTime && restaurant.closingTime && 
                               isOvernightOperation(restaurant.openingTime, restaurant.closingTime);

            if (isOvernight) {
                console.log(`🌙 [Table Availability] Detected overnight operation: ${restaurant.openingTime} to ${restaurant.closingTime}`);
            }

            const cacheKey = CacheKeys.tableAvailability(restaurant.id, `${date}_${time}`);
            const tableAvailabilityData = await withCache(cacheKey, async () => {
                const tablesData = await storage.getTables(restaurant.id);
                
                if (tablesData.length === 0) {
                    console.log(`⚠️ [Table Availability] No tables found for restaurant ${restaurant.id} - this might be why frontend shows empty arrays`);
                    return [];
                }
                
                console.log(`📋 [Table Availability] Found ${tablesData.length} tables for restaurant ${restaurant.id}`);
                
                // ✅ DYNAMIC: Enhanced reservation fetching for overnight operations
                let reservationsData;
                if (isOvernight) {
                    // Get reservations from current date
                    const currentDateReservations = await storage.getReservations(restaurant.id, { 
                        date: date as string,
                        timezone: restaurant.timezone
                    });
                    
                    // For overnight operations, also check previous day if checking early morning hours
                    const checkHour = parseInt((time as string).split(':')[0]);
                    const closingHour = parseInt((restaurant.closingTime || '0:00').split(':')[0]);
                    
                    if (checkHour < closingHour) { // Early morning hours (before closing time)
                        const previousDate = DateTime.fromISO(date as string, { zone: restaurant.timezone })
                            .minus({ days: 1 }).toISODate();
                        const previousDateReservations = await storage.getReservations(restaurant.id, { 
                            date: previousDate,
                            timezone: restaurant.timezone
                        });
                        
                        reservationsData = [...currentDateReservations, ...previousDateReservations];
                        console.log(`🌙 [Table Availability] Overnight operation: ${currentDateReservations.length} current + ${previousDateReservations.length} previous day reservations`);
                    } else {
                        reservationsData = currentDateReservations;
                    }
                } else {
                    // Standard operation - just get current date reservations
                    reservationsData = await storage.getReservations(restaurant.id, { 
                        date: date as string,
                        timezone: restaurant.timezone
                    });
                }

                console.log(`📊 [Table Availability] Found ${tablesData.length} tables and ${reservationsData.length} reservations for ${date} (${restaurant.timezone})`);

                // ✅ DYNAMIC: Enhanced time slot checking for overnight operations
                const isTimeSlotOccupied = (reservation: any, checkTime: string) => {
                    const actualReservation = reservation.reservation || reservation;
                    
                    if (!actualReservation.reservation_utc) {
                        console.warn(`[Table Availability] Reservation ${actualReservation.id} missing UTC timestamp, skipping`);
                        return false;
                    }
                    
                    const restaurantDateTime = parsePostgresTimestamp(actualReservation.reservation_utc);
                    
                    if (!restaurantDateTime.isValid) {
                        console.warn(`[Table Availability] Invalid timestamp for reservation ${actualReservation.id}: ${actualReservation.reservation_utc}, skipping`);
                        return false;
                    }
                    
                    const localDateTime = restaurantDateTime.setZone(restaurant.timezone);
                    const startTime = localDateTime.toFormat('HH:mm:ss');
                    const duration = actualReservation.duration || 120;

                    console.log(`🔍 [Time Check] Reservation UTC: ${actualReservation.reservation_utc} -> Local: ${startTime} (${restaurant.timezone})`);

                    const [checkHour, checkMin] = checkTime.split(':').map(Number);
                    const checkMinutes = checkHour * 60 + checkMin;

                    const [startHour, startMin] = startTime.split(':').map(Number);
                    const startMinutes = startHour * 60 + startMin;
                    const endMinutes = startMinutes + duration;

                    // ✅ DYNAMIC: Enhanced overnight conflict detection
                    const slotEndMinutes = checkMinutes + 120; // Assume 2-hour reservation
                    
                    // Standard overlap check
                    let hasOverlap = startMinutes < slotEndMinutes && endMinutes > checkMinutes;
                    
                    // ✅ DYNAMIC: Additional overnight conflict detection
                    if (isOvernight && !hasOverlap) {
                        const openingHour = parseInt((restaurant.openingTime || '0:00').split(':')[0]);
                        const closingHour = parseInt((restaurant.closingTime || '0:00').split(':')[0]);
                        
                        // Handle conflicts across midnight boundary
                        if (checkHour < closingHour && startHour > openingHour) {
                            // Early morning check vs late night reservation from previous day
                            const adjustedCheckMinutes = checkMinutes + 24 * 60;
                            const adjustedSlotEnd = slotEndMinutes + 24 * 60;
                            hasOverlap = startMinutes < adjustedSlotEnd && endMinutes > adjustedCheckMinutes;
                            console.log(`🌙 [Overnight Conflict] Early morning ${checkTime} vs late night ${startTime}: ${hasOverlap}`);
                        } else if (checkHour > openingHour && startHour < closingHour) {
                            // Late night check vs early morning reservation
                            const adjustedStartMinutes = startMinutes + 24 * 60;
                            const adjustedEndMinutes = endMinutes + 24 * 60;
                            hasOverlap = adjustedStartMinutes < slotEndMinutes && adjustedEndMinutes > checkMinutes;
                            console.log(`🌙 [Overnight Conflict] Late night ${checkTime} vs early morning ${startTime}: ${hasOverlap}`);
                        }
                    }
                    
                    if (hasOverlap) {
                        console.log(`⚠️ [Table Availability] ${isOvernight ? 'Overnight' : 'Standard'} conflict detected: Reservation ${startTime}-${Math.floor(endMinutes/60).toString().padStart(2,'0')}:${(endMinutes%60).toString().padStart(2,'0')} overlaps with ${checkTime}`);
                    }
                    
                    return hasOverlap;
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
                            const reservationDateTime = parsePostgresTimestamp(actualReservation.reservation_utc);
                            const reservationLocal = reservationDateTime.isValid 
                                ? reservationDateTime.setZone(restaurant.timezone).toFormat('HH:mm:ss')
                                : 'Invalid Time';
                            
                            console.log(`⚠️ Table ${table.id} conflict found:`, {
                                guestName: r.guestName || actualReservation.booking_guest_name || guest.name,
                                timeLocal: reservationLocal,
                                timeUtc: actualReservation.reservation_utc,
                                status: actualReservation.status
                            });
                        }

                        return matches;
                    });

                    if (conflictingReservation) {
                        const actualReservation = conflictingReservation.reservation || conflictingReservation;
                        const guest = conflictingReservation.guest || {};

                        const reservationDateTime = parsePostgresTimestamp(actualReservation.reservation_utc);
                        
                        if (!reservationDateTime.isValid) {
                            console.warn(`[Table Availability] Invalid timestamp for display, skipping conflict for reservation ${actualReservation.id}`);
                            return { ...table, status: 'available', reservation: null };
                        }
                        
                        const reservationLocal = reservationDateTime.setZone(restaurant.timezone);
                        const startTime = reservationLocal.toFormat('HH:mm:ss');
                        const duration = actualReservation.duration || 120;
                        const endTime = reservationLocal.plus({ minutes: duration }).toFormat('HH:mm:ss');

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

                console.log(`✅ [Table Availability] Processed ${availabilityResult.length} tables with timezone ${restaurant.timezone} (overnight: ${isOvernight})`);
                
                if (availabilityResult.length === 0) {
                    console.log(`❌ [Table Availability] RETURNING EMPTY ARRAY - Check table creation and restaurant association`);
                } else {
                    console.log(`✅ [Table Availability] Returning ${availabilityResult.length} tables:`, 
                        availabilityResult.map(t => ({ id: t.id, name: t.name, status: t.status })));
                }
                
                return availabilityResult;
            }, 30);

            res.json(tableAvailabilityData);
        } catch (error) {
            console.error('❌ [Table Availability] Error:', error);
            next(error);
        }
    });

    // ✅ DYNAMIC: Available Times with Complete Overnight Support (works for ANY times)
    app.get("/api/booking/available-times", isAuthenticated, async (req: Request, res: Response, next) => {
        try {
            const { restaurantId, date, guests } = req.query;
            const user = req.user as any;
            
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            
            if (parseInt(restaurantId as string) !== restaurant.id) {
                return res.status(403).json({ message: "Access denied to this restaurant" });
            }
            
            if (!restaurantId || !date || !guests) {
                return res.status(400).json({ message: "Missing required parameters" });
            }
            
            console.log(`[Routes] Getting available times for restaurant ${restaurantId}, date ${date}, guests ${guests} in timezone ${restaurant.timezone}`);
            
            // ✅ DYNAMIC: Check for overnight operation (works for ANY times)
            const isOvernight = restaurant.openingTime && restaurant.closingTime && 
                               isOvernightOperation(restaurant.openingTime, restaurant.closingTime);
            
            // ✅ DYNAMIC: Enhanced maxResults calculation for overnight operations
            let maxResults: number;
            let operatingHours: number;
            
            if (isOvernight) {
                // Calculate total operating hours for overnight operations
                const parseTime = (timeStr: string): number => {
                    const parts = timeStr.split(':');
                    return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
                };
                
                const openingMinutes = parseTime(restaurant.openingTime || '10:00');
                const closingMinutes = parseTime(restaurant.closingTime || '22:00');
                
                // ✅ DYNAMIC: For overnight operations, calculate correctly (works for ANY times)
                operatingHours = (24 * 60 - openingMinutes + closingMinutes) / 60;
                
                // ✅ DYNAMIC: More generous slot calculation for overnight operations
                maxResults = Math.max(80, Math.floor(operatingHours * 2.5)); // Extra buffer for overnight
                
                console.log(`[Routes] 🌙 Overnight operation detected: ${restaurant.openingTime}-${restaurant.closingTime} (${operatingHours.toFixed(1)} hours), maxResults=${maxResults}`);
            } else {
                // Standard operation
                const parseTime = (timeStr: string): number => {
                    const parts = timeStr.split(':');
                    return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
                };
                
                const openingMinutes = parseTime(restaurant.openingTime || '10:00');
                const closingMinutes = parseTime(restaurant.closingTime || '22:00');
                operatingHours = (closingMinutes - openingMinutes) / 60;
                
                maxResults = Math.max(30, Math.floor(operatingHours * 2));
                
                console.log(`[Routes] 📅 Standard operation: ${restaurant.openingTime}-${restaurant.closingTime} (${operatingHours.toFixed(1)} hours), maxResults=${maxResults}`);
            }
            
            // ✅ DYNAMIC: Pass enhanced configuration to getAvailableTimeSlots
            const availableSlots = await getAvailableTimeSlots(
                parseInt(restaurantId as string),
                date as string,
                parseInt(guests as string),
                { 
                    maxResults: maxResults,
                    timezone: restaurant.timezone,
                    lang: 'en',
                    allowCombinations: true,
                    slotIntervalMinutes: 30,
                    slotDurationMinutes: restaurant.avgReservationDuration || 120,
                    operatingHours: {
                        open: restaurant.openingTime || '10:00:00',
                        close: restaurant.closingTime || '22:00:00'
                    }
                }
            );
            
            // ✅ DYNAMIC: Better slot information with overnight support
            const timeSlots = availableSlots.map(slot => ({
                time: slot.time,
                timeDisplay: slot.timeDisplay,
                available: true,
                tableName: slot.tableName,
                tableCapacity: slot.tableCapacity.max,
                canAccommodate: true,
                tablesCount: slot.isCombined ? (slot.constituentTables?.length || 1) : 1,
                isCombined: slot.isCombined || false,
                message: slot.isCombined 
                    ? `${slot.tableName} available (seats up to ${slot.tableCapacity.max})`
                    : `Table ${slot.tableName} available (seats up to ${slot.tableCapacity.max})`,
                slotType: (() => {
                    const hour = parseInt(slot.time.split(':')[0]);
                    if (isOvernight) {
                        const closingHour = parseInt((restaurant.closingTime || '0:00').split(':')[0]);
                        const openingHour = parseInt((restaurant.openingTime || '0:00').split(':')[0]);
                        if (hour >= 0 && hour < closingHour) return 'early_morning';
                        if (hour >= openingHour) return 'late_night';
                        return 'day';
                    }
                    return 'standard';
                })()
            }));
            
            console.log(`[Routes] 📊 Found ${timeSlots.length} available time slots for ${restaurant.timezone} ${isOvernight ? '(overnight operation)' : '(standard operation)'}`);
            
            // ✅ DYNAMIC: Enhanced debug information for overnight operations
            if (isOvernight && timeSlots.length > 0) {
                const closingHour = parseInt((restaurant.closingTime || '0:00').split(':')[0]);
                const openingHour = parseInt((restaurant.openingTime || '0:00').split(':')[0]);
                
                const earlyMorning = timeSlots.filter(s => s.slotType === 'early_morning').length;
                const day = timeSlots.filter(s => s.slotType === 'day').length;
                const lateNight = timeSlots.filter(s => s.slotType === 'late_night').length;
                
                console.log(`[Routes] 🌙 Overnight slot distribution: Early Morning (00:00-${closingHour.toString().padStart(2,'0')}:00): ${earlyMorning}, Day (${closingHour.toString().padStart(2,'0')}:00-${openingHour.toString().padStart(2,'0')}:00): ${day}, Late Night (${openingHour.toString().padStart(2,'0')}:00-24:00): ${lateNight}`);
            }
            
            // ✅ DYNAMIC: Comprehensive response with debug info
            res.json({ 
                availableSlots: timeSlots,
                isOvernightOperation: isOvernight,
                operatingHours: {
                    opening: restaurant.openingTime,
                    closing: restaurant.closingTime,
                    totalHours: operatingHours
                },
                timezone: restaurant.timezone,
                totalSlotsGenerated: timeSlots.length,
                maxSlotsRequested: maxResults,
                slotInterval: 30,
                reservationDuration: restaurant.avgReservationDuration || 120,
                debugInfo: {
                    openingTime: restaurant.openingTime,
                    closingTime: restaurant.closingTime,
                    isOvernight: isOvernight,
                    avgDuration: restaurant.avgReservationDuration || 120,
                    requestedDate: date,
                    requestedGuests: guests,
                    operatingHours: operatingHours,
                    calculatedMaxResults: maxResults,
                    actualSlotsReturned: timeSlots.length
                }
            });
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
            const filters = {
                date: req.query.date as string,
                status: req.query.status ? (req.query.status as string).split(',') : undefined,
                upcoming: req.query.upcoming === 'true',
                timezone: restaurant.timezone,
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
            if (!reservation || reservation.reservation.restaurantId !== restaurant.id) {
                return res.status(404).json({ message: "Reservation not found" });
            }
            res.json(reservation);
        } catch (error) {
            next(error);
        }
    });

    // ✅ DYNAMIC: Reservation creation with UTC timestamp support
    app.post("/api/reservations", isAuthenticated, async (req, res, next) => {
        try {
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

            // ✅ DYNAMIC: Convert date/time to UTC timestamp before booking
            const restaurantTimezone = req.body.timezone || restaurant.timezone;
            
            let localDateTime: DateTime;
            let reservation_utc: string;
            
            try {
                localDateTime = DateTime.fromISO(`${date}T${time}`, { zone: restaurantTimezone });
                if (!localDateTime.isValid) {
                    throw new Error(`Invalid date/time combination: ${date}T${time} in timezone ${restaurantTimezone}`);
                }
                
                reservation_utc = localDateTime.toUTC().toISO();
                if (!reservation_utc) {
                    throw new Error('Failed to convert to UTC timestamp');
                }
                
                console.log(`📅 [Reservation] Converting ${date}T${time} (${restaurantTimezone}) -> ${reservation_utc} (UTC)`);
            } catch (conversionError) {
                console.error('❌ [Reservation] DateTime conversion failed:', conversionError);
                return res.status(400).json({ 
                    message: "Invalid date/time format or timezone", 
                    details: conversionError instanceof Error ? conversionError.message : 'Unknown conversion error' 
                });
            }

            try {
                const bookingResult = await createReservation({
                    restaurantId: restaurant.id,
                    guestId: guest.id,
                    reservation_utc: reservation_utc,
                    guests: parseInt(numGuests as string),
                    timezone: restaurantTimezone,
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

                CacheInvalidation.onReservationUtcChange(
                    restaurant.id,
                    bookingResult.reservation.reservation_utc,
                    restaurantTimezone,
                    bookingResult.reservation.duration || 120
                );

                console.log(`✅ [Reservation Creation] Success - Reservation ID ${bookingResult.reservation.id} created with UTC-based cache invalidation`);

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

            CacheInvalidation.onReservationUtcChange(
                restaurant.id,
                existingReservation.reservation_utc,
                restaurant.timezone,
                existingReservation.duration || 120
            );

            if (validatedData.date && validatedData.time) {
                const newLocalDateTime = DateTime.fromISO(`${validatedData.date}T${validatedData.time}`, { zone: restaurant.timezone });
                validatedData.reservation_utc = newLocalDateTime.toUTC().toISO();
                
                CacheInvalidation.onReservationUtcChange(
                    restaurant.id,
                    validatedData.reservation_utc,
                    restaurant.timezone,
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

            CacheInvalidation.onReservationUtcChange(
                restaurant.id,
                existingReservation.reservation_utc,
                restaurant.timezone,
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

    // ===========================================
    // ✅ NEW: SOFIA AI CHAT ENDPOINTS (Enhanced)
    // ===========================================

    // ✅ NEW: Helper function to get agent for restaurant greeting
    const getAgentForRestaurant = async (restaurantId: number) => {
        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
            throw new Error(`Restaurant ${restaurantId} not found`);
        }

        return createBookingAgent({
            id: restaurant.id,
            name: restaurant.name,
            timezone: restaurant.timezone || 'Europe/Moscow',
            openingTime: restaurant.openingTime || '09:00:00',
            closingTime: restaurant.closingTime || '23:00:00',
            maxGuests: restaurant.maxGuests || 12,
            cuisine: restaurant.cuisine,
            atmosphere: restaurant.atmosphere,
            country: restaurant.country,
            languages: restaurant.languages
        });
    };

    // Create new chat session
    app.post("/api/chat/session", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }

            const { platform = 'web', language = 'en' } = req.body;

            const sessionId = enhancedConversationManager.createSession({
                restaurantId: restaurant.id,
                platform,
                language,
                webSessionId: req.sessionID
            });

            // ✅ NEW: Get restaurant greeting based on restaurant language/country
            let restaurantGreeting: string;
            try {
                const agent = await getAgentForRestaurant(restaurant.id);
                const context = platform === 'web' ? 'hostess' : 'guest';
                restaurantGreeting = agent.getRestaurantGreeting(context);
            } catch (error) {
                console.error('[API] Error generating restaurant greeting:', error);
                // Fallback greeting
                restaurantGreeting = `🌟 Hi! I'm Sofia, your AI booking assistant for ${restaurant.name}! I can help you check availability, make reservations quickly. Try: "Book Martinez for 4 tonight at 8pm, phone 555-1234"`;
            }

            console.log(`[API] Created Sofia chat session ${sessionId} for restaurant ${restaurant.id} with greeting in ${restaurant.languages?.[0] || 'en'}`);

            res.json({
                sessionId,
                restaurantId: restaurant.id,
                restaurantName: restaurant.name,
                restaurantGreeting, // ✅ NEW: Send restaurant-specific greeting
                language,
                platform
            });

        } catch (error) {
            console.error('[API] Error creating chat session:', error);
            next(error);
        }
    });

    // Send message to Sofia AI
    app.post("/api/chat/message", isAuthenticated, async (req, res, next) => {
        try {
            const { sessionId, message } = req.body;

            if (!sessionId || !message) {
                return res.status(400).json({ 
                    message: "Session ID and message are required" 
                });
            }

            // Validate session exists
            const session = enhancedConversationManager.getSession(sessionId);
            if (!session) {
                return res.status(404).json({ 
                    message: "Session not found. Please create a new session." 
                });
            }

            console.log(`[API] Processing Sofia message for session ${sessionId}: "${message.substring(0, 50)}..."`);

            // Handle message with Sofia AI
            const result = await enhancedConversationManager.handleMessage(sessionId, message);

            // Log AI activity if booking was created
            if (result.hasBooking && result.reservationId) {
                await storage.logAiActivity({
                    restaurantId: session.restaurantId,
                    type: 'booking_completed',
                    description: `Sofia AI created reservation #${result.reservationId} for ${session.gatheringInfo.name}`,
                    data: {
                        reservationId: result.reservationId,
                        sessionId,
                        platform: session.platform,
                        guestName: session.gatheringInfo.name,
                        guests: session.gatheringInfo.guests,
                        date: session.gatheringInfo.date,
                        time: session.gatheringInfo.time
                    }
                });
            }

            res.json({
                response: result.response,
                hasBooking: result.hasBooking,
                reservationId: result.reservationId,
                sessionInfo: {
                    gatheringInfo: result.session.gatheringInfo,
                    currentStep: result.session.currentStep,
                    conversationLength: result.session.conversationHistory.length
                }
            });

        } catch (error) {
            console.error('[API] Error handling Sofia message:', error);
            
            // Provide helpful error response
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            
            if (errorMessage.includes('Session') && errorMessage.includes('not found')) {
                return res.status(404).json({ 
                    message: "Your session has expired. Please refresh the page to start a new conversation." 
                });
            }

            res.status(500).json({ 
                message: "I encountered an error. Please try again or refresh the page." 
            });
        }
    });

    // Get chat session information
    app.get("/api/chat/session/:sessionId", isAuthenticated, async (req, res, next) => {
        try {
            const { sessionId } = req.params;
            const session = enhancedConversationManager.getSession(sessionId);

            if (!session) {
                return res.status(404).json({ message: "Session not found" });
            }

            // Verify user has access to this restaurant
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            
            if (!restaurant || restaurant.id !== session.restaurantId) {
                return res.status(403).json({ message: "Access denied" });
            }

            res.json({
                sessionId: session.sessionId,
                restaurantId: session.restaurantId,
                platform: session.platform,
                language: session.language,
                currentStep: session.currentStep,
                gatheringInfo: session.gatheringInfo,
                conversationLength: session.conversationHistory.length,
                hasActiveReservation: session.hasActiveReservation,
                createdAt: session.createdAt,
                lastActivity: session.lastActivity
            });

        } catch (error) {
            console.error('[API] Error getting session info:', error);
            next(error);
        }
    });

    // Get Sofia AI statistics
    app.get("/api/chat/stats", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }

            const stats = enhancedConversationManager.getStats();

            res.json({
                restaurantId: restaurant.id,
                ...stats,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('[API] Error getting Sofia stats:', error);
            next(error);
        }
    });

    // End chat session
    app.delete("/api/chat/session/:sessionId", isAuthenticated, async (req, res, next) => {
        try {
            const { sessionId } = req.params;
            const success = enhancedConversationManager.endSession(sessionId);

            if (!success) {
                return res.status(404).json({ message: "Session not found" });
            }

            console.log(`[API] Ended Sofia chat session ${sessionId}`);

            res.json({ 
                message: "Session ended successfully",
                sessionId 
            });

        } catch (error) {
            console.error('[API] Error ending chat session:', error);
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

            const dashboardReservations = await storage.getReservationStatistics(restaurant.id, restaurant.timezone);
            const allReservations = await storage.getReservations(restaurant.id, { timezone: restaurant.timezone });
            const todayReservations = await storage.getReservations(restaurant.id, { date: new Date().toISOString().split('T')[0], timezone: restaurant.timezone });
            const upcomingReservations = await storage.getUpcomingReservations(restaurant.id, restaurant.timezone, 3);

            const directSqlResult = await db.select().from(reservations).where(eq(reservations.restaurantId, restaurant.id)).orderBy(desc(reservations.createdAt));
            const cacheStats = cache.getStats();

            const tables = await storage.getTables(restaurant.id);

            return res.json({
                restaurantId: restaurant.id,
                restaurantTimezone: restaurant.timezone,
                todayDate: new Date().toISOString().split('T')[0],
                dashboardStats: dashboardReservations,
                allReservationsCount: allReservations.length,
                todayReservationsCount: todayReservations.length,
                upcomingReservationsCount: upcomingReservations.length,
                directSqlCount: directSqlResult.length,
                tablesCount: tables.length,
                tables: tables.map(t => ({ id: t.id, name: t.name, status: t.status })),
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