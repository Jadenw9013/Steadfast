# Asset Requirements for Store Submission

All assets must be placed in `apps/mobile/assets/` before submitting to stores.

## Required Assets

| Asset | Size | Format | Purpose |
|---|---|---|---|
| `icon.png` | 1024 × 1024 px | PNG, no alpha | App icon (iOS + Android fallback) |
| `adaptive-icon.png` | 1024 × 1024 px | PNG with transparency OK | Android adaptive icon foreground. Content must be centered in the inner 66% safe zone (≈ 680 × 680 px usable area). |
| `favicon.png` | 48 × 48 px | PNG | Web favicon |
| `splash-icon.png` | 288 × 288 px | PNG with transparency OK | Centered on splash screen (optional — currently uses `icon.png`) |

## Design Guidelines

- **Icon**: Solid background `#09090b`, white or light logo/mark centered.
- **No rounded corners**: iOS and Android crop automatically.
- **No text in icon**: App name is displayed by the OS.
- **Adaptive icon foreground**: Only the center 66% is guaranteed visible. Do NOT place content near edges.

## Export Checklist

1. Export `icon.png` at exactly 1024×1024, sRGB, no alpha channel
2. Export `adaptive-icon.png` at 1024×1024, sRGB, alpha OK
3. Export `favicon.png` at 48×48
4. Run `npx expo export` to verify no asset warnings
5. Commit to source control
