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
        let protection = 0;
        let coveringItems = 0;

        for (const item of actor.items) {
            // Generic items remain valid armor until their owners convert them.
            if (!['item', 'armor'].includes(item.type) || !item.system.equipped) continue;
            // Existing armor items created before coverage was added protect the body.
            const coverage = item.system.armor_coverage ?? { body: true };
            if (!coverage[location]) continue;
            const formula = String(item.system.armor_value ?? '0').trim() || '0';
            const roll = await new Roll(formula).evaluate();
            const value = Math.max(0, Number(roll.total) || 0);
            protection += value;
            coveringItems++;
            await postArmorRoll(actor, item, roll, formula);
        }

        if (!coveringItems) {
            const roll = await new Roll('0').evaluate();
            await postArmorRoll(actor, null, roll, '0');
        }

        const absorbed = Math.min(damage, protection);
        const hpDamage = damage - absorbed;
        await actor.update({ 'system.secondaryAttributes.hp.value': hp - hpDamage }, { enforceTypes: false });
        // Mark the source roll applied before posting the final result so it cannot be reused.
        await message.update({ [`flags.${SYSTEM_ID}.armorDamage.applied`]: true });
        const summary = `<h2>Damage Calculation</h2><p><strong>${foundry.utils.escapeHTML(actor.name)} — ${location}</strong><br>` +
            `Damage ${damage} − armor ${absorbed} = <strong>${hpDamage} HP</strong><br>` +
            `HP ${hp} → ${hp - hpDamage}</p>`;
        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor }),
            content: summary
        });
    } catch (error) {
        console.error('AFMBE armor damage failed', error);
        ui.notifications.error(`AFMBE armor damage: ${error.message}`);
    } finally {
        applying.delete(message.id);
    }
}
