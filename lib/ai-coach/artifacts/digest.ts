import { contentHash } from "../canonical-json";
import { type ArtifactDraftInput, parseArtifactDraftInput } from "./schema";

export function artifactDigestPayload(input: ArtifactDraftInput) {
  return {
    id: input.id,
    artifactKey: input.artifactKey,
    version: input.version,
    kind: input.kind,
    schemaVersion: input.schemaVersion,
    engineVersions: input.engineVersions,
    dependencies: input.dependencies,
    synthetic: input.synthetic,
    reviewMetadata: input.reviewMetadata,
    content: input.content,
  };
}

export function artifactContentDigest(raw: unknown): string {
  return contentHash(artifactDigestPayload(parseArtifactDraftInput(raw)));
}
