import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db, pool, getDatabaseHealth } from "./db";
import {
    insertUserSchema, insertRestaurantSchema,
    insertTableSchema, insertGuestSchema,
    insertReservationSchema, insertIntegrationSettingSchema,
    // ✅ REMOVED: timeslots import
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
// ✅ FIXED: Import both functions from availability service
import { getAvailableTimeSlots, isTableAvailableAtTimeSlot } from "./services/availability.service";
import { cache, CacheKeys, CacheInvalidation, withCache } from "./cache";
import { getPopularRestaurantTimezones, getRestaurantOperatingStatus } from "./utils/timezone-utils";
import { eq, and, desc, sql, count, or, inArray, gt, ne, notExists } from "drizzle-orm";
import { DateTime } from 'luxon';

// ✅ NEW IMPORT: Sofia AI Enhanced Conversation Manager
import { enhancedConversationManager } from "./services/enhanced-conversation-manager";
// ✅ NEW IMPORT: Booking Agent for Restaurant Greeting
// OBSOLETE: import { createBookingAgent } from "./services/agents/booking-agent";

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

    // ✅ NEW: Restaurant Operating Status (Phase 3 Enhancement)
    app.get("/api/restaurants/:id/status", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }

            const restaurantId = parseInt(req.params.id);
            if (restaurant.id !== restaurantId) {
                return res.status(403).json({ message: "Access denied" });
            }

            const operatingStatus = getRestaurantOperatingStatus(
                restaurant.timezone,
                restaurant.openingTime || '10:00:00',
                restaurant.closingTime || '22:00:00'
            );

            res.json({
                restaurantId: restaurant.id,
                restaurantName: restaurant.name,
                timezone: restaurant.timezone,
                ...operatingStatus,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[Restaurant Status] Error:', error);
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

    // ✅ REMOVED: All 3 timeslot endpoints
    // - GET /api/timeslots
    // - POST /api/timeslots/generate  
    // - GET /api/timeslots/stats

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

    // ✅ NEW: Enhanced Guest Analytics (Phase 3)
    app.get("/api/guests/:id/analytics", isAuthenticated, async (req, res, next) => {
        try {
            const guestId = parseInt(req.params.id);
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }

            const guest = await storage.getGuest(guestId);
            if (!guest) {
                return res.status(404).json({ message: "Guest not found" });
            }

            const reservationHistory = await storage.getGuestReservationHistory(guestId, restaurant.id);
            
            // Calculate additional analytics
            const completedVisits = reservationHistory.filter(r => r.reservation.status === 'completed');
            const completionRate = reservationHistory.length > 0 ? 
                Math.round((completedVisits.length / reservationHistory.length) * 100) : 100;

            // Calculate loyalty status
            const getLoyaltyStatus = (guest: any): string => {
                const visits = guest.visit_count || 0;
                const reputationScore = guest.reputation_score || 100;
                
                if (visits >= 20 && reputationScore >= 95) return 'VIP';
                if (visits >= 10 && reputationScore >= 90) return 'Frequent';
                if (visits >= 5 && reputationScore >= 85) return 'Regular';
                if (reputationScore < 70) return 'Watch List';
                return 'New';
            };

            // Analyze preferred times
            const analyzePreferredTimes = (reservations: any[]): string[] => {
                const timeSlots = reservations.map(r => {
                    const dateTime = DateTime.fromISO(r.reservation.reservation_utc);
                    const hour = dateTime.hour;
                    if (hour < 12) return 'morning';
                    if (hour < 17) return 'afternoon';
                    if (hour < 21) return 'evening';
                    return 'late';
                });
                
                const counts = timeSlots.reduce((acc, slot) => {
                    acc[slot] = (acc[slot] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>);
                
                return Object.entries(counts)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 2)
                    .map(([slot]) => slot);
            };
            
            const analytics = {
                guest: {
                    ...guest,
                    loyaltyStatus: getLoyaltyStatus(guest)
                },
                visitCount: guest.visit_count || 0,
                noShowCount: guest.no_show_count || 0,
                reputationScore: guest.reputation_score || 100,
                vipLevel: guest.vip_level || 0,
                completionRate,
                averageSpending: guest.total_spent && guest.visit_count ? 
                    (parseFloat(guest.total_spent) / guest.visit_count).toFixed(2) : '0.00',
                totalSpent: guest.total_spent || '0.00',
                lastVisit: guest.last_visit_date,
                averageDuration: guest.average_duration || null,
                preferences: guest.preferences || {},
                preferredTimes: analyzePreferredTimes(reservationHistory),
                recentReservations: reservationHistory.slice(0, 5).map(r => ({
                    id: r.reservation.id,
                    date: r.reservation.reservation_utc,
                    status: r.reservation.status,
                    guests: r.reservation.guests,
                    table: r.table?.name,
                    totalAmount: r.reservation.totalAmount,
                    feedback: r.reservation.staffNotes
                })),
                statistics: {
                    totalReservations: reservationHistory.length,
                    completedReservations: completedVisits.length,
                    cancelledReservations: reservationHistory.filter(r => r.reservation.status === 'canceled').length,
                    noShowReservations: reservationHistory.filter(r => r.reservation.status === 'no_show').length
                },
                recommendations: {
                    approach: (() => {
                        const visits = guest.visit_count || 0;
                        const reputation = guest.reputation_score || 100;
                        
                        if (visits >= 10) return "VIP treatment - recognize their loyalty and offer premium service";
                        if (visits >= 5) return "Regular guest - personalized service based on their history";
                        if (reputation < 80) return "Handle with care - previous issues noted, ensure exceptional service";
                        return "Standard professional service - build positive relationship";
                    })(),
                    notes: `${guest.visit_count || 0} visits, ${guest.reputation_score || 100}% reputation score`
                }
            };

            console.log(`✅ [Guest Analytics] Retrieved analytics for guest ${guestId}: ${analytics.visitCount} visits, ${analytics.reputationScore}% reputation`);

            res.json(analytics);
        } catch (error) {
            console.error('[Guest Analytics] Error:', error);
            next(error);
        }
    });

    // ✅ FIXED: Table Availability with Centralized Logic from Service
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

                // ✅ FIXED: Use centralized availability logic from service
                const availabilityResult = tablesData.map(table => {
                    const tableReservations = reservationsData.filter(r => {
                        const actualReservation = r.reservation || r;
                        return actualReservation.tableId === table.id && 
                               ['confirmed', 'created'].includes(actualReservation.status || '');
                    });

                    if (tableReservations.length > 0) {
                        console.log(`🔍 Table ${table.id} (${table.name}) has ${tableReservations.length} reservations`);
                    }

                    // Use a reasonable default for the slot duration check
                    const slotDuration = restaurant.avgReservationDuration || 120;

                    // ✅ FIXED: Use centralized function from availability service
                    // isTableAvailableAtTimeSlot returns true if it's FREE
                    // So, we check if ANY reservation makes it UNAVAILABLE
                    const isOccupied = tableReservations.some(r => {
                        const reservationDetails = {
                            reservation_utc: r.reservation?.reservation_utc || r.reservation_utc,
                            duration: r.reservation?.duration || r.duration,
                            id: r.reservation?.id || r.id
                        };
                        
                        // Note the "!" to invert the result
                        // If the table is NOT available, it is occupied
                        return !isTableAvailableAtTimeSlot(
                            table.id,
                            time as string,
                            [reservationDetails], // The function expects an array
                            slotDuration,
                            restaurant.timezone,
                            date as string,
                            isOvernight,
                            // Pass opening/closing times for proper overnight calculation
                            restaurant.openingTime ? parseInt(restaurant.openingTime.split(':')[0]) * 60 + parseInt(restaurant.openingTime.split(':')[1] || '0') : 0,
                            restaurant.closingTime ? parseInt(restaurant.closingTime.split(':')[0]) * 60 + parseInt(restaurant.closingTime.split(':')[1] || '0') : 1440
                        );
                    });

                    let conflictingReservationData = null;
                    if (isOccupied) {
                        // Find the specific conflicting reservation for display
                        const conflictingReservation = tableReservations.find(r => {
                            const reservationDetails = {
                                reservation_utc: r.reservation?.reservation_utc || r.reservation_utc,
                                duration: r.reservation?.duration || r.duration,
                                id: r.reservation?.id || r.id
                            };
                            
                            return !isTableAvailableAtTimeSlot(
                                table.id,
                                time as string,
                                [reservationDetails],
                                slotDuration,
                                restaurant.timezone,
                                date as string,
                                isOvernight,
                                restaurant.openingTime ? parseInt(restaurant.openingTime.split(':')[0]) * 60 + parseInt(restaurant.openingTime.split(':')[1] || '0') : 0,
                                restaurant.closingTime ? parseInt(restaurant.closingTime.split(':')[0]) * 60 + parseInt(restaurant.closingTime.split(':')[1] || '0') : 1440
                            );
                        });

                        if (conflictingReservation) {
                            const actualReservation = conflictingReservation.reservation || conflictingReservation;
                            const guest = conflictingReservation.guest || {};

                            const reservationDateTime = parsePostgresTimestamp(actualReservation.reservation_utc);
                            
                            if (reservationDateTime.isValid) {
                                const reservationLocal = reservationDateTime.setZone(restaurant.timezone);
                                const startTime = reservationLocal.toFormat('HH:mm:ss');
                                const duration = actualReservation.duration || 120;
                                const endTime = reservationLocal.plus({ minutes: duration }).toFormat('HH:mm:ss');

                                conflictingReservationData = {
                                    id: actualReservation.id,
                                    guestName: conflictingReservation.guestName || actualReservation.booking_guest_name || guest.name || 'Guest',
                                    guestCount: actualReservation.guests,
                                    timeSlot: `${startTime}-${endTime}`,
                                    phone: guest.phone || '',
                                    status: actualReservation.status
                                };
                            }
                        }
                    }

                    return { 
                        ...table, 
                        status: isOccupied ? 'reserved' : 'available', 
                        reservation: conflictingReservationData
                    };
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

    // ✅ ENHANCED: Available Times with Exact Time Support
    app.get("/api/booking/available-times", isAuthenticated, async (req: Request, res: Response, next) => {
        try {
            const { restaurantId, date, guests, exactTime } = req.query; // NEW: exactTime param
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
            
            console.log(`[Routes] Getting available times for restaurant ${restaurantId}, date ${date}, guests ${guests} in timezone ${restaurant.timezone}${exactTime ? ` (exact time: ${exactTime})` : ''}`);
            
            // ✅ NEW: Handle exact time checking
            if (exactTime) {
                console.log(`[Routes] 🎯 Exact time check: ${exactTime} for ${guests} guests on ${date}`);
                
                const availableSlots = await getAvailableTimeSlots(
                    parseInt(restaurantId as string),
                    date as string,
                    parseInt(guests as string),
                    { 
                        requestedTime: exactTime as string,
                        exactTimeOnly: true, // NEW: Only check this exact time
                        timezone: restaurant.timezone,
                        allowCombinations: true
                    }
                );
                
                return res.json({
                    exactTimeRequested: exactTime,
                    available: availableSlots.length > 0,
                    availableSlots: availableSlots.map(slot => ({
                        time: slot.time,
                        timeDisplay: slot.timeDisplay,
                        available: true,
                        tableName: slot.tableName,
                        tableCapacity: slot.tableCapacity.max,
                        canAccommodate: true,
                        isCombined: slot.isCombined,
                        tablesCount: slot.isCombined ? slot.constituentTables?.length || 1 : 1,
                        message: `${slot.tableName} available at ${slot.timeDisplay}`
                    })),
                    timezone: restaurant.timezone,
                    slotInterval: restaurant.slotInterval || 30, // NEW: Include restaurant setting
                    allowAnyTime: restaurant.allowAnyTime !== false, // NEW: Include restaurant setting
                    minTimeIncrement: restaurant.minTimeIncrement || 15 // NEW: Include restaurant setting
                });
            }
            
            // ✅ EXISTING LOGIC (enhanced with restaurant settings):
            const isOvernight = restaurant.openingTime && restaurant.closingTime && 
                               isOvernightOperation(restaurant.openingTime, restaurant.closingTime);
            
            // Use restaurant's configured slot interval
            const slotInterval = restaurant.slotInterval || 30; // NEW: Use restaurant setting
            
            // ✅ ENHANCED: maxResults calculation for overnight operations
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
            
            // ✅ ENHANCED: Pass restaurant configuration to getAvailableTimeSlots
            const availableSlots = await getAvailableTimeSlots(
                parseInt(restaurantId as string),
                date as string,
                parseInt(guests as string),
                { 
                    maxResults: maxResults,
                    timezone: restaurant.timezone,
                    lang: 'en',
                    allowCombinations: true,
                    slotIntervalMinutes: slotInterval, // NEW: Use restaurant setting
                    slotDurationMinutes: restaurant.avgReservationDuration || 120,
                    operatingHours: {
                        open: restaurant.openingTime || '10:00:00',
                        close: restaurant.closingTime || '22:00:00'
                    }
                }
            );
            
            // ✅ ENHANCED: Better slot information with overnight support
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
            
            // ✅ ENHANCED: Response with restaurant time configuration
            res.json({ 
                availableSlots: timeSlots,
                isOvernightOperation: isOvernight,
                operatingHours: {
                    opening: restaurant.openingTime,
                    closing: restaurant.closingTime,
                    totalHours: operatingHours
                },
                timezone: restaurant.timezone,
                
                // ✅ NEW: Include restaurant's flexible time configuration
                slotInterval: slotInterval, // Restaurant's preferred slot interval
                allowAnyTime: restaurant.allowAnyTime !== false, // Whether any time booking is allowed
                minTimeIncrement: restaurant.minTimeIncrement || 15, // Minimum time precision
                
                totalSlotsGenerated: timeSlots.length,
                maxSlotsRequested: maxResults,
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
                    actualSlotsReturned: timeSlots.length,
                    
                    // ✅ NEW: Debug info for time configuration
                    restaurantSlotInterval: restaurant.slotInterval,
                    restaurantAllowAnyTime: restaurant.allowAnyTime,
                    restaurantMinTimeIncrement: restaurant.minTimeIncrement
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

            // ✅ BUG 3 FIX: REMOVED DEAD CODE BLOCK
            // The dead code that checked for validatedData.date && validatedData.time has been removed
            // because the validation schema only supports reservation_utc, not separate date/time fields

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

    // ✅ NEW: PHASE 3 - ENHANCED RESERVATION STATUS MANAGEMENT
    
    // Seat guests - transition from confirmed to seated
    app.post("/api/reservations/:id/seat", isAuthenticated, async (req, res, next) => {
        try {
            const { tableNotes, staffMember } = req.body;
            const reservationId = parseInt(req.params.id);
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            
            // Validate current status
            const reservation = await storage.getReservation(reservationId);
            if (!reservation || reservation.reservation.restaurantId !== restaurant.id) {
                return res.status(404).json({ message: "Reservation not found" });
            }
            
            if (!['confirmed', 'created'].includes(reservation.reservation.status)) {
                return res.status(400).json({ 
                    message: `Cannot seat guests - reservation status is ${reservation.reservation.status}. Only confirmed reservations can be seated.` 
                });
            }

            // Update status with history tracking
            await storage.updateReservationWithHistory(reservationId, {
                status: 'seated',
                staffNotes: tableNotes
            }, {
                changedBy: 'staff',
                changeReason: 'Manual seating by staff',
                metadata: { staffMember: staffMember || user.name }
            });

            // Update table status if there's a table assigned
            if (reservation.reservation.tableId) {
                await storage.updateTable(reservation.reservation.tableId, { 
                    status: 'occupied' 
                });
                
                // Invalidate table cache
                CacheInvalidation.onTableChange(restaurant.id);
            }

            console.log(`✅ [Reservation Status] Seated guests for reservation ${reservationId} by ${staffMember || user.name}`);

            res.json({ 
                success: true, 
                message: "Guests have been seated successfully",
                reservationId,
                newStatus: 'seated',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[Reservation Status] Error seating guests:', error);
            next(error);
        }
    });

    // Complete visit - transition from seated/in_progress to completed
    app.post("/api/reservations/:id/complete", isAuthenticated, async (req, res, next) => {
        try {
            const { feedback, totalAmount, staffMember } = req.body;
            const reservationId = parseInt(req.params.id);
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            
            const reservation = await storage.getReservation(reservationId);
            if (!reservation || reservation.reservation.restaurantId !== restaurant.id) {
                return res.status(404).json({ message: "Reservation not found" });
            }

            if (!['seated', 'in_progress'].includes(reservation.reservation.status)) {
                return res.status(400).json({ 
                    message: `Cannot complete visit - reservation status is ${reservation.reservation.status}. Only seated or in-progress reservations can be completed.` 
                });
            }

            // Calculate visit duration
            const seatedTime = await storage.getStatusChangeTime(reservationId, 'seated');
            const duration = seatedTime ? 
                Math.round((Date.now() - seatedTime.getTime()) / 60000) : 
                reservation.reservation.duration;

            // Update reservation
            await storage.updateReservationWithHistory(reservationId, {
                status: 'completed',
                totalAmount: totalAmount ? parseFloat(totalAmount) : null,
                staffNotes: feedback
            }, {
                changedBy: 'staff',
                changeReason: 'Visit completed by staff',
                metadata: { 
                    staffMember: staffMember || user.name, 
                    actualDuration: duration,
                    totalAmount: totalAmount ? parseFloat(totalAmount) : null
                }
            });

            // Update guest analytics
            await storage.updateGuestAnalytics(reservation.reservation.guestId, {
                visitCompleted: true,
                duration,
                totalSpent: totalAmount ? parseFloat(totalAmount) : 0
            });

            // Free up table
            if (reservation.reservation.tableId) {
                await storage.updateTable(reservation.reservation.tableId, { 
                    status: 'free' 
                });
                
                // Invalidate table cache
                CacheInvalidation.onTableChange(restaurant.id);
            }

            console.log(`✅ [Reservation Status] Completed visit for reservation ${reservationId}, duration: ${duration}min, amount: $${totalAmount || 0}`);

            res.json({ 
                success: true, 
                message: "Visit completed successfully",
                reservationId,
                newStatus: 'completed',
                duration,
                totalAmount: totalAmount ? parseFloat(totalAmount) : null,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[Reservation Status] Error completing visit:', error);
            next(error);
        }
    });

    // Mark as no-show
    app.post("/api/reservations/:id/no-show", isAuthenticated, async (req, res, next) => {
        try {
            const { reason, staffMember } = req.body;
            const reservationId = parseInt(req.params.id);
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            
            const reservation = await storage.getReservation(reservationId);
            if (!reservation || reservation.reservation.restaurantId !== restaurant.id) {
                return res.status(404).json({ message: "Reservation not found" });
            }

            if (!['confirmed', 'created'].includes(reservation.reservation.status)) {
                return res.status(400).json({ 
                    message: `Cannot mark as no-show - reservation status is ${reservation.reservation.status}. Only confirmed reservations can be marked as no-show.` 
                });
            }

            await storage.updateReservationWithHistory(reservationId, {
                status: 'no_show',
                staffNotes: reason
            }, {
                changedBy: 'staff',
                changeReason: 'Marked as no-show by staff',
                metadata: { 
                    staffMember: staffMember || user.name, 
                    reason: reason || 'No reason provided'
                }
            });

            // Update guest analytics (negative impact)
            await storage.updateGuestAnalytics(reservation.reservation.guestId, {
                noShowOccurred: true
            });

            // Free up table
            if (reservation.reservation.tableId) {
                await storage.updateTable(reservation.reservation.tableId, { 
                    status: 'free' 
                });
                
                // Invalidate table cache
                CacheInvalidation.onTableChange(restaurant.id);
            }

            console.log(`⚠️ [Reservation Status] Marked reservation ${reservationId} as no-show: ${reason || 'No reason provided'}`);

            res.json({ 
                success: true, 
                message: "Reservation marked as no-show",
                reservationId,
                newStatus: 'no_show',
                reason: reason || 'No reason provided',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[Reservation Status] Error marking no-show:', error);
            next(error);
        }
    });

    // Get reservation status history
    app.get("/api/reservations/:id/history", isAuthenticated, async (req, res, next) => {
        try {
            const reservationId = parseInt(req.params.id);
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }
            
            // Verify reservation belongs to this restaurant
            const reservation = await storage.getReservation(reservationId);
            if (!reservation || reservation.reservation.restaurantId !== restaurant.id) {
                return res.status(404).json({ message: "Reservation not found" });
            }
            
            const history = await storage.getReservationStatusHistory(reservationId);
            
            console.log(`📋 [Reservation History] Retrieved ${history.length} status changes for reservation ${reservationId}`);
            
            res.json({
                reservationId,
                history: history.map(entry => ({
                    id: entry.id,
                    fromStatus: entry.fromStatus,
                    toStatus: entry.toStatus,
                    changedBy: entry.changedBy,
                    changeReason: entry.changeReason,
                    timestamp: entry.timestamp,
                    metadata: entry.metadata
                })),
                totalChanges: history.length
            });
        } catch (error) {
            console.error('[Reservation History] Error:', error);
            next(error);
        }
    });

    // ✅ NEW: PHASE 3 - MENU MANAGEMENT SYSTEM

    // Get menu items with advanced filtering
    app.get("/api/menu-items", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }

            const { category, available, search, popular, limit } = req.query;
            
            const filters = {
                category: category as string,
                availableOnly: available === 'true',
                searchQuery: search as string,
                popularOnly: popular === 'true',
                limit: limit ? parseInt(limit as string) : undefined
            };

            console.log(`🍽️ [Menu Items] Fetching menu items for restaurant ${restaurant.id} with filters:`, filters);

            const menuItems = await storage.getMenuItems(restaurant.id, filters);
            
            // Group by category for better UI organization
            const groupedItems = menuItems.reduce((acc, item) => {
                const cat = item.category || 'other';
                if (!acc[cat]) acc[cat] = [];
                acc[cat].push(item);
                return acc;
            }, {} as Record<string, any[]>);

            // Calculate summary statistics
            const stats = {
                totalItems: menuItems.length,
                availableItems: menuItems.filter(item => item.isAvailable).length,
                popularItems: menuItems.filter(item => item.isPopular).length,
                newItems: menuItems.filter(item => item.isNew).length,
                categoriesCount: Object.keys(groupedItems).length
            };

            console.log(`✅ [Menu Items] Retrieved ${menuItems.length} items across ${Object.keys(groupedItems).length} categories`);

            res.json({
                items: menuItems,
                groupedItems,
                categories: Object.keys(groupedItems),
                stats,
                filters: filters,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[Menu Items] Error fetching items:', error);
            next(error);
        }
    });

    // ✅ BUG 1 FIX: Create new menu item with category name lookup
    app.post("/api/menu-items", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }

            // Basic validation schema for menu items
            const menuItemSchema = z.object({
                name: z.string().min(1, "Name is required"),
                description: z.string().optional(),
                price: z.string().or(z.number()).transform(val => String(val)),
                category: z.string().min(1, "Category is required"),
                allergens: z.array(z.string()).optional(),
                dietaryTags: z.array(z.string()).optional(),
                isAvailable: z.boolean().default(true),
                isPopular: z.boolean().default(false),
                isNew: z.boolean().default(false),
                preparationTime: z.number().optional(),
                spicyLevel: z.number().min(0).max(5).default(0)
            });

            const validatedData = menuItemSchema.parse(req.body);

            // ✅ BUG 1 FIX: Look up the category ID from the category name
            const category = await storage.getMenuCategoryByName(restaurant.id, validatedData.category);

            if (!category) {
                return res.status(400).json({ message: `Category '${validatedData.category}' not found.` });
            }

            const newItem = await storage.createMenuItem({
                name: validatedData.name,
                price: validatedData.price,
                description: validatedData.description,
                isAvailable: validatedData.isAvailable,
                isPopular: validatedData.isPopular,
                isNew: validatedData.isNew,
                preparationTime: validatedData.preparationTime,
                spicyLevel: validatedData.spicyLevel,
                allergens: validatedData.allergens,
                dietaryTags: validatedData.dietaryTags,
                restaurantId: restaurant.id,
                categoryId: category.id  // ✅ BUG 1 FIX: Use the correct numeric categoryId
            });
            
            // Invalidate menu cache
            cache.invalidatePattern(`menu_items_${restaurant.id}`);
            
            console.log(`✅ [Menu Items] Created new item: ${newItem.name} (${validatedData.category}) - $${newItem.price}`);

            res.status(201).json({
                ...newItem,
                message: "Menu item created successfully"
            });
        } catch (error: any) {
            console.error('[Menu Items] Error creating item:', error);
            if (error instanceof z.ZodError) {
                return res.status(400).json({ 
                    message: "Validation failed", 
                    errors: error.errors 
                });
            }
            next(error);
        }
    });

    // Update menu item
    app.patch("/api/menu-items/:id", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }

            const itemId = parseInt(req.params.id);
            
            // Verify the item belongs to this restaurant
            const existingItem = await storage.getMenuItem(itemId);
            if (!existingItem || existingItem.restaurantId !== restaurant.id) {
                return res.status(404).json({ message: "Menu item not found" });
            }

            const updatedItem = await storage.updateMenuItem(itemId, req.body);
            
            // Invalidate menu cache
            cache.invalidatePattern(`menu_items_${restaurant.id}`);
            
            console.log(`✅ [Menu Items] Updated item ${itemId}: ${updatedItem.name}`);

            res.json({
                ...updatedItem,
                message: "Menu item updated successfully"
            });
        } catch (error) {
            console.error('[Menu Items] Error updating item:', error);
            next(error);
        }
    });

    // Delete menu item
    app.delete("/api/menu-items/:id", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }

            const itemId = parseInt(req.params.id);
            
            // Verify the item belongs to this restaurant
            const existingItem = await storage.getMenuItem(itemId);
            if (!existingItem || existingItem.restaurantId !== restaurant.id) {
                return res.status(404).json({ message: "Menu item not found" });
            }

            await storage.deleteMenuItem(itemId);
            
            // Invalidate menu cache
            cache.invalidatePattern(`menu_items_${restaurant.id}`);
            
            console.log(`🗑️ [Menu Items] Deleted item ${itemId}: ${existingItem.name}`);

            res.json({ 
                success: true, 
                message: "Menu item deleted successfully",
                deletedItem: { id: itemId, name: existingItem.name }
            });
        } catch (error) {
            console.error('[Menu Items] Error deleting item:', error);
            next(error);
        }
    });

    // Bulk update menu items
    app.put("/api/menu-items/bulk", isAuthenticated, async (req, res, next) => {
        try {
            const { items, action } = req.body; // action: 'availability', 'prices', 'categories'
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }

            if (!items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ message: "Items array is required and must not be empty" });
            }

            if (!action || !['availability', 'prices', 'categories', 'delete'].includes(action)) {
                return res.status(400).json({ message: "Valid action is required: availability, prices, categories, or delete" });
            }

            console.log(`🔄 [Menu Items] Bulk ${action} update for ${items.length} items in restaurant ${restaurant.id}`);

            const results = await storage.bulkUpdateMenuItems(restaurant.id, items, action);
            
            // Invalidate cache
            cache.invalidatePattern(`menu_items_${restaurant.id}`);
            
            console.log(`✅ [Menu Items] Bulk ${action} completed: ${results.length} items processed`);
            
            res.json({ 
                success: true, 
                action,
                updatedCount: results.length,
                items: results,
                message: `Bulk ${action} update completed successfully`
            });
        } catch (error) {
            console.error('[Menu Items] Error in bulk update:', error);
            next(error);
        }
    });

    // Search menu items (enhanced search)
    app.get("/api/menu-items/search", isAuthenticated, async (req, res, next) => {
        try {
            const user = req.user as any;
            const restaurant = await storage.getRestaurantByUserId(user.id);
            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }

            const { q: query, category, dietary, priceMin, priceMax } = req.query;
            
            if (!query || typeof query !== 'string') {
                return res.status(400).json({ message: "Search query is required" });
            }

            console.log(`🔍 [Menu Search] Searching for "${query}" in restaurant ${restaurant.id}`);

            // Enhanced search with multiple strategies
            const searchResults = await storage.searchMenuItems(restaurant.id, {
                query: query as string,
                category: category as string,
                dietaryRestrictions: dietary ? (dietary as string).split(',') : undefined,
                priceRange: {
                    min: priceMin ? parseFloat(priceMin as string) : undefined,
                    max: priceMax ? parseFloat(priceMax as string) : undefined
                }
            });

            // Log search for analytics
            await storage.logMenuSearch(restaurant.id, query as string, 'staff_search');

            console.log(`✅ [Menu Search] Found ${searchResults.length} results for "${query}"`);

            res.json({
                query,
                results: searchResults,
                resultCount: searchResults.length,
                searchFilters: {
                    category,
                    dietary,
                    priceRange: { min: priceMin, max: priceMax }
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[Menu Search] Error:', error);
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
                restaurantGreeting = agent.getPersonalizedGreeting(null, language, context);

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