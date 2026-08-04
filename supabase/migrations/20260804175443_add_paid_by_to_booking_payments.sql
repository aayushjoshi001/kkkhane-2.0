-- Who actually handed over the money.
--
-- booking_payments records created_by, which is the staff member who took the
-- payment, and that is all it has ever recorded. On a combined reservation the
-- payer is a real question: several rooms share one folio, each with its own
-- occupant, and when they settle separately the desk needs to be able to say
-- afterwards which guest paid for which room. Without this the only evidence is
-- the note, which reads 'Settlement' on every row.
--
-- Free text, and nullable: it is a name a cashier types, not a foreign key --
-- the payer is frequently not any of the guests on the booking (a company, a
-- relative, the colleague who organised the trip). Existing rows keep NULL,
-- which reads correctly as "not recorded".
alter table public.booking_payments
    add column if not exists paid_by text;

comment on column public.booking_payments.paid_by is
    'Name of the person who paid, as typed by the cashier. Distinct from created_by, which is the staff member who took it. Used when rooms on a combined reservation settle separately.';
