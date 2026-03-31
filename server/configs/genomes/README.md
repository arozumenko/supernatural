# Custom Genomes

Place `.json` files in this directory to make them available as starting genomes on the game start screen.

## How to use

1. Export a winning genome from the results screen ("Download JSON" button)
2. Rename the file to something descriptive (e.g., `water-hoarder.json`)
3. Place it in this `server/genomes/` folder
4. Restart the server — the genome appears in the start screen genome selector

## File format

Each file must be a valid `BehaviorGenome` JSON. Example:

```json
{
  "version": 1,
  "generation": 0,
  "lineage": [],
  "interruptWeights": {
    "criticalThirst": 95,
    "fightBack": 93,
    "criticalHunger": 90,
    "lowHealth": 88,
    "staminaHerb": 82,
    "exhaustionRest": 80,
    "groupDefense": 75,
    "fleeBase": 75
  },
  "thresholds": { ... },
  "goalWeights": { ... },
  "fallbackWeights": { ... },
  "strategyRules": [],
  ...
}
```

## Tips

- Genomes with strategy rules are the most interesting — they represent learned behaviors
- The `lineage` array shows the mutation history — keep it for reference
- You can manually edit values to experiment (stay within safety bounds)
- Name files after the behavior they encode: `aggressive-hunter.json`, `cautious-hoarder.json`
