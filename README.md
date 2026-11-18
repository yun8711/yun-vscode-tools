# Yun VSCode Tools

VS Code/Cursor 开发辅助工具合集。

## 当前功能

- 在资源管理器标题栏增加“定位当前文件”按钮，点击后手动定位当前编辑器文件。
- 扩展首次激活时自动关闭全局 `explorer.autoReveal`，避免切换编辑器文件时资源管理器自动跳动。
- 在资源管理器文件右键菜单增加“复制文件”，可将本地文件以附件形式复制到 macOS 系统剪贴板。
- 在资源管理器和编辑器标签右键菜单增加“复制文件名”，可将文件或目录名复制为文本；资源管理器多选时每行一个名称。
- 在资源管理器右键菜单增加“编辑提交消息”，可修改当前分支未推送提交的消息。
- 在资源管理器右键菜单增加“压缩”和“压缩子文件”，支持递归生成 zip 或 tar.gz 压缩包。

## 开发

```bash
pnpm install
pnpm run compile
```

## 安装使用

发布到扩展市场后，可以在 VS Code 扩展面板中搜索 `Yun VSCode Tools` 安装。

也可以通过本地 VSIX 安装。

### 开发调试

在 VS Code/Cursor 中打开本项目，按 `F5` 启动扩展开发宿主窗口。

### 打包

```bash
pnpm run package
```

打包后会在项目根目录生成：

```text
yun-vscode-tools-0.0.2.vsix
```

### 安装到 VS Code

```bash
code --install-extension yun-vscode-tools-0.0.2.vsix
```

### 安装到 Cursor

```bash
cursor --install-extension yun-vscode-tools-0.0.2.vsix
```

如果命令行没有 `code` 或 `cursor` 命令，也可以在编辑器的扩展面板中选择“Install from VSIX...”并选择生成的 `.vsix` 文件。

### 更新扩展

修改代码后重新打包并再次安装同一个 VSIX 即可：

```bash
pnpm run package
cursor --install-extension yun-vscode-tools-0.0.2.vsix
```

## 注意事项

- `复制文件` 目前仅支持 macOS。
- `压缩` 和 `压缩子文件` 依赖系统提供的 `zip` 和 `tar` 命令。
- `编辑提交消息` 会重写未推送提交的 Git 历史，执行前请确认当前分支状态。
