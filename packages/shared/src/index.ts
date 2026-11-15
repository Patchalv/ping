// zod schemas and types shared by apps/server and apps/web. Never imports server code.

export type HealthzResponse = {
  status: 'ok';
};

export { type SignInBody, signInBody } from './auth';
export {
  CHANNEL_DESCRIPTION_MAX,
  CHANNEL_NAME_MAX,
  type ChannelView,
  type ChannelVisibility,
  type CreateChannelBody,
  channelParams,
  createChannelBody,
  type SidebarChannel,
} from './channel';
export {
  redactSensitiveText,
  SENTRY_DATA_COLLECTION,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from './sentry-scrub';
