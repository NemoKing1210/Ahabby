import type { ConfigFormat } from '@/shared/bindings/ConfigFormat'

/**
 * The syntax a path should be read with.
 *
 * Mirror of `ConfigFormat::from_extension` in `src-tauri/src/domain/config.rs`: the backend uses it
 * to validate a config, the viewer uses it to highlight one, and the two have to agree about what
 * a file is. Only the shapes CodeMirror has a parser for matter here; everything else is text.
 */
export function fileFormat(path: string): ConfigFormat {
  const extension = path.toLowerCase().split('.').pop() ?? ''
  switch (extension) {
    case 'json':
      return 'json'
    case 'jsonc':
      return 'jsonc'
    case 'toml':
      return 'toml'
    case 'yaml':
    case 'yml':
      return 'yaml'
    case 'md':
    case 'markdown':
    case 'mdx':
      return 'markdown'
    default:
      return 'text'
  }
}
