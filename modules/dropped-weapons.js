import { spendAction } from './action-economy.js';
import { handCount, HAND_LIMIT } from './inventory-grid.js';

const SYSTEM = 'afmbe-left-behind';
export const droppedAt = item => item?.getFlag(SYSTEM, 'droppedAt') ?? null;

export async function disarmWeapon(attack) {
    if (!game.user.isGM) throw new Error('Only the ZM can resolve a disarm.');
    const target = await fromUuid(attack.targetUuid);
    const item = await fromUuid(attack.targetWeaponUuid);
    const token = await fromUuid(attack.targetTokenUuid);
    if (!target || !item || item.parent?.uuid !== target.uuid || item.type !== 'weapon' || !item.system.equipped || droppedAt(item) || !token?.parent) {
        throw new Error('The chosen weapon is no longer readied on the target.');
    }
    const scene = token.parent;
    const size = Number(scene.grid.size) || 100;
    const x = Number(token.x) + size * 0.25;
    const y = Number(token.y) + size * 0.65;
    const tiles = await scene.createEmbeddedDocuments('Tile', [{ x, y, width: size * 0.5, height: size * 0.5,
        texture: { src: item.img }, flags: { [SYSTEM]: { droppedWeaponUuid: item.uuid } } }]);
    const tile = tiles[0];
    try {
        await item.setFlag(SYSTEM, 'droppedAt', { sceneId: scene.id, x: Number(token.x), y: Number(token.y), tileId: tile.id });
        await item.update({ 'system.equipped': false });
    } catch (error) { await scene.deleteEmbeddedDocuments('Tile', [tile.id]); throw error; }
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: target }),
        content: `<p>${foundry.utils.escapeHTML(target.name)} drops ${foundry.utils.escapeHTML(item.name)} at their feet. Select the token and use Pick up in Equipment to recover it (Help action).</p>` });
}

export async function pickUpWeapon(actor, item) {
    if (!actor?.isOwner || !item || item.parent?.uuid !== actor.uuid) throw new Error('This weapon is unavailable.');
    const location = droppedAt(item);
    if (!location) throw new Error('This weapon is not on the ground.');
    const token = canvas?.tokens?.controlled?.find(entry => entry.actor?.uuid === actor.uuid)?.document;
    if (!token || token.parent?.id !== location.sceneId) throw new Error('Select your token on the scene with the dropped weapon.');
    const grid = Number(token.parent.grid.size) || 100;
    if (Math.hypot(Number(token.x) - location.x, Number(token.y) - location.y) > grid * 1.5)
        throw new Error('Move next to the dropped weapon to pick it up.');
    if (handCount(actor) >= HAND_LIMIT) throw new Error('Free a hand before picking up this weapon.');
    await spendAction(actor, 'help');
    await item.update({ 'system.equipped': true });
    await item.unsetFlag(SYSTEM, 'droppedAt');
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p>${foundry.utils.escapeHTML(actor.name)} picks up ${foundry.utils.escapeHTML(item.name)} (Help action).</p>`,
        flags: { [SYSTEM]: { droppedWeaponPickup: { weaponUuid: item.uuid, sceneId: location.sceneId, tileId: location.tileId } } } });
}

export async function handleDroppedWeaponPickup(message) {
    if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
    const data = message.getFlag(SYSTEM, 'droppedWeaponPickup');
    if (!data) return;
    const weapon = await fromUuid(data.weaponUuid);
    const author = game.users.get(message.user?.id ?? message.user);
    if (!weapon || !author || (!author.isGM && !weapon.parent?.testUserPermission(author, 'OWNER')) || droppedAt(weapon)) return;
    const scene = game.scenes.get(data.sceneId);
    const tile = scene?.tiles.get(data.tileId);
    if (tile?.getFlag(SYSTEM, 'droppedWeaponUuid') === weapon.uuid) await scene.deleteEmbeddedDocuments('Tile', [tile.id]);
}
