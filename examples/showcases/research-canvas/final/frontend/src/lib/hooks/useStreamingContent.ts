import { useState, useEffect } from 'react';
import { ResearchState, Section } from '../types';

export function useStreamingContent(state: ResearchState) {
    const [currentSection, setCurrentSection] = useState<Section | null>(null);

    useEffect(() => {
        Object.keys(state).forEach(k => {
            const key = k as keyof ResearchState
            if (!key.startsWith('section_stream')) return;

            const [, streamType, idx, id, title] = key.split('.');
            const value = state[key]
            setCurrentSection(prev => {
                if (value == null) return null
                // If this is a new section, create new state
                if (prev?.id !== id) {
                    return {
                        idx: Number(idx),
                        id,
                        title,
                        content: (streamType === 'content' ? value : null) as Section['content'],
                        footer: (streamType === 'footer' ? value : null) as Section['footer'],
                    };
                }

                // Update existing section
                return {
                    ...prev,
                    [streamType]: value
                };
            });
        });
    }, [state]);

    return currentSection;
} 