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

const ELSEWHERE_ON_CAMPUS_SPECIFICS = [
  'Near the quad',
  'Outside the library',
  'Parking Lot C',
  'Campus green space behind the gym',
  'Bus stop on Locust Walk',
];

const OFF_CAMPUS_SPECIFICS = [
  'Nearby apartment on Walnut Street',
  'Local restaurant off campus',
  'Off-campus house party',
  'Sidewalk near campus perimeter',
  'Off-campus parking garage',
];

// "Search Student" looks up the app's own directory. Verified this is synthetic
// demo data (e.g. emails like "zara.ali.demo@collegehouses.example"), not real
// students — the app is the -demo instance and shows a "Mode: Demo" badge.
const STUDENT_SEARCH_LETTERS = ['a', 'b', 'c', 'e', 'j', 'k', 'l', 'm', 'r', 's', 't'];

// University Personnel / Non-Penncard Persons are free-text manual entry (no
// directory lookup), so any fabricated name here is inherently synthetic.
const FAKE_FIRST_NAMES = ['Alex', 'Jordan', 'Casey', 'Morgan', 'Riley', 'Sam', 'Taylor', 'Drew'];
const FAKE_LAST_NAMES = ['Smith', 'Johnson', 'Garcia', 'Chen', 'Patel', 'Brown', 'Davis', 'Lee'];
const PERSONNEL_TYPES = ['Allied Guard', 'MERT/EMT/Ambulance', 'Fire Department', 'Penn Police', 'Facilities', 'University Official'];
const NON_PENNCARD_CLASSIFICATIONS = ['Parent/Family', 'Visitor/Guest'];

// "CHAS/RHS Team Member" also looks up a real directory, but a small one —
// verified staff there use the same sequential-fake-ID pattern as the
// synthetic students (PennIDs like 91000001, 91000002).
const CHAS_DEPARTMENTS = ['CHAS Admin', 'Gregory', 'Harnwell', 'Stouffer'];

const PERSON_TYPES = ['unknown', 'student', 'personnel', 'nonpenncard', 'team'];

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

const LOCATION_TYPES = ['college', 'elsewhere', 'offcampus'];

function generateRandomIncident() {
  const locationType = randomChoice(LOCATION_TYPES);
  const base = {
    dateTime: randomRecentDateTime(),
    description: randomChoice(DESCRIPTIONS),
    locationType,
  };

  if (locationType === 'college') {
    return {
      ...base,
      house: randomChoice(COLLEGE_HOUSES),
      room: `Room ${100 + Math.floor(Math.random() * 300)}`,
    };
  }
  if (locationType === 'elsewhere') {
    return { ...base, specifics: randomChoice(ELSEWHERE_ON_CAMPUS_SPECIFICS) };
  }
  return { ...base, specifics: randomChoice(OFF_CAMPUS_SPECIFICS) };
}

// The app's #searchPeopleModal intermittently gets left with a stray "show"
// class — sometimes even before we've opened any modal ourselves. Neither
// Escape nor manually stripping the "show" class reliably dismisses it (the
// latter actively made things worse: Bootstrap's JS keeps its own internal
// "is this modal shown" state, and hacking the class externally desyncs it
// from that state instead of fixing anything). Clicking the modal's real
// Close button is the one path that goes through the app's own close logic.
async function ensureNoModalOpen(page) {
  const openModal = page.locator('.modal.show').first();
  if ((await openModal.count()) === 0) return;
  await openModal.getByRole('button', { name: 'Close' }).first().click({ timeout: 2000 }).catch(() => {});
  await openModal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
}

async function closePersonModal(page) {
  await ensureNoModalOpen(page);
}

// Every added person gets a reviewCard_<id> element — it's actually part of
// the Review & Submit tab's live preview, which the app keeps in sync via a
// background AJAX call independent of the success toast on the People tab.
// That call can lag slightly behind the toast, so reading .last() right after
// the toast can still return the *previous* card. countPersonCards()/
// waitForNewPersonCard() bracket each add so we wait for the count to
// actually increase before reading, avoiding that race. The card is also
// legitimately CSS-hidden while we're on the People tab (its tab-pane lacks
// the "show" class), so this reads via textContent() rather than innerText().
// Its header either contains a P-Number — for Students, None/Unknown, and
// Non-Penncard Persons, per the app's own anonymization convention — or just
// a plain name — for University Personnel and CHAS/RHS Team Member, who
// aren't anonymized.
function countPersonCards(page) {
  return page.locator('[id^="reviewCard_"]').count();
}

