import { isMeleeAttack } from './linked-combat.js';
import { meleeAttribute, meleePreview, prepareMeleeStrike } from './melee-actions.js';
import { gunPreview, prepareGunShot } from './gun-actions.js';
import { actionPanel, actionState, spendAction, correctAction } from './action-economy.js';
import { measureWeaponRange } from './weapon-range.js';
import { damageType, hitBonus } from './damage-types.js';
import { activeBonuses, attributeBonus, skillBonus, useConsumable, endConsumableEffect } from './consumables.js';
import { postArmorRoll } from './armor-damage.js';
import { loadedMagazine, compatibleMagazines, reloadWeapon, loadMagazine } from './magazines.js';

export class afmbeActorSheet extends foundry.appv1.sheets.ActorSheet {

    /** @override */
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["afmbe-left-behind", "sheet", "actor", `${game.settings.get("afmbe-left-behind", "dark-mode") ? "dark-mode" : ""}`],
            width: 700,
            height: 820,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "core" }],
            dragDrop: [{
                dragSelector: [
                    ".item"
                ],
                dropSelector: null
            }]
        });
    }

    /* -------------------------------------------- */
    /** @override */

    getData() {
        const data = super.getData();
        data.isGM = game.user.isGM;
        data.editable = data.options.editable;
        const actorData = data.system;
        let options = 0;
        let user = this.user;

        this._prepareCharacterItems(data)

        return data
    }

    _prepareCharacterItems(sheetData) {
        const actorData = sheetData.actor

        // Initialize Containers
        const item = [];
        const equippedItem = [];
        const armor = [];
        const consumable = [];
        const weapon = [];
        const magazine = [];
        const ammunition = [];
        const power = [];
        const quality = [];
        const skill = [];
        const drawback = [];

        // Iterate through items and assign to containers
        for (let i of sheetData.items) {
            switch (i.type) {
                case "item":
                    if (i.system.equipped) { equippedItem.push(i) }
                    else { item.push(i) }
                    break

                case "weapon":
                    i.isMeleeWeapon = isMeleeAttack(i)
                    weapon.push(i)
                    break

                case "magazine":
                    magazine.push(i)
                    break

                case "ammunition":
                    ammunition.push(i)
                    break

                case "consumable":
                    consumable.push(i)
                    break

                case "armor":
                    armor.push(i)
                    break

                case "power":
                    power.push(i)
                    break

                case "quality":
                    quality.push(i)
                    break

                case "skill":
                    skill.push(i)
                    break

                case "drawback":
                    drawback.push(i)
                    break
            }
        }

        // Alphabetically sort all items
        const itemCats = [item, equippedItem, weapon, armor, consumable, magazine, ammunition, power, quality, skill, drawback]
        for (let category of itemCats) {
            if (category.length > 1) {
                category.sort((a, b) => {
                    let nameA = a.name.toLowerCase()
                    let nameB = b.name.toLowerCase()
                    if (nameA > nameB) { return 1 }
                    else { return -1 }
                })
            }
        }

        // Assign and return items
        actorData.item = item
        actorData.equippedItem = equippedItem
        actorData.weapon = weapon
        actorData.magazine = magazine
        actorData.ammunition = ammunition
        actorData.armor = armor
        actorData.consumable = consumable
        actorData.actionEconomy = actionPanel(this.actor)
        actorData.activeConsumables = activeBonuses(this.actor).map(effect => ({ ...effect, willCrash: effect.phase !== "crash" && Number(effect.crashPenalty) > 0 && Number(effect.crashDuration) > 0 }))
        actorData.power = power
        actorData.quality = quality
        actorData.skill = skill
        actorData.drawback = drawback
    }

    get template() {
        const path = "systems/afmbe-left-behind/templates";
        if (!game.user.isGM && this.actor.limited) return "systems/afmbe-left-behind/templates/limited-character-sheet.hbs";
        return `${path}/${this.actor.type}-sheet.hbs`;
    }

    /** @override */
    async activateListeners(html) {
        super.activateListeners(html);

        // Run non-event functions
        this._createCharacterPointDivs()
        this._createStatusTags()

        // Buttons and Event Listeners
        html.find('.attribute-roll').click(this._onAttributeRoll.bind(this))
        html.find('.attack-roll').click(this._onAttackRoll.bind(this))
        html.find('.reload-weapon').click(this._onReloadWeapon.bind(this))
        html.find('.load-magazine').click(this._onLoadMagazine.bind(this))
        if (game.user.isGM) html.find('.damage-roll').click(this._onDamageRoll.bind(this))
        html.find('.toggleEquipped').click(this._onToggleEquipped.bind(this))
        html.find('.armor-button-cell button').click(this._onArmorRoll.bind(this))
        html.find('.use-consumable').click(event => useConsumable(this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)))
        html.find('.end-consumable').click(async event => {
            await endConsumableEffect(this.actor, event.currentTarget.dataset.effectId);
        })
        html.find('.roll-combat-task').click(this._onCombatTaskRoll.bind(this));
        html.find('.spend-action').click(async event => {
            const type = event.currentTarget.dataset.actionType;
            try {
                const action = await spendAction(this.actor, type);
                if (action.tracked) await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }),
                    content: `<p>${foundry.utils.escapeHTML(this.actor.name)} spends a ${foundry.utils.escapeHTML(type)} action (${action.used}; penalty ${action.penalty}).</p>` });
            } catch (error) { ui.notifications.warn(error.message); }
        });
        html.find('.correct-action').click(async event => {
            try { await correctAction(this.actor, event.currentTarget.dataset.actionType); }
            catch (error) { ui.notifications.error(error.message); }
        });
        html.find('.reset-resource').click(this._onResetResource.bind(this))

        // Update/Open Inventory Item
        html.find('.create-item').click(this._createItem.bind(this))

        html.find('.item-name').click((ev) => {
            const li = ev.currentTarget.closest(".item")
            const item = this.actor.items.get(li.dataset.itemId)
            if (item.isOwner) {
                item.sheet.render(true)
            }
            item.update({ "data.value": item.system.value })
        })

        // Delete Inventory Item
        html.find('.item-delete').click(ev => {
            const li = ev.currentTarget.closest(".item");
            this.actor.deleteEmbeddedDocuments("Item", [li.dataset.itemId]);
        });
    }

    /**
   * Handle clickable rolls.
   * @param event   The originating click event
   * @private
   */

    _createItem(event) {
        event.preventDefault()
        const element = event.currentTarget

        const typeKey = element.dataset.create
        const typeLabel = game.i18n.localize(`AFMBE.ItemType.${typeKey}`)
        let itemData = {
            name: game.i18n.format("AFMBE.Items.New", { type: typeLabel }),
            type: typeKey,
            cost: 0,
            level: 0
        }
        return Item.create(itemData, { parent: this.actor })
    }

    _createCharacterPointDivs() {
        let actorData = this.actor.system
        let attributesHeader = this.form.querySelector('#attributes-header')
        let qualityDiv = document.createElement('div')
        let drawbackDiv = document.createElement('div')
        let skillDiv = document.createElement('div')
        let powerDiv = document.createElement('div')
        let characterTypePath = actorData.characterTypes[actorData.characterType]

        // Construct and assign div elements to the headers
        if (characterTypePath != undefined && !this.actor.limited) {
            attributesHeader.innerHTML += ` - [${actorData.characterTypeValues[characterTypePath].attributePoints.value} / ${actorData.characterTypeValues[characterTypePath].attributePoints.max}]`

            qualityDiv.innerHTML = `- [${actorData.characterTypeValues[characterTypePath].qualityPoints.value} / ${actorData.characterTypeValues[characterTypePath].qualityPoints.max}]`
            this.form.querySelector('#quality-header').append(qualityDiv)

            drawbackDiv.innerHTML = `- [${actorData.characterTypeValues[characterTypePath].drawbackPoints.value} / ${actorData.characterTypeValues[characterTypePath].drawbackPoints.max}]`
            this.form.querySelector('#drawback-header').append(drawbackDiv)

            skillDiv.innerHTML = `- [${actorData.characterTypeValues[characterTypePath].skillPoints.value} / ${actorData.characterTypeValues[characterTypePath].skillPoints.max}]`
            this.form.querySelector('#skill-header').append(skillDiv)

            powerDiv.innerHTML = `- [${actorData.characterTypeValues[characterTypePath].metaphysicsPoints.value} / ${actorData.characterTypeValues[characterTypePath].metaphysicsPoints.max}]`
            this.form.querySelector('#power-header').append(powerDiv)
        }
    }


    _onAttributeRoll(event) {
        event.preventDefault()
        const element = event.currentTarget
        const attributeKey = element.dataset.attributeKey || element.dataset.attributeName?.toLowerCase()
        if (!attributeKey) { return }
        const attributeLabel = element.dataset.attributeLabel || attributeKey
        const actorData = this.actor.system

        const noneLabel = game.i18n.localize("AFMBE.Common.None")
        const penaltiesLabel = game.i18n.localize("AFMBE.Common.Penalties")
        const userModifierLabel = game.i18n.localize("AFMBE.Chat.UserModifier")
        const modifiersLabel = game.i18n.localize("AFMBE.Chat.Modifiers")
        const ruleOfTenLabel = game.i18n.localize("AFMBE.Chat.RuleOfTenTitle")
        const ruleOfOneLabel = game.i18n.localize("AFMBE.Chat.RuleOfOneTitle")
        const rollAgainLabel = game.i18n.localize("AFMBE.Chat.RollAgain")
        const dialogTitle = game.i18n.localize("AFMBE.Dialog.AttributeRoll.Title")
        const dialogHeader = game.i18n.format("AFMBE.Dialog.AttributeRoll.Header", { attribute: attributeLabel })
        const dialogInstructions = game.i18n.localize("AFMBE.Dialog.AttributeRoll.Help")
        const simpleDescription = game.i18n.localize("AFMBE.Dialog.AttributeRoll.SimpleDescription")
        const difficultDescription = game.i18n.localize("AFMBE.Dialog.AttributeRoll.DifficultDescription")
        const attributeTestLabel = game.i18n.localize("AFMBE.Dialog.AttributeRoll.AttributeTest")
        const rollModifierLabel = game.i18n.localize("AFMBE.Dialog.AttributeRoll.RollModifier")
        const skillsLabel = game.i18n.localize("AFMBE.Dialog.AttributeRoll.Skills")
        const qualitiesLabel = game.i18n.localize("AFMBE.Dialog.AttributeRoll.Qualities")
        const drawbacksLabel = game.i18n.localize("AFMBE.Dialog.AttributeRoll.Drawbacks")
        const cancelLabel = game.i18n.localize("AFMBE.Dialog.Button.Cancel")
        const rollLabel = game.i18n.localize("AFMBE.Dialog.Button.Roll")
        const attributeTestOptions = [
            { value: "simple", label: game.i18n.localize("AFMBE.AttributeTest.Simple") },
            { value: "difficult", label: game.i18n.localize("AFMBE.AttributeTest.Difficult") }
        ]
        const attributeTestNames = Object.fromEntries(attributeTestOptions.map(opt => [opt.value, opt.label]))

        const attributeValueBase = Number(actorData.primaryAttributes[attributeKey]?.value ?? 0) + attributeBonus(this.actor, attributeKey)

        const buildOptions = (items, formatter) => items.map(entry => `
                                                <option value="${entry.id}">${formatter(entry)}</option>`).join("")
        const skillOptions = buildOptions(this.actor.items.filter(item => item.type === 'skill'), skill => `${skill.name} ${skill.system.level}`)
        const qualityOptions = buildOptions(this.actor.items.filter(item => item.type === 'quality'), quality => `${quality.name} ${quality.system.bonus}`)
        const drawbackOptions = buildOptions(this.actor.items.filter(item => item.type === 'drawback'), drawback => `${drawback.name} ${drawback.system.bonus}`)

        const penaltyTags = []
        if (actorData.secondaryAttributes.endurance_points.loss_toggle) {
            penaltyTags.push(`<span class="penaltyColorClass">${game.i18n.format("AFMBE.Penalties.EnduranceLoss", { value: actorData.secondaryAttributes.endurance_points.loss_penalty })}</span>`)
        }
        if (actorData.secondaryAttributes.essence.loss_toggle) {
            penaltyTags.push(`<span class="penaltyColorClass">${game.i18n.format("AFMBE.Penalties.EssenceLoss", { value: actorData.secondaryAttributes.essence.loss_penalty })}</span>`)
        }
        const penaltyHtml = penaltyTags.length ? penaltyTags.join(' | ') : noneLabel

        let mode = game.settings.get("afmbe-left-behind", "dark-mode") ? "dark-mode" : ""
        let dialogOptions = { classes: ["dialog", "afmbe-left-behind", mode] }

        const content = `<div class="afmbe-dialog-menu">
                            <h2>${dialogHeader}</h2>

                            <div class="afmbe-dialog-menu-text-box">
                                <div>
                                    <p>${dialogInstructions}</p>
                                    
                                    <ul>
                                        <li>${simpleDescription}</li>
                                        <li>${difficultDescription}</li>
                                    </ul>
                                </div>
                            </div>

                            <div class="afmbe-tags-flex-container">
                                <b>${penaltiesLabel}</b>: ${penaltyHtml}
                            </div>

                            <table>
                                <tbody>
                                    <tr>
                                        <td class="table-bold-text">${attributeTestLabel}</td>
                                        <td>
                                            <select id="attributeTestSelect" name="attributeTest">
                                                ${attributeTestOptions.map(option => `<option value="${option.value}">${option.label}</option>`).join("")}
                                            </select>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td class="table-bold-text">${rollModifierLabel}</td>
                                        <td><input class="attribute-input" type="number" value="0" name="inputModifier" id="inputModifier"></td>
                                    </tr>
                                    <tr>
                                        <td class="table-bold-text">${skillsLabel}</td>
                                        <td>
                                            <select id="skillSelect" name="skills">
                                                <option value="">${noneLabel}</option>${skillOptions}
                                            </select>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td class="table-bold-text">${qualitiesLabel}</td>
                                        <td>
                                            <select id="qualitySelect" name="qualities">
                                                <option value="">${noneLabel}</option>${qualityOptions}
                                            </select>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td class="table-bold-text">${drawbacksLabel}</td>
                                        <td>
                                            <select id="drawbackSelect" name="drawbacks">
                                                <option value="">${noneLabel}</option>${drawbackOptions}
                                            </select>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                    </div>`

        let d = new Dialog({
            title: dialogTitle,
            content,
            buttons: {
                one: {
                    label: cancelLabel,
                    callback: html => console.log('Cancelled')
                },
                two: {
                    label: rollLabel,
                    callback: async html => {
                        const attributeTestSelect = html[0].querySelector('#attributeTestSelect').value
                        const userInputModifier = Number(html[0].querySelector('#inputModifier').value)
                        const selectedSkill = this.actor.getEmbeddedDocument("Item", html[0].querySelector('#skillSelect').value)
                        const selectedQuality = this.actor.getEmbeddedDocument("Item", html[0].querySelector('#qualitySelect').value)
                        const selectedDrawback = this.actor.getEmbeddedDocument("Item", html[0].querySelector('#drawbackSelect').value)

                        const attributeValue = attributeTestSelect === 'simple' ? attributeValueBase * 2 : attributeValueBase
                        const skillValue = selectedSkill ? Number(selectedSkill.system.level) + skillBonus(this.actor, selectedSkill) : 0
                        const qualityValue = selectedQuality ? selectedQuality.system.bonus : 0
                        const drawbackValue = selectedDrawback ? selectedDrawback.system.bonus : 0

                        let tags = []
                        if (userInputModifier !== 0) { tags.push(`<span class="${userInputModifier >= 0 ? "bonusColorClass" : 'penaltyColorClass'}">${userModifierLabel} ${userInputModifier >= 0 ? "+" : ''}${userInputModifier}</span>`) }
                        if (selectedSkill) {
                            const skillLevel = Number(selectedSkill.system.level) + skillBonus(this.actor, selectedSkill);
                            tags.push(`<span class="${skillLevel >= 0 ? 'bonusColorClass' : 'penaltyColorClass'}">${selectedSkill.name} ${skillLevel >= 0 ? '+' : ''}${skillLevel}</span>`)
                        }
                        if (selectedQuality) {
                            const qualityBonus = selectedQuality.system.bonus;
                            tags.push(`<span class="${qualityBonus >= 0 ? 'bonusColorClass' : 'penaltyColorClass'}">${selectedQuality.name} ${qualityBonus >= 0 ? '+' : ''}${qualityBonus}</span>`)
                        }
                        if (selectedDrawback) {
                            const drawbackPenalty = selectedDrawback.system.bonus;
                            tags.push(`<span class="penaltyColorClass">${selectedDrawback.name} ${drawbackPenalty >= 0 ? '-' : ''}${drawbackPenalty}</span>`)
                        }

                        const rollMod = (attributeValue + skillValue + qualityValue - drawbackValue + userInputModifier)
                        let roll = await new Roll('1d10').evaluate()
                        let totalResult = Number(roll.result) + rollMod

                        let ruleOfDiv = ``
                        if (roll.result == 10) {
                            ruleOfDiv = `<h2 class="rule-of-chat-text">${ruleOfTenLabel}</h2>
                                        <button type="button" data-roll="roll-again" class="rule-of-ten">${rollAgainLabel}</button>`
                        }
                        if (roll.result == 1) {
                            ruleOfDiv = `<h2 class="rule-of-chat-text">${ruleOfOneLabel}</h2>
                                        <button type="button" data-roll="roll-again" class="rule-of-one">${rollAgainLabel}</button>`
                        }

                        const modifiersHtml = [...tags, ...penaltyTags].length ? [...tags, ...penaltyTags].join(' | ') : noneLabel
                        const attributeSummary = game.i18n.format("AFMBE.Chat.AttributeRollSummary", { attribute: attributeLabel, value: attributeValueBase, test: attributeTestNames[attributeTestSelect] || attributeTestSelect })
                        const chatContent = `<form>
                                                <h2>${attributeSummary}</h2>

                                                <div class="afmbe-tags-flex-container"><b>${modifiersLabel}</b>: ${modifiersHtml}</div>
                                                <table class="afmbe-chat-roll-table">
                                                    <thead>
                                                        <tr>
                                                            <th class="table-center-align">${game.i18n.localize("AFMBE.Chat.Roll")}</th>
                                                            <th class="table-center-align">${game.i18n.localize("AFMBE.Chat.Modifier")}</th>
                                                            <th class="table-center-align">${game.i18n.localize("AFMBE.Chat.Result")}</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        <tr>
                                                            <td class="table-center-align" data-roll="dice-result">[[${roll.result}]]</td>
                                                            <td class="table-center-align" data-roll="modifier" data-mod="${rollMod}">${rollMod}</td>
                                                            <td class="table-center-align" data-roll="dice-total" data-roll-value="${totalResult}">${totalResult}</td>
                                                        </tr>
                                                    </tbody>
                                                </table>

                                                <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; width: 100%;">
                                                    ${ruleOfDiv}
                                                </div>
                                            </form>`

                        ChatMessage.create({
                            user: game.user.id,
                            speaker: ChatMessage.getSpeaker(),
                            content: chatContent,
                            rolls: [roll]
                        })

                    }
                }
            },
            default: 'two',
            close: html => console.log()
        }, dialogOptions)

        d.render(true)
    }



    _onCombatTaskRoll(event) {
        event.preventDefault();
        if (!this.actor.isOwner) return;
        const type = event.currentTarget.dataset.actionType;
        if (!['defensive', 'help'].includes(type)) return;
        const escape = value => foundry.utils.escapeHTML(String(value ?? ''));
        const attributes = this.actor.system.primaryAttributes ?? {};
        const options = Object.keys(attributes).map(key => `<option value="${escape(key)}" ${key === (type === 'defensive' ? 'dexterity' : 'intelligence') ? 'selected' : ''}>${escape(game.i18n.localize(`AFMBE.Attributes.Primary.${key[0].toUpperCase()}${key.slice(1)}`))}</option>`).join('');
        const skills = this.actor.items.filter(item => item.type === 'skill');
        const skillOptions = skills.map(item => `<option value="${escape(item.id)}">${escape(item.name)} (${Number(item.system.level) || 0})</option>`).join('');
        const preview = actionState(this.actor);
        const content = `<form class="afmbe-combat-task-dialog">
            ${type === 'defensive' ? `<div class="form-group"><label>Defense</label><select name="mode">
                <option value="dodge">Dodge melee (beat attack total)</option>
                <option value="block">Block melee (9 or more; halves damage)</option>
                <option value="duck">Duck gunfire (9 or more; attacker −2)</option>
            </select></div><div class="form-group"><label>Incoming attack total (needed for melee dodge)</label><input type="number" name="attackTotal" min="1" step="1"></div>` : ''}
            <div class="form-group"><label>Attribute</label><select name="attribute">${options}</select></div>
            <div class="form-group"><label>Skill</label><select name="skill"><option value="">None</option>${skillOptions}</select></div>
            <div class="form-group"><label>Other modifier</label><input type="number" name="modifier" value="0" step="1"></div>
            <p>Next ${type} action penalty: ${preview ? -2 * preview.counts[type] : 0}. Rechecked when rolled.</p>
        </form>`;
        new Dialog({ title: type === 'defensive' ? 'Defend' : 'Help action', content, buttons: {
            cancel: { label: 'Cancel' },
            roll: { label: 'Roll', callback: async html => {
                const form = html[0].querySelector('form');
                const mode = type === 'defensive' ? form.elements.mode.value : 'help';
                const attackTotal = Number(form.elements.attackTotal?.value);
                if (mode === 'dodge' && (!Number.isFinite(attackTotal) || attackTotal < 1)) {
                    ui.notifications.warn('Enter the incoming attack total to resolve a melee dodge.');
                    return;
                }
                const modifier = Number(form.elements.modifier.value);
                if (!Number.isFinite(modifier)) { ui.notifications.warn('Enter a valid modifier.'); return; }
                const attributeKey = form.elements.attribute.value;
                const attribute = (Number(attributes[attributeKey]?.value) || 0) + attributeBonus(this.actor, attributeKey);
                const skill = this.actor.items.get(form.elements.skill.value);
                const skillValue = (Number(skill?.system.level) || 0) + skillBonus(this.actor, skill);
                let action;
                try { action = await spendAction(this.actor, type); }
                catch (error) { ui.notifications.warn(error.message); return; }
                const roll = await new Roll('1d10').evaluate();
                const total = roll.total + attribute + skillValue + modifier + action.penalty;
                const result = mode === 'dodge' ? (total > attackTotal ? 'Dodge succeeds; avoid this melee hit.' : 'Dodge fails.') :
                    mode === 'block' ? (total >= 9 ? 'Block succeeds; halve this melee hit’s damage.' : 'Block fails.') :
                    mode === 'duck' ? (total >= 9 ? 'Duck succeeds; attacker takes −2 to hit.' : 'Duck fails.') :
                    (total >= 9 ? 'Success (9+).' : 'Failure (below 9).');
                await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor: this.actor }), rolls: [roll],
                    content: `<h2>${escape(this.actor.name)}: ${escape(mode === 'help' ? 'Help action' : mode === 'dodge' ? 'Melee dodge' : mode === 'block' ? 'Melee block' : 'Duck gunfire')}</h2>` +
                        `<p>Roll ${roll.total} + ${escape(attributeKey)} ${attribute} + ${escape(skill?.name ?? 'no skill')} ${skillValue} + modifier ${modifier} + action penalty ${action.penalty} = <strong>${total}</strong>${mode === 'dodge' ? ` vs attack ${attackTotal}` : ' vs 9'}</p><p><strong>${escape(result)}</strong></p>` });
            } }
        }, default: 'roll' }, { classes: ['dialog', 'afmbe-left-behind', game.settings.get('afmbe-left-behind', 'dark-mode') ? 'dark-mode' : ''] }).render(true);
    }

    async _onReloadWeapon(event) {
        event.preventDefault();
        const weapon = this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId);
        if (!weapon || !this.actor.isOwner) return;
        const spare = compatibleMagazines(this.actor, weapon);
        if (!spare.length) { ui.notifications.warn('No compatible spare magazines. Set matching caliber on the weapon and magazine.'); return; }
        const esc = foundry.utils.escapeHTML;
        new Dialog({ title: `Reload: ${weapon.name}`, content: `<form><label>Spare magazine</label><select name="magazine">${spare.map(item => `<option value="${esc(item.id)}">${esc(item.name)} — ${item.system.rounds}/${item.system.capacity} (${esc(damageType(item.system.ammoType))})</option>`).join('')}</select></form>`,
            buttons: { cancel: { label: 'Cancel' }, reload: { label: 'Reload (Help action)', callback: async html => {
                try { await reloadWeapon(this.actor, weapon, this.actor.items.get(html[0].querySelector('[name="magazine"]').value)); }
                catch (error) { console.error('AFMBE reload failed', error); ui.notifications.error(`Reload failed: ${error.message}`); }
            } } }, default: 'reload' }).render(true);
    }

    async _onLoadMagazine(event) {
        event.preventDefault();
        const magazine = this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId);
        if (!magazine || !this.actor.isOwner) return;
        const esc = foundry.utils.escapeHTML;
        const ammo = this.actor.items.filter(item => item.type === 'ammunition' && Number(item.system.qty) > 0);
        if (!ammo.length) { ui.notifications.warn('Create loose ammunition first.'); return; }
        new Dialog({ title: `Load: ${magazine.name}`, content: `<form><label>Loose ammunition</label><select name="ammo">${ammo.map(item => `<option value="${esc(item.id)}">${esc(item.name)} — ${item.system.qty} (${esc(item.system.caliber)}, ${esc(item.system.ammoType)})</option>`).join('')}</select><label>Rounds to load</label><input type="number" name="amount" min="1" step="1" value="1"></form>`,
            buttons: { cancel: { label: 'Cancel' }, load: { label: 'Load rounds', callback: async html => {
                const form = html[0].querySelector('form');
                try { await loadMagazine(this.actor, magazine, this.actor.items.get(form.elements.ammo.value), Number(form.elements.amount.value)); }
                catch (error) { console.error('AFMBE magazine loading failed', error); ui.notifications.error(`Loading failed: ${error.message}`); }
            } } }, default: 'load' }).render(true);
    }

    async _onAttackRoll(event) {
        event.preventDefault()
        const weaponId = event.currentTarget.closest('.item')?.dataset.itemId
        const weapon = this.actor.items.get(weaponId)
        if (!weapon) return

        const attributes = this.actor.system.primaryAttributes ?? {}
        const skills = this.actor.items.filter(item => item.type === 'skill')
        const escape = value => foundry.utils.escapeHTML(String(value ?? ''))
        const isMelee = isMeleeAttack(weapon)
        const defaultMeleeAttribute = meleeAttribute(weapon)
        const options = Object.keys(attributes).filter(key => !isMelee || ['strength', 'dexterity'].includes(key)).map(key =>
            `<option value="${escape(key)}" ${isMelee && key === defaultMeleeAttribute ? 'selected' : ''}>${escape(game.i18n.localize(`AFMBE.Attributes.Primary.${key[0].toUpperCase()}${key.slice(1)}`))}</option>`
        ).join('')
        const skillOptions = skills.map(item => `<option value="${escape(item.id)}">${escape(item.name)} (${Number(item.system.level) || 0})</option>`).join('')
        const magazineMode = Boolean(weapon.system.usesMagazines)
        const hasMagazine = !isMelee && (magazineMode || Number(weapon.system.capacity?.max) > 0)
        const gunState = !isMelee ? gunPreview(this.actor, weapon) : null
        const offensivePreview = actionState(this.actor)
        const rangePreview = isMelee ? { penalty: 0, note: "Melee range: target must be adjacent." } : measureWeaponRange(this.actor, weapon)
        const meleeState = isMelee ? meleePreview(this.actor, weapon) : null
        const rangeSummary = rangePreview.error || rangePreview.note ? escape(rangePreview.error || rangePreview.note) :
            `${escape(rangePreview.targetName)}: ${rangePreview.distance.toFixed(1)} m; normal range ${rangePreview.normalRange} m; penalty ${rangePreview.penalty} (${escape(rangePreview.sceneScale)})`
        const content = `<form class="afmbe-attack-dialog">
            <div class="form-group"><label>Attribute</label><select name="attribute">${options}</select></div>
            <div class="form-group"><label>Skill</label><select name="skill"><option value="">None</option>${skillOptions}</select></div>
            <div class="form-group"><label>Aimed location</label><select name="location">
                <option value="body">Body (0)</option><option value="arms">Arm (-2)</option><option value="legs">Leg (-2)</option><option value="head">Head (-4)</option>
            </select></div>
            <div class="form-group"><label>Other modifier</label><input type="number" name="modifier" value="0" step="1"></div>
            <p>${isMelee ? 'Melee: target must be adjacent.' : `Range: ${rangeSummary}`}</p>
            ${isMelee ? `<p>Swings this action: ${meleeState.swings}/${meleeState.limit}; strain so far: ${meleeState.strain}. ${meleeState.nextAction ? `Next Offensive action requires a Constitution + skill task; Endurance ${meleeState.endurance} per swing.` : 'This action has room for another swing.'}</p>` : ''}
            <p>Offensive action: ${offensivePreview ? `used ${offensivePreview.counts.offensive}; repeat penalty ${-2 * offensivePreview.counts.offensive}` : 'outside combat (no repeat penalty)'}. Rechecked when rolled.</p>
            ${!isMelee ? `<p>Semi-auto: one round per attack. Shot ${gunState.shot} this turn; ${gunState.shotsInAction}/${gunState.rateOfFire} shots in current Offensive action; next recoil ${gunState.recoilPenalty}; action penalty ${gunState.actionPenalty}.</p>` : ''}
            ${hasMagazine ? `<p>Magazine: ${Number(weapon.system.capacity.value) || 0} / ${Number(weapon.system.capacity.max) || 0}</p>` : ''}
        </form>`
        new Dialog({
            title: `Attack: ${weapon.name}`,
            content,
            buttons: {
                cancel: { label: 'Cancel' },
                attack: { label: 'Roll attack', callback: async html => {
                    const form = html[0].querySelector('form')
                    const attributeKey = form.elements.attribute.value
                    const attribute = (Number(attributes[attributeKey]?.value) || 0) + attributeBonus(this.actor, attributeKey)
                    const skill = this.actor.items.get(form.elements.skill.value)
                    const skillLevel = (Number(skill?.system.level) || 0) + skillBonus(this.actor, skill)
                    const hitLocation = form.elements.location.value
                    const location = hitLocation === 'head' ? -4 : ['arms', 'legs'].includes(hitLocation) ? -2 : 0
                    const modifier = Number(form.elements.modifier.value) || 0
                    const range = isMelee ? { penalty: 0, note: 'Melee' } : measureWeaponRange(this.actor, weapon)
                    if (range.error) { ui.notifications.warn(range.error); return }
                    const targetedTokens = [...game.user.targets]
                    if (targetedTokens.length !== 1 || !targetedTokens[0].actor) {
                        ui.notifications.warn('Target exactly one token before attacking.'); return
                    }
                    const target = targetedTokens[0].actor
                    if (isMelee) {
                        const attackerTokens = canvas?.tokens?.placeables?.filter(token => token.actor?.uuid === this.actor.uuid) ?? []
                        const source = attackerTokens.find(token => token.controlled) ?? (attackerTokens.length === 1 ? attackerTokens[0] : null)
                        const targetToken = targetedTokens[0]
                        const size = Number(canvas?.grid?.size), distance = Number(canvas?.scene?.grid?.distance)
                        if (!source || !size || !distance || !canvas?.scene?.grid || !['m', 'meter', 'meters'].includes(String(canvas.scene.grid.units).toLowerCase())) { ui.notifications.warn('Select your token on a scene measured in meters for melee.'); return }
                        const meters = Math.hypot(source.center.x - targetToken.center.x, source.center.y - targetToken.center.y) / size * distance
                        if (meters > distance * 1.5) { ui.notifications.warn('Melee target is out of reach (more than one adjacent grid space).'); return }
                    }
                    const activeMagazine = isMelee ? null : loadedMagazine(this.actor, weapon)
                    const shots = hasMagazine ? 1 : 0
                    const remaining = magazineMode && !isMelee ? Number(activeMagazine?.system.rounds) : Number(weapon.system.capacity?.value)
                    if (!isMelee && magazineMode && (!activeMagazine || !Number.isSafeInteger(remaining) || remaining < 1)) { ui.notifications.warn(`${weapon.name} has no loaded rounds. Reload a magazine.`); return }
                    const firedDamageType = isMelee ? (['twoHanded', 'slashing', 'stabbing'].includes(damageType(weapon.system.damage_type)) ? damageType(weapon.system.damage_type) : 'twoHanded') : magazineMode ? damageType(activeMagazine.system.ammoType) : damageType(weapon.system.damage_type)
                    if (hasMagazine && (!Number.isInteger(shots) || shots < 1 || !Number.isFinite(remaining) || shots > remaining)) {
                        ui.notifications.warn(`Not enough ammunition in ${weapon.name} for that attack.`)
                        return
                    }
                    let action, meleeStrike, gunShot
                    try {
                        meleeStrike = isMelee ? await prepareMeleeStrike(this.actor, weapon, skill) : null
                        if (isMelee && !meleeStrike) return
                        gunShot = isMelee ? null : await prepareGunShot(this.actor, weapon)
                        action = { penalty: isMelee ? meleeStrike.actionPenalty : gunShot.actionPenalty }
                    } catch (error) { ui.notifications.warn(error.message); return }
                    if (!isMelee && magazineMode) {
                        await activeMagazine.update({ 'system.rounds': remaining - 1 })
                        await weapon.update({ 'system.capacity.value': remaining - 1 })
                    } else if (hasMagazine) await weapon.update({ 'system.capacity.value': remaining - shots })
                    const roll = await new Roll('1d10').evaluate()
                    const ammoHitBonus = isMelee ? 1 : hitBonus(firedDamageType)
                    const total = roll.total + attribute + skillLevel + location + modifier + ammoHitBonus + range.penalty + action.penalty + (meleeStrike?.strainPenalty ?? gunShot?.recoilPenalty ?? 0)
                    const success = total >= 9
                    const degrees = success ? Math.floor((total - 9) / 2) + 1 : 0
                    const locationName = form.elements.location.selectedOptions[0].textContent
                    const ammoNote = hasMagazine ? `<p>1 ${escape(firedDamageType)} round fired (semi-auto); ${weapon.system.capacity.value}/${weapon.system.capacity.max} remaining.</p>` : ''
                    const rangeDetail = isMelee ? `melee swing ${meleeStrike.swing}/${meleePreview(this.actor, weapon).limit}; strain ${meleeStrike.strainPenalty}; Endurance spent ${meleeStrike.enduranceSpent}` : `shot ${gunShot.shot} this turn (${gunShot.shotsInAction}/${gunShot.rateOfFire} this action), recoil ${gunShot.recoilPenalty}; ` + (range.note ? 'range unconfigured (0)' : `range ${range.penalty} (${range.distance.toFixed(1)} m / ${range.normalRange} m)` )
                    const content = `<h2>${escape(weapon.name)}</h2><div class="afmbe-roll-kind">Attack</div><p>${escape(attributeKey)} ${attribute}, ${escape(skill?.name ?? 'No skill')} ${skillLevel}, ${escape(locationName)}, modifier ${modifier}, ${isMelee ? 'melee' : 'ammo'} ${ammoHitBonus >= 0 ? "+" : ""}${ammoHitBonus}, ${rangeDetail}, action ${action.penalty}</p><p>Roll ${roll.total} + modifiers = <strong>${total}</strong> vs 9 — <strong>${success ? `Hit (${degrees} degree${degrees === 1 ? '' : 's'})` : 'Miss'}</strong></p>${ammoNote}`
                    await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor: this.actor }),
                        content: content + `<p>${success ? `Awaiting ${escape(target.name)}’s defense.` : 'Attack misses; no damage roll.'}</p>`, rolls: [roll],
                        flags: { 'afmbe-left-behind': { pendingAttack: {
                            attackerUuid: this.actor.uuid, targetUuid: target.uuid, targetName: target.name,
                            weaponUuid: weapon.uuid, weaponName: weapon.name, damageType: firedDamageType, total, location: hitLocation,
                            melee: isMelee, status: success ? 'pending' : 'miss', blocked: false
                        } } } })
                } }
            },
            default: 'attack'
        }, { classes: ['dialog', 'afmbe-left-behind', game.settings.get('afmbe-left-behind', 'dark-mode') ? 'dark-mode' : ''] }).render(true)
    }

    async _onDamageRoll(event) {
        event.preventDefault()
        let element = event.currentTarget
        let weapon = this.actor.getEmbeddedDocument("Item", element.closest('.item').dataset.itemId)
        const targetedTokens = [...game.user.targets]
        const target = targetedTokens.length === 1 ? targetedTokens[0].actor : null

        const dialogTitle = game.i18n.localize("AFMBE.Dialog.WeaponRoll.Title")
        const optionsLabel = game.i18n.localize("AFMBE.Dialog.WeaponRoll.Options")
        const cancelLabel = game.i18n.localize("AFMBE.Dialog.Button.Cancel")
        const rollLabel = game.i18n.localize("AFMBE.Dialog.Button.Roll")

        let mode = game.settings.get("afmbe-left-behind", "dark-mode") ? "dark-mode" : ""
        let dialogOptions = { classes: ["dialog", "afmbe-left-behind", mode] }

        const content = `<div class="afmbe-dialog-menu">

                            <div>
                                <h2>${optionsLabel}</h2>
                                <table>
                                    <tbody>
                                        <tr>
                                            <th>Target</th>
                                            <td>${target ? foundry.utils.escapeHTML(target.name) : 'None selected (damage roll only)'}</td>
                                        </tr>
                                        <tr>
                                            <th>Hit location</th>
                                            <td><select id="hitLocation" name="hitLocation">
                                                <option value="body">Body</option>
                                                <option value="head">Head</option>
                                                <option value="arms">Arms</option>
                                                <option value="legs">Legs</option>
                                            </select></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                    <div>`

        let d = new Dialog({
            title: dialogTitle,
            content,
            buttons: {
                one: {
                    label: cancelLabel,
                    callback: html => console.log('Cancelled')
                },
                two: {
                    label: rollLabel,
                    callback: async html => {
                        const hitLocation = html[0].querySelector('#hitLocation').value

                        const roll = await new Roll(weapon.system.damage_string).evaluate()

                        const damageLabel = game.i18n.localize("AFMBE.Chat.Damage")
                        const typeLabel = game.i18n.localize("AFMBE.Chat.Type")
                        const detailLabel = game.i18n.localize("AFMBE.Chat.Detail")

                        let chatContent = `<div>
                                                <h2>Damage Roll</h2>
                                                <div class="afmbe-roll-kind">${foundry.utils.escapeHTML(weapon.name)}</div>

                                                <table class="afmbe-chat-roll-table">
                                                    <thead>
                                                        <tr>
                                                            <th class="table-center-align">${damageLabel}</th>
                                                            <th class="table-center-align">${typeLabel}</th>
                                                            <th class="table-center-align">${detailLabel}</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        <tr>
                                                            <td class="table-center-align">[[${roll.result}]]</td>
                                                            <td class="table-center-align">${foundry.utils.escapeHTML(weapon.system.damage_types_obj[damageType(weapon.system.damage_type)] ?? damageType(weapon.system.damage_type))}</td>
                                                            <td class="table-center-align">${weapon.system.damage_string}</td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>`

                        const damageMessage = await ChatMessage.create({
                            user: game.user.id,
                            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
                            content: chatContent,
                            rolls: [roll],
                            ...(target ? { flags: { 'afmbe-left-behind': { armorDamage: {
                                targetUuid: target.uuid,
                                targetName: target.name,
                                damage: roll.total,
                                damageType: damageType(weapon.system.damage_type),
                                location: hitLocation,
                                applied: false
                            } } } } : {})
                        })
                    }
                }
            },
            default: "two",
            close: html => console.log()
        }, dialogOptions)

        d.render(true)
    }


    async _onArmorRoll(event) {
        event.preventDefault()
        let element = event.currentTarget
        let equippedItem = this.actor.getEmbeddedDocument("Item", element.closest('.item').dataset.itemId)

        let roll = await new Roll(equippedItem.system.armor_value).evaluate()

        await postArmorRoll(this.actor, equippedItem, roll, equippedItem.system.armor_value)
    }

    _onToggleEquipped(event) {
        event.preventDefault()
        let element = event.currentTarget
        let equippedItem = this.actor.getEmbeddedDocument("Item", element.closest('.item').dataset.itemId)

        switch (equippedItem.system.equipped) {
            case true:
                equippedItem.update({ 'system.equipped': false })
                break

            case false:
                equippedItem.update({ 'system.equipped': true })
                break
        }
    }

    _onResetResource(event) {
        event.preventDefault()
        const actorData = this.actor.system
        const element = event.currentTarget
        const dataPath = `system.secondaryAttributes.${element.dataset.resource}.value`
        const resetResourceValue = actorData.secondaryAttributes[element.dataset.resource].max
        this.actor.update({ [dataPath]: resetResourceValue })
    }

    _createStatusTags() {
        let tagContainer = this.form.querySelector('.tags-flex-container')
        let encTag = document.createElement('div')
        let enduranceTag = document.createElement('div')
        let essenceTag = document.createElement('div')
        let injuryTag = document.createElement('div')
        let actorData = this.actor.system

        // Create Essence Tag and & Append
        if (actorData.secondaryAttributes.essence.value <= 1) {
            essenceTag.innerHTML = `<div>${game.i18n.localize("AFMBE.Status.Hopeless")}</div>`
            essenceTag.title = game.i18n.localize("AFMBE.Status.HopelessHint")
            essenceTag.classList.add('tag')
            tagContainer.append(essenceTag)
        }
        else if (actorData.secondaryAttributes.essence.value <= (actorData.secondaryAttributes.essence.max / 2)) {
            essenceTag.innerHTML = `<div>${game.i18n.localize("AFMBE.Status.Forlorn")}</div>`
            essenceTag.title = game.i18n.localize("AFMBE.Status.ForlornHint")
            essenceTag.classList.add('tag')
            tagContainer.append(essenceTag)
        }

        // Create Endurance Tag and & Append
        if (actorData.secondaryAttributes.endurance_points.value <= 5) {
            enduranceTag.innerHTML = `<div>${game.i18n.localize("AFMBE.Status.Exhausted")}</div>`
            enduranceTag.title = game.i18n.localize("AFMBE.Status.ExhaustedHint")
            enduranceTag.classList.add('tag')
            tagContainer.append(enduranceTag)
        }

        // Create Injury Tag and & Append
        if (actorData.secondaryAttributes.hp.value <= -10) {
            injuryTag.innerHTML = `<div>${game.i18n.localize("AFMBE.Status.Dying")}</div>`
            injuryTag.classList.add('tag')
            injuryTag.title = game.i18n.localize("AFMBE.Status.DyingHint")
            tagContainer.append(injuryTag)
        }
        else if (actorData.secondaryAttributes.hp.value <= 0) {
            injuryTag.innerHTML = `<div>${game.i18n.localize("AFMBE.Status.SemiConscious")}</div>`
            injuryTag.classList.add('tag')
            injuryTag.title = game.i18n.localize("AFMBE.Status.SemiConsciousHint")
            tagContainer.append(injuryTag)
        }
        else if (actorData.secondaryAttributes.hp.value <= 5) {
            injuryTag.innerHTML = `<div>${game.i18n.localize("AFMBE.Status.SeverelyInjured")}</div>`
            injuryTag.classList.add('tag')
            injuryTag.title = game.i18n.localize("AFMBE.Status.SeverelyInjuredHint")
            tagContainer.append(injuryTag)
        }

        // Create Encumbrance Tags & Append
        switch (actorData.encumbrance.level) {
            case 1:
                encTag.innerHTML = `<div>${game.i18n.localize("AFMBE.Status.Encumbrance.Light")}</div>`
                encTag.classList.add('tag')
                tagContainer.append(encTag)
                break

            case 2:
                encTag.innerHTML = `<div>${game.i18n.localize("AFMBE.Status.Encumbrance.Moderate")}</div>`
                encTag.classList.add('tag')
                tagContainer.append(encTag)
                break

            case 3:
                encTag.innerHTML = `<div>${game.i18n.localize("AFMBE.Status.Encumbrance.Heavy")}</div>`
                encTag.classList.add('tag')
                tagContainer.append(encTag)
                break
        }
    }

}
