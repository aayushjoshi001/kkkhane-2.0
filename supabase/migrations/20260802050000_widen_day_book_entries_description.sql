-- day_book_entries.description doubles as a JSON payload for vouchers
-- (createVoucherAction) that carry full cheque details — written name,
-- issuer bank, cheque number/date/type, plus the usual voucher fields.
-- The original 500-char cap was sized for a plain text description and
-- silently rejects any reasonably detailed cheque voucher (confirmed by the
-- new "Bank to Hotel Cash" cheque flow in Manual Entry). Widened well past
-- what a JSON-packed description realistically needs.
ALTER TABLE "public"."day_book_entries"
    DROP CONSTRAINT "day_book_entries_description_check";

ALTER TABLE "public"."day_book_entries"
    ADD CONSTRAINT "day_book_entries_description_check"
    CHECK ((char_length(description) >= 1) AND (char_length(description) <= 5000));
