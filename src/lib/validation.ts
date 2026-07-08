/**
 * Runtime Input Validation Schemas
 * ─────────────────────────────────────────────────────────────
 * Centralized zod schemas for all API routes and server actions.
 * Prevents malicious users from manipulating orders, payments, etc.
 */

import { z } from 'zod'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UUID & Common Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const UUID = z.string().uuid('Invalid UUID format')
const EMAIL = z.string().email('Invalid email address').max(255)

// Exported raw patterns — shared with client-side inline validation (e.g.
// OnboardingCreateClient.tsx) so both sides check the exact same rules
// instead of maintaining duplicate regexes that can drift apart.
export const PHONE_REGEX = /^\+?[\d\s\-()]{7,}$/
export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const PAN_REGEX = /^\d{9}$/
export const VAT_REGEX = /^\d{9}$/

const PHONE = z.string().regex(PHONE_REGEX, 'Invalid phone format')
const POSITIVE_INT = z.number().int().positive('Must be a positive integer')
const POSITIVE_DECIMAL = z.number().positive('Must be a positive number')
const URL_STRING = z.string().url('Invalid URL').max(2048)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ORDERS & CHECKOUT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const OrderItemSchema = z.object({
  menu_item_id: UUID,
  quantity: z.number().int().min(1).max(1000, 'Quantity cannot exceed 1000'),
  special_request: z.string().max(500, 'Special request too long').nullable().optional(),
  modifiers: z.array(z.object({
    modifier_id: UUID
  })).optional().default([])
})

export const PlaceOrderSchema = z.object({
  sessionId: z.string().min(1, 'Session ID required'),
  restaurantSlug: z.string().min(1).max(100),
  items: z.array(OrderItemSchema).min(1, 'At least one item required'),
  customerNote: z.string().max(500, 'Note too long').nullable().optional(),
  promoCode: z.string().max(50).nullable().optional(),
  loyaltyMemberId: UUID.nullable().optional()
})

