import * as vscode from 'vscode';

const HAS_INITIALIZED_KEY = 'yunVscodeTools.hasInitialized';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('yunVscodeTools.revealActiveFile', revealActiveFile),
    vscode.commands.registerCommand('yunVscodeTools.disableExplorerAutoReveal', () => disableExplorerAutoReveal(true)),
  );

  void initializeExtension(context);
}

export function deactivate() {}

async function initializeExtension(context: vscode.ExtensionContext) {
  const hasInitialized = context.globalState.get<boolean>(HAS_INITIALIZED_KEY, false);

  if (hasInitialized) {
    return;
  }

  await disableExplorerAutoReveal(false);
  await context.globalState.update(HAS_INITIALIZED_KEY, true);
}

async function revealActiveFile() {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showInformationMessage('当前没有可定位的文件');
    return;
  }

  const { uri } = editor.document;

  // Untitled 文档没有真实资源管理器位置，避免把无效 URI 交给内置 reveal 命令。
  if (uri.scheme === 'untitled') {
    vscode.window.showInformationMessage('当前文件尚未保存，无法在资源管理器中定位');
    return;
  }

  await vscode.commands.executeCommand('revealInExplorer', uri);
}

async function disableExplorerAutoReveal(showNotification: boolean) {
  await vscode.workspace
    .getConfiguration('explorer')
    .update('autoReveal', false, vscode.ConfigurationTarget.Global);

  if (showNotification) {
    vscode.window.showInformationMessage('已关闭资源管理器自动定位当前文件');
  }
}
