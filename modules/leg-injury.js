import { spendAction } from './action-economy.js';
import { attributeBonus, skillBonus } from './consumables.js';
import { traitRollEffects } from './trait-effects.js';
import { healthState } from './health-states.js';

const SYSTEM = 'afmbe-left-behind';
export const LEG_INJURY = 'afmbe-leg-injury';
export const ARM_INJURY = 'afmbe-arm-injury';
export const hasLegInjury = actor => Boolean(actor?.getFlag(SYSTEM, 'legInjury'));
export const hasArmInjury = actor => Boolean(actor?.getFlag(SYSTEM, 'armInjury'));
export const legMovementAllowance = actor => {
    const speed = Math.max(0, Number(actor?.system.secondaryAttributes?.speed?.halfValue) || 0);
    return Math.floor(hasLegInjury(actor) ? speed / 2 : speed);
};

export async function clearLegInjury(actor) {
    return clearInjury(actor, 'leg');
}
export async function clearArmInjury(actor) {
    return clearInjury(actor, 'arm');
}
async function clearInjury(actor, limb) {
    if (!game.user.isGM || !actor) throw new Error('Only the ZM can clear an injury.');
    await actor.unsetFlag(SYSTEM, `${limb}Injury`);
    await actor.toggleStatusEffect(limb === 'arm' ? ARM_INJURY : LEG_INJURY, { active: false });
}

export async function resolveLegInjury(actor, results) {
    return resolveLimbInjury(actor, results, 'leg');
}
export async function resolveArmInjury(actor, results) {
    return resolveLimbInjury(actor, results, 'arm');
}
async function resolveLimbInjury(actor, results, limb) {
    const maxHp = Number(actor.system.secondaryAttributes?.hp?.max);
    const strongest = Math.max(0, ...results.map(hit => Number(hit.damage) || 0));
    if (!(maxHp > 0) || strongest < Math.ceil(maxHp * 0.1)) return;
    if (actor.getFlag(SYSTEM, `${limb}Injury`)) return;
    const severe = strongest >= Math.ceil(maxHp * 0.25);
    const constitution = Number(actor.system.primaryAttributes?.constitution?.value) || 0;
    const traits = traitRollEffects(actor, { kind: 'attribute', attribute: 'constitution' });
    const effects = attributeBonus(actor, 'constitution') + traits.total;
    const roll = await new Roll('1d10').evaluate();
    const total = Number(roll.total) + constitution * 2 + effects - (severe ? 2 : 0) + healthState(actor).penalty;
    const injured = total < 9;
    if (injured) {
        await actor.setFlag(SYSTEM, `${limb}Injury`, { damage: strongest, maxHp });
        await actor.toggleStatusEffect(limb === 'arm' ? ARM_INJURY : LEG_INJURY, { active: true });
    }
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll],
        content: `<h2>${foundry.utils.escapeHTML(actor.name)}: ${limb} injury check</h2><p>Largest hit: ${strongest} HP (threshold ${Math.ceil(maxHp * 0.1)}; severe ${Math.ceil(maxHp * 0.25)}). Constitution Test: ${roll.total} + ${constitution * 2} + effects ${effects}${severe ? ' − 2 severe hit' : ''} = <strong>${total}</strong> vs 9. ${injured ? limb === 'leg' ? 'Leg injured: combat movement and Dash allowances are halved until treated.' : 'Arm injured: attacks using the arm take −2 until treated.' : 'No injury.'}</p>` });
}

export async function treatLegInjury(healer) {
    return treatInjury(healer, 'leg');
}
export async function treatArmInjury(healer) {
    return treatInjury(healer, 'arm');
}
async function treatInjury(healer, limb) {
    if (!healer?.isOwner) throw new Error('You cannot treat an injury with this actor.');
    const targets = [...game.user.targets];
    if (targets.length !== 1 || !targets[0].actor?.getFlag(SYSTEM, `${limb}Injury`)) throw new Error(`Target exactly one token with an ${limb} injury.`);
    const target = targets[0].actor;
    const skill = healer.items.find(item => item.type === 'skill' && /first aid/i.test(item.name));
    if (!skill) throw new Error('A First Aid skill is required to treat a leg injury.');
    const action = await spendAction(healer, 'help');
    const roll = await new Roll('1d10').evaluate();
    const intelligence = Number(healer.system.primaryAttributes?.intelligence?.value) || 0;
    const skillLevel = Number(skill.system.level) || 0;
    const traits = traitRollEffects(healer, { kind: 'help', attribute: 'intelligence', skillName: skill.name });
    const total = Number(roll.total) + intelligence + attributeBonus(healer, 'intelligence') + skillLevel + skillBonus(healer, skill) + traits.total + action.penalty + healthState(healer).penalty;
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: healer }), rolls: [roll],
        content: `<p>${foundry.utils.escapeHTML(healer.name)} treats ${foundry.utils.escapeHTML(target.name)}’s ${limb} (Help action): ${roll.total} + Intelligence ${intelligence} + First Aid ${skillLevel} + effects ${attributeBonus(healer, 'intelligence') + skillBonus(healer, skill) + traits.total} + action ${action.penalty} = <strong>${total}</strong> vs 9. ${total >= 9 ? 'Success: injury removed.' : 'Failure: injury remains.'}</p>`,
        flags: { [SYSTEM]: { legTreatment: { healerUuid: healer.uuid, targetUuid: target.uuid, limb, success: total >= 9 } } } });
}

export async function handleLegTreatment(message) {
    if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
    const data = message.getFlag(SYSTEM, 'legTreatment');
    if (!data?.success) return;
    const healer = await fromUuid(data.healerUuid);
    const target = await fromUuid(data.targetUuid);
    const author = game.users.get(message.user?.id ?? message.user);
    if (!healer || !target || !author || !author.isGM && !healer.testUserPermission(author, 'OWNER')) return;
    if (data.limb === 'arm' ? hasArmInjury(target) : hasLegInjury(target))
        await (data.limb === 'arm' ? clearArmInjury(target) : clearLegInjury(target));
}
