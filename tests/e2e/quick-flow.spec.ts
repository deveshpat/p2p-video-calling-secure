import { expect, test } from "@playwright/test";

test("quick mode creates a room link and opens custom call page", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/#\/quick$/u);
  await expect(page.getByRole("button", { name: "New meeting" })).toBeVisible();

  await page.getByRole("button", { name: "New meeting" }).click();

  await expect(page).toHaveURL(/#\/quick\/meet-[a-z0-9]{14}$/u);
  await expect(page.getByRole("button", { name: "Copy invite link" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Leave meeting" })).toBeVisible();
  await expect(page.getByText("Waiting for the other person to join this link.")).toBeVisible();

  await expect(page.locator("iframe")).toHaveCount(0);
});
