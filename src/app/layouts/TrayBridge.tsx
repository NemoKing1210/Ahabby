import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { onTrayNavigate, onTrayRunAgent } from '@/shared/api/events'
import type { Agent } from '@/shared/bindings/Agent'
import { toast } from '@/shared/ui/Toast'

import { useAgents } from '@/features/agents/api/queries'
import { useRunAgentInTerminal } from '@/features/terminal/api/hooks'

/**
 * What the tray asks of the window.
 *
 * The tray is native UI, so its entries are split by what can finish them: showing the window,
 * scanning the machine and quitting belong to the backend (`desktop::tray`), while going to a
 * screen and starting an agent belong to the shell — they arrive here as events and are carried
 * out by the very hooks the buttons use, so a session started from the tray is a session like any
 * other (in Ahabby's own terminal, or in the external one picked in Settings).
 *
 * The subscriptions are installed once. The agent list is read through a ref for that reason: a
 * scan landing while the window is hidden must not tear them down, and the menu is rebuilt from
 * every scan anyway, so what it offers is never far behind this list.
 */
export function TrayBridge() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { data: report } = useAgents()
  const runInTerminal = useRunAgentInTerminal()

  const agents = useRef<Agent[]>([])
  useEffect(() => {
    agents.current = report?.agents ?? []
  }, [report])

  useEffect(() => {
    const listeners = [
      // `navigate` returns a promise and the listener wants a void handler; nothing here awaits it.
      onTrayNavigate((route) => void navigate(route)),
      onTrayRunAgent((agentId) => {
        const agent = agents.current.find((entry) => entry.id === agentId)
        if (!agent) {
          // The tray menu is rebuilt from every scan, so this is a click racing a rescan — and the
          // honest answer is that there is nothing to start, not a launch that fails later.
          toast.error(t('tray.agentMissing'))
          return
        }
        runInTerminal(agent)
      }),
    ]

    return () => {
      void Promise.all(listeners).then((unlisten) => {
        for (const off of unlisten) off()
      })
    }
  }, [navigate, runInTerminal, t])

  return null
}