async function waitForNewPersonCard(page, previousCount) {
  await page.waitForFunction(
    (prevCount) => document.querySelectorAll('[id^="reviewCard_"]').length > prevCount,
    previousCount,
    { timeout: 8000 },
  );
  const card = page.locator('[id^="reviewCard_"]').last();
  const headerText = (await card.locator('.card-header').textContent()).replace(/\s+/g, ' ').trim();
  const pMatch = headerText.match(/\(P(\d+)\)/);
  if (pMatch) {
    const name = headerText.replace(/\(P\d+\)/, '').replace(/:\s*$/, '').trim();
    return { pNumber: `P${pMatch[1]}`, name };
  }
  const name = headerText.replace(/:\s*\d+\s*$/, '').replace(/:\s*$/, '').trim();
  return { pNumber: null, name };
}

function formatPersonReference({ pNumber, name }) {
  return pNumber ? `${pNumber} (${name})` : name;
}

async function addUnknownPerson(page) {
  await ensureNoModalOpen(page);
  const before = await countPersonCards(page);
  await page.getByRole('button', { name: 'None/Unknown', exact: true }).click();
  await page.getByRole('textbox').last().fill('UNKNOWN - identity not determined at time of report');
  await page.getByRole('button', { name: 'Add Description' }).click();
  await page.getByText('Unknown Personnel inserted successfully').first().waitFor({ timeout: 10000 });
  const person = await waitForNewPersonCard(page, before);
  await closePersonModal(page);
  return { label: 'None/Unknown', reference: formatPersonReference(person), countsAsInvolved: true };
}

async function addUniversityPersonnel(page) {
  const first = randomChoice(FAKE_FIRST_NAMES);
  const last = randomChoice(FAKE_LAST_NAMES);
  const personnelType = randomChoice(PERSONNEL_TYPES);

  await ensureNoModalOpen(page);
  const before = await countPersonCards(page);
  await page.getByRole('button', { name: 'University Personnel', exact: true }).click();
  await page.getByRole('textbox', { name: 'First Name' }).fill(first);
  await page.getByRole('textbox', { name: 'Last Name' }).fill(last);
  await page.getByRole('radio', { name: personnelType }).check({ force: true });
  await page.getByRole('button', { name: 'Add Person' }).click();
  await page.getByText('University Personnel inserted successfully').first().waitFor({ timeout: 10000 });
  const person = await waitForNewPersonCard(page, before);
  await closePersonModal(page);
  return { label: `University Personnel (${personnelType}): ${first} ${last}`, reference: formatPersonReference(person), countsAsInvolved: true };
}

async function addNonPenncardPerson(page) {
  const first = randomChoice(FAKE_FIRST_NAMES);
  const last = randomChoice(FAKE_LAST_NAMES);
  const classification = randomChoice(NON_PENNCARD_CLASSIFICATIONS);

  await ensureNoModalOpen(page);
  const before = await countPersonCards(page);
  await page.getByRole('button', { name: 'Non-Penncard Persons', exact: true }).click();
  await page.getByRole('textbox', { name: 'First Name' }).fill(first);
  await page.getByRole('textbox', { name: 'Last Name' }).fill(last);
  await page.getByRole('radio', { name: classification }).check({ force: true });
  await page.getByRole('button', { name: 'Add Person' }).click();
  await page.getByText('Non PennCard Personnel inserted successfully').first().waitFor({ timeout: 10000 });
  const person = await waitForNewPersonCard(page, before);
  await closePersonModal(page);
  return { label: `Non-Penncard Person (${classification}): ${first} ${last}`, reference: formatPersonReference(person), countsAsInvolved: true };
}

// Clicking ADD on a directory result that's already on the incident doesn't
// throw — it shows a *separate* "Cannot insert duplicate ..." alert while the
// earlier success toast (from a prior add) is still sitting in the DOM with
// its old text. Matching on the success text alone is a false positive in
// that case, so explicitly check for the duplicate error first.
async function clickAddAndConfirm(page, addButton, successText) {
  await addButton.click();
  await page.waitForTimeout(800);
  const isDuplicate = await page.getByText(/cannot insert duplicate/i).first().isVisible().catch(() => false);
  if (isDuplicate) return false;
  await page.getByText(successText).first().waitFor({ timeout: 10000 });
  return true;
}

// Searches the app's own demo student directory and adds a random match.
// Retries with different name letters/houses/results since not every combo
// hits, and a repeated combo can land on someone already added.
async function tryAddRandomStudent(page, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    await ensureNoModalOpen(page);
    await page.getByRole('button', { name: 'Search Student', exact: true }).click();
    await page.getByRole('button', { name: 'Search By Name / PennID' }).click();

    const house = randomChoice(COLLEGE_HOUSES);
    const houseSearchLabel = house.label.split(':')[0].trim();
    await page.getByRole('textbox', { name: 'Last Name' }).fill(randomChoice(STUDENT_SEARCH_LETTERS));
    await page.getByRole('combobox', { name: 'House' }).selectOption({ label: houseSearchLabel });
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForTimeout(800);

    const addButtons = page.getByRole('button', { name: 'ADD' });
    const count = await addButtons.count();
    if (count > 0) {
      const index = Math.floor(Math.random() * count);
      const before = await countPersonCards(page);
      const added = await clickAddAndConfirm(page, addButtons.nth(index), 'inserted successfully');
      if (added) {
        const person = await waitForNewPersonCard(page, before);
        await closePersonModal(page);
        return { label: `Student (${houseSearchLabel})`, reference: formatPersonReference(person), countsAsInvolved: true };
      }
      await closePersonModal(page);
      continue;
    }

    await closePersonModal(page);
  }
  return null;
}

