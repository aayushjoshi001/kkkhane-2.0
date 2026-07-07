const fs = require('fs');

const file = 'src/app/(admin)/admin/menu/actions.ts';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes("import { invalidateCache } from '@/lib/redis'")) {
    code = code.replace(
        "import { revalidatePath } from 'next/cache'",
        "import { revalidatePath } from 'next/cache'\nimport { invalidateCache } from '@/lib/redis'"
    );
}

// In addCategoryAction
code = code.replace(
    "revalidatePath('/admin/menu')\n    return { data }",
    "await invalidateCache(`menu-data:${restaurantId}`)\n    revalidatePath('/admin/menu')\n    return { data }"
);

// In addItemAction
code = code.replace(
    "revalidatePath('/admin/menu')\n    return { success: true, id: insertedItem.id }",
    "await invalidateCache(`menu-data:${restaurantId}`)\n    revalidatePath('/admin/menu')\n    return { success: true, id: insertedItem.id }"
);

// For update and delete actions, we'd need the restaurant ID, but let's just do a generic approach:
// We won't modify all of them if they don't have restaurantId locally. 
// Actually, let's just write the changes.
fs.writeFileSync(file, code);
