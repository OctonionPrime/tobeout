# API Documentation - ToBeOut Restaurant Booking Platform

## Overview
The ToBeOut API provides comprehensive endpoints for restaurant management, table reservations, guest tracking, and AI-powered interactions. All endpoints use JSON for request/response bodies and include proper authentication and validation.

## Authentication
All API endpoints require authentication via session-based authentication.

### Authentication Endpoints

#### POST /api/auth/login
Authenticate user and create session.

**Request:**
```json
{
  "email": "admin@tobeout.com",
  "password": "password"
}
```

**Response:**
```json
{
  "id": 1,
  "email": "admin@tobeout.com",
  "name": "Admin User",
  "role": "admin"
}
```

#### GET /api/auth/me
Get current authenticated user information.

**Response:**
```json
{
  "id": 1,
  "email": "admin@tobeout.com",
  "name": "Admin User",
  "role": "admin"
}
```

#### POST /api/auth/logout
Logout current user and destroy session.

**Response:**
```json
{
  "message": "Logged out successfully"
}
```

## Restaurant Management

#### GET /api/restaurants/profile
Get current restaurant profile information.

**Response:**
```json
{
  "id": 1,
  "userId": 1,
  "name": "Demo Restaurant",
  "description": "A modern dining experience",
  "country": "Russia",
  "city": "Moscow",
  "address": "Red Square 1",
  "openingTime": "10:00:00",
  "closingTime": "23:00:00",
  "cuisine": "International",
  "atmosphere": "Modern",
  "features": ["WiFi", "Parking", "Outdoor Seating"],
  "languages": ["en", "ru"],
  "avgReservationDuration": 90,
  "minGuests": 1,
  "maxGuests": 12,
  "phone": "+7 (495) 123-4567"
}
```

#### PATCH /api/restaurants/profile
Update restaurant profile information.

**Request:**
```json
{
  "name": "Updated Restaurant Name",
  "openingTime": "11:00:00",
  "closingTime": "22:00:00",
  "avgReservationDuration": 120
}
```

## Table Management

#### GET /api/tables
Get all tables for the authenticated restaurant.

