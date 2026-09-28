import { resolveDamage, damageType } from './damage-types.js';
import { armorIntegrity, armorWear } from './armor-integrity.js';
import { storageLocation } from './inventory-grid.js';
import { resolveLegInjury, resolveArmInjury } from './leg-injury.js';
const SYSTEM_ID = 'afmbe-left-behind';
const applying = new Set();

/** Use the same chat layout for a manual armor roll and an armor roll during damage. */
export async function postArmorRoll(actor, item, roll, formula) {
    const name = item ? foundry.utils.escapeHTML(item.name) : 'No covering armor';
    const title = item
        ? game.i18n.format('AFMBE.Chat.ArmorRollFor', { armor: name })
        : 'Armor Roll';
    const content = `<div><h2>${title}</h2>` +
        `<table class="afmbe-chat-roll-table"><thead><tr>` +
        `<th class="table-center-align">${game.i18n.localize('AFMBE.Chat.Result')}</th>` +
        `<th class="table-center-align">${game.i18n.localize('AFMBE.Chat.Detail')}</th>` +
        `</tr></thead><tbody><tr>` +
        `<td class="table-center-align">[[${roll.result}]]</td>` +
        `<td class="table-center-align">${foundry.utils.escapeHTML(String(formula))}</td>` +
        `</tr></tbody></table>${item ? '' : `<p>${name}</p>`}</div>`;
    return ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor }),
        content,
        rolls: [roll]
    });
}

/** Resolve a damage chat message against one targeted actor's equipped armor. */
export async function applyArmorDamage(message) {
    if (!game.user.isGM) return;
    const data = message.getFlag(SYSTEM_ID, 'armorDamage');
    if (!data || data.applied || applying.has(message.id)) return;
    applying.add(message.id);

    try {
        const actor = await fromUuid(data.targetUuid);
        if (!actor || !actor.isOwner) throw new Error('The target actor is unavailable.');
        const hp = Number(actor.system.secondaryAttributes?.hp?.value);
        if (!Number.isFinite(hp)) throw new Error('The target has no numeric HP value.');
        const damage = Math.max(0, Number(data.damage) || 0);
        const location = ['body', 'head', 'arms', 'legs'].includes(data.location) ? data.location : 'body';
        const damages = Array.isArray(data.damages) && data.damages.length <= 10 && data.damages.length > 0
            ? data.damages.map(value => Math.max(0, Number(value) || 0)) : [damage];
        const type = damageType(data.damageType);
        const results = [];
        const integrity = new Map();
        const broken = new Set();
        for (const [index, raw] of damages.entries()) {
            let protection = 0;
            let coveringItems = 0;
            for (const item of actor.items) {
                if (!['item', 'armor'].includes(item.type) || !item.system.equipped || storageLocation(item)) continue;
                const coverage = item.system.armor_coverage ?? { body: true };
                if (!coverage[location]) continue;
                const state = integrity.get(item.id) ?? armorIntegrity(item);
                if (state.value <= 0) continue;
                const formula = String(item.system.armor_value ?? '0').trim() || '0';
                const roll = await new Roll(formula).evaluate();
                const rolled = Math.max(0, Number(roll.total) || 0);
                protection += rolled;
                coveringItems++;
                await postArmorRoll(actor, item, roll, formula);
                const multiplier = resolveDamage(0, 0, type).armorMultiplier;
                const value = Math.max(0, state.value - armorWear(raw, rolled, multiplier));
                integrity.set(item.id, { value, max: state.max });
                if (value === 0 && state.value > 0) broken.add(item.name);
            }
            if (!coveringItems) await postArmorRoll(actor, null, await new Roll('0').evaluate(), '0');
            const resolved = resolveDamage(raw, protection, type, { headshot: location === 'head', criticalHit: Boolean(data.criticalHit) });
            results.push({ raw, protection: resolved.protection, penetrating: resolved.penetrating,
                multiplier: resolved.damageMultiplier, damage: data.blocked ? Math.floor(resolved.hpDamage / 2) : resolved.hpDamage });
        }
        const total = results.reduce((sum, hit) => sum + hit.damage, 0);
        if (integrity.size) await actor.updateEmbeddedDocuments('Item', [...integrity].map(([id, state]) => ({ _id: id, 'system.armor_integrity.value': state.value })));
        await actor.update({ 'system.secondaryAttributes.hp.value': hp - total }, { enforceTypes: false });
        await message.update({ [`flags.${SYSTEM_ID}.armorDamage.applied`]: true });
        const lines = results.map((hit, index) => `Hit ${index + 1}: ${hit.raw} raw, ${hit.protection} armor after ammo type, ${hit.penetrating} penetrates ×${hit.multiplier}${data.blocked ? ', then blocked' : ''} = ${hit.damage} HP`).join('<br>');
        await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }),
            content: `<h2>Damage Calculation</h2><p><strong>${foundry.utils.escapeHTML(actor.name)} — ${location}</strong><br>Type ${foundry.utils.escapeHTML(type)}${data.blocked ? '; blocked' : ''}<br>${lines}<br>Total ${total} HP; HP ${hp} → ${hp - total}${broken.size ? `<br>Armor depleted: ${[...broken].map(name => foundry.utils.escapeHTML(name)).join(', ')}` : ''}</p>` });
        if (location === 'legs') await resolveLegInjury(actor, results);
        if (location === 'arms') await resolveArmInjury(actor, results);
    } catch (error) {
        console.error('AFMBE armor damage failed', error);
        ui.notifications.error(`AFMBE armor damage: ${error.message}`);
    } finally {
        applying.delete(message.id);
    }
}
