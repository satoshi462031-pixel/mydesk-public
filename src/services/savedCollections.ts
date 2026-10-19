import { supabase } from '../supabase/client'
import { UNIQUE_VIOLATION } from '../supabase/postgresErrors'

export interface SavedCollection {
  id: string
  name: string
  created_at: string
}
export type CollectionItemKind = 'desk' | 'gadget'
const itemColumn = (kind: CollectionItemKind) => kind === 'desk' ? 'bookmark_id' : 'gadget_bookmark_id'

export async function listSavedCollections(userId: string): Promise<SavedCollection[]> {
  const collections: SavedCollection[] = []
  // Proのフォルダ数をPostgRESTの1,000行制限で切らない。
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('saved_collections').select('id, name, created_at')
      .eq('user_id', userId).order('created_at').order('id').range(offset, offset + 499)
    if (error) throw error
    collections.push(...(data ?? []))
    if (!data || data.length < 500) return collections
  }
}

export async function createSavedCollection(userId: string, name: string): Promise<SavedCollection> {
  const normalized = name.trim()
  if (!normalized || [...normalized].length > 60) throw new Error('INVALID_COLLECTION_NAME')
  const { data, error } = await supabase.from('saved_collections').insert({ user_id: userId, name: normalized })
    .select('id, name, created_at').single()
  if (error) throw error
  return data as SavedCollection
}

export async function renameSavedCollection(userId: string, id: string, name: string): Promise<void> {
  const normalized = name.trim()
  if (!normalized || [...normalized].length > 60) throw new Error('INVALID_COLLECTION_NAME')
  const { data, error } = await supabase.from('saved_collections').update({ name: normalized }).eq('user_id', userId).eq('id', id).select('id').single()
  if (error) throw error
  if (!data) throw new Error('COLLECTION_NOT_FOUND')
}

export async function deleteSavedCollection(userId: string, id: string): Promise<void> {
  const { error } = await supabase.from('saved_collections').delete().eq('user_id', userId).eq('id', id)
  if (error) throw error
}

export async function listItemCollections(userId: string, kind: CollectionItemKind, itemId: string): Promise<string[]> {
  const ids: string[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('saved_collection_items').select('collection_id')
      .eq('user_id', userId).eq(itemColumn(kind), itemId).order('id').range(offset, offset + 499)
    if (error) throw error
    ids.push(...(data ?? []).map((row: { collection_id: string }) => row.collection_id))
    if (!data || data.length < 500) return ids
  }
}

export async function setItemCollection(userId: string, collectionId: string, kind: CollectionItemKind, itemId: string, included: boolean): Promise<void> {
  const column = itemColumn(kind)
  const { error } = included
    ? await supabase.from('saved_collection_items').insert({ user_id: userId, collection_id: collectionId, [column]: itemId })
    : await supabase.from('saved_collection_items').delete().eq('user_id', userId).eq('collection_id', collectionId).eq(column, itemId)
  if (error && !(included && error.code === UNIQUE_VIOLATION)) throw error
}
