/** Straight-line centre-to-centre distance; scene units are converted to meters. */
export function rangePenalty(distanceMeters, normalRangeMeters, penaltyPerBand = 2) {
    if (!Number.isFinite(distanceMeters) || distanceMeters < 0 || !Number.isFinite(normalRangeMeters) || normalRangeMeters <= 0 ||
        !Number.isInteger(penaltyPerBand) || penaltyPerBand < 0) throw new Error('Invalid weapon range or range penalty.');
    const extraBands = Math.max(0, Math.ceil(distanceMeters / normalRangeMeters - 1e-9) - 1);
    return -extraBands * penaltyPerBand;
}

export function measureWeaponRange(actor, weapon, canvasView = canvas, targets = game.user.targets) {
    const rawRange = weapon.system.range;
    if (rawRange === '' || rawRange === null || rawRange === undefined || Number(rawRange) === 0)
        return { distance: null, penalty: 0, note: 'No weapon range configured; no automatic range penalty.' };
    const normalRange = Number(rawRange);
    if (!Number.isFinite(normalRange) || normalRange < 0) return { error: 'Set a positive numeric range (meters) on this weapon.' };
    const step = Number(weapon.system.rangePenaltyStep ?? 2);
    if (!Number.isInteger(step) || step < 0 || step > 20) return { error: 'Range penalty per band must be a whole number from 0 to 20.' };
    if (!canvasView?.ready || !canvasView.scene) return { error: 'Open the scene containing the combat tokens to measure distance.' };
    const candidates = canvasView.tokens.placeables.filter(token => token.actor?.uuid === actor.uuid);
    const controlled = candidates.filter(token => token.controlled);
    const shooters = controlled.length ? controlled : candidates;
    if (shooters.length !== 1) return { error: 'Select exactly one shooter token for this character.' };
    if (targets.size !== 1) return { error: 'Target exactly one token to measure weapon range.' };
    const target = [...targets][0];
    const grid = canvasView.scene.grid;
    const size = Number(canvasView.grid.size);
    const gridDistance = Number(grid.distance);
    const unit = String(grid.units ?? '').trim().toLowerCase();
    const metersPerUnit = ['m', 'meter', 'meters', 'metre', 'metres'].includes(unit) ? 1 :
        ['ft', 'feet', 'foot'].includes(unit) ? 0.3048 : null;
    if (!metersPerUnit || !(size > 0) || !(gridDistance > 0)) return { error: 'Set the scene grid distance and units to meters (1 m per grid space recommended).' };
    const distance = Math.hypot(target.center.x - shooters[0].center.x, target.center.y - shooters[0].center.y) / size * gridDistance * metersPerUnit;
    const penalty = rangePenalty(distance, normalRange, step);
    return { distance, normalRange, penalty, targetName: target.name, sceneScale: `${gridDistance} ${grid.units} per grid space` };
}
