export const ITEM_CATEGORIES = Object.freeze({
    general: 'General gear',
    material: 'Raw material',
    component: 'Crafting component',
    tool: 'Tool'
});

export function itemCategory(item) {
    const key = String(item?.system?.itemCategory ?? 'general');
    return Object.hasOwn(ITEM_CATEGORIES, key) ? key : 'general';
}
