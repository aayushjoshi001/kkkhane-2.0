-- Audit trail for supplier bills settled by a Payment Voucher.
--
-- Suppliers Ledger tracks "due" per bill (expenses.description JSON
-- paid_amount), not as an aggregate — so when a voucher settles a supplier's
-- overall outstanding balance (FIFO across bills), each touched bill's
-- paid_amount is mutated in place. Those bill rows leave day_book_entry_id
-- NULL by design (see 20260710020000_ledger_integrity.sql), so deleting the
-- voucher's day_book_entries row would not undo those mutations on its own.
-- This table records exactly which bill(s) a settlement touched and by how
-- much, so deleteVoucherAction can reverse it precisely before the cascade.
CREATE TABLE IF NOT EXISTS "public"."voucher_supplier_settlements" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "restaurant_id" uuid NOT NULL,
    "day_book_entry_id" uuid NOT NULL,
    "expense_id" uuid NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "voucher_supplier_settlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "voucher_supplier_settlements_amount_check" CHECK (("amount" > (0)::numeric))
);

ALTER TABLE "public"."voucher_supplier_settlements" OWNER TO "postgres";

ALTER TABLE ONLY "public"."voucher_supplier_settlements"
    ADD CONSTRAINT "voucher_supplier_settlements_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."voucher_supplier_settlements"
    ADD CONSTRAINT "voucher_supplier_settlements_day_book_entry_id_fkey" FOREIGN KEY ("day_book_entry_id") REFERENCES "public"."day_book_entries"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."voucher_supplier_settlements"
    ADD CONSTRAINT "voucher_supplier_settlements_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "voucher_supplier_settlements_day_book_entry_id_idx"
    ON "public"."voucher_supplier_settlements" ("day_book_entry_id");

CREATE INDEX IF NOT EXISTS "voucher_supplier_settlements_expense_id_idx"
    ON "public"."voucher_supplier_settlements" ("expense_id");

ALTER TABLE "public"."voucher_supplier_settlements" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manager_manage_voucher_supplier_settlements" ON "public"."voucher_supplier_settlements"
    USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())))
    WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));

GRANT ALL ON TABLE "public"."voucher_supplier_settlements" TO "anon";
GRANT ALL ON TABLE "public"."voucher_supplier_settlements" TO "authenticated";
GRANT ALL ON TABLE "public"."voucher_supplier_settlements" TO "service_role";

NOTIFY pgrst, 'reload schema';
