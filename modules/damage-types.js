// Keep numeric selections from older weapon sheets valid alongside named damage types.
const LEGACY = ['none', 'twoHanded', 'slashing', 'stabbing', 'bullets', 'hollowPoint', 'armorPiercing', 'shotgun', 'explosive', 'poison', 'corrosive'];
export function damageType(value) {
    const key = String(value ?? 'none');
    return /^\d+$/.test(key) ? (LEGACY[Number(key)] ?? 'none') : key;
}
export function hitBonus(value) {
    const type = damageType(value);
    return type === 'birdshot' ? 2 : ['buckshot', 'shotgun', 'twoHanded', 'slashing', 'stabbing'].includes(type) ? 1 : 0;
}
export function damageModifiers(value) {
    switch (damageType(value)) {
        case 'bullets': case 'slug': return { armor: 1, hp: 2 };
        case 'hollowPoint': return { armor: 2, hp: 3 };
        case 'armorPiercing': return { armor: 0.5, hp: 1 };
        case 'buckshot': case 'birdshot': case 'shotgun': return { armor: 2, hp: 1 };
        case 'twoHanded': case 'slashing': case 'stabbing': return { armor: 3, hp: 1 };
        default: return { armor: 1, hp: 1 };
    }
}
export function resolveDamage(rawDamage, armorRoll, type, { headshot = false } = {}) {
    const { armor, hp } = damageModifiers(type);
    const melee = ['twoHanded', 'slashing', 'stabbing'].includes(damageType(type));
    const adjustedDamage = rawDamage + (melee ? 1 : 0);
    const protection = Math.ceil(Math.max(0, armorRoll) * armor);
    const penetrating = Math.max(0, adjustedDamage - protection);
    // Headshots replace the ammunition's HP multiplier; armor and its ammo-type modifier still apply.
    const damageMultiplier = headshot ? 2 : hp;
    return { protection, penetrating, hpDamage: penetrating * damageMultiplier, armorMultiplier: armor, damageMultiplier, meleeBonus: melee ? 1 : 0 };
}
