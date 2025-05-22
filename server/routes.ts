import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { 
  insertUserSchema, insertRestaurantSchema, 
  insertTableSchema, insertGuestSchema, 
  insertReservationSchema, insertIntegrationSettingSchema,
  timeslots
} from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcryptjs";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import MemoryStore from "memorystore";
import { setupTelegramBot } from "./services/telegram";
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
    } catch (error) {
      console.error("Registration error:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/auth/login", passport.authenticate("local"), (req, res) => {
    const user = req.user as any;
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout(() => {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
      
      const timeslots = await storage.getTimeslots(restaurant.id, date);
      res.json(timeslots);
    } catch (error) {
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
    } catch (error) {
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
      
      // Get the last date for which timeslots are available
      const lastDateResult = await db.select({
        date: timeslots.date,
      })
      .from(timeslots)
      .where(eq(timeslots.restaurantId, restaurant.id))
      .orderBy(desc(timeslots.date))
      .limit(1);
      
      const lastDate = lastDateResult[0]?.date;
      
      // Count total available timeslots
      const totalCount = await db.select({
        count: sql<number>`count(*)`,
      })
      .from(timeslots)
      .where(eq(timeslots.restaurantId, restaurant.id));
      
      // Count free timeslots
      const freeCount = await db.select({
        count: sql<number>`count(*)`,
      })
      .from(timeslots)
      .where(and(
        eq(timeslots.restaurantId, restaurant.id),
        eq(timeslots.status, 'free')
      ));
      
      res.json({
        lastDate,
        totalCount: totalCount[0]?.count || 0,
        freeCount: freeCount[0]?.count || 0,
      });
    } catch (error) {
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
      
      const guests = await storage.getGuests(restaurant.id);
      res.json(guests);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/guests", isAuthenticated, async (req, res) => {
    try {
      const validatedData = insertGuestSchema.parse(req.body);
      
      // Check if guest already exists by phone
      let guest = await storage.getGuestByPhone(validatedData.phone);
      
      if (guest) {
        // Update existing guest
        guest = await storage.updateGuest(guest.id, validatedData);
      } else {
        // Create new guest
        guest = await storage.createGuest(validatedData);
      }
      
      res.status(201).json(guest);
    } catch (error) {
      res.status(400).json({ message: error.message });
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
      
      const reservations = await storage.getReservations(restaurant.id, filters);
      res.json(reservations);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/reservations", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const restaurant = await storage.getRestaurantByUserId(user.id);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }
      
      // Validate reservation data
      const validatedData = insertReservationSchema.parse({
        ...req.body,
        restaurantId: restaurant.id,
      });
      
      // Ensure guest exists
      let guest = await storage.getGuest(validatedData.guestId);
      
      if (!guest && req.body.guestPhone) {
        // Try to find by phone
        guest = await storage.getGuestByPhone(req.body.guestPhone);
        
        if (!guest && req.body.guestName) {
          // Create a new guest
          guest = await storage.createGuest({
            name: req.body.guestName,
            phone: req.body.guestPhone,
            email: req.body.guestEmail,
          });
        }
      }
      
      if (!guest) {
        return res.status(400).json({ message: "Guest not found or could not be created" });
      }
      
      // Update the guest ID
      validatedData.guestId = guest.id;
      
      // Create the reservation
      const reservation = await storage.createReservation(validatedData);
      
      // Log AI activity if source is an AI channel
      if (['telegram', 'web_chat', 'facebook'].includes(validatedData.source)) {
        await storage.logAiActivity({
          restaurantId: restaurant.id,
          type: 'reservation_create',
          description: `Created new reservation for ${guest.name} (${validatedData.guests} guests) via ${validatedData.source}`,
          data: {
            reservationId: reservation.id,
            guestId: guest.id,
            source: validatedData.source,
          }
        });
      }
      
      res.status(201).json(reservation);
    } catch (error) {
      res.status(400).json({ message: error.message });
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
      const reservation = await storage.getReservation(reservationId);
      
      if (!reservation || reservation.restaurantId !== restaurant.id) {
        return res.status(404).json({ message: "Reservation not found" });
      }
      
      const validatedData = insertReservationSchema.partial().parse(req.body);
      const updatedReservation = await storage.updateReservation(reservationId, validatedData);
      
      // Log AI activity if status was updated to confirmed/canceled
      if (validatedData.status && ['confirmed', 'canceled'].includes(validatedData.status)) {
        const guest = await storage.getGuest(reservation.guestId);
        await storage.logAiActivity({
          restaurantId: restaurant.id,
          type: `reservation_${validatedData.status}`,
          description: `Reservation for ${guest?.name || 'Guest'} was ${validatedData.status}`,
          data: {
            reservationId: reservation.id,
            guestId: reservation.guestId,
            previousStatus: reservation.status,
          }
        });
      }
      
      res.json(updatedReservation);
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
        return res.json({ enabled: false });
      }
      
      res.json(settings);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Test Telegram Bot Integration
  app.get("/api/integrations/telegram/test", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const restaurant = await storage.getRestaurantByUserId(user.id);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }
      
      // Get Telegram bot settings
      const settings = await storage.getIntegrationSettings(restaurant.id, 'telegram');
      
      if (!settings || !settings.enabled || !settings.token) {
        return res.status(400).json({ message: "Telegram bot is not configured or enabled" });
      }
      
      // Test the connection by trying to get the bot information
      try {
        const bot = await setupTelegramBot(settings.token, restaurant.id);
        const botInfo = await bot.getMe();
        
        // Log the successful test
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
      const validatedData = insertIntegrationSettingSchema.parse({
        ...req.body,
        restaurantId: restaurant.id,
        type,
      });
      
      const settings = await storage.saveIntegrationSettings(validatedData);
      
      // If telegram integration is enabled, setup the bot
      if (type === 'telegram' && settings.enabled && settings.token) {
        try {
          await setupTelegramBot(settings.token, restaurant.id);
        } catch (error) {
          console.error("Error setting up Telegram bot:", error);
          return res.status(400).json({ message: "Error setting up Telegram bot: " + error.message });
        }
      }
      
      res.json(settings);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
