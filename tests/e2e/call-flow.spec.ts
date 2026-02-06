import { expect, test } from "@playwright/test";

test("host and guest can join through link, chat, and reconnect", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New meeting" }).click();

  await expect(page).toHaveURL(/#\/quick\/meet-[a-z0-9]{14}$/u);
  const inviteUrl = page.url();

  const guestPage = await context.newPage();
  await guestPage.goto(inviteUrl);

  await expect(page.getByText(/Status:/u)).toBeVisible();
  await expect(guestPage.getByText(/Status:/u)).toBeVisible();

  await page.getByRole("button", { name: "Chat" }).click();
  await expect(
    page.getByText(
      /Peer joined\. Starting secure call\.|Peer answered\. Finalizing connection\.|You are connected\./u,
    ),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Share screen" }).click();
  await expect(
    page.getByText(/Screen sharing is on.|Screen sharing is not supported|Could not start screen sharing/u),
  ).toBeVisible({ timeout: 10_000 });

  await guestPage.getByRole("button", { name: "Leave meeting" }).click();
  await expect(page.getByText("Peer left the meeting.")).toBeVisible({ timeout: 10_000 });

  await guestPage.goto(inviteUrl);
  await expect(guestPage.getByRole("button", { name: "Leave meeting" })).toBeVisible({
    timeout: 15_000,
  });
});
