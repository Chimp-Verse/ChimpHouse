# ChimpHouse agent notes

## Committing Git LFS files

The large art files are stored with Git LFS: the Blender master file and its textures and exports (the tracked patterns are in `.gitattributes`). GitHub keeps every committed version of an LFS file in full and counts it against the account's limited LFS storage and download allowance, and deleting the files later doesn't give that space back.

- Commit LFS files at **milestones** only: a finished room, an agreed batch of model or texture changes, a step of the move to Blender. Between milestones, Blender work stays as local saves.
- Keep art and code in separate commits, so code can be committed whenever it's ready while the art waits for its milestone.
- When asked to commit and an LFS file has changed without reaching a milestone, commit the code, leave the LFS file out, and say so, asking whether this counts as a milestone.
- Before an LFS commit, list the LFS files being committed and their sizes for the user.
