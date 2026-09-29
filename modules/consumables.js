export const CONSUMABLE_FLAG = 'afmbe-left-behind';
export const ATTRIBUTES = ['strength', 'dexterity', 'constitution', 'intelligence', 'perception', 'willpower'];
export function activeBonuses(actor) {
    return (actor.getFlag(CONSUMABLE_FLAG, 'consumableEffects') ?? []).filter(effect => Number(effect.rounds) > 0);
}
export function attributeBonus(actor, key) {
    return activeBonuses(actor).filter(effect => effect.attribute === key).reduce((sum, effect) => sum + Number(effect.bonus || 0), 0);
}
export function skillBonus(actor, skill) {
    return activeBonuses(actor).filter(effect => effect.skillId === skill?.id).reduce((sum, effect) => sum + Number(effect.bonus || 0), 0);
}
export function startCrash(effect) {
    const penalty = Number(effect.crashPenalty || 0);
    const duration = Number(effect.crashDuration || 0);
    return penalty > 0 && duration > 0 ? { ...effect, phase: 'crash', bonus: -penalty, rounds: duration } : null;
}
export async function endConsumableEffect(actor, id) {
    const effects = activeBonuses(actor);
    const current = effects.find(effect => effect.id === id);
    if (!current || !actor.isOwner) return;
    const crash = current.phase !== 'crash' && startCrash(current);
    await actor.setFlag(CONSUMABLE_FLAG, 'consumableEffects', effects.filter(effect => effect.id !== id).concat(crash || []));
    if (crash) await announceCrash(actor, [crash]);
}
async function announceCrash(actor, effects) {
    const escape = foundry.utils.escapeHTML;
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<h2>${escape(actor.name)}: stim crash</h2>${effects.map(effect => `<p>${escape(effect.name)}: ${effect.bonus} to ${escape(effect.attribute || effect.skillName || 'skill')} for ${effect.rounds} rounds</p>`).join('')}` });
}
export async function useConsumable(item) {
    const actor = item?.parent;
    if (item?.type !== 'consumable' || !actor?.isOwner) return;
    if (!quickAccess(actor, item)) return ui.notifications.warn(item.system.storage?.containerId === 'stash'
        ? 'Retrieve this consumable from your off-character stash first.'
        : 'Move this consumable to pockets or a worn rig before using it in combat.');
    const qty = Number(item.system.qty);
    if (!Number.isInteger(qty) || qty < 1) return ui.notifications.warn('No consumables remaining.');
    const heal = Number(item.system.healing || 0);
    const bonus = Number(item.system.bonus || 0);
    const rounds = Number(item.system.duration || 0);
    const crashPenalty = Number(item.system.crashPenalty || 0);
    const crashDuration = Number(item.system.crashDuration || 0);
    const attribute = item.system.attribute;
    const skillId = item.system.skillId;
    const skillName = String(item.system.skillName ?? "").trim();
    const skill = skillName ? actor.items.find(entry => entry.type === "skill" && entry.name.trim().toLocaleLowerCase() === skillName.toLocaleLowerCase()) : actor.items.get(skillId);
    if (!Number.isInteger(heal) || heal < 0 || !Number.isInteger(bonus) || !Number.isInteger(rounds) || rounds < 0 || rounds > 100 ||
        !Number.isInteger(crashPenalty) || crashPenalty < 0 || crashPenalty > 100 || !Number.isInteger(crashDuration) || crashDuration < 0 || crashDuration > 100 ||
        (bonus && (!rounds || (!ATTRIBUTES.includes(attribute) && skill?.type !== 'skill'))) ||
        (!heal && !bonus)) return ui.notifications.warn('Configure healing or a valid timed bonus before using this item.');
    const effects = activeBonuses(actor);
    const hp = actor.system.secondaryAttributes?.hp;
    const restored = Math.min(heal, Math.max(0, Number(hp?.max || 0) - Number(hp?.value || 0)));
    const effect = bonus ? { id: foundry.utils.randomID(), name: item.name, attribute: ATTRIBUTES.includes(attribute) ? attribute : '', skillId: ATTRIBUTES.includes(attribute) ? '' : skill.id, bonus, rounds, phase: 'boost', crashPenalty, crashDuration, skillName: skill?.name || '' } : null;
    if (effect) effects.push(effect);
    // Keep the stack until all actor updates succeed, so a failed update never spends an item.
    const changes = { ...(restored ? { 'system.secondaryAttributes.hp.value': Number(hp.value) + restored } : {}),
        ...(effect ? { [`flags.${CONSUMABLE_FLAG}.consumableEffects`]: effects } : {}) };
    try {
        if (Object.keys(changes).length) await actor.update(changes);
        if (restored && Number(hp.value) + restored > 0 && actor.getFlag(CONSUMABLE_FLAG, 'regainedConsciousness')) await actor.unsetFlag(CONSUMABLE_FLAG, 'regainedConsciousness');
        await item.update({ 'system.qty': qty - 1 });
        const escape = foundry.utils.escapeHTML;
        const details = [restored ? `Restored ${restored} HP` : '', effect ? `${bonus > 0 ? '+' : ''}${bonus} ${effect.attribute || skill.name} for ${rounds} rounds${crashPenalty && crashDuration ? `; then -${crashPenalty} for ${crashDuration} rounds` : ''}` : ''].filter(Boolean).join('; ');
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<h2>${escape(actor.name)} uses ${escape(item.name)}</h2><p>${escape(details || 'No HP restored (already at maximum)')}</p>` });
    } catch (error) { console.error('AFMBE consumable use failed', error); ui.notifications.error('Could not use consumable; check its quantity and effects.'); }
}
export async function advanceConsumables(combat, changed) {
    if (!game.user.isGM || !Object.hasOwn(changed, 'round') || Number(changed.round) <= 0) return;
    for (const actor of new Set(combat.combatants.map(combatant => combatant.actor).filter(Boolean))) {
        const effects = activeBonuses(actor);
        if (!effects.length) continue;
        const previous = Number(combat.previous?.round ?? Number(changed.round) - 1);
        const elapsed = Math.max(0, Number(changed.round) - previous);
        if (!elapsed) continue;
        const updated = [];
        const crashes = [];
        for (const effect of effects) {
            const remaining = effect.rounds - elapsed;
            if (remaining > 0) updated.push({ ...effect, rounds: remaining });
            else if (effect.phase !== 'crash') {
                const crash = startCrash(effect);
                if (crash) {
                    const crashRemaining = crash.rounds + remaining;
                    if (crashRemaining > 0) { crash.rounds = crashRemaining; updated.push(crash); crashes.push(crash); }
                }
            }
        }
        await actor.setFlag(CONSUMABLE_FLAG, 'consumableEffects', updated);
        if (crashes.length) await announceCrash(actor, crashes);
    }
}
import { quickAccess } from './inventory-grid.js';
