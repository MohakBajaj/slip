import { describe, expect, test } from "bun:test"
import {
  buyMarkup,
  faqPricingAnswer,
  formatUsd,
  introMarkup,
  offerModel,
  priceMarkup,
  siteConfig,
} from "./render"

describe("money", () => {
  test("formats whole dollars without cents", () => {
    expect(formatUsd(29)).toBe("$29")
    expect(formatUsd(9)).toBe("$9")
    expect(formatUsd(9.5)).toBe("$9.50")
  })
})

describe("launch offer", () => {
  test("shows the regular price struck beside the launch price", () => {
    const full = priceMarkup(siteConfig, "full")
    const compact = priceMarkup(siteConfig, "compact")
    for (const html of [full, compact]) {
      expect(html).toContain("$29")
      expect(html).toContain("$9")
      expect(html).toContain("<s")
      expect(html).toContain("launch price for the first 50 users")
      expect(html).not.toContain("spots left")
    }
    expect(compact).toContain("offer-compact")
    expect(full).toContain("offer-full")
    expect(offerModel(siteConfig)).toEqual({
      pending: false,
      was: "$29",
      now: "$9",
      note: "launch price for the first 50 users",
      spots: null,
    })
  })

  test("prints spots left only when the optional constant is set", () => {
    const shown = priceMarkup({ ...siteConfig, launchSpotsLeft: 12 }, "full")
    expect(shown).toContain("12 spots left")
    expect(shown).not.toContain("only 12")
    const one = priceMarkup({ ...siteConfig, launchSpotsLeft: 1 }, "compact")
    expect(one).toContain("1 spot left")
    const off = priceMarkup({ ...siteConfig, launchSpotsLeft: null }, "full")
    expect(off).not.toContain("spot")
  })

  test("hides the discount when the launch price is null", () => {
    const html = priceMarkup(
      { ...siteConfig, launchPrice: null, launchSpotsLeft: 4 },
      "full"
    )
    expect(html).toContain("$29")
    expect(html).not.toContain("$9")
    expect(html).not.toContain("<s ")
    expect(html).not.toContain("launch price")
    expect(html).not.toContain("spot")
  })

  test("says price coming soon when both prices are null", () => {
    const html = priceMarkup(
      { ...siteConfig, price: null, launchPrice: null },
      "full"
    )
    expect(html).toContain("price coming soon")
    expect(html).not.toContain("$")
  })
})

describe("checkout", () => {
  test("stays coming soon while the url is null", () => {
    expect(siteConfig.checkoutUrl).toBeNull()
    expect(buyMarkup(siteConfig, "link")).toContain('href="#notify"')
    expect(buyMarkup(siteConfig, "link")).toContain("coming soon")
    expect(buyMarkup(siteConfig, "link")).not.toContain("buy jot")
    const pricing = buyMarkup(siteConfig, "pricing")
    expect(pricing).toContain("disabled")
    expect(pricing).toContain("coming soon")
    expect(pricing).not.toContain("buy jot")
  })

  test("points buy jot at a real checkout url", () => {
    const html = buyMarkup(
      { ...siteConfig, checkoutUrl: "https://pay.example/jot" },
      "pricing"
    )
    expect(html).toContain("buy jot")
    expect(html).toContain("https://pay.example/jot")
    expect(html).not.toContain("coming soon")
  })

  test("rejects a non-http checkout url", () => {
    expect(() =>
      buyMarkup({ ...siteConfig, checkoutUrl: "javascript:alert(1)" }, "link")
    ).toThrow()
  })
})

describe("faq", () => {
  test("explains one-time pricing with both amounts", () => {
    const answer = faqPricingAnswer(siteConfig)
    expect(answer).toContain("one-time")
    expect(answer).toContain("$9")
    expect(answer).toContain("$29")
    expect(answer).toContain("first 50 users")
    expect(answer).toContain("nothing renews")
    expect(answer).not.toContain("spots left")
  })
})

describe("intro", () => {
  test("wires the video when the file is present", () => {
    const html = introMarkup(true)
    expect(html).toContain('src="/intro.mp4"')
    expect(html).toContain("muted")
    expect(html).toContain("playsinline")
    expect(html).toContain('poster="/intro-poster.jpg"')
    expect(html).not.toContain("intro-fallback")
    expect(html).not.toContain("autoplay")
  })

  test("keeps a fallback that does not request the file", () => {
    const html = introMarkup(false)
    expect(html).not.toContain("intro.mp4")
    expect(html).toContain("intro-fallback.png")
    expect(html).toContain("isn't up yet")
  })
})
