import { quickAccess } from './inventory-grid.js';
import { spendAction } from './action-economy.js';
import { damageType } from './damage-types.js';

const SYSTEM = 'afmbe-left-behind';
const busy = new Set();
const esc = value => foundry.utils.escapeHTML(String(value ?? ''));

export function blastContains(template, token, scene) {
    const scale = Number(scene.grid.distance) / Number(canvas.grid.size);
    const radiusPixels = Number(template.distance) / scale;
    return radiusPixels > 0 && Math.hypot(token.center.x - template.x, token.center.y - template.y) <= radiusPixels;
}

export function beginGrenadeCircle(actor, grenade) {
    if (!actor?.isOwner || grenade?.parent?.uuid !== actor.uuid || grenade.type !== 'grenade') throw new Error('Select an owned grenade.');
    const radius = Number(grenade.system.radius);
    if (!Number.isFinite(radius) || radius <= 0) throw new Error('Set a positive blast radius on the grenade sheet.');
    if (!Number.isSafeInteger(Number(grenade.system.qty)) || Number(grenade.system.qty) < 1 || !quickAccess(actor, grenade))
        throw new Error('Carry an available grenade in pockets or an equipped rig during combat.');
    if (!canvas?.ready || !canvas.scene) throw new Error('Open a scene to place the grenade.');
    const throwers = canvas.tokens.placeables.filter(token => token.actor?.uuid === actor.uuid);
    const selected = throwers.filter(token => token.controlled);
    if (!(selected.length === 1 || selected.length === 0 && throwers.length === 1)) throw new Error('Select exactly one thrower token.');
    const key = `${game.user.id}:${actor.uuid}`;
    if (busy.has(key)) throw new Error('Finish placing the previous grenade circle.');
    busy.add(key);
    const sceneId = canvas.scene.id;
    const setRadius = (template, _data, _options, userId) => {
        if (userId === game.user.id && template.parent?.id === sceneId && template.t === 'circle')
            template.updateSource({ distance: radius });
    };
    const listener = async (template, _options, userId) => {
        if (userId !== game.user.id || template.parent?.id !== sceneId || template.t !== 'circle') return;
        cleanup();
        try {
            if (Number(template.distance) !== radius) await template.update({ distance: radius });
            await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }),
                content: `<h2>Grenade placement</h2><p>${esc(actor.name)} places ${esc(grenade.name)} with a ${radius} ${esc(canvas.scene.grid.units || 'scene unit')} radius. ZM: review the circle and affected tokens. Nothing has been spent yet.</p>`,
                flags: { [SYSTEM]: { grenadeBlast: { status: 'pending', actorUuid: actor.uuid, itemUuid: grenade.uuid,
                    templateUuid: template.uuid, sceneId, radius, authorId: game.user.id } } } });
        } catch (error) { ui.notifications.error(`Grenade placement failed: ${error.message}`); }
    };
    const cleanup = () => { Hooks.off('preCreateMeasuredTemplate', setRadius); Hooks.off('createMeasuredTemplate', listener); clearTimeout(timeout); busy.delete(key); };
    const timeout = setTimeout(cleanup, 120000);
    Hooks.on('preCreateMeasuredTemplate', setRadius);
    Hooks.on('createMeasuredTemplate', listener);
    canvas.templates.activate({ tool: 'circle' });
    ui.notifications.info(`Place the grenade's blast center. The circle will use radius ${radius} ${canvas.scene.grid.units || 'scene units'}. Right-click to cancel; cancelling spends nothing.`);
}

