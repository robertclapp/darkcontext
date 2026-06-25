# DarkContext — Sync

Move your store between machines using your existing file-sync layer
(Syncthing, Dropbox, iCloud Drive, NFS mount, SMB share, USB stick).
DarkContext provides safe push/pull semantics on top of any reachable
filesystem path; you bring the transport.

## TL;DR

```bash
# Laptop A
dcx push ~/Sync/darkcontext/store.db

# Laptop B (file is now in the shared folder via your sync app)
dcx pull ~/Sync/darkcontext/store.db --yes
```

That's the whole product surface for sync.

## Semantics

- **Single-writer-at-a-time.** Two `dcx push` runs against the same
  destination are blocked by a `<dest>.lock` sentinel. Two laptops
  *editing* their local stores between syncs is **not** safe — the
  later push wins and the earlier laptop's writes are lost. Multi-
  writer merge (CRDT, server arbitration) is a different feature with
  a different design and is **not** part of `dcx push`/`dcx pull`.
- **Atomic publish.** `push` writes to `<dest>.dcx-tmp` first via
  SQLite's online backup API and renames into place once the copy is
  complete. A crashed push leaves the `.tmp` behind for the next run
  to sweep but never half-overwrites the destination.
- **Lock TTL.** Lock files older than 5 minutes are treated as stale
  and overridden automatically (assumed-dead writer). For fresh locks,
  use `--force` if you're sure the recorded process is dead. The lock
  body is `{ host, pid, ts, op }` so you can decide.
- **Encryption-at-rest does NOT survive a sync today.** `dcx push` /
  `dcx pull` open the source DB with its key (so reads decrypt
  correctly), but `better-sqlite3`'s `backup()` API has no
  destination-key option — the page copy lands as plaintext on the
  remote and on any pulled destination. If you set
  `DARKCONTEXT_ENCRYPTION_KEY`, treat the synced file as confidential
  data leaving your encrypted-at-rest perimeter; layer transport
  encryption (Syncthing folder password, encrypted volume, SSH) on top.
  A keyed-destination follow-up is tracked in `Follow-ups`.

## What sync does NOT do

- **No merge.** `dcx pull --yes` overwrites the local store byte for
  byte. If you need to preserve local changes, push them first.
- **No deltas.** Every sync transfers the whole file. For a 100 MB
  store on a fast LAN this is a few seconds; for a slow link with a
  large store, layer rsync underneath.
- **No transport.** We don't ship SSH/HTTPS clients. Use whatever
  filesystem-sync tool you already trust.
- **No conflict detection across machines.** Two laptops that edit
  the same store between sync runs will lose data on the later push.
  If you need that, the right primitive is to **import** instead of
  pull: `dcx export -o snap.json` on each side and merge them in a
  separate tool.

## Recommended workflows

### One device active at a time (laptop / desktop)

```bash
# Before switching to the other machine
laptop$ dcx push ~/Sync/darkcontext/store.db

# On the other machine
desktop$ dcx pull ~/Sync/darkcontext/store.db --yes
```

This is safe as long as you remember to push before switching. The
lock file catches the simultaneous-push mistake; nothing catches the
"forgot to push" mistake.

### USB stick / air-gapped

```bash
# Source machine
$ dcx push /mnt/usb/store.db

# Eject, insert into target machine
$ dcx pull /mnt/usb/store.db --yes
```

## Operations

### Inspect a stale lock

```bash
$ cat ~/Sync/darkcontext/store.db.lock
{"host":"laptop-a","pid":42312,"ts":1700000000000,"op":"push"}
```

If the recorded process is gone, break the lock:

```bash
$ rm ~/Sync/darkcontext/store.db.lock
# or just pass --force on the next push/pull
```

### Recover from an interrupted push

If a `push` was killed mid-flight you'll find a `<dest>.dcx-tmp`
sitting next to the destination. Safe to delete — the next `push`
will overwrite it.

### Backup vs sync

`dcx backup <dest>` and `dcx push <dest>` use the same SQLite online
backup API under the hood. The differences:

| | `backup` | `push` |
|---|---|---|
| Lock file | no | yes (`<dest>.lock`) |
| Atomic rename | no | yes (`.dcx-tmp` + rename) |
| Intent | one-shot snapshot for safekeeping | regular sync to a shared location |

If you're just taking a one-time snapshot and not coordinating with
another writer, either works.
