# Failed tool call is saved as complete

Repro for `@tanstack/ai` 0.58.0. When a server tool call fails, `chat()` streams its result as `output-error`. But the tool message that `chat()` keeps in its message history has no `error`. As a result, `modelMessagesToUIMessages` rebuilds the `tool-result` part with `state: 'complete'` and no `error`.

```sh
npm install
npm run repro
```

No API key is necessary. A scripted adapter makes one tool call for each case:

- input that fails the zod schema of the tool
- a handler that throws
- a tool name that does not exist

The script reads the final messages in the `onFinish` hook of a middleware. `@tanstack/ai-persistence` saves the same list.

## Output

Each case prints the same shape. This is the output for the handler that throws:

```
## handler throws
1. streamed TOOL_CALL_RESULT metadata: { tanstack: { state: 'output-error' } }
2. saved tool message: {
  role: 'tool',
  content: '{"error":"lookup is down"}',
  toolCallId: 'call_1'
}
3. rebuilt tool-result part: { state: 'complete', error: undefined }
```

Expected: the saved tool message has `error`, and the rebuilt `tool-result` part is `{ state: 'error', error: 'lookup is down' }`.
