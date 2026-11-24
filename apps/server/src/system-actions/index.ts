// The system-actions module (ADR 0004, permissions.md › System functions). It is the only
// code that may:
//
// 1. Use the ping_system pool, for work with no signed-in Staff member behind it: invite
//    acceptance, bootstrap-admin and the sweepers. dependency-cruiser enforces this.
// 2. Call a system function. A system function is a SECURITY DEFINER function, owned by
//    the table owner and called by ping_app inside the request's own transaction (pass
//    the request's `tx` from withStaffTx). Every system function:
//    - reads the acting Staff member from app.staff_id (public.current_staff_id()), never
//      from an argument;
//    - pins its search_path (`SET search_path = pg_catalog`, with schema-qualified names);
//    - does one fixed job, after the server has authorised the request;
//    - is listed in the catalog guard's SECURITY_DEFINER_FUNCTIONS allowlist, and the RLS
//      suite proves it acts for app.staff_id, does nothing when it's unset, and can't be
//      steered to another Staff member through its arguments.
//
// Each system function has one caller here; later slices add fan_out_pings and the rest.
import { createSystemPool, type SystemDb } from '../db/system-pool';

export { adminSetChannelAdmin } from './admin-set-channel-admin';
export { cleanUpLostAccess } from './clean-up-lost-access';
export { createChannel } from './create-channel';
export { deactivateStaffMember } from './deactivate-staff-member';
export { fanOutPings } from './fan-out-pings';
export { makeChannelPrivate } from './make-channel-private';

export type SystemActions = {
  /** The ping_system handle. Jobs in this module only. */
  readonly db: SystemDb;
  close(): Promise<void>;
};

export function createSystemActions(systemDatabaseUrl: string): SystemActions {
  const pool = createSystemPool(systemDatabaseUrl);
  return { db: pool.db, close: pool.close };
}
