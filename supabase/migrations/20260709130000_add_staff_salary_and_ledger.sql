-- Add monthly_salary to users table
ALTER TABLE "public"."users" ADD COLUMN IF NOT EXISTS "monthly_salary" numeric(12,2) DEFAULT 0.00 NOT NULL;

-- Create staff_ledger table
CREATE TABLE IF NOT EXISTS "public"."staff_ledger" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "restaurant_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "entry_type" text NOT NULL, -- 'salary_payout', 'advance_payment', 'bonus', 'deduction', 'accrual'
    "payment_method" text, -- 'cash', 'bank_transfer', 'qr_digital'
    "note" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_by" uuid,
    CONSTRAINT "staff_ledger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_ledger_entry_type_check" CHECK (("entry_type" = ANY (ARRAY['salary_payout'::text, 'advance_payment'::text, 'bonus'::text, 'deduction'::text, 'accrual'::text]))),
    CONSTRAINT "staff_ledger_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'qr_digital'::text])))
);

ALTER TABLE "public"."staff_ledger" OWNER TO "postgres";

-- Add foreign key constraints
ALTER TABLE ONLY "public"."staff_ledger"
    ADD CONSTRAINT "staff_ledger_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."staff_ledger"
    ADD CONSTRAINT "staff_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."staff_ledger"
    ADD CONSTRAINT "staff_ledger_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;

-- Enable Row Level Security (RLS)
ALTER TABLE "public"."staff_ledger" ENABLE ROW LEVEL SECURITY;

-- Add RLS Policies
CREATE POLICY "manager_manage_staff_ledger" ON "public"."staff_ledger"
    USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::text, 'super_admin'::text])) AND ("restaurant_id" = "public"."current_restaurant_id"())))
    WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::text, 'super_admin'::text])) AND ("restaurant_id" = "public"."current_restaurant_id"())));

CREATE POLICY "staff_read_own_ledger" ON "public"."staff_ledger"
    FOR SELECT
    USING (("user_id" = auth.uid()));
