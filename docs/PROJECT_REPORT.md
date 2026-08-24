# KKKhane — Hotel & Restaurant Management System
## Complete Project Report

---

## 1. Introduction

**KKKhane** is a full-stack, multi-tenant SaaS platform built for hotels and restaurants in Nepal. It handles the complete operational lifecycle of both a restaurant (order management, kitchen, billing, QR menus) and a hotel (room booking, stay billing, housekeeping) within a single unified system.

The system is role-based, meaning different users (super admin, manager, cashier, waiter, kitchen staff) see different panels and have different capabilities. It is designed to work on mobile and desktop, and supports offline-tolerant operations with real-time sync via Supabase Realtime.

**Business modes supported:**
- 🍽️ **Restaurant-only** — Full restaurant POS with QR ordering, table management, kitchen display, billing
- 🏨 **Hotel + Restaurant** — All restaurant features PLUS hotel room management, bookings, stay billing, housekeeping

---

## 2. Technology Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16 (App Router, React Server Components) |
| **Language** | TypeScript (strict mode) |
| **Styling** | Tailwind CSS v4 with custom design tokens |
| **Database** | PostgreSQL via Supabase |
| **Auth** | Supabase Auth (email/password + invite-based staff) |
| **Realtime** | Supabase Realtime (Postgres CDC) |
| **File Storage** | Supabase Storage (menu images, payment proofs) |
| **Caching** | Upstash Redis (rate limiting, session cache) |
| **Background Jobs** | QStash (webhooks, cron jobs) |
| **Error Monitoring** | Sentry |
| **Email** | Custom email service (`lib/email.ts`) |
| **SMS** | Custom SMS service (`lib/sms.ts`) |
| **PWA** | Serwist (Service Worker, offline support) |
| **Maps** | Leaflet (delivery address location) |
| **Deployment** | Vercel (assumed from Next.js + Supabase stack) |

---

## 3. Database Architecture

The database uses PostgreSQL with Row Level Security (RLS) for multi-tenant isolation. Every table that belongs to a restaurant has a `restaurant_id` foreign key. RLS policies use helper functions `current_restaurant_id()` and `current_app_role()` to enforce tenant boundaries.

### Core Tables

#### 👤 Users & Auth
| Table | Purpose |
|-------|---------|
| `users` | Staff accounts (manager, cashier, waiter, kitchen, super_admin) |
| `invitations` | Invite tokens for onboarding new staff by email |
| `departments` | Organizational departments per restaurant |
| `staff_shifts` | Shift clock-in/out records per user |

#### 🍽️ Restaurant
| Table | Purpose |
|-------|---------|
| `restaurants` | Core restaurant record (name, slug, mode, subscription) |
| `categories` | Menu categories (with images) |
| `menu_items` | Dishes with price, description, images |
| `menu_item_variations` | Size/type variants (e.g. Small/Large) with individual prices |
| `menu_item_pairings` | Recommended item pairings |
| `combo_items` | Bundled meal combos with discounted pricing |
| `tables` | Dining tables with QR slug identifiers |
| `sessions` | Active table sessions (open when occupied, closed on bill paid) |
| `orders` | Customer orders (dine-in, takeout, delivery) |
| `order_items` | Line items within each order |
| `payment_verifications` | QR/digital payment screenshot submissions |
| `promo_codes` | Discount codes applied at checkout |
| `loyalty_programs` | Customer loyalty points configuration |
| `ingredients` | Inventory ingredients |
| `menu_item_ingredients` | Mapping of ingredients to menu items (for stock deduction) |
| `physical_menus` | Printable physical menu PDF configs |
| `service_requests` | Customer service requests from QR (call waiter, water, etc.) |
| `takeout_orders` | Takeout / delivery order tracking |

