import { chromium, expect } from "@playwright/test";

const base = process.env.PLAN_UI_BASE_URL ?? "http://127.0.0.1:4180";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.goto(base + "/client");
  await expect(page.getByRole("link")).toHaveCount(2);
  for (const card of await page.getByRole("link").all()) {
    const bounds = await card.boundingBox();
    expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: "/tmp/steadfast-release-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 1000 });
  for (const path of ["coach", "macro", "training"]) {
    for (const failure of [false, true]) {
      await page.goto(base + "/" + path + (failure ? "?failure" : ""));
      const count = path === "training" ? 2 : 1;
      await expect(page.getByRole("button", { name: "Published", exact: true })).toHaveCount(count);
      for (const button of await page.getByRole("button", { name: "Published", exact: true }).all()) await expect(button).toBeDisabled();
      if (path === "coach") await page.getByPlaceholder("portion", { exact: true }).fill("90 g");
      else if (path === "macro") await page.locator('input[type="number"]').first().fill("350");
      else await page.getByPlaceholder("Exercise details — sets × reps, rest periods, tempo…").fill("4 sets of 12");
      await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(count);
      await page.getByRole("button", { name: "Publish", exact: true }).last().click();
      if (failure) {
        await expect(page.getByText("Synthetic publish failure. Please try again.", { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Published", exact: true })).toHaveCount(0);
      } else {
        await expect(page.getByRole("button", { name: "Published", exact: true })).toHaveCount(count);
        for (const button of await page.getByRole("button", { name: "Published", exact: true }).all()) await expect(button).toBeDisabled();
        await expect(page.getByRole("status")).toContainText("matches the plan shared");
      }
    }
  }
  console.log("PASS: square mobile layout; food, macro and both training publish controls; success and failure feedback.");
} finally {
  await browser.close();
}
