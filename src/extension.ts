import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const HAS_INITIALIZED_KEY = 'yunVscodeTools.hasInitialized';
const MAC_COPY_FILES_HELPER = 'yun-copy-files-macos';
const execFileAsync = promisify(execFile);
let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;

  context.subscriptions.push(
    vscode.commands.registerCommand('yunVscodeTools.revealActiveFile', revealActiveFile),
    vscode.commands.registerCommand('yunVscodeTools.disableExplorerAutoReveal', () => disableExplorerAutoReveal(true)),
    vscode.commands.registerCommand('yunVscodeTools.copyFile', copyFile),
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

async function copyFile(resource?: vscode.Uri, selectedResources?: vscode.Uri[]) {
  if (process.platform !== 'darwin') {
    vscode.window.showWarningMessage('复制文件暂只支持 macOS');
    return;
  }

  const uris = getExplorerFileUris(resource, selectedResources);

  if (uris.length === 0) {
    vscode.window.showInformationMessage('请选择要复制的本地文件');
    return;
  }

  const files = await filterExistingFiles(uris);

  if (files.length === 0) {
    vscode.window.showInformationMessage('未找到可复制的本地文件');
    return;
  }

  try {
    await copyMacFilesToClipboard(files);
    vscode.window.showInformationMessage(files.length === 1 ? '已复制文件' : `已复制 ${files.length} 个文件`);
  } catch (error) {
    vscode.window.showErrorMessage(`复制文件失败：${getErrorMessage(error)}`);
  }
}

function getExplorerFileUris(resource?: vscode.Uri, selectedResources?: vscode.Uri[]) {
  const uris = selectedResources && selectedResources.length > 0 ? selectedResources : resource ? [resource] : [];
  const seen = new Set<string>();

  return uris.filter((uri) => {
    if (uri.scheme !== 'file' || seen.has(uri.fsPath)) {
      return false;
    }

    seen.add(uri.fsPath);
    return true;
  });
}

async function filterExistingFiles(uris: vscode.Uri[]) {
  const files: vscode.Uri[] = [];

  for (const uri of uris) {
    const stat = await vscode.workspace.fs.stat(uri);

    // 聊天框通常只接受文件附件；文件夹的跨应用粘贴兼容性较差，先不纳入首版。
    if ((stat.type & vscode.FileType.File) === vscode.FileType.File) {
      files.push(uri);
    }
  }

  return files;
}

async function copyMacFilesToClipboard(files: vscode.Uri[]) {
  const helperUri = vscode.Uri.joinPath(extensionContext.extensionUri, 'bin', MAC_COPY_FILES_HELPER);

  await execFileAsync(helperUri.fsPath, files.map((file) => file.fsPath));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
