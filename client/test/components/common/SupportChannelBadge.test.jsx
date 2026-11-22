import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import SupportChannelBadge from "../../../src/components/common/SupportChannelBadge.jsx";

// The i18n default language is Persian (fa), so the badge labels below are
// the fa strings rendered in a fresh browser context.
describe("SupportChannelBadge", () => {
  test("renders the support-channel headset with the fa aria-label", async () => {
    render(<SupportChannelBadge />);
    await expect
      .element(page.getByLabelText("درخواست پشتیبانی"))
      .toBeInTheDocument();
  });

  test("default size is 15px", async () => {
    render(<SupportChannelBadge />);
    const svg = page
      .getByLabelText("درخواست پشتیبانی")
      .locator("svg");
    await expect.element(svg).toHaveAttribute("width", "15");
    await expect.element(svg).toHaveAttribute("height", "15");
  });

  test("appends the department name to the label", async () => {
    render(<SupportChannelBadge departmentName="Billing" />);
    await expect
      .element(page.getByLabelText("درخواست پشتیبانی — Billing"))
      .toBeInTheDocument();
  });

  test("reveals the tooltip on hover", async () => {
    render(<SupportChannelBadge departmentName="Billing" />);
    await page.getByLabelText("درخواست پشتیبانی — Billing").hover();
    await expect
      .element(page.getByRole("tooltip"))
      .toHaveTextContent("درخواست پشتیبانی — Billing");
  });

  test("renders at a custom size", async () => {
    render(<SupportChannelBadge size={17} />);
    const svg = page
      .getByLabelText("درخواست پشتیبانی")
      .locator("svg");
    await expect.element(svg).toHaveAttribute("width", "17");
  });
});
