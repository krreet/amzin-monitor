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
        console.log(`[Telegram Status]: Alert sent successfully.`);
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

// Helper function to log base64 data cleanly to Render console
async function logPageScreenshot(page, logTitle) {
  try {
    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 50 });
    const base64Image = screenshotBuffer.toString('base64');
    console.log(`\n--- 📸 BASE64 SCREENSHOT BEGIN [${logTitle}] ---`);
    console.log(`data:image/jpeg;base64,${base64Image}`);
    console.log(`--- 📸 BASE64 SCREENSHOT END [${logTitle}] ---\n`);
  } catch (error) {
    console.error('⚠️ Failed to capture visual snapshot:', error.message);
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

      // Check if Amazon loaded the main product page successfully
      const productTitleExists = await page.$('#productTitle');

      if (!productTitleExists) {
        console.log(`[${new Date().toLocaleTimeString()}] ⚠️ Verification Blocked: Encountered a CAPTCHA or security page.`);
        await logPageScreenshot(page, 'VERIFICATION_BLOCKED');
      } else {
        const outOfStockElement = await page.$('#outOfStock, .a-color-price:has-text("Currently unavailable")');

        if (outOfStockElement) {
          outOfStockCounter++;
          console.log(`[${new Date().toLocaleTimeString()}] ❌ Item is still out of stock.`);
          
          // Throttled: Print out-of-stock screenshot only once every 10 checks to avoid bloating log files
          if (outOfStockCounter % 10 === 0) {
            await logPageScreenshot(page, `OUT_OF_STOCK_LOOP_${outOfStockCounter}`);
          }
        } else {
          const alertMsg = `🚨 *ALERT! YOUR MONITORED ITEM MIGHT BE IN STOCK!* 🚨\nBuy immediately here: ${PRODUCT_URL}`;
          console.log(`\n${alertMsg}\n`);
          
          // Instantly dump the screenshot for verification
          await logPageScreenshot(page, 'IN_STOCK_CONFIRMED');
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
