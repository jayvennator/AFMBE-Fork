import { spendAction } from './action-economy.js';

export const POCKETS = Object.freeze({ id: 'pockets', label: 'Pockets', width: 2, height: 2, maxWeight: 3 });
export const STASH = 'stash';
export const HAND_LIMIT = 2;
const integer = (n, fallback = 0) => Number.isSafeInteger(Number(n)) ? Number(n) : fallback;
const clamp = (n, min, max, fallback) => Math.max(min, Math.min(max, integer(n, fallback)));
export const itemWeight = item => Math.max(0, Number(item.system.encumbrance) || 0) * Math.max(0, integer(item.system.qty, 1));
export const storageLocation = item => String(item?.system?.storage?.containerId ?? '');
export const isStashed = (actor, item) => storageLocation(item) === STASH ||
    Boolean((item.system.insertedInWeaponId || item.system.installedWeaponId) &&
        storageLocation(actor.items.get(item.system.insertedInWeaponId || item.system.installedWeaponId)) === STASH);
export const isPhysicalItem = item => !['backpack', 'rig', 'skill', 'quality', 'drawback', 'power', 'aspect'].includes(item.type);
export const isLooseItem = item => isPhysicalItem(item) && !(item.type === 'ammunition' && Number(item.system.qty) <= 0) &&
    !item.system.equipped && !storageLocation(item) &&
    !(item.type === 'magazine' && item.system.insertedInWeaponId) &&
    !(item.type === 'attachment' && item.system.installedWeaponId);
