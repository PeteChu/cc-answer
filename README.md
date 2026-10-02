# CC-Answer

**Claude forgot the question dialog? Open one yourself.**

Sometimes Claude asks questions in plain prose instead of opening its built-in question dialog. Run `/answer` to pick options or write your own responses, review them, and send everything back in one organized reply.

A Claude Code mod to answer every question in Claude Code's native question dialog, all at once, instead of retyping them in the prompt.

## Get started

Load the repository as a plugin in a Claude Code runtime that supports mods:

```bash
git clone https://github.com/PeteChu/cc-answer
claude --plugin-dir ./cc-answer
```

For persistent loading, set `CLAUDE_CODE_PLUGIN_DIRS=/path/to/cc-answer` in your environment or in the `env` block of `~/.claude/settings.json`.

## How it works

1. **Extraction**: `/answer` takes Claude's latest reply that has text. A small model (`haiku` by default) pulls out the questions, each with a short header, 2–4 options with one-line descriptions, and single or multi-select. Open-ended questions get a few suggested answers.
2. **Answering**: the questions open in Claude Code's **own AskUserQuestion dialog**, the same one Claude uses to ask you something, right above the prompt. One tab per question; ↑/↓ and Enter to pick, Tab/←/→ to switch questions, checkboxes for multi-select, **Type something** to answer in your own words, a review screen before **Submit answers**, and Esc to cancel. The dialog holds up to 4 questions, so a fifth and later ones come in another round.
3. **Submit**: the answers go to Claude as one prompt that starts with `I answered your questions in the following way:`, followed by `Q:`/`A:` pairs. Unanswered questions are left out.

Under the hood, the mod calls `$.ui.ask` with a placeholder question. Its `tool.call` hook then swaps the extracted questions into that AskUserQuestion call, so the engine draws its native multi-question dialog and the hook reads every answer back. Claude's own AskUserQuestion calls pass through untouched.

Extraction uses **`haiku` by default**. Change the `model` option in `/config`, or set `pluginConfigs.answer.options.model` in settings to another model alias or ID.

Custom text entry is available on terminal and desktop surfaces. On mobile, answers are limited to the extracted options.

## Example reply

```text
I answered your questions in the following way:

Q: Which database should we use?
A: PostgreSQL

Q: What should the service be called?
A: billing-api
```

## Troubleshooting: `/answer --debug`

`/answer --debug` ends with an extraction report: the model used, its raw reply (and the retry's, when the first one did not parse), and the questions it parsed with their options. It shows straight away when extraction fails, or after the dialog closes. The report is part of the command's output, so Claude can read it too.

Extraction tolerates the usual model slips: prose or code fences around the JSON, trailing commas, raw newlines in strings, smart quotes, and a reply cut off partway (the questions that arrived whole are kept). If the reply still can't be read, `/answer` retries once with a stricter instruction and more room. If that fails too, it says what the model replied.

## Development

```bash
claude plugin validate .   # Check the manifest and hooks module
claude plugin test .       # Run unit and end-to-end tests
```

Layout:

- `hooks/register.ts`: the `/answer` command (extraction, one retry, the `--debug` report) and the `tool.call` hook that fills the native dialog
- `hooks/lib.ts`: the extraction prompt, JSON repair and recovery from replies cut off partway, fitting questions to the dialog's limits (header ≤ 12 chars, 2–4 options, ≤ 4 questions per round), and compiling the answers
- `tests/answer.test.ts`: tests, with the model and the dialog faked beneath the plugin: JSON repairs, rounds of four, the submitted prompt, Esc and "Chat about this", the retry, and the `--debug` report
