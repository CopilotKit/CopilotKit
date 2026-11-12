import { createLicenseChecker } from "./license";

const service = { licenseChecker: createLicenseChecker() };

export const status = service.licenseChecker.getStatus();
