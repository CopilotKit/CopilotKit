import {
  NodeSDK,
  getNodeAutoInstrumentations,
  ATTR_SERVICE_NAME,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  AlwaysOnSampler,
  AlwaysOffSampler,
  OTLPHttpExporter,
  OTLPGrpcExporter,
  CompositeExporter,
  resourceFromAttributes,
} from '@mastra/core/telemetry/otel-vendor';
import { telemetry } from './telemetry-config.mjs';

function getSampler(config) {
  if (!config.sampling) {
    return new AlwaysOnSampler();
  }

  if (!config.enabled) {
    return new AlwaysOffSampler();
  }

  switch (config.sampling.type) {
    case 'ratio':
      return new TraceIdRatioBasedSampler(config.sampling.probability);
    case 'always_on':
      return new AlwaysOnSampler();
    case 'always_off':
      return new AlwaysOffSampler();
    case 'parent_based':
      const rootSampler = new TraceIdRatioBasedSampler(config.sampling.root?.probability || 1.0);
      return new ParentBasedSampler({ root: rootSampler });
    default:
      return new AlwaysOnSampler();
  }
}

async function getExporters(config) {
  const exporters = [];

  // Add local exporter by default
  if (!config.disableLocalExport) {
    exporters.push(new OTLPHttpExporter({
      url: `http://localhost:${process.env.PORT ?? 4111}/api/telemetry`,
      headers: process.env.MASTRA_DEV ? {
        'x-mastra-dev-playground': 'true',
      } : {},
    }));
  }

  if (config.export?.type === 'otlp') {
    if (config.export?.protocol === 'grpc') {
      exporters.push(new OTLPGrpcExporter({
        url: config.export.endpoint,
        headers: config.export.headers,
      }));
    } else {
      exporters.push(new OTLPHttpExporter({
        url: config.export.endpoint,
        headers: config.export.headers,
      }));
    }
  } else if (config.export?.type === 'custom') {
    exporters.push(config.export.exporter);
  }

  return exporters
}

const sampler = getSampler(telemetry);
const exporters = await getExporters(telemetry);
const compositeExporter = new CompositeExporter(exporters);

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: telemetry.serviceName || 'default-service',
  }),
  sampler,
  traceExporter: compositeExporter,
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// gracefully shut down the SDK on process exit
process.on('SIGTERM', () => {
  sdk.shutdown().catch(() => {
    // do nothing
  });
});
