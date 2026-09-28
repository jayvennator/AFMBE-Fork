import { actionState, spendAction } from './action-economy.js';
import { attributeBonus } from './consumables.js';
import { traitRollEffects } from './trait-effects.js';

const SYSTEM = 'afmbe-left-behind';
const pending = new Map();
const rollingDash = new Set();
const meters = n => Math.max(0, Number(n) || 0);
const round = n => Math.round(n * 100) / 100;
const dashSuccesses = dash => Math.max(0, Number(dash?.successes) || (dash?.success ? 1 : 0));

function context(token) {
    const combat = game.combat;
    const actor = token?.actor;
    if (!actor || actor.type !== 'character' || !combat || Number(combat.round) < 1) return null;
    const sceneId = combat.scene?.id ?? combat.sceneId ?? combat.scene;
    if (sceneId && sceneId !== token.parent?.id) return null;
    const combatant = combat.combatants.find(entry => entry.tokenId === token.id);
    if (!combatant) return null;
    return { actor, combat, active: combat.combatant?.id === combatant.id,
        key: `${combat.id}:${combat.round}:${combatant.id}` };
}

export function movementPanel(actor) {
    const token = canvas?.tokens?.controlled?.find(entry => entry.actor?.uuid === actor.uuid)?.document
        ?? canvas?.tokens?.placeables?.find(entry => entry.actor?.uuid === actor.uuid)?.document;
    const ctx = context(token);
    if (!ctx) return null;
    const speed = meters(actor.system.secondaryAttributes?.speed?.halfValue);
    const allowance = Math.floor(speed);
    const stored = token.getFlag(SYSTEM, 'combatMovement') ?? {};
    const traveled = stored.key === ctx.key ? meters(stored.distance) : 0;
    const dash = actor.getFlag(SYSTEM, 'dash') ?? {};
    const successes = dash.key === ctx.key ? dashSuccesses(dash) : 0;
    return { allowance, traveled: round(traveled), remaining: round(Math.max(0, allowance * (1 + successes) - traveled)),
        dashSuccesses: successes, nextDashPenalty: -2 * (dash.key === ctx.key ? Number(dash.attempts) || 0 : 0),
        dashFailed: dash.key === ctx.key && Boolean(dash.failed), active: ctx.active };
}

export async function attemptDash(actor) {
    if (!actor.isOwner) throw new Error('You cannot dash for this character.');
    const token = canvas?.tokens?.controlled?.find(entry => entry.actor?.uuid === actor.uuid)?.document;
    const ctx = context(token);
    if (!ctx?.active) throw new Error('Select your token on its combat turn to dash.');
    if (rollingDash.has(actor.uuid)) throw new Error('Dash roll already in progress.');
    const previous = actor.getFlag(SYSTEM, 'dash') ?? {};
    const dash = previous.key === ctx.key ? previous : { key: ctx.key, attempts: 0, successes: 0, failed: false };
    if (dash.failed) throw new Error('Dash attempts ended after the failed roll.');
    const used = actionState(actor)?.counts.movement ?? 0;
    if (!used) throw new Error('Use your free Movement action before attempting to dash.');
    rollingDash.add(actor.uuid);
    try {
        const roll = await new Roll('1d10').evaluate();
        const constitution = Number(actor.system.primaryAttributes?.constitution?.value) || 0;
        const traits = traitRollEffects(actor, { kind: 'attribute', attribute: 'constitution' });
        const penalty = -2 * (Number(dash.attempts) || 0);
        const effects = attributeBonus(actor, 'constitution') + traits.total;
        const total = Number(roll.total) + constitution * 2 + effects + penalty;
        const success = total >= 9;
        await spendAction(actor, 'movement');
        await actor.setFlag(SYSTEM, 'dash', { key: ctx.key, attempts: (Number(dash.attempts) || 0) + 1,
            successes: dashSuccesses(dash) + (success ? 1 : 0), failed: !success });
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll],
            content: `<p>${foundry.utils.escapeHTML(actor.name)} attempts to dash: ${roll.total} + Constitution ${constitution * 2} + effects ${effects} ${penalty < 0 ? `− ${-penalty}` : '+ 0'} = <strong>${total}</strong> vs 9. ${success ? 'Success: another movement allowance unlocked; Endurance is spent as you travel. You may try again at an additional −2.' : 'Failure: no extra allowance; no further Dash attempts this turn.'}</p>` });
    } finally { rollingDash.delete(actor.uuid); }
}

