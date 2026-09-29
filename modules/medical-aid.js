import { spendAction } from './action-economy.js';
import { quickAccess } from './inventory-grid.js';
import { attributeBonus, skillBonus } from './consumables.js';
import { traitRollEffects, manualTraitValue, traitSummary } from './trait-effects.js';
import { healthState } from './health-states.js';

const SYSTEM = 'afmbe-left-behind';
const resolving = new Set();
const esc = value => foundry.utils.escapeHTML(String(value ?? ''));
const firstAid = actor => actor.items.find(item => item.type === 'skill' && /first aid/i.test(item.name));
const supplies = actor => actor.items.filter(item => item.type === 'consumable' && Number(item.system.healing) > 0 && Number(item.system.qty) > 0 && quickAccess(actor, item));

function targetFor(healer) {
    const targets = [...game.user.targets];
    if (targets.length !== 1 || !targets[0].actor || targets[0].actor.uuid === healer.uuid) throw new Error('Target exactly one other character token.');
    const target = targets[0];
    const tokens = canvas?.tokens?.placeables?.filter(token => token.actor?.uuid === healer.uuid) ?? [];
    const source = tokens.find(token => token.controlled) ?? (tokens.length === 1 ? tokens[0] : null);
    const size = Number(canvas?.grid?.size);
    const distance = Number(canvas?.scene?.grid?.distance);
    if (!source || !size || !distance || source.document.parent?.id !== target.document.parent?.id)
        throw new Error('Select your healer token on the target’s scene.');
    const meters = Math.hypot(source.center.x - target.center.x, source.center.y - target.center.y) / size * distance;
    if (meters > distance * 1.5) throw new Error('Move within one adjacent grid space to give First Aid.');
    return target.actor;
}

export function promptMedicalAid(healer, kind) {
    if (!healer?.isOwner || !['stabilize', 'treat'].includes(kind)) throw new Error('First Aid is unavailable.');
    const target = targetFor(healer);
    const state = healthState(target);
    if (state.dead) throw new Error('The ZM has confirmed death.');
    if (kind === 'stabilize' && (!state.dying || state.stable || state.critical?.expired)) throw new Error('This target cannot be stabilized now.');
    if (kind === 'treat' && (state.critical || state.dying && !state.stable || state.hp >= Number(target.system.secondaryAttributes.hp.max)))
        throw new Error('Stabilize a dying target first, or select an injured target.');
    if (!firstAid(healer)) throw new Error('The healer needs the First Aid skill.');
    const available = supplies(healer);
    if (!available.length) throw new Error('Carry a healing consumable in pockets or an equipped rig.');
    const options = type => healer.items.filter(item => item.type === type).map(item =>
        `<option value="${esc(item.id)}">${esc(item.name)} (${Number(item.system.bonus) || 0})</option>`).join('');
    const content = `<form><p>${esc(kind === 'stabilize' ? 'Stabilize' : 'Treat')} ${esc(target.name)} (HP ${state.hp}).
        Intelligence + First Aid vs ${kind === 'stabilize' && state.critical ? 13 : 9}. Supply is consumed on success.</p>
        <div class="form-group"><label>Medical supply</label><select name="supply">${available.map(item => `<option value="${esc(item.id)}">${esc(item.name)} (${Number(item.system.qty)} available; heals ${Number(item.system.healing)})</option>`).join('')}</select></div>
        <div class="form-group"><label>Quality</label><select name="quality"><option value="">None</option>${options('quality')}</select></div>
        <div class="form-group"><label>Drawback</label><select name="drawback"><option value="">None</option>${options('drawback')}</select></div>
        <div class="form-group"><label>Other modifier</label><input type="number" name="modifier" value="0" step="1"></div></form>`;
    new Dialog({ title: kind === 'stabilize' ? 'Stabilize ally' : 'Treat ally', content, buttons: {
        cancel: { label: 'Cancel' }, roll: { label: 'Roll First Aid', callback: async html => {
            try {
                const form = html[0].querySelector('form');
                await rollMedicalAid(healer, target, kind, {
                    supply: healer.items.get(form.elements.supply.value),
                    quality: healer.items.get(form.elements.quality.value),
                    drawback: healer.items.get(form.elements.drawback.value),
                    modifier: Number(form.elements.modifier.value)
                });
            } catch (error) { ui.notifications.warn(error.message); }
        } }
    }, default: 'roll' }, { classes: ['dialog', 'afmbe-left-behind', game.settings.get(SYSTEM, 'dark-mode') ? 'dark-mode' : ''] }).render(true);
}

