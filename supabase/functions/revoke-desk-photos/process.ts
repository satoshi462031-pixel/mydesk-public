export type RevocationJob = {
  id: string; lease_token: string; owner_id: string; desk_id: string;
  old_url: string; new_url: string; preserve_photo: boolean; committed: boolean;
}
export type RevocationStore = {
  list(folder: string, search: string): Promise<string[]>;
  copy(source: string, target: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  commit(job: RevocationJob, copyReady: boolean): Promise<boolean>;
  finish(job: RevocationJob): Promise<void>;
}

function photoPath(value: string, job: RevocationJob, supabaseUrl: string): string {
  const url = new URL(value)
  const prefix = `/storage/v1/object/public/desk-images/${job.owner_id}/${job.desk_id}/`
  if (url.origin !== new URL(supabaseUrl).origin || url.protocol !== 'https:' || url.username || url.password
    || url.search || url.hash || !url.pathname.startsWith(prefix)) throw new Error('INVALID_REVOCATION_URL')
  const filename = url.pathname.slice(prefix.length)
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:jpg|png|webp)$/.test(filename)) throw new Error('INVALID_REVOCATION_PATH')
  return `${job.owner_id}/${job.desk_id}/${filename}`
}

function variants(path: string): string[] {
  return [...new Set([path, path.replace(/\.jpg$/, '_thumb.jpg'), path.replace(/\.jpg$/, '_md.jpg')])]
}

async function existing(store: RevocationStore, paths: string[]): Promise<string[]> {
  const first = paths[0], at = first.lastIndexOf('/')
  const folder = first.slice(0, at), basename = first.slice(at + 1).replace(/\.(?:jpg|png|webp)$/, '')
  const files = new Set(await store.list(folder, basename))
  return paths.filter((path) => files.has(path.slice(at + 1)))
}

export async function processPhotoRevocation(store: RevocationStore, job: RevocationJob, supabaseUrl: string): Promise<void> {
  const source = photoPath(job.old_url, job, supabaseUrl)
  const target = photoPath(job.new_url, job, supabaseUrl)
  if (source === target) throw new Error('INVALID_REVOCATION_TARGET')
  const sources = variants(source), targets = variants(target)
  let copyReady = false
  if (job.preserve_photo && !job.committed) {
    const available = await existing(store, sources)
    const copied = new Set(await existing(store, targets))
    for (const path of available) {
      const index = sources.indexOf(path)
      if (!copied.has(targets[index])) { await store.copy(path, targets[index]); copied.add(targets[index]) }
    }
    copyReady = copied.has(target)
  }
  const targetUsed = await store.commit(job, copyReady)
  if (!targetUsed) await store.remove(targets)
  await store.remove(sources)
  if ((await existing(store, sources)).length) throw new Error('PHOTO_REVOCATION_INCOMPLETE')
  await store.finish(job)
}
