# CC-Answer

**Claude forgot the question dialog? Open one yourself.**

Sometimes Claude asks questions in plain prose instead of opening its built-in question dialog. Run `/answer` to pick options or write your own responses, review them, and send everything back in one organized reply.

A Claude Code mod to answer every question in Claude Code's native question dialog, all at once, instead of retyping them in the prompt.

## Get started

Install from the marketplace, inside Claude Code:

```
/plugin marketplace add PeteChu/cc-answer
/plugin install answer@cc-answer
/reload-plugins
```

A mod runs inside Claude Code with the same access Claude Code has. Read the code before installing.

Or load a local clone directly:

```bash
git clone https://github.com/PeteChu/cc-answer
claude --plugin-dir ./cc-answer
```

For persistent loading, set `CLAUDE_CODE_PLUGIN_DIRS=/path/to/cc-answer` in your environment or in the `env` block of `~/.claude/settings.json`.

## How it works

1. **Extraction**: `/answer` takes Claude's latest reply that has text. A small model (`haiku` by default) pulls out the questions, each with a short header, 2–4 options with one-line descriptions, and single or multi-select. Open-ended questions get a few suggested answers.
2. **Answering**: the questions open in Claude Code's **own AskUserQuestion dialog**, the same one Claude uses to ask you something, right above the prompt. One tab per question; ↑/↓ and Enter to pick, Tab/←/→ to switch questions, checkboxes for multi-select, **Type something** to answer in your own words, a review screen before **Submit answers**, and Esc to cancel. The dialog holds up to 4 questions, so a fifth and later ones come in another round.
3. **Submit**: the answers go to Claude as one prompt that starts with `I answered your questions in the following way:`, followed by `Q:`/`A:` pairs. Unanswered questions are left out.

Extraction uses **`haiku` by default**. Change the `model` option in `/config`, or set `pluginConfigs.answer.options.model` in settings to another model alias or ID.

### Prompts sent by the mod

- **Extraction model call (`$.model.complete`)**: the prompt is the full text of the latest non-empty assistant reply, unchanged. The system prompt is [`SYSTEM_PROMPT` in `hooks/lib.mjs`](hooks/lib.mjs): it instructs the model to extract user-facing questions in order as JSON, include essential context, use headers of at most 12 characters, provide 2–4 concise options with descriptions (Yes/No for confirmations and suggestions for open-ended questions), omit an "Other" option, mark multi-select only for compatible choices, and return an empty questions array when none are found. No other conversation messages, files, or tool results are included by the mod.
- **Retry**: if the first reply cannot be parsed, the mod sends the same assistant text and system prompt once more, appending: `Your reply must be exactly one JSON object and nothing else: no prose, no code fences, no commentary. Escape quotes and newlines inside strings.`
- **Conversation submission (`$.prompt.submit`)**: after all dialog rounds complete, the mod submits a new user message (`asUser: true`) beginning exactly with `I answered your questions in the following way:`, then a blank line and `Q: <extracted question>` / `A: <your answer>` blocks separated by blank lines. Questions are model-extracted and may be rephrased; answers are selected option labels or your custom text, with whitespace normalized. Multiple selections are joined with `,`. Unanswered questions are omitted. Cancellation or no answers means no prompt is submitted. No additional instructions are appended.

With `--debug`, the command output also contains the extraction model name, raw model replies, and parsed questions/options; Claude can read that output. Extraction failures may include a snippet of the model reply even without `--debug`.

### Intentional tool-input changes

The mod changes **only `AskUserQuestion`**, through its `tool.call` hook. `/answer` calls `$.ui.ask` with the placeholder `Answer Claude's questions?`, header `Answer`, and options `Answer` / `Cancel`. While a round is pending, the hook matches that placeholder as the first question and calls `next({ ...e, questions })`, replacing the entire `questions` array with up to four extracted questions. Each has `question`, `header`, `options` (labels and descriptions), and `multiSelect`; all other event fields are preserved. This lets the native dialog display the extracted questions instead of the placeholder. The hook reads the returned answers or cancellation and returns the tool result unchanged.

If no round is pending or the first question does not match the placeholder, the hook calls **`next(e)` unchanged**. Ordinary Claude-generated `AskUserQuestion` calls pass through under that rule; all other tools are outside the hook's filter and are not modified.

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

- `hooks/register.mjs`: the `/answer` command (extraction, one retry, the `--debug` report) and the `tool.call` hook that fills the native dialog
- `hooks/lib.mjs`: the extraction prompt, JSON repair and recovery from replies cut off partway, fitting questions to the dialog's limits (header ≤ 12 chars, 2–4 options, ≤ 4 questions per round), and compiling the answers
- `tests/answer.test.ts`: tests, with the model and the dialog faked beneath the plugin: JSON repairs, rounds of four, the submitted prompt, Esc and "Chat about this", the retry, and the `--debug` report

## License

MIT. See [LICENSE](LICENSE).
