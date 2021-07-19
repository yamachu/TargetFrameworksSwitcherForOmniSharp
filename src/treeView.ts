import type {
  ProjectInfo,
  ProjectSettings,
} from "@yamachu/node-csproj-modifier/dist/Types";
import {
  getTargetFramework,
  insertTargetFrameworkSwitcherImporter,
  listing,
  switchTargetFramework,
} from "@yamachu/node-csproj-modifier/dist/Usecases";
import * as vscode from "vscode";

type Solution = { name: string };
type TargetFramework = { framework: string; isActive: boolean };
type Identifier = { id: string };
type TreeItem =
  | ({ type: "solution" } & Solution & Identifier)
  | ({ type: "project" } & ProjectInfo &
      Pick<ProjectSettings, "extensionEntryAdded"> &
      Identifier)
  | ({ type: "targetFramework" } & TargetFramework & Identifier);

export class TreeView {
  constructor(context: vscode.ExtensionContext) {
    const provider = new TreeItemProvider(
      vscode.workspace.workspaceFolders
        ?.slice(0, 1)
        .map((v) => v.uri.path)[0] ?? context.asAbsolutePath(".")
    );
    const view = vscode.window.createTreeView(
      "TargetFrameworkSwitcherTreeView",
      {
        treeDataProvider: provider,
        showCollapseAll: true,
      }
    );
    context.subscriptions.push(view);

    vscode.commands.registerCommand(
      "TargetFrameworkSwitcherTreeView.setTargetFramework",
      async (node: vscode.TreeItem) => {
        if (node.id === undefined) {
          return;
        }
        provider.setTargetFramework(node.id).then(() => provider.refresh());
      }
    );

    vscode.commands.registerCommand(
      "TargetFrameworkSwitcherTreeView.addExtensionEntry",
      async (node: vscode.TreeItem) => {
        if (node.id === undefined) {
          return;
        }
        provider.configureCsproj(node.id).then(() => provider.refresh());
      }
    );

    vscode.commands.registerCommand(
      "TargetFrameworkSwitcherTreeView.refreshSolutions",
      () => {
        provider.refresh();
      }
    );
  }
}

type ExtensionCommands = { refresh: () => Promise<void> } & {
  setTargetFramework: (id: string) => Promise<void>;
} & { configureCsproj: (id: string) => Promise<void> };

class TreeItemProvider
  implements vscode.TreeDataProvider<TreeItem>, ExtensionCommands
{
  private _path: string;
  private currentSolutionStatus: Promise<
    ReadonlyMap<string, Array<ProjectInfo>>
  >;
  private _onDidChangeTreeData: vscode.EventEmitter<void> =
    new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<void> =
    this._onDidChangeTreeData.event;

  constructor(path: string) {
    this._path = path;
    this.currentSolutionStatus = listing(path);
  }

  getChildren(element?: TreeItem): vscode.ProviderResult<Array<TreeItem>> {
    if (element === undefined) {
      return this.currentSolutionStatus
        .then((v) => [...v.keys()])
        .then((v) => v.map((name) => ({ type: "solution", name, id: name })));
    }
    if (element.type === "solution") {
      return this.currentSolutionStatus
        .then((v) => v.get(element.name))
        .then((v) => {
          if (v === undefined) {
            return [];
          }
          return v.map((i) => ({
            type: "project",
            ...i,
            extensionEntryAdded: i.projectSettings.extensionEntryAdded,
            id: `${element.id}|${i.projectName}`,
          }));
        });
    }
    if (element.type === "project") {
      const { type, ...project } = element;
      return getTargetFramework(project.projectResolvedPath).then(
        (targetFramework) =>
          project.projectSettings.targetFrameworks.map((framework) => ({
            type: "targetFramework",
            framework,
            isActive: framework === targetFramework,
            id: `${element.id}|${framework}`,
          }))
      );
    }
    if (element.type === "targetFramework") {
      return [];
    }
    return [];
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    const label: vscode.TreeItemLabel = {
      label: toLabel(element),
    };
    return {
      label,
      iconPath: toIconPath(element),
      collapsibleState:
        element.type === "project" || element.type === "solution"
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      contextValue: toContextValue(element),
      id: element.id,
    };
  }

  async refresh() {
    this.currentSolutionStatus = listing(this._path);
    this._onDidChangeTreeData.fire();
  }

  async setTargetFramework(id: string) {
    const [solution, project, framework] = id.split("|");
    const projectPath = await this.currentSolutionStatus.then(
      (v) =>
        v.get(solution)?.find((s) => s.projectName === project)
          ?.projectResolvedPath
    );
    if (projectPath === undefined) {
      return;
    }
    await switchTargetFramework(projectPath, framework);
  }

  async configureCsproj(id: string) {
    const [solution, project] = id.split("|");
    const projectPath = await this.currentSolutionStatus.then(
      (v) =>
        v.get(solution)?.find((s) => s.projectName === project)
          ?.projectResolvedPath
    );
    if (projectPath === undefined) {
      return;
    }
    await insertTargetFrameworkSwitcherImporter(projectPath);
  }
}

const toLabel = (element: TreeItem): string => {
  switch (element.type) {
    case "project":
      return element.projectName;
    case "solution":
      return element.name;
    case "targetFramework":
      return element.framework;
  }
};

const toIconPath = (
  element: TreeItem
): { light: string; dark: string } | vscode.ThemeIcon | undefined => {
  switch (element.type) {
    case "solution":
      return undefined;
    case "project":
      return element.extensionEntryAdded
        ? new vscode.ThemeIcon("flame")
        : undefined;
    case "targetFramework":
      return element.isActive ? new vscode.ThemeIcon("eye") : undefined;
  }
};

const toContextValue = (element: TreeItem): string | undefined => {
  switch (element.type) {
    case "solution":
      return undefined;
    case "project":
      return element.extensionEntryAdded
        ? "project-configured"
        : "project-default";
    case "targetFramework":
      return element.isActive
        ? "targetFramework-active"
        : "targetFramework-nonActive";
  }
};
