/**
 * Assemble a minimal Monaco from node_modules and register it with the react
 * wrapper. Imported by SqlPreviewModal so it lands in that lazy chunk.
 *
 * Two reasons this is hand-assembled rather than `import * as monaco from
 * 'monaco-editor'`:
 *
 * 1. Without a local bundle, @monaco-editor/loader pulls the editor from
 *    cdn.jsdelivr.net at runtime: a third-party script on an origin whose
 *    localStorage holds Snowflake credentials.
 * 2. The `monaco-editor` barrel is `editor.main`, which registers every
 *    language and every editor contribution — plus the LSP client and the
 *    json/css/html/ts language services, whose four web workers total ~9 MB
 *    and are never requested. This modal is a read-only SQL viewer.
 *
 * Add a feature here if the modal starts needing it; the list is deliberately
 * the smallest set that supports the options SqlPreviewModal passes.
 */
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/editor/editor.api'

// The only language shown. Its tokenizer is lazily imported by the registry.
import 'monaco-editor/languages/definitions/sql/register'

// Turns the registered monarch grammar into highlighting.
import 'monaco-editor/features/tokenization/register'
// `folding: true`.
import 'monaco-editor/features/folding/register'
// Ctrl+F inside a long statement.
import 'monaco-editor/features/find/register'
// Ctrl+C on a selection (the header also has an explicit Copy button).
import 'monaco-editor/features/clipboard/register'
// The icon font. editor.main pulls this in implicitly; without it the find
// widget's buttons and the folding chevrons render as empty boxes.
import 'monaco-editor/features/codicon/register'

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment
  }
}

// No language service is registered, so nothing should ask for a worker. Point
// at the plain editor worker anyway: it is only fetched if something does.
window.MonacoEnvironment = {
  getWorker: async () => {
    const { default: EditorWorker } = await import(
      'monaco-editor/editor/editor.worker?worker'
    )
    return new EditorWorker()
  },
}

loader.config({ monaco })
