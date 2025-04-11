import React from 'react';

export type AgentStateProps = {
  state: State;
  setState?: (state: State) => void;
  className: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type State = any;

export function AgentState({ state, setState, className}: AgentStateProps) {
  const { messages, ...rest } = state;
  const [editableState, setEditableState] = React.useState(JSON.stringify(rest, null, 2));
  const [isEditing, setIsEditing] = React.useState(false);
  const [hasChanges, setHasChanges] = React.useState(false);
  
  // Update editable state when the actual state changes (if not currently editing)
  React.useEffect(() => {
    if (!isEditing) {
      setEditableState(JSON.stringify(rest, null, 2));
      setHasChanges(false); 
    }
  }, [rest, isEditing]);

  const handleEditToggle = () => {
    setIsEditing(!isEditing);
    if (isEditing) {
      // Reset to original state when canceling edit
      setEditableState(JSON.stringify(rest, null, 2));
      setHasChanges(false);
    }
  };

  const handleStateChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditableState(e.target.value);
    setHasChanges(true);
  };

  const handleSubmit = () => {
    try {
      const newState = JSON.parse(editableState);
      if (setState) setState({ ...newState, messages });
      setIsEditing(false);
      setHasChanges(false);
    } catch (error) {
      alert(`Invalid JSON format. Please check your input. \n\n${error}`);
    }
  };

  const wrapperStyles = `${className} bg-gradient-to-r from-indigo-200 to-pink-200 shadow-inner overflow-auto`;
  const headerStyles = `sticky top-0 p-4 pt-4 pb-2 bg-indigo-500/50 backdrop-blur-sm shadow-md flex justify-between items-center z-10`;
  const headerTextStyles = `text-white text-lg font-medium p-4`;
  const agentNameStyles = `underline`;
  const buttonStyles = `px-3 py-1 text-sm rounded bg-slate-200 hover:bg-slate-300 transition-colors text-slate-700`;
  const textareaStyles = `w-full h-[calc(100vh-120px)] font-mono text-sm p-3 bg-white border border-slate-300 bg-opacity-80 backdrop-blur-sm rounded resize-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 outline-none`;
  const preStyles = `font-mono text-slate-700 h-[calc(100vh-120px)] whitespace-pre-wrap break-words text-sm w-full overflow-x-hidden p-3 bg-white border border-slate-200 rounded`;
  
  return (
    <div className={wrapperStyles}>
      <div className={headerStyles}>
        <h2 className={headerTextStyles}>
          <span className={agentNameStyles}>{process.env.NEXT_PUBLIC_AGENT_NAME}</span> state
        </h2>
        <div className="flex gap-2">
          {hasChanges && (
            <button
              onClick={handleSubmit}
              className={buttonStyles}
            >
              Save
            </button>
          )}
          <button 
            onClick={handleEditToggle}
            className={buttonStyles}
          >
            {isEditing ? "Cancel" : "Edit"}
          </button>
        </div>
      </div>
      
      <div className="p-4">
        {isEditing ? (
          <div className="space-y-3">
            <textarea
              value={editableState}
              onChange={handleStateChange}
              className={textareaStyles}
              spellCheck="false"
            />
          </div>
        ) : (
          <pre className={preStyles}>
            {editableState}
          </pre>
        )}
      </div>
    </div>
  );
}