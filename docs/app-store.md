# App Store submission

Everything to paste into App Store Connect for version 1.0. Bundle ID: `com.smoothafdriving.app`.

## App information

| Field | Value |
|---|---|
| **Name** (30 max) | Smooth AF: Driving Score |
| **Subtitle** (30 max) | Drive smoother. Get better. |
| **Primary category** | Utilities |
| **Secondary category** | Lifestyle |
| **Age rating** | Answer the questionnaire honestly; expect 4+ to 13+. The app's name uses "AF" |
| **Price** | Free |
| **Device** | iPhone only |
| **Privacy Policy URL** | https://smoothafdriving.pages.dev/privacy |
| **Support URL** | https://smoothafdriving.pages.dev/support |
| **Marketing URL** | https://smoothafdriving.pages.dev/install |
| **Copyright** | 2026, your name or company |

## Promotional text (170 max)

Stop stabbing the pedals. Smooth AF scores every drive, shows you what to work on, and proves you're getting better.

## Description

Smooth is a flex.

Smooth AF turns your iPhone into a driving coach. Mount it, drive like you normally do, and get a score out of 100 with a map of every moment that cost you.

FOR EVERY DRIVE
• A score for smoothness, braking and momentum
• A map of every harsh moment, and every stop
• Red lights and stop signs barely count against you, because you can't will a light green
• Coaching on what to work on next

GET MEASURABLY BETTER
• See whether you're improving, and at what
• Earn 10 points for every smooth mile, plus badges along the way
• Watch your scores on the roads you drive most

LOOK AFTER YOUR CAR
• Plug in a Bluetooth LE OBD-II reader to see trouble codes in plain English
• Battery health, recall checks and a maintenance timeline
• Call the AI concierge about your car, and it already knows your car's readout

YOUR DATA
Your drives are private to you. We don't sell your data or share it with insurers, and you can delete your account and everything with it at any time. No account is needed to start.

DRIVE SAFELY
Set up the app before you drive, and don't touch your phone while moving. Always follow traffic laws and speed limits. Smooth AF uses GPS in the background during a drive, which can use more battery. 

## Keywords (100 max)

driving,coach,score,smooth,driver,OBD,OBD2,car,check engine,trouble codes,commute,trip,maintenance

## What's New

First release.

## App Review notes

Paste into App Review Information > Notes:

> No account is needed. To see a full drive without driving, open the app, finish or skip the intro, and tap "Not in a car? Watch a demo drive" on the Home screen. It plays a simulated drive through to the recap and saves nothing. The demo link appears only while the drive history is empty.
>
> Background location: during a real drive the app records a GPS route in the background, so the drive keeps recording while the screen is off or the driver is in a navigation app. The route and score are the app's main function. Recording stops when the drive ends.
>
> Bluetooth: an optional OBD-II reader adds engine data and trouble codes. The bluetooth-central background mode lets the app notice the driver sitting in the car, from the saved reader's signal strength, and send a notification to start the drive. No reader is needed to use the app.
>
> Microphone: used only for the optional AI concierge call in Garage > car care. The first call explains what's sent to the AI providers and asks for consent.
>
> Account deletion: sign in, open the account screen from Home, and tap Delete account.
>
> Sign-in uses Sign in with Apple or an emailed one-time code. All features can be used without signing in, apart from cloud backup.

## App Privacy answers

App Store Connect > App Privacy. Tracking: **No**. For every type below: used for **App Functionality**, **linked to the user**, not used for tracking.

| Apple's category | Type |
|---|---|
| Location | Precise Location |
| Contact Info | Name, Email Address |
| Identifiers | User ID, Device ID |
| Audio Data | Audio Data (concierge calls) |
| Other Data | Other Data Types (scores, car data, motion readings) |

## Export compliance

`ITSAppUsesNonExemptEncryption` is already false in the build, so there's no question to answer.

## Screenshots

Required size: 6.9-inch iPhone, 1320 x 2868 portrait. Files are in `docs/app-store-screenshots/`.

## Before submitting

Each of these needs the owner:

1. **Support email:** add a real address to `public/support.html`, replacing "Support email coming soon".
2. **Vapi:** set a spend limit, restrict origins, turn off call recording if it's on, and check the account has credit, since a reviewer may try a call.
3. **Screen recording:** attach a short video of a real drive to the review notes, showing background location and the OBD reader. A reviewer can't test those from a desk.
4. **Legal review:** have someone qualified read `public/privacy.html`.
5. **Sign in with Apple token revocation:** Apple requires this for accounts that signed in with Apple. It needs a Sign in with Apple key from the Apple Developer site, stored in Cloudflare. Not built yet. Until it is, deletion removes all of our data but leaves the Apple link in place.
