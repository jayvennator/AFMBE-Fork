/** Register Handlebars template partials */
export function registerTemplates() {
    const templatePaths = [
        //Sheet Components
        "systems/afmbe-left-behind/templates/components/primary-attributes.hbs",
        "systems/afmbe-left-behind/templates/components/secondary-attributes.hbs",
        "systems/afmbe-left-behind/templates/components/aspects.hbs",
        "systems/afmbe-left-behind/templates/components/biography.hbs",
        "systems/afmbe-left-behind/templates/components/drawbacks.hbs",
        "systems/afmbe-left-behind/templates/components/equipment-header.hbs",
        "systems/afmbe-left-behind/templates/components/items.hbs",
        "systems/afmbe-left-behind/templates/components/consumables.hbs",
        "systems/afmbe-left-behind/templates/components/action-economy.hbs",
        "systems/afmbe-left-behind/templates/components/item-description-sidebar.hbs",
        "systems/afmbe-left-behind/templates/components/polaroid.hbs",
        "systems/afmbe-left-behind/templates/components/powers.hbs",
        "systems/afmbe-left-behind/templates/components/skills.hbs",
        "systems/afmbe-left-behind/templates/components/weapons.hbs",
        "systems/afmbe-left-behind/templates/components/weapon-row.hbs",
        "systems/afmbe-left-behind/templates/components/ammunition.hbs",
        "systems/afmbe-left-behind/templates/components/armor.hbs",
        "systems/afmbe-left-behind/templates/components/attachments.hbs",
        "systems/afmbe-left-behind/templates/components/inventory-grids.hbs",
        "systems/afmbe-left-behind/templates/components/grid-fields.hbs",
        "systems/afmbe-left-behind/templates/components/ready-gear.hbs",
        "systems/afmbe-left-behind/templates/components/qualities.hbs",
        "systems/afmbe-left-behind/templates/components/item-attribute-sidebar.hbs",
        "systems/afmbe-left-behind/templates/components/item-sheet-header.hbs",
        "systems/afmbe-left-behind/templates/components/vehicle-attributes.hbs",
        "systems/afmbe-left-behind/templates/components/character-details.hbs"
    ];

    foundry.applications.handlebars.loadTemplates(templatePaths);
}
