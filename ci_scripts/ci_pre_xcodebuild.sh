#!/bin/sh
#
# Xcode Cloud — runs right before xcodebuild.
#
# Stamps the build number from Xcode Cloud's monotonically increasing
# CI_BUILD_NUMBER. Without this every build ships as "1", and App Store Connect
# rejects a build number it has already seen — so the second upload onwards
# would fail. The project's CURRENT_PROJECT_VERSION is hardcoded, so patch it in
# the runner's clone (never committed back).
set -e

[ -n "$CI_BUILD_NUMBER" ] || { echo "[pre-xcodebuild] no CI_BUILD_NUMBER — leaving version alone"; exit 0; }

PBX="$CI_PRIMARY_REPOSITORY_PATH/ios/App/App.xcodeproj/project.pbxproj"
[ -f "$PBX" ] || { echo "[pre-xcodebuild] no pbxproj at $PBX — skipping"; exit 0; }

# BSD sed (macOS) needs an explicit empty suffix for in-place editing.
sed -i '' "s/CURRENT_PROJECT_VERSION = [0-9][0-9.]*;/CURRENT_PROJECT_VERSION = $CI_BUILD_NUMBER;/g" "$PBX"
echo "[pre-xcodebuild] build number set to $CI_BUILD_NUMBER"
