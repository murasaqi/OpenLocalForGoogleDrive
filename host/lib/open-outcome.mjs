// Turns the DB resolution into either a path to open or an error response.
// Breadcrumbs are only a fallback for when the DB cannot place the item at
// all (unknown ID, schema change): they carry nothing but titles, so for an
// item the DB knows is unreachable or not synced yet they could only match
// a same-named folder somewhere else.
export const decideOpen = (fromDb, resolveBreadcrumbs) => {
  if (fromDb?.unreachable) {
    return {
      response: {
        ok: false,
        error: fromDb.reason,
        ...(fromDb.drive ? { drive: fromDb.drive } : {}),
      },
    };
  }
  const resolved = fromDb ?? resolveBreadcrumbs();
  return resolved ? { resolved } : { response: { ok: false, error: "not_synced" } };
};
