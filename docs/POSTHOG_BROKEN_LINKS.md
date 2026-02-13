# PostHog Broken Link Monitoring Setup

This document describes how to set up dashboards and alerts in PostHog to monitor broken links (404 errors) on the CopilotKit documentation site.

## Event Structure

The 404 page (`app/not-found.tsx`) tracks the `broken_link_accessed` event with the following properties:

### Core Properties

- `broken_url` (string): The pathname that resulted in a 404 (e.g., `/langgraph/quickstart`)
- `broken_url_full` (string): Full URL including query params (e.g., `https://docs.copilotkit.ai/langgraph/quickstart?theme=dark`)
- `query_params` (string|null): Query string if present

### Referrer Properties

- `referrer_url` (string): Full URL where the user came from (or "(direct)" if none)
- `referrer_domain` (string|null): Domain/hostname of the referrer (e.g., `www.copilotkit.ai`, `partner.com`)
- `referrer_path` (string|null): Path of the referrer page (e.g., `/features/generative-ui`)
- `is_internal_referrer` (boolean): Whether the referrer is from copilotkit.ai or localhost

### Context Properties

- `user_agent` (string): Browser user agent string
- `is_likely_bot` (boolean): Whether the request appears to be from a bot/crawler
- `timestamp` (string): ISO timestamp of the event
- `viewport_width` (number): Browser viewport width
- `viewport_height` (number): Browser viewport height

## Creating Dashboards

### Dashboard 1: Broken Links Overview

**Purpose**: High-level view of 404 errors and trends

**Insights to add**:

1. **Total 404s Over Time**
   - Type: Trend (Line Chart)
   - Event: `broken_link_accessed`
   - Filter: `is_likely_bot = false`
   - Breakdown: By day
   - Shows: Volume of broken link accesses

2. **Top Broken URLs**
   - Type: Table
   - Event: `broken_link_accessed`
   - Filter: `is_likely_bot = false`
   - Breakdown: By `broken_url`
   - Shows: Which URLs are 404ing most frequently

3. **Internal vs External Referrers**
   - Type: Pie Chart
   - Event: `broken_link_accessed`
   - Filter: `is_likely_bot = false`
   - Breakdown: By `is_internal_referrer`
   - Shows: Whether broken links are from our site or external sources

4. **Bot vs Human Traffic**
   - Type: Pie Chart
   - Event: `broken_link_accessed`
   - Breakdown: By `is_likely_bot`
   - Shows: How much 404 traffic is bot crawlers

### Dashboard 2: Internal Broken Links

**Purpose**: Find and fix broken links on our own pages

**Insights to add**:

1. **Pages with Broken Links**
   - Type: Table
   - Event: `broken_link_accessed`
   - Filters:
     - `is_internal_referrer = true`
     - `is_likely_bot = false`
   - Breakdown: By `referrer_path`
   - Shows: Which of our pages have broken links

2. **Broken Link Pairs**
   - Type: Table
   - Event: `broken_link_accessed`
   - Filters:
     - `is_internal_referrer = true`
     - `is_likely_bot = false`
   - Breakdown: By `referrer_path` and `broken_url`
   - Shows: Exact source → destination broken link relationships

3. **Recent Internal 404s**
   - Type: Table
   - Event: `broken_link_accessed`
   - Filters:
     - `is_internal_referrer = true`
     - `is_likely_bot = false`
   - Sort: By timestamp (descending)
   - Shows: Latest internal broken links for quick fixes

### Dashboard 3: External & Partner Links

**Purpose**: Identify broken links from partner sites, blogs, and external sources

**Insights to add**:

1. **Top External Referrer Domains**
   - Type: Table
   - Event: `broken_link_accessed`
   - Filters:
     - `is_internal_referrer = false`
     - `is_likely_bot = false`
   - Breakdown: By `referrer_domain`
   - Shows: Which external sites are sending traffic to broken links

2. **Partner Broken Link Pairs**
   - Type: Table
   - Event: `broken_link_accessed`
   - Filters:
     - `is_internal_referrer = false`
     - `is_likely_bot = false`
   - Breakdown: By `referrer_domain`, `referrer_path`, and `broken_url`
   - Shows: Exact pages on partner sites with broken links (so you can contact them)

3. **All Referrer Sources**
   - Type: Table
   - Event: `broken_link_accessed`
   - Filters:
     - `is_likely_bot = false`
   - Breakdown: By `referrer_domain`
   - Shows: All traffic sources (internal + external) sorted by volume

## Setting Up Alerts

### Alert 1: Broken Link Spike

**Purpose**: Get notified when there's an unusual increase in 404 errors

