import { traitRollEffects, traitSummary } from './trait-effects.js';
import { actionState, spendAction } from './action-economy.js';
import { attributeBonus, skillBonus } from './consumables.js';
const SYSTEM_ID = 'afmbe-left-behind';
const locks = new Set();

export function enduranceCost(constitution) {
    const score = Math.max(0, Math.min(5, Number(constitution) || 0));
    return Math.max(1, Math.ceil((6 - score) / 2));
}
export function swingLimit(weapon) {
    const value = Number(weapon.system.swingsPerAction ?? 1);
    return Number.isSafeInteger(value) && value >= 1 ? Math.min(value, 20) : 1;
}
export function meleeAttribute(weapon) {
    return ['strength', 'dexterity'].includes(weapon.system.meleeAttribute) ? weapon.system.meleeAttribute :
        weapon.system.damage_cha_multiplier === 'dexterity' ? 'dexterity' : 'strength';
}
function sequence(actor) {
    const state = actionState(actor);
    if (!state) return null;
    const stored = actor.getFlag(SYSTEM_ID, 'meleeSequence') ?? {};
    const key = `${state.combatId}:${game.combat.round}:${state.turn ?? 'outside-turn'}`;
    return stored.key === key ? stored : { key, weaponId: '', swingsInAction: 0, totalSwings: 0, actionNumber: 0, actionPenalty: 0, offensiveUsed: -1, paidAction: false };
}
export function meleePreview(actor, weapon) {
    const state = sequence(actor);
    if (!state) return { swings: 0, limit: swingLimit(weapon), strain: 0, nextAction: false, endurance: 0 };
    const used = state.weaponId === weapon.id ? state.swingsInAction : 0;
    return { swings: used, limit: swingLimit(weapon), strain: state.weaponId === weapon.id ? state.totalSwings : 0,
        nextAction: Boolean(state.actionNumber && (state.weaponId !== weapon.id || used >= swingLimit(weapon))),
        endurance: enduranceCost(actor.system.primaryAttributes?.constitution?.value) };
}

/** Reserve one strike. A failed Constitution task consumes the repeated Offensive action, but not Endurance. */
export async function prepareMeleeStrike(actor, weapon, skill) {
    if (!actor.isOwner) throw new Error('Only the actor owner can make a melee attack.');
    if (locks.has(actor.uuid)) throw new Error('Another melee attack is being recorded. Try again.');
    locks.add(actor.uuid);
    try {
        const state = sequence(actor);
        if (!state) { const action = await spendAction(actor, 'offensive'); return { actionPenalty: action.penalty, strainPenalty: 0, meleeBonus: 1, enduranceSpent: 0, swing: 1, action: 1 }; }
        const used = actionState(actor).counts.offensive;
        const canContinue = state.weaponId === weapon.id && state.actionNumber > 0 && state.swingsInAction < swingLimit(weapon) && state.offensiveUsed === used;
        let actionPenalty = state.actionPenalty;
        let actionNumber = state.actionNumber;
        let swingsInAction = canContinue ? state.swingsInAction : 0;
        if (!canContinue) {
            const repeat = used > 0;
            const cost = enduranceCost(actor.system.primaryAttributes?.constitution?.value);
            const current = Number(actor.system.secondaryAttributes?.endurance_points?.value);
            if (repeat && (!Number.isFinite(current) || current < cost)) throw new Error(`Need ${cost} Endurance for an additional melee swing.`);
            const action = await spendAction(actor, 'offensive');
            actionPenalty = action.penalty;
            actionNumber = state.actionNumber + 1;
            if (repeat) {
                const constitution = (Number(actor.system.primaryAttributes?.constitution?.value) || 0) + attributeBonus(actor, 'constitution');
                const skillLevel = (Number(skill?.system.level) || 0) + skillBonus(actor, skill);
                const roll = await new Roll('1d10').evaluate();
                const automatic = traitRollEffects(actor, {kind: 'endurance', attribute: 'constitution', skillName: skill?.name});
                const total = roll.total + constitution + skillLevel + actionPenalty + automatic.total;
                const passed = total >= 9;
                const esc = foundry.utils.escapeHTML;
                await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll],
                    content: `<h2>${esc(actor.name)} tests endurance</h2><p>Constitution ${constitution} + ${esc(skill?.name ?? 'no skill')} ${skillLevel} + action ${actionPenalty} + traits ${traitSummary(automatic, null, null, esc)} + roll ${roll.total} = <strong>${total}</strong> vs 9. ${passed ? 'Attack continues.' : 'No additional melee attack.'}</p>` });
                if (!passed) {
                    await actor.setFlag(SYSTEM_ID, 'meleeSequence', { ...state, weaponId: weapon.id, swingsInAction: swingLimit(weapon), offensiveUsed: used + 1 });
                    return null;
                }
            }
        }
        const repeatSwing = canContinue ? state.paidAction : used > 0;
        const cost = repeatSwing ? enduranceCost(actor.system.primaryAttributes?.constitution?.value) : 0;
        if (cost) {
            const current = Number(actor.system.secondaryAttributes?.endurance_points?.value);
            if (!Number.isFinite(current) || current < cost) throw new Error(`Need ${cost} Endurance for this swing.`);
            await actor.update({ 'system.secondaryAttributes.endurance_points.value': current - cost });
        }
        const totalSwings = state.weaponId === weapon.id ? state.totalSwings + 1 : 1;
        await actor.setFlag(SYSTEM_ID, 'meleeSequence', { key: state.key, weaponId: weapon.id,
            swingsInAction: swingsInAction + 1, totalSwings, actionNumber, actionPenalty,
            offensiveUsed: canContinue ? used : used + 1, paidAction: repeatSwing });
        return { actionPenalty, strainPenalty: -Math.max(0, Number(weapon.system.strain) || 0) * totalSwings,
            meleeBonus: 1, enduranceSpent: cost, swing: swingsInAction + 1, action: actionNumber };
    } finally { locks.delete(actor.uuid); }
}