#### 🏨 Hotel
| Table | Purpose |
|-------|---------|
| `room_types` | Room categories (Deluxe, Standard, Suite) with base price & capacity |
| `rooms` | Individual rooms with floor, number, type, status |
| `bookings` | Guest reservations (check-in, check-out, guest details, status) |
| `room_charges` | Extra charges added during stay (minibar, laundry, room service) |

#### 💰 Finance
| Table | Purpose |
|-------|---------|
| `day_book_sessions` | Daily cash book sessions (one per day per restaurant) |
| `day_book_entries` | Individual cash-in / cash-out entries with category |
| `invoices` | Generated invoice records |

#### ⚙️ Configuration
| Table | Purpose |
|-------|---------|
| `homepage_configs` | Customer-facing restaurant homepage content |
| `feature_flags` | Per-restaurant feature toggles |
| `restaurant_settings` | Advanced settings (service charge, currency, theme, etc.) |
| `allowed_ips` | IP whitelist for location-restricted staff access |
| `subscription_payments` | SaaS billing records (Super Admin use) |

### Database Design Principles
- **Row Level Security (RLS)** on every table — staff can only access their own restaurant's data
- **`updated_at` triggers** auto-maintained via `set_updated_at()` function
- **Composite unique indexes** (e.g. one open session per table, one booking per room at a time)
- **Partial indexes** for performance (e.g. index only on open/active records)
- **Audit trail** via `audit.ts` — sensitive actions are logged
- **62 migration files** tracking every schema change

---

## 4. Authentication & Authorization

### Roles
| Role | Access Level |
|------|-------------|
| `super_admin` | Full system access, platform management |
| `manager` | Full restaurant management, all admin features |
| `cashier` | POS cashier panel, billing, settlements |
| `waiter` | Waiter panel — take orders, manage tables |
| `kitchen` | Kitchen Display System (KDS) only |

### How It Works
1. Staff are **invited by email** (`/admin/staff → Invite`) — they receive a link, set a password, and are auto-assigned their role and restaurant.
2. Login at `/login` — Supabase Auth issues a JWT.
3. A **middleware proxy** (`src/proxy.ts`) intercepts every request, reads the JWT, checks the user's role, and routes them to the correct panel. Wrong-role access is blocked with a redirect.
4. **IP restriction** — Admin can whitelist IPs. Staff accessing from outside will be blocked.
5. **Rate limiting** via Upstash Redis — brute-force protection on login and sensitive APIs.

---

## 5. System Panels & Features

---

### 5.1 🌐 Public Customer-Facing Pages

#### QR Table Menu (`/t/[tableSlug]`)
**How to use:** A QR code is printed and placed on each table. Customer scans → lands on this page.

**Components:**
- `TablePageClient.tsx` — Main customer menu SPA
- `/cart` — Cart review page
- `/checkout` — Nepal payment checkout (eSewa, Khalti, Fonepay, cash)
- `/order` — Order status tracker

**Features:**
- Browse the full menu by category with item images
- Select item variations (size, type)
- Apply promo codes for discounts
- Add to cart, review, and place order
- Pay via **Nepal QR (eSewa/Khalti/Fonepay)** — customer uploads screenshot for verification
- Real-time order status tracking after placing
- Service requests — "Call Waiter", "Request Water", etc.
- Loyalty points — Customers can earn and redeem points
- Works as a PWA (installable, offline-tolerant)

#### Restaurant Public Homepage (`/r/[slug]`)
- Customer-facing branded restaurant page
- Shows name, logo, description, social links
- Entry point to the QR menu

#### Takeout Ordering (`/takeout/[slug]`)
- Online ordering for takeout and delivery without table QR
- Customer enters name, phone, optional delivery address

---

### 5.2 🔐 Onboarding (`/onboarding`)

New restaurants go through a guided setup:
1. **Create Restaurant** — name, slug, business type (restaurant / hotel)
2. **Digital Identity** — logo, cover image, social links
3. **Menu Setup** — add categories and first items
4. **Table Setup** — create tables and download QR codes
5. **Staff Invite** — invite first manager/cashier

