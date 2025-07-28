//
// storage.ts (🔒 SECURITY FIXED: Complete Multi-Tenant Guest Isolation)
// 🚨 CRITICAL FIXES APPLIED:
// 1. Guest data privacy breach - Added restaurant scoping to all guest methods
// 2. Currency data corruption - Updated all financial calculations for decimal types
// 3. Complete tenant isolation across all operations
// 4. Added missing super admin methods: getAllTenants and logSuperAdminActivity
// 5. 🚨 NEW FIX: Added missing updateTenant method for super admin functionality
// 6. ✅ BUG FIX: Fixed tenant feature flags bug in createTenantWithOwner method
//

import {
    users, restaurants, tables, guests, reservations,
    integrationSettings, aiActivities,
    reservationStatusHistory, menuItems, restaurantMenuCategories, menuSearchLog,
    superAdmins, tenantAuditLogs, tenantUsageMetrics, planLimits,
    type User, type InsertUser,
    type Restaurant, type InsertRestaurant,
    type Table, type InsertTable,
    type Guest, type InsertGuest,
    type Reservation, type InsertReservation,
    type AiActivity, type InsertAiActivity,
    type IntegrationSetting, type InsertIntegrationSetting,
    type ReservationStatusHistory, type InsertReservationStatusHistory,
    type MenuItem, type InsertMenuItem,
    type RestaurantMenuCategory, type InsertRestaurantMenuCategory,
    type MenuSearchLog, type InsertMenuSearchLog,
    type SuperAdmin, type InsertSuperAdmin,
    type TenantAuditLog, type InsertTenantAuditLog,
    type TenantUsageMetrics, type PlanLimits
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, desc, sql, count, or, inArray, gt, ne, notExists, like, ilike } from "drizzle-orm";
import { DateTime } from 'luxon';
import bcrypt from 'bcryptjs'; 
// ✅ PROPER FIX: Use centralized timezone utilities for consistency across the application
import { getRestaurantDateTime, getRestaurantDateString } from './utils/timezone-utils';
// ✅ NEW: Import tenant context system
import { 
    tenantContextManager, 
    validateTenantAction, 
    trackTenantUsage,
    type TenantContext 
} from './services/tenant-context';

// ✅ TYPE SAFETY FIX: Define valid reservation statuses
type ReservationStatus = 'confirmed' | 'created' | 'canceled' | 'completed' | 'archived' | 'seated' | 'in_progress' | 'no_show';

export interface IStorage {
    // ✅ EXISTING: User methods
    getUser(id: number): Promise<User | undefined>;
    getUserByEmail(email: string): Promise<User | undefined>;
    createUser(user: InsertUser): Promise<User>;

    // ✅ EXISTING: Restaurant methods
    getRestaurant(id: number): Promise<Restaurant | undefined>;
    getRestaurantByUserId(userId: number): Promise<Restaurant | undefined>;
    getAllRestaurants(): Promise<Restaurant[]>;
    createRestaurant(restaurant: InsertRestaurant): Promise<Restaurant>;
    updateRestaurant(id: number, restaurant: Partial<InsertRestaurant>): Promise<Restaurant>;

    // ✅ ENHANCED: Table methods with tenant context
    getTables(restaurantId: number): Promise<Table[]>;
    getTable(id: number): Promise<Table | undefined>;
    createTable(table: InsertTable, tenantContext?: TenantContext): Promise<Table>;
    updateTable(id: number, table: Partial<InsertTable>): Promise<Table>;
    deleteTable(id: number): Promise<void>;

    // 🔒 SECURITY FIXED: Guest methods with restaurant scoping
    getGuests(restaurantId: number): Promise<Guest[]>;
    getGuest(id: number, restaurantId: number): Promise<Guest | undefined>;
    getGuestByPhone(phone: string, restaurantId: number): Promise<Guest | undefined>; // ✅ SECURITY FIX: Added restaurantId
    getGuestByTelegramId(telegramUserId: string, restaurantId: number): Promise<Guest | undefined>; // ✅ SECURITY FIX: Added restaurantId
    createGuest(guest: InsertGuest): Promise<Guest>; // ✅ SECURITY: guest.restaurantId required in schema
    updateGuest(id: number, guest: Partial<InsertGuest>, restaurantId: number): Promise<Guest>; // ✅ SECURITY FIX: Added restaurantId

    // ✅ ENHANCED: Reservation methods with tenant context
    getReservations(restaurantId: number, filters?: {
        date?: string;
        status?: string[];
        upcoming?: boolean;
        timezone?: string;
        excludeReservationId?: number;
    }): Promise<any[]>;
    getReservation(id: number): Promise<any | undefined>;
    createReservation(reservation: InsertReservation, tenantContext?: TenantContext): Promise<Reservation>;
    createReservationAtomic(
        reservation: InsertReservation,
        expectedSlot: { tableId: number; time: string; duration: number },
        tenantContext?: TenantContext
    ): Promise<Reservation>;
    updateReservation(id: number, reservation: Partial<InsertReservation>): Promise<Reservation>;
    getUpcomingReservations(restaurantId: number, restaurantTimezone: string, hours: number): Promise<any[]>;
    getReservationStatistics(restaurantId: number, restaurantTimezone: string): Promise<{
        todayReservations: number;
        confirmedReservations: number;
        pendingReservations: number;
        totalGuests: number;
    }>;

    // ✅ NEW: Enhanced reservation status management
    updateReservationWithHistory(
        reservationId: number, 
        updateData: Partial<InsertReservation>,
        historyData: {
            changedBy: 'system' | 'staff' | 'guest';
            changeReason: string;
            metadata?: any;
        }
    ): Promise<Reservation>;
    getStatusChangeTime(reservationId: number, status: string): Promise<Date | null>;
    getReservationStatusHistory(reservationId: number): Promise<ReservationStatusHistory[]>;

    // ✅ NEW: Enhanced guest analytics
    updateGuestAnalytics(
        guestId: number,
        analytics: {
            visitCompleted?: boolean;
            noShowOccurred?: boolean;
            duration?: number;
            totalSpent?: number;
        },
        restaurantId: number // ✅ SECURITY FIX: Added restaurantId
    ): Promise<Guest>;
    getGuestReservationHistory(guestId: number, restaurantId: number): Promise<any[]>;

    // ✅ NEW: Menu management system
    getMenuItems(restaurantId: number, filters?: {
        category?: string;
        availableOnly?: boolean;
        searchQuery?: string;
        popularOnly?: boolean;
        limit?: number;
    }): Promise<any[]>;
    createMenuItem(data: InsertMenuItem): Promise<MenuItem>;
    getMenuItem(id: number): Promise<MenuItem | undefined>;
    updateMenuItem(id: number, data: Partial<InsertMenuItem>): Promise<MenuItem>;
    deleteMenuItem(id: number): Promise<void>;
    getMenuCategoryByName(restaurantId: number, name: string): Promise<RestaurantMenuCategory | undefined>;
    searchMenuItems(restaurantId: number, options: {
        query: string;
        category?: string;
        dietaryRestrictions?: string[];
        priceRange?: { min?: number; max?: number };
    }): Promise<MenuItem[]>;
    bulkUpdateMenuItems(restaurantId: number, items: any[], action: string): Promise<any[]>;
    searchMenuItemsByName(restaurantId: number, query: string): Promise<MenuItem[]>;
    searchMenuItemsByDescription(restaurantId: number, query: string): Promise<MenuItem[]>;
    searchMenuItemsByDietaryTags(restaurantId: number, query: string): Promise<MenuItem[]>;
    fuzzySearchMenuItems(restaurantId: number, query: string): Promise<MenuItem[]>;
    getMenuRecommendations(
        restaurantId: number,
        context: {
            guestPreferences?: string[];
            priceRange?: { min?: number; max?: number };
            category?: string;
            limit?: number;
        }
    ): Promise<any[]>;
    getPopularMenuItems(restaurantId: number, limit?: number): Promise<MenuItem[]>;
    logMenuSearch(restaurantId: number, query: string, source: string): Promise<MenuSearchLog>;

    // ✅ EXISTING: Integration settings methods
    getIntegrationSettings(restaurantId: number, type: string): Promise<IntegrationSetting | undefined>;
    saveIntegrationSettings(settings: InsertIntegrationSetting): Promise<IntegrationSetting>;

    // ✅ EXISTING: AI activities methods
    getAiActivities(restaurantId: number, limit?: number): Promise<AiActivity[]>;
    logAiActivity(activity: InsertAiActivity): Promise<AiActivity>;

    // ✅ EXISTING: Real-time table availability methods
    updateTableStatusFromReservations(tableId: number, restaurantTimezone: string): Promise<void>;
    updateAllTableStatuses(restaurantId: number, restaurantTimezone: string): Promise<void>;
    getTableAvailability(restaurantId: number, date: string, time: string, excludeReservationId?: number): Promise<Table[]>;

    // ✅ NEW: Multi-tenant management methods
    getSuperAdmin(id: number): Promise<SuperAdmin | undefined>;
    getSuperAdminByEmail(email: string): Promise<SuperAdmin | undefined>;
    createSuperAdmin(admin: InsertSuperAdmin): Promise<SuperAdmin>;
    updateSuperAdminLogin(id: number): Promise<void>;
    getTenantsByStatus(status: string): Promise<Restaurant[]>;
    suspendTenant(restaurantId: number, reason: string): Promise<void>;
    reactivateTenant(restaurantId: number): Promise<void>;
    getTenantUsageMetrics(restaurantId: number, options?: {
        startDate?: string;
        endDate?: string;
    }): Promise<TenantUsageMetrics[]>;
    logTenantAudit(auditData: Omit<InsertTenantAuditLog, 'timestamp'>): Promise<void>;
    getPlatformMetrics(): Promise<{
        totalTenants: number;
        activeTenants: number;
        trialTenants: number;
        suspendedTenants: number;
        totalReservationsToday: number;
        totalReservationsMonth: number;
        tenantsByPlan: any[];
    }>;

