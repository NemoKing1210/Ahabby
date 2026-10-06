import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { McpKeyValue } from '@/shared/bindings/McpKeyValue'
import type { McpServerDraft } from '@/shared/bindings/McpServerDraft'
import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { FormField } from '@/shared/ui/FormField'
import { Input } from '@/shared/ui/Input'
import { OwnerSelect } from '@/shared/ui/OwnerSelect'
import { Textarea } from '@/shared/ui/Textarea'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useCreateMcpServer } from '../api/hooks'

type Transport = McpServerDraft['transport']['type']

/** One argument per line; blank lines are ignored. */
const parseLines = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

/** `KEY=value` per line; a line without `=` becomes a key with an empty value. */
const parsePairs = (value: string): McpKeyValue[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separator = line.indexOf('=')
      return separator === -1
        ? { key: line, value: '' }
        : { key: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() }
    })
    .filter((pair) => pair.key.length > 0)

/**
 * Add an MCP server to the config file of your choice.
 *
 * The entry is written in the shape agents share — `command`/`args`/`env` for a local process,
 * `type: http` with `url`/`headers` for a remote one — into the file the manifest already
 * declares, so nothing about the agent's own layout has to be known here.
 */
export function CreateMcpServerDialog({
  owners,
  onClose,
}: {
  owners: AgentRef[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const create = useCreateMcpServer()

  const [ownerId, setOwnerId] = useState(owners[0]?.id ?? '')
  const [transport, setTransport] = useState<Transport>('stdio')
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState('')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState('')

  const trimmedName = name.trim()
  const valid =
    trimmedName.length > 0 &&
    ownerId.length > 0 &&
    (transport === 'stdio' ? command.trim().length > 0 : url.trim().length > 0)

  const submit = () => {
    if (!valid) return
    const draft: McpServerDraft =
      transport === 'stdio'
        ? {
            name: trimmedName,
            transport: {
              type: 'stdio',
              command: command.trim(),
              args: parseLines(args),
              env: parsePairs(env),
            },
          }
        : {
            name: trimmedName,
            transport: { type: 'http', url: url.trim(), headers: parsePairs(headers) },
          }

    create.mutate(
      { agentId: ownerId, draft },
      {
        onSuccess: (result) => {
          toast.success(t('mcp.created', { name: result.data.name }))
          onClose()
        },
        // A refused write keeps the form open: the message says what to fix.
        onError: (error) => toastAppError(error),
      },
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-[min(640px,92vw)]">
        <DialogHeader>
          <DialogTitle>{t('mcp.createTitle')}</DialogTitle>
          <DialogDescription>{t('mcp.createBody')}</DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <OwnerSelect
            label={t('mcp.createOwner')}
            hint={owners.length > 1 ? t('mcp.createOwnerHint') : undefined}
            owners={owners}
            value={ownerId}
            onChange={setOwnerId}
          />

          <FormField label={t('mcp.createName')} htmlFor="create-mcp-name">
            <Input
              id="create-mcp-name"
              autoFocus
              value={name}
              maxLength={80}
              placeholder={t('mcp.createNamePlaceholder')}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>

          <FormField label={t('mcp.createTransport')} hint={t('mcp.createTransportHint')}>
            <div className="flex flex-wrap gap-2">
              <Chip
                label={t('mcp.transportStdio')}
                active={transport === 'stdio'}
                onClick={() => setTransport('stdio')}
              />
              <Chip
                label={t('mcp.transportHttp')}
                active={transport === 'http'}
                onClick={() => setTransport('http')}
              />
            </div>
          </FormField>

          {transport === 'stdio' ? (
            <>
              <FormField label={t('mcp.createCommand')} htmlFor="create-mcp-command">
                <Input
                  id="create-mcp-command"
                  value={command}
                  placeholder={t('mcp.createCommandPlaceholder')}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </FormField>

              <FormField
                label={t('mcp.createArgs')}
                htmlFor="create-mcp-args"
                hint={t('mcp.createArgsHint')}
              >
                <Textarea
                  id="create-mcp-args"
                  rows={3}
                  className="font-mono"
                  value={args}
                  placeholder={t('mcp.createArgsPlaceholder')}
                  onChange={(event) => setArgs(event.target.value)}
                />
              </FormField>

              <FormField
                label={t('mcp.createEnv')}
                htmlFor="create-mcp-env"
                hint={t('mcp.createPairsHint')}
              >
                <Textarea
                  id="create-mcp-env"
                  rows={3}
                  className="font-mono"
                  value={env}
                  placeholder={t('mcp.createPairsPlaceholder')}
                  onChange={(event) => setEnv(event.target.value)}
                />
              </FormField>
            </>
          ) : (
            <>
              <FormField label={t('mcp.createUrl')} htmlFor="create-mcp-url">
                <Input
                  id="create-mcp-url"
                  value={url}
                  placeholder={t('mcp.createUrlPlaceholder')}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </FormField>

              <FormField
                label={t('mcp.createHeaders')}
                htmlFor="create-mcp-headers"
                hint={t('mcp.createPairsHint')}
              >
                <Textarea
                  id="create-mcp-headers"
                  rows={3}
                  className="font-mono"
                  value={headers}
                  placeholder={t('mcp.createPairsPlaceholder')}
                  onChange={(event) => setHeaders(event.target.value)}
                />
              </FormField>
            </>
          )}
        </DialogBody>

        <div className="border-border flex items-center justify-end gap-2 border-t px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid || create.isPending}>
            {t('mcp.createSubmit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
