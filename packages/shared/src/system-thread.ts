// System threads (product.md › System threads): Threads Ping itself starts to announce a
// change to a Channel. They store the Staff members involved by ID, and their names are
// filled in when they're read, so a renamed Staff member shows by their current name.

/** A Staff member a System thread is about, by their current name. Null if unknown. */
type SystemThreadStaff = { staffId: string; name: string } | null;

/**
 * What a System thread announces. Archiving and replacing a Deactivated sole Channel admin
 * arrive with their slices.
 */
export type SystemThreadEvent = { kind: 'channel_made_private'; staff: SystemThreadStaff };

/** The title a System thread shows, with the current names of the people involved. */
export function systemThreadTitle(event: SystemThreadEvent): string {
  switch (event.kind) {
    case 'channel_made_private':
      return event.staff
        ? `${event.staff.name} made this Channel Private`
        : 'This Channel was made Private';
  }
}
