export interface PRData {
    id: string;
    title: string;
    status: string;
    assignedReviewer: string;
    assignedTester: string;
    daysSinceStatusChange: number;
    createdAt: string;
    updatedAt: string;
    userId: number;
    author: string;
    repository: string;
    branch: string;
}

export interface chartData {
    name: string;
    value: number;
}

export interface WeeklyCount {
    week: string;
    count: number;
}

export interface TestsData {
    testId: string;
    prId: string;
    title: string;
    status: 'passed' | 'failed' | 'in_progress';
    testCases: TestCase[];
    totalTestCases: number;
    passedTestCases: number;
    failedTestCases: number;
    skippedTestCases: number;
    coverage: number;
    createdAt: string;
    updatedAt: string;
    executedBy: string;
    shortDescription?: string;
    codeSnippet?: string;
}

interface TestCase {
    id: string;
    name: string;
    status: 'passed' | 'failed' | 'in_progress' | 'pending';
    executionTime: string;
    createdAt: string;
    updatedAt: string;
    environment: string;
    browser?: string;
    device?: string;
    testSteps: string[];
    failureReason?: string;
}

    