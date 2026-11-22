import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import ChannelBadge from "../../../src/components/common/ChannelBadge.jsx";

// The i18n default language is Persian (fa), so the labels below are the fa
// strings rendered in a fresh browser context.
describe("ChannelBadge", () => {
  test("support channel renders the SUPPORT pill with the fa aria-label", async () => {
    render(<ChannelBadge channel="support" />);
    await expect
      .element(page.getByLabelText("تیکت پشتیبانی"))
      .toBeInTheDocument();
    await expect
      .element(page.getByLabelText("تیکت پشتیبانی"))
      .toHaveTextContent("SUPPORT");
  });

  test("direct channel renders the MESSENGER pill with the fa aria-label", async () => {
    render(<ChannelBadge channel="direct" />);
    await expect
      .element(page.getByLabelText("چت پیام‌رسان"))
      .toBeInTheDocument();
    await expect
      .element(page.getByLabelText("چت پیام‌رسان"))
      .toHaveTextContent("MESSENGER");
  });

  test("unknown channel falls back to the MESSENGER pill", async () => {
    render(<ChannelBadge channel="nonsense" />);
    await expect
      .element(page.getByLabelText("چت پیام‌رسان"))
      .toBeInTheDocument();
  });

  test("appends the department name to the label", async () => {
    render(<ChannelBadge channel="support" departmentName="Billing" />);
    await expect
      .element(page.getByLabelText("تیکت پشتیبانی — Billing"))
      .toBeInTheDocument();
  });

  test("reveals the tooltip on hover", async () => {
    render(<ChannelBadge channel="support" departmentName="Billing" />);
    await page.getByLabelText("تیکت پشتیبانی — Billing").hover();
    await expect
      .element(page.getByRole("tooltip"))
      .toHaveTextContent("تیکت پشتیبانی — Billing");
  });

  test("the pill is always LTR (uppercase latin label inside RTL layouts)", async () => {
    render(<ChannelBadge channel="support" />);
    const badge = page.getByLabelText("تیکت پشتیبانی");
    await expect.element(badge).toHaveAttribute("dir", "ltr");
  });
});
