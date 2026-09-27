import { traitRollEffects, traitSummary } from './trait-effects.js';
import { spendAction } from './action-economy.js';
import { attributeBonus, skillBonus } from './consumables.js';
import { damageType } from './damage-types.js';
import { weaponCategory } from './weapon-feed.js';
import { volleyHits } from './fire-modes.js';
const SYSTEM_ID = 'afmbe-left-behind';
const resolving = new Set();
const rolling = new Set();
const meleeTypes = new Set(['twoHanded', 'slashing', 'stabbing']);
export function isMeleeAttack(weapon) { return weaponCategory(weapon) === 'melee'; }
export function defenseOutcome(attack, mode, total) {
    if (mode === 'none') return { status: 'ready', blocked: false, result: 'No defense. The hit stands.' };
    if (attack.melee) {
        if (mode === 'dodge') return total > attack.total
            ? { status: 'avoided', blocked: false, result: 'Melee dodge succeeds. No damage.' }
            : { status: 'ready', blocked: false, result: 'Melee dodge fails. The hit stands.' };
        if (mode === 'block') return total >= 9
            ? { status: 'ready', blocked: true, result: 'Block succeeds. Damage after armor will be halved.' }
            : { status: 'ready', blocked: false, result: 'Block fails. The hit stands.' };
    } else if (mode === 'duck') {
        return total >= 9 && attack.total - 2 < 9
            ? { status: 'avoided', blocked: false, result: 'Duck succeeds: −2 to hit turns the attack into a miss.' }
            : { status: 'ready', blocked: false, result: total >= 9 ? 'Duck succeeds: −2 to hit, but the hit stands.' : 'Duck fails. The hit stands.' };
    }
    throw new Error('Defense does not apply to this attack.');
}

/** GM alone resolves the defender's reply against the attacker's chat message. */
export async function handleDefenseResponse(response) {
    if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
    const data = response.getFlag(SYSTEM_ID, 'defenseResponse');
    if (!data?.attackUuid || resolving.has(data.attackUuid)) return;
    resolving.add(data.attackUuid);
    try {
        const message = await fromUuid(data.attackUuid);
        const attack = message?.getFlag(SYSTEM_ID, 'pendingAttack');
        if (!attack || attack.status !== 'pending' || attack.targetUuid !== data.defenderUuid) return;
        const defender = await fromUuid(attack.targetUuid);
        const attacker = await fromUuid(attack.attackerUuid);
        const attackAuthor = game.users.get(message.user?.id ?? message.user);
        if (!attacker || !attackAuthor || (!attackAuthor.isGM && !attacker.testUserPermission(attackAuthor, 'OWNER'))) return;
        const sender = game.users.get(response.user?.id ?? response.user);
        if (!defender || !sender || (!sender.isGM && !defender.testUserPermission(sender, 'OWNER'))) return;
        if (data.mode !== 'none' && (!Number.isFinite(data.total) || !response.rolls?.length)) return;
        const outcome = defenseOutcome(attack, data.mode, Number(data.total));
        const adjustedHits = data.mode === 'duck' && Number(data.total) >= 9 && outcome.status === 'ready'
            ? volleyHits(attack.firingMode, attack.total - 2, Number(attack.roundsFired) || 1) : attack.hits;
        await message.update({ [`flags.${SYSTEM_ID}.pendingAttack.hits`]: adjustedHits, [`flags.${SYSTEM_ID}.pendingAttack.status`]: outcome.status,
            [`flags.${SYSTEM_ID}.pendingAttack.blocked`]: outcome.blocked,
            [`flags.${SYSTEM_ID}.pendingAttack.defenseResult`]: outcome.result });
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: defender }),
            content: `<h2>Defense Resolution</h2><p>${foundry.utils.escapeHTML(defender.name)}: ${foundry.utils.escapeHTML(outcome.result)}</p>` });
    } catch (error) { console.error('AFMBE linked defense failed', error); ui.notifications.error(`Defense resolution failed: ${error.message}`); }
    finally { resolving.delete(data.attackUuid); }
}

export async function declineDefense(message) {
    const attack = message.getFlag(SYSTEM_ID, 'pendingAttack');
    if (!attack || attack.status !== 'pending') return;
    const defender = await fromUuid(attack.targetUuid);
    if (!defender?.isOwner) return;
    await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor: defender }),
        content: `<p>${foundry.utils.escapeHTML(defender.name)} declines to defend against ${foundry.utils.escapeHTML(attack.weaponName)}.</p>`,
        flags: { [SYSTEM_ID]: { defenseResponse: { attackUuid: message.uuid, defenderUuid: defender.uuid, mode: 'none' } } } });
}

