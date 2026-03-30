# Change Request: DROPS_AND_MATERIALS.md

**Status:** Pending (DROPS_AND_MATERIALS.md is currently being implemented)
**Depends on:** CRAFTING.md, PROGRESSION.md
**Apply after:** DROPS_AND_MATERIALS.md base implementation is complete

---

## Summary of Changes

The CRAFTING.md spec introduces a full crafting system that supersedes and extends the recipe tables currently in DROPS_AND_MATERIALS.md. Once the base drops/materials implementation is stable, these changes should be applied.

---

## Change 1: Add iron_ore to MaterialType

The crafting system adds iron as a new world resource. The `MaterialType` in DROPS_AND_MATERIALS.md needs to expand:

```diff
 type ResourceType =
   | 'wood' | 'stone' | 'food' | 'water' | 'seeds'   // existing
   | 'meat' | 'bone' | 'hide' | 'sinew'               // common body materials
-  | 'fat' | 'feathers' | 'teeth_claws' | 'scales';   // uncommon body materials
+  | 'fat' | 'feathers' | 'teeth_claws' | 'scales'    // uncommon body materials
+  | 'iron_ore' | 'iron_ingot';                        // metal resources (CRAFTING.md)
```

---

## Change 2: Add iron_ore to Material Scarcity table

In the "Scarcity Design" section, add iron_ore to the RARE tier:

```diff
 ABUNDANT:    meat, bone, hide    ← most animals drop these, basic crafting covered
 MODERATE:    sinew, fat          ← most animals drop small amounts, need several kills
 SCARCE:      feathers            ← only 2 species (chicken, duck), valuable for ranged
-RARE:        teeth_claws         ← predators mainly, risky to obtain
+RARE:        teeth_claws         ← predators mainly, risky to obtain
+             iron_ore            ← finite world deposits (~15-20), never respawn
 VERY RARE:   scales              ← only alligators, most dangerous source in the game
```

---

## Change 3: Replace recipe tables with reference to CRAFTING.md

The "Material Uses in Crafting" section (currently lines ~278-362) contains recipe tables that are now fully superseded by CRAFTING.md, which has expanded versions with weights, craft times, tier organization, and iron recipes. Replace the entire section with:

```markdown
## Material Uses in Crafting

All crafting recipes, tool stats, structure HP, inventory weights, and material tier progression
are defined in **[CRAFTING.md](CRAFTING.md)**. This document covers material *sources* only.

### Material Rarity (drives crafting economy)

ABUNDANT:    wood, stone, meat, bone, hide    ← easy to get, Tier 1-2 recipes
MODERATE:    sinew, fat                       ← need several kills, Tier 3 recipes
SCARCE:      feathers                         ← only chickens + ducks, ranged weapons
RARE:        teeth_claws, iron_ore            ← predators / finite deposits, Tier 3-4
VERY RARE:   scales                           ← only alligators, best armor in game
```

**Keep** the following sections untouched (they belong in this doc, not CRAFTING.md):
- Material Economy Balance (supply/demand analysis)
- Material Spoilage
- How Drops Work (corpse mechanics)
- Scavenger Behavior
- Harvesting a Corpse
- Inventory Expansion (carry weight specs have moved to CRAFTING.md but the weight-per-material table here is still useful as reference)

---

## Change 4: Update CraftProduct type

The `CraftProduct` type at the bottom of DROPS_AND_MATERIALS.md should be replaced with the richer types from CRAFTING.md:

```diff
-type CraftProduct =
-  | { type: 'tile'; tileType: TileType }
-  | { type: 'item'; item: ItemType; quantity: number }
-  | { type: 'food'; proteinRestore: number; plantRestore: number; thirstRestore?: number; healthBoost?: number; staminaBoost?: number };
+// Recipe and item types are now defined in CRAFTING.md
+// See CraftingRecipe, ItemDefinition, and Inventory interfaces there
```

---

## Change 5: Update smell mechanic for protein-only detection

Already applied — smell mechanic references `agent_meat_carried` and notes predators don't care about plant food. No further changes needed.

---

## Change 6: Add CorpseState.items field

The `CorpseState` type should use the new `InventoryItem` type from CRAFTING.md instead of raw material counts:

```diff
 export interface CorpseState {
   id: string;
   x: number;
   y: number;
   sourceType: 'agent' | 'animal';
   sourceSpecies?: string;
   sourceName?: string;
-  materials: Partial<DropTable>;
-  carriedResources?: Partial<Resources>;
+  loot: InventoryItem[];              // all materials + agent inventory as items
   createdAt: number;
   decayAt: number;
 }
```

---

## Priority

These changes are non-blocking. The base DROPS_AND_MATERIALS.md implementation can proceed as-is. Apply these changes when:
1. CRAFTING.md types are implemented in `shared/src/index.ts`
2. The inventory system (weight-based) is in place
3. The base drop/corpse system is working