---

### 5.3 🏛️ Admin Panel (`/admin`)

The admin panel is for **managers and owners**. It has a collapsible sidebar with all management sections.

---

#### 📊 Dashboard (`/admin/dashboard`)
**Purpose:** High-level overview of restaurant performance.

**What's shown:**
- Today's revenue, order count, average order value
- Pending/active orders count
- Recent orders list
- Revenue trend chart (line chart, 7/30 days)
- Payment method breakdown (Cash vs Digital)
- Top-selling items

**Components:** `AnalyticsDashboard.tsx`, `RevenueTrendChart.tsx`

---

#### 🍽️ Menu Manager (`/admin/menu`)
**Purpose:** Complete menu management.

**Components:** `MenuManager.tsx` (87KB — the largest component)

**Sub-sections & Features:**
- **Categories** — Create/edit/delete categories, upload category images, reorder via drag
- **Menu Items** — Add items with name, description, price, category, images
  - Toggle availability on/off (instant hide from QR menu)
  - Mark items as vegetarian, bestseller, new
  - Set preparation time
- **Variations** — Add size/type variants to any item (e.g. Small Rs.150, Large Rs.250) with individual prices and optional images
- **Ingredients** — Link ingredients to items for stock tracking
- **Pairings** — Set "Frequently ordered with" suggestions
- **Translation** — Translate item names/descriptions to Nepali (via `TranslationModal.tsx`)
- **Physical Menu** — Configure and download a printable PDF menu

**How to add an item:**
1. Go to Menu → click "Add Item"
2. Fill name, price, category, description
3. Upload image
4. Optionally add variations
5. Click Save → instantly live on QR menu

---

#### 🪑 Tables Manager (`/admin/tables`)
**Purpose:** Configure dining tables and generate QR codes.

**Components:** `TableManager.tsx` (admin), `components/admin/TableManager.tsx`

**Features:**
- Add tables with a label (e.g. "T1", "Balcony 3")
- Each table gets a unique QR slug
- Download individual QR codes as PNG/SVG
- Download bulk QR sheet for printing
- Set table capacity
- View which tables are currently occupied (live status)
- Delete/deactivate tables

---

#### 📦 Orders (`/admin/orders`)
**Purpose:** View and manage all orders.

**Features:**
- Filter by status: Pending, Active, Delivered, Cancelled
- Filter by type: Dine-in, Takeout, Delivery
- View order details — items, quantities, prices, table
- Manual status updates
- Export orders (date range)

---

#### 💳 Payment Verification (`/admin/payments`)
**Purpose:** Verify digital payment screenshots submitted by customers.

**Components:** `PaymentVerificationPanel.tsx`

**Work flow:**
1. Customer pays via QR (eSewa etc.) and uploads screenshot
2. Notification appears in this panel
3. Staff views the screenshot, verifies the amount
4. Click **Approve** → order marked as paid
5. Click **Reject** → customer notified

---

#### 📈 Analytics & Reports (`/admin/analytics`, `/admin/reports`)
**Purpose:** Business intelligence and financial reporting.

**Features:**
- Revenue by date range (daily/weekly/monthly)
- Order volume trends
- Payment method breakdown (cash vs card vs digital)
- Top items by revenue and quantity
- Staff performance metrics
- Export to CSV

**Components:** `AnalyticsDashboard.tsx`, `ReportsViewer.tsx`

---

#### 🏨 Rooms Manager (`/admin/rooms`) — Hotel Only
**Purpose:** Configure hotel rooms and room types.

**Components:** `RoomsClient.tsx` (59KB)

**Sub-sections:**

**Room Types Tab:**
- Create room types (e.g. Deluxe, Standard, Suite)
- Set base price per night
- Set max guest capacity
- Add description

**Rooms Tab:**
- Add individual rooms (room number, floor, assign room type)
- View current status: Available / Occupied / Cleaning / Closed
- Filter by floor or status
- Edit room details
- Delete room

