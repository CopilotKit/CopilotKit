import type { Incident } from '../types/incident'

/**
 * Returns 8 realistic seed incidents with timestamps relative to now
 * so the data always looks fresh.
 */
export function getSeedIncidents(): Incident[] {
  const now = Date.now()
  const hours = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString()
  const mins = (m: number) => new Date(now - m * 60 * 1000).toISOString()

  return [
    {
      id: 'INC-SEED-001',
      title: 'Unauthorized API access from external IP range',
      description:
        'WAF detected anomalous traffic from external IP range 203.0.113.0/24 targeting authenticated API endpoints. Multiple endpoints hit with credential-stuffing patterns.',
      severity: 'P0',
      status: 'Investigating',
      affectedServices: ['api-gateway', 'auth-service'],
      detectionSource: 'alert',
      timestamps: {
        created: hours(2),
        acknowledged: hours(1.8),
      },
      owner: 'Sarah Chen',
      timeline: [
        {
          id: 'tl-001-1',
          timestamp: hours(2),
          type: 'status_change',
          description: 'Incident created: Unauthorized API access from external IP range',
        },
        {
          id: 'tl-001-2',
          timestamp: hours(1.8),
          type: 'status_change',
          description: 'Status changed from Open to Investigating',
          author: 'Sarah Chen',
        },
        {
          id: 'tl-001-3',
          timestamp: hours(1.5),
          type: 'comment',
          description: 'Confirmed credential-stuffing pattern. Rate limiting applied at WAF level. Analyzing affected accounts.',
          author: 'Sarah Chen',
        },
      ],
    },
    {
      id: 'INC-SEED-002',
      title: 'Database connection pool exhaustion on postgres-primary',
      description:
        'postgres-primary reporting max connections reached. Application queries timing out, causing cascading failures in API gateway.',
      severity: 'P1',
      status: 'Open',
      affectedServices: ['postgres-primary', 'api-gateway'],
      detectionSource: 'alert',
      timestamps: {
        created: hours(1),
      },
      owner: 'Mike Torres',
      timeline: [
        {
          id: 'tl-002-1',
          timestamp: hours(1),
          type: 'status_change',
          description: 'Incident created: Database connection pool exhaustion on postgres-primary',
        },
        {
          id: 'tl-002-2',
          timestamp: mins(45),
          type: 'comment',
          description: 'Connection count at 98% capacity. Identified possible connection leak in recent ORM migration.',
          author: 'Mike Torres',
        },
      ],
    },
    {
      id: 'INC-SEED-003',
      title: 'CDN cache poisoning detected on edge nodes',
      description:
        'Cache poisoning attack detected on CDN edge nodes serving static assets. Malicious headers injected to serve altered content to a subset of users.',
      severity: 'P1',
      status: 'Mitigated',
      affectedServices: ['cdn-edge', 'web-prod-01'],
      detectionSource: 'alert',
      timestamps: {
        created: hours(6),
        acknowledged: hours(5.5),
      },
      owner: 'Aisha Patel',
      timeline: [
        {
          id: 'tl-003-1',
          timestamp: hours(6),
          type: 'status_change',
          description: 'Incident created: CDN cache poisoning detected on edge nodes',
        },
        {
          id: 'tl-003-2',
          timestamp: hours(5.5),
          type: 'status_change',
          description: 'Status changed from Open to Investigating',
          author: 'Aisha Patel',
        },
        {
          id: 'tl-003-3',
          timestamp: hours(4),
          type: 'mitigation',
          description: 'Purged all edge caches and added cache key normalization rule. Monitoring for recurrence.',
          author: 'Aisha Patel',
        },
        {
          id: 'tl-003-4',
          timestamp: hours(3.5),
          type: 'status_change',
          description: 'Status changed from Investigating to Mitigated',
          author: 'Aisha Patel',
        },
      ],
    },
    {
      id: 'INC-SEED-004',
      title: 'Kubernetes pod crash loop in payment service',
      description:
        'payment-service pods entering CrashLoopBackOff after latest deployment. OOMKilled events observed. Kafka consumer lag increasing.',
      severity: 'P2',
      status: 'Investigating',
      affectedServices: ['payment-service', 'kafka-broker'],
      detectionSource: 'alert',
      timestamps: {
        created: hours(3),
        acknowledged: hours(2.5),
      },
      owner: 'James Wilson',
      timeline: [
        {
          id: 'tl-004-1',
          timestamp: hours(3),
          type: 'status_change',
          description: 'Incident created: Kubernetes pod crash loop in payment service',
        },
        {
          id: 'tl-004-2',
          timestamp: hours(2.5),
          type: 'status_change',
          description: 'Status changed from Open to Investigating',
          author: 'James Wilson',
        },
        {
          id: 'tl-004-3',
          timestamp: hours(2),
          type: 'comment',
          description: 'Memory limit set to 512Mi but new version requires ~700Mi. Preparing rollback while testing increased limits.',
          author: 'James Wilson',
        },
      ],
    },
    {
      id: 'INC-SEED-005',
      title: 'TLS certificate expiration on customer portal',
      description:
        'TLS certificate for customer portal expired, causing browser warnings for end users. Auto-renewal failed due to DNS validation issue.',
      severity: 'P3',
      status: 'Resolved',
      affectedServices: ['web-prod-01', 'cdn-edge'],
      detectionSource: 'alert',
      timestamps: {
        created: hours(18),
        acknowledged: hours(17),
        resolved: hours(15),
      },
      owner: 'Dana Kim',
      timeline: [
        {
          id: 'tl-005-1',
          timestamp: hours(18),
          type: 'status_change',
          description: 'Incident created: TLS certificate expiration on customer portal',
        },
        {
          id: 'tl-005-2',
          timestamp: hours(17),
          type: 'status_change',
          description: 'Status changed from Open to Investigating',
          author: 'Dana Kim',
        },
        {
          id: 'tl-005-3',
          timestamp: hours(15.5),
          type: 'comment',
          description: 'Manually renewed certificate and fixed DNS validation CNAME record for auto-renewal.',
          author: 'Dana Kim',
        },
        {
          id: 'tl-005-4',
          timestamp: hours(15),
          type: 'resolution',
          description: 'Certificate deployed to all edge nodes. Verified HTTPS working. Auto-renewal re-enabled.',
          author: 'Dana Kim',
        },
      ],
    },
    {
      id: 'INC-SEED-006',
      title: 'Elevated failed login attempts across auth service',
      description:
        'Auth service logging 50x increase in failed login attempts over the past hour. Potential brute force or credential stuffing attack in progress.',
      severity: 'P0',
      status: 'Open',
      affectedServices: ['auth-service', 'redis-cache'],
      detectionSource: 'alert',
      timestamps: {
        created: mins(30),
      },
      timeline: [
        {
          id: 'tl-006-1',
          timestamp: mins(30),
          type: 'status_change',
          description: 'Incident created: Elevated failed login attempts across auth service',
        },
        {
          id: 'tl-006-2',
          timestamp: mins(20),
          type: 'comment',
          description: 'Auto-alert: 15,000 failed login attempts in the last 30 minutes from distributed IP ranges.',
          author: 'SIEM',
        },
      ],
    },
    {
      id: 'INC-SEED-007',
      title: 'S3 bucket policy misconfiguration exposing data lake',
      description:
        'Security audit detected overly permissive S3 bucket policy on data lake bucket. Public read access inadvertently enabled during infrastructure change.',
      severity: 'P1',
      status: 'Investigating',
      affectedServices: ['s3-data-lake', 'vpc-internal'],
      detectionSource: 'manual',
      timestamps: {
        created: hours(4),
        acknowledged: hours(3.5),
      },
      owner: 'Priya Sharma',
      timeline: [
        {
          id: 'tl-007-1',
          timestamp: hours(4),
          type: 'status_change',
          description: 'Incident created: S3 bucket policy misconfiguration exposing data lake',
        },
        {
          id: 'tl-007-2',
          timestamp: hours(3.5),
          type: 'status_change',
          description: 'Status changed from Open to Investigating',
          author: 'Priya Sharma',
        },
        {
          id: 'tl-007-3',
          timestamp: hours(3),
          type: 'comment',
          description: 'Reverted bucket policy to private. Analyzing CloudTrail logs for unauthorized access during exposure window.',
          author: 'Priya Sharma',
        },
      ],
    },
    {
      id: 'INC-SEED-008',
      title: 'Redis cache memory pressure causing API latency spikes',
      description:
        'Redis cache cluster at 95% memory utilization. Eviction rate spiking causing cache misses and elevated P99 latency on API endpoints.',
      severity: 'P2',
      status: 'Mitigated',
      affectedServices: ['redis-cache', 'api-gateway'],
      detectionSource: 'alert',
      timestamps: {
        created: hours(8),
        acknowledged: hours(7),
      },
      owner: 'Carlos Ruiz',
      timeline: [
        {
          id: 'tl-008-1',
          timestamp: hours(8),
          type: 'status_change',
          description: 'Incident created: Redis cache memory pressure causing API latency spikes',
        },
        {
          id: 'tl-008-2',
          timestamp: hours(7),
          type: 'status_change',
          description: 'Status changed from Open to Investigating',
          author: 'Carlos Ruiz',
        },
        {
          id: 'tl-008-3',
          timestamp: hours(5),
          type: 'mitigation',
          description: 'Increased maxmemory to 8GB and adjusted eviction policy to allkeys-lfu. Latency returning to normal.',
          author: 'Carlos Ruiz',
        },
        {
          id: 'tl-008-4',
          timestamp: hours(4.5),
          type: 'status_change',
          description: 'Status changed from Investigating to Mitigated',
          author: 'Carlos Ruiz',
        },
      ],
    },
  ]
}
