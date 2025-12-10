#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

console.log('\n🔍 Verifying Agent Execution Telemetry Events\n');

// Check the LangGraphAgent for telemetry
const agentPath = path.join(__dirname, 'CopilotKit/packages/runtime/src/lib/runtime/agent-integrations/langgraph/agent.ts');
const agentContent = fs.readFileSync(agentPath, 'utf8');

const events = [
  'oss.runtime.agent_execution_stream_started',
  'oss.runtime.agent_execution_stream_ended',
  'oss.runtime.agent_execution_stream_errored'
];

console.log('Checking LangGraphAgent for telemetry events:');
console.log('-----------------------------------------------');
events.forEach(event => {
  if (agentContent.includes(event)) {
    console.log(`  ✓ ${event} - FOUND`);
  } else {
    console.log(`  ✗ ${event} - MISSING`);
  }
});

// Check telemetry import
console.log('\nChecking telemetry imports:');
console.log('-----------------------------------------------');
if (agentContent.includes('import telemetry from')) {
  console.log('  ✓ Telemetry client imported');
}
if (agentContent.includes('createHash')) {
  console.log('  ✓ createHash imported for API key hashing');
}
if (agentContent.includes('AgentExecutionResponseInfo')) {
  console.log('  ✓ AgentExecutionResponseInfo type imported');
}

// Check telemetry structure
console.log('\nChecking telemetry implementation:');
console.log('-----------------------------------------------');
if (agentContent.includes('getHashedLgcKey')) {
  console.log('  ✓ getHashedLgcKey method for API key hashing');
}
if (agentContent.includes('streamInfo.model')) {
  console.log('  ✓ Model info captured');
}
if (agentContent.includes('streamInfo.langGraphHost')) {
  console.log('  ✓ LangGraph host info captured');
}
if (agentContent.includes('streamInfo.langGraphVersion')) {
  console.log('  ✓ LangGraph version info captured');
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

console.log('\n✅ Agent Execution Telemetry Verification Complete!\n');
