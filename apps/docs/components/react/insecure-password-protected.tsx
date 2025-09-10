'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
interface InsecurePasswordProtectedProps {
  password?: string;
  unauthenticatedComponent?: React.ReactNode;
  children: React.ReactNode;
}

const defaultUnauthenticatedComponent = (
  <div className="space-y-4 text-center">
    <h3 className="text-xl font-bold">This content is protected by a password.</h3>
    <div className="text-base mx-auto">
      <p>
        This content is for an upcoming release and not yet publicly available. If you’d like to apply for early access, please
        <a target="_blank" rel="noreferrer" href="https://go.copilotkit.ai/earlyaccess" className="ml-1 underline">click here.</a>
      </p>
      <p>If you’re already apart of the early adopter group, please enter your password!</p>
    </div>
  </div>
)

/**
 * This component is used to "protect" content that is not intended for public consumption yet, i.e. early access content.
 * 
 * For the moment this is completely insecure, as it relies on a single shared password for all users that is publicly
 * viewable. Additionally, the password can be easily bypassed.
 * 
 * However, this is fine for us as the content is not a secret or sensitive. We just want to prevent dissuade users from
 * using the content outside of the early adopter group, not completely prevent it.
 */
export function InsecurePasswordProtected({ 
  password = process.env.NEXT_PUBLIC_LGC_DOCS_PASSWORD, 
  unauthenticatedComponent = defaultUnauthenticatedComponent, 
  children 
}: InsecurePasswordProtectedProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [storedPassword, setStoredPassword] = useState(() => {
    // Initialize state from localStorage if available
    if (typeof window !== 'undefined') {
      return localStorage.getItem('storedPassword') || '';
    }
    return '';
  });

  if (!password) {
    return <>{children}</>;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input === password) {
      setStoredPassword(input);
      setError('');
      localStorage.setItem('storedPassword', input);
    } else {
      setError('Incorrect password');
      setInput('');
    }
  };

  if (storedPassword === password) {
    return <>{children}</>;
  }

  return (
    <div className="w-full">
      <div className="hidden">
        If you're looking at this code, you'll probably notice that this is a very shallow layer of security. This 
        is very intentional, we don't want to make it impossible for users to access this content just 
        difficult until we're ready to make it readily available.
      </div>
      <div className="flex flex-col gap-6 p-8 border rounded-lg shadow-lg">
        {unauthenticatedComponent}
        <hr className="my-0" />
        <div className="flex gap-4">
          <Input
            type="password"
            autoComplete="off"
            className='w-full'
            placeholder="Enter password..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSubmit(e);
              }
            }}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError('');
            }}
            aria-invalid={!!error}
            aria-describedby={error ? "password-error" : undefined}
          />
          <Button onClick={handleSubmit}>Submit</Button>
        </div>
        {error && (
          <p id="password-error" className="text-sm text-red-500 mt-1">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
