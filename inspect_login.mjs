import { chromium } from 'playwright';

const url = 'https://chas-stage.collegehouses.upenn.edu/chasdatahub-demo/home.cfm';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { timeout: 60000 });
    console.log('status', response?.status());
    console.log('title', await page.title());
    const selectors = [
      'input[type=password]',
      'input[type=text]',
      'input[type=email]',
      'input[name*=\"user\" i]',
      'input[name*=\"email\" i]',
      'button',
      'input[type=submit]',
      'a',
      'form'
    ];
    for (const sel of selectors) {
      const loc = page.locator(sel);
      const count = await loc.count();
      console.log('checking', sel, 'count', count);
      if (count > 0) {
        const attrs = await loc.first().evaluate(el => ({
          tag: el.tagName,
          id: el.id,
          name: el.name,
          type: el.type,
          value: el.value,
          innerText: el.innerText.trim().slice(0, 100),
          placeholder: el.placeholder,
          class: el.className,
          ariaLabel: el.getAttribute('aria-label'),
        }));
        console.log('selector', sel, 'first', JSON.stringify(attrs));
        break;
      }
    }
  } catch (err) {
    console.error('error', err);
  } finally {
    await browser.close();
  }
})();