export async function promptLinkedDefense(message) {
    const attack = message.getFlag(SYSTEM_ID, 'pendingAttack');
    if (!attack || attack.status !== 'pending') return;
    const defender = await fromUuid(attack.targetUuid);
    if (!defender?.isOwner) return;
    const escape = value => foundry.utils.escapeHTML(String(value ?? ''));
    const attributes = defender.system.primaryAttributes ?? {};
    const options = Object.keys(attributes).map(key => `<option value="${escape(key)}" ${key === 'dexterity' ? 'selected' : ''}>${escape(key)}</option>`).join('');
    const skills = defender.items.filter(item => item.type === 'skill');
    const skillOptions = skills.map(skill => `<option value="${escape(skill.id)}">${escape(skill.name)} (${Number(skill.system.level) || 0})</option>`).join('');
    const modes = attack.melee ? '<option value="dodge">Dodge melee (beat attack)</option><option value="block">Block melee (9+; halve damage)</option>' :
        '<option value="duck">Duck gunfire (9+; attacker −2 to hit)</option>';
    const content = `<form><p>Incoming ${escape(attack.weaponName)} attack: ${attack.total} vs 9</p>
        <div class="form-group"><label>Defense</label><select name="mode">${modes}</select></div>
        <div class="form-group"><label>Attribute</label><select name="attribute">${options}</select></div>
        <div class="form-group"><label>Skill</label><select name="skill"><option value="">None</option>${skillOptions}</select></div>
        <div class="form-group"><label>Other modifier</label><input type="number" name="modifier" value="0" step="1"></div></form>`;
    new Dialog({ title: `Defend: ${attack.weaponName}`, content, buttons: {
        cancel: { label: 'Cancel' },
        roll: { label: 'Roll defense', callback: async html => {
            const latest = message.getFlag(SYSTEM_ID, 'pendingAttack');
            if (latest?.status !== 'pending') return ui.notifications.warn('This attack has already been resolved.');
            const form = html[0].querySelector('form');
            const modifier = Number(form.elements.modifier.value);
            if (!Number.isFinite(modifier)) return ui.notifications.warn('Enter a valid modifier.');
            const attributeKey = form.elements.attribute.value;
            const skill = defender.items.get(form.elements.skill.value);
            const attr = (Number(attributes[attributeKey]?.value) || 0) + attributeBonus(defender, attributeKey);
            const level = (Number(skill?.system.level) || 0) + skillBonus(defender, skill);
            let action;
            try { action = await spendAction(defender, 'defensive'); }
            catch (error) { return ui.notifications.warn(error.message); }
            const roll = await new Roll('1d10').evaluate();
            const automatic = traitRollEffects(defender, {kind: 'defense', mode: form.elements.mode.value, attribute: attributeKey, skillName: skill?.name});
            const total = roll.total + attr + level + modifier + action.penalty + automatic.total;
            const mode = form.elements.mode.value;
            await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor: defender }), rolls: [roll],
                content: `<h2>${escape(defender.name)} defends</h2><p>${escape(mode)}: ${roll.total} + ${escape(attributeKey)} ${attr} + ${escape(skill?.name ?? 'no skill')} ${level} + modifier ${modifier} + action ${action.penalty} + traits ${traitSummary(automatic, null, null, escape)} = <strong>${total}</strong></p>`,
                flags: { [SYSTEM_ID]: { defenseResponse: { attackUuid: message.uuid, defenderUuid: defender.uuid, mode, total } } } });
        } }
    }, default: 'roll' }, { classes: ['dialog', 'afmbe-left-behind'] }).render(true);
}

export async function rollLinkedDamage(message) {
    if (rolling.has(message.id)) return;
    const attack = message.getFlag(SYSTEM_ID, 'pendingAttack');
    if (!attack || attack.status !== 'ready') return;
    const attacker = await fromUuid(attack.attackerUuid);
    const weapon = await fromUuid(attack.weaponUuid);
    if (!attacker?.isOwner || !weapon || weapon.parent?.uuid !== attacker.uuid) return;
    rolling.add(message.id);
    try {
        // Claim the attack before rolling so the chat control cannot apply it twice.
        await message.update({ [`flags.${SYSTEM_ID}.pendingAttack.status`]: 'rolling' });
        const hits = Math.max(1, Math.min(10, Number(attack.hits) || 1));
        const rolls = [];
        for (let i = 0; i < hits; i++) rolls.push(await new Roll(weapon.system.damage_string).evaluate());
        const values = rolls.map(roll => roll.total);
        await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor: attacker }), rolls,
            content: `<h2>Damage Rolls</h2><div class="afmbe-roll-kind">${foundry.utils.escapeHTML(weapon.name)}</div><p>${hits} hit(s): ${values.join(', ')}. Each hit resolves against armor separately.${attack.blocked ? ' Block halves damage after armor for each hit.' : ''}</p>`,
            flags: { [SYSTEM_ID]: { armorDamage: { targetUuid: attack.targetUuid, targetName: attack.targetName,
                damage: values[0], damages: values, damageType: damageType(attack.damageType ?? weapon.system.damage_type), location: attack.location,
                blocked: Boolean(attack.blocked), applied: false, attackUuid: message.uuid } } } });
        await message.update({ [`flags.${SYSTEM_ID}.pendingAttack.status`]: 'complete' });
    } catch (error) {
        console.error('AFMBE linked damage failed', error);
        // Keep the attack recoverable if the roll or message creation failed.
        await message.update({ [`flags.${SYSTEM_ID}.pendingAttack.status`]: 'ready' });
        ui.notifications.error(`Could not roll linked damage: ${error.message}`);
    } finally { rolling.delete(message.id); }
}

export async function renderLinkedAttack(message, root) {
    const attack = message.getFlag(SYSTEM_ID, 'pendingAttack');
    if (!attack || !root) return;
    const container = root.querySelector('.message-content');
    if (!container) return;
    const makeButton = (label, fn) => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.addEventListener('click', async () => {
            button.disabled = true;
            try { await fn(); } catch (error) { ui.notifications.error(error.message); }
            if (message.getFlag(SYSTEM_ID, 'pendingAttack')?.status === attack.status) button.disabled = false;
        });
        container.append(button);
    };
    if (attack.status === 'pending') {
        const defender = await fromUuid(attack.targetUuid);
        if (defender?.isOwner) {
            makeButton(`Defend ${defender.name}`, () => promptLinkedDefense(message));
            makeButton('No defense', () => declineDefense(message));
        }
    } else if (attack.status === 'ready') {
        const attacker = await fromUuid(attack.attackerUuid);
        if (attacker?.isOwner) makeButton('Roll damage', () => rollLinkedDamage(message));
    }
}
