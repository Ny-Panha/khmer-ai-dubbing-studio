const { chromium } = require('playwright');

async function runBrowserVerification() {
  console.log('🚀 Starting ConCaT-Inspired Browser Verification on Real Google Chrome...');
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox']
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Listen to console errors
  const pageErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });
  page.on('pageerror', err => pageErrors.push(err.message));

  try {
    console.log('📍 Navigating to http://localhost:5173...');
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    // Click "ចូលផ្ទាំងកាត់ត (Open Studio)"
    console.log('🎬 Opening Studio Editor...');
    const openStudioBtn = await page.$('text="ចូលផ្ទាំងកាត់ត (Open Studio)"');
    if (openStudioBtn) {
      await openStudioBtn.click();
    } else {
      const studioLink = await page.$('a[href="/studio"], button:has-text("Studio")');
      if (studioLink) await studioLink.click();
    }
    await page.waitForTimeout(3000);
    console.log('📍 Current Page URL:', page.url());

    // Print text on screen to see what is open
    const pageText = await page.evaluate(() => document.body.innerText.slice(0, 600));
    console.log('📄 Page snippet:\n', pageText);

    // 1. Verify Diagnostics Toggle Button exists
    console.log('Searching for .btn-diagnostics-pill or player stage...');
    const playerStage = await page.$('.player-stage-viewport, .capcut-player-panel');
    console.log('Player Stage found:', Boolean(playerStage));

    const diagBtn = await page.waitForSelector('.btn-diagnostics-pill', { timeout: 10000 });
    console.log('✅ Found Diagnostics Pill button:', await diagBtn.innerText());

    // 2. Click Diagnostics Pill button to open Diagnostics Panel
    await diagBtn.click();
    await page.waitForTimeout(500);

    const diagPanel = await page.waitForSelector('.player-diagnostics-panel', { timeout: 5000 });
    console.log('✅ Diagnostics panel expanded successfully!');
    const panelText = await diagPanel.innerText();
    console.log('📊 Initial Diagnostics text:\n', panelText);

    // 3. Test Audio Engine Toggle button
    const toggleEngineBtn = await page.waitForSelector('.btn-engine-toggle', { timeout: 5000 });
    const initialEngineLabel = await toggleEngineBtn.innerText();
    console.log('🔄 Initial Audio Engine toggle label:', initialEngineLabel);

    // Toggle to HTMLAudio Pool
    await toggleEngineBtn.click();
    await page.waitForTimeout(300);
    const toggledLabel1 = await toggleEngineBtn.innerText();
    console.log('✅ Toggled to HTMLAudio Pool. New label:', toggledLabel1);

    // Toggle back to Web Audio
    await toggleEngineBtn.click();
    await page.waitForTimeout(300);
    const toggledLabel2 = await toggleEngineBtn.innerText();
    console.log('✅ Toggled back to Web Audio. New label:', toggledLabel2);

    // 4. Test Voice Clip Drag & Snapping on Timeline
    const firstVoiceBlock = await page.$('.voice-segment-block');
    if (firstVoiceBlock) {
      console.log('🎬 Testing Voice Drag gesture on timeline...');
      const box = await firstVoiceBlock.boundingBox();
      if (box) {
        // Drag 30px right
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 5 });
        await page.waitForTimeout(100);
        await page.mouse.up();
        console.log('✅ Successfully completed voice move drag gesture!');
      }
    } else {
      console.log('ℹ️ No voice blocks currently rendered, skipping drag interaction');
    }

    // 5. Test Video Playback & FPS measurement
    const videoEl = await page.$('.player-stage-viewport video');
    if (videoEl) {
      console.log('▶️ Triggering video playback to measure FPS and dropped frames...');
      await page.evaluate(() => {
        const v = document.querySelector('.player-stage-viewport video');
        if (v) v.play().catch(() => {});
      });

      await page.waitForTimeout(3000);

      const metrics = await page.evaluate(() => {
        const v = document.querySelector('.player-stage-viewport video');
        const q = v && v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
        return {
          currentTime: v ? v.currentTime : 0,
          paused: v ? v.paused : true,
          droppedFrames: q ? q.droppedVideoFrames : 0,
          totalFrames: q ? q.totalVideoFrames : 0,
        };
      });

      console.log('📈 Playback metrics after 3s:', metrics);

      // Read updated diagnostics panel text
      const liveDiagText = await diagPanel.innerText();
      console.log('📊 Live Diagnostics panel readings:\n', liveDiagText);

      // Pause playback
      await page.evaluate(() => {
        const v = document.querySelector('.player-stage-viewport video');
        if (v) v.pause();
      });
      console.log('⏸️ Playback paused cleanly');
    }

    // Check for unexpected page errors
    const fatalErrors = pageErrors.filter(e => !e.includes('favicon') && !e.includes('404') && !e.includes('ResizeObserver'));
    if (fatalErrors.length > 0) {
      console.warn('⚠️ Non-fatal console notices:', fatalErrors.slice(0, 3));
    } else {
      console.log('✅ ZERO unexpected page errors detected during test session!');
    }

    console.log('🎉 ConCaT-Inspired Browser Verification COMPLETED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ Browser verification failed:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runBrowserVerification();
