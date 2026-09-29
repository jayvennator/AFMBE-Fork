import { attributeBonus } from './consumables.js';
import { traitRollEffects } from './trait-effects.js';

const SYSTEM = 'afmbe-left-behind';
export function healthState(actor) {
    const hp = Number(actor?.system?.secondaryAttributes?.hp?.value) || 0;
    const dead = Boolean(actor?.getFlag?.(SYSTEM, 'failedSurvival'));
    const conscious = Boolean(actor?.getFlag?.(SYSTEM, 'regainedConsciousness'));
    return { hp, dead, conscious, dying: hp <= -10, semiConscious: hp <= 0 && hp > -10,
        penalty: hp > 0 && hp <= 5 ? hp - 6 : hp <= 0 ? -5 : 0 };
}

export async function clearFailedSurvival(actor) {
    if (!game.user.isGM) throw new Error('Only the ZM can resolve a failed Survival Test.');
    await actor.unsetFlag(SYSTEM, 'failedSurvival');
}

export function assertCanAct(actor) {
    const state = healthState(actor);
    if (state.dead) throw new Error('Survival Test failed; the ZM must resolve this character’s fate.');
    if (state.dying) throw new Error('Dying: this character cannot act until stabilized.');
    if (state.semiConscious && !state.conscious) throw new Error('Semi-conscious: make a Willpower recovery Test before acting.');
}

export async function recoverConsciousness(actor) {
    if (!actor?.isOwner) throw new Error('You cannot roll for this actor.');
    const state = healthState(actor);
    if (!state.semiConscious || state.conscious) throw new Error('A consciousness Test is not needed.');
    const will = Number(actor.system.primaryAttributes?.willpower?.value) || 0;
    const traits = traitRollEffects(actor, { kind: 'attribute', attribute: 'willpower' });
    const modifier = attributeBonus(actor, 'willpower') + traits.total - Math.abs(state.hp);
    const roll = await new Roll('1d10').evaluate();
    const total = Number(roll.total) + will * 2 + modifier;
    if (total >= 9) await actor.setFlag(SYSTEM, 'regainedConsciousness', true);
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll],
        content: `<h2>${foundry.utils.escapeHTML(actor.name)}: regain consciousness</h2><p>Willpower Test: ${roll.total} + ${will * 2} + modifiers ${modifier} = <strong>${total}</strong> vs 9. ${total >= 9 ? 'Conscious, but still injured.' : 'Still semi-conscious.'}</p>` });
}

export async function resolveHealthDamage(actor, previousHp, currentHp) {
    if (currentHp > 0) {
        if (actor.getFlag(SYSTEM, 'regainedConsciousness')) await actor.unsetFlag(SYSTEM, 'regainedConsciousness');
        return;
    }
    if (currentHp < previousHp && actor.getFlag(SYSTEM, 'regainedConsciousness')) await actor.unsetFlag(SYSTEM, 'regainedConsciousness');
    if (previousHp <= -10 || currentHp > -10) return;
    const constitution = Number(actor.system.primaryAttributes?.constitution?.value) || 0;
    const traits = traitRollEffects(actor, { kind: 'attribute', attribute: 'constitution' });
    const effects = attributeBonus(actor, 'constitution') + traits.total;
    const roll = await new Roll('1d10').evaluate();
    const total = Number(roll.total) + constitution * 2 + effects;
    if (total < 9) await actor.setFlag(SYSTEM, 'failedSurvival', true);
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll],
        content: `<h2>${foundry.utils.escapeHTML(actor.name)}: Survival Test</h2><p>HP ${previousHp} → ${currentHp}. ${roll.total} + Constitution ${constitution * 2} + effects ${effects} = <strong>${total}</strong> vs 9. ${total >= 9 ? 'Survives for now, but is dying and cannot act until stabilized.' : 'Failed: immediate death is possible; ZM resolves the outcome.'}</p>` });
}
