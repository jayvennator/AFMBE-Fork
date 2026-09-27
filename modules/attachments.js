import { spendAction } from './action-economy.js';
import { attributeBonus, skillBonus } from './consumables.js';
import { traitRollEffects, traitSummary } from './trait-effects.js';
import { weaponCategory } from './weapon-feed.js';

export const ATTACHMENT_SLOTS = Object.freeze(['optic', 'muzzle', 'underbarrel', 'stock', 'accessory']);
const safe = value => foundry.utils.escapeHTML(String(value ?? ''));
const bounded = (value, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : 0;
};

/** Only actor-owned attachments with a valid slot and category affect a weapon. */
export function installedAttachments(actor, weapon) {
    if (!actor || !weapon || weapon.parent?.uuid !== actor.uuid) return [];
    return actor.items.filter(item => item.type === 'attachment' && item.system.installedWeaponId === weapon.id &&
        ATTACHMENT_SLOTS.includes(item.system.slot) &&
        ['any', weaponCategory(weapon)].includes(item.system.weaponCategory));
}
export function attachmentModifiers(actor, weapon, { aimed = false } = {}) {
    const seen = new Set();
    const items = installedAttachments(actor, weapon).filter(item => {
        if (seen.has(item.system.slot)) return false;
        seen.add(item.system.slot);
        return true;
    });
    return { items,
        attack: items.reduce((sum, item) => sum + (item.system.slot === 'optic' && !aimed ? 0 : bounded(item.system.attackBonus, -2, 2)), 0),
        recoil: items.reduce((sum, item) => sum + bounded(item.system.recoilReduction, 0, 2), 0),
        range: items.reduce((sum, item) => sum + bounded(item.system.rangeBonusMeters, 0, 100), 0) };
}
export function canInstall(actor, weapon, attachment) {
    return Boolean(actor?.isOwner && weapon?.type === 'weapon' && attachment?.type === 'attachment' &&
        weapon.parent?.uuid === actor.uuid && attachment.parent?.uuid === actor.uuid &&
        ATTACHMENT_SLOTS.includes(attachment.system.slot) &&
        ['any', weaponCategory(weapon)].includes(attachment.system.weaponCategory) &&
        !attachment.system.installedWeaponId &&
        !actor.items.filter(item => item.type === 'attachment' && item.id !== attachment.id &&
            item.system.installedWeaponId === weapon.id && item.system.slot === attachment.system.slot).length);
}

export function promptInstallAttachment(actor, weapon) {
    if (!actor?.isOwner || !weapon) return;
    const available = actor.items.filter(item => canInstall(actor, weapon, item));
    if (!available.length) return ui.notifications.warn('No compatible, uninstalled attachment fits a free slot on this weapon.');
    const attributes = actor.system.primaryAttributes ?? {};
    const attrs = Object.keys(attributes).map(key => `<option value="${safe(key)}" ${key === 'dexterity' ? 'selected' : ''}>${safe(key)}</option>`).join('');
    const skills = actor.items.filter(item => item.type === 'skill');
    const skillOptions = skills.map(item => `<option value="${safe(item.id)}" ${/mechanic|repair/i.test(item.name) ? 'selected' : ''}>${safe(item.name)} (${Number(item.system.level) || 0})</option>`).join('');
    const options = available.map(item => `<option value="${safe(item.id)}">${safe(item.name)} (${safe(item.system.slot)})</option>`).join('');
    new Dialog({ title: `Install attachment: ${weapon.name}`, content: `<form>
        <p>Help task (9+). Failure spends the action but leaves the attachment uninstalled.</p>
        <label>Attachment</label><select name="attachment">${options}</select>
        <label>Attribute</label><select name="attribute">${attrs}</select>
        <label>Skill</label><select name="skill"><option value="">None</option>${skillOptions}</select>
        <label>Other modifier</label><input type="number" name="modifier" step="1" value="0"></form>`,
        buttons: { cancel: { label: 'Cancel' }, install: { label: 'Roll Help task', callback: async html => {
            const form = html[0].querySelector('form');
            const attachment = actor.items.get(form.elements.attachment.value);
            if (!canInstall(actor, weapon, attachment)) return ui.notifications.warn('Weapon slot or attachment changed; open the dialog again.');
            const modifier = Number(form.elements.modifier.value);
            if (!Number.isFinite(modifier)) return ui.notifications.warn('Enter a valid modifier.');
            const key = form.elements.attribute.value;
            if (!Object.hasOwn(attributes, key)) return ui.notifications.warn('Choose a valid attribute.');
            const skill = actor.items.get(form.elements.skill.value);
            let action;
            try { action = await spendAction(actor, 'help'); } catch (error) { return ui.notifications.warn(error.message); }
            const roll = await new Roll('1d10').evaluate();
            const traits = traitRollEffects(actor, { kind: 'help', attribute: key, skillName: skill?.name });
            const attr = (Number(attributes[key]?.value) || 0) + attributeBonus(actor, key);
            const level = (Number(skill?.system.level) || 0) + skillBonus(actor, skill);
            const total = roll.total + attr + level + modifier + action.penalty + traits.total;
            let outcome = 'Failure: attachment remains uninstalled.';
            if (total >= 9) {
                if (canInstall(actor, weapon, attachment)) {
                    await attachment.update({ 'system.installedWeaponId': weapon.id });
                    outcome = `Success: ${safe(attachment.name)} installed on ${safe(weapon.name)}.`;
                } else outcome = 'Slot changed during the roll; no attachment installed.';
            }
            await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll],
                content: `<h2>${safe(actor.name)} installs an attachment</h2><p>Roll ${roll.total} + ${safe(key)} ${attr} + ${safe(skill?.name ?? 'no skill')} ${level} + modifier ${modifier} + Help action ${action.penalty} + traits ${safe(traitSummary(traits, null, null, safe))} = <strong>${total}</strong> vs 9.</p><p>${outcome}</p>` });
        } } }, default: 'install' }).render(true);
}

export async function removeAttachment(actor, attachment) {
    if (!actor?.isOwner || attachment?.type !== 'attachment' || !attachment.system.installedWeaponId) return;
    const weapon = actor.items.get(attachment.system.installedWeaponId);
    const action = await spendAction(actor, 'help');
    await attachment.update({ 'system.installedWeaponId': '' });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p>${safe(actor.name)} removes ${safe(attachment.name)} from ${safe(weapon?.name ?? 'a missing weapon')} (Help action${action.tracked ? `; ${action.used}, repeat penalty ${action.penalty}` : ''}).</p>` });
}
