import { chromium, expect } from "@playwright/test";

const base = new URL(process.env.ACCOUNT_ENTRY_BASE_URL ?? "http://localhost:4192");
if (!["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("Use a local test server with development Clerk keys.");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, locale: "en-US" });
  page.on("pageerror", error => errors.push(error.message));
  async function visit(path) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await page.goto(new URL(path, base).href, { waitUntil: "commit" }); }
      catch (error) { if (!error.message.includes("ERR_NETWORK_CHANGED") || attempt === 2) throw error; }
    }
  }
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await visit("/sign-in?redirect_url=%2Finvite%2Fsynthetic-token");
    await expect(page.locator(".cl-signIn-root")).toBeVisible({ timeout: 30000 });
    await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
    const input = page.getByLabel("Email address", { exact: true });
    expect(await input.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    const button = page.locator(".cl-formButtonPrimary");
    await expect(button).toBeVisible();
    expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(56);
    expect(await button.evaluate(element => getComputedStyle(element).color)).toBe("rgb(255, 255, 255)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByText("Trouble getting an email?", { exact: true }).click();
    await expect(page.getByText(/Check your email spelling and spam folder/)).toBeVisible();
    await page.getByText("Medical Disclaimer & Liability Notice", { exact: true }).click();
    await expect(page.getByText(/Steadfast provides general fitness and wellness coaching only/)).toBeVisible();
    await page.getByText("Medical Disclaimer & Liability Notice", { exact: true }).click();
    await page.getByText("Trouble getting an email?", { exact: true }).click();
    await page.screenshot({ path: `/tmp/steadfast-auth-entry-${width}.png`, fullPage: true });
  }
  await visit("/sign-up?redirect_url=%2Finvite%2Fsynthetic-token");
  await expect(page).toHaveURL(new URL("/sign-in?redirect_url=%2Finvite%2Fsynthetic-token", base).href);
  await expect(page.locator(".cl-signIn-root")).toBeVisible();
  for (const path of ["/account", "/client", "/coach/dashboard"]) {
    const response = await visit(path);
    if (response.status() === 404) {
      expect(response.headers()["x-clerk-auth-reason"]).toBeTruthy();
    } else {
      expect(response.status()).toBe(200);
      expect(new URL(page.url()).pathname).toBe("/sign-in");
      await expect(page.locator(".cl-signIn-root")).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
  console.log("PASS: real Clerk combined form at 320/375/768/1440px, tap targets, readable inputs, recovery/legal disclosures, legacy invite return and signed-out route protection. No credentials submitted or accounts created.");
} finally {
  await browser.close();
}
