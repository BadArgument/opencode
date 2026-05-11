import { Schema } from "effect"
import DESCRIPTION from "./shell.txt"
import { PositiveInt } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { ShellID } from "./id"

const PS = new Set(["powershell", "pwsh"])
const CMD = new Set(["cmd"])

const descriptions = {
  bash: "用5-10个词清晰简洁地描述此命令的作用。示例：\n输入：ls\n输出：列出当前目录中的文件\n\n输入：git status\n输出：显示工作树状态\n\n输入：npm install\n输出：安装包依赖项\n\n输入：mkdir foo\n输出：创建目录 'foo'",
  powershell:
    '用5-10个词清晰简洁地描述此命令的作用。示例：\n输入：Get-ChildItem -LiteralPath "."\n输出：列出当前目录\n\n输入：git status\n输出：显示工作树状态\n\n输入：npm install\n输出：安装包依赖项\n\n输入：New-Item -ItemType Directory -Path "tmp"\n输出：创建目录 tmp',
  cmd: '用5-10个词清晰简洁地描述此命令的作用。示例：\n输入：dir\n输出：列出当前目录\n\n输入：if exist "package.json" type "package.json"\n输出：当 package.json 存在时打印其内容\n\n输入：mkdir tmp\n输出：创建目录 tmp',
}

export type Limits = {
  maxLines: number
  maxBytes: number
}

export function parameterSchema(description: string) {
  return Schema.Struct({
    command: Schema.String.annotate({ description: "要执行的命令" }),
    timeout: Schema.optional(PositiveInt).annotate({ description: "可选的超时时间（毫秒）" }),
    workdir: Schema.optional(Schema.String).annotate({
      description: `执行命令的工作目录。默认为当前目录。请使用此参数代替 'cd' 命令。`,
    }),
    description: Schema.String.annotate({ description }),
  })
}

export const Parameters = parameterSchema(descriptions.bash)
export type Parameters = Schema.Schema.Type<typeof Parameters>

function renderPrompt(template: string, values: Record<string, string>) {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => {
    const value = values[key]
    if (value === undefined) throw new Error(`缺少 shell 提示值：${key}`)
    return value
  })
}

function shellDisplayName(name: string) {
  if (name === "pwsh") return "PowerShell (7+)"
  if (name === "powershell") return "Windows PowerShell (5.1)"
  if (name === "cmd") return "cmd.exe"
  return name
}

function powershellNotes(name: string) {
  if (name === "pwsh") {
    return `# PowerShell (7+) shell 说明
- 这个跨平台 shell 支持管道链运算符（\`&&\` 和 \`||\`）。
- 使用双引号表示插值字符串（\`"Hello $name"\`），使用单引号表示原义字符串。
- 优先使用完整的 cmdlet 名称，如 \`Get-ChildItem\`、\`Set-Content\`、\`Remove-Item\` 和 \`New-Item\`，而不是别名。
- 使用 \`$(...)\` 表示子表达式。使用 \`@(...)\` 表示数组表达式。
- 要调用路径包含空格的本机可执行文件，请使用调用运算符：\`& "path/to/exe" args\`。
- 使用 PowerShell 反引号字符转义特殊字符。`
  }
  if (name === "powershell") {
    return `# Windows PowerShell (5.1) shell 说明
- 使用 \`cmd1; if ($?) { cmd2 }\` 来链接依赖的命令。
- 使用双引号表示插值字符串（\`"Hello $name"\`），使用单引号表示原义字符串。
- 优先使用完整的 cmdlet 名称，如 \`Get-ChildItem\`、\`Set-Content\`、\`Remove-Item\` 和 \`New-Item\`，而不是别名。
- 使用 \`$(...)\` 表示子表达式。使用 \`@(...)\` 表示数组表达式。
- 要调用路径包含空格的本机可执行文件，请使用调用运算符：\`& "path/to/exe" args\`。
- 使用 PowerShell 反引号字符转义特殊字符。`
  }
  return ""
}

