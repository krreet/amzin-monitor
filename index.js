const { chromium } = require('playwright');
const https = require('https');
const http = require('http');
const path = require('path');

// --- SECURE CONFIGURATION (READ FROM CLOUD SETTINGS) ---
const PRODUCT_URL = process.env.PRODUCT_URL;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; 
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; 
// -------------------------------------------------------

let outOfStockCounter = 0; // Global counter to throttle out-of-stock screenshots

// Keep-alive server for Render's Free Tier
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Monitor is running completely securely via Telegram!\n');
}).listen(process.env.PORT || 3000);

// Unified function to send Markdown alerts to Telegram
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
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  const req = https.request(options, (res) => {
    let responseBody = '';
    res.on('data', (chunk) => { responseBody += chunk; });
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log(`[Telegram Status]: Message alert sent successfully.`);
      } else {
        console.error(`[Telegram Error]: Received status ${res.statusCode} - ${responseBody}`);
      }
    });
  });

  req.on("error", (err) => {
    console.error("[Telegram Network Error]: " + err.message);
  });

  req.write(data);
  req.end();
}

// ✨ New Function: Sends the actual binary browser screenshot file straight to Telegram chat
function sendTelegramPhoto(screenshotBuffer, captionText) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;

  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  
  // Build standard multi-part form payload to transport raw buffer files via API requests
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
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    }
  };

  const req = https.request(options, (res) => {
    let responseBody = '';
    res.on('data', (chunk) => { responseBody += chunk; });
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log(`[Telegram Status]: Image confirmation successfully delivered.`);
      } else {
        console.error(`[Telegram Error]: Photo upload hit status ${res.statusCode} - ${responseBody}`);
      }
    });
  });

  req.on("error", (err) => {
    console.error("[Telegram Media Network Error]: " + err.message);
  });

  // Write segments out cleanly to preserve data integrity of raw image array assets
  req.write(Buffer.from(payloadHeader, 'utf-8'));
  req.write(screenshotBuffer);
  req.write(Buffer.from(payloadFooter, 'utf-8'));
  req.end();
}

// Console logging platform for Base64 debugging architecture
async function logPageScreenshot(page, logTitle) {
  try {
    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 50 });
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

async function monitorProduct() {
  if (!PRODUCT_URL) {
    console.error('[Configuration Error]: No PRODUCT_URL provided in Environment Variables!');
    process.exit(1);
  }

  console.log('🚀 Secure Cloud Stock Monitor Initializing...');

  const customExecutablePath = path.resolve(
    __dirname, 
    'ms-playwright', 
    'chromium_headless_shell-1234', 
    'chrome-headless-shell-linux64', 
    'chrome-headless-shell'
  );

  const browser = await chromium.launch({ 
    executablePath: customExecutablePath,
    headless: true 
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  while (true) {
    try {
      await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

      const productTitleExists = await page.$('#productTitle');

      if (!productTitleExists) {
        console.log(`[${new Date().toLocaleTimeString()}] ⚠️ Verification Blocked: Encountered a CAPTCHA or security page.`);
        await logPageScreenshot(page, 'VERIFICATION_BLOCKED');
      } else {
        const outOfStockElement = await page.$('#outOfStock, .a-color-price:has-text("Currently unavailable")');

        if (outOfStockElement) {
          outOfStockCounter++;
          console.log(`[${new Date().toLocaleTimeString()}] ❌ Item is still out of stock.`);
          
          if (outOfStockCounter % 10 === 0) {
            await logPageScreenshot(page, `OUT_OF_STOCK_LOOP_${outOfStockCounter}`);
          }
        } else {
          const alertMsg = `🚨 *ALERT! YOUR MONITORED ITEM MIGHT BE IN STOCK!* 🚨\nBuy immediately here: ${PRODUCT_URL}`;
          console.log(`\n${alertMsg}\n`);
          
          // 1. Instantly generate a crisp layout screenshot buffer
          const inStockBuffer = await page.screenshot({ type: 'jpeg', quality: 75 });
          
          // 2. Deliver the graphic photo straight into your personal channel interface natively
          sendTelegramPhoto(inStockBuffer, `🎯 IN-STOCK PROOF SNAPSHOT!\n\nLink: ${PRODUCT_URL}`);
          sendTelegramNotification(alertMsg);
        }
      }
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ⚠️ Error:`, error.message);
    }

    const randomInterval = 5000 + Math.floor(Math.random() * 6000);
    await delay(randomInterval);
  }
}

monitorProduct();
