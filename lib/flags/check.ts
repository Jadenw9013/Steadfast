export async function checkFeatureEnabled(featureName: string, userId: string) {
  const envOverride = process.env[`FEATURE_${featureName}`];
  if (envOverride !== undefined) {
    return envOverride === "true";
  }
  // check unleashed
  return true;
}
