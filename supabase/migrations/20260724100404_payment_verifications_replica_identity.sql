-- Bring payment_verifications in line with every other table the app
-- subscribes to.
--
-- It is the one replicated table still on REPLICA IDENTITY DEFAULT, which puts
-- only the primary key in the WAL pre-image. Two consequences: `payload.old` is
-- unusable, and DELETE events cannot be matched against the shared channel's
-- `restaurant_id=eq.<id>` filter, so they are dropped before they reach a
-- subscriber.
--
-- Nothing is broken today - PaymentVerificationPanel and PaymentVerificationFeed
-- only handle INSERT and UPDATE, both of which carry a full new record. This is
-- pre-emptive: the next handler to branch on a delete, or to read a previous
-- value to decide whether a claim moved out of "pending", would fail silently
-- rather than loudly, which is the hard kind of realtime bug to find.
--
-- Payment claims are low-volume, so the extra WAL is immaterial.

ALTER TABLE ONLY "public"."payment_verifications" REPLICA IDENTITY FULL;
