import { allowedFireModes } from './fire-modes.js';
import { feedSystem } from './weapon-feed.js';
import { loadedMagazine } from './magazines.js';
import { prepareGunShot } from './gun-actions.js';
import { damageType, hitBonus } from './damage-types.js';
import { attachmentModifiers } from './attachments.js';
import { attributeBonus, skillBonus } from './consumables.js';
import { spendAction } from './action-economy.js';
import { healthState } from './health-states.js';
import { traitRollEffects } from './trait-effects.js';

const SYSTEM = 'afmbe-left-behind';
const esc = value => foundry.utils.escapeHTML(String(value ?? ''));
const busy = new Set();
const degrees = angle => ((angle % 360) + 360) % 360;
export const MAX_SUPPRESSION_SPACES = 10;
export const suppressionMaxDistance = scene => Number(scene.grid.distance) * MAX_SUPPRESSION_SPACES;

export function coneContains(template, token, scene) {
    const scale = Number(scene.grid.distance) / Number(canvas.grid.size);
    const radius = Math.min(Number(template.distance), suppressionMaxDistance(scene)) / scale;
    if (!(radius > 0)) return false;
    const dx = token.center.x - template.x, dy = token.center.y - template.y;
    if (Math.hypot(dx, dy) > radius) return false;
    const delta = degrees(Math.atan2(dy, dx) * 180 / Math.PI - Number(template.direction));
    return Math.min(delta, 360 - delta) <= Number(template.angle) / 2;
}

export function beginSuppressiveCone(actor, weapon, skill, attribute) {
    if (!actor.isOwner || !weapon.system.equipped || !allowedFireModes(weapon).includes('automatic')) throw new Error('Equip an automatic-capable weapon.');
    const feed = feedSystem(weapon);
    const magazine = ['detachable', 'legacy'].includes(feed) && (feed === 'detachable' || weapon.system.usesMagazines) ? loadedMagazine(actor, weapon) : null;
    const rounds = magazine ? Number(magazine.system.rounds) : Number(weapon.system.capacity?.value);
    if (!Number.isSafeInteger(rounds) || rounds < 10 || (feed === 'detachable' && !magazine)) throw new Error('Load at least 10 rounds before suppressing.');
    if (!canvas?.ready || !canvas.scene) throw new Error('Open the scene first.');
    const shooters = canvas.tokens.placeables.filter(token => token.actor?.uuid === actor.uuid);
    const selected = shooters.filter(token => token.controlled);
    const shooter = selected.length === 1 ? selected[0] : shooters.length === 1 ? shooters[0] : null;
    if (!shooter) throw new Error('Select exactly one shooter token.');
    const key = `${game.user.id}:${actor.uuid}`;
    if (busy.has(key)) throw new Error('Finish placing the previous suppression cone.');
    busy.add(key);
    const sceneId = canvas.scene.id;
    const maxDistance = suppressionMaxDistance(canvas.scene);
    const capPreview = (template, data, options, userId) => {
        if (userId === game.user.id && template.parent?.id === sceneId && template.t === 'cone' && Number(template.distance) > maxDistance)
            template.updateSource({ distance: maxDistance });
    };
    const listener = async (template, options, userId) => {
        if (userId !== game.user.id || template.parent?.id !== sceneId || template.t !== 'cone') return;
        Hooks.off('createMeasuredTemplate', listener);
        Hooks.off('preCreateMeasuredTemplate', capPreview);
        clearTimeout(timeout);
        busy.delete(key);
        if (Math.hypot(template.x - shooter.center.x, template.y - shooter.center.y) > Number(canvas.grid.size) * 0.75) {
            ui.notifications.warn('Draw the cone starting at the shooter token. No ammunition was spent.');
            return;
        }
        if (Number(template.distance) > maxDistance) await template.update({ distance: maxDistance });
        await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }),
            content: `<h2>Suppressive fire requested</h2><p>${esc(actor.name)} aims ${esc(weapon.name)}. ZM: review the cone and threatened tokens before firing. No ammunition spent yet.</p>`,
            flags: { [SYSTEM]: { suppression: { status: 'pending', actorUuid: actor.uuid, weaponUuid: weapon.uuid,
                templateUuid: template.uuid, sceneId, authorId: game.user.id, skillId: skill?.id ?? '', attribute } } } });
    };
    const timeout = setTimeout(() => { Hooks.off('createMeasuredTemplate', listener); Hooks.off('preCreateMeasuredTemplate', capPreview); busy.delete(key); }, 120000);
    Hooks.on('preCreateMeasuredTemplate', capPreview);
    Hooks.on('createMeasuredTemplate', listener);
    canvas.templates.activate({ tool: 'cone' });
    ui.notifications.info('Draw a cone starting at your token (maximum 10 grid spaces). Right-click to cancel; cancelling spends nothing.');
}

