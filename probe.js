import { chromium } from 'playwright';

const url = 'https://chas-stage.collegehouses.upenn.edu/chasdatahub-demo/home.cfm';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });

  const selectors = [
    'input[type=password]',
    'input[type=text]',
    'input[type=email]',
    'input[name*=\"user\" i]',
    'input[name*=\"email\" i]',
    'input[name*=\"pass\" i]',
    'button',
    'input[type=submit]',
    'input[type=button]'
  ];

  for (const sel of selectors) {
    const elements = await page.locator(sel).elementHandles();
    if (elements.length > 0) {
      console.log(`\nSelector: ${sel} -> ${elements.length} element(s)`);
      for (let i = 0; i < elements.length; i++) {
        const info = await elements[i].evaluate(el => ({
          tag: el.tagName,
          id: el.id,
          name: el.name,
          type: el.type,
          placeholder: el.placeholder,
          value: el.value,
          innerText: el.innerText.trim().slice(0, 100),
          class: el.className,
          ariaLabel: el.getAttribute('aria-label')
        }));
        console.log(JSON.stringify(info, null, 2));
      }
    }
  }

  await browser.close();
})();
