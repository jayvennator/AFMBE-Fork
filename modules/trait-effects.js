/** Explicit catalog rules. The item description is never parsed as executable mechanics. */
const text = value => String(value ?? '').trim().toLocaleLowerCase();
function matches(effect, context) {
    if (!Array.isArray(effect.contexts) || !effect.contexts.includes(context.kind)) return false;
    for (const [rule, current] of [['weaponNames', context.weaponName], ['skillNames', context.skillName],
        ['attributes', context.attribute], ['modes', context.mode]]) {
        if (effect[rule]?.length && !effect[rule].some(needle => text(current).includes(text(needle)))) return false;
    }
    return true;
}
export function traitRollEffects(actor, context) {
    const applications = [];
    const seen = new Set();
    for (const item of actor.items) {
        if (!['quality', 'drawback'].includes(item.type)) continue;
        // Two copies of the same named trait do not grant the same roll bonus twice.
        const key = `${item.type}:${text(item.name)}`;
        if (seen.has(key)) continue;
        for (const effect of item.system.autoRollEffects ?? []) {
            const value = Number(effect.value);
            if (!Number.isFinite(value) || !matches(effect, context)) continue;
            applications.push({ itemId: item.id, name: item.name, value });
            seen.add(key);
        }
    }
    return { applications, total: applications.reduce((sum, entry) => sum + entry.value, 0),
        appliedIds: new Set(applications.map(entry => entry.itemId)) };
}
export function manualTraitValue(item, automatic) {
    if (!item || automatic.appliedIds.has(item.id)) return 0;
    const raw = Number(item.system.bonus);
    if (!Number.isFinite(raw)) return 0;
    return item.type === 'drawback' ? -Math.abs(raw) : raw;
}
export function traitSummary(automatic, quality, drawback, escape) {
    const signed = value => `${value >= 0 ? '+' : ''}${value}`;
    const parts = automatic.applications.map(entry => `${escape(entry.name)} ${signed(entry.value)} (automatic)`);
    if (quality) parts.push(`${escape(quality.name)} ${signed(manualTraitValue(quality, automatic))}${automatic.appliedIds.has(quality.id) ? ' (already applied)' : ' (manual)'}`);
    if (drawback) parts.push(`${escape(drawback.name)} ${signed(manualTraitValue(drawback, automatic))}${automatic.appliedIds.has(drawback.id) ? ' (already applied)' : ' (manual)'}`);
    return parts.length ? parts.join('; ') : 'None';
}