**How to add a room:**
1. First create a Room Type (Deluxe, Rs. 2000/night, 2 guests)
2. Go to Rooms tab → Add Room
3. Enter room number (e.g. 101), select floor, select room type
4. Save → Room appears in cashier panel

---

#### 📅 Bookings (`/admin/bookings`) — Hotel Only
**Purpose:** View all guest bookings and stay history.

**Components:** `BookingsClient.tsx`

**Features:**
- List of all bookings (current, upcoming, checked-out)
- Filter by status: Checked In, Checked Out, Cancelled
- View guest name, phone, check-in/out dates, room number
- See booking notes/KYC

---

#### 📒 Day Book (`/admin/day-book`)
**Purpose:** Daily cash register / ledger for tracking all cash movements.

**Components:** `DayBookClient.tsx` (72KB)

**Sub-sections:**

**Daily Session:**
- Open a new day session (set opening balance)
- System auto-calculates yesterday's closing balance as today's opening
- Close day session at end of shift

**Cash Entries:**
- Record **Cash In** (income: room payment, order payment, advance deposit)
- Record **Cash Out** (expenses: salary advance, supplier payment, utility)
- Categories: `order_payment`, `room_deposit`, `booking_payment`, `expense`, `refund`, `salary`, `advance`, `other`
- Each entry has description, amount, category, reference

**Summary View:**
- Total cash in for the day
- Total cash out for the day
- Closing balance = Opening + Cash In − Cash Out
- Bank deposit tracking
- Bank ledger

**How it works:**
1. Manager opens day at start of shift → sets opening cash
2. Throughout day, cashier adds entries for payments received/expenses
3. At end of day → manager closes day → system calculates final balance
4. Closing balance carries forward as next day's opening balance automatically

---

#### 🧂 Ingredients / Stock (`/admin/ingredients`)
**Purpose:** Manage inventory ingredients and track consumption.

**Components:** `IngredientsManager.tsx`

**Features:**
- Add ingredients (name, unit: kg/L/pcs, current stock quantity)
- Set reorder level (alert when stock goes below this)
- Link ingredients to menu items (recipe mapping)
- When an order is placed → system deducts stock automatically
- View low-stock alerts
- Manual stock adjustments (restock, wastage)
- Stock movement history

---

#### 👥 Staff Manager (`/admin/staff`)
**Purpose:** Manage all staff members.

**Components:** `StaffManager.tsx` (81KB)

**Sub-sections:**

**Staff List:**
- View all staff with role, department, last active
- Edit role or department
- Deactivate / remove staff

**Invite Staff:**
- Enter email and select role (cashier, waiter, kitchen, manager)
- Select department (optional)
- Send invite email → staff receives link, sets password, auto-assigned to restaurant

**Departments:**
- Create departments (e.g. "Kitchen", "Front Desk", "Housekeeping")
- Assign staff to departments

**Shifts:**
- View shift clock-in/out history per staff member
- See total hours worked

---

#### ⏰ Shifts (`/admin/shifts`)
**Purpose:** Staff shift scheduling and time tracking.

**Components:** `ShiftsManager.tsx`

**Features:**
- View shift log for all staff
- See clock-in/out times and duration
- Filter by staff member or date range
- Staff clock in/out from their own panel

---

#### 🎁 Promo Codes (`/admin/promos`)
**Purpose:** Create and manage discount codes.

**Components:** `PromoCodesManager.tsx`

**Features:**
- Create promo codes (fixed amount or percentage discount)
- Set validity dates
- Set usage limits (one-time, unlimited, per-customer)
- Enable/disable codes
- View usage statistics

---

#### 🌟 Loyalty Program (`/admin/loyalty`)
**Purpose:** Customer loyalty points system.

**Components:** `LoyaltyManager.tsx`

