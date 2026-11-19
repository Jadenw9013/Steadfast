import { chromium, expect } from "@playwright/test";

const base = process.env.PLAN_UI_BASE_URL ?? "http://127.0.0.1:4180";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 812 });
    for (const [total, logged] of [[0, 0], [5, 0], [5, 2], [12, 0], [5, 5], [5, 8]]) {
      await page.goto(`${base}/client?meals=${total}&logged=${logged}`);
      await page.evaluate(() => document.fonts.ready);
      const cards = page.getByRole("region", { name: "Today's plan" }).getByRole("link");
      await expect(cards).toHaveCount(2);
      for (const card of await cards.all()) {
        const bounds = await card.boundingBox();
        expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(1);
        const overflow = await card.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return [...element.querySelectorAll("span, h3")].filter((child) => {
            if (child.classList.contains("sr-only")) return false;
            const text = child.getBoundingClientRect();
            return text.left < bounds.left || text.right > bounds.right || text.top < bounds.top || text.bottom > bounds.bottom;
          }).map((child) => child.textContent);
        });
        expect(overflow, `Text must fit at ${width}px`).toEqual([]);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const progress = page.getByRole("progressbar");
      const completed = Math.min(total, logged);
      await expect(progress).toHaveAttribute("aria-valuenow", String(completed));
      await expect(progress).toHaveAttribute("aria-valuetext", total ? `${completed} of ${total} meals completed` : "No meals scheduled");
      await expect(progress.locator("circle")).toHaveCount(completed > 0 ? 2 : 1);
      await expect(progress).toContainText(total === 0 ? "—" : completed === total ? "Done" : "left");
      const geometry = await progress.evaluate((element) => {
        const track = element.querySelector("circle");
        const matrix = track.getScreenCTM();
        const center = new DOMPoint(60, 60).matrixTransform(matrix);
        const scale = Math.hypot(matrix.a, matrix.b);
        const innerRadius = (50 - 12 / 2) * scale;
        const content = [...element.querySelectorAll(":scope > div > span, :scope > div > svg")];
        const textFits = content.every((child) => {
          const bounds = child.getBoundingClientRect();
          return [bounds.left, bounds.right].every((horizontal) => [bounds.top, bounds.bottom].every((vertical) => Math.hypot(horizontal - center.x, vertical - center.y) < innerRadius));
        });
        return { textFits, stroke: 12 * scale };
      });
      expect(geometry.textFits, `Center text must stay inside the ring at ${width}px (${total}/${logged})`).toBe(true);
      expect(geometry.stroke).toBeGreaterThanOrEqual(7);
    }
    await page.goto(base + "/client");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `/tmp/steadfast-meal-ring-${width}.png` });
    await page.getByRole("region", { name: "Today's plan" }).screenshot({ path: `/tmp/steadfast-plan-cards-${width}.png` });
  }
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
  console.log("PASS: square cards and thick-ring text fit at 320–430px in six progress states; food, macro and both training publish controls; success and failure feedback.");
} finally {
  await browser.close();
}
