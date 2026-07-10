-- expenses.bank_account_id and income_entries.bank_account_id columns already
-- exist in the baseline schema, but were never given a foreign key to
-- bank_accounts, so PostgREST can't resolve `.select('*, bank_accounts(*)')`
-- embeds on these tables ("Could not find a relationship..." error).
ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."income_entries"
    ADD CONSTRAINT "income_entries_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
