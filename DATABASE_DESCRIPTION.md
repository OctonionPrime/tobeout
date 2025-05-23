# Database Schema Description - ToBeOut Restaurant Booking System

This document describes the comprehensive database schema for the ToBeOut restaurant booking system with AI-powered conversation management and multi-channel integration.

## Enhanced Core Tables

### Users
- `id`: Primary key
- `email`: User email (unique)
- `password`: Hashed password (bcrypt)
- `role`: User role (admin, manager, staff)
- `name`: Full name
- `isActive`: Account status
- `lastLogin`: Last authentication timestamp
- `createdAt`: Account creation timestamp

### Restaurants
- `id`: Primary key
- `name`: Restaurant name
- `description`: Restaurant description
- `address`: Physical address
- `phone`: Contact phone number
- `email`: Contact email
- `cuisine`: Type of cuisine
- `openingHours`: JSON object with detailed operating hours
- `userId`: Foreign key to users table (owner)
- `settings`: JSON object with restaurant configuration
- `timezone`: Restaurant timezone
- `averageServiceTime`: Average dining duration (minutes)
- `maxAdvanceBooking`: Maximum days in advance for bookings
- `isActive`: Restaurant operational status
- `createdAt`: Restaurant creation timestamp
- `updatedAt`: Last modification timestamp

### Tables
- `id`: Primary key
- `restaurantId`: Foreign key to restaurants
- `name`: Table identifier (e.g., "Table 1", "VIP Section A")
- `capacity`: Maximum number of guests
- `minCapacity`: Minimum number of guests (for optimization)
- `status`: Current status (available, occupied, reserved, maintenance, cleaned)
- `position`: JSON object with table location/coordinates
- `features`: JSON array with table features (window, private, accessible)
- `priority`: Table assignment priority (1-10)
- `shape`: Table shape (round, square, rectangular)
- `isActive`: Boolean for table availability
- `lastCleaned`: Timestamp of last cleaning
- `notes`: Staff notes about table condition
- `createdAt`: Table creation timestamp
- `updatedAt`: Last modification timestamp

### Timeslots
- `id`: Primary key
- `restaurantId`: Foreign key to restaurants
- `date`: Reservation date
- `time`: Time slot (HH:MM format)
- `isAvailable`: Boolean availability status
- `maxCapacity`: Maximum total guests for this time slot
- `currentBookings`: Current number of bookings
- `isActive`: Boolean for slot availability
- `staffLevel`: Required staff level for this slot
- `specialEvent`: Special event or promotion
- `pricing`: JSON object with dynamic pricing
- `createdAt`: Slot creation timestamp
- `updatedAt`: Last modification timestamp

### Guests
- `id`: Primary key
- `restaurantId`: Foreign key to restaurants
- `name`: Guest full name
- `phone`: Contact phone number (unique per restaurant)
- `email`: Guest email (optional)
- `preferences`: JSON object with dietary restrictions, seating preferences
- `allergies`: JSON array with allergy information
- `visitCount`: Number of previous visits
- `totalSpent`: Total amount spent (for VIP status)
- `lastVisit`: Date of last visit
- `averagePartySize`: Average number of guests in bookings
- `preferredTimes`: JSON array with preferred dining times
- `blacklisted`: Boolean for banned guests
- `notes`: Staff notes about guest
- `loyaltyPoints`: Accumulated loyalty points
- `vipStatus`: VIP tier level
- `source`: How guest was acquired (telegram, web, referral)
- `createdAt`: Guest record creation
- `updatedAt`: Last modification timestamp

### Reservations
- `id`: Primary key
- `restaurantId`: Foreign key to restaurants
- `guestId`: Foreign key to guests
- `tableId`: Foreign key to tables (nullable for flexible assignment)
- `timeslotId`: Foreign key to timeslots
- `date`: Reservation date
- `time`: Reservation time (HH:MM format)
- `guests`: Number of guests
- `status`: Reservation status (pending, confirmed, cancelled, completed, no_show, seated)
- `specialRequests`: Text field for special requests
- `occasionType`: Type of occasion (birthday, anniversary, business, casual)
- `source`: Booking source (web, telegram, whatsapp, phone, walk_in, ai_assistant)
- `confirmation_code`: Unique confirmation code
- `arrival_time`: Actual arrival time
- `departure_time`: Actual departure time
- `no_show_reason`: Reason for no-show
- `cancellation_reason`: Reason for cancellation
- `rating`: Guest rating of experience (1-5)
- `feedback`: Guest feedback text
- `total_amount`: Bill total (if available)
- `deposit_required`: Boolean for deposit requirement
- `deposit_amount`: Required deposit amount
- `deposit_paid`: Boolean for deposit payment status
- `reminderSent`: JSON object tracking sent reminders
- `conversation_id`: Link to AI conversation thread
- `createdAt`: Booking creation timestamp
- `updatedAt`: Last modification timestamp

### Integration Settings
- `id`: Primary key
- `restaurantId`: Foreign key to restaurants
- `type`: Integration type (telegram, whatsapp, voice, facebook, google)
- `settings`: JSON object with integration configuration
- `credentials`: Encrypted credentials for the integration
- `webhook_url`: Webhook URL for real-time updates
- `isActive`: Boolean for integration status
- `lastSync`: Last synchronization timestamp
- `errorCount`: Number of recent errors
- `lastError`: Last error message
- `rateLimits`: JSON object with rate limiting configuration
- `features`: JSON array with enabled features
- `createdAt`: Setup timestamp
- `updatedAt`: Last modification timestamp

