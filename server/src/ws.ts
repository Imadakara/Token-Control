import type { WsServerMessage } from '@tokencontrol/shared';
import type { WebSocket } from 'ws';

/** Реестр WS-подключений по игрокам; пуш state_delta после мутаций. */
export class WsRegistry {
  private sockets = new Map<string, Set<WebSocket>>();

  add(pid: string, socket: WebSocket): void {
    let set = this.sockets.get(pid);
    if (!set) {
      set = new Set();
      this.sockets.set(pid, set);
    }
    set.add(socket);
    socket.on('close', () => {
      set.delete(socket);
      if (set.size === 0) this.sockets.delete(pid);
    });
  }

  push(pid: string, msg: WsServerMessage): void {
    const set = this.sockets.get(pid);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const socket of set) {
      if (socket.readyState === socket.OPEN) socket.send(data);
    }
  }
}
