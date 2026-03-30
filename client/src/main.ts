import Phaser from 'phaser';
import { MainMenuScene } from './scenes/MainMenuScene.js';
import { GameScene } from './scenes/GameScene.js';
import { UIScene } from './scenes/UIScene.js';

// Wait for the pixel font to load before starting Phaser.
// Without this, text created in create() renders with fallback font
// and "changes" when the font loads later.
document.fonts.load('16px "Press Start 2P"').then(() => {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'game-container',
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#0a0a0a',
    pixelArt: true,
    roundPixels: true,
    scene: [MainMenuScene, GameScene, UIScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: {
      mouse: {
        preventDefaultWheel: false,
      },
    },
  };

  const game = new Phaser.Game(config);

  // Handle resize
  window.addEventListener('resize', () => {
    game.scale.resize(window.innerWidth, window.innerHeight);
  });

  console.log(`
╔══════════════════════════════════════╗
║       S U P E R N A T U R A L       ║
║                                      ║
║   AI Agent Civilization Simulation   ║
║                                      ║
║   WASD/Arrows - Move camera          ║
║   Scroll     - Zoom in/out           ║
║   Click      - Select agent          ║
║   M          - Message agent          ║
║   N          - Create new agent       ║
╚══════════════════════════════════════╝
  `);
});
