/**
 * Bundle Monaco from node_modules and register it with the react wrapper.
 *
 * Without this, @monaco-editor/loader pulls the editor from cdn.jsdelivr.net at
 * runtime: a third-party script on an origin whose localStorage holds Snowflake
 * credentials. Imported by SqlPreviewModal so it lands in that lazy chunk.
 */
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment
  }
}

window.MonacoEnvironment = { getWorker: () => new EditorWorker() }

loader.config({ monaco })
