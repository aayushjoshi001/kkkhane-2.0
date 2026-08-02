-- Modifier groups/options have existed in the schema, in lib/menu-cache.ts and
-- in the customer + KOT rendering since the baseline, but nothing could ever
-- create one: /admin/menu has no modifier UI, so the only way to get a row in
-- was raw SQL. Wiring up that editor needs one thing the schema doesn't have —
-- a way to remove an option.
--
-- order_item_modifiers.modifier_id is ON DELETE RESTRICT (deliberately: a past
-- order must keep naming what it charged for). So the moment an option has been
-- ordered once it can never be deleted, and deleting its group cascades into
-- the same RESTRICT and fails the whole statement. Without a soft-delete the
-- editor would offer a Remove button that throws a foreign-key error on exactly
-- the options a busy restaurant most wants to retire.
--
-- is_archived is that soft delete, and it is deliberately NOT is_available:
--   is_available = false → temporarily off (out of stock tonight), still in the
--                          editor, manager flips it back
--   is_archived  = true  → removed for good; hidden from the editor and the
--                          menu, but the row survives so old bills still read
--                          correctly.
-- The actions layer hard-deletes when there is no order history and archives
-- when there is, so a restaurant that mistypes an option still gets a clean
-- delete rather than accumulating tombstones.

ALTER TABLE "public"."menu_item_modifier_groups"
    ADD COLUMN IF NOT EXISTS "is_archived" boolean NOT NULL DEFAULT false;

ALTER TABLE "public"."menu_item_modifiers"
    ADD COLUMN IF NOT EXISTS "is_archived" boolean NOT NULL DEFAULT false;

-- Both read paths (menu-cache and the admin editor) filter on this, and always
-- alongside the parent key, so it belongs in the existing lookup indexes rather
-- than in indexes of its own.
DROP INDEX IF EXISTS "public"."idx_modifier_groups_menu_item";
CREATE INDEX "idx_modifier_groups_menu_item"
    ON "public"."menu_item_modifier_groups" USING "btree" ("menu_item_id", "is_archived");

DROP INDEX IF EXISTS "public"."idx_modifiers_group";
CREATE INDEX "idx_modifiers_group"
    ON "public"."menu_item_modifiers" USING "btree" ("group_id", "is_archived");
