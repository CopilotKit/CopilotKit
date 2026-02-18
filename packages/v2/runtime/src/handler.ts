export type CopilotKitRequestHandler = (params: {
  request: Request;
}) => Promise<Response>;
