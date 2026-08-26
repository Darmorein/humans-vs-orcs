/**
 * Procedural artifacts — forged from world conditions; ownership moves by deed.
 */
export type {
  Artifact,
  ArtifactType,
  ArtifactQuality,
  ArtifactEffect,
  ArtifactHistoryEntry,
} from './Types';
export {
  artifactTypeLabel,
  artifactQualityLabel,
  MAX_ARTIFACTS_PER_PLAYER,
} from './Types';
export { generateArtifactName } from './Names';
export { ArtifactSystem } from './ArtifactSystem';
