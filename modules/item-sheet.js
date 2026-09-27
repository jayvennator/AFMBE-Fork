import { damageType } from './damage-types.js';
import { CALIBERS, caliberSelection } from './calibers.js';
import { weaponCategory, feedSystem } from './weapon-feed.js';
import { SKILL_CATEGORIES, skillCategory } from './skill-categories.js';
export class afmbeItemSheet extends foundry.appv1.sheets.ItemSheet {

    /** @override */
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["afmbe-left-behind", "sheet", "item", `${game.settings.get("afmbe-left-behind", "dark-mode") ? "dark-mode" : ""}`],
            width: 600,
            height: 450,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body-items", initial: "description" }]
        })
    }

    /* -------------------------------------------- */


    /** @override */
    get template() {
        const path = "systems/afmbe-left-behind/templates";
        return `${path}/${this.item.type}-sheet.hbs`;
    }

    getData() {
        const data = super.getData();
        data.dtypes = ["String", "Number", "Boolean"];
        data.attributeOptions = Object.fromEntries(["strength", "dexterity", "constitution", "intelligence", "perception", "willpower"].map(key => [key, key[0].toUpperCase() + key.slice(1)]));
        data.hasActor = this.item.parent instanceof Actor;
        data.normalizedDamageType = damageType(this.item.system.damage_type);
        data.caliberOptions = CALIBERS;
        data.attackModeOptions = { auto: 'Auto (legacy)', melee: 'Melee', ranged: 'Ranged' };
        data.weaponCategoryOptions = { auto: 'Auto (existing weapon)', melee: 'Melee', firearm: 'Firearm', bow: 'Bow', crossbow: 'Crossbow', launcher: 'Launcher' };
        data.feedSystemOptions = { auto: 'Auto (existing capacity/magazine)', detachable: 'Detachable magazine', internal: 'Internal magazine / tube', cylinder: 'Revolver cylinder', single: 'Single shot / crossbow' };
        data.allowedFireModes = this.item.system.allowedFireModes ?? {semi: true, burst: true, automatic: true};
        data.showMeleeFields = weaponCategory(this.item) === 'melee';
        data.showRangedFields = weaponCategory(this.item) !== 'melee';
        data.showGunFields = ['firearm', 'launcher'].includes(weaponCategory(this.item));
        data.showFeedFields = data.showGunFields || weaponCategory(this.item) === 'crossbow';
        data.showCapacityFields = data.showRangedFields && weaponCategory(this.item) !== 'bow';
        data.effectiveFeed = feedSystem(this.item);
        data.meleeAttributeOptions = { '': 'Auto (legacy)', strength: 'Strength', dexterity: 'Dexterity' };
        data.selectedCaliber = caliberSelection(this.item.type === "weapon" ? this.item.system.ammo_type : this.item.system.caliber);
        data.ammoDamageTypes = {"none": "Standard projectile", "bullets": "Normal Bullet", "hollowPoint": "Hollow Point", "armorPiercing": "Armor Piercing", "slug": "Slug", "buckshot": "Buckshot", "birdshot": "Birdshot", "shotgun": "Shotgun", "explosive": "Explosive", "poison": "Poison", "corrosive": "Corrosive"};
        data.attachmentSlotOptions = { optic: 'Optic', muzzle: 'Muzzle', underbarrel: 'Underbarrel', stock: 'Stock', accessory: 'Accessory' };
        data.attachmentCategoryOptions = { firearm: 'Firearm', launcher: 'Launcher', bow: 'Bow', crossbow: 'Crossbow', melee: 'Melee', any: 'Any weapon' };
        data.skillOptions = Object.fromEntries((this.item.parent?.items ?? []).filter(item => item.type === "skill").map(item => [item.name, item.name]));
        data.selectedSkillName = this.item.system.skillName || this.item.parent?.items.get(this.item.system.skillId)?.name || "";
        data.skillCategoryOptions = { auto: 'Auto (from skill name)', ...SKILL_CATEGORIES };
        data.effectiveSkillCategory = SKILL_CATEGORIES[skillCategory(this.item)];
        data.isGM = game.user.isGM;
        data.editable = data.options.editable;
        const itemData = data.system;
        data.data = itemData;
        return data;
    }

    /** @override */
    activateListeners(html) {
        super.activateListeners(html);
        html.find('[name="system.weaponCategory"], [name="system.feedSystem"]').change(() => {
            // Foundry saves the selection normally; preview the relevant rows immediately.
            const category = html.find('[name="system.weaponCategory"]').val();
            const effective = category === 'auto' ? weaponCategory(this.item) : category;
            html.find('.melee-weapon-field').toggle(effective === 'melee');
            html.find('.ranged-weapon-field').toggle(effective !== 'melee');
            html.find('.gun-weapon-field').toggle(['firearm','launcher'].includes(effective));
            html.find('.feed-weapon-field').toggle(['firearm','launcher','crossbow'].includes(effective));
            html.find('.capacity-weapon-field').toggle(effective !== 'melee' && effective !== 'bow');
        });
        html.find('.caliber-presets').change(event => {
            const field = event.currentTarget.closest('td')?.querySelector('.caliber-value');
            if (field && event.currentTarget.value) { field.value = event.currentTarget.value; field.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        html.find('.convert-to-armor').click(async event => {
            event.preventDefault();
            const actor = this.item.parent;
            if (!actor?.isOwner || this.item.type !== 'item') return;
            const converted = this.item.toObject();
            delete converted._id;
            converted.type = 'armor';
            try {
                // Create the replacement before removing the original item.
                const [armor] = await actor.createEmbeddedDocuments('Item', [converted]);
                await actor.deleteEmbeddedDocuments('Item', [this.item.id]);
                await this.close();
                armor.sheet.render(true);
            } catch (error) {
                console.error('AFMBE armor conversion failed', error);
                ui.notifications.error('Could not convert the item. Check the actor inventory before retrying.');
            }
        });
    }

    /* -------------------------------------------- */

    /** @override */
    setPosition(options = {}) {
        const position = super.setPosition(options);
        const sheetBody = this.element.find(".sheet-body");
        const bodyHeight = position.height - 192;
        sheetBody.css("height", bodyHeight);
        return position;
    }

    /**
   * Handle clickables
   * @param {Event} event   The originating click event
   * @private
   */



}
