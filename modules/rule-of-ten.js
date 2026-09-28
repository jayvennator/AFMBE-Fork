// Resolve the same Rule of One / Rule of Ten rerolls used by attribute tests
// before an attack's hit, degree, and volley results are calculated.
export async function rollAttackD10(rollDie = () => new Roll('1d10').evaluate()) {
    const rolls = [await rollDie()];
    const first = Number(rolls[0].total);
    let result = first;
    if (first === 10) {
        for (let i = 0; i < 100; i++) {
            const next = await rollDie();
            rolls.push(next);
            const face = Number(next.total);
            result += Math.max(0, face - 5);
            if (face !== 10) break;
        }
    } else if (first === 1) {
        const next = await rollDie();
        rolls.push(next);
        const face = Number(next.total);
        if (face <= 5) result = face === 1 ? -5 : face - 5;
        if (face === 1) {
            for (let i = 0; i < 100; i++) {
                const extra = await rollDie();
                rolls.push(extra);
                if (Number(extra.total) !== 1) break;
                result -= 5;
            }
        }
    }
    return { total: result, rolls, faces: rolls.map(roll => Number(roll.total)) };
}