export async function rollMedicalAid(healer, target, kind, { supply, quality = null, drawback = null, modifier = 0 }) {
    if (!healer?.isOwner || !['stabilize', 'treat'].includes(kind) || !Number.isFinite(modifier)) throw new Error('Invalid First Aid roll.');
    if (targetFor(healer)?.uuid !== target.uuid) throw new Error('Target changed; try again.');
    const state = healthState(target);
    if (state.dead || kind === 'stabilize' && (!state.dying || state.stable || state.critical?.expired) ||
        kind === 'treat' && (state.critical || state.dying && !state.stable || state.hp >= Number(target.system.secondaryAttributes.hp.max)))
        throw new Error('The target’s condition changed; reopen First Aid.');
    const skill = firstAid(healer);
    if (!skill || !supply || !supplies(healer).some(item => item.id === supply.id)) throw new Error('First Aid skill and accessible medical supply are required.');
    if (quality && (quality.type !== 'quality' || quality.parent !== healer) || drawback && (drawback.type !== 'drawback' || drawback.parent !== healer))
        throw new Error('Selected trait is unavailable.');
    const action = await spendAction(healer, 'help');
    const roll = await new Roll('1d10').evaluate();
    const intelligence = Number(healer.system.primaryAttributes?.intelligence?.value) || 0;
    const level = (Number(skill.system.level) || 0) + skillBonus(healer, skill);
    const traits = traitRollEffects(healer, { kind: 'help', attribute: 'intelligence', skillName: skill.name });
    const effects = attributeBonus(healer, 'intelligence') + level + traits.total + manualTraitValue(quality, traits) +
        manualTraitValue(drawback, traits) + modifier + action.penalty + healthState(healer).penalty;
    const total = Number(roll.total) + intelligence + effects;
    const difficulty = kind === 'stabilize' && state.critical ? 13 : 9;
    const success = total >= difficulty;
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: healer }), rolls: [roll],
        content: `<h2>${esc(healer.name)}: ${kind === 'stabilize' ? 'Stabilize' : 'Treat'} ${esc(target.name)}</h2>
            <p>First Aid: ${roll.total} + Intelligence ${intelligence} + skill ${level} + traits ${traitSummary(traits, quality, drawback, esc)} + other/effects/action/health ${effects - level - traits.total - manualTraitValue(quality, traits) - manualTraitValue(drawback, traits)} = <strong>${total}</strong> vs ${difficulty}.
            ${success ? 'Success: awaiting application.' : 'Failure: no supply spent or HP restored.'}</p>`,
        flags: { [SYSTEM]: { medicalAid: { healerUuid: healer.uuid, targetUuid: target.uuid, kind, supplyId: supply.id,
            success, difficulty, targetHp: state.hp, critical: Boolean(state.critical), applied: false } } } });
}

export async function handleMedicalAid(message) {
    if (!game.user.isGM || game.users.activeGM?.id !== game.user.id || resolving.has(message.id)) return;
    const data = message.getFlag(SYSTEM, 'medicalAid');
    if (!data || data.applied) return;
    resolving.add(message.id);
    try {
        const healer = await fromUuid(data.healerUuid);
        const target = await fromUuid(data.targetUuid);
        const author = game.users.get(message.user?.id ?? message.user);
        if (!healer || !target || !author || !author.isGM && !healer.testUserPermission(author, 'OWNER')) return;
        await message.update({ [`flags.${SYSTEM}.medicalAid.applied`]: true });
        if (!data.success) return;
        const state = healthState(target);
        const supply = healer.items.get(data.supplyId);
        if (!supply || !supplies(healer).some(item => item.id === supply.id) || state.hp !== data.targetHp || state.dead ||
            data.kind === 'stabilize' && (!state.dying || state.stable || state.critical?.expired || Boolean(state.critical) !== data.critical) ||
            data.kind === 'treat' && (state.critical || state.dying && !state.stable))
            throw new Error('Target or medical supply changed before First Aid could be applied.');
        if (data.kind === 'stabilize') {
            await target.setFlag(SYSTEM, 'stabilized', true);
            if (state.critical) await target.unsetFlag(SYSTEM, 'criticalCondition');
        } else {
            const restored = Math.min(Number(supply.system.healing), Math.max(0, Number(target.system.secondaryAttributes.hp.max) - state.hp));
            if (restored <= 0) throw new Error('Target has no HP to restore.');
            await target.update({ 'system.secondaryAttributes.hp.value': state.hp + restored }, { enforceTypes: false });
            if (state.hp + restored > -10 && state.stable) await target.unsetFlag(SYSTEM, 'stabilized');
            if (state.hp + restored > 0 && target.getFlag(SYSTEM, 'regainedConsciousness')) await target.unsetFlag(SYSTEM, 'regainedConsciousness');
        }
        await supply.update({ 'system.qty': Number(supply.system.qty) - 1 });
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: target }), content:
            `<p>${esc(target.name)}: ${data.kind === 'stabilize' ? 'stabilized at the current HP; still unable to act at −10 HP or less.' : `treated; HP ${state.hp} → ${target.system.secondaryAttributes.hp.value}.`} One ${esc(supply.name)} used.</p>` });
    } catch (error) { console.error('AFMBE First Aid failed', error); ui.notifications.error(`First Aid could not be applied: ${error.message}`); }
    finally { resolving.delete(message.id); }
}
