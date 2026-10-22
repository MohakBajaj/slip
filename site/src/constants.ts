/**
 * Marketing site config. This file is the only place prices and checkout live.
 *
 * PRICE — regular one-time price in USD. Null renders “price coming soon”.
 * LAUNCH_PRICE — launch price in USD. Null hides the discount.
 * LAUNCH_LIMIT — how many licenses the launch price covers.
 * LAUNCH_SPOTS_LEFT — optional static “spots left” figure. Null hides it.
 *   There is no backend and no live counter. Set a number only if you want
 *   that exact figure printed. It will not count down on its own.
 * CHECKOUT_URL — where “buy jot” goes. Null renders “coming soon”.
 */
export const PRICE: number | null = 29
export const LAUNCH_PRICE: number | null = 9
export const LAUNCH_LIMIT: number | null = 50
export const LAUNCH_SPOTS_LEFT: number | null = null
export const CHECKOUT_URL: string | null = null

export const SITE_URL = "https://sayjot.xyz"
