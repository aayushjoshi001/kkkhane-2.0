# Archived migrations (pre-baseline)

These files are **history only** — the Supabase CLI does not read this folder.

On 2026-07-08 the project switched to a baseline workflow. The core schema was
never captured in migration files (tables were created directly on the
production project before migration tracking started), so a fresh database
could not be built from these files. The full production schema was dumped
into `../migrations/20260708150000_baseline.sql`, which supersedes everything
here. The production migration history table was reset the same day to record
only the baseline; the 51 history rows it previously held (versions
`20260529050222` through `20260707195536`) matched the changes contained in
these files.

Do not move these files back into `migrations/` and do not re-apply them —
their changes are already part of the baseline.
