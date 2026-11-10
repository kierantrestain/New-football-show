import type { Board, Still } from './model'

const STORE = 'boards'
const LIBRARY = 'library'

export type BoardListing = Pick<Board, 'id' | 'name' | 'updatedAt'> & { sceneCount: number }
const LAST = 'touchline.active.v1'
let database: Promise<IDBDatabase> | undefined

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('touchline-tactics', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' })
      request.result.createObjectStore(LIBRARY, { keyPath: 'id' })
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); database = undefined }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('The board library is open in another window.'))
  }).catch((error) => {
    database = undefined
    throw error
  })
  return database
}

async function transact<T>(stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode)
    const request = action(transaction)
    transaction.oncomplete = () => resolve(request.result)
    transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error('Board storage was interrupted.'))
  })
}

export async function saveBoard(board: Board): Promise<void> {
  const listing: BoardListing = { id: board.id, name: board.name, updatedAt: board.updatedAt, sceneCount: board.scenes.length }
  await transact([STORE, LIBRARY], 'readwrite', (tx) => {
    tx.objectStore(LIBRARY).put(listing)
    return tx.objectStore(STORE).put(board)
  })
  rememberBoard(board.id)
}

export async function listBoards(): Promise<BoardListing[]> {
  const boards = await transact<BoardListing[]>([LIBRARY], 'readonly', (tx) => tx.objectStore(LIBRARY).getAll())
  return boards.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function openBoard(id: string): Promise<Board | undefined> {
  return transact([STORE], 'readonly', (tx) => tx.objectStore(STORE).get(id))
}

export async function deleteBoard(id: string): Promise<void> {
  await transact([STORE, LIBRARY], 'readwrite', (tx) => {
    tx.objectStore(LIBRARY).delete(id)
    return tx.objectStore(STORE).delete(id)
  })
  if (lastBoardId() === id) rememberBoard(null)
}

export function rememberBoard(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST, id)
    else localStorage.removeItem(LAST)
  } catch {
    // IndexedDB remains usable when the browser blocks localStorage.
  }
}

export function lastBoardId(): string | null {
  try { return localStorage.getItem(LAST) } catch { return null }
}

const imageTypes = /^data:image\/(png|jpeg|webp);base64,/i

export async function readStill(file: File): Promise<Still> {
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
    throw new Error('Choose a PNG, JPEG or WebP image.')
  }
  if (file.size > 30 * 1024 * 1024) throw new Error('Choose an image under 30 MB.')
  const type = /\.png$/i.test(file.name) ? 'image/png'
    : /\.webp$/i.test(file.name) ? 'image/webp' : 'image/jpeg'
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('The image could not be read.'))
    reader.onload = () => typeof reader.result === 'string' && imageTypes.test(reader.result)
      ? resolve(reader.result) : reject(new Error('Choose a PNG, JPEG or WebP image.'))
    reader.readAsDataURL(/^image\/(png|jpeg|webp)$/i.test(file.type) ? file : new Blob([file], { type }))
  })
  const image = new Image()
  image.src = src
  await image.decode().catch(() => { throw new Error('The image could not be opened.') })
  return { src, width: image.naturalWidth, height: image.naturalHeight, fit: 'fit' }
}
