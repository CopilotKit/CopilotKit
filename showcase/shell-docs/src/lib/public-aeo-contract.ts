import contract from "../../../shared/aeo/public-surface-contract.v1.json";

export type PublicAeoContract = typeof contract;

// The human policy and machine endpoint intentionally read the same artifact.
// Do not copy contract fields into either presentation surface.
export const publicAeoContract: PublicAeoContract = contract;
