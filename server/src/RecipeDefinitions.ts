import { TileType } from '../shared/src/index.ts';

export interface CraftingRecipeNew {
  id: string;
  name: string;
  requires: Record<string, number>;  // itemId/resourceId -> quantity
  produces: {
    type: 'item' | 'tile';
    itemId?: string;
    tileType?: number;
    quantity?: number;
  };
  station: 'none' | 'campfire' | 'workbench' | 'forge';
  skillType: 'crafting' | 'building';
  skillRequired: number;
  craftTime: number;      // ticks
  staminaCost: number;
}

export const RECIPES: CraftingRecipeNew[] = [
  // ─── Hand Recipes (no station) ───

  {
    id: 'campfire', name: 'Campfire',
    requires: { wood: 3, stone: 2 },
    produces: { type: 'tile', tileType: TileType.CAMPFIRE },
    station: 'none', skillType: 'building', skillRequired: 0,
    craftTime: 20, staminaCost: 3,
  },
  {
    id: 'workbench', name: 'Workbench',
    requires: { wood: 8, stone: 4 },
    produces: { type: 'tile', tileType: TileType.WORKBENCH },
    station: 'none', skillType: 'building', skillRequired: 5,
    craftTime: 20, staminaCost: 3,
  },

  // ─── Tier 0: Hand-crafted (no station) ───

  {
    id: 'wooden_spear_basic', name: 'Sharp Stick',
    requires: { wood: 2 },
    produces: { type: 'item', itemId: 'wooden_spear', quantity: 1 },
    station: 'none', skillType: 'crafting', skillRequired: 0,
    craftTime: 10, staminaCost: 1,
  },
  {
    id: 'stone_knife_basic', name: 'Flint Knife',
    requires: { stone: 2 },
    produces: { type: 'item', itemId: 'stone_knife', quantity: 1 },
    station: 'none', skillType: 'crafting', skillRequired: 0,
    craftTime: 10, staminaCost: 1,
  },

  // ─── Tier 1: Wood Tools (workbench) ───

  {
    id: 'wooden_shovel', name: 'Wooden Shovel',
    requires: { wood: 4 },
    produces: { type: 'item', itemId: 'wooden_shovel', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 0,
    craftTime: 15, staminaCost: 2,
  },
  {
    id: 'wooden_club', name: 'Wooden Club',
    requires: { wood: 5 },
    produces: { type: 'item', itemId: 'wooden_club', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 0,
    craftTime: 15, staminaCost: 2,
  },
  {
    id: 'wooden_spear', name: 'Wooden Spear',
    requires: { wood: 6, stone: 1 },
    produces: { type: 'item', itemId: 'wooden_spear', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 5,
    craftTime: 15, staminaCost: 2,
  },
  {
    id: 'wooden_floor', name: 'Wooden Floor',
    requires: { wood: 3 },
    produces: { type: 'tile', tileType: TileType.BUILT_FLOOR },
    station: 'workbench', skillType: 'building', skillRequired: 5,
    craftTime: 30, staminaCost: 5,
  },
  {
    id: 'wooden_wall', name: 'Wooden Wall',
    requires: { wood: 5 },
    produces: { type: 'tile', tileType: TileType.BUILT_WALL },
    station: 'workbench', skillType: 'building', skillRequired: 8,
    craftTime: 30, staminaCost: 5,
  },
  {
    id: 'wooden_door', name: 'Wooden Door',
    requires: { wood: 6, sinew: 1 },
    produces: { type: 'tile', tileType: TileType.WOOD_DOOR },
    station: 'workbench', skillType: 'building', skillRequired: 10,
    craftTime: 30, staminaCost: 5,
  },
  {
    id: 'wooden_storage', name: 'Wooden Storage',
    requires: { wood: 10 },
    produces: { type: 'tile', tileType: TileType.STORAGE },
    station: 'workbench', skillType: 'building', skillRequired: 12,
    craftTime: 30, staminaCost: 5,
  },

  // ─── Tier 2: Stone Tools (workbench) ───

  {
    id: 'stone_axe', name: 'Stone Axe',
    requires: { wood: 2, stone: 3 },
    produces: { type: 'item', itemId: 'stone_axe', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 5,
    craftTime: 20, staminaCost: 3,
  },
  {
    id: 'stone_pickaxe', name: 'Stone Pickaxe',
    requires: { wood: 2, stone: 3 },
    produces: { type: 'item', itemId: 'stone_pickaxe', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 5,
    craftTime: 20, staminaCost: 3,
  },
  {
    id: 'stone_knife', name: 'Stone Knife',
    requires: { wood: 1, stone: 2 },
    produces: { type: 'item', itemId: 'stone_knife', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 3,
    craftTime: 20, staminaCost: 3,
  },
  {
    id: 'stone_shovel', name: 'Stone Shovel',
    requires: { wood: 2, stone: 3 },
    produces: { type: 'item', itemId: 'stone_shovel', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 5,
    craftTime: 20, staminaCost: 3,
  },
  {
    id: 'stone_wall', name: 'Stone Wall',
    requires: { stone: 8 },
    produces: { type: 'tile', tileType: TileType.STONE_WALL },
    station: 'workbench', skillType: 'building', skillRequired: 15,
    craftTime: 30, staminaCost: 5,
  },

  // ─── Tier 3: Bone, Hide & Advanced (workbench) ───

  // Weapons
  {
    id: 'bone_knife', name: 'Bone Knife',
    requires: { bone: 3, sinew: 1 },
    produces: { type: 'item', itemId: 'bone_knife', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 8,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'bone_axe', name: 'Bone Axe',
    requires: { bone: 4, wood: 2, sinew: 2 },
    produces: { type: 'item', itemId: 'bone_axe', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 12,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'bone_pickaxe', name: 'Bone Pickaxe',
    requires: { bone: 4, stone: 2, sinew: 2 },
    produces: { type: 'item', itemId: 'bone_pickaxe', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 12,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'bone_spear', name: 'Bone Spear',
    requires: { bone: 5, wood: 3, sinew: 2 },
    produces: { type: 'item', itemId: 'bone_spear', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 15,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'tooth_club', name: 'Tooth Club',
    requires: { teeth_claws: 4, wood: 3 },
    produces: { type: 'item', itemId: 'tooth_club', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 12,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'bow', name: 'Bow',
    requires: { wood: 4, sinew: 3, feathers: 2 },
    produces: { type: 'item', itemId: 'bow', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 20,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'arrows', name: 'Arrows',
    requires: { wood: 1, feathers: 1, bone: 1 },
    produces: { type: 'item', itemId: 'arrows', quantity: 5 },
    station: 'workbench', skillType: 'crafting', skillRequired: 10,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'bone_arrows', name: 'Bone Arrows',
    requires: { bone: 2, wood: 1 },
    produces: { type: 'item', itemId: 'arrows', quantity: 3 },
    station: 'workbench', skillType: 'crafting', skillRequired: 8,
    craftTime: 25, staminaCost: 4,
  },

  // Armor
  {
    id: 'hide_vest', name: 'Hide Vest',
    requires: { hide: 4, sinew: 2 },
    produces: { type: 'item', itemId: 'hide_vest', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 10,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'hide_boots', name: 'Hide Boots',
    requires: { hide: 2, sinew: 1 },
    produces: { type: 'item', itemId: 'hide_boots', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 8,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'fur_cloak', name: 'Fur Cloak',
    requires: { hide: 6, sinew: 3 },
    produces: { type: 'item', itemId: 'fur_cloak', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 18,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'scale_shield', name: 'Scale Shield',
    requires: { scales: 6, wood: 3, sinew: 2 },
    produces: { type: 'item', itemId: 'scale_shield', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 25,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'scale_armor', name: 'Scale Armor',
    requires: { scales: 10, hide: 4, sinew: 4 },
    produces: { type: 'item', itemId: 'scale_armor', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 35,
    craftTime: 25, staminaCost: 4,
  },

  // Utility
  {
    id: 'sinew_rope', name: 'Sinew Rope',
    requires: { sinew: 4 },
    produces: { type: 'item', itemId: 'sinew_rope', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 8,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'leather_sack', name: 'Leather Sack',
    requires: { hide: 3, sinew: 1 },
    produces: { type: 'item', itemId: 'leather_sack', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 10,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'fat_torch', name: 'Fat Torch',
    requires: { fat: 2, wood: 1 },
    produces: { type: 'item', itemId: 'fat_torch', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 3,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'tallow_candle', name: 'Tallow Candle',
    requires: { fat: 3 },
    produces: { type: 'item', itemId: 'tallow_candle', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 5,
    craftTime: 25, staminaCost: 4,
  },

  // Structures (Tier 3)
  {
    id: 'bone_fence', name: 'Bone Fence',
    requires: { bone: 6, wood: 4 },
    produces: { type: 'tile', tileType: TileType.BONE_FENCE },
    station: 'workbench', skillType: 'building', skillRequired: 10,
    craftTime: 30, staminaCost: 5,
  },
  {
    id: 'hide_tent', name: 'Hide Tent',
    requires: { hide: 8, wood: 6, sinew: 3 },
    produces: { type: 'tile', tileType: TileType.TENT },
    station: 'workbench', skillType: 'building', skillRequired: 18,
    craftTime: 50, staminaCost: 8,
  },
  {
    id: 'feather_bedroll', name: 'Feather Bedroll',
    requires: { feathers: 8, hide: 3 },
    produces: { type: 'tile', tileType: TileType.BEDROLL },
    station: 'workbench', skillType: 'crafting', skillRequired: 12,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'animal_pen', name: 'Animal Pen',
    requires: { wood: 12, sinew: 8, bone: 4 },
    produces: { type: 'tile', tileType: TileType.ANIMAL_PEN },
    station: 'workbench', skillType: 'building', skillRequired: 25,
    craftTime: 50, staminaCost: 8,
  },

  // Social & Trade Items
  {
    id: 'tooth_necklace', name: 'Tooth Necklace',
    requires: { teeth_claws: 3, sinew: 1 },
    produces: { type: 'item', itemId: 'tooth_necklace', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 5,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'feather_crown', name: 'Feather Crown',
    requires: { feathers: 6, sinew: 2 },
    produces: { type: 'item', itemId: 'feather_crown', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 12,
    craftTime: 25, staminaCost: 4,
  },
  {
    id: 'scale_pendant', name: 'Scale Pendant',
    requires: { scales: 3, sinew: 1 },
    produces: { type: 'item', itemId: 'scale_pendant', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 18,
    craftTime: 25, staminaCost: 4,
  },

  // ─── Tier 4: Iron (forge) ───

  {
    id: 'iron_ingot', name: 'Iron Ingot',
    requires: { iron_ore: 2, wood: 2 },
    produces: { type: 'item', itemId: 'iron_ingot', quantity: 1 },
    station: 'forge', skillType: 'crafting', skillRequired: 15,
    craftTime: 30, staminaCost: 5,
  },
  {
    id: 'forge', name: 'Forge',
    requires: { stone: 12, wood: 8 },
    produces: { type: 'tile', tileType: TileType.FORGE },
    station: 'workbench', skillType: 'building', skillRequired: 20,
    craftTime: 50, staminaCost: 8,
  },
  {
    id: 'iron_sword', name: 'Iron Sword',
    requires: { iron_ingot: 3, wood: 1, hide: 1 },
    produces: { type: 'item', itemId: 'iron_sword', quantity: 1 },
    station: 'forge', skillType: 'crafting', skillRequired: 25,
    craftTime: 35, staminaCost: 6,
  },
  {
    id: 'iron_axe', name: 'Iron Axe',
    requires: { iron_ingot: 2, wood: 2 },
    produces: { type: 'item', itemId: 'iron_axe', quantity: 1 },
    station: 'forge', skillType: 'crafting', skillRequired: 22,
    craftTime: 35, staminaCost: 6,
  },
  {
    id: 'iron_pickaxe', name: 'Iron Pickaxe',
    requires: { iron_ingot: 2, wood: 2 },
    produces: { type: 'item', itemId: 'iron_pickaxe', quantity: 1 },
    station: 'forge', skillType: 'crafting', skillRequired: 22,
    craftTime: 35, staminaCost: 6,
  },
  {
    id: 'iron_shovel', name: 'Iron Shovel',
    requires: { iron_ingot: 2, wood: 2 },
    produces: { type: 'item', itemId: 'iron_shovel', quantity: 1 },
    station: 'forge', skillType: 'crafting', skillRequired: 20,
    craftTime: 35, staminaCost: 6,
  },
  {
    id: 'iron_wall', name: 'Iron-Reinforced Wall',
    requires: { stone: 6, iron_ingot: 2, wood: 2 },
    produces: { type: 'tile', tileType: TileType.IRON_WALL },
    station: 'forge', skillType: 'building', skillRequired: 28,
    craftTime: 50, staminaCost: 8,
  },
  {
    id: 'iron_shield', name: 'Iron Shield',
    requires: { iron_ingot: 4, hide: 2 },
    produces: { type: 'item', itemId: 'iron_shield', quantity: 1 },
    station: 'forge', skillType: 'crafting', skillRequired: 28,
    craftTime: 35, staminaCost: 6,
  },
  {
    id: 'iron_tipped_arrows', name: 'Iron-Tipped Arrows',
    requires: { iron_ingot: 1, wood: 2, feathers: 2 },
    produces: { type: 'item', itemId: 'iron_tipped_arrows', quantity: 5 },
    station: 'forge', skillType: 'crafting', skillRequired: 20,
    craftTime: 35, staminaCost: 6,
  },

  // ─── Food & Cooking ───

  {
    id: 'cooked_meat', name: 'Cooked Meat',
    requires: { meat: 2 },
    produces: { type: 'item', itemId: 'cooked_meat', quantity: 1 },
    station: 'campfire', skillType: 'crafting', skillRequired: 0,
    craftTime: 10, staminaCost: 1,
  },
  {
    id: 'stew', name: 'Stew',
    requires: { meat: 3, water: 2, food: 2 },
    produces: { type: 'item', itemId: 'stew', quantity: 1 },
    station: 'campfire', skillType: 'crafting', skillRequired: 10,
    craftTime: 10, staminaCost: 1,
  },
  {
    id: 'jerky', name: 'Jerky',
    requires: { meat: 4, fat: 1 },
    produces: { type: 'item', itemId: 'jerky', quantity: 1 },
    station: 'campfire', skillType: 'crafting', skillRequired: 8,
    craftTime: 10, staminaCost: 1,
  },
  {
    id: 'bone_broth', name: 'Bone Broth',
    requires: { bone: 3, water: 3 },
    produces: { type: 'item', itemId: 'bone_broth', quantity: 1 },
    station: 'campfire', skillType: 'crafting', skillRequired: 5,
    craftTime: 10, staminaCost: 1,
  },
  {
    id: 'fat_rations', name: 'Fat Rations',
    requires: { fat: 3, food: 2 },
    produces: { type: 'item', itemId: 'fat_rations', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 5,
    craftTime: 10, staminaCost: 1,
  },
  {
    id: 'berry_salad', name: 'Berry Salad',
    requires: { food: 4 },
    produces: { type: 'item', itemId: 'berry_salad', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 3,
    craftTime: 10, staminaCost: 1,
  },
  {
    id: 'herb_mix', name: 'Herb Mix',
    requires: { food: 3 },
    produces: { type: 'item', itemId: 'herb_mix', quantity: 1 },
    station: 'workbench', skillType: 'crafting', skillRequired: 5,
    craftTime: 10, staminaCost: 1,
  },
];
