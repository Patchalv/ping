// What Threads and Thread Responses share once posted: the "edited" mark and what the
// viewer may do with them.

/**
 * The "edited" mark. `by` is set only when someone other than the author made the last
 * edit, for "edited by <name>".
 */
export type EditedMark = { at: string; by: { staffId: string; name: string } | null };

/**
 * What the viewer may do with a Thread or Thread Response, decided by the server's
 * permissions module. The web only hides the controls they can't use.
 */
export type ContentActions = { canEdit: boolean; canDelete: boolean };

/**
 * The "edited" mark for something its author posted, from who last edited it and when.
 * Null when it was never edited.
 */
export function toEditedMark(edit: {
  authorId: string | null;
  editedAt: Date | null;
  editedBy: string | null;
  editorName: string | null;
}): EditedMark | null {
  if (edit.editedAt === null) return null;
  return {
    at: edit.editedAt.toISOString(),
    by:
      edit.editedBy === null || edit.editedBy === edit.authorId
        ? null
        : { staffId: edit.editedBy, name: edit.editorName ?? '' },
  };
}
