# Session Synopsis — Multi-Project Recap

**Owner:** Sean Kelly (skellyslife@gmail.com) · Denver, CO
**Date:** August 2026
**Style:** Faceless, hands-off

---

## Projects Overview

### 1. ShopScribe (AI Etsy Listing Generator)
- **Repo:** `1047ventures/shopscribe`
- **Live:** shopscribe-app.netlify.app
- **Stack:** React 19 + Vite + TypeScript + Tailwind, Netlify Functions, Stripe ($19/mo), Claude Haiku AI, Resend email
- **Status:** Live and accepting payments
- **What was done this session:**
  - Added UTM tracking (frontend capture in `main.tsx`, backend in `track.ts`)
  - Added listing generation analytics via Netlify Blobs
  - Enhanced daily report function with traffic/ad/listing stats (then **disabled** report emails per user request)
  - Created Stripe checkout flow with custom copy
  - Drafted Reddit marketing posts
- **Meta Ad Campaign:** ID `6997069619642` — **PAUSED**

### 2. Smooth AF Driving (GPS Driving Score App)
- **Repo:** `1047ventures/SmoothAFDriving`
- **Live:** smoothaf-app.netlify.app
- **Branch:** `claude-pwa` (production), also `claude/ad-landing-splash`
- **Stack:** Vanilla JS PWA, phone GPS + accelerometer, Supabase leaderboard, Leaflet maps
- **Status:** Live with new ad landing splash page
- **What was done this session:**
  - Built ad landing splash overlay (shows for first-time visitors with UTM params)
  - iOS install hint (Share → Add to Home Screen)
  - Styled to match dark app aesthetic with Playfair Display font
- **Meta Ad Campaign:** ID `6998805095842` — **PAUSED**
- **Pending:** Ad URLs need UTM params added, keyword targeting update (F1, gaming, action sports)

### 3. Smooth AF Footy School
- **Site:** smoothaffooty.com
- **Status:** Existing site, no code changes this session
- **Meta Ad Campaign:** ID `6998804704242` — **PAUSED**
- **Pending:** Reddit posts drafted but not posted

---

## Pending Tasks

| Task | Project | Notes |
|------|---------|-------|
| Post Reddit content | All 3 | 12 posts drafted in `shopscribe/marketing/reddit-posts.md` — needs human to post |
| Update ad targeting keywords | Driving | F1, gaming, action sports, car culture — needs Meta token + unpaused campaign |
| Add UTM params to ad URLs | Driving | `?utm_source=meta&utm_campaign=driving&utm_content={{ad.id}}` |
| Set up Meta Pixel | All | Would improve ad optimization |
| Get long-lived Meta token | All | Need app secret to exchange for 60-day token |

---

## Key Credentials & Config

- **Netlify token:** User provides as needed (tokens expire/rotate)
- **Meta access token:** Expires ~1 hour, regenerate at developers.facebook.com/tools/explorer
- **Stripe:** Connected to ShopScribe for $19/mo subscriptions
- **Supabase:** Connected to Driving app for leaderboard

---

## Decisions Made

- All Meta ads **paused** — too expensive with no results
- Pivoting to **organic Reddit marketing** strategy
- Daily ShopScribe report emails **disabled**
- All marketing must be **faceless** — no personal branding
- Each project should have its **own repo and session**
