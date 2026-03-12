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