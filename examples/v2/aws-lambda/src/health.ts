/**
 * Health check handler for AWS Lambda
 */

import { APIGatewayProxyResult } from "aws-lambda";

export const handler = async (): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({
      status: "healthy",
      service: "copilotkit-lambda-runtime",
      timestamp: new Date().toISOString(),
      version: "2.0.0",
    }),
  };
};
