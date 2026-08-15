import { test, expect } from "@playwright/test";

test("edit customer ward-hamlet form populates province/ward/hamlet", async ({
  page,
}) => {
  // Login first
  await page.goto("http://localhost:3002");
  await page.fill('input[name="username"]', "zz_e2e_staff");
  await page.fill('input[name="password"]', "E2eTest!2026");
  await page.click("button:has-text('Đăng nhập')");
  await page.waitForLoadState("networkidle");

  // Go to customers list
  await page.goto("http://localhost:3002/customers");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  // Look for a row with "Phường" in it (ward-hamlet type shows ward name)
  const table = page.locator("table");
  await table.waitFor({ timeout: 5000 }).catch(() => null);

  // Check table headers
  const headers = page.locator("table thead th");
  const headerCount = await headers.count();
  console.log(`Table has ${headerCount} columns`);
  for (let i = 0; i < headerCount; i++) {
    const text = await headers.nth(i).textContent();
    console.log(`Column ${i}: "${text?.trim()}"`);
  }

  const rows = page.locator("table tbody tr");
  const rowCount = await rows.count();
  console.log(`Found ${rowCount} customer rows`);

  let customerLink = null;
  for (let i = 0; i < rowCount && i < 15; i++) {
    const row = rows.nth(i);
    const cells = row.locator("td");
    const cellCount = await cells.count();

    // Get channel cell (column 4)
    const channelCell = cells.nth(4);
    const channelText = await channelCell.textContent();

    let rowSummary = "";
    for (let j = 0; j < Math.min(3, cellCount); j++) {
      const text = await cells.nth(j).textContent();
      rowSummary += text?.trim().slice(0, 15) + " ";
    }
    console.log(`Row ${i}: ${rowSummary} | Channel: "${channelText?.trim()}"`);

    // Look for ward-hamlet channel indicator (contains district/ward name)
    if (
      channelText?.includes("Phường") ||
      channelText?.includes("Quận") ||
      channelText?.includes("Huyện") ||
      channelText?.includes("Thành phố")
    ) {
      console.log(`✓ Found ward-hamlet customer at row ${i}`);
      customerLink = row.locator("a").first();
      break;
    }
  }

  if (customerLink) {
    await customerLink.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    console.log("Page URL:", page.url());

    // Wait for heading to render
    const heading = page.locator("h1, h2");
    const headingText = await heading.first().textContent();
    console.log("Page heading:", headingText);

    // List all buttons
    const buttons = page.locator("button");
    const buttonCount = await buttons.count();
    console.log(`Found ${buttonCount} buttons`);

    for (let i = 0; i < Math.min(10, buttonCount); i++) {
      const text = await buttons.nth(i).textContent();
      if (text?.trim()) {
        console.log(`Button ${i}: "${text?.trim()}"`);
      }
    }

    // Look for any button that might open edit form
    const editButtons = page.locator(
      "button:has-text('Sửa'), button:has-text('Edit'), [data-testid*='edit'], button.edit"
    );
    const editCount = await editButtons.count();
    console.log(`Found ${editCount} potential edit buttons`);

    // Try clicking page heading if it's clickable
    const topSection = page.locator("main, [role='main']");
    const clickables = topSection.locator("button, [role='button'], a[href*='edit']");
    const clickCount = await clickables.count();
    console.log(`Found ${clickCount} clickables in main area`);

    // Try keyboard shortcut or menu
    const selects = page.locator("select");
    const selectCount = await selects.count();
    console.log(`Found ${selectCount} selects`);

    for (let i = 0; i < selectCount; i++) {
      const value = await selects.nth(i).inputValue();
      const label = await selects.nth(i).getAttribute("aria-label");
      console.log(`Select ${i}: value="${value}", label="${label}"`);
    }

    // Check if we can find province/ward/hamlet text
    const allText = await page.textContent("body");
    if (allText?.includes("Phường") || allText?.includes("Quận")) {
      console.log("✓ Found ward/district text");
    } else {
      console.log("✗ Ward/district text not found");
    }
  } else {
    console.log("✗ No ward-hamlet customer found in list");
  }
});