export function registerCombatMovement() {
    function checkMove(token, waypoints) {
        const ctx = context(token);
        if (!ctx || game.user.isGM && globalThis.KeyboardManager?.MODIFIER_KEYS?.ALT && game.keyboard?.isModifierActive?.(KeyboardManager.MODIFIER_KEYS.ALT)) return;
        if (!ctx.active) { ui.notifications.warn('Move this token on its combat turn.'); return false; }
        if (!Array.isArray(waypoints) || !waypoints.length) return;
        const measured = token.measureMovementPath([{ x: token.x, y: token.y }, ...waypoints]);
        const distance = meters(measured.distance);
        if (!distance) return;
        const stored = token.getFlag(SYSTEM, 'combatMovement') ?? {};
        const traveled = stored.key === ctx.key ? meters(stored.distance) : 0;
        const allowance = Math.floor(meters(ctx.actor.system.secondaryAttributes?.speed?.halfValue));
        const dash = ctx.actor.getFlag(SYSTEM, 'dash') ?? {};
        const successes = dash.key === ctx.key ? dashSuccesses(dash) : 0;
        const dashActive = successes > 0;
        const max = allowance * (1 + successes);
        if (traveled + distance > max + 0.01) { ui.notifications.warn(`Movement limit: ${round(Math.max(0, max - traveled))} m remaining. ${dashActive ? '' : 'Dash to move farther.'}`); return false; }
        if ((actionState(ctx.actor)?.counts.movement ?? 0) > 0 && traveled === 0 && !dashActive) {
            ui.notifications.warn('Movement action already spent. Dash to move farther.'); return false;
        }
        const endurance = meters(ctx.actor.system.secondaryAttributes?.endurance_points?.value);
        const cost = Math.max(0, Math.ceil(Math.max(0, traveled + distance - allowance) - 0.001) - Math.ceil(Math.max(0, traveled - allowance) - 0.001));
        if (cost > endurance) { ui.notifications.warn(`Dash requires ${cost} Endurance; only ${endurance} remain.`); return false; }
        pending.set(token.uuid, { key: ctx.key, traveled, distance, cost, actor: ctx.actor });
    }
    // Foundry's movement hook supplies the routed waypoints. A direct token position
    // update can skip it, so validate those updates as well using the destination.
    Hooks.on('preMoveToken', (token, movement) => checkMove(token, movement?.waypoints));
    Hooks.on('preUpdateToken', (token, changes) => {
        if (!Object.hasOwn(changes, 'x') && !Object.hasOwn(changes, 'y')) return;
        if (pending.has(token.uuid)) return;
        return checkMove(token, [{ x: changes.x ?? token.x, y: changes.y ?? token.y }]);
    });
    Hooks.on('updateToken', async (token, changes, _options, userId) => {
        if (userId !== game.user.id || !Object.hasOwn(changes, 'x') && !Object.hasOwn(changes, 'y')) return;
        const move = pending.get(token.uuid);
        if (!move) return;
        pending.delete(token.uuid);
        try {
            if (move.traveled === 0 && !(actionState(move.actor)?.counts.movement ?? 0)) await spendAction(move.actor, 'movement');
            await token.setFlag(SYSTEM, 'combatMovement', { key: move.key, distance: round(move.traveled + move.distance) });
            if (move.cost) await move.actor.update({ 'system.secondaryAttributes.endurance_points.value': meters(move.actor.system.secondaryAttributes.endurance_points.value) - move.cost });
            if (move.actor.sheet?.rendered) move.actor.sheet.render(false);
        } catch (error) { console.error('AFMBE movement tracking failed', error); ui.notifications.error(error.message); }
    });
}
