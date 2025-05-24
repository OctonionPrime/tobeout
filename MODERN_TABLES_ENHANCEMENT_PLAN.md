# Modern Tables - Enhanced Functionality Guide

## 🎯 Overview
Advanced restaurant table management with **intelligent drag & drop functionality**, real-time availability tracking, and flexible scheduling in Moscow timezone. Move reservations to **any time slot on any table** with smart validation.

## 📋 4 View Modes

### 🕐 Schedule View (Primary)
**Purpose:** Real-time table availability with advanced reservation management
- **Visual Timeline:** Hourly slots showing all tables
- **🆕 Smart Drag & Drop:** Move bookings to ANY table at ANY time
- **Auto-refresh:** Updates every 30 seconds
- **Status Colors:** Green (available), Amber (reserved), Red (occupied)

**How to use:**
1. Select date using quick buttons or dropdown
2. **Drag reservations anywhere:** Different tables, different times, or both
3. Right-click any slot for context menu actions
4. Watch for visual feedback showing valid drop zones

### 🏢 Floor Plan View
**Purpose:** Physical restaurant layout management
- **Drag Tables:** Rearrange table positions in dining room
- **Visual Layout:** See your restaurant from above
- **Table Properties:** Hover for capacity and features

**How to use:**
1. Drag table shapes to new positions
2. Click tables to edit details
3. Right-click for quick actions (edit, maintenance, etc.)

### 🔲 Grid View
**Purpose:** Card-based table overview
- **Table Cards:** Visual status of all tables
- **Current Status:** Shows reservations and availability
- **Quick Access:** Click cards to edit tables

### 📝 List View  
**Purpose:** Detailed table information table
- **Complete Info:** All table data in spreadsheet format
- **Current Reservations:** Shows active bookings
- **Bulk Actions:** Edit multiple tables efficiently

## 🎛️ Enhanced Key Features

### 🚀 **NEW: Advanced Drag & Drop System**

#### **Move Reservations Anywhere**
**🆕 Three Types of Moves:**

1. **Same Table, Different Time:**
   - Drag "Walrus 18:00" → "Walrus 19:00" (same table)
   - Perfect for time change requests

2. **Different Table, Same Time:**
   - Drag "Table 3 18:00" → "Table 5 18:00"
   - Move to better seating (window, larger capacity)

3. **Different Table, Different Time:**
   - Drag "Table 3 18:00" → "Table 1 20:00"
   - Complete reservation makeover

#### **🛡️ Smart Validation System**
- ✅ **Available Slots Only:** Can only drop on green (free) slots
- ❌ **Occupied Protection:** Cannot drop on red (occupied) slots
- ✅ **Capacity Check:** Validates party size fits new table
- ✅ **Operating Hours:** Only allows moves within business hours
- ✅ **Conflict Detection:** Prevents double-booking scenarios

#### **🎨 Visual Feedback System**
- **📱 Drag Ghost:** Shows reservation details while dragging
- **🟢 Valid Drop Zones:** Green highlight on available slots
- **🔴 Invalid Zones:** Red overlay on occupied/unsuitable slots
- **✨ Hover Effects:** Tables scale and glow when drag approaches
- **📢 Smart Confirmations:** "Walrus moved from Table 3 at 6:00 PM to Table 5 at 7:00 PM"

### 📅 Date Selection (Schedule View)
- **Quick Buttons:** Today, Tomorrow, This Weekend
- **Date Picker:** 30-day calendar dropdown
- **Moscow Time:** All dates automatically in restaurant timezone

### 🖱️ Enhanced Right-Click Menus
**Schedule Context Menu:**
- Cancel Reservation
- Create New Reservation  
- Edit Table Details
- **🆕 Quick Move Options:** Move to next/previous hour

**Floor Plan Context Menu:**
- Edit Table Details
- Mark Available/Maintenance
- Table Status Management

### ⚡ Smart Features
- **Real-time Updates:** Data refreshes automatically
- **Moscow Timezone:** All times in restaurant timezone
- **Enhanced Visual Feedback:** Drag previews, drop zone highlights
- **Error Prevention:** Cannot drop on invalid slots
- **Performance:** Smart caching with conflict pre-calculation

## 🎨 **Updated Status Colors & Meanings**

**Visual Legend:**
- 🟢 **Green (Available):** Free for new bookings - ✅ **Valid Drop Zone**
- 🟡 **Amber (Reserved):** Future booking scheduled - ❌ **Invalid Drop Zone**
- 🔴 **Red (Occupied):** Guests currently dining - ❌ **Invalid Drop Zone**
- ⚫ **Gray (Unavailable):** Maintenance/closed - ❌ **Invalid Drop Zone**

**Business Logic:**
- **Available:** Accepts new reservations and moves
- **Reserved:** Has future booking (cannot be disturbed)
- **Occupied:** Guests currently at table (protected)