async function review(message) {
    const data = message.getFlag(SYSTEM, 'suppression');
    if (!game.user.isGM || data?.status !== 'pending') return;
    const scene = game.scenes.get(data.sceneId);
    const template = await fromUuid(data.templateUuid);
    if (!scene || !template || canvas.scene?.id !== scene.id) return ui.notifications.warn('Open the scene with the suppression cone first.');
    if (Number(template.distance) > suppressionMaxDistance(scene)) await template.update({ distance: suppressionMaxDistance(scene) });
    const tokens = canvas.tokens.placeables.filter(token => token.actor);
    const shooter = await fromUuid(data.actorUuid);
    const list = tokens.filter(token => token.actor.uuid !== shooter?.uuid).map(token =>
        `<label><input type="checkbox" name="targets" value="${esc(token.document.id)}" ${coneContains(template, token, scene) ? 'checked' : ''}>${esc(token.name)}</label>`).join('<br>');
    new Dialog({ title: 'ZM: review suppressive fire', content: `<form><p>Maximum range: ${MAX_SUPPRESSION_SPACES} grid spaces. Choose affected tokens. Confirm commits 10 rounds and the attack action.</p>${list || '<p>No other tokens on the scene.</p>'}</form>`, buttons: {
        cancel: { label: 'Keep pending' },
        deny: { label: 'Cancel shot', callback: () => message.update({ [`flags.${SYSTEM}.suppression.status`]: 'cancelled' }) },
        fire: { label: 'Confirm fire', callback: async html => {
            const ids = [...html[0].querySelectorAll('input[name="targets"]:checked')].map(input => input.value);
            try { await commitSuppression(message, ids); } catch (error) { ui.notifications.warn(error.message); }
        } }
    }, default: 'fire' }).render(true);
}

