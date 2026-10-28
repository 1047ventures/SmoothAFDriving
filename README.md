# Smooth AF — Driving

Scores every drive for smoothness and coaches you to drive better. Vanilla-JS PWA
(Vite) that also ships as an iOS app through Capacitor; hosted on Cloudflare Pages.

- Live app: https://smoothafdriving.pages.dev/install
- Developer guide (architecture, scoring pipeline, deploy, working rules): [CLAUDE.md](CLAUDE.md)
- Native/iOS notes: [NATIVE.md](NATIVE.md)

```bash
npm install
npm run dev        # Vite dev server (never writes to the production database)
npm run build      # production build → dist/
npx vitest run src/tests/<file>.test.js   # run the tests that cover your change
```