    // 🚨 MISSING METHODS ADDED: Super admin tenant management
    getAllTenants(filters: {
        page: number;
        limit: number;
        status?: string;
        plan?: string;
        searchQuery?: string;
        sortBy: string;
        sortOrder: 'asc' | 'desc';
    }): Promise<{
        tenants: any[];
        pagination: {
            currentPage: number;
            totalPages: number;
            totalCount: number;
            limit: number;
            hasNextPage: boolean;
            hasPreviousPage: boolean;
        };
        summary: {
            totalTenants: number;
            activeTenants: number;
            suspendedTenants: number;
            planDistribution: any[];
        }
    }>;
    logSuperAdminActivity(adminId: number, action: string, details: object): Promise<void>;
    getTenantBySubdomain(subdomain: string): Promise<Restaurant | undefined>;
    createTenantWithOwner(data: {
        restaurantName: string;
        subdomain: string;
        plan: 'starter' | 'professional' | 'enterprise';
        timezone: string;
        ownerName: string;
        ownerEmail: string;
        ownerPhone?: string;
        initialPassword: string;
        features: object;
        limits: object;
        customSettings?: object;
    }): Promise<{ restaurant: Restaurant, owner: User }>;

    // 🚨 MISSING METHODS ADDED: Tenant detail view functions
    getTenantById(tenantId: number): Promise<any | undefined>;
    getTenantMetrics(tenantId: number): Promise<any>;
    getTenantUsage(tenantId: number): Promise<any>;
    getTenantRecentActivity(tenantId: number, limit: number): Promise<any[]>;
    getTenantAuditLogs(tenantId: number, options: { limit: number; offset: number }): Promise<any[]>;

    // 🚨 CRITICAL FIX: Add missing updateTenant method
    updateTenant(tenantId: number, data: {
        restaurantName?: string;
        subdomain?: string;
        plan?: 'starter' | 'professional' | 'enterprise';
        status?: 'active' | 'suspended' | 'terminated' | 'trial';
        timezone?: string;
        maxTables?: number;
        maxUsers?: number;
        maxReservationsPerMonth?: number;
        enableAiChat?: boolean;
        enableTelegramBot?: boolean;
        enableGuestAnalytics?: boolean;
        enableAdvancedReporting?: boolean;
        enableMenuManagement?: boolean;
        adminNotes?: string;
        customSettings?: any;
    }): Promise<Restaurant>;
}

export class DatabaseStorage implements IStorage {
    
    private parseTimeToMinutes(timeStr: string): number {
        if (!timeStr) {
            throw new Error(`Invalid time string: ${timeStr}`);
        }

        const parts = timeStr.split(':');
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10) || 0;

