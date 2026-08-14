# Accounts & Sign-in

Before this existed the app had **no identity at all**. The "device ID" was a
random UUID minted per install — it identified a handset, not a driver, so a new
phone or a reinstall looked like a brand-new stranger and the drive history was
stranded on the old device.

Two ways in:

| Method | Status | Needs |
|---|---|---|
| Email + 6-digit code | Built, works today | one Supabase template edit (below) |
| Sign in with Apple | Built client-side, **inert** | Apple capability + Supabase provider |

## How it fits together

```
Sign in  →  claimDeviceDrives()      PATCH drives SET user_id WHERE device_id=me AND user_id IS NULL
         →  fetchDrivesForUser()     SELECT ... WHERE user_id = me
         →  mergeCloudDrives()       dedupe by startTime, local always wins
```

Both halves are idempotent — claiming filters on `user_id is null`, merging
dedupes by `startTime` — so this runs on every launch and settles to a no-op.

New drives are stamped with `user_id` at upload time (null when signed out), so
anonymous recording keeps working exactly as before.

---

## Step 1 — Run the migration (required)

`supabase/migrations/20260814000000_accounts.sql` adds the nullable `user_id`
column, its indexes, and the RLS policies that let a signed-in user claim their
own unclaimed rows.

Supabase dashboard → **SQL Editor** → paste the file → Run.

## Step 2 — Put the code in the email (required)

**Email sign-in will not work until this is done.** Supabase's stock templates
send a magic *link*, not a code. A link has to deep-link back into the native
app, which breaks whenever the mail client opens it in its own webview — so the
app asks for a typed code instead. The code is always generated; the default
template just doesn't print it.

Dashboard → **Authentication → Emails**. Edit **both** templates — a first-time
address gets "Confirm signup", a returning one gets "Magic Link":

```html
<h2>Your Smooth AF code</h2>
<p style="font-size:32px;letter-spacing:8px"><strong>{{ .Token }}</strong></p>
<p>Enter this in the app. It expires in an hour.</p>
```

Then test on a real device: tap **Sign in**, enter your email, check the inbox.

> Free-tier Supabase sends ~3-4 emails/hour through its shared SMTP and it is
> rate-limited per address. Fine for testing; hook up a real SMTP provider
> before any real user volume.

## Step 3 — Sign in with Apple (optional, do it before App Store review)

The button is already coded and **appears by itself** the moment the provider is
enabled — `isAppleConfigured()` checks `/auth/v1/settings` at runtime, so no app
release is needed to turn it on. Right now that endpoint reports
`"apple": false`, so the button stays hidden.

Apple **requires** Sign in with Apple in any app that offers another third-party
sign-in. Email-only does not trigger that rule, so today's build is submittable
without it.

1. **developer.apple.com** → Certificates, IDs & Profiles → Identifiers → your
   App ID → tick **Sign In with Apple** → Save.
2. Same page → **Keys** → new key with Sign In with Apple enabled → download the
   `.p8`. (Never paste its contents anywhere — it is a private key.)
3. **Xcode** → App target → Signing & Capabilities → **+ Capability** → Sign In
   with Apple. Commit the generated `App.entitlements`.
4. **Supabase** → Authentication → Providers → Apple → enable, and add your
   bundle ID (`com.smoothafdriving.app`) to **Authorized Client IDs**. Native
   sign-in validates the bundle ID; the Services ID / team key fields are only
   needed for the web flow.
5. `npm i @capacitor-community/apple-sign-in && npx cap sync ios`

Step 5 is what makes `requestAppleCredential()` find a plugin. Until then it
returns null and the button reports that Apple sign-in isn't available — it
never throws.

---

## Known gap: the drives table is still world-readable

The select policy is `using (true)`. The device-ID restore box reads rows while
signed out, so it cannot filter on `auth.uid()`. Anyone who guesses a device
UUID can read that device's GPS tracks.

This is pre-existing, not introduced by accounts. The fix is to wait until
installs have moved onto accounts, then swap the policy to
`using (user_id = auth.uid())` and delete the device-ID restore box from the
home screen. Both are noted in the migration.
