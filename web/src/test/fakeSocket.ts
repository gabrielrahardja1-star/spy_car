import type { SocketLike } from '../data/traccar/socket'

/** A WebSocket stand-in that tests drive by hand. Every instance is kept in `FakeSocket.all`. */
export class FakeSocket implements SocketLike {
  static all: FakeSocket[] = []
  static last(): FakeSocket {
    return FakeSocket.all[FakeSocket.all.length - 1]
  }

  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  closed = false
  url: string

  constructor(url: string) {
    this.url = url
    FakeSocket.all.push(this)
  }
  close() {
    this.closed = true
  }
  open() {
    this.onopen?.({})
  }
  send(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) })
  }
  drop() {
    this.onerror?.({})
    this.onclose?.({})
  }
}
