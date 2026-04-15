import * as vscode from "vscode";
import type { DiscoveredComponent } from "../types";
import { scanDirectory } from "./component-scanner";

type TreeItemType = "component" | "fixture";

interface ComponentTreeItem {
  type: TreeItemType;
  label: string;
  component: DiscoveredComponent;
  fixtureName?: string;
}

export class ComponentPreviewProvider
  implements vscode.TreeDataProvider<ComponentTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ComponentTreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private components: DiscoveredComponent[] = [];

  constructor(private workspaceRoot: string | undefined) {
    if (workspaceRoot) {
      this.refresh();
    }
  }

  refresh(): void {
    if (this.workspaceRoot) {
      this.components = scanDirectory(this.workspaceRoot);
    }
    this._onDidChangeTreeData.fire();
  }

  getComponents(): DiscoveredComponent[] {
    return this.components;
  }

  getTreeItem(element: ComponentTreeItem): vscode.TreeItem {
    if (element.type === "component") {
      const item = new vscode.TreeItem(
        element.label,
        element.component.fixtureNames?.length
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      );
      item.contextValue = "component";
      item.tooltip = element.component.filePath;
      item.iconPath = new vscode.ThemeIcon("symbol-class");
      item.command = {
        command: "copilotkit.previewComponentFromSidebar",
        title: "Preview Component",
        arguments: [element.component],
      };

      if (!element.component.fixturePath) {
        item.description = "(auto-generated)";
      }

      return item;
    }

    // Fixture item
    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.contextValue = "fixture";
    item.iconPath = new vscode.ThemeIcon("file-code");
    item.command = {
      command: "copilotkit.previewComponentFromSidebar",
      title: "Preview Component",
      arguments: [element.component, element.fixtureName],
    };
    return item;
  }

  getChildren(element?: ComponentTreeItem): ComponentTreeItem[] {
    if (!element) {
      // Root level -- list components
      return this.components.map((component) => ({
        type: "component" as const,
        label: component.name,
        component,
      }));
    }

    if (element.type === "component" && element.component.fixtureNames?.length) {
      // Component children -- list fixtures
      return element.component.fixtureNames.map((name) => ({
        type: "fixture" as const,
        label: name,
        component: element.component,
        fixtureName: name,
      }));
    }

    return [];
  }
}
