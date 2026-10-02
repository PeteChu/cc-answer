# cc-mods-answer

A Claude Code mod that ports the [Pi `answer` extension](https://github.com/PeteChu/pi-extensions/tree/main/answer): run `/answer` after Claude asks you something, and answer every question in an interactive pane instead of retyping them in the prompt.

## How it works

1. **Extraction**: `/answer` takes Claude's latest reply that has text and asks a small model (`haiku` by default) to pull out the questions as JSON: each one gets an id, an optional header and context, and choices when a fixed set can be inferred.
2. **Answering**: a focused pane shows one question at a time:
   - numbered options (press `1`–`9` or click). Single-select moves on to the next question as soon as you pick.
   - an **Other / Answer** text field for a custom answer (Enter saves it and moves on)
   - **Multi-select** turns the options into checkboxes; picks and custom text are joined with `, `
   - **← Prev / Next →** to move between questions, plus a progress strip (`✓` answered, `●` current, `·` open)
3. **Review & submit**: the review screen shows the compiled Q/A. **Submit** sends one prompt that starts with
   `I answered your questions in the following way:` and Claude's next turn begins. Unanswered questions are left out.

**Drafts**: closing the pane (Esc or **Later**) keeps your answers for the session. Running `/answer` again on the same reply brings them back without extracting again. Use `/answer new` to extract again.

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

- `hooks/register.tsx`: the `/answer` command, extraction, and the pane UI
- `hooks/lib.ts`: the extraction prompt, parsing/normalizing, and answer compilation
- `types/index.d.ts`: the session-state contract (`answer.session`)
- `tests/answer.test.ts`: unit tests, plus an end-to-end test (extract → answer → submit) on the terminal and desktop surfaces
