import { damageType } from './damage-types.js';
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
        data.ammoDamageTypes = {"bullets": "Normal Bullet", "hollowPoint": "Hollow Point", "armorPiercing": "Armor Piercing", "slug": "Slug", "buckshot": "Buckshot", "birdshot": "Birdshot", "shotgun": "Shotgun", "explosive": "Explosive", "poison": "Poison", "corrosive": "Corrosive"};
        data.skillOptions = Object.fromEntries((this.item.parent?.items ?? []).filter(item => item.type === "skill").map(item => [item.name, item.name]));
        data.selectedSkillName = this.item.system.skillName || this.item.parent?.items.get(this.item.system.skillId)?.name || "";
        data.isGM = game.user.isGM;
        data.editable = data.options.editable;
        const itemData = data.system;
        data.data = itemData;
        return data;
    }

    /** @override */
    activateListeners(html) {
        super.activateListeners(html);
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