## 🚀 Quick Actions

### **🆕 Enhanced Reservation Management**
1. **Move Anywhere:** 
   - Drag any reservation to any green slot
   - System validates capacity and availability
   - Instant visual confirmation

2. **Quick Time Changes:**
   - Right-click → Quick Move → Next/Previous Hour
   - Perfect for small adjustments

3. **Create New:**
   - Right-click empty green slot → Create Reservation
   - Drag from reservation list to empty slot

### Adding Tables
1. Click "Add Table" button
2. Fill in name, capacity, features
3. Table appears in all views immediately

### Layout Management
1. Switch to Floor Plan view
2. Drag tables to desired positions
3. Use context menu for table settings

## 💡 **Enhanced Pro Tips**

### **🎯 Drag & Drop Mastery**
- **Look for the cursor change:** Pointer becomes grab hand over draggable reservations
- **Green = Go:** Only drop on green highlighted zones
- **Red = Stop:** Red overlay means invalid drop target
- **Ghost preview:** Dragged reservation shows guest name and party size
- **Capacity matching:** System prevents moves to tables too small for party

### **⚡ Efficiency Shortcuts**
- **Schedule View:** Drag reservations for instant moves
- **Floor Plan:** Organize your dining room layout
- **Auto-refresh:** System updates every 30 seconds
- **Mobile-friendly:** All drag operations work on tablets

### **🛡️ Error Prevention**
- **Smart validation:** Cannot drop on occupied slots
- **Capacity protection:** Won't allow moves to undersized tables
- **Time boundaries:** Respects restaurant operating hours
- **Conflict detection:** Prevents double-booking automatically

## 🎨 **Enhanced Visual Indicators**

**Interactive Elements:**
- **🎯 Drag Handles:** Grab cursor on reservation boxes
- **🟢 Drop Zones:** Green glow on valid targets during drag
- **🔴 No-Drop Zones:** Red overlay on invalid targets
- **✨ Hover Effects:** Tables scale when drag approaches
- **📱 Drag Ghost:** Floating reservation info during move
- **🔄 Loading States:** Smooth animations during updates

**Drag States:**
- **👆 Hovering:** Cursor changes to grab hand
- **✊ Dragging:** Ghost preview follows mouse
- **🟢 Valid Target:** Green highlight on drop zone
- **🔴 Invalid Target:** Red overlay with X indicator
- **✅ Success:** Smooth animation to new position

## 🚀 **Advanced Use Cases**

### **Time Management Scenarios**
```
Customer calls: "Can we move our 6 PM to 7 PM?"
→ Drag "Smith 18:00" to same table's 19:00 slot
→ Instant confirmation: "Smith moved to 7:00 PM"
```

### **Table Upgrade Scenarios**
```
VIP guest wants window table:
→ Drag "Johnson Table 3" to "Johnson Table 1 (Window)"
→ Same time, better location
```

### **Complete Reorganization**
```
Kitchen running behind, need to spread out bookings:
→ Drag multiple 19:00 reservations to 19:30 and 20:00
→ Distribute load across time slots
```

### **Error Prevention Examples**
```
❌ Cannot drag to occupied slot: "Table 5 19:00 occupied by Miller party"
❌ Capacity mismatch: "Party of 6 cannot fit at 2-person Table 8"
✅ Valid move: "Wilson party moved from Table 2 at 6 PM to Table 4 at 7 PM"
```

---

## 🏗️ Implementation Checklist

### Phase 1: Core Drag & Drop Infrastructure ✅ DONE
- [x] Basic schedule view with time slots
- [x] Table availability display
- [x] Status color coding
- [x] 30-second auto-refresh

### Phase 2: Enhanced Drag & Drop System (IN PROGRESS)
- [ ] Make reservation slots draggable
- [ ] Add drag ghost/preview
- [ ] Implement drop zone validation
- [ ] Add visual feedback (green/red zones)
- [ ] Smart capacity checking
- [ ] **Backend Integration:** Reservation move API endpoint

**⚠️ Critical:** All drag & drop functionality must be perfectly aligned with backend APIs and database operations to ensure data integrity and real-time synchronization.

### Phase 3: Advanced UI Features (TODO)
- [ ] Date selection with quick buttons
- [ ] Right-click context menus
- [ ] Enhanced hover effects
- [ ] Drag state animations
- [ ] Success/error notifications

### Phase 4: Multiple View Modes (TODO)
- [ ] Floor Plan view
- [ ] Grid view  
- [ ] List view
- [ ] View switching tabs

### Phase 5: Advanced Features (TODO)
- [ ] Quick move options
- [ ] Bulk operations
- [ ] Advanced validation
- [ ] Performance optimizations

*This enhanced system provides complete restaurant table management with intelligent drag & drop functionality, allowing flexible reservation moves while preventing conflicts and ensuring optimal customer service.*