**Features:**
- Enable/disable loyalty program
- Set points earned per Rs. spent (e.g. 1 point per Rs. 100)
- Set redemption rate (e.g. 100 points = Rs. 50 off)
- Customers automatically earn points on QR orders
- Customers can see and redeem points at checkout

---

#### 🎨 Theme Customizer (`/admin/theme`)
**Purpose:** Brand the system with restaurant colors and fonts.

**Components:** `ThemeCustomizer.tsx`

**Features:**
- Set primary brand color (used across menus, buttons, receipts)
- Set logo and cover images
- Font selection
- Preview changes live before saving

---

#### 🌐 Homepage Manager (`/admin/homepage`)
**Purpose:** Configure the public restaurant homepage.

**Components:** `HomepageManager.tsx` (55KB)

**Features:**
- Set restaurant name, tagline, description
- Upload hero/banner image
- Add social media links (Facebook, Instagram, etc.)
- Opening hours
- Contact info (phone, address, map location)
- Enable/disable online ordering
- Preview how it looks to customers

---

#### ⚙️ Settings (`/admin/settings`)
**Purpose:** Restaurant-wide configuration.

**Components:** `SettingsManager.tsx` (58KB)

**Configurable options:**
- Restaurant name, address, phone
- Business type (restaurant / hotel)
- Currency display format
- Service charge percentage
- Tax settings
- VAT/PAN number
- Default language (English / Nepali)
- Notification preferences
- Allowed IP addresses (staff access restriction)
- Payment methods accepted (cash, digital, card)
- Order auto-confirm settings
- Combo offers enable/disable

---

#### 🧩 Combo Offers (`/admin/combos`)
**Purpose:** Create bundled meal deals.

**Features:**
- Create combo with name and discounted price
- Add menu items to the combo bundle
- Enable/disable combos
- Appears on customer QR menu as a special offer

---

#### 👑 Super Admin Panel (`/admin/super-admin`)
**Purpose:** Platform-level management for SaaS operator.

**Features:**
- View all restaurants on the platform
- Manage subscription tiers (Free, Basic, Pro, Enterprise)
- View subscription payment history
- Manually upgrade/downgrade restaurant plans
- Platform-wide settings and configurations

---

### 5.4 👨‍🍳 Kitchen Display System (`/kitchen`)

**Who uses it:** Kitchen staff — they see this on a dedicated screen/tablet.

**Features:**
- Live feed of all incoming orders (auto-updates via Realtime)
- Orders displayed as cards with items and quantities
- **Chef claim** — individual chef can claim specific order items
- Order item status progression: `pending → preparing → ready`
- Mark entire order as ready → waiter gets notified
- Audio alert when new order arrives
- Priority indicators (time elapsed, urgent orders highlighted)
- Filter by category or chef
- Shift clock-in/out for kitchen staff

**How it works:**
1. Customer places order (QR or waiter)
2. Order instantly appears on KDS screen
3. Chef claims items they are preparing
4. Updates status to "preparing" → "ready"
5. Waiter sees the ready notification and delivers

---

### 5.5 🧑‍💼 Waiter Panel (`/waiter`)

**Who uses it:** Floor waiters on their phone or tablet.

**Components:** `WaiterLayoutClient.tsx`, `WaiterTabs.tsx`, `WaiterOrderFeed.tsx`, `WaiterDeliveryFeed.tsx`, `WaiterTakeoutFeed.tsx`

**Tabs:**

**Orders Tab:**
- Live feed of all active orders at all tables
- See order items, status, table number
- Confirm order delivery (mark as delivered)
- View payment status of each order

**Payment Claims Tab:**
- See pending QR payment verifications from customers
- Forward to cashier for approval

**Takeout Tab:**
- View and manage takeout/delivery orders
- Update status (preparing, ready, dispatched)

**Tables Tab:**
- Quick view of table occupancy
- See which tables have active sessions

**Service Requests Tab:**
- Real-time feed of customer service requests ("Call Waiter", "Request Water")
- Mark requests as resolved

