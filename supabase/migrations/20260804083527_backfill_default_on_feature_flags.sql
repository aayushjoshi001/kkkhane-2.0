-- Write out the default-on feature flags that stored settings never wrote.
--
-- resolveFeatureDefaults() in src/lib/tiers.ts already reads an absent one of
-- these as true, and useFeatureEnabled() agrees with it, so this changes no
-- behaviour today. What it removes is the reliance on that: any code path that
-- reads settings.features_v2 directly instead of going through the resolver
-- sees an absent key as false, and that disagreement is what has repeatedly put
-- a link in the nav to a page that redirects straight back.
--
-- The defaults are concatenated on the LEFT so a stored value always wins:
-- jsonb `a || b` lets b override a. Only keys that are genuinely absent get
-- written. A tenant that has deliberately switched one of these off keeps it
-- off -- verified before applying, with zero existing values altered.
--
-- The WHERE clause restricts this to rows actually missing a key, so untouched
-- tenants are not rewritten. There is no trigger on settings, so updated_at is
-- deliberately left alone.
--
-- Companion to 20260727160000_backfill_module_feature_flags.sql, which did the
-- same for the three plan-gated module keys.
update settings s
set features_v2 = jsonb_build_object(
      'promosEnabled',          true,
      'feedbackEnabled',        true,
      'dineInEnabled',          true,
      'serviceRequestsEnabled', true,
      'splitBillingEnabled',    true,
      'printInvoiceEnabled',    true,
      'generateInvoiceEnabled', true,
      'manualEntryEnabled',     true,
      'printBillEnabled',       true,
      'showInvoiceEnabled',     true,
      'kdsEnabled',             true,
      'kotEnabled',             true
    ) || s.features_v2
where s.features_v2 is not null
  and not (s.features_v2 ?& array[
      'promosEnabled', 'feedbackEnabled', 'dineInEnabled',
      'serviceRequestsEnabled', 'splitBillingEnabled', 'printInvoiceEnabled',
      'generateInvoiceEnabled', 'manualEntryEnabled', 'printBillEnabled',
      'showInvoiceEnabled', 'kdsEnabled', 'kotEnabled']);
