# QA: A2UI Fixed Schema — LlamaIndex

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the a2ui-fixed-schema demo page
- [ ] Verify the chat interface loads with placeholder "Type a message"

### 2. Fixed Flight Card

- [ ] Click the "Find SFO → JFK" suggestion
- [ ] Verify a flight card renders with:
  - [ ] Title "Flight Details"
  - [ ] Origin airport code (SFO)
  - [ ] Arrow
  - [ ] Destination airport code (JFK)
  - [ ] Airline badge
  - [ ] Price tag
- [ ] Verify the "Book flight" button is visible