**Profile:**
- Clock in/out for shift
- View own shift history

---

### 5.6 💰 Cashier Panel (`/cashier`)

**Who uses it:** Cashier staff — handles billing, settlement, and POS operations.

**Components:** `CashierClient.tsx` (main), `CashierRoomManager.tsx`, `CashierTableManager.tsx`

The Cashier panel has different tabs depending on business mode:

---

#### Restaurant Mode Tabs

**Tables Tab:**
- Grid of all tables color-coded by status
  - 🟢 Available — empty
  - 🔵 Occupied — has active session
  - 🟡 Dirty — needs cleaning
- Click an occupied table → slide-up drawer shows:
  - Active orders for that table
  - Items, quantities, prices
  - QR payment claims pending
- Cash payment button → marks all orders as cash-paid

**Takeaway/Delivery Tab:**
- List of all takeout orders
- Filter by status
- Mark as ready/dispatched

**Billing Tab (Tables sub-tab):**
- Cards for all tables with active/unpaid sessions
- Click table card → stay details popup:
  - All order items with totals
  - Payment method selector (Cash / QR Digital)
  - Total amount
  - **Generate Invoice** → opens thermal receipt preview
  - **Print Bill** → sends to thermal printer
  - **Mark Paid** → settles all orders, closes session, card disappears instantly

---

#### Hotel Mode Additional Tabs

**Rooms Tab:**
- Grid of all hotel rooms color-coded by status:
  - 🟢 **Available** — empty, ready to book
  - 🔵 **Occupied/Booked** — guest is staying
  - 🟡 **Cleaning** (Dirty) — needs housekeeping
  - 🔴 **Closed** (Maintenance) — not available
- Click **Available** room → popup with actions:
  - **Book** → booking form appears:
    - Guest name, phone
    - KYC document (optional)
    - Check-in date & time
    - Check-out date & time
    - Number of guests
    - Click "Book" → room becomes Occupied, booking created
  - **Reserve** → same as book but marked as reserved
  - **Closed** → confirmation popup → room goes to maintenance
  - **Dirty** → confirmation popup → room goes to cleaning
- Click **Occupied** room → guest details drawer:
  - Guest info (name, phone, KYC)
  - Stay schedule (check-in/check-out)
  - Stay billing breakdown:
    - Room stay cost (base price × nights)
    - QR Room Service orders (auto-added from restaurant orders linked to that room)
    - Manually added charges (minibar, laundry, spa, parking, etc.)
  - ➕ Add manual charge (type, description, amount)
  - **Go to Billing** button → switches to Billing tab, opens that room's invoice

**Billing Tab (Rooms sub-tab):**
- Cards for all occupied rooms with guest name and amount
- Click room card → stay details popup:
  - Complete billing breakdown (stay cost + QR orders + manual charges)
  - **Payment Method** selector: Cash or QR/Digital
  - Total bill amount
  - **Generate Invoice** → opens thermal receipt modal:
    - 80mm thermal printer compatible format
    - Hotel name header
    - Guest details
    - Itemized billing
    - Grand total
    - **Print Bill** → browser print to thermal printer
    - **Mark Paid** → calls checkout API:
      - Booking marked as `checked_out`
      - Room marked as `dirty` (needs cleaning)
      - Room card instantly removed from billing page (no refresh needed)
      - Toast success confirmation

---

### 5.7 🧾 Invoice / Receipt System

**Thermal Printer Support:**
- Invoice formatted for standard **80mm POS thermal rolls**
- `@page` CSS set to `80mm auto` with zero margins
- Monospace font (`font-mono`) for alignment
- Dashed line separators (standard receipt style)
- Header: Restaurant/Hotel name
- Body: Itemized list with qty × price
- Footer: Grand total + "THANK YOU" greeting
- `window.print()` triggers browser print dialog → select thermal printer

---

## 6. Real-time Architecture

