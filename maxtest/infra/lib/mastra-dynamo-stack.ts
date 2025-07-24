import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { requireEnv } from "./utils";

export class MastraDynamoDbStack extends cdk.NestedStack {
  tableName: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const uniqueEnvironmentId = requireEnv("UNIQUE_ENV_ID");

    // Consider parameterizing the table name for different environments
    const tableName = `mastra-dojo-shared-memory-table-${uniqueEnvironmentId}`;

    // Create the single table
    const table = new dynamodb.Table(this, "MastraDojoSharedMemoryTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Add GSI1
    table.addGlobalSecondaryIndex({
      indexName: "gsi1",
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
      // projectionType defaults to ALL in CDK, which is suitable for flexible querying but has cost implications.
    });

    // Add GSI2 (Used by Trace and WorkflowSnapshot)
    table.addGlobalSecondaryIndex({
      indexName: "gsi2",
      partitionKey: { name: "gsi2pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi2sk", type: dynamodb.AttributeType.STRING },
      // projectionType defaults to ALL in CDK
    });

    this.tableName = table.tableName;

       new cdk.CfnOutput(this, "TableName", {
      value: table.tableName,
    });


    new cdk.CfnOutput(this, "UniqueEnvironmentId", {
      value: `${uniqueEnvironmentId}`,
    });


    // Add tag for PR number to all resources
    cdk.Tags.of(this).add("env-id", uniqueEnvironmentId);
    cdk.Tags.of(this).add("dojo-e2e-env", "true");
  }
}
