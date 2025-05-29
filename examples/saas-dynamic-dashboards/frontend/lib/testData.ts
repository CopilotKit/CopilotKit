export const testData = [
    {
        testId: 'TEST001',
        prId: 'PR01',
        title: 'User Authentication Flow Test Suite',
        status: 'passed',
        testCases: [
            {
                id: 'TC001-1',
                name: 'Login with valid credentials',
                status: 'passed',
                executionTime: '1.2s',
                createdAt: '2025-04-28T15:00:00.000Z',
                updatedAt: '2025-04-28T15:05:00.000Z',
                environment: 'staging',
                browser: 'Chrome',
                testSteps: [
                    'Enter valid email',
                    'Enter valid password',
                    'Click login button',
                    'Verify successful login'
                ]
            },
            {
                id: 'TC001-2',
                name: 'Login with invalid credentials',
                status: 'passed',
                executionTime: '0.8s',
                createdAt: '2025-04-28T15:10:00.000Z',
                updatedAt: '2025-04-28T15:15:00.000Z',
                environment: 'staging',
                browser: 'Firefox',
                testSteps: [
                    'Enter invalid email',
                    'Enter invalid password',
                    'Click login button',
                    'Verify error message'
                ]
            },
            {
                id: 'TC001-3',
                name: 'Password reset flow',
                status: 'passed',
                executionTime: '1.5s',
                createdAt: '2025-04-28T15:20:00.000Z',
                updatedAt: '2025-04-28T15:25:00.000Z',
                environment: 'staging',
                browser: 'Safari',
                testSteps: [
                    'Click forgot password',
                    'Enter email',
                    'Verify reset email sent',
                    'Click reset link',
                    'Set new password'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 3,
        failedTestCases: 0,
        skippedTestCases: 0,
        coverage: 85,
        createdAt: '2025-04-28T14:30:00.000Z',
        updatedAt: '2025-04-28T15:30:00.000Z',
        executedBy: 'jane.smith@got.com'
    },
    {
        testId: 'TEST002',
        prId: 'PR02',
        title: 'Navigation Menu Responsiveness Test Suite',
        status: 'passed',
        testCases: [
            {
                id: 'TC002-1',
                name: 'Mobile view navigation',
                status: 'passed',
                executionTime: '1.0s',
                createdAt: '2025-05-18T19:00:00.000Z',
                updatedAt: '2025-05-18T19:05:00.000Z',
                environment: 'staging',
                device: 'iPhone 12',
                testSteps: [
                    'Resize viewport to mobile',
                    'Verify hamburger menu',
                    'Click menu items',
                    'Check responsive behavior'
                ]
            },
            {
                id: 'TC002-2',
                name: 'Tablet view navigation',
                status: 'passed',
                executionTime: '0.9s',
                createdAt: '2025-05-18T19:10:00.000Z',
                updatedAt: '2025-05-18T19:15:00.000Z',
                environment: 'staging',
                device: 'iPad Pro',
                testSteps: [
                    'Resize viewport to tablet',
                    'Verify menu layout',
                    'Test menu interactions',
                    'Check responsive behavior'
                ]
            },
            {
                id: 'TC002-3',
                name: 'Desktop view navigation',
                status: 'passed',
                executionTime: '0.7s',
                createdAt: '2025-05-18T19:20:00.000Z',
                updatedAt: '2025-05-18T19:25:00.000Z',
                environment: 'staging',
                device: 'Desktop',
                testSteps: [
                    'Resize viewport to desktop',
                    'Verify full menu display',
                    'Test dropdown menus',
                    'Check hover states'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 3,
        failedTestCases: 0,
        skippedTestCases: 0,
        coverage: 90,
        createdAt: '2025-05-18T18:30:00.000Z',
        updatedAt: '2025-05-18T19:30:00.000Z',
        executedBy: 'sarah.wilson@got.com'
    },
    {
        testId: 'TEST003',
        prId: 'PR03',
        title: 'Payment Module Unit Test Suite',
        status: 'failed',
        testCases: [
            {
                id: 'TC003-1',
                name: 'Payment validation',
                status: 'failed',
                executionTime: '0.5s',
                createdAt: '2025-05-06T09:00:00.000Z',
                updatedAt: '2025-05-06T09:05:00.000Z',
                environment: 'development',
                testSteps: [
                    'Test valid card number',
                    'Test invalid card number',
                    'Test expired card',
                    'Test invalid CVV'
                ],
                failureReason: 'Invalid card validation logic'
            },
            {
                id: 'TC003-2',
                name: 'Transaction processing',
                status: 'passed',
                executionTime: '0.6s',
                createdAt: '2025-05-06T09:10:00.000Z',
                updatedAt: '2025-05-06T09:15:00.000Z',
                environment: 'development',
                testSteps: [
                    'Test successful transaction',
                    'Test failed transaction',
                    'Test transaction timeout',
                    'Test transaction rollback'
                ]
            },
            {
                id: 'TC003-3',
                name: 'Payment gateway integration',
                status: 'failed',
                executionTime: '0.7s',
                createdAt: '2025-05-06T09:20:00.000Z',
                updatedAt: '2025-05-06T09:25:00.000Z',
                environment: 'development',
                testSteps: [
                    'Test gateway connection',
                    'Test API responses',
                    'Test error handling',
                    'Test timeout scenarios'
                ],
                failureReason: 'Gateway connection timeout'
            }
        ],
        totalTestCases: 3,
        passedTestCases: 1,
        failedTestCases: 2,
        skippedTestCases: 0,
        coverage: 75,
        createdAt: '2025-05-06T08:30:00.000Z',
        updatedAt: '2025-05-06T09:30:00.000Z',
        executedBy: 'tom.brown@got.com'
    },
    {
        testId: 'TEST004',
        prId: 'PR04',
        title: 'API Documentation Test Suite',
        status: 'passed',
        testCases: [
            {
                id: 'TC004-1',
                name: 'API endpoint documentation validation',
                status: 'passed',
                executionTime: '0.8s',
                createdAt: '2025-05-20T10:30:00.000Z',
                updatedAt: '2025-05-20T10:35:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Verify endpoint descriptions',
                    'Check request/response examples',
                    'Validate parameter documentation',
                    'Test code snippets'
                ]
            },
            {
                id: 'TC004-2',
                name: 'Swagger/OpenAPI specification',
                status: 'passed',
                executionTime: '0.6s',
                createdAt: '2025-05-20T10:40:00.000Z',
                updatedAt: '2025-05-20T10:45:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Validate OpenAPI schema',
                    'Check endpoint definitions',
                    'Verify security schemes',
                    'Test interactive documentation'
                ]
            },
            {
                id: 'TC004-3',
                name: 'Documentation accessibility',
                status: 'passed',
                executionTime: '0.5s',
                createdAt: '2025-05-20T10:50:00.000Z',
                updatedAt: '2025-05-20T10:55:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test search functionality',
                    'Verify navigation structure',
                    'Check mobile responsiveness',
                    'Validate accessibility standards'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 3,
        failedTestCases: 0,
        skippedTestCases: 0,
        coverage: 95,
        createdAt: '2025-05-20T10:25:00.000Z',
        updatedAt: '2025-05-20T11:00:00.000Z',
        executedBy: 'chris.taylor@got.com'
    },
    {
        testId: 'TEST005',
        prId: 'PR05',
        title: 'Dark Mode Toggle Test Suite',
        status: 'failed',
        testCases: [
            {
                id: 'TC005-1',
                name: 'Theme switching functionality',
                status: 'passed',
                executionTime: '0.7s',
                createdAt: '2025-05-16T13:30:00.000Z',
                updatedAt: '2025-05-16T13:35:00.000Z',
                environment: 'staging',
                browser: 'Chrome',
                testSteps: [
                    'Test theme toggle button',
                    'Verify theme persistence',
                    'Check system theme detection',
                    'Validate theme transition'
                ]
            },
            {
                id: 'TC005-2',
                name: 'Dark mode color scheme',
                status: 'failed',
                executionTime: '0.9s',
                createdAt: '2025-05-16T13:40:00.000Z',
                updatedAt: '2025-05-16T13:45:00.000Z',
                environment: 'staging',
                browser: 'Firefox',
                testSteps: [
                    'Verify dark mode colors',
                    'Check contrast ratios',
                    'Test color variables',
                    'Validate accessibility'
                ]
            },
            {
                id: 'TC005-3',
                name: 'Component dark mode adaptation',
                status: 'passed',
                executionTime: '0.0s',
                createdAt: '2025-05-16T13:50:00.000Z',
                updatedAt: '2025-05-16T13:50:00.000Z',
                environment: 'staging',
                browser: 'Safari',
                testSteps: [
                    'Test all UI components',
                    'Verify dark mode styles',
                    'Check component transitions',
                    'Validate dark mode images'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 1,
        failedTestCases: 0,
        skippedTestCases: 1,
        coverage: 70,
        createdAt: '2025-05-16T13:00:00.000Z',
        updatedAt: '2025-05-16T14:00:00.000Z',
        executedBy: 'olivia.parker@got.com'
    },
    {
        testId: 'TEST006',
        prId: 'PR06',
        title: 'Dragon Animation Effects Test Suite',
        status: 'failed',
        testCases: [
            {
                id: 'TC006-1',
                name: 'Animation performance',
                status: 'failed',
                executionTime: '1.2s',
                createdAt: '2025-05-06T01:00:00.000Z',
                updatedAt: '2025-05-06T01:05:00.000Z',
                environment: 'staging',
                browser: 'Chrome',
                testSteps: [
                    'Measure FPS during animation',
                    'Check CPU usage',
                    'Test memory consumption',
                    'Verify animation smoothness'
                ],
                failureReason: 'High CPU usage during complex animations'
            },
            {
                id: 'TC006-2',
                name: 'Animation synchronization',
                status: 'failed',
                executionTime: '0.8s',
                createdAt: '2025-05-06T01:10:00.000Z',
                updatedAt: '2025-05-06T01:15:00.000Z',
                environment: 'staging',
                browser: 'Firefox',
                testSteps: [
                    'Test multiple dragon animations',
                    'Verify timing synchronization',
                    'Check animation queues',
                    'Test interruption handling'
                ],
                failureReason: 'Animation timing inconsistencies'
            },
            {
                id: 'TC006-3',
                name: 'Cross-browser compatibility',
                status: 'passed',
                executionTime: '1.0s',
                createdAt: '2025-05-06T01:20:00.000Z',
                updatedAt: '2025-05-06T01:25:00.000Z',
                environment: 'staging',
                browser: 'Safari',
                testSteps: [
                    'Test in different browsers',
                    'Verify animation consistency',
                    'Check fallback behaviors',
                    'Test mobile browsers'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 1,
        failedTestCases: 2,
        skippedTestCases: 0,
        coverage: 80,
        createdAt: '2025-05-06T00:30:00.000Z',
        updatedAt: '2025-05-06T01:30:00.000Z',
        executedBy: 'sarah.wilson@got.com'
    },
    {
        testId: 'TEST007',
        prId: 'PR07',
        title: 'Winter Theme UI Components Test Suite',
        status: 'failed',
        testCases: [
            {
                id: 'TC007-1',
                name: 'Theme color application',
                status: 'failed',
                executionTime: '0.7s',
                createdAt: '2025-05-17T06:30:00.000Z',
                updatedAt: '2025-05-17T06:35:00.000Z',
                environment: 'staging',
                browser: 'Chrome',
                testSteps: [
                    'Verify winter color palette',
                    'Check color consistency',
                    'Test color transitions',
                    'Validate contrast ratios'
                ],
                failureReason: 'Inconsistent color application across components'
            },
            {
                id: 'TC007-2',
                name: 'Winter theme assets',
                status: 'passed',
                executionTime: '0.5s',
                createdAt: '2025-05-17T06:40:00.000Z',
                updatedAt: '2025-05-17T06:45:00.000Z',
                environment: 'staging',
                browser: 'Firefox',
                testSteps: [
                    'Test winter-themed icons',
                    'Verify snow effects',
                    'Check image assets',
                    'Validate asset loading'
                ]
            },
            {
                id: 'TC007-3',
                name: 'Component winter styling',
                status: 'failed',
                executionTime: '0.8s',
                createdAt: '2025-05-17T06:50:00.000Z',
                updatedAt: '2025-05-17T06:55:00.000Z',
                environment: 'staging',
                browser: 'Safari',
                testSteps: [
                    'Test all UI components',
                    'Verify winter styles',
                    'Check hover effects',
                    'Validate animations'
                ],
                failureReason: 'Incomplete winter styling on some components'
            }
        ],
        totalTestCases: 3,
        passedTestCases: 1,
        failedTestCases: 2,
        skippedTestCases: 0,
        coverage: 75,
        createdAt: '2025-05-17T06:00:00.000Z',
        updatedAt: '2025-05-17T07:00:00.000Z',
        executedBy: 'tom.brown@got.com'
    },
    {
        testId: 'TEST008',
        prId: 'PR08',
        title: 'Castle Defense System Test Suite',
        status: 'passed',
        testCases: [
            {
                id: 'TC008-1',
                name: 'Defense mechanism activation',
                status: 'passed',
                executionTime: '1.2s',
                createdAt: '2025-05-13T02:00:00.000Z',
                updatedAt: '2025-05-13T02:05:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test defense trigger conditions',
                    'Verify activation sequence',
                    'Check response time',
                    'Validate defense protocols'
                ]
            },
            {
                id: 'TC008-2',
                name: 'Resource management',
                status: 'passed',
                executionTime: '0.9s',
                createdAt: '2025-05-13T02:10:00.000Z',
                updatedAt: '2025-05-13T02:15:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test resource allocation',
                    'Verify resource consumption',
                    'Check resource regeneration',
                    'Validate resource limits'
                ]
            },
            {
                id: 'TC008-3',
                name: 'Defense system integration',
                status: 'passed',
                executionTime: '1.1s',
                createdAt: '2025-05-13T02:20:00.000Z',
                updatedAt: '2025-05-13T02:25:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test system communication',
                    'Verify data synchronization',
                    'Check error handling',
                    'Validate system recovery'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 3,
        failedTestCases: 0,
        skippedTestCases: 0,
        coverage: 92,
        createdAt: '2025-05-13T01:30:00.000Z',
        updatedAt: '2025-05-13T02:30:00.000Z',
        executedBy: 'chris.taylor@got.com'
    },
    {
        testId: 'TEST009',
        prId: 'PR09',
        title: 'Wildfire Explosion Effects Test Suite',
        status: 'failed',
        testCases: [
            {
                id: 'TC009-1',
                name: 'Visual effects rendering',
                status: 'passed',
                executionTime: '1.5s',
                createdAt: '2025-04-23T04:30:00.000Z',
                updatedAt: '2025-04-23T04:35:00.000Z',
                environment: 'staging',
                browser: 'Chrome',
                testSteps: [
                    'Test explosion animations',
                    'Verify particle effects',
                    'Check lighting effects',
                    'Validate visual quality'
                ]
            },
            {
                id: 'TC009-2',
                name: 'Performance optimization',
                status: 'failed',
                executionTime: '1.3s',
                createdAt: '2025-04-23T04:40:00.000Z',
                updatedAt: '2025-04-23T04:45:00.000Z',
                environment: 'staging',
                browser: 'Firefox',
                testSteps: [
                    'Measure FPS during effects',
                    'Check memory usage',
                    'Test GPU utilization',
                    'Verify optimization techniques'
                ]
            },
            {
                id: 'TC009-3',
                name: 'Cross-platform compatibility',
                status: 'passed',
                executionTime: '0.0s',
                createdAt: '2025-04-23T04:50:00.000Z',
                updatedAt: '2025-04-23T04:50:00.000Z',
                environment: 'staging',
                browser: 'Safari',
                testSteps: [
                    'Test on different devices',
                    'Verify mobile performance',
                    'Check browser compatibility',
                    'Validate fallback options'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 1,
        failedTestCases: 0,
        skippedTestCases: 1,
        coverage: 85,
        createdAt: '2025-04-23T04:00:00.000Z',
        updatedAt: '2025-04-23T05:00:00.000Z',
        executedBy: 'olivia.parker@got.com'
    },
    {
        testId: 'TEST010',
        prId: 'PR10',
        title: 'Faceless Man Disguise System Test Suite',
        status: 'passed',
        testCases: [
            {
                id: 'TC010-1',
                name: 'Disguise transformation',
                status: 'passed',
                executionTime: '1.1s',
                createdAt: '2025-05-12T13:00:00.000Z',
                updatedAt: '2025-05-12T13:05:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test identity switching',
                    'Verify appearance changes',
                    'Check transformation effects',
                    'Validate identity persistence'
                ]
            },
            {
                id: 'TC010-2',
                name: 'Identity verification',
                status: 'passed',
                executionTime: '0.8s',
                createdAt: '2025-05-12T13:10:00.000Z',
                updatedAt: '2025-05-12T13:15:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test identity validation',
                    'Verify security checks',
                    'Check access control',
                    'Validate permission system'
                ]
            },
            {
                id: 'TC010-3',
                name: 'System integration',
                status: 'passed',
                executionTime: '0.9s',
                createdAt: '2025-05-12T13:20:00.000Z',
                updatedAt: '2025-05-12T13:25:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test system communication',
                    'Verify data synchronization',
                    'Check error handling',
                    'Validate recovery procedures'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 3,
        failedTestCases: 0,
        skippedTestCases: 0,
        coverage: 95,
        createdAt: '2025-05-12T12:30:00.000Z',
        updatedAt: '2025-05-12T13:30:00.000Z',
        executedBy: 'jane.smith@got.com'
    },
    {
        testId: 'TEST011',
        prId: 'PR11',
        title: 'Night Watch Notification System Test Suite',
        status: 'failed',
        testCases: [
            {
                id: 'TC011-1',
                name: 'Notification delivery',
                status: 'passed',
                executionTime: '0.7s',
                createdAt: '2025-04-29T21:00:00.000Z',
                updatedAt: '2025-04-29T21:05:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test notification triggers',
                    'Verify delivery methods',
                    'Check priority levels',
                    'Validate delivery timing'
                ]
            },
            {
                id: 'TC011-2',
                name: 'Alert system integration',
                status: 'failed',
                executionTime: '0.9s',
                createdAt: '2025-04-29T21:10:00.000Z',
                updatedAt: '2025-04-29T21:15:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test alert conditions',
                    'Verify alert propagation',
                    'Check response handling',
                    'Validate alert escalation'
                ]
            },
            {
                id: 'TC011-3',
                name: 'System reliability',
                status: 'passed',
                executionTime: '0.0s',
                createdAt: '2025-04-29T21:20:00.000Z',
                updatedAt: '2025-04-29T21:20:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test system uptime',
                    'Verify data persistence',
                    'Check error recovery',
                    'Validate backup systems'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 1,
        failedTestCases: 0,
        skippedTestCases: 1,
        coverage: 88,
        createdAt: '2025-04-29T20:30:00.000Z',
        updatedAt: '2025-04-29T21:30:00.000Z',
        executedBy: 'sarah.wilson@got.com'
    },
    {
        testId: 'TEST012',
        prId: 'PR12',
        title: 'Tournament Bracket System Test Suite',
        status: 'failed',
        testCases: [
            {
                id: 'TC012-1',
                name: 'Bracket generation',
                status: 'failed',
                executionTime: '0.8s',
                createdAt: '2025-05-08T08:00:00.000Z',
                updatedAt: '2025-05-08T08:05:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test bracket creation',
                    'Verify participant assignment',
                    'Check seeding logic',
                    'Validate bracket structure'
                ],
                failureReason: 'Incorrect seeding algorithm'
            },
            {
                id: 'TC012-2',
                name: 'Match progression',
                status: 'passed',
                executionTime: '0.7s',
                createdAt: '2025-05-08T08:10:00.000Z',
                updatedAt: '2025-05-08T08:15:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test match updates',
                    'Verify winner advancement',
                    'Check bracket updates',
                    'Validate progression logic'
                ]
            },
            {
                id: 'TC012-3',
                name: 'Tournament completion',
                status: 'failed',
                executionTime: '0.9s',
                createdAt: '2025-05-08T08:20:00.000Z',
                updatedAt: '2025-05-08T08:25:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test final match handling',
                    'Verify winner declaration',
                    'Check statistics generation',
                    'Validate tournament closure'
                ],
                failureReason: 'Incomplete tournament closure process'
            }
        ],
        totalTestCases: 3,
        passedTestCases: 1,
        failedTestCases: 2,
        skippedTestCases: 0,
        coverage: 82,
        createdAt: '2025-05-08T07:30:00.000Z',
        updatedAt: '2025-05-08T08:30:00.000Z',
        executedBy: 'tom.brown@got.com'
    },
    {
        testId: 'TEST013',
        prId: 'PR13',
        title: 'Direwolf Companion Feature Test Suite',
        status: 'passed',
        testCases: [
            {
                id: 'TC013-1',
                name: 'Companion interaction',
                status: 'passed',
                executionTime: '1.1s',
                createdAt: '2025-04-22T09:30:00.000Z',
                updatedAt: '2025-04-22T09:35:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test companion commands',
                    'Verify response behavior',
                    'Check interaction animations',
                    'Validate companion AI'
                ]
            },
            {
                id: 'TC013-2',
                name: 'Companion abilities',
                status: 'passed',
                executionTime: '0.9s',
                createdAt: '2025-04-22T09:40:00.000Z',
                updatedAt: '2025-04-22T09:45:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test special abilities',
                    'Verify combat assistance',
                    'Check tracking skills',
                    'Validate ability cooldowns'
                ]
            },
            {
                id: 'TC013-3',
                name: 'Companion progression',
                status: 'passed',
                executionTime: '1.0s',
                createdAt: '2025-04-22T09:50:00.000Z',
                updatedAt: '2025-04-22T09:55:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test experience gain',
                    'Verify level progression',
                    'Check ability unlocks',
                    'Validate stat improvements'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 3,
        failedTestCases: 0,
        skippedTestCases: 0,
        coverage: 90,
        createdAt: '2025-04-22T09:00:00.000Z',
        updatedAt: '2025-04-22T10:00:00.000Z',
        executedBy: 'chris.taylor@got.com'
    },
    {
        testId: 'TEST014',
        prId: 'PR14',
        title: 'Iron Bank Transaction System Test Suite',
        status: 'failed',
        testCases: [
            {
                id: 'TC014-1',
                name: 'Transaction processing',
                status: 'passed',
                executionTime: '0.8s',
                createdAt: '2025-05-04T21:00:00.000Z',
                updatedAt: '2025-05-04T21:05:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test transaction creation',
                    'Verify amount validation',
                    'Check balance updates',
                    'Validate transaction history'
                ]
            },
            {
                id: 'TC014-2',
                name: 'Security measures',
                status: 'failed',
                executionTime: '1.0s',
                createdAt: '2025-05-04T21:10:00.000Z',
                updatedAt: '2025-05-04T21:15:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test authentication',
                    'Verify authorization',
                    'Check fraud detection',
                    'Validate security protocols'
                ]
            },
            {
                id: 'TC014-3',
                name: 'System integration',
                status: 'passed',
                executionTime: '0.0s',
                createdAt: '2025-05-04T21:20:00.000Z',
                updatedAt: '2025-05-04T21:20:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test API integration',
                    'Verify data consistency',
                    'Check error handling',
                    'Validate recovery procedures'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 1,
        failedTestCases: 0,
        skippedTestCases: 1,
        coverage: 85,
        createdAt: '2025-05-04T20:30:00.000Z',
        updatedAt: '2025-05-04T21:30:00.000Z',
        executedBy: 'olivia.parker@got.com'
    },
    {
        testId: 'TEST015',
        prId: 'PR15',
        title: 'Wine Cellar Management System Test Suite',
        status: 'passed',
        testCases: [
            {
                id: 'TC015-1',
                name: 'Inventory management',
                status: 'passed',
                executionTime: '0.7s',
                createdAt: '2025-05-19T21:30:00.000Z',
                updatedAt: '2025-05-19T21:35:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test wine addition',
                    'Verify inventory tracking',
                    'Check stock updates',
                    'Validate categorization'
                ]
            },
            {
                id: 'TC015-2',
                name: 'Quality monitoring',
                status: 'passed',
                executionTime: '0.8s',
                createdAt: '2025-05-19T21:40:00.000Z',
                updatedAt: '2025-05-19T21:45:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test quality checks',
                    'Verify aging tracking',
                    'Check condition monitoring',
                    'Validate quality reports'
                ]
            },
            {
                id: 'TC015-3',
                name: 'Distribution system',
                status: 'passed',
                executionTime: '0.9s',
                createdAt: '2025-05-19T21:50:00.000Z',
                updatedAt: '2025-05-19T21:55:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test distribution logic',
                    'Verify allocation rules',
                    'Check delivery tracking',
                    'Validate distribution reports'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 3,
        failedTestCases: 0,
        skippedTestCases: 0,
        coverage: 95,
        createdAt: '2025-05-19T21:00:00.000Z',
        updatedAt: '2025-05-19T22:00:00.000Z',
        executedBy: 'jane.smith@got.com'
    },
    {
        testId: 'TEST016',
        prId: 'PR16',
        title: 'Raven Messaging System Test Suite',
        status: 'passed',
        testCases: [
            {
                id: 'TC016-1',
                name: 'Message delivery',
                status: 'passed',
                executionTime: '0.8s',
                createdAt: '2025-05-10T21:30:00.000Z',
                updatedAt: '2025-05-10T21:35:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test message sending',
                    'Verify delivery confirmation',
                    'Check message routing',
                    'Validate delivery time'
                ]
            },
            {
                id: 'TC016-2',
                name: 'Message encryption',
                status: 'passed',
                executionTime: '0.9s',
                createdAt: '2025-05-10T21:40:00.000Z',
                updatedAt: '2025-05-10T21:45:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test encryption process',
                    'Verify decryption',
                    'Check security protocols',
                    'Validate key management'
                ]
            },
            {
                id: 'TC016-3',
                name: 'System reliability',
                status: 'passed',
                executionTime: '1.0s',
                createdAt: '2025-05-10T21:50:00.000Z',
                updatedAt: '2025-05-10T21:55:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test system uptime',
                    'Verify message persistence',
                    'Check error handling',
                    'Validate recovery procedures'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 3,
        failedTestCases: 0,
        skippedTestCases: 0,
        coverage: 92,
        createdAt: '2025-05-10T21:00:00.000Z',
        updatedAt: '2025-05-10T22:00:00.000Z',
        executedBy: 'sarah.wilson@got.com'
    },
    {
        testId: 'TEST017',
        prId: 'PR17',
        title: 'Battle Strategy Planning Interface Test Suite',
        status: 'failed',
        testCases: [
            {
                id: 'TC017-1',
                name: 'Strategy creation',
                status: 'failed',
                executionTime: '1.1s',
                createdAt: '2025-05-17T15:30:00.000Z',
                updatedAt: '2025-05-17T15:35:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test strategy input',
                    'Verify unit placement',
                    'Check formation creation',
                    'Validate strategy rules'
                ],
                failureReason: 'Incomplete unit placement validation'
            },
            {
                id: 'TC017-2',
                name: 'Tactical analysis',
                status: 'passed',
                executionTime: '0.8s',
                createdAt: '2025-05-17T15:40:00.000Z',
                updatedAt: '2025-05-17T15:45:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test scenario simulation',
                    'Verify outcome prediction',
                    'Check risk assessment',
                    'Validate analysis reports'
                ]
            },
            {
                id: 'TC017-3',
                name: 'Interface usability',
                status: 'failed',
                executionTime: '0.9s',
                createdAt: '2025-05-17T15:50:00.000Z',
                updatedAt: '2025-05-17T15:55:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test user interactions',
                    'Verify interface responsiveness',
                    'Check accessibility features',
                    'Validate user feedback'
                ],
                failureReason: 'Poor mobile responsiveness'
            }
        ],
        totalTestCases: 3,
        passedTestCases: 1,
        failedTestCases: 2,
        skippedTestCases: 0,
        coverage: 85,
        createdAt: '2025-05-17T15:00:00.000Z',
        updatedAt: '2025-05-17T16:00:00.000Z',
        executedBy: 'tom.brown@got.com'
    },
    {
        testId: 'TEST018',
        prId: 'PR18',
        title: 'Weirwood Tree Visualization Test Suite',
        status: 'passed',
        testCases: [
            {
                id: 'TC018-1',
                name: 'Visual rendering',
                status: 'passed',
                executionTime: '1.2s',
                createdAt: '2025-04-24T10:30:00.000Z',
                updatedAt: '2025-04-24T10:35:00.000Z',
                environment: 'staging',
                browser: 'Chrome',
                testSteps: [
                    'Test tree visualization',
                    'Verify texture rendering',
                    'Check lighting effects',
                    'Validate visual quality'
                ]
            },
            {
                id: 'TC018-2',
                name: 'Interaction features',
                status: 'passed',
                executionTime: '0.9s',
                createdAt: '2025-04-24T10:40:00.000Z',
                updatedAt: '2025-04-24T10:45:00.000Z',
                environment: 'staging',
                browser: 'Firefox',
                testSteps: [
                    'Test user interactions',
                    'Verify zoom functionality',
                    'Check rotation controls',
                    'Validate touch gestures'
                ]
            },
            {
                id: 'TC018-3',
                name: 'Performance optimization',
                status: 'passed',
                executionTime: '1.0s',
                createdAt: '2025-04-24T10:50:00.000Z',
                updatedAt: '2025-04-24T10:55:00.000Z',
                environment: 'staging',
                browser: 'Safari',
                testSteps: [
                    'Test rendering performance',
                    'Verify memory usage',
                    'Check loading times',
                    'Validate optimization techniques'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 3,
        failedTestCases: 0,
        skippedTestCases: 0,
        coverage: 88,
        createdAt: '2025-04-24T10:00:00.000Z',
        updatedAt: '2025-04-24T11:00:00.000Z',
        executedBy: 'chris.taylor@got.com'
    },
    {
        testId: 'TEST019',
        prId: 'PR19',
        title: 'Wildfire Safety Protocols Test Suite',
        status: 'failed',
        testCases: [
            {
                id: 'TC019-1',
                name: 'Safety measures',
                status: 'passed',
                executionTime: '0.8s',
                createdAt: '2025-05-09T21:30:00.000Z',
                updatedAt: '2025-05-09T21:35:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test safety protocols',
                    'Verify warning systems',
                    'Check evacuation procedures',
                    'Validate safety checks'
                ]
            },
            {
                id: 'TC019-2',
                name: 'Emergency response',
                status: 'failed',
                executionTime: '1.0s',
                createdAt: '2025-05-09T21:40:00.000Z',
                updatedAt: '2025-05-09T21:45:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test response triggers',
                    'Verify alert systems',
                    'Check response coordination',
                    'Validate emergency protocols'
                ]
            },
            {
                id: 'TC019-3',
                name: 'System monitoring',
                status: 'passed',
                executionTime: '0.0s',
                createdAt: '2025-05-09T21:50:00.000Z',
                updatedAt: '2025-05-09T21:50:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test monitoring systems',
                    'Verify data collection',
                    'Check alert thresholds',
                    'Validate monitoring reports'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 1,
        failedTestCases: 0,
        skippedTestCases: 1,
        coverage: 82,
        createdAt: '2025-05-09T21:00:00.000Z',
        updatedAt: '2025-05-09T22:00:00.000Z',
        executedBy: 'olivia.parker@got.com'
    },
    {
        testId: 'TEST020',
        prId: 'PR20',
        title: 'Hand of the King Dashboard Test Suite',
        status: 'passed',
        testCases: [
            {
                id: 'TC020-1',
                name: 'Dashboard layout',
                status: 'passed',
                executionTime: '0.8s',
                createdAt: '2025-04-23T15:30:00.000Z',
                updatedAt: '2025-04-23T15:35:00.000Z',
                environment: 'staging',
                browser: 'Chrome',
                testSteps: [
                    'Test component layout',
                    'Verify responsive design',
                    'Check data visualization',
                    'Validate UI elements'
                ]
            },
            {
                id: 'TC020-2',
                name: 'Data integration',
                status: 'passed',
                executionTime: '0.9s',
                createdAt: '2025-04-23T15:40:00.000Z',
                updatedAt: '2025-04-23T15:45:00.000Z',
                environment: 'staging',
                browser: 'Firefox',
                testSteps: [
                    'Test data fetching',
                    'Verify real-time updates',
                    'Check data accuracy',
                    'Validate data refresh'
                ]
            },
            {
                id: 'TC020-3',
                name: 'User interactions',
                status: 'passed',
                executionTime: '1.0s',
                createdAt: '2025-04-23T15:50:00.000Z',
                updatedAt: '2025-04-23T15:55:00.000Z',
                environment: 'staging',
                browser: 'Safari',
                testSteps: [
                    'Test user controls',
                    'Verify filtering options',
                    'Check sorting functionality',
                    'Validate user preferences'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 3,
        failedTestCases: 0,
        skippedTestCases: 0,
        coverage: 95,
        createdAt: '2025-04-23T15:00:00.000Z',
        updatedAt: '2025-04-23T16:00:00.000Z',
        executedBy: 'jane.smith@got.com'
    },
    {
        testId: 'TEST021',
        prId: 'PR21',
        title: 'White Walker Detection System Test Suite',
        status: 'failed',
        testCases: [
            {
                id: 'TC021-1',
                name: 'Detection algorithms',
                status: 'passed',
                executionTime: '1.2s',
                createdAt: '2025-05-16T03:30:00.000Z',
                updatedAt: '2025-05-16T03:35:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test detection logic',
                    'Verify pattern recognition',
                    'Check false positive rate',
                    'Validate detection accuracy'
                ]
            },
            {
                id: 'TC021-2',
                name: 'Alert system',
                status: 'failed',
                executionTime: '0.9s',
                createdAt: '2025-05-16T03:40:00.000Z',
                updatedAt: '2025-05-16T03:45:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test alert generation',
                    'Verify notification delivery',
                    'Check alert prioritization',
                    'Validate response protocols'
                ]
            },
            {
                id: 'TC021-3',
                name: 'System integration',
                status: 'passed',
                executionTime: '0.0s',
                createdAt: '2025-05-16T03:50:00.000Z',
                updatedAt: '2025-05-16T03:50:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test system communication',
                    'Verify data synchronization',
                    'Check error handling',
                    'Validate recovery procedures'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 1,
        failedTestCases: 0,
        skippedTestCases: 1,
        coverage: 85,
        createdAt: '2025-05-16T03:00:00.000Z',
        updatedAt: '2025-05-16T04:00:00.000Z',
        executedBy: 'jane.smith@got.com'
    },
    {
        testId: 'TEST022',
        prId: 'PR22',
        title: 'Longclaw Sword Animation Effects Test Suite',
        status: 'failed',
        testCases: [
            {
                id: 'TC022-1',
                name: 'Animation sequences',
                status: 'failed',
                executionTime: '1.1s',
                createdAt: '2025-04-22T18:30:00.000Z',
                updatedAt: '2025-04-22T18:35:00.000Z',
                environment: 'staging',
                browser: 'Chrome',
                testSteps: [
                    'Test attack animations',
                    'Verify motion fluidity',
                    'Check transition effects',
                    'Validate animation timing'
                ],
                failureReason: 'Animation frame skipping'
            },
            {
                id: 'TC022-2',
                name: 'Visual effects',
                status: 'passed',
                executionTime: '0.8s',
                createdAt: '2025-04-22T18:40:00.000Z',
                updatedAt: '2025-04-22T18:45:00.000Z',
                environment: 'staging',
                browser: 'Firefox',
                testSteps: [
                    'Test particle effects',
                    'Verify lighting effects',
                    'Check trail effects',
                    'Validate visual quality'
                ]
            },
            {
                id: 'TC022-3',
                name: 'Performance optimization',
                status: 'failed',
                executionTime: '0.9s',
                createdAt: '2025-04-22T18:50:00.000Z',
                updatedAt: '2025-04-22T18:55:00.000Z',
                environment: 'staging',
                browser: 'Safari',
                testSteps: [
                    'Test rendering performance',
                    'Verify memory usage',
                    'Check GPU utilization',
                    'Validate optimization techniques'
                ],
                failureReason: 'High memory consumption'
            }
        ],
        totalTestCases: 3,
        passedTestCases: 1,
        failedTestCases: 2,
        skippedTestCases: 0,
        coverage: 80,
        createdAt: '2025-04-22T18:00:00.000Z',
        updatedAt: '2025-04-22T19:00:00.000Z',
        executedBy: 'sarah.wilson@got.com'
    },
    {
        testId: 'TEST023',
        prId: 'PR23',
        title: "Night's Watch Oath System Test Suite",
        status: 'passed',
        testCases: [
            {
                id: 'TC023-1',
                name: 'Oath ceremony',
                status: 'passed',
                executionTime: '0.7s',
                createdAt: '2025-04-28T23:30:00.000Z',
                updatedAt: '2025-04-28T23:35:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test oath initiation',
                    'Verify ceremony flow',
                    'Check participant tracking',
                    'Validate completion status'
                ]
            },
            {
                id: 'TC023-2',
                name: 'Record keeping',
                status: 'passed',
                executionTime: '0.8s',
                createdAt: '2025-04-28T23:40:00.000Z',
                updatedAt: '2025-04-28T23:45:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test record creation',
                    'Verify data persistence',
                    'Check record retrieval',
                    'Validate data integrity'
                ]
            },
            {
                id: 'TC023-3',
                name: 'System security',
                status: 'passed',
                executionTime: '0.9s',
                createdAt: '2025-04-28T23:50:00.000Z',
                updatedAt: '2025-04-28T23:55:00.000Z',
                environment: 'staging',
                testSteps: [
                    'Test access control',
                    'Verify authentication',
                    'Check authorization',
                    'Validate security protocols'
                ]
            }
        ],
        totalTestCases: 3,
        passedTestCases: 3,
        failedTestCases: 0,
        skippedTestCases: 0,
        coverage: 90,
        createdAt: '2025-04-28T23:00:00.000Z',
        updatedAt: '2025-04-29T00:00:00.000Z',
        executedBy: 'tom.brown@got.com'
    }
]

export default testData; 