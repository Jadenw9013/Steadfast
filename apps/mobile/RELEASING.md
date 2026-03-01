# Releasing

## Version Numbers

| Field | File | Purpose |
|---|---|---|
| `version` | `app.json` → `expo.version` | User-facing version (e.g. `1.0.0`) |
| `ios.buildNumber` | `app.json` → `expo.ios.buildNumber` | iTunes build identifier (string) |
| `android.versionCode` | `app.json` → `expo.android.versionCode` | Play Store build number (integer) |

> **Note**: EAS Build with `autoIncrement: true` (production profile) auto-increments `buildNumber` and `versionCode` on each build. You only need to bump `version` manually for new marketing releases.

## Release Procedure

### 1. Bump version (marketing release only)

```bash
# In app.json, change:
#   "version": "1.0.0" → "1.1.0"
# Also update lib/legal.ts → appInfo.version to match
```

### 2. Build

```bash
# Preview/internal testing:
npx eas-cli build --profile preview --platform all

# Production (store submission):
npx eas-cli build --profile production --platform all
```

### 3. Submit

```bash
# iOS (TestFlight → App Store):
npx eas-cli submit --platform ios --profile production

# Android (Internal Track → Production):
npx eas-cli submit --platform android --profile production
```

### 4. Post-release

1. Tag the release in git: `git tag v1.1.0 && git push --tags`
2. Update `CHANGELOG.md` if you maintain one
3. Monitor crash reports in Expo dashboard
