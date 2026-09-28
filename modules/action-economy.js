const SYSTEM_ID = 'afmbe-left-behind';
export const ACTION_TYPES = Object.freeze(['movement', 'offensive', 'defensive', 'help']);
const labels = { movement: 'Movement', offensive: 'Offensive', defensive: 'Defensive', help: 'Help' };
const locks = new Set();

function combatantFor(actor) {
    const combat = game.combat;
    if (!combat || Number(combat.round) < 1) return null;
    const combatant = combat.combatants.find(entry => entry.actor?.uuid === actor.uuid);
    return combatant ? { combat, combatant } : null;
}

export function actionState(actor) {
    const context = combatantFor(actor);
    if (!context) return null;
    const { combat, combatant } = context;
    const stored = actor.getFlag(SYSTEM_ID, 'actionEconomy') ?? {};
    const active = combat.combatant?.id === combatant.id;
    const turn = active ? `${combat.round}:${combat.turn}` : null;
    const newCombat = stored.combatId !== combat.id;
    // A combatant's first action on its own new turn resets all four counters.
    // Defenses made before that turn retain the previous turn's tally.
    const reset = newCombat || (active && stored.turn !== turn);
    const counts = Object.fromEntries(ACTION_TYPES.map(type => [type, reset ? 0 : Math.max(0, Number(stored.counts?.[type]) || 0)]));
    return { combatId: combat.id, turn: active ? turn : (newCombat ? null : stored.turn ?? null), counts };
}

export function actionPanel(actor) {
    const state = actionState(actor);
    if (!state) return null;
    return { rows: ACTION_TYPES.map(type => ({ type, label: labels[type], used: state.counts[type], penalty: -2 * state.counts[type], movement: type === 'movement', defensive: type === 'defensive', help: type === 'help'  })) };
}

export async function spendAction(actor, type) {
    if (!ACTION_TYPES.includes(type) || !actor.isOwner) throw new Error('Action is unavailable for this actor.');
    const key = actor.uuid;
    if (locks.has(key)) throw new Error('An action is already being recorded. Please retry.');
    locks.add(key);
    try {
        const state = actionState(actor);
        if (!state) return { tracked: false, penalty: 0, used: 0 };
        const used = state.counts[type];
        state.counts[type] = used + 1;
        await actor.setFlag(SYSTEM_ID, 'actionEconomy', state);
        return { tracked: true, penalty: -2 * used, used: used + 1 };
    } finally { locks.delete(key); }
}

export async function correctAction(actor, type) {
    if (!game.user.isGM || !ACTION_TYPES.includes(type)) return;
    const state = actionState(actor);
    if (!state || !state.counts[type]) return;
    state.counts[type]--;
    await actor.setFlag(SYSTEM_ID, 'actionEconomy', state);
}
