// Compatibility facade; Runtime owns the shared implementation.
// Named exports also preserve bindings when adapters bundle this facade as CJS.
export {
  MAX_ARCHIVE_ENTRIES,
  MAX_SNAPSHOT_BYTES,
  safeRelativePath,
  readArchive,
  resolveRegistryConfig,
  SkillDeliveryError,
  invalidSnapshot,
  SkillRegistry,
  validateSnapshot,
  formatSkillCatalog,
  loadSkill,
  readSkillFile,
} from "@copilotkit/runtime/internal/learned-skills";
export type {
  SkillRegistryOptions,
  RegistryConfig,
  SkillDeliveryErrorCode,
  SkillRegistryStatus,
  SnapshotFile,
  SnapshotSkill,
  VerifiedSnapshot,
} from "@copilotkit/runtime/internal/learned-skills";