The system uses **Supabase Realtime** (Postgres Change Data Capture) for live updates without page refresh.

### What updates in real-time:
| Event | Who sees it |
|-------|------------|
| New order placed | Kitchen KDS, Waiter panel, Cashier billing |
| Order status changed | Waiter, Customer order tracker |
| Payment verification submitted | Cashier, Admin |
| Table session opened/closed | Waiter, Cashier |
| Room status changed | Cashier rooms grid |
| Booking created/updated | Cashier billing |
| Service request made | Waiter feed |
| New takeout order | Cashier, Waiter |

### How it works:
1. `useRestaurantTable()` hook subscribes to a Supabase Realtime channel filtered by `restaurant_id`
2. On `INSERT` or `UPDATE` events → React state updates immediately
3. UI re-renders without any manual refresh

---

## 7. API Routes (`/api`)

| Route | Purpose |
|-------|---------|
| `/api/bookings` | Create room booking |
| `/api/bookings/checkout` | Check out guest, mark room dirty |
| `/api/bookings/status` | Update booking status |
| `/api/rooms/status` | Update room status (available/dirty/maintenance) |
| `/api/rooms/booking` | Fetch active booking for a room |
| `/api/rooms/charges` | Add/fetch manual stay charges |
| `/api/orders` | Create and manage orders |
| `/api/session` | Open/close table sessions |
| `/api/table-session` | Table session management |
| `/api/staff` | Staff management |
| `/api/day-book/session` | Open/close/get day book session |
| `/api/day-book/entries` | Add/delete day book cash entries |
| `/api/payment-proof` | Upload payment screenshot |
| `/api/service-requests` | Customer service requests |
| `/api/takeout` | Takeout order management |
| `/api/loyalty` | Loyalty points operations |
| `/api/customer` | Customer profile |
| `/api/billing` | Invoice generation |
| `/api/upload` | File upload to Supabase Storage |
| `/api/validate-location` | IP-based location validation |
| `/api/verify-ip` | IP whitelist check |
| `/api/cron` | Scheduled background jobs |
| `/api/webhooks` | External webhook handlers |
| `/api/health` | Health check endpoint |

---

## 8. Progressive Web App (PWA)

The system is a fully installable PWA:
- Service worker via **Serwist** (`src/sw.ts`)
- Offline page caching for staff panels
- Installable on Android/iOS home screen
- Push notification support (for order alerts)
- Works without internet for cached views

---

## 9. Subscription Tiers

The platform has four pricing tiers for restaurants, defined as the single source of truth in `lib/tiers.ts`:

| Tier | Limits (staff / menu items / tables) | Features |
|------|---------------------------------------|---------|
| **Free** | 3 / 20 / 10 | Promo codes, service requests, split billing. No takeout, loyalty, dynamic pricing, ingredient tracking, or staff shifts. |
| **Basic** | 10 / 100 / 30 | Everything in Free, plus takeout ordering. |
| **Pro** | 50 / 500 / 100 | Everything in Basic, plus loyalty, dynamic pricing, ingredient tracking, staff shifts. |
| **Enterprise** | 999 / 9999 / 999 | Everything in Pro, plus multi-language support and hotel mode. |

Super Admin manages subscriptions, and each restaurant's feature access is gated by their tier via `lib/tiers.ts` and `lib/features.ts`.

---

## 10. Security Features

- **Row Level Security** — database-level tenant isolation
- **JWT Auth** — Supabase Auth tokens
- **IP Whitelisting** — optional staff access restriction
- **Rate Limiting** — Upstash Redis on all sensitive APIs
- **Cloudflare Turnstile** — bot protection on public forms
- **Audit Logging** — sensitive actions recorded with user + timestamp
- **Invite-only staff** — no self-registration for staff accounts
- **Role enforcement** — middleware blocks wrong-role access

---

## 11. Complete Feature Matrix