function chainGuidance(name: string) {
  if (name === "powershell") {
    return "如果命令相互依赖且必须按顺序运行，请避免在此 shell 中使用 '&&'，因为 Windows PowerShell (5.1) 不支持它。当后续命令必须依赖先前命令成功时，请使用 PowerShell 条件语句，如 `cmd1; if ($?) { cmd2 }`。"
  }
  if (PS.has(name)) {
    return "如果命令相互依赖且必须按顺序运行，请使用单个 bash 工具调用并用 '&&' 将它们链接在一起（例如，`git add . && git commit -m \"message\" && git push`）。例如，如果一个操作必须在另一个操作开始之前完成（如 New-Item 在 Copy-Item 之前、Write 在 bash 的 git 操作之前，或 git add 在 git commit 之前），请改为按顺序运行这些操作。"
  }
  if (CMD.has(name)) {
    return "如果命令相互依赖且必须按顺序运行，请使用单个 bash 工具调用并用 `&&` 将它们链接在一起（例如，`mkdir out && dir out`）。例如，如果一个操作必须在另一个操作开始之前完成，请改为按顺序运行这些操作。"
  }
  return "如果命令相互依赖且必须按顺序运行，请使用单个 Bash 调用并用 '&&' 将它们链接在一起（例如，`git add . && git commit -m \"message\" && git push`）。例如，如果一个操作必须在另一个操作开始之前完成（如 mkdir 在 cp 之前、Write 在 Bash 的 git 操作之前，或 git add 在 git commit 之前），请改为按顺序运行这些操作。"
}

function bashCommandSection(chain: string, limits: Limits) {
  return `在执行命令之前，请遵循以下步骤：

1. 目录验证：
   - 如果命令将创建新目录或文件，请首先使用 \`ls\` 验证父目录存在且位置正确
   - 例如，在运行 "mkdir foo/bar" 之前，请先使用 \`ls foo\` 检查 "foo" 是否存在且是预期的父目录

2. 命令执行：
   - 始终使用双引号引用包含空格的文件路径（例如，rm "path with spaces/file.txt"）
   - 正确引用的示例：
     - mkdir "/Users/name/My Documents"（正确）
     - mkdir /Users/name/My Documents（错误 - 会失败）
     - python "/path/with spaces/script.py"（正确）
     - python /path/with spaces/script.py（错误 - 会失败）
   - 确保正确引用后，执行命令。
   - 捕获命令的输出。

使用说明：
  - command 参数是必需的。
  - 您可以指定可选的超时时间（毫秒）。如果未指定，命令将在 120000 毫秒（2 分钟）后超时。
  - 用 5-10 个词写出清晰简洁的命令描述非常有帮助。
  - 如果输出超过 ${limits.maxLines} 行或 ${limits.maxBytes} 字节，它将被截断，完整的输出将写入文件。您可以使用带有偏移量/限制的 Read 来读取特定部分，或使用 Grep 搜索完整内容。不要使用 \`head\`、\`tail\` 或其他截断命令来限制输出；完整输出将已被捕获到文件中，以便更精确地搜索。

  - 避免使用带有 \`find\`、\`grep\`、\`cat\`、\`head\`、\`tail\`、\`sed\`、\`awk\` 或 \`echo\` 命令的 Bash，除非明确指示或这些命令对任务确实必要。相反，始终优先使用专用工具来处理这些命令：
    - 文件搜索：使用 Glob（不是 find 或 ls）
    - 内容搜索：使用 Grep（不是 grep 或 rg）
    - 读取文件：使用 Read（不是 cat/head/tail）
    - 编辑文件：使用 Edit（不是 sed/awk）
    - 写入文件：使用 Write（不是 echo >/cat <<EOF）
    - 通信：直接输出文本（不是 echo/printf）
  - 发出多个命令时：
    - 如果命令是独立的且可以并行运行，请在单条消息中进行多次 bash 工具调用。例如，如果需要运行 "git status" 和 "git diff"，请发送一条包含两个并行 bash 工具调用的消息。
    - ${chain}
    - 仅当需要按顺序运行命令但不关心先前命令是否失败时，才使用 ';'
    - 不要使用换行符分隔命令（换行符在带引号的字符串中是可以的）
  - 避免使用 \`cd <directory> && <command>\`。请改用 \`workdir\` 参数来切换目录。
    <good-example>
    使用 workdir="/foo/bar" 并带上命令：pytest tests
    </good-example>
    <bad-example>
    cd /foo/bar && pytest tests
    </bad-example>`
}

