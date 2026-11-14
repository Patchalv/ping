import type { ChannelView } from '@ping/shared';
import { Link } from '@tanstack/react-router';
import { LockIcon } from '../../components/icons';
import { NotFound } from '../../components/NotFound';
import { ApiError } from '../../lib/api-client';
import { useChannel } from './api';

/** The Channel view: its Channel bar above the Thread feed. */
export function ChannelPage({ channelId }: { channelId: string }) {
  const channel = useChannel(channelId);
  if (channel.isPending) return <p className="main-note">Loading…</p>;
  if (channel.isError) {
    return channel.error instanceof ApiError && channel.error.status === 404 ? (
      <ChannelNotFound />
    ) : (
      <p className="main-note main-note--error" role="alert">
        {channel.error.message}
      </p>
    );
  }
  return (
    <>
      <ChannelBar channel={channel.data} />
      <section className="feed" aria-label="Threads">
        <div className="feed__empty">
          <p className="feed__empty-title">No Threads yet</p>
          <p className="feed__empty-note">Threads started in this Channel show up here.</p>
        </div>
      </section>
    </>
  );
}

function ChannelBar({ channel }: { channel: ChannelView }) {
  const isPrivate = channel.visibility === 'private';
  return (
    <section className="channel-bar" aria-label="Channel">
      <div className="channel-bar__top">
        {/* Phone only: the sidebar is the home screen, so the Channel view needs a way back. */}
        <Link className="back-link" to="/">
          <span aria-hidden="true">‹</span> Channels
        </Link>
        <h1 className="channel-bar__name">{channel.name}</h1>
        {isPrivate ? (
          <span className="tag">
            <LockIcon />
            Private
          </span>
        ) : null}
        <span className="channel-bar__count">
          {channel.memberCount} {channel.memberCount === 1 ? 'member' : 'members'}
        </span>
      </div>
      {channel.description ? (
        <p className="channel-bar__description">{channel.description}</p>
      ) : null}
      <div className="channel-bar__tabs">
        <span className="channel-bar__tab" aria-current="page">
          Threads
        </span>
      </div>
    </section>
  );
}

/** A missing Channel and a Private one the Staff member isn't in look the same. */
function ChannelNotFound() {
  return (
    <NotFound
      title="Channel not found"
      note="Check the link. If it’s a Private channel, ask one of its Channel admins to add you."
    />
  );
}
