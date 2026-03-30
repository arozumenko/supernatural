import type { ItemDefinition } from '../shared/src/index.ts';

export const ITEM_DEFS: Record<string, ItemDefinition> = {
  // ─── Raw Materials (stackable) ───

  wood: {
    id: 'wood', name: 'Wood', category: 'material',
    weight: 2.0, stackable: true, maxStack: 99,
  },
  stone: {
    id: 'stone', name: 'Stone', category: 'material',
    weight: 3.0, stackable: true, maxStack: 99,
  },
  iron_ore: {
    id: 'iron_ore', name: 'Iron Ore', category: 'material',
    weight: 4.0, stackable: true, maxStack: 99,
  },
  iron_ingot: {
    id: 'iron_ingot', name: 'Iron Ingot', category: 'material',
    weight: 3.0, stackable: true, maxStack: 99,
  },
  treeSeed: {
    id: 'treeSeed', name: 'Tree Seed', category: 'material',
    weight: 0.2, stackable: true, maxStack: 99,
  },
  plantSeed: {
    id: 'plantSeed', name: 'Plant Seed', category: 'material',
    weight: 0.1, stackable: true, maxStack: 99,
  },

  // ─── Body Materials (stackable) ───

  meat: {
    id: 'meat', name: 'Raw Meat', category: 'food',
    weight: 1.5, stackable: true, maxStack: 99,
    nutrition: { protein: 10, plant: 0 },
    spoilsAfter: 300,
  },
  rotten_meat: {
    id: 'rotten_meat', name: 'Rotten Meat', category: 'food',
    weight: 1.5, stackable: true, maxStack: 99,
    nutrition: { protein: 2, plant: 0 },
    // Eating rotten meat: minor protein, but harmful (handled in eating code)
  },
  bone: {
    id: 'bone', name: 'Bone', category: 'material',
    weight: 2.0, stackable: true, maxStack: 99,
  },
  hide: {
    id: 'hide', name: 'Hide', category: 'material',
    weight: 2.0, stackable: true, maxStack: 99,
  },
  sinew: {
    id: 'sinew', name: 'Sinew', category: 'material',
    weight: 0.5, stackable: true, maxStack: 99,
  },
  fat: {
    id: 'fat', name: 'Fat', category: 'material',
    weight: 1.0, stackable: true, maxStack: 99,
  },
  feathers: {
    id: 'feathers', name: 'Feathers', category: 'material',
    weight: 0.2, stackable: true, maxStack: 99,
  },
  teeth_claws: {
    id: 'teeth_claws', name: 'Teeth & Claws', category: 'material',
    weight: 0.5, stackable: true, maxStack: 99,
  },
  scales: {
    id: 'scales', name: 'Scales', category: 'material',
    weight: 1.5, stackable: true, maxStack: 99,
  },

  // ─── Tools (not stackable) ───

  wooden_shovel: {
    id: 'wooden_shovel', name: 'Wooden Shovel', category: 'tool',
    weight: 3.0, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 50,
    harvestBonus: 0.3,
  },
  wooden_club: {
    id: 'wooden_club', name: 'Wooden Club', category: 'weapon',
    weight: 3.5, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 50,
    attackBonus: 3,
  },
  wooden_spear: {
    id: 'wooden_spear', name: 'Wooden Spear', category: 'weapon',
    weight: 4.0, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 50,
    attackBonus: 5, range: 2,
  },
  stone_axe: {
    id: 'stone_axe', name: 'Stone Axe', category: 'tool',
    weight: 4.0, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 120,
    woodcuttingBonus: 0.5, attackBonus: 4,
  },
  stone_pickaxe: {
    id: 'stone_pickaxe', name: 'Stone Pickaxe', category: 'tool',
    weight: 4.5, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 120,
    miningBonus: 0.5,
  },
  stone_knife: {
    id: 'stone_knife', name: 'Stone Knife', category: 'weapon',
    weight: 2.0, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 120,
    attackBonus: 4, harvestBonus: 0.2,
  },
  stone_shovel: {
    id: 'stone_shovel', name: 'Stone Shovel', category: 'tool',
    weight: 4.0, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 120,
    harvestBonus: 0.6,
  },
  bone_knife: {
    id: 'bone_knife', name: 'Bone Knife', category: 'weapon',
    weight: 2.0, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 100,
    attackBonus: 5, harvestBonus: 0.25,
  },
  bone_axe: {
    id: 'bone_axe', name: 'Bone Axe', category: 'tool',
    weight: 3.5, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 100,
    woodcuttingBonus: 0.6, attackBonus: 5,
  },
  bone_pickaxe: {
    id: 'bone_pickaxe', name: 'Bone Pickaxe', category: 'tool',
    weight: 4.0, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 100,
    miningBonus: 0.6,
  },
  bone_spear: {
    id: 'bone_spear', name: 'Bone Spear', category: 'weapon',
    weight: 3.0, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 100,
    attackBonus: 10, range: 2,
  },
  tooth_club: {
    id: 'tooth_club', name: 'Tooth Club', category: 'weapon',
    weight: 4.0, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 100,
    attackBonus: 8,
  },
  bow: {
    id: 'bow', name: 'Bow', category: 'weapon',
    weight: 3.0, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 100,
    attackBonus: 7, range: 5,
  },
  arrows: {
    id: 'arrows', name: 'Arrows', category: 'material',
    weight: 1.0, stackable: true, maxStack: 99,
  },
  iron_sword: {
    id: 'iron_sword', name: 'Iron Sword', category: 'weapon',
    weight: 5.0, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 300,
    attackBonus: 15,
  },
  iron_axe: {
    id: 'iron_axe', name: 'Iron Axe', category: 'tool',
    weight: 4.5, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 300,
    woodcuttingBonus: 1.0, attackBonus: 8,
  },
  iron_pickaxe: {
    id: 'iron_pickaxe', name: 'Iron Pickaxe', category: 'tool',
    weight: 5.0, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 300,
    miningBonus: 1.0,
  },
  iron_shovel: {
    id: 'iron_shovel', name: 'Iron Shovel', category: 'tool',
    weight: 4.0, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 300,
    harvestBonus: 1.0,
  },
  iron_shield: {
    id: 'iron_shield', name: 'Iron Shield', category: 'weapon',
    weight: 7.0, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 300,
    defenseBonus: 18,
  },
  scale_shield: {
    id: 'scale_shield', name: 'Scale Shield', category: 'weapon',
    weight: 6.0, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 200,
    defenseBonus: 15,
  },
  iron_tipped_arrows: {
    id: 'iron_tipped_arrows', name: 'Iron-Tipped Arrows', category: 'material',
    weight: 1.5, stackable: true, maxStack: 99,
  },

  // ─── Armor (not stackable) ───

  hide_vest: {
    id: 'hide_vest', name: 'Hide Vest', category: 'armor',
    weight: 3.0, stackable: false, maxStack: 1,
    equipSlot: 'body', durability: 100,
    defenseBonus: 5,
  },
  hide_boots: {
    id: 'hide_boots', name: 'Hide Boots', category: 'armor',
    weight: 1.5, stackable: false, maxStack: 1,
    equipSlot: 'body', durability: 100,
    speedBonus: 0.05,
  },
  fur_cloak: {
    id: 'fur_cloak', name: 'Fur Cloak', category: 'armor',
    weight: 4.0, stackable: false, maxStack: 1,
    equipSlot: 'body', durability: 100,
    defenseBonus: 8,
  },
  scale_armor: {
    id: 'scale_armor', name: 'Scale Armor', category: 'armor',
    weight: 8.0, stackable: false, maxStack: 1,
    equipSlot: 'body', durability: 200,
    defenseBonus: 20,
  },

  // ─── Accessories (not stackable) ───

  leather_sack: {
    id: 'leather_sack', name: 'Leather Sack', category: 'accessory',
    weight: 1.0, stackable: false, maxStack: 1,
    equipSlot: 'accessory',
    carryCapacityBonus: 20,
  },
  tooth_necklace: {
    id: 'tooth_necklace', name: 'Tooth Necklace', category: 'accessory',
    weight: 0.3, stackable: false, maxStack: 1,
    equipSlot: 'accessory',
    socialBonus: 5,
  },
  feather_crown: {
    id: 'feather_crown', name: 'Feather Crown', category: 'accessory',
    weight: 0.3, stackable: false, maxStack: 1,
    equipSlot: 'accessory',
    socialBonus: 8,
  },
  scale_pendant: {
    id: 'scale_pendant', name: 'Scale Pendant', category: 'accessory',
    weight: 0.3, stackable: false, maxStack: 1,
    equipSlot: 'accessory',
    socialBonus: 12,
  },

  // ─── Food Items (stackable) ───

  cooked_meat: {
    id: 'cooked_meat', name: 'Cooked Meat', category: 'food',
    weight: 1.0, stackable: true, maxStack: 99,
    nutrition: { protein: 20, plant: 0 },
  },
  stew: {
    id: 'stew', name: 'Stew', category: 'food',
    weight: 2.0, stackable: true, maxStack: 99,
    nutrition: { protein: 25, plant: 15, thirst: 15 },
  },
  jerky: {
    id: 'jerky', name: 'Jerky', category: 'food',
    weight: 0.5, stackable: true, maxStack: 99,
    nutrition: { protein: 15, plant: 0 },
  },
  bone_broth: {
    id: 'bone_broth', name: 'Bone Broth', category: 'food',
    weight: 1.5, stackable: true, maxStack: 99,
    nutrition: { protein: 10, plant: 0, health: 5 },
  },
  fat_rations: {
    id: 'fat_rations', name: 'Fat Rations', category: 'food',
    weight: 1.0, stackable: true, maxStack: 99,
    nutrition: { protein: 10, plant: 5, stamina: 10 },
  },
  berry_salad: {
    id: 'berry_salad', name: 'Berry Salad', category: 'food',
    weight: 1.0, stackable: true, maxStack: 99,
    nutrition: { protein: 0, plant: 25 },
  },
  herb_mix: {
    id: 'herb_mix', name: 'Herb Mix', category: 'food',
    weight: 0.5, stackable: true, maxStack: 99,
    nutrition: { protein: 0, plant: 15, stamina: 10 },
  },

  // ─── Utility ───

  sinew_rope: {
    id: 'sinew_rope', name: 'Sinew Rope', category: 'material',
    weight: 1.0, stackable: true, maxStack: 99,
  },
  fat_torch: {
    id: 'fat_torch', name: 'Fat Torch', category: 'tool',
    weight: 1.5, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 120,
  },
  tallow_candle: {
    id: 'tallow_candle', name: 'Tallow Candle', category: 'tool',
    weight: 0.5, stackable: false, maxStack: 1,
    equipSlot: 'mainHand', durability: 300,
  },
};

export function getItemDef(id: string): ItemDefinition {
  const def = ITEM_DEFS[id];
  if (!def) {
    throw new Error(`Unknown item definition: ${id}`);
  }
  return def;
}
