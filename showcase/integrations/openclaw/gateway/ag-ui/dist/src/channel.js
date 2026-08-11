export const aguiChannelPlugin = {
  id: "ag-ui",
  meta: {
    id: "ag-ui",
    label: "AG-UI",
    selectionLabel: "AG-UI (CopilotKit / HttpAgent)",
    docsPath: "/channels/agui",
    docsLabel: "agui",
    blurb: "AG-UI protocol endpoint for CopilotKit and HttpAgent clients.",
    order: 90,
  },
  capabilities: {
    chatTypes: ["direct"],
    blockStreaming: true,
  },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: () => ({
      accountId: "default",
      enabled: true,
      configured: true,
    }),
    defaultAccountId: () => "default",
  },
  pairing: {
    idLabel: "aguiDeviceId",
    normalizeAllowEntry: (entry) => entry.replace(/^ag-ui:/i, "").toLowerCase(),
  },
};