// Searches the app's own (small) CHAS/RHS staff directory and adds a random
// match. Retries across departments/results since the pool is tiny and a
// repeated pick can land on someone already added.
async function tryAddTeamMember(page, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    await ensureNoModalOpen(page);
    await page.getByRole('button', { name: 'CHAS/RHS Team Member', exact: true }).click();

    const department = randomChoice(CHAS_DEPARTMENTS);
    await page.getByRole('combobox').selectOption({ label: department });
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForTimeout(800);

    const addButtons = page.getByRole('button', { name: 'ADD' });
    const count = await addButtons.count();
    if (count > 0) {
      const index = Math.floor(Math.random() * count);
      const before = await countPersonCards(page);
      const added = await clickAddAndConfirm(page, addButtons.nth(index), 'Staff inserted successfully');
      if (added) {
        const person = await waitForNewPersonCard(page, before);
        await closePersonModal(page);
        // Verified live: unlike the other four types, a Team Member alone does
        // NOT satisfy the app's "Involved person(s)" requirement — it's an
        // ancillary staff reference, not the actual involved party.
        return { label: `CHAS/RHS Team Member (${department})`, reference: formatPersonReference(person), countsAsInvolved: false };
      }
      await closePersonModal(page);
      continue;
    }

    await closePersonModal(page);
  }
  return null;
}

async function addRandomPerson(page) {
  const type = randomChoice(PERSON_TYPES);

  if (type === 'student') {
    const result = await tryAddRandomStudent(page);
    if (result) return result;
    // No search hits after retries — fall back to a guaranteed-safe option.
  }
  if (type === 'team') {
    const result = await tryAddTeamMember(page);
    if (result) return result;
  }
  if (type === 'personnel') return addUniversityPersonnel(page);
  if (type === 'nonpenncard') return addNonPenncardPerson(page);
  return addUnknownPerson(page);
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

  let locationLabel;
  if (data.locationType === 'college') {
    await page.getByRole('radio', { name: 'College Houses or Sansom Place' }).check({ force: true });
    await page.getByRole('combobox').selectOption(data.house.value);
    await page.getByPlaceholder('Room or Location').fill(data.room);
    locationLabel = `${data.house.label} — ${data.room}`;
  } else if (data.locationType === 'elsewhere') {
    await page.getByRole('radio', { name: 'Elsewhere on campus' }).check({ force: true });
    await page.getByPlaceholder('Location Specifics').nth(0).fill(data.specifics);
    locationLabel = `Elsewhere on campus — ${data.specifics}`;
  } else {
    await page.getByRole('radio', { name: 'Off-campus' }).check({ force: true });
    await page.getByPlaceholder('Location Specifics').nth(1).fill(data.specifics);
    locationLabel = `Off-campus — ${data.specifics}`;
  }

  await page.getByRole('button', { name: 'Save Time & Location' }).click();
  await page.getByText('Incident Updated Successfully').first().waitFor({ timeout: 10000 });
  console.log(`📍 Saved location: ${locationLabel}`);

  // --- People ---
  await page.getByRole('tab', { name: 'People' }).click();
  const peopleCount = 1 + Math.floor(Math.random() * 3); // 1-3 people
  const people = [];
  for (let i = 0; i < peopleCount; i++) {
    const person = await addRandomPerson(page);
    people.push(person);
    console.log(`👤 Added person: ${person.label}`);
  }
  // A CHAS/RHS Team Member alone doesn't satisfy the app's "Involved
  // person(s)" requirement (verified live), so if every random pick landed on
  // that type, add one guaranteed-valid person too.
  if (!people.some((p) => p.countsAsInvolved)) {
    const person = await addUnknownPerson(page);
    people.push(person);
    console.log(`👤 Added person: ${person.label} (ensuring a qualifying involved person)`);
  }

  // --- Summary ---
  // The app's own help text asks descriptions to cite each involved person by
  // P-Number (for Students/None-Unknown/Non-Penncard) or name (for staff), so
  // fold every added person's reference into the description.
  const peopleClause = `Involved: ${people.map((p) => p.reference).join('; ')}.`;
  const fullDescription = `${data.description} ${peopleClause}`;

  await page.getByRole('tab', { name: 'Summary' }).click();
  await page.getByPlaceholder('Describe the incident here').fill(fullDescription);
  await page.getByRole('button', { name: 'Save Description' }).click();
  await page.getByText('Description inserted successfully').first().waitFor({ timeout: 10000 });
  console.log(`🖊️  Saved description: "${fullDescription}"`);

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
