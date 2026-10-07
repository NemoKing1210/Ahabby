import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'

import { clearProxiedImages, proxiedImage } from './images'

vi.mock('@/shared/api/ipc', () => ({ ipc: { fetchWebImage: vi.fn() } }))

const PNG = { mime: 'image/png', base64: 'AAAA' }

/** Drain the microtask queue: the loader hands the next slot over in a promise chain. */
async function flush() {
  for (let tick = 0; tick < 8; tick += 1) await Promise.resolve()
}

beforeEach(() => {
  clearProxiedImages()
  vi.mocked(ipc.fetchWebImage).mockReset()
})

describe('images of a page Ahabby is reading', () => {
  it('asks for one image once, however often the page uses it', async () => {
    vi.mocked(ipc.fetchWebImage).mockResolvedValue(PNG)

    const [first, second] = await Promise.all([
      proxiedImage('https://docs.example.com/logo.png'),
      proxiedImage('https://docs.example.com/logo.png'),
    ])
    expect(first).toBe('data:image/png;base64,AAAA')
    expect(second).toBe(first)

    await proxiedImage('https://docs.example.com/logo.png')
    expect(ipc.fetchWebImage).toHaveBeenCalledTimes(1)
  })

  it('remembers a refusal instead of asking the backend again', async () => {
    vi.mocked(ipc.fetchWebImage).mockRejectedValue(new Error('not an image'))

    expect(await proxiedImage('https://docs.example.com/broken.png')).toBeNull()
    expect(await proxiedImage('https://docs.example.com/broken.png')).toBeNull()
    expect(ipc.fetchWebImage).toHaveBeenCalledTimes(1)
  })

  /** A page can name a hundred images; the IPC must not carry a hundred requests at once. */
  it('fetches a handful at a time, and never more', async () => {
    let inFlight = 0
    let peak = 0
    const gates: Array<() => void> = []
    vi.mocked(ipc.fetchWebImage).mockImplementation(
      () =>
        // The type of `Promise.withResolvers` is not in this project's `lib`, and the gate is
        // what the case needs: a request that only finishes when the test says so.
        new Promise((resolve) => {
          inFlight += 1
          peak = Math.max(peak, inFlight)
          gates.push(() => {
            inFlight -= 1
            resolve(PNG)
          })
        }),
    )

    const images = Array.from({ length: 6 }, (_, index) =>
      proxiedImage(`https://docs.example.com/${index}.png`),
    )
    // The first slots are taken synchronously; the rest wait for one to come free.
    expect(ipc.fetchWebImage).toHaveBeenCalledTimes(4)

    while (vi.mocked(ipc.fetchWebImage).mock.calls.length < 6) {
      gates.splice(0, gates.length).forEach((gate) => gate())
      await flush()
    }
    gates.splice(0, gates.length).forEach((gate) => gate())

    await Promise.all(images)
    expect(ipc.fetchWebImage).toHaveBeenCalledTimes(6)
    expect(peak).toBe(4)
  })
})
