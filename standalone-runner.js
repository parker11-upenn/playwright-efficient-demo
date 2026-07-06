import 'dotenv/config';
import { chromium } from 'playwright';
import { promises as fs } from 'fs';

function getRandomDateTimeLocal(maxDateStr) {
  const maxDate = new Date(maxDateStr);
  const now = new Date();
  const end = now < maxDate ? now : maxDate;
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const randomTime = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  const year = randomTime.getFullYear();
  const month = String(randomTime.getMonth() + 1).padStart(2, '0');
  const day = String(randomTime.getDate()).padStart(2, '0');
  const hours = String(randomTime.getHours()).padStart(2, '0');
  const minutes = String(randomTime.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

(async () => {
  console.log('🚀 Launching standalone browser in debug mode...');
  
  // 1. Launch with devtools open so you can inspect elements manually
  const browser = await chromium.launch({ 
    headless: false,
    devtools: true 
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 2. Navigate to your staging environment
    const targetUrl = 'https://chas-stage.collegehouses.upenn.edu/chasdatahub-demo/home.cfm';
    console.log(`🌐 Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle' });

    const loginFormSelector = 'form#loginform';
    const usernameSelector = 'input[name="j_username"]';
    const passwordSelector = 'input[name="j_password"]';
    const loginButtonSelector = 'button[name="_eventId_proceed"]';

    await page.waitForSelector(loginFormSelector, { state: 'visible', timeout: 10000 });
    await page.waitForSelector(passwordSelector, { state: 'visible', timeout: 10000 });
    console.log(`✅ Login screen loaded; found login form at ${loginFormSelector}, username at ${usernameSelector}, and password at ${passwordSelector}`);

    const username = process.env.CHAS_USERNAME;
    const password = process.env.CHAS_PASSWORD;

    if (!username || !password) {
      throw new Error('Missing CHAS_USERNAME or CHAS_PASSWORD. Add them to the .env file before running.');
    }

    await page.fill(usernameSelector, username);
    await page.fill(passwordSelector, password);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }),
      page.click(loginButtonSelector),
    ]);

    console.log('📱 Duo 2FA detected! Please approve the push notification on your device...');

    const loggedInUrl = await page.waitForURL(
      url => url.toString().includes('collegehouses.upenn.edu'),
      { timeout: 60000 }
    );

    console.log(`✅ Redirected back to collegehouses.upenn.edu: ${loggedInUrl}`);
    const dashboardHtml = await page.content();
    await fs.writeFile('dashboard-snapshot.html', dashboardHtml, 'utf8');
    console.log('✅ Dashboard snapshot written to dashboard-snapshot.html');

    const dashboardSelectors = [
      'text=Log out',
      'text=Logout',
      'text=Dashboard',
      'text=Home',
      'text=Welcome',
    ];

    let verifiedSelector = null;
    for (const selector of dashboardSelectors) {
      if (await page.locator(selector).count() > 0) {
        verifiedSelector = selector;
        break;
      }
    }

    if (!verifiedSelector) {
      throw new Error(
        `Post-login verification failed: current URL=${page.url()}. No dashboard marker found.`
      );
    }

    console.log(`✅ Submitted login form and verified post-login marker: ${verifiedSelector} on ${loggedInUrl}`);

    const incidentsTabSelector = 'a:has-text("Incidents")';
    await page.waitForSelector(incidentsTabSelector, { state: 'visible', timeout: 10000 });
    console.log(`➡️ Navigating to Incidents via ${incidentsTabSelector}`);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
      page.click(incidentsTabSelector),
    ]);

    const incidentsHtml = await page.content();
    await fs.writeFile('incidents-snapshot.html', incidentsHtml, 'utf8');
    console.log('✅ Incident page snapshot written to incidents-snapshot.html');

    const createIncidentSelector = 'a.btn.btn-success.btn-icon-split:has-text("Create Incident Report")';
    await page.waitForSelector(createIncidentSelector, { state: 'visible', timeout: 10000 });
    console.log(`➡️ Clicking create incident link using ${createIncidentSelector}`);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
      page.click(createIncidentSelector),
    ]);

    const createIncidentHtml = await page.content();
    await fs.writeFile('create-incident-snapshot.html', createIncidentHtml, 'utf8');
    console.log('✅ Create incident page snapshot written to create-incident-snapshot.html');

    const dateTimeField = page.getByRole('textbox', { name: 'Date and Time' });
    await dateTimeField.waitFor({ state: 'visible', timeout: 10000 });
    const randomDateTime = getRandomDateTimeLocal('2026-07-06T10:23');
    console.log(`⏱️ Filling Date and Time with ${randomDateTime}`);
    await dateTimeField.fill(randomDateTime);

    await page.check('input#location1');
    await page.selectOption('select[name="LocID"]', '57');
    await page.fill('#roomLocation1', 'Room 101');
    console.log('📍 Filled location as College House and Room 101');

    await page.click('button#save_dateTime');
    console.log('💾 Clicked Save Time & Location');

    const createIncidentSavedHtml = await page.content();
    await fs.writeFile('create-incident-saved-snapshot.html', createIncidentSavedHtml, 'utf8');
    console.log('✅ Saved incident creation snapshot to create-incident-saved-snapshot.html');

    console.log('🔍 Pausing for exploration on the incident creation page.');
    await page.pause();
  } catch (error) {
    console.error('❌ An error occurred:', error);
  } finally {
    // Keeps the browser open for a few seconds after unpausing before closing
    await page.waitForTimeout(3000);
    await browser.close();
    console.log('🔒 Browser closed cleanly.');
  }
})();