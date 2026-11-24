import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The ordinary Next CLI owns a separate HTTP worker. On Windows, terminating
// the CLI with ChildProcess.kill() bypasses its signal handlers and can orphan
// that worker. An IPC message invokes the CLI's own shutdown path instead.
if (process.env.NODE_ENV !== 'development' || process.env.AC4_HTTP_REHEARSAL !== '1' || !process.send || process.argv.length !== 3 || process.argv[2] !== '3115') throw new Error('This app wrapper belongs only to the isolated AC4 runner');
let shutdownRequested = false, shutdownDelivered = false;
function deliverShutdown() {
  if (shutdownRequested && !shutdownDelivered && process.listenerCount('SIGTERM') > 0) {
    shutdownDelivered = true;
    process.emit('SIGTERM');
  }
}
process.on('message', message => {
  if (message?.type === 'ac4-shutdown') { shutdownRequested = true; deliverShutdown(); }
});
// A failed startup can request shutdown before Next finishes loading. The
// newListener event fires before insertion, so defer delivery until the CLI's
// signal handler is actually attached. Never discard an early stop request.
process.on('newListener', event => {
  if (event === 'SIGTERM' && shutdownRequested) setImmediate(deliverShutdown);
});
const entry = path.resolve('node_modules/next/dist/bin/next');
process.argv = [process.execPath, entry, 'dev', '--hostname', '127.0.0.1', '--port', process.argv[2]];
await import(pathToFileURL(entry).href);
