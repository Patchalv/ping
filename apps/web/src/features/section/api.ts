// The Section feature's API: a query-key factory and hooks only. Components use these
// hooks and never call hc or read a response themselves. Sections are personal, so only
// the Staff member's own sidebar reads them.
//
// Moving, collapsing and reordering update the cache at once, so a drag lands without a
// flicker, and put it back if the server refuses. Every change then refetches by key.
import type { CreateSectionBody, SectionView } from '@ping/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { call, callNoContent } from '../../lib/api-client';
import { type Placement, placeIn } from './sidebar-sections';

const sections = api.api.sections;

/** The query keys. Exported so live updates can refetch by them. */
export const sectionKeys = {
  all: ['sections'] as const,
  mine: () => [...sectionKeys.all, 'mine'] as const,
};

/** The Staff member's Sections, in order, each with its Channels in theirs. */
export function useSections() {
  return useQuery({
    queryKey: sectionKeys.mine(),
    queryFn: (): Promise<SectionView[]> => call(() => sections.$get()),
  });
}

/**
 * A mutation that changes the cached Sections first with `apply`, puts them back if it
 * fails, and refetches either way.
 */
function useOptimisticSections<Input>(
  send: (input: Input) => Promise<unknown>,
  apply: (current: SectionView[], input: Input) => SectionView[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    onMutate: async (input: Input) => {
      await queryClient.cancelQueries({ queryKey: sectionKeys.mine() });
      const before = queryClient.getQueryData<SectionView[]>(sectionKeys.mine());
      if (before) queryClient.setQueryData(sectionKeys.mine(), apply(before, input));
      return { before };
    },
    onError: (_error, _input, context) => {
      if (context?.before) queryClient.setQueryData(sectionKeys.mine(), context.before);
    },
    onSettled: () => refetchSections(queryClient),
  });
}

const refetchSections = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: sectionKeys.mine() });

/** + New section, below the others. */
export function useCreateSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSectionBody): Promise<SectionView> =>
      call(() => sections.$post({ json: body })),
    onSuccess: () => refetchSections(queryClient),
  });
}

/** Renames a Section. */
export function useRenameSection(sectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string): Promise<SectionView> =>
      call(() => sections[':sectionId'].$patch({ param: { sectionId }, json: { name } })),
    onSuccess: () => refetchSections(queryClient),
  });
}

/** Collapses or expands a Section. */
export function useCollapseSection() {
  return useOptimisticSections(
    (input: { sectionId: string; collapsed: boolean }) =>
      call(() =>
        sections[':sectionId'].$patch({
          param: { sectionId: input.sectionId },
          json: { collapsed: input.collapsed },
        }),
      ),
    (current, input) =>
      current.map((s) => (s.id === input.sectionId ? { ...s, collapsed: input.collapsed } : s)),
  );
}

/** Puts the Sections in a new order: every one of them, by ID. */
export function useReorderSections() {
  return useOptimisticSections(
    (sectionIds: string[]) => call(() => sections.order.$put({ json: { sectionIds } })),
    (current, sectionIds) => sectionIds.flatMap((id) => current.find((s) => s.id === id) ?? []),
  );
}

/** Deletes a Section. Its Channels go back to the default Channels section. */
export function useDeleteSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sectionId: string) =>
      callNoContent(() => sections[':sectionId'].$delete({ param: { sectionId } })),
    onSuccess: () => refetchSections(queryClient),
  });
}

/** Moves a Channel into a Section (at `position`, or its end), or to the default section. */
export function usePlaceChannel() {
  return useOptimisticSections(
    ({ channelId, ...json }: Placement) =>
      callNoContent(() =>
        api.api.channels[':channelId'].section.$put({ param: { channelId }, json }),
      ),
    (current, placement) => placeIn(current, placement),
  );
}
