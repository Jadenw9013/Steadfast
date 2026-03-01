# Store Submission Guide

## Prerequisites

1. **EAS CLI**: `npm install -g eas-cli`
2. **Login**: `eas login` (use your Expo account)
3. **App assets**: Replace placeholder icons (see `assets/ASSET_REQUIREMENTS.md`)
4. **Environment**: Set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `EXPO_PUBLIC_API_BASE_URL` in EAS Secrets (Expo dashboard → Project → Environment variables)

## Build Commands

```bash
cd apps/mobile

# Internal testing build:
npx eas-cli build --profile preview --platform ios
npx eas-cli build --profile preview --platform android

# Production (store-ready):
npx eas-cli build --profile production --platform ios
npx eas-cli build --profile production --platform android
```

## Submit Commands

```bash
# iOS → TestFlight:
npx eas-cli submit --platform ios --profile production

# Android → Play Console (internal track):
npx eas-cli submit --platform android --profile production
```

## iOS: App Store Connect Setup

1. Create an app in [App Store Connect](https://appstoreconnect.apple.com)
   - Bundle ID: `com.steadfast.coachplatform`
   - SKU: `coach-platform`
2. Update `eas.json` → `submit.production.ios`:
   - `appleId`: your Apple ID email
   - `ascAppId`: numeric ID from App Store Connect
   - `appleTeamId`: your team ID
3. Generate an App Store Connect API key (recommended for CI):
   - Users → Keys → Generate
   - Download the `.p8` file
4. After build, run `eas submit --platform ios`
5. In App Store Connect:
   - Select the build in TestFlight
   - Add internal/external testers
   - Fill in App Information (description, screenshots, keywords)
   - Set privacy policy URL: `https://steadfast.coach/privacy`
   - Submit for review

## Android: Google Play Console Setup

1. Create an app in [Play Console](https://play.google.com/console)
   - Package: `com.steadfast.coachplatform`
2. Create a service account:
   - Google Cloud Console → IAM → Service Accounts → Create
   - Grant "Service Account User" role
   - Download JSON key → save as `apps/mobile/service-account.json`
   - In Play Console → Settings → API access → link the service account
3. After build, run `eas submit --platform android`
4. In Play Console:
   - Set up Internal Testing track
   - Add testers by email
   - Fill Store Listing (description, screenshots, feature graphic)
   - Set privacy policy URL
   - Submit for review

## Reviewer Mode

Set `EXPO_PUBLIC_REVIEWER_MODE=true` in EAS environment to show a "Reviewer Mode" banner. This signals the app is under review and provides soft fallbacks for empty screens.

## Store Submission Checklist

### Before Building
- [ ] Replace placeholder icon assets (see `ASSET_REQUIREMENTS.md`)
- [ ] Set `EXPO_PUBLIC_API_BASE_URL` to production URL in EAS Secrets
- [ ] Set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in EAS Secrets
- [ ] Verify legal URLs in `lib/legal.ts` are live and accessible
- [ ] Update `version` in `app.json` if needed

### Before Submitting iOS
- [ ] Create app in App Store Connect
- [ ] Fill `eas.json` → `submit.production.ios` fields
- [ ] Prepare 6.7" and 5.5" screenshots (iPhone 15 Pro Max / iPhone 8 Plus)
- [ ] Write app description (includes "coaching", "check-in", "meal plan")
- [ ] Set Age Rating (likely 4+, no objectionable content)
- [ ] Set Privacy Policy URL
- [ ] Set Support URL
- [ ] Add demo account credentials in App Review Information

### Before Submitting Android
- [ ] Create app in Play Console
- [ ] Set up service account + download JSON key
- [ ] Prepare phone + 7" + 10" screenshots
- [ ] Write short + full description
- [ ] Set Content Rating (fill questionnaire)
- [ ] Set Privacy Policy URL
- [ ] Complete Data Safety form

### Reviewer Notes (paste into review notes)
```
Demo account:
Email: [your demo email]
Password: [your demo password]

The app requires a coach connection to show data.
The demo account is pre-connected to a coach with sample check-ins and meal plans.
```