async function commitSuppression(message, targetIds) {
    const data = message.getFlag(SYSTEM, 'suppression');
    if (!game.user.isGM || data?.status !== 'pending') throw new Error('This shot is no longer pending.');
    if (busy.has(message.uuid)) throw new Error('This shot is already being committed.');
    busy.add(message.uuid);
    try {
        const actor = await fromUuid(data.actorUuid), weapon = await fromUuid(data.weaponUuid);
        const scene = game.scenes.get(data.sceneId), template = await fromUuid(data.templateUuid);
        const author = game.users.get(data.authorId);
        if (!actor || !weapon || weapon.parent?.uuid !== actor.uuid || !author || (!author.isGM && !actor.testUserPermission(author, 'OWNER')) ||
            !scene || !template || canvas.scene?.id !== scene.id || !weapon.system.equipped || !allowedFireModes(weapon).includes('automatic'))
            throw new Error('The shooter, weapon, cone, or scene is no longer valid.');
        if (Number(template.distance) > suppressionMaxDistance(scene)) throw new Error('The cone exceeds 10 grid spaces. Review it again before firing.');
        const feed = feedSystem(weapon);
        const magazine = ['detachable', 'legacy'].includes(feed) && (feed === 'detachable' || weapon.system.usesMagazines) ? loadedMagazine(actor, weapon) : null;
        const rounds = magazine ? Number(magazine.system.rounds) : Number(weapon.system.capacity?.value);
        if (!Number.isSafeInteger(rounds) || rounds < 10 || (feed === 'detachable' && !magazine)) throw new Error('The weapon needs 10 loaded rounds.');
        const targets = [...new Set(targetIds)].map(id => canvas.tokens.get(id)).filter(token => token?.actor && token.actor.uuid !== actor.uuid);
        const shot = await prepareGunShot(actor, weapon);
        if (magazine) await magazine.update({ 'system.rounds': rounds - 10 });
        await weapon.update({ 'system.capacity.value': rounds - 10 });
        await message.update({ [`flags.${SYSTEM}.suppression.status`]: 'fired' });
        const skill = actor.items.get(data.skillId);
        const attr = (Number(actor.system.primaryAttributes?.[data.attribute]?.value) || 0) + attributeBonus(actor, data.attribute);
        const bonus = attr + (Number(skill?.system.level) || 0) + skillBonus(actor, skill) + attachmentModifiers(actor, weapon).attack + shot.actionPenalty + shot.recoilPenalty - 4;
        const type = damageType(magazine?.system.ammoType ?? weapon.system.loadedAmmoType ?? weapon.system.damage_type);
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<h2>${esc(actor.name)} suppresses an area</h2><p>10 rounds fired from ${esc(weapon.name)}; ${rounds - 10} remain. ${targets.length} threatened token(s). Offensive action ${shot.actionPenalty}; recoil ${shot.recoilPenalty}. No immediate damage.</p>` });
        for (const token of targets) await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: token.actor }),
            content: `<h2>${esc(token.name)}: under suppressive fire</h2><p>Make a Difficult Willpower test (1d10 + Willpower vs 9). On failure, choose cover, duck, or remain exposed on your next turn.</p>`,
            flags: { [SYSTEM]: { suppressionTarget: { status: 'test', targetUuid: token.actor.uuid, targetTokenUuid: token.uuid,
                attackerUuid: actor.uuid, weaponUuid: weapon.uuid, damageType: type, attackBonus: bonus, firedRound: Number(game.combat?.round) || 0,
                combatId: game.combat?.id ?? '', templateUuid: template.uuid } } } });
    } finally { busy.delete(message.uuid); }
}

async function rollWillpower(message) {
    const data = message.getFlag(SYSTEM, 'suppressionTarget');
    const actor = await fromUuid(data?.targetUuid);
    if (!actor?.isOwner || data.status !== 'test') return;
    // Willpower tests are Attribute-only Difficult Tests.
    const roll = await new Roll('1d10').evaluate();
    const will = (Number(actor.system.primaryAttributes?.willpower?.value) || 0) + attributeBonus(actor, 'willpower');
    const traits = traitRollEffects(actor, { kind: 'test', attribute: 'willpower', mode: 'fear' });
    const total = roll.total + will + traits.total + healthState(actor).penalty;
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll],
        content: `<h2>${esc(actor.name)} resists suppression</h2><p>Difficult Willpower: ${roll.total} + ${will} + traits ${traits.total} = ${total} vs 9. ${total >= 9 ? 'Resisted.' : 'Failed: choose a response next turn.'}</p>`,
        flags: { [SYSTEM]: { suppressionResponse: { messageUuid: message.uuid, kind: 'test', total, targetUuid: actor.uuid } } } });
}

async function chooseResponse(message, choice) {
    const data = message.getFlag(SYSTEM, 'suppressionTarget');
    const actor = await fromUuid(data?.targetUuid);
    if (!actor?.isOwner || data.status !== 'failed') return;
    if (data.combatId && game.combat?.id === data.combatId && game.combat.combatant?.actor?.uuid !== actor.uuid)
        throw new Error('Choose your suppression response on your turn.');
    if (choice === 'cover') {
        await spendAction(actor, 'movement');
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${esc(actor.name)} heads for cover. ZM: verify the token reaches cover.</p>`,
            flags: { [SYSTEM]: { suppressionResponse: { messageUuid: message.uuid, kind: 'choice', choice: 'cover', targetUuid: actor.uuid } } } });
    } else if (choice === 'duck') {
        const action = await spendAction(actor, 'defensive');
        const roll = await new Roll('1d10').evaluate();
        const dex = Number(actor.system.primaryAttributes?.dexterity?.value) || 0;
        const dodge = actor.items.find(item => item.type === 'skill' && /^dodge$/i.test(item.name));
        const skill = (Number(dodge?.system.level) || 0) + skillBonus(actor, dodge);
        const total = roll.total + dex + skill + action.penalty;
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll], content: `<p>${esc(actor.name)} ducks: ${roll.total} + Dexterity ${dex} + Dodge ${skill} + action ${action.penalty} = ${total} vs 9. ${total >= 9 ? 'Safe on the ground.' : 'Failed; exposed to one attack.'}</p>`,
            flags: { [SYSTEM]: { suppressionResponse: { messageUuid: message.uuid, kind: 'choice', choice: total >= 9 ? 'ducked' : 'exposed', targetUuid: actor.uuid } } } });
    } else if (choice === 'exposed') await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${esc(actor.name)} remains exposed to suppressive fire.</p>`,
        flags: { [SYSTEM]: { suppressionResponse: { messageUuid: message.uuid, kind: 'choice', choice: 'exposed', targetUuid: actor.uuid } } } });
}

export async function handleSuppressionResponse(response) {
    if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
    const data = response.getFlag(SYSTEM, 'suppressionResponse');
    if (!data?.messageUuid) return;
    const original = await fromUuid(data.messageUuid);
    const state = original?.getFlag(SYSTEM, 'suppressionTarget');
    const actor = await fromUuid(data.targetUuid);
    const sender = game.users.get(response.user?.id ?? response.user);
    if (!state || !actor || state.targetUuid !== actor.uuid || !sender || (!sender.isGM && !actor.testUserPermission(sender, 'OWNER'))) return;
    if (data.kind === 'test' && state.status === 'test' && response.rolls?.length && Number.isFinite(data.total)) {
        await original.update({ [`flags.${SYSTEM}.suppressionTarget.status`]: data.total >= 9 ? 'resisted' : 'failed',
            [`flags.${SYSTEM}.suppressionTarget.testTotal`]: data.total });
    } else if (data.kind === 'choice' && state.status === 'failed' && ['cover', 'ducked', 'exposed'].includes(data.choice)) {
        await original.update({ [`flags.${SYSTEM}.suppressionTarget.status`]: data.choice });
    }
}

async function resolveExposed(message) {
    const data = message.getFlag(SYSTEM, 'suppressionTarget');
    if (!game.user.isGM || data?.status !== 'exposed') return;
    const actor = await fromUuid(data.attackerUuid), weapon = await fromUuid(data.weaponUuid), target = await fromUuid(data.targetUuid);
    if (!actor || !weapon || !target) throw new Error('Suppression attacker or target is missing.');
    const roll = await new Roll('1d10').evaluate();
    const type = damageType(data.damageType);
    const total = roll.total + data.attackBonus + hitBonus(type);
    await message.update({ [`flags.${SYSTEM}.suppressionTarget.status`]: 'resolved' });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll],
        content: `<h2>Exposed under suppression</h2><p>${esc(weapon.name)} vs ${esc(target.name)}: ${roll.total} + ${data.attackBonus} + ammo ${hitBonus(type)} = ${total} vs 9. ${total >= 9 ? 'One hit; roll damage below.' : 'Miss; no damage.'}</p>`,
        flags: { [SYSTEM]: { pendingAttack: { attackerUuid: actor.uuid, targetUuid: target.uuid, targetName: target.name,
            weaponUuid: weapon.uuid, weaponName: weapon.name, damageType: type, total, location: 'body', melee: false,
            roundsFired: 1, hits: total >= 9 ? 1 : 0, firingMode: 'semi', status: total >= 9 ? 'ready' : 'miss', blocked: false } } } });
}

function promptEssenceLoss(message) {
    const data = message.getFlag(SYSTEM, 'suppressionTarget');
    if (!game.user.isGM || !data || data.essenceApplied || ['test', 'resisted'].includes(data.status)) return;
    new Dialog({ title: 'ZM: suppression Essence loss', content: '<form><label>Essence points lost (ZM discretion)</label><input name="loss" type="number" min="0" step="1" value="0"></form>',
        buttons: { cancel: { label: 'Later' }, apply: { label: 'Apply', callback: async html => {
            const loss = Number(html[0].querySelector('[name="loss"]').value);
            if (!Number.isSafeInteger(loss) || loss < 0) return ui.notifications.warn('Enter a nonnegative whole number.');
            const current = message.getFlag(SYSTEM, 'suppressionTarget');
            if (current?.essenceApplied) return;
            const actor = await fromUuid(current.targetUuid);
            if (!actor) return ui.notifications.warn('The target no longer exists.');
            const before = Number(actor.system.secondaryAttributes.essence.value) || 0;
            if (loss) await actor.update({ 'system.secondaryAttributes.essence.value': Math.max(0, before - loss) });
            await message.update({ [`flags.${SYSTEM}.suppressionTarget.essenceApplied`]: true });
            await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${esc(actor.name)} loses ${loss} Essence from suppression (${before} → ${Math.max(0, before - loss)}).</p>` });
        } } }, default: 'apply' }).render(true);
}

