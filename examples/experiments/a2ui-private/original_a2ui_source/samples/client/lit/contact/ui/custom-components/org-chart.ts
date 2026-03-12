import { Root } from '@a2ui/web-lib/ui';
import { v0_8 } from '@a2ui/web-lib';
import { html, css, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { map } from 'lit/directives/map.js';

// Use aliases for convenience
const StateEvent = v0_8.Events.StateEvent;
type Action = v0_8.Types.Action;

export interface OrgChartNode {
  title: string;
  name: string;
}

@customElement('org-chart')
export class OrgChart extends Root {
  @property({ type: Array }) accessor chain: OrgChartNode[] = [];
  @property({ type: Object }) accessor action: Action | null = null;

  static styles = [
    ...Root.styles,
    css`
    :host {
      display: block;
      padding: 16px;
      font-family: 'Roboto', sans-serif;
    }

    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }

    .node {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 12px 24px;
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
      min-width: 200px;
      position: relative;
      transition: transform 0.2s, box-shadow 0.2s;
      cursor: pointer;
    }

    .node:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    }

    .node:focus {
      outline: 2px solid #1a73e8;
      outline-offset: 2px;
    }

    .node.current {
      background: #e8f0fe;
      border-color: #1a73e8;
      border-width: 2px;
    }

    .title {
      font-size: 0.85rem;
      color: #5f6368;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .name {
      font-size: 1.1rem;
      font-weight: 500;
      color: #202124;
    }

    .arrow {
      color: #9aa0a6;
      font-size: 24px;
      line-height: 1;
    }
  `];

  render() {
    if (!this.chain || this.chain.length === 0) {
      return html`<div class="empty">No hierarchy data</div>`;
    }

    return html`
      <div class="container">
        ${map(this.chain, (node, index) => {
      const isLast = index === this.chain.length - 1;
      return html`
            <button 
              class="node ${isLast ? 'current' : ''}"
              @click=${() => this.handleNodeClick(node)}
              aria-label="Select ${node.name} (${node.title})"
            >
              <span class="title">${node.title}</span>
              <span class="name">${node.name}</span>
            </button>
            ${!isLast ? html`<div class="arrow">↓</div>` : ''}
          `;
    })}
      </div>
    `;
  }

  private handleNodeClick(node: OrgChartNode) {
    if (!this.action) return;

    // Create a new action with the node's context merged in
    const newContext = [
      ...(this.action.context || []),
      {
        key: 'clickedNodeTitle',
        value: { literalString: node.title }
      },
      {
        key: 'clickedNodeName',
        value: { literalString: node.name }
      }
    ];

    const actionWithContext: Action = {
      ...this.action,
      context: newContext as Action['context']
    };

    const evt = new StateEvent<"a2ui.action">({
      eventType: "a2ui.action",
      action: actionWithContext,
      dataContextPath: this.dataContextPath,
      sourceComponentId: this.id,
      sourceComponent: this.component,
    });
    this.dispatchEvent(evt);
  }
}
