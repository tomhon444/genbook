export async function stopApp(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  // IPC needs neither process-tree discovery privileges nor a shell. The
  // app wrapper asks Next to close its own worker before the CLI exits.
  if (child.connected) child.send({ type: 'ac4-shutdown' });
  else child.kill();
  let timeout;
  try {
    await Promise.race([exited, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('APP_SHUTDOWN_TIMEOUT')), 15000);
    })]);
  } finally { clearTimeout(timeout); }
}
