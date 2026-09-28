import { armorIntegrity } from './armor-integrity.js';
import { spendAction } from './action-economy.js';
import { attributeBonus, skillBonus } from './consumables.js';
import { traitRollEffects, traitSummary } from './trait-effects.js';
import { quickAccess, inCombat } from './inventory-grid.js';

export function promptArmorReplenishment(actor, armor) {
    if (!actor?.isOwner || !armor || !['armor', 'item'].includes(armor.type)) return;
    if (inCombat(actor) && (!armor.system.equipped || armor.system.storage?.containerId))
        return ui.notifications.warn('Repair armor while it is worn or outside combat.');
    const before = armorIntegrity(armor);
    if (before.value >= before.max) return ui.notifications.info(`${armor.name} is already intact.`);
    const supplies = actor.items.filter(item => item.type === 'consumable' && quickAccess(actor, item) &&
        Number(item.system.armorRestoration) >= 1 && Number.isInteger(Number(item.system.qty)) && Number(item.system.qty) > 0);
    if (!supplies.length) return ui.notifications.warn('Add a consumable with Armor integrity restored greater than zero to replenish armor.');
    const esc = foundry.utils.escapeHTML;
    const attributes = actor.system.primaryAttributes ?? {};
    const options = Object.keys(attributes).map(key => `<option value="${esc(key)}" ${key === 'dexterity' ? 'selected' : ''}>${esc(key)}</option>`).join('');
    const skills = actor.items.filter(item => item.type === 'skill');
    const skillOptions = skills.map(item => `<option value="${esc(item.id)}" ${/repair|mechanic/i.test(item.name) ? 'selected' : ''}>${esc(item.name)} (${Number(item.system.level) || 0})</option>`).join('');
    new Dialog({ title: `Replenish ${armor.name}`, content: `<form><p>${esc(armor.name)}: ${before.value}/${before.max} integrity. On success, spend one supply and restore its listed integrity. On failure, spend the Help action only.</p>
        <label>Supplies</label><select name="supply">${supplies.map(item => `<option value="${esc(item.id)}">${esc(item.name)} (+${Number(item.system.armorRestoration)}; ${Number(item.system.qty)} remaining)</option>`).join('')}</select>
        <label>Attribute</label><select name="attribute">${options}</select>
        <label>Skill</label><select name="skill"><option value="">None</option>${skillOptions}</select>
        <label>Other modifier</label><input name="modifier" type="number" step="1" value="0"></form>`,
        buttons: { cancel: { label: 'Cancel' }, roll: { label: 'Roll Help task', callback: async html => {
            const form = html[0].querySelector('form');
            const supply = actor.items.get(form.elements.supply.value);
            const current = armorIntegrity(armor);
            if (current.value >= current.max || !supply || Number(supply.system.qty) < 1 || Number(supply.system.armorRestoration) < 1)
                return ui.notifications.warn('Armor or supplies changed; open the replenishment dialog again.');
            const modifier = Number(form.elements.modifier.value);
            if (!Number.isFinite(modifier)) return ui.notifications.warn('Enter a valid modifier.');
            const key = form.elements.attribute.value;
            const skill = actor.items.get(form.elements.skill.value);
            let action;
            try { action = await spendAction(actor, 'help'); }
            catch (error) { return ui.notifications.warn(error.message); }
            const roll = await new Roll('1d10').evaluate();
            const traits = traitRollEffects(actor, { kind: 'help', attribute: key, skillName: skill?.name });
            const total = roll.total + (Number(attributes[key]?.value) || 0) + attributeBonus(actor, key) + (Number(skill?.system.level) || 0) + skillBonus(actor, skill) + modifier + action.penalty + traits.total;
            let result = 'Failure: armor and supplies unchanged.';
            if (total >= 9) {
                const restored = Math.min(current.max, current.value + Math.floor(Number(supply.system.armorRestoration)));
                // Recheck after the roll so a stale dialog cannot overwrite newer repairs.
                if (armorIntegrity(armor).value !== current.value || Number(supply.system.qty) < 1) result = 'Armor or supplies changed during the roll; no repair applied.';
                else {
                    await armor.update({ 'system.armor_integrity.value': restored });
                    await supply.update({ 'system.qty': Number(supply.system.qty) - 1 });
                    result = `Success: ${esc(armor.name)} ${current.value} → ${restored} integrity; one ${esc(supply.name)} used.`;
                }
            }
            await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll],
                content: `<h2>${esc(actor.name)} replenishes armor</h2><p>Roll ${roll.total} + ${esc(key)} ${Number(attributes[key]?.value) || 0} + skill ${esc(skill?.name ?? 'none')} ${Number(skill?.system.level) || 0} + modifier ${modifier} + Help action ${action.penalty} + traits ${esc(traitSummary(traits, null, null, esc))} + active effects ${attributeBonus(actor, key) + skillBonus(actor, skill)} = <strong>${total}</strong> vs 9.</p><p>${result}</p>` });
        } } }, default: 'roll' }).render(true);
}
