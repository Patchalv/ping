import type { ChannelView } from '@ping/shared';
import { AppLink } from '../../components/AppLink';
import { LockIcon } from '../../components/icons';
import { NotFound } from '../../components/NotFound';
import { useChannel } from './api';

/** The Channel view: its Channel bar above the Thread feed. */
export function ChannelPage({ channelId }: { channelId: string }) {
  const channel = useChannel(channelId);
  switch (channel.status) {
    case 'loading':
      return <p className="main-note">Loading…</p>;
    case 'notFound':
      return <ChannelNotFound />;
    case 'error':
      return (
        <p className="main-note main-note--error" role="alert">
          {channel.message}
        </p>
      );
    case 'ready':
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
}

function ChannelBar({ channel }: { channel: ChannelView }) {
  const isPrivate = channel.visibility === 'private';
  return (
    <section className="channel-bar" aria-label="Channel">
      <div className="channel-bar__top">
        <BackToChannels />
        <h1 className="channel-bar__name">{channel.name}</h1>
        {isPrivate && (
          <span className="tag">
            <LockIcon />
            Private
          </span>
        )}
        <span className="channel-bar__count">
          {channel.memberCount} {channel.memberCount === 1 ? 'member' : 'members'}
        </span>
      </div>
      {channel.description && <p className="channel-bar__description">{channel.description}</p>}
      <div className="channel-bar__tabs">
        <span className="channel-bar__tab" aria-current="page">
          Threads
        </span>
      </div>
    </section>
  );
}

/** Phone only: the sidebar is the home screen, so the Channel view needs a way back. */
function BackToChannels() {
  return (
    <AppLink className="back-link" href="/">
      <span aria-hidden="true">‹</span> Channels
    </AppLink>
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
