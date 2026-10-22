# Jot site

Marketing site for sayjot.xyz. Static Vite build. No backend.

## Build

```sh
bun install
bun run build
```

Output is `dist/`. On Vercel or Cloudflare Pages, set the root to `site/`:

- Build command: `bun run build`
- Output directory: `dist`

## Config

Edit `src/constants.ts`.

- `PRICE` — regular one-time price in USD. `null` shows “price coming soon”.
- `LAUNCH_PRICE` — launch price in USD. `null` hides the discount.
- `LAUNCH_LIMIT` — how many licenses the launch price covers.
- `LAUNCH_SPOTS_LEFT` — optional static “spots left” number. `null` (the default) hides it. This is not a live counter.
- `CHECKOUT_URL` — where “buy jot” goes. `null` shows “coming soon”.

## Intro video

`public/intro.mp4` plays muted and inline. `public/intro-poster.jpg` is the frame at 25.5 seconds.

If `intro.mp4` is missing, the build shows a still and does not request the file.

To refresh the poster after replacing the video:

```sh
ffmpeg -y -i public/intro.mp4 -ss 25.5 -frames:v 1 -update 1 public/intro-poster.jpg
```
