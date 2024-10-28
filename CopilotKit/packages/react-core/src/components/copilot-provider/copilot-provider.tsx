import React from 'react';
import { CopilotKitProps } from './copilotkit-props';
import { CopilotInput } from '../copilot-input/copilot-input';

export const CopilotProvider: React.FC<CopilotKitProps> = (props) => {
  return (
    <div>
      <h1>CopilotKit Demo</h1>
      <CopilotInput
        publicApiKey={props.publicApiKey}
        runtimeUrl={props.runtimeUrl}
        headers={props.headers}
        placeholder="Start typing to get suggestions..."
      />
      {props.children}
    </div>
  );
};