function powershellCommandSection(name: string, chain: string, pathSep: string, limits: Limits) {
  return `${powershellNotes(name)}

在执行命令之前，请遵循以下步骤：

1. 目录验证：
   - 如果命令将创建新目录或文件，请首先使用 \`Test-Path -LiteralPath <parent>\` 验证父目录存在且位置正确
   - 例如，在创建 \`foo${pathSep}bar\` 之前，请先使用 \`Test-Path -LiteralPath "foo"\` 检查 \`foo\` 是否存在且是预期的父目录

2. 命令执行：
   - 始终使用双引号引用包含空格的文件路径（例如，Remove-Item -LiteralPath "path with spaces${pathSep}file.txt"）
   - 正确引用的示例：
     - New-Item -ItemType Directory -Path "My Documents"（正确）
     - New-Item -ItemType Directory -Path My Documents（错误 - 路径被分割）
     - & "path with spaces${pathSep}script.ps1"（正确）
     - path with spaces${pathSep}script.ps1（错误 - 路径被分割且未调用）
   - 确保正确引用后，执行命令。
   - 捕获命令的输出。

使用说明：
  - command 参数是必需的。
  - 您可以指定可选的超时时间（毫秒）。如果未指定，命令将在 120000 毫秒（2 分钟）后超时。
  - 用 5-10 个词写出清晰简洁的命令描述非常有帮助。
  - 如果输出超过 ${limits.maxLines} 行或 ${limits.maxBytes} 字节，它将被截断，完整的输出将写入文件。您可以使用带有偏移量/限制的 Read 来读取特定部分，或使用 Grep 搜索完整内容。不要使用 \`Select-Object -First\`、\`Select-Object -Last\` 或其他截断命令来限制输出；完整输出将已被捕获到文件中，以便更精确地搜索。

  - 避免使用带有 PowerShell 文件/内容 cmdlet 的 Shell，除非明确指示或这些 cmdlet 对任务确实必要。相反，始终优先使用专用工具来处理这些命令：
    - 文件搜索：使用 Glob（不是 Get-ChildItem）
    - 内容搜索：使用 Grep（不是 Select-String）
    - 读取文件：使用 Read（不是 Get-Content）
    - 编辑文件：使用 Edit（不是 Set-Content）
    - 写入文件：使用 Write（不是 Set-Content/Out-File 或 here-strings）
    - 通信：直接输出文本（不是 Write-Output/Write-Host）
  - 发出多个命令时：
    - 如果命令是独立的且可以并行运行，请在单条消息中进行多次 bash 工具调用。例如，如果需要运行 "git status" 和 "git diff"，请发送一条包含两个并行 bash 工具调用的消息。
    - ${chain}
    - 仅当需要按顺序运行命令但不关心先前命令是否失败时，才使用 \`;\`
    - 不要使用换行符分隔命令（换行符在带引号的字符串中是可以的）
  - 避免在命令内部切换目录。请改用 \`workdir\` 参数来切换目录。
    <good-example>
    使用 workdir="project${pathSep}subdir" 并带上命令：pytest tests
    </good-example>
    <bad-example>
    ${name === "powershell" ? `Set-Location -LiteralPath "project${pathSep}subdir"; if ($?) { pytest tests }` : `Set-Location -LiteralPath "project${pathSep}subdir" && pytest tests`}
    </bad-example>`
}

function cmdCommandSection(chain: string, limits: Limits) {
  return `# cmd.exe shell 说明
- 使用双引号处理包含空格的路径。
- 使用 %VAR% 表示环境变量。
- 使用 \`if exist\` 进行存在性检查。
- 从另一个批处理风格的命令中调用批处理文件时，使用 \`call\`。

在执行命令之前，请遵循以下步骤：

1. 目录验证：
   - 如果命令将创建新目录或文件，请首先使用 \`if exist\` 验证父目录存在且位置正确
   - 例如，在创建 \`foo\\bar\` 之前，请先使用 \`if exist "foo\\" dir "foo"\` 检查 \`foo\` 是否存在且是预期的父目录

2. 命令执行：
   - 始终使用双引号引用包含空格的文件路径（例如，del "path with spaces\\file.txt"）
   - 正确引用的示例：
     - mkdir "My Documents"（正确）
     - mkdir My Documents（错误 - 路径被分割）
     - call "path with spaces\\script.bat"（正确）
     - path with spaces\\script.bat（错误 - 路径被分割且未正确调用）
   - 确保正确引用后，执行命令。
   - 捕获命令的输出。

使用说明：
  - command 参数是必需的。
  - 您可以指定可选的超时时间（毫秒）。如果未指定，命令将在 120000 毫秒（2 分钟）后超时。
  - 用 5-10 个词写出清晰简洁的命令描述非常有帮助。
  - 如果输出超过 ${limits.maxLines} 行或 ${limits.maxBytes} 字节，它将被截断，完整的输出将写入文件。您可以使用带有偏移量/限制的 Read 来读取特定部分，或使用 Grep 搜索完整内容。不要使用 \`more\` 或其他分页命令来限制输出；完整输出将已被捕获到文件中，以便更精确地搜索。

  - 避免使用带有 cmd.exe 文件/内容命令的 Shell，除非明确指示或这些命令对任务确实必要。相反，始终优先使用专用工具来处理这些命令：
    - 文件搜索：使用 Glob（不是 dir /s）
    - 内容搜索：使用 Grep（不是 findstr）
    - 读取文件：使用 Read（不是 type）
    - 编辑文件：使用 Edit（不是 copy）
    - 写入文件：使用 Write（不是 echo > file）
    - 通信：直接输出文本（不是 echo）
  - 发出多个命令时：
    - 如果命令是独立的且可以并行运行，请在单条消息中进行多次 bash 工具调用。例如，如果需要运行 "dir" 和 "where cmd"，请发送一条包含两个并行 bash 工具调用的消息。
    - ${chain}
    - 仅当需要按顺序运行命令但不关心先前命令是否失败时，才使用 \`&\`
    - 不要使用换行符分隔命令（换行符在带引号的字符串中是可以的）
  - 避免在命令内部切换目录。请改用 \`workdir\` 参数来切换目录。
    <good-example>
    使用 workdir="project\\subdir" 并带上命令：dir
    </good-example>
    <bad-example>
    cd /d "project\\subdir" && dir
    </bad-example>`
}

