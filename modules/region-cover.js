const SYSTEM = 'afmbe-left-behind';
import { spendAction } from './action-economy.js';

export function registerRegionCoverControls() {
    Hooks.on('preUpdateToken', (token, changes) => {
        if (['x', 'y', 'elevation'].some(key => Object.hasOwn(changes, key)) && token.getFlag(SYSTEM, 'coverStance'))
            foundry.utils.setProperty(changes, `flags.${SYSTEM}.coverStance`, null);
    });
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
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function closestPoint(point, a, b) {
    const segment = subtract(b, a);
    const lengthSquared = segment.x * segment.x + segment.y * segment.y;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * segment.x + (point.y - a.y) * segment.y) / lengthSquared)) : 0;
    return { x: a.x + t * segment.x, y: a.y + t * segment.y };
}

function nearestBoundary(point, region) {
    let nearest = null, minimum = Infinity;
    for (const polygon of region.polygons ?? []) {
        const points = polygonPoints(polygon);
        for (let i = 0; i < points.length; i++) {
            const candidate = closestPoint(point, points[i], points[(i + 1) % points.length]);
            const separation = distance(candidate, point);
            if (separation < minimum) { minimum = separation; nearest = candidate; }
        }
    }
    return { point: nearest, distance: minimum };
}

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

function nearbyCover(start, end, region, gridSize, target) {
    if (region.testPoint(start)) return false;
    const boundary = nearestBoundary(end, region);
    const radius = Math.max(0, Number(target.document?.width) || 1, Number(target.document?.height) || 1) * gridSize / 2;
    if (!boundary.point || boundary.distance > radius + gridSize / 2) return false;
    const direction = subtract(end, start), toTarget = subtract(end, boundary.point);
    const length = Math.hypot(direction.x, direction.y);
    if (length < 1 || (toTarget.x * direction.x + toTarget.y * direction.y) / length <= 1) return false;
    // An adjacent barricade must also overlap the target's profile from this angle.
    if (Math.abs(cross(direction, subtract(boundary.point, start))) / length > radius + gridSize * 0.1) return false;
    const elevation = Number(target.document?.elevation) || 0;
    return region.testPoint({ ...boundary.point, elevation }) || region.testPoint({ x: boundary.point.x + (start.x - end.x) / length, y: boundary.point.y + (start.y - end.y) / length, elevation });
}

export function coverStance(token) {
    const saved = token?.document?.getFlag?.(SYSTEM, 'coverStance');
    const doc = token?.document;
    return saved?.regionId && saved.x === doc.x && saved.y === doc.y && saved.elevation === doc.elevation ? saved : null;
}

export function coverTokenForActor(actor) {
    if (!canvas?.ready) return null;
    const candidates = canvas.tokens.placeables.filter(token => token.actor?.uuid === actor.uuid);
    const selected = candidates.filter(token => token.controlled);
    return selected.length === 1 ? selected[0] : candidates.length === 1 ? candidates[0] : null;
}

export function nearbyCoverRegion(token, gridSize = Number(canvas?.grid?.size) || 0) {
    if (!token?.center || gridSize <= 0) return null;
    const elevation = Number(token.document?.elevation) || 0;
    let best = null, separation = Infinity;
    for (const region of canvas.scene?.regions ?? []) {
        if (!['partial', 'full'].includes(region.getFlag?.(SYSTEM, 'cover'))) continue;
        const closest = nearestBoundary(token.center, region);
        const radius = Math.max(Number(token.document?.width) || 1, Number(token.document?.height) || 1) * gridSize / 2;
        if (closest.point && closest.distance <= radius + gridSize / 2 && closest.distance < separation &&
            region.testPoint({ ...closest.point, elevation })) { best = region; separation = closest.distance; }
    }
    return best;
}

export async function toggleCoverStance(actor) {
    if (!actor?.isOwner) throw new Error('You cannot take cover for this actor.');
    const token = coverTokenForActor(actor);
    if (!token) throw new Error('Select exactly one token for this character on the scene.');
    if (coverStance(token)) {
        await token.document.unsetFlag(SYSTEM, 'coverStance');
        ui.notifications.info(`${actor.name} leaves cover.`);
        return;
    }
    const region = nearbyCoverRegion(token);
    if (!region) throw new Error('Move next to a marked cover Region first.');
    // Taking cover uses a Movement action. Leaving cover is free.
    const action = await spendAction(actor, 'movement');
    await token.document.setFlag(SYSTEM, 'coverStance', { regionId: region.id, x: token.document.x, y: token.document.y, elevation: token.document.elevation });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${foundry.utils.escapeHTML(actor.name)} takes cover behind ${foundry.utils.escapeHTML(region.name)}${action.tracked ? ` (Movement action ${action.used}).` : '.'}</p>` });
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
        const hits = points.filter(point => crossesRegion({ ...start, elevation: startHeight }, { ...point, elevation: endHeight }, region) ||
            nearbyCover({ ...start, elevation: startHeight }, { ...point, elevation: endHeight }, region, gridSize, target)).length;
        if (level === 'full' && hits === points.length) return { level: 'full', region };
        if (hits && coverStance(target)?.regionId === region.id && hits === points.length) return { level: 'full', region };
        if (hits && !partial) partial = region;
    }
    return partial ? { level: 'partial', region: partial } : { level: 'none' };
}

export function coverForAttack(actor, targetToken) {
    if (!canvas?.ready || targetToken?.document?.parent?.id !== canvas.scene?.id) return { level: 'none', note: 'No active scene target.' };
    const source = coverTokenForActor(actor);
    if (!source) return { level: 'none', note: 'Select one shooter token to detect cover.' };
    return detectRegionCover(source, targetToken, canvas.scene.regions, Number(canvas.grid?.size) || 0);
}
