import { useId } from 'react'

import type { CopilotAction } from '../shared/types'
export type { CopilotAction }

import { useEffect, useContext } from 'react';
import { EntryPointContext } from './context';

export function useCopilotEntrypoint<ActionInput extends any[]>(
   action: CopilotAction<ActionInput>
) {
  // const { setEntryPoint, removeEntryPoint } = useContext(EntryPointContext);

  // useEffect(() => {
  //   setEntryPoint(id, func);
    
  //   return () => {
  //     removeEntryPoint(id);
  //   };
  // }, [id, func, setEntryPoint, removeEntryPoint]);

  
  return {}
}


