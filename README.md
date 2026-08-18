# vscode-plugin-swimming
VSCode模拟写代码，划水，摸鱼神器。代码写的快，提早完工却被监视压榨怎么办？你需要一个模拟写代码工具，让代码自己重写一遍。

本项目初衷是抵制拼多多在疫情期间监控员工电脑编写代码时间计算工时的行为。个人认为过于常态化过于饱和的工作，是严重影响员工创造力和员工归属感的行为，对于公司和个人的长期发展都是极为不利的，在这个环境下员工只会变成为了虚假的产出进行工作而不考虑是否能为公司带来真正的价值。

# 安装方法
在vscode的扩展栏，在应用商店中搜索“swimming”,点击"install"或“安装”

## 本地打包安装

项目最低支持 Node.js 20，仓库中的 `.nvmrc` 默认使用 Node.js 24。进入项目目录后执行：

```bash
nvm use
corepack enable
pnpm install
pnpm test
pnpm run vsce:package
```

打包成功后，会在项目根目录生成 `swimming-local.vsix`。可以通过命令行安装或覆盖已有版本：

```bash
code --install-extension ./swimming-local.vsix --force
```

也可以在 VS Code 扩展页面点击右上角 `...`，选择 `从 VSIX 安装...`，然后选中 `swimming-local.vsix`。安装完成后执行 `Developer: Reload Window` 重新加载窗口。

代码更新后，重新运行 `pnpm test`、打包命令和带 `--force` 的安装命令即可覆盖本地版本。此流程只生成并安装本地 VSIX，不会发布到扩展市场。

# 使用方法
此工具需要配合低声音键盘，即使抚摸键盘也可以完美演绎敲键盘的样子！

选中代码后，右击菜单中选中划水选择对应划水模式即可，也可以右键暂停或继续。如下图：

![使用图片](https://raw.githubusercontent.com/zy445566/vscode-plugin-swimming/master/cr.png)

新增 `Shadow Rewriting` 模式：
* 先选中目标代码，再右键选择 `Shadow Rewriting`
* 进入该模式后，除了 `Esc` 之外，你随便按键盘上的字符键，编辑器都会输出下一个目标代码字符
* 可以显示类似 AI 行内补全的 ghost text，提示当前代码行剩余的完整内容
* 该模式现在默认优先保证目标文本正确，不再借用编辑器的自动补全括号/引号
* 当下一个目标字符是符号时，需要按出一个符号字符后才会继续映射，避免普通字母键直接写出符号
* 按 `Esc` 可以退出 `Shadow Rewriting`
* 如果系统或输入法抢字，shadow 会暂停继续推进；这时 `Backspace` 只会删除多输出来的字符，不会回退已经映射出的目标字符
* 可以在 VS Code 设置中搜索 `shadowRequireShiftForSymbols`，关闭符号映射限制
* 可以在 VS Code 设置中搜索 `shadowShowInlineSuggestion`，关闭 ghost text 提示
* 可以在 VS Code 设置中搜索 `shadowRequireManualLineBreaksAndIndentation`，开启“回车换行 + Tab 推进缩进”的严格模式；其中 Tab 只消费一个 `\t` 或连续 4 个空格

新增 `边打边看` 模式：
* 将需要查看的文件与正在输入的文件放在两个可见的编辑器组中
* 在正在输入的编辑器右键选择 `边打边看：选择工作窗口`，然后选择需要滚动的工作文件
* 焦点仍停留在正在输入的编辑器时，默认按 `-` 向上滚动、`=` 向下滚动、`\` 关闭工作窗口、`` ` `` 重新打开最近关闭的工作窗口
* 滚动时会同步更新工作窗口的光标位置，重新聚焦后可继续从当前观看位置阅读
* 在右键菜单的 `Swimming` 子菜单中选择 `边打边看：重命名工作编辑器`，可为工作区文件设置自定义标签页名称
* 可以在 VS Code 设置中搜索 `lookWhileTypingScrollUpKey`、`lookWhileTypingScrollDownKey`、`lookWhileTypingCloseTargetKey`、`lookWhileTypingReopenTargetKey` 自定义四个单字符按键
* 可以在 VS Code 设置中搜索 `lookWhileTypingStepLines` 调整每次滚动的行数
* 可以在 VS Code 设置中搜索 `lookWhileTypingScrollMode` 切换滚动方式：`line` 为跨文档行移动（默认），`cursor` 为移动工作窗口光标，适合自动换行后占据多行的超长文本
* 右键选择 `边打边看：清除工作窗口` 后，三个按键都会恢复为普通输入

如果想要快捷键暂停代码重写，可以直接使用以下按键暂停：
* win默认:ctrl+alt+shift+p
* mac默认:alt+cmd+shift+p

如果想要快捷键放弃代码重写，可以直接使用以下按键停止：
* win默认:ctrl+alt+x
* mac默认:alt+cmd+x

新增模式切换，在编辑器内右击Switch Write Mode，可以切换模式
* once 仅重写一次 # 划一下就好
* cycle 循环重写 # 一直划水一直爽

# 重要说明
请先提交代码，否则代码丢失概不负责！

# 仓库地址
https://github.com/zy445566/vscode-plugin-swimming
