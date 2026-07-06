import 'dotenv/config';
import { chromium } from 'playwright';
import { existsSync } from 'fs';

const HOME_URL = 'https://chas-stage.collegehouses.upenn.edu/chasdatahub-demo/home.cfm';
const INCIDENTS_URL = 'https://chas-stage.collegehouses.upenn.edu/chasdatahub-demo/views/incidents/dsp_index.cfm?m=1&s=1';
const AUTH_STATE_PATH = 'auth-state.json';
const HEADLESS = process.env.HEADLESS === 'true';

// Verified live against the stage app's "Location Date & Time" college house dropdown.
const COLLEGE_HOUSES = [
  { label: 'Du Bois: W.E.B. DuBois', value: '57' },
  { label: 'Harnwell: Harnwell', value: '53' },
  { label: 'Harrison: Harrison', value: '54' },
  { label: 'Hill: Hill', value: '60' },
  { label: 'Gutmann College House: Gutmann College House', value: '67' },
  { label: 'Ware: Morgan', value: '29' },
  { label: 'Stouffer: Mayer Hall', value: '50' },
  { label: 'Riepe: Warwick', value: '38' },
];

const DESCRIPTIONS = [
  'Excessive noise complaint reported near the common area.',
  'Resident reported a strong odor coming from a nearby room.',
  'Report of an unauthorized guest in the building after hours.',
  'Maintenance issue reported affecting a shared space.',
  'Minor property damage observed in a common area.',
  'Resident reported a policy violation involving common area use.',
  'Report of a suspicious individual near the building entrance.',
  'Noise disturbance reported during quiet hours.',
];

function randomChoice(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomRecentDateTime(daysBack = 7) {
  const now = new Date();
  const start = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const randomTime = new Date(start.getTime() + Math.random() * (now.getTime() - start.getTime()));
  const pad = (n) => String(n).padStart(2, '0');
  return `${randomTime.getFullYear()}-${pad(randomTime.getMonth() + 1)}-${pad(randomTime.getDate())}T${pad(randomTime.getHours())}:${pad(randomTime.getMinutes())}`;
}

function generateRandomIncident() {
  const house = randomChoice(COLLEGE_HOUSES);
  return {
    dateTime: randomRecentDateTime(),
    house,
    room: `Room ${100 + Math.floor(Math.random() * 300)}`,
    description: randomChoice(DESCRIPTIONS),
  };
}

async function performLogin(page) {
  await page.goto(HOME_URL, { waitUntil: 'networkidle' });

  const usernameField = page.locator('input[name="j_username"]');
  const isLoggedIn = await usernameField.isVisible({ timeout: 5000 }).catch(() => false);
  if (!isLoggedIn) {
    // Already authenticated via a valid session.
    return;
  }

  const username = process.env.CHAS_USERNAME;
  const password = process.env.CHAS_PASSWORD;
  if (!username || !password) {
    throw new Error('Missing CHAS_USERNAME or CHAS_PASSWORD. Add them to the .env file before running.');
  }

  await usernameField.fill(username);
  await page.locator('input[name="j_password"]').fill(password);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }),
    page.click('button[name="_eventId_proceed"]'),
  ]);

  console.log('📱 Duo push sent — approve it on your device...');
  await page.waitForURL((url) => url.toString().includes('collegehouses.upenn.edu'), { timeout: 90000 });
  await page.getByRole('link', { name: 'Incidents' }).waitFor({ state: 'visible', timeout: 15000 });
  console.log('✅ Logged in.');
}

async function createRandomIncident(page, data) {
  await page.goto(INCIDENTS_URL, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Create Incident Report' }).click();
  await page.waitForURL((url) => url.toString().includes('dsp_add_incident.cfm'), { timeout: 15000 });

  const incID = new URL(page.url()).searchParams.get('incID');
  console.log(`📝 Created draft incident #${incID}`);

  // --- Location Date & Time ---
  await page.getByRole('tab', { name: 'Location Date & Time' }).click();
  await page.getByLabel('Date and Time').fill(data.dateTime);
  await page.getByRole('radio', { name: 'College Houses or Sansom Place' }).check({ force: true });
  await page.getByRole('combobox').selectOption(data.house.value);
  await page.getByPlaceholder('Room or Location').fill(data.room);
  await page.getByRole('button', { name: 'Save Time & Location' }).click();
  await page.getByText('Incident Updated Successfully').first().waitFor({ timeout: 10000 });
  console.log(`📍 Saved location: ${data.house.label} — ${data.room}`);

  // --- People (None/Unknown — avoids looking up real student/staff records for synthetic data) ---
  await page.getByRole('tab', { name: 'People' }).click();
  await page.getByRole('button', { name: 'None/Unknown' }).click();
  await page.getByRole('textbox').last().fill('UNKNOWN - identity not determined at time of report');
  await page.getByRole('button', { name: 'Add Description' }).click();
  await page.getByText('Unknown Personnel inserted successfully').first().waitFor({ timeout: 10000 });
  await page.keyboard.press('Escape');
  console.log('👤 Added None/Unknown person.');

  // --- Summary ---
  await page.getByRole('tab', { name: 'Summary' }).click();
  await page.getByPlaceholder('Describe the incident here').fill(data.description);
  await page.getByRole('button', { name: 'Save Description' }).click();
  await page.getByText('Description inserted successfully').first().waitFor({ timeout: 10000 });
  console.log(`🖊️  Saved description: "${data.description}"`);

  // --- Review & Submit ---
  await page.getByRole('tab', { name: 'Review & Submit' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByRole('button', { name: 'Yes, Proceed' }).click();
  // The "Incident Submitted successfully" toast redirects almost immediately,
  // so the reliable success signal is landing back on the incidents list.
  await page.waitForURL((url) => url.toString().includes('dsp_index.cfm'), { timeout: 15000 });
  console.log(`✅ Incident #${incID} submitted successfully.`);

  return incID;
}

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = existsSync(AUTH_STATE_PATH)
    ? await browser.newContext({ storageState: AUTH_STATE_PATH })
    : await browser.newContext();
  const page = await context.newPage();

  try {
    await performLogin(page);
    await context.storageState({ path: AUTH_STATE_PATH });

    const incidentData = generateRandomIncident();
    await createRandomIncident(page, incidentData);
  } catch (error) {
    console.error('❌ An error occurred:', error);
    await page.screenshot({ path: 'error-screenshot.png' }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
