const SYSTEM = 'afmbe-left-behind';

export function registerRegionCoverControls() {
    Hooks.on('renderApplicationV2', (app, html) => {
        if (!game.user.isGM || !(app instanceof foundry.applications.sheets.RegionConfig)) return;
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root || root.querySelector('.afmbe-region-cover')) return;
        const region = app.document;
        if (region?.documentName !== 'Region') return;
        const section = document.createElement('div');
        section.className = 'afmbe-region-cover form-group';
        section.innerHTML = `<label>AFMBE cover</label><select aria-label="AFMBE cover level">
            <option value="none">No cover</option><option value="partial">Partial cover</option><option value="full">Full cover</option>
        </select><button type="button">Save cover</button><p class="hint">An incoming shot crossing this Region can grant cover. No cover applies to a shot starting inside it.</p>`;
        const select = section.querySelector('select');
        select.value = region.getFlag(SYSTEM, 'cover') ?? 'none';
        section.querySelector('button').addEventListener('click', async () => {
            try {
                await region.setFlag(SYSTEM, 'cover', select.value);
                ui.notifications.info(`Region cover set to ${select.selectedOptions[0].textContent}.`);
            } catch (error) { ui.notifications.warn(error.message); }
        });
        (root.querySelector('form') ?? root).append(section);
    });
}

const cross = (a, b) => a.x * b.y - a.y * b.x;
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });

function polygonPoints(polygon) {
    const points = polygon.points;
    if (!points?.length) return [];
    if (typeof points[0] === 'number') {
        const vertices = [];
        for (let i = 0; i < points.length - 1; i += 2) vertices.push({ x: points[i], y: points[i + 1] });
        return vertices;
    }
    return points;
}

// Split the ray at Region polygon edges, then use Foundry's own point test for
// the intervals. This respects polygon holes and multi-shape Regions.
export function crossesRegion(start, end, region) {
    if (typeof region?.testPoint !== 'function') return false;
    const heightAt = t => (Number(start.elevation) || 0) + ((Number(end.elevation) || 0) - (Number(start.elevation) || 0)) * t;
    const pointAt = t => ({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t, elevation: heightAt(t) });
    if (region.testPoint(pointAt(0))) return false; // The shooter cannot hide the target behind their own cover.
    const ray = subtract(end, start);
    if (Math.hypot(ray.x, ray.y) < 1) return false;
    const intersections = [0, 1];
    for (const polygon of region.polygons ?? []) {
        const points = polygonPoints(polygon);
        for (let i = 0; i < points.length; i++) {
            const a = points[i], edge = subtract(points[(i + 1) % points.length], a);
            const divisor = cross(ray, edge);
            if (Math.abs(divisor) < 1e-8) continue;
            const difference = subtract(a, start);
            const t = cross(difference, edge) / divisor;
            const u = cross(difference, ray) / divisor;
            if (t > 0.0001 && t < 0.9999 && u >= 0 && u <= 1) intersections.push(t);
        }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length - 1; i++) {
        const from = intersections[i], to = intersections[i + 1];
        if (to - from > 0.0001 && region.testPoint(pointAt((from + to) / 2))) return true;
    }
    return false;
}

export function detectRegionCover(shooter, target, regions, gridSize = 0) {
    if (!shooter?.center || !target?.center) return { level: 'none' };
    const start = shooter.center, end = target.center;
    const dx = end.x - start.x, dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) return { level: 'none' };
    const halfWidth = Math.max(0, Number(target.document?.width) || 1) * gridSize * 0.35;
    const halfHeight = Math.max(0, Number(target.document?.height) || 1) * gridSize * 0.35;
    const spread = Math.min(Math.hypot(halfWidth, halfHeight), length * 0.25);
    const normal = { x: -dy / length * spread, y: dx / length * spread };
    const startHeight = Number(shooter.document?.elevation) || 0;
    const endHeight = Number(target.document?.elevation) || 0;
    const points = [end, { x: end.x + normal.x, y: end.y + normal.y }, { x: end.x - normal.x, y: end.y - normal.y }];
    let partial = null;
    for (const entry of regions ?? []) {
        const region = entry.document ?? entry;
        const level = region.getFlag?.(SYSTEM, 'cover');
        if (level !== 'partial' && level !== 'full') continue;
        const hits = points.filter(point => crossesRegion({ ...start, elevation: startHeight }, { ...point, elevation: endHeight }, region)).length;
        if (level === 'full' && hits === points.length) return { level: 'full', region };
        if (hits && !partial) partial = region;
    }
    return partial ? { level: 'partial', region: partial } : { level: 'none' };
}

export function coverForAttack(actor, targetToken) {
    if (!canvas?.ready || targetToken?.document?.parent?.id !== canvas.scene?.id) return { level: 'none', note: 'No active scene target.' };
    const shooters = canvas.tokens.placeables.filter(token => token.actor?.uuid === actor.uuid);
    const controlled = shooters.filter(token => token.controlled);
    const source = controlled.length === 1 ? controlled[0] : shooters.length === 1 ? shooters[0] : null;
    if (!source) return { level: 'none', note: 'Select one shooter token to detect cover.' };
    return detectRegionCover(source, targetToken, canvas.scene.regions, Number(canvas.grid?.size) || 0);
}
