const SYSTEM_ID = 'afmbe-jesuisfrog';
const applying = new Set();

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
        let protection = 0;
        const armorDetails = [];

        for (const item of actor.items) {
            if (item.type !== 'item' || !item.system.equipped) continue;
            // Existing armor items created before coverage was added protect the body.
            const coverage = item.system.armor_coverage ?? { body: true };
            if (!coverage[location]) continue;
            const formula = String(item.system.armor_value ?? '0').trim() || '0';
            const roll = await new Roll(formula).evaluate();
            const value = Math.max(0, Number(roll.total) || 0);
            protection += value;
            armorDetails.push(`${foundry.utils.escapeHTML(item.name)} (${foundry.utils.escapeHTML(formula)}): ${value}`);
        }

        const absorbed = Math.min(damage, protection);
        const hpDamage = damage - absorbed;
        await actor.update({ 'system.secondaryAttributes.hp.value': hp - hpDamage }, { enforceTypes: false });
        const summary = `<p><strong>${foundry.utils.escapeHTML(actor.name)} — ${location}</strong><br>` +
            `Damage ${damage} − armor ${absorbed} = <strong>${hpDamage} HP</strong><br>` +
            `HP ${hp} → ${hp - hpDamage}` +
            (armorDetails.length ? `<br>Armor: ${armorDetails.join(', ')}` : '<br>No covering armor') + '</p>';
        await message.update({
            content: `${message.content}${summary}`,
            [`flags.${SYSTEM_ID}.armorDamage.applied`]: true
        });
    } catch (error) {
        console.error('AFMBE armor damage failed', error);
        ui.notifications.error(`AFMBE armor damage: ${error.message}`);
    } finally {
        applying.delete(message.id);
    }
}
