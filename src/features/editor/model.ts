import type { ConfigFile } from '@/shared/bindings/ConfigFile'
import type { ConfigFormat } from '@/shared/bindings/ConfigFormat'

/**
 * One file the backend lets us read, and possibly write.
 *
 * The dashboard builds these from whatever the scan produced — a config, an MCP source file, a
 * skill's `SKILL.md`, an instructions/commands/hooks file — so the editor has a single shape to
 * understand. `editable` mirrors the backend decision; the textarea is never open when it is
 * `false`, and the backend refuses the write anyway.
 */
export interface EditorDocument {
  path: string
  label: string
  format: ConfigFormat
  editable: boolean
  description?: string | null
}

/** The document behind a scanned config file. `editable` can be lowered, never raised. */
export function configDocument(config: ConfigFile): EditorDocument {
  return {
    path: config.path,
    label: config.label,
    format: config.format,
    editable: config.editable,
    description: config.description,
  }
}
