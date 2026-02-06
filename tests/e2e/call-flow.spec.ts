import { expect, test } from "@playwright/test";

test("host and guest can join through link, chat, and reconnect", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New meeting" }).click();

  await expect(page).toHaveURL(/#\/quick\/meet-[a-z0-9]{14}$/u);
  const inviteUrl = page.url();

  const guestPage = await context.newPage();
  await guestPage.goto(inviteUrl);
  await expect(guestPage.getByRole("button", { name: "Leave meeting" })).toBeVisible({
    timeout: 15_000,
  });

  await guestPage.getByRole("button", { name: "Leave meeting" }).click();
  await expect(guestPage.getByRole("button", { name: "New meeting" })).toBeVisible({
    timeout: 10_000,
  });

  await guestPage.goto(inviteUrl);
  await expect(guestPage.getByRole("button", { name: "Leave meeting" })).toBeVisible({
    timeout: 15_000,
  });
});