export const OrderQuerySchema = z.object({
  restaurant_id: UUID,
  status: z.enum(['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'] as const).optional(),
  limit: z.number().int().min(1).max(100).default(50)
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PAYMENTS (QR Screenshot Upload + Cash)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const PaymentClaimSchema = z.object({
  restaurantId: UUID,
  orderId: UUID.optional(),
  amount: POSITIVE_DECIMAL.max(999999, 'Amount too large'),
  paymentMethod: z.enum(['qr_scan', 'esewa', 'khalti', 'fonepay', 'cash']),
  phone: PHONE.optional(),
  screenshot: z.instanceof(File)
    .refine(f => f.size <= 10 * 1024 * 1024, 'Screenshot must be under 10MB')
    .refine(f => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type), 'Screenshot must be JPEG, PNG, or WebP')
    .optional()
})

// Keep old name as alias for backward compat with existing imports
export const NepalPaymentSchema = PaymentClaimSchema

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LOYALTY PROGRAM
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const LoyaltyMemberSchema = z.object({
  restaurant_id: UUID,
  phone: PHONE,
  email: EMAIL.optional(),
  full_name: z.string().min(2).max(255, 'Name too long'),
  tier: z.enum(['bronze', 'silver', 'gold', 'platinum']).default('bronze')
})

export const RedeemPointsSchema = z.object({
  loyaltyMemberId: UUID,
  pointsToRedeem: POSITIVE_INT.min(1),
  restaurantId: UUID
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MENU MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const MenuItemSchema = z.object({
  restaurant_id: UUID,
  category_id: UUID,
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  price: POSITIVE_DECIMAL.max(999999),
  preparation_min: POSITIVE_INT.max(300).optional(),
  preparation_max: POSITIVE_INT.max(300).optional(),
  is_available: z.boolean().default(true),
  image_url: URL_STRING.optional(),
  allergens: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([])
})

export const CreateCategorySchema = z.object({
  restaurant_id: UUID,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  display_order: POSITIVE_INT.optional()
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STAFF MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const CreateStaffSchema = z.object({
  restaurant_id: UUID,
  email: EMAIL,
  full_name: z.string().min(2).max(255),
  role_id: z.number().int().min(1).max(10, 'Invalid role'),
  department_id: UUID.optional().nullable(),
  phone: PHONE.optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128)
})

export const UpdateStaffSchema = z.object({
  restaurant_id: UUID,
  user_id: UUID,
  full_name: z.string().min(2).max(255).optional(),
  role_id: z.number().int().min(1).max(10).optional(),
  is_active: z.boolean().optional()
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROMO CODES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const PromoCodeSchema = z.object({
  restaurant_id: UUID,
  code: z.string().min(3).max(50).toUpperCase(),
  description: z.string().max(500).optional(),
  discount_percentage: z.number().min(0).max(100).optional(),
  discount_amount: POSITIVE_DECIMAL.optional(),
  min_order_value: POSITIVE_DECIMAL.default(0),
  max_uses: POSITIVE_INT.optional(),
  valid_from: z.coerce.date().optional(),
  valid_until: z.coerce.date().optional(),
  is_active: z.boolean().default(true)
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TABLES & SESSIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const CreateTableSchema = z.object({
  restaurant_id: UUID,
  number: POSITIVE_INT.max(9999),
  capacity: POSITIVE_INT.min(1).max(50),
  description: z.string().max(200).optional(),
  is_active: z.boolean().default(true)
})

export const CreateSessionSchema = z.object({
  restaurant_id: UUID,
  table_id: UUID,
  guest_count: POSITIVE_INT.min(1).max(50).optional(),
  notes: z.string().max(500).optional()
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TENANT MANAGEMENT (SaaS)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const CreateTenantSchema = z.object({
  restaurantName: z.string().min(2).max(255),
  restaurantSlug: z.string().min(2).max(100)
    .regex(SLUG_REGEX, 'Slug must be lowercase alphanumeric with hyphens'),
  ownerFullName: z.string().min(2).max(255),
  ownerEmail: EMAIL,
  ownerPassword: z.string().min(8, 'Password must be 8+ characters').max(128),
  contactPhone: PHONE.optional(),
  address: z.string().max(500).optional(),
  subscriptionTier: z.enum(['free', 'basic', 'pro', 'enterprise']).default('free'),
  businessType: z.string().optional()
})

export const UpdateTenantSchema = z.object({
  restaurant_id: UUID,
  subscription_tier: z.enum(['free', 'basic', 'pro', 'enterprise']).optional(),
  subscription_status: z.enum(['active', 'past_due', 'suspended', 'cancelled']).optional(),
  custom_domain: z.string().max(255).optional()
})

export const UpdateOwnerContactSchema = z.object({
  userId: UUID,
  email: EMAIL.optional(),
  phone: PHONE.optional()
})

// Public self-service signup — extends CreateTenantSchema with Nepal business fields
export const PublicSignupSchema = CreateTenantSchema.extend({
  panNumber:       z.string().regex(PAN_REGEX, 'PAN must be 9 digits').optional().or(z.literal('')),
  vatRegistered:   z.boolean().optional().default(false),
  vatNumber:       z.string().regex(VAT_REGEX, 'VAT number must be 9 digits').optional().or(z.literal('')),
  slogan:          z.string().max(120).optional().or(z.literal('')),
  restaurantEmail: z.string().email('Invalid email').optional().or(z.literal('')),
  telephone:       z.string().max(20).optional().or(z.literal('')),
  latitude:        z.number().optional(),
  longitude:       z.number().optional(),
})

// The authenticated onboarding/create form collects only restaurant/business
// fields — the owner's name/email/password were already collected at signup —
// so this reuses PublicSignupSchema's field validation minus the account fields,
// plus businessType (which PublicSignupSchema has no concept of) and a rule
// requiring an actual VAT number once "VAT Registered" is checked.
export const OnboardingRestaurantSchema = PublicSignupSchema
  .omit({ ownerFullName: true, ownerEmail: true, ownerPassword: true })
  .extend({ businessType: z.string().max(50).optional() })
  .superRefine((data, ctx) => {
    if (data.vatRegistered && !data.vatNumber) {
      ctx.addIssue({ code: 'custom', path: ['vatNumber'], message: 'VAT number is required when VAT registered is checked' })
    }
  })

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LOGIN & AUTH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const LoginSchema = z.object({
  email: EMAIL,
  password: z.string().min(1, 'Password required')
})

export const SignupSchema = z.object({
  email: EMAIL,
  password: z.string().min(8, 'Password must be 8+ characters'),
  fullName: z.string().min(2).max(255)
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SETTINGS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const UpdateSettingsSchema = z.object({
  restaurant_id: UUID,
  theme: z.object({
    primaryColor: z.string().regex(/^#[0-9A-F]{6}$/i, 'Invalid hex color'),
    secondaryColor: z.string().regex(/^#[0-9A-F]{6}$/i),
    fontFamily: z.string().max(50)
  }).optional(),
  features_v2: z.record(z.string(), z.boolean()).optional()
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SERVICE REQUESTS (Waiter Call)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const CreateServiceRequestSchema = z.object({
  session_id: z.string().min(1),
  restaurant_id: UUID,
  type: z.enum(['waiter', 'check', 'cleanup', 'support']),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  notes: z.string().max(500).optional()
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// QUERY PARAMETERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const PaginationSchema = z.object({
  page: POSITIVE_INT.default(1),
  limit: z.number().int().min(1).max(100).default(20)
})

export const SearchSchema = z.object({
  q: z.string().max(255).optional(),
  restaurant_id: UUID.optional()
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UTILITY: Safe Parse with Error Messages
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HOMEPAGE & THEMES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const UpdateHomepageSchema = z.object({
  restaurant_id: UUID,
  template: z.enum(['modern', 'elegant', 'vibrant', 'minimal', 'classic']),
  is_active: z.boolean().default(true),
  hero_title: z.string().min(1).max(200),
  hero_subtitle: z.string().max(500).optional(),
  hero_image_url: z.string().url().optional().nullable(),
  hero_video_url: z.string().url().optional().nullable(),
  hero_cta_text: z.string().max(50).optional(),
  about_section_enabled: z.boolean().default(true),
  about_title: z.string().max(200).optional(),
  about_description: z.string().max(1000).optional(),
  about_image_url: z.string().url().optional().nullable(),
  features_enabled: z.boolean().default(true),
  features: z.array(z.object({
    id: UUID,
    title: z.string().min(1).max(100),
    description: z.string().max(300),
    icon: z.string().max(10),
    order: z.number().int().min(0)
  })).max(10),
  theme: z.object({
    primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    secondaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    textColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    fontFamily: z.string().max(100)
  }),
  cta_section_enabled: z.boolean().default(true),
  cta_title: z.string().max(200).optional(),
  cta_text: z.string().max(500).optional(),
  cta_button_text: z.string().max(50).optional(),
  footer_enabled: z.boolean().default(true),
  footer_text: z.string().max(500).optional(),
  social_links: z.array(z.object({
    platform: z.string().max(50),
    url: z.string().url()
  })).max(10)
})

export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): { 
  success: boolean
  data?: T
  error?: string
} {
  try {
    const validated = schema.parse(data)
    return { success: true, data: validated }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
      return { success: false, error: messages }
    }
    return { success: false, error: 'Validation failed' }
  }
}
