export const ANDROID_NOTIFICATION_ICON = 'ic_notification';
export const ANDROID_NOTIFICATION_COLOR = '#FFFFFF';

export function getAndroidNotificationBase(channelId: string) {
  return {
    channelId,
    smallIcon: ANDROID_NOTIFICATION_ICON,
    color: ANDROID_NOTIFICATION_COLOR,
    pressAction: { id: 'default' },
  };
}
