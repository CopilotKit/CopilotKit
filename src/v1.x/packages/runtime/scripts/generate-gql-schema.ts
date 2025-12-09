import "reflect-metadata";
import { buildSchema } from "../src/lib/integrations/shared";
import path from "node:path";

console.log("Generating schema...");

const outputPath = path.resolve(__dirname, "../__snapshots__/schema/schema.graphql");

buildSchema({
  emitSchemaFile: path.resolve(__dirname, outputPath),
});

console.log(`Schema generated to ${outputPath}`);