export const handCount = actor => actor.items.filter(isLooseItem).length;
export function inventoryActionCost(actor, item, targetId = '') {
    if (!inCombat(actor)) return 0;
    const old = storageLocation(item);
    return actor.items.get(old)?.type === 'backpack' || actor.items.get(targetId)?.type === 'backpack' ? 1 : 0;
}
export function dimensions(item, rotated = Boolean(item.system.storage?.rotated)) {
    const width = clamp(item.system.gridSize?.width, 1, 8, 1);
    const height = clamp(item.system.gridSize?.height, 1, 8, 1);
    return rotated ? { width: height, height: width } : { width, height };
}
export function containers(actor) {
    return [POCKETS, ...actor.items.filter(item => ['backpack', 'rig'].includes(item.type)).map(item => ({
        id: item.id, label: item.name, width: clamp(item.system.grid?.width, 1, 12, item.type === 'rig' ? 4 : 6),
        height: clamp(item.system.grid?.height, 1, 12, item.type === 'rig' ? 4 : 8),
        maxWeight: Math.max(0, Number(item.system.grid?.maxWeight) || 0), type: item.type, equipped: Boolean(item.system.equipped)
    }))];
}
export function ownedContainer(actor, id) { return containers(actor).find(container => container.id === id); }
export function inCombat(actor) {
    return Boolean(game.combat?.started && game.combat.combatants.some(entry => entry.actor?.uuid === actor.uuid));
}
export function quickAccess(actor, item) {
    if (!item || item.parent?.uuid !== actor.uuid) return false;
    if (isStashed(actor, item)) return false;
    if (!inCombat(actor)) return true;
    if (item.type === 'weapon') return Boolean(item.system.equipped && !storageLocation(item));
    if (item.type === 'armor') return Boolean(item.system.equipped && !storageLocation(item));
    if (item.type === 'magazine' && item.system.insertedInWeaponId) return true;
    const location = storageLocation(item);
    return location === 'pockets' || Boolean(actor.items.get(location)?.type === 'rig' && actor.items.get(location).system.equipped);
}
export function canCarryQuick(item) {
    return ['magazine', 'ammunition', 'consumable', 'attachment'].includes(item.type) ||
        (item.type === 'item' && Boolean(item.system.quickAccess));
}
export function placementError(actor, item, targetId, x, y, rotated = Boolean(item?.system.storage?.rotated)) {
    if (!actor?.isOwner || !item || item.parent?.uuid !== actor.uuid) return 'Item is unavailable.';
    if (storageLocation(item) === STASH && inCombat(actor)) return 'Stashed gear is off character and cannot be retrieved in combat.';
    const target = ownedContainer(actor, targetId);
    if (!target) return 'Equip a backpack or rig before placing items in it.';
    if (target.id !== 'pockets' && !target.equipped) return 'Equip this backpack or rig first.';
    if (['backpack', 'rig', 'skill', 'quality', 'drawback', 'power', 'aspect'].includes(item.type)) return 'This item cannot go inside a container.';
    if (item.type === 'attachment' && item.system.installedWeaponId) return 'Detach this attachment from its weapon before packing it.';
    if (item.type === 'magazine' && item.system.insertedInWeaponId) return 'Remove this magazine from its weapon before packing it.';
    if ((target.id === 'pockets' || target.type === 'rig') && !canCarryQuick(item)) return 'Only small supplies, magazines, and marked quick-access items fit here.';
    const size = dimensions(item, rotated);
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x + size.width > target.width || y + size.height > target.height) return 'The item does not fit within this grid.';
    const limit = integer(item.system.stackLimit, item.type === 'ammunition' ? 30 : 1);
    if (integer(item.system.qty, 1) > Math.max(1, limit)) return `Split this stack to at most ${Math.max(1, limit)} per grid item.`;
    const others = actor.items.filter(entry => entry.id !== item.id && storageLocation(entry) === target.id);
    if (target.maxWeight && others.reduce((sum, entry) => sum + itemWeight(entry), itemWeight(item)) > target.maxWeight + 1e-6) return 'Container weight limit exceeded.';
    for (const other of others) {
        const old = dimensions(other);
        const px = integer(other.system.storage?.x), py = integer(other.system.storage?.y);
        if (x < px + old.width && x + size.width > px && y < py + old.height && y + size.height > py)
            return `Overlaps ${other.name}.`;
    }
    return null;
}
export function firstFreeCell(actor, item, targetId, rotated = Boolean(item?.system.storage?.rotated)) {
    const target = ownedContainer(actor, targetId);
    if (!target) return null;
    for (let y = 0; y < target.height; y++) for (let x = 0; x < target.width; x++)
        if (!placementError(actor, item, targetId, x, y, rotated)) return { x, y };
    return null;
}
export function nearestFreeCell(actor, item, targetId, x, y, rotated = Boolean(item?.system.storage?.rotated), radius = 2) {
    const target = ownedContainer(actor, targetId);
    if (!target) return null;
    const size = dimensions(item, rotated);
    if (size.width > target.width || size.height > target.height) return null;
    const cx = Math.max(0, Math.min(target.width - size.width, Math.floor(x)));
    const cy = Math.max(0, Math.min(target.height - size.height, Math.floor(y)));
    const candidates = [];
    for (let row = 0; row <= target.height - size.height; row++)
        for (let col = 0; col <= target.width - size.width; col++) {
            const distance = Math.abs(cx - col) + Math.abs(cy - row);
            if (distance <= radius) candidates.push({ x: col, y: row, distance });
        }
    candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
    return candidates.find(cell => !placementError(actor, item, targetId, cell.x, cell.y, rotated)) ?? null;
}
export async function moveInventoryItem(actor, item, targetId, x, y, rotated = Boolean(item?.system.storage?.rotated)) {
    const error = placementError(actor, item, targetId, x, y, rotated);
    if (error) throw new Error(error);
    const old = storageLocation(item);
    if (old === targetId && Number(item.system.storage?.x) === x && Number(item.system.storage?.y) === y &&
        Boolean(item.system.storage?.rotated) === Boolean(rotated)) return;
    // Packing or retrieving from a backpack is deliberate; items in rigs and pockets stay ready.
    const cost = inventoryActionCost(actor, item, targetId);
    if (cost) await spendAction(actor, 'help');
    await item.update({ 'system.storage.containerId': targetId, 'system.storage.x': x,
        'system.storage.y': y, 'system.storage.rotated': Boolean(rotated),
        ...(Object.hasOwn(item.system, 'equipped') ? { 'system.equipped': false } : {}) });
    if (cost)
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${foundry.utils.escapeHTML(actor.name)} moves ${foundry.utils.escapeHTML(item.name)} between backpack and ready storage (Help action).</p>` });
}
export async function unpackItem(actor, item) {
    if (!actor?.isOwner || item?.parent?.uuid !== actor.uuid) return;
    const old = storageLocation(item);
    if (!old) return;
    if (old === STASH && inCombat(actor)) throw new Error('Stashed gear is off character and cannot be retrieved in combat.');
    if (handCount(actor) >= HAND_LIMIT) throw new Error(`Both hands are occupied (${HAND_LIMIT}/${HAND_LIMIT}). Pack or stash loose gear first.`);
    const cost = inventoryActionCost(actor, item);
    if (cost) await spendAction(actor, 'help');
    await item.update({ 'system.storage.containerId': '', 'system.storage.x': 0, 'system.storage.y': 0 });
    if (cost)
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${foundry.utils.escapeHTML(actor.name)} retrieves ${foundry.utils.escapeHTML(item.name)} from a backpack (Help action).</p>` });
}
export async function stashItem(actor, item) {
    if (!actor?.isOwner || item?.parent?.uuid !== actor.uuid || !isPhysicalItem(item)) throw new Error('This item cannot be stashed.');
    if (inCombat(actor)) throw new Error('Your off-character stash is unavailable in combat.');
    if (item.system.equipped || item.system.insertedInWeaponId || item.system.installedWeaponId)
        throw new Error('Unequip, unload, or detach this item before stashing it.');
    await item.update({ 'system.storage.containerId': STASH, 'system.storage.x': 0, 'system.storage.y': 0 });
}
export async function splitInventoryStack(actor, item) {
    if (!actor?.isOwner || item?.parent?.uuid !== actor.uuid || !['ammunition','consumable','item'].includes(item.type))
        throw new Error('Only stacked ammunition, consumables, and general items can be split.');
    if (inCombat(actor)) throw new Error('Split stacks outside combat.');
    const quantity = integer(item.system.qty);
    if (quantity < 2) throw new Error('This stack has fewer than two units.');
    const amount = Math.min(quantity - 1, Math.max(1, integer(item.system.stackLimit, item.type === 'ammunition' ? 30 : 1)));
    const copy = item.toObject();
    delete copy._id;
    copy.system.qty = amount;
    copy.system.storage = { containerId: STASH, x: 0, y: 0, rotated: false };
    await actor.createEmbeddedDocuments('Item', [copy]);
    await item.update({ 'system.qty': quantity - amount });
}
