// Acces aux dossiers de l'ordinateur (Chrome / Edge).
var SL = self.SL = self.SL || {};
SL.fsa = (function () {
  const supported = typeof self.showDirectoryPicker === 'function';

  async function pick(id, write) {
    return self.showDirectoryPicker({ id, mode: write ? 'readwrite' : 'read' });
  }

  async function hasPermission(handle, write) {
    return (await handle.queryPermission({ mode: write ? 'readwrite' : 'read' })) === 'granted';
  }

  async function requestPermission(handle, write) {
    const opts = { mode: write ? 'readwrite' : 'read' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  async function subdir(root, parts) {
    let d = root;
    for (const p of parts) d = await d.getDirectoryHandle(SL.naming.clean(p) || '_', { create: true });
    return d;
  }

  async function exists(dir, name) {
    try {
      await dir.getFileHandle(name);
      return true;
    } catch (e) {
      if (e.name === 'NotFoundError') return false;
      if (e.name === 'TypeMismatchError') return true;
      throw e;
    }
  }

  // Ajoute -2, -3... si le fichier existe deja : jamais d'ecrasement.
  async function uniqueName(dir, name) {
    if (!(await exists(dir, name))) return name;
    const stem = SL.naming.stem(name);
    const ext = name.slice(stem.length);
    for (let k = 2; ; k++) {
      const candidate = `${stem}-${k}${ext}`;
      if (!(await exists(dir, candidate))) return candidate;
    }
  }

  async function writeFile(dir, name, blob) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }

  return { supported, pick, hasPermission, requestPermission, subdir, uniqueName, writeFile };
})();
