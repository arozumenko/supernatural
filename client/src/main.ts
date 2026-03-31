import Phaser from 'phaser';
import { MainMenuScene } from './scenes/MainMenuScene.js';
import { GameScene } from './scenes/GameScene.js';
import { UIScene } from './scenes/UIScene.js';
import { ResultsScene } from './scenes/ResultsScene.js';

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
    scene: [MainMenuScene, GameScene, UIScene, ResultsScene],
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

  // Handle resize — covers manual drag, macOS green expand button, and fullscreen toggle
  let resizeTimer: number | null = null;
  const handleResize = () => {
    if (resizeTimer) cancelAnimationFrame(resizeTimer);
    resizeTimer = requestAnimationFrame(() => {
      game.scale.resize(window.innerWidth, window.innerHeight);
      resizeTimer = null;
    });
  };
  window.addEventListener('resize', handleResize);
  // macOS expand button triggers fullscreenchange, not always resize
  document.addEventListener('fullscreenchange', () => setTimeout(handleResize, 100));
  document.addEventListener('webkitfullscreenchange', () => setTimeout(handleResize, 100));
  // Also catch delayed layout shifts (e.g. moving between displays with different DPI)
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleResize);
  }
  // Fallback: poll once after a short delay to catch any missed resize
  setInterval(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (game.scale.width !== w || game.scale.height !== h) {
      game.scale.resize(w, h);
    }
  }, 2000);

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
