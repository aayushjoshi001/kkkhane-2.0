-- Daily staff attendance: one row per (user, date). Marking "In" sets status
-- to 'present'; marking "Out" sets status to 'absent' with an optional reason.
-- Re-marking the same day updates the existing row (upsert on user_id+date).
CREATE TABLE IF NOT EXISTS "public"."staff_attendance" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "restaurant_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "date" date NOT NULL,
    "status" text NOT NULL, -- 'present', 'absent'
    "reason" text,
    "marked_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "staff_attendance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_attendance_status_check" CHECK (("status" = ANY (ARRAY['present'::text, 'absent'::text]))),
    CONSTRAINT "staff_attendance_user_date_unique" UNIQUE ("user_id", "date")
);

ALTER TABLE "public"."staff_attendance" OWNER TO "postgres";

ALTER TABLE ONLY "public"."staff_attendance"
    ADD CONSTRAINT "staff_attendance_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."staff_attendance"
    ADD CONSTRAINT "staff_attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."staff_attendance"
    ADD CONSTRAINT "staff_attendance_marked_by_fkey" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "staff_attendance_restaurant_date_idx" ON "public"."staff_attendance" ("restaurant_id", "date");

-- Enable Row Level Security (RLS)
ALTER TABLE "public"."staff_attendance" ENABLE ROW LEVEL SECURITY;

-- Add RLS Policies (mirrors staff_ledger's access model)
CREATE POLICY "manager_manage_staff_attendance" ON "public"."staff_attendance"
    USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::text, 'super_admin'::text])) AND ("restaurant_id" = "public"."current_restaurant_id"())))
    WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::text, 'super_admin'::text])) AND ("restaurant_id" = "public"."current_restaurant_id"())));

CREATE POLICY "staff_read_own_attendance" ON "public"."staff_attendance"
    FOR SELECT
    USING (("user_id" = auth.uid()));
