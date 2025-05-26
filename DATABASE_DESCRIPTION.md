# Database Schema Documentation - ToBeOut Restaurant Booking Platform

## Overview
The ToBeOut platform uses PostgreSQL with a comprehensive schema designed for restaurant management, table reservations, guest tracking, and AI-powered interactions. The database supports multi-language operations, flexible guest identity management, and real-time table availability tracking.

## Core Tables

### Users Table
Authentication and role management for restaurant owners and staff.

```sql
users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role user_role DEFAULT 'restaurant',
  name TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMP DEFAULT NOW()
)
```

**Enums:** `user_role: ['admin', 'restaurant', 'staff']`

### Restaurants Table
Restaurant profile information with operational settings.

```sql
restaurants (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  country TEXT,
  city TEXT,
  address TEXT,
  photo TEXT,
  opening_time TIME,
  closing_time TIME,
  cuisine TEXT,
  atmosphere TEXT,
  features TEXT[],
  tags TEXT[],
  languages TEXT[],
  avg_reservation_duration INTEGER DEFAULT 90,
  min_guests INTEGER DEFAULT 1,
  max_guests INTEGER DEFAULT 12,
  phone TEXT,
  google_maps_link TEXT,
  trip_advisor_link TEXT,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### Tables Table
Physical table configurations with capacity and status management.

```sql
tables (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id),
  name TEXT NOT NULL,
  min_guests INTEGER DEFAULT 1,
  max_guests INTEGER NOT NULL,
  status table_status DEFAULT 'free',
  features TEXT[],
  comments TEXT,
  created_at TIMESTAMP DEFAULT NOW()
)
```

**Enums:** `table_status: ['free', 'occupied', 'reserved', 'unavailable']`

### Guests Table
Guest profiles with flexible identity management supporting multiple contact methods.

```sql
guests (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  telegram_user_id TEXT UNIQUE,
  language TEXT DEFAULT 'en',
  birthday DATE,
  comments TEXT,
  tags TEXT[],
  created_at TIMESTAMP DEFAULT NOW()
)
```

**Key Features:**
- Multi-language support (en, ru)
- Telegram integration via telegram_user_id
- Flexible contact methods (phone not unique to allow shared numbers)
- Guest preferences and birthday tracking

### Reservations Table ⭐ **Enhanced with Booking Guest Name Feature**
Core reservation system with advanced guest name management.

```sql
reservations (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id),
  guest_id INTEGER REFERENCES guests(id),
  table_id INTEGER REFERENCES tables(id),
  timeslot_id INTEGER REFERENCES timeslots(id),
  date DATE NOT NULL,
  time TIME NOT NULL,
  duration INTEGER DEFAULT 90,
  guests INTEGER NOT NULL,
  status reservation_status DEFAULT 'created',
  booking_guest_name TEXT, -- ⭐ NEW: Name used for specific booking
  comments TEXT,
  special_requests TEXT,
  staff_notes TEXT,
  total_amount TEXT,
  currency TEXT DEFAULT 'USD',
  guest_rating INTEGER,
  confirmation_24h BOOLEAN DEFAULT FALSE,
  confirmation_2h BOOLEAN DEFAULT FALSE,
  source TEXT DEFAULT 'direct',
  created_at TIMESTAMP DEFAULT NOW()
)
```

**Enums:** `reservation_status: ['created', 'confirmed', 'canceled', 'completed', 'archived']`

**Advanced Guest Name Management:**
- `booking_guest_name`: Stores the specific name used for each booking
- Allows guests to book under different names while maintaining profile integrity
- When NULL, displays the guest's profile name
- When populated, displays the booking-specific name
- Enables scenarios like "Alex booking as Oleg" while keeping Alex's profile separate

### Timeslots Table
Time-based availability management for detailed scheduling.

```sql
timeslots (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id),
  table_id INTEGER REFERENCES tables(id),
  date DATE NOT NULL,
  time TIME NOT NULL,
  status timeslot_status DEFAULT 'free',
  created_at TIMESTAMP DEFAULT NOW()
)
```

**Enums:** `timeslot_status: ['free', 'pending', 'occupied']`

### Integration Settings Table
External service configurations for Telegram, email, and other integrations.

```sql
integration_settings (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id),
  type TEXT NOT NULL,
  api_key TEXT,
  token TEXT,
  enabled BOOLEAN DEFAULT FALSE,
  settings JSON,
  created_at TIMESTAMP DEFAULT NOW()
)
```

**Supported Integration Types:**
- `telegram`: Bot integration with Sofia AI
- `email`: Email notification settings
- `google`: Google Calendar/Maps integration
- `web_widget`: Website booking widget

### AI Activities Table
Audit trail for AI-powered interactions and automated actions.

```sql
ai_activities (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id),
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  data JSON,
  created_at TIMESTAMP DEFAULT NOW()
)
```

**Activity Types:**
- `reservation_create`: AI-assisted booking creation
- `reminder_sent`: Automated reminder notifications
- `telegram_interaction`: Sofia AI conversations
- `table_assignment`: Smart table allocation

## Key Relationships

### Guest-Reservation Relationship
- One guest profile can have multiple reservations
- Each reservation can use a different `booking_guest_name`
- Guest profile maintains core identity while bookings show specific names
- Prevents duplicate guest profiles for same person using different names

### Restaurant-Table-Reservation Flow
- Restaurant → Tables (1:many)
- Table → Reservations (1:many)
- Each reservation links to both table and guest
- Real-time status updates across table and timeslot entities

### Multi-Language Support
- Guest language preferences stored in `guests.language`
- Restaurant supported languages in `restaurants.languages[]`
- AI interactions adapt to guest's preferred language

## Advanced Features

### Booking Guest Name System
The platform supports complex guest identity scenarios:

1. **Same Name Booking**: Guest books with profile name
   - `booking_guest_name` = NULL
   - Display shows `guests.name`

2. **Different Name Booking**: Guest books under different name
   - `booking_guest_name` = "Alternative Name"
   - Display shows `booking_guest_name`
   - Guest profile remains unchanged

3. **Historical Accuracy**: Previous reservations maintain original booking names
   - Prevents confusion when guest profile name changes
   - Each reservation preserves the name it was made under

### Smart Table Management
- Dynamic status calculation based on active reservations
- Automatic availability updates when reservations change
- Overlap detection for 2-hour reservation blocks
- Intelligent table assignment based on guest count and preferences

### Real-Time Synchronization
- WebSocket integration for live updates
- Optimistic UI updates with server synchronization
- Cache invalidation for immediate consistency
- Background sync every 3 minutes for reliability

## Data Integrity Features

### Reservation Validation
- Guest count must fit table capacity (`table.min_guests` ≤ `reservation.guests` ≤ `table.max_guests`)
- Reservation time must be within restaurant operating hours
- Last booking allowed 1 hour before closing time
- No overlapping reservations for same table/time

### Guest Profile Management
- Phone numbers not unique (families can share phones)
- Telegram IDs are unique for bot integration
- Multiple contact methods supported per guest
- Language preferences inherited from initial interaction

### Restaurant Configuration
- Operating hours validation (opening_time < closing_time)
- Average reservation duration affects booking windows
- Min/max guest limits apply to all table configurations
- Multi-language support for international operations

## Performance Optimizations

### Indexing Strategy
- Primary keys on all tables
- Foreign key constraints with automatic indexing
- Unique constraints on critical fields (email, telegram_user_id)
- Composite indexes on frequently queried combinations

### Caching Layer
- Smart caching with 30-second TTL for availability data
- Cache invalidation on reservation changes
- Memory-efficient cache size limits (1000 entries)
- Automatic cache cleanup and statistics tracking

This schema supports the full ToBeOut platform functionality including Sofia AI integration, multi-language operations, advanced guest management, and real-time table availability tracking.