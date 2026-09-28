import { damageType } from './damage-types.js';
import { spendAction } from './action-economy.js';
import { normalizeCaliber } from './calibers.js';
import { quickAccess } from './inventory-grid.js';

const caliber = normalizeCaliber;
const count = value => Number(value);
const validCount = value => Number.isSafeInteger(count(value)) && count(value) >= 0;
const alert = message => { ui.notifications.warn(message); return false; };

export function loadedMagazine(actor, weapon) {
    if (!weapon.system.usesMagazines) return null;
    const magazine = actor.items.get(weapon.system.loadedMagazineId);
    return magazine?.type === 'magazine' && magazine.system.insertedInWeaponId === weapon.id ? magazine : null;
}

export function compatibleMagazines(actor, weapon) {
    const key = caliber(weapon.system.ammo_type);
    if (!key) return [];
    return actor.items.filter(item => item.type === 'magazine' && caliber(item.system.caliber) === key &&
        quickAccess(actor, item) &&
        (!item.system.insertedInWeaponId || item.system.insertedInWeaponId === weapon.id) && item.id !== weapon.system.loadedMagazineId &&
        validCount(item.system.rounds) && validCount(item.system.capacity) && count(item.system.capacity) > 0 &&
        count(item.system.rounds) <= count(item.system.capacity));
}

export async function reloadWeapon(actor, weapon, magazine) {
    if (!weapon?.system.equipped || weapon.system.storage?.containerId) return alert('Equip the weapon before reloading it.');
    if (!actor.isOwner || !weapon || !magazine || !compatibleMagazines(actor, weapon).some(item => item.id === magazine.id)) return alert('Choose a compatible spare magazine with valid capacity and rounds.');
    const old = loadedMagazine(actor, weapon);
    const updates = [{ _id: magazine.id, 'system.insertedInWeaponId': weapon.id,
        'system.storage.containerId': '', 'system.storage.x': 0, 'system.storage.y': 0 }];
    if (old) updates.push({ _id: old.id, 'system.insertedInWeaponId': '', 'system.storage.containerId': '' });
    await actor.updateEmbeddedDocuments('Item', updates);
    await weapon.update({ 'system.usesMagazines': true, 'system.loadedMagazineId': magazine.id,
        'system.capacity.value': count(magazine.system.rounds), 'system.capacity.max': count(magazine.system.capacity) });
    const action = await spendAction(actor, 'help');
    const esc = foundry.utils.escapeHTML;
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<h2>${esc(actor.name)} reloads ${esc(weapon.name)}</h2><p>${esc(magazine.name)} (${count(magazine.system.rounds)}/${count(magazine.system.capacity)} ${esc(damageType(magazine.system.ammoType))} rounds).${action.tracked ? ` Help action ${action.used}; repeat penalty ${action.penalty}.` : ''}</p>` });
    return true;
}

export async function loadMagazine(actor, magazine, ammunition, amount) {
    if (!actor.isOwner || !magazine || !ammunition || magazine.type !== 'magazine' || ammunition.type !== 'ammunition') return alert('Choose a magazine and loose ammunition.');
    if (game.combat?.started && game.combat.combatants.some(c => c.actorId === actor.id)) return alert('Fill spare magazines outside combat.');
    const capacity = count(magazine.system.capacity), rounds = count(magazine.system.rounds), qty = count(ammunition.system.qty);
    if (!caliber(magazine.system.caliber) || caliber(magazine.system.caliber) !== caliber(ammunition.system.caliber)) return alert('Magazine and ammunition calibers must match.');
    if (![capacity,rounds,qty,amount].every(validCount) || capacity < 1 || rounds > capacity || amount < 1 || amount > qty || rounds + amount > capacity) return alert('Invalid count or not enough rounds or space.');
    if (rounds > 0 && damageType(magazine.system.ammoType) !== damageType(ammunition.system.ammoType)) return alert('Empty the magazine before switching ammunition type.');
    const type = damageType(ammunition.system.ammoType);
    await actor.updateEmbeddedDocuments('Item', [
        { _id: magazine.id, 'system.rounds': rounds + amount, 'system.ammoType': type },
        { _id: ammunition.id, 'system.qty': qty - amount }
    ]);
    const weapon = actor.items.get(magazine.system.insertedInWeaponId);
    if (weapon?.system.loadedMagazineId === magazine.id) await weapon.update({ 'system.capacity.value': rounds + amount });
    if (qty === amount) await actor.deleteEmbeddedDocuments('Item', [ammunition.id]);
    ui.notifications.info(`Loaded ${amount} ${type} round(s) into ${magazine.name}.`);
    return true;
}
