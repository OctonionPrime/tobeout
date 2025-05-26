import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
// import { initializeTelegramBot } from "./services/telegram"; // initializeTelegramBot is in telegram.ts
import { 
 insertUserSchema, insertRestaurantSchema, 
 insertTableSchema, insertGuestSchema, 
 insertReservationSchema, insertIntegrationSettingSchema,
 timeslots,
 type Guest // Import Guest type
} from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcryptjs";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import MemoryStore from "memorystore";

// ✅ UPDATED IMPORTS - Using new refactored services
import { initializeTelegramBot, initializeAllTelegramBots } from "./services/telegram"; // Corrected import
import { 
 // findAvailableTables, // Legacy, direct usage of getAvailableTimeSlots is preferred
 // findAlternativeSlots, // Legacy
 createReservation, // This is the primary booking service function
 cancelReservation, 
 // getDateAvailability // Legacy
} from "./services/booking";
import { getAvailableTimeSlots } from "./services/availability.service"; // ✅ NEW IMPORT
import { cache, CacheKeys, CacheInvalidation, withCache } from "./cache";
import { eq, and, desc, sql } from "drizzle-orm";

const Session = MemoryStore(session);

export async function registerRoutes(app: Express): Promise<Server> {
 // Configure session middleware
 app.use(
   session({
     secret: process.env.SESSION_SECRET || "tobeout-secret-key",
     resave: false,
     saveUninitialized: false,
     cookie: { secure: process.env.NODE_ENV === "production", maxAge: 86400000 }, // 1 day
     store: new Session({
       checkPeriod: 86400000, // prune expired entries every 24h
     }),
   })
 );

 // Initialize Passport
 app.use(passport.initialize());
 app.use(passport.session());

 // Configure Passport local strategy
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

 // Authentication middleware
 const isAuthenticated = (req: Request, res: Response, next: Function) => {
   if (req.isAuthenticated()) {
     return next();
   }
   res.status(401).json({ message: "Unauthorized" });
 };

 // Auth routes
 app.post("/api/auth/register", async (req, res) => {
   try {
     const userSchema = insertUserSchema.extend({
       confirmPassword: z.string(),
       restaurantName: z.string(),
     });

     const validatedData = userSchema.parse(req.body);

     if (validatedData.password !== validatedData.confirmPassword) {
       return res.status(400).json({ message: "Passwords do not match" });
     }

     // Check if user already exists
     const existingUser = await storage.getUserByEmail(validatedData.email);
     if (existingUser) {
       return res.status(400).json({ message: "Email already registered" });
     }

     // Hash password
     const hashedPassword = await bcrypt.hash(validatedData.password, 10);

     // Create user
     const user = await storage.createUser({
       email: validatedData.email,
       password: hashedPassword,
       name: validatedData.name,
       role: 'restaurant',
       phone: validatedData.phone,
     });

     // Create restaurant
     const restaurant = await storage.createRestaurant({
       userId: user.id,
       name: validatedData.restaurantName,
       phone: validatedData.phone,
     });

     // Log in the user
     req.login(user, (err) => {
       if (err) {
         return res.status(500).json({ message: "Error logging in" });
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
   } catch (error: any) { // Changed error to any for type safety with ZodError
     console.error("Registration error:", error);
     if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: error.errors });
     }
     res.status(400).json({ message: error.message });
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

 app.post("/api/auth/logout", (req, res) => {
   req.logout((err) => { // Added error handling for logout
    if (err) { 
        console.error("Logout error:", err);
        return res.status(500).json({ message: "Error logging out" });
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
 app.get("/api/restaurants/profile", isAuthenticated, async (req, res) => {
   try {
     const user = req.user as any;
     const restaurant = await storage.getRestaurantByUserId(user.id);

     if (!restaurant) {
       return res.status(404).json({ message: "Restaurant not found" });
     }

     res.json(restaurant);
   } catch (error: any) {
     res.status(500).json({ message: error.message });
   }
 });

 app.patch("/api/restaurants/profile", isAuthenticated, async (req, res) => {
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
    res.status(400).json({ message: error.message });
   }
 });

 // Table routes
 app.get("/api/tables", isAuthenticated, async (req, res) => {
   try {
     const user = req.user as any;
     const restaurant = await storage.getRestaurantByUserId(user.id);

     if (!restaurant) {
       return res.status(404).json({ message: "Restaurant not found" });
     }

     const tables = await storage.getTables(restaurant.id);
     res.json(tables);
   } catch (error: any) {
     res.status(500).json({ message: error.message });
   }
 });

 app.post("/api/tables", isAuthenticated, async (req, res) => {
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
    res.status(400).json({ message: error.message });
   }
 });

 app.patch("/api/tables/:id", isAuthenticated, async (req, res) => {
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
    res.status(400).json({ message: error.message });
   }
 });

 app.delete("/api/tables/:id", isAuthenticated, async (req, res) => {
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
   } catch (error: any) {
     res.status(500).json({ message: error.message });
   }
 });

 // Timeslot routes
 app.get("/api/timeslots", isAuthenticated, async (req, res) => {
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

     const timeslotsData = await storage.getTimeslots(restaurant.id, date); // Renamed to avoid conflict
     res.json(timeslotsData);
   } catch (error: any) {
     res.status(500).json({ message: error.message });
   }
 });

 app.post("/api/timeslots/generate", isAuthenticated, async (req, res) => {
   try {
     const user = req.user as any;
     const restaurant = await storage.getRestaurantByUserId(user.id);

     if (!restaurant) {
       return res.status(404).json({ message: "Restaurant not found" });
     }

     const daysAhead = parseInt(req.query.days as string) || 14;
     const count = await storage.generateTimeslots(restaurant.id, daysAhead);

     res.json({ message: `Generated ${count} timeslots` });
   } catch (error: any) {
     res.status(500).json({ message: error.message });
   }
 });

 app.get("/api/timeslots/stats", isAuthenticated, async (req, res) => {
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

     const totalCountResult = await db.select({ // Renamed to avoid conflict
       count: sql<number>`count(*)`,
     })
     .from(timeslots)
     .where(eq(timeslots.restaurantId, restaurant.id));

     const freeCountResult = await db.select({ // Renamed to avoid conflict
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
     res.status(500).json({ message: error instanceof Error ? error.message : "Unknown error" });
   }
 });

 // Guest routes
 app.get("/api/guests", isAuthenticated, async (req, res) => {
   try {
     const user = req.user as any;
     const restaurant = await storage.getRestaurantByUserId(user.id);

     if (!restaurant) {
       return res.status(404).json({ message: "Restaurant not found" });
     }

     const guestsData = await storage.getGuests(restaurant.id); // Renamed
     res.json(guestsData);
   } catch (error: any) {
     res.status(500).json({ message: error.message });
   }
 });

 app.post("/api/guests", isAuthenticated, async (req, res) => {
   try {
     const validatedData = insertGuestSchema.parse(req.body);
     let guest: Guest | undefined = await storage.getGuestByPhone(validatedData.phone as string); // Added type assertion

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
    res.status(400).json({ message: error.message });
   }
 });

 // Table availability for specific date/time (with smart caching)
 app.get("/api/tables/availability", isAuthenticated, async (req, res) => {
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

     const cacheKey = CacheKeys.tableAvailability(restaurant.id, `${date}_${time}`);
     const tableAvailabilityData = await withCache(cacheKey, async () => { // Renamed
       const tablesData = await storage.getTables(restaurant.id); // Renamed
       const reservationsData = await storage.getReservations(restaurant.id, { date: date as string }); // Renamed

       const isTimeSlotOccupied = (reservation: any, checkTime: string) => {
         const startTime = reservation.time;
         const duration = reservation.duration || 90;
         const [checkHour, checkMin] = checkTime.split(':').map(Number);
         const checkMinutes = checkHour * 60 + checkMin;
         const [startHour, startMin] = startTime.split(':').map(Number);
         const startMinutes = startHour * 60 + startMin;
         const endMinutes = startMinutes + duration;
         return checkMinutes >= startMinutes && checkMinutes < endMinutes;
       };

       const availabilityResult = tablesData.map(table => { // Renamed
         const tableReservations = reservationsData.filter(r => r.tableId === table.id);
         if (tableReservations.length > 0) {
           console.log(`🔍 Table ${table.id} reservations:`, tableReservations.map(r => ({
             guestName: r.guestName, 
             status: r.status, 
             time: r.time, 
             date: r.date
           })));
         }
         const conflictingReservation = reservationsData.find(r => 
           r.tableId === table.id && 
           ['confirmed', 'created'].includes(r.status || '') &&
           isTimeSlotOccupied(r, time as string)
         );
         if (conflictingReservation) {
           const startTime = conflictingReservation.time;
           const duration = conflictingReservation.duration || 90;
           const endHour = Math.floor((parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]) + duration) / 60);
           const endMin = ((parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]) + duration) % 60);
           const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
           return {
             ...table,
             status: 'reserved',
             reservation: {
               id: conflictingReservation.id,
               guestName: conflictingReservation.guestName || 'Reserved',
               guestCount: conflictingReservation.guests,
               timeSlot: `${startTime}-${endTime}`,
               phone: conflictingReservation.guestPhone || '',
               status: conflictingReservation.status
             }
           };
         }
         return { ...table, status: 'available', reservation: null };
       });
       return availabilityResult;
     }, 30);
     res.json(tableAvailabilityData);
   } catch (error: any) {
     console.error("Error getting table availability:", error);
     res.status(500).json({ message: "Internal server error" });
   }
 });

 app.get("/api/booking/available-times", isAuthenticated, async (req: Request, res: Response) => {
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
   } catch (error: any) {
     console.error("Error getting available times:", error);
     res.status(500).json({ message: "Internal server error" });
   }
 });

 // Reservation routes
 app.get("/api/reservations", isAuthenticated, async (req, res) => {
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
     const reservationsData = await storage.getReservations(restaurant.id, filters); // Renamed
     res.json(reservationsData);
   } catch (error: any) {
     res.status(500).json({ message: error.message });
   }
 });

 app.get("/api/reservations/:id", isAuthenticated, async (req, res) => {
   try {
     const user = req.user as any;
     const restaurant = await storage.getRestaurantByUserId(user.id);
     if (!restaurant) {
       return res.status(404).json({ message: "Restaurant not found" });
     }
     const reservationId = parseInt(req.params.id);
     const reservation = await storage.getReservation(reservationId);
     if (!reservation || reservation.restaurantId !== restaurant.id) {
       return res.status(404).json({ message: "Reservation not found" });
     }
     res.json(reservation);
   } catch (error: any) {
     res.status(500).json({ message: error.message });
   }
 });

 app.post("/api/reservations", isAuthenticated, async (req, res) => {
   console.log('🔥 RESERVATION ENDPOINT HIT (POST /api/reservations)!');
   try {
     console.log('Received reservation request body:', req.body);

     const user = req.user as any;
     const restaurant = await storage.getRestaurantByUserId(user.id);
     if (!restaurant) {
       return res.status(404).json({ message: "Restaurant not found" });
     }

     // Validate required fields from req.body
     const { guestName, guestPhone, date, time, guests: numGuests } = req.body; // Renamed guests to numGuests
     if (!guestName || !guestPhone || !date || !time || !numGuests) {
       return res.status(400).json({ message: "Missing required fields: guestName, guestPhone, date, time, guests" });
     }

     let guest: Guest | undefined = await storage.getGuestByPhone(guestPhone);
     console.log('Guest lookup by phone result:', guest);

     if (!guest) {
       console.log('Creating new guest as none found by phone.');
       guest = await storage.createGuest({
         name: guestName, // Use guestName from request for new guest profile
         phone: guestPhone,
         email: req.body.guestEmail || null,
         // language and other fields can be set to defaults or extracted if available
       });
       console.log('Created new guest:', guest);
     } else {
        // Optionally, update existing guest's name if guestName from request differs
        // For now, we prioritize the existing guest's profile name unless explicitly told to update.
        // The booking_guest_name will handle the name for this specific booking.
        console.log(`Existing guest found: ID ${guest.id}, Profile Name: ${guest.name}`);
     }

     if (!guest) { // Should not happen if creation above is successful
       return res.status(400).json({ message: "Guest information processing failed." });
     }

     // Determine booking_guest_name: Use guestName from request if it's different from the guest's profile name.
     // Otherwise, it can be null (storage will use profile name).
     const bookingGuestNameForThisReservation = (guestName !== guest.name) ? guestName : null;
     console.log(`Name for this specific booking (booking_guest_name): ${bookingGuestNameForThisReservation}, Guest profile name: ${guest.name}`);

     const bookingResult = await createReservation({
       restaurantId: restaurant.id,
       guestId: guest.id,
       date: date,
       time: time,
       guests: parseInt(numGuests as string), // Ensure guests is a number
       comments: req.body.comments || '',
       source: req.body.source || 'manual',
       booking_guest_name: bookingGuestNameForThisReservation, // Pass the specific name for this booking
       lang: req.body.lang || restaurant.languages?.[0] || 'en', // Pass language
     });

     if (!bookingResult.success || !bookingResult.reservation) { // Check reservation existence
       return res.status(400).json({ 
         message: bookingResult.message,
         details: 'Smart table assignment could not find available slot or booking failed'
       });
     }

     console.log('✅ New booking service completed! Table assigned:', bookingResult.table?.name);
     CacheInvalidation.onReservationChange(restaurant.id, date);

     if (['telegram', 'web_chat', 'facebook'].includes(req.body.source || 'manual')) {
       await storage.logAiActivity({
         restaurantId: restaurant.id,
         type: 'reservation_create',
         description: `Smart table assignment: ${bookingResult.table?.name} for ${bookingGuestNameForThisReservation || guest.name} (${numGuests} guests) via ${req.body.source}`,
         data: {
           reservationId: bookingResult.reservation.id,
           guestId: guest.id,
           tableId: bookingResult.reservation.tableId,
           tableName: bookingResult.table?.name,
           smartAssignment: true
         }
       });
     }
     return res.status(201).json({
       ...bookingResult.reservation,
       guestName: bookingGuestNameForThisReservation || guest.name, // Ensure guestName in response reflects booking
       table: bookingResult.table,
       smartAssignment: true
     });

   } catch (error: any) {
     console.error('❌ Error in reservation creation (POST /api/reservations):', error);
     if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: error.errors });
    }
     res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error during reservation creation" });
   }
 });

 app.patch("/api/reservations/:id", isAuthenticated, async (req, res) => {
   try {
     const user = req.user as any;
     const restaurant = await storage.getRestaurantByUserId(user.id);
     if (!restaurant) {
       return res.status(404).json({ message: "Restaurant not found" });
     }
     const reservationId = parseInt(req.params.id);
     const existingReservation = await storage.getReservation(reservationId); // Use existingReservation to avoid conflict
     if (!existingReservation || existingReservation.restaurantId !== restaurant.id) {
       return res.status(404).json({ message: "Reservation not found" });
     }

     const validatedData = insertReservationSchema.partial().parse(req.body);

     // If tableId is explicitly set to null or not provided, and other details change, try smart assignment
     if ((validatedData.tableId === null || validatedData.tableId === undefined) && 
         (validatedData.date || validatedData.time || validatedData.guests)) {
       console.log('🎯 Using smart table assignment for reservation edit due to tableId being null/undefined and other changes.');
       const guestForUpdate = await storage.getGuest(existingReservation.guestId);
       if (!guestForUpdate) return res.status(404).json({ message: "Guest not found for reservation update." });

       // Use existing booking_guest_name if not provided in update, else use new one or profile name
       let nameForBookingUpdate = validatedData.booking_guest_name !== undefined 
                                ? validatedData.booking_guest_name 
                                : existingReservation.booking_guest_name;
       if (nameForBookingUpdate === null && validatedData.booking_guest_name === undefined) { // If still null, use profile name
            nameForBookingUpdate = guestForUpdate.name;
       }


       const bookingResult = await createReservation({
         restaurantId: restaurant.id,
         guestId: existingReservation.guestId,
         date: validatedData.date || existingReservation.date,
         time: validatedData.time || existingReservation.time,
         guests: validatedData.guests || existingReservation.guests,
         comments: validatedData.comments || existingReservation.comments || '',
         source: validatedData.source || existingReservation.source || 'manual',
         booking_guest_name: nameForBookingUpdate, // Pass the determined name
         lang: req.body.lang || restaurant.languages?.[0] || 'en',
       });
       if (!bookingResult.success || !bookingResult.reservation) {
         return res.status(400).json({ message: bookingResult.message || "Failed to re-assign table smartly." });
       }
       validatedData.tableId = bookingResult.reservation.tableId;
       validatedData.status = validatedData.status || 'confirmed'; // Keep existing or confirm
       validatedData.booking_guest_name = nameForBookingUpdate; // Ensure this is set for the update
       console.log('✅ Smart assignment for edit completed! Table assigned:', bookingResult.table?.name);
       await storage.logAiActivity({
         restaurantId: restaurant.id,
         type: 'reservation_update_smart',
         description: `Smart table re-assignment: ${bookingResult.table?.name} for ${nameForBookingUpdate || guestForUpdate.name}`,
         data: { reservationId, tableId: bookingResult.reservation.tableId, tableName: bookingResult.table?.name }
       });
     }

     const updatedReservation = await storage.updateReservation(reservationId, validatedData);
     if (validatedData.status && ['confirmed', 'canceled'].includes(validatedData.status)) {
       const guest = await storage.getGuest(existingReservation.guestId);
       await storage.logAiActivity({
         restaurantId: restaurant.id,
         type: `reservation_${validatedData.status}`,
         description: `Reservation for ${updatedReservation.booking_guest_name || guest?.name || 'Guest'} was ${validatedData.status}`,
         data: { reservationId, guestId: existingReservation.guestId, previousStatus: existingReservation.status }
       });
     }
     res.json(updatedReservation);
   } catch (error: any) {
    if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: error.errors });
    }
    res.status(400).json({ message: error.message });
   }
 });

 // Dashboard data
 app.get("/api/dashboard/stats", isAuthenticated, async (req, res) => {
   try {
     const user = req.user as any;
     const restaurant = await storage.getRestaurantByUserId(user.id);
     if (!restaurant) {
       return res.status(404).json({ message: "Restaurant not found" });
     }
     const stats = await storage.getReservationStatistics(restaurant.id);
     res.json(stats);
   } catch (error: any) {
     res.status(500).json({ message: error.message });
   }
 });

 app.get("/api/dashboard/upcoming", isAuthenticated, async (req, res) => {
   try {
     const user = req.user as any;
     const restaurant = await storage.getRestaurantByUserId(user.id);
     if (!restaurant) {
       return res.status(404).json({ message: "Restaurant not found" });
     }
     const hours = parseInt(req.query.hours as string) || 3;
     const upcoming = await storage.getUpcomingReservations(restaurant.id, hours);
     res.json(upcoming);
   } catch (error: any) {
     res.status(500).json({ message: error.message });
   }
 });

 // AI Assistant Activity
 app.get("/api/ai/activities", isAuthenticated, async (req, res) => {
   try {
     const user = req.user as any;
     const restaurant = await storage.getRestaurantByUserId(user.id);
     if (!restaurant) {
       return res.status(404).json({ message: "Restaurant not found" });
     }
     const limit = parseInt(req.query.limit as string) || 10;
     const activities = await storage.getAiActivities(restaurant.id, limit);
     res.json(activities);
   } catch (error: any) {
     res.status(500).json({ message: error.message });
   }
 });

 // Integration settings
 app.get("/api/integrations/:type", isAuthenticated, async (req, res) => {
   try {
     const user = req.user as any;
     const restaurant = await storage.getRestaurantByUserId(user.id);
     if (!restaurant) {
       return res.status(404).json({ message: "Restaurant not found" });
     }
     const type = req.params.type;
     const settings = await storage.getIntegrationSettings(restaurant.id, type);
     if (!settings) {
       return res.json({ enabled: false }); // Return a default structure
     }
     res.json(settings);
   } catch (error: any) {
     res.status(500).json({ message: error.message });
   }
 });

  app.get("/api/integrations/telegram/test", isAuthenticated, async (req, res) => {
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
         const TelegramBot = require('node-telegram-bot-api'); // Consider moving to top-level import if always used
         const bot = new TelegramBot(settings.token);
         const botInfo = await bot.getMe();
         const updatedSettingsData = { // Renamed to avoid conflict
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
         console.error("Telegram bot connection test failed:", botError);
         return res.status(400).json({ 
           success: false, 
           message: `Failed to connect to Telegram bot: ${botError instanceof Error ? botError.message : "Unknown error"}` 
         });
       }
     } catch (error: unknown) {
       console.error("Error testing Telegram bot:", error);
       res.status(500).json({ message: error instanceof Error ? error.message : "Unknown error" });
     }
   });

   app.post("/api/integrations/:type", isAuthenticated, async (req, res) => {
     try {
       const user = req.user as any;
       const restaurant = await storage.getRestaurantByUserId(user.id);
       if (!restaurant) {
         return res.status(404).json({ message: "Restaurant not found" });
       }
       const type = req.params.type;
       let customSettings = {}; // Renamed
       if (req.body.botUsername) {
         customSettings = { botUsername: req.body.botUsername };
         delete req.body.botUsername;
       }
       const validatedData = insertIntegrationSettingSchema.parse({
         ...req.body,
         restaurantId: restaurant.id,
         type,
         settings: customSettings // Use renamed variable
       });
       const savedSettings = await storage.saveIntegrationSettings(validatedData);
       if (type === 'telegram' && savedSettings.enabled && savedSettings.token) {
         try {
           await initializeTelegramBot(restaurant.id); // Ensure this is awaited
           await storage.logAiActivity({
             restaurantId: restaurant.id,
             type: 'telegram_setup',
             description: `Telegram bot successfully configured and activated`,
             data: { token: savedSettings.token.substring(0, 10) + '...', enabled: savedSettings.enabled }
           });
         } catch (error: unknown) {
           console.error("Error setting up Telegram bot after saving settings:", error);
           // Decide if this should be a fatal error for the response
           // For now, we'll log it but still return success for saving settings
         }
       }
       res.json(savedSettings);
     } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: error.errors });
      }
      res.status(400).json({ message: error.message });
     }
   });

   const httpServer = createServer(app);
   return httpServer;
  }
