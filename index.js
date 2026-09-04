const { chromium } = require('playwright');
const https = require('https');
const http = require('http');
const path = require('path');

// --- SECURE CONFIGURATION (READ FROM CLOUD SETTINGS) ---
const PRODUCT_URL = process.env.PRODUCT_URL;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; 
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; 
// -------------------------------------------------------

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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function monitorProduct() {
  if (!PRODUCT_URL) {
    console.error('[Configuration Error]: No PRODUCT_URL provided in Environment Variables!');
    process.exit(1);
  }

  console.log('🚀 Secure Cloud Stock Monitor Initializing...');

  // Target local browser binary compiled during Render's build step
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
      // Navigate to the target page link
      await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

      // 1. SAFETY VALIDATION STEP: Verify if Amazon actually loaded the real item description
      const productTitleExists = await page.$('#productTitle');

      if (!productTitleExists) {
        // If the main title is missing, Amazon likely served a CAPTCHA check or blocked the request
        console.log(`[${new Date().toLocaleTimeString()}] ⚠️ Verification Blocked: Encountered a CAPTCHA or security page. Skipping this loop to avoid false alarms.`);
      } else {
        // 2. PARSING STEP: Real product page loaded. Look for the actual unavailable flags.
        const outOfStockElement = await page.$('#outOfStock, .a-color-price:has-text("Currently unavailable")');

        if (outOfStockElement) {
          console.log(`[${new Date().toLocaleTimeString()}] ❌ Item is still out of stock.`);
        } else {
          // If the product title loaded perfectly, but outOfStock markers are gone: it is in stock!
          const alertMsg = `🚨 *ALERT! YOUR MONITORED ITEM MIGHT BE IN STOCK!* 🚨\nBuy immediately here: ${PRODUCT_URL}`;
          console.log(`\n${alertMsg}\n`);
          
          sendTelegramNotification(alertMsg);
        }
      }
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ⚠️ Error:`, error.message);
    }

    // Extended random interval to help bypass bot tracking algorithms (5 to 11 seconds)
    const randomInterval = 5000 + Math.floor(Math.random() * 6000);
    await delay(randomInterval);
  }
}

monitorProduct();