**Configuration**:

- Insight: "Total 404s Over Time" from Dashboard 1
- Threshold: Increase of 50% compared to previous period
- Time period: Last 24 hours
- Notification channel: Email or Slack
- Filter: `is_likely_bot = false` (exclude bot traffic)

**When it fires**: A sudden spike often indicates:

- A popular page was moved/deleted
- External site linked to wrong URL
- Recent deployment broke links

### Alert 2: New High-Volume 404

**Purpose**: Detect when a specific URL starts getting many 404s

**Configuration**:

- Insight: "Top Broken URLs" from Dashboard 1
- Threshold: Any URL with > 10 hits in last hour
- Filter: `is_likely_bot = false`
- Notification channel: Email or Slack

**When it fires**: Indicates a specific URL is being heavily accessed but doesn't exist

### Alert 3: Internal Broken Links

**Purpose**: Catch broken links on our own documentation pages

**Configuration**:

- Insight: "Pages with Broken Links" from Dashboard 2
- Threshold: Any page with > 5 broken link clicks in 24 hours
- Filters:
  - `is_internal_referrer = true`
  - `is_likely_bot = false`
- Notification channel: Email or Slack (dev team)

**When it fires**: One of our docs pages has a broken link that needs fixing

## Querying Examples

### Find all broken links from a specific page

```sql
SELECT
  broken_url,
  COUNT(*) as hits
FROM events
WHERE
  event = 'broken_link_accessed'
  AND properties.referrer_path = '/langgraph/quickstart'
  AND properties.is_likely_bot = false
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY broken_url
ORDER BY hits DESC
```

### Find most common 404s this week

```sql
SELECT
  properties.broken_url,
  COUNT(*) as hits,
  COUNT(DISTINCT properties.referrer_url) as unique_referrers
FROM events
WHERE
  event = 'broken_link_accessed'
  AND properties.is_likely_bot = false
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY properties.broken_url
ORDER BY hits DESC
LIMIT 20
```

### Find broken links with query parameters

```sql
SELECT
  properties.broken_url_full,
  COUNT(*) as hits
FROM events
WHERE
  event = 'broken_link_accessed'
  AND properties.query_params IS NOT NULL
  AND properties.is_likely_bot = false
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY properties.broken_url_full
ORDER BY hits DESC
```

### Find broken links from partner/external sites

```sql
SELECT
  properties.referrer_domain,
  properties.referrer_path,
  properties.broken_url,
  COUNT(*) as hits
FROM events
WHERE
  event = 'broken_link_accessed'
  AND properties.is_internal_referrer = false
  AND properties.is_likely_bot = false
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY
  properties.referrer_domain,
  properties.referrer_path,
  properties.broken_url
ORDER BY hits DESC
LIMIT 20
```

### Find all broken links from a specific partner domain

```sql
SELECT
  properties.referrer_path,
  properties.broken_url,
  COUNT(*) as hits
FROM events
WHERE
  event = 'broken_link_accessed'
  AND properties.referrer_domain = 'partner-site.com'
  AND properties.is_likely_bot = false
  AND timestamp > now() - INTERVAL 90 DAY
GROUP BY
  properties.referrer_path,
  properties.broken_url
ORDER BY hits DESC
```

## Maintenance Workflow

1. **Weekly Review**:
   - Check "Top Broken URLs" insight
   - Create redirects for high-traffic 404s if appropriate
   - Fix or remove broken internal links
   - Review "Top External Referrer Domains" for partner broken links

2. **After Deployments**:
   - Monitor "Total 404s Over Time" for spikes
   - Check "Recent Internal 404s" for new issues

3. **Monthly Cleanup**:
   - Review "Internal Broken Links" dashboard
   - Run link checker script: `npm run check-links`
   - Fix any persistent internal broken links

4. **Partner Outreach** (as needed):
   - Check "Partner Broken Link Pairs" dashboard
   - Identify high-traffic broken links from partner sites
   - Contact partners to update their links
   - Consider creating redirects for common partner mistakes

## Bot Filtering

The tracking automatically filters out common bots using user agent patterns:

- `/bot/i`
- `/crawl/i`
- `/spider/i`
- `/slurp/i`
- `/mediapartners/i`
- `/googlebot/i`
- `/bingbot/i`
- `/facebookexternalhit/i`
- `/twitterbot/i`

Use the `is_likely_bot = false` filter in dashboards to focus on human traffic.

## Privacy Considerations

The tracking does NOT collect:

- Personal identifiable information
- IP addresses
- User IDs or session tokens

The data collected (URLs, referrers, user agents) is standard web analytics information used solely for improving documentation quality.
