import { execFile, ExecFileOptions } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';

const HAS_INITIALIZED_KEY = 'yunVscodeTools.hasInitialized';
const MAC_COPY_FILES_HELPER = 'yun-copy-files-macos';
const COMMIT_LOG_SEPARATOR = '\x1f';
const COMMIT_RECORD_SEPARATOR = '\x1e';
const execFileAsync = promisify(execFile);
let extensionContext: vscode.ExtensionContext;

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

interface GitAPI {
  repositories: GitRepository[];
}

interface GitRepository {
  rootUri: vscode.Uri;
}

interface UnpushedCommit extends vscode.QuickPickItem {
  hash: string;
  subject: string;
  body: string;
}

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;

  context.subscriptions.push(
    vscode.commands.registerCommand('yunVscodeTools.revealActiveFile', revealActiveFile),
    vscode.commands.registerCommand('yunVscodeTools.disableExplorerAutoReveal', () => disableExplorerAutoReveal(true)),
    vscode.commands.registerCommand('yunVscodeTools.copyFile', copyFile),
    vscode.commands.registerCommand('yunVscodeTools.editCommitMessage', editCommitMessage),
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
  if (isExecFileError(error) && error.stderr) {
    return error.stderr.toString().trim();
  }

  return error instanceof Error ? error.message : String(error);
}

function isExecFileError(error: unknown): error is Error & { stderr?: Buffer | string } {
  return error instanceof Error && 'stderr' in error;
}

async function editCommitMessage() {
  const repository = await pickGitRepository();

  if (!repository) {
    return;
  }

  try {
    await assertGitReady(repository.rootUri.fsPath);

    const commits = await getUnpushedCommits(repository.rootUri.fsPath);

    if (commits.length === 0) {
      vscode.window.showInformationMessage('当前没有未推送的提交');
      return;
    }

    const selected = await vscode.window.showQuickPick<UnpushedCommit>(commits, {
      placeHolder: '选择要编辑消息的未推送提交',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) {
      return;
    }

    const currentMessage = [selected.subject, selected.body].filter(Boolean).join('\n\n');
    const nextMessage = await vscode.window.showInputBox({
      title: '编辑提交消息',
      prompt: selected.hash === commits[0].hash ? '将修改最新未推送提交' : '将通过 rebase 修改历史未推送提交',
      value: currentMessage,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim().length === 0 ? '提交消息不能为空' : undefined),
    });

    if (nextMessage === undefined) {
      return;
    }

    if (nextMessage.trim() === currentMessage.trim()) {
      vscode.window.showInformationMessage('提交消息未变化');
      return;
    }

    if (selected.hash === commits[0].hash) {
      await amendHeadCommitMessage(repository.rootUri.fsPath, nextMessage);
    } else {
      await rewordCommitMessage(repository.rootUri.fsPath, selected.hash, nextMessage);
    }

    vscode.window.showInformationMessage('已更新提交消息');
  } catch (error) {
    vscode.window.showErrorMessage(`编辑提交消息失败：${getErrorMessage(error)}`);
  }
}

async function pickGitRepository() {
  const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  const git = gitExtension?.isActive ? gitExtension.exports : await gitExtension?.activate();
  const repositories = git?.getAPI(1).repositories ?? [];

  if (repositories.length === 0) {
    vscode.window.showInformationMessage('当前工作区没有 Git 仓库');
    return undefined;
  }

  if (repositories.length === 1) {
    return repositories[0];
  }

  const selected = await vscode.window.showQuickPick(
    repositories.map((repository) => ({
      label: vscode.workspace.asRelativePath(repository.rootUri, false),
      repository,
    })),
    { placeHolder: '选择 Git 仓库' },
  );

  return selected?.repository;
}

async function assertGitReady(cwd: string) {
  await assertHasUpstream(cwd);
  await assertNoGitOperationInProgress(cwd);
  await assertWorkingTreeClean(cwd);
}

async function assertHasUpstream(cwd: string) {
  try {
    await runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  } catch {
    throw new Error('当前分支没有 upstream，无法判断哪些提交尚未推送');
  }
}

async function assertNoGitOperationInProgress(cwd: string) {
  const gitDir = (await runGit(cwd, ['rev-parse', '--git-dir'])).stdout.trim();
  const stateDirs = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];

  for (const item of stateDirs) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path.resolve(cwd, gitDir, item)));
      throw new Error('Git 正在执行 rebase/merge/cherry-pick/revert，请完成或中止后再编辑提交消息');
    } catch (error) {
      if (!(error instanceof vscode.FileSystemError)) {
        throw error;
      }
    }
  }
}

