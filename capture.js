// npm i playwright ffmpeg-static
const { chromium } = require('playwright');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const { once } = require('events');
const path = require('path');

const FILE = 'index.html';
const W = 1920, H = 1080;
const FPS = 60;
const OUT = path.join(__dirname, 'video.mp4');
function startEncoder() {
  const ff = spawn(ffmpegPath, [
    '-y', '-hide_banner', '-loglevel', 'error', '-nostats',
    '-f', 'image2pipe',
    '-c:v', 'png',
    '-framerate', String(FPS),
    '-i', 'pipe:0',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-crf', '18', '-preset', 'slow', '-movflags', '+faststart',
    OUT
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  ff.exited = false;
  // One shared promise so per-frame backpressure waits don't pile up listeners.
  ff.closed = new Promise(res => ff.once('close', code => { ff.exited = true; res(code); }));
  ff.stdin.on('error', err => { if (err.code !== 'EPIPE') ff.emit('error', err); });
  return ff;
}

// Write one frame, honoring ffmpeg's backpressure; bail out if it dies.
async function writeFrame(ff, png) {
  if (ff.exited) throw new Error('ffmpeg exited before all frames were sent');
  if (!ff.stdin.write(png)) {
    await Promise.race([once(ff.stdin, 'drain'), ff.closed]);
    if (ff.exited) throw new Error('ffmpeg exited while frames were being sent');
  }
}

(async () => {
  const ff = startEncoder();
  let browser;

  try {
    browser = await chromium.launch();
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
    console.log(`rendering ${total} frames @ ${FPS} fps → ffmpeg (streaming)`);

    for (let f = 0; f < total; f++) {
      await page.evaluate(t => window.__reel.seekTo(t), f / FPS);
      const png = await page.screenshot();      // in-memory; ffmpeg takes it now
      await writeFrame(ff, png);                // encoder runs alongside rendering
      if (f % 90 === 0) console.log(`  ${f} / ${total}`);
    }

    ff.stdin.end();
    const code = await ff.closed;
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    console.log('done →', OUT);
  } catch (err) {
    ff.stdin.destroy();
    if (!ff.exited) ff.kill('SIGKILL');
    throw err;
  } finally {
    if (browser) await browser.close();
  }
})();
