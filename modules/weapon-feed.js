import { normalizeCaliber } from './calibers.js';
import { damageType } from './damage-types.js';
import { spendAction } from './action-economy.js';
import { quickAccess, firstFreeCell, handCount, HAND_LIMIT } from './inventory-grid.js';

export function weaponCategory(weapon) {
    const category = weapon.system.weaponCategory;
    if (['melee','firearm','bow','crossbow','launcher'].includes(category)) return category;
    if (weapon.system.attackMode === 'melee') return 'melee';
    if (weapon.system.attackMode === 'ranged') return 'firearm';
    const type = damageType(weapon.system.damage_type);
    return ['twoHanded','slashing','stabbing'].includes(type) || (!Number(weapon.system.range) && !Number(weapon.system.capacity?.max)) ? 'melee' : 'firearm';
}
export function feedSystem(weapon) {
    if (weaponCategory(weapon) === 'melee') return 'none';
    if (weaponCategory(weapon) === 'bow') return 'direct';
    if (weaponCategory(weapon) === 'crossbow') return 'single';
    const feed = weapon.system.feedSystem;
    if (['detachable','internal','cylinder','single'].includes(feed)) return feed;
    return weapon.system.usesMagazines ? 'detachable' : 'legacy';
}
export function compatibleLooseAmmo(actor, weapon) {
    const key = normalizeCaliber(weapon.system.ammo_type);
    if (!key) return [];
    return actor.items.filter(item => item.type === 'ammunition' && normalizeCaliber(item.system.caliber) === key &&
        quickAccess(actor, item) &&
        Number.isSafeInteger(Number(item.system.qty)) && Number(item.system.qty) > 0);
}
export async function loadInternalRound(actor, weapon, ammo) {
    if (!weapon?.system.equipped || weapon.system.storage?.containerId) throw new Error('Equip this weapon before loading it.');
    if (!actor.isOwner || !weapon || !ammo || !compatibleLooseAmmo(actor, weapon).some(i => i.id === ammo.id)) throw new Error('Choose compatible loose ammunition with at least one round.');
    const feed = feedSystem(weapon);
    if (!['internal','cylinder','single'].includes(feed)) throw new Error('This weapon does not load loose ammunition directly.');
    const capacity = feed === 'single' ? 1 : Number(weapon.system.capacity?.max);
    const rounds = Number(weapon.system.capacity?.value);
    if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isSafeInteger(rounds) || rounds < 0 || rounds >= capacity) throw new Error('The weapon is full, or its capacity is invalid.');
    const oldType = damageType(weapon.system.loadedAmmoType || weapon.system.damage_type);
    const newType = damageType(ammo.system.ammoType);
    if (rounds && oldType !== newType) throw new Error('Unload existing rounds before switching ammunition type.');
    const count = Number(ammo.system.qty);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('No loose rounds left.');
    await ammo.update({ 'system.qty': count - 1 });
    await weapon.update({ 'system.capacity.value': rounds + 1, 'system.capacity.max': capacity, 'system.loadedAmmoType': newType });
    const action = await spendAction(actor, 'help');
    const esc = foundry.utils.escapeHTML;
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<h2>${esc(actor.name)} loads ${esc(weapon.name)}</h2><p>1 ${esc(ammo.name)} round (${rounds + 1}/${capacity}).${action.tracked ? ` Help action ${action.used}; repeat penalty ${action.penalty}.` : ''}</p>` });
    return true;
}
export async function unloadInternalRounds(actor, weapon) {
    if (!actor.isOwner || !weapon || !['internal','cylinder','single'].includes(feedSystem(weapon))) throw new Error('This weapon does not have a direct-load chamber.');
    if (!weapon.system.equipped || weapon.system.storage?.containerId) throw new Error('Equip the weapon before unloading.');
    const rounds = Number(weapon.system.capacity?.value);
    if (!Number.isSafeInteger(rounds) || rounds <= 0) throw new Error('No rounds to unload.');
    const oldType = damageType(weapon.system.loadedAmmoType || weapon.system.damage_type);
    const existing = compatibleLooseAmmo(actor, weapon).find(item => damageType(item.system.ammoType) === oldType) ??
        actor.items.find(item => item.type === 'ammunition' && normalizeCaliber(item.system.caliber) === normalizeCaliber(weapon.system.ammo_type) && damageType(item.system.ammoType) === oldType && Number(item.system.qty) === 0);
    if (existing) await existing.update({ 'system.qty': Number(existing.system.qty) + rounds });
    else await actor.createEmbeddedDocuments('Item', [{ name: `${weapon.system.ammo_type} ${oldType} (unloaded)`, type: 'ammunition', system: { caliber: weapon.system.ammo_type, ammoType: oldType, qty: rounds } }]);
    await weapon.update({ 'system.capacity.value': 0, 'system.loadedAmmoType': '' });
    const action = await spendAction(actor, 'help');
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<h2>${foundry.utils.escapeHTML(actor.name)} unloads ${foundry.utils.escapeHTML(weapon.name)}</h2><p>${rounds} rounds returned to loose ammunition.${action.tracked ? ` Help action ${action.used}.` : ''}</p>` });
    return true;
}

export async function removeMagazine(actor, weapon) {
    if (!actor.isOwner || !weapon?.system.loadedMagazineId) throw new Error('No inserted magazine.');
    if (!weapon.system.equipped || weapon.system.storage?.containerId) throw new Error('Equip the weapon before removing its magazine.');
    const magazine = actor.items.get(weapon.system.loadedMagazineId);
    if (!magazine || magazine.type !== 'magazine' || magazine.system.insertedInWeaponId !== weapon.id) throw new Error('Inserted magazine is missing.');
    const placeable = { id: magazine.id, name: magazine.name, type: magazine.type, parent: magazine.parent,
        system: { ...magazine.system, insertedInWeaponId: '' } };
    const available = ['pockets', ...actor.items.filter(entry => entry.type === 'rig' && entry.system.equipped).map(entry => entry.id)];
    const destination = available.map(id => ({ id, cell: firstFreeCell(actor, placeable, id) })).find(entry => entry.cell);
    if (!destination && handCount(actor) >= HAND_LIMIT) throw new Error('Free space in pockets, your worn rig, or your hands before removing this magazine.');
    const action = await spendAction(actor, 'help');
    await magazine.update({ 'system.insertedInWeaponId': '', 'system.storage.containerId': destination?.id ?? '',
        'system.storage.x': destination?.cell.x ?? 0, 'system.storage.y': destination?.cell.y ?? 0 });
    await weapon.update({ 'system.loadedMagazineId': '', 'system.usesMagazines': true, 'system.capacity.value': 0 });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<h2>${foundry.utils.escapeHTML(actor.name)} removes ${foundry.utils.escapeHTML(magazine.name)}</h2><p>${magazine.system.rounds} rounds remain in the magazine. Placed in ${destination?.id === 'pockets' ? 'pockets' : destination ? 'the combat rig' : 'hands'}.${action.tracked ? ` Help action ${action.used}.` : ''}</p>` });
    return true;
}
