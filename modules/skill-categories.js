export const SKILL_CATEGORIES = Object.freeze({
    combat: 'Combat',
    social: 'Social',
    navigation: 'Navigation & outdoors',
    physical: 'Physical',
    medical: 'Medical',
    technical: 'Technical',
    knowledge: 'Knowledge & creative',
    other: 'Other'
});
const inferred = [
    ['combat', /^(guns?\b|hand weapon\b|melee\b|brawling\b|martial arts\b|dodge\b|throwing\b)/i],
    ['social', /^(acting\b|bureaucracy\b|cheating\b|disguise\b|gambling\b|haggling\b|instruction\b|intimidation\b|persuad\w*\b|questioning\b|smooth talking\b|storytelling\b|streetwise\b)/i],
    ['navigation', /^(driving\b|navigation\b|piloting\b|riding\b|survival\b|tracking\b|scavenging\b)/i],
    ['physical', /^(acrobatics\b|climbing\b|escapism\b|running\b|sleight of hand\b|sports\b|stealth\b|swimming\b)/i],
    ['medical', /^(first aid\b|medicine\b)/i],
    ['technical', /^(computer hacking\b|demolitions\b|electronic surveillance\b|electronics\b|engineer\b|lockpicking\b|mechanic\b|repair\b|surveillance\b|traps\b)/i],
    ['knowledge', /^(agriculture\b|beautician\b|craft\b|fine arts\b|humanities\b|myth and legend\b|notice\b|research\b|writing\b)/i]
];
export function skillCategory(item) {
    const explicit = item.system?.category;
    if (explicit && explicit !== 'auto' && Object.hasOwn(SKILL_CATEGORIES, explicit)) return explicit;
    return inferred.find(([, pattern]) => pattern.test(String(item.name ?? '').trim()))?.[0] ?? 'other';
}
