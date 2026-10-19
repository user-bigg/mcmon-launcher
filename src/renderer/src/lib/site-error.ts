import type { SiteError } from '@shared/site';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { IconName } from '../components/icons';

export interface ErrorView {
  icon: IconName;
  title: string;
  text: string;
  tone: 'neutral' | 'danger';
}

const DEFAULT_RETRY_S = 60;

export function siteErrorView(error: SiteError | null): ErrorView {
  if (error?.code === 'timeout') {
    return {
      icon: 'clock',
      title: ru.state.timeoutTitle,
      text: ru.state.timeoutText,
      tone: 'neutral',
    };
  }
  if (error === null || error.code === 'offline') {
    return {
      icon: 'wifi-off',
      title: ru.state.offlineTitle,
      text: ru.state.offlineText,
      tone: 'neutral',
    };
  }
  if (error.code === 'rate-limited') {
    return {
      icon: 'clock-history',
      title: ru.state.rateLimitedTitle,
      text: fill(ru.state.rateLimited, { seconds: error.retryAfterS ?? DEFAULT_RETRY_S }),
      tone: 'neutral',
    };
  }
  return {
    icon: 'exclamation-triangle',
    title: ru.state.errorTitle,
    text: ru.state.errorText,
    tone: 'danger',
  };
}