**Query Parameters:**
- `restaurantId`: Restaurant ID (optional, defaults to authenticated user's restaurant)

**Response:**
```json
[
  {
    "id": 5,
    "restaurantId": 1,
    "name": "5",
    "minGuests": 1,
    "maxGuests": 4,
    "status": "free",
    "features": ["Window View"],
    "comments": "Prime location table",
    "createdAt": "2025-01-20T10:30:00Z"
  }
]
```

#### POST /api/tables
Create a new table.

**Request:**
```json
{
  "name": "Table 10",
  "minGuests": 2,
  "maxGuests": 6,
  "features": ["Outdoor", "Quiet"],
  "comments": "Perfect for couples"
}
```

#### PATCH /api/tables/:id
Update table configuration.

**Request:**
```json
{
  "name": "Updated Table Name",
  "maxGuests": 8,
  "status": "unavailable"
}
```

#### DELETE /api/tables/:id
Delete a table.

**Response:**
```json
{
  "message": "Table deleted successfully"
}
```

## Table Availability & Scheduling

#### GET /api/tables/availability/schedule
Get detailed table availability schedule for a specific date.

**Query Parameters:**
- `date`: Date in YYYY-MM-DD format (required)
- `restaurantId`: Restaurant ID (optional)

**Response:**
```json
[
  {
    "time": "18:00",
    "tables": [
      {
        "id": 5,
        "name": "5",
        "minGuests": 1,
        "maxGuests": 4,
        "status": "reserved",
        "reservation": {
          "id": 69,
          "guestName": "Эрик", // Uses booking_guest_name if set, otherwise guest.name
          "guestCount": 2,
          "timeSlot": "18:00",
          "phone": "+7-912-345-6789",
          "status": "confirmed",
          "bookingGuestName": "Эрик" // Specific name used for this booking
        }
      }
    ]
  }
]
```

#### GET /api/booking/available-times
Get available booking times for a specific date and guest count.

**Query Parameters:**
- `date`: Date in YYYY-MM-DD format (required)
- `guests`: Number of guests (required)

**Response:**
```json
{
  "availableTimes": [
    {
      "time": "19:00",
      "availableTables": [
        {
          "id": 6,
          "name": "6",
          "maxGuests": 4
        }
      ]
    }
  ]
}
```

## Guest Management

#### GET /api/guests
Get all guests for the authenticated restaurant.

**Query Parameters:**
- `restaurantId`: Restaurant ID (optional)

**Response:**
```json
[
  {
    "id": 55,
    "name": "Миса",
    "phone": "+7-912-345-6789",
    "email": null,
    "telegramUserId": "123456789",
    "language": "ru",
    "birthday": null,
    "comments": "Regular customer",
    "tags": ["VIP", "Vegetarian"],
    "createdAt": "2025-01-15T14:20:00Z"
  }
]
```

#### POST /api/guests
Create a new guest profile.

**Request:**
```json
{
  "name": "John Doe",
  "phone": "+1-555-0123",
  "email": "john@example.com",
  "language": "en",
  "birthday": "1990-05-15",
  "tags": ["Business Client"]
}
```

#### PATCH /api/guests/:id
Update guest information.

**Request:**
```json
{
  "name": "Updated Name",
  "comments": "Updated preferences",
  "tags": ["VIP", "Anniversary"]
}
```

## Reservation Management ⭐ **Enhanced with Booking Guest Name Feature**

#### GET /api/reservations
Get reservations with advanced filtering options.

**Query Parameters:**
- `restaurantId`: Restaurant ID (required)
- `date`: Filter by specific date (YYYY-MM-DD)
- `status`: Filter by status (created, confirmed, canceled, completed)
- `upcoming`: Boolean to get only upcoming reservations

**Response:**
```json
[
  {
    "id": 69,
    "restaurantId": 1,
    "guestId": 55,
    "tableId": 5,
    "date": "2025-05-26",
    "time": "18:00:00",
    "duration": 90,
    "guests": 2,
    "status": "confirmed",
    "bookingGuestName": "Эрик", // ⭐ Name used for this specific booking
    "comments": "Special occasion",
    "specialRequests": "Window table preferred",
    "staffNotes": "Regular customer",
    "source": "telegram",
    "createdAt": "2025-01-20T15:30:00Z",
    "guestName": "Эрик", // Computed display name (booking_guest_name or guest.name)
    "guestPhone": "+7-912-345-6789",
    "tableName": "5"
  }
]
```

#### POST /api/reservations
Create a new reservation with flexible guest name handling.

**Request:**
```json
{
  "guestId": 55,
  "tableId": 5,
  "date": "2025-05-27",
  "time": "19:00",
  "guests": 3,
  "bookingGuestName": "Настя", // ⭐ Optional: Name to use for this booking
  "comments": "Birthday celebration",
  "specialRequests": "Birthday cake setup",
  "source": "telegram"
}
```

**Key Features:**
- If `bookingGuestName` is provided, the reservation shows that name
- If `bookingGuestName` is null/empty, shows the guest's profile name
- Guest profile remains unchanged regardless of booking name
- Enables complex scenarios like "Alex booking as Sarah"

#### PATCH /api/reservations/:id
Update existing reservation, including table moves and time changes.

**Request:**
```json
{
  "tableId": 6,
  "time": "20:00",
  "date": "2025-05-27",
  "status": "confirmed",
  "bookingGuestName": "Updated Booking Name", // ⭐ Can change booking name
  "staffNotes": "Moved to larger table"
}
```

#### DELETE /api/reservations/:id
Cancel/delete a reservation.

**Response:**
```json
{
  "message": "Reservation deleted successfully"
}
```

## Dashboard & Analytics

#### GET /api/dashboard/stats
Get restaurant performance statistics.

**Query Parameters:**
- `restaurantId`: Restaurant ID (required)

**Response:**
```json
{
  "todayReservations": 3,
  "confirmedReservations": 2,
  "pendingReservations": 1,
  "totalGuests": 8
}
```

#### GET /api/dashboard/upcoming
Get upcoming reservations for the next few hours.

**Query Parameters:**
- `restaurantId`: Restaurant ID (required)
- `hours`: Look-ahead hours (default: 3)

**Response:**
```json
[
  {
    "id": 69,
    "guestName": "Эрик", // Display name (booking_guest_name or guest.name)
    "tableName": "5",
    "time": "18:00",
    "guests": 2,
    "phone": "+7-912-345-6789",
    "status": "confirmed"
  }
]
```

## Timeslot Management

#### GET /api/timeslots/stats
Get timeslot generation statistics.

**Response:**
```json
{
  "lastDate": "2025-05-22",
  "totalCount": 1080
}
```

#### POST /api/timeslots/generate
Generate timeslots for upcoming days.

**Request:**
```json
{
  "daysAhead": 7
}
```

**Response:**
```json
{
  "generated": 168,
  "message": "Generated 168 timeslots for 7 days"
}
```

## AI Integration

#### GET /api/ai/activities
Get AI activity log for the restaurant.

**Query Parameters:**
- `restaurantId`: Restaurant ID (required)
- `limit`: Number of activities to return (default: 10)

**Response:**
```json
[
  {
    "id": 195,
    "restaurantId": 1,
    "type": "telegram_interaction",
    "description": "Sofia handled booking request for Эрик (2 guests, 2025-05-26 18:00)",
    "data": {
      "guestName": "Эрик",
      "guests": 2,
      "date": "2025-05-26",
      "time": "18:00",
      "telegramUserId": "123456789"
    },
    "createdAt": "2025-01-20T15:30:00Z"
  }
]
```

#### POST /api/ai/activity
Log new AI activity.

**Request:**
```json
{
  "type": "reservation_create",
  "description": "AI created reservation for guest",
  "data": {
    "reservationId": 69,
    "guestId": 55,
    "automated": true
  }
}
```

## Integration Settings

#### GET /api/integration/settings/:type
Get integration settings for a specific type.

**Parameters:**
- `type`: Integration type (telegram, email, google, web_widget)

**Response:**
```json
{
  "id": 1,
  "restaurantId": 1,
  "type": "telegram",
  "enabled": true,
  "settings": {
    "botUsername": "sofia_restaurant_bot",
    "language": "ru",
    "autoConfirm": false
  }
}
```

#### POST /api/integration/settings
Save integration settings.

**Request:**
```json
{
  "type": "telegram",
  "apiKey": "your_telegram_bot_token",
  "enabled": true,
  "settings": {
    "language": "ru",
    "autoConfirm": false,
    "businessHours": true
  }
}
```

## WebSocket Events (Real-time Updates)

The platform supports real-time updates via WebSocket connection at `/ws`.

### Events Sent to Clients:
- `reservation_created`: New reservation added
- `reservation_updated`: Reservation modified
- `reservation_deleted`: Reservation cancelled
- `table_status_changed`: Table availability updated
- `guest_updated`: Guest information modified

### Event Format:
```json
{
  "type": "reservation_created",
  "data": {
    "reservationId": 69,
    "tableId": 5,
    "guestName": "Эрик", // Display name with booking_guest_name support
    "date": "2025-05-26",
    "time": "18:00"
  },
  "timestamp": "2025-01-20T15:30:00Z"
}
```

## Error Handling

All endpoints return appropriate HTTP status codes:

- `200`: Success
- `201`: Created
- `400`: Bad Request (validation errors)
- `401`: Unauthorized (authentication required)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found
- `500`: Internal Server Error

### Error Response Format:
```json
{
  "error": "Validation failed",
  "message": "Guest count exceeds table capacity",
  "details": {
    "field": "guests",
    "value": 6,
    "max": 4
  }
}
```

## Advanced Features

### Booking Guest Name System
The API supports flexible guest name management:

1. **Same Name Booking**: Omit `bookingGuestName` to use profile name
2. **Different Name Booking**: Provide `bookingGuestName` for specific booking identity
3. **Historical Preservation**: Each reservation maintains its original booking name
4. **Display Logic**: Response includes both `bookingGuestName` (raw) and `guestName` (computed display name)

### Real-time Synchronization
- All data modifications trigger cache invalidation
- WebSocket events notify connected clients immediately
- Optimistic UI updates with server-side validation
- Background sync ensures data consistency

### Multi-language Support
- Guest language preferences automatically detected
- AI responses adapt to guest's preferred language
- Restaurant configuration supports multiple languages
- All user-facing text supports internationalization

This API documentation covers the complete ToBeOut platform functionality including advanced guest name management, real-time updates, and AI integration features.