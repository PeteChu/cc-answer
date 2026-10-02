# cc-mods-answer

A Claude Code mod that ports the [Pi `answer` extension](https://github.com/PeteChu/pi-extensions/tree/main/answer): run `/answer` after Claude asks you something, and answer every question in Claude Code's native question dialog instead of retyping them in the prompt.

## How it works

1. **Extraction**: `/answer` takes Claude's latest reply that has text and asks a small model (`haiku` by default) to pull out the questions as JSON, shaped for the question dialog: a short header, 2–4 option labels, and single or multi-select.
2. **Answering**: no custom UI. Each question opens Claude Code's own **AskUserQuestion** dialog through `$.ui.ask`, the same one Claude uses when it asks you something. Pick an option, pick several for multi-select questions, or type your own answer under **Other**. Dismissing the dialog cancels `/answer`, and nothing is sent.
3. **Submit**: the answers are compiled into one prompt that starts with
   `I answered your questions in the following way:`, followed by `Q:`/`A:` pairs, and Claude's next turn begins.

## Install

The repo root is the plugin folder:

```bash
git clone https://github.com/PeteChu/cc-mods-answer
claude --plugin-dir ./cc-mods-answer
```

You can also set `CLAUDE_CODE_PLUGIN_DIRS=/path/to/cc-mods-answer` in your environment, or in the `env` block of `~/.claude/settings.json`.

## Configuration

| Option  | Default | What it does                                                  |
| ------- | ------- | ------------------------------------------------------------- |
| `model` | `haiku` | The model alias or id used for extraction. Edit it in `/config`, or set it in `pluginConfigs.answer.options.model` in settings. |

## Development

```bash
claude plugin validate .   # manifest + hooks module checks
claude plugin test .       # runs tests/*.test.ts
```

Layout:

- `hooks/register.ts`: the `/answer` command: extract, ask each question with `$.ui.ask`, submit
- `hooks/lib.ts`: the extraction prompt, and normalizing questions to the dialog's limits (header ≤ 12 chars, 2–4 options, no "Other")
- `tests/answer.test.ts`: unit tests, plus end-to-end tests of answering and of dismissing, with the dialog mocked beneath the plugin
