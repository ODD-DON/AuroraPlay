/**
 * MVP acceptance workflow through the real UI.
 * All listing data, comps, and prices below are TEST FIXTURES, not market data.
 */
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const PHOTO = path.join(import.meta.dirname, "fixtures", "listing-photo.jpg");
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Set SCREENSHOTS_DIR to capture review screenshots of populated screens. */
async function shot(page: Page, name: string) {
  if (process.env.SCREENSHOTS_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOTS_DIR, `${name}.png`), fullPage: true });
}

async function saveForm(page: Page, scope: ReturnType<Page["locator"]>, button: string, message: RegExp) {
  await scope.getByRole("button", { name: button }).click();
  await expect(page.getByText(message).first()).toBeVisible();
}

test("owner completes the resale workflow from import to realized profit", async ({ page }) => {
  // 1. First-run setup with the owner's defaults.
  await page.goto("/");
  await expect(page).toHaveURL(/onboarding/);
  await expect(page.getByLabel("Starting location")).toHaveValue("Lockport, Illinois");
  await page.getByRole("button", { name: "Start using Resale Radar" }).click();
  await expect(page).toHaveURL(/radar/);
  await expect(page.getByText("No live marketplace feed is connected yet")).toBeVisible();

  // 2. Import a real-shaped Facebook Marketplace listing with a photo.
  await page.goto("/import");
  await page.getByLabel("Listing URL").fill("https://www.facebook.com/marketplace/item/555666777888/?ref=share");
  await page.getByLabel("Title").fill("TEST FIXTURE Pioneer DDJ-FLX6 DJ controller");
  await page.getByLabel("Asking price").fill("300");
  await page.getByLabel("Category").selectOption("dj_equipment");
  await page.getByLabel("Seller location").fill("Joliet, IL");
  await page.getByLabel("Photos").setInputFiles(PHOTO);
  await page.getByLabel("One-way drive (minutes)").fill("16");
  await page.getByLabel("One-way distance (miles)").fill("10");
  await page.getByRole("button", { name: "Import and evaluate" }).click();
  await expect(page).toHaveURL(/\/deals\//);
  const dealUrl = page.url();
  await expect(page.locator('img[alt="Listing photo"]')).toHaveCount(1);

  // 3. Missing sold data is shown honestly.
  await expect(page.getByText("No verified sold data yet")).toBeVisible();
  await expect(page.getByText("Profit cannot be calculated yet")).toBeVisible();

  // 4. Record sold comparables with traceable sources.
  const prices = ["480", "495", "505", "510", "520", "530"];
  for (const [i, price] of prices.entries()) {
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Save comparable" }) });
    const toggle = page.getByRole("button", { name: "Add comparable sale" });
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    await form.getByLabel("Sold price").fill(price);
    await form.getByLabel("Sale date").fill(daysAgo(6 + i * 9));
    await form.getByLabel("Link or reference").fill(`https://www.ebay.com/itm/10000000000${i}`);
    await saveForm(page, form, "Save comparable", /Comparable saved/);
  }
  await expect(page.getByText("6 (moderate)")).toBeVisible();

  // 5. Demand evidence and liquidity.
  const demand = page.locator("form").filter({ has: page.getByRole("button", { name: "Save demand" }) });
  await demand.getByLabel("Sold (90d)").fill("45");
  await demand.getByLabel("Active now").fill("30");
  await saveForm(page, demand, "Save demand", /Demand data saved/);
  await expect(page.getByText("Highly liquid").first()).toBeVisible();

  // 6. Confirm facts the owner verified, including identity and testing.
  const facts = page.locator("form").filter({ has: page.getByRole("button", { name: "Save facts" }) });
  await facts.getByLabel("Identity").selectOption("verified");
  await facts.getByLabel("Condition confidence (%)").fill("85");
  await facts.getByLabel("Outbound shipping label (est.)").fill("28");
  await facts.getByLabel("Confirmed working").check();
  await saveForm(page, facts, "Save facts", /Saved and re-evaluated/);
  await expect(facts.getByLabel("Identity")).toHaveValue("verified");

  // 7. Realistic net profit, travel costs, and a maximum purchase price.
  await expect(page.getByText("Profit analysis at asking price")).toBeVisible();
  await expect(page.getByText("Maximum purchase price").first()).toBeVisible();
  await expect(page.getByText("Travel cost", { exact: true })).toBeVisible();
  await expect(page.getByText("Never above")).toBeVisible();
  await expect(page.getByText(/^(Strong Buy|Buy If Negotiated)$/).first()).toBeVisible();
  await shot(page, "deal-evaluated");

  // 8. Generate an offer and track the negotiation.
  await page.getByRole("button", { name: "Start negotiation" }).click();
  await expect(page).toHaveURL(/\/negotiations\//);
  await expect(page.getByText("Suggested message")).toBeVisible();
  await page.getByRole("button", { name: "I sent it" }).click();
  await expect(page.getByText("Offer sent").first()).toBeVisible();
  await expect(page.getByText(/^You · /)).toBeVisible();
  const reply = page.locator("form").filter({ has: page.getByRole("button", { name: "Save reply" }) });
  await reply.getByPlaceholder("Paste the seller's message").fill("Could you do a little more?");
  await reply.getByLabel("Seller's counteroffer (if any)").fill("9999");
  await reply.getByRole("button", { name: "Save reply" }).click();
  await expect(page.getByText(/exceeds your maximum/).first()).toBeVisible();
  const agree = page.locator("form").filter({ has: page.getByRole("button", { name: "Record agreement" }) });
  await agree.getByLabel("Meeting place").fill("Lockport police station");
  await agree.getByRole("button", { name: "Record agreement" }).click();
  await expect(page.getByText(/Agreed at/)).toBeVisible();

  // 9. Record the purchase after inspection.
  await page.goto(`${dealUrl}#purchase`);
  const purchase = page.locator("#purchase");
  await purchase.getByLabel(/Powers on/).check();
  await purchase.getByLabel("Serial number", { exact: true }).fill("TESTFIXTURE-001");
  await purchase.getByRole("button", { name: "Mark purchased" }).click();
  await expect(page).toHaveURL(/\/inventory\//);

  // 10. Inventory, listing, and sale.
  await expect(page.getByText("Listing assistant")).toBeVisible();
  await page.getByRole("button", { name: "Mark as listed" }).click();
  await expect(page.getByText(/Listing marked active/)).toBeVisible();
  const sale = page.locator("form").filter({ has: page.getByRole("button", { name: "Record sale" }) });
  await sale.getByLabel("Order number").fill("TEST-12-34567-89012");
  await sale.getByLabel("Item price").fill("505");
  await sale.getByLabel("Shipping label").fill("27.50");
  await sale.getByRole("button", { name: "Record sale" }).click();
  await expect(page.getByText(/Sale recorded. Realized profit/)).toBeVisible();

  // 11. Actual profit and bankroll progress from the initial $1,000.
  await page.goto("/financials");
  await expect(page.getByText("Net operating profit")).toBeVisible();
  await expect(page.getByText(/Started with \$1,000\.00 owner capital/)).toBeVisible();
  await expect(page.getByText("Inventory (cost basis)").first()).toBeVisible();
  const csv = await page.request.get("/api/export/journal");
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("TEST-12-34567-89012");

  await shot(page, "financials");
  await page.goto("/analytics");
  await expect(page.getByText("Units sold")).toBeVisible();
  await page.goto("/");
  await shot(page, "command-center");
});

test("key screens fit a phone without horizontal scrolling", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/");
  await shot(page, "mobile-home");
  for (const p of ["/", "/radar", "/import", "/inventory", "/financials", "/negotiations", "/settings", "/analyzer"]) {
    await page.goto(p);
    const { overflow, culprits } = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const culprits: string[] = [];
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > w + 1 && !el.closest(".overflow-x-auto") && culprits.length < 5) culprits.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
      });
      return { overflow: document.documentElement.scrollWidth - w, culprits };
    });
    expect(overflow, `horizontal overflow on ${p}: ${culprits.join(" | ")}`).toBeLessThanOrEqual(1);
  }
  await ctx.close();
});