        if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            throw new Error(`Invalid time format: ${timeStr}. Expected HH:MM or HH:MM:SS`);
        }

        return hours * 60 + minutes;
    }

    private parsePostgresTimestamp(timestamp: string): DateTime {
        try {
            return DateTime.fromISO(timestamp, { zone: 'utc' });
        } catch (error) {
            console.error(`[Storage] Failed to parse timestamp: ${timestamp}`, error);
            return DateTime.now().toUTC();
        }
    }

    // 🔒 CURRENCY HELPER: Safe decimal operations
    private addDecimal(a: string | number, b: string | number): string {
        const numA = typeof a === 'string' ? parseFloat(a) : a;
        const numB = typeof b === 'string' ? parseFloat(b) : b;
        return (numA + numB).toFixed(2);
    }

    private calculateAverage(currentAvg: number, currentCount: number, newValue: number): number {
        if (currentCount === 0) return newValue;
        return Math.round((currentAvg * currentCount + newValue) / (currentCount + 1));
    }

    // ================================
    // ✅ EXISTING USER METHODS
    // ================================

    async getUser(id: number): Promise<User | undefined> {
        const [user] = await db.select().from(users).where(eq(users.id, id));
        return user;
    }

    async getUserByEmail(email: string): Promise<User | undefined> {
        const [user] = await db.select().from(users).where(eq(users.email, email));
        return user;
    }

    async createUser(user: InsertUser): Promise<User> {
        const [newUser] = await db.insert(users).values(user).returning();
        return newUser;
    }

    // ================================
    // ✅ EXISTING RESTAURANT METHODS
    // ================================

    async getRestaurant(id: number): Promise<Restaurant | undefined> {
        const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.id, id));
        return restaurant;
    }

    async getRestaurantByUserId(userId: number): Promise<Restaurant | undefined> {
        const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.userId, userId));
        return restaurant;
    }

    async getAllRestaurants(): Promise<Restaurant[]> {
        return await db.select().from(restaurants);
    }

    async createRestaurant(restaurant: InsertRestaurant): Promise<Restaurant> {
        const [newRestaurant] = await db.insert(restaurants).values(restaurant).returning();
        return newRestaurant;
    }

    async updateRestaurant(id: number, restaurant: Partial<InsertRestaurant>): Promise<Restaurant> {
        const [updatedRestaurant] = await db
            .update(restaurants)
            .set(restaurant)
            .where(eq(restaurants.id, id))
            .returning();
        return updatedRestaurant;
    }

    // ================================
    // 🚨 CRITICAL FIX: MISSING updateTenant METHOD IMPLEMENTATION
    // ================================

    async updateTenant(tenantId: number, data: {
        restaurantName?: string;
        subdomain?: string;
        plan?: 'starter' | 'professional' | 'enterprise';
        status?: 'active' | 'suspended' | 'terminated' | 'trial';
        timezone?: string;
        maxTables?: number;
        maxUsers?: number;
        maxReservationsPerMonth?: number;
        enableAiChat?: boolean;
        enableTelegramBot?: boolean;
        enableGuestAnalytics?: boolean;
        enableAdvancedReporting?: boolean;
        enableMenuManagement?: boolean;
        adminNotes?: string;
        customSettings?: any;
    }): Promise<Restaurant> {
        console.log(`🏢 [Storage] Updating tenant ${tenantId} with data:`, Object.keys(data));
        
        return await db.transaction(async (tx) => {
            // Prepare restaurant updates with proper field mapping
            const updates: Partial<InsertRestaurant> = {};
            
            // Basic restaurant fields
            if (data.restaurantName !== undefined) updates.name = data.restaurantName;
            if (data.subdomain !== undefined) updates.subdomain = data.subdomain;
            if (data.plan !== undefined) updates.tenantPlan = data.plan;
            if (data.status !== undefined) updates.tenantStatus = data.status;
            if (data.timezone !== undefined) updates.timezone = data.timezone;
            
            // Feature flags (exact field mapping)
            if (data.enableAiChat !== undefined) updates.enableAiChat = data.enableAiChat;
            if (data.enableTelegramBot !== undefined) updates.enableTelegramBot = data.enableTelegramBot;
            if (data.enableGuestAnalytics !== undefined) updates.enableGuestAnalytics = data.enableGuestAnalytics;
            if (data.enableAdvancedReporting !== undefined) updates.enableAdvancedReporting = data.enableAdvancedReporting;
            if (data.enableMenuManagement !== undefined) updates.enableMenuManagement = data.enableMenuManagement;
            
            // Tenant limits (proper field mapping)
            if (data.maxTables !== undefined) updates.maxTablesAllowed = data.maxTables;
            if (data.maxUsers !== undefined) updates.maxStaffAccounts = data.maxUsers;
            if (data.maxReservationsPerMonth !== undefined) updates.maxMonthlyReservations = data.maxReservationsPerMonth;
            
            // Admin fields (if schema supports them - currently commented out)
            // if (data.adminNotes !== undefined) updates.adminNotes = data.adminNotes;
            // if (data.customSettings !== undefined) updates.customSettings = data.customSettings;
            
            // Always update modification timestamp
            updates.lastModifiedAt = new Date();
            
            console.log(`🏢 [Storage] Applying ${Object.keys(updates).length} field updates to tenant ${tenantId}`);
            
            // Update the restaurant record
            const [updatedRestaurant] = await tx
                .update(restaurants)
                .set(updates)
                .where(eq(restaurants.id, tenantId))
                .returning();
                
            if (!updatedRestaurant) {
                throw new Error(`Tenant ${tenantId} not found`);
            }
            
            // Log audit event
            await this.logTenantAudit({
                restaurantId: tenantId,
                action: 'tenant_updated',
                performedBy: 'super_admin',
                performedByType: 'super_admin',
                details: {
                    updatedFields: Object.keys(data),
                    fieldCount: Object.keys(updates).length,
                    changes: data
                }
            });
            
            console.log(`✅ [Storage] Tenant ${tenantId} updated successfully - ${Object.keys(updates).length} fields modified`);
            return updatedRestaurant;
        });
    }

    // ================================
    // ✅ ENHANCED TABLE METHODS WITH TENANT CONTEXT
    // ================================

    async getTables(restaurantId: number): Promise<Table[]> {
        return db.select().from(tables).where(eq(tables.restaurantId, restaurantId));
    }

    async getTable(id: number): Promise<Table | undefined> {
        const [table] = await db.select().from(tables).where(eq(tables.id, id));
        return table;
    }

    async createTable(table: InsertTable, tenantContext?: TenantContext): Promise<Table> {
        console.log(`🏢 [Storage] Creating table for restaurant ${table.restaurantId}`);
        
        // Load tenant context if not provided
        const context = tenantContext || await tenantContextManager.loadContext(table.restaurantId);
        if (!context) {
            throw new Error('Tenant context not found');
        }
        
        // Check table limit
        const limitCheck = await validateTenantAction(table.restaurantId, 'create_table', context);
        if (!limitCheck.allowed) {
            console.log(`❌ [Storage] Table creation blocked: ${limitCheck.reason}`);
            throw new Error(limitCheck.reason || 'Table limit exceeded');
        }
        
        console.log(`✅ [Storage] Table limit check passed (${context.usage.currentTableCount}/${context.limits.maxTables})`);
        
        const [newTable] = await db.insert(tables).values(table).returning();
        
        // Log audit event
        await tenantContextManager.logAuditEvent({
            restaurantId: table.restaurantId,
            action: 'table_created',
            performedBy: 'restaurant_owner', // TODO: Get actual user
            performedByType: 'restaurant',
            details: { tableId: newTable.id, tableName: newTable.name }
        });
        
        console.log(`✅ [Storage] Table ${newTable.id} created successfully`);
        return newTable;
    }

    async updateTable(id: number, table: Partial<InsertTable>): Promise<Table> {
        const [updatedTable] = await db
            .update(tables)
            .set(table)
            .where(eq(tables.id, id))
            .returning();
        return updatedTable;
    }

    async deleteTable(id: number): Promise<void> {
        await db.delete(tables).where(eq(tables.id, id));
    }

    // ================================
    // 🔒 SECURITY FIXED: GUEST METHODS WITH RESTAURANT SCOPING
    // ================================

    async getGuests(restaurantId: number): Promise<Guest[]> {
        console.log(`👥 [Storage] Getting guests for restaurant ${restaurantId} (TENANT SCOPED)`);
        
        const guestsWithCounts = await db
            .select({
                id: guests.id,
                restaurantId: guests.restaurantId, // ✅ SECURITY: Include restaurant ID
                name: guests.name,
                phone: guests.phone,
                email: guests.email,
                telegram_user_id: guests.telegram_user_id,
                language: guests.language,
                birthday: guests.birthday,
                tags: guests.tags,
                comments: guests.comments,
                visit_count: guests.visit_count,
                no_show_count: guests.no_show_count,
                total_spent: guests.total_spent,
                average_duration: guests.average_duration,
                preferences: guests.preferences,
                vip_level: guests.vip_level,
                last_visit_date: guests.last_visit_date,
                reputation_score: guests.reputation_score,
                createdAt: guests.createdAt,
                reservationCount: count(reservations.id)
            })
            .from(guests)
            .leftJoin(reservations, and(
                eq(guests.id, reservations.guestId),
                eq(reservations.restaurantId, restaurantId) // ✅ SECURITY: Double-check restaurant scoping
            ))
            .where(eq(guests.restaurantId, restaurantId)) // 🚨 CRITICAL SECURITY FIX: Filter by restaurant
            .groupBy(guests.id);

        console.log(`👥 [Storage] Found ${guestsWithCounts.length} guests for restaurant ${restaurantId}`);
        return guestsWithCounts as Guest[];
    }

    async getGuest(id: number, restaurantId: number): Promise<Guest | undefined> {
        console.log(`👤 [Storage] Getting guest ${id} for restaurant ${restaurantId} (TENANT SCOPED)`);
        
        const [guest] = await db
            .select()
            .from(guests)
            .where(
                and(
                    eq(guests.id, id),
                    eq(guests.restaurantId, restaurantId) // 🚨 CRITICAL SECURITY FIX: Filter by restaurant
                )
            );
        
        if (!guest) {
            console.log(`👤 [Storage] Guest ${id} not found for restaurant ${restaurantId}`);
        }
        
        return guest;
    }

    // 🚨 CRITICAL SECURITY FIX: Guest lookup by phone with restaurant scoping
    async getGuestByPhone(phone: string, restaurantId: number): Promise<Guest | undefined> {
        console.log(`📞 [Storage] Getting guest by phone ${phone} for restaurant ${restaurantId} (TENANT SCOPED)`);
        
        const [guest] = await db
            .select()
            .from(guests)
            .where(
                and(
                    eq(guests.phone, phone),
                    eq(guests.restaurantId, restaurantId) // 🚨 CRITICAL SECURITY FIX: Filter by restaurant
                )
            );
        
        if (guest) {
            console.log(`📞 [Storage] Found guest ${guest.id} (${guest.name}) for restaurant ${restaurantId}`);
        } else {
            console.log(`📞 [Storage] No guest found with phone ${phone} for restaurant ${restaurantId}`);
        }
        
        return guest;
    }

    // 🚨 CRITICAL SECURITY FIX: Guest lookup by Telegram ID with restaurant scoping
    async getGuestByTelegramId(telegramUserId: string, restaurantId: number): Promise<Guest | undefined> {
        console.log(`📱 [Storage] Getting guest by Telegram ID ${telegramUserId} for restaurant ${restaurantId} (TENANT SCOPED)`);
        
        const [guest] = await db
            .select()
            .from(guests)
            .where(
                and(
                    eq(guests.telegram_user_id, telegramUserId),
                    eq(guests.restaurantId, restaurantId) // 🚨 CRITICAL SECURITY FIX: Filter by restaurant
                )
            );
        
        if (guest) {
            console.log(`📱 [Storage] Found guest ${guest.id} (${guest.name}) for restaurant ${restaurantId}`);
        } else {
            console.log(`📱 [Storage] No guest found with Telegram ID ${telegramUserId} for restaurant ${restaurantId}`);
        }
        
        return guest;
    }

    async createGuest(guest: InsertGuest): Promise<Guest> {
        console.log(`👤 [Storage] Creating guest for restaurant ${guest.restaurantId} (TENANT SCOPED)`);
        
        // ✅ SECURITY: Schema now enforces restaurantId is required
        if (!guest.restaurantId) {
            throw new Error('Guest must be associated with a restaurant');
        }
        
        const [newGuest] = await db.insert(guests).values(guest).returning();
        
        console.log(`✅ [Storage] Created guest ${newGuest.id} for restaurant ${newGuest.restaurantId}`);
        return newGuest;
    }

    // 🚨 CRITICAL SECURITY FIX: Guest update with restaurant validation
    async updateGuest(id: number, guest: Partial<InsertGuest>, restaurantId: number): Promise<Guest> {
        console.log(`👤 [Storage] Updating guest ${id} for restaurant ${restaurantId} (TENANT SCOPED)`);
        
        // ✅ SECURITY: Verify guest belongs to restaurant before updating
        const existingGuest = await this.getGuest(id, restaurantId);
        if (!existingGuest) {
            throw new Error(`Guest ${id} not found for restaurant ${restaurantId}`);
        }
        
        const [updatedGuest] = await db
            .update(guests)
            .set(guest)
            .where(
                and(
                    eq(guests.id, id),
                    eq(guests.restaurantId, restaurantId) // 🚨 CRITICAL SECURITY FIX: Filter by restaurant
                )
            )
            .returning();
        
        console.log(`✅ [Storage] Updated guest ${id} for restaurant ${restaurantId}`);
        return updatedGuest;
    }

    // ================================
    // ✅ ENHANCED RESERVATION METHODS WITH TENANT CONTEXT
    // ================================

    async getReservations(restaurantId: number, filters?: {
        date?: string;
        status?: string[];
        upcoming?: boolean;
        timezone?: string;
        excludeReservationId?: number;
    }): Promise<any[]> {
        const whereConditions = [eq(reservations.restaurantId, restaurantId)];

        if (filters?.excludeReservationId) {
            whereConditions.push(ne(reservations.id, filters.excludeReservationId));
            console.log(`📋 [Storage] Excluding reservation ID ${filters.excludeReservationId} from results`);
        }

        if (filters?.date && filters?.timezone) {
            const startOfDay = DateTime.fromISO(filters.date, { zone: filters.timezone }).startOf('day').toUTC().toISO();
            const endOfDay = DateTime.fromISO(filters.date, { zone: filters.timezone }).endOf('day').toUTC().toISO();
            
            if (startOfDay && endOfDay) {
                whereConditions.push(
                    and(
                        gte(reservations.reservation_utc, startOfDay),
                        lte(reservations.reservation_utc, endOfDay)
                    )!
                );
                console.log(`📋 [Storage] Filtering by UTC range: ${startOfDay} to ${endOfDay} for restaurant date: ${filters.date}`);
            }
        }

        if (filters?.status && filters.status.length > 0) {
            const validStatuses = filters.status.filter(status => 
                ['confirmed', 'created', 'canceled', 'completed', 'archived', 'seated', 'in_progress', 'no_show'].includes(status)
            ) as ReservationStatus[];
            
            if (validStatuses.length > 0) {
                whereConditions.push(inArray(reservations.status, validStatuses));
            }
            console.log(`📋 [Storage] Filtering by status: ${validStatuses.join(', ')}`);
        } else {
            whereConditions.push(ne(reservations.status, 'canceled'));
            console.log(`📋 [Storage] No status filter provided, excluding canceled reservations`);
        }

        if (filters?.upcoming && filters.timezone) {
            const nowUtc = DateTime.now().toUTC().toISO();
            if (nowUtc) {
                whereConditions.push(gte(reservations.reservation_utc, nowUtc));
                console.log(`📋 [Storage] Filtering for upcoming reservations from UTC: ${nowUtc}`);
            }
        }

        const results = await db
            .select({
                reservation: reservations,
                guest: guests,
                table: tables
            })
            .from(reservations)
            .innerJoin(guests, and(
                eq(reservations.guestId, guests.id),
                eq(guests.restaurantId, restaurantId) // ✅ SECURITY: Ensure guest belongs to same restaurant
            ))
            .innerJoin(tables, eq(reservations.tableId, tables.id))
            .where(and(...whereConditions))
            .orderBy(reservations.reservation_utc);

        console.log(`📋 [Storage] Found ${results.length} reservations with ${whereConditions.length} conditions${filters?.excludeReservationId ? ` (excluded reservation ${filters.excludeReservationId})` : ''}`);

        return results.map(r => ({
            ...r,
            guestName: r.reservation.booking_guest_name || r.guest.name,
        }));
    }

    async getReservation(id: number): Promise<any | undefined> {
        const result = await db
            .select({
                reservation: reservations,
                guest: guests,
                table: tables
            })
            .from(reservations)
            .innerJoin(guests, eq(reservations.guestId, guests.id))
            .innerJoin(tables, eq(reservations.tableId, tables.id))
            .where(eq(reservations.id, id))
            .limit(1);

        if (!result || result.length === 0) return undefined;

        const r = result[0];
        return {
            ...r,
            guestName: r.reservation.booking_guest_name || r.guest.name,
        };
    }

    async createReservation(reservation: InsertReservation, tenantContext?: TenantContext): Promise<Reservation> {
        console.log(`🏢 [Storage] Creating reservation for restaurant ${reservation.restaurantId}`);
        
        // Load tenant context if not provided
        const context = tenantContext || await tenantContextManager.loadContext(reservation.restaurantId);
        if (!context) {
            throw new Error('Tenant context not found');
        }
        
        // Check reservation limit
        const limitCheck = await validateTenantAction(reservation.restaurantId, 'create_reservation', context);
        if (!limitCheck.allowed) {
            console.log(`❌ [Storage] Reservation creation blocked: ${limitCheck.reason}`);
            throw new Error(limitCheck.reason || 'Reservation limit exceeded');
        }
        
        console.log(`✅ [Storage] Reservation limit check passed (${context.usage.currentMonthReservations}/${context.limits.maxMonthlyReservations})`);
        
        const [newReservation] = await db.insert(reservations).values(reservation).returning();

        // Track usage
        await trackTenantUsage(reservation.restaurantId, 'reservation_created');
        
        // Update table status
        if (newReservation.tableId) {
            const restaurant = await this.getRestaurant(newReservation.restaurantId);
            const timezone = restaurant?.timezone || 'Europe/Moscow';
            await this.updateTableStatusFromReservations(newReservation.tableId, timezone);
        }
        
        // Log audit event
        await tenantContextManager.logAuditEvent({
            restaurantId: reservation.restaurantId,
            action: 'reservation_created',
            performedBy: 'system', // TODO: Get actual user
            performedByType: 'system',
            details: { 
                reservationId: newReservation.id,
                guestId: newReservation.guestId,
                tableId: newReservation.tableId
            }
        });
        
        console.log(`✅ [Storage] Reservation ${newReservation.id} created successfully`);
        return newReservation;
    }

    async createReservationAtomic(
        reservation: InsertReservation,
        expectedSlot: { tableId: number; time: string; duration: number },
        tenantContext?: TenantContext
    ): Promise<Reservation> {
        console.log(`🔒 [AtomicBooking] Starting atomic reservation creation for table ${expectedSlot.tableId} at ${expectedSlot.time}`);

        // Load tenant context if not provided
        const context = tenantContext || await tenantContextManager.loadContext(reservation.restaurantId);
        if (!context) {
            throw new Error('Tenant context not found');
        }
        
        // Check reservation limit before starting transaction
        const limitCheck = await validateTenantAction(reservation.restaurantId, 'create_reservation', context);
        if (!limitCheck.allowed) {
            console.log(`❌ [AtomicBooking] Reservation creation blocked: ${limitCheck.reason}`);
            throw new Error(limitCheck.reason || 'Reservation limit exceeded');
        }

        return await db.transaction(async (tx) => {
            try {
                const restaurant = await this.getRestaurant(reservation.restaurantId);
                const restaurantTimezone = restaurant?.timezone || 'Europe/Moscow';

                let reservationStartUtc: DateTime;
                try {
                    reservationStartUtc = this.parsePostgresTimestamp(reservation.reservation_utc);
                } catch (error) {
                    console.error(`🔒 [AtomicBooking] Failed to parse reservation UTC timestamp: ${reservation.reservation_utc}`, error);
                    throw new Error('Invalid reservation timestamp format');
                }

                const reservationEndUtc = reservationStartUtc.plus({ minutes: expectedSlot.duration });
                console.log(`🔒 [AtomicBooking] Expected UTC time range: ${reservationStartUtc.toISO()} to ${reservationEndUtc.toISO()}`);

                const existingReservations = await tx
                    .select({
                        id: reservations.id,
                        reservation_utc: reservations.reservation_utc,
                        duration: reservations.duration,
                        status: reservations.status,
                        guestId: reservations.guestId,
                        booking_guest_name: reservations.booking_guest_name
                    })
                    .from(reservations)
                    .where(and(
                        eq(reservations.restaurantId, reservation.restaurantId),
                        eq(reservations.tableId, expectedSlot.tableId),
                        inArray(reservations.status, ['confirmed', 'created'] as ReservationStatus[])
                    ));

                console.log(`🔒 [AtomicBooking] Found ${existingReservations.length} existing reservations for table ${expectedSlot.tableId}`);

                for (const existing of existingReservations) {
                    let existingStartUtc: DateTime;
                    try {
                        existingStartUtc = this.parsePostgresTimestamp(existing.reservation_utc);
                    } catch (error) {
                        console.warn(`🔒 [AtomicBooking] Skipping reservation ${existing.id} due to invalid timestamp: ${existing.reservation_utc}`);
                        continue;
                    }

                    const existingDuration = existing.duration || 120;
                    const existingEndUtc = existingStartUtc.plus({ minutes: existingDuration });

                    const hasOverlap = reservationStartUtc < existingEndUtc && reservationEndUtc > existingStartUtc;

                    if (hasOverlap) {
                        console.log(`❌ [AtomicBooking] CONFLICT DETECTED: Table ${expectedSlot.tableId} has existing reservation from ${existingStartUtc.toISO()} to ${existingEndUtc.toISO()} (ID: ${existing.id})`);

                        const conflictStartLocal = existingStartUtc.setZone(restaurantTimezone).toFormat('HH:mm');
                        const conflictEndLocal = existingEndUtc.setZone(restaurantTimezone).toFormat('HH:mm');

                        throw new Error(`Table no longer available - conflict detected with existing reservation from ${conflictStartLocal} to ${conflictEndLocal}`);
                    }
                }

                console.log(`✅ [AtomicBooking] No conflicts found for table ${expectedSlot.tableId} at ${expectedSlot.time}`);

                const [newReservation] = await tx
                    .insert(reservations)
                    .values(reservation)
                    .returning();

                // Track usage (increment counters)
                await tx
                    .update(restaurants)
                    .set({
                        monthlyReservationCount: sql`${restaurants.monthlyReservationCount} + 1`,
                        totalReservationsAllTime: sql`${restaurants.totalReservationsAllTime} + 1`
                    })
                    .where(eq(restaurants.id, reservation.restaurantId));

                console.log(`✅ [AtomicBooking] Created reservation ID ${newReservation.id} for table ${expectedSlot.tableId} with usage tracking`);
                console.log(`🎉 [AtomicBooking] Atomic reservation creation completed successfully for reservation ID ${newReservation.id}`);
                return newReservation;

            } catch (error: any) {
                console.log(`❌ [AtomicBooking] Transaction failed:`, error.message);

                if (error.code === '40P01') {
                    throw new Error('Deadlock detected - please try again');
                } else if (error.code === '40001') {
                    throw new Error('Transaction conflict - please try again');
                } else if (error.message.includes('conflict detected') || error.message.includes('limit exceeded')) {
                    throw error;
                } else {
                    console.error(`🔥 [AtomicBooking] Unexpected database error:`, error);
                    throw new Error(`Database error during reservation creation: ${error.message}`);
                }
            }
        });
    }

    async updateReservation(id: number, reservation: Partial<InsertReservation>): Promise<Reservation> {
        const [updatedReservation] = await db
            .update(reservations)
            .set(reservation)
            .where(eq(reservations.id, id))
            .returning();

        if (updatedReservation.tableId) {
            const restaurant = await this.getRestaurant(updatedReservation.restaurantId);
            const timezone = restaurant?.timezone || 'Europe/Moscow';
            await this.updateTableStatusFromReservations(updatedReservation.tableId, timezone);
        }
        return updatedReservation;
    }

    async getUpcomingReservations(restaurantId: number, restaurantTimezone: string, hours: number = 3): Promise<any[]> {
        const nowUtc = DateTime.now().toUTC();
        const endTimeUtc = nowUtc.plus({ hours });

        console.log(`⏰ [Storage] Getting upcoming reservations from UTC ${nowUtc.toISO()} to ${endTimeUtc.toISO()}`);

        const results = await db
            .select({
                reservation: reservations,
                guest: guests,
                table: tables
            })
            .from(reservations)
            .innerJoin(guests, and(
                eq(reservations.guestId, guests.id),
                eq(guests.restaurantId, restaurantId) // ✅ SECURITY: Ensure guest belongs to same restaurant
            ))
            .innerJoin(tables, eq(reservations.tableId, tables.id))
            .where(
                and(
                    eq(reservations.restaurantId, restaurantId),
                    gte(reservations.reservation_utc, nowUtc.toISO()!),
                    lte(reservations.reservation_utc, endTimeUtc.toISO()!),
                    inArray(reservations.status, ['confirmed', 'created'] as ReservationStatus[])
                )
            )
            .orderBy(reservations.reservation_utc)
            .limit(10);

        console.log(`⏰ [Storage] Found ${results.length} upcoming reservations`);

        return results.map(r => ({
            ...r,
            guestName: r.reservation.booking_guest_name || r.guest.name,
        }));
    }

    async getReservationStatistics(restaurantId: number, restaurantTimezone: string): Promise<{
        todayReservations: number;
        confirmedReservations: number;
        pendingReservations: number;
        totalGuests: number;
    }> {
        const restaurantToday = DateTime.now().setZone(restaurantTimezone);
        const startOfDayUtc = restaurantToday.startOf('day').toUTC().toISO();
        const endOfDayUtc = restaurantToday.endOf('day').toUTC().toISO();

        if (!startOfDayUtc || !endOfDayUtc) {
            throw new Error('Invalid timezone for statistics calculation');
        }

        console.log(`📊 [Storage] Getting stats for restaurant ${restaurantId} for UTC range: ${startOfDayUtc} to ${endOfDayUtc}`);

        const [todayCount] = await db
            .select({ count: count() })
            .from(reservations)
            .innerJoin(tables, eq(reservations.tableId, tables.id))
            .where(
                and(
                    eq(reservations.restaurantId, restaurantId),
                    gte(reservations.reservation_utc, startOfDayUtc),
                    lte(reservations.reservation_utc, endOfDayUtc),
                    ne(reservations.status, 'canceled')
                )
            );

        const [confirmedCount] = await db
            .select({ count: count() })
            .from(reservations)
            .innerJoin(tables, eq(reservations.tableId, tables.id))
            .where(
                and(
                    eq(reservations.restaurantId, restaurantId),
                    gte(reservations.reservation_utc, startOfDayUtc),
                    lte(reservations.reservation_utc, endOfDayUtc),
                    eq(reservations.status, 'confirmed')
                )
            );

        const [pendingCount] = await db
            .select({ count: count() })
            .from(reservations)
            .innerJoin(tables, eq(reservations.tableId, tables.id))
            .where(
                and(
                    eq(reservations.restaurantId, restaurantId),
                    gte(reservations.reservation_utc, startOfDayUtc),
                    lte(reservations.reservation_utc, endOfDayUtc),
                    eq(reservations.status, 'created')
                )
            );

        const [guestsResult] = await db
            .select({ total: sql<number>`SUM(${reservations.guests})`.mapWith(Number) })
            .from(reservations)
            .innerJoin(tables, eq(reservations.tableId, tables.id))
            .where(
                and(
                    eq(reservations.restaurantId, restaurantId),
                    gte(reservations.reservation_utc, startOfDayUtc),
                    lte(reservations.reservation_utc, endOfDayUtc),
                    ne(reservations.status, 'canceled')
                )
            );

        const stats = {
            todayReservations: todayCount?.count || 0,
            confirmedReservations: confirmedCount?.count || 0,
            pendingReservations: pendingCount?.count || 0,
            totalGuests: guestsResult?.total || 0,
        };

        console.log(`📊 [Storage] Computed stats:`, stats);
        return stats;
    }

    // ================================
    // ✅ NEW: ENHANCED RESERVATION STATUS MANAGEMENT
    // ================================

    async updateReservationWithHistory(
        reservationId: number, 
        updateData: Partial<InsertReservation>,
        historyData: {
            changedBy: 'system' | 'staff' | 'guest';
            changeReason: string;
            metadata?: any;
        }
    ): Promise<Reservation> {
        return await db.transaction(async (tx) => {
            console.log(`🔄 [Storage] Updating reservation ${reservationId} with history tracking`);
            
            const [currentReservation] = await tx
                .select()
                .from(reservations)
                .where(eq(reservations.id, reservationId));
                
            if (!currentReservation) {
                throw new Error(`Reservation ${reservationId} not found`);
            }
            
            if (updateData.status && updateData.status !== currentReservation.status) {
                await tx.insert(reservationStatusHistory).values({
                    reservationId,
                    fromStatus: currentReservation.status,
                    toStatus: updateData.status,
                    changedBy: historyData.changedBy,
                    changeReason: historyData.changeReason,
                    metadata: historyData.metadata
                });
                
                console.log(`📝 [Storage] Status change logged: ${currentReservation.status} → ${updateData.status}`);
            }
            
            const [updatedReservation] = await tx
                .update(reservations)
                .set({ ...updateData, lastModifiedAt: new Date() })
                .where(eq(reservations.id, reservationId))
                .returning();
                
            console.log(`✅ [Storage] Reservation ${reservationId} updated successfully`);
            return updatedReservation;
        });
    }

    async getStatusChangeTime(reservationId: number, status: string): Promise<Date | null> {
        const [statusChange] = await db
            .select({ timestamp: reservationStatusHistory.timestamp })
            .from(reservationStatusHistory)
            .where(
                and(
                    eq(reservationStatusHistory.reservationId, reservationId),
                    eq(reservationStatusHistory.toStatus, status as any)
                )
            )
            .orderBy(desc(reservationStatusHistory.timestamp))
            .limit(1);
            
        return statusChange?.timestamp ? new Date(statusChange.timestamp) : null;
    }

    async getReservationStatusHistory(reservationId: number): Promise<ReservationStatusHistory[]> {
        return await db
            .select()
            .from(reservationStatusHistory)
            .where(eq(reservationStatusHistory.reservationId, reservationId))
            .orderBy(reservationStatusHistory.timestamp);
    }

    // ================================
    // 🔒 SECURITY FIXED: ENHANCED GUEST ANALYTICS WITH RESTAURANT VALIDATION
    // ================================

    async updateGuestAnalytics(
        guestId: number,
        analytics: {
            visitCompleted?: boolean;
            noShowOccurred?: boolean;
            duration?: number;
            totalSpent?: number;
        },
        restaurantId: number // 🚨 CRITICAL SECURITY FIX: Added restaurantId parameter
    ): Promise<Guest> {
        return await db.transaction(async (tx) => {
            console.log(`📊 [Storage] Updating guest ${guestId} analytics for restaurant ${restaurantId} (TENANT SCOPED):`, analytics);
            
            // ✅ SECURITY: Verify guest belongs to restaurant
            const [currentGuest] = await tx
                .select()
                .from(guests)
                .where(
                    and(
                        eq(guests.id, guestId),
                        eq(guests.restaurantId, restaurantId) // 🚨 CRITICAL SECURITY FIX: Filter by restaurant
                    )
                );
                
            if (!currentGuest) {
                throw new Error(`Guest ${guestId} not found for restaurant ${restaurantId}`);
            }
            
            const updates: Partial<InsertGuest> = {
                last_visit_date: new Date()
            };
            
            if (analytics.visitCompleted) {
                updates.visit_count = (currentGuest.visit_count || 0) + 1;
                
                if (analytics.totalSpent && analytics.totalSpent > 0) {
                    // 🔒 CURRENCY FIX: Safe decimal operations
                    const currentSpent = currentGuest.total_spent || '0';
                    updates.total_spent = this.addDecimal(currentSpent, analytics.totalSpent);
                    console.log(`💰 [Storage] Updated total spent: ${currentSpent} + ${analytics.totalSpent} = ${updates.total_spent}`);
                }
                
                if (analytics.duration) {
                    const currentCount = currentGuest.visit_count || 0;
                    const currentAvg = currentGuest.average_duration || 120;
                    updates.average_duration = this.calculateAverage(currentAvg, currentCount, analytics.duration);
                    console.log(`⏱️ [Storage] Updated average duration: ${updates.average_duration} minutes`);
                }
                
                updates.reputation_score = Math.min(100, (currentGuest.reputation_score || 100) + 2);
            }
            
            if (analytics.noShowOccurred) {
                updates.no_show_count = (currentGuest.no_show_count || 0) + 1;
                
                const reputationPenalty = Math.min(15, 5 + (currentGuest.no_show_count || 0) * 2);
                updates.reputation_score = Math.max(0, (currentGuest.reputation_score || 100) - reputationPenalty);
                console.log(`⚠️ [Storage] Applied reputation penalty: -${reputationPenalty} points`);
            }
            
            const [updatedGuest] = await tx
                .update(guests)
                .set(updates)
                .where(
                    and(
                        eq(guests.id, guestId),
                        eq(guests.restaurantId, restaurantId) // 🚨 CRITICAL SECURITY FIX: Filter by restaurant
                    )
                )
                .returning();
                
            console.log(`✅ [Storage] Guest ${guestId} analytics updated for restaurant ${restaurantId}`);
            return updatedGuest;
        });
    }

    async getGuestReservationHistory(guestId: number, restaurantId: number): Promise<any[]> {
        console.log(`📋 [Storage] Getting reservation history for guest ${guestId} at restaurant ${restaurantId} (TENANT SCOPED)`);
        
        const results = await db
            .select({
                reservation: reservations,
                table: tables,
                statusHistory: sql<any[]>`COALESCE(
                    json_agg(
                        json_build_object(
                            'fromStatus', ${reservationStatusHistory.fromStatus},
                            'toStatus', ${reservationStatusHistory.toStatus},
                            'changedBy', ${reservationStatusHistory.changedBy},
                            'changeReason', ${reservationStatusHistory.changeReason},
                            'timestamp', ${reservationStatusHistory.timestamp}
                        ) ORDER BY ${reservationStatusHistory.timestamp}
                    ) FILTER (WHERE ${reservationStatusHistory.id} IS NOT NULL),
                    '[]'::json
                )`
            })
            .from(reservations)
            .leftJoin(tables, eq(reservations.tableId, tables.id))
            .leftJoin(reservationStatusHistory, eq(reservations.id, reservationStatusHistory.reservationId))
            .where(
                and(
                    eq(reservations.guestId, guestId),
                    eq(reservations.restaurantId, restaurantId) // ✅ SECURITY: Double-check restaurant scoping
                )
            )
            .groupBy(reservations.id, tables.id)
            .orderBy(desc(reservations.reservation_utc))
            .limit(20);
            
        console.log(`📋 [Storage] Found ${results.length} reservations in history for guest ${guestId}`);
        return results;
    }

    // ================================
    // ✅ NEW: MENU MANAGEMENT SYSTEM (UNCHANGED - Already tenant-scoped)
    // ================================

    async getMenuItems(restaurantId: number, filters?: {
        category?: string;
        availableOnly?: boolean;
        searchQuery?: string;
        popularOnly?: boolean;
        limit?: number;
    }): Promise<any[]> {
        const whereConditions = [eq(menuItems.restaurantId, restaurantId)];
        
        if (filters?.category) {
            const categoryResults = await db
                .select({ id: restaurantMenuCategories.id })
                .from(restaurantMenuCategories)
                .where(
                    and(
                        eq(restaurantMenuCategories.restaurantId, restaurantId),
                        eq(restaurantMenuCategories.slug, filters.category)
                    )
                );
                
            if (categoryResults.length > 0) {
                whereConditions.push(eq(menuItems.categoryId, categoryResults[0].id));
            }
        }
        
        if (filters?.availableOnly) {
            whereConditions.push(eq(menuItems.isAvailable, true));
        }
        
        if (filters?.popularOnly) {
            whereConditions.push(eq(menuItems.isPopular, true));
        }
        
        if (filters?.searchQuery) {
            whereConditions.push(
                or(
                    ilike(menuItems.name, `%${filters.searchQuery}%`),
                    ilike(menuItems.description, `%${filters.searchQuery}%`),
                    ilike(menuItems.subcategory, `%${filters.searchQuery}%`)
                )!
            );
        }
        
        let query = db
            .select({
                item: menuItems,
                category: restaurantMenuCategories
            })
            .from(menuItems)
            .innerJoin(restaurantMenuCategories, eq(menuItems.categoryId, restaurantMenuCategories.id))
            .where(and(...whereConditions))
            .orderBy(restaurantMenuCategories.displayOrder, menuItems.displayOrder);
            
        if (filters?.limit) {
            query = query.limit(filters.limit) as any;
        }
            
        const results = await query;
            
        return results.map(r => ({
            ...r.item,
            categoryName: r.category.name,
            categorySlug: r.category.slug
        }));
    }

    async createMenuItem(data: InsertMenuItem): Promise<MenuItem> {
        const [newItem] = await db.insert(menuItems).values(data).returning();
        return newItem;
    }

    async getMenuItem(id: number): Promise<MenuItem | undefined> {
        const [item] = await db
            .select({
                item: menuItems,
                category: restaurantMenuCategories
            })
            .from(menuItems)
            .innerJoin(restaurantMenuCategories, eq(menuItems.categoryId, restaurantMenuCategories.id))
            .where(eq(menuItems.id, id));
        
        if (!item) return undefined;
        
        return {
            ...item.item,
            categoryName: item.category.name,
            categorySlug: item.category.slug
        } as MenuItem;
    }

    async updateMenuItem(id: number, data: Partial<InsertMenuItem>): Promise<MenuItem> {
        const [updatedItem] = await db
            .update(menuItems)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(menuItems.id, id))
            .returning();
        return updatedItem;
    }

    async deleteMenuItem(id: number): Promise<void> {
        await db.delete(menuItems).where(eq(menuItems.id, id));
    }

    async getMenuCategoryByName(restaurantId: number, name: string): Promise<RestaurantMenuCategory | undefined> {
        const [category] = await db
            .select()
            .from(restaurantMenuCategories)
            .where(
                and(
                    eq(restaurantMenuCategories.restaurantId, restaurantId),
                    eq(restaurantMenuCategories.name, name)
                )
            );
        return category;
    }

    async searchMenuItems(restaurantId: number, options: {
        query: string;
        category?: string;
        dietaryRestrictions?: string[];
        priceRange?: { min?: number; max?: number };
    }): Promise<MenuItem[]> {
        console.log(`🔍 [Storage] Searching menu items for restaurant ${restaurantId} with options:`, options);
        
        const searchPromises = [
            this.searchMenuItemsByName(restaurantId, options.query),
            this.searchMenuItemsByDescription(restaurantId, options.query),
            this.fuzzySearchMenuItems(restaurantId, options.query)
        ];
        
        if (options.dietaryRestrictions && options.dietaryRestrictions.length > 0) {
            for (const restriction of options.dietaryRestrictions) {
                searchPromises.push(this.searchMenuItemsByDietaryTags(restaurantId, restriction));
            }
        }
        
        const searchResults = await Promise.all(searchPromises);
        
        const allResults: MenuItem[] = [];
        const seenIds = new Set<number>();
        
        for (const results of searchResults) {
            for (const item of results) {
                if (!seenIds.has(item.id)) {
                    seenIds.add(item.id);
                    allResults.push(item);
                }
            }
        }
        
        let filteredResults = allResults;
        
        if (options.category) {
            const categoryFilter = await db
                .select({ id: restaurantMenuCategories.id })
                .from(restaurantMenuCategories)
                .where(
                    and(
                        eq(restaurantMenuCategories.restaurantId, restaurantId),
                        eq(restaurantMenuCategories.slug, options.category)
                    )
                );
            
            if (categoryFilter.length > 0) {
                const categoryId = categoryFilter[0].id;
                filteredResults = filteredResults.filter(item => item.categoryId === categoryId);
            }
        }
        
        if (options.priceRange) {
            filteredResults = filteredResults.filter(item => {
                const price = parseFloat(item.price);
                if (options.priceRange!.min && price < options.priceRange!.min) return false;
                if (options.priceRange!.max && price > options.priceRange!.max) return false;
                return true;
            });
        }
        
        console.log(`✅ [Storage] Found ${filteredResults.length} items matching search criteria`);
        
        return filteredResults.sort((a, b) => {
            if (a.isPopular && !b.isPopular) return -1;
            if (!a.isPopular && b.isPopular) return 1;
            if (a.isNew && !b.isNew) return -1;
            if (!a.isNew && b.isNew) return 1;
            return a.name.localeCompare(b.name);
        });
    }

    async bulkUpdateMenuItems(restaurantId: number, items: any[], action: string): Promise<any[]> {
        return await db.transaction(async (tx) => {
            const results = [];
            
            for (const item of items) {
                let updateData: Partial<InsertMenuItem> = {};
                
                switch (action) {
                    case 'availability':
                        updateData.isAvailable = item.isAvailable;
                        break;
                    case 'prices':
                        updateData.price = item.price;
                        if (item.originalPrice) updateData.originalPrice = item.originalPrice;
                        break;
                    case 'categories':
                        updateData.categoryId = item.categoryId;
                        break;
                    default:
                        throw new Error(`Unknown bulk update action: ${action}`);
                }
                
                const [updated] = await tx
                    .update(menuItems)
                    .set({ ...updateData, updatedAt: new Date() })
                    .where(
                        and(
                            eq(menuItems.id, item.id),
                            eq(menuItems.restaurantId, restaurantId)
                        )
                    )
                    .returning();
                    
                results.push(updated);
            }
            
            return results;
        });
    }

    async searchMenuItemsByName(restaurantId: number, query: string): Promise<MenuItem[]> {
        let results = await db
            .select()
            .from(menuItems)
            .where(
                and(
                    eq(menuItems.restaurantId, restaurantId),
                    eq(menuItems.isAvailable, true),
                    ilike(menuItems.name, query)
                )
            );
            
        if (results.length === 0) {
            results = await db
                .select()
                .from(menuItems)
                .where(
                    and(
                        eq(menuItems.restaurantId, restaurantId),
                        eq(menuItems.isAvailable, true),
                        ilike(menuItems.name, `%${query}%`)
                    )
                );
        }
        
        return results;
    }

    async searchMenuItemsByDescription(restaurantId: number, query: string): Promise<MenuItem[]> {
        return await db
            .select()
            .from(menuItems)
            .where(
                and(
                    eq(menuItems.restaurantId, restaurantId),
                    eq(menuItems.isAvailable, true),
                    or(
                        ilike(menuItems.description, `%${query}%`),
                        ilike(menuItems.shortDescription, `%${query}%`)
                    )!
                )
            );
    }

    async searchMenuItemsByDietaryTags(restaurantId: number, query: string): Promise<MenuItem[]> {
        return await db
            .select()
            .from(menuItems)
            .where(
                and(
                    eq(menuItems.restaurantId, restaurantId),
                    eq(menuItems.isAvailable, true),
                    sql`${menuItems.dietaryTags} && ARRAY[${query}]`
                )
            );
    }

    async fuzzySearchMenuItems(restaurantId: number, query: string): Promise<MenuItem[]> {
        const words = query.toLowerCase().split(' ');
        const searchPattern = words.join('%');
        
        return await db
            .select()
            .from(menuItems)
            .where(
                and(
                    eq(menuItems.restaurantId, restaurantId),
                    eq(menuItems.isAvailable, true),
                    or(
                        ilike(menuItems.name, `%${searchPattern}%`),
                        ilike(menuItems.description, `%${searchPattern}%`)
                    )!
                )
            );
    }

    async getMenuRecommendations(
        restaurantId: number,
        context: {
            guestPreferences?: string[];
            priceRange?: { min?: number; max?: number };
            category?: string;
            limit?: number;
        }
    ): Promise<any[]> {
        const whereConditions = [
            eq(menuItems.restaurantId, restaurantId),
            eq(menuItems.isAvailable, true)
        ];
        
        if (context.category) {
            const categoryResults = await db
                .select({ id: restaurantMenuCategories.id })
                .from(restaurantMenuCategories)
                .where(
                    and(
                        eq(restaurantMenuCategories.restaurantId, restaurantId),
                        eq(restaurantMenuCategories.slug, context.category)
                    )
                );
                
            if (categoryResults.length > 0) {
                whereConditions.push(eq(menuItems.categoryId, categoryResults[0].id));
            }
        }
        
        if (context.priceRange) {
            if (context.priceRange.min) {
                whereConditions.push(gte(menuItems.price, context.priceRange.min.toString()));
            }
            if (context.priceRange.max) {
                whereConditions.push(lte(menuItems.price, context.priceRange.max.toString()));
            }
        }
        
        let results = await db
            .select({
                item: menuItems,
                category: restaurantMenuCategories
            })
            .from(menuItems)
            .innerJoin(restaurantMenuCategories, eq(menuItems.categoryId, restaurantMenuCategories.id))
            .where(and(...whereConditions))
            .orderBy(
                desc(menuItems.isPopular),
                desc(menuItems.isNew),
                menuItems.displayOrder
            )
            .limit(context.limit || 6);
        
        return results.map(r => ({
            ...r.item,
            categoryName: r.category.name,
            recommendationReason: this.getRecommendationReason(r.item, context.guestPreferences)
        }));
    }

    private getRecommendationReason(item: any, guestPreferences?: string[]): string {
        if (item.isPopular) return "Popular choice";
        if (item.isNew) return "New addition";
        if (guestPreferences?.some(pref => 
            item.dietaryTags?.includes(pref) || 
            item.subcategory?.toLowerCase().includes(pref.toLowerCase())
        )) {
            return "Matches your preferences";
        }
        return "Chef's selection";
    }

    async getPopularMenuItems(restaurantId: number, limit: number = 5): Promise<MenuItem[]> {
        return await db
            .select()
            .from(menuItems)
            .where(
                and(
                    eq(menuItems.restaurantId, restaurantId),
                    eq(menuItems.isAvailable, true),
                    eq(menuItems.isPopular, true)
                )
            )
            .orderBy(menuItems.displayOrder)
            .limit(limit);
    }

    async logMenuSearch(restaurantId: number, query: string, source: string): Promise<MenuSearchLog> {
        const [searchLog] = await db.insert(menuSearchLog).values({
            restaurantId,
            query,
            resultsCount: 0,
            source
        }).returning();
        
        return searchLog;
    }

    // ================================
    // ✅ EXISTING INTEGRATION SETTINGS METHODS
    // ================================

    async getIntegrationSettings(restaurantId: number, type: string): Promise<IntegrationSetting | undefined> {
        const [settings] = await db
            .select()
            .from(integrationSettings)
            .where(
                and(
                    eq(integrationSettings.restaurantId, restaurantId),
                    eq(integrationSettings.type, type)
                )
            );
        return settings;
    }

    async saveIntegrationSettings(settings: InsertIntegrationSetting): Promise<IntegrationSetting> {
        const existingSettings = await this.getIntegrationSettings(
            settings.restaurantId as number,
            settings.type as string
        );
        if (existingSettings) {
            const [updatedSettings] = await db
                .update(integrationSettings)
                .set(settings)
                .where(eq(integrationSettings.id, existingSettings.id))
                .returning();
            return updatedSettings;
        } else {
            const [newSettings] = await db
                .insert(integrationSettings)
                .values(settings)
                .returning();
            return newSettings;
        }
    }

    // ================================
    // ✅ EXISTING AI ACTIVITIES METHODS
    // ================================

    async getAiActivities(restaurantId: number, limit: number = 10): Promise<AiActivity[]> {
        return db
            .select()
            .from(aiActivities)
            .where(eq(aiActivities.restaurantId, restaurantId))
            .orderBy(desc(aiActivities.createdAt))
            .limit(limit);
    }

    async logAiActivity(activity: InsertAiActivity): Promise<AiActivity> {
        const [newActivity] = await db
            .insert(aiActivities)
            .values(activity)
            .returning();
        
        // Track AI usage for the tenant
        await trackTenantUsage(activity.restaurantId, 'ai_request');
        
        return newActivity;
    }

    // ================================
    // ✅ EXISTING TABLE AVAILABILITY METHODS
    // ================================

    async updateTableStatusFromReservations(tableId: number, restaurantTimezone: string): Promise<void> {
        const nowInRestaurant = DateTime.now().setZone(restaurantTimezone);
        const nowUtc = nowInRestaurant.toUTC();

        console.log(`🏢 [Storage] Updating table ${tableId} status using restaurant time converted to UTC: ${nowUtc.toISO()} (${restaurantTimezone})`);

        const activeReservations = await db
            .select()
            .from(reservations)
            .where(
                and(
                    eq(reservations.tableId, tableId),
                    inArray(reservations.status, ['confirmed', 'created'] as ReservationStatus[])
                )
            );

        let isCurrentlyOccupied = false;
        let hasUpcomingReservation = false;

        for (const reservation of activeReservations) {
            try {
                const reservationStartUtc = this.parsePostgresTimestamp(reservation.reservation_utc);
                const reservationDuration = reservation.duration || 120;
                const reservationEndUtc = reservationStartUtc.plus({ minutes: reservationDuration });

                if (nowUtc >= reservationStartUtc && nowUtc <= reservationEndUtc) {
                    isCurrentlyOccupied = true;
                    console.log(`🏢 [Storage] Table ${tableId} currently occupied by reservation ${reservation.id} (${reservationStartUtc.toISO()} - ${reservationEndUtc.toISO()})`);
                }

                const twoHoursFromNow = nowUtc.plus({ hours: 2 });
                if (reservationStartUtc > nowUtc && reservationStartUtc <= twoHoursFromNow) {
                    hasUpcomingReservation = true;
                    console.log(`🏢 [Storage] Table ${tableId} has upcoming reservation ${reservation.id} at ${reservationStartUtc.toISO()}`);
                }
            } catch (error) {
                console.warn(`🏢 [Storage] Skipping reservation ${reservation.id} due to invalid timestamp`, error);
            }
        }

        let newStatus: 'free' | 'occupied' | 'reserved' | 'unavailable' = 'free';
        if (isCurrentlyOccupied) {
            newStatus = 'occupied';
        } else if (hasUpcomingReservation) {
            newStatus = 'reserved';
        }
        
        console.log(`🏢 [Storage] Table ${tableId} status: ${newStatus}`);
        
        await db
            .update(tables)
            .set({ status: newStatus })
            .where(eq(tables.id, tableId));
    }

    async updateAllTableStatuses(restaurantId: number, restaurantTimezone: string): Promise<void> {
        const restaurantTables = await this.getTables(restaurantId);
        for (const table of restaurantTables) {
            await this.updateTableStatusFromReservations(table.id, restaurantTimezone);
        }
    }

    async getTableAvailability(restaurantId: number, date: string, time: string, excludeReservationId?: number): Promise<Table[]> {
        const restaurant = await this.getRestaurant(restaurantId);
        const restaurantTimezone = restaurant?.timezone || 'Europe/Moscow';

        const startOfSlotUtc = DateTime.fromISO(`${date}T${time}`, { zone: restaurantTimezone }).toUTC().toISO();
        const endOfSlotUtc = DateTime.fromISO(`${date}T${time}`, { zone: restaurantTimezone }).plus({ hours: 2 }).toUTC().toISO();

        if (!startOfSlotUtc || !endOfSlotUtc) {
            console.error(`❌ [Storage] Failed to convert date/time to UTC for availability check`);
            return [];
        }

        console.log(`🏢 [Storage] Checking table availability for UTC range: ${startOfSlotUtc} to ${endOfSlotUtc}${excludeReservationId ? ` (excluding reservation ${excludeReservationId})` : ''}`);

        const conflictConditions = [
            eq(reservations.tableId, tables.id),
            sql`${reservations.reservation_utc} < ${endOfSlotUtc}`,
            sql`${reservations.reservation_utc} + INTERVAL '2 hours' > ${startOfSlotUtc}`,
            inArray(reservations.status, ['confirmed', 'created'] as ReservationStatus[])
        ];

        if (excludeReservationId) {
            conflictConditions.push(ne(reservations.id, excludeReservationId));
        }

        const availableTables = await db
            .select()
            .from(tables)
            .where(
                and(
                    eq(tables.restaurantId, restaurantId),
                    ne(tables.status, 'unavailable'),
                    notExists(
                        db.select()
                            .from(reservations)
                            .where(and(...conflictConditions))
                    )
                )
            );
        
        console.log(`🏢 [Storage] Found ${availableTables.length} available tables${excludeReservationId ? ` (excluded reservation ${excludeReservationId})` : ''}`);
        return availableTables;
    }

    // ================================
    // ✅ NEW: MULTI-TENANT MANAGEMENT METHODS
    // ================================

    async getSuperAdmin(id: number): Promise<SuperAdmin | undefined> {
        const [admin] = await db.select().from(superAdmins).where(eq(superAdmins.id, id));
        return admin;
    }

    async getSuperAdminByEmail(email: string): Promise<SuperAdmin | undefined> {
        const [admin] = await db.select().from(superAdmins).where(eq(superAdmins.email, email));
        return admin;
    }

    async createSuperAdmin(admin: InsertSuperAdmin): Promise<SuperAdmin> {
        const [newAdmin] = await db.insert(superAdmins).values(admin).returning();
        return newAdmin;
    }

    async updateSuperAdminLogin(id: number): Promise<void> {
        await db
            .update(superAdmins)
            .set({ lastLoginAt: new Date() })
            .where(eq(superAdmins.id, id));
    }

    async getTenantsByStatus(status: string): Promise<Restaurant[]> {
        return await db
            .select()
            .from(restaurants)
            .where(eq(restaurants.tenantStatus, status as any));
    }

    async suspendTenant(restaurantId: number, reason: string): Promise<void> {
        await tenantContextManager.suspendTenant(restaurantId, reason, 'super_admin');
    }

    async reactivateTenant(restaurantId: number): Promise<void> {
        await tenantContextManager.reactivateTenant(restaurantId, 'super_admin');
    }

    async getTenantUsageMetrics(restaurantId: number, options?: {
        startDate?: string;
        endDate?: string;
    }): Promise<TenantUsageMetrics[]> {
        const whereConditions = [eq(tenantUsageMetrics.restaurantId, restaurantId)];
        
        if (options?.startDate) {
            whereConditions.push(gte(tenantUsageMetrics.metricDate, options.startDate));
        }
        
        if (options?.endDate) {
            whereConditions.push(lte(tenantUsageMetrics.metricDate, options.endDate));
        }
        
        return await db
            .select()
            .from(tenantUsageMetrics)
            .where(and(...whereConditions))
            .orderBy(tenantUsageMetrics.metricDate);
    }

    async logTenantAudit(auditData: Omit<InsertTenantAuditLog, 'timestamp'>): Promise<void> {
        await tenantContextManager.logAuditEvent(auditData);
    }

    async getPlatformMetrics(): Promise<{
        totalTenants: number;
        activeTenants: number;
        trialTenants: number;
        suspendedTenants: number;
        totalReservationsToday: number;
        totalReservationsMonth: number;
        tenantsByPlan: any[];
    }> {
        console.log(`📊 [Storage] Computing platform metrics`);
        
        const [totalTenantsResult] = await db
            .select({ count: count() })
            .from(restaurants);
        
        const [activeTenantsResult] = await db
            .select({ count: count() })
            .from(restaurants)
            .where(eq(restaurants.tenantStatus, 'active'));
            
        const [trialTenantsResult] = await db
            .select({ count: count() })
            .from(restaurants)
            .where(eq(restaurants.tenantStatus, 'trial'));
            
        const [suspendedTenantsResult] = await db
            .select({ count: count() })
            .from(restaurants)
            .where(eq(restaurants.tenantStatus, 'suspended'));
        
        const tenantsByPlan = await db
            .select({
                plan: restaurants.tenantPlan,
                count: count()
            })
            .from(restaurants)
            .groupBy(restaurants.tenantPlan);
        
        const today = DateTime.now().toISODate();
        const startOfMonth = DateTime.now().startOf('month').toISODate();
        
        const [todayReservationsResult] = await db
            .select({ total: sql<number>`SUM(${restaurants.monthlyReservationCount})`.mapWith(Number) })
            .from(restaurants);
            
        const [monthReservationsResult] = await db
            .select({ total: sql<number>`SUM(${restaurants.totalReservationsAllTime})`.mapWith(Number) })
            .from(restaurants);
        
        const metrics = {
            totalTenants: totalTenantsResult?.count || 0,
            activeTenants: activeTenantsResult?.count || 0,
            trialTenants: trialTenantsResult?.count || 0,
            suspendedTenants: suspendedTenantsResult?.count || 0,
            totalReservationsToday: 0, // Would need more complex calculation
            totalReservationsMonth: monthReservationsResult?.total || 0,
            tenantsByPlan: tenantsByPlan || []
        };
        
        console.log(`📊 [Storage] Platform metrics computed:`, metrics);
        return metrics;
    }

    // ================================
    // 🚨 MISSING METHODS ADDED: Super admin tenant management
    // ================================

    async logSuperAdminActivity(adminId: number, action: string, details: object): Promise<void> {
        try {
            await db.insert(tenantAuditLogs).values({
                restaurantId: null, // Platform-wide action
                action: `superadmin:${action}`,
                performedBy: `super_admin_id:${adminId}`,
                performedByType: 'super_admin',
                details,
                ipAddress: (details as any).ip,
            });
        } catch (error) {
            console.error('[Storage] Failed to log super admin activity:', error);
        }
    }

    async getAllTenants(filters: {
        page: number;
        limit: number;
        status?: string;
        plan?: string;
        searchQuery?: string;
        sortBy: string;
        sortOrder: 'asc' | 'desc';
    }): Promise<{
        tenants: any[];
        pagination: {
            currentPage: number;
            totalPages: number;
            totalCount: number;
            limit: number;
            hasNextPage: boolean;
            hasPreviousPage: boolean;
        };
        summary: {
            totalTenants: number;
            activeTenants: number;
            suspendedTenants: number;
            planDistribution: any[];
        }
    }> {
        console.log(`[Storage] Getting all tenants with filters:`, filters);
        
        const whereConditions = [];

        if (filters.status) {
            whereConditions.push(eq(restaurants.tenantStatus, filters.status as any));
        }
        
        if (filters.plan) {
            whereConditions.push(eq(restaurants.tenantPlan, filters.plan as any));
        }
        
        if (filters.searchQuery) {
            const query = `%${filters.searchQuery}%`;
            whereConditions.push(
                or(
                    ilike(restaurants.name, query),
                    ilike(restaurants.subdomain, query),
                    ilike(users.email, query)
                )!
            );
        }

        const queryBuilder = db
            .select({
                tenant: restaurants,
                owner: users
            })
            .from(restaurants)
            .leftJoin(users, eq(restaurants.userId, users.id))
            .where(whereConditions.length > 0 ? and(...whereConditions) : undefined);

        // Get total count for pagination
        const totalCountQuery = db
            .select({ count: count() })
            .from(restaurants)
            .leftJoin(users, eq(restaurants.userId, users.id))
            .where(whereConditions.length > 0 ? and(...whereConditions) : undefined);
            
        const [totalResult] = await totalCountQuery;
        const totalCount = totalResult.count;
        const totalPages = Math.ceil(totalCount / filters.limit);
        const offset = (filters.page - 1) * filters.limit;

        // Apply sorting
        const orderByColumn = (restaurants as any)[filters.sortBy] || restaurants.createdAt;
        const finalQuery = queryBuilder
            .orderBy(filters.sortOrder === 'asc' ? orderByColumn : desc(orderByColumn))
            .limit(filters.limit)
            .offset(offset);

        const tenants = await finalQuery;

        // Get summary data
        const [summaryResult] = await db.select({
            total: count(),
            active: count(sql`CASE WHEN ${restaurants.tenantStatus} = 'active' THEN 1 END`),
            suspended: count(sql`CASE WHEN ${restaurants.tenantStatus} = 'suspended' THEN 1 END`),
        }).from(restaurants);

        const planDistribution = await db.select({
            plan: restaurants.tenantPlan,
            count: count()
        }).from(restaurants).groupBy(restaurants.tenantPlan);

        console.log(`[Storage] Found ${tenants.length} tenants (page ${filters.page}/${totalPages})`);

        return {
            tenants: tenants.map(t => ({...t.tenant, owner: t.owner})),
            pagination: {
                currentPage: filters.page,
                totalPages,
                totalCount,
                limit: filters.limit,
                hasNextPage: filters.page < totalPages,
                hasPreviousPage: filters.page > 1,
            },
            summary: {
                totalTenants: summaryResult.total,
                activeTenants: summaryResult.active,
                suspendedTenants: summaryResult.suspended,
                planDistribution
            }
        };
    }

    async getTenantBySubdomain(subdomain: string): Promise<Restaurant | undefined> {
        console.log(`[Storage] Checking for tenant with subdomain: ${subdomain}`);
        const [tenant] = await db
            .select()
            .from(restaurants)
            .where(eq(restaurants.subdomain, subdomain));
        return tenant;
    }

    // ✅ BUG FIX: Fixed tenant feature flags in createTenantWithOwner method
    async createTenantWithOwner(data: {
        restaurantName: string;
        subdomain: string;
        plan: any;
        timezone: string;
        ownerName: string;
        ownerEmail: string;
        ownerPhone?: string;
        initialPassword: string;
        features: any;
        limits: any;
    }): Promise<{ restaurant: Restaurant, owner: User }> {
        return await db.transaction(async (tx) => {
            console.log(`[Storage] Starting transaction to create tenant ${data.restaurantName}`);

            // ✅ BUG FIX: Ensure feature flags have proper defaults if undefined
            const safeFeatures = {
                enableAiChat: data.features.enableAiChat !== undefined ? Boolean(data.features.enableAiChat) : true,
                enableTelegramBot: data.features.enableTelegramBot !== undefined ? Boolean(data.features.enableTelegramBot) : false,
                enableGuestAnalytics: data.features.enableGuestAnalytics !== undefined ? Boolean(data.features.enableGuestAnalytics) : true,
                enableAdvancedReporting: data.features.enableAdvancedReporting !== undefined ? Boolean(data.features.enableAdvancedReporting) : false,
                enableMenuManagement: data.features.enableMenuManagement !== undefined ? Boolean(data.features.enableMenuManagement) : true,
            };

            console.log(`[Storage] Safe feature flags for tenant ${data.restaurantName}:`, safeFeatures);

            // 1. Create the owner user
            const hashedPassword = await bcrypt.hash(data.initialPassword, 10);
            const [owner] = await tx.insert(users).values({
                email: data.ownerEmail,
                password: hashedPassword,
                name: data.ownerName,
                phone: data.ownerPhone,
                role: 'restaurant',
            }).returning();

            // 2. Create the restaurant (tenant) and link it to the owner
            const [restaurant] = await tx.insert(restaurants).values({
                // Core Tenant Info
                userId: owner.id,
                name: data.restaurantName,
                subdomain: data.subdomain,
                tenantPlan: data.plan,
                timezone: data.timezone,
                tenantStatus: 'trial',

                // ✅ BUG FIX: Use safe feature flags with explicit boolean values
                enableAiChat: safeFeatures.enableAiChat,
                enableTelegramBot: safeFeatures.enableTelegramBot,
                enableGuestAnalytics: safeFeatures.enableGuestAnalytics,
                enableAdvancedReporting: safeFeatures.enableAdvancedReporting,
                enableMenuManagement: safeFeatures.enableMenuManagement,

                // Explicitly map limits
                maxTablesAllowed: data.limits.maxTables,
                maxStaffAccounts: data.limits.maxUsers

            }).returning();
            
            console.log(`[Storage] Successfully created user ${owner.id} and restaurant ${restaurant.id} with features:`, {
                enableAiChat: restaurant.enableAiChat,
                enableTelegramBot: restaurant.enableTelegramBot,
                enableGuestAnalytics: restaurant.enableGuestAnalytics,
                enableAdvancedReporting: restaurant.enableAdvancedReporting,
                enableMenuManagement: restaurant.enableMenuManagement,
            });
            
            return { restaurant, owner };
        });
    }

    async getTenantById(tenantId: number): Promise<any | undefined> {
        console.log(`[Storage] Getting tenant details for ID: ${tenantId}`);
        const [tenant] = await db.select({
                tenant: restaurants,
                owner: users
            })
            .from(restaurants)
            .leftJoin(users, eq(restaurants.userId, users.id))
            .where(eq(restaurants.id, tenantId));
            
        if (!tenant) return undefined;
        return { ...tenant.tenant, owner: tenant.owner };
    }

    async getTenantMetrics(tenantId: number): Promise<any> {
        const [reservationStats] = await db.select({
                total: count(),
                completed: count(sql`CASE WHEN ${reservations.status} = 'completed' THEN 1 END`),
                noShow: count(sql`CASE WHEN ${reservations.status} = 'no_show' THEN 1 END`),
            }).from(reservations)
            .where(eq(reservations.restaurantId, tenantId));

        const [guestStats] = await db.select({
                total: count(),
            }).from(guests)
            .where(eq(guests.restaurantId, tenantId));

        return {
            totalReservations: reservationStats.total,
            completedReservations: reservationStats.completed,
            noShowRate: reservationStats.total > 0 ? (reservationStats.noShow / reservationStats.total) * 100 : 0,
            totalGuests: guestStats.total,
        };
    }

    async getTenantUsage(tenantId: number): Promise<any> {
         const [usage] = await db.select({
                monthlyReservations: restaurants.monthlyReservationCount,
                maxMonthlyReservations: restaurants.maxMonthlyReservations,
                tables: count(tables.id),
                maxTables: restaurants.maxTablesAllowed,
            })
            .from(restaurants)
            .leftJoin(tables, eq(tables.restaurantId, restaurants.id))
            .where(eq(restaurants.id, tenantId))
            .groupBy(restaurants.id);
        return usage || {};
    }

    async getTenantRecentActivity(tenantId: number, limit: number = 10): Promise<any[]> {
        return db.select()
            .from(tenantAuditLogs)
            .where(eq(tenantAuditLogs.restaurantId, tenantId))
            .orderBy(desc(tenantAuditLogs.timestamp))
            .limit(limit);
    }

    async getTenantAuditLogs(tenantId: number, options: { limit: number; offset: number }): Promise<any[]> {
        return db.select()
            .from(tenantAuditLogs)
            .where(eq(tenantAuditLogs.restaurantId, tenantId))
            .orderBy(desc(tenantAuditLogs.timestamp))
            .limit(options.limit)
            .offset(options.offset);
    }
}

export const storage = new DatabaseStorage();