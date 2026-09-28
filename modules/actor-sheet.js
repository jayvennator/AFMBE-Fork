import { traitRollEffects, manualTraitValue, traitSummary } from './trait-effects.js';
import { isMeleeAttack } from './linked-combat.js';
import { meleeAttribute, meleePreview, prepareMeleeStrike } from './melee-actions.js';
import { gunPreview, prepareGunShot } from './gun-actions.js';
import { allowedFireModes, fireMode, volleyHits } from './fire-modes.js';
import { weaponCategory, feedSystem, compatibleLooseAmmo, loadInternalRound, unloadInternalRounds, removeMagazine } from './weapon-feed.js';
import { actionPanel, actionState, spendAction, correctAction } from './action-economy.js';
import { measureWeaponRange } from './weapon-range.js';
import { damageType, hitBonus } from './damage-types.js';
import { normalizeCaliber } from './calibers.js';
import { activeBonuses, attributeBonus, skillBonus, useConsumable, endConsumableEffect } from './consumables.js';
import { postArmorRoll } from './armor-damage.js';
import { promptArmorReplenishment } from './armor-replenishment.js';
import { armorIntegrity } from './armor-integrity.js';
import { attachmentModifiers, promptInstallAttachment, removeAttachment } from './attachments.js';
import { SKILL_CATEGORIES, skillCategory } from './skill-categories.js';
import { containers, dimensions, firstFreeCell, nearestFreeCell, moveInventoryItem, unpackItem, splitInventoryStack, stashItem, storageLocation, inCombat, handCount, HAND_LIMIT, STASH, inventoryActionCost, itemWeight } from './inventory-grid.js';
import { loadedMagazine, compatibleMagazines, reloadWeapon, loadMagazine, unloadMagazine } from './magazines.js';
import { coverForAttack, toggleCoverStance } from './region-cover.js';
import { beginSuppressiveCone } from './suppressive-fire.js';

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
        const backpack = [];
        const rig = [];
        const attachment = [];
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
                    i.weaponCategory = weaponCategory(i)
                    i.feed = feedSystem(i)
                    i.isBow = weaponCategory(i) === "bow"
                    i.hasInsertedMagazine = Boolean(i.system.loadedMagazineId)
                    i.canUnload = ["internal", "cylinder", "single"].includes(i.feed) && Number(i.system.capacity?.value) > 0
                    weapon.push(i)
                    break
                case "backpack":
                    backpack.push(i)
                    break
                case "rig":
                    rig.push(i)
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
                case "attachment":
                    i.installedWeaponName = sheetData.items.find(weapon => (weapon.id ?? weapon._id) === i.system.installedWeaponId)?.name ?? '';
                    attachment.push(i)
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
        const itemCats = [item, equippedItem, weapon, armor, backpack, rig, attachment, consumable, magazine, ammunition, power, quality, skill, drawback]
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
        actorData.readyWeapons = weapon.filter(entry => entry.system.equipped && !storageLocation(entry))
        actorData.readyWeaponSlots = [0, 1].map(index => actorData.readyWeapons[index] ?? null)
        actorData.meleeWeapons = weapon.filter(i => i.weaponCategory === "melee")
        actorData.firearms = weapon.filter(i => i.weaponCategory === "firearm")
        actorData.bows = weapon.filter(i => ["bow", "crossbow"].includes(i.weaponCategory))
        actorData.launchers = weapon.filter(i => i.weaponCategory === "launcher")
        actorData.magazine = magazine
        actorData.ammunition = ammunition
        actorData.armor = armor
        actorData.readyArmor = [...armor, ...equippedItem.filter(entry => String(entry.system.armor_value ?? '0') !== '0')]
            .filter(entry => entry.system.equipped && !storageLocation(entry))
        actorData.backpack = backpack
        actorData.rig = rig
        actorData.readyBackpack = backpack.find(entry => entry.system.equipped) ?? null
        actorData.readyRig = rig.find(entry => entry.system.equipped) ?? null
        const allStored = sheetData.items.filter(entry => !['skill','quality','drawback','power','aspect','backpack','rig'].includes(entry.type) &&
            !(entry.type === 'magazine' && entry.system.insertedInWeaponId && !storageLocation(entry)) &&
            !(entry.type === 'attachment' && entry.system.installedWeaponId && !storageLocation(entry)))
        actorData.inventoryGrids = containers(this.actor).map(container => ({
            ...container,
            usedWeight: this.actor.items.filter(entry => storageLocation(entry) === container.id).reduce((sum, entry) => sum + itemWeight(entry), 0).toFixed(1),
            usedCells: allStored.filter(entry => storageLocation(entry) === container.id).reduce((sum, entry) => {
                const size = dimensions(entry); return sum + size.width * size.height
            }, 0),
            cells: Array.from({ length: container.width * container.height }, (_, index) => ({
                x: index % container.width, y: Math.floor(index / container.width),
                column: index % container.width + 1, row: Math.floor(index / container.width) + 1
            })),
            contents: allStored.filter(entry => storageLocation(entry) === container.id).map(entry => {
                const size = dimensions(entry)
                return { id: entry._id ?? entry.id, name: entry.name, img: entry.img, type: entry.type,
                    canEquip: ['weapon', 'armor', 'item'].includes(entry.type), canUse: entry.type === 'consumable',
                    equipped: Boolean(entry.system.equipped), qty: Number(entry.system.qty ?? 1),
                    x: Number(entry.system.storage?.x) || 0,
                    y: Number(entry.system.storage?.y) || 0, column: (Number(entry.system.storage?.x) || 0) + 1,
                    row: (Number(entry.system.storage?.y) || 0) + 1, width: size.width, height: size.height,
                    rotated: Boolean(entry.system.storage?.rotated) }
            })
        }))
        actorData.unassignedInventory = allStored.filter(entry => !entry.system.equipped && storageLocation(entry) !== STASH && (!storageLocation(entry) ||
            !actorData.inventoryGrids.some(grid => grid.id === storageLocation(entry)))).map(entry => ({
                ...entry, canEquip: ['weapon', 'armor', 'item'].includes(entry.type), canUse: entry.type === 'consumable'
            }))
        actorData.stashedInventory = allStored.filter(entry => storageLocation(entry) === STASH)
        actorData.handLimit = HAND_LIMIT
        actorData.handCount = handCount(this.actor)
        actorData.handOverflow = actorData.handCount > HAND_LIMIT
        const selected = sheetData.items.find(entry => (entry._id ?? entry.id) === this._selectedInventoryItemId)
        actorData.selectedInventoryItem = selected ? { ...selected,
            canEquip: ['weapon', 'armor', 'item', 'backpack', 'rig'].includes(selected.type),
            canUse: selected.type === 'consumable' && storageLocation(selected) !== STASH, stored: Boolean(storageLocation(selected)),
            canSplit: ['ammunition', 'consumable', 'item'].includes(selected.type) && Number(selected.system.qty) > 1,
            canDetach: selected.type === 'attachment' && Boolean(selected.system.installedWeaponId),
            canRotate: dimensions(selected).width !== dimensions(selected).height,
            footprint: dimensions(selected), inStash: storageLocation(selected) === STASH,
            stashLocked: storageLocation(selected) === STASH && inCombat(this.actor),
            canStash: !inCombat(this.actor) && !selected.system.equipped && !selected.system.installedWeaponId &&
                !selected.system.insertedInWeaponId && !['backpack','rig','quality','drawback','skill','power','aspect'].includes(selected.type) && storageLocation(selected) !== STASH,
            equipCost: inCombat(this.actor) && ['weapon','backpack','rig'].includes(selected.type) ? 1 : 0,
            retrievalCost: inventoryActionCost(this.actor, this.actor.items.get(selected._id ?? selected.id)),
            storageOptions: containers(this.actor).filter(container => container.id === 'pockets' || container.equipped).map(container => ({
                id: container.id, label: container.label,
                helpCost: inventoryActionCost(this.actor, this.actor.items.get(selected._id ?? selected.id), container.id)
            })),
        } : null
        actorData.attachment = attachment
        actorData.consumable = consumable
        actorData.readyConsumables = consumable.filter(entry => {
            const location = storageLocation(entry)
            return location === 'pockets' || Boolean(this.actor.items.get(location)?.type === 'rig' &&
                this.actor.items.get(location).system.equipped)
        })
        actorData.actionEconomy = actionPanel(this.actor)
        actorData.activeConsumables = activeBonuses(this.actor).map(effect => ({ ...effect, willCrash: effect.phase !== "crash" && Number(effect.crashPenalty) > 0 && Number(effect.crashDuration) > 0 }))
        actorData.power = power
        actorData.quality = quality
        actorData.skill = skill
        actorData.skillGroups = Object.entries(SKILL_CATEGORIES).map(([key, label]) =>
            ({ label, items: skill.filter(entry => skillCategory(entry) === key) })).filter(group => group.items.length)
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
        html.find('.install-attachment').click(event => promptInstallAttachment(this.actor, this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)))
        html.find('.remove-attachment').click(async event => {
            try { await removeAttachment(this.actor, this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)); }
            catch (error) { console.error('AFMBE attachment removal failed', error); ui.notifications.error(error.message); }
        })
        html.find('.unload-weapon').click(this._onUnloadWeapon.bind(this))
        html.find('.remove-magazine').click(async event => {
            const weapon = this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId);
            try { await removeMagazine(this.actor, weapon); } catch (error) { ui.notifications.warn(error.message); }
        })
        html.find('.load-magazine').click(this._onLoadMagazine.bind(this))
        html.find('.unload-magazine').click(event => {
            const magazine = this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)
            this._promptMagazineUnload(magazine)
        })
        if (game.user.isGM) html.find('.damage-roll').click(this._onDamageRoll.bind(this))
        html.find('.toggleEquipped').click(this._onToggleEquipped.bind(this))
        html.find('.toggle-weapon-equipped').click(async event => {
            const weapon = this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)
            try { await this._setInventoryEquipped(weapon, !weapon?.system.equipped) }
            catch (error) { ui.notifications.warn(error.message) }
        })
        html.find('.inventory-equip').click(async event => {
            const item = this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)
            try { await this._setInventoryEquipped(item, !item?.system.equipped) }
            catch (error) { ui.notifications.warn(error.message) }
        })
        html.find('.afmbe-inventory-grid').on('dragover', event => {
            event.preventDefault()
            const item = this.actor.items.get(this._gridDrag?.id)
            const preview = event.currentTarget.querySelector('.inventory-grid-preview')
            if (!item || !preview) return
            const rotated = Boolean(item.system.storage?.rotated) !== Boolean(event.originalEvent.shiftKey)
            const placement = this._inventoryDropPosition(event.currentTarget, item, event.originalEvent, rotated)
            if (!placement) { preview.hidden = true; return }
            const size = dimensions(item, rotated)
            preview.hidden = false
            preview.classList.toggle('invalid', !placement.cell)
            preview.style.left = `${placement.x * placement.cellWidth}px`
            preview.style.top = `${placement.y * placement.cellHeight}px`
            preview.style.width = `${size.width * placement.cellWidth}px`
            preview.style.height = `${size.height * placement.cellHeight}px`
        })
        html.find('.item').attr('draggable', 'true').on('dragstart', event => {
            const item = this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)
            if (!item) return
            const source = event.currentTarget.closest('.inventory-grid-item')
            const size = dimensions(item)
            const rect = source?.getBoundingClientRect()
            this._gridDrag = { id: item.id, fromGrid: Boolean(source), rotated: Boolean(item.system.storage?.rotated),
                x: rect ? Math.max(0, Math.min(size.width - 1, Math.floor((event.originalEvent.clientX - rect.left) / (rect.width / size.width)))) : 0,
                y: rect ? Math.max(0, Math.min(size.height - 1, Math.floor((event.originalEvent.clientY - rect.top) / (rect.height / size.height)))) : 0 }
            event.originalEvent.dataTransfer.setData('application/x-afmbe-item', item.id)
        })
        html.find('.item').on('dragend', () => {
            this._gridDrag = null
            html.find('.inventory-grid-preview').prop('hidden', true)
            html.find('.afmbe-magazine-drop-ready').removeClass('afmbe-magazine-drop-ready')
        })
        html.find('.afmbe-magazine-target').on('dragover', event => {
            const source = this.actor.items.get(this._gridDrag?.id)
            if (source?.type !== 'ammunition') return
            event.preventDefault(); event.stopPropagation()
            event.currentTarget.classList.add('afmbe-magazine-drop-ready')
            event.currentTarget.closest('.afmbe-inventory-grid')?.querySelector('.inventory-grid-preview')?.setAttribute('hidden', '')
        }).on('dragleave', event => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove('afmbe-magazine-drop-ready')
        }).on('drop', event => {
            const ammo = this.actor.items.get(event.originalEvent.dataTransfer.getData('application/x-afmbe-item'))
            if (ammo?.type !== 'ammunition') return
            event.preventDefault(); event.stopPropagation()
            event.currentTarget.classList.remove('afmbe-magazine-drop-ready')
            const magazine = this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)
            this._promptMagazineLoad(magazine, ammo)
        })
        html.find('.afmbe-item-portrait').on('error', event => { event.currentTarget.hidden = true })
        html.find('.inventory-grid-item, .afmbe-loose-item').click(async event => {
            if (event.target.closest('button')) return
            const scroll = html.closest('.window-content').scrollTop()
            this._selectedInventoryItemId = event.currentTarget.dataset.itemId
            await this.render(false)
            this.element.find('.window-content').scrollTop(scroll)
        })
        html.find('.afmbe-inventory-grid').on('drop', async event => {
            event.preventDefault(); event.stopPropagation()
            const source = this.actor.items.get(event.originalEvent.dataTransfer.getData('application/x-afmbe-item'))
            const grid = event.currentTarget
            if (!source) return
            const rotated = Boolean(source.system.storage?.rotated) !== Boolean(event.originalEvent.shiftKey)
            const placement = this._inventoryDropPosition(grid, source, event.originalEvent, rotated)
            grid.querySelector('.inventory-grid-preview').hidden = true
            if (!placement?.cell) return ui.notifications.warn('No nearby free space for this item. Rotate it or move another item first.')
            try { await moveInventoryItem(this.actor, source, grid.dataset.containerId, placement.cell.x, placement.cell.y, rotated) }
            catch (error) { ui.notifications.warn(error.message) }
        })
        html.find('.afmbe-equip-slot').on('dragover', event => event.preventDefault())
        html.find('.afmbe-equip-slot').on('drop', async event => {
            event.preventDefault(); event.stopPropagation()
            const item = this.actor.items.get(event.originalEvent.dataTransfer.getData('application/x-afmbe-item'))
            if (!item) return
            if (event.currentTarget.dataset.equipSlot === 'weapon' && item.type !== 'weapon' ||
                event.currentTarget.dataset.equipSlot === 'armor' && !['armor', 'item'].includes(item.type) ||
                event.currentTarget.dataset.equipSlot === 'backpack' && item.type !== 'backpack' ||
                event.currentTarget.dataset.equipSlot === 'rig' && item.type !== 'rig')
                return ui.notifications.warn('This item does not fit that equipment slot.')
            try { await this._setInventoryEquipped(item, true) }
            catch (error) { ui.notifications.warn(error.message) }
        })
        html.find('.inventory-autopack').click(async event => {
            const item = this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)
            const containerId = event.currentTarget.dataset.containerId
            const cell = firstFreeCell(this.actor, item, containerId)
            if (!cell) return ui.notifications.warn('No free space for this item in that container.')
            try { await moveInventoryItem(this.actor, item, containerId, cell.x, cell.y) }
            catch (error) { ui.notifications.warn(error.message) }
        })
        html.find('.inventory-unpack').click(async event => {
            try { await unpackItem(this.actor, this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)) }
            catch (error) { ui.notifications.warn(error.message) }
        })
        html.find('.inventory-stash').click(async event => {
            try { await stashItem(this.actor, this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)) }
            catch (error) { ui.notifications.warn(error.message) }
        })
        html.find('.inventory-rotate').click(async event => {
            const item = this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)
            try { await this._rotateInventoryItem(item) }
            catch (error) { ui.notifications.warn(error.message) }
        })
        html.find('.inventory-detach').click(async event => {
            const item = this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)
            try { await removeAttachment(this.actor, item) }
            catch (error) { ui.notifications.warn(error.message) }
        })
        html.find('.inventory-split').click(async event => {
            try { await splitInventoryStack(this.actor, this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)) }
            catch (error) { ui.notifications.warn(error.message) }
        })
        html.find('.inventory-open').click(event => this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)?.sheet.render(true))
        html.find('.toggle-container-equipped').click(async event => {
            const item = this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)
            try { await this._setInventoryEquipped(item, !item?.system.equipped) }
            catch (error) { ui.notifications.warn(error.message) }
        })
        html.find('.equipment .item, .items .item').on('contextmenu', event => {
            event.preventDefault()
            const item = this.actor.items.get(event.currentTarget.dataset.itemId)
            if (item) this._showInventoryMenu(item, event.originalEvent)
        })
        html.find('.armor-button-cell button').click(this._onArmorRoll.bind(this))
        html.find('.replenish-armor').click(event => promptArmorReplenishment(this.actor, this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)))
        html.find('.use-consumable').click(event => useConsumable(this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)))
        html.find('.end-consumable').click(async event => {
            await endConsumableEffect(this.actor, event.currentTarget.dataset.effectId);
        })
        html.find('.roll-combat-task').click(this._onCombatTaskRoll.bind(this));
        html.find('.take-cover').click(async () => {
            try { await toggleCoverStance(this.actor); }
            catch (error) { ui.notifications.warn(error.message); }
        });
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
            if (li?.matches('.inventory-grid-item, .afmbe-loose-item')) return
            const item = this.actor.items.get(li.dataset.itemId)
            if (item.isOwner) {
                item.sheet.render(true)
            }
            item.update({ "data.value": item.system.value })
        })

        // Delete Inventory Item
        html.find('.item-delete').click(async ev => {
            const item = this.actor.items.get(ev.currentTarget.closest('.item')?.dataset.itemId)
            try { await this._deleteInventoryItem(item) }
            catch (error) { ui.notifications.warn(error.message) }
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
            level: 0,
            ...(!['backpack', 'rig', 'quality', 'drawback', 'skill', 'power', 'aspect'].includes(typeKey) ?
                { system: { storage: { containerId: STASH, x: 0, y: 0, rotated: false } } } : {})
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
                        const automatic = traitRollEffects(this.actor, { kind: 'attribute', attribute: attributeKey, skillName: selectedSkill?.name })
                        const qualityValue = manualTraitValue(selectedQuality, automatic)
                        const drawbackValue = manualTraitValue(selectedDrawback, automatic)

                        let tags = []
                        if (userInputModifier !== 0) { tags.push(`<span class="${userInputModifier >= 0 ? "bonusColorClass" : 'penaltyColorClass'}">${userModifierLabel} ${userInputModifier >= 0 ? "+" : ''}${userInputModifier}</span>`) }
                        if (selectedSkill) {
                            const skillLevel = Number(selectedSkill.system.level) + skillBonus(this.actor, selectedSkill);
                            tags.push(`<span class="${skillLevel >= 0 ? 'bonusColorClass' : 'penaltyColorClass'}">${selectedSkill.name} ${skillLevel >= 0 ? '+' : ''}${skillLevel}</span>`)
                        }
                        tags.push(`<span>Traits: ${traitSummary(automatic, selectedQuality, selectedDrawback, foundry.utils.escapeHTML)}</span>`)
                        const rollMod = (attributeValue + skillValue + automatic.total + qualityValue + drawbackValue + userInputModifier)
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
                const automatic = traitRollEffects(this.actor, { kind: type === 'defensive' ? 'defense' : 'help', mode, attribute: attributeKey, skillName: skill?.name });
                const total = roll.total + attribute + skillValue + modifier + action.penalty + automatic.total;
                const result = mode === 'dodge' ? (total > attackTotal ? 'Dodge succeeds; avoid this melee hit.' : 'Dodge fails.') :
                    mode === 'block' ? (total >= 9 ? 'Block succeeds; halve this melee hit’s damage.' : 'Block fails.') :
                    mode === 'duck' ? (total >= 9 ? 'Duck succeeds; attacker takes −2 to hit.' : 'Duck fails.') :
                    (total >= 9 ? 'Success (9+).' : 'Failure (below 9).');
                await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor: this.actor }), rolls: [roll],
                    content: `<h2>${escape(this.actor.name)}: ${escape(mode === 'help' ? 'Help action' : mode === 'dodge' ? 'Melee dodge' : mode === 'block' ? 'Melee block' : 'Duck gunfire')}</h2>` +
                        `<p>Roll ${roll.total} + ${escape(attributeKey)} ${attribute} + ${escape(skill?.name ?? 'no skill')} ${skillValue} + modifier ${modifier} + action penalty ${action.penalty} + traits ${escape(traitSummary(automatic, null, null, escape))} = <strong>${total}</strong>${mode === 'dodge' ? ` vs attack ${attackTotal}` : ' vs 9'}</p><p><strong>${escape(result)}</strong></p>` });
            } }
        }, default: 'roll' }, { classes: ['dialog', 'afmbe-left-behind', game.settings.get('afmbe-left-behind', 'dark-mode') ? 'dark-mode' : ''] }).render(true);
    }

    async _onReloadWeapon(event) {
        event.preventDefault();
        const weapon = this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId);
        if (!weapon || !this.actor.isOwner) return;
        const feed = feedSystem(weapon);
        if (['internal', 'cylinder', 'single'].includes(feed)) {
            if (weapon.system.loadedMagazineId) return ui.notifications.warn('Remove the inserted magazine before switching to direct loading.');
            const ammo = compatibleLooseAmmo(this.actor, weapon);
            if (!ammo.length) return ui.notifications.warn('No compatible loose ammunition. Set the same caliber or projectile on the weapon and ammunition.');
            const esc = foundry.utils.escapeHTML;
            new Dialog({ title: `Load one round: ${weapon.name}`, content: `<form><label>Loose ammunition</label><select name="ammo">${ammo.map(item => `<option value="${esc(item.id)}">${esc(item.name)} — ${item.system.qty} (${esc(item.system.ammoType)})</option>`).join('')}</select></form>`,
                buttons: { cancel: { label: 'Cancel' }, load: { label: 'Load one (Help action)', callback: async html => {
                    const selected = this.actor.items.get(html[0].querySelector('[name="ammo"]').value);
                    try { await loadInternalRound(this.actor, weapon, selected); }
                    catch (error) { ui.notifications.warn(error.message); }
                } } }, default: 'load' }).render(true);
            return;
        }
        if (feed !== 'legacy' && feed !== 'detachable') return ui.notifications.warn('This weapon draws ammunition directly when attacking.');
        const spare = compatibleMagazines(this.actor, weapon);
        if (!spare.length) { ui.notifications.warn('No compatible spare magazines. Set matching caliber on the weapon and magazine.'); return; }
        const esc = foundry.utils.escapeHTML;
        new Dialog({ title: `Reload: ${weapon.name}`, content: `<form><label>Spare magazine</label><select name="magazine">${spare.map(item => `<option value="${esc(item.id)}">${esc(item.name)} — ${item.system.rounds}/${item.system.capacity} (${esc(damageType(item.system.ammoType))})</option>`).join('')}</select></form>`,
            buttons: { cancel: { label: 'Cancel' }, reload: { label: 'Reload (Help action)', callback: async html => {
                try { await reloadWeapon(this.actor, weapon, this.actor.items.get(html[0].querySelector('[name="magazine"]').value)); }
                catch (error) { console.error('AFMBE reload failed', error); ui.notifications.error(`Reload failed: ${error.message}`); }
            } } }, default: 'reload' }).render(true);
    }

    async _onUnloadWeapon(event) {
        event.preventDefault();
        const weapon = this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId);
        try { await unloadInternalRounds(this.actor, weapon); }
        catch (error) { ui.notifications.warn(error.message); }
    }

    async _onLoadMagazine(event) {
        event.preventDefault();
        const magazine = this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId);
        this._promptMagazineLoad(magazine)
    }

    _promptMagazineLoad(magazine, preferredAmmo = null) {
        if (!magazine || !this.actor.isOwner) return;
        if (inCombat(this.actor)) return ui.notifications.warn('Load loose rounds into magazines outside combat.');
        const esc = foundry.utils.escapeHTML;
        const remaining = Number(magazine.system.capacity) - Number(magazine.system.rounds);
        if (!Number.isSafeInteger(remaining) || remaining < 1) return ui.notifications.warn('This magazine is full or its capacity is not configured.');
        const caliber = normalizeCaliber(magazine.system.caliber);
        const ammo = this.actor.items.filter(item => item.type === 'ammunition' && Number(item.system.qty) > 0 &&
            caliber && normalizeCaliber(item.system.caliber) === caliber &&
            (!Number(magazine.system.rounds) || damageType(item.system.ammoType) === damageType(magazine.system.ammoType)) &&
            (!preferredAmmo || item.id === preferredAmmo.id));
        if (!ammo.length) return ui.notifications.warn('No compatible loose rounds. Check caliber and the ammunition already inside the magazine.');
        const initial = Math.min(remaining, Number(ammo[0].system.qty));
        new Dialog({ title: `Load: ${magazine.name}`, content: `<form><p>${Number(magazine.system.rounds)} / ${Number(magazine.system.capacity)} rounds. ${remaining} space left.</p><label>Loose ammunition</label><select name="ammo">${ammo.map(item => `<option value="${esc(item.id)}">${esc(item.name)} — ${item.system.qty} (${esc(item.system.caliber)}, ${esc(item.system.ammoType)})</option>`).join('')}</select><label>Rounds to load</label><input type="number" name="amount" min="1" max="${remaining}" step="1" value="${initial}"></form>`,
            render: html => html.find('[name="ammo"]').on('change', event => {
                const chosen = this.actor.items.get(event.currentTarget.value)
                const amount = html[0].querySelector('[name="amount"]')
                amount.max = String(Math.min(remaining, Number(chosen?.system.qty) || 0))
                amount.value = amount.max
            }),
            buttons: { cancel: { label: 'Cancel' }, load: { label: 'Load rounds', callback: async html => {
                const form = html[0].querySelector('form');
                try { await loadMagazine(this.actor, magazine, this.actor.items.get(form.elements.ammo.value), Number(form.elements.amount.value)); }
                catch (error) { console.error('AFMBE magazine loading failed', error); ui.notifications.error(`Loading failed: ${error.message}`); }
            } } }, default: 'load' }).render(true);
    }

    _promptMagazineUnload(magazine) {
        if (!magazine || !this.actor.isOwner) return
        if (inCombat(this.actor)) return ui.notifications.warn('Unload magazine rounds outside combat.')
        const rounds = Number(magazine.system.rounds)
        if (!Number.isSafeInteger(rounds) || rounds < 1) return ui.notifications.warn('This magazine is empty.')
        const amount = Math.min(rounds, 30)
        new Dialog({ title: `Unload: ${magazine.name}`,
            content: `<form><p>${rounds} round(s) in this magazine. Unload up to 30 per stack.</p><label>Rounds to unload</label><input type="number" name="amount" min="1" max="${amount}" step="1" value="${amount}"></form>`,
            buttons: { cancel: { label: 'Cancel' }, unload: { label: 'Unload rounds', callback: async html => {
                const chosen = Number(html[0].querySelector('[name="amount"]').value)
                try { await unloadMagazine(this.actor, magazine, chosen) }
                catch (error) { ui.notifications.warn(error.message) }
            } } }, default: 'unload' }).render(true)
    }

    async _onAttackRoll(event) {
        event.preventDefault()
        const weaponId = event.currentTarget.closest('.item')?.dataset.itemId
        const weapon = this.actor.items.get(weaponId)
        if (!weapon) return
        if (!weapon.system.equipped || storageLocation(weapon)) return ui.notifications.warn('Equip this weapon before attacking.')

        const attributes = this.actor.system.primaryAttributes ?? {}
        const skills = this.actor.items.filter(item => item.type === 'skill')
        const escape = value => foundry.utils.escapeHTML(String(value ?? ''))
        const isMelee = isMeleeAttack(weapon)
        const defaultMeleeAttribute = meleeAttribute(weapon)
        const saved = this.actor.getFlag('afmbe-left-behind', 'attackDefaults')?.[weapon.id] ?? {}
        const availableAttributes = Object.keys(attributes).filter(key => !isMelee || ['strength', 'dexterity'].includes(key))
        const defaultAttribute = availableAttributes.includes(saved.attribute) ? saved.attribute : isMelee ? defaultMeleeAttribute : 'dexterity'
        const defaultSkillId = skills.some(item => item.id === saved.skillId) ? saved.skillId : ''
        const combatSkills = skills.filter(item => skillCategory(item) === 'combat')
        const otherSkills = skills.filter(item => skillCategory(item) !== 'combat')
        const usingOtherSkill = Boolean(defaultSkillId && skillCategory(this.actor.items.get(defaultSkillId)) !== 'combat')
        const defaultLocation = ['body', 'arms', 'legs', 'head'].includes(saved.location) ? saved.location : 'body'
        const options = availableAttributes.map(key =>
            `<option value="${escape(key)}" ${key === defaultAttribute ? 'selected' : ''}>${escape(game.i18n.localize(`AFMBE.Attributes.Primary.${key[0].toUpperCase()}${key.slice(1)}`))}</option>`
        ).join('')
        const combatSkillOptions = combatSkills.map(item => `<option value="${escape(item.id)}" ${item.id === defaultSkillId ? 'selected' : ''}>${escape(item.name)} (${Number(item.system.level) || 0})</option>`).join('')
        const otherSkillOptions = Object.entries(SKILL_CATEGORIES).filter(([key]) => key !== 'combat').map(([key, label]) => {
            const options = otherSkills.filter(item => skillCategory(item) === key)
            return options.length ? `<optgroup label="${escape(label)}">${options.map(item =>
                `<option value="${escape(item.id)}" ${item.id === defaultSkillId ? 'selected' : ''}>${escape(item.name)} (${Number(item.system.level) || 0})</option>`).join('')}</optgroup>` : ''
        }).join('')
        const getSelectedSkill = form => this.actor.items.get(form.elements.skill.value === '__other'
            ? form.elements.otherSkill?.value : form.elements.skill.value)
        const traitOptions = type => this.actor.items.filter(item => item.type === type).map(item =>
            `<option value="${escape(item.id)}">${escape(item.name)} (${type === 'quality' ? '+' : '−'}${escape(item.system.bonus ?? 0)})</option>`).join('')
        const qualityOptions = traitOptions('quality')
        const drawbackOptions = traitOptions('drawback')
        const category = weaponCategory(weapon)
        const feed = feedSystem(weapon)
        const magazineMode = !isMelee && (feed === "detachable" || (feed === "legacy" && Boolean(weapon.system.usesMagazines)))
        const hasMagazine = !isMelee && feed !== "direct" && (magazineMode || ["internal", "cylinder", "single"].includes(feed) || Number(weapon.system.capacity?.max) > 0)
        const gunState = !isMelee ? gunPreview(this.actor, weapon) : null
        const modes = allowedFireModes(weapon)
        const defaultMode = modes.includes(saved.fireMode) ? saved.fireMode : modes[0]
        const modeOptions = modes.map(mode => `<option value="${mode}" ${mode === defaultMode ? 'selected' : ''}>${mode === 'semi' ? 'Semi-auto (1 round)' : mode === 'burst' ? `Burst (${fireMode(mode, weapon).rounds} rounds; −3)` : 'Automatic (10 rounds; −4)'}</option>`).join('') +
            (category === 'firearm' && modes.includes('automatic') ? '<option value="suppress">Suppressive fire (10 rounds; cone)</option>' : '')
        const offensivePreview = actionState(this.actor)
        const rangePreview = isMelee ? { penalty: 0, note: "Melee range: target must be adjacent." } : measureWeaponRange(this.actor, weapon)
        const attachmentPreview = attachmentModifiers(this.actor, weapon)
        const meleeState = isMelee ? meleePreview(this.actor, weapon) : null
        const rangeSummary = rangePreview.error || rangePreview.note ? escape(rangePreview.error || rangePreview.note) :
            `${escape(rangePreview.targetName)}: ${rangePreview.distance.toFixed(1)} m; normal range ${rangePreview.normalRange} m; penalty ${rangePreview.penalty} (${escape(rangePreview.sceneScale)})`
        const firstSkill = this.actor.items.get(defaultSkillId)
        const firstTraits = traitRollEffects(this.actor, { kind: 'attack', weaponName: weapon.name, attribute: defaultAttribute,
            skillName: firstSkill?.name, mode: category === 'firearm' ? defaultMode : 'semi' })
        const firstAttachment = attachmentModifiers(this.actor, weapon, { aimed: defaultAttribute === 'perception' })
        const locationLabel = { body: 'Body (0)', arms: 'Arm (-2)', legs: 'Leg (-2)', head: 'Head (-4)' }[defaultLocation]
        const firstSummary = `Target ${locationLabel} · traits ${firstTraits.total >= 0 ? '+' : ''}${firstTraits.total} · attachments ${firstAttachment.attack >= 0 ? '+' : ''}${firstAttachment.attack}${category === 'firearm' ? ` · mode ${fireMode(defaultMode, weapon).penalty}` : ''}`
        const content = `<form class="afmbe-attack-dialog">
            <div class="form-group"><label>Attribute</label><select name="attribute">${options}</select></div>
            <div class="form-group"><label>Combat skill</label><select name="skill">
                <option value="" ${defaultSkillId ? '' : 'selected'}>None</option>${combatSkillOptions}
                ${otherSkills.length ? `<option value="__other" ${usingOtherSkill ? 'selected' : ''}>Other skill…</option>` : ''}
            </select></div>
            ${otherSkills.length ? `<div class="form-group afmbe-other-skill" ${usingOtherSkill ? '' : 'style="display:none"'}><label>Other skill</label><select name="otherSkill">
                <option value="" ${usingOtherSkill ? '' : 'selected'}>Choose a skill</option>${otherSkillOptions}
            </select></div>` : ''}
            ${category === 'firearm' ? `<div class="form-group"><label>Firing mode</label><select name="fireMode">${modeOptions}</select></div>` : ''}
            ${isMelee ? '' : `<div class="form-group"><label>Target cover</label><select name="cover">
                <option value="auto">Auto (marked Regions)</option><option value="none">None</option><option value="partial">Partial (−1d4)</option><option value="full">Full (−1d8)</option>
            </select></div>`}
            <p class="afmbe-attack-summary" aria-live="polite">${escape(firstSummary)}</p>
            <details ${defaultLocation !== 'body' ? 'open' : ''}><summary>Adjust attack (target, traits, modifier)</summary>
                <div class="form-group"><label>Aimed location</label><select name="location">
                    <option value="body" ${defaultLocation === 'body' ? 'selected' : ''}>Body (0)</option>
                    <option value="arms" ${defaultLocation === 'arms' ? 'selected' : ''}>Arm (-2)</option>
                    <option value="legs" ${defaultLocation === 'legs' ? 'selected' : ''}>Leg (-2)</option>
                    <option value="head" ${defaultLocation === 'head' ? 'selected' : ''}>Head (-4)</option>
                </select></div>
                <div class="form-group"><label>Quality</label><select name="quality"><option value="">None</option>${qualityOptions}</select></div>
                <div class="form-group"><label>Drawback</label><select name="drawback"><option value="">None</option>${drawbackOptions}</select></div>
                <div class="form-group"><label>Other modifier</label><input type="number" name="modifier" value="0" step="1"></div>
            </details>
            <p>${isMelee ? 'Melee: target must be adjacent.' : `Range: ${rangeSummary}`}</p>
            ${isMelee ? `<p>Swings this action: ${meleeState.swings}/${meleeState.limit}; strain so far: ${meleeState.strain}. ${meleeState.nextAction ? `Next Offensive action requires a Constitution + skill task; Endurance ${meleeState.endurance} per swing.` : 'This action has room for another swing.'}</p>` : ''}
            <p>Offensive action: ${offensivePreview ? `used ${offensivePreview.counts.offensive}; repeat penalty ${-2 * offensivePreview.counts.offensive}` : 'outside combat (no repeat penalty)'}. Rechecked when rolled.</p>
            ${!isMelee ? `<p>${category === 'firearm' ? 'Trigger pull: firing mode controls rounds spent' : 'One projectile per attack'}. Shot ${gunState.shot} this turn; ${gunState.shotsInAction}/${gunState.rateOfFire} shots in current Offensive action; next recoil ${gunState.recoilPenalty}; action penalty ${gunState.actionPenalty}.</p>` : ''}
            ${hasMagazine ? `<p>Magazine: ${Number(weapon.system.capacity.value) || 0} / ${Number(weapon.system.capacity.max) || 0}</p>` : ''}
            ${attachmentPreview.items.length ? `<p>Attachments: ${attachmentPreview.items.map(item => escape(item.name)).join(', ')}; attack ${attachmentPreview.attack >= 0 ? '+' : ''}${attachmentPreview.attack} (optics apply on Perception attacks), recoil reduction ${attachmentPreview.recoil}, range +${attachmentPreview.range} m.</p>` : ''}
        </form>`
        new Dialog({
            title: `Attack: ${weapon.name}`,
            content,
            render: html => {
                const form = html[0].querySelector('form.afmbe-attack-dialog')
                if (!form) return
                const refresh = () => {
                    const otherField = form.querySelector('.afmbe-other-skill')
                    if (otherField) otherField.style.display = form.elements.skill.value === '__other' ? '' : 'none'
                    const key = form.elements.attribute.value
                    const skill = getSelectedSkill(form)
                    const mode = category === 'firearm' ? form.elements.fireMode.value : 'semi'
                    const auto = traitRollEffects(this.actor, { kind: 'attack', weaponName: weapon.name, attribute: key,
                        skillName: skill?.name, mode })
                    const quality = this.actor.items.get(form.elements.quality.value)
                    const drawback = this.actor.items.get(form.elements.drawback.value)
                    const attachments = attachmentModifiers(this.actor, weapon, { aimed: key === 'perception' })
                    const manual = manualTraitValue(quality, auto) + manualTraitValue(drawback, auto)
                    const location = form.elements.location.selectedOptions[0]?.textContent ?? 'Body (0)'
                    const other = Number(form.elements.modifier.value) || 0
                    const parts = [`Target ${location}`, `traits ${auto.total + manual >= 0 ? '+' : ''}${auto.total + manual}`,
                        `attachments ${attachments.attack >= 0 ? '+' : ''}${attachments.attack}`]
                    if (category === 'firearm') parts.push(mode === 'suppress' ? 'suppressive cone (10 rounds)' : `mode ${fireMode(mode, weapon).penalty}`)
                    if (!isMelee) {
                        const choice = form.elements.cover.value
                        const detected = choice === 'auto' && game.user.targets.size === 1 ? coverForAttack(this.actor, [...game.user.targets][0]) : null
                        parts.push(`cover ${choice === 'auto' ? `auto: ${detected?.level ?? 'none'}` : choice === 'partial' ? '−1d4' : choice === 'full' ? '−1d8' : 'none'}`)
                    }
                    if (other) parts.push(`other ${other > 0 ? '+' : ''}${other}`)
                    form.querySelector('.afmbe-attack-summary').textContent = parts.join(' · ')
                }
                form.addEventListener('change', refresh)
                form.addEventListener('input', refresh)
                refresh()
            },
            buttons: {
                cancel: { label: 'Cancel' },
                attack: { label: 'Roll attack', callback: async html => {
                    const form = html[0].querySelector('form')
                    const attributeKey = form.elements.attribute.value
                    const attribute = (Number(attributes[attributeKey]?.value) || 0) + attributeBonus(this.actor, attributeKey)
                    const skill = getSelectedSkill(form)
                    const skillLevel = (Number(skill?.system.level) || 0) + skillBonus(this.actor, skill)
                    const quality = this.actor.items.get(form.elements.quality.value)
                    const drawback = this.actor.items.get(form.elements.drawback.value)
                    if ((quality && quality.type !== 'quality') || (drawback && drawback.type !== 'drawback')) { ui.notifications.warn('Choose a valid Quality and Drawback.'); return }
                    if (form.elements.fireMode?.value === 'suppress') {
                        try { beginSuppressiveCone(this.actor, weapon, skill, attributeKey); }
                        catch (error) { ui.notifications.warn(error.message); }
                        return;
                    }
                    // Trait context is evaluated below after the firing mode and skill are known.
                    const hitLocation = form.elements.location.value
                    const location = hitLocation === 'head' ? -4 : ['arms', 'legs'].includes(hitLocation) ? -2 : 0
                    const modifier = Number(form.elements.modifier.value) || 0
                    const coverChoice = isMelee ? 'none' : form.elements.cover.value
                    if (!['auto', 'none', 'partial', 'full'].includes(coverChoice)) { ui.notifications.warn('Choose valid target cover.'); return }
                    const range = isMelee ? { penalty: 0, note: 'Melee' } : measureWeaponRange(this.actor, weapon)
                    if (range.error) { ui.notifications.warn(range.error); return }
                    const targetedTokens = [...game.user.targets]
                    if (targetedTokens.length !== 1 || !targetedTokens[0].actor) {
                        ui.notifications.warn('Target exactly one token before attacking.'); return
                    }
                    const target = targetedTokens[0].actor
                    const detectedCover = coverChoice === 'auto' ? coverForAttack(this.actor, targetedTokens[0]) : null
                    if (detectedCover?.note) { ui.notifications.warn(`${detectedCover.note} Select cover manually for this shot.`); return }
                    const cover = detectedCover?.level ?? coverChoice
                    if (isMelee) {
                        const attackerTokens = canvas?.tokens?.placeables?.filter(token => token.actor?.uuid === this.actor.uuid) ?? []
                        const source = attackerTokens.find(token => token.controlled) ?? (attackerTokens.length === 1 ? attackerTokens[0] : null)
                        const targetToken = targetedTokens[0]
                        const size = Number(canvas?.grid?.size), distance = Number(canvas?.scene?.grid?.distance)
                        if (!source || !size || !distance || !canvas?.scene?.grid || !['m', 'meter', 'meters'].includes(String(canvas.scene.grid.units).toLowerCase())) { ui.notifications.warn('Select your token on a scene measured in meters for melee.'); return }
                        const meters = Math.hypot(source.center.x - targetToken.center.x, source.center.y - targetToken.center.y) / size * distance
                        if (meters > distance * 1.5) { ui.notifications.warn('Melee target is out of reach (more than one adjacent grid space).'); return }
                    }
                    const activeMagazine = magazineMode ? loadedMagazine(this.actor, weapon) : null
                    if (!isMelee && weapon.system.loadedMagazineId && feed !== "detachable" && feed !== "legacy") { ui.notifications.warn("Remove the inserted magazine before switching feed systems."); return }
                    const looseProjectile = feed === "direct" ? compatibleLooseAmmo(this.actor, weapon)[0] : null
                    if (feed === "direct" && !looseProjectile) { ui.notifications.warn("No compatible arrows in loose ammunition."); return }
                    if (feed === "single" && category === "crossbow" && Number(weapon.system.capacity?.max) > 1) { ui.notifications.warn("Crossbow capacity must be 1. Set it on the weapon sheet."); return }
                    const selectedMode = category === 'firearm' ? form.elements.fireMode?.value : 'semi'
                    if (category === 'firearm' && !allowedFireModes(weapon).includes(selectedMode)) { ui.notifications.warn('That firing mode is unavailable for this weapon.'); return }
                    const firing = fireMode(selectedMode, weapon)
                    const automatic = traitRollEffects(this.actor, { kind: 'attack', weaponName: weapon.name, attribute: attributeKey,
                        skillName: skill?.name, mode: firing.mode })
                    // Perception is the rulebook's aimed-fire attribute; optics only add attack accuracy then.
                    const attachments = attachmentModifiers(this.actor, weapon, { aimed: attributeKey === 'perception' })
                    const qualityBonus = manualTraitValue(quality, automatic)
                    const drawbackBonus = manualTraitValue(drawback, automatic)
                    if (firing.mode !== 'semi' && ['single', 'cylinder'].includes(feed) && Number(weapon.system.capacity?.max) < firing.rounds) { ui.notifications.warn('This weapon cannot hold enough rounds for that firing mode.'); return }
                    const shots = hasMagazine ? firing.rounds : 0
                    const remaining = magazineMode && !isMelee ? Number(activeMagazine?.system.rounds) : Number(weapon.system.capacity?.value)
                    if (!isMelee && magazineMode && (!activeMagazine || !Number.isSafeInteger(remaining) || remaining < firing.rounds)) { ui.notifications.warn(`${weapon.name} has no loaded rounds. Reload a magazine.`); return }
                    const rawWeaponDamageType = damageType(weapon.system.damage_type)
                    const projectileDamageType = ['bow', 'crossbow'].includes(category) && ['twoHanded', 'slashing', 'stabbing'].includes(rawWeaponDamageType) ? 'none' : rawWeaponDamageType
                    const firedDamageType = isMelee ? (['twoHanded', 'slashing', 'stabbing'].includes(damageType(weapon.system.damage_type)) ? damageType(weapon.system.damage_type) : 'twoHanded') : magazineMode ? damageType(activeMagazine.system.ammoType) : category === "crossbow" ? projectileDamageType : ["internal", "cylinder", "single"].includes(feed) ? damageType(weapon.system.loadedAmmoType || weapon.system.damage_type) : projectileDamageType
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
                    if (feed === 'direct') {
                        await looseProjectile.update({ 'system.qty': Number(looseProjectile.system.qty) - 1 })
                    } else if (!isMelee && magazineMode) {
                        await activeMagazine.update({ 'system.rounds': remaining - firing.rounds })
                        await weapon.update({ 'system.capacity.value': remaining - firing.rounds })
                    } else if (hasMagazine) await weapon.update({ 'system.capacity.value': remaining - shots })
                    const roll = await new Roll('1d10').evaluate()
                    const natural = Number(roll.total)
                    const criticalHit = natural === 10
                    const criticalMiss = natural === 1
                    const coverRoll = cover === 'none' ? null : await new Roll(cover === 'partial' ? '1d4' : '1d8').evaluate()
                    const coverPenalty = -(coverRoll?.total ?? 0)
                    const ammoHitBonus = isMelee ? 1 : hitBonus(firedDamageType)
                    const total = roll.total + attribute + skillLevel + location + modifier + automatic.total + qualityBonus + drawbackBonus + ammoHitBonus + range.penalty + action.penalty + firing.penalty + attachments.attack + (meleeStrike?.strainPenalty ?? gunShot?.recoilPenalty ?? 0) + coverPenalty
                    const success = !criticalMiss && (criticalHit || total >= 9)
                    const effectiveTotal = criticalHit ? Math.max(9, total) : total
                    const degrees = success ? Math.floor((effectiveTotal - 9) / 2) + 1 : 0
                    const hits = success ? volleyHits(firing.mode, effectiveTotal, firing.rounds) : 0
                    const locationName = form.elements.location.selectedOptions[0].textContent
                    const ammoNote = feed === 'direct' ? `<p>1 ${escape(looseProjectile.name)} used; ${looseProjectile.system.qty} remain.</p>` : hasMagazine ? `<p>${firing.rounds} ${escape(firedDamageType)} round(s) fired; ${weapon.system.capacity.value}/${weapon.system.capacity.max} remaining.</p>` : ''
                    const rangeDetail = isMelee ? `melee swing ${meleeStrike.swing}/${meleePreview(this.actor, weapon).limit}; strain ${meleeStrike.strainPenalty}; Endurance spent ${meleeStrike.enduranceSpent}` : `shot ${gunShot.shot} this turn (${gunShot.shotsInAction}/${gunShot.rateOfFire} this action), recoil ${gunShot.recoilPenalty}; ` + (range.note ? 'range unconfigured (0)' : `range ${range.penalty} (${range.distance.toFixed(1)} m / ${range.normalRange} m)` )
                    const coverDetail = coverRoll ? `${cover} cover${detectedCover?.region ? ` (Region ${escape(detectedCover.region.name ?? detectedCover.region.id)})` : ''} −1d${cover === 'partial' ? 4 : 8} (${coverPenalty})` : coverChoice === 'auto' ? 'auto cover: none' : 'cover: none'
                    const criticalNote = criticalHit ? 'Natural 10: guaranteed hit; penetrating damage doubled.' : criticalMiss ? 'Natural 1: automatic miss.' : ''
                    const content = `<h2>${escape(weapon.name)}</h2><div class="afmbe-roll-kind">Attack</div><p>${escape(attributeKey)} ${attribute}, ${escape(skill?.name ?? 'No skill')} ${skillLevel}, ${escape(locationName)}, modifier ${modifier}, traits ${traitSummary(automatic, quality, drawback, escape)}, ${isMelee ? 'melee' : 'ammo'} ${ammoHitBonus >= 0 ? "+" : ""}${ammoHitBonus}, attachments ${attachments.attack >= 0 ? '+' : ''}${attachments.attack}${attachments.items.length ? ` (${attachments.items.map(item => escape(item.name)).join(', ')})` : ''}, ${rangeDetail}, mode ${firing.mode} ${firing.penalty}, action ${action.penalty}, ${coverDetail}</p><p>Roll ${roll.total} + modifiers = <strong>${total}</strong> vs 9 — <strong>${success ? `Hit (${degrees} degree${degrees === 1 ? '' : 's'}; ${hits} of ${firing.rounds} rounds hit)` : 'Miss'}</strong>${criticalNote ? ` — ${criticalNote}` : ''}</p>${ammoNote}`
                    await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor: this.actor }),
                        content: content + `<p>${success ? `Awaiting ${escape(target.name)}’s defense.` : 'Attack misses; no damage roll.'}</p>`, rolls: coverRoll ? [roll, coverRoll] : [roll],
                        flags: { 'afmbe-left-behind': { pendingAttack: {
                            attackerUuid: this.actor.uuid, targetUuid: target.uuid, targetName: target.name,
                            weaponUuid: weapon.uuid, weaponName: weapon.name, damageType: firedDamageType, total, location: hitLocation,
                            melee: isMelee, roundsFired: firing.rounds, hits, firingMode: firing.mode, criticalHit, status: success ? 'pending' : 'miss', blocked: false
                        } } } })
                    if (feed === 'direct' && Number(looseProjectile.system.qty) === 0)
                        await this.actor.deleteEmbeddedDocuments('Item', [looseProjectile.id])
                    if (feed === 'direct' && Number(looseProjectile.system.qty) === 0)
                        await this.actor.deleteEmbeddedDocuments('Item', [looseProjectile.id])
                    try {
                        const previous = this.actor.getFlag('afmbe-left-behind', 'attackDefaults') ?? {}
                        await this.actor.setFlag('afmbe-left-behind', 'attackDefaults', { ...previous,
                            [weapon.id]: { attribute: attributeKey, skillId: skill?.id ?? '', fireMode: firing.mode, location: hitLocation } })
                    } catch (error) { console.warn('AFMBE could not save weapon attack defaults', error) }
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

        if (!equippedItem || armorIntegrity(equippedItem).value <= 0) return ui.notifications.warn('This armor is depleted and provides no protection.');

        let roll = await new Roll(equippedItem.system.armor_value).evaluate()

        await postArmorRoll(this.actor, equippedItem, roll, equippedItem.system.armor_value)
    }

    async _setInventoryEquipped(item, equipped) {
        if (!item?.isOwner || !['weapon', 'armor', 'item', 'backpack', 'rig'].includes(item.type))
            throw new Error('This item cannot be equipped.')
        if (Boolean(item.system.equipped) === equipped && (!equipped || !storageLocation(item))) return
        if (equipped && item.type === 'weapon' && this.actor.items.filter(entry => entry.type === 'weapon' && entry.system.equipped && entry.id !== item.id).length >= 2)
            throw new Error('Only two weapons can be equipped. Unequip one first.')
        if (equipped && ['backpack', 'rig'].includes(item.type) && this.actor.items.filter(entry => entry.type === item.type && entry.system.equipped && entry.id !== item.id).length)
            throw new Error(`Only one ${item.type} can be worn at a time.`)
        if (equipped && storageLocation(item) === STASH) throw new Error('Retrieve this item from your off-character stash first.')
        if (!equipped && item.system.equipped && ['weapon', 'armor', 'item'].includes(item.type) && handCount(this.actor) >= HAND_LIMIT)
            throw new Error('Both hands are occupied. Pack or stash something before unequipping this item.')
        const fromBackpack = equipped && this.actor.items.get(storageLocation(item))?.type === 'backpack'
        if (equipped && storageLocation(item) && !fromBackpack) await unpackItem(this.actor, item)
        if (inCombat(this.actor) && ['weapon', 'backpack', 'rig'].includes(item.type)) await spendAction(this.actor, 'help')
        else if (inCombat(this.actor) && fromBackpack) await spendAction(this.actor, 'help')
        await item.update({ 'system.equipped': equipped,
            ...(fromBackpack ? { 'system.storage.containerId': '', 'system.storage.x': 0, 'system.storage.y': 0 } : {}) })
    }

    _inventoryDropPosition(grid, item, pointer, rotated) {
        const firstCell = grid.querySelector('.inventory-grid-cell')
        if (!firstCell) return null
        const rect = grid.getBoundingClientRect()
        const cellWidth = firstCell.getBoundingClientRect().width
        const cellHeight = firstCell.getBoundingClientRect().height
        if (!cellWidth || !cellHeight) return null
        const grabbed = this._gridDrag?.id === item.id ? this._gridDrag : { x: 0, y: 0 }
        const turned = grabbed.fromGrid && grabbed.rotated !== rotated
        const originalSize = dimensions(item, grabbed.rotated)
        const grabX = turned ? grabbed.y : grabbed.x
        const grabY = turned ? originalSize.width - 1 - grabbed.x : grabbed.y
        const x = Math.floor((pointer.clientX - rect.left) / cellWidth) - grabX
        const y = Math.floor((pointer.clientY - rect.top) / cellHeight) - grabY
        const cell = nearestFreeCell(this.actor, item, grid.dataset.containerId, x, y, rotated)
        const size = dimensions(item, rotated)
        const maxX = Math.max(0, Number(grid.dataset.width) - size.width)
        const maxY = Math.max(0, grid.querySelectorAll('.inventory-grid-cell').length / Number(grid.dataset.width) - size.height)
        return { cell, x: cell?.x ?? Math.max(0, Math.min(maxX, x)),
            y: cell?.y ?? Math.max(0, Math.min(maxY, y)), cellWidth, cellHeight }
    }

    async _rotateInventoryItem(item) {
        if (!item?.isOwner) throw new Error('Item is unavailable.')
        const rotated = !Boolean(item.system.storage?.rotated)
        const location = storageLocation(item)
        if (!location) return item.update({ 'system.storage.rotated': rotated })
        const cell = nearestFreeCell(this.actor, item, location,
            Number(item.system.storage?.x) || 0, Number(item.system.storage?.y) || 0, rotated, 3)
        if (!cell) throw new Error('No space to rotate this item here. Move it to another container first.')
        await moveInventoryItem(this.actor, item, location, cell.x, cell.y, rotated)
    }

    async _onToggleEquipped(event) {
        event.preventDefault()
        const item = this.actor.items.get(event.currentTarget.closest('.item')?.dataset.itemId)
        try { await this._setInventoryEquipped(item, !item?.system.equipped) }
        catch (error) { ui.notifications.warn(error.message) }
    }

    async _deleteInventoryItem(item, { confirm = false } = {}) {
        if (!item?.isOwner || item.parent?.uuid !== this.actor.uuid) throw new Error('Item is unavailable.')
        const checkContainer = () => {
            if (['backpack', 'rig'].includes(item.type) &&
                this.actor.items.filter(entry => storageLocation(entry) === item.id).length)
                throw new Error('Empty this container before deleting it.')
        }
        checkContainer()
        if (confirm) {
            const approved = await Dialog.confirm({
                title: 'Delete item',
                content: `<p>Delete <strong>${foundry.utils.escapeHTML(item.name)}</strong> from ${foundry.utils.escapeHTML(this.actor.name)}? This cannot be undone.</p>`
            })
            if (!approved) return
        }
        if (!this.actor.items.get(item.id)) throw new Error('Item is no longer on this character.')
        checkContainer()
        await this.actor.deleteEmbeddedDocuments('Item', [item.id])
        if (this._selectedInventoryItemId === item.id) this._selectedInventoryItemId = null
    }

    _showInventoryMenu(item, pointer) {
        this._inventoryMenuAbort?.abort()
        this._inventoryMenu?.remove()
        const menu = document.createElement('div')
        menu.className = 'afmbe-inventory-menu'
        menu.setAttribute('role', 'menu')
        const header = document.createElement('div')
        header.className = 'afmbe-inventory-menu-header'
        const portrait = document.createElement('img')
        portrait.className = 'afmbe-item-portrait'
        portrait.src = item.img || 'icons/svg/item-bag.svg'
        portrait.alt = ''
        portrait.addEventListener('error', () => { portrait.hidden = true })
        const name = document.createElement('strong')
        name.textContent = item.name
        header.append(portrait, name)
        menu.append(header)
        const actions = []
        const add = (label, run, danger = false) => actions.push({ label, run, danger })
        if (['weapon', 'armor', 'item', 'backpack', 'rig'].includes(item.type))
            add(item.system.equipped ? 'Unequip' : 'Equip', () => this._setInventoryEquipped(item, !item.system.equipped))
        if (item.type === 'consumable') add('Use', () => useConsumable(item))
        if (item.type === 'magazine') add('Load ammunition', () => this._promptMagazineLoad(item))
        if (item.type === 'magazine' && Number(item.system.rounds) > 0)
            add('Unload ammunition', () => this._promptMagazineUnload(item))
        if (item.type === 'weapon' && item.system.loadedMagazineId && item.system.equipped)
            add('Remove magazine (1 Help)', () => removeMagazine(this.actor, item))
        if (item.type === 'attachment' && item.system.installedWeaponId)
            add('Detach from weapon', () => removeAttachment(this.actor, item))
        if (dimensions(item).width !== dimensions(item).height)
            add('Rotate 90°', () => this._rotateInventoryItem(item))
        if (storageLocation(item) && !(storageLocation(item) === STASH && inCombat(this.actor)))
            add(`${storageLocation(item) === STASH ? 'Take from stash' : 'Take out'}${inventoryActionCost(this.actor, item) ? ' (1 Help)' : ''}`, () => unpackItem(this.actor, item))
        if (storageLocation(item) !== STASH && !inCombat(this.actor) && !item.system.equipped && !item.system.insertedInWeaponId && !item.system.installedWeaponId)
            add('Move to off-character stash', () => stashItem(this.actor, item))
        for (const container of containers(this.actor)) {
            if (storageLocation(item) === STASH && inCombat(this.actor)) continue
            if (container.type && !container.equipped) continue
            add(`Put in ${container.label}${inventoryActionCost(this.actor, item, container.id) ? ' (1 Help)' : ''}`, async () => {
                const cell = firstFreeCell(this.actor, item, container.id)
                if (!cell) throw new Error(`No available space in ${container.label}.`)
                await moveInventoryItem(this.actor, item, container.id, cell.x, cell.y)
            })
        }
        if (['ammunition', 'consumable', 'item'].includes(item.type) && Number(item.system.qty) > 1)
            add('Split stack', () => splitInventoryStack(this.actor, item))
        add('Open item sheet', () => item.sheet.render(true))
        add('Delete item…', () => this._deleteInventoryItem(item, { confirm: true }), true)
        const abort = new AbortController()
        this._inventoryMenuAbort = abort
        this._inventoryMenu = menu
        const close = () => { menu.remove(); abort.abort(); if (this._inventoryMenu === menu) this._inventoryMenu = null }
        for (const action of actions) {
            const button = document.createElement('button')
            button.type = 'button'; button.textContent = action.label
            if (action.danger) button.classList.add('afmbe-inventory-menu-danger')
            button.addEventListener('click', async event => {
                event.preventDefault(); event.stopPropagation(); close()
                try { await action.run() } catch (error) { ui.notifications.warn(error.message) }
            })
            menu.append(button)
        }
        document.body.append(menu)
        menu.style.left = `${Math.min(pointer.clientX, window.innerWidth - menu.offsetWidth - 8)}px`
        menu.style.top = `${Math.min(pointer.clientY, window.innerHeight - menu.offsetHeight - 8)}px`
        setTimeout(() => {
            if (abort.signal.aborted) return
            document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) close() }, { signal: abort.signal })
            document.addEventListener('keydown', event => { if (event.key === 'Escape') close() }, { signal: abort.signal })
        }, 0)
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
