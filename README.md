# snapbubbles.com

HTML5 virtual bubble wrap. Two modes:

- **Zen** — pop bubbles forever, grid auto-regenerates.
- **Speed** — pop 50 bubbles as fast as you can; best time stored locally.

Pure static site: `index.html` + `style.css` + `game.js`. No build step.

## Local preview

Open `index.html` in a browser. Or for a proper local server:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy

Hosted on Cloudflare Pages. Every push to `main` auto-deploys.

## Pending integration

- GA4 measurement ID (replace `G-XXXXXXXXXX` in `index.html`)
- AdSense ad unit slot (commented in `index.html`, account `ca-pub-6647695511145371`)
