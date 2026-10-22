import {
  CHECKOUT_URL,
  LAUNCH_LIMIT,
  LAUNCH_PRICE,
  LAUNCH_SPOTS_LEFT,
  PRICE,
  SITE_URL,
} from "./constants"

export type SiteConfig = {
  price: number | null
  launchPrice: number | null
  launchLimit: number | null
  launchSpotsLeft: number | null
  checkoutUrl: string | null
  siteUrl: string
}

export const siteConfig: SiteConfig = {
  price: PRICE,
  launchPrice: LAUNCH_PRICE,
  launchLimit: LAUNCH_LIMIT,
  launchSpotsLeft: LAUNCH_SPOTS_LEFT,
  checkoutUrl: CHECKOUT_URL,
  siteUrl: SITE_URL,
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

const moneyCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export const formatUsd = (amount: number): string =>
  Number.isInteger(amount) ? money.format(amount) : moneyCents.format(amount)

export const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export const escapeAttr = (value: string): string =>
  escapeHtml(value).replace(/"/g, "&quot;")

const assertNumber = (name: string, value: number | null): void => {
  if (value == null) return
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number or null`)
  }
}

export const assertConfig = (config: SiteConfig): void => {
  assertNumber("PRICE", config.price)
  assertNumber("LAUNCH_PRICE", config.launchPrice)
  assertNumber("LAUNCH_LIMIT", config.launchLimit)
  assertNumber("LAUNCH_SPOTS_LEFT", config.launchSpotsLeft)
  if (config.launchLimit != null && !Number.isInteger(config.launchLimit)) {
    throw new Error("LAUNCH_LIMIT must be a whole number or null")
  }
  if (
    config.launchSpotsLeft != null &&
    !Number.isInteger(config.launchSpotsLeft)
  ) {
    throw new Error("LAUNCH_SPOTS_LEFT must be a whole number or null")
  }
  if (config.checkoutUrl == null) return
  const url = config.checkoutUrl
  const ok =
    /^https?:\/\//i.test(url) || (url.startsWith("/") && !url.startsWith("//"))
  if (!ok) {
    throw new Error("CHECKOUT_URL must be an http(s) URL or a site path")
  }
}

/** Sentence under the prices. Null when the launch price is hidden. */
export const launchNote = (config: SiteConfig): string | null => {
  if (config.launchPrice == null) return null
  if (config.launchLimit == null) return "launch price"
  return `launch price for the first ${config.launchLimit} users`
}

/**
 * Static spots line. Null hides it. Not a live counter.
 * Ignored unless a launch price is on, so a leftover number cannot
 * outlive the discount.
 */
export const spotsNote = (config: SiteConfig): string | null => {
  if (config.launchPrice == null || config.launchSpotsLeft == null) return null
  if (config.launchSpotsLeft === 1) return "1 spot left"
  return `${config.launchSpotsLeft} spots left`
}

export type Offer = {
  pending: boolean
  was: string | null
  now: string | null
  note: string | null
  spots: string | null
}

export const offerModel = (config: SiteConfig): Offer => {
  const note = launchNote(config)
  const spots = spotsNote(config)
  if (config.price == null && config.launchPrice == null) {
    return { pending: true, was: null, now: null, note: null, spots: null }
  }
  const discounted =
    config.launchPrice != null &&
    config.price != null &&
    config.launchPrice !== config.price
  const current = config.launchPrice ?? config.price
  return {
    pending: false,
    was: discounted ? formatUsd(config.price as number) : null,
    now: formatUsd(current as number),
    note: config.launchPrice != null ? note : null,
    spots,
  }
}

export const priceMarkup = (
  config: SiteConfig,
  variant: "compact" | "full"
): string => {
  assertConfig(config)
  const offer = offerModel(config)
  if (offer.pending || offer.now == null) {
    return `<p class="offer-pending">price coming soon</p>`
  }
  const was = offer.was
    ? `<s class="offer-was"><span class="sr-only">regular price </span>${escapeHtml(offer.was)}</s>`
    : ""
  const note = offer.note
    ? `<p class="offer-note">${escapeHtml(offer.note)}</p>`
    : ""
  const spots = offer.spots
    ? `<p class="offer-spots">${escapeHtml(offer.spots)}</p>`
    : ""
  return `<div class="offer offer-${variant}">
    <p class="offer-prices">${was}<span class="offer-now">${escapeHtml(offer.now)}</span></p>
    ${note}
    ${spots}
  </div>`
}

export const buyMarkup = (
  config: SiteConfig,
  place: "link" | "pricing"
): string => {
  assertConfig(config)
  if (config.checkoutUrl) {
    return `<a class="btn btn-amber" href="${escapeAttr(config.checkoutUrl)}">buy jot</a>`
  }
  if (place === "pricing") {
    return `<button class="btn btn-amber" type="button" disabled aria-describedby="checkout-note">coming soon</button>`
  }
  return `<a class="btn btn-amber" href="#notify">coming soon</a>`
}

export const checkoutNote = (config: SiteConfig): string => {
  if (config.checkoutUrl) return ""
  return `<p class="checkout-note" id="checkout-note">checkout isn't open yet.</p>`
}

export const faqPricingAnswer = (config: SiteConfig): string => {
  const base = "no. jot is a one-time license. pay once, and it's yours."
  const note = launchNote(config)
  if (config.launchPrice != null && config.price != null && note) {
    return `${base} the ${note} is ${formatUsd(config.launchPrice)}. the regular price is ${formatUsd(config.price)}. nothing renews.`
  }
  if (config.price != null) {
    return `${base} the price is ${formatUsd(config.price)}. nothing renews.`
  }
  return `${base} nothing renews. the price is still being set.`
}

export const metaDescription = (config: SiteConfig): string => {
  const pitch =
    "Jot is a macOS app. Hold fn, speak, and clean text is pasted into whatever app you're in."
  const note = launchNote(config)
  if (config.launchPrice != null && config.price != null && note) {
    return `${pitch} One-time license, ${formatUsd(config.launchPrice)} ${note}. Regular price ${formatUsd(config.price)}.`
  }
  if (config.price != null) {
    return `${pitch} One-time license, ${formatUsd(config.price)}.`
  }
  return pitch
}

export const ogAlt = (config: SiteConfig): string => {
  const offer = offerModel(config)
  if (offer.was && offer.now && offer.note) {
    return `Jot. hold fn. speak. it's typed. ${offer.now} ${offer.note}. Regular price ${offer.was}.`
  }
  if (offer.now) {
    return `Jot. hold fn. speak. it's typed. ${offer.now}, one-time license.`
  }
  return "Jot. hold fn. speak. it's typed."
}

export const jsonLd = (config: SiteConfig): string => {
  const origin = config.siteUrl.replace(/\/$/, "")
  const offer = offerModel(config)
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Jot",
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "macOS",
    url: `${origin}/`,
    image: `${origin}/og.png`,
    description: metaDescription(config),
  }
  if (offer.now && !offer.pending) {
    const price = config.launchPrice ?? config.price
    data.offers = {
      "@type": "Offer",
      price: (price as number).toFixed(2),
      priceCurrency: "USD",
      description: faqPricingAnswer(config),
    }
  }
  return JSON.stringify(data).replace(/</g, "\\u003c")
}

export const introMarkup = (hasVideo: boolean): string => {
  if (!hasVideo) {
    return `<div class="intro-fallback">
      <img src="/intro-fallback.png" width="1280" height="720" alt="Intro coming soon. hold fn. speak. it's typed.">
      <p>the intro isn't up yet.</p>
    </div>`
  }
  return `<video class="intro-video" controls muted playsinline webkit-playsinline preload="none" poster="/intro-poster.jpg" width="1920" height="1080" aria-label="Jot intro">
    <source src="/intro.mp4" type="video/mp4">
    <track kind="captions" src="/intro.vtt" srclang="en" label="English">
  </video>`
}

export const renderPage = (
  html: string,
  opts: { hasVideo: boolean }
): string => {
  assertConfig(siteConfig)
  const origin = siteConfig.siteUrl.replace(/\/$/, "")
  const replacements: Record<string, string> = {
    __ORIGIN__: origin,
    __DESCRIPTION__: escapeAttr(metaDescription(siteConfig)),
    __OG_ALT__: escapeAttr(ogAlt(siteConfig)),
    __JSONLD__: jsonLd(siteConfig),
    __BUY_HEADER__: buyMarkup(siteConfig, "link"),
    __BUY_HERO__: buyMarkup(siteConfig, "link"),
    __BUY_PRICING__: buyMarkup(siteConfig, "pricing"),
    __PRICE_COMPACT__: priceMarkup(siteConfig, "compact"),
    __PRICE_FULL__: priceMarkup(siteConfig, "full"),
    __CHECKOUT_NOTE__: checkoutNote(siteConfig),
    __FAQ_PRICE__: escapeHtml(faqPricingAnswer(siteConfig)),
    __INTRO__: introMarkup(opts.hasVideo),
  }
  let out = html
  for (const [token, value] of Object.entries(replacements)) {
    if (!out.includes(token)) throw new Error(`missing token ${token}`)
    out = out.replaceAll(token, value)
  }
  const leftover = out.match(/__[A-Z0-9_]+__/g)
  if (leftover) throw new Error(`unreplaced tokens: ${leftover.join(", ")}`)
  return out
}
