import { damageType } from './damage-types.js';
import { spendAction } from './action-economy.js';
import { normalizeCaliber } from './calibers.js';
import { quickAccess, inCombat, storageLocation, placementError, handCount, HAND_LIMIT, STASH } from './inventory-grid.js';

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
    if (inCombat(actor)) return alert('Fill spare magazines outside combat.');
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

export async function unloadMagazine(actor, magazine, amount) {
    if (!actor?.isOwner || !magazine || magazine.type !== 'magazine' || magazine.parent?.uuid !== actor.uuid)
        throw new Error('Choose a magazine on this character.');
    if (inCombat(actor)) throw new Error('Unload magazine rounds outside combat.');
    const rounds = count(magazine.system.rounds);
    if (!validCount(rounds) || !Number.isSafeInteger(amount) || amount < 1 || amount > Math.min(rounds, 30))
        throw new Error('Choose between 1 and 30 rounds, up to the number in the magazine.');
    const key = caliber(magazine.system.caliber);
    if (!key) throw new Error('Set the magazine caliber before unloading rounds.');
    const type = damageType(magazine.system.ammoType);
    const location = storageLocation(magazine);
    const matches = actor.items.filter(item => item.type === 'ammunition' && caliber(item.system.caliber) === key &&
        damageType(item.system.ammoType) === type && validCount(item.system.qty) &&
        count(item.system.qty) + amount <= Math.max(1, count(item.system.stackLimit) || 30) &&
        (storageLocation(item) === STASH || !storageLocation(item) || !placementError(actor, {
            id: item.id, name: item.name, type: item.type, parent: item.parent,
            system: { ...item.system, qty: count(item.system.qty) + amount }
        }, storageLocation(item), Number(item.system.storage?.x) || 0, Number(item.system.storage?.y) || 0)));
    const carried = matches.filter(item => storageLocation(item) !== STASH);
    const stack = carried.find(item => storageLocation(item) === location) ?? carried[0] ??
        (handCount(actor) >= HAND_LIMIT ? matches.find(item => storageLocation(item) === STASH) : null);
    if (stack) {
        await actor.updateEmbeddedDocuments('Item', [
            { _id: stack.id, 'system.qty': count(stack.system.qty) + amount },
            { _id: magazine.id, 'system.rounds': rounds - amount }
        ]);
    } else {
        const containerId = handCount(actor) < HAND_LIMIT ? '' : STASH;
        const [created] = await actor.createEmbeddedDocuments('Item', [{
            name: `${magazine.system.caliber} ${type} rounds`, type: 'ammunition',
            system: { caliber: magazine.system.caliber, ammoType: type, qty: amount, stackLimit: 30,
                storage: { containerId, x: 0, y: 0, rotated: false } }
        }]);
        if (!created) throw new Error('Could not create the loose rounds. The magazine was not changed.');
        try { await magazine.update({ 'system.rounds': rounds - amount }); }
        catch (error) { await actor.deleteEmbeddedDocuments('Item', [created.id]); throw error; }
    }
    const weapon = actor.items.get(magazine.system.insertedInWeaponId);
    if (weapon?.system.loadedMagazineId === magazine.id) await weapon.update({ 'system.capacity.value': rounds - amount });
    ui.notifications.info(`Unloaded ${amount} ${type} round(s) from ${magazine.name}.`);
    return true;
}
