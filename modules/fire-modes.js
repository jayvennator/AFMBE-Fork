/** One trigger pull is one attack and one recoil step, regardless of rounds spent. */
export function fireMode(mode, weapon) {
    if (mode === 'burst') {
        const size = Number(weapon.system.burstSize ?? 3);
        return { mode, rounds: Number.isSafeInteger(size) && size >= 2 && size <= 10 ? size : 3, penalty: -3 };
    }
    if (mode === 'automatic') return { mode, rounds: 10, penalty: -4 };
    return { mode: 'semi', rounds: 1, penalty: 0 };
}
export function volleyHits(mode, total, rounds) {
    if (total < 9) return 0;
    const tiers = Math.floor((total - 9) / 2) + 1;
    return Math.min(rounds, mode === 'automatic' ? tiers + 1 : tiers);
}