export function renderSuppressiveFire(message, root) {
    const container = root?.querySelector('.message-content');
    if (!container) return;
    const request = message.getFlag(SYSTEM, 'suppression');
    const target = message.getFlag(SYSTEM, 'suppressionTarget');
    const button = (label, action) => {
        const control = document.createElement('button');
        control.type = 'button'; control.textContent = label;
        control.addEventListener('click', async () => {
            control.disabled = true;
            try { await action(); } catch (error) { ui.notifications.warn(error.message); }
            control.disabled = false;
        });
        container.append(control);
    };
    if (request?.status === 'pending' && game.user.isGM) button('ZM: review cone', () => review(message));
    if (target?.status === 'test') button('Roll Willpower', () => rollWillpower(message));
    if (target?.status === 'failed') {
        button('Head to cover', () => chooseResponse(message, 'cover'));
        button('Duck', () => chooseResponse(message, 'duck'));
        button('Remain exposed', () => chooseResponse(message, 'exposed'));
    }
    if (target?.status === 'exposed' && game.user.isGM) button('ZM: resolve one attack', () => resolveExposed(message));
    if (target && !['test', 'resisted'].includes(target.status) && !target.essenceApplied && game.user.isGM)
        button('ZM: set Essence loss', () => promptEssenceLoss(message));
}
