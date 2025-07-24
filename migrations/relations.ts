import { relations } from "drizzle-orm/relations";
import { users, restaurants, aiActivities, integrationSettings, menuItems, menuItemOptions, menuItemOptionValues, restaurantMenuCategories, menuSearchLog, reservations, guests, tables, timeslots, reservationCancellations, reservationModifications, reservationStatusHistory, restaurantPolicies, tenantAuditLogs, tenantUsageMetrics } from "./schema";

export const restaurantsRelations = relations(restaurants, ({one, many}) => ({
	user: one(users, {
		fields: [restaurants.userId],
		references: [users.id]
	}),
	aiActivities: many(aiActivities),
	integrationSettings: many(integrationSettings),
	menuItems: many(menuItems),
	restaurantMenuCategories: many(restaurantMenuCategories),
	menuSearchLogs: many(menuSearchLog),
	reservations: many(reservations),
	tables: many(tables),
	timeslots: many(timeslots),
	restaurantPolicies: many(restaurantPolicies),
	tenantAuditLogs: many(tenantAuditLogs),
	tenantUsageMetrics: many(tenantUsageMetrics),
}));

export const usersRelations = relations(users, ({many}) => ({
	restaurants: many(restaurants),
}));

export const aiActivitiesRelations = relations(aiActivities, ({one}) => ({
	restaurant: one(restaurants, {
		fields: [aiActivities.restaurantId],
		references: [restaurants.id]
	}),
}));

export const integrationSettingsRelations = relations(integrationSettings, ({one}) => ({
	restaurant: one(restaurants, {
		fields: [integrationSettings.restaurantId],
		references: [restaurants.id]
	}),
}));

export const menuItemOptionsRelations = relations(menuItemOptions, ({one, many}) => ({
	menuItem: one(menuItems, {
		fields: [menuItemOptions.menuItemId],
		references: [menuItems.id]
	}),
	menuItemOptionValues: many(menuItemOptionValues),
}));

export const menuItemsRelations = relations(menuItems, ({one, many}) => ({
	menuItemOptions: many(menuItemOptions),
	restaurant: one(restaurants, {
		fields: [menuItems.restaurantId],
		references: [restaurants.id]
	}),
	restaurantMenuCategory: one(restaurantMenuCategories, {
		fields: [menuItems.categoryId],
		references: [restaurantMenuCategories.id]
	}),
	menuSearchLogs: many(menuSearchLog),
}));

export const menuItemOptionValuesRelations = relations(menuItemOptionValues, ({one}) => ({
	menuItemOption: one(menuItemOptions, {
		fields: [menuItemOptionValues.optionId],
		references: [menuItemOptions.id]
	}),
}));

export const restaurantMenuCategoriesRelations = relations(restaurantMenuCategories, ({one, many}) => ({
	menuItems: many(menuItems),
	restaurant: one(restaurants, {
		fields: [restaurantMenuCategories.restaurantId],
		references: [restaurants.id]
	}),
}));

export const menuSearchLogRelations = relations(menuSearchLog, ({one}) => ({
	restaurant: one(restaurants, {
		fields: [menuSearchLog.restaurantId],
		references: [restaurants.id]
	}),
	menuItem: one(menuItems, {
		fields: [menuSearchLog.clickedItemId],
		references: [menuItems.id]
	}),
}));

export const reservationsRelations = relations(reservations, ({one, many}) => ({
	restaurant: one(restaurants, {
		fields: [reservations.restaurantId],
		references: [restaurants.id]
	}),
	guest: one(guests, {
		fields: [reservations.guestId],
		references: [guests.id]
	}),
	table: one(tables, {
		fields: [reservations.tableId],
		references: [tables.id]
	}),
	timeslot: one(timeslots, {
		fields: [reservations.timeslotId],
		references: [timeslots.id]
	}),
	reservationCancellations: many(reservationCancellations),
	reservationModifications: many(reservationModifications),
	reservationStatusHistories: many(reservationStatusHistory),
}));

export const guestsRelations = relations(guests, ({many}) => ({
	reservations: many(reservations),
}));

export const tablesRelations = relations(tables, ({one, many}) => ({
	reservations: many(reservations),
	restaurant: one(restaurants, {
		fields: [tables.restaurantId],
		references: [restaurants.id]
	}),
	timeslots: many(timeslots),
}));

export const timeslotsRelations = relations(timeslots, ({one, many}) => ({
	reservations: many(reservations),
	restaurant: one(restaurants, {
		fields: [timeslots.restaurantId],
		references: [restaurants.id]
	}),
	table: one(tables, {
		fields: [timeslots.tableId],
		references: [tables.id]
	}),
}));

export const reservationCancellationsRelations = relations(reservationCancellations, ({one}) => ({
	reservation: one(reservations, {
		fields: [reservationCancellations.reservationId],
		references: [reservations.id]
	}),
}));

export const reservationModificationsRelations = relations(reservationModifications, ({one}) => ({
	reservation: one(reservations, {
		fields: [reservationModifications.reservationId],
		references: [reservations.id]
	}),
}));

export const reservationStatusHistoryRelations = relations(reservationStatusHistory, ({one}) => ({
	reservation: one(reservations, {
		fields: [reservationStatusHistory.reservationId],
		references: [reservations.id]
	}),
}));

export const restaurantPoliciesRelations = relations(restaurantPolicies, ({one}) => ({
	restaurant: one(restaurants, {
		fields: [restaurantPolicies.restaurantId],
		references: [restaurants.id]
	}),
}));

export const tenantAuditLogsRelations = relations(tenantAuditLogs, ({one}) => ({
	restaurant: one(restaurants, {
		fields: [tenantAuditLogs.restaurantId],
		references: [restaurants.id]
	}),
}));

export const tenantUsageMetricsRelations = relations(tenantUsageMetrics, ({one}) => ({
	restaurant: one(restaurants, {
		fields: [tenantUsageMetrics.restaurantId],
		references: [restaurants.id]
	}),
}));