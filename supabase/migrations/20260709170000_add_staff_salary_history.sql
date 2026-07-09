-- Time-bounded salary history: one row per (user, salary, effective period).
-- effective_to = NULL means "still in effect until the manager changes it".
-- Salary accrual (lib/payroll.ts) looks up the rate that covers each day
-- worked from this table, falling back to users.monthly_salary for staff who
-- have never had a recorded change.
CREATE TABLE IF NOT EXISTS "public"."staff_salary_history" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "restaurant_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "monthly_salary" numeric(12,2) NOT NULL,
    "effective_from" date NOT NULL,
    "effective_to" date,
    "created_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "staff_salary_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_salary_history_salary_check" CHECK (("monthly_salary" >= 0)),
    CONSTRAINT "staff_salary_history_date_check" CHECK (("effective_to" IS NULL OR "effective_to" >= "effective_from"))
);

ALTER TABLE "public"."staff_salary_history" OWNER TO "postgres";

ALTER TABLE ONLY "public"."staff_salary_history"
    ADD CONSTRAINT "staff_salary_history_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."staff_salary_history"
    ADD CONSTRAINT "staff_salary_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."staff_salary_history"
    ADD CONSTRAINT "staff_salary_history_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "staff_salary_history_user_period_idx" ON "public"."staff_salary_history" ("user_id", "effective_from", "effective_to");

-- Enable Row Level Security (RLS)
ALTER TABLE "public"."staff_salary_history" ENABLE ROW LEVEL SECURITY;

-- Add RLS Policies (mirrors staff_ledger's access model)
CREATE POLICY "manager_manage_staff_salary_history" ON "public"."staff_salary_history"
    USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::text, 'super_admin'::text])) AND ("restaurant_id" = "public"."current_restaurant_id"())))
    WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::text, 'super_admin'::text])) AND ("restaurant_id" = "public"."current_restaurant_id"())));

CREATE POLICY "staff_read_own_salary_history" ON "public"."staff_salary_history"
    FOR SELECT
    USING (("user_id" = auth.uid()));