async function review(message) {
    const data = message.getFlag(SYSTEM, 'grenadeBlast');
    if (!game.user.isGM || data?.status !== 'pending') return;
    const scene = game.scenes.get(data.sceneId);
    const template = await fromUuid(data.templateUuid);
    if (!scene || !template || canvas.scene?.id !== scene.id) throw new Error('Open the scene with the grenade circle.');
    if (Number(template.distance) !== Number(data.radius)) await template.update({ distance: Number(data.radius) });
    const tokens = canvas.tokens.placeables.filter(token => token.actor);
    const list = tokens.map(token => `<label><input type="checkbox" name="targets" value="${esc(token.document.id)}" ${blastContains(template, token, scene) ? 'checked' : ''}>${esc(token.name)}</label>`).join('<br>');
    new Dialog({ title: `ZM: ${esc((await fromUuid(data.itemUuid))?.name ?? 'grenade')} blast`,
        content: `<form><p>Radius ${data.radius} ${esc(scene.grid.units || 'scene units')}. Confirm spends one grenade and an Offensive action, then rolls blast damage against selected tokens.</p>${list || '<p>No tokens on the scene.</p>'}</form>`,
        buttons: { cancel: { label: 'Keep pending' }, deny: { label: 'Cancel blast', callback: () => message.update({ [`flags.${SYSTEM}.grenadeBlast.status`]: 'cancelled' }) },
            fire: { label: 'Detonate', callback: async html => {
                const ids = [...html[0].querySelectorAll('input[name="targets"]:checked')].map(input => input.value);
                try { await detonate(message, ids); } catch (error) { ui.notifications.warn(error.message); }
            } } }, default: 'fire' }).render(true);
}

export async function detonate(message, targetIds) {
    const data = message.getFlag(SYSTEM, 'grenadeBlast');
    if (!game.user.isGM || data?.status !== 'pending' || busy.has(message.uuid)) throw new Error('This blast is unavailable.');
    busy.add(message.uuid);
    try {
        const actor = await fromUuid(data.actorUuid);
        const item = await fromUuid(data.itemUuid);
        const template = await fromUuid(data.templateUuid);
        const author = game.users.get(data.authorId);
        if (!actor || !item || item.type !== 'grenade' || item.parent?.uuid !== actor.uuid || !template ||
            template.parent?.id !== data.sceneId || canvas.scene?.id !== data.sceneId || !author ||
            !author.isGM && !actor.testUserPermission(author, 'OWNER')) throw new Error('Grenade, thrower, or template is no longer valid.');
        if (Number(item.system.radius) !== Number(data.radius) || Number(template.distance) !== Number(data.radius))
            throw new Error('The blast radius changed. Reset the item and circle before detonating.');
        if (!quickAccess(actor, item) || Number(item.system.qty) < 1) throw new Error('The grenade is no longer ready.');
        const formula = String(item.system.damage || '').trim();
        if (!formula) throw new Error('Set a damage formula on the grenade.');
        const roll = new Roll(formula);
        const targets = [...new Set(targetIds)].map(id => canvas.tokens.get(id)).filter(token => token?.actor);
        const action = await spendAction(actor, 'offensive');
        await message.update({ [`flags.${SYSTEM}.grenadeBlast.status`]: 'detonating' });
        await item.update({ 'system.qty': Number(item.system.qty) - 1 });
        await roll.evaluate();
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll],
            content: `<h2>${esc(item.name)} detonates</h2><p>Blast radius ${data.radius} ${esc(canvas.scene.grid.units || 'scene units')}; ${targets.length} affected token(s). Damage ${roll.total}; Offensive action ${action.penalty}. Armor resolves separately for each target.</p>` });
        for (const token of targets) await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
            content: `<p>${esc(token.name)} is inside the blast of ${esc(item.name)}: ${roll.total} raw damage. ZM: apply armor and HP.</p>`,
            flags: { [SYSTEM]: { armorDamage: { targetUuid: token.actor.uuid, targetName: token.name, damage: roll.total,
                damages: [roll.total], damageType: damageType(item.system.damage_type), location: 'body', applied: false } } } });
        await message.update({ [`flags.${SYSTEM}.grenadeBlast.status`]: 'detonated' });
    } finally { busy.delete(message.uuid); }
}

export function renderGrenadeBlast(message, root) {
    const data = message.getFlag(SYSTEM, 'grenadeBlast');
    const container = root?.querySelector('.message-content');
    if (!data || !container || !game.user.isGM || data.status !== 'pending') return;
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = 'ZM: review grenade circle';
    button.addEventListener('click', async () => {
        button.disabled = true;
        try { await review(message); } catch (error) { ui.notifications.warn(error.message); }
        button.disabled = false;
    });
    container.append(button);
}
