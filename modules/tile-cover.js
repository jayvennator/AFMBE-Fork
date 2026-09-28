const SYSTEM = 'afmbe-left-behind';

// A GM marks individual Tiles as cover. Unmarked scenery has no effect.
export function registerTileCoverControls() {
    const addControl = (app, html) => {
        if (!game.user.isGM) return;
        if (!(app instanceof foundry.applications.sheets.TileConfig)) return;
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root || root.querySelector('.afmbe-tile-cover')) return;
        const tile = app.document ?? app.object?.document;
        if (!tile || tile.documentName !== 'Tile') return;
        const section = document.createElement('div');
        section.className = 'afmbe-tile-cover form-group';
        section.innerHTML = `<label>AFMBE cover</label><select aria-label="AFMBE cover level">
            <option value="none">No cover</option><option value="partial">Partial cover</option><option value="full">Full cover</option>
        </select><button type="button">Save cover</button><p class="hint">Only shots crossing this tile can receive cover.</p>`;
        const select = section.querySelector('select');
        select.value = tile.getFlag(SYSTEM, 'cover') ?? 'none';
        section.querySelector('button').addEventListener('click', async () => {
            try {
                await tile.setFlag(SYSTEM, 'cover', select.value);
                ui.notifications.info(`Tile cover set to ${select.selectedOptions[0].textContent}.`);
            } catch (error) { ui.notifications.warn(error.message); }
        });
        (root.querySelector('form') ?? root).append(section);
    };
    Hooks.on('renderApplicationV2', addControl);
}

const cross = (a, b) => a.x * b.y - a.y * b.x;
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });

function tileCorners(tile) {
    const { x, y, width, height } = tile;
    const rotation = Number(tile.rotation ?? 0);
    if (![x, y, width, height, rotation].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    const c = { x: x + width / 2, y: y + height / 2 };
    const angle = rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    return [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]]
        .map(([dx, dy]) => ({ x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }));
}

function inside(point, corners) {
    let positive = false, negative = false;
    for (let i = 0; i < 4; i++) {
        const value = cross(subtract(corners[(i + 1) % 4], corners[i]), subtract(point, corners[i]));
        positive ||= value > 0.001;
        negative ||= value < -0.001;
    }
    return !(positive && negative);
}

export function crossesTile(start, end, tile) {
    const corners = tileCorners(tile);
    if (!corners || inside(start, corners)) return false; // Cover containing the shooter cannot shield the target.
    const ray = subtract(end, start);
    if (Math.hypot(ray.x, ray.y) < 1) return false;
    for (let i = 0; i < 4; i++) {
        const a = corners[i], edge = subtract(corners[(i + 1) % 4], a);
        const denominator = cross(ray, edge);
        if (Math.abs(denominator) < 1e-8) continue;
        const offset = subtract(a, start);
        const t = cross(offset, edge) / denominator;
        const u = cross(offset, ray) / denominator;
        if (t > 0.001 && t < 0.999 && u >= 0 && u <= 1) return true;
    }
    return false;
}

export function detectTileCover(shooter, target, tiles) {
    if (!shooter?.center || !target?.center) return { level: 'none' };
    const start = shooter.center, end = target.center;
    const dx = end.x - start.x, dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) return { level: 'none' };
    const halfWidth = Math.max(0, Number(target.document?.width) || 1) * Number(canvas.grid?.size || 0) * 0.35;
    const halfHeight = Math.max(0, Number(target.document?.height) || 1) * Number(canvas.grid?.size || 0) * 0.35;
    const spread = Math.min(Math.hypot(halfWidth, halfHeight), length * 0.25);
    const normal = { x: -dy / length * spread, y: dx / length * spread };
    const points = [end, { x: end.x + normal.x, y: end.y + normal.y }, { x: end.x - normal.x, y: end.y - normal.y }];
    let partial = null;
    for (const tile of tiles ?? []) {
        const document = tile.document ?? tile;
        const level = document.getFlag?.(SYSTEM, 'cover');
        if (level !== 'partial' && level !== 'full') continue;
        const hits = points.filter(point => crossesTile(start, point, document)).length;
        if (level === 'full' && hits === points.length) return { level: 'full', tile: document };
        if (hits && !partial) partial = document;
    }
    return partial ? { level: 'partial', tile: partial } : { level: 'none' };
}

export function coverForAttack(actor, targetToken) {
    if (!canvas?.ready || targetToken?.document?.parent?.id !== canvas.scene?.id) return { level: 'none', note: 'No active scene target.' };
    const shooters = canvas.tokens.placeables.filter(token => token.actor?.uuid === actor.uuid);
    const controlled = shooters.filter(token => token.controlled);
    const source = controlled.length === 1 ? controlled[0] : shooters.length === 1 ? shooters[0] : null;
    if (!source) return { level: 'none', note: 'Select one shooter token to detect cover.' };
    return detectTileCover(source, targetToken, canvas.tiles.placeables);
}
