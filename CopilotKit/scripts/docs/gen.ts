import { REFERENCE_DOCS } from "./lib/files";
import { ReferenceDoc } from "./lib/reference-doc";

Promise.all(
  REFERENCE_DOCS.map(async (referenceDoc) => {
    const doc = new ReferenceDoc(referenceDoc);
    await doc.generate();
  }),
)
  .then(() => {
    console.log("All reference docs processed");
  })
  .catch((error) => {
    console.error("Error processing reference docs:", error);
  });
