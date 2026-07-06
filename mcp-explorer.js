import { chromium } from 'playwright';

// This function acts as the target for MCP tools to execute commands
export async function runExplorerStep(actionType, targetSelector, value = '') {
  const browser = await chromium.launch({ headless: false }); // Headless false so you can see it!
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Replace with your local application URL
    await page.goto('https://chas-stage.collegehouses.upenn.edu/chasdatahub-demo/home.cfm'); 
    
    if (actionType === 'click') {
      await page.click(targetSelector);
    } else if (actionType === 'fill') {
      await page.fill(targetSelector, value);
    }
    
    // Keep open briefly so MCP can evaluate the state
    await page.waitForTimeout(2000); 
    return await page.content(); // Returns HTML state back to LLM
  } finally {
    await browser.close();
  }
}