// eslint-rules/require-tenant-scope.mjs
//
// The tenant-scoping invariant, enforced.
//
// createAdminClient() uses the service-role key, so Postgres RLS does not apply:
// nothing but the query text keeps one restaurant's data out of another's. This
// rule reads every query built on an admin client and fails the ones that touch a
// restaurant_id table without constraining restaurant_id.
//
// What it checks, and what it deliberately cannot:
//
//   ✔ chains rooted at a locally created admin client
//        const supabase = await createAdminClient()
//        supabase.from('orders').select('*')            ← reported
//        supabase.from('orders').select('*').eq('restaurant_id', id)  ← fine
//   ✔ inserts/upserts — the payload must carry restaurant_id
//   ✔ selects/updates/deletes — the chain must filter restaurant_id
//   ✘ a client received as a function parameter. Helpers like
//     resolveActiveDayBookSession(supabase, restaurantId) are handed a client
//     from elsewhere, so the filter belongs to the caller and the callee's chain
//     cannot be judged here.
//   ✘ .rpc(...) — the scoping lives inside the SQL function body.
//   ✘ child tables (order_items, …) — no restaurant_id to filter on; they are
//     only safe when their parent row was tenant-checked first.
//
// Escape hatch, for the queries that genuinely must cross or precede a tenant:
//
//   // tenant-scope-exempt: pre-auth lookup — the tenant is what we are resolving
//   const { data } = await admin.from('users').select('restaurant_id').eq('id', uid)
//
// The reason is required. A bare marker is itself reported, because an unexplained
// exemption is indistinguishable from the bug this rule exists to catch.

import { TENANT_SCOPED_TABLES } from './tenant-tables.mjs'

const TENANT_COLUMN = 'restaurant_id'
const EXEMPT_MARKER = 'tenant-scope-exempt'

// Factories returning a service-role client: RLS off, so the query text is the
// only tenant boundary.
const ADMIN_FACTORIES = new Set(['createAdminClient'])
// Factories that scope every query themselves (see src/lib/supabase/tenant.ts).
const SCOPED_FACTORIES = new Set(['createTenantClient'])

// Filter methods that can pin a column to a value.
const COLUMN_FILTERS = new Set(['eq', 'in', 'filter', 'is'])
const WRITE_METHODS = new Set(['insert', 'upsert'])

/** The bare `foo` of `foo(...)`, or the `bar` of `a.bar(...)`. */
function calleeName(node) {
    if (!node || node.type !== 'CallExpression') return null
    if (node.callee.type === 'Identifier') return node.callee.name
    if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
        return node.callee.property.name
    }
    return null
}

/** Unwraps `await x`, `(x)` and `x!` / `x as T` down to the expression itself. */
function unwrap(node) {
    let cur = node
    for (;;) {
        if (!cur) return cur
        if (cur.type === 'AwaitExpression') { cur = cur.argument; continue }
        if (cur.type === 'TSNonNullExpression' || cur.type === 'TSAsExpression') { cur = cur.expression; continue }
        return cur
    }
}

/** Does this object expression have a `restaurant_id` property? */
function objectSetsTenant(node) {
    if (!node) return false
    if (node.type === 'ArrayExpression') {
        // An insert of many rows is scoped only if every row is.
        const rows = node.elements.filter(Boolean)
        return rows.length > 0 && rows.every(objectSetsTenant)
    }
    if (node.type !== 'ObjectExpression') {
        // A variable or a call — the payload is not visible here. Treated as
        // scoped: the alternative is reporting every `insert(row)` in the repo,
        // which trains people to disable the rule.
        return true
    }
    for (const prop of node.properties) {
        if (prop.type === 'SpreadElement') return true // contents unknown
        const key = prop.key
        if (key?.type === 'Identifier' && key.name === TENANT_COLUMN) return true
        if (key?.type === 'Literal' && key.value === TENANT_COLUMN) return true
    }
    return false
}

/** Is this argument the string 'restaurant_id'? */
function isTenantColumnArg(arg) {
    return arg?.type === 'Literal' && arg.value === TENANT_COLUMN
}

