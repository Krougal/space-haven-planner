const DB_NAME = 'space-haven-planner'
const DB_VERSION = 1
const STORE_NAME = 'file-system-handles'
const EXPORT_DIRECTORY_KEY = 'export-directory'

interface ExportWritableFileStream {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}

interface ExportFileHandle {
  createWritable(): Promise<ExportWritableFileStream>
}

export interface ExportDirectoryHandle {
  readonly name: string
  getFileHandle(name: string, options?: { create?: boolean }): Promise<ExportFileHandle>
  queryPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<ExportDirectoryHandle>
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open export folder storage'))
  })
}

async function persistExportDirectory(handle: ExportDirectoryHandle): Promise<void> {
  try {
    const db = await openDatabase()
    if (!db) return

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(handle, EXPORT_DIRECTORY_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Failed to store export folder'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Failed to store export folder'))
    })

    db.close()
  } catch {
    // Folder handles are structured-cloneable in supporting browsers, but persistence is best-effort.
  }
}

export function isExportDirectorySupported(): boolean {
  if (typeof window === 'undefined') return false
  return typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function'
}

export async function loadExportDirectory(): Promise<ExportDirectoryHandle | null> {
  try {
    const db = await openDatabase()
    if (!db) return null

    const handle = await new Promise<ExportDirectoryHandle | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(EXPORT_DIRECTORY_KEY)
      request.onsuccess = () => resolve((request.result as ExportDirectoryHandle | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error('Failed to load export folder'))
    })

    db.close()
    return handle
  } catch {
    return null
  }
}

export async function chooseExportDirectory(): Promise<ExportDirectoryHandle | null> {
  if (!isExportDirectorySupported()) return null

  const picker = (window as DirectoryPickerWindow).showDirectoryPicker
  if (!picker) return null

  const handle = await picker.call(window, { mode: 'readwrite' })
  await persistExportDirectory(handle)
  return handle
}

async function ensureWritePermission(handle: ExportDirectoryHandle): Promise<boolean> {
  const descriptor = { mode: 'readwrite' as const }

  if (!handle.queryPermission || !handle.requestPermission) {
    return true
  }

  if ((await handle.queryPermission(descriptor)) === 'granted') {
    return true
  }

  return (await handle.requestPermission(descriptor)) === 'granted'
}

export async function writeExportFile(
  directory: ExportDirectoryHandle,
  filename: string,
  blob: Blob
): Promise<boolean> {
  if (!(await ensureWritePermission(directory))) {
    return false
  }

  const fileHandle = await directory.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(blob)
  await writable.close()
  return true
}

export function dataURLToBlob(dataURL: string): Blob {
  const commaIndex = dataURL.indexOf(',')
  if (commaIndex < 0) {
    throw new Error('Invalid data URL')
  }

  const header = dataURL.slice(0, commaIndex)
  const payload = dataURL.slice(commaIndex + 1)
  const mimeType = header.match(/^data:([^;,]+)/)?.[1] ?? 'application/octet-stream'

  if (header.includes(';base64')) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new Blob([bytes], { type: mimeType })
  }

  return new Blob([decodeURIComponent(payload)], { type: mimeType })
}
