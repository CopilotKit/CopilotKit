# Deep Agents Finance ERP — V2 Feature Test Suite

This document provides a comprehensive set of testing prompts to verify all 8 advanced generative UI features and their underlying V2 infrastructure.

---

## 🛠 Feature Framework Overview

| Feature | Hook / Component | Python Tool | Bi-Directional? |
|---|---|---|---|
| **Anomaly Detection** | `useRenderAnomalyCard` | `render_anomaly_card` | No |
| **Period Comparison** | `useRenderComparison` | `render_comparison` | No |
| **Risk Scorecards** | `useRenderRiskScorecard` | `render_risk_scorecard` | No |
| **Invoice Form** | `useRenderInvoiceForm` | `render_invoice_form` | **Yes** |
| **Budget Wizard** | `useRenderBudgetWizard` | `render_budget_wizard` | **Yes** |
| **What-If Slider** | `useRenderWhatIfSlider` | `render_what_if_slider` | **Yes** |
| **Semantic Highlight**| `useSemanticHighlight` | `highlight_ui_element` | No |
| **Dynamic Dashboard** | `useUpdateDashboard` | `update_dashboard` | No |

---

## 🧪 Individual Testing Prompts

Use these to verify each feature in isolation:

1.  **Anomaly Detection**: 
    > *"Scan my recent expenses and show me any spending anomalies compared to historical averages."*
2.  **Period Comparison**: 
    > *"Compare our revenue and expenses for Q1 2025 vs Q2 2025 in a table."*
3.  **Risk Scorecard**: 
    > *"Generate a financial health risk scorecard for the current quarter."*
4.  **Invoice Form**: 
    > *"I need to create a new invoice for Wayne Enterprises. Open the creation form."*
5.  **Budget Wizard**: 
    > *"Help me plan the budget for Q3. Start the budget planning wizard."*
6.  **What-If Slider**: 
    > *"Run a what-if analysis on my marketing budget. Show me a slider to adjust the spend."*
7.  **Semantic Highlight**: 
    > *"Go to the invoices page and highlight the invoice for Globex Industries (INV-2026-004)."*
8.  **Dynamic Dashboard**: 
    > *"Add a custom bar chart to my dashboard showing Sales by Region: North ($50k), South ($30k), East ($80k)."*

---

## 🌪 The "Mix" (Combination Prompts)

These prompts test the agent's ability to orchestrate multiple tools in a single response:

### 1. The Audit Mix (Anomalies + Risk + Highlighting)
> *"Perform a security audit. Scan for anomalies, show me a risk scorecard, and then highlight any suspicious transactions on the accounts page."*

### 2. The Strategy Mix (Comparison + What-If + Dashboard)
> *"Compare Q1 vs Q2 performance. Based on that, show me a what-if slider for our Q3 marketing spend, and then add a trend chart of our net position to the dashboard."*

### 3. The Operations Mix (Navigation + Invoice Form + Budget)
> *"Navigate to the Invoices page. Now, I want to create a new invoice for Acme Corp, but before that, let's start the budget planning wizard for next year."*

---

## 🔥 Stress & Thread-Safety Testing

These prompts test the `stopAgent` logic and concurrency handling:

### 1. Rapid Fire (Concurrency)
> *"Show me a risk scorecard. [Wait 1s] No wait, show me spending anomalies instead. [Wait 1s] Actually, just open the invoice form."*
*   **Verification**: Ensure each new request cancels the previous one and the UI updates cleanly without "Thread already running" errors.

### 2. Bi-Directional Stress
1. Trigger: *"Show me a what-if slider for travel expenses."*
2. **Action**: Drag the slider rapidly multiple times.
*   **Verification**: Each release should trigger a new "Recalculating..." message from the agent. The 600ms buffer should prevent protocol conflicts.

### 3. Persistent State Test
1. Trigger: *"Highlight the first row of the invoice table."*
2. **Action**: Navigate to Dashboard, then back to Invoices.
*   **Verification**: The blue highlight should persist across navigation (thanks to the persistent `Shell` component).

---

**Test Suite Version:** 1.0.0 (Synced with CopilotKit V2)
**Author:** Antigravity (AI Assistant)
