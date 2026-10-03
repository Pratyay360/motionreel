// npm i playwright ffmpeg-static
// npx playwright install chromium
const { chromium } = require('playwright');
const ffmpegPath = require('ffmpeg-static');
const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const FILE = 'index.html';
const W = 1920, H = 1080;   // 1280x720 also fine; 1080x1920 for vertical
const FPS = 60;
const OUT = path.join(__dirname, 'video.mp4');

(async () => {
  const frames = path.join(__dirname, 'frames');
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  await page.goto('file://' + path.join(__dirname, FILE),
                  { waitUntil: 'networkidle', timeout: 60000 });

  await page.waitForFunction(() => window.__reel && !document.getElementById('boot'),
                             null, { timeout: 60000 });

  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.evaluate(() => window.__reel.rebuild());


  await page.addStyleTag({ content: `
    #bar,#sndHint,#replay,#boot{display:none!important}
    body{cursor:none!important}
    #hud{opacity:1!important}
    *,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
  `});

  const DUR   = await page.evaluate(() => window.__reel.DUR);
  const total = Math.ceil(DUR * FPS);
  console.log(`rendering ${total} frames @ ${FPS} fps...`);

  for (let f = 0; f < total; f++) {
    await page.evaluate(t => window.__reel.seekTo(t), f / FPS);
    await page.screenshot({ path: path.join(frames, 'f' + String(f).padStart(5, '0') + '.png') });
    if (f % 90 === 0) console.log(`  ${f} / ${total}`);
  }
  await browser.close();

  console.log('encoding mp4...');
  execFileSync(ffmpegPath, [
    '-y', '-framerate', String(FPS),
    '-i', path.join(frames, 'f%05d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-crf', '18', '-preset', 'slow', '-movflags', '+faststart',
    OUT
  ], { stdio: 'inherit' });

  console.log('done →', OUT);
})();