async function assertWorkingTreeClean(cwd: string) {
  const { stdout } = await runGit(cwd, ['status', '--porcelain']);

  if (stdout.trim().length > 0) {
    throw new Error('请先处理工作区改动，工作区干净后再编辑提交消息');
  }
}

async function getUnpushedCommits(cwd: string) {
  const { stdout } = await runGit(cwd, [
    'log',
    '--format=%H%x1f%B%x1e',
    '--reverse',
    '@{upstream}..HEAD',
  ]);

  return stdout
    .split(COMMIT_RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map(parseCommitLogRecord)
    .reverse();
}

function parseCommitLogRecord(record: string): UnpushedCommit {
  const separatorIndex = record.indexOf(COMMIT_LOG_SEPARATOR);
  const hash = record.slice(0, separatorIndex);
  const message = record.slice(separatorIndex + COMMIT_LOG_SEPARATOR.length).trim();
  const [subject = '', ...bodyLines] = message.split('\n');
  const body = bodyLines.join('\n').trim();
  const shortHash = hash.slice(0, 7);

  return {
    hash,
    subject,
    body: body.trim(),
    label: subject,
    description: shortHash,
    detail: body.trim(),
  };
}

async function amendHeadCommitMessage(cwd: string, message: string) {
  const messageFile = await writeTempMessageFile(message);

  try {
    // --only 避免意外把暂存区内容一起 amend；前置检查仍要求工作区干净。
    await runGit(cwd, ['commit', '--amend', '--only', '-F', messageFile]);
  } finally {
    await deleteFileIfExists(messageFile);
  }
}

async function rewordCommitMessage(cwd: string, hash: string, message: string) {
  const messageFile = await writeTempMessageFile(message);
  const sequenceEditor = await writeTempScriptFile(createSequenceEditorScript(hash));
  const editor = await writeTempScriptFile(createMessageEditorScript(messageFile));

  try {
    await runGit(cwd, ['rebase', '-i', `${hash}^`], {
      env: {
        ...process.env,
        GIT_SEQUENCE_EDITOR: sequenceEditor,
        GIT_EDITOR: editor,
      },
    });
  } finally {
    await Promise.all([deleteFileIfExists(messageFile), deleteFileIfExists(sequenceEditor), deleteFileIfExists(editor)]);
  }
}

function createSequenceEditorScript(hash: string) {
  return [
    '#!/bin/sh',
    'todo_file="$1"',
    'tmp_file="${todo_file}.yun-vscode-tools"',
    `target_hash="${hash}"`,
    'awk -v hash="$target_hash" \'$1 == "pick" && index(hash, $2) == 1 { $1 = "reword"; changed = 1 } { print } END { if (!changed) exit 2 }\' "$todo_file" > "$tmp_file"',
    'mv "$tmp_file" "$todo_file"',
    '',
  ].join('\n');
}

function createMessageEditorScript(messageFile: string) {
  return [
    '#!/bin/sh',
    'target_file="$1"',
    `message_file=${shellQuote(messageFile)}`,
    'cp "$message_file" "$target_file"',
    '',
  ].join('\n');
}

async function writeTempMessageFile(content: string) {
  const file = path.join(os.tmpdir(), `yun-vscode-tools-message-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  await vscode.workspace.fs.writeFile(vscode.Uri.file(file), Buffer.from(content.endsWith('\n') ? content : `${content}\n`));
  return file;
}

async function writeTempScriptFile(content: string) {
  const file = path.join(os.tmpdir(), `yun-vscode-tools-script-${Date.now()}-${Math.random().toString(16).slice(2)}.sh`);

  await vscode.workspace.fs.writeFile(vscode.Uri.file(file), Buffer.from(content));
  await execFileAsync('chmod', ['700', file]);
  return file;
}

async function deleteFileIfExists(file: string) {
  try {
    await vscode.workspace.fs.delete(vscode.Uri.file(file));
  } catch {
    // 临时文件清理失败不影响 Git 操作结果。
  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function runGit(cwd: string, args: string[], options: ExecFileOptions = {}) {
  const result = await execFileAsync('git', args, {
    encoding: 'utf8',
    ...options,
    cwd,
    maxBuffer: 1024 * 1024 * 10,
  });

  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}