### AI Activities
- `id`: Primary key
- `restaurantId`: Foreign key to restaurants
- `type`: Activity type (booking_attempt, conversation, optimization, sentiment_analysis)
- `description`: Activity description
- `metadata`: JSON object with additional data
- `conversation_id`: Link to conversation thread
- `guest_id`: Foreign key to guests (if applicable)
- `success`: Boolean indicating success/failure
- `confidence_score`: AI confidence level (0-1)
- `processing_time`: Time taken for AI processing (ms)
- `model_version`: AI model version used
- `input_tokens`: Number of input tokens used
- `output_tokens`: Number of output tokens generated
- `cost`: Estimated cost of AI operation
- `createdAt`: Activity timestamp

### Conversation Threads (New)
- `id`: Primary key
- `restaurantId`: Foreign key to restaurants
- `guest_id`: Foreign key to guests (nullable)
- `platform`: Communication platform (telegram, whatsapp, web)
- `platform_user_id`: Platform-specific user identifier
- `thread_id`: Platform-specific thread identifier
- `status`: Conversation status (active, paused, completed, abandoned)
- `stage`: Current conversation stage
- `intent`: Detected user intent
- `context`: JSON object with conversation context
- `message_count`: Total number of messages
- `last_message_at`: Timestamp of last message
- `sentiment_score`: Overall conversation sentiment (-1 to 1)
- `satisfaction_rating`: User satisfaction rating (1-5)
- `resolution_type`: How conversation was resolved
- `agent_handoff`: Boolean indicating human agent involvement
- `createdAt`: Conversation start timestamp
- `updatedAt`: Last activity timestamp

### Messages (New)
- `id`: Primary key
- `conversation_id`: Foreign key to conversation_threads
- `sender_type`: Message sender (user, ai, agent)
- `sender_id`: Identifier of sender
- `message_text`: Message content
- `message_type`: Type of message (text, image, audio, file, quick_reply)
- `metadata`: JSON object with message metadata
- `ai_confidence`: AI processing confidence (0-1)
- `processing_time`: AI processing time (ms)
- `intent_detected`: Detected intent from message
- `entities_extracted`: JSON object with extracted entities
- `sentiment_score`: Message sentiment score (-1 to 1)
- `language`: Detected language
- `is_flagged`: Boolean for content moderation
- `response_time`: Time to generate response (ms)
- `createdAt`: Message timestamp

## Enhanced Relationships

- Users → Restaurants (1:many) - A user can own multiple restaurants
- Restaurants → Tables (1:many) - A restaurant has multiple tables
- Restaurants → Timeslots (1:many) - A restaurant has multiple time slots  
- Restaurants → Guests (1:many) - A restaurant serves multiple guests
- Restaurants → Reservations (1:many) - A restaurant has multiple reservations
- Restaurants → Conversation Threads (1:many) - A restaurant has multiple conversations
- Guests → Reservations (1:many) - A guest can have multiple reservations
- Guests → Conversation Threads (1:many) - A guest can have multiple conversations
- Tables → Reservations (1:many) - A table can have multiple reservations
- Timeslots → Reservations (1:many) - A timeslot can have multiple reservations
- Conversation Threads → Messages (1:many) - A conversation has multiple messages
- Conversation Threads → Reservations (1:many) - A conversation can result in multiple reservations

## Advanced Business Logic

### Smart Table Assignment Algorithm
1. **Guest History Analysis** - Consider guest's previous table preferences
2. **Party Size Optimization** - Match table capacity to party size efficiently
3. **Table Features Matching** - Match special requests to table features
4. **Revenue Optimization** - Prioritize high-value time slots and guests
5. **Operational Efficiency** - Consider service time and table turnover
6. **Accessibility Requirements** - Automatic matching for accessibility needs

### Dynamic Time Slot Management
- **Real-time Availability Calculation** - Based on current reservations and service times
- **Buffer Time Management** - Automatic cleaning and preparation time
- **Seasonal Adjustments** - Holiday and special event considerations
- **Capacity Optimization** - Dynamic adjustment based on staff levels
- **Weather Integration** - Outdoor seating availability based on weather

### AI-Powered Guest Profiling
- **Behavioral Pattern Recognition** - Analyze booking patterns and preferences
- **Sentiment Analysis** - Track guest satisfaction across interactions
- **Predictive Analytics** - Anticipate guest needs and preferences
- **Personalization Engine** - Customize offers and communications
- **Churn Prevention** - Identify at-risk guests and retention strategies

### Multi-Channel Conversation Management
- **Context Preservation** - Maintain conversation state across channels
- **Intent Recognition** - Understand guest needs from natural language
- **Sentiment Monitoring** - Real-time emotional state analysis
- **Escalation Triggers** - Automatic handoff to human agents
- **Performance Analytics** - Track conversation success rates and satisfaction

### Advanced Reservation Status Flow
1. **inquiry** - Initial interest expressed
2. **pending** - Formal booking request submitted
3. **confirmed** - Booking confirmed by restaurant
4. **reminded** - Confirmation reminder sent
5. **seated** - Guest has arrived and been seated
6. **dining** - Guest is currently dining
7. **completed** - Service completed successfully
8. **cancelled** - Booking cancelled by guest or restaurant
9. **no_show** - Guest didn't show up
10. **rescheduled** - Booking moved to different time/date

### Performance Metrics & Analytics
- **Booking Conversion Rate** - Inquiry to confirmed reservation ratio
- **No-Show Rate** - Percentage of confirmed bookings that don't show
- **Customer Satisfaction Score** - Average rating across all interactions
- **Revenue Per Available Seat Hour** - Revenue optimization metric
- **AI Automation Rate** - Percentage of bookings handled without human intervention
- **Response Time** - Average time to respond to booking inquiries
- **Table Utilization Rate** - Percentage of available capacity used

This enhanced schema supports advanced AI conversation management, multi-channel integration, comprehensive analytics, and sophisticated business intelligence while maintaining high performance and data integrity.