import React, { useState, useRef, useCallback, useEffect } from 'react';
import { CopilotKitProps } from '../copilot-provider/copilotkit-props';
import { debounce, throttle } from 'lodash';
import { css } from '@emotion/react';

interface CopilotInputProps extends Pick<CopilotKitProps, 'publicApiKey' | 'runtimeUrl' | 'headers'> {
  placeholder?: string;
  label: string; // Adding a label prop for accessibility
}

const srOnlyStyle = css`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
`;

export const CopilotInput: React.FC<CopilotInputProps> = ({
  publicApiKey,
  runtimeUrl,
  headers,
  placeholder = 'Type here...',
  label,
}) => {
  const [userInput, setUserInput] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [isFadingOut, setIsFadingOut] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastApiCallTime = useRef(0);

  // Simulated function to generate suggestions
  const generateSuggestion = async (input: string) => {
    // TODO: Implement actual API call to get suggestions
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate API delay
    return input + ' suggestion';
  };

  const throttledApiCall = useCallback(
    throttle(async (input: string) => {
      if (input.trim()) {
        const newSuggestion = await generateSuggestion(input);
        setSuggestion(newSuggestion);
      } else {
        setSuggestion('');
      }
      lastApiCallTime.current = Date.now();
    }, 300),
    []
  );

  const debouncedInputHandler = useCallback(
    debounce((input: string) => {
      setUserInput(input);
      const timeSinceLastCall = Date.now() - lastApiCallTime.current;
      if (timeSinceLastCall >= 300) {
        throttledApiCall(input);
      } else {
        setTimeout(() => throttledApiCall(input), 300 - timeSinceLastCall);
      }
    }, 50),
    []
  );

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newInput = event.target.value;
    setIsFadingOut(false);
    debouncedInputHandler(newInput);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === 'Tab' || event.key === 'Enter') && suggestion) {
      event.preventDefault();
      setUserInput(suggestion);
      setSuggestion('');
      // Announce the accepted suggestion for screen readers
      announceForScreenReader(`Suggestion accepted: ${suggestion}`);
    } else if (event.key === 'Escape') {
      setSuggestion('');
      setIsFadingOut(true);
      // Announce the ignored suggestion for screen readers
      announceForScreenReader('Suggestion ignored');
    } else if (event.key === 'ArrowRight' && suggestion) {
      event.preventDefault();
      setUserInput(suggestion);
      setSuggestion('');
      // Announce the accepted suggestion for screen readers
      announceForScreenReader(`Suggestion accepted: ${suggestion}`);
    }
  };

  const displaySuggestion = () => {
    if (suggestion.startsWith(userInput)) {
      return suggestion.slice(userInput.length);
    }
    return '';
  };

  // Function to announce messages for screen readers
  const announceForScreenReader = (message: string) => {
    const announcement = document.createElement('div');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.setAttribute('class', 'sr-only');
    announcement.textContent = message;
    document.body.appendChild(announcement);
    setTimeout(() => document.body.removeChild(announcement), 1000);
  };

  // Effect to handle fading out ignored suggestions
  useEffect(() => {
    if (isFadingOut) {
      const timer = setTimeout(() => {
        setIsFadingOut(false);
      }, 500); // Duration of fade-out animation
      return () => clearTimeout(timer);
    }
  }, [isFadingOut]);

  return (
    <div className="copilot-input-wrapper">
      <label htmlFor="copilot-input" css={srOnlyStyle}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id="copilot-input"
          ref={inputRef}
          type="text"
          value={userInput}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-autocomplete="both"
          aria-describedby="copilot-suggestion"
          style={{
            width: '100%',
            padding: '8px',
            fontSize: '16px',
            lineHeight: '1.5',
          }}
        />
        <div
          id="copilot-suggestion"
          className="suggestion-overlay"
          aria-live="polite"
          style={{
            position: 'absolute',
            top: '0',
            left: '0',
            right: '0',
            bottom: '0',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            padding: '8px',
            fontSize: '16px',
            lineHeight: '1.5',
          }}
        >
          <span style={{ color: 'transparent' }}>{userInput}</span>
          <span
            className="suggestion-text"
            style={{
              color: 'gray',
              opacity: isFadingOut ? 0 : 0.5,
              transition: 'opacity 0.5s ease-out',
            }}
          >
            {displaySuggestion()}
          </span>
        </div>
      </div>
      <div css={srOnlyStyle} aria-live="polite">
        {suggestion ? `Suggestion: ${suggestion}. Press Tab, Enter, or Right Arrow to accept.` : ''}
      </div>
    </div>
  );
};