### Restaurant Features
| Feature | Who Can Use |
|---------|------------|
| Digital QR menu | Customer |
| Cart & checkout | Customer |
| Nepal QR payment (eSewa/Khalti) | Customer |
| Service requests (call waiter) | Customer |
| Loyalty points earn & redeem | Customer |
| Promo codes | Customer |
| Order status tracking | Customer |
| Live order KDS | Kitchen |
| Chef item claiming | Kitchen |
| Order delivery management | Waiter |
| Table management | Waiter |
| Takeout management | Waiter/Cashier |
| Cash billing & settlement | Cashier |
| Invoice generation & print | Cashier |
| Thermal receipt printing | Cashier |
| Payment verification | Cashier/Admin |
| Menu management | Admin/Manager |
| Category & item management | Admin/Manager |
| Variations & combos | Admin/Manager |
| Ingredient/stock tracking | Admin/Manager |
| Staff management & invites | Admin/Manager |
| Shift management | Admin/Manager |
| Promo code management | Admin/Manager |
| Loyalty program config | Admin/Manager |
| Theme & branding | Admin/Manager |
| Homepage management | Admin/Manager |
| Analytics & reports | Admin/Manager |
| Day book / cash register | Admin/Manager/Cashier |
| Settings management | Admin/Manager |

### Hotel Features (Additional)
| Feature | Who Can Use |
|---------|------------|
| Room type configuration | Admin/Manager |
| Room management (add/edit rooms) | Admin/Manager |
| Booking history & records | Admin/Manager |
| Room grid with live status | Cashier |
| Book/Reserve a room | Cashier |
| Room status management (open/close/dirty) | Cashier |
| Guest stay details view | Cashier |
| Room service order linking | Cashier (auto) |
| Manual charge addition (minibar etc.) | Cashier |
| Stay billing breakdown | Cashier |
| Room checkout with billing | Cashier |
| Hotel invoice / thermal receipt | Cashier |
| Room billing on billing page | Cashier |
| Payment method selection (Cash/QR) | Cashier |

---

## 12. Workflow Diagrams

### Restaurant Order Flow
```
Customer scans QR
    ↓
Browses QR menu → adds to cart
    ↓
Checkout → selects payment method
    ↓
Cash? → order placed → waiter collects
QR/Digital? → uploads screenshot → verification pending
    ↓
Order appears on Kitchen KDS
    ↓
Chef claims → prepares → marks ready
    ↓
Waiter delivers → marks delivered
    ↓
Cashier settles → session closed → billing done
```

### Hotel Stay Flow
```
Guest arrives → Cashier opens Room tab
    ↓
Clicks Available room → clicks "Book"
    ↓
Fills guest name, phone, KYC, dates → saves
    ↓
Room turns Occupied (blue)
    ↓
During stay: Guest scans room QR → orders food
    (orders auto-linked to room)
    ↓
Guest wants extras: Cashier adds manual charge
    (minibar, laundry, etc.)
    ↓
Checkout: Cashier clicks room → "Go to Billing"
    ↓
Billing page opens room details:
    - Stay cost (base × nights)
    - QR food orders
    - Manual charges
    - Selects payment method
    ↓
Generate Invoice → Print thermal receipt
    ↓
Mark Paid → Room goes to Cleaning (yellow)
    ↓
Housekeeping cleans → Cashier marks Available (green)
```

### Day Book Flow
```
Start of day: Manager opens Day Book
    ↓
Creates new session → enters opening cash balance
    ↓
Throughout day: cashier records entries
    Cash In: room payments, order payments, deposits
    Cash Out: expenses, salary advances, supplier payments
    ↓
End of day: Manager reviews totals
    Total Cash In − Total Cash Out + Opening = Closing Balance
    ↓
Records bank deposit if cash deposited
    ↓
Closes day session
    ↓
Next day: closing balance auto-becomes opening balance
```

---

*Report generated: 2026-07-07 | System: KKKhane Hotel & Restaurant Management Platform*