export default {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Require every admin-client query against a restaurant_id table to constrain restaurant_id',
        },
        schema: [
            {
                type: 'object',
                properties: {
                    // Files whose queries legitimately span tenants — the platform
                    // super-admin console, cron jobs iterating every restaurant.
                    allowCrossTenantFiles: { type: 'array', items: { type: 'string' } },
                },
                additionalProperties: false,
            },
        ],
        messages: {
            unscopedRead:
                "'{{table}}' is tenant-scoped, but this query does not constrain {{column}}. A row id alone is not a tenant check — an id from another restaurant would be served. Add .eq('{{column}}', <the caller's restaurant id>), use createTenantClient(), or mark it '{{marker}}: <reason>'.",
            unscopedWrite:
                "'{{table}}' is tenant-scoped, but this {{method}} payload does not set {{column}} — the row lands with no owner (or is rejected by NOT NULL at runtime). Set {{column}}, or use createTenantClient().",
            unscopedUpdate:
                "'{{table}}' is tenant-scoped, but this {{method}} does not constrain {{column}} — it can modify another restaurant's rows. Add .eq('{{column}}', <the caller's restaurant id>), use createTenantClient(), or mark it '{{marker}}: <reason>'.",
            exemptionNeedsReason:
                "'{{marker}}' must be followed by a reason explaining why this query may cross or precede a tenant boundary.",
        },
    },

    create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode()
        const filename = (context.filename ?? context.getFilename()).replace(/\\/g, '/')
        const allowed = context.options[0]?.allowCrossTenantFiles ?? []
        if (allowed.some(frag => filename.includes(frag))) return {}

        // Identifiers bound to an admin client, and to a self-scoping one.
        const adminVars = new Set()
        const scopedVars = new Set()
        // Candidates are judged on Program:exit, so a client declared after its
        // first textual use (a hoisted helper) is still recognised.
        const candidates = []

        /** Walks up from a `.from()` call collecting the method chain built on it. */
        function chainAbove(fromCall) {
            const ancestors = sourceCode.getAncestors
                ? sourceCode.getAncestors(fromCall)
                : context.getAncestors()
            const chain = []
            let cur = fromCall
            for (let i = ancestors.length - 1; i >= 0; i--) {
                const a = ancestors[i]
                if (a.type === 'MemberExpression' && a.object === cur) { cur = a; continue }
                if (a.type === 'TSNonNullExpression' && a.expression === cur) { cur = a; continue }
                if (a.type === 'CallExpression' && a.callee === cur) {
                    const name = cur.type === 'MemberExpression' && cur.property.type === 'Identifier'
                        ? cur.property.name
                        : null
                    chain.push({ name, node: a })
                    cur = a
                    continue
                }
                break
            }
            return chain
        }

        /** The statement a chain lives in — where an exemption comment is looked for. */
        function enclosingStatement(node) {
            let cur = node
            while (cur.parent && !/Statement|Declaration/.test(cur.parent.type)) cur = cur.parent
            return cur.parent ?? cur
        }

        /**
         * Returns 'none' | 'bare' | 'reasoned' for the exemption marker attached to
         * this query. Comments inside the chain and above the statement both count,
         * so a long chain can be annotated at its head.
         */
        function exemptionFor(node) {
            const stmt = enclosingStatement(node)
            const comments = [
                ...sourceCode.getCommentsBefore(stmt),
                ...sourceCode.getCommentsInside(stmt),
                ...sourceCode.getCommentsAfter(stmt),
            ]
            let found = 'none'
            for (const c of comments) {
                const idx = c.value.indexOf(EXEMPT_MARKER)
                if (idx === -1) continue
                const rest = c.value.slice(idx + EXEMPT_MARKER.length).replace(/^[:\s-]+/, '').trim()
                if (rest.length > 0) return 'reasoned'
                found = 'bare'
            }
            return found
        }

        return {
            // const supabase = await createAdminClient()
            VariableDeclarator(node) {
                if (node.id.type !== 'Identifier') return
                const init = unwrap(node.init)
                const name = calleeName(init)
                if (!name) return
                if (ADMIN_FACTORIES.has(name)) adminVars.add(node.id.name)
                else if (SCOPED_FACTORIES.has(name)) scopedVars.add(node.id.name)
            },

            'CallExpression:exit'(node) {
                const callee = node.callee
                if (callee.type !== 'MemberExpression') return
                if (callee.property.type !== 'Identifier' || callee.property.name !== 'from') return

                const table = node.arguments[0]
                if (table?.type !== 'Literal' || typeof table.value !== 'string') return
                if (!TENANT_SCOPED_TABLES.has(table.value)) return

                // Root of the chain: `supabase.from(…)` or `(await createAdminClient()).from(…)`.
                const root = unwrap(callee.object)
                let rootName = null
                if (root.type === 'Identifier') rootName = root.name
                else if (root.type === 'CallExpression') rootName = calleeName(root)
                if (!rootName) return

                const isAdmin = adminVars.has(rootName) || ADMIN_FACTORIES.has(rootName)
                const isScoped = scopedVars.has(rootName) || SCOPED_FACTORIES.has(rootName)
                if (isScoped) return

                candidates.push({
                    node,
                    rootName,
                    table: table.value,
                    chain: chainAbove(node),
                    // Resolved on exit — the declaration may come later in the file.
                    isAdminAtVisit: isAdmin,
                })
            },

            'Program:exit'() {
                for (const c of candidates) {
                    if (scopedVars.has(c.rootName)) continue
                    if (!c.isAdminAtVisit && !adminVars.has(c.rootName)) continue

                    const exemption = exemptionFor(c.node)
                    if (exemption === 'reasoned') continue
                    if (exemption === 'bare') {
                        context.report({
                            node: c.node,
                            messageId: 'exemptionNeedsReason',
                            data: { marker: EXEMPT_MARKER },
                        })
                        continue
                    }

                    const hasTenantFilter = c.chain.some(
                        link =>
                            (COLUMN_FILTERS.has(link.name) && isTenantColumnArg(link.node.arguments[0])) ||
                            (link.name === 'match' && objectSetsTenant(link.node.arguments[0])) ||
                            (link.name === 'or' &&
                                link.node.arguments[0]?.type === 'Literal' &&
                                String(link.node.arguments[0].value).includes(TENANT_COLUMN))
                    )
                    if (hasTenantFilter) continue

                    const write = c.chain.find(link => WRITE_METHODS.has(link.name))
                    if (write) {
                        if (!objectSetsTenant(write.node.arguments[0])) {
                            context.report({
                                node: c.node,
                                messageId: 'unscopedWrite',
                                data: { table: c.table, column: TENANT_COLUMN, method: write.name },
                            })
                        }
                        continue
                    }

                    const mutation = c.chain.find(link => link.name === 'update' || link.name === 'delete')
                    context.report({
                        node: c.node,
                        messageId: mutation ? 'unscopedUpdate' : 'unscopedRead',
                        data: {
                            table: c.table,
                            column: TENANT_COLUMN,
                            marker: EXEMPT_MARKER,
                            method: mutation?.name ?? 'select',
                        },
                    })
                }
            },
        }
    },
}
