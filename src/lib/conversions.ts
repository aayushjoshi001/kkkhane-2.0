export interface IngredientDensity {
    keywords: string[];
    density: number; // grams per milliliter
}

export const INGREDIENT_DENSITIES: IngredientDensity[] = [
    { keywords: ['salt', 'nun'], density: 1.2 }, // 1 tbsp ≈ 18g
    { keywords: ['sugar', 'chini'], density: 0.85 }, // 1 tbsp ≈ 12.5g
    { keywords: ['pickle', 'achar'], density: 1.0 }, // 1 tbsp ≈ 15g
    { keywords: ['honey', 'syrup', 'maha'], density: 1.4 }, // 1 tbsp ≈ 21g
    { keywords: ['spice', 'cumin', 'jeera', 'turmeric', 'besar', 'chili', 'masala', 'pepper', 'powder', 'coriander', 'dhaniya'], density: 0.4 }, // 1 tbsp ≈ 6g
    { keywords: ['oil', 'ghee', 'butter', 'tel'], density: 0.92 }, // 1 tbsp ≈ 13.8g
    { keywords: ['sauce', 'ketchup', 'mayo', 'mustard', 'vinegar', 'paste'], density: 1.05 }, // 1 tbsp ≈ 15.8g
    { keywords: ['baking powder', 'baking soda', 'yeast'], density: 0.8 }, // 1 tbsp ≈ 12g
];

// Standard volume in milliliters
export const UNIT_VOLUMES: Record<string, number> = {
    tbsp: 15.0,
    tsp: 5.0,
    cup: 240.0,
    ml: 1.0,
    L: 1000.0,
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function getDensityForIngredient(name: string): number {
    const lowerName = name.toLowerCase();
    for (const item of INGREDIENT_DENSITIES) {
        // Match keywords on word boundaries so e.g. "Boiled Egg" doesn't match
        // "oil" and "Sugarcane" doesn't match "sugar". Substring matching gave
        // the wrong density (and thus wrong stock deduction) for such names.
        if (item.keywords.some(kw => new RegExp(`\\b${escapeRegExp(kw)}\\b`).test(lowerName))) {
            return item.density;
        }
    }
    return 1.0; // Default to water density (1g = 1ml)
}

/**
 * Converts a given quantity from a volume/weight unit to the target base unit of the stock item.
 * @param ingredientName Name of the ingredient (for density lookup)
 * @param quantity Quantity input by user
 * @param fromUnit Unit input by user ('tbsp', 'tsp', 'cup', 'ml', 'L', 'g', 'kg', 'pcs')
 * @param targetUnit Base unit of the stock item ('g', 'kg', 'ml', 'L', 'pcs', etc.)
 */
export function convertToStockUnit(
    ingredientName: string,
    quantity: number,
    fromUnit: string,
    targetUnit: string
): number {
    if (fromUnit === targetUnit) return quantity;

    const density = getDensityForIngredient(ingredientName);
    
    // Normalize target unit to lowercase
    const tgt = targetUnit.toLowerCase();
    const src = fromUnit.toLowerCase();

    // Prevent cross-conversion between liquid volume (ml, L) and weight (g, kg)
    const isLiquidSrc = ['ml', 'l'].includes(src);
    const isWeightTgt = ['g', 'kg'].includes(tgt);
    const isWeightSrc = ['g', 'kg'].includes(src);
    const isLiquidTgt = ['ml', 'l'].includes(tgt);

    if ((isLiquidSrc && isWeightTgt) || (isWeightSrc && isLiquidTgt)) {
        return quantity;
    }

    // 1. Convert source quantity to a base reference: milliliters (ml) for volume, grams (g) for weight
    let ml = 0;
    let g = 0;
    const isVolume = ['tbsp', 'tsp', 'cup', 'ml', 'l'].includes(src);
    const isWeight = ['g', 'kg'].includes(src);

    if (isVolume) {
        const factor = UNIT_VOLUMES[src === 'l' ? 'L' : src] || 1.0;
        ml = quantity * factor;
        // If target is weight, convert ml to g using density
        g = ml * density;
    } else if (isWeight) {
        g = quantity * (src === 'kg' ? 1000 : 1);
        // If target is volume, convert g to ml using density
        ml = g / density;
    } else {
        // Pieces (pcs) or other non-convertibles
        return quantity;
    }

    // 2. Convert from base reference (ml/g) to target unit
    if (tgt === 'kg') {
        return g / 1000;
    } else if (tgt === 'g') {
        return g;
    } else if (tgt === 'l') {
        return ml / 1000;
    } else if (tgt === 'ml') {
        return ml;
    }

    return quantity;
}
