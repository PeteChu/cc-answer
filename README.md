# cc-mods-answer

A Claude Code mod that ports the [Pi `answer` extension](https://github.com/PeteChu/pi-extensions/tree/main/answer): run `/answer` after Claude asks you something, and answer every question in Claude Code's native question dialog, all at once, instead of retyping them in the prompt.

## How it works

1. **Extraction**: `/answer` takes Claude's latest reply that has text. A small model (`haiku` by default) pulls out the questions, each with a short header, 2–4 options with one-line descriptions, and single or multi-select. Open-ended questions get a few suggested answers.
2. **Answering**: the questions open in Claude Code's **own AskUserQuestion dialog**, the same one Claude uses to ask you something, right above the prompt. One tab per question; ↑/↓ and Enter to pick, Tab/←/→ to switch questions, checkboxes for multi-select, **Type something** to answer in your own words, a review screen before **Submit answers**, and Esc to cancel. The dialog holds up to 4 questions, so a fifth and later ones come in another round.
3. **Submit**: the answers go to Claude as one prompt that starts with `I answered your questions in the following way:`, followed by `Q:`/`A:` pairs. Unanswered questions are left out.

Under the hood, the mod calls `$.ui.ask` with a placeholder question. Its `tool.call` hook then swaps the extracted questions into that AskUserQuestion call, so the engine draws its native multi-question dialog and the hook reads every answer back. Claude's own AskUserQuestion calls pass through untouched.

## Troubleshooting: `/answer --debug`

`/answer --debug` ends with an extraction report: the model used, its raw reply (and the retry's, when the first one did not parse), and the questions it parsed with their options. It shows straight away when extraction fails, or after the dialog closes. The report is part of the command's output, so Claude can read it too.

Extraction tolerates the usual model slips: prose or code fences around the JSON, trailing commas, raw newlines in strings, smart quotes, and a reply cut off partway (the questions that arrived whole are kept). If the reply still can't be read, `/answer` retries once with a stricter instruction and more room. If that fails too, it says what the model replied.

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

- `hooks/register.ts`: the `/answer` command and the `tool.call` hook that fills the native dialog
- `hooks/lib.ts`: the extraction prompt, fitting questions to the dialog's limits (header ≤ 12 chars, 2–4 options, ≤ 4 questions per round), and compiling the answers
- `tests/answer.test.ts`: tests, with the dialog faked beneath the plugin: rounds of four, the submitted prompt, Esc and "Chat about this"
