-- Tie the "Credit Sale" income row to the receivable transaction that created it.
--
-- Recording a credit charge writes a receivable_transactions row AND an
-- income_entries row recognising the sale. Deleting the charge removed only the
-- first, leaving income the business never earned on the books with no way to
-- find it again -- income_entries carries no reference to its source.
--
-- ON DELETE CASCADE rather than app-side cleanup: the delete path is a plain
-- .delete() in a server action, and anything that removes a receivable
-- transaction by any route should take its recognition with it.

ALTER TABLE public.income_entries
    ADD COLUMN IF NOT EXISTS receivable_transaction_id uuid
        REFERENCES public.receivable_transactions(id) ON DELETE CASCADE;

-- Only rows written by the credit-charge path ever carry this, so the index
-- stays small; it exists for the cascade's own lookup.
CREATE INDEX IF NOT EXISTS income_entries_receivable_transaction_id_idx
    ON public.income_entries (receivable_transaction_id)
    WHERE receivable_transaction_id IS NOT NULL;

COMMENT ON COLUMN public.income_entries.receivable_transaction_id IS
    'Set when this income row recognises a credit sale; deleting that receivable_transactions row deletes this one. NULL for every other income entry.';
