#!/bin/sh
#
# Xcode Cloud — runs on the cloud runner right after it clones the repo, before
# Xcode builds the iOS target.
#
# Why this is required: the native project is only a WebView shell. The actual
# app is the Vite build in dist/, which Capacitor copies into
# ios/App/App/public/ — and that directory is generated, so it isn't in git.
# Without this script Xcode Cloud would compile a shell around an empty
# public/ and ship a blank app.
#
# So: install Node, build the web app, sync it into the iOS project, and
# re-apply the privacy usage strings.
set -e

echo "── Installing Node (Capacitor CLI needs >= 22) ──"
brew install node@22
export PATH="$(brew --prefix node@22)/bin:$PATH"
node -v
npm -v

cd "$CI_PRIMARY_REPOSITORY_PATH"

echo "── Installing dependencies ──"
npm ci

echo "── Building the web app ──"
npm run build

echo "── Syncing web build into the iOS project ──"
npx cap sync ios

echo "── Applying iOS privacy usage strings ──"
bash scripts/ios-privacy.sh

echo "── ci_post_clone complete ──"
