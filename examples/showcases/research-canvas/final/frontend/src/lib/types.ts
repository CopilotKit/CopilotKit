export interface Section { title: string; content: string; idx: number; footer?: string; id: string }
// export interface Section { title: string; content: string; idx: number; footnotes?: string; id: string }


export interface Source {
    content: string;
    published_date: string;
    score: number;
    title: string;
    url: string;
}
export type Sources = Record<string, Source>

export interface Log {
    message: string;
    done: boolean;
}

export interface ProposalSection {
    title: string;
    description: string
    approved: boolean
}

export enum ProposalSectionName {
    Sections = "sections",
}

export type IProposalItem = Record<string, ProposalSection>

export interface Proposal {
    [ProposalSectionName.Sections]: IProposalItem
    timestamp: string
    approved: boolean
    remarks?: string,
}

// This interface corresponds to the state defined in agent/state.py
export interface ResearchState {
    title: string;
    outline: Record<string, unknown>;
    proposal: Proposal;
    // structure: Record<string, unknown>;
    sections: Section[]; // Array of objects with 'title', 'content', and 'idx'
    sources: Sources; // Dictionary with string keys and nested dictionaries
    tool: string;
    messages: { [key: string]: unknown }[]; // Array of AnyMessage objects with potential additional properties
    logs: Log[];
}

// export type Document = Pick<ResearchState, 'sections' | 'title' | 'intro' | 'outline' | 'conclusion' | 'cited_sources'>

