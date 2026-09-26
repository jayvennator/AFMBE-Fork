// Catalog values are stable identifiers shared by weapons, magazines and loose ammunition.
export const CALIBERS = {
    '9mm': '9×19 mm (9mm)', '.22 LR': '.22 LR', '.38 spc': '.38 Special', '.357 Magnum': '.357 Magnum',
    '.40 S&W': '.40 S&W', '.45 ACP': '.45 ACP', '.44 Magnum': '.44 Magnum', '5.7x28mm': '5.7×28 mm',
    '5.56': '5.56×45 mm', '5.45x39mm': '5.45×39 mm', '6.8x51mm': '6.8×51 mm', '.30-30': '.30-30 Winchester', '7.62x39mm': '7.62×39 mm', '7.62x51mm': '7.62×51 mm',
    '7.62x54mm': '7.62×54 mm R', '.308': '.308 Winchester', '.30-06': '.30-06 Springfield',
    '.338': '.338 Lapua Magnum', '50 BMG': '.50 BMG', '12g': '12 gauge', '20g': '20 gauge',
    '40mm Grenade': '40 mm grenade', 'arrow': 'Arrow', 'bolt': 'Crossbow bolt', '.300 BLK': '.300 Blackout', '6.5 Creedmoor': '6.5 Creedmoor'
};
const aliases = new Map(Object.keys(CALIBERS).map(key => [key.toLowerCase().replace(/[\s×]/g, '').replace(/\u00d7/g, 'x'), key]));
for (const [alias, key] of Object.entries({
    '.22': '.22 LR', '.38spc': '.38 spc', '.44mag': '.44 Magnum', '.357mag': '.357 Magnum',
    '9x19mm': '9mm', '9mmluger': '9mm', '5.56x45mm': '5.56', '7.62x54': '7.62x54mm',
    '.50bmg': '50 BMG', '50bmg': '50 BMG', '12gauge': '12g', '20gauge': '20g'
})) aliases.set(alias.replace(/\s/g, ''), key);
export function normalizeCaliber(value) {
    const raw = String(value ?? '').trim();
    const cleaned = raw.toLowerCase().replace(/\s/g, '').replace(/×/g, 'x');
    return aliases.get(cleaned) ?? cleaned;
}
export function caliberSelection(value) {
    const canonical = normalizeCaliber(value);
    return Object.hasOwn(CALIBERS, canonical) ? canonical : '';
}
