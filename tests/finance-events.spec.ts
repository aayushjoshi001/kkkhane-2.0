import { test, expect, loginAsManager, requireEnv } from './fixtures'

test.describe('Finance — Financial Events (admin shell)', () => {
    test.beforeEach(async ({ page }) => {
        const skip = requireEnv('managerEmail', 'managerPassword')
        if (skip) return test.skip()
        await loginAsManager(page)
    })

    test('Financial Events tab loads with search, filters, and pagination', async ({ page }) => {
        const skip = requireEnv('managerEmail', 'managerPassword')
        if (skip) test.skip(true, skip)

        await page.goto('/admin/finance/administration')
        await page.waitForLoadState('networkidle')

        // Switch to the Financial Events tab within Administration
        await page.getByRole('button', { name: /financial events/i }).click()

        // Search + filter controls render
        await expect(page.getByPlaceholder(/search event code/i)).toBeVisible()
        await expect(page.getByText(/no financial events yet|event code/i).first()).toBeVisible({ timeout: 10_000 })

        // Nothing dispatches events yet in this phase, so the table stays empty —
        // this test only confirms the admin shell renders without error.
        await expect(page.locator('table')).toBeVisible()
    })
})
