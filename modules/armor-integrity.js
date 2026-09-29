export const DEFAULT_ARMOR_INTEGRITY = 10;

/** Older generic items may still have real armor data; new generic items do not. */
export function hasArmorProtection(item) {
    if (item?.type === 'armor') return true;
    if (item?.type !== 'item') return false;
    const formula = String(item.system.armor_value ?? '').trim();
    return Boolean(formula && !(Number.isFinite(Number(formula)) && Number(formula) === 0));
}

export function armorIntegrity(item) {
    const value = item.system.armor_integrity ?? {};
    const max = Math.max(1, Math.floor(Number(value.max) || DEFAULT_ARMOR_INTEGRITY));
    // Existing armor starts intact until it has been damaged or explicitly configured.
    const current = value.value == null ? max : Math.max(0, Math.min(max, Math.floor(Number(value.value) || 0)));
    return { value: current, max };
}

export function armorWear(raw, rolledProtection, typeMultiplier) {
    return Math.max(0, Number(raw) || 0) > 0 && Math.ceil(Math.max(0, rolledProtection) * typeMultiplier) > 0 ? 1 : 0;
}
