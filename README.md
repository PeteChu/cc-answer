# cc-mods-answer

A Claude Code mod that ports the [Pi `answer` extension](https://github.com/PeteChu/pi-extensions/tree/main/answer): run `/answer` after Claude asks you something, and answer every question in Claude Code's native question dialog instead of retyping them in the prompt.

## How it works

1. **Extraction**: `/answer` takes Claude's latest reply that has text and asks a small model (`haiku` by default) to pull out the questions as JSON, shaped for the question dialog: a short header, 2–4 option labels, and single or multi-select.
2. **Answering**: no custom UI. Each question opens Claude Code's own **AskUserQuestion** dialog through `$.ui.ask`, the same one Claude uses when it asks you something. Pick an option, pick several for multi-select questions, or type your own answer under **Other**. Dismissing the dialog cancels `/answer`, and nothing is sent.
3. **Submit**: the answers are compiled into one prompt that starts with
   `I answered your questions in the following way:`, followed by `Q:`/`A:` pairs, and Claude's next turn begins.

## Prototypes: `/answer-prototype`

Ten candidate UIs for answering. Each one draws in the band **directly above the prompt**, so none of them docks beside the transcript, and each uses Claude Code's own glyphs and theme colors (`✻ ⏺ ⎿ ❯ ☐ ☒`, `claude`, `permission`, `suggestion`).

```
/answer-prototype            # list the designs
/answer-prototype 3          # try design 3 on built-in demo questions (nothing is sent)
/answer-prototype 3 live     # extract from Claude's last reply and really submit
```

| # | Design | Idea |
|---|--------|------|
| 1 | Ask dialog | Looks like the built-in AskUserQuestion dialog: tabs per question, `❯` on the pick, option descriptions |
| 2 | Survey line | Two compact lines, like Claude Code's "How is Claude doing this session?" survey |
| 3 | Transcript thread | `⏺` / `⎿` rows that read like the transcript; answered questions collapse to one line |
| 4 | Todo checklist | `✻ Answering…` header with `☐`/`☒` items, like the todo list |
| 5 | Stepper | One question at a time, a `━━━──` progress bar and a row of buttons |
| 6 | Prompt card | A rounded card with an accent border, drawn like the prompt box |
| 7 | Chips | A running answer summary on top; options as wrapping chips |
| 8 | Accordion | Every question listed; the current one expanded |
| 9 | Ghost suggestion | A tiny band; the pick shows as dim ghost text in the prompt box (Tab takes it) |
| 10 | Split view | The question list on the left, the current question on the right; stacked when narrow |

Every design answers the same way, so you compare looks rather than controls:

- **1–7** pick an option straight from the empty prompt, the way the feedback survey takes digits. On a multi-select question they toggle.
- **Type in the prompt + Enter** answers the current question in your own words. Typing an option's label or number picks it. While a prototype is up, typed prompts go to it, not to Claude.
- **8** back · **9** skip (single-select) or done (multi-select) · **0** cancel. On the review screen, **1** submits.
- To use the mouse, click any button. In the terminal, ctrl+x tab focuses the band.

The demo run ends by printing the prompt that would be sent, without sending it. With `live`, the answers really go to Claude.

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

- `hooks/register.tsx`: the `/answer` command (asks with `$.ui.ask`), plus `/answer-prototype`: its state, the prompt capture and the band
- `hooks/proto/model.ts`: the prototype list, the demo questions and the answer state changes
- `hooks/proto/designs.tsx`: the ten band designs and the shared review screen
- `types/index.d.ts`: the state contract (`answer.proto`)
- `hooks/lib.ts`: the extraction prompt, and normalizing questions to the dialog's limits (header ≤ 12 chars, 2–4 options, no "Other")
- `tests/answer.test.ts`: `/answer` tests, with the dialog mocked beneath the plugin
- `tests/prototype.test.ts`: each design drawn on terminal and desktop, narrow and wide, and run end to end