function profile(name: string, platform: NodeJS.Platform, limits: Limits) {
  const isPowerShell = PS.has(name)
  const chain = chainGuidance(name)
  if (CMD.has(name)) {
    return {
      intro: `执行给定的 ${shellDisplayName(name)} 命令，并带有可选的超时时间，确保正确处理和安全措施。`,
      workdirSection:
        "所有命令默认在当前工作目录中运行。如果需要在不同目录中运行命令，请使用 `workdir` 参数。避免在命令内部切换目录 - 请改用 `workdir`。",
      commandSection: cmdCommandSection(chain, limits),
      gitCommands: "git 命令",
      gitCommandRestriction: "git 命令",
      createPrInstruction: "使用临时正文文件创建 PR，以便 cmd.exe 引号保持简单。",
      createPrExample: `(\n  echo ## 摘要\n  echo - ^<1-3 个要点^>\n) > pr-body.txt\ngh pr create --title "pr 标题" --body-file pr-body.txt`,
      parameterDescription: descriptions.cmd,
    }
  }
  if (isPowerShell) {
    return {
      intro: `执行给定的 ${shellDisplayName(name)} 命令，并带有可选的超时时间，确保正确处理和安全措施。`,
      workdirSection:
        "所有命令默认在当前工作目录中运行。如果需要在不同目录中运行命令，请使用 `workdir` 参数。避免在命令内部切换目录 - 请改用 `workdir`。",
      commandSection: powershellCommandSection(name, chain, platform === "win32" ? "\\" : "/", limits),
      gitCommands: "git 命令",
      gitCommandRestriction: "git 命令",
      createPrInstruction: "使用带有 PowerShell here-string 的 gh pr create 来正确传递正文。",
      createPrExample: `gh pr create --title "pr 标题" --body @'
## 摘要
- <1-3 个要点>
'@`,
      parameterDescription: descriptions.powershell,
    }
  }
  return {
    intro:
      "在持久的 shell 会话中执行给定的 bash 命令，并带有可选的超时时间，确保正确处理和安全措施。",
    workdirSection:
      "所有命令默认在当前工作目录中运行。如果需要在不同目录中运行命令，请使用 `workdir` 参数。避免使用 `cd <directory> && <command>` 模式 - 请改用 `workdir`。",
    commandSection: bashCommandSection(chain, limits),
    gitCommands: "bash 命令",
    gitCommandRestriction: "git bash 命令",
    createPrInstruction:
      "使用以下格式通过 gh pr create 创建 PR。使用 HEREDOC 传递正文以确保格式正确。",
    createPrExample: `gh pr create --title "pr 标题" --body "$(cat <<'EOF'
## 摘要
<1-3 个要点>`,
    parameterDescription: descriptions.bash,
  }
}

export function render(name: string, platform: NodeJS.Platform, limits: Limits) {
  const selected = profile(name, platform, limits)
  return {
    description: renderPrompt(DESCRIPTION, {
      intro: selected.intro,
      os: platform,
      shell: name,
      tmp: Global.Path.tmp,
      workdirSection: selected.workdirSection,
      commandSection: selected.commandSection,
      gitCommands: selected.gitCommands,
      toolName: ShellID.ToolID,
      gitCommandRestriction: selected.gitCommandRestriction,
      createPrInstruction: selected.createPrInstruction,
      createPrExample: selected.createPrExample,
    }),
    parameters: parameterSchema(selected.parameterDescription),
  }
}

export * as ShellPrompt from "./prompt"
