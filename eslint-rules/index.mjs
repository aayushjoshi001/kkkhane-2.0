// eslint-rules/index.mjs
// Local ESLint plugin for this repo's own invariants.
import requireTenantScope from './require-tenant-scope.mjs'

export default {
    rules: {
        'require-tenant-scope': requireTenantScope,
    },
}
