const { chromium } = require('playwright');
const https = require('https');
const http = require('http');
const path = require('path');

// --- SECURE CONFIGURATION (READ FROM CLOUD SETTINGS) ---
const PRODUCT_URL = process.env.PRODUCT_URL;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; 
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; 
// -------------------------------------------------------

let outOfStockCounter = 0; 

// Keep-alive server for Render's Free Tier
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Monitor is running completely securely via Telegram!\n');
}).listen(process.env.PORT || 3000);

function sendTelegramNotification(message) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('[Telegram Error]: Missing secure environment variables!');
    return;
  }

  const data = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'Markdown'
  });

  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
  };

  const req = https.request(options, (res) => {
    let responseBody = '';
    res.on('data', (chunk) => { responseBody += chunk; });
    res.on('end', () => {});
  });

  req.on("error", (err) => { console.error("[Telegram Network Error]: " + err.message); });
  req.write(data);
  req.end();
}

function sendTelegramPhoto(screenshotBuffer, captionText) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;

  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const payloadHeader = 
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="chat_id"\r\n\r\n${TELEGRAM_CHAT_ID}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="caption"\r\n\r\n${captionText}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="photo"; filename="screenshot.jpg"\r\n` +
    `Content-Type: image/jpeg\r\n\r\n`;

  const payloadFooter = `\r\n--${boundary}--\r\n`;

  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_TOKEN}/sendPhoto`,
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
  };

  const req = https.request(options, (res) => {
    let responseBody = '';
    res.on('data', (chunk) => { responseBody += chunk; });
    res.on('end', () => {});
  });

  req.on("error", (err) => { console.error("[Telegram Media Network Error]: " + err.message); });
  req.write(Buffer.from(payloadHeader, 'utf-8'));
  req.write(screenshotBuffer);
  req.write(Buffer.from(payloadFooter, 'utf-8'));
  req.end();
}

async function logPageScreenshot(page, logTitle) {
  try {
    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 40 }); // Lowered quality to save network RAM buffer
    const base64Image = screenshotBuffer.toString('base64');
    console.log(`\n--- 📸 BASE64 SCREENSHOT BEGIN [${logTitle}] ---`);
    console.log(`data:image/jpeg;base64,${base64Image}`);
    console.log(`--- 📸 BASE64 SCREENSHOT END [${logTitle}] ---\n`);
    return screenshotBuffer;
  } catch (error) {
    console.error('⚠️ Failed to capture visual snapshot:', error.message);
    return null;
  }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function checkStockOnce() {
  if (!PRODUCT_URL) {
    console.error('[Configuration Error]: No PRODUCT_URL provided in Environment Variables!');
    process.exit(1);
  }

  const customExecutablePath = path.resolve(
    __dirname, 'ms-playwright', 'chromium_headless_shell-1234', 'chrome-headless-shell-linux64', 'chrome-headless-shell'
  );

  let browser;
  let context;
  let page;
  let statusResult = { shouldCoolDown: false };

  try {
    // Spin up clean instance
    browser = await chromium.launch({ executablePath: customExecutablePath, headless: true });
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 }
    });
    page = await context.newPage();

    await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });

    const productTitleExists = await page.$('#productTitle');

    if (!productTitleExists) {
      console.log(`[${new Date().toLocaleTimeString()}] ⚠️ Verification Blocked: Encountered a CAPTCHA.`);
      await logPageScreenshot(page, 'VERIFICATION_BLOCKED');
      statusResult.shouldCoolDown = false;
    } else {
      const outOfStockElement = await page.$('#outOfStock, .a-color-price:has-text("Currently unavailable")');

      if (outOfStockElement) {
        outOfStockCounter++;
        console.log(`[${new Date().toLocaleTimeString()}] ❌ Item is still out of stock.`);
        if (outOfStockCounter % 2 === 0) {
          await logPageScreenshot(page, `OUT_OF_STOCK_LOOP_${outOfStockCounter}`);
        }
      } else {
        const alertMsg = `🚨 *ALERT! YOUR MONITORED ITEM MIGHT BE IN STOCK!* 🚨\nBuy immediately here: ${PRODUCT_URL}`;
        console.log(`\n${alertMsg}\n`);
        const inStockBuffer = await page.screenshot({ type: 'jpeg', quality: 60 });
        sendTelegramPhoto(inStockBuffer, `🎯 IN-STOCK PROOF SNAPSHOT!\n\nLink: ${PRODUCT_URL}`);
        sendTelegramNotification(alertMsg);
      }
    }
  } catch (error) {
    console.error(`[${new Date().toLocaleTimeString()}] ⚠️ Loop Error:`, error.message);
  } finally {
    // 💥 CRITICAL RECOVERY: Force kill the browser and empty OS threads every single iteration loop
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    
    // Explicit global garbage cleanup hint for Node runtime environments
    if (global.gc) global.gc();
  }

  return statusResult;
}

async function startMonitor() {
  console.log('🚀 Secure Leak-Proof Cloud Stock Monitor Initializing...');
  
  while (true) {
    const outcome = await checkStockOnce();

    if (outcome.shouldCoolDown) {
      console.log(`[${new Date().toLocaleTimeString()}] ⏳ Initiating a 2-minute safety pause to reset bot threshold profile...`);
      await delay(120000); 
    } else {
      const randomInterval = 7000 + Math.floor(Math.random() * 5000); // 7-12 second relaxed throttle to conserve Free tier CPU
      await delay(randomInterval);
    }
  }
}

startMonitor();
