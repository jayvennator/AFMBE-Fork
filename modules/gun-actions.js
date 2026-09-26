import { actionState, spendAction } from './action-economy.js';
const SYSTEM_ID = 'afmbe-left-behind';
const locks = new Set();

export function rateOfFire(weapon) {
    const value = Number(weapon.system.rateOfFire ?? 1);
    return Number.isSafeInteger(value) && value >= 1 ? Math.min(value, 20) : 1;
}
export function recoilPerShot(weapon) {
    const value = Number(weapon.system.recoil ?? 0);
    return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 20) : 0;
}
function sequence(actor) {
    const state = actionState(actor);
    if (!state) return null;
    const stored = actor.getFlag(SYSTEM_ID, 'gunSequence') ?? {};
    const key = `${state.combatId}:${game.combat.round}:${state.turn ?? 'outside-turn'}`;
    return stored.key === key ? stored : { key, weaponId: '', shotsInAction: 0, actionPenalty: 0, offensiveUsed: -1, shotsByWeapon: {} };
}
export function gunPreview(actor, weapon) {
    const state = sequence(actor);
    const shots = state?.shotsByWeapon?.[weapon.id] ?? 0;
    const action = actionState(actor);
    const continues = state && state.weaponId === weapon.id && state.shotsInAction < rateOfFire(weapon) && state.offensiveUsed === action.counts.offensive;
    return { shot: shots + 1, recoilPenalty: -(shots + 1) * recoilPerShot(weapon),
        shotsInAction: continues ? state.shotsInAction : 0, rateOfFire: rateOfFire(weapon),
        actionPenalty: continues ? state.actionPenalty : -2 * (action?.counts.offensive ?? 0) };
}
/** Reserves a single semi-auto trigger pull; recoil stays with this gun across Offensive actions this turn. */
export async function prepareGunShot(actor, weapon) {
    if (!actor.isOwner) throw new Error('Only the actor owner can fire this weapon.');
    if (locks.has(actor.uuid)) throw new Error('Another shot is being recorded. Try again.');
    locks.add(actor.uuid);
    try {
        const state = sequence(actor);
        if (!state) {
            const action = await spendAction(actor, 'offensive');
            return { shot: 1, shotsInAction: 1, rateOfFire: rateOfFire(weapon), recoilPenalty: 0, actionPenalty: action.penalty };
        }
        const used = actionState(actor).counts.offensive;
        const continues = state.weaponId === weapon.id && state.shotsInAction < rateOfFire(weapon) && state.offensiveUsed === used;
        const actionPenalty = continues ? state.actionPenalty : (await spendAction(actor, 'offensive')).penalty;
        const shotsInAction = continues ? state.shotsInAction + 1 : 1;
        const shot = (Number(state.shotsByWeapon?.[weapon.id]) || 0) + 1;
        await actor.setFlag(SYSTEM_ID, 'gunSequence', { ...state, weaponId: weapon.id, shotsInAction, actionPenalty,
            offensiveUsed: continues ? used : used + 1, shotsByWeapon: { ...state.shotsByWeapon, [weapon.id]: shot } });
        return { shot, shotsInAction, rateOfFire: rateOfFire(weapon), recoilPenalty: -shot * recoilPerShot(weapon), actionPenalty };
    } finally { locks.delete(actor.uuid); }
}
