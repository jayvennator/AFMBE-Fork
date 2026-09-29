import { attributeBonus, skillBonus } from './consumables.js';
import { traitRollEffects, manualTraitValue, traitSummary } from './trait-effects.js';

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
    const esc = foundry.utils.escapeHTML;
    const options = type => actor.items.filter(item => item.type === type)
        .map(item => `<option value="${esc(item.id)}">${esc(item.name)} (${type === 'skill' ? Number(item.system.level) || 0 : Number(item.system.bonus) || 0})</option>`).join('');
    const content = `<form><p>Simple Willpower Test (Willpower ×2 + 1d10) vs 9. HP ${state.hp} applies ${-Math.abs(state.hp)}.</p>
        <div class="form-group"><label>Skill</label><select name="skill"><option value="">None</option>${options('skill')}</select></div>
        <div class="form-group"><label>Quality</label><select name="quality"><option value="">None</option>${options('quality')}</select></div>
        <div class="form-group"><label>Drawback</label><select name="drawback"><option value="">None</option>${options('drawback')}</select></div>
        <div class="form-group"><label>Other modifier</label><input type="number" name="modifier" value="0" step="1"></div></form>`;
    new Dialog({ title: 'Regain consciousness', content, buttons: {
        cancel: { label: 'Cancel' },
        roll: { label: 'Roll Willpower', callback: async html => {
            try {
                const form = html[0].querySelector('form');
                const modifier = Number(form.elements.modifier.value);
                if (!Number.isFinite(modifier)) throw new Error('Enter a valid modifier.');
                const skill = actor.items.get(form.elements.skill.value);
                const quality = actor.items.get(form.elements.quality.value);
                const drawback = actor.items.get(form.elements.drawback.value);
                await rollConsciousnessRecovery(actor, { skill, quality, drawback, modifier });
            } catch (error) { ui.notifications.warn(error.message); }
        } }
    }, default: 'roll' }, { classes: ['dialog', 'afmbe-left-behind', game.settings.get(SYSTEM, 'dark-mode') ? 'dark-mode' : ''] }).render(true);
}

export async function rollConsciousnessRecovery(actor, { skill = null, quality = null, drawback = null, modifier = 0 } = {}) {
    if (!actor?.isOwner) throw new Error('You cannot roll for this actor.');
    const state = healthState(actor);
    if (!state.semiConscious || state.conscious) throw new Error('A consciousness Test is not needed.');
    if (skill && (skill.parent !== actor || skill.type !== 'skill')) throw new Error('Select a skill belonging to this actor.');
    if (quality && (quality.parent !== actor || quality.type !== 'quality')) throw new Error('Select a quality belonging to this actor.');
    if (drawback && (drawback.parent !== actor || drawback.type !== 'drawback')) throw new Error('Select a drawback belonging to this actor.');
    if (!Number.isFinite(modifier)) throw new Error('Enter a valid modifier.');
    const will = Number(actor.system.primaryAttributes?.willpower?.value) || 0;
    const traits = traitRollEffects(actor, { kind: 'attribute', attribute: 'willpower', skillName: skill?.name });
    const skillValue = skill ? (Number(skill.system.level) || 0) + skillBonus(actor, skill) : 0;
    const qualityValue = manualTraitValue(quality, traits);
    const drawbackValue = manualTraitValue(drawback, traits);
    const effects = attributeBonus(actor, 'willpower') + traits.total + skillValue + qualityValue + drawbackValue + modifier - Math.abs(state.hp);
    const roll = await new Roll('1d10').evaluate();
    const total = Number(roll.total) + will * 2 + effects;
    if (total >= 9) await actor.setFlag(SYSTEM, 'regainedConsciousness', true);
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll],
        content: `<h2>${foundry.utils.escapeHTML(actor.name)}: regain consciousness</h2><p>Willpower Test: ${roll.total} + Willpower ${will * 2} + ${foundry.utils.escapeHTML(skill?.name ?? 'no skill')} ${skillValue} + traits ${traitSummary(traits, quality, drawback, foundry.utils.escapeHTML)} + attribute effects ${attributeBonus(actor, 'willpower')} + other ${modifier} − HP penalty ${Math.abs(state.hp)} = <strong>${total}</strong> vs 9. ${total >= 9 ? 'Conscious, but still injured.' : 'Still semi-conscious.'}</p>` });
    return { total, success: total >= 9 };
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
