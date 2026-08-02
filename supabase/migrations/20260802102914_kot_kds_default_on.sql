-- Turn the kitchen on for every restaurant that never had it written.
--
-- buildFeaturesV2 (src/lib/tiers.ts) had no entry for kotEnabled or kdsEnabled,
-- so both keys were *absent* on every restaurant ever provisioned. Absent
-- kotEnabled reads as off everywhere, and every cashier-side auto-print is
-- gated on it (CashierClient printOutstanding/claimAndPrint, CashierOrdersPanel
-- printConfirmedItems) — so placing an order produced no ticket, no error and
-- no toast. Nothing in the UI could distinguish that from KOT printing simply
-- not being built.
--
-- The two flags used to clear each other, on the theory that a kitchen runs
-- either a screen or a printer. They are independent: the KDS is how the
-- kitchen works a ticket, the printer is how the ticket reaches the pass, and a
-- kitchen may want both. The application no longer forces one off when the
-- other goes on, so this writes both true where the tenant never chose.
--
-- An explicitly stored value is never overwritten — a restaurant that has
-- deliberately switched either half off keeps it off.
UPDATE public.settings s
SET features_v2 = s.features_v2 || jsonb_build_object(
        'kotEnabled', COALESCE((s.features_v2 ->> 'kotEnabled')::boolean, true),
        'kdsEnabled', COALESCE((s.features_v2 ->> 'kdsEnabled')::boolean, true)
    )
WHERE s.features_v2 IS NOT NULL
  AND (
        NOT (s.features_v2 ? 'kotEnabled')
     OR NOT (s.features_v2 ? 'kdsEnabled')
  );
