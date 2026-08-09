// lib/trial.ts
// The 14-day full-access trial every self-serve tenant starts on.
//
// A trial is not a fourth thing alongside plan and status — it is the ordinary
// pair (`subscription_tier`, `subscription_status`) with `subscription_status`
// set to 'trialing' and `subscription_expires_at` set 14 days out. That keeps
// every existing tier check working untouched: a tenant on trial genuinely *is*
// on TRIAL_TIER for as long as it lasts, so nothing has to learn a new concept
// to grant them the features.
//
// What does need care is the day it runs out. Two things resolve that, and both
// are required:
//   - the daily auto-suspend cron, which persists the downgrade to free, and
//   - effectiveTier() below, which every read path uses so a lapsed trial stops
//     granting anything the moment it lapses rather than whenever the cron next
//     happens to run.
// The cron alone would leave up to 24 hours of free platinum; the read path
// alone would leave the stored tier lying about what the tenant is on.

import type { Tier } from '@/lib/tiers'

/** How long a new tenant gets full access for. */
export const TRIAL_DAYS = 14

/**
 * What "full access" means.
 *
 * Platinum rather than Enterprise: both carry unlimited caps and every module,
 * but Enterprise is the bespoke contact-sales plan and auto-suspend deliberately
 * skips it (it may be billed by hand). Putting a self-serve trial there would
 * make it exempt from expiry — a permanent free top plan for anyone who signs up.
 */
export const TRIAL_TIER: Tier = 'platinum'

/** What a lapsed trial falls back to. */
export const POST_TRIAL_TIER: Tier = 'free'

/** The `subscription_status` value that marks a trial. */
export const TRIAL_STATUS = 'trialing'

/** When a trial starting now should end. */
export function trialExpiryFrom(start: Date = new Date()): string {
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + TRIAL_DAYS)
    return end.toISOString()
}

/** On a trial that has not run out yet. */
export function isTrialing(
    status: string | null | undefined,
    expiresAt: string | null | undefined,
): boolean {
    if (status !== TRIAL_STATUS) return false
    if (!expiresAt) return true
    return new Date(expiresAt).getTime() > Date.now()
}

/** Was on a trial, and it has run out. */
export function trialHasLapsed(
    status: string | null | undefined,
    expiresAt: string | null | undefined,
): boolean {
    if (status !== TRIAL_STATUS) return false
    if (!expiresAt) return false
    return new Date(expiresAt).getTime() <= Date.now()
}

/**
 * The plan a tenant is actually entitled to right now.
 *
 * Identical to the stored tier in every case except one: a trial that has run
 * out but has not yet been written down as free by the cron. Read paths call
 * this instead of reading `subscription_tier` directly so that the gap between
 * "the trial ended" and "the nightly job noticed" grants nothing.
 */
export function effectiveTier(
    tier: string | null | undefined,
    status: string | null | undefined,
    expiresAt: string | null | undefined,
): string | null | undefined {
    return trialHasLapsed(status, expiresAt) ? POST_TRIAL_TIER : tier
}

/**
 * Whole days left on the trial, floored at 0.
 *
 * Rounded up, because a trial with six hours left should read "1 day left"
 * rather than "0 days left" while it is still working.
 */
export function trialDaysRemaining(expiresAt: string | null | undefined): number {
    if (!expiresAt) return 0
    const ms = new Date(expiresAt).getTime() - Date.now()
    if (ms <= 0) return 0
    return Math.ceil(ms / 86_400_000)
}

/**
 * How long a tenant keeps being told their trial ended before the notice goes
 * away. Long enough to be a real prompt, short enough that a venue which has
 * settled happily onto Free is not nagged forever.
 */
export const TRIAL_ENDED_NOTICE_DAYS = 30

/** How many days out the countdown starts sounding urgent. */
export const TRIAL_URGENT_DAYS = 3

export type TrialState =
    | { kind: 'none' }
    | { kind: 'active'; daysRemaining: number; endsAt: string; urgent: boolean }
    | { kind: 'ended'; endedAt: string }

/**
 * What, if anything, to tell this tenant about their trial.
 *
 * The single place the banner's three cases are decided, so the copy and the
 * gating cannot drift apart.
 *
 * Note the second branch: a trial whose expiry has passed reads as 'ended' even
 * while the row still says 'trialing', because the nightly cron has not run
 * yet. That matches what the tenant is actually experiencing — effectiveTier()
 * has already stopped granting the plan — rather than what the row says.
 */
export function trialState(input: {
    tier: string | null | undefined
    status: string | null | undefined
    expiresAt: string | null | undefined
    trialEndsAt: string | null | undefined
}): TrialState {
    const { tier, status, expiresAt, trialEndsAt } = input

    if (status === TRIAL_STATUS) {
        if (isTrialing(status, expiresAt)) {
            const daysRemaining = trialDaysRemaining(expiresAt)
            return {
                kind: 'active',
                daysRemaining,
                endsAt: expiresAt ?? trialEndsAt ?? '',
                urgent: daysRemaining <= TRIAL_URGENT_DAYS,
            }
        }
        // Lapsed, but the cron has not written the downgrade down yet.
        const endedAt = expiresAt ?? trialEndsAt
        return endedAt ? { kind: 'ended', endedAt } : { kind: 'none' }
    }

    // Downgraded already. Only worth saying to a tenant who is now on Free —
    // one who upgraded to a paid plan mid-trial got what the trial was for, and
    // does not need telling it is over.
    if (!trialEndsAt || tier !== POST_TRIAL_TIER) return { kind: 'none' }

    const endedMsAgo = Date.now() - new Date(trialEndsAt).getTime()
    if (endedMsAgo <= 0) return { kind: 'none' }
    if (endedMsAgo > TRIAL_ENDED_NOTICE_DAYS * 86_400_000) return { kind: 'none' }

    return { kind: 'ended', endedAt: trialEndsAt }
}
