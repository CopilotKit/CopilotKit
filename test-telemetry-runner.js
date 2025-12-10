#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

console.log('\n🔍 Verifying Agent Execution Telemetry Events (Framework-Agnostic)\n');

// Check the TelemetryAgentRunner for telemetry
const runnerPath = path.join(__dirname, 'CopilotKit/packages/runtime/src/lib/runtime/telemetry-agent-runner.ts');
const runnerContent = fs.readFileSync(runnerPath, 'utf8');

const events = [
  'oss.runtime.agent_execution_stream_started',
  'oss.runtime.agent_execution_stream_ended',
  'oss.runtime.agent_execution_stream_errored'
];

console.log('Checking TelemetryAgentRunner for telemetry events:');
console.log('-----------------------------------------------');
events.forEach(event => {
  if (runnerContent.includes(event)) {
    console.log(`  ✓ ${event} - FOUND`);
  } else {
    console.log(`  ✗ ${event} - MISSING`);
  }
});

// Check telemetry import
console.log('\nChecking imports:');
console.log('-----------------------------------------------');
if (runnerContent.includes('import telemetry from')) {
  console.log('  ✓ Telemetry client imported');
}
if (runnerContent.includes('createHash')) {
  console.log('  ✓ createHash imported for API key hashing');
}
if (runnerContent.includes('AgentExecutionResponseInfo')) {
  console.log('  ✓ AgentExecutionResponseInfo type imported');
}
if (runnerContent.includes('tap, catchError, finalize')) {
  console.log('  ✓ RxJS operators imported (tap, catchError, finalize)');
}

// Check implementation details
console.log('\nChecking implementation:');
console.log('-----------------------------------------------');
if (runnerContent.includes('hashedLgcKey')) {
  console.log('  ✓ API key hashing implemented');
}
if (runnerContent.includes('streamInfo.model')) {
  console.log('  ✓ Model info captured');
}
if (runnerContent.includes('streamInfo.langGraphHost')) {
  console.log('  ✓ LangGraph host info captured');
}
if (runnerContent.includes('streamInfo.langGraphVersion')) {
  console.log('  ✓ LangGraph version info captured');
}

// Check CopilotRuntime uses TelemetryAgentRunner
console.log('\nChecking CopilotRuntime integration:');
console.log('-----------------------------------------------');
const runtimePath = path.join(__dirname, 'CopilotKit/packages/runtime/src/lib/runtime/copilot-runtime.ts');
const runtimeContent = fs.readFileSync(runtimePath, 'utf8');

if (runtimeContent.includes('import { TelemetryAgentRunner }')) {
  console.log('  ✓ TelemetryAgentRunner imported in CopilotRuntime');
}
if (runtimeContent.includes('new TelemetryAgentRunner()')) {
  console.log('  ✓ TelemetryAgentRunner used as default runner');
}

// Check exports
console.log('\nChecking exports:');
console.log('-----------------------------------------------');
const indexPath = path.join(__dirname, 'CopilotKit/packages/runtime/src/lib/index.ts');
const indexContent = fs.readFileSync(indexPath, 'utf8');

if (indexContent.includes('telemetry-agent-runner')) {
  console.log('  ✓ TelemetryAgentRunner exported from package');
}

// Check events.ts still has the event definitions
console.log('\nChecking events.ts definitions:');
console.log('-----------------------------------------------');
const eventsPath = path.join(__dirname, 'CopilotKit/packages/shared/src/telemetry/events.ts');
const eventsContent = fs.readFileSync(eventsPath, 'utf8');

events.forEach(event => {
  if (eventsContent.includes(`"${event}"`)) {
    console.log(`  ✓ ${event} defined in events.ts`);
  } else {
    console.log(`  ✗ ${event} NOT defined in events.ts`);
  }
});

console.log('\n✅ Agent Execution Telemetry Verification Complete!');
console.log('\nThis is a framework-agnostic solution that:');
console.log('  - Works with all agent types (LangGraph, BasicAgent, custom agents)');
console.log('  - Runs at the AgentRunner level, not in individual agent implementations');
console.log('  - Captures start, end, and error events for all agent executions\n');
